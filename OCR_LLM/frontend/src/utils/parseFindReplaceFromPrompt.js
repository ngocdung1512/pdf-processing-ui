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

function pushPair(pairs, seen, find, replace) {
  const f = find.trim().replace(/\s+/g, " ");
  const r = replace.trim().replace(/\s+/g, " ");
  if (!f || !r) return;
  const k = `${f}\0${r}`;
  if (seen.has(k)) return;
  seen.add(k);
  pairs.push({ find: f, replace: r });
}

/**
 * Parse several comma/semicolon-separated substitution requests (Vietnamese).
 * Examples:
 *   "tên nguyễn văn căn thay là hồ ngọc hà, còn hoàng ngọc dũng thay là lê văn chính"
 *   "đổi lại năm trong file thành 2027, ..."
 *
 * @param {string} text
 * @returns {{ find: string, replace: string }[]}
 */
export function parseAllFindReplaceFromPrompt(text) {
  if (!text || typeof text !== "string") return [];
  const t = text.trim();
  if (!t) return [];
  const pairs = [];
  const seen = new Set();

  const parts = t.split(/[,;]+/).map((s) => s.trim()).filter(Boolean);
  for (const part of parts) {
    let m;
    if ((m = part.match(/^tên\s+(.+?)\s+thay\s+là\s+(.+)$/is))) {
      pushPair(pairs, seen, m[1], m[2]);
      continue;
    }
    if ((m = part.match(/^còn\s+(.+?)\s+thay\s+là\s+(.+)$/is))) {
      pushPair(pairs, seen, m[1], m[2]);
      continue;
    }
    if ((m = part.match(/^đổi\s+(.+?)\s+thành\s+(.+)$/is))) {
      pushPair(pairs, seen, m[1], m[2]);
      continue;
    }
    if ((m = part.match(/^thay\s+(.+?)\s+thành\s+(.+)$/is))) {
      pushPair(pairs, seen, m[1], m[2]);
      continue;
    }
    if ((m = part.match(/^(.+?)\s+thay\s+là\s+(.+)$/is))) {
      pushPair(pairs, seen, m[1], m[2]);
      continue;
    }
  }
  if (pairs.length === 0) {
    const one = parseFindReplaceFromPrompt(t);
    if (one) pushPair(pairs, seen, one.find, one.replace);
  }
  return pairs;
}
