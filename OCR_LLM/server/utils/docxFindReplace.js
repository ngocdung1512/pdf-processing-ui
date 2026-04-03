"use strict";

const PizZip = require("pizzip");

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeXmlText(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function countMatchesInString(text, find, opts) {
  if (!find) return 0;
  const esc = escapeRegex(find);
  let re;
  if (opts.wholeWord) {
    re = new RegExp(
      `(?<![\\p{L}\\p{M}\\p{N}])${esc}(?![\\p{L}\\p{M}\\p{N}])`,
      opts.matchCase ? "gu" : "giu"
    );
  } else {
    re = new RegExp(esc, opts.matchCase ? "g" : "gi");
  }
  const m = text.match(re);
  return m ? m.length : 0;
}

function applyReplace(text, find, replace, opts) {
  if (!find) return text;
  const esc = escapeRegex(find);
  if (opts.wholeWord) {
    const re = new RegExp(
      `(?<![\\p{L}\\p{M}\\p{N}])${esc}(?![\\p{L}\\p{M}\\p{N}])`,
      opts.matchCase ? "gu" : "giu"
    );
    return text.replace(re, replace);
  }
  return text.replace(new RegExp(esc, opts.matchCase ? "g" : "gi"), replace);
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
  const full = matches.map((x) => x.inner).join("");
  const count = countMatchesInString(full, find, opts);
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
    const { xml: newP, count } = replaceParagraphPreservingRuns(pXml, find, replace, opts);
    total += count;
    return newP;
  });
  return { xml: out, count: total };
}

function shouldProcessWordXmlPath(name) {
  if (!name.startsWith("word/") || !name.endsWith(".xml")) return false;
  if (name.includes("/_rels/")) return false;
  const base = name.split("/").pop();
  return /^(document\.xml|header\d+\.xml|footer\d+\.xml|footnotes\.xml|endnotes\.xml|comments\.xml)$/.test(
    base
  );
}

/**
 * Find/replace in body, headers, footers, footnotes, endnotes, comments.
 *
 * @param {Buffer} buffer
 * @param {string} find
 * @param {string} replace
 * @param {{ matchCase?: boolean, wholeWord?: boolean }} [options]
 * @returns {{ buffer: Buffer, count: number }}
 */
function findReplaceInDocxBuffer(buffer, find, replace, options = {}) {
  const opts = {
    matchCase: !!options.matchCase,
    wholeWord: !!options.wholeWord,
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
    const { xml: newXml, count } = replaceInXmlDocument(xml, find, replace, opts);
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
};
