from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "src" / "data" / "campaign-registrations-demo.json"
REFERENCE_DATE = datetime(2026, 8, 14, 12, tzinfo=UTC)


LOCATIONS = [
    ("4314902", "Porto Alegre", 48, [
        ("Centro Histórico", "90010", -30.030, -51.230),
        ("Cidade Baixa", "90050", -30.041, -51.219),
        ("Partenon", "90680", -30.058, -51.191),
        ("Restinga", "91790", -30.151, -51.163),
    ]),
    ("4305108", "Caxias do Sul", 30, [
        ("Centro", "95020", -29.168, -51.179),
        ("Exposição", "95084", -29.164, -51.191),
        ("Cruzeiro", "95074", -29.172, -51.153),
    ]),
    ("4304606", "Canoas", 24, [
        ("Centro", "92010", -29.918, -51.184),
        ("Mathias Velho", "92330", -29.905, -51.197),
        ("Niterói", "92110", -29.946, -51.166),
    ]),
    ("4314407", "Pelotas", 22, [
        ("Centro", "96010", -31.765, -52.338),
        ("Fragata", "96030", -31.759, -52.371),
    ]),
    ("4316907", "Santa Maria", 20, [
        ("Centro", "97010", -29.687, -53.807),
        ("Camobi", "97105", -29.713, -53.717),
    ]),
    ("4309209", "Gravataí", 18, [
        ("Centro", "94010", -29.944, -50.992),
        ("Morada do Vale", "94085", -29.915, -51.046),
    ]),
    ("4323002", "Viamão", 16, [
        ("Centro", "94410", -30.081, -51.024),
        ("Santa Isabel", "94480", -30.069, -51.098),
    ]),
    ("4313409", "Novo Hamburgo", 16, [
        ("Centro", "93510", -29.685, -51.132),
        ("Canudos", "93542", -29.687, -51.101),
    ]),
    ("4318705", "São Leopoldo", 15, [
        ("Centro", "93010", -29.761, -51.148),
        ("Feitoria", "93052", -29.750, -51.111),
    ]),
    ("4315602", "Rio Grande", 14, [
        ("Centro", "96200", -32.034, -52.099),
        ("Cassino", "96205", -32.183, -52.163),
    ]),
    ("4314100", "Passo Fundo", 14, [
        ("Centro", "99010", -28.263, -52.407),
        ("São Cristóvão", "99062", -28.273, -52.379),
    ]),
    ("4300604", "Alvorada", 12, [
        ("Centro", "94810", -29.991, -51.080),
        ("Formoza", "94818", -30.006, -51.070),
    ]),
    ("4303103", "Cachoeirinha", 12, [
        ("Centro", "94910", -29.950, -51.093),
        ("Vila City", "94935", -29.941, -51.107),
    ]),
    ("4316808", "Santa Cruz do Sul", 11, [
        ("Centro", "96810", -29.718, -52.426),
        ("Universitário", "96815", -29.700, -52.438),
    ]),
    ("4302105", "Bento Gonçalves", 10, [
        ("Centro", "95700", -29.169, -51.519),
        ("São Bento", "95703", -29.157, -51.516),
    ]),
    ("4322400", "Uruguaiana", 9, [
        ("Centro", "97501", -29.755, -57.087),
        ("São João", "97502", -29.770, -57.072),
    ]),
    ("4301602", "Bagé", 8, [
        ("Centro", "96400", -31.331, -54.107),
        ("Getúlio Vargas", "96412", -31.317, -54.118),
    ]),
    ("4307005", "Erechim", 7, [
        ("Centro", "99700", -27.634, -52.274),
        ("Três Vendas", "99713", -27.616, -52.279),
    ]),
]

SOURCES = ("field", "event", "digital", "referral")
STATUSES = ("pending", "contacted", "completed", "completed", "contacted")
CHANNELS = ("formulario_web", "ficha_de_campo", "qr_code_evento")


def main() -> None:
    electorate = json.loads(
        (ROOT / "src" / "data" / "electorate-go.json").read_text(encoding="utf-8")
    )
    records = []
    sequence = 1
    for municipality_id, municipality_name, count, neighborhoods in LOCATIONS:
        official = electorate["municipalities"].get(municipality_id)
        if not official or official["name"] != municipality_name:
            raise SystemExit(f"Município inválido na demonstração: {municipality_id}")
        for index in range(count):
            neighborhood, cep_prefix, latitude, longitude = neighborhoods[index % len(neighborhoods)]
            age_days = (index * 7 + sequence * 3) % 150
            created_at = REFERENCE_DATE - timedelta(days=age_days, hours=index % 9)
            consent_at = created_at - timedelta(minutes=5)
            records.append(
                {
                    "id": f"demo-{sequence:04d}",
                    "municipalityId": municipality_id,
                    "municipalityName": municipality_name,
                    "cepPrefix": cep_prefix,
                    "neighborhood": neighborhood,
                    "latitude": round(latitude + ((index % 3) - 1) * 0.001, 3),
                    "longitude": round(longitude + ((index % 5) - 2) * 0.001, 3),
                    "geocodePrecision": "cep_centroid",
                    "source": SOURCES[(index + sequence) % len(SOURCES)],
                    "followUpStatus": STATUSES[(index + sequence) % len(STATUSES)],
                    "consentAt": consent_at.isoformat().replace("+00:00", "Z"),
                    "consentChannel": CHANNELS[(index + sequence) % len(CHANNELS)],
                    "consentVersion": "demo-v1",
                    "retentionUntil": (created_at + timedelta(days=365)).date().isoformat(),
                    "createdAt": created_at.isoformat().replace("+00:00", "Z"),
                    "revokedAt": None,
                }
            )
            sequence += 1

    payload = {
        "metadata": {
            "mode": "synthetic-demo",
            "state": "GO",
            "referenceDate": REFERENCE_DATE.date().isoformat(),
            "privacyThreshold": 5,
            "recordCount": len(records),
            "municipalityCount": len(LOCATIONS),
            "generatedAt": REFERENCE_DATE.isoformat().replace("+00:00", "Z"),
            "warning": "Dados totalmente sintéticos para demonstração; não representam pessoas reais.",
        },
        "records": records,
    }
    OUTPUT.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Demonstração gerada: {len(records)} cadastros em {len(LOCATIONS)} municípios.")


if __name__ == "__main__":
    main()
