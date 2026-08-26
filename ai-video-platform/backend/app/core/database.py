"""
Async SQLAlchemy database engine, session factory, and base model.
"""
from typing import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, MappedColumn, mapped_column
from sqlalchemy import DateTime, func

from app.core.config import settings


from sqlalchemy.pool import NullPool

engine = create_async_engine(
    settings.database_url,
    echo=settings.debug,
    poolclass=NullPool,
)

# ─── Session Factory ───────────────────────────────────────────────────────────
AsyncSessionFactory = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
    autocommit=False,
)


# ─── Base ──────────────────────────────────────────────────────────────────────
class Base(DeclarativeBase):
    """Declarative base with automatic timestamps."""

    created_at: MappedColumn[DateTime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: MappedColumn[DateTime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


# ─── Dependency ────────────────────────────────────────────────────────────────
async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency that yields an async database session."""
    async with AsyncSessionFactory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
