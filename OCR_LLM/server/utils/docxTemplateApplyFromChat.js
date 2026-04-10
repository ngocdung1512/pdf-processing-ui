"use strict";

const PizZip = require("pizzip");
const {
  findReplaceInDocxBuffer,
  suggestSnippetsForFailedFind,
  shouldProcessWordXmlPath,
} = require("./docxFindReplace");
const {
  extractFindReplacePairsFromChatLLM,
} = require("./extractFindReplacePairsLLM");

function extractExplicitReplacementTargets(userMessage = "") {
  const text = String(userMessage || "").trim();
  if (!text) return [];
  const targets = new Set();
  const patterns = [
    /\b(?:thay|đổi)\s+["'“”‘’`]?.+?["'“”‘’`]?\s+(?:thành|sang)\s+["'“”‘’`]?(.+?)["'“”‘’`]?(?=$|[.;,\n])/giu,
    /\breplace\s+["'“”‘’`]?.+?["'“”‘’`]?\s+with\s+["'“”‘’`]?(.+?)["'“”‘’`]?(?=$|[.;,\n])/giu,
    /["'“”‘’`]?.+?["'“”‘’`]?\s*->\s*["'“”‘’`]?(.+?)["'“”‘’`]?(?=$|[.;,\n])/giu,
  ];

  for (const re of patterns) {
    let m;
    while ((m = re.exec(text)) !== null) {
      const v = String(m[1] || "")
        .replace(/\s+(cho\s+tôi|giúp\s+tôi|nhé|nha|đi|với|please|pls)\s*$/iu, "")
        .replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, "")
        .trim();
      if (v) targets.add(v.toLowerCase());
    }
  }
  return [...targets];
}

function replacementMatchesTargets(replaceValue = "", targets = []) {
  if (!Array.isArray(targets) || targets.length === 0) return true;
  const r = String(replaceValue || "").toLowerCase();
  if (!r) return false;
  return targets.some((t) => t && (r === t || r.includes(t)));
}

function extractPlainExcerptFromBuffer(buffer, maxLen = 24000) {
  const zip = new PizZip(buffer);
  const chunks = [];
  const names = Object.keys(zip.files)
    .filter((n) => !zip.files[n].dir && shouldProcessWordXmlPath(n))
    .sort();
  for (const name of names) {
    const entry = zip.file(name);
    if (!entry) continue;
    let xml = entry.asText();
    xml = xml.replace(/<w:tab\b[^/>]*\/?>/gi, " ");
    xml = xml.replace(/<w:br\b[^/>]*\/?>/gi, " ");
    xml = xml.replace(/<w:p\b/g, "\n");
    xml = xml.replace(/<[^>]+>/g, " ");
    chunks.push(xml);
  }
  return chunks.join("\n").replace(/\s+/g, " ").trim().slice(0, maxLen);
}

