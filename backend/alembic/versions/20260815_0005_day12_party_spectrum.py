"""Day 12 party ideological spectrum registry.

Revision ID: 20260815_0005
Revises: 20260814_0004
Create Date: 2026-08-15
"""

import sqlalchemy as sa

from alembic import op

revision = "20260815_0005"
down_revision = "20260814_0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "party_spectrum_scores",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("party_code", sa.String(40), nullable=False),
        sa.Column("party_name", sa.String(220), nullable=False),
        sa.Column("tse_numbers", sa.JSON(), nullable=False),
        sa.Column("wave_year", sa.Integer(), nullable=False),
        sa.Column("score", sa.Float(), nullable=False),
        sa.Column("block", sa.String(16), nullable=False),
        sa.Column("is_derived", sa.Boolean(), nullable=False),
        sa.Column("derived_from", sa.JSON(), nullable=False),
        sa.Column("source_institution", sa.String(220), nullable=False),
        sa.Column("source_citation", sa.Text(), nullable=False),
        sa.Column("source_doi", sa.String(120), nullable=False),
        sa.Column("source_url", sa.String(500), nullable=False),
        sa.Column("imported_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("score >= 0 AND score <= 10", name="ck_party_spectrum_scores_score"),
        sa.CheckConstraint(
            "block IN ('left', 'center', 'right')",
            name="ck_party_spectrum_scores_block",
        ),
        sa.UniqueConstraint(
            "party_code",
            "wave_year",
            name="uq_party_spectrum_scores_party_wave",
        ),
    )
    for column in ("party_code", "wave_year", "block"):
        op.create_index(
            f"ix_party_spectrum_scores_{column}",
            "party_spectrum_scores",
            [column],
        )
    op.create_index(
        "ix_party_spectrum_scores_wave_party",
        "party_spectrum_scores",
        ["wave_year", "party_code"],
    )

    op.create_table(
        "party_aliases",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("alias", sa.String(60), nullable=False),
        sa.Column("party_code", sa.String(40), nullable=False),
        sa.Column("imported_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("alias", name="uq_party_aliases_alias"),
    )
    for column in ("alias", "party_code"):
        op.create_index(f"ix_party_aliases_{column}", "party_aliases", [column])

    op.create_table(
        "spectrum_settings",
        sa.Column("key", sa.String(64), primary_key=True),
        sa.Column("value_json", sa.JSON(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "key IN ('registry', 'scale', 'block_thresholds', "
            "'wave_by_election_year', 'waves')",
            name="ck_spectrum_settings_key",
        ),
    )


def downgrade() -> None:
    op.drop_table("spectrum_settings")
    op.drop_table("party_aliases")
    op.drop_table("party_spectrum_scores")
