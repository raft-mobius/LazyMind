"""SSE streaming utilities for chat responses."""
import json
import logging
from typing import AsyncGenerator, Any

from fastapi.responses import StreamingResponse

logger = logging.getLogger("algorithm.chat")


def create_sse_response(generator: AsyncGenerator[dict[str, Any], None]) -> StreamingResponse:
    """Wrap an async generator into an SSE StreamingResponse."""
    return StreamingResponse(
        _sse_wrapper(generator),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


async def _sse_wrapper(generator: AsyncGenerator[dict[str, Any], None]):
    """Format async generator output as SSE events."""
    try:
        async for chunk in generator:
            data = json.dumps(chunk, ensure_ascii=False)
            yield f"data: {data}\n\n"
        yield "data: [DONE]\n\n"
    except Exception as e:
        logger.error(f"SSE stream error: {e}")
        error_data = json.dumps({"error": str(e)}, ensure_ascii=False)
        yield f"data: {error_data}\n\n"
        yield "data: [DONE]\n\n"
