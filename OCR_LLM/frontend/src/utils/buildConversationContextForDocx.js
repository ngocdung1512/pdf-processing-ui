import { stripAssistantThoughtForExport } from "@/components/WorkspaceChat/ChatContainer/ChatHistory/ThoughtContainer";

/**
 * Build a compact transcript for LLM: USER / ASSISTANT lines up to the export target message.
 * Lets the model respect follow-ups like "sửa lại", "ý tôi là…".
 *
 * @param {Array<{ role?: string, content?: string, type?: string }> | null} chatHistory
 * @param {number | null | undefined} assistantHistoryIndex index of the assistant message in `chatHistory`
 * @param {{ maxMessages?: number, maxChars?: number }} [opts]
 * @returns {string}
 */
export function buildConversationContextForTemplateExport(
  chatHistory,
  assistantHistoryIndex,
  opts = {}
) {
  const maxMessages = opts.maxMessages ?? 22;
  const maxChars = opts.maxChars ?? 18_000;
  if (
    !Array.isArray(chatHistory) ||
    assistantHistoryIndex == null ||
    assistantHistoryIndex < 0
  ) {
    return "";
  }
  const start = Math.max(0, assistantHistoryIndex - maxMessages + 1);
  const slice = chatHistory.slice(start, assistantHistoryIndex + 1);
  const lines = [];
  let chars = 0;

  const stripThought = (t) => stripAssistantThoughtForExport(t);

  for (const m of slice) {
    if (m.type === "statusResponse" || m.type === "rechartVisualize") continue;
    const role = m.role;
    if (role !== "user" && role !== "assistant") continue;
    const label = role === "user" ? "USER" : "ASSISTANT";
    const text = stripThought(m.content);
    if (!text) continue;
    const line = `${label}: ${text}`;
    if (chars + line.length > maxChars) break;
    lines.push(line);
    chars += line.length + 2;
  }
  return lines.join("\n\n");
}
