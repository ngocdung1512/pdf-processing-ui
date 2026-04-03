import { useState } from "react";
import { FileArrowDown } from "@phosphor-icons/react";
import { saveAs } from "file-saver";
import { API_BASE } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";
import { parseFindReplaceFromPrompt } from "@/utils/parseFindReplaceFromPrompt";
import showToast from "@/utils/toast";

/**
 * Uses the first attached .docx + the current prompt text to run find/replace
 * (e.g. "thay Hoàng Ngọc Dũng thành Vũ Xuân Trường") and download the updated file.
 * Does not send a chat message.
 *
 * @param {{ attachments: import("../../DnDWrapper").Attachment[], promptText: string }} props
 */
export default function DocxReplaceFromChatButton({ attachments = [], promptText = "" }) {
  const [loading, setLoading] = useState(false);

  const docxAttachment = attachments.find((a) => {
    const name = a?.file?.name?.toLowerCase() || "";
    return name.endsWith(".docx");
  });

  const canShow = !!docxAttachment?.file;

  if (!canShow) return null;

  async function handleDownloadUpdatedDocx(e) {
    e.preventDefault();
    e.stopPropagation();

    const parsed = parseFindReplaceFromPrompt(promptText);
    if (!parsed) {
      showToast(
        'Nhập lệnh trong ô chat, ví dụ: thay Hoàng Ngọc Dũng thành Vũ Xuân Trường (hoặc đổi … thành … / replace … with …)',
        "warning"
      );
      return;
    }

    setLoading(true);
    try {
      const fd = new FormData();
      fd.append("file", docxAttachment.file, docxAttachment.file.name);
      fd.append("find", parsed.find);
      fd.append("replace", parsed.replace);
      fd.append("matchCase", "false");
      fd.append("wholeWord", "false");

      const res = await fetch(`${API_BASE}/utils/docx-find-replace`, {
        method: "POST",
        body: fd,
        headers: baseHeaders(),
      });

      const ct = res.headers.get("content-type") || "";
      if (!res.ok) {
        if (ct.includes("application/json")) {
          const j = await res.json();
          throw new Error(j.error || "Request failed");
        }
        throw new Error((await res.text()) || "Request failed");
      }

      const blob = await res.blob();
      const count = res.headers.get("X-Replace-Count");
      const outName = docxAttachment.file.name.replace(/\.docx$/i, "_replaced.docx");
      saveAs(blob, outName);
      showToast(
        count != null ? `Đã thay ${count} lần — đã tải ${outName}` : `Đã tải ${outName}`,
        "success"
      );
    } catch (err) {
      console.error("[DocxReplaceFromChatButton]", err);
      showToast(err.message || "Không thể xử lý file", "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleDownloadUpdatedDocx}
      disabled={loading}
      title="Tải .docx đã sửa theo lệnh trong ô chat (vd: thay A thành B) — không gửi tin"
      className="flex items-center gap-x-0.5 max-w-[140px] px-1 py-0.5 rounded-md hover:bg-white/10 light:hover:bg-slate-100 text-[10px] font-medium text-theme-text-secondary hover:text-theme-text-primary disabled:opacity-50"
    >
      <FileArrowDown size={14} weight="bold" className="shrink-0" />
      <span className="truncate">{loading ? "…" : "Tải .docx đã sửa"}</span>
    </button>
  );
}
