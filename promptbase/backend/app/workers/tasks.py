from app.workers.celery_app import celery


@celery.task(name="process_document")
def process_document(document_id: int):
    """Placeholder — implemented in Task 15."""
    pass
