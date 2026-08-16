from __future__ import annotations

from collections import defaultdict
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, case, func, select
from sqlalchemy.orm import Session

from ...database import get_db
from ...dependencies import AuthContext, get_auth_context
from ...models import (
    ElectionCandidate,
    ElectionContest,
    Municipality,
    MunicipalityElectionResult,
    PartyAlias,
    PartySpectrumScore,
    SpectrumSetting,
)
from ...schemas import (
    PartySpectrumOut,
    PartySpectrumRegistry,
    PartySpectrumScoreOut,
    SpectrumBlockShares,
    SpectrumBlockThresholdsOut,
    SpectrumContestOut,
    SpectrumMunicipalityIndex,
    SpectrumMunicipalitySeries,
    SpectrumScaleOut,
    SpectrumUnscoredParty,
    SpectrumWaveOut,
)

router = APIRouter(prefix="/spectrum", tags=["spectrum"])
SPECTRUM_SETTING_KEYS = (
    "registry",
    "scale",
    "block_thresholds",
    "wave_by_election_year",
    "waves",
)


def load_spectrum_settings(db: Session) -> dict[str, dict[str, object]]:
    settings = {
        setting.key: dict(setting.value_json)
        for setting in db.scalars(select(SpectrumSetting))
    }
    if set(SPECTRUM_SETTING_KEYS) - set(settings):
        raise HTTPException(
            status_code=404,
            detail="O espectro partidário ainda não foi importado.",
        )
    return settings


def wave_year_for_contest(
    settings: dict[str, dict[str, object]],
    contest: ElectionContest,
) -> int:
    wave_year = settings["wave_by_election_year"].get(str(contest.election_year))
    if wave_year is None:
        raise HTTPException(
            status_code=404,
            detail="Não há onda do survey aplicável ao ano deste pleito.",
        )
    return int(wave_year)


def percentage(part: int, total: int) -> float:
    return part / total * 100 if total else 0.0


@router.get("/parties", response_model=PartySpectrumRegistry)
def get_party_spectrum_registry(
    _context: Annotated[AuthContext, Depends(get_auth_context)],
    db: Annotated[Session, Depends(get_db)],
) -> PartySpectrumRegistry:
    settings = load_spectrum_settings(db)
    aliases_by_party: dict[str, list[str]] = defaultdict(list)
    for alias, party_code in db.execute(
        select(PartyAlias.alias, PartyAlias.party_code).order_by(PartyAlias.alias)
    ):
        aliases_by_party[str(party_code)].append(str(alias))

    scores = list(
        db.scalars(
            select(PartySpectrumScore).order_by(
                PartySpectrumScore.party_code,
                PartySpectrumScore.wave_year,
            )
        )
    )
    grouped: dict[str, list[PartySpectrumScore]] = defaultdict(list)
    for score in scores:
        grouped[score.party_code].append(score)

    registry = settings["registry"]
    return PartySpectrumRegistry(
        schema_version=int(registry["schema_version"]),
        title=str(registry["title"]),
        description=str(registry["description"]),
        scale=SpectrumScaleOut(**settings["scale"]),
        block_thresholds=SpectrumBlockThresholdsOut(**settings["block_thresholds"]),
        wave_by_election_year=settings["wave_by_election_year"],
        waves=[
            SpectrumWaveOut(**wave)
            for _, wave in sorted(settings["waves"].items())
        ],
        limitations=[str(item) for item in registry["limitations"]],
        parties=[
            PartySpectrumOut(
                code=party_code,
                name=party_scores[0].party_name,
                tse_numbers=party_scores[0].tse_numbers,
                aliases=aliases_by_party[party_code],
                scores=[
                    PartySpectrumScoreOut.model_validate(score) for score in party_scores
                ],
            )
            for party_code, party_scores in sorted(grouped.items())
        ],
    )


@router.get("/contests", response_model=list[SpectrumContestOut])
def list_spectrum_contests(
    _context: Annotated[AuthContext, Depends(get_auth_context)],
    db: Annotated[Session, Depends(get_db)],
) -> list[SpectrumContestOut]:
    settings = load_spectrum_settings(db)
    wave_by_election_year = settings["wave_by_election_year"]
    contests = db.scalars(
        select(ElectionContest).order_by(
            ElectionContest.election_year.desc(),
            ElectionContest.office_code,
            ElectionContest.round_number,
        )
    )
    return [
        SpectrumContestOut(
            contest_id=contest.id,
            election_year=contest.election_year,
            office_code=contest.office_code,
            office_name=contest.office_name,
            round_number=contest.round_number,
            election_date=contest.election_date,
            state_valid_votes=contest.state_valid_votes,
            municipality_count=contest.municipality_count,
            wave_year=int(wave_by_election_year[str(contest.election_year)]),
        )
        for contest in contests
        if str(contest.election_year) in wave_by_election_year
    ]


