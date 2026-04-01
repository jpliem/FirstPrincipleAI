"""add cascade deletes to foreign keys

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-04-01 00:00:00.000000
"""
from alembic import op

revision = "d4e5f6a7b8c9"
down_revision = "c3d4e5f6a7b8"
branch_labels = None
depends_on = None

# (table, constraint_name, column, references, ondelete)
FK_UPDATES = [
    # conversation_documents junction - cascade on both sides
    ("conversation_documents", "conversation_documents_conversation_id_fkey", "conversation_id", "conversations.id", "CASCADE"),
    ("conversation_documents", "conversation_documents_document_id_fkey", "document_id", "documents.id", "CASCADE"),
    # messages cascade with conversation
    ("messages", "messages_conversation_id_fkey", "conversation_id", "conversations.id", "CASCADE"),
    # document_chunks cascade with document
    ("document_chunks", "document_chunks_document_id_fkey", "document_id", "documents.id", "CASCADE"),
    # prompt modules/modes cascade with pack
    ("prompt_modules", "prompt_modules_pack_id_fkey", "pack_id", "prompt_packs.id", "CASCADE"),
    ("task_modes", "task_modes_pack_id_fkey", "pack_id", "prompt_packs.id", "CASCADE"),
    # team members cascade with team/user
    ("team_members", "team_members_team_id_fkey", "team_id", "teams.id", "CASCADE"),
    ("team_members", "team_members_user_id_fkey", "user_id", "users.id", "CASCADE"),
    # invite links cascade with team
    ("invite_links", "invite_links_team_id_fkey", "team_id", "teams.id", "CASCADE"),
    # team llm config cascade with team
    ("team_llm_config", "team_llm_config_team_id_fkey", "team_id", "teams.id", "CASCADE"),
    # team pack_id set null on pack delete
    ("teams", "teams_pack_id_fkey", "pack_id", "prompt_packs.id", "SET NULL"),
]


def upgrade():
    for table, constraint, column, references, ondelete in FK_UPDATES:
        op.drop_constraint(constraint, table, type_="foreignkey")
        op.create_foreign_key(constraint, table, references.split(".")[0], [column], [references.split(".")[1]], ondelete=ondelete)


def downgrade():
    for table, constraint, column, references, _ in FK_UPDATES:
        op.drop_constraint(constraint, table, type_="foreignkey")
        op.create_foreign_key(constraint, table, references.split(".")[0], [column], [references.split(".")[1]])
