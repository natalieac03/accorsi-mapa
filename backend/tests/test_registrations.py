from __future__ import annotations

from conftest import login_admin
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.database import SessionLocal
from app.models import CampaignRegistration, Municipality, User


def seed_municipalities() -> None:
    with SessionLocal() as db:
        db.add_all(
            [
                Municipality(
                    ibge_code="4314902",
                    tse_code="88013",
                    name="Porto Alegre",
                    uf="GO",
                    electorate_2026=1_061_485,
                ),
                Municipality(
                    ibge_code="4304606",
                    tse_code="85873",
                    name="Canoas",
                    uf="GO",
                    electorate_2026=252_875,
                ),
            ]
        )
        db.commit()


def payload(reference: str, *, neighborhood: str = "Centro Histórico") -> dict:
    return {
        "external_reference": reference,
        "municipality_ibge_code": "4314902",
        "cep": "90010-000",
        "neighborhood": neighborhood,
        "latitude": -30.0304,
        "longitude": -51.2297,
        "geocode_precision": "cep_centroid",
        "source": "field",
        "follow_up_status": "pending",
        "consent_at": "2026-08-14T12:00:00Z",
        "consent_channel": "ficha_de_campo",
        "consent_version": "v1",
        "retention_until": "2027-08-14",
    }


def test_registration_crud_minimizes_location_and_revokes_consent(
    client: TestClient, admin_user: User
):
    seed_municipalities()
    csrf = login_admin(client)
    headers = {"X-CSRF-Token": csrf}

    created_ids = []
    for index in range(5):
        response = client.post(
            "/api/v1/registrations",
            json=payload(f"CRM-{index}"),
            headers=headers,
        )
        assert response.status_code == 201
        body = response.json()
        assert body["cep_prefix"] == "90010"
        assert "cep" not in body
        assert "external_reference" not in body
        assert body["latitude"] == -30.03
        created_ids.append(body["id"])

    duplicate = client.post(
        "/api/v1/registrations",
        json=payload("crm-0"),
        headers=headers,
    )
    assert duplicate.status_code == 409

    with SessionLocal() as db:
        stored = db.scalar(
            select(CampaignRegistration).where(
                CampaignRegistration.id == created_ids[0]
            )
        )
        assert stored is not None
        assert stored.external_reference_hash != "CRM-0"
        assert len(stored.external_reference_hash or "") == 64

    listed = client.get("/api/v1/registrations")
    assert listed.status_code == 200
    assert listed.json()["total"] == 5

    summary = client.get("/api/v1/registrations/summary")
    assert summary.status_code == 200
    assert summary.json()["privacy_threshold"] == 5
    assert summary.json()["clusters"][0]["count"] == 5

    revoked = client.patch(
        f"/api/v1/registrations/{created_ids[0]}",
        json={"revoke_consent": True},
        headers=headers,
    )
    assert revoked.status_code == 200
    assert revoked.json()["follow_up_status"] == "revoked"
    assert revoked.json()["revoked_at"] is not None

    summary_after = client.get("/api/v1/registrations/summary")
    assert summary_after.json()["total_active"] == 4
    assert summary_after.json()["clusters"] == []
    assert summary_after.json()["suppressed_cluster_count"] == 1


def test_registration_import_is_atomic_and_audited(
    client: TestClient, admin_user: User
):
    seed_municipalities()
    csrf = login_admin(client)
    headers = {"X-CSRF-Token": csrf}
    first = payload("IMPORT-1")
    second = payload("IMPORT-2")
    second.update(
        {
            "municipality_ibge_code": "4304606",
            "cep": "92010-000",
            "neighborhood": "Centro",
            "latitude": -29.918,
            "longitude": -51.184,
            "source": "event",
        }
    )

    imported = client.post(
        "/api/v1/registrations/import",
        json={"items": [first, second]},
        headers=headers,
    )
    assert imported.status_code == 201
    assert imported.json()["imported_count"] == 2
    assert {item["data_origin"] for item in imported.json()["items"]} == {"import"}

    repeated = client.post(
        "/api/v1/registrations/import",
        json={"items": [first, second]},
        headers=headers,
    )
    assert repeated.status_code == 409
    assert client.get("/api/v1/registrations").json()["total"] == 2
