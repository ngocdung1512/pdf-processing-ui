import { useMemo } from "react";
import { FileCsv, FileXls } from "@phosphor-icons/react";
import { saveAs } from "file-saver";
import renderMarkdown from "@/utils/chat/markdown";

// ─── CSV parser (handles quoted fields) ──────────────────────────────────────

function parseCSVLine(line) {
  const result = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuote = !inQuote;
    } else if (ch === "," && !inQuote) {
      result.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  result.push(cur.trim());
  return result;
}

function parseCSVText(text) {
  return text
    .trim()
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0) // skip blank lines
    .map((l) => parseCSVLine(l));
}

// ─── Main extraction ──────────────────────────────────────────────────────────

/**
 * Extract tabular data from an assistant message.
 *
 * Strategy A — HTML table (most reliable for markdown | tables |):
 *   Render the message to HTML, then read <thead> + <tbody>.
 *   markdown-it always puts the header row in <thead><tr><th>, so we can't
 *   accidentally skip it.
 *
 * Strategy B — Code block (for ```csv or ```text blocks):
 *   Parse the rendered HTML's <pre> text content, which gives decoded plain
 *   text regardless of how hljs or HTMLEncode processed it.
 *
 * Returns array-of-arrays (rows × cols) with header as rows[0], or null.
 */
export function extractTableData(message) {
  if (!message) return null;

  // Strip <think>…</think> blocks before processing so they don't interfere.
  const cleanMessage = message.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

  // Render once and reuse
  let div = null;
  try {
    const html = renderMarkdown(cleanMessage);
    div = document.createElement("div");
    div.innerHTML = html;
  } catch (_) {
    // fall through to regex fallback
  }

  // ── Strategy A: HTML <table> ────────────────────────────────────────────────
  if (div) {
    const table = div.querySelector("table");
    if (table) {
      const rows = [];

      // Header from <thead> <th> cells
      const headerRow = table.querySelector("thead tr");
      if (headerRow) {
        const headerCells = Array.from(
          headerRow.querySelectorAll("th, td")
        ).map((c) => c.textContent.trim());
        if (headerCells.length > 0) rows.push(headerCells);
      }

      // Data from <tbody> <td> cells
      const bodyRows = table.querySelectorAll("tbody tr");
      bodyRows.forEach((tr) => {
        const cells = Array.from(tr.querySelectorAll("th, td")).map((c) =>
          c.textContent.trim()
        );
        if (cells.length > 0) rows.push(cells);
      });

      console.log("[TableDownloadCard] Strategy A (HTML table) rows:", rows);

      if (rows.length >= 2 && rows[0].length >= 2) return rows;
    }
  }

  // ── Strategy B: <pre> code block text ──────────────────────────────────────
  if (div) {
    const preElements = div.querySelectorAll("pre");
    for (const pre of preElements) {
      // textContent decodes HTML entities and strips highlight spans
      const rawText = pre.textContent.trim();
      if (!rawText.includes(",")) continue;

      const rows = parseCSVText(rawText);
      console.log("[TableDownloadCard] Strategy B (pre block) rows:", rows);

      if (rows.length >= 2 && rows[0].length >= 2) {
        // Verify columns are consistent
        const maxCols = Math.max(...rows.map((r) => r.length));
        const consistent = rows.filter((r) => r.length >= maxCols - 1);
        if (consistent.length >= rows.length - 1) return rows;
      }
    }
  }

  // ── Strategy C: Raw regex fallback (no DOM available) ──────────────────────
  // Matches any fenced code block regardless of language tag
  const codeBlockRe = /```[^\n`]*\r?\n([\s\S]+?)(?:\r?\n)?```/g;
  let match;
  while ((match = codeBlockRe.exec(cleanMessage)) !== null) {
    const content = match[1].trim();
    if (!content.includes(",")) continue;
    const rows = parseCSVText(content);
    console.log("[TableDownloadCard] Strategy C (regex code block) rows:", rows);
    if (rows.length >= 2 && rows[0].length >= 2) return rows;
  }

  // Markdown table via raw regex
  const lines = cleanMessage.split("\n");
  const tableLines = lines.filter((l) => l.trim().match(/^\|.+\|/));
  if (tableLines.length >= 2) {
    const rows = tableLines
      .filter((l) => !l.trim().match(/^\|[\s\-:|]+\|/)) // remove separator
      .map((l) =>
        l
          .trim()
          .replace(/^\|/, "")   // strip leading pipe
          .replace(/\|$/, "")   // strip trailing pipe
          .split("|")
          .map((c) => c.trim())
      )
      .filter((r) => r.length >= 2);

    console.log("[TableDownloadCard] Strategy C (regex md table) rows:", rows);

    if (rows.length >= 2) return rows;
  }

  console.log("[TableDownloadCard] No table found in message.");
  return null;
}

// ─── Download helpers ─────────────────────────────────────────────────────────

function downloadCSV(rows) {
  console.log("[TableDownloadCard] downloadCSV rows:", rows);
  const content = rows
    .map((row) =>
      row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")
    )
    .join("\n");
  // UTF-8 BOM so Excel opens with correct encoding
  const blob = new Blob(["\ufeff" + content], {
    type: "text/csv;charset=utf-8;",
  });
  saveAs(blob, "table-data.csv");
}

async function downloadXLSX(rows) {
  console.log("[TableDownloadCard] downloadXLSX rows:", rows);
  const XLSX = await import("xlsx");
  const ws = XLSX.utils.aoa_to_sheet(rows);

  // Bold every cell in the header row (row index 0)
  const colCount = rows[0]?.length ?? 0;
  for (let c = 0; c < colCount; c++) {
    const addr = XLSX.utils.encode_cell({ r: 0, c });
    if (ws[addr]) ws[addr].s = { font: { bold: true } };
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  const buffer = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  saveAs(blob, "table-data.xlsx");
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function TableDownloadCard({ message, role }) {
  // useMemo MUST be called before any early return (React rules of hooks)
  const rows = useMemo(
    () => (role === "assistant" ? extractTableData(message) : null),
    [message, role]
  );

  if (role !== "assistant") return null;
  if (!rows || rows.length === 0) return null;

  const colCount = rows[0]?.length ?? 0;
  const totalRows = rows.length;

  return (
    <div className="flex items-center gap-x-3 mt-3 p-3 rounded-lg border border-theme-sidebar-border bg-theme-bg-secondary w-fit max-w-xs">
      <div className="flex flex-col gap-y-0.5 flex-1 min-w-0">
        <p className="text-xs font-semibold text-theme-text-primary leading-tight">
          Bảng dữ liệu
        </p>
        <p className="text-[11px] text-theme-text-secondary leading-tight">
          {totalRows} hàng &times; {colCount} cột
        </p>
      </div>
      <div className="flex gap-x-2 shrink-0">
        <button
          onClick={() => downloadCSV(rows)}
          title="Tải xuống CSV"
          className="flex items-center gap-x-1 px-2 py-1 rounded-md bg-green-600/20 hover:bg-green-600/40 text-green-600 light:text-green-700 text-xs font-medium transition-colors"
        >
          <FileCsv size={14} weight="bold" />
          CSV
        </button>
        <button
          onClick={() => downloadXLSX(rows)}
          title="Tải xuống Excel"
          className="flex items-center gap-x-1 px-2 py-1 rounded-md bg-blue-600/20 hover:bg-blue-600/40 text-blue-600 light:text-blue-700 text-xs font-medium transition-colors"
        >
          <FileXls size={14} weight="bold" />
          Excel
        </button>
      </div>
    </div>
  );
}
