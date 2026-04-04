"""
Chat route - Single unified endpoint for all LLM operations.

The LangChain Agent automatically determines the intent (Q&A, compare, 
summarize, edit) and routes to the appropriate tool.
"""
import re
from pathlib import Path
from fastapi import APIRouter, HTTPException
from fastapi.concurrency import run_in_threadpool

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "src"))

from api.schemas import ChatRequest, ChatResponse
from api import runtime_state
from llm_pipeline import llm_engine, tools, vector_store


router = APIRouter(tags=["Chat"])

# No global agent needed anymore

_PDF_EXTENSIONS = {".pdf"}
_COMPLEX_TASK_REGEX = re.compile(
    r"(pdf|bảng|table|excel|xlsx|thống kê|biểu mẫu|mẫu|template|giữ bố cục|format|định dạng|so sánh|sửa|chỉnh|rewrite|batch)",
    re.IGNORECASE | re.UNICODE,
)


def _fallback_doc_ids_if_empty(requested: list[str]) -> list[str]:
    """
    When the client sends [] (e.g. no doc_ids in body), pick a sensible default.
    Prefer the most recently registered doc in the tool registry (insertion order) so
    multi-upload sessions still answer from the latest file instead of failing or guessing.
    """
    if requested:
        return requested
    reg = tools.get_all_doc_ids()
    if len(reg) == 1:
        return [reg[0]]
    if len(reg) > 1:
        return [reg[-1]]
    docs = vector_store.list_documents()
    if len(docs) == 1:
        return [docs[0]["doc_id"]]
    return []


def _ensure_doc_registered(doc_id: str) -> bool:
    """Ensure doc_id exists in local tool registry; recover from shared ChromaDB if missing."""
    if tools.get_doc_info(doc_id):
        return True

    docs = vector_store.list_documents()
    hit = next((d for d in docs if d.get("doc_id") == doc_id), None)
    if not hit:
        return False

    file_name = hit.get("file_name", "")
    root_dir = Path(__file__).resolve().parent.parent.parent
    uploads_dir = root_dir / "uploads"
    possible_paths = [
        uploads_dir / f"{Path(file_name).stem}_converted.docx",
        uploads_dir / file_name,
    ]
    docx_path = ""
    for p in possible_paths:
        if p.exists() and p.suffix.lower() == ".docx":
            docx_path = str(p)
            break

    tools.register_document(
        doc_id=doc_id,
        file_name=file_name or "unknown",
        docx_path=docx_path,
    )
    return True


def _doc_ids_are_pdf_only(doc_ids: list[str]) -> bool:
    """All scoped uploads are .pdf — used to widen fast chat_tool path without changing Word multi-doc behavior."""
    if not doc_ids:
        return False
    for doc_id in doc_ids:
        info = tools.get_doc_info(doc_id) or {}
        if Path(info.get("file_name", "")).suffix.lower() != ".pdf":
            return False
    return True


def _is_complex_or_pdf_flow(message: str, doc_ids: list[str]) -> bool:
    """Hybrid router: keep fast path for simple Word Q&A, use agent for PDF/complex requests."""
    if _COMPLEX_TASK_REGEX.search(message or ""):
        return True
    for doc_id in doc_ids:
        info = tools.get_doc_info(doc_id) or {}
        suffix = Path(info.get("file_name", "")).suffix.lower()
        if suffix in _PDF_EXTENSIONS:
            return True
    return False


