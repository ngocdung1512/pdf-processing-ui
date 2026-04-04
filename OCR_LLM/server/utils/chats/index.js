const { v4: uuidv4 } = require("uuid");
const { WorkspaceChats } = require("../../models/workspaceChats");
const { resetMemory } = require("./commands/reset");
const { convertToPromptHistory } = require("../helpers/chat/responses");
const { SlashCommandPresets } = require("../../models/slashCommandsPresets");
const { SystemPromptVariables } = require("../../models/systemPromptVariables");

const VALID_COMMANDS = {
  "/reset": resetMemory,
};

async function grepCommand(message, user = null) {
  const userPresets = await SlashCommandPresets.getUserPresets(user?.id);
  const availableCommands = Object.keys(VALID_COMMANDS);

  // Check if the message starts with any built-in command
  for (let i = 0; i < availableCommands.length; i++) {
    const cmd = availableCommands[i];
    const re = new RegExp(`^(${cmd})`, "i");
    if (re.test(message)) {
      return cmd;
    }
  }

  // Replace all preset commands with their corresponding prompts
  // Allows multiple commands in one message
  let updatedMessage = message;
  for (const preset of userPresets) {
    const regex = new RegExp(
      `(?:\\b\\s|^)(${preset.command})(?:\\b\\s|$)`,
      "g"
    );
    updatedMessage = updatedMessage.replace(regex, preset.prompt);
  }

  return updatedMessage;
}

/**
 * @description This function will do recursive replacement of all slash commands with their corresponding prompts.
 * @notice This function is used for API calls and is not user-scoped. THIS FUNCTION DOES NOT SUPPORT PRESET COMMANDS.
 * @returns {Promise<string>}
 */
async function grepAllSlashCommands(message) {
  const allPresets = await SlashCommandPresets.where({});

  // Replace all preset commands with their corresponding prompts
  // Allows multiple commands in one message
  let updatedMessage = message;
  for (const preset of allPresets) {
    const regex = new RegExp(
      `(?:\\b\\s|^)(${preset.command})(?:\\b\\s|$)`,
      "g"
    );
    updatedMessage = updatedMessage.replace(regex, preset.prompt);
  }

  return updatedMessage;
}

async function recentChatHistory({
  user = null,
  workspace,
  thread = null,
  messageLimit = 20,
  apiSessionId = null,
}) {
  const rawHistory = (
    await WorkspaceChats.where(
      {
        workspaceId: workspace.id,
        user_id: user?.id || null,
        thread_id: thread?.id || null,
        api_session_id: apiSessionId || null,
        include: true,
      },
      messageLimit,
      { id: "desc" }
    )
  ).reverse();
  return { rawHistory, chatHistory: convertToPromptHistory(rawHistory) };
}

/**
 * Returns the base prompt for the chat. This method will also do variable
 * substitution on the prompt if there are any defined variables in the prompt.
 * @param {Object|null} workspace - the workspace object
 * @param {Object|null} user - the user object
 * @returns {Promise<string>} - the base prompt
 */
