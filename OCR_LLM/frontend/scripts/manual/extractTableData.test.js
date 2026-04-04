/**
 * Manual Node script — NOT part of Vite build or CI.
 * From OCR_LLM/frontend: node scripts/manual/extractTableData.test.js
 * Tests DOM-free extraction logic (copy; keep in sync with TableDownloadCard if needed).
 */

// ─── Helpers copied from component (DOM-free versions) ───────────────────────

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
    .filter((l) => l.trim().length > 0)
    .map((l) => parseCSVLine(l));
}

/** DOM-free version of extractTableData — covers Strategy B (regex) only */
function extractTableData(message) {
  if (!message) return null;

  const cleanMessage = message.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

  // Code block (Strategy C)
  const codeBlockRe = /```[^\n`]*\r?\n([\s\S]+?)(?:\r?\n)?```/g;
  let match;
  while ((match = codeBlockRe.exec(cleanMessage)) !== null) {
    const content = match[1].trim();
    if (!content.includes(",")) continue;
    const rows = parseCSVText(content);
    if (rows.length >= 2 && rows[0].length >= 2) return rows;
  }

  // Markdown table (Strategy C)
  const lines = cleanMessage.split("\n");
  const tableLines = lines.filter((l) => l.trim().match(/^\|.+\|/));
  if (tableLines.length >= 2) {
    const rows = tableLines
      .filter((l) => !l.trim().match(/^\|[\s\-:|]+\|/))
      .map((l) =>
        l
          .trim()
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((c) => c.trim())
      )
      .filter((r) => r.length >= 2);

    if (rows.length >= 2) return rows;
  }

  return null;
}

// ─── Test runner ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗  ${name}`);
    console.error(`     ${e.message}`);
    failed++;
  }
}

