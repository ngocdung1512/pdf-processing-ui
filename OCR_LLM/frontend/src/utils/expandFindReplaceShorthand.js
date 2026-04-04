/**
 * Expand shorthand replacements when the user only names the new province/place
 * but the find text includes a "tỉnh …" (or similar) prefix.
 *
 * Example: find "công an tỉnh hưng yên", replace "bắc ninh"
 *    -> replace "công an tỉnh Bắc Ninh" (casing follows old province in find).
 */

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
  const n = String(newRaw || "").trim().normalize("NFC");
  const o = String(oldSegment || "").trim().normalize("NFC");
  if (!o || !n) return n;
  const hasLetter = /[\p{L}]/u.test(o);
  if (!hasLetter) return n;
  const isAllUpper = o === o.toUpperCase() && /[\p{Lu}]/u.test(o);
  if (isAllUpper) return n.toLocaleUpperCase("vi-VN");
  const isAllLower = o === o.toLowerCase();
  if (isAllLower) return titleCaseViWords(n);
  return titleCaseViWords(n);
}

const RE_FIND_TINH = /^(.*?)(\btỉnh\s+)(.+)$/isu;

/**
 * @param {{ find: string, replace: string }} pair
 * @returns {{ find: string, replace: string }}
 */
export function expandPairIfShorthandProvince(pair) {
  const find = String(pair.find || "")
    .normalize("NFC")
    .trim()
    .replace(/\s+/g, " ");
  let replace = String(pair.replace || "")
    .normalize("NFC")
    .trim()
    .replace(/\s+/g, " ");
  if (!find || !replace) return { find, replace };
  if (find === replace) return { find, replace };
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
  const expanded = `${prefix}${tinhTok}${styledNew}`.replace(/\s+/g, " ").trim();
  if (!expanded || expanded === replace) return { find, replace };
  return { find, replace: expanded };
}
