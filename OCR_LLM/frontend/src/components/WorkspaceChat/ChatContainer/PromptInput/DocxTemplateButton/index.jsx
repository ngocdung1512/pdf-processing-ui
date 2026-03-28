import { useRef, useState, useEffect } from "react";
import { FileDoc, FolderOpen, X } from "@phosphor-icons/react";
import { baseHeaders } from "@/utils/request";
import { API_BASE } from "@/utils/constants";
import ReportFormat from "@/models/reportFormat";
import ReportFormatLibrary from "../ReportFormatLibrary";
import NoiDungEditor from "../NoiDungEditor";
import {
  clearDocxTemplateLocalStorage,
  DOCX_TEMPLATE_STORAGE_CLEARED_EVENT,
} from "@/utils/docxTemplateStorage";

const DOCX_MIME =
  "data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,";

// ─── Client-side docx XML helpers (PizZip — already in frontend bundle) ───────

/**
 * Extract all paragraphs from a docx (raw base64), stripping any existing
 * {noi_dung} and {ket_thuc} marker paragraphs.  Also records where those
 * markers were so the editor can pre-select the boundaries.
 *
 * Returns:
 *   cleanBase64          : raw base64 of the docx with both markers removed
 *   paragraphs           : [{ text: string }]
 *   initialHeaderEndIdx  : last header paragraph index (before {noi_dung}), or -1
 *   initialFooterStartIdx: first footer paragraph index (where {ket_thuc} was), or -1
 */
async function prepareForEditor(rawBase64) {
  try {
    const { default: PizZip } = await import("pizzip");
    const zip = new PizZip(rawBase64, { base64: true });
    const entry = zip.file("word/document.xml");
    if (!entry) return null;

    const xml = entry.asText();
    const paragraphs = [];
    let initialHeaderEndIdx = -1;
    let initialFooterStartIdx = -1;

    // Rebuild docXml without the marker paragraphs
    const parts = [];
    let lastEnd = 0;
    const paraRe = /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g;
    let m;

    while ((m = paraRe.exec(xml)) !== null) {
      const tRe = /<w:t(?:[^>]*)?>([^<]*)<\/w:t>/g;
      const texts = [];
      let t;
      while ((t = tRe.exec(m[0])) !== null) texts.push(t[1]);
      const text = texts.join("").trim();

      if (text === "{noi_dung}") {
        initialHeaderEndIdx = paragraphs.length - 1;
        parts.push(xml.slice(lastEnd, m.index));
        lastEnd = m.index + m[0].length;
      } else if (text === "{ket_thuc}") {
        // Footer starts at the paragraph that follows (current length = next index)
        initialFooterStartIdx = paragraphs.length;
        parts.push(xml.slice(lastEnd, m.index));
        lastEnd = m.index + m[0].length;
      } else {
        paragraphs.push({ text });
      }
    }
    parts.push(xml.slice(lastEnd));

    zip.file("word/document.xml", parts.join(""));
    const cleanBase64 = zip.generate({ type: "base64", compression: "DEFLATE" });

    return { cleanBase64, paragraphs, initialHeaderEndIdx, initialFooterStartIdx };
  } catch (err) {
    console.error("[prepareForEditor]", err);
    return null;
  }
}

/**
 * Inject {noi_dung} and optionally {ket_thuc} markers into a *clean* docx.
 *
 *   {noi_dung}  → inserted after paragraph at headerEndIdx
 *   {ket_thuc}  → inserted after paragraph at (footerStartIdx - 1),
 *                 i.e. just before the first footer paragraph.
 *                 Skipped when footerStartIdx >= total paragraph count.
 *
 * Processing is done back-to-front to preserve XML offsets.
 * Returns the new raw base64, or null on error.
 */
