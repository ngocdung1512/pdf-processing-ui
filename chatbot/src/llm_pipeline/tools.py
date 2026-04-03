"""
LangChain Tools - 3 tools for the Agent.

1. chat_tool: Q&A + summarize (RAG-based)
2. compare_tool: Compare two documents 
3. edit_tool: Modify document content → JSON output → doc surgery → .docx file
"""
import json
import os
from pathlib import Path
from typing import Optional
import contextvars
import re

from langchain_core.tools import tool

from llm_pipeline import vector_store
from llm_pipeline import llm_engine
from llm_pipeline import doc_surgery

# Context variable to hold doc_ids for the current API request
current_request_doc_ids = contextvars.ContextVar("current_request_doc_ids", default=None)
# Optional override for chat_tool: None = infer from message (regex heuristics); else force mode
current_reply_depth = contextvars.ContextVar("current_reply_depth", default=None)

# ─────────────────────────────────────────────────────────────
# Store for document metadata (doc_id → file_name, docx_path)
# Populated during upload. Shared across tools.
# ─────────────────────────────────────────────────────────────
_doc_registry: dict[str, dict] = {}

# Summary/detail detection: regex heuristics (not fixed prompts). Synonyms can be extended here;
# clients may bypass via ChatRequest.reply_depth != "auto".
_TECHNICAL_PREFIX_RE = re.compile(
    r"^\s*\[(?:Table_\d+_Cell_\d+_\d+|Para_\d+|Table_\d+)[^\]]*\]\s*[:\-]?\s*",
    re.IGNORECASE,
)
_TECHNICAL_GLOBAL_RE = re.compile(
    r"\[(?:Table_\d+_Cell_\d+_\d+|Para_\d+|Table_\d+)[^\]]*\]",
    re.IGNORECASE,
)
_TECHNICAL_TABLE_META_RE = re.compile(
    r"\(Table:\s*Table_\d+,\s*Row\s*\d+,\s*Col\s*\d+\)\s*:?\s*",
    re.IGNORECASE,
)
# Fallback label used when indexing table_cell without full context window
_TECHNICAL_ROW_COL_BRACKET_RE = re.compile(
    r"\[Table_\d+\s+Row\s+\d+\s+Col\s+\d+\]\s*:?\s*",
    re.IGNORECASE,
)
_BROAD_COVERAGE_QUERY_RE = re.compile(
    r"(toàn\s*bộ|đầy\s*đủ|trình\s*bày\s*toàn|trình\s*bày\s*chi\s*tiết|"
    r"đầy\s*đủ\s*nội\s*dung|liệt\s*kê|danh\s*sách|"
    r"nguyên\s*văn|mọi\s*đoạn|mọi\s*nội\s*dung|"
    r"từ\s*đầu\s*đến\s*cuối|full\s*text|entire\s*document|complete\s*content|"
    r"copy\s*hết|in\s*ra\s*hết|chi\s*tiết\s*từng|không\s*bỏ\s*sót|"
    r"phục\s*hồi\s*nội\s*dung|soạn\s*thảo|dự\s*thảo|viết\s*thành\s*văn\s*bản|"
    r"\d+\s*trang|khổ\s*a4|mẫu\s*văn\s*bản)",
    re.IGNORECASE,
)
_SUMMARY_INTENT_QUERY_RE = re.compile(
    r"(tóm\s*tắt|tóm\s*lược|\bskim\b|\bbrief\b|\bsummary\b|\bsummarize\b|"
    r"ngắn\s*gọn|súc\s*tích|chỉ\s*ý\s*chính|nêu\s*ý\s*chính|"
    r"tổng\s*quan\s*ngắn|\boverview\b)",
    re.IGNORECASE,
)
_STRONG_DETAIL_HINT_RE = re.compile(
    r"(trình\s*bày\s*chi\s*tiết|đầy\s*đủ\s*nội\s*dung|nguyên\s*văn|"
    r"toàn\s*bộ\s*nội\s*dung|không\s*bỏ\s*sót|liệt\s*kê\s*đầy\s*đủ|"
    r"soạn\s*thảo|dự\s*thảo|khổ\s*a4|\d+\s*trang)",
    re.IGNORECASE,
)
# Triggers JSON+repair multi-pass (heavy). Keep narrow so generic "liệt kê / list" stays single-pass.
_STRUCTURED_EXTRACTION_QUERY_RE = re.compile(
    r"(bảng|thống\s*kê|trích\s*xuất|csv|excel|cột|hàng|\btable\b|extract)",
    re.IGNORECASE,
)


def _fulltext_char_limit(num_docs: int, is_structured: bool) -> int:
    """How much indexed text to pass in one prompt before falling back to RAG — tune via env, not fixed phrases."""
    try:
        single = int(os.environ.get("CHATBOT_FULLTEXT_MAX_CHARS", "400000"))
    except ValueError:
        single = 400000
    try:
        multi = int(os.environ.get("CHATBOT_FULLTEXT_MAX_CHARS_MULTI", "150000"))
    except ValueError:
        multi = 150000
    if is_structured:
        single = max(single, 120000)
        multi = max(multi, 120000)
    return single if num_docs <= 1 else multi
_REMEDIATION_KEYWORDS = [
    "biện pháp khắc phục",
    "khắc phục hậu quả",
    "biện pháp xử lý",
    "xử lý",
    "thu giữ",
    "niêm phong",
    "củng cố hồ sơ",
    "lập biên bản",
    "biên bản vi phạm",
    "ra quyết định",
    "đang điều tra",
    "xác minh vụ việc",
    "tiếp tục điều tra",
    "xử phạt vi phạm hành chính",
]


def _remediation_keywords_for_search() -> list[str]:
    """Subset of keywords for extra RAG hits — full list is slow (many Chroma queries per doc)."""
    try:
        n = int(os.environ.get("CHATBOT_REMEDIATION_KEYWORD_LIMIT", "6"))
    except ValueError:
        n = 6
    if n <= 0:
        return []
    return _REMEDIATION_KEYWORDS[:n]