function titleCaseViWords(s) {
  return String(s || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(
      (w) =>
        w.charAt(0).toLocaleUpperCase("vi-VN") +
        w.slice(1).toLocaleLowerCase("vi-VN")
    )
    .join(" ");
}

function mirrorPlaceNameCasing(oldSegment, newRaw) {
  const n = String(newRaw || "")
    .trim()
    .normalize("NFC");
  const o = String(oldSegment || "")
    .trim()
    .normalize("NFC");
  if (!o || !n) return n;
  if (!/[\p{L}]/u.test(o)) return n;
  const isAllUpper = o === o.toUpperCase() && /[\p{Lu}]/u.test(o);
  if (isAllUpper) return n.toLocaleUpperCase("vi-VN");
  const isAllLower = o === o.toLowerCase();
  if (isAllLower) return titleCaseViWords(n);
  return titleCaseViWords(n);
}

const RE_FIND_TINH = /^(.*?)(\btỉnh\s+)(.+)$/isu;

function expandPairIfShorthandProvince(pair) {
  const find = String(pair.find || "")
    .normalize("NFC")
    .trim()
    .replace(/\s+/g, " ");
  let replace = String(pair.replace || "")
    .normalize("NFC")
    .trim()
    .replace(/\s+/g, " ");
  if (!find || !replace || find === replace) return { find, replace };
  if (/\btỉnh\b/iu.test(replace)) return { find, replace };
  if (replace.split(/\s+/).filter(Boolean).length > 8) return { find, replace };
  if (
    /^(xã|huyện|phường|thị\s+trấn|thành\s+phố|tp\.|tổng\s+cục|cục|bộ)\b/iu.test(
      replace
    )
  ) {
    return { find, replace };
  }
  const m = find.match(RE_FIND_TINH);
  if (!m) return { find, replace };
  const prefix = m[1];
  const tinhTok = m[2];
  const oldAfterTinh = m[3].replace(/\s+/g, " ").trim();
  const styledNew = mirrorPlaceNameCasing(oldAfterTinh, replace);
  const expanded = `${prefix}${tinhTok}${styledNew}`
    .replace(/\s+/g, " ")
    .trim();
  if (!expanded || expanded === replace) return { find, replace };
  return { find, replace: expanded };
}

function provinceAdminTailPair(find, replace) {
  const f = String(find || "")
    .normalize("NFC")
    .trim();
  const r = String(replace || "")
    .normalize("NFC")
    .trim();
  const reTinh = /tỉnh\s+/iu;
  const idxF = f.search(reTinh);
  const idxR = r.search(reTinh);
  if (idxF <= 0 || idxR <= 0) return null;
  const tailF = f.slice(idxF).replace(/\s+/g, " ").trim();
  const tailR = r.slice(idxR).replace(/\s+/g, " ").trim();
  if (!tailF || !tailR || tailF === f) return null;
  return { find: tailF, replace: tailR };
}

function expandFindReplaceCandidatesForDocx(find, replace) {
  const rawF = String(find || "").trim();
  const rawR = String(replace || "").trim();
  if (!rawF || !rawR) return [];
  const nF = rawF.normalize("NFC");
  const nR = rawR.normalize("NFC");
  const seen = new Set();
  const out = [];
  const push = (f, r) => {
    const ff = String(f).replace(/\s+/g, " ").trim();
    const rr = String(r).replace(/\s+/g, " ").trim();
    if (!ff || !rr) return;
    const k = `${ff}\0${rr}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ find: ff, replace: rr });
  };
  for (const f of [nF, nF.toUpperCase(), nF.toLowerCase()]) {
    push(f, nR);
  }
  const tail = provinceAdminTailPair(nF, nR);
  if (tail) {
    const { find: tf, replace: tr } = tail;
    for (const f of [tf, tf.toUpperCase(), tf.toLowerCase()]) {
      push(f, tr);
    }
  }
  return out;
}

/**
 * One-shot: LLM infers pairs from chat + template excerpt, then applies find/replace on the .docx.
 *
 * @param {Buffer} templateBuffer
 * @param {{ pairedUserMessage?: string, assistantMessage?: string, conversationContext?: string }} ctx
 * @returns {Promise<{ buffer: Buffer, totalReplacements: number, steps: number }>}
 */
async function applyDocxTemplateFromChat(templateBuffer, ctx = {}) {
  if (!templateBuffer || !Buffer.isBuffer(templateBuffer)) {
    const e = new Error("Invalid template buffer");
    e.code = "INVALID_BUFFER";
    throw e;
  }
  const pairedUserMessage = String(ctx.pairedUserMessage || "");
  const assistantMessage = String(ctx.assistantMessage || "");
  const conversationContext = String(ctx.conversationContext || "");
  const explicitTargets = extractExplicitReplacementTargets(pairedUserMessage);

  const excerpt = extractPlainExcerptFromBuffer(templateBuffer);
  let pairs = await extractFindReplacePairsFromChatLLM(
    pairedUserMessage,
    assistantMessage,
    excerpt,
    conversationContext
  );

  pairs = pairs
    .filter((p) => p.find && p.replace && p.find !== p.replace)
    .map((p) => expandPairIfShorthandProvince(p));

  if (pairs.length === 0) {
    const e = new Error(
      "Could not infer any find/replace steps from the conversation and template."
    );
    e.code = "NO_PAIRS";
    throw e;
  }

  let current = templateBuffer;
  let total = 0;
  const opts = { matchCase: false, wholeWord: false, flexibleWhitespace: true };

  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i];
    if (!replacementMatchesTargets(pair.replace, explicitTargets)) {
      const e = new Error(
        "Inferred replacement does not match your explicit replacement target."
      );
      e.code = "REPLACE_TARGET_MISMATCH";
      e.pairIndex = i;
      e.inferredPair = pair;
      e.explicitTargets = explicitTargets;
      throw e;
    }

    const variants = expandFindReplaceCandidatesForDocx(
      pair.find,
      pair.replace
    );
    let stepOk = false;
    let lastSnippets = [];
    const lastTried = [];
    for (const { find, replace } of variants) {
      const { buffer: out, count } = findReplaceInDocxBuffer(
        current,
        find,
        replace,
        opts
      );
      lastTried.push(find);
      if (count > 0) {
        current = out;
        total += count;
        stepOk = true;
        break;
      }
      lastSnippets = suggestSnippetsForFailedFind(current, find);
    }
    if (!stepOk) {
      const e = new Error("No matches found for the search text.");
      e.code = "NO_MATCH_STEP";
      e.pairIndex = i;
      e.findTried = lastTried;
      e.textSnippetsFromFile = lastSnippets;
      throw e;
    }
  }

  return { buffer: current, totalReplacements: total, steps: pairs.length };
}

module.exports = {
  applyDocxTemplateFromChat,
  extractPlainExcerptFromBuffer,
};
