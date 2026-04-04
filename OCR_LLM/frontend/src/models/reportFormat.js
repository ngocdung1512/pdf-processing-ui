import { API_BASE } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";

const ReportFormat = {
  async list() {
    try {
      const res = await fetch(`${API_BASE}/utils/report-formats`, {
        headers: baseHeaders(),
      });
      if (!res.ok) return [];
      const json = await res.json();
      return json.formats ?? [];
    } catch {
      return [];
    }
  },

  /**
   * Upload a new .docx template to the library.
   * @param {File} file
   * @param {string} [name]  Display name; defaults to filename without extension
   * @returns {{ success: boolean, format?: object, error?: string }}
   */
  async upload(file, name) {
    try {
      const form = new FormData();
      form.append("file", file, file.name);
      if (name) form.append("name", name);
      // Note: do NOT set Content-Type — browser sets multipart boundary automatically
      const res = await fetch(`${API_BASE}/utils/report-formats`, {
        method: "POST",
        headers: baseHeaders(),
        body: form,
      });
      return await res.json().catch(() => ({ success: false, error: "Invalid response" }));
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  async delete(id) {
    try {
      const res = await fetch(`${API_BASE}/utils/report-formats/${id}`, {
        method: "DELETE",
        headers: baseHeaders(),
      });
      return await res.json().catch(() => ({ success: false }));
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  /**
   * Overwrite the stored .docx for a template with a processed version.
   * Fire-and-forget safe — returns true on success, false on any error.
   * @param {string} id
   * @param {string} rawBase64  Raw base64 (no data-URL prefix)
   */
  async updateFile(id, rawBase64) {
    try {
      const res = await fetch(`${API_BASE}/utils/report-formats/${id}/file`, {
        method: "PATCH",
        headers: { ...baseHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ base64: rawBase64 }),
      });
      return res.ok;
    } catch {
      return false;
    }
  },

  /**
   * Get full data for a template: metadata + extracted markdown content + raw base64 binary.
   * @param {string} id
   * @returns {{ success: boolean, id, name, uploadedAt, content: string, base64: string } | null}
   */
  async getData(id) {
    try {
      const res = await fetch(`${API_BASE}/utils/report-formats/${id}/data`, {
        headers: baseHeaders(),
      });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  },
};

export default ReportFormat;
