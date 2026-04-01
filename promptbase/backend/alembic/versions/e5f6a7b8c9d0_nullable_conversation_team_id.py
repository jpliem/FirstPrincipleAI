"""make conversation team_id nullable for personal chat

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-04-01 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = "e5f6a7b8c9d0"
down_revision = "d4e5f6a7b8c9"
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column("conversations", "team_id", existing_type=sa.UUID(), nullable=True)


def downgrade():
    op.alter_column("conversations", "team_id", existing_type=sa.UUID(), nullable=False)
