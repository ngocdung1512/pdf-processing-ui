"use strict";

const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

function getStorageDir() {
  const dir =
    process.env.NODE_ENV === "development"
      ? path.resolve(__dirname, "../../storage/report-formats")
      : path.resolve(process.env.STORAGE_DIR, "report-formats");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function metaPath() {
  return path.join(getStorageDir(), "meta.json");
}

function readMeta() {
  const p = metaPath();
  if (!fs.existsSync(p)) return [];
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return [];
  }
}

function writeMeta(arr) {
  fs.writeFileSync(metaPath(), JSON.stringify(arr, null, 2));
}

/**
 * List all saved report format entries (no binary).
 * @returns {{ id: string, name: string, filename: string, uploadedAt: string }[]}
 */
function listFormats() {
  return readMeta();
}

/**
 * Save a new report format template.
 * @param {string} name  Display name
 * @param {Buffer} buffer  .docx file binary
 * @returns {{ id: string, name: string, filename: string, uploadedAt: string }}
 */
function saveFormat(name, buffer) {
  const id = uuidv4();
  const filename = `${id}.docx`;
  const dir = getStorageDir();
  fs.writeFileSync(path.join(dir, filename), buffer);
  const entry = {
    id,
    name: name || filename,
    filename,
    uploadedAt: new Date().toISOString(),
    processed: false,
  };
  const meta = readMeta();
  meta.push(entry);
  writeMeta(meta);
  return entry;
}

/**
 * Delete a report format by id.
 * @param {string} id
 * @returns {boolean} true if deleted, false if not found
 */
function deleteFormat(id) {
  const meta = readMeta();
  const idx = meta.findIndex((m) => m.id === id);
  if (idx === -1) return false;
  const [entry] = meta.splice(idx, 1);
  const filePath = path.join(getStorageDir(), entry.filename);
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    /* non-fatal */
  }
  writeMeta(meta);
  return true;
}

/**
 * Get a report format entry + its file path.
 * @param {string} id
 * @returns {{ id, name, filename, uploadedAt, filePath: string } | null}
 */
function getFormat(id) {
  const meta = readMeta();
  const entry = meta.find((m) => m.id === id);
  if (!entry) return null;
  const filePath = path.join(getStorageDir(), entry.filename);
  if (!fs.existsSync(filePath)) return null;
  return { ...entry, filePath };
}

/**
 * Overwrite the stored .docx file for an existing format entry.
 * Used to persist processed templates (with {noi_dung}/{ket_thuc} markers)
 * so that subsequent selections skip the expensive LLM analysis step.
 *
 * @param {string} id
 * @param {Buffer} buffer  Updated .docx binary
 * @returns {boolean}  true if updated, false if not found
 */
function updateFormatFile(id, buffer) {
  const meta = readMeta();
  const entry = meta.find((m) => m.id === id);
  if (!entry) return false;
  const filePath = path.join(getStorageDir(), entry.filename);
  try {
    fs.writeFileSync(filePath, buffer);
    entry.processed = true;
    writeMeta(meta);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  listFormats,
  saveFormat,
  deleteFormat,
  getFormat,
  updateFormatFile,
};
