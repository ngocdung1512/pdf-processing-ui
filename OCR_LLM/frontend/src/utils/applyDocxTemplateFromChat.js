import { API_BASE } from "./constants";
import { baseHeaders } from "./request";

/**
 * Single round-trip: server reads template, infers pairs (LLM + excerpt + conversation), applies all replaces.
 *
 * @param {{
 *   templateBase64Raw: string,
 *   pairedUserMessage: string | null,
 *   assistantMessage: string,
 *   conversationContext: string,
 * }} args
 * @returns {Promise<{ blob: Blob, replaceCount: number, steps: number }>}
 */
export async function applyDocxTemplateFromChat({
  templateBase64Raw,
  pairedUserMessage,
  assistantMessage,
  conversationContext,
}) {
  const headers = { ...baseHeaders(), "Content-Type": "application/json" };
  if (headers.Authorization == null) delete headers.Authorization;

  const res = await fetch(`${API_BASE}/utils/docx-template-apply-from-chat`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      templateBase64: templateBase64Raw,
      pairedUserMessage: pairedUserMessage || "",
      assistantMessage: assistantMessage || "",
      conversationContext: conversationContext || "",
    }),
  });

  if (res.ok) {
    const blob = await res.blob();
    return {
      blob,
      replaceCount: Number(res.headers.get("X-Replace-Count") || 0),
      steps: Number(res.headers.get("X-Replace-Steps") || 0),
    };
  }

  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    const j = await res.json();
    const err = new Error(j.error || "Apply failed");
    err.code = j.code;
    err.pairIndex = j.pairIndex;
    err.findTried = j.findTried;
    err.textSnippetsFromFile = j.textSnippetsFromFile;
    throw err;
  }
  throw new Error((await res.text()) || "Apply failed");
}
