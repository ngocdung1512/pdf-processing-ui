const { v4 } = require("uuid");
const {
  createdDate,
  trashFile,
  writeToServerDocuments,
} = require("../../../utils/files");
const { tokenizeString } = require("../../../utils/tokenizer");
const { default: slugify } = require("slugify");
const PDFLoader = require("./PDFLoader");
const OCRLoader = require("../../../utils/OCRLoader");

function isTruthy(value = "") {
  return ["1", "true", "yes", "on"].includes(
    String(value).trim().toLowerCase()
  );
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function asPdf({
  fullFilePath = "",
  filename = "",
  options = {},
  metadata = {},
}) {
  const pdfLoader = new PDFLoader(fullFilePath, {
    splitPages: true,
  });

  console.log(`-- Working ${filename} --`);
  const pageContent = [];
  let docs = await pdfLoader.load();
  const totalPages = pdfLoader.numPages;

  const enableOcrFallback =
    options?.ocr?.enabled ??
    isTruthy(process.env.COLLECTOR_ENABLE_PDF_OCR_FALLBACK);
  const hasMissingTextPages = docs.length === 0 || docs.length < totalPages;

  if (hasMissingTextPages && enableOcrFallback) {
    const missingPages = Math.max(totalPages - docs.length, 0);
    console.log(
      `[asPDF] ${filename} has ${missingPages} page(s) without text layer. Running OCR fallback.`
    );

    const ocrLoader = new OCRLoader({
      targetLanguages:
        options?.ocr?.langList || process.env.COLLECTOR_PDF_OCR_LANGS || "eng",
    });
    const ocrDocs = await ocrLoader.ocrPDF(fullFilePath, {
      maxExecutionTime: parsePositiveInt(
        process.env.COLLECTOR_PDF_OCR_MAX_EXECUTION_TIME_MS,
        300_000
      ),
      batchSize: parsePositiveInt(process.env.COLLECTOR_PDF_OCR_BATCH_SIZE, 10),
      maxWorkers: parsePositiveInt(process.env.COLLECTOR_PDF_OCR_MAX_WORKERS, 4),
    });

    const parsedPages = new Set(
      docs
        .map((doc) => doc?.metadata?.loc?.pageNumber)
        .filter((pageNum) => Number.isInteger(pageNum))
    );

    for (const ocrDoc of ocrDocs) {
      const pageNum = ocrDoc?.metadata?.loc?.pageNumber;
      if (Number.isInteger(pageNum) && parsedPages.has(pageNum)) continue;
      docs.push(ocrDoc);
    }

    docs = docs.sort((a, b) => {
      const aPage = a?.metadata?.loc?.pageNumber ?? Number.MAX_SAFE_INTEGER;
      const bPage = b?.metadata?.loc?.pageNumber ?? Number.MAX_SAFE_INTEGER;
      return aPage - bPage;
    });
  } else if (hasMissingTextPages) {
    const missingPages = Math.max(totalPages - docs.length, 0);
    console.log(
      `[asPDF] ${filename} has ${missingPages} page(s) without text layer. OCR fallback is disabled.`
    );
  }

  for (const doc of docs) {
    console.log(
      `-- Parsing content from pg ${
        doc.metadata?.loc?.pageNumber || "unknown"
      } --`
    );
    if (!doc.pageContent || !doc.pageContent.length) continue;
    pageContent.push(doc.pageContent);
  }

  if (!pageContent.length) {
    console.error(`[asPDF] Resulting text content was empty for ${filename}.`);
    trashFile(fullFilePath);
    return {
      success: false,
      reason: `No text content found in ${filename}.`,
      documents: [],
    };
  }

  const content = pageContent.join("");
  const data = {
    id: v4(),
    url: "file://" + fullFilePath,
    title: metadata.title || filename,
    docAuthor:
      metadata.docAuthor ||
      docs[0]?.metadata?.pdf?.info?.Creator ||
      "no author found",
    description:
      metadata.description ||
      docs[0]?.metadata?.pdf?.info?.Title ||
      "No description found.",
    docSource: metadata.docSource || "pdf file uploaded by the user.",
    chunkSource: metadata.chunkSource || "",
    published: createdDate(fullFilePath),
    wordCount: content.split(" ").length,
    pageContent: content,
    token_count_estimate: tokenizeString(content),
  };

  const document = writeToServerDocuments({
    data,
    filename: `${slugify(filename)}-${data.id}`,
    options: { parseOnly: options.parseOnly },
  });
  trashFile(fullFilePath);
  console.log(`[SUCCESS]: ${filename} converted & ready for embedding.\n`);
  return { success: true, reason: null, documents: [document] };
}

module.exports = asPdf;
