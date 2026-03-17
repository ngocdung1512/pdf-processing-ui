import { useRef, useEffect, useState } from "react";
import { X, Check, ArrowDown, PushPin } from "@phosphor-icons/react";

/**
 * Template structure editor.
 *
 * Only one mode: "noidung" — user marks the last header line and (optionally)
 * the first signature/footer line.  AI fills everything in between freely
 * (no JSON, no field tags required).
 *
 * Props:
 *   paragraphs           : { text: string }[]
 *   initialHeaderEndIdx  : number  (-1 = none)
 *   initialFooterStartIdx: number  (-1 = use paragraphs.length as default)
 *   onConfirm : ({ editorMode:"noidung", headerEndIdx, footerStartIdx }) => void
 *   onCancel  : () => void
 */
export default function NoiDungEditor({
  paragraphs,
  initialHeaderEndIdx,
  initialFooterStartIdx,
  onConfirm,
  onCancel,
}) {
  const listRef = useRef(null);

  const [selectingZone, setSelectingZone] = useState("header");

  const [headerEndIdx, setHeaderEndIdx] = useState(
    initialHeaderEndIdx ?? -1
  );
  const [footerStartIdx, setFooterStartIdx] = useState(
    initialFooterStartIdx != null && initialFooterStartIdx >= 0
      ? initialFooterStartIdx
      : paragraphs.length
  );

  useEffect(() => {
    const idx = initialHeaderEndIdx ?? -1;
    if (idx < 0 || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-para="${idx}"]`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function getZone(idx) {
    if (idx <= headerEndIdx) return "header";
    if (idx >= footerStartIdx) return "footer";
    return "body";
  }

  function handleRowClick(idx) {
    if (selectingZone === "header") {
      setHeaderEndIdx(idx);
      if (footerStartIdx <= idx) setFooterStartIdx(idx + 1);
    } else {
      setFooterStartIdx(idx);
      if (headerEndIdx >= idx) setHeaderEndIdx(idx - 1);
    }
  }

  function handleConfirm() {
    if (headerEndIdx < 0) return;
    onConfirm({ editorMode: "noidung", headerEndIdx, footerStartIdx });
  }

  const canConfirm = headerEndIdx >= 0;

  const headerCount = headerEndIdx + 1;
  const footerCount = Math.max(0, paragraphs.length - footerStartIdx);
  const bodyCount = paragraphs.length - headerCount - footerCount;

  function zoneBtn(zone, label, activeClass) {
    const isActive = selectingZone === zone;
    return (
      <button
        onClick={() => setSelectingZone(zone)}
        className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
          isActive
            ? activeClass
            : "text-theme-text-secondary hover:text-theme-text-primary hover:bg-theme-sidebar-subitem-hover"
        }`}
      >
        {label}
      </button>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div className="bg-theme-bg-secondary border border-theme-sidebar-border rounded-xl w-[640px] max-h-[88vh] flex flex-col shadow-2xl">

        {/* ── Title bar ────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-theme-sidebar-border shrink-0">
          <div>
            <h2 className="text-theme-text-primary font-semibold text-sm leading-tight">
              Chọn vị trí chèn nội dung
            </h2>
            <p className="text-theme-text-secondary text-[11px] mt-0.5">
              Đánh dấu cuối tiêu đề và đầu chữ ký — AI điền phần thân ở giữa tự do
            </p>
          </div>
          <button
            onClick={onCancel}
            className="text-theme-text-secondary hover:text-theme-text-primary transition-colors p-1 rounded"
          >
            <X size={16} />
          </button>
        </div>

        {/* ── Zone controls ────────────────────────────────────────────── */}
        <div className="px-4 py-2.5 border-b border-theme-sidebar-border flex items-center gap-3 shrink-0 flex-wrap">
          <div className="flex items-center gap-0.5 bg-theme-sidebar-subitem-hover rounded-lg p-0.5 ml-auto">
            {zoneBtn("header", "📌 Cuối tiêu đề", "bg-indigo-500/20 text-indigo-700 light:text-indigo-800")}
            {zoneBtn("footer", "✍️ Đầu chữ ký",  "bg-green-500/20 text-green-700 light:text-green-800")}
          </div>
        </div>

        {/* ── Paragraph list ───────────────────────────────────────────── */}
        <div
          ref={listRef}
          className="flex-1 overflow-y-auto px-3 py-2 flex flex-col gap-0.5"
        >
          {paragraphs.length === 0 && (
            <p className="text-theme-text-secondary text-xs text-center py-8">
              Không trích xuất được đoạn văn nào từ tài liệu.
            </p>
          )}

          {paragraphs.map((p, idx) => {
            const zone = getZone(idx);
            const isHeaderBoundary = idx === headerEndIdx;
            const isFooterBoundary = idx === footerStartIdx;

            const showNoiDungMarker = headerEndIdx >= 0 && idx === headerEndIdx + 1;
            const showFooterMarker  = footerStartIdx < paragraphs.length && idx === footerStartIdx;

            let rowClass;
            if (zone === "header") {
              rowClass = isHeaderBoundary
                ? "bg-indigo-500/20 border border-indigo-400/50 text-indigo-900 light:text-indigo-900 dark:text-indigo-100"
                : "bg-indigo-500/5 border border-transparent hover:bg-indigo-500/12 text-theme-text-primary";
            } else if (zone === "footer") {
              rowClass = isFooterBoundary
                ? "bg-green-500/15 border border-green-400/40 text-green-900 light:text-green-900 dark:text-green-100"
                : "bg-green-500/5 border border-transparent hover:bg-green-500/10 text-theme-text-secondary";
            } else {
              rowClass = "bg-theme-sidebar-subitem-hover/50 border border-transparent text-theme-text-secondary";
            }

            const numClass =
              zone === "header" ? "text-indigo-500/70" :
              zone === "footer" ? "text-green-500/70" :
              "text-theme-text-secondary opacity-50";

            return (
              <div key={idx}>
                {/* AI content / body start marker */}
                {showNoiDungMarker && (
                  <div className="flex items-center gap-2 px-2 py-1.5 my-0.5">
                    <div className="flex-1 border-t-2 border-dashed border-purple-400/50" />
                    <div className="flex items-center gap-1 shrink-0 bg-purple-500/10 border border-purple-400/30 rounded-full px-2.5 py-0.5">
                      <ArrowDown size={10} className="text-purple-600 light:text-purple-700" weight="bold" />
                      <span className="text-purple-700 light:text-purple-800 text-[10px] font-medium">
                        AI điền nội dung tại đây
                      </span>
                    </div>
                    <div className="flex-1 border-t-2 border-dashed border-purple-400/50" />
                  </div>
                )}

                {/* Signature / footer start marker */}
                {showFooterMarker && (
                  <div className="flex items-center gap-2 px-2 py-1.5 my-0.5">
                    <div className="flex-1 border-t-2 border-dashed border-green-400/50" />
                    <div className="flex items-center gap-1 shrink-0 bg-green-500/10 border border-green-400/30 rounded-full px-2.5 py-0.5">
                      <PushPin size={10} className="text-green-600 light:text-green-700" weight="fill" />
                      <span className="text-green-700 light:text-green-800 text-[10px] font-medium">
                        Chữ ký / kết thúc — giữ nguyên
                      </span>
                    </div>
                    <div className="flex-1 border-t-2 border-dashed border-green-400/50" />
                  </div>
                )}

                {/* Paragraph row */}
                <button
                  data-para={idx}
                  type="button"
                  onClick={() => handleRowClick(idx)}
                  className={`w-full text-left px-3 py-1.5 rounded-lg text-sm transition-all duration-150 flex items-start gap-2 ${rowClass}`}
                >
                  <span className={`shrink-0 text-[10px] font-mono mt-0.5 w-5 text-right leading-tight ${numClass}`}>
                    {idx + 1}
                  </span>
                  <span className="flex-1 leading-snug break-words min-w-0">
                    {p.text || (
                      <span className="italic text-theme-text-secondary opacity-50 text-xs">
                        (trống)
                      </span>
                    )}
                  </span>
                  {isHeaderBoundary && (
                    <span className="shrink-0 text-[10px] text-indigo-600 light:text-indigo-700 font-semibold mt-0.5">
                      ← cuối tiêu đề
                    </span>
                  )}
                  {zone === "footer" && isFooterBoundary && (
                    <span className="shrink-0 text-[10px] text-green-600 light:text-green-700 font-semibold mt-0.5">
                      ← đầu chữ ký
                    </span>
                  )}
                </button>
              </div>
            );
          })}
        </div>

        {/* ── Footer bar ───────────────────────────────────────────────── */}
        <div className="px-4 pb-4 pt-3 border-t border-theme-sidebar-border flex items-center justify-between gap-3 shrink-0">
          <div className="text-theme-text-secondary text-[11px] min-w-0 flex flex-col gap-0.5">
            <span>
              Tiêu đề:{" "}
              <span className="text-indigo-600 light:text-indigo-700">{Math.max(0, headerCount)} dòng</span>
              {footerCount > 0 && (
                <>
                  {" "}· Chữ ký:{" "}
                  <span className="text-green-600 light:text-green-700">{footerCount} dòng</span>
                </>
              )}
              {bodyCount > 0 && (
                <>
                  {" "}· Thân (xóa):{" "}
                  <span className="text-theme-text-secondary">{bodyCount} dòng</span>
                </>
              )}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onCancel}
              className="px-3 py-1.5 rounded-lg text-theme-text-secondary hover:text-theme-text-primary text-xs transition-colors"
            >
              Hủy
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={!canConfirm}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-purple-600/25 hover:bg-purple-600/40 text-purple-700 light:text-purple-800"
            >
              <Check size={12} weight="bold" />
              Xác nhận
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
