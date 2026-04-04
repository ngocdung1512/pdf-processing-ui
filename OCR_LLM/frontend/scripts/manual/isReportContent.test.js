/**
 * Manual Node script — NOT part of Vite build or CI.
 * From OCR_LLM/frontend: node scripts/manual/isReportContent.test.js
 *
 * Tests isReportContent() logic in isolation (copy; keep in sync with ReportDownloadCard).
 */

// ─── Logic under test (copy of the real function) ────────────────────────────

function isReportContent(message) {
  if (!message) return false;

  // If the model is still mid-thought (open tag present, no closing tag yet)
  // the thought content itself may look like a report — suppress until done.
  const THOUGHT_OPEN = /(<think|<thinking|<thought)[\s>]/i;
  const THOUGHT_CLOSE = /(<\/think>|<\/thinking>|<\/thought>)/i;
  if (THOUGHT_OPEN.test(message) && !THOUGHT_CLOSE.test(message)) return false;

  const clean = message.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

  // Markdown headings: # H1, ## H2, ### H3
  const mdHeadings = (clean.match(/^#{1,3}\s+.+/gm) || []).length;

  // Bold-only lines used as section headers by many LLMs:
  //   **Executive Summary**  or  **Executive Summary:**
  const boldHeaders = (clean.match(/^\*\*[^*\n]+\*\*:?\s*$/gm) || []).length;

  // Numbered sections whose first token is bold — common Vietnamese/structured
  // report pattern: "1.  **Đơn vị:** ..."  "2.  **Finding:** ..."
  const numberedBoldSections = (clean.match(/^\d+\.\s+\*\*[^*\n]+/gm) || [])
    .length;

  const headings = mdHeadings + boldHeaders;

  const wordCount = clean
    .replace(/[#*`[\]()!]/g, " ")
    .split(/\s+/)
    .filter(Boolean).length;

  // Detect as report if:
  //  A) 2+ explicit headings, OR
  //  B) 1 title heading + 2+ numbered bold sections (title + body pattern)
  return (
    wordCount >= 100 &&
    (headings >= 2 || (headings >= 1 && numberedBoldSections >= 2))
  );
}

// ─── Micro test runner ────────────────────────────────────────────────────────

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
    toBeTrue() {
      if (actual !== true)
        throw new Error(`Expected true, got ${JSON.stringify(actual)}`);
    },
    toBeFalse() {
      if (actual !== false)
        throw new Error(`Expected false, got ${JSON.stringify(actual)}`);
    },
  };
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

// Typical LLM output using markdown (#) headings
const MD_HEADING_REPORT = `
# Security Assessment Report

## Executive Summary

This report provides a comprehensive analysis of the current security posture
of the target environment. Multiple critical vulnerabilities were identified
during the assessment period, and remediation steps are recommended.

## Findings

The following issues were identified during the review:
- Outdated dependencies with known CVEs
- Insufficient input validation in the API layer
- Missing rate limiting on authentication endpoints
- Lack of audit logging for privileged operations

## Recommendations

Immediate action is required to address the critical findings. The team should
prioritize patching the dependency vulnerabilities and implementing proper input
validation across all endpoints. A follow-up review is scheduled for next quarter.

## Conclusion

The overall security posture requires significant improvement. With the
recommended changes implemented, the risk level should be reduced substantially.
`.trim();

// LLM using **Bold** section headers (very common with GPT-4, Claude, etc.)
const BOLD_HEADER_REPORT = `
**Executive Summary**

This report covers the quarterly performance metrics for the engineering team.
Overall velocity increased by 18% compared to the previous quarter, with
notable improvements in deployment frequency and mean time to recovery.

**Key Metrics**

Deployment frequency rose from 4 to 6 per week. Mean time to recovery dropped
from 45 minutes to 12 minutes. Test coverage improved from 62% to 78%.
Code review turnaround time averaged 4 hours across the team.

**Recommendations**

Continue the current sprint cadence and invest in further test automation.
Consider adopting feature flags to decouple deployment from release. Address
the remaining technical debt items identified in the backlog review.

**Conclusion**

The team demonstrated strong execution in Q3. The metrics indicate a healthy
engineering culture with consistent improvement trends across all dimensions.
`.trim();

// Mix of markdown headings + bold sub-headers
const MIXED_REPORT = `
# Annual Report 2024

## Overview

This document summarises the key events and financial highlights for 2024.
The organisation achieved record revenue while maintaining operational costs
within budget. New product lines contributed significantly to growth.

**Market Position**

The company strengthened its market position through strategic partnerships
and expanded into three new geographic regions during the fiscal year.
Customer satisfaction scores reached an all-time high of 94%.

## Financial Highlights

Total revenue: $4.2M (+22% YoY)
Operating costs: $2.8M (+5% YoY)
Net profit: $1.4M

**Cost Breakdown**

Personnel costs represent 65% of total expenditure, followed by infrastructure
at 18% and marketing at 12%. All budget categories remained within approved limits.
`.trim();

// Think block wrapping a real report
const THINK_WRAPPED_REPORT = `
<think>
The user wants a detailed incident report. I should structure this properly.
</think>

# Incident Report — Service Outage

## Incident Summary

On 2024-11-14 at 03:22 UTC a cascading failure in the payment processing
service caused a complete outage lasting 47 minutes. Approximately 12,000
transactions were affected and approximately $85,000 in revenue was deferred.

## Root Cause

A memory leak introduced in release v2.4.1 caused the primary node to exhaust
available heap after approximately 72 hours of runtime. The automated restart
policy did not trigger because the health check endpoint continued to respond
with HTTP 200 due to a shallow implementation.

## Timeline

- 03:22 UTC — First alert fired (P1)
- 03:35 UTC — On-call engineer acknowledged
- 04:01 UTC — Root cause identified
- 04:09 UTC — Rollback completed, service restored

## Action Items

All items have assigned owners and due dates in the tracking system. Memory
profiling will be added to the CI pipeline. Health checks will be revised to
perform deep dependency validation rather than shallow process checks.
`.trim();

// Real-world: Vietnamese violation-summary report produced by the AI.
// Pattern: bold title + numbered sections where each section opens with
// "N.  **Field:** value"  — boldHeaders=1, numberedBoldSections=4.
const VIETNAMESE_VIOLATION_REPORT = `<think>
Some internal reasoning that should be stripped.
</think>

**BÁO CÁO TỔNG QUAN VỀ CÁC LỖI VI PHẠM**

Dựa trên các văn bản và dữ liệu đã được cung cấp, dưới đây là tổng hợp các vi phạm hành chính đã được ghi nhận trong các báo cáo của Công an xã:

1.  **Đơn vị:** Công an xã Việt Tiến
    *   **Đối tượng:** Bà Đỗ Thị Thu Ngân (Chủ hộ kinh doanh)
    *   **Hành vi:** Bán hàng hóa giả mạo nhãn hiệu Adidas (thiếu mã an toàn, nhãn phụ tiếng Việt).
    *   **Số tiền xử phạt:** Chưa cập nhật (Đang củng cố hồ sơ).
    *   **Biện pháp:** Thu giữ, niêm phong hàng hóa, củng cố hồ sơ xử lý.
    *   **Cơ quan ban hành:** Công an xã Việt Tiến.

2.  **Đơn vị:** Công an xã Lê Lợi
    *   **Đối tượng:** Ông Nguyễn Xuân Đông (SN 1987)
    *   **Hành vi:** Vệ sinh cá nhân (tiểu tiện) không đúng nơi quy định tại nơi công cộng.
    *   **Số tiền xử phạt:** 150.000đ.
    *   **Biện pháp:** Tham mưu UBND xã ra Quyết định xử phạt hành chính.
    *   **Căn cứ:** Điểm b, khoản 2, Điều 25, Nghị định số 45/2022/NĐ-CP.
    *   **Cơ quan ban hành:** UBND xã.

3.  **Đơn vị:** Công an xã Văn Giang
    *   **Đối tượng:** Ông Tống Bảo Trung (SN 1990)
    *   **Hành vi:** Tàng trữ hàng cấm (pháo hoa nổ) tại phố Văn Giang.
    *   **Số tiền xử phạt:** Chưa cập nhật.
    *   **Biện pháp:** Thu giữ, niêm phong, đang tiếp tục điều tra, xác minh.
    *   **Căn cứ:** Chưa nêu rõ.
    *   **Cơ quan ban hành:** Công an xã Văn Giang.

4.  **Đơn vị:** Công an xã Tống Trân (Thông tin chưa đầy đủ trong văn bản)
    *   **Đối tượng:** Chưa rõ.
    *   **Hành vi:** Chưa rõ (Văn bản bị cắt).
    *   **Số tiền xử phạt:** Chưa cập nhật.
    *   **Biện pháp:** Chưa rõ.
    *   **Căn cứ:** Chưa nêu rõ.
    *   **Cơ quan ban hành:** Công an xã Tống Trân.

*Lưu ý: Báo cáo này chỉ phản ánh các vi phạm được ghi nhận rõ ràng trong các văn bản đã cung cấp.*`.trim();

// Numbered list without bold labels — should NOT trigger (not structured enough)
const NUMBERED_LIST_NO_BOLD = `
Here are some things to remember:

1. Make sure to check the logs regularly for any unusual activity.
2. Update dependencies every month to stay secure and up to date.
3. Run the test suite before merging any pull request to main branch.
4. Review access control lists quarterly to remove stale permissions.

These are general best practices for any software engineering team.
`.trim();

// ─── Not-a-report fixtures ─────────────────────────────────────────────────────

const PLAIN_PROSE =
  "The quick brown fox jumped over the lazy dog. This is just a normal conversational message without any structured report formatting. I can talk about many things but this is not a report.";

const SHORT_WITH_HEADINGS = `
# Title

## Section

Too short.
`.trim();

const CODE_ONLY = `
Here is the code:

\`\`\`python
def hello():
    print("hello world")
\`\`\`
`.trim();

const SINGLE_HEADING_LONG = `
## Only One Heading

Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor
incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis
nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.
Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu
fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in
culpa qui officia deserunt mollit anim id est laborum. This paragraph continues
to ensure we have well over one hundred words of content in total here.
`.trim();

const TABLE_ONLY = `
Here is the data:

| Name | Score | Grade |
|------|-------|-------|
| Alice | 95 | A |
| Bob | 78 | B |
| Carol | 88 | B+ |
`.trim();

// ─── Tests: SHOULD detect as report ──────────────────────────────────────────

console.log("\n=== Should detect as report ===");

test("standard markdown heading report", () => {
  expect(isReportContent(MD_HEADING_REPORT)).toBeTrue();
});

test("bold-header report (common LLM output style)", () => {
  expect(isReportContent(BOLD_HEADER_REPORT)).toBeTrue();
});

test("mixed markdown + bold headers", () => {
  expect(isReportContent(MIXED_REPORT)).toBeTrue();
});

test("report wrapped in <think> block", () => {
  expect(isReportContent(THINK_WRAPPED_REPORT)).toBeTrue();
});

test("Vietnamese violation report: bold title + numbered bold sections", () => {
  // This is the exact format the AI produced that was NOT being detected.
  // Pattern: boldHeaders=1, numberedBoldSections=4 → should trigger.
  expect(isReportContent(VIETNAMESE_VIOLATION_REPORT)).toBeTrue();
});

// ─── Tests: SHOULD NOT detect as report ───────────────────────────────────────

console.log("\n=== Should NOT detect as report ===");

test("plain prose (no headings)", () => {
  expect(isReportContent(PLAIN_PROSE)).toBeFalse();
});

test("headings but too short (< 100 words)", () => {
  expect(isReportContent(SHORT_WITH_HEADINGS)).toBeFalse();
});

test("code only (no headings)", () => {
  expect(isReportContent(CODE_ONLY)).toBeFalse();
});

test("single heading + long prose", () => {
  expect(isReportContent(SINGLE_HEADING_LONG)).toBeFalse();
});

test("table only (no headings)", () => {
  expect(isReportContent(TABLE_ONLY)).toBeFalse();
});

test("numbered list without bold labels (no structural heading)", () => {
  expect(isReportContent(NUMBERED_LIST_NO_BOLD)).toBeFalse();
});

test("mid-stream: open <think> with no closing tag → hidden", () => {
  // Simulates the message arriving while the model is still reasoning.
  // The thought content itself can look like a report — must be suppressed.
  const midStream = `<think>
The user wants a summary report. I'll structure it with a title and numbered sections.

# Internal Plan
## Section 1
I need to list all violations found in the provided contexts including names, dates...
## Section 2
Let me organise by unit: Việt Tiến, Lê Lợi, Văn Giang, Tống Trân...
## Section 3
For each case I will include the violator, act, fine, handling, and legal basis.
## Section 4
Final summary with recommendations and next steps for the enforcement team.
This is a very long reasoning block with more than one hundred words total here.`;
  expect(isReportContent(midStream)).toBeFalse();
});

test("completed <think> block: button shows after model finishes thinking", () => {
  // Same message but now the closing tag has arrived — button should appear.
  const completed = `<think>
Internal reasoning here.
</think>

**BÁO CÁO TỔNG QUAN VỀ CÁC LỖI VI PHẠM**

Dựa trên dữ liệu đã cung cấp, đây là tổng hợp vi phạm:

1.  **Đơn vị:** Công an xã Việt Tiến
    *   **Đối tượng:** Bà Đỗ Thị Thu Ngân
    *   **Hành vi:** Bán hàng giả mạo nhãn hiệu Adidas.
    *   **Biện pháp:** Thu giữ, niêm phong, củng cố hồ sơ xử lý theo quy định pháp luật.

2.  **Đơn vị:** Công an xã Lê Lợi
    *   **Đối tượng:** Ông Nguyễn Xuân Đông (SN 1987)
    *   **Hành vi:** Tiểu tiện không đúng nơi quy định tại khu vực công cộng.
    *   **Biện pháp:** Xử phạt hành chính 150.000đ theo Nghị định 45/2022/NĐ-CP.

3.  **Đơn vị:** Công an xã Văn Giang
    *   **Đối tượng:** Ông Tống Bảo Trung (SN 1990)
    *   **Hành vi:** Tàng trữ pháo hoa nổ trái phép tại phố Văn Giang.
    *   **Biện pháp:** Thu giữ, niêm phong, tiếp tục điều tra xác minh theo quy định.`;
  expect(isReportContent(completed)).toBeTrue();
});

test("null returns false", () => {
  expect(isReportContent(null)).toBeFalse();
});

test("empty string returns false", () => {
  expect(isReportContent("")).toBeFalse();
});

// ─── Diagnostic: show counts for troubleshooting ──────────────────────────────

console.log("\n=== Diagnostic counts ===");

function diagnose(label, message) {
  if (!message) {
    console.log(`  ${label}: message is falsy`);
    return;
  }
  const clean = message.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const mdHeadings = (clean.match(/^#{1,3}\s+.+/gm) || []).length;
  const boldHeaders = (clean.match(/^\*\*[^*\n]+\*\*:?\s*$/gm) || []).length;
  const numberedBold = (clean.match(/^\d+\.\s+\*\*[^*\n]+/gm) || []).length;
  const wordCount = clean
    .replace(/[#*`[\]()!]/g, " ")
    .split(/\s+/)
    .filter(Boolean).length;
  const result = isReportContent(message);
  console.log(
    `  ${label}: md=${mdHeadings} bold=${boldHeaders} numBold=${numberedBold} words=${wordCount} → ${result ? "✓ REPORT" : "✗ not a report"}`
  );
}

diagnose("MD heading report        ", MD_HEADING_REPORT);
diagnose("Bold header report       ", BOLD_HEADER_REPORT);
diagnose("Mixed report             ", MIXED_REPORT);
diagnose("Think-wrapped report     ", THINK_WRAPPED_REPORT);
diagnose("Vietnamese viol. report  ", VIETNAMESE_VIOLATION_REPORT);
diagnose("Plain prose              ", PLAIN_PROSE);
diagnose("Short with headings      ", SHORT_WITH_HEADINGS);
diagnose("Single heading long      ", SINGLE_HEADING_LONG);
diagnose("Numbered list no bold    ", NUMBERED_LIST_NO_BOLD);
diagnose("Table only               ", TABLE_ONLY);

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
