/** Last .docx uploaded in chat (session) — binary for “export by template” on assistant messages. */
export const CHAT_LAST_DOCX_BASE64_KEY = "CHAT_LAST_DOCX_BASE64";
export const CHAT_LAST_DOCX_NAME_KEY = "CHAT_LAST_DOCX_NAME";
/** Epoch ms — updated whenever a .docx is stored from chat attachment */
export const CHAT_LAST_DOCX_UPDATED_AT_KEY = "CHAT_LAST_DOCX_UPDATED_AT";

/** Epoch ms — updated whenever DocxTemplateButton saves DOCX_TEMPLATE_BINARY */
export const DOCX_TEMPLATE_UPDATED_AT_KEY = "DOCX_TEMPLATE_UPDATED_AT";
/** Filename from the last template save (for export naming) */
export const DOCX_TEMPLATE_ORIGINAL_NAME_KEY = "DOCX_TEMPLATE_ORIGINAL_NAME";

/** Keys used by DocxTemplateButton / ReportDownloadCard for the active DOCX template. */
export const DOCX_TEMPLATE_STORAGE_KEYS = [
  "DOCX_TEMPLATE_BINARY",
  "DOCX_TEMPLATE_TAGS",
  "DOCX_TEMPLATE_MODE",
  "DOCX_TEMPLATE_STYLES",
  "DOCX_TEMPLATE_PROMPT",
  DOCX_TEMPLATE_UPDATED_AT_KEY,
  DOCX_TEMPLATE_ORIGINAL_NAME_KEY,
];

export const DOCX_TEMPLATE_STORAGE_CLEARED_EVENT = "DOCX_TEMPLATE_STORAGE_CLEARED";

export function markChatLastDocxTouched() {
  try {
    sessionStorage.setItem(CHAT_LAST_DOCX_UPDATED_AT_KEY, String(Date.now()));
  } catch (e) {
    console.warn("[markChatLastDocxTouched]", e);
  }
}

/**
 * Call whenever DOCX_TEMPLATE_BINARY is written so export can pick the most recently updated source.
 * @param {string} [originalFileName]
 */
export function markDocxTemplateTouched(originalFileName) {
  try {
    localStorage.setItem(DOCX_TEMPLATE_UPDATED_AT_KEY, String(Date.now()));
    if (originalFileName && typeof originalFileName === "string") {
      localStorage.setItem(DOCX_TEMPLATE_ORIGINAL_NAME_KEY, originalFileName);
    }
  } catch (e) {
    console.warn("[markDocxTemplateTouched]", e);
  }
}

/**
 * Resolve which .docx to use for "Theo mẫu": whichever source was updated last (chat attach vs template button).
 * No fixed priority — avoids stale session overriding a freshly chosen template and vice versa.
 *
 * @returns {{ base64: string, name: string } | null}
 */
export function pickDocxForTemplateExport() {
  const chatB64 = sessionStorage.getItem(CHAT_LAST_DOCX_BASE64_KEY);
  const chatName = sessionStorage.getItem(CHAT_LAST_DOCX_NAME_KEY) || "document.docx";
  const chatTs = Number(sessionStorage.getItem(CHAT_LAST_DOCX_UPDATED_AT_KEY) || 0);

  const raw = localStorage.getItem("DOCX_TEMPLATE_BINARY");
  let templateB64 = null;
  if (raw) {
    templateB64 = raw.includes(",") ? raw.split(",")[1] : raw;
  }
  const templateName =
    localStorage.getItem(DOCX_TEMPLATE_ORIGINAL_NAME_KEY) || "mau_bao_cao.docx";
  const templateTs = Number(localStorage.getItem(DOCX_TEMPLATE_UPDATED_AT_KEY) || 0);

  if (!chatB64 && !templateB64) return null;
  if (chatB64 && !templateB64) {
    return { base64: chatB64, name: chatName };
  }
  if (!chatB64 && templateB64) {
    return { base64: templateB64, name: templateName };
  }

  // Legacy: no timestamps yet → same as original behavior (chat attachment wins if both present)
  if (chatTs === 0 && templateTs === 0) {
    return { base64: chatB64, name: chatName };
  }

  if (templateTs > chatTs) {
    return { base64: templateB64, name: templateName };
  }
  return { base64: chatB64, name: chatName };
}

/**
 * Remove all DOCX template data from localStorage and notify the UI (DocxTemplateButton).
 */
export function clearDocxTemplateLocalStorage() {
  for (const key of DOCX_TEMPLATE_STORAGE_KEYS) {
    localStorage.removeItem(key);
  }
  window.dispatchEvent(new CustomEvent(DOCX_TEMPLATE_STORAGE_CLEARED_EVENT));
}
