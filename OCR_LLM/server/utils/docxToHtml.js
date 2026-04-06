"use strict";

/**
 * Lightweight .docx → HTML converter using only adm-zip (already installed).
 * Produces a self-contained HTML fragment suitable for display in an iframe.
 * Handles: headings, bold, italic, underline, font size, alignment,
 *           tables, empty paragraphs, and the national motto/slogan pattern.
 *
 * Not a pixel-perfect renderer — used for template preview only.
 */

// ─── XML helpers ──────────────────────────────────────────────────────────────

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function attr(xml, name) {
  const m = xml.match(new RegExp(`${name}="([^"]*)"`));
  return m ? m[1] : null;
}

// ─── Run-level formatting ─────────────────────────────────────────────────────

function runText(rXml) {
  const tRe = /<w:t(?:[^>]*)?>([^<]*)<\/w:t>/g;
  const parts = [];
  let m;
  while ((m = tRe.exec(rXml)) !== null) parts.push(m[1]);
  return parts.join("");
}

function runHtml(rXml) {
  const rPrM = rXml.match(/<w:rPr>([\s\S]*?)<\/w:rPr>/);
  const rPr = rPrM ? rPrM[1] : "";
  let text = esc(runText(rXml));
  if (!text) return "";

  const bold = /<w:b\/>|<w:b\s/.test(rPr) && !/<w:b\s+w:val="0"/.test(rPr);
  const italic = /<w:i\/>|<w:i\s/.test(rPr) && !/<w:i\s+w:val="0"/.test(rPr);
  const underline = /<w:u\s+w:val="(?!none)/.test(rPr);

  if (bold) text = `<strong>${text}</strong>`;
  if (italic) text = `<em>${text}</em>`;
  if (underline) text = `<u>${text}</u>`;
  return text;
}

// ─── Paragraph-level ─────────────────────────────────────────────────────────

function allRunsHtml(pXml) {
  const runRe = /<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g;
  const parts = [];
  let m;
  while ((m = runRe.exec(pXml)) !== null) parts.push(runHtml(m[0]));
  return parts.join("");
}

function paragraphHtml(pXml) {
  const pPrM = pXml.match(/<w:pPr>([\s\S]*?)<\/w:pPr>/);
  const pPr = pPrM ? pPrM[1] : "";

  const content = allRunsHtml(pXml);

  // Style
  const styleM = pPr.match(/<w:pStyle\s+w:val="([^"]+)"/);
  const style = styleM ? styleM[1].toLowerCase() : "";

  // Alignment
  const jcM = pPr.match(/<w:jc\s+w:val="([^"]+)"/);
  const align = jcM ? jcM[1] : null;
  const alignCss =
    align === "center"
      ? "text-align:center"
      : align === "right"
        ? "text-align:right"
        : "";

  const css = alignCss ? ` style="${alignCss}"` : "";

  if (!content.trim()) return `<p style="margin:0;height:0.6em"></p>`;

  if (/heading1|^1$/.test(style)) return `<h2${css}>${content}</h2>`;
  if (/heading2|^2$/.test(style)) return `<h3${css}>${content}</h3>`;
  if (/heading3|^3$/.test(style)) return `<h4${css}>${content}</h4>`;
  if (/^title$/.test(style)) return `<h1${css}>${content}</h1>`;

  return `<p${css}>${content}</p>`;
}

// ─── Table ────────────────────────────────────────────────────────────────────

function tableHtml(tblXml) {
  const rows = [];
  const rowRe = /<w:tr(?:\s[^>]*)?>[\s\S]*?<\/w:tr>/g;
  let rowM;
  while ((rowM = rowRe.exec(tblXml)) !== null) {
    const cells = [];
    const cellRe = /<w:tc(?:\s[^>]*)?>[\s\S]*?<\/w:tc>/g;
    let cellM;
    while ((cellM = cellRe.exec(rowM[0])) !== null) {
      const paraRe = /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g;
      const cellContent = [];
      let pM;
      while ((pM = paraRe.exec(cellM[0])) !== null)
        cellContent.push(allRunsHtml(pM[0]));
      cells.push(
        `<td style="border:1px solid #aaa;padding:4px 6px">${cellContent.join("<br>") || "&nbsp;"}</td>`
      );
    }
    rows.push(`<tr>${cells.join("")}</tr>`);
  }
  return `<table style="border-collapse:collapse;width:100%;margin:8px 0">${rows.join("")}</table>`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

/**
 * Convert a .docx file to a self-contained HTML document string.
 * @param {string} filePath  Absolute path to the .docx file
 * @returns {string|null}    Full HTML document, or null on error
 */
function docxToHtml(filePath) {
  try {
    const AdmZip = require("adm-zip");
    const zip = new AdmZip(filePath);

    const docEntry = zip.getEntry("word/document.xml");
    if (!docEntry) return null;
    const xml = docEntry.getData().toString("utf8");

    // Pull body content
    const bodyM = xml.match(/<w:body>([\s\S]*)<\/w:body>/);
    if (!bodyM) return null;

    let body = bodyM[1];
    const blocks = [];

    // Replace tables with placeholders, process paragraphs in between
    const tables = [];
    body = body.replace(/<w:tbl(?:\s[^>]*)?>[\s\S]*?<\/w:tbl>/g, (m) => {
      const i = tables.length;
      tables.push(m);
      return `\x00TABLE:${i}\x00`;
    });

    const parts = body.split(/\x00TABLE:(\d+)\x00/);
    for (let i = 0; i < parts.length; i++) {
      if (i % 2 === 0) {
        const paraRe = /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g;
        let pM;
        while ((pM = paraRe.exec(parts[i])) !== null)
          blocks.push(paragraphHtml(pM[0]));
      } else {
        blocks.push(tableHtml(tables[parseInt(parts[i], 10)]));
      }
    }

    const inner = blocks.join("\n");

    return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body { font-family: "Times New Roman", serif; font-size: 14px; line-height: 1.6;
         color: #111; padding: 24px 32px; margin: 0; background: #fff; }
  h1 { font-size: 1.2em; text-align: center; text-transform: uppercase; margin: 6px 0; }
  h2 { font-size: 1.1em; font-weight: bold; text-transform: uppercase; margin: 10px 0 4px; }
  h3 { font-size: 1em; font-weight: bold; margin: 8px 0 2px; }
  h4 { font-size: 1em; font-style: italic; margin: 6px 0 2px; }
  p  { margin: 4px 0; }
  table { border-collapse: collapse; width: 100%; }
  td, th { border: 1px solid #999; padding: 4px 8px; vertical-align: top; }
</style>
</head>
<body>${inner}</body>
</html>`;
  } catch (err) {
    console.error("[docxToHtml]", err.message);
    return null;
  }
}

module.exports = { docxToHtml };
