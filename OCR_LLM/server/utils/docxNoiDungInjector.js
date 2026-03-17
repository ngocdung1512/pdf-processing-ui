"use strict";

/**
 * Auto-detect the fixed header / body boundary in a Vietnamese government
 * report template and inject a {noi_dung} placeholder paragraph after it.
 *
 * The LLM is asked to identify the exact text of the last fixed header
 * paragraph (motto → slogan → org name → report title → "V/v:" / "Kính gửi:").
 * That paragraph is located in the docx XML and a new paragraph containing
 * only "{noi_dung}" is inserted immediately after it.
 *
 * Public API:
 *   hasNoiDungMarker(fileBuffer) → boolean
 *   autoInjectNoiDung(fileBuffer, content) → Promise<Buffer|null>
 */

// ─── LLM boundary detection ───────────────────────────────────────────────────

function buildBoundaryPrompt(content) {
  return `You are analyzing a Vietnamese government report document template.
Your task: find the EXACT TEXT of the last paragraph that belongs to the fixed header.

The fixed header includes (top-to-bottom, all unchanging):
  1. National motto  — "CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM"
  2. Slogan          — "Độc lập - Tự do - Hạnh phúc"
  3. Separator line  — "----------" or "---***---" (optional)
  4. Organization / unit name (e.g. "ỦY BAN NHÂN DÂN TỈNH …", "PHÒNG …")
  5. Report title    — starts with "BÁO CÁO" (e.g. "BÁO CÁO KẾT QUẢ CÔNG TÁC …")
  6. Subject line    — starts with "V/v:" or "Về việc:" (if present)
  7. Salutation      — "Kính gửi: …" (if present)

The report BODY starts after these, usually with Roman-numeral sections (I., II., …)
or with the date/location line ("…, ngày … tháng … năm …") followed by content.

Document content:
${content}

Return ONLY valid JSON — no explanation, no markdown fences:
{
  "last_header_line": "<exact text of the last fixed-header paragraph>"
}

STRICT RULES:
1. The value must be copied EXACTLY from the document content above (preserve spacing).
2. Choose the LAST line that is clearly a fixed header element.
3. If "Kính gửi:" is present it is usually the best boundary.
4. If "V/v:" is present and "Kính gửi:" is absent, use "V/v:…".
5. If only "BÁO CÁO …" is present, use that title line.
6. Return null for "last_header_line" only when there is no identifiable header.`;
}

async function detectHeaderBoundary(content) {
  try {
    const { getLLMProvider } = require("./helpers");

    // Bump Ollama timeout for this analysis call
    const KEY = "OLLAMA_RESPONSE_TIMEOUT";
    const prev = process.env[KEY];
    if (!prev || Number(prev) <= 5 * 60_000) process.env[KEY] = "7200000";

    const LLM = getLLMProvider();

    if (prev === undefined) delete process.env[KEY];
    else process.env[KEY] = prev;

    if (!LLM || typeof LLM.getChatCompletion !== "function") return null;

    const response = await LLM.getChatCompletion(
      [{ role: "user", content: buildBoundaryPrompt(content) }],
      { temperature: 0.1 }
    );
    if (!response) return null;

    const text =
      typeof response === "string" ? response : (response.textResponse ?? "");
    // Strip think blocks
    const stripped = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    const fenced = stripped.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    const jsonStr = fenced
      ? fenced[1]
      : (stripped.match(/\{[\s\S]*\}/)?.[0] ?? null);
    if (!jsonStr) return null;

    const parsed = JSON.parse(jsonStr);
    const line = parsed.last_header_line;
    return typeof line === "string" && line.trim() ? line.trim() : null;
  } catch (err) {
    console.error("[docxNoiDungInjector] detectHeaderBoundary:", err.message);
    return null;
  }
}

// ─── XML helpers ──────────────────────────────────────────────────────────────

/** Concatenate all <w:t> text content from a <w:p> XML string. */
function paraText(pXml) {
  const tRe = /<w:t(?:[^>]*)?>([^<]*)<\/w:t>/g;
  const parts = [];
  let t;
  while ((t = tRe.exec(pXml)) !== null) parts.push(t[1]);
  return parts.join("").replace(/\s+/g, " ").trim();
}

