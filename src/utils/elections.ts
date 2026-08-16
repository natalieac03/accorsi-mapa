import type { AnalysisBand } from "../types/analysis";
import type {
  ElectionCandidate,
  ElectionContest,
  ElectionDataset,
  ElectionMetricId,
  ElectionModel,
  ElectionState,
} from "../types/elections";
import type { MunicipalityProfile } from "../types/electorate";
import {
  ALL_ANALYSIS_BANDS,
  calculateQuantileThresholds,
  getAnalysisBand,
  toggleAnalysisBand,
} from "./analysis.ts";
import { createCsv, formatCsvDecimal } from "./csv.ts";
import { formatDecimal, formatInteger, formatPercent } from "./electorate.ts";

export const ELECTION_METRICS: Array<{
  id: ElectionMetricId;
  label: string;
  description: string;
}> = [
  {
    id: "share",
    label: "Participação nos votos válidos",
    description: "Percentual do candidato entre os votos válidos do município.",
  },
  {
    id: "votes",
    label: "Quantidade de votos",
    description: "Total nominal recebido pelo candidato em cada município.",
  },
  {
    id: "swing",
    label: "Diferença entre duas séries",
    description: "Variação da participação municipal em pontos percentuais.",
  },
];

function getContest(dataset: ElectionDataset, contestId: string) {
  return dataset.contests.find((contest) => contest.id === contestId);
}

function getCandidate(contest: ElectionContest, candidateId: string) {
  return contest.candidates.find((candidate) => candidate.id === candidateId);
}

export function getComparableContests(
  dataset: ElectionDataset,
  contest: ElectionContest,
) {
  // The contest itself is never a comparison target: comparing a candidacy
  // with another candidacy of the same contest is not an evolution.
  return dataset.contests.filter(
    (candidate) =>
      candidate.id !== contest.id &&
      candidate.officeCode === contest.officeCode &&
      candidate.round === contest.round,
  );
}

// Um pleito nunca compara consigo mesmo: sem alternativa real, a comparação é
// declarada indisponível (null) — jamais uma auto-comparação com evolução zero.
function isSelfComparison(
  candidate: { id: string },
  contest: { candidates: Array<{ id: string }> },
) {
  return contest.candidates.some((item) => item.id === candidate.id);
}

export function findComparableCandidate(
  source: ElectionCandidate,
  target: ElectionContest,
): ElectionCandidate | null {
  if (isSelfComparison(source, target)) return null;
  const normalizedFullName = source.fullName.toLocaleLowerCase("pt-BR");
  const normalizedBallotName = source.ballotName.toLocaleLowerCase("pt-BR");
  // Match by full name, ballot name or party — never by mere list position:
  // when no equivalent candidacy exists, the comparison is unavailable.
  return (
    target.candidates.find(
      (candidate) =>
        candidate.fullName.toLocaleLowerCase("pt-BR") === normalizedFullName,
    ) ??
    target.candidates.find(
      (candidate) =>
        candidate.ballotName.toLocaleLowerCase("pt-BR") === normalizedBallotName,
    ) ??
    target.candidates.find(
      (candidate) => candidate.party && candidate.party === source.party,
    ) ??
    null
  );
}

/**
 * `true` enquanto o histórico do TSE for o placeholder do repositório: sem
 * nenhum pleito OU marcado como "pendente" nos metadados. A camada inteira de
 * eleições é opcional — quem consome este arquivo decide se some da tela, e
 * nada aqui inventa pleito, candidatura ou voto para "preencher" a ausência.
 */
export function isElectionDatasetPendente(dataset: ElectionDataset): boolean {
  return dataset.metadata.status === "pendente" || dataset.contests.length === 0;
}

/**
 * Estado neutro: usado quando não há pleito nenhum no snapshot. Todos os
 * identificadores ficam vazios/nulos — ausência declarada, jamais um pleito
 * fabricado com votos zerados.
 */
function getEmptyElectionState(): ElectionState {
  return {
    contestId: "",
    candidateId: "",
    metricId: "share",
    comparisonContestId: "",
    comparisonCandidateId: null,
    activeBands: [...ALL_ANALYSIS_BANDS],
    sortDirection: "desc",
  };
}

