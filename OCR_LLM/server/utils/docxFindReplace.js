"use strict";

const PizZip = require("pizzip");

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Decode common entities inside w:t; match user-typed find text */
function decodeWtInner(s) {
  return String(s || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) =>
      String.fromCharCode(parseInt(h, 16))
    );
}

/** NFC + NBSP + zero-width — helps "Công an..." vs "CÔNG AN..." with matchCase false */
function normalizeForDocxMatch(s) {
  return decodeWtInner(s)
    .normalize("NFC")
    .replace(/\u00A0/g, " ")
    .replace(/[\u200B-\u200D\uFEFF]/g, "");
}

function escapeXmlText(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * @param {{ matchCase?: boolean, wholeWord?: boolean, flexibleWhitespace?: boolean }} opts
 */
function buildFindRegex(find, opts) {
  const f = normalizeForDocxMatch(find);
  if (!f) return null;
  if (opts.wholeWord) {
    const esc = escapeRegex(f);
    return new RegExp(
      `(?<![\\p{L}\\p{M}\\p{N}])${esc}(?![\\p{L}\\p{M}\\p{N}])`,
      opts.matchCase ? "gu" : "giu"
    );
  }
  const flex = opts.flexibleWhitespace !== false && /\s/.test(f);
  if (flex) {
    const parts = f.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      const inner = parts.map(escapeRegex).join("\\s+");
      return new RegExp(inner, opts.matchCase ? "g" : "gi");
    }
  }
  const esc = escapeRegex(f);
  return new RegExp(esc, opts.matchCase ? "g" : "gi");
}

function countMatchesInString(text, find, opts) {
  if (!find) return 0;
  const t = normalizeForDocxMatch(text);
  const re = buildFindRegex(find, opts);
  if (!re) return 0;
  const m = t.match(re);
  return m ? m.length : 0;
}

function applyReplace(text, find, replace, opts) {
  if (!find) return text;
  const t = normalizeForDocxMatch(text);
  const rep = normalizeForDocxMatch(replace);
  const re = buildFindRegex(find, opts);
  if (!re) return t;
  // Function replacer so literal `$` / `&` in replacement text is not interpreted.
  return t.replace(re, () => rep);
}

/**
 * Replace occurrences of `find` within one w:p by merging all w:t text in that paragraph,
 * applying replacement, then putting the result in the first w:t and clearing the rest.
 * Preserves paragraph structure and first-run formatting; avoids rewriting non-text XML.
 */
function replaceParagraphPreservingRuns(pXml, find, replace, opts) {
  const collectRe = /<w:t((?:\s[^>]*)?)>([^<]*)<\/w:t>/g;
  const matches = [];
  let m;
  while ((m = collectRe.exec(pXml)) !== null) {
    matches.push({ attrs: m[1], inner: m[2] });
  }
  if (matches.length === 0) return { xml: pXml, count: 0 };
  const tight = matches.map((x) => x.inner).join("");
  const spaced = matches.map((x) => x.inner).join(" ");
  let full = tight;
  let count = countMatchesInString(tight, find, opts);
  if (count === 0 && spaced !== tight) {
    const c2 = countMatchesInString(spaced, find, opts);
    if (c2 > 0) {
      full = spaced;
      count = c2;
    }
  }
  if (count === 0) return { xml: pXml, count: 0 };
  const newFull = applyReplace(full, find, replace, opts);
  let first = true;
  const replaceRe = /<w:t((?:\s[^>]*)?)>([^<]*)<\/w:t>/g;
  const newPXml = pXml.replace(replaceRe, (_match, attrs) => {
    if (first) {
      first = false;
      return `<w:t${attrs}>${escapeXmlText(newFull)}</w:t>`;
    }
    return `<w:t${attrs}></w:t>`;
  });
  return { xml: newPXml, count };
}