async function injectAtBoundary(cleanBase64, headerEndIdx, footerStartIdx) {
  try {
    const { default: PizZip } = await import("pizzip");
    const zip = new PizZip(cleanBase64, { base64: true });
    const entry = zip.file("word/document.xml");
    if (!entry) return null;

    let docXml = entry.asText();
    const noiDungPara = `<w:p><w:r><w:t xml:space="preserve">{noi_dung}</w:t></w:r></w:p>`;
    const ketThucPara = `<w:p><w:r><w:t xml:space="preserve">{ket_thuc}</w:t></w:r></w:p>`;

    // Collect all paragraph end-positions in one pass
    const paraRe = /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g;
    const ends = []; // ends[i] = position right after paragraph i
    let m;
    while ((m = paraRe.exec(docXml)) !== null) {
      ends.push(m.index + m[0].length);
    }

    const total = ends.length;

    // Build a sorted list of insertions (back-to-front = descending position)
    const insertions = [];

    // {ket_thuc}: after paragraph footerStartIdx-1, if footer is set
    if (footerStartIdx > 0 && footerStartIdx < total) {
      insertions.push({ pos: ends[footerStartIdx - 1], text: ketThucPara });
    }

    // {noi_dung}: after paragraph headerEndIdx
    if (headerEndIdx >= 0 && headerEndIdx < total) {
      insertions.push({ pos: ends[headerEndIdx], text: noiDungPara });
    }

    // Sort descending so earlier insertions don't shift later positions
    insertions.sort((a, b) => b.pos - a.pos);

    for (const { pos, text } of insertions) {
      docXml = docXml.slice(0, pos) + text + docXml.slice(pos);
    }

    zip.file("word/document.xml", docXml);
    return zip.generate({ type: "base64", compression: "DEFLATE" });
  } catch (err) {
    console.error("[injectAtBoundary]", err);
    return null;
  }
}

// ─── Server call helpers ──────────────────────────────────────────────────────

/**
 * Ask the server to auto-detect the header/body boundary and inject {noi_dung}.
 * Returns the injected raw base64, null on failure, or "ABORTED" if cancelled.
 */