@router.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    """
    Unified chat endpoint. Send a message and optionally specify doc_ids.
    
    The LLM Agent automatically determines the intent:
    - Q&A → uses chat_tool (RAG search + answer)
    - Compare → uses compare_tool (load 2 docs, diff)
    - Summarize → uses chat_tool (summarize prompt)
    - Edit → uses edit_tool (JSON modifications → doc surgery → .docx file)
    
    Examples:
    - {"message": "Tóm tắt nội dung file này", "doc_ids": ["id1"]}
    - {"message": "So sánh 2 file này", "doc_ids": ["id1", "id2"]}
    - {"message": "Sửa giá trong bảng 1 thành 50 triệu"}
    """
    if not request.message.strip():
        raise HTTPException(status_code=400, detail="Message cannot be empty.")

    if runtime_state.is_ingest_busy():
        raise HTTPException(
            status_code=503,
            detail="Tài liệu đang được OCR/index. Vui lòng chờ hoàn tất rồi gửi câu hỏi.",
        )
    
    doc_ids_to_use = _fallback_doc_ids_if_empty(request.doc_ids or [])
    if doc_ids_to_use and not (request.doc_ids or []):
        print(
            f"[Chat] fallback doc_ids (single indexed doc): {doc_ids_to_use}",
            flush=True,
        )

    # If specific doc_ids provided, temporarily scope tools to those docs
    if doc_ids_to_use:
        # Verify doc_ids exist
        for doc_id in doc_ids_to_use:
            if not _ensure_doc_registered(doc_id):
                raise HTTPException(
                    status_code=404,
                    detail=f"Document not found: {doc_id}"
                )
    
    try:
        # Lazy-load model on first chat if startup preload was skipped.
        if llm_engine._model is None:
            try:
                llm_engine.load_model(load_4bit=True, load_8bit=False)
            except Exception as e:
                raise HTTPException(
                    status_code=503,
                    detail=f"LLM is not available on this machine yet: {e}",
                )

        # Build context info for the agent
        available_docs = []

        # Scope the tools to the current request doc_ids
        tools.current_request_doc_ids.set(doc_ids_to_use)
        if getattr(request, "reply_depth", "auto") == "auto":
            tools.current_reply_depth.set(None)
        else:
            tools.current_reply_depth.set(request.reply_depth)
        
        for doc_id in doc_ids_to_use:
            info = tools.get_doc_info(doc_id)
            if info:
                available_docs.append(f"- {info['file_name']} (ID: {doc_id})")
        
        docs_context = "\n".join(available_docs) if available_docs else "Chưa có tài liệu nào."
        
        system_reminder = ""
        if not available_docs and not request.message.strip().startswith("[Tài liệu"):
            system_reminder = "\n\n[HỆ THỐNG CẢNH BÁO AI: Hiện tại chưa có tài liệu nào được cung cấp. Nếu người dùng yêu cầu xử lý, tóm tắt, so sánh hoặc trích xuất thông tin từ tài liệu, bạn BẮT BUỘC thông báo lỗi và yêu cầu tải lên. Nếu người dùng hỏi kiến thức chung hoặc trò chuyện bình thường, hãy trả lời bình thường nhưng ngắn gọn.]"
            
        # Enhance the user message with context about available documents
        enhanced_input = f"""Tài liệu hiện có:
{docs_context}

Yêu cầu của người dùng: {request.message}{system_reminder}"""

        route_used = "agent"
        generated_files = []
        is_agent_route = _is_complex_or_pdf_flow(request.message, doc_ids_to_use)
        lowered_message = (request.message or "").lower()
        pdf_only = _doc_ids_are_pdf_only(doc_ids_to_use)
        # Word: keep single-doc fast path only (multi-doc → agent). PDF-only: allow up to 3 docs on fast chat_tool for long Q&A.
        doc_count_ok = len(doc_ids_to_use) <= 1 or (
            pdf_only and len(doc_ids_to_use) <= 3
        )
        can_fast_summarize_pdf = doc_count_ok and not any(
            key in lowered_message
            for key in ["so sánh", "compare", "sửa", "chỉnh", "rewrite", "batch"]
        )

        if is_agent_route and not can_fast_summarize_pdf:
            print(f"[Hybrid Router] route=agent | session={request.session_id}", flush=True)
            # Run the robust custom agent loop in a threadpool to avoid blocking Event Loop
            all_tools = tools.get_all_tools()
            result = await run_in_threadpool(
                llm_engine.run_agent,
                enhanced_input,
                tools=all_tools,
                max_steps=4,
                session_id=request.session_id,
                raw_user_message=request.message
            )
            response_text = tools.sanitize_user_facing_llm_text(
                result.get("output", "Không có kết quả.")
            )
            generated_files = result.get("files", [])
        else:
            print(f"[Hybrid Router] route=fast_chat_tool | session={request.session_id}", flush=True)
            route_used = "fast_chat_tool"
            try:
                response_text = tools.sanitize_user_facing_llm_text(
                    await run_in_threadpool(
                        tools.chat_tool.invoke,
                        {"query": request.message},
                    )
                )
            except Exception as fast_err:
                # Safe fallback to agent if fast path fails for any reason.
                print(f"[Hybrid Router] fast route failed, fallback to agent: {fast_err}", flush=True)
                all_tools = tools.get_all_tools()
                result = await run_in_threadpool(
                    llm_engine.run_agent,
                    enhanced_input,
                    tools=all_tools,
                    max_steps=4,
                    session_id=request.session_id,
                    raw_user_message=request.message
                )
                route_used = "agent_fallback"
                response_text = tools.sanitize_user_facing_llm_text(
                    result.get("output", "Không có kết quả.")
                )
                generated_files = result.get("files", [])
        
        return ChatResponse(
            response=response_text,
            files=generated_files,
            route=route_used,
        )
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Agent error: {str(e)}")
