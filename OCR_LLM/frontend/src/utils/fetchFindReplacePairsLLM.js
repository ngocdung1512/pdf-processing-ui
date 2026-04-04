import { API_BASE } from "./constants";
import { baseHeaders } from "./request";
import { getFindReplacePairsForTemplate } from "./extractFindReplaceFromAssistantReply";
import { expandPairIfShorthandProvince } from "./expandFindReplaceShorthand";

/**
 * OOXML parts included in excerpt / replace (sync with server docxProcessableXmlPaths.js).
 * @param {string} name
 */
export function isWordXmlPartForDocxExcerpt(name) {
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

/**
 * Rough plain text from template .docx so the LLM anchors "find" on real file wording.
 * @param {string} base64Raw raw base64 (no data: prefix)
 * @param {number} [maxLen]
 */
export async function extractDocxPlainExcerptFromBase64(base64Raw, maxLen = 24000) {
  if (!base64Raw || typeof base64Raw !== "string") return "";
  try {
    const { default: PizZip } = await import("pizzip");
    const zip = new PizZip(base64Raw, { base64: true });
    const chunks = [];
    const names = Object.keys(zip.files).filter(
      (n) => !zip.files[n].dir && isWordXmlPartForDocxExcerpt(n)
    );
    names.sort();
    for (const name of names) {
      const f = zip.file(name);
      if (!f) continue;
      let xml = f.asText();
      xml = xml.replace(/<w:tab\b[^/>]*\/?>/gi, " ");
      xml = xml.replace(/<w:br\b[^/>]*\/?>/gi, " ");
      xml = xml.replace(/<w:p\b/g, "\n");
      xml = xml.replace(/<[^>]+>/g, " ");
      chunks.push(xml);
    }
    const t = chunks.join("\n").replace(/\s+/g, " ").trim();
    return t.slice(0, maxLen);
  } catch (e) {
    console.warn("[extractDocxPlainExcerpt]", e);
    return "";
  }
}

function stripForPairApi(text) {
  return String(text || "")
    .replace(/<think[\s\S]*?<\/think>/gi, "")
    .replace(/<thinking[\s\S]*?<\/thinking>/gi, "")
    .replace(/<thought[\s\S]*?<\/thought>/gi, "")
    .replace(/<redacted_thinking>[\s\S]*?<\/redacted_thinking>/gi, "")
    .trim();
}

/**
 * Server uses workspace LLM to infer find/replace (natural phrasing).
 */
export async function fetchFindReplacePairsLLMFallback(
  userMessage,
  assistantMessage,
  documentPlainText = "",
  conversationContext = ""
) {
  const headers = { ...baseHeaders(), "Content-Type": "application/json" };
  if (headers.Authorization == null) delete headers.Authorization;

  const res = await fetch(`${API_BASE}/utils/extract-find-replace-pairs`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      userMessage: stripForPairApi(userMessage),
      assistantMessage: stripForPairApi(assistantMessage),
      documentPlainText: documentPlainText || "",
      conversationContext: stripForPairApi(conversationContext),
    }),
  });

  const ct = res.headers.get("content-type") || "";
  if (!res.ok || !ct.includes("application/json")) return [];
  const j = await res.json();
  if (!j.success || !Array.isArray(j.pairs)) return [];
  return j.pairs.filter(
    (p) =>
      p &&
      typeof p.find === "string" &&
      typeof p.replace === "string" &&
      p.find.trim() !== p.replace.trim()
  );
}

/**
 * Keep LLM order (intent); append regex-only pairs not already present, sorted by find length.
 */
function mergeDedupeAndOrderPairs(llmPairs, regexPairs) {
  const seen = new Set();
  const out = [];
  const pushOne = (p) => {
    if (!p || typeof p.find !== "string" || typeof p.replace !== "string") return;
    const expanded = expandPairIfShorthandProvince({
      find: p.find,
      replace: p.replace,
    });
    const find = expanded.find.trim().replace(/\s+/g, " ");
    const replace = expanded.replace.trim().replace(/\s+/g, " ");
    if (!find || !replace || find === replace) return;
    const k = `${find}\0${replace}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ find, replace });
  };
  for (const p of llmPairs || []) pushOne(p);
  const regexExtra = [];
  for (const p of regexPairs || []) {
    if (!p || typeof p.find !== "string" || typeof p.replace !== "string") continue;
    const expanded = expandPairIfShorthandProvince({
      find: p.find,
      replace: p.replace,
    });
    const find = expanded.find.trim().replace(/\s+/g, " ");
    const replace = expanded.replace.trim().replace(/\s+/g, " ");
    if (!find || !replace || find === replace) continue;
    const k = `${find}\0${replace}`;
    if (seen.has(k)) continue;
    seen.add(k);
    regexExtra.push({ find, replace });
  }
  regexExtra.sort((a, b) => b.find.length - a.find.length);
  out.push(...regexExtra);
  return out;
}

/**
 * LLM + document excerpt first (human-like), always merged with regex/heuristic pairs
 * so a wrong partial LLM answer does not hide good patterns from the reply/prompt.
 * @param {string | null} userMessage
 * @param {string | null} assistantMessage
 * @param {string | null} templateBase64Raw
 * @param {string} [conversationContext] multi-turn transcript for extract API
 */
export async function resolveFindReplacePairsFlexible(
  userMessage,
  assistantMessage,
  templateBase64Raw,
  conversationContext = ""
) {
  const excerpt = await extractDocxPlainExcerptFromBase64(templateBase64Raw || "");
  let llmPairs = [];
  try {
    llmPairs = await fetchFindReplacePairsLLMFallback(
      userMessage,
      assistantMessage,
      excerpt,
      conversationContext
    );
  } catch (e) {
    console.warn("[resolveFindReplacePairsFlexible] LLM pairs failed", e);
  }
  const regexPairs = getFindReplacePairsForTemplate(
    userMessage || "",
    assistantMessage || ""
  );
  return mergeDedupeAndOrderPairs(llmPairs, regexPairs);
}
