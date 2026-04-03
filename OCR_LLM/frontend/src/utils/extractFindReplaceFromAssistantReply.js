import {
  parseFindReplaceFromPrompt,
  parseAllFindReplaceFromPrompt,
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
  const fromReply = extractAllFindReplacePairsFromAssistantReply(assistantMessage);
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
