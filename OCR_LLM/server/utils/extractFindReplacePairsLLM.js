"use strict";

/**
 * When regex heuristics miss, ask the configured LLM to infer { find, replace }[]
 * from the user + assistant chat about a .docx edit.
 */

function buildPrompt(
  userMessage,
  assistantMessage,
  documentPlainText,
  conversationContext = ""
) {
  const u = (userMessage || "").slice(0, 12_000);
  const a = (assistantMessage || "").slice(0, 12_000);
  const c = (conversationContext || "").slice(0, 20_000);
  const d = documentPlainText
    ? `\n---PLAIN_TEXT_FROM_DOCX_EXCERPT---\n${String(documentPlainText).slice(0, 24_000)}\n`
    : "";

  const convBlock = c
    ? `---RECENT_CONVERSATION (oldest → newest)---
${c}

`
    : "";

  return `You are a careful human editor. The user keeps their own Word (.docx) layout; you only decide what text in that file should become what text. Templates may be reports, letters, certificates, contracts, forms, tables, bilingual docs, or anything else—do not assume one domain (police, province names, etc.).

${convBlock}---USER (message right before the export reply)---
${u}
---ASSISTANT (the reply that will be exported / patched)---
${a}
${d}

Return ONLY valid JSON (no markdown code fences, no commentary):
{"pairs":[{"find":"text to locate in the file","replace":"replacement text"}]}

Rules:
1. EXCERPT FIRST: When PLAIN_TEXT_FROM_DOCX_EXCERPT is present, every "find" MUST be copied from that excerpt whenever the target text appears there (same spelling, diacritics, punctuation, digits, and CAPITALIZATION as in the excerpt). The chat may use informal typing, missing tones, or different wording—still choose the real substring from the excerpt that the user intends to change. If their phrase does not appear verbatim, pick the shortest excerpt span that unambiguously matches their intent (e.g. a line in a table cell, a header line, a footnote fragment).
2. CONVERSATION: If RECENT_CONVERSATION exists, later USER messages override earlier assistant or user wording ("không phải", "sửa lại", "nhầm rồi", "ý tôi là …"). Honor the latest clear intent.
3. NO EXCERPT: Infer "find" only from explicit old text in chat. If the same entity might appear in ALL CAPS and in sentence case in typical Word files, you may output two pairs with the same "replace" and different "find"—only when both forms are plausible.
4. SCOPE: Edits may live in body, headers, footers, footnotes, endnotes, comments, glossary, or table cells—all of that is flattened into the excerpt. Do not assume text is only in the "main paragraph"; labels, dates, IDs, names, amounts, and addresses count the same.
5. SHORTHAND REPLACE: If the user gives a short new value (e.g. only a name, place, number, or date) but the old "find" in the file is a longer phrase, expand "replace" so it mirrors the grammar and structure of the old phrase (same prefixes/suffixes, line style), not just the bare new token—unless the user clearly asked to replace only that token.
6. MULTIPLE EDITS: Several unrelated changes → several objects in "pairs". Do not merge unrelated changes into one huge "find".
7. ORDER: List pairs so longer or more specific spans come before shorter ones when they could overlap; otherwise follow the order the user implied.
8. SKIP: Omit pairs where find equals replace, purely illustrative examples, or requests with no identifiable old string. Keep each find/replace to a short phrase (one label, one name, one date, one line fragment)—not entire multi-sentence blocks unless the user explicitly asked for that block.
9. LANGUAGES: Vietnamese, English, mixed, or other languages in the excerpt—same rules: copy "find" from excerpt when present.`;
}

function parsePairsFromLlmText(text) {
  const stripped = String(text || "")
    .replace(/<think[\s\S]*?<\/think>/gi, "")
    .replace(/<thinking[\s\S]*?<\/thinking>/gi, "")
    .trim();
  const fenced = stripped.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const jsonStr = fenced
    ? fenced[1]
    : (stripped.match(/\{[\s\S]*\}/)?.[0] ?? null);
  if (!jsonStr) return [];
  const parsed = JSON.parse(jsonStr);
  const pairs = parsed.pairs;
  if (!Array.isArray(pairs)) return [];
  const out = [];
  for (const p of pairs) {
    if (p && typeof p.find === "string" && typeof p.replace === "string") {
      const f = p.find.trim().replace(/\s+/g, " ");
      const r = p.replace.trim().replace(/\s+/g, " ");
      if (f && r && f !== r) out.push({ find: f, replace: r });
    }
  }
  return out;
}

/**
 * @param {string} userMessage
 * @param {string} assistantMessage
 * @param {string} [documentPlainText] optional excerpt from the template to anchor "find"
 * @param {string} [conversationContext] optional multi-turn transcript (USER:/ASSISTANT:)
 * @returns {Promise<{ find: string, replace: string }[]>}
 */
async function extractFindReplacePairsFromChatLLM(
  userMessage,
  assistantMessage,
  documentPlainText = "",
  conversationContext = ""
) {
  try {
    const { getLLMProvider } = require("./helpers");
    const LLM = getLLMProvider();
    if (!LLM || typeof LLM.getChatCompletion !== "function") return [];

    const response = await LLM.getChatCompletion(
      [
        {
          role: "user",
          content: buildPrompt(
            userMessage,
            assistantMessage,
            documentPlainText,
            conversationContext
          ),
        },
      ],
      { temperature: 0.15 }
    );

    const text =
      typeof response === "string" ? response : (response.textResponse ?? "");
    return parsePairsFromLlmText(text);
  } catch (err) {
    console.error("[extractFindReplacePairsLLM]", err.message);
    return [];
  }
}

module.exports = {
  extractFindReplacePairsFromChatLLM,
  parsePairsFromLlmText,
  buildPrompt,
};