/** Minimal Word paragraph XML that contains only the text "{noi_dung}". */
function buildNoiDungParagraph() {
  return `<w:p><w:r><w:t xml:space="preserve">{noi_dung}</w:t></w:r></w:p>`;
}

/**
 * Scan the document XML for the paragraph whose text best matches `target`.
 * We try exact match first, then substring containment, then the longest
 * paragraph that the target contains (handles line-wrapping in extracted MD).
 * Returns the full XML string of the matched paragraph, or null.
 */
function findBestMatchingParagraph(docXml, target) {
  if (!target) return null;
  const norm = target.replace(/\s+/g, " ").trim();

  const paraRe = /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g;
  let exact = null;
  let contains = null; // para contains target as substring
  let contained = null; // target contains para text (partial)

  let m;
  while ((m = paraRe.exec(docXml)) !== null) {
    const pt = paraText(m[0]);
    if (!pt) continue;
    if (pt === norm) { exact = m[0]; break; }
    if (!contains && pt.includes(norm)) contains = m[0];
    if (!contained && norm.includes(pt) && pt.length > 5) contained = m[0];
  }

  return exact ?? contains ?? contained ?? null;
}

/**
 * Insert `injection` immediately after the last occurrence of `needle` in `str`.
 */
function insertAfterLast(str, needle, injection) {
  const idx = str.lastIndexOf(needle);
  if (idx === -1) return null;
  const pos = idx + needle.length;
  return str.slice(0, pos) + injection + str.slice(pos);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Return true if the docx buffer already contains a {noi_dung} marker paragraph.
 */
function hasNoiDungMarker(fileBuffer) {
  try {
    const PizZip = require("pizzip");
    const zip = new PizZip(fileBuffer);
    const entry = zip.file("word/document.xml");
    if (!entry) return false;
    const xml = entry.asText();
    const paraRe = /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g;
    let m;
    while ((m = paraRe.exec(xml)) !== null) {
      if (paraText(m[0]) === "{noi_dung}") return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Automatically inject a {noi_dung} paragraph into a .docx buffer.
 *
 * Steps:
 *  1. Ask the LLM to identify the last fixed-header paragraph text.
 *  2. Locate that paragraph in word/document.xml.
 *  3. Insert a new {noi_dung} paragraph immediately after it.
 *  4. Return the updated .docx buffer.
 *
 * Returns null if the LLM fails, the paragraph cannot be found, or any
 * error occurs — the caller should fall back to the existing tag/style flow.
 *
 * @param {Buffer} fileBuffer   Original .docx binary
 * @param {string} content      Markdown content extracted from the docx
 * @returns {Promise<Buffer|null>}
 */
async function autoInjectNoiDung(fileBuffer, content) {
  try {
    // 1. LLM: identify the header boundary
    const lastHeaderLine = await detectHeaderBoundary(content);
    if (!lastHeaderLine) {
      console.warn("[docxNoiDungInjector] LLM could not identify header boundary");
      return null;
    }

    // 2. Open ZIP + get document XML
    const PizZip = require("pizzip");
    const zip = new PizZip(fileBuffer);
    const entry = zip.file("word/document.xml");
    if (!entry) return null;
    const docXml = entry.asText();

    // 3. Find the target paragraph
    const matchedPara = findBestMatchingParagraph(docXml, lastHeaderLine);
    if (!matchedPara) {
      console.warn(
        "[docxNoiDungInjector] Could not locate paragraph:",
        lastHeaderLine
      );
      return null;
    }

    // 4. Inject {noi_dung} immediately after it
    const newDocXml = insertAfterLast(
      docXml,
      matchedPara,
      buildNoiDungParagraph()
    );
    if (!newDocXml) return null;

    zip.file("word/document.xml", newDocXml);
    return zip.generate({
      type: "nodebuffer",
      compression: "DEFLATE",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
  } catch (err) {
    console.error("[docxNoiDungInjector] autoInjectNoiDung:", err.message);
    return null;
  }
}

module.exports = { hasNoiDungMarker, autoInjectNoiDung };
