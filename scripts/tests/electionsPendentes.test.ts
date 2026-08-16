import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type {
  ElectionCandidate,
  ElectionContest,
  ElectionDataset,
} from "../../src/types/elections.ts";
import type { MunicipalityProfile } from "../../src/types/electorate.ts";
import {
  buildElectionModel,
  changeElectionCandidate,
  changeElectionComparisonContest,
  changeElectionContest,
  getDefaultElectionState,
  isElectionDatasetPendente,
  sanitizeElectionState,
} from "../../src/utils/elections.ts";

/**
 * Camada de eleições com snapshot PENDENTE.
 *
 * Payloads sintéticos inline, montados aqui mesmo: nada depende de
 * `src/data`, então NENHUM teste deste arquivo é pulado — ele roda de
 * verdade antes e depois de `gerar_dados.sh`.
 *
 * O que está sob teste é a disciplina do nulo: dataset sem pleito devolve
 * `null`/estado neutro e o aplicativo segue de pé. Em nenhum momento o motor
 * pode fabricar pleito, candidatura ou voto zerado para "preencher a tela".
 */

const METADATA_PENDENTE: ElectionDataset["metadata"] = {
  state: "GO",
  status: "pendente",
  years: [],
  offices: [],
  rounds: [],
  source: "TSE",
  dataset: "Votação por seção",
  sourceUrl: "https://dadosabertos.tse.jus.br/",
  processedAtUtc: "1970-01-01T00:00:00+00:00",
  municipalityCount: 0,
  contestCount: 0,
  municipalResultCount: 0,
  sourceRows: 0,
  selectedRows: 0,
  privacyLevel: "Resultados públicos agregados por município.",
  inputFiles: {},
};

/** Placeholder do repositório: marcado "pendente" e sem pleito nenhum. */
function datasetPendente(): ElectionDataset {
  return { metadata: { ...METADATA_PENDENTE }, contests: [] };
}

function candidato(
  id: string,
  overrides: Partial<ElectionCandidate> = {},
): ElectionCandidate {
  return {
    id,
    number: "13",
    ballotName: `URNA ${id}`,
    fullName: `NOME COMPLETO ${id}`,
    party: "PSB",
    partyName: "Partido Sintético Brasileiro",
    registrationStatus: "APTO",
    resultStatus: "ELEITO",
    stateVotes: 600,
    stateSharePct: 60,
    stateRank: 1,
    municipalitiesWon: 1,
    ...overrides,
  };
}

function pleito(): ElectionContest {
  return {
    id: "2022-1-1",
    electionYear: 2022,
    round: 1,
    officeCode: 1,
    officeName: "Presidente",
    electionDate: "2022-10-02",
    generatedAt: "2022-10-03T00:00:00+00:00",
    stateValidVotes: 1000,
    municipalityCount: 2,
    candidates: [
      candidato("c1"),
      candidato("c2", {
        number: "22",
        party: "PDS",
        stateVotes: 400,
        stateSharePct: 40,
        stateRank: 2,
        municipalitiesWon: 1,
      }),
    ],
    municipalities: {
      "5200001": {
        validVotes: 400,
        winnerCandidateId: "c1",
        votes: { c1: 300, c2: 100 },
      },
      "5200002": {
        validVotes: 600,
        winnerCandidateId: "c2",
        votes: { c1: 300, c2: 300 },
      },
    },
  };
}

/** Dataset mínimo, porém VÁLIDO: prova que o caminho feliz segue intacto. */
function datasetValido(): ElectionDataset {
  const contest = pleito();
  return {
    metadata: {
      ...METADATA_PENDENTE,
      status: undefined,
      years: [2022],
      offices: ["Presidente"],
      rounds: [1],
      municipalityCount: 2,
      contestCount: 1,
      municipalResultCount: 2,
    },
    contests: [contest],
  };
}

function municipio(ibgeCode: string, name: string): MunicipalityProfile {
  return {
    ibgeCode,
    tseCode: ibgeCode.slice(-5),
    name,
    electorate: 1000,
    stateSharePct: 50,
    stateRank: 1,
    zoneCount: 1,
    biometrics: 500,
    biometricsPct: 50,
    registeredDisability: 0,
    socialName: 0,
    topAgeGroup: { label: "35 a 39 anos", electorate: 200, percentage: 20 },
    gender: { female: 500, male: 500, notInformed: 0 },
    // Indicadores sem valor são null — ausência declarada, nunca zero.
    socioeconomic: {
      populationEstimate: null,
      censusPopulation: null,
      populationDensity: null,
      gdpPerCapita: null,
      schoolAttendance: null,
      occupiedPopulation: null,
      formalAverageSalary: null,
      adequateSanitation: null,
      lowIncomePopulation: null,
    },
    age: null,
    literacy: null,
  };
}

const MUNICIPIOS = [
  municipio("5200001", "Cidade Alfa"),
  municipio("5200002", "Cidade Beta"),
];

