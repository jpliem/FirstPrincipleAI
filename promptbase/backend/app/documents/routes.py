import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user
from app.auth.models import User
from app.auth.service import get_user_team_role
from app.config import settings
from app.database import get_db
from app.documents.models import Document
from app.documents.schemas import DocumentListResponse, DocumentResponse
from app.workers.tasks import process_document

router = APIRouter(prefix="/api/documents", tags=["documents"])


@router.post("/{team_id}/upload", response_model=DocumentResponse, status_code=status.HTTP_202_ACCEPTED)
async def upload_document(
    team_id: uuid.UUID,
    file: UploadFile,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    role = await get_user_team_role(db, user.id, team_id)
    if role is None and not user.is_super_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a member of this team")

    contents = await file.read()
    if len(contents) > settings.max_upload_size_mb * 1024 * 1024:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="File too large")

    upload_dir = Path(settings.upload_dir) / str(team_id)
    upload_dir.mkdir(parents=True, exist_ok=True)
    file_path = upload_dir / f"{uuid.uuid4()}_{file.filename}"
    file_path.write_bytes(contents)

    doc = Document(
        team_id=team_id, user_id=user.id, filename=file.filename,
        file_path=str(file_path), file_type=file.content_type or "application/octet-stream",
        file_size=len(contents),
    )
    db.add(doc)
    await db.commit()
    await db.refresh(doc)

    process_document.delay(str(doc.id))

    return doc


@router.get("/{team_id}", response_model=DocumentListResponse)
async def list_documents(
    team_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    role = await get_user_team_role(db, user.id, team_id)
    if role is None and not user.is_super_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN)

    result = await db.execute(
        select(Document).where(Document.team_id == team_id).order_by(Document.created_at.desc())
    )
    return DocumentListResponse(documents=result.scalars().all())


@router.get("/{team_id}/{document_id}", response_model=DocumentResponse)
async def get_document(
    team_id: uuid.UUID, document_id: uuid.UUID,
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    role = await get_user_team_role(db, user.id, team_id)
    if role is None and not user.is_super_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN)

    result = await db.execute(
        select(Document).where(Document.id == document_id, Document.team_id == team_id)
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    return doc


@router.delete("/{team_id}/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_document(
    team_id: uuid.UUID, document_id: uuid.UUID,
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    role = await get_user_team_role(db, user.id, team_id)
    if role not in ("admin",) and not user.is_super_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Team admin required")

    result = await db.execute(
        select(Document).where(Document.id == document_id, Document.team_id == team_id)
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)

    file_path = Path(doc.file_path)
    if file_path.exists():
        file_path.unlink()

    await db.delete(doc)
    await db.commit()
