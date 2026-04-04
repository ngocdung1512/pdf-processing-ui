"use strict";

/**
 * Parts of OOXML we scan for w:p / narrative text. Keep in sync with
 * frontend extractDocxPlainExcerpt (fetchFindReplacePairsLLM.js).
 * Uses full zip path (e.g. word/header1.xml) so word/glossary/document.xml
 * is not confused with word/document.xml.
 */
function shouldProcessWordXmlPath(name) {
  if (!name || typeof name !== "string") return false;
  if (!name.startsWith("word/") || !name.endsWith(".xml")) return false;
  if (name.includes("/_rels/")) return false;
  const n = name.replace(/\\/g, "/");

  if (/^word\/document\.xml$/i.test(n)) return true;
  if (/^word\/glossary\/document\.xml$/i.test(n)) return true;
  if (/^word\/footnotes\.xml$/i.test(n)) return true;
  if (/^word\/endnotes\.xml$/i.test(n)) return true;
  if (/^word\/comments\.xml$/i.test(n)) return true;
  if (/^word\/header\d*\.xml$/i.test(n)) return true;
  if (/^word\/footer\d*\.xml$/i.test(n)) return true;

  return false;
}

module.exports = { shouldProcessWordXmlPath };
