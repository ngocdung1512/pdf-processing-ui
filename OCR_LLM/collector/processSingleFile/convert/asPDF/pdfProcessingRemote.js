const fs = require("fs");
const path = require("path");
const { Blob } = require("buffer");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Single HTTP attempt to pdf_processing extract API.
 */
async function tryExtractOnce(fullFilePath, filename, urlTrimmed) {
  let buf;
  try {
    buf = fs.readFileSync(fullFilePath);
  } catch (e) {
    console.error("[pdfProcessingRemote] read failed:", e.message);
    return null;
  }

  const basename = path.basename(filename || fullFilePath) || "document.pdf";
  const blob = new Blob([buf], { type: "application/pdf" });
  const form = new FormData();
  form.append("file", blob, basename);

  const headers = {};
  const token = process.env.PDF_PROCESSING_EXTRACT_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;

  const timeoutMs = Math.max(
    60_000,
    Number.parseInt(process.env.PDF_PROCESSING_EXTRACT_TIMEOUT_MS || "", 10) ||
      900_000
  );
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(urlTrimmed, {
      method: "POST",
      body: form,
      headers,
      signal: controller.signal,
    });
    const json = await res.json().catch(() => ({}));
    return {
      ok: res.ok,
      success: !!json.success,
      pageContent: json.pageContent || "",
      title: json.title || basename,
      error: json.error || (res.ok ? null : `HTTP ${res.status}`),
    };
  } catch (e) {
    console.warn("[pdfProcessingRemote] fetch failed:", e.message);
    return {
      ok: false,
      success: false,
      pageContent: "",
      title: basename,
      error: e.message,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Send PDF to pdf_processing (full ingest: PyMuPDF or YOLO + Qwen2.5-VL per document_parser).
 * Retries on failure so slow service / cold start can succeed.
 *
 * Env:
 *   PDF_PROCESSING_EXTRACT_URL
 *   PDF_PROCESSING_EXTRACT_TOKEN (optional)
 *   PDF_PROCESSING_EXTRACT_RETRIES (default 5)
 *   PDF_PROCESSING_EXTRACT_RETRY_DELAY_MS (default 3000)
 */
async function extractPdfViaPdfProcessing(fullFilePath, filename) {
  const url = process.env.PDF_PROCESSING_EXTRACT_URL;
  if (!url || typeof url !== "string" || !url.trim()) return null;

  const urlTrimmed = url.trim();
  const maxAttempts = Math.max(
    1,
    Number.parseInt(process.env.PDF_PROCESSING_EXTRACT_RETRIES || "", 10) || 5
  );
  const retryDelayMs = Math.max(
    0,
    Number.parseInt(
      process.env.PDF_PROCESSING_EXTRACT_RETRY_DELAY_MS || "",
      10
    ) || 3000
  );

  let last = {
    ok: false,
    success: false,
    pageContent: "",
    title: path.basename(filename || fullFilePath) || "document.pdf",
    error: "no attempts",
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await tryExtractOnce(
      fullFilePath,
      filename,
      urlTrimmed
    );
    if (result == null) return null;

    last = result;
    const text = String(result.pageContent || "").trim();
    if (result.success && text.length > 0) {
      if (attempt > 1) {
        console.log(
          `[pdfProcessingRemote] succeeded on attempt ${attempt}/${maxAttempts}`
        );
      }
      return result;
    }

    if (attempt < maxAttempts) {
      console.warn(
        `[pdfProcessingRemote] attempt ${attempt}/${maxAttempts} failed (${result.error || "empty text"}), retry in ${retryDelayMs}ms`
      );
      await sleep(retryDelayMs);
    }
  }

  return last;
}

module.exports = { extractPdfViaPdfProcessing };