function expect(actual) {
  return {
    toBe(expected) {
      if (actual !== expected)
        throw new Error(
          `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
        );
    },
    toEqual(expected) {
      const a = JSON.stringify(actual);
      const b = JSON.stringify(expected);
      if (a !== b)
        throw new Error(`Expected\n     ${b}\n     got\n     ${a}`);
    },
    toBeNull() {
      if (actual !== null)
        throw new Error(`Expected null, got ${JSON.stringify(actual)}`);
    },
    not: {
      toBeNull() {
        if (actual === null) throw new Error("Expected non-null value");
      },
    },
  };
}

// ─── Tests: CSV code blocks ───────────────────────────────────────────────────

console.log("\n=== Code blocks — header MUST be rows[0] ===");

test("```csv with header", () => {
  const msg = "```csv\nName,Score,Grade\nAlice,95,A\nBob,78,B\n```";
  const rows = extractTableData(msg);
  expect(rows).not.toBeNull();
  // Header IS the first row
  expect(rows[0]).toEqual(["Name", "Score", "Grade"]);
  // Total rows = header + 2 data = 3
  expect(rows.length).toBe(3);
});

test("```text with header (common model output)", () => {
  const msg = "```text\nTên,Điểm,Xếp_loại\nAlice,95,A\nBob,78,B\n```";
  const rows = extractTableData(msg);
  expect(rows).not.toBeNull();
  expect(rows[0]).toEqual(["Tên", "Điểm", "Xếp_loại"]);
  expect(rows.length).toBe(3);
});

test("empty language tag with header", () => {
  const msg = "```\nName,Score\nAlice,95\nBob,78\n```";
  const rows = extractTableData(msg);
  expect(rows).not.toBeNull();
  expect(rows[0]).toEqual(["Name", "Score"]);
  expect(rows.length).toBe(3);
});

test("no newline before closing backticks", () => {
  const msg = "```csv\nName,Score\nAlice,95\nBob,78```";
  const rows = extractTableData(msg);
  expect(rows).not.toBeNull();
  expect(rows[0]).toEqual(["Name", "Score"]);
  expect(rows.length).toBe(3);
});

test("prose before and after code block", () => {
  const msg =
    "Đây là kết quả:\n\n```csv\nTên,Điểm\nAlice,95\nBob,78\n```\n\nBạn có thể tải về.";
  const rows = extractTableData(msg);
  expect(rows).not.toBeNull();
  expect(rows[0]).toEqual(["Tên", "Điểm"]);
  expect(rows.length).toBe(3);
});

// ─── Tests: Markdown tables ───────────────────────────────────────────────────

console.log("\n=== Markdown tables — header MUST be rows[0] ===");

test("standard GFM table", () => {
  const msg =
    "| Name | Score | Grade |\n|------|-------|-------|\n| Alice | 95 | A |\n| Bob | 78 | B |";
  const rows = extractTableData(msg);
  expect(rows).not.toBeNull();
  // rows[0] must be the header, NOT a data row
  expect(rows[0]).toEqual(["Name", "Score", "Grade"]);
  // header + 2 data = 3 total
  expect(rows.length).toBe(3);
});

test("table with colons in separator (alignment markers)", () => {
  const msg =
    "| Name | Score |\n|:-----|------:|\n| Alice | 95 |\n| Bob | 78 |";
  const rows = extractTableData(msg);
  expect(rows).not.toBeNull();
  expect(rows[0]).toEqual(["Name", "Score"]);
  expect(rows.length).toBe(3);
});

test("table with 4 data rows — totalRows should be 5", () => {
  const msg =
    "| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n| 5 | 6 |\n| 7 | 8 |";
  const rows = extractTableData(msg);
  expect(rows).not.toBeNull();
  expect(rows[0]).toEqual(["A", "B"]);
  expect(rows.length).toBe(5); // header + 4 data
});

test("table inside prose", () => {
  const msg =
    "Here:\n\n| Col1 | Col2 |\n|------|------|\n| a | b |\n\nEnd.";
  const rows = extractTableData(msg);
  expect(rows).not.toBeNull();
  expect(rows[0]).toEqual(["Col1", "Col2"]);
});

// ─── Tests: <think> stripping ─────────────────────────────────────────────────

console.log("\n=== <think> block stripping ===");

test("table after think block", () => {
  const msg =
    "<think>Let me create a table.</think>\n\n| Name | Score |\n|------|-------|\n| Alice | 95 |";
  const rows = extractTableData(msg);
  expect(rows).not.toBeNull();
  expect(rows[0]).toEqual(["Name", "Score"]);
  expect(rows.length).toBe(2);
});

test("csv code block after think block", () => {
  const msg =
    "<think>I'll output CSV.</think>\n\n```csv\nName,Score\nAlice,95\n```";
  const rows = extractTableData(msg);
  expect(rows).not.toBeNull();
  expect(rows[0]).toEqual(["Name", "Score"]);
});

// ─── Tests: CRLF line endings ────────────────────────────────────────────────

console.log("\n=== CRLF line endings ===");

test("csv block with CRLF", () => {
  const msg = "```csv\r\nName,Score\r\nAlice,95\r\n```";
  const rows = extractTableData(msg);
  expect(rows).not.toBeNull();
  expect(rows[0]).toEqual(["Name", "Score"]);
});

test("markdown table with CRLF", () => {
  const msg =
    "| Name | Score |\r\n|------|-------|\r\n| Alice | 95 |\r\n| Bob | 78 |";
  const rows = extractTableData(msg);
  expect(rows).not.toBeNull();
  expect(rows[0]).toEqual(["Name", "Score"]);
  expect(rows.length).toBe(3);
});

// ─── Tests: Edge cases ────────────────────────────────────────────────────────

console.log("\n=== Edge cases ===");

test("returns null for plain prose", () => {
  expect(extractTableData("No table here.")).toBeNull();
});

test("returns null for null", () => {
  expect(extractTableData(null)).toBeNull();
});

test("returns null for empty string", () => {
  expect(extractTableData("")).toBeNull();
});

test("returns null for code block without commas", () => {
  expect(extractTableData("```js\nconst x = 1;\n```")).toBeNull();
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
