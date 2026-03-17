import { useState, useEffect, useRef } from "react";
import { X, ArrowsOut, ArrowsIn } from "@phosphor-icons/react";
import { API_BASE } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";

/**
 * Full-document preview panel for a stored report format template.
 * Fetches /utils/report-formats/:id/preview-html and renders it in a
 * sandboxed <iframe> so template styles don't bleed into the app.
 *
 * Props:
 *   formatId   : string   — ID of the stored format
 *   name       : string   — display name for the title bar
 *   onClose    : () => void
 */
export default function TemplatePreviewPanel({ formatId, name, onClose }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const iframeRef = useRef(null);

  // Build the preview URL — the iframe fetches directly so auth header must be
  // passed via a Blob URL (fetch + createObjectURL).
  useEffect(() => {
    let objectUrl = null;

    async function loadPreview() {
      try {
        const res = await fetch(
          `${API_BASE}/utils/report-formats/${formatId}/preview-html`,
          { headers: baseHeaders() }
        );
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
        const html = await res.text();

        const blob = new Blob([html], { type: "text/html" });
        objectUrl = URL.createObjectURL(blob);

        if (iframeRef.current) iframeRef.current.src = objectUrl;
      } catch (e) {
        setError(e.message || "Could not load preview");
      } finally {
        setLoading(false);
      }
    }

    loadPreview();

    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [formatId]);

  const panelCls = expanded
    ? "fixed inset-4 z-[70]"
    : "fixed inset-0 z-[70] flex items-center justify-center";

  const cardCls = expanded
    ? "w-full h-full"
    : "w-[820px] h-[85vh]";

  return (
    <div
      className={panelCls}
      onClick={(e) => !expanded && e.target === e.currentTarget && onClose()}
    >
      {/* Backdrop when not expanded */}
      {!expanded && (
        <div
          className="absolute inset-0 bg-black/70 backdrop-blur-sm"
          onClick={onClose}
        />
      )}

      <div
        className={`relative flex flex-col bg-white rounded-xl shadow-2xl overflow-hidden ${cardCls}`}
      >
        {/* ── Title bar ──────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-4 py-3 bg-gray-100 border-b border-gray-200 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-gray-500 text-xs font-medium uppercase tracking-wide shrink-0">
              Xem trước mẫu
            </span>
            <span className="text-gray-800 font-semibold text-sm truncate">
              {name}
            </span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => setExpanded((v) => !v)}
              title={expanded ? "Thu nhỏ" : "Phóng to"}
              className="p-1.5 rounded text-gray-500 hover:bg-gray-200 transition-colors"
            >
              {expanded ? <ArrowsIn size={15} /> : <ArrowsOut size={15} />}
            </button>
            <button
              onClick={onClose}
              title="Đóng"
              className="p-1.5 rounded text-gray-500 hover:bg-gray-200 transition-colors"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* ── Content area ───────────────────────────────────────────────── */}
        <div className="flex-1 relative overflow-hidden bg-gray-50">
          {/* Loading overlay */}
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-50">
              <div className="flex flex-col items-center gap-3">
                <span className="animate-spin text-2xl text-gray-400">⟳</span>
                <p className="text-gray-500 text-sm">Đang tải xem trước…</p>
              </div>
            </div>
          )}

          {/* Error state */}
          {error && !loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-50">
              <div className="text-center max-w-sm">
                <p className="text-red-500 font-semibold text-sm mb-1">
                  Không thể tải xem trước
                </p>
                <p className="text-gray-400 text-xs">{error}</p>
              </div>
            </div>
          )}

          {/* iframe — sandboxed to prevent script execution */}
          <iframe
            ref={iframeRef}
            title={`Preview: ${name}`}
            sandbox="allow-same-origin"
            className="w-full h-full border-0"
            style={{ display: loading || error ? "none" : "block" }}
            onLoad={() => setLoading(false)}
            onError={() => {
              setError("Failed to render document");
              setLoading(false);
            }}
          />
        </div>

        {/* ── Footer hint ─────────────────────────────────────────────────── */}
        {!loading && !error && (
          <div className="px-4 py-2 bg-gray-100 border-t border-gray-200 shrink-0">
            <p className="text-gray-400 text-[10px] text-center">
              Xem trước cơ bản — bố cục và phông chữ có thể khác so với file gốc
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