async function serverAutoInject(rawBase64, content, signal) {
  try {
    const res = await fetch(`${API_BASE}/utils/auto-inject-noi-dung`, {
      method: "POST",
      headers: { ...baseHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ templateBase64: rawBase64, content }),
      signal,
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (!json.success) return null;
    if (json.alreadyHasMarker) return rawBase64;
    return json.injectedBase64 ?? null;
  } catch (e) {
    if (e.name === "AbortError") return "ABORTED";
    return null;
  }
}

// ─── Prompt builders ──────────────────────────────────────────────────────────

function buildNoiDungPrompt(content) {
  const lines = content.split("\n");
  const startIdx = lines.findIndex((l) => l.trim() === "{noi_dung}");
  const endIdx = lines.findIndex((l) => l.trim() === "{ket_thuc}");

  const header =
    startIdx >= 0 ? lines.slice(0, startIdx).join("\n").trim() : content.trim();
  const footer =
    endIdx >= 0 ? lines.slice(endIdx + 1).join("\n").trim() : "";

  return (
    `Đây là mẫu báo cáo. Phần đầu và phần cuối được GIỮ NGUYÊN từ mẫu — chỉ viết phần thân ở giữa.\n\n` +
    `=== PHẦN ĐẦU CỐ ĐỊNH (quốc hiệu, tên cơ quan, tiêu đề) ===\n${header}\n=== KẾT THÚC PHẦN ĐẦU ===\n\n` +
    (footer ? `=== PHẦN CUỐI CỐ ĐỊNH (chữ ký, ngày tháng) ===\n${footer}\n=== KẾT THÚC PHẦN CUỐI ===\n\n` : "") +
    `Khi tôi cung cấp dữ liệu, hãy:\n` +
    `1. Chỉ viết NỘI DUNG THÂN báo cáo (các mục I., II., III., ... và nội dung chi tiết)\n` +
    `2. KHÔNG lặp lại quốc hiệu, tiêu ngữ, tên đơn vị, tiêu đề hay chữ ký — những phần đó đã có sẵn trong mẫu\n` +
    `3. Được dùng bảng biểu, gạch đầu dòng, định dạng tự do — AI không cần trả về JSON`
  );
}

function buildStylePrompt(content) {
  return (
    `Đây là mẫu báo cáo của tôi. Khi tôi yêu cầu tạo báo cáo, hãy:\n` +
    `1. Giữ đúng cấu trúc: tiêu đề và thứ tự các mục (I., II., III., ...)\n` +
    `2. Giữ nguyên cấu trúc bảng với đúng số cột và tên cột\n` +
    `3. Điền thông tin thực tế vào đúng vị trí tương ứng\n` +
    `4. Giữ phần thông tin đơn vị, xác thực, ký tên ở cuối\n\n` +
    `=== MẪU BÁO CÁO ===\n${content}\n=== KẾT THÚC MẪU ===`
  );
}

function storeTemplatePrompt(messageContent) {
  localStorage.setItem("DOCX_TEMPLATE_PROMPT", messageContent);
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function DocxTemplateButton() {
  const inputRef = useRef(null); // kept for potential programmatic use

  // Active template badge state
  const [templateName, setTemplateName] = useState(null);
  const [mode, setMode] = useState("style"); // "noidung"|"style"

  // Loading indicator
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("Loading…");
  const [error, setError] = useState(null);

  // Modals
  const [showLibrary, setShowLibrary] = useState(false);

  // Editor state
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorParagraphs, setEditorParagraphs] = useState([]);
  const [editorInitialHeader, setEditorInitialHeader] = useState(-1);
  const [editorInitialFooter, setEditorInitialFooter] = useState(-1);

  // Pending data used when the editor confirms
  const pendingRef = useRef(null);
  // pendingRef.current = { cleanBase64, content, name, styles }

  // Abort controller for the AI auto-detect fetch — null when not in-flight
  const cancelRef = useRef(null);

  // ── Internal: directly finalize noidung mode (no editor shown) ────────────

  async function finalizeNoiDung(cleanBase64, content, name, styles, libraryId, headerEndIdx, footerStartIdx) {
    setLoadingMsg("Đang lưu vị trí chèn…");
    const finalBase64 = await injectAtBoundary(cleanBase64, headerEndIdx, footerStartIdx);
    if (!finalBase64) { setError("Không thể chèn {noi_dung}"); setLoading(false); return; }
    localStorage.setItem("DOCX_TEMPLATE_BINARY", DOCX_MIME + finalBase64);
    localStorage.setItem("DOCX_TEMPLATE_MODE", "noidung");
    localStorage.removeItem("DOCX_TEMPLATE_TAGS");
    if (styles) localStorage.setItem("DOCX_TEMPLATE_STYLES", JSON.stringify(styles));
    else localStorage.removeItem("DOCX_TEMPLATE_STYLES");
    setTemplateName(name);
    setMode("noidung");
    storeTemplatePrompt(buildNoiDungPrompt(content));
    if (libraryId) ReportFormat.updateFile(libraryId, finalBase64).catch(() => {});
    setLoading(false);
  }

  // ── Internal: open editor for manual boundary selection ────────────────────
  //   • If boundary already detected (from existing markers or AI) → auto-confirm, no editor.
  //   • If AI fails to detect → show editor so user can pick manually.

  async function openEditor(rawBase64, content, name, styles, libraryId = null, autoDetect = true) {
    setLoadingMsg("Chuẩn bị…");

    // 1. Strip existing markers and collect paragraphs + initial boundaries
    const prepared = await prepareForEditor(rawBase64);
    if (!prepared || prepared.paragraphs.length === 0) {
      finalizeStyle(rawBase64, content, name, styles);
      return;
    }

    let { cleanBase64, paragraphs, initialHeaderEndIdx, initialFooterStartIdx } = prepared;

    if (autoDetect) {
      // Always re-run AI on the clean (marker-stripped) base64 so the server
      // doesn't see existing markers and skip re-detection.
      setLoadingMsg("AI đang phát hiện vị trí chèn…");
      const controller = new AbortController();
      cancelRef.current = () => controller.abort();

      const injected = await serverAutoInject(cleanBase64, content, controller.signal);
      cancelRef.current = null;

      // User cancelled — discard everything and reset
      if (injected === "ABORTED") {
        pendingRef.current = null;
        setLoading(false);
        return;
      }

      if (injected && injected !== rawBase64) {
        const result = await prepareForEditor(injected);
        if (result && result.initialHeaderEndIdx >= 0) {
          // Boundary found → auto-confirm, no editor
          const footerIdx = result.initialFooterStartIdx >= 0 ? result.initialFooterStartIdx : result.paragraphs.length;
          await finalizeNoiDung(result.cleanBase64, content, name, styles, libraryId, result.initialHeaderEndIdx, footerIdx);
          return;
        }
        // AI returned something but no boundary parsed — use cleaned version
        if (result) { cleanBase64 = result.cleanBase64; paragraphs = result.paragraphs; }
      }
    }

    // Show the editor so user can pick the boundary manually
    pendingRef.current = { cleanBase64, content, name, styles, libraryId };
    setEditorParagraphs(paragraphs);
    setEditorInitialHeader(initialHeaderEndIdx);
    setEditorInitialFooter(initialFooterStartIdx);
    setEditorOpen(true);
    setLoading(false);
  }

  // ── Internal: finalize after editor confirms ───────────────────────────────

  async function handleEditorConfirm({ headerEndIdx, footerStartIdx }) {
    const { cleanBase64, content, name, styles, libraryId } = pendingRef.current;
    setEditorOpen(false);
    setLoading(true);
    pendingRef.current = null;

    try {
      await finalizeNoiDung(cleanBase64, content, name, styles, libraryId, headerEndIdx, footerStartIdx);
    } catch (err) {
      console.error("[handleEditorConfirm]", err);
      setError("Lỗi khi xử lý mẫu");
      setLoading(false);
    }
  }

  function handleEditorCancel() {
    setEditorOpen(false);
    pendingRef.current = null;
    setLoading(false);
  }

  // ── Internal: use template in style-reference mode (no markers yet) ────────

  function finalizeStyle(rawBase64, content, name, styles) {
    localStorage.setItem("DOCX_TEMPLATE_BINARY", DOCX_MIME + rawBase64);
    localStorage.setItem("DOCX_TEMPLATE_MODE", "style");
    localStorage.removeItem("DOCX_TEMPLATE_TAGS");
    if (styles) localStorage.setItem("DOCX_TEMPLATE_STYLES", JSON.stringify(styles));
    else localStorage.removeItem("DOCX_TEMPLATE_STYLES");
    setTemplateName(name);
    setMode("style");
    storeTemplatePrompt(buildStylePrompt(content));
    setLoading(false);
  }

  // ── Library selection flow ────────────────────────────────────────────────

  async function handleLibrarySelect({ id, name, content, base64, preMode = "noidung" }) {
    setShowLibrary(false);
    if (!base64 || !content) { setError("Không thể tải mẫu"); return; }

    setLoading(true);
    setLoadingMsg("Đang tải mẫu…");
    setError(null);

    try {
      // "Sử dụng" — use template as-is:
      //   1. Has {noi_dung} marker → noidung mode directly
      //   2. Otherwise → style-reference mode
      if (preMode === "use") {
        setLoadingMsg("Kiểm tra mẫu…");
        const prepared = await prepareForEditor(base64);
        if (prepared && prepared.initialHeaderEndIdx >= 0) {
          const footerIdx = prepared.initialFooterStartIdx >= 0
            ? prepared.initialFooterStartIdx
            : prepared.paragraphs.length;
          await finalizeNoiDung(prepared.cleanBase64, content, name, null, id ?? null, prepared.initialHeaderEndIdx, footerIdx);
          return;
        }
        // Not processed yet — trigger AI auto-detect so user doesn't end up with unformatted output
        await openEditor(base64, content, name, null, id ?? null, true);
        return;
      }

      // "AI điền" — auto-detect boundary with LLM, fall back to editor
      // "Chọn vị trí" — skip auto-detect, open editor directly
      const autoDetect = preMode !== "fields";
      await openEditor(base64, content, name, null, id ?? null, autoDetect);
    } catch (err) {
      console.error("[DocxTemplateButton/handleLibrarySelect]", err);
      setError("Lỗi không xác định");
      setLoading(false);
    }
  }

  useEffect(() => {
    function onTemplateStorageCleared() {
      setTemplateName(null);
      setError(null);
      setMode("style");
      setEditorOpen(false);
      pendingRef.current = null;
    }
    window.addEventListener(
      DOCX_TEMPLATE_STORAGE_CLEARED_EVENT,
      onTemplateStorageCleared
    );
    return () =>
      window.removeEventListener(
        DOCX_TEMPLATE_STORAGE_CLEARED_EVENT,
        onTemplateStorageCleared
      );
  }, []);

  // ── Clear ──────────────────────────────────────────────────────────────────

  function clearTemplate() {
    clearDocxTemplateLocalStorage();
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  // Single entry point: the folder button opens the library for all template
  // management (upload, preview, select, delete).
  // While processing a selected template the button shows a spinner.

  const isAiStep = loading && loadingMsg.toLowerCase().includes("ai");

  return (
    <>
      {/* ── Processing toast — visible while loading ───────────────────────── */}
      {loading && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[200] flex items-start gap-3 bg-zinc-900 light:bg-white border border-white/10 light:border-slate-200 rounded-xl px-4 py-3 shadow-2xl min-w-[280px] max-w-sm pointer-events-auto">
          <span className="animate-spin text-purple-400 light:text-purple-600 text-lg shrink-0 mt-0.5">
            ⟳
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-white light:text-slate-800 text-sm font-medium leading-tight">
              {loadingMsg}
            </p>
            {isAiStep && (
              <p className="text-white/40 light:text-slate-500 text-xs mt-1 leading-snug">
                Mẫu sẽ không dùng được cho đến khi xử lý xong.
              </p>
            )}
          </div>
          {isAiStep && (
            <button
              type="button"
              onClick={() => cancelRef.current?.()}
              className="shrink-0 mt-0.5 px-2 py-1 rounded-md text-xs font-medium bg-red-500/20 hover:bg-red-500/40 text-red-400 hover:text-red-300 light:text-red-600 transition-colors"
              title="Hủy phát hiện AI"
            >
              Hủy
            </button>
          )}
        </div>
      )}

      {/* Active template badge — shown when a template is loaded */}
      {templateName && !editorOpen && (
        <div
          className={`flex items-center gap-x-1 px-2 py-0.5 rounded-full text-[11px] max-w-[200px] ${
            mode === "noidung"
              ? "bg-purple-600/20 border border-purple-500/40 text-purple-700 light:text-purple-800"
              : "bg-indigo-600/20 border border-indigo-500/40 text-indigo-700 light:text-indigo-800"
          }`}
          title={
            mode === "noidung"
              ? "Giữ đầu & cuối mẫu — AI điền thân tự do"
              : "Dùng định dạng mẫu"
          }
        >
          <FileDoc size={12} weight="bold" className="shrink-0" />
          <span className="truncate leading-tight">{templateName}</span>
          {mode === "noidung" && (
            <span className="shrink-0 opacity-60 text-[9px] font-bold">
              NDung
            </span>
          )}
          <button
            type="button"
            onClick={clearTemplate}
            className="shrink-0 hover:text-white transition-colors"
            title="Xóa mẫu"
          >
            <X size={10} weight="bold" />
          </button>
        </div>
      )}

      {/* Folder / library button — single entry point for all template management */}
      {!templateName && (
        <button
          type="button"
          disabled={loading}
          onClick={() => !loading && setShowLibrary(true)}
          title={loading ? loadingMsg : "Mẫu báo cáo — mở thư viện"}
          className="flex items-center justify-center w-5 h-5 rounded hover:opacity-80 transition-opacity disabled:opacity-40 text-theme-text-secondary hover:text-theme-text-primary"
        >
          {loading ? (
            <span className="animate-spin text-[10px]">⟳</span>
          ) : (
            <FolderOpen size={16} weight="bold" />
          )}
        </button>
      )}

      {error && (
        <span className="text-red-400 text-[10px] max-w-[120px] truncate">
          {error}
        </span>
      )}

      {/* Library modal */}
      {showLibrary && (
        <ReportFormatLibrary
          onClose={() => setShowLibrary(false)}
          onSelect={handleLibrarySelect}
        />
      )}

      {/* Template structure editor */}
      {editorOpen && (
        <NoiDungEditor
          paragraphs={editorParagraphs}
          initialHeaderEndIdx={editorInitialHeader}
          initialFooterStartIdx={editorInitialFooter}
          onConfirm={handleEditorConfirm}
          onCancel={handleEditorCancel}
        />
      )}
    </>
  );
}
