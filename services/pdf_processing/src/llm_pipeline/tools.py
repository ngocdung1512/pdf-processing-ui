"""
LangChain Tools - 3 tools for the Agent.

1. chat_tool: Q&A + summarize (RAG-based)
2. compare_tool: Compare two documents 
3. edit_tool: Modify document content → JSON output → doc surgery → .docx file

Env (optional, pdf_processing chat RAG):
  PDF_CHAT_RAG_TOP_K — vector hits before neighbor expansion (default 24)
  PDF_CHAT_RAG_NEIGHBORS — adjacent elements each side (default 1; 0 = off)
  PDF_CHAT_RAG_MAX_CONTEXT_ELEMENTS — cap after expansion (default 120)
  PDF_CHAT_FULL_DOC_MAX_CHARS — if >0 and exactly one doc indexed, use full OCR text
    when len(text) <= this value instead of RAG (default 120000; 0 = never)
  PDF_CHAT_GEN_TEMPERATURE — LLM temperature for chat_tool answers (default 0.12)

edit_tool:
  PDF_EDIT_RAG_TOP_K (default 28), PDF_EDIT_RAG_NEIGHBORS (default 1),
  PDF_EDIT_RAG_MAX_ELEMENTS (default 60)

"""
import json
import os
from pathlib import Path
from typing import Optional

from langchain_core.tools import tool

from llm_pipeline import vector_store
from llm_pipeline import llm_engine
from llm_pipeline import doc_surgery


def _int_env(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, str(default)))
    except ValueError:
        return default


def _float_env(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, str(default)))
    except ValueError:
        return default


# ─────────────────────────────────────────────────────────────
# Store for document metadata (doc_id → file_name, docx_path)
# Populated during upload. Shared across tools.
# ─────────────────────────────────────────────────────────────
_doc_registry: dict[str, dict] = {}


def register_document(doc_id: str, file_name: str, docx_path: str):
    """Register a document for tool access."""
    _doc_registry[doc_id] = {
        "file_name": file_name,
        "docx_path": docx_path,
    }


def get_doc_info(doc_id: str) -> Optional[dict]:
    """Get document info from registry."""
    return _doc_registry.get(doc_id)


def ensure_doc_registered(doc_id: str) -> bool:
    """
    If doc_id exists in ChromaDB but was lost from RAM (server restart, another
    uvicorn worker, etc.), rebuild registry entry so /chat can use it.
    """
    if get_doc_info(doc_id):
        return True
    elements = vector_store.get_full_document(doc_id)
    if not elements:
        return False
    file_name = elements[0].get("metadata", {}).get("file_name", "unknown")
    project_root = Path(__file__).resolve().parent.parent.parent
    uploads_dir = project_root / "uploads"
    possible_paths = [
        uploads_dir / f"{Path(file_name).stem}_converted.docx",
        uploads_dir / file_name,
    ]
    docx_path = ""
    for p in possible_paths:
        if p.exists() and p.suffix.lower() == ".docx":
            docx_path = str(p)
            break
    register_document(doc_id, file_name, docx_path)
    return True


def get_all_doc_ids() -> list[str]:
    """Get all registered document IDs."""
    return list(_doc_registry.keys())


# ─────────────────────────────────────────────────────────────
# Tool 1: Chat (Q&A + Summarize)
# ─────────────────────────────────────────────────────────────

