"""add thinking_content to messages

Revision ID: 84f5bb4220a5
Revises: 2d5b633bba0e
Create Date: 2026-03-29 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '84f5bb4220a5'
down_revision: Union[str, None] = '2d5b633bba0e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('messages', sa.Column('thinking_content', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('messages', 'thinking_content')
