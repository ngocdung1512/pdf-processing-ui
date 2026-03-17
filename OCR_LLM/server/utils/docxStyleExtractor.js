"use strict";
const fs = require("fs");

// ─── XML helpers ──────────────────────────────────────────────────────────────

function attr(xml, name) {
  const m = xml.match(new RegExp(`${name}="([^"]*)"`));
  return m ? m[1] : null;
}

function innerXml(xml, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "g");
  const m = re.exec(xml);
  return m ? m[1] : null;
}

function allInnerXml(xml, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "g");
  const results = [];
  let m;
  while ((m = re.exec(xml)) !== null) results.push(m[1]);
  return results;
}

// ─── Block parser ─────────────────────────────────────────────────────────────

function parseRPr(rPr) {
  if (!rPr) return {};
  const out = {};

  // Font
  const fonts = rPr.match(/<w:rFonts([^/]*)\/>/);
  if (fonts) {
    out.font =
      attr(fonts[0], "w:ascii") ||
      attr(fonts[0], "w:hAnsi") ||
      attr(fonts[0], "w:cs") ||
      null;
  }

  // Size (half-points: 24 = 12pt)
  const sz = rPr.match(/<w:sz\s+w:val="(\d+)"/);
  if (sz) out.size = parseInt(sz[1]);

  // Bold
  if (/<w:b\/>|<w:b\s/.test(rPr)) {
    const bv = rPr.match(/<w:b\s+w:val="(\d+)"/);
    out.bold = bv ? bv[1] !== "0" : true;
  }

  // Italic
  if (/<w:i\/>|<w:i\s/.test(rPr)) {
    const iv = rPr.match(/<w:i\s+w:val="(\d+)"/);
    out.italic = iv ? iv[1] !== "0" : true;
  }

  // Color
  const col = rPr.match(/<w:color\s+w:val="([^"]+)"/);
  if (col && col[1] !== "auto") out.color = col[1];

  return out;
}

function parsePPr(pPr) {
  if (!pPr) return {};
  const out = {};

  // Alignment
  const jc = pPr.match(/<w:jc\s+w:val="([^"]+)"/);
  if (jc) out.alignment = jc[1]; // center | both | left | right | distribute

  // Spacing
  const sp = pPr.match(/<w:spacing([^/]*)\/>/);
  if (sp) {
    const before = attr(sp[0], "w:before");
    const after = attr(sp[0], "w:after");
    const line = attr(sp[0], "w:line");
    if (before != null) out.spacingBefore = parseInt(before);
    if (after != null) out.spacingAfter = parseInt(after);
    if (line != null) out.spacingLine = parseInt(line);
  }

  // Indent
  const ind = pPr.match(/<w:ind([^/]*)\/>/);
  if (ind) {
    const left = attr(ind[0], "w:left");
    if (left != null) out.indentLeft = parseInt(left);
  }

  return out;
}

// ─── Main extractor ───────────────────────────────────────────────────────────

function parseStylesXml(xml) {
  const result = {};

  // docDefaults: global font/size fallback
  const defaults = {};
  const ddBlock = innerXml(xml, "w:docDefaults");
  if (ddBlock) {
    const rPrDef = innerXml(ddBlock, "w:rPrDefault");
    if (rPrDef) {
      const rPr = innerXml(rPrDef, "w:rPr");
      Object.assign(defaults, parseRPr(rPr));
    }
  }

  // Individual style blocks
  const styleRe =
    /<w:style\s[^>]*w:styleId="([^"]+)"[^>]*>([\s\S]*?)<\/w:style>/g;
  let m;

  while ((m = styleRe.exec(xml)) !== null) {
    const id = m[1];
    const body = m[2];

    const rPr = innerXml(body, "w:rPr");
    const pPr = innerXml(body, "w:pPr");
    const props = { ...parseRPr(rPr), ...parsePPr(pPr) };

    if (Object.keys(props).length === 0) continue;

    // Map style IDs to canonical keys
    if (/^Normal$|^normal$/.test(id)) result.normal = props;
    else if (/^Heading1$|^heading1$|^1$/.test(id)) result.heading1 = props;
    else if (/^Heading2$|^heading2$|^2$/.test(id)) result.heading2 = props;
    else if (/^Heading3$|^heading3$|^3$/.test(id)) result.heading3 = props;
    else if (/^Title$|^title$/.test(id)) result.title = props;
  }

  // Fill in normal from docDefaults if missing
  if (!result.normal && Object.keys(defaults).length > 0)
    result.normal = defaults;

  return result;
}

/**
 * Open a .docx file (ZIP+XML) and extract paragraph/character style info.
 * Returns an object with keys: normal, heading1, heading2, heading3, title.
 * Returns null for non-DOCX or on error.
 */
function extractDocxStyles(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const AdmZip = require("adm-zip");
    const zip = new AdmZip(filePath);

    const entry = zip.getEntry("word/styles.xml");
    if (!entry) return null;

    const xml = entry.getData().toString("utf8");
    const styles = parseStylesXml(xml);

    return Object.keys(styles).length > 0 ? styles : null;
  } catch (err) {
    console.error("[extractDocxStyles]", err.message);
    return null;
  }
}

module.exports = { extractDocxStyles };