def _clean_technical_markers(text: str) -> str:
    """Remove internal parser markers (Table_x_Cell_y_z, Para_x, ...) from user-facing context."""
    if not text:
        return ""
    cleaned_lines = []
    for line in text.splitlines():
        cleaned = _TECHNICAL_GLOBAL_RE.sub("", line)
        cleaned = _TECHNICAL_TABLE_META_RE.sub("", cleaned)
        cleaned = _TECHNICAL_ROW_COL_BRACKET_RE.sub("", cleaned)
        cleaned = _TECHNICAL_PREFIX_RE.sub("", cleaned)
        cleaned = re.sub(r"\s{2,}", " ", cleaned).strip()
        if cleaned:
            cleaned_lines.append(cleaned)
    return "\n".join(cleaned_lines)


def sanitize_user_facing_llm_text(text: str) -> str:
    """Strip internal element labels from any model/tool output before returning to the client."""
    return _clean_technical_markers(text or "")


def _is_structured_extraction_query(query: str) -> bool:
    """Heuristic check for table/list extraction style requests."""
    return bool(_STRUCTURED_EXTRACTION_QUERY_RE.search(str(query or "")))


def _wants_broad_document_coverage(query: str) -> bool:
    """User likely wants long / contiguous text, not a short RAG sample."""
    return bool(_BROAD_COVERAGE_QUERY_RE.search(str(query or "")))


def _reply_depth_mode(query: str) -> str:
    """
    summary  → tóm tắt / ngắn (kể cả "tóm tắt toàn bộ ý" nếu không đòi hỏi nguyên văn đầy đủ).
    detail   → trình bày chi tiết, đầy đủ nội dung, nguyên văn, không bỏ sót, v.v.
    balanced → không rõ; bám sát câu hỏi.

    API may set current_reply_depth to skip keyword heuristics (explicit control).
    """
    override = current_reply_depth.get()
    if override in ("summary", "detail", "balanced"):
        return override
    q = str(query or "")
    summary_hit = bool(_SUMMARY_INTENT_QUERY_RE.search(q))
    broad = _wants_broad_document_coverage(q)
    if summary_hit and broad and _STRONG_DETAIL_HINT_RE.search(q):
        return "detail"
    if _STRONG_DETAIL_HINT_RE.search(q):
        return "detail"
    if summary_hit and broad:
        return "summary"
    if summary_hit:
        return "summary"
    if broad:
        return "detail"
    return "balanced"


def _word_table_fidelity_block() -> str:
    """Always-on: user expects facts from Word tables, not paraphrased-invented summaries."""
    return """
=== TRÍCH / TỔNG HỢP BẢNG TỪ FILE WORD (luôn áp dụng) ===
- **Nội dung thông tin** (số tiền, họ tên, đơn vị, mức phạt, căn cứ pháp lý, trạng thái, mô tả hành vi) phải **lấy từ chữ trong tài liệu**; chỉ được **đổi cách diễn đạt câu từ** khi **không làm sai** số, tên, hoặc ý nghĩa pháp lý.
- **Cấm bịa:** không thêm vụ, không thêm dòng, không điền số/tên/căn cứ **không có** trong nguồn; không gộp hai vụ thành một, không gán nhầm dữ liệu giữa các hàng.
- **Cấm bỏ sót** hàng trong bảng **khi** phần "NỘI DUNG TÀI LIỆU" đã chứa đủ các hàng đó (bản liên tục). Nếu ngữ cảnh chỉ là **trích đoạn** và không đủ để khớp toàn bộ bảng gốc, **phải nói rõ** là đang thiếu phần nào / không đủ dòng so với file — **không** tự chế thêm cho khớp.
- Ô trống hoặc “Chưa cập nhật” / “Chưa xác định” trong Word → giữ đúng hoặc ghi *chưa có trong tài liệu*, không thay bằng giá trị “cho đẹp”.
- **Trích nguyên văn / không bịa** = **không thêm** dữ kiện không có trong file và **không lược bỏ** đoạn nào **đã có** trong phần "NỘI DUNG TÀI LIỆU" bên dưới. **Không** hiểu nhầm là chỉ trả lời vài gạch đầu dòng ngắn: nếu ngữ cảnh là **bản liên tục / đủ đoạn**, hãy trình bày **đủ các phần** theo thứ tự (đoạn văn, mục, bảng). Chỉ **rút gọn có chủ đích** khi người dùng **yêu cầu tóm tắt** hoặc hệ thống đang ở chế độ tóm tắt.
- Cột **biện pháp khắc phục hậu quả** (và cột tương đương): **không** thay toàn bộ bằng dấu "-" hoặc bỏ trống nếu trong nguồn (cùng hàng hoặc ô được **merge dọc** đã được điền xuống trong ngữ cảnh) **có** chữ; chỉ dùng "-" khi trong nguồn **thực sự** là gạch ngang/trống.
- **Không gộp nhiều đoạn thành một khối tóm tắt** khi người dùng muốn chi tiết/đầy đủ: mỗi đoạn văn trong nguồn (mỗi khối xuống dòng trong phần tài liệu) **tương ứng ít nhất một đoạn hoặc một mục riêng** trong câu trả lời — **không** viết kiểu "Para_6 đến Para_71: …" một câu chung. Không lặp mã nội bộ `[Para_…]`.
"""


def _strict_source_facts_block() -> str:
    """When CHATBOT_STRICT_SOURCE_FACTS=1, extra tightening (audit-style)."""
    if str(os.environ.get("CHATBOT_STRICT_SOURCE_FACTS", "")).lower() not in (
        "1",
        "true",
        "yes",
    ):
        return ""
    return """
=== SIẾT THÊM (CHATBOT_STRICT_SOURCE_FACTS=1) ===
- Ưu tiên **trích nguyên văn** các trường nhạy cảm (số tiền, số hiệu văn bản, tên riêng) khi có thể — **không** dùng điều này để **cắt ngắn** câu trả lời; vẫn phải **bao phủ toàn bộ** đoạn có trong ngữ cảnh khi người dùng cần báo cáo / trình bày đầy đủ.
- Mỗi ô trong bảng trả lời phải **truy về** một phần nguồn tương ứng; nếu không truy được thì ghi *không thấy trong tài liệu đã cung cấp*.
"""


