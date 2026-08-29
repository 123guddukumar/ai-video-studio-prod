"""add_subtitle_style

Revision ID: d1a58a74e0d9
Revises: c0cf53fababe
Create Date: 2026-08-29 12:49:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd1a58a74e0d9'
down_revision: Union[str, None] = 'c0cf53fababe'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add subtitle_style column to projects table
    op.add_column('projects', sa.Column('subtitle_style', sa.String(length=50), nullable=True, server_default='minimalist_white'))


def downgrade() -> None:
    # Drop subtitle_style column from projects table
    op.drop_column('projects', 'subtitle_style')