export function getDefaultElectionState(dataset: ElectionDataset): ElectionState {
  const contest = dataset.contests[0];
  // Snapshot pendente (contests: []) não derruba o app: devolve estado neutro
  // em vez de acessar o índice 0 de uma lista vazia.
  if (!contest) return getEmptyElectionState();
  const candidate = contest.candidates[0];
  if (!candidate) return getEmptyElectionState();
  const comparisonContest = getComparableContests(dataset, contest)[0] ?? contest;
  const comparisonCandidate = findComparableCandidate(candidate, comparisonContest);
  return {
    contestId: contest.id,
    candidateId: candidate.id,
    metricId: "share",
    comparisonContestId: comparisonContest.id,
    comparisonCandidateId: comparisonCandidate?.id ?? null,
    activeBands: [...ALL_ANALYSIS_BANDS],
    sortDirection: "desc",
  };
}

export function sanitizeElectionState(
  value: unknown,
  dataset: ElectionDataset,
): ElectionState {
  const fallback = getDefaultElectionState(dataset);
  // Sem pleito no snapshot não existe estado a sanear: só o estado neutro.
  if (dataset.contests.length === 0) return fallback;
  if (!value || typeof value !== "object") return fallback;
  const raw = value as Record<string, unknown>;
  const contest =
    typeof raw.contestId === "string"
      ? getContest(dataset, raw.contestId)
      : undefined;
  if (!contest) return fallback;
  const candidate =
    typeof raw.candidateId === "string"
      ? getCandidate(contest, raw.candidateId)
      : undefined;
  const comparisonContestCandidate =
    typeof raw.comparisonContestId === "string"
      ? getContest(dataset, raw.comparisonContestId)
      : undefined;
  const comparisonContest =
    comparisonContestCandidate &&
    comparisonContestCandidate.id !== contest.id &&
    comparisonContestCandidate.officeCode === contest.officeCode &&
    comparisonContestCandidate.round === contest.round
      ? comparisonContestCandidate
      : getComparableContests(dataset, contest)[0] ?? contest;
  const primaryCandidate = candidate ?? contest.candidates[0];
  // Pleito sem candidaturas no arquivo: nada a exibir, volta ao estado padrão.
  if (!primaryCandidate) return fallback;
  const comparisonCandidate =
    typeof raw.comparisonCandidateId === "string"
      ? getCandidate(comparisonContest, raw.comparisonCandidateId) ??
        findComparableCandidate(primaryCandidate, comparisonContest)
      : findComparableCandidate(primaryCandidate, comparisonContest);
  const activeBands = Array.isArray(raw.activeBands)
    ? Array.from(
        new Set(
          raw.activeBands.filter(
            (band): band is AnalysisBand =>
              typeof band === "number" && Number.isInteger(band) && band >= 0 && band <= 4,
          ),
        ),
      ).sort((a, b) => a - b)
    : [];
  return {
    contestId: contest.id,
    candidateId: primaryCandidate.id,
    metricId:
      raw.metricId === "votes" || raw.metricId === "swing"
        ? raw.metricId
        : "share",
    comparisonContestId: comparisonContest.id,
    comparisonCandidateId: comparisonCandidate?.id ?? null,
    activeBands: activeBands.length ? activeBands : [...ALL_ANALYSIS_BANDS],
    sortDirection: raw.sortDirection === "asc" ? "asc" : "desc",
  };
}

export function changeElectionContest(
  state: ElectionState,
  contestId: string,
  dataset: ElectionDataset,
): ElectionState {
  const currentContest = getContest(dataset, state.contestId) ?? dataset.contests[0];
  // Snapshot pendente: não há para onde trocar, o estado segue como está.
  if (!currentContest) return state;
  const currentCandidate =
    getCandidate(currentContest, state.candidateId) ?? currentContest.candidates[0];
  const contest = getContest(dataset, contestId) ?? currentContest;
  const candidate =
    (currentCandidate ? findComparableCandidate(currentCandidate, contest) : null) ??
    contest.candidates[0];
  if (!candidate) return state;
  const comparisonContest = getComparableContests(dataset, contest)[0] ?? contest;
  const comparisonCandidate = findComparableCandidate(candidate, comparisonContest);
  return {
    ...state,
    contestId: contest.id,
    candidateId: candidate.id,
    comparisonContestId: comparisonContest.id,
    comparisonCandidateId: comparisonCandidate?.id ?? null,
  };
}

