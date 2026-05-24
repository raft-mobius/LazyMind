"""Parse API routes."""
import logging
from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel

from . import service

logger = logging.getLogger("algorithm.parse")

router = APIRouter(prefix="/api/chat/parse", tags=["parse"])


class ParseRequest(BaseModel):
    user_id: str
    source_path: str


class ParseTaskResponse(BaseModel):
    task_id: str
    status: str
    doc_id: str | None = None
    chunk_count: int | None = None
    error: str | None = None


@router.post("/submit", response_model=ParseTaskResponse)
async def submit_parse(req: ParseRequest, background_tasks: BackgroundTasks):
    """Submit a file for parsing. Returns immediately with task_id."""
    result = service.create_parse_task(req.user_id, req.source_path)
    background_tasks.add_task(service.execute_parse_task, result["task_id"])
    return ParseTaskResponse(task_id=result["task_id"], status="pending")


@router.post("/execute", response_model=ParseTaskResponse)
async def execute_parse(req: ParseRequest):
    """Parse a file synchronously (for small files)."""
    task = service.create_parse_task(req.user_id, req.source_path)
    result = service.execute_parse_task(task["task_id"])
    return ParseTaskResponse(**result)


@router.get("/status/{task_id}")
async def get_status(task_id: str):
    """Get parse task status."""
    result = service.get_parse_task_status(task_id)
    if not result:
        raise HTTPException(status_code=404, detail="Task not found")
    return result


@router.get("/tasks/{user_id}")
async def list_tasks(user_id: str, status: str | None = None):
    """List parse tasks for a user."""
    return service.list_parse_tasks(user_id, status)


@router.get("/chunks/{task_id}")
async def get_chunks(task_id: str):
    """Get chunks for a parse task."""
    return service.get_chunks_by_task(task_id)
