import tempfile
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user
from app.auth.models import User
from app.chat.models import Conversation, Message
from app.database import get_db
from app.export.renderer import render_markdown_to_docx

router = APIRouter(prefix="/api/export", tags=["export"])


@router.get("/message/{message_id}")
async def export_message(
    message_id: uuid.UUID,
    format: str = "docx",
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Message).where(Message.id == message_id))
    msg = result.scalar_one_or_none()
    if not msg:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)

    conv_result = await db.execute(
        select(Conversation).where(Conversation.id == msg.conversation_id)
    )
    conv = conv_result.scalar_one_or_none()
    if not conv or conv.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN)

    return await _export_markdown(msg.content, f"message_{message_id}", format, metadata={
        "Exported from": conv.title, "Role": msg.role,
    })


@router.get("/conversation/{conversation_id}")
async def export_conversation(
    conversation_id: uuid.UUID,
    format: str = "docx",
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    conv_result = await db.execute(
        select(Conversation).where(Conversation.id == conversation_id, Conversation.user_id == user.id)
    )
    conv = conv_result.scalar_one_or_none()
    if not conv:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)

    messages_result = await db.execute(
        select(Message).where(Message.conversation_id == conversation_id).order_by(Message.created_at.asc())
    )
    messages = messages_result.scalars().all()

    parts = [f"# {conv.title}\n"]
    for msg in messages:
        role_label = "**User:**" if msg.role == "user" else "**Assistant:**"
        parts.append(f"\n{role_label}\n\n{msg.content}")

    combined_md = "\n\n---\n\n".join(parts)

    return await _export_markdown(combined_md, f"conversation_{conversation_id}", format, metadata={
        "Conversation": conv.title, "Messages": str(len(messages)),
    })


async def _export_markdown(
    markdown: str, filename_base: str, format: str,
    metadata: dict | None = None, template_path: str | None = None,
) -> FileResponse:
    tmp = tempfile.NamedTemporaryFile(suffix=".docx", delete=False)
    render_markdown_to_docx(markdown, tmp.name, template_path=template_path, metadata=metadata)

    if format == "pdf":
        from app.export.pdf import convert_to_pdf
        pdf_path = convert_to_pdf(tmp.name)
        if pdf_path:
            return FileResponse(pdf_path, media_type="application/pdf", filename=f"{filename_base}.pdf")

    return FileResponse(
        tmp.name,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename=f"{filename_base}.docx",
    )
