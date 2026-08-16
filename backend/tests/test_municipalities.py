from __future__ import annotations

from conftest import login_admin
from fastapi.testclient import TestClient

from app.database import SessionLocal
from app.models import ImportRun, Municipality, User


def test_municipality_listing_search_and_detail(client: TestClient, admin_user: User):
    with SessionLocal() as db:
        db.add_all(
            [
                Municipality(
                    ibge_code="4314902",
                    tse_code="88013",
                    name="Porto Alegre",
                    uf="GO",
                    electorate_2026=1_061_485,
                    state_rank=1,
                ),
                Municipality(
                    ibge_code="4304606",
                    tse_code="85873",
                    name="Canoas",
                    uf="GO",
                    electorate_2026=252_875,
                    state_rank=3,
                ),
            ]
        )
        db.add(
            ImportRun(
                source="tse_electorate_2026",
                status="succeeded",
                row_count=246,
                checksum_sha256="a" * 64,
            )
        )
        db.commit()

    login_admin(client)
    response = client.get("/api/v1/municipalities?q=porto&limit=10")
    assert response.status_code == 200
    assert response.json()["total"] == 1
    assert response.json()["items"][0]["name"] == "Porto Alegre"

    detail = client.get("/api/v1/municipalities/4314902")
    assert detail.status_code == 200
    assert detail.json()["electorate_2026"] == 1_061_485
    assert client.get("/api/v1/municipalities/9999999").status_code == 404

    imports = client.get("/api/v1/imports")
    assert imports.status_code == 200
    assert imports.json()[0]["row_count"] == 246
