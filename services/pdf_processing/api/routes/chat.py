"""
Chat route - Single unified endpoint for all LLM operations.

The LangChain Agent automatically determines the intent (Q&A, compare,
summarize, edit) and routes to the appropriate tool.
"""
import uuid
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse

import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "src"))

from api.schemas import ChatRequest, ChatResponse
from llm_pipeline import llm_engine, tools

OUTPUT_DIR = Path(__file__).resolve().parent.parent.parent / "outputs"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

router = APIRouter(tags=["Chat"])


def execute_chat(request: ChatRequest) -> ChatResponse:
    """Shared logic for /chat and /chat/docx."""
    if not request.message.strip():
        raise HTTPException(status_code=400, detail="Message cannot be empty.")

    if request.doc_ids:
        for doc_id in request.doc_ids:
            if not tools.ensure_doc_registered(doc_id):
                raise HTTPException(
                    status_code=404,
                    detail=f"Document not found: {doc_id}",
                )

    try:
        available_docs = []
        doc_ids_to_use = request.doc_ids if request.doc_ids else tools.get_all_doc_ids()

        for doc_id in doc_ids_to_use:
            info = tools.get_doc_info(doc_id)
            if info:
                available_docs.append(f"- {info['file_name']} (ID: {doc_id})")

        docs_context = "\n".join(available_docs) if available_docs else "Chưa có tài liệu nào."

        enhanced_input = f"""Tài liệu hiện có:
{docs_context}

Yêu cầu của người dùng: {request.message}"""

        all_tools = tools.get_all_tools()
        result = llm_engine.run_agent(enhanced_input, tools=all_tools, max_steps=4)

        response_text = result.get("output", "Không có kết quả.")
        generated_files = result.get("files", [])

        return ChatResponse(
            response=response_text,
            files=generated_files,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Agent error: {str(e)}")


def _write_response_to_docx(text: str, output_path: Path) -> None:
    from docx import Document

    doc = Document()
    for line in text.splitlines():
        doc.add_paragraph(line)
    doc.save(str(output_path))


@router.post(
    "/chat",
    responses={
        200: {
            "description": "JSON by default; Word file when as_docx=true",
            "content": {
                "application/json": {},
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {},
            },
        }
    },
)
async def chat(
    request: ChatRequest,
    as_docx: bool = Query(
        False,
        description="If true, response is a .docx file (Swagger Download saves Word). If false, JSON as usual.",
    ),
):
    """
    Unified chat endpoint. Send a message and optionally specify doc_ids.

    **Swagger:** To download Word from the same screen as /chat, set query **as_docx=true**
    (checkbox in Parameters), then Execute — the Download button will save `.docx`.

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
    result = execute_chat(request)
    if as_docx:
        out_name = f"chat_response_{uuid.uuid4().hex[:10]}.docx"
        out_path = OUTPUT_DIR / out_name
        _write_response_to_docx(result.response, out_path)
        return FileResponse(
            path=str(out_path),
            filename="chat_response.docx",
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        )
    return result


@router.post(
    "/chat/docx",
    response_class=FileResponse,
    responses={
        200: {
            "content": {
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {}
            },
            "description": "Word document containing the chat response text.",
        }
    },
)
async def chat_docx(request: ChatRequest):
    """
    Same body as POST /chat. Runs the agent and returns a .docx file whose body
    is the assistant response text (plain paragraphs). Use this when you want a
    direct Word download instead of JSON from Swagger.
    """
    result = execute_chat(request)
    out_name = f"chat_response_{uuid.uuid4().hex[:10]}.docx"
    out_path = OUTPUT_DIR / out_name
    _write_response_to_docx(result.response, out_path)
    return FileResponse(
        path=str(out_path),
        filename="chat_response.docx",
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )
