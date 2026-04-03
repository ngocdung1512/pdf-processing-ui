import { parseFindReplaceFromPrompt } from "./parseFindReplaceFromPrompt";

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
 * Prefer quoted-name patterns from the assistant reply, then fall back to
 * the same natural-language rules as the prompt bar (thay A thành B).
 * @param {string} text
 * @returns {{ find: string, replace: string } | null}
 */
export function tryExtractFindReplaceFromReply(text) {
  return (
    extractFindReplaceFromAssistantReply(text) ||
    parseFindReplaceFromPrompt(stripThoughtBlocks(text))
  );
}
