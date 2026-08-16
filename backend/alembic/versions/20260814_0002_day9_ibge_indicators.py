"""Day 9 IBGE socioeconomic indicator catalog and municipal values.

Revision ID: 20260814_0002
Revises: 20260814_0001
Create Date: 2026-08-14
"""

import sqlalchemy as sa

from alembic import op

revision = "20260814_0002"
down_revision = "20260814_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "indicator_definitions",
        sa.Column("code", sa.String(64), primary_key=True),
        sa.Column("ibge_indicator_id", sa.Integer(), nullable=False),
        sa.Column("label", sa.String(220), nullable=False),
        sa.Column("short_label", sa.String(120), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("unit", sa.String(80), nullable=False),
        sa.Column("value_format", sa.String(24), nullable=False),
        sa.Column("source_name", sa.String(220), nullable=False),
        sa.Column("source_url", sa.String(500), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("ibge_indicator_id", name="uq_indicator_definitions_ibge_id"),
    )
    op.create_index(
        "ix_indicator_definitions_ibge_indicator_id",
        "indicator_definitions",
        ["ibge_indicator_id"],
        unique=True,
    )

    op.create_table(
        "municipality_indicator_values",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "municipality_ibge_code",
            sa.String(7),
            sa.ForeignKey("municipalities.ibge_code", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "indicator_code",
            sa.String(64),
            sa.ForeignKey("indicator_definitions.code", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("reference_year", sa.Integer(), nullable=False),
        sa.Column("value", sa.Float(), nullable=False),
        sa.Column("imported_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint(
            "municipality_ibge_code",
            "indicator_code",
            "reference_year",
            name="uq_municipality_indicator_year",
        ),
    )
    op.create_index(
        "ix_municipality_indicator_values_municipality_ibge_code",
        "municipality_indicator_values",
        ["municipality_ibge_code"],
    )
    op.create_index(
        "ix_municipality_indicator_values_indicator_code",
        "municipality_indicator_values",
        ["indicator_code"],
    )
    op.create_index(
        "ix_municipality_indicator_values_reference_year",
        "municipality_indicator_values",
        ["reference_year"],
    )


def downgrade() -> None:
    op.drop_table("municipality_indicator_values")
    op.drop_table("indicator_definitions")