@tool
def chat_tool(query: str) -> str:
    """Trả lời câu hỏi hoặc tóm tắt nội dung tài liệu đã upload.
    Dùng tool này khi người dùng hỏi về nội dung, yêu cầu tóm tắt, 
    hoặc cần thông tin từ tài liệu. Input là câu hỏi của người dùng."""
    
    doc_ids = get_all_doc_ids()
    if not doc_ids:
        return "Chưa có tài liệu nào được upload. Vui lòng upload tài liệu trước."

    top_k = max(1, _int_env("PDF_CHAT_RAG_TOP_K", 24))
    neighbors = max(0, _int_env("PDF_CHAT_RAG_NEIGHBORS", 1))
    max_ctx = max(1, _int_env("PDF_CHAT_RAG_MAX_CONTEXT_ELEMENTS", 120))
    full_max = _int_env("PDF_CHAT_FULL_DOC_MAX_CHARS", 120000)
    gen_temp = _float_env("PDF_CHAT_GEN_TEMPERATURE", 0.12)

    use_full = (
        full_max > 0
        and len(doc_ids) == 1
    )
    context_header = "=== NỘI DUNG TÀI LIỆU ==="
    if use_full:
        full_text = vector_store.get_document_text(doc_ids[0])
        if len(full_text) <= full_max:
            context = full_text
            context_header = (
                "=== NỘI DUNG TÀI LIỆU (toàn bộ văn bản đã index, một file) ==="
            )
            results = []
        else:
            use_full = False

    if not use_full:
        results = vector_store.search(query, doc_ids=doc_ids, top_k=top_k)
        if not results:
            return "Không tìm thấy thông tin liên quan trong tài liệu."
        if neighbors > 0:
            results = vector_store.expand_results_with_neighbors(
                results,
                neighbor_radius=neighbors,
                max_total=max_ctx,
            )
        else:
            results = results[:max_ctx]

        context_parts = []
        for r in results:
            meta = r.get("metadata", {})
            file_name = meta.get("file_name", "unknown")
            element_id = meta.get("element_id", "?")
            content = r.get("content", "")
            context_parts.append(f"[{file_name} - {element_id}] {content}")
        context = "\n".join(context_parts)

    prompt = f"""Dựa trên nội dung tài liệu dưới đây, hãy trả lời câu hỏi.
Chỉ trả lời dựa trên thông tin có trong tài liệu, không bịa thêm.
Không dùng tên người giả định (ví dụ Nguyễn Văn A). Mọi con số phải khớp văn bản nguồn.
Ưu tiên đủ ý và đủ cấu trúc (các mục chính), tránh lặp ý và tránh kéo dài không cần thiết trừ khi người dùng yêu cầu chi tiết tối đa.

{context_header}
{context}

=== CÂU HỎI ===
{query}

=== TRẢ LỜI ==="""

    return llm_engine.generate_raw(
        prompt,
        temperature=gen_temp,
        top_p=0.85,
        do_sample=gen_temp > 0,
    )


# ─────────────────────────────────────────────────────────────
# Tool 2: Compare
# ─────────────────────────────────────────────────────────────

@tool
def compare_tool(input_text: str) -> str:
    """So sánh hai tài liệu đã upload và liệt kê các điểm khác biệt.
    Dùng tool này khi người dùng yêu cầu so sánh, đối chiếu hai file.
    Input là yêu cầu so sánh của người dùng (ví dụ: 'so sánh giá giữa 2 file')."""
    
    doc_ids = get_all_doc_ids()
    if len(doc_ids) < 2:
        return "Cần ít nhất 2 tài liệu để so sánh. Vui lòng upload thêm tài liệu."
    
    # Get full content of the two most recent documents
    doc1_id = doc_ids[-2]
    doc2_id = doc_ids[-1]
    
    doc1_info = get_doc_info(doc1_id)
    doc2_info = get_doc_info(doc2_id)
    
    doc1_text = vector_store.get_document_text(doc1_id)
    doc2_text = vector_store.get_document_text(doc2_id)
    
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
    
    doc_ids = get_all_doc_ids()
    if not doc_ids:
        return "Chưa có tài liệu nào được upload. Vui lòng upload tài liệu trước."
    
    # Use the most recently uploaded document
    doc_id = doc_ids[-1]
    doc_info = get_doc_info(doc_id)
    
    if not doc_info:
        return "Không tìm thấy thông tin tài liệu."
    
    # Dùng vector_store để tìm các đoạn văn bản liên quan đến yêu cầu sửa đổi
    # Việc này giúp tránh load toàn bộ doc_text gây tràn RAM (OOM) cho GPU
    _etop = max(1, _int_env("PDF_EDIT_RAG_TOP_K", 28))
    _enb = max(0, _int_env("PDF_EDIT_RAG_NEIGHBORS", 1))
    _emax = max(1, _int_env("PDF_EDIT_RAG_MAX_ELEMENTS", 60))
    results = vector_store.search(instruction, doc_ids=[doc_id], top_k=_etop)
    if _enb > 0 and results:
        results = vector_store.expand_results_with_neighbors(
            results,
            neighbor_radius=_enb,
            max_total=_emax,
        )
    else:
        results = results[:_emax]

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


def get_all_tools() -> list:
    """Return all tools for agent registration."""
    return [chat_tool, compare_tool, edit_tool]