export function changeElectionCandidate(
  state: ElectionState,
  candidateId: string,
  dataset: ElectionDataset,
): ElectionState {
  const contest = getContest(dataset, state.contestId) ?? dataset.contests[0];
  // Snapshot pendente: sem pleito não há candidatura a selecionar.
  if (!contest) return state;
  const candidate = getCandidate(contest, candidateId) ?? contest.candidates[0];
  if (!candidate) return state;
  const comparisonContest =
    getContest(dataset, state.comparisonContestId) ?? contest;
  const comparisonCandidate = findComparableCandidate(candidate, comparisonContest);
  return {
    ...state,
    candidateId: candidate.id,
    comparisonCandidateId: comparisonCandidate?.id ?? null,
  };
}

export function changeElectionComparisonContest(
  state: ElectionState,
  contestId: string,
  dataset: ElectionDataset,
): ElectionState {
  const primaryContest = getContest(dataset, state.contestId) ?? dataset.contests[0];
  // Snapshot pendente: sem pleito não existe comparação possível.
  if (!primaryContest) return state;
  const primaryCandidate =
    getCandidate(primaryContest, state.candidateId) ?? primaryContest.candidates[0];
  const alternatives = getComparableContests(dataset, primaryContest);
  const contest =
    alternatives.find((item) => item.id === contestId) ??
    alternatives[0] ??
    primaryContest;
  const candidate = primaryCandidate
    ? findComparableCandidate(primaryCandidate, contest)
    : null;
  return {
    ...state,
    comparisonContestId: contest.id,
    comparisonCandidateId: candidate?.id ?? null,
  };
}

function getMetricValue(
  metricId: ElectionMetricId,
  votes: number,
  sharePct: number,
  comparisonSharePct: number,
) {
  if (metricId === "votes") return votes;
  if (metricId === "swing") return sharePct - comparisonSharePct;
  return sharePct;
}

/**
 * Devolve `null` quando o histórico ainda é placeholder (nenhum pleito ou
 * pleito sem candidaturas). Ausência de dado é AUSÊNCIA: quem chama esconde a
 * camada e explica o porquê — nada de mapa pintado com zeros inventados.
 */
export function buildElectionModel(
  dataset: ElectionDataset,
  municipalities: MunicipalityProfile[],
  state: ElectionState,
): ElectionModel | null {
  if (isElectionDatasetPendente(dataset)) return null;
  const sanitized = sanitizeElectionState(state, dataset);
  const contest = getContest(dataset, sanitized.contestId) ?? dataset.contests[0];
  if (!contest) return null;
  const candidate = getCandidate(contest, sanitized.candidateId) ?? contest.candidates[0];
  if (!candidate) return null;
  const comparisonContest =
    getContest(dataset, sanitized.comparisonContestId) ?? contest;
  const comparisonCandidate = sanitized.comparisonCandidateId
    ? getCandidate(comparisonContest, sanitized.comparisonCandidateId) ?? null
    : null;
  // Without an equivalent candidacy the swing metric is unavailable: the map
  // falls back to the share metric and the UI explains why.
  const metricId: ElectionMetricId =
    sanitized.metricId === "swing" && !comparisonCandidate
      ? "share"
      : sanitized.metricId;
  const rawItems = municipalities.map((municipality) => {
    const result = contest.municipalities[municipality.ibgeCode];
    const comparisonResult =
      comparisonContest.municipalities[municipality.ibgeCode];
    const votes = result?.votes[candidate.id] ?? 0;
    const validVotes = result?.validVotes ?? 0;
    const comparisonVotes = comparisonCandidate
      ? comparisonResult?.votes[comparisonCandidate.id] ?? 0
      : 0;
    const comparisonValidVotes = comparisonResult?.validVotes ?? 0;
    const sharePct = validVotes > 0 ? (votes / validVotes) * 100 : 0;
    const comparisonSharePct =
      comparisonCandidate && comparisonValidVotes > 0
        ? (comparisonVotes / comparisonValidVotes) * 100
        : 0;
    return {
      municipality,
      votes,
      validVotes,
      sharePct,
      comparisonVotes,
      comparisonValidVotes,
      comparisonSharePct,
      value: getMetricValue(
        metricId,
        votes,
        sharePct,
        comparisonSharePct,
      ),
      winner: result?.winnerCandidateId === candidate.id,
    };
  });
  const thresholds = calculateQuantileThresholds(rawItems.map((item) => item.value));
  const ranked = [...rawItems].sort(
    (a, b) => b.value - a.value || a.municipality.name.localeCompare(b.municipality.name, "pt-BR"),
  );
  const rankById = new Map(
    ranked.map((item, index) => [item.municipality.ibgeCode, index + 1]),
  );
  const allItems = rawItems.map((item) => ({
    ...item,
    band: getAnalysisBand(item.value, thresholds),
    rank: rankById.get(item.municipality.ibgeCode) ?? 0,
  }));
  const direction = sanitized.sortDirection === "desc" ? -1 : 1;
  const filteredItems = allItems
    .filter((item) => sanitized.activeBands.includes(item.band))
    .sort(
      (a, b) =>
        (a.value - b.value) * direction ||
        a.municipality.name.localeCompare(b.municipality.name, "pt-BR"),
    );
  const focusedValues = filteredItems.map((item) => item.value);
  const metric = ELECTION_METRICS.find((item) => item.id === metricId)!;
  const bestMunicipality = [...allItems].sort(
    (a, b) => b.sharePct - a.sharePct,
  )[0];
  return {
    contest,
    candidate,
    comparisonContest,
    comparisonCandidate,
    metricId,
    metricLabel: metric.label,
    metricShortLabel:
      metricId === "votes"
        ? "Votos"
        : metricId === "swing"
          ? "Diferença (p.p.)"
          : "% dos votos válidos",
    thresholds,
    bandCounts: ALL_ANALYSIS_BANDS.map(
      (band) => allItems.filter((item) => item.band === band).length,
    ),
    allItems,
    filteredItems,
    focusedMinimum: focusedValues.length ? Math.min(...focusedValues) : 0,
    focusedMaximum: focusedValues.length ? Math.max(...focusedValues) : 0,
    stateValue: getMetricValue(
      metricId,
      candidate.stateVotes,
      candidate.stateSharePct,
      comparisonCandidate?.stateSharePct ?? 0,
    ),
    stateSharePct: candidate.stateSharePct,
    comparisonStateSharePct: comparisonCandidate?.stateSharePct ?? 0,
    stateVotes: candidate.stateVotes,
    municipalitiesWon: candidate.municipalitiesWon,
    bestMunicipality,
  };
}

