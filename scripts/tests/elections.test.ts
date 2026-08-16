import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { AgeStructureDataset } from "../../src/types/ageStructure.ts";
import type { ElectionDataset } from "../../src/types/elections.ts";
import type { ElectorateDataset } from "../../src/types/electorate.ts";
import type { LiteracyDataset } from "../../src/types/literacy.ts";
import type { SocioeconomicDataset } from "../../src/types/socioeconomic.ts";
import {
  buildElectionModel,
  changeElectionComparisonContest,
  changeElectionContest,
  createElectionCsv,
  findComparableCandidate,
  getComparableContests,
  getDefaultElectionState,
  sanitizeElectionState,
} from "../../src/utils/elections.ts";
import { buildTerritorialDataset } from "../../src/utils/socioeconomic.ts";
import { ELEICOES_PENDENTES, INSTRUCAO_GERAR } from "./dadosPendentes.ts";

function loadData() {
  const elections = JSON.parse(
    readFileSync(
      new URL("../../src/data/election-history-go.json", import.meta.url),
      "utf8",
    ),
  ) as ElectionDataset;
  const electorate = JSON.parse(
    readFileSync(
      new URL("../../src/data/electorate-go.json", import.meta.url),
      "utf8",
    ),
  ) as ElectorateDataset;
  const socioeconomic = JSON.parse(
    readFileSync(
      new URL("../../src/data/socioeconomic-go.json", import.meta.url),
      "utf8",
    ),
  ) as SocioeconomicDataset;
  const ageStructure = JSON.parse(
    readFileSync(
      new URL("../../src/data/age-structure-go.json", import.meta.url),
      "utf8",
    ),
  ) as AgeStructureDataset;
  const literacy = JSON.parse(
    readFileSync(
      new URL("../../src/data/literacy-go.json", import.meta.url),
      "utf8",
    ),
  ) as LiteracyDataset;
  return {
    elections,
    municipalities: Object.values(
      buildTerritorialDataset(electorate, socioeconomic, ageStructure, literacy)
        .municipalities,
    ),
  };
}

// O conjunto de anos do snapshot é configurável (scripts/ajustar_anos.py pode
// remover anos), então o teste valida CONSISTÊNCIA INTERNA — metadata batendo
// com o conteúdo — em vez de fixar quantos e quais anos existem.
test("snapshot oficial é internamente consistente e cobre os 246 municípios em cada pleito", { skip: ELEICOES_PENDENTES ? INSTRUCAO_GERAR : false }, () => {
  const { elections } = loadData();
  assert.ok(elections.contests.length >= 4, "ao menos um ano completo (2 cargos x 2 turnos)");
  assert.equal(elections.metadata.contestCount, elections.contests.length);
  assert.equal(
    elections.metadata.municipalResultCount,
    elections.contests.length * 246,
  );
  assert.deepEqual(
    elections.metadata.years,
    [...new Set(elections.contests.map((contest) => contest.electionYear))].sort(),
  );
  for (const contest of elections.contests) {
    assert.equal(contest.municipalityCount, 246);
    assert.equal(Object.keys(contest.municipalities).length, 246);
    assert.equal(
      contest.candidates.reduce((total, candidate) => total + candidate.stateVotes, 0),
      contest.stateValidVotes,
    );
  }
});

test("estado salvo inválido volta para uma série oficial existente", { skip: ELEICOES_PENDENTES ? INSTRUCAO_GERAR : false }, () => {
  const { elections } = loadData();
  assert.deepEqual(
    sanitizeElectionState(
      { contestId: "inexistente", candidateId: "x" },
      elections,
    ),
    getDefaultElectionState(elections),
  );
});

test("modelo calcula participação, quintis, ranking e evolução em pontos percentuais", { skip: ELEICOES_PENDENTES ? INSTRUCAO_GERAR : false }, () => {
  const { elections, municipalities } = loadData();
  const base = getDefaultElectionState(elections);
  const state = { ...base, metricId: "swing" as const };
  const model = buildElectionModel(elections, municipalities, state);
  assert.equal(model.allItems.length, 246);
  assert.equal(model.bandCounts.reduce((total, count) => total + count, 0), 246);
  const portoAlegre = model.allItems.find(
    (item) => item.municipality.name === "Porto Alegre",
  );
  assert.ok(portoAlegre);
  assert.equal(
    Number(portoAlegre.value.toFixed(8)),
    Number((portoAlegre.sharePct - portoAlegre.comparisonSharePct).toFixed(8)),
  );
});

