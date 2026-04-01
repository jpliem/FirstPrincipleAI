import uuid

from app.compiler.budget import count_tokens_approx
from app.config import settings
from app.documents.chunker import chunk_text, count_chunk_tokens
from app.documents.models import Document, DocumentChunk
from app.documents.parser import parse_document
from app.workers.celery_app import celery

# Import all models so SQLAlchemy can resolve FKs
from app.auth.models import User, Team, TeamMember, InviteLink  # noqa: F401
from app.compiler.models import PromptPack, PromptModule, TaskMode  # noqa: F401
from app.chat.models import Conversation, Message, ConversationDocument  # noqa: F401
from app.providers.models import LLMProviderConfig, TeamLLMConfig  # noqa: F401

_engine = None


def _get_sync_session():
    global _engine
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session

    if _engine is None:
        sync_url = settings.database_url.replace("postgresql+asyncpg", "postgresql+psycopg2")
        _engine = create_engine(sync_url)
    return Session(_engine)


@celery.task(name="process_document", bind=True, max_retries=3)
def process_document(self, document_id: str):
    session = _get_sync_session()
    try:
        doc = session.query(Document).filter(Document.id == uuid.UUID(document_id)).first()
        if not doc:
            return

        # Stage 1: Start processing (10%)
        doc.status = "processing"
        doc.progress = 10
        session.commit()

        # Stage 2: Parse document (40%)
        text = parse_document(doc.file_path, doc.file_type)
        doc.progress = 40
        session.commit()

        # Stage 3: Count tokens (50%)
        token_count = count_tokens_approx(text)
        doc.token_count = token_count
        doc.progress = 50
        session.commit()

        if token_count <= settings.rag_threshold_tokens:
            # Stage 4a: Full inject — store text (90%)
            doc.strategy = "full_inject"
            doc.full_text = text
            doc.progress = 90
            session.commit()

            # Done (100%)
            doc.status = "ready"
            doc.progress = 100
            session.commit()
            return

        # Stage 4b: RAG — chunk text (60%)
        doc.strategy = "rag"
        doc.progress = 60
        session.commit()

        chunks = chunk_text(text, chunk_size=settings.default_chunk_size * 4, overlap=settings.default_chunk_overlap * 4)
        token_counts = count_chunk_tokens(chunks)

        # Stage 5: Store chunks (60-90%)
        total_chunks = len(chunks)
        for i, (chunk_text_content, tokens) in enumerate(zip(chunks, token_counts)):
            chunk = DocumentChunk(
                document_id=doc.id,
                chunk_index=i,
                content=chunk_text_content,
                token_count=tokens,
                embedding=None,
            )
            session.add(chunk)

            # Update progress proportionally through chunk processing
            chunk_progress = 60 + int(30 * (i + 1) / max(total_chunks, 1))
            doc.progress = chunk_progress
            session.commit()

        # Done (100%)
        doc.status = "ready"
        doc.progress = 100
        session.commit()

    except Exception as e:
        session.rollback()
        try:
            doc = session.query(Document).filter(Document.id == uuid.UUID(document_id)).first()
            if doc:
                doc.status = "failed"
                doc.progress = 0
                doc.error_message = str(e)[:1000]
                session.commit()
        except Exception:
            session.rollback()
    finally:
        session.close()
