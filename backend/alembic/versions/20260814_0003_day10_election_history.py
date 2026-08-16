"""Day 10 official municipal election history.

Revision ID: 20260814_0003
Revises: 20260814_0002
Create Date: 2026-08-14
"""

import sqlalchemy as sa

from alembic import op

revision = "20260814_0003"
down_revision = "20260814_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "election_contests",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("election_year", sa.Integer(), nullable=False),
        sa.Column("office_code", sa.Integer(), nullable=False),
        sa.Column("office_name", sa.String(80), nullable=False),
        sa.Column("round_number", sa.Integer(), nullable=False),
        sa.Column("election_date", sa.String(10), nullable=False),
        sa.Column("generated_at_source", sa.String(10), nullable=False),
        sa.Column("state_valid_votes", sa.Integer(), nullable=False),
        sa.Column("municipality_count", sa.Integer(), nullable=False),
        sa.Column("source_name", sa.String(220), nullable=False),
        sa.Column("source_url", sa.String(500), nullable=False),
        sa.Column("imported_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("round_number IN (1, 2)", name="ck_election_contests_round"),
        sa.UniqueConstraint(
            "election_year",
            "office_code",
            "round_number",
            name="uq_election_contest_year_office_round",
        ),
    )
    for column in ("election_year", "office_code", "round_number"):
        op.create_index(f"ix_election_contests_{column}", "election_contests", [column])

    op.create_table(
        "election_candidates",
        sa.Column("id", sa.String(80), primary_key=True),
        sa.Column(
            "contest_id",
            sa.String(32),
            sa.ForeignKey("election_contests.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("tse_candidate_id", sa.String(32), nullable=False),
        sa.Column("number", sa.String(12), nullable=False),
        sa.Column("ballot_name", sa.String(160), nullable=False),
        sa.Column("full_name", sa.String(220), nullable=False),
        sa.Column("party", sa.String(32), nullable=False),
        sa.Column("party_name", sa.String(220), nullable=False),
        sa.Column("registration_status", sa.String(80), nullable=False),
        sa.Column("result_status", sa.String(80), nullable=False),
        sa.Column("state_votes", sa.Integer(), nullable=False),
        sa.Column("state_share_pct", sa.Float(), nullable=False),
        sa.Column("state_rank", sa.Integer(), nullable=False),
        sa.Column("municipalities_won", sa.Integer(), nullable=False),
        sa.UniqueConstraint(
            "contest_id",
            "tse_candidate_id",
            name="uq_election_candidate_contest_tse",
        ),
    )
    for column in ("contest_id", "tse_candidate_id", "party"):
        op.create_index(f"ix_election_candidates_{column}", "election_candidates", [column])

    op.create_table(
        "municipality_election_results",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "contest_id",
            sa.String(32),
            sa.ForeignKey("election_contests.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "candidate_id",
            sa.String(80),
            sa.ForeignKey("election_candidates.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "municipality_ibge_code",
            sa.String(7),
            sa.ForeignKey("municipalities.ibge_code", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("votes", sa.Integer(), nullable=False),
        sa.Column("valid_votes", sa.Integer(), nullable=False),
        sa.Column("share_pct", sa.Float(), nullable=False),
        sa.Column("won_municipality", sa.Boolean(), nullable=False),
        sa.Column("imported_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint(
            "contest_id",
            "candidate_id",
            "municipality_ibge_code",
            name="uq_municipality_election_candidate",
        ),
    )
    for column in ("contest_id", "candidate_id", "municipality_ibge_code"):
        op.create_index(
            f"ix_municipality_election_results_{column}",
            "municipality_election_results",
            [column],
        )
    op.create_index(
        "ix_municipality_election_contest_municipality",
        "municipality_election_results",
        ["contest_id", "municipality_ibge_code"],
    )


def downgrade() -> None:
    op.drop_table("municipality_election_results")
    op.drop_table("election_candidates")
    op.drop_table("election_contests")