test("dataset sem pleito: buildElectionModel devolve null e não lança", () => {
  const dataset = datasetPendente();
  const state = getDefaultElectionState(dataset);
  assert.doesNotThrow(() => buildElectionModel(dataset, MUNICIPIOS, state));
  assert.equal(buildElectionModel(dataset, MUNICIPIOS, state), null);
  // Sem status "pendente", só a lista vazia, o resultado é o mesmo.
  const semStatus: ElectionDataset = {
    metadata: { ...METADATA_PENDENTE, status: undefined },
    contests: [],
  };
  assert.equal(
    buildElectionModel(semStatus, MUNICIPIOS, getDefaultElectionState(semStatus)),
    null,
  );
});

test("dataset sem pleito: getDefaultElectionState devolve estado neutro sem lançar", () => {
  const dataset = datasetPendente();
  let state = getDefaultElectionState(dataset);
  assert.doesNotThrow(() => getDefaultElectionState(dataset));
  // Ausência declarada: identificadores vazios, comparação nula. Nenhum id
  // aponta para pleito ou candidatura inventada.
  assert.equal(state.contestId, "");
  assert.equal(state.candidateId, "");
  assert.equal(state.comparisonContestId, "");
  assert.equal(state.comparisonCandidateId, null);
  assert.equal(state.metricId, "share");
  assert.deepEqual(state.activeBands, [0, 1, 2, 3, 4]);

  // Saneamento e trocas de seleção também são inertes, nunca explosivas.
  assert.deepEqual(sanitizeElectionState(null, dataset), state);
  assert.deepEqual(
    sanitizeElectionState({ contestId: "2022-1-1", candidateId: "c1" }, dataset),
    state,
  );
  state = changeElectionContest(state, "2022-1-1", dataset);
  state = changeElectionCandidate(state, "c1", dataset);
  state = changeElectionComparisonContest(state, "2018-1-1", dataset);
  assert.equal(state.contestId, "");
  assert.equal(state.candidateId, "");
  assert.equal(state.comparisonCandidateId, null);
});

test("isElectionDatasetPendente detecta contests vazio E status pendente", () => {
  // 1) status "pendente" com lista vazia (o placeholder versionado).
  assert.equal(isElectionDatasetPendente(datasetPendente()), true);
  // 2) sem status, apenas contests vazio.
  assert.equal(
    isElectionDatasetPendente({
      metadata: { ...METADATA_PENDENTE, status: undefined },
      contests: [],
    }),
    true,
  );
  // 3) status "pendente" mesmo com pleito no arquivo: o ETL manda.
  assert.equal(
    isElectionDatasetPendente({
      ...datasetValido(),
      metadata: { ...datasetValido().metadata, status: "pendente" },
    }),
    true,
  );
  // 4) snapshot íntegro não é pendente.
  assert.equal(isElectionDatasetPendente(datasetValido()), false);
});

test("caminho feliz intacto: dataset sintético válido constrói o modelo", () => {
  const dataset = datasetValido();
  const state = getDefaultElectionState(dataset);
  assert.equal(state.contestId, "2022-1-1");
  assert.equal(state.candidateId, "c1");
  // Um pleito só: não há série comparável, então a comparação é nula.
  assert.equal(state.comparisonCandidateId, null);

  const model = buildElectionModel(dataset, MUNICIPIOS, state);
  assert.ok(model);
  assert.equal(model.contest.id, "2022-1-1");
  assert.equal(model.candidate.id, "c1");
  assert.equal(model.metricId, "share");
  assert.equal(model.allItems.length, 2);
  const alfa = model.allItems.find(
    (item) => item.municipality.ibgeCode === "5200001",
  );
  const beta = model.allItems.find(
    (item) => item.municipality.ibgeCode === "5200002",
  );
  assert.ok(alfa && beta);
  assert.equal(alfa.votes, 300);
  assert.equal(alfa.validVotes, 400);
  assert.equal(alfa.sharePct, 75);
  assert.equal(alfa.winner, true);
  assert.equal(beta.sharePct, 50);
  assert.equal(beta.winner, false);
  assert.equal(model.stateVotes, 600);
  assert.equal(model.stateSharePct, 60);
  assert.equal(model.bestMunicipality.municipality.ibgeCode, "5200001");

  // Trocar de candidatura continua funcionando no dataset válido.
  const outro = changeElectionCandidate(state, "c2", dataset);
  const modelOutro = buildElectionModel(dataset, MUNICIPIOS, outro);
  assert.ok(modelOutro);
  assert.equal(modelOutro.candidate.id, "c2");
  assert.equal(modelOutro.stateVotes, 400);
});

test("arquivo versionado em src/data nunca derruba a inicialização", () => {
  const arquivo = JSON.parse(
    readFileSync(
      new URL("../../src/data/election-history-go.json", import.meta.url),
      "utf8",
    ),
  ) as ElectionDataset;
  // Vale com placeholder e com snapshot gerado: o modelo é nulo exatamente
  // quando o dado está pendente — nunca um modelo "vazio" cheio de zeros.
  const state = getDefaultElectionState(arquivo);
  const model = buildElectionModel(arquivo, MUNICIPIOS, state);
  assert.equal(model === null, isElectionDatasetPendente(arquivo));
});
