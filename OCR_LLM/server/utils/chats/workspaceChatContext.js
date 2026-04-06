/**
 * Product boundary: when workspace RAG (pins, parsed files, vector, backfill, permissive fallback)
 * is injected into the LLM prompt.
 *
 * **Lightweight = flexible, not a phrase whitelist.** Any short, low-structure message without
 * document/legal/file signals is treated as normal chat (e.g. "xin chào" was only one example).
 * Explicit patterns below are optional fast-paths; the broad rule is
 * `isFlexibleShortCasualTurn` + `hasSubstantiveDocumentIntent` heuristics.
 *
 * **Rule:** skip injection when the message is **lightweight**. The env
 * `WORKSPACE_CONTEXT_IN_CHAT_MODE` is legacy; `full` no longer forces inject on every turn.
 */

const CHAT_CONTEXT_MODES = new Set(["minimal", "full"]);
const DOCUMENT_EXT_REGEX = /\.(pdf|doc|docx|xls|xlsx|csv|txt|md)$/i;

/**
 * Signals that the user is asking about workspace material (files, reports, embeddings).
 * Used to avoid treating short general questions as "document mode" for RAG injection.
 */
/** Short follow-ups clearly referring to "this file / this section" (VN). */
function isLikelyDocumentFollowUp(message) {
  const s = String(message || "").trim();
  if (!s || s.length > 280) return false;
  if (
    /(trong\s+(file|tài\s*liệu|đoạn|phần|bài|văn\s*bản|báo\s*cáo)|(đoạn|phần|mục)\s+(này|sau|trước|trên|dưới|cuối)|theo\s+(đoạn|file|tài\s*liệu)|đọc\s+(giúp|đoạn|phần))/i.test(
      s
    )
  )
    return true;
  if (
    /(nói\s+về\s+gì|viết\s+(về\s+)?gì|ý\s+nghĩa|giải\s+thích\s+(đoạn|phần|giúp)|tóm\s+(lại|nhanh)\s+(đoạn|phần)?)/i.test(
      s
    )
  )
    return true;
  return false;
}

/** e.g. "đọc đi", "tóm tắt giúp" right after an upload — treat as document intent. */
function isShortDocumentImperative(message) {
  const s = String(message || "").trim();
  if (!s || s.length > 52) return false;
  return /^(đọc|tóm\s*tắt|phân\s*tích|giải\s+thích)(\s+đi|\s+giúp|\s+nhanh)?$/i.test(
    s
  );
}

function hasDocKeywordSignal(s) {
  const t = String(s || "");
  if (/(https?:\/\/|\.pdf\b|\.docx?\b|\.xlsx?\b|\.csv\b)/i.test(t)) return true;
  if (
    /(báo\s*cáo|tài\s*liệu|văn\s*bản|đính\s*kèm|nội\s*dung|mục\s*\d|điều\s*\d|khoản\s*\d)/i.test(
      t
    )
  )
    return true;
  if (/(theo\s+(báo\s*cáo|file|tài\s*liệu|văn\s*bản|điều|mục|khoản)|dựa\s+trên)/i.test(t))
    return true;
  if (/(số\s*liệu|thống\s*kê|chỉ\s*tiêu)/i.test(t) && /\b(file|tài\s*liệu|báo\s*cáo)\b/i.test(t))
    return true;
  if (
    /(summarize|summarise|analy[sz]e|according\s+to|reference|attachment|report|document|extract|cite)/i.test(
      t
    )
  )
    return true;
  if (/\bfile\b/i.test(t)) return true;
  return false;
}

/** Strip combining marks so "xin chao" matches "xin chào" for greeting detection. */
function foldGreetingAscii(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * Broad “normal chat” detector: not a fixed command list — any short message in 1–2 lines
 * without doc signals is usually small-talk / general Q&A (subject to hasDocKeywordSignal).
 */
function isFlexibleShortCasualTurn(message) {
  const s = String(message || "").trim();
  if (!s || s.length > 140) return false;
  const lines = s
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0 || lines.length > 2) return false;
  return true;
}

/** Optional fast-path for common openers (supplements isFlexibleShortCasualTurn, not exhaustive). */
function isLikelyCasualGeneralChat(message) {
  const s = String(message || "").trim();
  if (!s || s.length > 140) return false;
  if (hasDocKeywordSignal(s)) return false;
  const lines = s
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length > 1) return false;

  const folded = foldGreetingAscii(s);
  return (
    /^(hi|hello|hey|hiya)\b[!. ,]*$/i.test(s) ||
    /^how\s+are\s+you(\s+today)?\s*[?!.]?$/i.test(s) ||
    /^what'?s\s+up\b/i.test(s) ||
    (/^(thanks?|thank\s+you|cảm\s+ơn)\b/i.test(s) && s.length < 70) ||
    (/^(xin\s+chào|chào\s+bạn|chào\s+anh|chào\s+chị)\b/i.test(s) && s.length < 90) ||
    (/^(xin\s+chao|chao\s+ban|chao\s+anh|chao\s+chi)\b/.test(folded) &&
      s.length < 90) ||
    /^bạn\s+khỏe\s+không\s*[?!]?$/i.test(s) ||
    (/^(ban\s+khoe\s+khong)\b/.test(folded) && s.length < 70) ||
    (/^(ok|okay|yes|no)\b[!.]?$/i.test(s) && s.length < 32)
  );
}

