"""add is_pinned to conversations and make documents.team_id nullable

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2026-04-01
"""
from alembic import op
import sqlalchemy as sa

revision = "f6a7b8c9d0e1"
down_revision = "e5f6a7b8c9d0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("conversations", sa.Column("is_pinned", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.create_index("ix_conversations_pinned_updated", "conversations", [sa.text("is_pinned DESC"), sa.text("updated_at DESC")])
    op.alter_column("documents", "team_id", existing_type=sa.UUID(), nullable=True)


def downgrade() -> None:
    op.alter_column("documents", "team_id", existing_type=sa.UUID(), nullable=False)
    op.drop_index("ix_conversations_pinned_updated", table_name="conversations")
    op.drop_column("conversations", "is_pinned")
