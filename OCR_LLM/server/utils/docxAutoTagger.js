"use strict";

// ─── AI analysis ──────────────────────────────────────────────────────────────

function buildAnalysisPrompt(content) {
  return `You are analyzing a Vietnamese government report document template.
Your job: identify the VARIABLE data fields — values that change between different report instances.

Document content:
${content}

Return ONLY valid JSON (no explanation, no markdown fences):
{
  "simple_fields": {
    "snake_case_tag": "exact substring from the document to be replaced"
  },
  "tables": [
    {
      "array_name": "rows",
      "columns": ["col_tag_1", "col_tag_2", "col_tag_3"]
    }
  ]
}

STRICT RULES:
1. simple_fields values MUST be exact substrings copied from the document above.
2. Only include values that genuinely change: dates, locations, names, phone numbers, amounts, ID numbers.
3. Do NOT include: fixed headings like "I. THÔNG TIN CHUNG", label text like "Địa điểm:", page titles.
4. Use concise English snake_case for tag names.
5. For tables with repeating data rows (STT 1, 2, 3...), add ONE entry in "tables". List columns left-to-right.
6. If there are no tables with repeating rows, return an empty "tables" array.
7. The simple_fields values must be long enough to be unique in the document (avoid matching labels or fixed text).`;
}

/**
 * Call the configured LLM to analyse the document content and return
 * a field-mapping object.  Returns null on any error.
 */
async function analyzeTemplateFields(content) {
  try {
    const { getLLMProvider } = require("./helpers");

    // Ollama's default fetch times out after 5 minutes which is too short for
    // a full document analysis on slow hardware. Temporarily raise the timeout
    // to 2 hours before constructing the provider (it is read in the constructor).
    const TIMEOUT_KEY = "OLLAMA_RESPONSE_TIMEOUT";
    const MIN_TIMEOUT = 5 * 60_000; // 5 minutes in ms
    const ANALYSIS_TIMEOUT = "7200000"; // 2 hours
    const prevTimeout = process.env[TIMEOUT_KEY];
    if (
      !prevTimeout ||
      isNaN(Number(prevTimeout)) ||
      Number(prevTimeout) <= MIN_TIMEOUT
    ) {
      process.env[TIMEOUT_KEY] = ANALYSIS_TIMEOUT;
    }

    const LLM = getLLMProvider();

    // Restore original value so we don't affect other parts of the app
    if (prevTimeout === undefined) delete process.env[TIMEOUT_KEY];
    else process.env[TIMEOUT_KEY] = prevTimeout;

    if (!LLM || typeof LLM.getChatCompletion !== "function") {
      console.warn(
        "[docxAutoTagger] LLM provider does not support getChatCompletion"
      );
      return null;
    }

    const prompt = buildAnalysisPrompt(content);
    const response = await LLM.getChatCompletion(
      [{ role: "user", content: prompt }],
      { temperature: 0.1 }
    );

    if (!response) return null;
    return parseJsonResponse(response.textResponse ?? response);
  } catch (err) {
    console.error("[docxAutoTagger] analyzeTemplateFields:", err.message);
    return null;
  }
}

function parseJsonResponse(text) {
  if (typeof text !== "string") return null;
  // Strip chain-of-thought think blocks (Ollama reasoning models)
  const stripped = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  // Try fenced block first
  const fenced = stripped.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]);
    } catch {
      /* fall through */
    }
  }
  // Try the first top-level JSON object
  const bare = stripped.match(/\{[\s\S]*\}/);
  if (bare) {
    try {
      return JSON.parse(bare[0]);
    } catch {
      /* fall through */
    }
  }
  return null;
}

// ─── XML patching ─────────────────────────────────────────────────────────────

/**
 * Replace every occurrence of `value` in the XML string with `{tag}`.
 * Escapes regex-special characters.
 */
