"use strict";

/**
 * Extract all simple {tag} placeholder names from a .docx template buffer.
 * Loop tags ({#arr} / {/arr}) are not returned — only leaf field names.
 */
function extractTemplateTags(templateBuffer) {
  const PizZip = require("pizzip");
  const zip = new PizZip(templateBuffer);

  const entry = zip.file("word/document.xml");
  if (!entry) return [];

  const xml = entry.asText();

  // Match {fieldName} — exclude loop markers {#x} {/x} and raw {{{x}}}
  const tags = new Set();
  const re = /\{(?!#|\/|{)([A-Za-z_][A-Za-z0-9_.]*)\}(?!\})/g;
  let m;
  while ((m = re.exec(xml)) !== null) tags.add(m[1].trim());

  return [...tags].sort();
}

/**
 * Fill a .docx template buffer with data using docxtemplater.
 * Returns a Node.js Buffer of the filled .docx.
 *
 * Template syntax:
 *   {fieldName}         — simple text replacement
 *   {#rows}{col}{/rows} — array loop (place in a table row)
 *
 * @param {Buffer} templateBuffer
 * @param {Object} data
 * @returns {Buffer}
 */
function fillDocxTemplate(templateBuffer, data) {
  const PizZip = require("pizzip");
  const Docxtemplater = require("docxtemplater");

  const zip = new PizZip(templateBuffer);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
  });

  try {
    doc.render(data);
  } catch (err) {
    // Attach template error details for debugging
    if (err.properties && err.properties.errors) {
      const message = err.properties.errors
        .map((e) => e.message)
        .join(", ");
      throw new Error(`Template fill error: ${message}`);
    }
    throw err;
  }

  return doc.getZip().generate({
    type: "nodebuffer",
    compression: "DEFLATE",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

module.exports = { extractTemplateTags, fillDocxTemplate };
