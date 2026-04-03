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
- For **tables / statistics from Word**: every row and cell value must **trace to the source text**; you may rephrase wording but **must not** add or drop cases, change numbers, or merge/split rows. If context is incomplete, say so — do not fabricate rows to “complete” the table.
- If a **document-specific** question cannot be answered from context, say it is not stated there (do not guess document facts from general knowledge).
- Do **not** force every message into "work mode" — small talk, math, definitions, and app help are **not** document tasks unless the user ties them to a file.
- **Tone:** Reply in **formal, polite Vietnamese** (trang trọng, lịch sự). Do **not** use emojis, emoticons, or decorative symbols (e.g. 😊 🙂) unless you are **quoting verbatim** from a source that contains them.
- Paraphrasing in Vietnamese is fine if meaning stays identical; do not substitute or "normalize" facts drawn from documents.
- **Verbatim / no fabrication** means: do not add facts not in the sources — it does **not** mean compress the answer to a few bullets when the user asked for a full report and the retrieved context contains multiple sections. Cover **all** relevant parts present in the context, in order, unless the user explicitly asked for a short summary.
- When the user wants **detail / full text**, do **not** merge many source paragraphs into one summary line (e.g. "Para 6–71: …"). Give **each logical paragraph** from the context as its **own** block or bullet. Do **not** output internal labels like \`[Para_…]\` or \`[Table_…]\`.
- For table/list outputs, when source rows share merged cells (same unit/action/legal basis across multiple people), expand to **one record per person** and **repeat shared values on each row**. Do not leave blanks caused only by merged source cells.
- For remedial-measure columns (e.g. Vietnamese administrative tables: **biện pháp khắc phục hậu quả**): do **not** fill with "-" or leave empty when the source row or vertically merged carry-down in context already contains text; use "-" only when the source cell is literally empty or a dash.`;

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
