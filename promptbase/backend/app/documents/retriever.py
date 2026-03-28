import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.documents.models import Document, DocumentChunk


async def retrieve_document_context(
    db: AsyncSession,
    document_ids: list[uuid.UUID],
    query_embedding: list[float] | None,
    top_k: int = 5,
) -> str:
    parts = []

    for doc_id in document_ids:
        result = await db.execute(select(Document).where(Document.id == doc_id))
        doc = result.scalar_one_or_none()
        if not doc or doc.status != "ready":
            continue

        if doc.strategy == "full_inject" and doc.full_text:
            parts.append(f"### {doc.filename}\n\n{doc.full_text}")
        elif doc.strategy == "rag" and query_embedding:
            chunk_results = await db.execute(
                select(DocumentChunk)
                .where(DocumentChunk.document_id == doc_id)
                .where(DocumentChunk.embedding.isnot(None))
                .order_by(DocumentChunk.embedding.cosine_distance(query_embedding))
                .limit(top_k)
            )
            chunks = chunk_results.scalars().all()
            if chunks:
                chunk_texts = [f"[Chunk {c.chunk_index}] {c.content}" for c in chunks]
                parts.append(f"### {doc.filename} (relevant sections)\n\n" + "\n\n".join(chunk_texts))

    return "\n\n---\n\n".join(parts)