@router.get("/municipalities", response_model=SpectrumMunicipalitySeries)
def list_spectrum_municipalities(
    _context: Annotated[AuthContext, Depends(get_auth_context)],
    db: Annotated[Session, Depends(get_db)],
    contest_id: str = Query(min_length=1, max_length=32),
) -> SpectrumMunicipalitySeries:
    contest = db.get(ElectionContest, contest_id)
    if not contest:
        raise HTTPException(status_code=404, detail="Pleito não encontrado.")
    settings = load_spectrum_settings(db)
    wave_year = wave_year_for_contest(settings, contest)

    scored_condition = PartySpectrumScore.id.is_not(None)
    votes = MunicipalityElectionResult.votes
    scored_votes = func.sum(case((scored_condition, votes), else_=0))
    weighted_votes = func.sum(case((scored_condition, votes * PartySpectrumScore.score), else_=0.0))
    block_votes = {
        block: func.sum(case((PartySpectrumScore.block == block, votes), else_=0))
        for block in ("left", "center", "right")
    }
    spectrum_join = (
        select(MunicipalityElectionResult)
        .join(
            ElectionCandidate,
            ElectionCandidate.id == MunicipalityElectionResult.candidate_id,
        )
        .outerjoin(
            PartyAlias,
            PartyAlias.alias == func.upper(func.trim(ElectionCandidate.party)),
        )
        .outerjoin(
            PartySpectrumScore,
            and_(
                PartySpectrumScore.party_code == PartyAlias.party_code,
                PartySpectrumScore.wave_year == wave_year,
            ),
        )
        .where(MunicipalityElectionResult.contest_id == contest.id)
    )

    aggregate_rows = db.execute(
        spectrum_join.join(
            Municipality,
            Municipality.ibge_code == MunicipalityElectionResult.municipality_ibge_code,
        )
        .with_only_columns(
            MunicipalityElectionResult.municipality_ibge_code,
            Municipality.name,
            func.sum(votes),
            scored_votes,
            weighted_votes,
            block_votes["left"],
            block_votes["center"],
            block_votes["right"],
        )
        .group_by(MunicipalityElectionResult.municipality_ibge_code, Municipality.name)
        .order_by(Municipality.name)
    )

    unscored_rows = db.execute(
        spectrum_join.with_only_columns(
            MunicipalityElectionResult.municipality_ibge_code,
            ElectionCandidate.party,
            func.sum(votes),
        )
        .where(PartySpectrumScore.id.is_(None))
        .group_by(MunicipalityElectionResult.municipality_ibge_code, ElectionCandidate.party)
        .having(func.sum(votes) > 0)
        .order_by(MunicipalityElectionResult.municipality_ibge_code, func.sum(votes).desc())
    )
    unscored_by_municipality: dict[str, list[SpectrumUnscoredParty]] = defaultdict(list)
    for ibge_code, party, party_votes in unscored_rows:
        unscored_by_municipality[str(ibge_code)].append(
            SpectrumUnscoredParty(party=str(party), votes=int(party_votes))
        )

    items: list[SpectrumMunicipalityIndex] = []
    for (
        ibge_code,
        municipality_name,
        total_votes,
        municipality_scored_votes,
        municipality_weighted_votes,
        left_votes,
        center_votes,
        right_votes,
    ) in aggregate_rows:
        total = int(total_votes or 0)
        scored = int(municipality_scored_votes or 0)
        weighted = float(municipality_weighted_votes or 0.0)
        items.append(
            SpectrumMunicipalityIndex(
                ibge_code=str(ibge_code),
                municipality_name=str(municipality_name),
                spectrum_index=weighted / scored if scored else None,
                total_votes=total,
                scored_votes=scored,
                unscored_votes=total - scored,
                coverage_pct=percentage(scored, total),
                blocks=SpectrumBlockShares(
                    left_votes=int(left_votes or 0),
                    center_votes=int(center_votes or 0),
                    right_votes=int(right_votes or 0),
                    left_pct=percentage(int(left_votes or 0), scored),
                    center_pct=percentage(int(center_votes or 0), scored),
                    right_pct=percentage(int(right_votes or 0), scored),
                ),
                unscored_parties=unscored_by_municipality[str(ibge_code)],
            )
        )

    return SpectrumMunicipalitySeries(
        contest=SpectrumContestOut(
            contest_id=contest.id,
            election_year=contest.election_year,
            office_code=contest.office_code,
            office_name=contest.office_name,
            round_number=contest.round_number,
            election_date=contest.election_date,
            state_valid_votes=contest.state_valid_votes,
            municipality_count=contest.municipality_count,
            wave_year=wave_year,
        ),
        wave_year=wave_year,
        scale=SpectrumScaleOut(**settings["scale"]),
        block_thresholds=SpectrumBlockThresholdsOut(**settings["block_thresholds"]),
        coverage_count=sum(1 for item in items if item.spectrum_index is not None),
        missing_count=sum(1 for item in items if item.spectrum_index is None),
        items=items,
    )
