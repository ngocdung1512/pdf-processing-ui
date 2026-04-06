const { v4: uuidv4 } = require("uuid");
const { Blob } = require("buffer");

/**
 * Hybrid router: Python chatbot (8010) ONLY for PDF / spreadsheet-class files
 * and follow-up turns in the same session after such an upload.
 *
 * Word (.doc/.docx) stays on AnythingLLM default (Collector + workspace RAG).
 */
const HYBRID_CHATBOT_ENABLED =
  String(process.env.HYBRID_CHATBOT_ENABLED || "true").toLowerCase() === "true";

function normalizeBaseUrl(value, fallback) {
  const normalized = String(value || fallback || "").trim();
  return normalized.replace(/\/+$/, "");
}

const HYBRID_CHATBOT_BASE_URL = normalizeBaseUrl(
  process.env.HYBRID_CHATBOT_BASE_URL,
  "http://127.0.0.1:8010"
);
const HYBRID_CHATBOT_UPLOAD_BASE_URL = normalizeBaseUrl(
  process.env.HYBRID_CHATBOT_UPLOAD_BASE_URL,
  HYBRID_CHATBOT_BASE_URL
);
const HYBRID_CHATBOT_CHAT_BASE_URL = normalizeBaseUrl(
  process.env.HYBRID_CHATBOT_CHAT_BASE_URL,
  HYBRID_CHATBOT_BASE_URL
);
const HYBRID_CHATBOT_TIMEOUT_MS = Number(
  process.env.HYBRID_CHATBOT_TIMEOUT_MS || 0
);
const HYBRID_CHATBOT_READY_TIMEOUT_MS = Number(
  process.env.HYBRID_CHATBOT_READY_TIMEOUT_MS ||
    process.env.HYBRID_CHATBOT_TIMEOUT_MS ||
    0
);
const HYBRID_CHAT_RETRY_ATTEMPTS = Number(
  process.env.HYBRID_CHAT_RETRY_ATTEMPTS || 0
);
const HYBRID_CHAT_RETRY_DELAY_MS = Number(
  process.env.HYBRID_CHAT_RETRY_DELAY_MS || 1500
);
const HYBRID_UPLOAD_RETRY_ATTEMPTS = Number(
  process.env.HYBRID_UPLOAD_RETRY_ATTEMPTS || 0
);
const HYBRID_UPLOAD_RETRY_DELAY_MS = Number(
  process.env.HYBRID_UPLOAD_RETRY_DELAY_MS || 2000
);
const HYBRID_DOC_IDS_STRATEGY = String(
  process.env.HYBRID_DOC_IDS_STRATEGY || "merge"
)
  .toLowerCase()
  .trim();

const {
  isTrivialHybridStyleGreeting,
  hasSubstantiveDocumentIntent,
} = require("./workspaceChatContext");

const DOCUMENT_EXT_REGEX = /\.(pdf|doc|docx|xls|xlsx|csv)$/i;

const hybridDocIdsBySession = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url, options = {}, retry = {}) {
  const {
    attempts = 8,
    delayMs = 1500,
    retryOn = (err) =>
      String(err?.message || err || "")
        .toLowerCase()
        .includes("fetch failed") ||
      String(err?.cause?.code || "")
        .toLowerCase()
        .includes("econnrefused"),
  } = retry;

  const maxAttempts = Number(attempts);
  const infiniteAttempts =
    !Number.isFinite(maxAttempts) || maxAttempts <= 0 ? true : false;

  let lastErr = null;
  let i = 0;
  while (infiniteAttempts || i < maxAttempts) {
    try {
      return await fetch(url, options);
    } catch (err) {
      lastErr = err;
      if (!retryOn(err) || (!infiniteAttempts && i === maxAttempts - 1))
        throw err;
      await sleep(delayMs);
    }
    i++;
  }
  throw lastErr ?? new Error("fetch failed");
}

async function waitForHybridReady(baseUrl, timeoutMs = 120000) {
  const started = Date.now();
  const readyUrl = `${baseUrl}/ready`;
  const maxWaitMs = Number(timeoutMs);
  const waitForever = !Number.isFinite(maxWaitMs) || maxWaitMs <= 0;
  while (waitForever || Date.now() - started < maxWaitMs) {
    try {
      const res = await fetch(readyUrl, { method: "GET" });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data?.ready === true) return true;
      }
    } catch {
      // service may still be booting
    }
    await sleep(1500);
  }
  return false;
}

function hybridSessionKey({
  workspace,
  thread,
  sessionId,
  user,
  hybridClientSessionId = null,
}) {
  const ws = String(workspace?.id ?? "unknown-workspace");
  const tid = thread?.id != null ? String(thread.id) : "no-thread";
  let sid;
  if (thread?.id != null) {
    sid =
      sessionId != null && String(sessionId).trim().length > 0
        ? String(sessionId).trim()
        : `thread-${thread.id}`;
  } else {
    const h =
      hybridClientSessionId != null ? String(hybridClientSessionId).trim() : "";
    const s = sessionId != null ? String(sessionId).trim() : "";
    sid = h || s || "no-session";
  }
  const uid = String(user?.id ?? "anonymous");
  return `${ws}:${tid}:${sid}:${uid}`;
}