test("troca de pleito escolhe uma candidatura comparável e exporta a série municipal", { skip: ELEICOES_PENDENTES ? INSTRUCAO_GERAR : false }, () => {
  const { elections, municipalities } = loadData();
  const initial = getDefaultElectionState(elections);
  // Com um único ano no snapshot não existe pleito de outro ano; qualquer outro
  // pleito serve para exercitar a troca (a comparação, se nula, é declarada).
  const target =
    elections.contests.find(
      (contest) =>
        contest.electionYear !== elections.contests[0].electionYear &&
        contest.officeCode === elections.contests[0].officeCode &&
        contest.round === elections.contests[0].round,
    ) ?? elections.contests.find((contest) => contest.id !== elections.contests[0].id);
  assert.ok(target);
  const changed = changeElectionContest(initial, target.id, elections);
  assert.ok(target.candidates.some((candidate) => candidate.id === changed.candidateId));
  const csv = createElectionCsv(
    buildElectionModel(elections, municipalities, changed),
  );
  assert.equal(csv.startsWith("\uFEFF"), true);
  assert.match(csv, /"participacao_pct"/);
  assert.match(csv, /"diferenca_pontos_percentuais"/);
  assert.equal(csv.trim().split("\n").length, 498);
});

test("sem candidatura equivalente a comparação é nula e a evolução fica indisponível", { skip: ELEICOES_PENDENTES ? INSTRUCAO_GERAR : false }, () => {
  const { elections, municipalities } = loadData();
  // O snapshot pode ter um ano só (scripts/ajustar_anos.py), então o pleito
  // "anterior" é SINTÉTICO: um clone do pleito real, quatro anos antes, cujas
  // candidaturas não têm par com o candidato analisado. Isso mantém o cenário
  // "sem equivalente" testável com qualquer conjunto de anos.
  const source = elections.contests[elections.contests.length - 1];
  assert.ok(source.candidates.length >= 2);
  const analisado = source.candidates[0];
  const outroPartido = source.candidates.find(
    (candidate) =>
      candidate.party !== analisado.party &&
      candidate.ballotName !== analisado.ballotName &&
      candidate.fullName !== analisado.fullName,
  );
  assert.ok(outroPartido);
  const target = {
    ...source,
    id: `${source.electionYear - 4}-${source.officeCode}-${source.round}`,
    electionYear: source.electionYear - 4,
    candidates: [{ ...outroPartido, id: `${outroPartido.id}-anterior` }],
  };
  assert.equal(findComparableCandidate(analisado, target), null);
  assert.equal(
    findComparableCandidate(outroPartido, target)?.party,
    outroPartido.party,
  );

  const eleicoesComAnterior = {
    ...elections,
    contests: [...elections.contests, target],
  };
  const base = getDefaultElectionState(eleicoesComAnterior);
  const model = buildElectionModel(eleicoesComAnterior, municipalities, {
    ...base,
    contestId: source.id,
    candidateId: analisado.id,
    metricId: "swing",
    comparisonContestId: target.id,
    comparisonCandidateId: null,
  });
  assert.equal(model.comparisonCandidate, null);
  assert.equal(model.metricId, "share");
  assert.equal(model.metricShortLabel, "% dos votos válidos");

  const csv = createElectionCsv(model);
  const lines = csv.trim().split("\n");
  assert.equal(lines.length, 498);
  assert.match(lines[1], /"";"";"";"";"";"";""/);
});

test("o próprio pleito fica fora da lista de comparação", { skip: ELEICOES_PENDENTES ? INSTRUCAO_GERAR : false }, () => {
  const { elections } = loadData();
  // Com um ano só, alguns pleitos podem não ter comparável — o essencial é que
  // o próprio pleito NUNCA apareça na lista.
  let algumComparavel = false;
  for (const contest of elections.contests) {
    const comparable = getComparableContests(elections, contest);
    assert.ok(comparable.every((item) => item.id !== contest.id));
    if (comparable.length > 0) algumComparavel = true;
  }
  assert.ok(
    algumComparavel || elections.metadata.years.length <= 1,
    "com mais de um ano, algum pleito precisa ter comparável",
  );
  const state = getDefaultElectionState(elections);
  // Sem pleito alternativo (snapshot de um ano), o id degenerado pode ser o do
  // próprio pleito — mas o invariante SEMÂNTICO vale sempre: auto-comparação
  // nunca produz candidato comparável, logo nunca produz evolução falsa.
  const forced = changeElectionComparisonContest(state, state.contestId, elections);
  if (forced.comparisonContestId === state.contestId) {
    assert.equal(forced.comparisonCandidateId, null);
  }
});
