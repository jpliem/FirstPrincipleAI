"""add conversation_id to documents

Revision ID: a1b2c3d4e5f6
Revises: 84f5bb4220a5
Create Date: 2026-03-29 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = '84f5bb4220a5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('documents', sa.Column('conversation_id', sa.UUID(), nullable=True))
    op.create_foreign_key(
        'fk_documents_conversation_id', 'documents', 'conversations',
        ['conversation_id'], ['id'], ondelete='CASCADE'
    )


def downgrade() -> None:
    op.drop_constraint('fk_documents_conversation_id', 'documents', type_='foreignkey')
    op.drop_column('documents', 'conversation_id')