function resolvePythonSessionId({ thread, sessionId, hybridClientSessionId }) {
  if (thread?.id != null) return String(thread.id);
  const h =
    hybridClientSessionId != null ? String(hybridClientSessionId).trim() : "";
  if (h) return h;
  const s = sessionId != null ? String(sessionId).trim() : "";
  if (s) return s;
  return "default";
}

/**
 * Clear hybrid doc_id memory for a workspace (optionally one thread only).
 */
function clearHybridDocIdsForWorkspaceKeys({ workspace, thread = null }) {
  if (!workspace?.id) return;
  const ws = String(workspace.id);
  for (const k of [...hybridDocIdsBySession.keys()]) {
    const parts = k.split(":");
    if (parts[0] !== ws) continue;
    if (thread?.id != null) {
      if (parts[1] === String(thread.id)) hybridDocIdsBySession.delete(k);
    } else {
      hybridDocIdsBySession.delete(k);
    }
  }
}

function getHybridDocIdsForSession(key) {
  return hybridDocIdsBySession.get(key) || [];
}

function setHybridDocIdsForSession(key, docIds = []) {
  hybridDocIdsBySession.set(
    key,
    Array.from(new Set((docIds || []).filter(Boolean)))
  );
}

function mergeHybridDocIds(...groups) {
  return Array.from(
    new Set(
      groups
        .flat()
        .filter((docId) => typeof docId === "string" && docId.trim().length > 0)
    )
  );
}

function isDocumentAttachment(attachment = {}) {
  if (!attachment || typeof attachment !== "object") return false;
  if (
    String(attachment.mime || "").toLowerCase() ===
    "application/anythingllm-document"
  )
    return true;
  return DOCUMENT_EXT_REGEX.test(String(attachment.name || ""));
}

function attachmentToBlob(attachment) {
  let base64Data = String(attachment?.contentString || "");
  const dataUriMatch = base64Data.match(/^data:[^;]+;base64,(.+)$/);
  if (dataUriMatch) base64Data = dataUriMatch[1];
  const buffer = Buffer.from(base64Data, "base64");
  return new Blob([buffer], {
    type: "application/octet-stream",
  });
}

function isPdfLikeAttachmentName(name = "") {
  return /\.(pdf|xls|xlsx|csv)$/i.test(String(name || ""));
}

function isWordLikeAttachmentName(name = "") {
  return /\.(doc|docx)$/i.test(String(name || ""));
}

function hasPdfLikeDocumentAttachment(attachments = []) {
  return attachments.some(
    (a) => isDocumentAttachment(a) && isPdfLikeAttachmentName(a.name)
  );
}

/**
 * When hybrid has doc scope, prefer detail mode so chat_tool uses full-text / richer RAG
 * unless the user clearly asks for a short summary only.
 */
function hybridReplyDepth(message, docIds) {
  const ids = docIds || [];
  if (!ids.length) return "auto";
  const m = String(message || "").trim();
  if (
    /tóm\s*tắt|tóm\s*lược|ngắn\s*gọn|nêu\s*ý\s*chính|chỉ\s*ý\s*chính|summary|brief|skim|overview/i.test(
      m
    )
  ) {
    return "auto";
  }
  return "detail";
}

function hasOnlyWordDocumentAttachments(attachments = []) {
  const docs = attachments.filter(isDocumentAttachment);
  if (docs.length === 0) return false;
  return docs.every((a) => isWordLikeAttachmentName(a.name));
}

