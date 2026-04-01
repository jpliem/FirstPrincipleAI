import re
import uuid
from collections import Counter

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.documents.models import Document, DocumentChunk


def _tokenize(text: str) -> list[str]:
    """Simple word tokenizer for keyword matching."""
    return re.findall(r'\w+', text.lower())


def _score_chunk(chunk_tokens: list[str], query_tokens: set[str]) -> float:
    """Score a chunk by keyword overlap with the query (BM25-lite)."""
    if not query_tokens:
        return 0.0
    chunk_counter = Counter(chunk_tokens)
    score = 0.0
    for token in query_tokens:
        if token in chunk_counter:
            # Term frequency with diminishing returns
            tf = chunk_counter[token]
            score += 1.0 + (0.5 * min(tf, 5))
    return score


async def retrieve_document_context(
    db: AsyncSession,
    document_ids: list[uuid.UUID],
    query_text: str = "",
    query_embedding: list[float] | None = None,
    top_k: int = 5,
) -> str:
    parts = []
    query_tokens = set(_tokenize(query_text))

    for doc_id in document_ids:
        result = await db.execute(select(Document).where(Document.id == doc_id))
        doc = result.scalar_one_or_none()
        if not doc or doc.status != "ready":
            continue

        if doc.strategy == "full_inject" and doc.full_text:
            parts.append(f"### {doc.filename}\n\n{doc.full_text}")
        elif doc.strategy == "rag":
            # Try vector similarity first if embedding is available
            if query_embedding:
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
                    continue

            # Fallback: keyword-based chunk retrieval
            all_chunks_result = await db.execute(
                select(DocumentChunk)
                .where(DocumentChunk.document_id == doc_id)
                .order_by(DocumentChunk.chunk_index)
            )
            all_chunks = all_chunks_result.scalars().all()

            if not all_chunks:
                continue

            if query_tokens:
                # Score and rank chunks by keyword overlap
                scored = []
                for chunk in all_chunks:
                    chunk_tokens = _tokenize(chunk.content)
                    score = _score_chunk(chunk_tokens, query_tokens)
                    scored.append((score, chunk))
                scored.sort(key=lambda x: x[0], reverse=True)
                # Take top_k chunks that have any match, preserving original order
                matched = [c for score, c in scored[:top_k] if score > 0]
                if not matched:
                    # No keyword matches — take first few chunks as context
                    matched = all_chunks[:top_k]
                matched.sort(key=lambda c: c.chunk_index)
            else:
                # No query — take first chunks
                matched = all_chunks[:top_k]

            chunk_texts = [f"[Chunk {c.chunk_index}] {c.content}" for c in matched]
            parts.append(f"### {doc.filename} (relevant sections)\n\n" + "\n\n".join(chunk_texts))

    return "\n\n---\n\n".join(parts)
