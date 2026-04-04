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
  process.env.HYBRID_CHATBOT_TIMEOUT_MS || 120000
);

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
      String(err?.cause?.code || "").toLowerCase().includes("econnrefused"),
  } = retry;

  let lastErr = null;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetch(url, options);
    } catch (err) {
      lastErr = err;
      if (!retryOn(err) || i === attempts - 1) throw err;
      await sleep(delayMs);
    }
  }
  throw lastErr ?? new Error("fetch failed");
}

async function waitForHybridReady(baseUrl, timeoutMs = 120000) {
  const started = Date.now();
  const readyUrl = `${baseUrl}/ready`;
  while (Date.now() - started < timeoutMs) {
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

function hybridSessionKey({ workspace, thread, sessionId, user }) {
  return [
    workspace?.id || "unknown-workspace",
    thread?.id || "no-thread",
    sessionId || "no-session",
    user?.id || "anonymous",
  ].join(":");
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
  const isReady = await waitForHybridReady(HYBRID_CHATBOT_UPLOAD_BASE_URL).catch(
    () => false
  );
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
        attempts: 12,
        delayMs: 2000,
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

function shouldUseHybridChatbot(message = "", attachments = [], hybridDocIds = []) {
  if (!HYBRID_CHATBOT_ENABLED) return false;
  const msg = String(message || "").trim();
  const trivialGreeting =
    msg.length > 0 &&
    msg.length < 80 &&
    /^(chào|hi|hello|xin\s*chào|cảm\s*ơn|thanks|ok|oke)\b/i.test(msg);

  const pdfLike = hasPdfLikeDocumentAttachment(attachments);

  // Word-only attachment → AnythingLLM (Collector / workspace), never 8010.
  if (hasOnlyWordDocumentAttachments(attachments) && !pdfLike) return false;

  if (pdfLike) return true;

  const remembered = (hybridDocIds?.length || 0) > 0;
  if (remembered) {
    if (trivialGreeting) return false;
    return true;
  }

  // No PDF/sheet in this message and no active hybrid session → default AnythingLLM.
  return false;
}

async function requestHybridChatbot({
  message,
  sessionId,
  docIds,
  timeoutMs = HYBRID_CHATBOT_TIMEOUT_MS,
}) {
  const isReady = await waitForHybridReady(HYBRID_CHATBOT_CHAT_BASE_URL).catch(
    () => false
  );
  if (!isReady)
    throw new Error("Hybrid chat service is busy. Please retry in a moment.");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
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
        attempts: 12,
        delayMs: 2000,
      }
    );
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Hybrid chat failed (${res.status}): ${body}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function prepareHybridState(
  message,
  attachments,
  workspace,
  thread,
  sessionId,
  user
) {
  const sessionKey = hybridSessionKey({ workspace, thread, sessionId, user });
  const rememberedDocIds = getHybridDocIdsForSession(sessionKey);
  const useHybrid = shouldUseHybridChatbot(
    message,
    attachments,
    rememberedDocIds
  );
  const uploadedHybridDocIds = useHybrid
    ? await uploadAttachmentsToHybridChatbot(attachments).catch((error) => {
        console.warn("[Hybrid Router] upload attachments failed:", error.message);
        return [];
      })
    : [];
  const hybridDocIds = mergeHybridDocIds(rememberedDocIds, uploadedHybridDocIds);
  if (uploadedHybridDocIds.length > 0)
    setHybridDocIdsForSession(sessionKey, hybridDocIds);
  if (
    !useHybrid &&
    hasOnlyWordDocumentAttachments(attachments) &&
    attachments.filter(isDocumentAttachment).length > 0
  ) {
    setHybridDocIdsForSession(sessionKey, []);
  }
  return { useHybrid, hybridDocIds, sessionKey };
}

module.exports = {
  prepareHybridState,
  requestHybridChatbot,
  hybridSessionKey,
  hasOnlyWordDocumentAttachments,
  hasPdfLikeDocumentAttachment,
};