/** Default = normal chat; strict document grounding only when the user targets file content. */
const DOCUMENT_GROUNDING_SUFFIX = `

---
Behavior (read first):
- **Default:** Be a helpful assistant — casual chat, Q&A, and normal exchange are welcome. Use general knowledge when the user is **not** asking about specific uploaded material.
- **Document mode (only when relevant):** When the user clearly asks about **uploaded files, pinned context, attachments, or phrasing like "trong tài liệu / trong file / theo văn bản"**, treat answers as **grounded**: use only the provided context / retrieved text for **those** facts. Do not invent names, amounts, legal citations, agencies, or case details not supported by the sources.
- **Edits / substitutions the user requests (đổi tên, đổi năm, thay cụm từ trong file họ đã gửi):** Do **not** refuse with generic "policy" or "I cannot edit documents" (e.g. *theo quy định không thể chỉnh sửa tài liệu*). This is a **private** workspace: the user owns the file. **Confirm** each requested change clearly (old text → new text, or list pairs). You are not asked to rewrite a binary file in chat; confirming the substitution list is correct and helpful. Refusing blocks the user even when the app can apply changes on export.
- **Tables / thống kê from documents:** Do **not** turn every document answer into a large statistics table by default. Use a **table or tight row-by-row list** only when the user clearly asks (e.g. *thống kê*, *bảng*, *liệt kê theo từng dòng*, *xuất dữ liệu*). When you do: every value must match the source; do not add or drop cases, change numbers, or invent rows to “fill” the grid. If retrieved context is partial or row/column boundaries are unclear, **say so** and answer conservatively (prose, partial list, or incomplete table with an explicit caveat)—do not guess to complete the table.
- **Merged cells:** If the source clearly shows merged cells and the user asked for a tabular layout, you may repeat shared text on each logical row **only when that structure is obvious** from the provided text. If merges or row boundaries are **not** clear in context, do not infer—avoid fabricating extra rows or duplicated “carry-down” values.
- **Multiple files:** When the context contains blocks starting with \`<<<SOURCE_DOCUMENT:…>>>\`, each block is one file’s text. For summaries or tables across uploads, **attribute** rows or facts to the correct file label; do not mix content from one file into another. Column names and grouping rules (e.g. one row per case vs per person) come **only** from the user’s instructions, not from assumptions about a fixed report template.
- If a **document-specific** question cannot be answered from context, say it is not stated there (do not guess document facts from general knowledge).
- Do **not** force every message into "work mode" — small talk, math, definitions, and app help are **not** document tasks unless the user ties them to a file.
- **Tone:** Reply in **formal, polite Vietnamese** (trang trọng, lịch sự). Do **not** use emojis, emoticons, or decorative symbols (e.g. 😊 🙂) unless you are **quoting verbatim** from a source that contains them.
- Paraphrasing in Vietnamese is fine if meaning stays identical; do not substitute or "normalize" facts drawn from documents.
- **Verbatim / no fabrication** means: do not add facts not in the sources. For **reports / multi-section** asks: include **all main sections** present in the context, in order, with **enough substance per section** — **avoid redundant repetition** and **avoid padding**; you do not need maximum length unless the user asked for verbatim, page count, or line-by-line detail. If they asked for a short summary, stay short.
- When the user wants **detail**, present **each major section or logical block** clearly (headings or bullets). You may **condense** minor paragraphs within a section if facts stay accurate. Do **not** merge everything into one vague line (e.g. "Para 6–71: …"). Do **not** output internal labels like \`[Para_…]\` or \`[Table_…]\`.
- **Names / numbers:** Do **not** invent placeholder personal names (e.g. "Nguyễn Văn A") or statistics not present in the sources. If the document only states a role (e.g. team leader) without a full name, say it is **not stated** in the context — do not guess real names. Every figure (%, amounts, counts, years) must be traceable to the provided text.`;

async function chatPrompt(workspace, user = null) {
  const { SystemSettings } = require("../../models/systemSettings");
  const basePrompt =
    workspace?.openAiPrompt ?? SystemSettings.saneDefaultSystemPrompt;
  const expanded = await SystemPromptVariables.expandSystemPromptVariables(
    basePrompt,
    user?.id,
    workspace?.id
  );
  return expanded + DOCUMENT_GROUNDING_SUFFIX;
}

// We use this util function to deduplicate sources from similarity searching
// if the document is already pinned.
// Eg: You pin a csv, if we RAG + full-text that you will get the same data
// points both in the full-text and possibly from RAG - result in bad results
// even if the LLM was not even going to hallucinate.
function sourceIdentifier(sourceDocument) {
  if (!sourceDocument?.title || !sourceDocument?.published) return uuidv4();
  return `title:${sourceDocument.title}-timestamp:${sourceDocument.published}`;
}

module.exports = {
  sourceIdentifier,
  recentChatHistory,
  chatPrompt,
  grepCommand,
  grepAllSlashCommands,
  VALID_COMMANDS,
};