function replaceInXml(xml, value, tag) {
  if (!value || !value.trim()) return xml;
  try {
    const escaped = value.replace(/[-[\]{}()*+?.,\\^$|#]/g, "\\$&");
    return xml.replace(new RegExp(escaped, "g"), `{${tag}}`);
  } catch {
    // Fallback to literal split-join
    return xml.split(value).join(`{${tag}}`);
  }
}

/**
 * Replace the content of a table cell's first paragraph with `newText`.
 */
function setCellText(cellXml, newText) {
  return cellXml.replace(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/, (pXml) => {
    const pTag = pXml.match(/^<w:p(?:\s[^>]*)?>/)?.[0] ?? "<w:p>";
    const pPrMatch = pXml.match(/<w:pPr(?:\s[^>]*)?>[\s\S]*?<\/w:pPr>/);
    const pPr = pPrMatch ? pPrMatch[0] : "";
    // Escape XML special chars inside the placeholder text
    const safe = newText
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    return `${pTag}${pPr}<w:r><w:t xml:space="preserve">${safe}</w:t></w:r></w:p>`;
  });
}

/**
 * Build a docxtemplater loop row from the first data row of a table.
 * The first cell gets `{#arrayName}{col0}`, the last gets `{col_last}{/arrayName}`.
 */
function buildLoopRow(firstDataRowXml, arrayName, columns) {
  const cellMatches = [
    ...firstDataRowXml.matchAll(/<w:tc(?:\s[^>]*)?>[\s\S]*?<\/w:tc>/g),
  ];
  let rowXml = firstDataRowXml;

  for (let i = 0; i < columns.length && i < cellMatches.length; i++) {
    const col = columns[i];
    let placeholder;
    if (columns.length === 1) {
      placeholder = `{#${arrayName}}{${col}}{/${arrayName}}`;
    } else if (i === 0) {
      placeholder = `{#${arrayName}}{${col}}`;
    } else if (i === columns.length - 1) {
      placeholder = `{${col}}{/${arrayName}}`;
    } else {
      placeholder = `{${col}}`;
    }

    const originalCell = cellMatches[i][0];
    const newCell = setCellText(originalCell, placeholder);
    rowXml = rowXml.replace(originalCell, newCell);
  }
  return rowXml;
}

/**
 * Find the first table whose column count matches `columns.length` and
 * replace its data rows with a single docxtemplater loop row.
 */
function injectTableTemplate(xml, tableSpec) {
  const { array_name = "rows", columns = [] } = tableSpec;
  if (!columns.length) return xml;

  let replaced = false;
  return xml.replace(/<w:tbl(?:\s[^>]*)?>[\s\S]*?<\/w:tbl>/g, (tblXml) => {
    if (replaced) return tblXml;

    const rowMatches = [
      ...tblXml.matchAll(/<w:tr(?:\s[^>]*)?>[\s\S]*?<\/w:tr>/g),
    ];
    if (rowMatches.length < 2) return tblXml;

    // Only touch tables whose data row has the same column count as expected
    const dataCells = [
      ...rowMatches[1][0].matchAll(/<w:tc(?:\s[^>]*)?>[\s\S]*?<\/w:tc>/g),
    ];
    if (dataCells.length !== columns.length) return tblXml;

    replaced = true;

    const tblOpen = tblXml.match(/^<w:tbl(?:\s[^>]*)?>/)?.[0] ?? "<w:tbl>";
    const tblPr =
      tblXml.match(/<w:tblPr(?:\s[^>]*)?>[\s\S]*?<\/w:tblPr>/)?.[0] ?? "";
    const tblGrid =
      tblXml.match(/<w:tblGrid(?:\s[^>]*)?>[\s\S]*?<\/w:tblGrid>/)?.[0] ?? "";
    const headerRow = rowMatches[0][0];
    const templateRow = buildLoopRow(rowMatches[1][0], array_name, columns);

    return `${tblOpen}${tblPr}${tblGrid}${headerRow}${templateRow}</w:tbl>`;
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Build a docxtemplater-compatible tagged .docx buffer from a source buffer
 * and the AI analysis result.  Returns null if anything goes wrong.
 */
function buildTaggedDocx(fileBuffer, analysis) {
  if (!analysis) return null;
  try {
    const PizZip = require("pizzip");
    const zip = new PizZip(fileBuffer);

    const entry = zip.file("word/document.xml");
    if (!entry) return null;

    let xml = entry.asText();

    // 1. Simple field replacements
    for (const [tag, value] of Object.entries(analysis.simple_fields ?? {})) {
      xml = replaceInXml(xml, value, tag);
    }

    // 2. Table row loop injection
    for (const tableSpec of analysis.tables ?? []) {
      xml = injectTableTemplate(xml, tableSpec);
    }

    zip.file("word/document.xml", xml);

    return zip.generate({
      type: "nodebuffer",
      compression: "DEFLATE",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
  } catch (err) {
    console.error("[docxAutoTagger] buildTaggedDocx:", err.message);
    return null;
  }
}

/**
 * Return a flat list of all field names for use in the AI prompt.
 * Simple fields are returned as-is; table columns are returned as
 * "rows[].col_name" so the AI knows they belong to an array.
 */
function getFieldList(analysis) {
  if (!analysis) return [];
  const out = [];
  for (const tag of Object.keys(analysis.simple_fields ?? {})) out.push(tag);
  for (const tbl of analysis.tables ?? []) {
    for (const col of tbl.columns ?? []) out.push(`${tbl.array_name}[].${col}`);
  }
  return out;
}

/**
 * Build a docxtemplater-compatible tagged .docx from plain text and the AI
 * analysis result.  Used when the source is a binary .doc file that cannot
 * be patched in-place.  Returns null if anything goes wrong.
 */
function buildTaggedDocxFromText(text, analysis) {
  if (!analysis) return null;
  try {
    const PizZip = require("pizzip");

    // Apply simple-field tag replacements to the plain text
    let taggedText = text;
    for (const [tag, value] of Object.entries(analysis.simple_fields ?? {})) {
      if (value && value.trim())
        taggedText = taggedText.split(value).join(`{${tag}}`);
    }

    // Convert to Word XML paragraphs (one <w:p> per line)
    const escape = (s) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    const paragraphs = taggedText
      .split("\n")
      .map(
        (line) =>
          `<w:p><w:r><w:t xml:space="preserve">${escape(line)}</w:t></w:r></w:p>`
      )
      .join("");

    // Append a loop row for each table spec (placed after the paragraphs)
    let tableXml = "";
    for (const { array_name = "rows", columns = [] } of analysis.tables ?? []) {
      if (!columns.length) continue;
      const headerCells = columns
        .map(
          (c) => `<w:tc><w:p><w:r><w:t>${escape(c)}</w:t></w:r></w:p></w:tc>`
        )
        .join("");
      const dataCells = columns
        .map((c, i) => {
          let ph;
          if (columns.length === 1)
            ph = `{#${array_name}}{${c}}{/${array_name}}`;
          else if (i === 0) ph = `{#${array_name}}{${c}}`;
          else if (i === columns.length - 1) ph = `{${c}}{/${array_name}}`;
          else ph = `{${c}}`;
          return `<w:tc><w:p><w:r><w:t xml:space="preserve">${escape(ph)}</w:t></w:r></w:p></w:tc>`;
        })
        .join("");
      tableXml += `<w:tbl><w:tr>${headerCells}</w:tr><w:tr>${dataCells}</w:tr></w:tbl>`;
    }

    const documentXml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:body>${paragraphs}${tableXml}<w:sectPr/></w:body></w:document>`;

    const contentTypesXml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
      `</Types>`;

    const relsXml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
      `</Relationships>`;

    const zip = new PizZip();
    zip.file("[Content_Types].xml", contentTypesXml);
    zip.file("_rels/.rels", relsXml);
    zip.file("word/document.xml", documentXml);
    zip.file(
      "word/_rels/document.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`
    );

    return zip.generate({
      type: "nodebuffer",
      compression: "DEFLATE",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
  } catch (err) {
    console.error("[docxAutoTagger] buildTaggedDocxFromText:", err.message);
    return null;
  }
}

module.exports = {
  analyzeTemplateFields,
  buildTaggedDocx,
  buildTaggedDocxFromText,
  getFieldList,
};
