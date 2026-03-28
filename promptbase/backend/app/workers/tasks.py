import uuid

from app.compiler.budget import count_tokens_approx
from app.config import settings
from app.documents.chunker import chunk_text, count_chunk_tokens
from app.documents.models import Document, DocumentChunk
from app.documents.parser import parse_document
from app.workers.celery_app import celery


def _get_sync_session():
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session

    sync_url = settings.database_url.replace("postgresql+asyncpg", "postgresql")
    engine = create_engine(sync_url)
    return Session(engine)


@celery.task(name="process_document", bind=True, max_retries=3)
def process_document(self, document_id: str):
    session = _get_sync_session()
    try:
        doc = session.query(Document).filter(Document.id == uuid.UUID(document_id)).first()
        if not doc:
            return

        doc.status = "processing"
        session.commit()

        text = parse_document(doc.file_path, doc.file_type)

        token_count = count_tokens_approx(text)
        doc.token_count = token_count

        if token_count <= settings.rag_threshold_tokens:
            doc.strategy = "full_inject"
            doc.full_text = text
            doc.status = "ready"
            session.commit()
            return

        doc.strategy = "rag"
        chunks = chunk_text(text, chunk_size=settings.default_chunk_size * 4, overlap=settings.default_chunk_overlap * 4)
        token_counts = count_chunk_tokens(chunks)

        for i, (chunk_text_content, tokens) in enumerate(zip(chunks, token_counts)):
            chunk = DocumentChunk(
                document_id=doc.id,
                chunk_index=i,
                content=chunk_text_content,
                token_count=tokens,
                embedding=None,
            )
            session.add(chunk)

        doc.status = "ready"
        session.commit()

    except Exception as e:
        session.rollback()
        doc = session.query(Document).filter(Document.id == uuid.UUID(document_id)).first()
        if doc:
            doc.status = "failed"
            doc.error_message = str(e)[:1000]
            session.commit()
        raise self.retry(exc=e, countdown=60)
    finally:
        session.close()