function replaceInXmlDocument(xml, find, replace, opts) {
  let total = 0;
  const out = xml.replace(/<w:p[\s\S]*?<\/w:p>/g, (pXml) => {
    const { xml: newP, count } = replaceParagraphPreservingRuns(
      pXml,
      find,
      replace,
      opts
    );
    total += count;
    return newP;
  });
  return { xml: out, count: total };
}

const { shouldProcessWordXmlPath } = require("./docxProcessableXmlPaths");

/** Flat text from .docx for hinting (same parts as find/replace). */
function extractRoughPlainFromDocxBuffer(buffer) {
  const zip = new PizZip(buffer);
  const chunks = [];
  for (const name of Object.keys(zip.files).sort()) {
    const f = zip.files[name];
    if (!f || f.dir || !shouldProcessWordXmlPath(name)) continue;
    const entry = zip.file(name);
    if (!entry) continue;
    const xml = entry.asText();
    const tRe = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g;
    let m;
    while ((m = tRe.exec(xml)) !== null) {
      chunks.push(normalizeForDocxMatch(m[1]));
    }
    chunks.push(" \n ");
  }
  return chunks.join("").replace(/\s+/g, " ").trim();
}

/**
 * When find fails, return short excerpts from the file that contain words from `findRaw`
 * so the user can see how the text actually appears in Word.
 */
function suggestSnippetsForFailedFind(
  buffer,
  findRaw,
  maxSnippets = 4,
  window = 95
) {
  try {
    const plain = extractRoughPlainFromDocxBuffer(buffer);
    if (!plain || plain.length < 3) return [];
    const find = normalizeForDocxMatch(findRaw);
    const tokens = find
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length >= 2)
      .slice(0, 10);
    if (tokens.length === 0) return [];
    const pl = plain.toLowerCase();
    const seen = new Set();
    const scored = [];
    for (const tok of tokens) {
      let from = 0;
      let n = 0;
      while (n < 25) {
        const i = pl.indexOf(tok, from);
        if (i < 0) break;
        const start = Math.max(0, i - window);
        const snip = plain
          .slice(start, start + window * 2 + tok.length)
          .replace(/\s+/g, " ")
          .trim();
        if (snip.length > 10) {
          const key = `${i}`;
          if (!seen.has(key)) {
            seen.add(key);
            const score = tokens.filter((t) =>
              snip.toLowerCase().includes(t)
            ).length;
            scored.push({ snip, score });
          }
        }
        from = i + 1;
        n++;
      }
    }
    scored.sort((a, b) => b.score - a.score);
    const out = [];
    for (const { snip } of scored) {
      if (out.length >= maxSnippets) break;
      if (!out.some((u) => u.slice(0, 35) === snip.slice(0, 35)))
        out.push(snip);
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Find/replace in body, headers, footers, footnotes, endnotes, comments.
 *
 * @param {Buffer} buffer
 * @param {string} find
 * @param {string} replace
 * @param {{ matchCase?: boolean, wholeWord?: boolean, flexibleWhitespace?: boolean }} [options]
 * @returns {{ buffer: Buffer, count: number }}
 */
function findReplaceInDocxBuffer(buffer, find, replace, options = {}) {
  const opts = {
    matchCase: !!options.matchCase,
    wholeWord: !!options.wholeWord,
    flexibleWhitespace: options.flexibleWhitespace === false ? false : true,
  };
  const zip = new PizZip(buffer);
  let total = 0;
  const names = Object.keys(zip.files).filter(
    (n) => !zip.files[n].dir && shouldProcessWordXmlPath(n)
  );
  for (const name of names) {
    const entry = zip.file(name);
    if (!entry) continue;
    const xml = entry.asText();
    const { xml: newXml, count } = replaceInXmlDocument(
      xml,
      find,
      replace,
      opts
    );
    total += count;
    if (count > 0) zip.file(name, newXml);
  }
  return {
    buffer: zip.generate({
      type: "nodebuffer",
      compression: "DEFLATE",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }),
    count: total,
  };
}

module.exports = {
  findReplaceInDocxBuffer,
  shouldProcessWordXmlPath,
  suggestSnippetsForFailedFind,
};
