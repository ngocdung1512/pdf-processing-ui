import { useMemo, useState } from "react";
import { FileDoc, FileArrowDown } from "@phosphor-icons/react";
import { saveAs } from "file-saver";
import { API_BASE } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";
import {
  CHAT_LAST_DOCX_BASE64_KEY,
  CHAT_LAST_DOCX_NAME_KEY,
} from "@/utils/docxTemplateStorage";
import { getFindReplacePairsForTemplate } from "@/utils/extractFindReplaceFromAssistantReply";
import showToast from "@/utils/toast";

// ─── Report detection ─────────────────────────────────────────────────────────

export function isReportContent(message) {
  if (!message) return false;

  const THOUGHT_OPEN = /(<think|<thinking|<thought)[\s>]/i;
  const THOUGHT_CLOSE = /(<\/think>|<\/thinking>|<\/thought>)/i;
  if (THOUGHT_OPEN.test(message) && !THOUGHT_CLOSE.test(message)) return false;

  const clean = message.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

  const mdHeadings = (clean.match(/^#{1,3}\s+.+/gm) || []).length;
  const boldHeaders = (clean.match(/^\*\*[^*\n]+\*\*:?\s*$/gm) || []).length;
  const numberedBoldSections = (clean.match(/^\d+\.\s+\*\*[^*\n]+/gm) || []).length;
  const romanHeaders = (clean.match(/^[IVX]+\.\s+\S/gm) || []).length;

  const headings = mdHeadings + boldHeaders + romanHeaders;
  const wordCount = clean
    .replace(/[#*`[\]()!]/g, " ")
    .split(/\s+/)
    .filter(Boolean).length;

  return (
    wordCount >= 100 &&
    (headings >= 2 || (headings >= 1 && numberedBoldSections >= 2))
  );
}

/**
 * True when an assistant message can be exported to DOCX (any length).
 * Excludes in-flight streams where a thought block is open but not closed.
 */
export function canExportAssistantMessageToDocx(message) {
  if (!message || typeof message !== "string") return false;

  const THOUGHT_OPEN = /(<think|<thinking|<thought)[\s>]/i;
  const THOUGHT_CLOSE = /(<\/think>|<\/thinking>|<\/thought>)/i;
  if (THOUGHT_OPEN.test(message) && !THOUGHT_CLOSE.test(message)) return false;

  const clean = message.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  return clean.length > 0;
}

// ─── Inline markdown → TextRun[] ─────────────────────────────────────────────

function parseInline(text, TextRun, forceBold = false) {
  const runs = [];
  const re = /(\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`)/g;
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      const plain = text.slice(last, m.index);
      runs.push(forceBold ? new TextRun({ text: plain, bold: true }) : new TextRun(plain));
    }
    if (m[2]) runs.push(new TextRun({ text: m[2], bold: true, italics: true }));
    else if (m[3]) runs.push(new TextRun({ text: m[3], bold: true }));
    else if (m[4]) runs.push(new TextRun({ text: m[4], italics: true, bold: forceBold }));
    else if (m[5])
      runs.push(new TextRun({ text: m[5], font: "Courier New", size: 18 }));
    last = re.lastIndex;
  }
  if (last < text.length) {
    const tail = text.slice(last);
    runs.push(forceBold ? new TextRun({ text: tail, bold: true }) : new TextRun(tail));
  }
  return runs.length > 0 ? runs : [forceBold ? new TextRun({ text, bold: true }) : new TextRun(text)];
}

// ─── Table helpers ────────────────────────────────────────────────────────────

function countPipes(line) {
  return (line.match(/\|/g) || []).length;
}

function isTableLine(line) {
  return line.trim().length > 0 && countPipes(line) >= 2;
}

function isSeparatorRow(line) {
  const t = line.trim();
  return countPipes(t) >= 1 && /^[\|\s\-:]+$/.test(t) && t.includes("-");
}

function parseTableCells(line) {
  let parts = line.split("|").map((c) => c.trim());
  if (parts[0] === "") parts = parts.slice(1);
  if (parts[parts.length - 1] === "") parts = parts.slice(0, -1);
  return parts;
}

function buildDocxTable(tableLines, docxLib) {
  const {
    TextRun,
    Paragraph,
    Table,
    TableRow,
    TableCell,
    WidthType,
    AlignmentType,
  } = docxLib;

  const dataLines = tableLines.filter(
    (l) => !isSeparatorRow(l) && l.trim().length > 0
  );
  if (dataLines.length === 0) return null;

  const firstCells = parseTableCells(dataLines[0]);
  const hasHeader =
    dataLines.length > 1 &&
    (firstCells.some((c) => /\*\*/.test(c)) ||
      tableLines.some((l) => isSeparatorRow(l)));

  // Use literal string "single" — avoids importing BorderStyle enum
  // which was restructured in docx v9.
  const border = { style: "single", size: 4, color: "AAAAAA" };
  const borders = {
    top: border,
    bottom: border,
    left: border,
    right: border,
    insideHorizontal: border,
    insideVertical: border,
  };

  const docxRows = dataLines.map((line, rowIdx) => {
    const cells = parseTableCells(line);
    const isHeader = rowIdx === 0 && hasHeader;

    return new TableRow({
      tableHeader: isHeader,
      children: cells.map((cellText) => {
        // Strip ** from header text (bold handled by run formatting)
        const text = cellText.replace(/^\*\*(.+)\*\*$/, "$1").trim();
        return new TableCell({
          borders,
          // Header: light gray fill using inline shading XML (no ShadingType import needed)
          shading: isHeader
            ? { fill: "D9D9D9", val: "clear", color: "auto" }
            : undefined,
          children: [
            new Paragraph({
              alignment: isHeader ? AlignmentType.CENTER : AlignmentType.LEFT,
              children: isHeader
                ? [new TextRun({ text, bold: true })]
                : parseInline(text, TextRun),
            }),
          ],
        });
      }),
    });
  });

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders,
    rows: docxRows,
  });
}

// ─── Style helpers (fallback when no template binary available) ───────────────

function buildRunProps(s) {
  if (!s) return {};
  const r = {};
  if (s.font) r.font = s.font;
  if (s.size) r.size = s.size;
  if (s.bold !== undefined) r.bold = s.bold;
  if (s.italic !== undefined) r.italics = s.italic;
  if (s.color) r.color = s.color;
  return r;
}

function buildParaProps(s, AlignmentType) {
  if (!s) return {};
  const p = {};
  const spacing = {};
  if (s.spacingBefore !== undefined) spacing.before = s.spacingBefore;
  if (s.spacingAfter !== undefined) spacing.after = s.spacingAfter;
  if (s.spacingLine !== undefined) spacing.line = s.spacingLine;
  if (Object.keys(spacing).length) p.spacing = spacing;
  if (s.indentLeft !== undefined) p.indent = { left: s.indentLeft };
  if (s.alignment) {
    const map = {
      center: AlignmentType.CENTER,
      both: AlignmentType.BOTH,
      left: AlignmentType.LEFT,
      right: AlignmentType.RIGHT,
      distribute: AlignmentType.DISTRIBUTE,
    };
    p.alignment = map[s.alignment] ?? AlignmentType.LEFT;
  }
  return p;
}

// ─── Core DOCX builder ────────────────────────────────────────────────────────
// Converts the AI message into a complete DOCX Blob.
// Pass tplStyles=null when styles will be provided by a template ZIP instead.

async function buildReportBlob(message, tplStyles) {
  const docxLib = await import("docx");
  const {
    Document,
    Packer,
    Paragraph,
    TextRun,
    HeadingLevel,
    AlignmentType,
  } = docxLib;

  const clean = message.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const lines = clean.split(/\r?\n/);

  // ── Segment: group consecutive table rows ────────────────────────────────
  const segments = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isTableLine(line) || isSeparatorRow(line)) {
      const block = [];
      while (
        i < lines.length &&
        (isTableLine(lines[i]) || isSeparatorRow(lines[i]))
      ) {
        block.push(lines[i]);
        i++;
      }
      const dataRows = block.filter(
        (l) => !isSeparatorRow(l) && l.trim().length > 0
      );
      if (dataRows.length >= 2) {
        segments.push({ type: "table", lines: block });
      } else {
        for (const l of block) segments.push({ type: "line", line: l });
      }
    } else {
      segments.push({ type: "line", line });
      i++;
    }
  }

  // ── Build children ───────────────────────────────────────────────────────
  const children = [];

  for (const seg of segments) {
    if (seg.type === "table") {
      const tbl = buildDocxTable(seg.lines, docxLib);
      if (tbl) {
        children.push(tbl);
        children.push(new Paragraph({ text: "" }));
      }
      continue;
    }

    const line = seg.line.trimEnd();

    if (/^###\s+/.test(line)) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_3,
          children: parseInline(line.replace(/^###\s+/, ""), TextRun, true),
        })
      );
      continue;
    }
    if (/^##\s+/.test(line)) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: parseInline(line.replace(/^##\s+/, ""), TextRun, true),
        })
      );
      continue;
    }
    if (/^#\s+/.test(line)) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          children: parseInline(line.replace(/^#\s+/, ""), TextRun, true),
        })
      );
      continue;
    }

    // Roman numeral section headers: I. ... II. ... → always bold
    if (/^[IVX]+\.\s+\S/.test(line.trim())) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          children: parseInline(line.trim(), TextRun, true),
        })
      );
      continue;
    }

    // Bold-only line → H2 (already bold by markdown, forceBold ensures plain variant is too)
    if (/^\*\*[^*\n]+\*\*:?\s*$/.test(line.trim())) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: parseInline(line.trim(), TextRun, true),
        })
      );
      continue;
    }

    // Bullet: -, *, +, ●, •
    if (/^[-*+●•]\s+/.test(line)) {
      children.push(
        new Paragraph({
          bullet: { level: 0 },
          children: parseInline(line.replace(/^[-*+●•]\s+/, ""), TextRun),
        })
      );
      continue;
    }

    // Numbered paragraph — plain text so original numbers are preserved exactly.
    // Word's auto-numbering would reassign the sequence and break the source order.
    // Sub-items (3+ spaces after the period, e.g. "4.    Sub-item") get extra indent.
    if (/^\d+\.\s+/.test(line)) {
      const isSub = /^\d+\.\s{3,}/.test(line);
      // Normalise multiple spaces after the period to one space
      const numText = line.replace(/^(\d+\.)\s+/, "$1 ");
      children.push(
        new Paragraph({
          indent: { left: isSub ? 720 : 360 },
          children: parseInline(numText, TextRun),
        })
      );
      continue;
    }

    // Horizontal rule
    if (/^---+$/.test(line.trim()) || /^\*\*\*+$/.test(line.trim())) {
      children.push(new Paragraph({ text: "" }));
      continue;
    }

    // Blockquote
    if (/^>\s*/.test(line)) {
      children.push(
        new Paragraph({
          indent: { left: 720 },
          children: [
            new TextRun({
              text: line.replace(/^>\s*/, ""),
              italics: true,
              color: "555555",
            }),
          ],
        })
      );
      continue;
    }

    // Empty line
    if (line.trim() === "") {
      children.push(new Paragraph({ text: "" }));
      continue;
    }

    // All-caps Vietnamese header → centered bold.
    // Must NOT start with a digit or letter+dot prefix (those are numbered items
    // that already ran above), and must contain no lowercase letters.
    const trimmed = line.trim();
    if (
      trimmed.length <= 80 &&
      /[A-ZÀ-Ỵ]/.test(trimmed) &&
      !/[a-z]/.test(trimmed) &&
      !/^[\d]/.test(trimmed) &&
      !/^[A-Z]\.\s/.test(trimmed) &&
      !/^[-*+●•#>]/.test(trimmed)
    ) {
      children.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: parseInline(trimmed, TextRun, true),
        })
      );
      continue;
    }

    // Normal paragraph
    children.push(
      new Paragraph({
        children: parseInline(line, TextRun),
      })
    );
  }

  // ── Build Document ───────────────────────────────────────────────────────
  const stylesConfig = tplStyles
    ? {
        default: {
          document: {
            run: buildRunProps(tplStyles.normal),
            paragraph: buildParaProps(tplStyles.normal, AlignmentType),
          },
          heading1: {
            run: buildRunProps(tplStyles.heading1),
            paragraph: buildParaProps(tplStyles.heading1, AlignmentType),
          },
          heading2: {
            run: buildRunProps(tplStyles.heading2),
            paragraph: buildParaProps(tplStyles.heading2, AlignmentType),
          },
          heading3: {
            run: buildRunProps(tplStyles.heading3),
            paragraph: buildParaProps(tplStyles.heading3, AlignmentType),
          },
        },
      }
    : undefined;

  const doc = new Document({
    styles: stylesConfig,
    sections: [{ children }],
  });

  return Packer.toBlob(doc);
}

// ─── {noi_dung} marker injection ─────────────────────────────────────────────
// When the template has a paragraph whose full text is exactly "{noi_dung}",
// we keep the entire template (header, footer, styles, layout) intact and
// replace only that paragraph with the AI-generated content paragraphs.

/**
 * Extract top-level block elements (<w:p> paragraphs and <w:tbl> tables)
 * from a <w:body> XML string, maintaining their document order.
 *
 * Table cell paragraphs are NOT extracted separately — the full <w:tbl>
 * element is kept intact so Word renders it as a table.
 * Returns a single XML string of all blocks joined by newlines.
 */
function extractBodyBlocks(bodyXml) {
  const blocks = [];
  const tables = [];

  // Replace table blocks with temporary markers (preserves their XML)
  const withMarkers = bodyXml.replace(
    /<w:tbl(?:\s[^>]*)?>[\s\S]*?<\/w:tbl>/g,
    (match) => {
      const idx = tables.length;
      tables.push(match);
      return `\x00TBL:${idx}\x00`;
    }
  );

  // Split on markers; even parts have paragraphs, odd parts are table indices
  const parts = withMarkers.split(/\x00TBL:(\d+)\x00/);
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) {
      const paraRe = /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g;
      let m;
      while ((m = paraRe.exec(parts[i])) !== null) blocks.push(m[0]);
    } else {
      blocks.push(tables[parseInt(parts[i], 10)]);
    }
  }

  return blocks.join("\n");
}

/**
 * Scan document.xml for the paragraph whose concatenated <w:t> text
 * exactly equals `markerText`.
 * Returns { found, paraXml, startIndex, endIndex } — positions in the
 * original docXml string so we can do precise range replacement.
 */
function findMarkerParagraph(docXml, markerText) {
  const paraRe = /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g;
  let m;
  while ((m = paraRe.exec(docXml)) !== null) {
    const tRe = /<w:t(?:[^>]*)?>([^<]*)<\/w:t>/g;
    const texts = [];
    let t;
    while ((t = tRe.exec(m[0])) !== null) texts.push(t[1]);
    if (texts.join("").trim() === markerText) {
      return {
        found: true,
        paraXml: m[0],
        startIndex: m.index,
        endIndex: m.index + m[0].length,
      };
    }
  }
  return { found: false, paraXml: null, startIndex: -1, endIndex: -1 };
}

/**
 * Generate a report using the {noi_dung} / {ket_thuc} marker approach.
 *
 * Template structure:
 *   [header paragraphs]   — kept as-is
 *   {noi_dung}            — AI content starts here
 *   [old body paragraphs] — removed (if {ket_thuc} is present)
 *   {ket_thuc}            — AI content ends here; rest is footer/signature
 *   [footer paragraphs]   — kept as-is
 *
 * If only {noi_dung} is present (no {ket_thuc}), the single paragraph is
 * replaced with AI content (backward-compatible behaviour).
 */
/**
 * Copy table-style definitions that exist in the content DOCX but are missing
 * from the template DOCX.  Without this, injected table XML references style IDs
 * (e.g. "TableGrid") that the template's styles.xml doesn't know about, causing
 * Word to silently drop table borders and formatting.
 */
function mergeTableStyles(contentZip, templateZip) {
  try {
    const contentStylesXml = contentZip.file("word/styles.xml")?.asText() ?? "";
    const templateStylesEntry = templateZip.file("word/styles.xml");
    if (!templateStylesEntry) return;
    let templateStylesXml = templateStylesEntry.asText();

    // Extract every <w:style w:type="table" …> … </w:style> block from content
    const tableStyleRe = /<w:style\s+[^>]*w:type="table"[^>]*>[\s\S]*?<\/w:style>/g;
    const contentTableStyles = contentStylesXml.match(tableStyleRe) ?? [];

    let changed = false;
    for (const block of contentTableStyles) {
      const idMatch = block.match(/w:styleId="([^"]+)"/);
      if (!idMatch) continue;
      if (templateStylesXml.includes(`w:styleId="${idMatch[1]}"`)) continue;
      // Append before the closing </w:styles> tag
      templateStylesXml = templateStylesXml.replace("</w:styles>", block + "\n</w:styles>");
      changed = true;
    }

    if (changed) templateZip.file("word/styles.xml", templateStylesXml);
  } catch {
    // Non-fatal: table will still appear, just without named style formatting
  }
}

async function generateReportWithNoiDung(message, templateBase64) {
  const { default: PizZip } = await import("pizzip");

  // 1. Build AI content paragraphs
  const contentBlob = await buildReportBlob(message, null);
  const contentBuffer = await contentBlob.arrayBuffer();
  const contentZip = new PizZip(contentBuffer);
  const contentDocXml = contentZip.file("word/document.xml").asText();

  const bodyMatch = contentDocXml.match(/<w:body>([\s\S]*)<\/w:body>/);
  const contentBodyXml = bodyMatch ? bodyMatch[1] : "";
  // Extract top-level blocks (paragraphs + tables) in document order.
  // Must NOT descend into <w:tc> cell paragraphs or we lose table structure.
  const contentParas = extractBodyBlocks(contentBodyXml);

  // 2. Open template
  const base64Data = templateBase64.includes(",")
    ? templateBase64.split(",")[1]
    : templateBase64;
  const templateZip = new PizZip(base64Data, { base64: true });
  let templateDocXml = templateZip.file("word/document.xml").asText();

  // 3. Locate markers
  const noiDung = findMarkerParagraph(templateDocXml, "{noi_dung}");
  if (!noiDung.found) {
    return generateReportFromTemplate(message, templateBase64);
  }

  const ketThuc = findMarkerParagraph(templateDocXml, "{ket_thuc}");

  if (ketThuc.found && ketThuc.startIndex > noiDung.endIndex) {
    templateDocXml =
      templateDocXml.slice(0, noiDung.startIndex) +
      contentParas +
      templateDocXml.slice(ketThuc.endIndex);
  } else {
    templateDocXml = templateDocXml.replace(noiDung.paraXml, contentParas);
  }

  // 4. Write document XML back
  templateZip.file("word/document.xml", templateDocXml);

  // 5. Merge table styles from content DOCX so injected tables render correctly
  //    even if the template never had a table before.
  mergeTableStyles(contentZip, templateZip);

  return templateZip.generate({
    type: "blob",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    compression: "DEFLATE",
  });
}

// ─── Template injection ───────────────────────────────────────────────────────
// Generates the report, then replaces its styles.xml with the template's own
// styles.xml — so fonts, sizes, colors, spacing all come directly from the
// uploaded template file without recreating it from scratch.

async function generateReportFromTemplate(message, templateBase64) {
  // 1. Build report with no style overrides (template provides all styles)
  const reportBlob = await buildReportBlob(message, null);
  const reportBuffer = await reportBlob.arrayBuffer();

  // 2. Open both ZIPs
  const { default: PizZip } = await import("pizzip");
  const reportZip = new PizZip(reportBuffer);

  // base64 may be a data-URL ("data:...;base64,XXXX") or raw base64
  const base64Data = templateBase64.includes(",")
    ? templateBase64.split(",")[1]
    : templateBase64;
  const templateZip = new PizZip(base64Data, { base64: true });

  // 3. Swap styles.xml: replace report's default styles with template's styles
  const templateStyles = templateZip.file("word/styles.xml");
  if (templateStyles) {
    reportZip.file("word/styles.xml", templateStyles.asText());
  }

  // 4. Carry over template theme if present (colour palette, fonts)
  const templateTheme = templateZip.file("word/theme/theme1.xml");
  if (templateTheme) {
    reportZip.file("word/theme/theme1.xml", templateTheme.asText());
  }

  // 5. Inject template's page-layout settings (margins, paper size, orientation)
  //    from its <w:sectPr> into the report body, replacing the report's own sectPr.
  try {
    const templateDocXml = templateZip.file("word/document.xml").asText();
    const sectPrMatch = templateDocXml.match(
      /<w:sectPr(?:\s[^>]*)?>[\s\S]*?<\/w:sectPr>/
    );
    if (sectPrMatch) {
      // Strip any header/footer references that would break cross-file links
      const cleanSectPr = sectPrMatch[0]
        .replace(/<w:headerReference[^/]*\/>/g, "")
        .replace(/<w:footerReference[^/]*\/>/g, "");

      let reportDocXml = reportZip.file("word/document.xml").asText();
      // Replace the report's sectPr with the template's clean version
      reportDocXml = reportDocXml.replace(
        /<w:sectPr(?:\s[^>]*)?>[\s\S]*?<\/w:sectPr>/,
        cleanSectPr
      );
      reportZip.file("word/document.xml", reportDocXml);
    }
  } catch {
    // Non-fatal: page layout falls back to report default
  }

  // 6. Return the filled template as a Blob
  return reportZip.generate({
    type: "blob",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    compression: "DEFLATE",
  });
}

// ─── Main dispatch ────────────────────────────────────────────────────────────

async function generateDocx(message) {
  const templateBase64 = localStorage.getItem("DOCX_TEMPLATE_BINARY");
  const templateMode = localStorage.getItem("DOCX_TEMPLATE_MODE") || "style";

  // ── Mode 0: {noi_dung} marker — preserve header & footer, AI fills middle ──
  if (templateBase64 && templateMode === "noidung") {
    return generateReportWithNoiDung(message, templateBase64);
  }

  // ── Mode 1: template binary present → ZIP injection (style swap) ────────────
  if (templateBase64) {
    return generateReportFromTemplate(message, templateBase64);
  }

  // ── Mode 2: no template → generate from scratch ─────────────────────────────
  const tplStyles = JSON.parse(
    localStorage.getItem("DOCX_TEMPLATE_STYLES") || "null"
  );
  return buildReportBlob(message, tplStyles);
}

/**
 * Original .docx from last chat upload (session) or library template (localStorage).
 * @returns {{ base64: string, name: string } | null}
 */
function readStoredOriginalDocx() {
  const b64 = sessionStorage.getItem(CHAT_LAST_DOCX_BASE64_KEY);
  const name = sessionStorage.getItem(CHAT_LAST_DOCX_NAME_KEY);
  if (b64) return { base64: b64, name: name || "document.docx" };
  const raw = localStorage.getItem("DOCX_TEMPLATE_BINARY");
  if (!raw) return null;
  const base64 = raw.includes(",") ? raw.split(",")[1] : raw;
  return { base64, name: "mau_bao_cao.docx" };
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ReportDownloadCard({
  message,
  role,
  pairedUserMessage = null,
}) {
  const [loading, setLoading] = useState(false);
  const [loadingTemplate, setLoadingTemplate] = useState(false);
  const [dlError, setDlError] = useState(null);

  const showExport = useMemo(
    () => role === "assistant" && canExportAssistantMessageToDocx(message),
    [message, role]
  );

  const looksLikeReport = useMemo(
    () => isReportContent(message),
    [message]
  );

  if (!showExport) return null;

  const hasTemplate = !!localStorage.getItem("DOCX_TEMPLATE_BINARY");
  const templateMode = localStorage.getItem("DOCX_TEMPLATE_MODE") || "style";
  const isNoiDung = hasTemplate && templateMode === "noidung";
  const needsProcessing = hasTemplate && !isNoiDung;

  const titleText = looksLikeReport
    ? needsProcessing
      ? "Mẫu chưa được xử lý"
      : isNoiDung
        ? "Mẫu báo cáo"
        : "Phát hiện báo cáo"
    : "Xuất Word";

  const subtitle = isNoiDung
    ? "Đã xử lý — tải DOCX theo mẫu {noi_dung}"
    : needsProcessing
      ? "Có mẫu style: thử ghép mẫu; nếu lỗi sẽ tải nội dung thuần"
      : looksLikeReport
        ? "Tải xuống dạng Word"
        : "Tải toàn bộ phản hồi dạng .docx";

  const downloadFileName = isNoiDung
    ? "report_filled.docx"
    : looksLikeReport
      ? "report.docx"
      : "chat_message.docx";

  const handleDownload = async () => {
    setLoading(true);
    setDlError(null);
    try {
      const blob = await generateDocx(message);
      saveAs(blob, downloadFileName);
    } catch (e) {
      console.warn("[ReportDownloadCard] primary export failed, plain DOCX fallback", e);
      try {
        const tplStyles = JSON.parse(
          localStorage.getItem("DOCX_TEMPLATE_STYLES") || "null"
        );
        const blob = await buildReportBlob(message, tplStyles);
        saveAs(blob, looksLikeReport ? "report_plain.docx" : "chat_message.docx");
      } catch (e2) {
        console.error("[ReportDownloadCard]", e2);
        setDlError(e2.message || "Failed");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadByOriginalTemplate = async () => {
    setLoadingTemplate(true);
    setDlError(null);
    try {
      const stored = readStoredOriginalDocx();
      if (!stored) {
        showToast(
          "Chưa có file .docx gốc — hãy đính kèm mẫu trong phiên chat này hoặc chọn mẫu từ thư viện (nút thư mục).",
          "warning"
        );
        return;
      }
      const pairs = getFindReplacePairsForTemplate(pairedUserMessage, message);
      if (!pairs.length) {
        showToast(
          "Không trích được cặp thay thế — trong tin nhắn dùng: thay A thành B, hoặc A thay là B; hoặc để bot liệt kê \"A\" → \"B\" trong phản hồi.",
          "warning"
        );
        return;
      }

      const dataUrl = `data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,${stored.base64}`;
      const docxType =
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
      let currentBlob = await fetch(dataUrl).then((r) => r.blob());
      const baseName = stored.name;
      let totalReplacements = 0;

      for (let i = 0; i < pairs.length; i++) {
        const { find, replace } = pairs[i];
        const fd = new FormData();
        fd.append(
          "file",
          new File([currentBlob], baseName, { type: docxType }),
          baseName
        );
        fd.append("find", find);
        fd.append("replace", replace);
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
            const hint =
              res.status === 422
                ? ` (không thấy trong file: "${find.length > 60 ? `${find.slice(0, 60)}…` : find}")`
                : "";
            throw new Error((j.error || "Request failed") + hint);
          }
          throw new Error((await res.text()) || "Request failed");
        }
        currentBlob = await res.blob();
        totalReplacements += Number(res.headers.get("X-Replace-Count") || 0);
      }

      const outName = baseName.replace(/\.docx$/i, "_replaced.docx");
      saveAs(currentBlob, outName);
      showToast(
        `Đã cập nhật file mẫu (${totalReplacements} lần thay, ${pairs.length} bước) — ${outName}`,
        "success"
      );
    } catch (e) {
      console.error("[ReportDownloadCard/template]", e);
      showToast(e.message || "Không tạo được file theo mẫu", "error");
      setDlError(e.message || "Template export failed");
    } finally {
      setLoadingTemplate(false);
    }
  };

  return (
    <div className="flex flex-col gap-y-1 mt-3">
      <div className={`flex items-center gap-x-3 p-3 rounded-lg border w-fit max-w-md ${
        needsProcessing && looksLikeReport
          ? "border-amber-500/40 bg-amber-500/5"
          : "border-theme-sidebar-border bg-theme-bg-secondary"
      }`}>
        <div className="flex flex-col gap-y-0.5 flex-1 min-w-0">
          <p className={`text-xs font-semibold leading-tight ${needsProcessing && looksLikeReport ? "text-amber-600 light:text-amber-700" : "text-theme-text-primary"}`}>
            {titleText}
          </p>
          <p className={`text-[11px] leading-tight ${needsProcessing && looksLikeReport ? "text-amber-600/80 light:text-amber-700/80" : "text-theme-text-secondary truncate"}`}>
            {needsProcessing && looksLikeReport
              ? "Nhấn \"AI điền\" hoặc \"Chọn vị trí\" ở thanh nhập để xử lý mẫu đầy đủ"
              : subtitle}
          </p>
          <p className="text-[10px] leading-tight text-theme-text-secondary/80 mt-1">
            DOCX = nội dung chat. &quot;Theo mẫu&quot; = file gốc đã upload / mẫu thư viện; cặp thay thế lấy từ tin bạn gửi (thay A thành B, A thay là B) hoặc từ phản hồi có &quot;A&quot; → &quot;B&quot;.
          </p>
        </div>
        <div className="flex flex-col gap-y-1.5 shrink-0">
          <button
            type="button"
            onClick={handleDownload}
            disabled={loading || loadingTemplate}
            title="Tải phản hồi dạng Word (nội dung chat)"
            className="flex items-center justify-center gap-x-1 px-2 py-1 rounded-md bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-600 light:text-indigo-700 text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <FileDoc size={14} weight="bold" />
            {loading ? "…" : "DOCX"}
          </button>
          <button
            type="button"
            onClick={handleDownloadByOriginalTemplate}
            disabled={loading || loadingTemplate}
            title="Giữ layout file .docx gốc; thay tên theo phản hồi (vd: … thành …)"
            className="flex items-center justify-center gap-x-1 px-2 py-1 rounded-md bg-emerald-600/20 hover:bg-emerald-600/35 text-emerald-600 light:text-emerald-800 text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <FileArrowDown size={14} weight="bold" />
            {loadingTemplate ? "…" : "Theo mẫu"}
          </button>
        </div>
      </div>
      {dlError && (
        <p className="text-[11px] text-red-400 max-w-xs truncate">{dlError}</p>
      )}
    </div>
  );
}