export function formatElectionMetricValue(metricId: ElectionMetricId, value: number) {
  if (metricId === "votes") return formatInteger(Math.round(value));
  if (metricId === "swing") {
    const sign = value > 0 ? "+" : "";
    return `${sign}${formatDecimal(value)} p.p.`;
  }
  return formatPercent(value);
}

export function getElectionRangeLabel(
  metricId: ElectionMetricId,
  thresholds: number[],
  band: AnalysisBand,
) {
  const format = (value: number) => formatElectionMetricValue(metricId, value);
  if (band === 0) return `Até ${format(thresholds[0])}`;
  if (band === 4) return `Acima de ${format(thresholds[3])}`;
  return `${format(thresholds[band - 1])} a ${format(thresholds[band])}`;
}

export function createElectionCsv(model: ElectionModel) {
  const comparison = model.comparisonCandidate;
  const rows = model.filteredItems.map((item) => [
    item.municipality.ibgeCode,
    item.municipality.tseCode,
    item.municipality.name,
    model.contest.electionYear,
    model.contest.officeName,
    model.contest.round,
    model.candidate.number,
    model.candidate.ballotName,
    model.candidate.party,
    item.votes,
    item.validVotes,
    formatCsvDecimal(item.sharePct),
    comparison ? model.comparisonContest.electionYear : "",
    comparison?.number ?? "",
    comparison?.ballotName ?? "",
    comparison?.party ?? "",
    comparison ? item.comparisonVotes : "",
    comparison ? formatCsvDecimal(item.comparisonSharePct) : "",
    comparison ? formatCsvDecimal(item.sharePct - item.comparisonSharePct) : "",
    item.winner ? "sim" : "não",
  ]);
  return createCsv(
    [
      "codigo_ibge",
      "codigo_tse",
      "municipio",
      "ano",
      "cargo",
      "turno",
      "numero_candidato",
      "candidato",
      "partido",
      "votos",
      "votos_validos_municipio",
      "participacao_pct",
      "ano_comparacao",
      "numero_candidato_comparacao",
      "candidato_comparacao",
      "partido_comparacao",
      "votos_comparacao",
      "participacao_comparacao_pct",
      "diferenca_pontos_percentuais",
      "liderou_municipio",
    ],
    rows,
  );
}

export function getElectionCsvFilename(model: ElectionModel) {
  const candidate = model.candidate.ballotName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return `historico-tse-${model.contest.electionYear}-${model.contest.officeName.toLowerCase()}-${model.contest.round}t-${candidate}.csv`;
}

export { toggleAnalysisBand as toggleElectionBand };
