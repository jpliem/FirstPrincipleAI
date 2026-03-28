import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import ARRAY, JSON, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class PromptPack(Base):
    __tablename__ = "prompt_packs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255))
    version: Mapped[str] = mapped_column(String(50), default="1.0.0")
    description: Mapped[str] = mapped_column(Text, default="")
    team_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    manifest: Mapped[dict] = mapped_column(JSON, default=dict)
    condensed_core: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    modules: Mapped[list["PromptModule"]] = relationship(back_populates="pack", cascade="all, delete-orphan")
    modes: Mapped[list["TaskMode"]] = relationship(back_populates="pack", cascade="all, delete-orphan")


class PromptModule(Base):
    __tablename__ = "prompt_modules"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    pack_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("prompt_packs.id"))
    filename: Mapped[str] = mapped_column(String(255))
    title: Mapped[str] = mapped_column(String(255))
    layer: Mapped[str] = mapped_column(String(20))  # core | domain | always
    tags: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    priority: Mapped[int] = mapped_column(Integer, default=50)
    content: Mapped[str] = mapped_column(Text)
    token_count: Mapped[int] = mapped_column(Integer, default=0)
    max_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    pack: Mapped["PromptPack"] = relationship(back_populates="modules")


class TaskMode(Base):
    __tablename__ = "task_modes"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    pack_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("prompt_packs.id"))
    name: Mapped[str] = mapped_column(String(100))
    prompt_text: Mapped[str] = mapped_column(Text)
    form_schema: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    pack: Mapped["PromptPack"] = relationship(back_populates="modes")
