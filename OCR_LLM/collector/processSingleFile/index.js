const path = require("path");
const fs = require("fs");
const {
  WATCH_DIRECTORY,
  SUPPORTED_FILETYPE_CONVERTERS,
} = require("../utils/constants");
const {
  trashFile,
  isTextType,
  normalizePath,
  isWithin,
} = require("../utils/files");
const RESERVED_FILES = ["__HOTDIR__.md"];
const _inflightJobs = new Map();
const _recentResults = new Map();

function dedupeTtlMs() {
  const raw = Number.parseInt(
    process.env.COLLECTOR_PROCESSFILE_DEDUP_TTL_MS || "",
    10
  );
  return Number.isFinite(raw) && raw >= 0 ? raw : 30_000;
}

/**
 * Process a single file and return the documents
 * @param {string} targetFilename - The filename to process
 * @param {Object} options - The options for the file processing
 * @param {boolean} options.parseOnly - If true, the file will not be saved as a document even when `writeToServerDocuments` is called in the handler. Must be explicitly set to true to use.
 * @param {Object} metadata - The metadata for the file processing
 * @returns {Promise<{success: boolean, reason: string, documents: Object[]}>} - The documents from the file processing
 */
async function processSingleFile(targetFilename, options = {}, metadata = {}) {
  const fullFilePath = path.resolve(
    WATCH_DIRECTORY,
    normalizePath(targetFilename)
  );
  if (!isWithin(path.resolve(WATCH_DIRECTORY), fullFilePath))
    return {
      success: false,
      reason: "Filename is a not a valid path to process.",
      documents: [],
    };

  if (RESERVED_FILES.includes(targetFilename))
    return {
      success: false,
      reason: "Filename is a reserved filename and cannot be processed.",
      documents: [],
    };
  if (!fs.existsSync(fullFilePath))
    return {
      success: false,
      reason: "File does not exist in upload directory.",
      documents: [],
    };

  const fileExtension = path.extname(fullFilePath).toLowerCase();
  if (fullFilePath.includes(".") && !fileExtension) {
    return {
      success: false,
      reason: `No file extension found. This file cannot be processed.`,
      documents: [],
    };
  }

  let processFileAs = fileExtension;
  if (!SUPPORTED_FILETYPE_CONVERTERS.hasOwnProperty(fileExtension)) {
    if (isTextType(fullFilePath)) {
      console.log(
        `\x1b[33m[Collector]\x1b[0m The provided filetype of ${fileExtension} does not have a preset and will be processed as .txt.`
      );
      processFileAs = ".txt";
    } else {
      trashFile(fullFilePath);
      return {
        success: false,
        reason: `File extension ${fileExtension} not supported for parsing and cannot be assumed as text file type.`,
        documents: [],
      };
    }
  }

  const FileTypeProcessor = require(SUPPORTED_FILETYPE_CONVERTERS[
    processFileAs
  ]);
  const dedupeKey = `${fullFilePath}::${processFileAs}::${options?.parseOnly ? "parse" : "process"}`;
  const ttl = dedupeTtlMs();
  const now = Date.now();
  // Chat "parse only" must not reuse the short TTL cache: same filename in hotdir
  // would look like "instant accept" without re-running OCR/extract.
  const skipResultCache = !!options?.parseOnly;
  if (!skipResultCache) {
    const cached = _recentResults.get(dedupeKey);
    if (cached && now - cached.at <= ttl) return cached.result;
    if (cached && now - cached.at > ttl) _recentResults.delete(dedupeKey);
  }

  if (_inflightJobs.has(dedupeKey)) return await _inflightJobs.get(dedupeKey);

  const job = (async () => {
    return await FileTypeProcessor({
      fullFilePath,
      filename: targetFilename,
      options,
      metadata,
    });
  })();

  _inflightJobs.set(dedupeKey, job);
  try {
    const result = await job;
    if (!skipResultCache) {
      _recentResults.set(dedupeKey, { at: Date.now(), result });
    }
    return result;
  } finally {
    if (_inflightJobs.get(dedupeKey) === job) _inflightJobs.delete(dedupeKey);
  }
}

module.exports = {
  processSingleFile,
};
