const { trashFile } = require("../../utils/files");

async function asImage({ fullFilePath = "", filename = "" }) {
  // OCR is disabled for time-saving. Image files require OCR to extract text.
  console.log(`[asImage] OCR is disabled — skipping image file ${filename}.`);
  trashFile(fullFilePath);
  return {
    success: false,
    reason: `OCR is disabled. Image file "${filename}" cannot be processed without OCR.`,
    documents: [],
  };
}

module.exports = asImage;
