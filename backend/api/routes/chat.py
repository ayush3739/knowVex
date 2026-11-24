import json
from uuid import UUID

from fastapi import APIRouter, Depends
from sse_starlette.sse import EventSourceResponse
from sqlalchemy.ext.asyncio import AsyncSession

from backend.db.base import get_db
from backend.services.chat_service import ChatService
from backend.services.session_service import SessionService
from backend.models.schemas import ChatRequest
from backend.api.deps import get_current_user
from backend.services.quota_service import check_and_consume_quota, check_and_consume_research_quota

router = APIRouter(prefix="/chat",)

chat_service = ChatService()
session_service = SessionService()

@router.post("/{session_id}")
async def chat(
    session_id: UUID,
    request: ChatRequest,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    if request.mode == "research":
        await check_and_consume_research_quota(user=current_user, db=db)
    else:
        await check_and_consume_quota(user=current_user, db=db)

   

    async def event_generator():
        try:
            async for event_type, data in chat_service.stream_chat(
                session_id=session_id,
                question=request.question,
                user_id=current_user.id,
                db=db,
                mode = request.mode or "auto",
            ):
                yield {
                    "event": event_type,
                    "data": data,
                }
        except Exception as stream_exc:
            error_text = f"⚠️ Stream interrupted: {stream_exc}"
            try:
                await session_service.add_message(
                    session_id=session_id,
                    role="assistant",
                    content=error_text,
                    db=db,
                    confidence=0.0,
                    sources=[],
                    tool_used="error",
                )
            except Exception:
                pass
            yield {
                "event": "graph_status",
                "data": json.dumps({
                    "node": "error",
                    "label": "Stream Error",
                    "status": "failed",
                    "message": str(stream_exc),
                }),
            }
            yield {
                "event": "error",
                "data": f"Stream interrupted: {stream_exc}",
            }
            yield {
                "event": "done",
                "data": "[DONE]",
            }

    return EventSourceResponse(
        event_generator()
    )

