"""Day 11 privacy-safe geocoded campaign registrations.

Revision ID: 20260814_0004
Revises: 20260814_0003
Create Date: 2026-08-14
"""

import sqlalchemy as sa

from alembic import op

revision = "20260814_0004"
down_revision = "20260814_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "campaign_registrations",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("external_reference_hash", sa.String(64), nullable=True),
        sa.Column(
            "municipality_ibge_code",
            sa.String(7),
            sa.ForeignKey("municipalities.ibge_code", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("cep_prefix", sa.String(5), nullable=False),
        sa.Column("neighborhood", sa.String(160), nullable=False),
        sa.Column("latitude", sa.Float(), nullable=True),
        sa.Column("longitude", sa.Float(), nullable=True),
        sa.Column("geocode_precision", sa.String(24), nullable=False),
        sa.Column("source", sa.String(24), nullable=False),
        sa.Column("follow_up_status", sa.String(24), nullable=False),
        sa.Column("consent_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consent_channel", sa.String(80), nullable=False),
        sa.Column("consent_version", sa.String(40), nullable=False),
        sa.Column("retention_until", sa.Date(), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("data_origin", sa.String(24), nullable=False),
        sa.Column(
            "created_by_user_id",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "source IN ('field', 'event', 'digital', 'referral')",
            name="ck_campaign_registrations_source",
        ),
        sa.CheckConstraint(
            "follow_up_status IN ('pending', 'contacted', 'completed', 'revoked')",
            name="ck_campaign_registrations_follow_up_status",
        ),
        sa.CheckConstraint(
            "geocode_precision IN ('cep_centroid', 'neighborhood', 'municipality')",
            name="ck_campaign_registrations_geocode_precision",
        ),
        sa.CheckConstraint(
            "data_origin IN ('manual', 'import', 'synthetic-demo')",
            name="ck_campaign_registrations_data_origin",
        ),
        sa.UniqueConstraint(
            "external_reference_hash",
            name="uq_campaign_registrations_external_reference_hash",
        ),
    )
    for column in (
        "external_reference_hash",
        "municipality_ibge_code",
        "cep_prefix",
        "neighborhood",
        "source",
        "follow_up_status",
        "consent_at",
        "retention_until",
        "revoked_at",
        "data_origin",
        "created_by_user_id",
        "created_at",
    ):
        op.create_index(
            f"ix_campaign_registrations_{column}",
            "campaign_registrations",
            [column],
        )


def downgrade() -> None:
    op.drop_table("campaign_registrations")
