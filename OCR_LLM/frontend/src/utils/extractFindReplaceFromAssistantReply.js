import {
  parseFindReplaceFromPrompt,
  parseAllFindReplaceFromPrompt,
  normalizeTextForFindReplacePrompt,
} from "./parseFindReplaceFromPrompt";

/**
 * Strip thought blocks so regex matches the visible reply only.
 * @param {string} text
 */
function stripThoughtBlocks(text) {
  if (!text) return "";
  return text
    .replace(/<think[\s\S]*?<\/think>/gi, "")
    .replace(/<thinking[\s\S]*?<\/thinking>/gi, "")
    .replace(/<thought[\s\S]*?<\/thought>/gi, "")
    .replace(/<redacted_thinking>[\s\S]*?<\/redacted_thinking>/gi, "");
}

/** Trim markdown emphasis and wrapping quotes from a label line value */
function stripLabelValue(raw) {
  if (!raw) return "";
  return raw
    .replace(/\*+/g, "")
    .replace(/^[`"'“”‘’\s\-•]+|[`"'“”‘’\s]+$/g, "")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Extract find/replace from assistant wording (Vietnamese report edits).
 * Examples:
 *   Chỉ thay đổi tên "Hoàng Ngọc Dũng" thành "Đỗ Duy Khánh"
 *   (thay "A" thành "B")
 * @param {string} text
 * @returns {{ find: string, replace: string } | null}
 */
export function extractFindReplaceFromAssistantReply(text) {
  if (!text || typeof text !== "string") return null;
  const clean = stripThoughtBlocks(text);

  const patterns = [
    /thay\s+đổi\s+tên\s*"([^"]+)"\s*thành\s*"([^"]+)"/i,
    /tên\s*"([^"]+)"\s*đã\s+được\s+thay\s+(?:bằng|thành)\s*"([^"]+)"/i,
    /(?:^|[\s(])Chỉ\s+thay\s+đổi\s+tên\s*"([^"]+)"\s*thành\s*"([^"]+)"/i,
    // từ 'A' thành 'B' / từ "A" thành "B" (common bot confirmations)
    /từ\s+['\u2018]([^'\u2019\n]+)['\u2019]\s+thành\s+['\u2018]([^'\u2019\n]+)['\u2019]/i,
    /từ\s+"([^"\n]+)"\s+thành\s+"([^"\n]+)"/i,
  ];

  for (const re of patterns) {
    const m = clean.match(re);
    if (m) {
      const find = m[1].trim().replace(/\s+/g, " ");
      const replace = m[2].trim().replace(/\s+/g, " ");
      if (find.length > 0 && replace.length > 0) return { find, replace };
    }
  }
  return null;
}

/**
 * Collect all "old" → "new" pairs from assistant text (common when the model lists edits).
 * Supports straight "…" → "…", curly “…”, and single '…' → '…'.
 * @param {string} text
 * @returns {{ find: string, replace: string }[]}
 */
export function extractAllFindReplacePairsFromAssistantReply(text) {
  if (!text || typeof text !== "string") return [];
  const clean = stripThoughtBlocks(text);
  const pairs = [];
  const seen = new Set();
  const push = (find, replace) => {
    const f = find.trim().replace(/\s+/g, " ");
    const r = replace.trim().replace(/\s+/g, " ");
    if (!f || !r) return;
    const k = `${f}\0${r}`;
    if (seen.has(k)) return;
    seen.add(k);
    pairs.push({ find: f, replace: r });
  };

  // "từ 'A' thành 'B'" (global scan — may appear mid-sentence)
  const tuThanhRes = [
    /từ\s+['\u2018]([^'\u2019\n]+)['\u2019]\s+thành\s+['\u2018]([^'\u2019\n]+)['\u2019]/gi,
    /từ\s+"([^"\n]+)"\s+thành\s+"([^"\n]+)"/gi,
    // 'A' thành 'B' without leading "từ" (min length avoids English contractions)
    /['\u2018]([^'\u2019\n]{2,})['\u2019]\s+thành\s+['\u2018]([^'\u2019\n]{2,})['\u2019]/g,
  ];
  for (const re of tuThanhRes) {
    let m;
    const r = new RegExp(re.source, re.flags);
    while ((m = r.exec(clean)) !== null) {
      push(m[1], m[2]);
    }
  }

  const arrowRes = [
    /"([^"]+)"\s*(?:→|->|\u2192)\s*"([^"]+)"/g,
    /\u201c([^\u201d]+)\u201d\s*(?:→|->|\u2192)\s*\u201c([^\u201d]+)\u201d/g,
    /'([^']+)'\s*(?:→|->|\u2192)\s*'([^']+)'/g,
  ];
  for (const re of arrowRes) {
    let m;
    const r = new RegExp(re.source, re.flags);
    while ((m = r.exec(clean)) !== null) {
      push(m[1], m[2]);
    }
  }

  // Bot-style: "- **Tên cũ:** …" / "Tên cũ (Old name): …" — allow * / parens before ':'
  const labelOldNewPairs = [
    [/Tên\s+cũ[^:\n]*:\s*([^\n]+)/i, /Tên\s+mới[^:\n]*:\s*([^\n]+)/i],
    [/Người\s+ký\s+cũ[^:\n]*:\s*([^\n]+)/i, /Người\s+ký\s+mới[^:\n]*:\s*([^\n]+)/i],
    [/Old\s+name[^:\n]*:\s*([^\n]+)/i, /New\s+name[^:\n]*:\s*([^\n]+)/i],
  ];
  for (const [reOld, reNew] of labelOldNewPairs) {
    const mo = clean.match(reOld);
    const mn = clean.match(reNew);
    if (mo && mn) {
      push(stripLabelValue(mo[1]), stripLabelValue(mn[1]));
    }
  }

  const legacy = extractFindReplaceFromAssistantReply(clean);
  if (legacy) push(legacy.find, legacy.replace);

  return pairs;
}

/**
 * Prefer pairs from assistant (exact strings as in the document), else from user message.
 * @param {string | null} pairedUserMessage
 * @param {string} assistantMessage
 * @returns {{ find: string, replace: string }[]}
 */
export function getFindReplacePairsForTemplate(
  pairedUserMessage,
  assistantMessage
) {
  const fromReply = extractAllFindReplacePairsFromAssistantReply(
    normalizeTextForFindReplacePrompt(assistantMessage || "")
  );
  if (fromReply.length > 0) return fromReply;
  return parseAllFindReplaceFromPrompt(pairedUserMessage || "");
}

/**
 * Prefer quoted-name patterns from the assistant reply, then fall back to
 * the same natural-language rules as the prompt bar (thay A thành B).
 * @param {string} text
 * @returns {{ find: string, replace: string } | null}
 */
export function tryExtractFindReplaceFromReply(text) {
  const all = extractAllFindReplacePairsFromAssistantReply(text);
  if (all.length > 0) return all[0];
  return parseFindReplaceFromPrompt(stripThoughtBlocks(text));
}
