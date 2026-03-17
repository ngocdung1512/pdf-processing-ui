import { useState, useEffect, useRef } from "react";
import {
  X,
  Upload,
  Trash,
  FileDoc,
  FolderOpen,
  Eye,
  Robot,
  ListChecks,
  Play,
  CheckCircle,
} from "@phosphor-icons/react";
import ReportFormat from "@/models/reportFormat";
import TemplatePreviewPanel from "../TemplatePreviewPanel";

export default function ReportFormatLibrary({ onClose, onSelect }) {
  const [formats, setFormats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [selectingId, setSelectingId] = useState(null);
  const [previewFormat, setPreviewFormat] = useState(null);

  const dataCache = useRef({});
  const fileInputRef = useRef(null);

  useEffect(() => { loadFormats(); }, []);

  async function loadFormats() {
    setLoading(true);
    const list = await ReportFormat.list();
    setFormats(list);
    setLoading(false);
  }

  async function handleUpload(e) {
    const file = e.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (!file) return;
    setUploading(true);
    setError(null);
    const result = await ReportFormat.upload(file);
    if (result.success) {
      await loadFormats();
    } else {
      setError(result.error || "Upload thất bại");
    }
    setUploading(false);
  }

  async function handleDelete(id) {
    if (!window.confirm("Xóa mẫu báo cáo này?")) return;
    setError(null);
    const result = await ReportFormat.delete(id);
    if (result.success) {
      setFormats((prev) => prev.filter((f) => f.id !== id));
      delete dataCache.current[id];
    } else {
      setError(result.error || "Xóa thất bại");
    }
  }

  async function fetchData(id) {
    if (dataCache.current[id]) return dataCache.current[id];
    const data = await ReportFormat.getData(id);
    if (data) dataCache.current[id] = data;
    return data;
  }

  /**
   * @param {string} id
   * @param {"noidung"|"fields"|"use"} preMode
   */
  async function handleSelect(id, preMode) {
    setSelectingId(id);
    setError(null);
    const data = await fetchData(id);
    if (!data || !data.base64) {
      setError("Không thể tải mẫu. Vui lòng thử lại.");
      setSelectingId(null);
      return;
    }
    onSelect({ id: data.id, name: data.name, content: data.content, base64: data.base64, preMode });
    onClose();
  }

  return (
    <>
      {previewFormat && (
        <TemplatePreviewPanel
          formatId={previewFormat.id}
          name={previewFormat.name}
          onClose={() => setPreviewFormat(null)}
        />
      )}

      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
        onClick={(e) => e.target === e.currentTarget && onClose()}
      >
        <div className="bg-theme-bg-secondary border border-theme-sidebar-border rounded-xl w-[600px] max-h-[80vh] flex flex-col shadow-2xl">

          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-theme-sidebar-border shrink-0">
            <div className="flex items-center gap-2">
              <FolderOpen size={18} className="text-indigo-500" />
              <div>
                <h2 className="text-theme-text-primary font-semibold text-sm leading-tight">
                  Thư viện mẫu báo cáo
                </h2>
                <p className="text-theme-text-secondary text-[11px] mt-0.5">
                  Chọn mẫu có sẵn hoặc tải lên mẫu mới (.docx)
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-theme-text-secondary hover:text-theme-text-primary transition-colors p-1 rounded"
            >
              <X size={16} />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-2">
            {loading ? (
              <p className="text-theme-text-secondary text-sm text-center py-10">Đang tải…</p>
            ) : formats.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-12">
                <FileDoc size={36} className="text-theme-text-secondary opacity-30" weight="fill" />
                <p className="text-theme-text-secondary text-sm">Chưa có mẫu nào. Tải lên mẫu đầu tiên.</p>
              </div>
            ) : (
              formats.map((f) => {
                const isSelecting = selectingId === f.id;
                const isProcessed = !!f.processed;

                return (
                  <div
                    key={f.id}
                    className="border border-theme-sidebar-border rounded-lg bg-theme-bg-secondary hover:bg-theme-sidebar-subitem-hover transition-colors"
                  >
                    <div className="flex items-center gap-2 px-3 py-2.5">
                      <FileDoc size={16} className="text-indigo-500 shrink-0" weight="fill" />

                      {/* Name + date + processed badge */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <p className="text-theme-text-primary text-sm font-medium truncate leading-tight">
                            {f.name}
                          </p>
                          {isProcessed && (
                            <span
                              title="Mẫu đã được xử lý — có thể dùng trực tiếp"
                              className="shrink-0 flex items-center gap-0.5 text-[10px] font-medium text-green-600 light:text-green-700 bg-green-500/10 border border-green-500/30 rounded-full px-1.5 py-0.5"
                            >
                              <CheckCircle size={9} weight="fill" />
                              Đã xử lý
                            </span>
                          )}
                        </div>
                        <p className="text-theme-text-secondary text-[10px]">
                          {new Date(f.uploadedAt).toLocaleDateString("vi-VN")}
                        </p>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1 shrink-0">
                        {/* Preview */}
                        <button
                          onClick={() => setPreviewFormat({ id: f.id, name: f.name })}
                          title="Xem trước tài liệu"
                          className="p-1.5 rounded text-theme-text-secondary hover:text-blue-500 hover:bg-blue-500/10 transition-colors"
                        >
                          <Eye size={13} />
                        </button>

                        {/* Delete */}
                        <button
                          onClick={() => handleDelete(f.id)}
                          title="Xóa mẫu này"
                          className="p-1.5 rounded text-theme-text-secondary hover:text-red-500 hover:bg-red-500/10 transition-colors"
                        >
                          <Trash size={13} />
                        </button>

                        {/* Sử dụng — direct use (already-processed templates skip editor) */}
                        <button
                          onClick={() => handleSelect(f.id, "use")}
                          disabled={isSelecting}
                          title={
                            isProcessed
                              ? "Dùng mẫu đã xử lý — không cần chọn lại vị trí"
                              : "Dùng mẫu theo kiểu tham chiếu cấu trúc"
                          }
                          className="flex items-center gap-1 px-2 py-1 rounded-md bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-600 light:text-emerald-700 text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-wait"
                        >
                          {isSelecting ? (
                            <span className="animate-spin inline-block">⟳</span>
                          ) : (
                            <Play size={11} weight="fill" />
                          )}
                          Sử dụng
                        </button>

                        {/* AI điền */}
                        <button
                          onClick={() => handleSelect(f.id, "noidung")}
                          disabled={isSelecting}
                          title={
                            isProcessed
                              ? "Chạy lại AI để phát hiện vị trí mới (ghi đè)"
                              : "AI tự phát hiện và điền phần thân báo cáo"
                          }
                          className="flex items-center gap-1 px-2 py-1 rounded-md bg-purple-600/20 hover:bg-purple-600/40 text-purple-600 light:text-purple-700 text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-wait"
                        >
                          {isSelecting ? (
                            <span className="animate-spin inline-block">⟳</span>
                          ) : (
                            <Robot size={12} weight="bold" />
                          )}
                          AI điền
                        </button>

                        {/* Chọn vị trí */}
                        <button
                          onClick={() => handleSelect(f.id, "fields")}
                          disabled={isSelecting}
                          title={
                            isProcessed
                              ? "Chọn lại vị trí thủ công (ghi đè kết quả cũ)"
                              : "Chọn thủ công vị trí cần thay thế trong mẫu"
                          }
                          className="flex items-center gap-1 px-2 py-1 rounded-md bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-600 light:text-indigo-700 text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-wait"
                        >
                          <ListChecks size={12} weight="bold" />
                          Chọn vị trí
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer */}
          <div className="px-4 pb-4 pt-3 border-t border-theme-sidebar-border flex items-center justify-between gap-3 shrink-0">
            <div className="flex-1 min-w-0">
              {error && <p className="text-red-500 text-xs truncate">{error}</p>}
              {!error && (
                <p className="text-theme-text-secondary opacity-60 text-[10px]">
                  <span className="inline-flex items-center gap-0.5 text-green-600 light:text-green-700 font-medium">
                    <CheckCircle size={9} weight="fill" /> Đã xử lý
                  </span>
                  {" "}= có thể dùng "Sử dụng" trực tiếp
                </p>
              )}
            </div>
            <div>
              <input ref={fileInputRef} type="file" accept=".docx" className="hidden" onChange={handleUpload} />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="flex items-center gap-x-1.5 px-3 py-1.5 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-600 light:text-indigo-700 text-xs font-medium transition-colors disabled:opacity-50"
              >
                {uploading ? (
                  <span className="animate-spin inline-block text-sm">⟳</span>
                ) : (
                  <Upload size={13} />
                )}
                {uploading ? "Đang tải…" : "Tải lên mẫu mới"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