async function uploadAttachmentsToHybridChatbot(attachments = []) {
  const isReady = await waitForHybridReady(
    HYBRID_CHATBOT_UPLOAD_BASE_URL,
    HYBRID_CHATBOT_READY_TIMEOUT_MS
  ).catch(() => false);
  if (!isReady)
    throw new Error(
      "Hybrid upload service is not ready yet. Please retry in a moment."
    );

  const docAttachments = attachments.filter(isDocumentAttachment);
  if (!docAttachments.length) return [];

  const uploadedDocIds = [];
  for (const attachment of docAttachments) {
    const filename = attachment.name || `document-${uuidv4()}.pdf`;
    // Word never goes to 8010 — AnythingLLM default pipeline only.
    if (isWordLikeAttachmentName(filename)) continue;
    if (!isPdfLikeAttachmentName(filename)) continue;

    const form = new FormData();
    const blob = attachmentToBlob(attachment);
    form.append("file", blob, filename);
    const res = await fetchWithRetry(
      `${HYBRID_CHATBOT_UPLOAD_BASE_URL}/documents/upload`,
      {
        method: "POST",
        body: form,
      },
      {
        attempts: HYBRID_UPLOAD_RETRY_ATTEMPTS,
        delayMs: HYBRID_UPLOAD_RETRY_DELAY_MS,
      }
    );
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Hybrid upload failed (${res.status}): ${body}`);
    }
    const payload = await res.json();
    if (payload?.doc_id) uploadedDocIds.push(payload.doc_id);
  }
  return uploadedDocIds;
}

function shouldUseHybridChatbot(
  message = "",
  attachments = [],
  hybridDocIds = []
) {
  if (!HYBRID_CHATBOT_ENABLED) return false;
  const msg = String(message || "").trim();
  const pdfLike = hasPdfLikeDocumentAttachment(attachments);

  // Word-only attachment → AnythingLLM (Collector / workspace), never 8010.
  if (hasOnlyWordDocumentAttachments(attachments) && !pdfLike) return false;

  if (isTrivialHybridStyleGreeting(msg) && !pdfLike) return false;

  if (pdfLike) return true;

  const remembered = (hybridDocIds?.length || 0) > 0;
  // Active PDF session: only route to hybrid when the user likely asks about document content.
  // Otherwise use the normal workspace LLM so off-topic chat stays natural.
  if (remembered && !pdfLike && !hasSubstantiveDocumentIntent(msg)) return false;

  if (remembered) return true;

  // No PDF/sheet in this message and no active hybrid session → default AnythingLLM.
  return false;
}

async function requestHybridChatbot({
  message,
  sessionId,
  docIds,
  timeoutMs = HYBRID_CHATBOT_TIMEOUT_MS,
}) {
  const isReady = await waitForHybridReady(
    HYBRID_CHATBOT_CHAT_BASE_URL,
    HYBRID_CHATBOT_READY_TIMEOUT_MS
  ).catch(() => false);
  if (!isReady)
    throw new Error("Hybrid chat service is busy. Please retry in a moment.");

  const controller = new AbortController();
  const maxChatWaitMs = Number(timeoutMs);
  const timeout =
    Number.isFinite(maxChatWaitMs) && maxChatWaitMs > 0
      ? setTimeout(() => controller.abort(), maxChatWaitMs)
      : null;
  try {
    const res = await fetchWithRetry(
      `${HYBRID_CHATBOT_CHAT_BASE_URL}/chat`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          session_id: sessionId || "default",
          doc_ids: docIds || [],
          reply_depth: hybridReplyDepth(message, docIds),
        }),
        signal: controller.signal,
      },
      {
        attempts: HYBRID_CHAT_RETRY_ATTEMPTS,
        delayMs: HYBRID_CHAT_RETRY_DELAY_MS,
      }
    );
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Hybrid chat failed (${res.status}): ${body}`);
    }
    return await res.json();
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function prepareHybridState(
  message,
  attachments,
  workspace,
  thread,
  sessionId,
  user,
  hybridClientSessionId = null
) {
  const sessionKey = hybridSessionKey({
    workspace,
    thread,
    sessionId,
    user,
    hybridClientSessionId,
  });
  const rememberedDocIds = getHybridDocIdsForSession(sessionKey);
  const useHybrid = shouldUseHybridChatbot(
    message,
    attachments,
    rememberedDocIds
  );
  const uploadedHybridDocIds = useHybrid
    ? await uploadAttachmentsToHybridChatbot(attachments).catch((error) => {
        console.warn(
          "[Hybrid Router] upload attachments failed:",
          error.message
        );
        return [];
      })
    : [];
  let hybridDocIds;
  if (HYBRID_DOC_IDS_STRATEGY === "replace") {
    hybridDocIds =
      uploadedHybridDocIds.length > 0
        ? mergeHybridDocIds(uploadedHybridDocIds)
        : mergeHybridDocIds(rememberedDocIds);
  } else {
    hybridDocIds = mergeHybridDocIds(rememberedDocIds, uploadedHybridDocIds);
  }
  if (useHybrid && uploadedHybridDocIds.length > 0) {
    setHybridDocIdsForSession(sessionKey, hybridDocIds);
  }
  if (
    !useHybrid &&
    hasOnlyWordDocumentAttachments(attachments) &&
    attachments.filter(isDocumentAttachment).length > 0
  ) {
    setHybridDocIdsForSession(sessionKey, []);
  }
  const pythonSessionId = resolvePythonSessionId({
    thread,
    sessionId,
    hybridClientSessionId,
  });
  return { useHybrid, hybridDocIds, sessionKey, pythonSessionId };
}

module.exports = {
  prepareHybridState,
  requestHybridChatbot,
  hybridSessionKey,
  resolvePythonSessionId,
  clearHybridDocIdsForWorkspaceKeys,
  hasOnlyWordDocumentAttachments,
  hasPdfLikeDocumentAttachment,
};
