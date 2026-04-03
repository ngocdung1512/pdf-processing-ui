"""
Pydantic schemas for the Document Intelligence API.
"""
from pydantic import BaseModel, Field
from typing import Literal, Optional

ReplyDepth = Literal["auto", "summary", "detail", "balanced"]


# ─────────────────────────────────────────────────────
# Document schemas
# ─────────────────────────────────────────────────────

class DocumentInfo(BaseModel):
    """Summary info about an uploaded document."""
    doc_id: str
    file_name: str
    element_count: int = 0
    docx_path: str = ""


class DocumentElement(BaseModel):
    """A single element (paragraph or table cell)."""
    id: str
    type: str
    content: str
    table_id: Optional[str] = None
    row: Optional[int] = None
    col: Optional[int] = None


class DocumentDetail(BaseModel):
    """Full document detail with all elements."""
    doc_id: str
    file_name: str
    docx_path: str
    elements: list[DocumentElement] = []


class UploadResponse(BaseModel):
    """Response after uploading a document."""
    doc_id: str
    file_name: str
    element_count: int
    message: str


class DeleteResponse(BaseModel):
    """Response after deleting a document."""
    doc_id: str
    deleted_elements: int
    message: str


# ─────────────────────────────────────────────────────
# Chat schemas
# ─────────────────────────────────────────────────────

class ChatRequest(BaseModel):
    """Request body for the unified /chat endpoint."""
    message: str = Field(..., description="User message (Q&A, compare, edit, summarize...)")
    session_id: str = Field(default="default", description="Session ID to track chat history per tab/user")
    doc_ids: list[str] = Field(default=[], description="List of doc_ids to use as context. Empty = use none.")
    reply_depth: ReplyDepth = Field(
        default="auto",
        description="auto = infer summary vs detail from message (heuristic); summary/detail/balanced = force chat_tool behaviour",
    )


class ChatResponse(BaseModel):
    """Response from the /chat endpoint."""
    response: str = Field(..., description="LLM response text")
    files: list[str] = Field(default=[], description="List of generated filenames (for edit operations)")
    route: Optional[str] = Field(default=None, description="Execution route used by backend")


# ─────────────────────────────────────────────────────
# Health / Status
# ─────────────────────────────────────────────────────

class HealthResponse(BaseModel):
    """Health check response."""
    status: str
    llm_loaded: bool
    embedding_loaded: bool
    documents_count: int