def _depth_scope_instruction(mode: str) -> str:
    if mode == "summary":
        return """=== ƯU TIÊN ĐỘ DÀI (theo câu hỏi) ===
Người dùng muốn **TÓM TẮT / TRÌNH BÀY NGẮN**. Hãy trả lời **gọn**, **ưu tiên ý chính**, có thể dùng gạch đầu dòng hoặc vài đoạn ngắn; **không** trích lại toàn văn từng đoạn dài và **không** dựng bảng Markdown đầy đủ từng hàng trừ khi họ hỏi **riêng** về bảng/số liệu. Vẫn **không được bịa**; số, ngày, tên cơ quan then chốt giữ đúng nguồn nếu có."""
    if mode == "detail":
        return """=== ƯU TIÊN ĐỘ DÀI (theo câu hỏi) ===
Người dùng muốn **CHI TIẾT / ĐẦY ĐỦ**. Trình bày **đủ phạm vi** theo **thứ tự** trong tài liệu, **không bỏ sót** khối nội dung lớn ở giữa khi phần "NỘI DUNG TÀI LIỆU" là bản **liên tục**; bảng → Markdown hoặc **Ý 1, Ý 2…** như mục 7a. Nếu ngữ cảnh chỉ là trích đoạn, nói rõ phần nào có/không có.
**Không gộp đoạn:** khi nguồn có **nhiều đoạn văn liên tiếp**, **không** tóm gọn thành một đoạn duy nhất hay một khối "Para_6–71" kiểu tóm tắt — hãy **mỗi đoạn nguồn = một đoạn (hoặc một gạch đầu dòng) riêng**, giữ đủ câu chữ có trong nguồn. **Không** dùng nhãn kỹ thuật `[Para_…]` / `[Table_…]` trong câu trả lời.
Nếu người dùng yêu cầu **soạn thảo/dự thảo theo độ dài** (ví dụ: "4 trang A4"), ưu tiên xuất bản thảo **đủ độ dài mục tiêu** với cấu trúc văn bản hành chính rõ ràng thay vì trả lời ngắn."""
    return """=== ƯU TIÊN ĐỘ DÀI (theo câu hỏi) ===
**Cân đối:** bám đúng độ sâu câu hỏi — không kéo dài dư thừa nếu họ chỉ hỏi một điểm hẹp; cũng không tóm lược quá mức nếu họ hỏi nhiều khía cạnh hoặc yêu cầu cụ thể."""


def _dedupe_results(results: list[dict]) -> list[dict]:
    seen = set()
    output = []
    for r in results:
        meta = r.get("metadata", {}) if isinstance(r, dict) else {}
        key = (
            meta.get("file_name"),
            meta.get("element_id"),
            meta.get("table_id"),
            meta.get("row"),
            meta.get("col"),
            (r.get("content", "") if isinstance(r, dict) else "")[:180],
        )
        if key in seen:
            continue
        seen.add(key)
        output.append(r)
    return output


def _extract_json_object(text: str) -> Optional[dict]:
    """Best-effort parse first JSON object from model output."""
    if not text:
        return None
    candidate = str(text).strip()
    try:
        parsed = json.loads(candidate)
        return parsed if isinstance(parsed, dict) else None
    except Exception:
        pass

    start = candidate.find("{")
    end = candidate.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return None
    snippet = candidate[start : end + 1]
    try:
        parsed = json.loads(snippet)
        return parsed if isinstance(parsed, dict) else None
    except Exception:
        return None


def _safe_md_cell(value: str) -> str:
    return str(value or "").replace("\n", " ").replace("|", "\\|").strip()


def _records_to_markdown(headers: list[str], records: list[dict]) -> str:
    """Render validated records to markdown table."""
    if not headers or not records:
        return ""
    header_row = "| " + " | ".join(_safe_md_cell(h) for h in headers) + " |"
    sep_row = "|" + "|".join(["---"] * len(headers)) + "|"
    body_rows = []
    for rec in records:
        cells = rec.get("cells", [])
        if not isinstance(cells, list) or len(cells) != len(headers):
            continue
        body_rows.append("| " + " | ".join(_safe_md_cell(c) for c in cells) + " |")
    if not body_rows:
        return ""
    return "\n".join([header_row, sep_row, *body_rows])


def register_document(doc_id: str, file_name: str, docx_path: str):
    """Register a document for tool access."""
    _doc_registry[doc_id] = {
        "file_name": file_name,
        "docx_path": docx_path,
    }


def get_doc_info(doc_id: str) -> Optional[dict]:
    """Get document info from registry."""
    return _doc_registry.get(doc_id)


def get_all_doc_ids() -> list[str]:
    """Get all registered document IDs."""
    return list(_doc_registry.keys())


def _doc_ids_are_pdf_only(doc_ids: list[str]) -> bool:
    """True when every scoped document was uploaded as .pdf (converted to docx internally). Word paths unchanged."""
    if not doc_ids:
        return False
    for doc_id in doc_ids:
        info = get_doc_info(doc_id)
        if not info:
            return False
        if Path(info.get("file_name", "")).suffix.lower() != ".pdf":
            return False
    return True


# ─────────────────────────────────────────────────────────────
# Tool 1: Chat (Q&A + Summarize)
# ─────────────────────────────────────────────────────────────

@tool
def chat_tool(query: str) -> str:
    """Trả lời câu hỏi hoặc tóm tắt nội dung tài liệu đã upload.
    Dùng khi hỏi nội dung, tóm tắt, trích xuất, lập bảng/thống kê từ tài liệu.
    Khi trích nhiều trường hợp: cần đủ các bản ghi liên quan trong phạm vi câu hỏi và giữ mỗi hàng nhất quán (cùng một vụ việc)."""
    
    # Priority: doc_ids from current request > all registered doc_ids
    req_docs = current_request_doc_ids.get()
    doc_ids = req_docs if req_docs is not None else get_all_doc_ids()
    
    if not doc_ids:
        return "Chưa có tài liệu nào được chỉ định để trả lời câu hỏi. Vui lòng kiểm tra lại tải lên."

    pdf_only = _doc_ids_are_pdf_only(doc_ids)

    # First, try to fetch the FULL text for all selected documents
    # to avoid context fragmentation (especially useful for tables/statistics across multiple files).
    full_text_mode = True
    all_texts = []
    total_length = 0
    
    for doc_id in doc_ids:
        doc_info = get_doc_info(doc_id)
        if not doc_info:
            continue
        
        file_name = doc_info.get("file_name", "unknown")
        doc_text = _clean_technical_markers(vector_store.get_document_text(doc_id))
        
        doc_block = f"--- TÀI LIỆU: {file_name} ---\n{doc_text}\n"
        all_texts.append(doc_block)
        total_length += len(doc_block)
    
    is_structured_query = _is_structured_extraction_query(query)
    depth_mode = _reply_depth_mode(query)
    SAFE_CHAR_LIMIT = _fulltext_char_limit(len(doc_ids), is_structured_query)
    # PDF-only: prefer staying on full extracted text (same spirit as "old long" chatbot).
    # Does not apply when any Word doc is in scope.
    if pdf_only:
        try:
            single_pdf = int(os.environ.get("CHATBOT_PDF_FULLTEXT_MAX_CHARS", "1200000"))
        except ValueError:
            single_pdf = 1_200_000
        try:
            multi_pdf = int(os.environ.get("CHATBOT_PDF_FULLTEXT_MAX_CHARS_MULTI", "600000"))
        except ValueError:
            multi_pdf = 600_000
        floor = single_pdf if len(doc_ids) <= 1 else multi_pdf
        SAFE_CHAR_LIMIT = max(SAFE_CHAR_LIMIT, floor)
    # "Toàn bộ / đầy đủ" + detail: raise cap so we stay on FULL TEXT (ordered) instead of
    # semantic RAG — RAG returns scattered chunks → holes like Para_5 … Para_67.
    if _wants_broad_document_coverage(query) and depth_mode == "detail":
        try:
            mult = float(os.environ.get("CHATBOT_BROAD_FULLTEXT_MULT", "3"))
        except ValueError:
            mult = 3.0
        try:
            cap = int(os.environ.get("CHATBOT_BROAD_FULLTEXT_CAP", "1200000"))
        except ValueError:
            cap = 1_200_000
        if len(doc_ids) == 1:
            SAFE_CHAR_LIMIT = min(cap, int(SAFE_CHAR_LIMIT * mult))
        elif len(doc_ids) <= 3:
            SAFE_CHAR_LIMIT = min(cap, int(SAFE_CHAR_LIMIT * 2))

    if total_length > 0 and total_length <= SAFE_CHAR_LIMIT:
        print(
            f"[chat_tool] Using FULL TEXT extraction. Total length: {total_length} chars. pdf_only={pdf_only}",
            flush=True,
        )
        context = "\n".join(all_texts)
    else:
        # Fallback to RAG if documents are too large
        full_text_mode = False
        print(
            f"[chat_tool] Documents too large ({total_length} chars). Falling back to RAG. pdf_only={pdf_only}",
            flush=True,
        )
        
        # Broad RAG bump only when user wants full detail (not tóm tắt-only)
        wants_broad = (
            _wants_broad_document_coverage(query) and depth_mode == "detail"
        )
        if len(doc_ids) == 1:
            top_k_per_doc = 28 if is_structured_query else 22
        elif len(doc_ids) <= 3:
            top_k_per_doc = 16 if is_structured_query else 10
        elif len(doc_ids) <= 6:
            top_k_per_doc = 10 if is_structured_query else 6
        else:
            top_k_per_doc = 8 if is_structured_query else 4
        if wants_broad:
            bump = 50 if len(doc_ids) == 1 else 28
            cap = 120 if is_structured_query else 100
            top_k_per_doc = min(cap, top_k_per_doc + bump)
        if pdf_only:
            try:
                pdf_extra = int(os.environ.get("CHATBOT_PDF_RAG_TOPK_EXTRA", "24"))
            except ValueError:
                pdf_extra = 24
            top_k_per_doc = min(
                140 if is_structured_query else 120,
                top_k_per_doc + max(0, pdf_extra),
            )

        all_results = []
        for doc_id in doc_ids:
            results = vector_store.search(query, doc_ids=[doc_id], top_k=top_k_per_doc)
            all_results.extend(results)

            # Structured extraction often misses remediation details unless we
            # pull dedicated remediation-related snippets.
            if is_structured_query:
                for kw in _remediation_keywords_for_search():
                    kw_results = vector_store.search(
                        kw,
                        doc_ids=[doc_id],
                        top_k=max(4, top_k_per_doc // 2),
                    )
                    all_results.extend(kw_results)
        all_results = _dedupe_results(all_results)
            
        if not all_results:
            return "Không tìm thấy thông tin liên quan trong tài liệu."
        
        # Separate paragraphs and table cells for proper reconstruction
        para_parts = []
        table_cells_by_table = {}  # (file_name, table_id) -> {(row, col): content}
        table_max_dims = {}  # (file_name, table_id) -> (max_row, max_col)
        
        for r in all_results:
            meta = r.get("metadata", {})
            file_name = meta.get("file_name", "unknown")
            element_id = meta.get("element_id", "?")
            element_type = meta.get("element_type", "")
            content = meta.get("original_content", "") or r.get("content", "")
            
            if element_type == "table_cell":
                table_id = meta.get("table_id", "")
                row = meta.get("row", 0)
                col = meta.get("col", 0)
                key = (file_name, table_id)
                
                if key not in table_cells_by_table:
                    table_cells_by_table[key] = {}
                    table_max_dims[key] = (-1, -1)
                
                table_cells_by_table[key][(row, col)] = content
                mr, mc = table_max_dims[key]
                table_max_dims[key] = (max(mr, row), max(mc, col))
            else:
                para_parts.append(_clean_technical_markers(content))
        
        # Reconstruct table cells into Markdown tables
        for (file_name, table_id), cells in table_cells_by_table.items():
            max_row, max_col = table_max_dims[(file_name, table_id)]
            para_parts.append("\nBảng dữ liệu (trích xuất):")
            for row in range(max_row + 1):
                row_parts = []
                for col in range(max_col + 1):
                    cell_text = cells.get((row, col), "...")
                    cell_text = cell_text.replace("\n", " ").strip()
                    row_parts.append(cell_text)
                para_parts.append("| " + " | ".join(row_parts) + " |")
                if row == 0:
                    para_parts.append("|" + "|".join(["---"] * (max_col + 1)) + "|")
            
        context = "\n".join(para_parts)
    
    scope_block = _depth_scope_instruction(depth_mode)
    fidelity_block = _word_table_fidelity_block()
    strict_block = _strict_source_facts_block()
    prompt = f"""Dựa trên nội dung tài liệu dưới đây, hãy trả lời câu hỏi.

{scope_block}
{fidelity_block}
{strict_block}
Hướng dẫn:
0. Nguồn sự thật là các tài liệu trong phần "NỘI DUNG TÀI LIỆU" bên dưới, ưu tiên nội dung từ file Word đã upload trong phiên. Không lấy dữ liệu từ file Excel mẫu, bảng tham khảo ngoài phiên, hay "cho khớp" với mẫu — chỉ căn cứ vào chữ trong tài liệu đã cung cấp.
0a. **Không bịa:** không thêm số tiền, tên, hành vi, căn cứ, cơ quan, trạng thái vụ việc từ kiến thức chung hoặc suy đoán khi không có trong nội dung Word/tài liệu đã cho. Thiếu thì nói thẳng là không có trong tài liệu.
0b. Ưu tiên phân tích đúng **nội dung thực tế** trong Word (tên, số tiền, hành vi, trạng thái, căn cứ) cho từng vụ. **Thứ tự dòng hoặc tổng số bản ghi** trong câu trả lời **không** cần trùng file gốc; không được bịa thêm hoặc bỏ sót nội dung có trong nguồn chỉ để “khớp số dòng”.
1. Chỉ dựa trên nội dung trong phần tài liệu; không bịa thêm dữ liệu không có trong đó.
2. Bám sát ý định trong câu hỏi (độ chi tiết, dạng bảng hay đoạn văn, số cột, có/không STT). Không mặc định một schema cố định; nếu nguồn có bao nhiêu cột thì bám cấu trúc đó.
2b. **Diễn đạt linh hoạt**: có thể diễn giải tự nhiên bằng tiếng Việt trong ô/bảng miễn **không đổi nghĩa** và **đúng cột** so với nguồn; không cần copy nguyên văn từng từ trừ khi đó là số tiền, tên riêng, trích dẫn văn bản pháp lý.
2c. **Bám ý người dùng về phạm vi**: họ có thể diễn đạt theo nhiều cách (tóm tắt, chi tiết, lần lượt, toàn bộ, từng phần, mục nào…). Nếu họ muốn **phạm vi rộng hoặc đầy đủ**, hãy **theo thứ tự trong tài liệu** và **không bỏ sót khối nội dung lớn ở giữa** khi phần "NỘI DUNG TÀI LIỆU" là bản liên tục. Nếu phần ngữ cảnh dưới đây rõ ràng chỉ là **các trích đoạn** (không đủ liên tục), hãy **nói thẳng** là đang thiếu phần giữa và mô tả ngắn phần nào có/không có; gợi ý họ tiếp tục bằng câu hỏi theo **mục/trang/đoạn** cụ thể.
3. Khi trích xuất nhiều trường hợp (danh sách, bảng, thống kê): cố gắng bao phủ toàn bộ trường hợp có trong tài liệu thuộc phạm vi câu hỏi; không bỏ sót trừ khi người dùng giới hạn rõ (ví dụ chỉ một đơn vị).
4. Mỗi hàng của bảng (mỗi bản ghi): các cột phải cùng mô tả một trường hợp duy nhất như trong nguồn — không gán nhầm dữ liệu giữa các vụ.
5. Ưu tiên giữ nguyên giá trị gốc cho các trường quan trọng (số tiền, ngày tháng, tên riêng, điều khoản, cơ quan, trạng thái). Nếu không chắc, ghi "chưa rõ trong tài liệu" hoặc giữ nguyên trạng thái mơ hồ của nguồn (ví dụ: "Chưa cập nhật", "Chưa nêu rõ", "Đang xử lý"), tuyệt đối không suy đoán.
5b. Ưu tiên **tiếng Việt**; tránh xen tiếng Anh không cần thiết (vd. không đổi "trường hợp" thành "case"). **Phân loại cột** đúng như nguồn: tiền phạt / căn cứ / biện pháp — không gộp nhầm giữa các cột.
5c. **Giọng điệu:** trình bày **trang trọng, lịch sự**; **không** dùng emoji, emoticon hay ký hiệu cảm xúc trang trí; chỉ giữ ký tự đó nếu **trích nguyên văn** từ tài liệu nguồn.
6. Chỉ rút gọn/diễn giải khi người dùng yêu cầu tóm tắt; còn trích xuất bảng thì ưu tiên trung thành nội dung.
7. Nếu tài liệu có bảng Markdown (| và ---), đọc theo hàng/cột tương ứng.
7a. **Cách hiển thị bảng trong khung chat (cho người đọc):** ưu tiên **một bảng Markdown** (`|`, hàng phân cách `---`). Nếu cột khó tách, nguồn là trích đoạn rời, hoặc bảng quá rộng, hãy **liệt kê theo ý** — **Ý 1**, **Ý 2**, … (hoặc gạch đầu dòng), mỗi mục ghi rõ từng trường bằng nhãn tiếng Việt bám nguồn (vd. *Nội dung:* …, *Căn cứ:* …, *Đơn vị:* …). Không dùng từ tiếng Anh *row*, *cell*, *table index* và không lặp mã nội bộ (đã nêu ở mục 12).
7b. **Không để trống do ô merge:** nếu một nhóm nhiều người/bản ghi dùng chung giá trị cột (đơn vị, hành vi, mức phạt, biện pháp, căn cứ, cơ quan...), hãy **lặp lại đầy đủ** giá trị đó ở **từng dòng** trong đầu ra (mỗi người = một dòng riêng), **không** để ô trống chỉ vì nguồn gốc được merge theo chiều dọc.
8. Trước khi trả lời, tự kiểm tra: (a) có dòng nào tự thêm từ suy luận không, (b) có hàng nào trộn thông tin giữa 2 vụ không. Nếu có nghi ngờ, giữ nguyên theo nguồn hoặc ghi chưa rõ.
9. Không sử dụng kiến thức ngoài tài liệu để "điền thiếu" căn cứ pháp lý, cơ quan, mức phạt, hoặc chi tiết vụ việc.
10. Không được suy từ "ghi chú chung" để điền hàng loạt cho nhiều dòng. Mỗi dòng phải bám chứng cứ của chính vụ đó trong nguồn.
11. Chỉ dùng các cụm như "không ghi rõ/chưa rõ trong tài liệu" khi đã kiểm tra nguồn của đúng vụ đó mà không thấy thông tin.
12. **Không** lặp mã nội bộ như `[Para_0]`, `[Table_0_Cell_1_2]`, hay `(Table: Table_0, Row 0, Col 0):` trong câu trả lời; chỉ dùng văn bản thường hoặc bảng Markdown.

=== NỘI DUNG TÀI LIỆU ===
{context}

=== CÂU HỎI ===
{query}

=== TRẢ LỜI ==="""
    
    try:
        chat_max_tokens = int(os.environ.get("CHATBOT_CHAT_MAX_NEW_TOKENS", "8192"))
    except ValueError:
        chat_max_tokens = 8192
    if depth_mode == "summary":
        try:
            summary_cap = int(os.environ.get("CHATBOT_SUMMARY_MAX_NEW_TOKENS", "3072"))
        except ValueError:
            summary_cap = 3072
        eff_max_tokens = max(512, min(summary_cap, chat_max_tokens))
    else:
        eff_max_tokens = max(1024, chat_max_tokens)
    print(
        f"[chat_tool] depth_mode={depth_mode} max_new_tokens={eff_max_tokens}",
        flush=True,
    )
    first_pass = llm_engine.generate_raw(
        prompt,
        temperature=0.15,
        top_p=0.85,
        max_new_tokens=eff_max_tokens,
    )

    # For extraction/table-like requests, run a second-pass repair to prevent
    # cross-record mixing (unit/person/violation from different cases).
    if not is_structured_query:
        return sanitize_user_facing_llm_text(first_pass)

    # Multi-pass (JSON + repair) roughly triples latency vs a single generate_raw.
    # Set CHATBOT_FAST_EXTRACTION=1 to skip JSON/repair when speed matters more than max accuracy.
    if str(os.environ.get("CHATBOT_FAST_EXTRACTION", "")).lower() in (
        "1",
        "true",
        "yes",
    ):
        print("[chat_tool] CHATBOT_FAST_EXTRACTION: single-pass only.", flush=True)
        return sanitize_user_facing_llm_text(first_pass)

    json_extract_prompt = f"""Bạn là bộ trích xuất dữ liệu chính xác từ tài liệu.

Nhiệm vụ:
- Trả về DUY NHẤT JSON object hợp lệ theo schema bên dưới.
- Mỗi dòng dữ liệu phải có evidence trích nguyên văn từ nguồn.
- Không có evidence thì KHÔNG được đưa dòng đó vào records.
- Thứ tự phần tử trong "records" không cần trùng thứ tự trong file Word; quan trọng là mỗi record đúng nội dung nguồn.

Schema bắt buộc:
{{
  "headers": ["<tên cột 1>", "<tên cột 2>", "..."],
  "records": [
    {{
      "cells": ["<giá trị cột 1>", "<giá trị cột 2>", "..."],
      "evidence": ["<trích dẫn nguồn 1>", "<trích dẫn nguồn 2>"]
    }}
  ]
}}

Ràng buộc:
1. len(cells) phải bằng len(headers) cho mọi record.
2. Không trộn thông tin giữa các vụ.
3. Không tự chuẩn hóa làm đổi nghĩa dữ liệu nguồn.
4. Không thêm phần ghi chú, không markdown, không text ngoài JSON.

=== NỘI DUNG TÀI LIỆU ===
{context}

=== YÊU CẦU GỐC ===
{query}

=== BẢN NHÁP THAM CHIẾU (có thể sai) ===
{first_pass}

=== JSON KẾT QUẢ ==="""

    json_pass = llm_engine.generate_raw(json_extract_prompt, temperature=0.0, top_p=0.7)
    parsed = _extract_json_object(json_pass)
    if parsed:
        headers = parsed.get("headers", [])
        records = parsed.get("records", [])
        if isinstance(headers, list) and isinstance(records, list):
            valid_headers = [str(h).strip() for h in headers if str(h).strip()]
            valid_records = []
            for rec in records:
                if not isinstance(rec, dict):
                    continue
                cells = rec.get("cells", [])
                evidence = rec.get("evidence", [])
                if (
                    isinstance(cells, list)
                    and isinstance(evidence, list)
                    and len(cells) == len(valid_headers)
                    and len(valid_headers) > 0
                    and len([e for e in evidence if str(e).strip()]) > 0
                ):
                    valid_records.append(
                        {
                            "cells": [str(c).strip() for c in cells],
                            "evidence": [str(e).strip() for e in evidence if str(e).strip()],
                        }
                    )
            markdown = _records_to_markdown(valid_headers, valid_records)
            if markdown:
                return sanitize_user_facing_llm_text(markdown)

    repair_prompt = f"""Bạn là bộ kiểm định kết quả trích xuất dữ liệu.

Mục tiêu:
- Sửa bản nháp để KHÔNG trộn thông tin giữa các vụ.
- Mỗi hàng chỉ được mô tả một vụ duy nhất từ tài liệu nguồn.
- Không bịa thêm chi tiết không có trong file Word/tài liệu; không đủ chắc thì giữ nguyên chữ nguồn hoặc ghi "chưa rõ trong tài liệu".
- Ưu tiên GIỮ NGUYÊN cách ghi trong nguồn cho các trường định danh/chính xác.
- Độ chính xác nội dung từng vụ quan trọng hơn việc giữ đúng thứ tự xuất hiện trong tài liệu.

Quy tắc bắt buộc:
1. Không gộp 2 người/vụ khác nhau vào cùng một hàng nếu nguồn không ghi như vậy.
2. Không chuyển vụ sang sai đơn vị/cơ quan.
3. Trường số liệu và căn cứ pháp lý: chỉ dùng khi có trong nguồn cho đúng vụ đó.
4. Tên đơn vị, viết tắt (vd. CAX): giữ như nguồn hoặc diễn đạt tương đương rõ nghĩa **nếu** không làm sai lệch vụ việc; tránh đổi tự do khiến khác với chứng cứ trong tài liệu.
5. Không đổi trạng thái mơ hồ trong nguồn ("Chưa cập nhật", "Chưa nêu rõ", "Đang xử lý", "-") thành giá trị cụ thể hơn.
6. Không tự thay đơn vị tiền tệ/định dạng số nếu không có yêu cầu.
6b. Giữ tiếng Việt tự nhiên; tránh tiếng Anh thừa. Đảm bảo nội dung mỗi cột đúng vai trò (tiền / biện pháp / căn cứ) như nguồn.
7. Giữ định dạng mà người dùng yêu cầu (bảng/đoạn văn). Nếu là bảng, giữ tính nhất quán cột theo toàn bảng.
8. Chỉ trả về phiên bản đã sửa cuối cùng, không giải thích.
9. Không thêm phần "Ghi chú/nhận xét/tổng quát" nếu người dùng không yêu cầu rõ.

=== NỘI DUNG TÀI LIỆU ===
{context}

=== YÊU CẦU GỐC ===
{query}

=== BẢN NHÁP CẦN KIỂM ĐỊNH ===
{first_pass}

=== KẾT QUẢ CUỐI CÙNG ==="""

    return sanitize_user_facing_llm_text(
        llm_engine.generate_raw(repair_prompt, temperature=0.0, top_p=0.7)
    )


# ─────────────────────────────────────────────────────────────
# Tool 2: Compare
# ─────────────────────────────────────────────────────────────

@tool
def compare_tool(input_text: str) -> str:
    """So sánh hai tài liệu đã upload và liệt kê các điểm khác biệt.
    Dùng tool này khi người dùng yêu cầu so sánh, đối chiếu hai file.
    Input là yêu cầu so sánh của người dùng (ví dụ: 'so sánh giá giữa 2 file')."""
    
    req_docs = current_request_doc_ids.get()
    doc_ids = req_docs if req_docs is not None else get_all_doc_ids()
    
    if len(doc_ids) < 2:
        return "Cần ít nhất 2 tài liệu để so sánh. Vui lòng kiểm tra lại tải lên."
    
    # Get full content of the two most recent documents in the scoped context
    doc1_id = doc_ids[-2]
    doc2_id = doc_ids[-1]
    
    doc1_info = get_doc_info(doc1_id)
    doc2_info = get_doc_info(doc2_id)
    
    doc1_text = sanitize_user_facing_llm_text(vector_store.get_document_text(doc1_id))
    doc2_text = sanitize_user_facing_llm_text(vector_store.get_document_text(doc2_id))
    
    doc1_name = doc1_info.get("file_name", "File 1") if doc1_info else "File 1"
    doc2_name = doc2_info.get("file_name", "File 2") if doc2_info else "File 2"
    
    prompt = f"""So sánh hai tài liệu sau và liệt kê các điểm khác biệt chi tiết.

=== TÀI LIỆU 1: {doc1_name} ===
{doc1_text}

=== TÀI LIỆU 2: {doc2_name} ===
{doc2_text}

=== YÊU CẦU ===
{input_text}

Hãy liệt kê các điểm khác biệt dưới dạng danh sách rõ ràng, bao gồm:
- Khác biệt về nội dung
- Khác biệt về số liệu/giá cả (nếu có)
- Khác biệt về cấu trúc
- Các điều khoản thêm/bớt (nếu có)

=== KẾT QUẢ SO SÁNH ==="""
    
    return llm_engine.generate_raw(prompt)


# ─────────────────────────────────────────────────────────────
# Tool 3: Edit (Modify document → JSON → doc surgery → .docx)
# ─────────────────────────────────────────────────────────────

@tool
def edit_tool(instruction: str) -> str:
    """Sửa đổi nội dung tài liệu theo yêu cầu, giữ nguyên format gốc.
    Dùng tool này khi người dùng yêu cầu sửa, thay đổi, cập nhật nội dung 
    (ví dụ: 'sửa giá thành 50 triệu', 'đổi tên công ty thành ABC').
    Input là yêu cầu sửa đổi cụ thể."""
    
    req_docs = current_request_doc_ids.get()
    doc_ids = req_docs if req_docs is not None else get_all_doc_ids()
    
    if not doc_ids:
        return "Chưa có tài liệu nào được chỉ định để sửa đổi. Vui lòng kiểm tra lại tải lên."
    
    # Use the most recently uploaded document in the scoped context
    doc_id = doc_ids[-1]
    doc_info = get_doc_info(doc_id)
    
    if not doc_info:
        return "Không tìm thấy thông tin tài liệu."
    
    # Dùng vector_store để tìm các đoạn văn bản liên quan đến yêu cầu sửa đổi
    # Việc này giúp tránh load toàn bộ doc_text gây tràn RAM (OOM) cho GPU
    results = vector_store.search(instruction, doc_ids=[doc_id], top_k=20)
    
    if not results:
        return "Không tìm thấy phần nội dung nào trong tài liệu khớp với yêu cầu sửa đổi."
        
    doc_text_parts = []
    for r in results:
        meta = r.get("metadata", {})
        element_id = meta.get("element_id", "?")
        content = r.get("content", "")
        doc_text_parts.append(f"[{element_id}] {content}")
        
    doc_text = "\n".join(doc_text_parts)
    
    docx_path = doc_info.get("docx_path", "")
    file_name = doc_info.get("file_name", "document")
    
    # Generate JSON modifications using LLM
    prompt = f"""Bạn là hệ thống sửa đổi tài liệu. Dựa trên nội dung tài liệu và yêu cầu sửa đổi,
hãy trả về một JSON object chứa danh sách các thay đổi cần thực hiện.

=== NỘI DUNG TÀI LIỆU (mỗi dòng có format [ID] nội dung) ===
{doc_text}

=== YÊU CẦU SỬA ĐỔI ===
{instruction}

=== QUY TẮC ===
1. Chỉ sửa những phần được yêu cầu, giữ nguyên phần còn lại.
2. Trả về ĐÚNG format JSON sau, KHÔNG giải thích thêm:

```json
{{
  "modifications": [
    {{"id": "element_id ở đây", "new_text": "nội dung mới ở đây"}},
    {{"id": "element_id khác", "new_text": "nội dung mới khác"}}
  ]
}}
```

3. "id" phải là ID chính xác từ tài liệu (ví dụ: "Para_0", "Table_0_Cell_1_2").
4. "new_text" là nội dung mới thay thế cho element đó.

=== JSON OUTPUT ==="""
    
    response = llm_engine.generate_raw(prompt, max_new_tokens=4096)
    
    # Parse JSON from response
    try:
        # Try to extract JSON from response (might be wrapped in code block)
        json_str = response
        if "```json" in json_str:
            json_str = json_str.split("```json")[1].split("```")[0].strip()
        elif "```" in json_str:
            json_str = json_str.split("```")[1].split("```")[0].strip()
        
        modifications = json.loads(json_str)
    except (json.JSONDecodeError, IndexError) as e:
        return f"Lỗi: LLM trả về JSON không hợp lệ. Vui lòng thử lại.\nResponse: {response[:500]}"
    
    # Apply modifications via doc surgery
    try:
        from pathlib import Path
        output_dir = Path(docx_path).parent.parent / "outputs"
        output_dir.mkdir(parents=True, exist_ok=True)
        
        revised_path = doc_surgery.apply_modifications(
            docx_path=docx_path,
            modifications=modifications,
            output_dir=str(output_dir),
        )
        
        return f"✓ Đã sửa đổi tài liệu thành công. File mới: {revised_path}"
    except Exception as e:
        return f"Lỗi khi áp dụng sửa đổi: {str(e)}"


@tool
def batch_rewrite_tool(instruction: str, context: str) -> str:
    """Viết lại (rewrite) TOÀN BỘ nội dung file tự động theo lô (batch).
    Dùng công cụ này KHI người dùng yêu cầu viết lại toàn bộ file, hoặc dựa vào tổng hợp để ghi đè toàn bộ file mẫu.
    Tham số `context` CẦN chứa toàn bộ thông tin/tổng hợp mà bạn muốn dùng để viết lại.
    Tham số `instruction` là yêu cầu cụ thể (vd: 'Viết lại hợp đồng theo format')."""
    
    req_docs = current_request_doc_ids.get()
    doc_ids = req_docs if req_docs is not None else get_all_doc_ids()
    
    if not doc_ids:
        return "Chưa có tài liệu nào được chỉ định để sửa đổi toàn bộ. Vui lòng kiểm tra lại tải lên."
    
    # Lấy tài liệu mới nhất (chính là template format) trong scoped context
    doc_id = doc_ids[-1]
    doc_info = get_doc_info(doc_id)
    if not doc_info:
        return "Không tìm thấy thông tin tài liệu."
    
    # Lấy toàn bộ elements nối tiếp nhau
    elements = vector_store.get_full_document(doc_id)
    if not elements:
        return "Tài liệu trống."
        
    docx_path = doc_info.get("docx_path", "")
    
    # Lọc bỏ các elements trống trơn
    valid_elements = [el for el in elements if el.get("content", "").strip()]
    
    # Chia thành các batch (4 đoạn mỗi batch) để inference song song mà không tràn VRAM
    batch_size = 4
    batches = []
    for i in range(0, len(valid_elements), batch_size):
        batches.append(valid_elements[i:i+batch_size])
        
    print(f"[Batch Rewrite] Bắt đầu xử lý song song {len(batches)} lô (mỗi lô {batch_size} đoạn)...")
    
    # Chuẩn bị prompts song song
    prompts = []
    for batch in batches:
        doc_text_parts = []
        for el in batch:
            eid = el.get("metadata", {}).get("element_id", "?")
            content = el.get("content", "")
            doc_text_parts.append(f"[{eid}] {content}")
            
        doc_text = "\n".join(doc_text_parts)
        
        prompt = f"""Bạn là hệ thống tự động viết lại tài liệu. Dựa trên thông tin tổng hợp (context), hãy viết lại các đoạn văn bản sau sao cho phù hợp, GIỮ NGUYÊN cấu trúc ID.

=== THÔNG TIN TỔNG HỢP (CONTEXT) ===
{context}

=== YÊU CẦU SỬA ĐỔI ===
{instruction}

=== CÁC ĐOẠN VĂN BẢN HIỆN TẠI (mỗi dòng có format [ID] nội dung) ===
{doc_text}

=== QUY TẮC ===
1. Dựa vào thông tin tổng hợp, viết lại hoặc thay thế thông tin trong các đoạn văn bản trên.
2. Trả về ĐÚNG format JSON sau, KHÔNG giải thích thêm:

```json
{{
  "modifications": [
    {{"id": "element_id ở đây", "new_text": "nội dung MỚI đã được viết lại ở đây"}},
    {{"id": "element_id tiếp theo", "new_text": "nội dung MỚI ở đây"}}
  ]
}}
```

3. "id" phải giữ y nguyên từ chữ số trong ngoặc vuông (ví dụ: "Para_0").
4. Nếu một đoạn văn bản KHÔNG chứa thông tin cần thay đổi theo context, hãy giữ nguyên chữ của nó vào "new_text".

=== JSON OUTPUT ==="""
        prompts.append(prompt)
        
    # Chạy song song Tensor (Parallel Inference)
    responses = llm_engine.generate_raw_batch(prompts, max_new_tokens=4096)
    
    all_modifications = []
    for resp in responses:
        try:
            json_str = resp
            if "```json" in json_str:
                json_str = json_str.split("```json")[1].split("```")[0].strip()
            elif "```" in json_str:
                json_str = json_str.split("```")[1].split("```")[0].strip()
            
            mods = json.loads(json_str)
            all_modifications.extend(mods.get("modifications", []))
        except Exception as e:
            print(f"[Batch Rewrite Error] Lỗi parse JSON trong 1 batch: {e}")
            continue
            
    if not all_modifications:
        return "Lỗi: Không thể sinh ra tệp thay đổi JSON tương ứng do lỗi LLM Format ở toàn bộ batch."
        
    # Áp dụng modifications qua doc surgery một lần duy nhất
    try:
        from pathlib import Path
        output_dir = Path(docx_path).parent.parent / "outputs"
        output_dir.mkdir(parents=True, exist_ok=True)
        
        revised_path = doc_surgery.apply_modifications(
            docx_path=docx_path,
            modifications={"modifications": all_modifications},
            output_dir=str(output_dir),
        )
        
        return f"✓ Đã viết lại toàn bộ tài liệu thành công. File mới: {revised_path}"
    except Exception as e:
        return f"Lỗi khi áp dụng sửa đổi: {str(e)}"


def get_all_tools() -> list:
    """Return all tools for agent registration."""
    return [chat_tool, compare_tool, edit_tool, batch_rewrite_tool]
