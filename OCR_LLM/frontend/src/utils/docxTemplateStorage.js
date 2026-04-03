/** Last .docx uploaded in chat (session) — binary for “export by template” on assistant messages. */
export const CHAT_LAST_DOCX_BASE64_KEY = "CHAT_LAST_DOCX_BASE64";
export const CHAT_LAST_DOCX_NAME_KEY = "CHAT_LAST_DOCX_NAME";

/** Keys used by DocxTemplateButton / ReportDownloadCard for the active DOCX template. */
export const DOCX_TEMPLATE_STORAGE_KEYS = [
  "DOCX_TEMPLATE_BINARY",
  "DOCX_TEMPLATE_TAGS",
  "DOCX_TEMPLATE_MODE",
  "DOCX_TEMPLATE_STYLES",
  "DOCX_TEMPLATE_PROMPT",
];

export const DOCX_TEMPLATE_STORAGE_CLEARED_EVENT = "DOCX_TEMPLATE_STORAGE_CLEARED";

/**
 * Remove all DOCX template data from localStorage and notify the UI (DocxTemplateButton).
 */
export function clearDocxTemplateLocalStorage() {
  for (const key of DOCX_TEMPLATE_STORAGE_KEYS) {
    localStorage.removeItem(key);
  }
  window.dispatchEvent(new CustomEvent(DOCX_TEMPLATE_STORAGE_CLEARED_EVENT));
}