function workspaceContextInChatMode() {
  const v = String(process.env.WORKSPACE_CONTEXT_IN_CHAT_MODE || "minimal")
    .toLowerCase()
    .trim();
  return CHAT_CONTEXT_MODES.has(v) ? v : "minimal";
}

/**
 * Detects whether this turn has document uploads attached.
 * This should force document-grounded behavior for that turn.
 */
function hasDocumentAttachmentInRequest(attachments = []) {
  if (!Array.isArray(attachments) || attachments.length === 0) return false;
  return attachments.some((attachment) => {
    if (!attachment || typeof attachment !== "object") return false;
    if (
      String(attachment.mime || "").toLowerCase() ===
      "application/anythingllm-document"
    )
      return true;
    return DOCUMENT_EXT_REGEX.test(String(attachment.name || ""));
  });
}

/**
 * Strong signals the user expects an answer grounded in files / reports / structured content.
 */
function hasSubstantiveDocumentIntent(message) {
  const s = String(message || "").trim();
  if (!s) return false;
  if (isLikelyCasualGeneralChat(s)) return false;
  if (isLikelyDocumentFollowUp(s)) return true;
  if (isShortDocumentImperative(s)) return true;
  if (hasDocKeywordSignal(s)) return true;

  const lines = s
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  // Long single-topic rants without doc cues are often general chat — do not force RAG/hybrid.
  if (s.length > 260) {
    if (hasDocKeywordSignal(s)) return true;
    if (lines.length >= 3) return true;
    if (s.length > 2000) return true;
    return false;
  }

  if (lines.length >= 4) return true;

  if (/(https?:\/\/|\.pdf\b|\.docx?\b|\.xlsx?\b|\.csv\b)/i.test(s)) return true;

  if (
    /(phân\s*tích|tóm\s*tắt|tóm\s*lược|giải\s*thích|nêu\s+(rõ|ý|nội\s*dung|điểm)|trình\s*bày|đánh\s*giá)/i.test(
      s
    )
  )
    return true;
  if (
    /(báo\s*cáo|tài\s*liệu|văn\s*bản|đính\s*kèm|file|nội\s*dung|điều\s*khoản|mục\s*\d|điều\s*\d|khoản\s*\d)/i.test(
      s
    )
  )
    return true;
  if (/(theo\s+(báo\s*cáo|file|tài\s*liệu|văn\s*bản|điều|mục|khoản)|dựa\s+trên)/i.test(s))
    return true;
  if (/(PC\s*\d+|phòng\s*PC|vụ\s*việc|khởi\s*tố|án|điều\s*tra|kiến\s*nghị|kết\s*luận)/i.test(s))
    return true;
  if (/(số\s*liệu|thống\s*kê|chỉ\s*tiêu|chỉ\s*đạo|nghị\s*quyết)/i.test(s)) return true;
  if (
    /(summarize|summarise|analy[sz]e|according\s+to|reference|attachment|report|document|extract|cite)/i.test(
      s
    )
  )
    return true;

  // After substantive cues above: short 1–2 lines without matches = flexible normal chat.
  if (isFlexibleShortCasualTurn(s)) return false;

  // Do NOT treat every English WH-question as document intent — that pulled RAG for normal Q&A.
  // Short/medium general questions (no doc keywords) skip workspace injection.
  if (/\?/.test(s)) {
    const compact = s.replace(/\s/g, "");
    const words = s.split(/\s+/).filter(Boolean);
    if (hasDocKeywordSignal(s)) return true;
    if (words.length >= 22 || compact.length >= 200) return true;
    return false;
  }

  if (/\d{3,}/.test(s) && s.length >= 12) return true;

  return false;
}

/**
 * True when the message is likely small-talk / opener only — safe to skip workspace RAG.
 * Not a closed list of phrases: anything short without substantive document intent qualifies.
 */
function isLightweightConversationMessage(message) {
  const raw = String(message || "").trim();
  if (!raw) return true;
  if (hasSubstantiveDocumentIntent(raw)) return false;

  if (raw.length > 300) return false;
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length > 3) return false;

  return true;
}

/**
 * @deprecated Use isLightweightConversationMessage — kept for hybrid router import name stability.
 */
function isTrivialHybridStyleGreeting(message) {
  return isLightweightConversationMessage(message);
}

function shouldInjectFullWorkspaceContext(
  chatMode,
  message,
  { hasDocumentAttachment = false } = {}
) {
  if (hasDocumentAttachment) return true;
  if (isLightweightConversationMessage(message)) return false;
  return true;
}

module.exports = {
  workspaceContextInChatMode,
  hasDocKeywordSignal,
  hasDocumentAttachmentInRequest,
  isLikelyDocumentFollowUp,
  isShortDocumentImperative,
  isFlexibleShortCasualTurn,
  hasSubstantiveDocumentIntent,
  isLightweightConversationMessage,
  isTrivialHybridStyleGreeting,
  shouldInjectFullWorkspaceContext,
};
