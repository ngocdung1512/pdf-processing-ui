"use strict";
const fs = require("fs");

// ─── Text helpers ─────────────────────────────────────────────────────────────

/** Pull all <w:t> text out of an XML fragment. */
function getRunText(xml) {
  const texts = [];
  const re = /<w:t(?:[^>]*)?>([^<]*)<\/w:t>/g;
  let m;
  while ((m = re.exec(xml)) !== null) texts.push(m[1]);
  return texts.join("");
}

// ─── Paragraph → markdown line ────────────────────────────────────────────────

function formatParagraph(pXml) {
  const pPrM = pXml.match(/<w:pPr>([\s\S]*?)<\/w:pPr>/);
  const pPr = pPrM ? pPrM[1] : null;

  const text = getRunText(pXml).trim();
  if (!text) return null;

  // Style ID (lowercase for comparison)
  let styleId = null;
  if (pPr) {
    const sm = pPr.match(/<w:pStyle\s+w:val="([^"]+)"/);
    if (sm) styleId = sm[1].toLowerCase();
  }

  // Map heading styles (Word may use numeric IDs in some locales)
  if (styleId) {
    if (/^(heading1|heading 1|1|titre1|heading-1)$/.test(styleId))
      return `# ${text}`;
    if (/^(heading2|heading 2|2|titre2|heading-2)$/.test(styleId))
      return `## ${text}`;
    if (/^(heading3|heading 3|3|titre3|heading-3)$/.test(styleId))
      return `### ${text}`;
    if (/^(title|titre)$/.test(styleId)) return `**${text}**`;
  }

  const centered = pPr ? /<w:jc\s+w:val="center"/.test(pPr) : false;
  const bold = /<w:b\/>|<w:b\s+w:val="(?!0)/.test(pXml);

  // All-bold or bold+centered → treat as a section title
  if (bold && centered) return `**${text}**`;

  return text;
}

// ─── Table → markdown table ───────────────────────────────────────────────────

function formatTable(tblXml) {
  const rows = [];

  const rowRe = /<w:tr(?:\s[^>]*)?>[\s\S]*?<\/w:tr>/g;
  let rowM;
  while ((rowM = rowRe.exec(tblXml)) !== null) {
    const cells = [];
    const cellRe = /<w:tc(?:\s[^>]*)?>[\s\S]*?<\/w:tc>/g;
    let cellM;
    while ((cellM = cellRe.exec(rowM[0])) !== null) {
      const cellText = getRunText(cellM[0]).replace(/\s+/g, " ").trim();
      cells.push(cellText || "");
    }
    if (cells.length > 0) rows.push(cells);
  }

  if (rows.length === 0) return null;

  // Normalise to same column count
  const maxCols = Math.max(...rows.map((r) => r.length));
  const norm = rows.map((r) => {
    const row = [...r];
    while (row.length < maxCols) row.push("");
    return row;
  });

  const lines = [];
  lines.push("| " + norm[0].join(" | ") + " |");
  lines.push("| " + norm[0].map(() => "---").join(" | ") + " |");
  for (let i = 1; i < norm.length; i++) {
    lines.push("| " + norm[i].join(" | ") + " |");
  }
  return lines.join("\n");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

/**
 * Open a .docx file and convert its content to structured Markdown.
 * Headings, bold titles, and tables are preserved.
 * Returns null on error or if the file is not a .docx ZIP.
 */
function extractDocxContent(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const AdmZip = require("adm-zip");
    const zip = new AdmZip(filePath);

    const entry = zip.getEntry("word/document.xml");
    if (!entry) return null;

    const xml = entry.getData().toString("utf8");

    const bodyM = xml.match(/<w:body>([\s\S]*)<\/w:body>/);
    if (!bodyM) return null;

    let bodyXml = bodyM[1];

    // ── Step 1: extract table blocks, replace with placeholders ──────────────
    // (simple non-greedy: works for non-nested tables, which covers 99 % of
    //  Vietnamese government report templates)
    const tables = [];
    bodyXml = bodyXml.replace(
      /<w:tbl(?:\s[^>]*)?>[\s\S]*?<\/w:tbl>/g,
      (match) => {
        const idx = tables.length;
        tables.push(match);
        return `\x00TABLE:${idx}\x00`;
      }
    );

    // ── Step 2: process paragraphs between table placeholders ─────────────────
    const output = [];
    const parts = bodyXml.split(/\x00TABLE:(\d+)\x00/);

    for (let i = 0; i < parts.length; i++) {
      if (i % 2 === 0) {
        // Paragraph section
        const paraRe = /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g;
        let pM;
        while ((pM = paraRe.exec(parts[i])) !== null) {
          const line = formatParagraph(pM[0]);
          if (line) output.push(line);
        }
      } else {
        // Table placeholder
        const tbl = formatTable(tables[parseInt(parts[i], 10)]);
        if (tbl) output.push(tbl);
      }
    }

    return output.length > 0 ? output.join("\n") : null;
  } catch (err) {
    console.error("[extractDocxContent]", err.message);
    return null;
  }
}

module.exports = { extractDocxContent };
