/**
 * Extract find/replace from a natural-language prompt (Vietnamese + simple English).
 * Examples that match:
 *   "thay Hoàng Ngọc Dũng thành Vũ Xuân Trường"
 *   "đổi A thành B"
 *   "thay A bằng B"
 *   "replace X with Y"
 *
 * @param {string} text
 * @returns {{ find: string, replace: string } | null}
 */
export function parseFindReplaceFromPrompt(text) {
  if (!text || typeof text !== "string") return null;
  const t = text.trim();
  if (!t) return null;

  const patterns = [
    // "thay tên Hoàng Ngọc Dũng thành Vũ Xuân Thiều" — find is the name, not "tên …"
    /\bthay\s+tên\s+(.+?)\s+thành\s+(.+)/is,
    /\bthay\s+(.+?)\s+thành\s+(.+)/is,
    /\bđổi\s+(.+?)\s+thành\s+(.+)/is,
    /\bthay\s+(.+?)\s+bằng\s+(.+)/is,
    /\breplace\s+(.+?)\s+with\s+(.+)/is,
  ];

  for (const re of patterns) {
    const m = t.match(re);
    if (m) {
      const find = m[1].trim().replace(/\s+/g, " ");
      const replace = m[2].trim().replace(/\s+/g, " ");
      if (find.length > 0) return { find, replace };
    }
  }
  return null;
}
