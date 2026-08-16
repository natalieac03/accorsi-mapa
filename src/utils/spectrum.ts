import type { AnalysisBand } from "../types/analysis";
import type { ElectionDataset } from "../types/elections";
import type { MunicipalityProfile } from "../types/electorate";
import type {
  PartySpectrumRegistry,
  PartySpectrumWave,
  ResolvedPartyScore,
  SpectrumBlock,
  SpectrumMetricId,
  SpectrumModel,
  SpectrumMunicipalityItem,
  SpectrumSourceContest,
  SpectrumState,
  SpectrumUnscoredParty,
} from "../types/spectrum";
import {
  ALL_ANALYSIS_BANDS,
  calculateQuantileThresholds,
  getAnalysisBand,
  toggleAnalysisBand,
} from "./analysis.ts";
import { createCsv, formatCsvDecimal } from "./csv.ts";
import { formatDecimal, formatPercent } from "./electorate.ts";

export const SPECTRUM_BLOCKS: SpectrumBlock[] = ["left", "center", "right"];

export const SPECTRUM_BLOCK_LABELS: Record<SpectrumBlock, string> = {
  left: "Esquerda",
  center: "Centro",
  right: "Direita",
};

/**
 * Paleta divergente de cinco passos do índice: violeta (esquerda) ↔ ocre
 * (direita), com cinza claro neutro no centro.
 *
 * Escolhida deliberadamente fora do par vermelho-azul e fora das cores usadas
 * pelos partidos brasileiros, para que a cor não sugira nenhuma sigla. Violeta
 * e ocre se separam pelo eixo azul-amarelo, justamente o eixo que a daltonia
 * vermelho-verde preserva: validado par a par com ΔE ≥ 16 (OKLab ×100) sob
 * protanopia e deuteranopia, e ≥ 3:1 de contraste sobre o painel escuro. O
 * passo do meio tem croma ~0,01, ou seja, é cinza de verdade: lê como "sem
 * predominância", nunca como um terceiro lado.
 */
export const SPECTRUM_COLORS = [
  "#7a52b8",
  "#b0a0da",
  "#eae8e3",
  "#e2ab68",
  "#bd6f1e",
] as const;

/**
 * Paleta divergente própria do DESLOCAMENTO do índice, em torno de zero:
 * violeta = moveu para a esquerda, ocre = moveu para a direita, cinza neutro
 * = estável. Deriva da SPECTRUM_COLORS porque os polos têm o mesmo
 * significado (esquerda/direita), mas com passos próprios para que os dois
 * mapas não se confundam e para abrir a separação dos vizinhos num
 * coroplético, onde qualquer par de faixas pode ficar lado a lado.
 *
 * Validada com o validador da skill dataviz sobre o fundo #070d0d no modo
 * todos-os-pares: pior par #b96712↔#e2a45c com ΔE 16,6 sob deuteranopia e
 * 17,0 em visão normal (piso 15), todos os passos ≥ 3:1 de contraste. O
 * centro #eae8e3 tem croma ~0,01 (cinza de verdade, "não se moveu") e fica a
 * ΔE ~31 do cinza de "sem dado" (#788382), então estabilidade nunca se
 * confunde com ausência de índice.
 */
export const SPECTRUM_SHIFT_COLORS = [
  "#8a5cd0",
  "#bda9e6",
  "#eae8e3",
  "#e2a45c",
  "#b96712",
] as const;

/**
 * Faixas absolutas do deslocamento, simétricas em torno de zero e fixas em
 * pontos da escala 0–10: a faixa central (−0,25 a +0,25) lê como estabilidade.
 */
export const SPECTRUM_SHIFT_THRESHOLDS = [-1, -0.25, 0.25, 1] as const;

/** Paleta da métrica: o deslocamento tem paleta divergente própria. */
export function getSpectrumMetricColors(metricId: SpectrumMetricId) {
  return metricId === "shift" ? SPECTRUM_SHIFT_COLORS : SPECTRUM_COLORS;
}

export const SPECTRUM_METRICS: Array<{
  id: SpectrumMetricId;
  label: string;
  shortLabel: string;
  description: string;
}> = [
  {
    id: "index",
    label: "Índice ideológico ponderado",
    shortLabel: "Índice 0–10",
    description:
      "Média das notas dos partidos votados no município, ponderada pelos votos que cada um recebeu.",
  },
  {
    id: "shift",
    label: "Deslocamento do índice",
    shortLabel: "Deslocamento",
    description:
      "Índice do pleito analisado menos o índice do pleito de comparação, em pontos da escala 0–10. Positivo = moveu para a direita.",
  },
  {
    id: "left",
    label: "Participação da esquerda",
    shortLabel: "% esquerda",
    description: "Percentual dos votos com nota que foram para partidos do bloco de esquerda.",
  },
  {
    id: "center",
    label: "Participação do centro",
    shortLabel: "% centro",
    description: "Percentual dos votos com nota que foram para partidos do bloco de centro.",
  },
  {
    id: "right",
    label: "Participação da direita",
    shortLabel: "% direita",
    description: "Percentual dos votos com nota que foram para partidos do bloco de direita.",
  },
  {
    id: "coverage",
    label: "Cobertura do índice",
    shortLabel: "% coberto",
    description:
      "Percentual dos votos do município que caíram em partidos com nota no survey aplicado.",
  },
];

const EMPTY_BLOCK_VOTES: Record<SpectrumBlock, number> = {
  left: 0,
  center: 0,
  right: 0,
};

function emptyBlocks(): Record<SpectrumBlock, number> {
  return { ...EMPTY_BLOCK_VOTES };
}

export function normalizePartyCode(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase();
}

export type PartySpectrumIndex = {
  registry: PartySpectrumRegistry;
  /** alias normalizado -> código canônico do partido */
  aliasToCode: Map<string, string>;
  /** `${code}|${wave}` -> nota resolvida */
  scores: Map<string, ResolvedPartyScore>;
  waves: Map<number, PartySpectrumWave>;
};

export function classifySpectrumBlock(
  score: number,
  registry: PartySpectrumRegistry,
): SpectrumBlock {
  const { leftMaximum, rightMinimum } = registry.metadata.blockThresholds;
  if (score <= leftMaximum) return "left";
  if (score >= rightMinimum) return "right";
  return "center";
}

export function buildPartySpectrumIndex(
  registry: PartySpectrumRegistry,
): PartySpectrumIndex {
  const aliasToCode = new Map<string, string>();
  const scores = new Map<string, ResolvedPartyScore>();
  for (const party of registry.parties) {
    const aliases = new Set([party.code, ...party.aliases]);
    for (const alias of aliases) {
      const normalized = normalizePartyCode(alias);
      if (!normalized) continue;
      const existing = aliasToCode.get(normalized);
      if (existing && existing !== party.code) {
        throw new Error(
          `Alias de partido ambíguo: "${alias}" aponta para ${existing} e ${party.code}.`,
        );
      }
      aliasToCode.set(normalized, party.code);
    }
    for (const [wave, score] of Object.entries(party.scores)) {
      if (score === null || score === undefined) continue;
      if (!Number.isFinite(score) || score < 0 || score > 10) {
        throw new Error(
          `Nota fora da escala 0-10 para ${party.code} na onda ${wave}: ${String(score)}.`,
        );
      }
      scores.set(`${party.code}|${wave}`, {
        code: party.code,
        name: party.name,
        score,
        block: classifySpectrumBlock(score, registry),
        derived: Boolean(party.derivedFrom?.[wave]),
      });
    }
  }
  const waves = new Map(registry.metadata.waves.map((wave) => [wave.year, wave]));
  return { registry, aliasToCode, scores, waves };
}

export function resolveWaveYear(
  registry: PartySpectrumRegistry,
  electionYear: number,
) {
  const configured = registry.metadata.waveByElectionYear[String(electionYear)];
  if (typeof configured === "number") return configured;
  const years = registry.metadata.waves
    .map((wave) => wave.year)
    .filter((year) => year <= electionYear)
    .sort((a, b) => b - a);
  return years[0] ?? registry.metadata.waves[0].year;
}

export function resolvePartyScore(
  index: PartySpectrumIndex,
  party: string,
  waveYear: number,
): ResolvedPartyScore | null {
  const code = index.aliasToCode.get(normalizePartyCode(party));
  if (!code) return null;
  return index.scores.get(`${code}|${waveYear}`) ?? null;
}

/**
 * Converte os pleitos do snapshot de candidaturas em pleitos de espectro,
 * somando os votos de todas as candidaturas de um mesmo partido.
 */
export function buildContestsFromElections(
  elections: ElectionDataset,
  registry: PartySpectrumRegistry,
): SpectrumSourceContest[] {
  return elections.contests.map((contest) => {
    const partyByCandidate = new Map(
      contest.candidates.map((candidate) => [candidate.id, candidate.party]),
    );
    const municipalities: Record<string, Record<string, number>> = {};
    for (const [ibgeCode, result] of Object.entries(contest.municipalities)) {
      const byParty: Record<string, number> = {};
      for (const [candidateId, votes] of Object.entries(result.votes)) {
        const party = partyByCandidate.get(candidateId);
        if (!party || !votes) continue;
        byParty[party] = (byParty[party] ?? 0) + votes;
      }
      municipalities[ibgeCode] = byParty;
    }
    return {
      id: `elections:${contest.id}`,
      electionYear: contest.electionYear,
      round: contest.round,
      officeCode: contest.officeCode,
      officeName: contest.officeName,
      origin: "candidates" as const,
      waveYear: resolveWaveYear(registry, contest.electionYear),
      stateTotalVotes: contest.stateValidVotes,
      municipalities,
    };
  });
}

export type PartyVotesDataset = {
  metadata: { schemaVersion: number; municipalityCount: number };
  contests: Array<{
    id: string;
    electionYear: number;
    round: number;
    officeCode: number;
    officeName: string;
    stateTotalVotes: number;
    municipalities: Record<string, { totalVotes: number; votes: Record<string, number> }>;
  }>;
};

/** Pleitos vindos do snapshot de votos por partido (eleições municipais). */
export function buildContestsFromPartyVotes(
  dataset: PartyVotesDataset | null | undefined,
  registry: PartySpectrumRegistry,
): SpectrumSourceContest[] {
  if (!dataset || !Array.isArray(dataset.contests)) return [];
  return dataset.contests.map((contest) => {
    const municipalities: Record<string, Record<string, number>> = {};
    for (const [ibgeCode, result] of Object.entries(contest.municipalities)) {
      municipalities[ibgeCode] = { ...result.votes };
    }
    return {
      id: `parties:${contest.id}`,
      electionYear: contest.electionYear,
      round: contest.round,
      officeCode: contest.officeCode,
      officeName: contest.officeName,
      origin: "parties" as const,
      waveYear: resolveWaveYear(registry, contest.electionYear),
      stateTotalVotes: contest.stateTotalVotes,
      municipalities,
    };
  });
}

export function buildSpectrumContests(
  elections: ElectionDataset,
  partyVotes: PartyVotesDataset | null | undefined,
  registry: PartySpectrumRegistry,
): SpectrumSourceContest[] {
  return [
    ...buildContestsFromPartyVotes(partyVotes, registry),
    ...buildContestsFromElections(elections, registry),
  ].sort(
    (a, b) =>
      b.electionYear - a.electionYear ||
      a.officeCode - b.officeCode ||
      a.round - b.round,
  );
}

export function getSpectrumContestLabel(contest: SpectrumSourceContest) {
  return `${contest.electionYear} · ${contest.officeName} · ${contest.round}º turno`;
}

export function getDefaultSpectrumState(
  contests: SpectrumSourceContest[],
): SpectrumState {
  return {
    contestId: contests[0]?.id ?? "",
    metricId: "index",
    comparisonContestId: null,
    bandMode: "absolute",
    activeBands: [...ALL_ANALYSIS_BANDS],
    sortDirection: "desc",
  };
}

export function sanitizeSpectrumState(
  value: unknown,
  contests: SpectrumSourceContest[],
): SpectrumState {
  const fallback = getDefaultSpectrumState(contests);
  if (!value || typeof value !== "object") return fallback;
  const raw = value as Record<string, unknown>;
  const contest =
    typeof raw.contestId === "string"
      ? contests.find((item) => item.id === raw.contestId)
      : undefined;
  const metricId = SPECTRUM_METRICS.some((metric) => metric.id === raw.metricId)
    ? (raw.metricId as SpectrumMetricId)
    : fallback.metricId;
  const contestId = contest?.id ?? fallback.contestId;
  // O pleito de comparação precisa existir na lista e NUNCA pode ser o próprio
  // pleito analisado — mesma disciplina adotada em elections depois do defeito
  // do "próprio pleito fora da lista". Estados antigos sem o campo caem em null.
  const comparisonCandidate =
    typeof raw.comparisonContestId === "string"
      ? contests.find((item) => item.id === raw.comparisonContestId)
      : undefined;
  const comparisonContestId =
    comparisonCandidate && comparisonCandidate.id !== contestId
      ? comparisonCandidate.id
      : null;
  const activeBands = Array.isArray(raw.activeBands)
    ? Array.from(
        new Set(
          raw.activeBands.filter(
            (band): band is AnalysisBand =>
              typeof band === "number" &&
              Number.isInteger(band) &&
              band >= 0 &&
              band <= 4,
          ),
        ),
      ).sort((a, b) => a - b)
    : [];
  return {
    contestId,
    metricId,
    comparisonContestId,
    bandMode: raw.bandMode === "quantile" ? "quantile" : "absolute",
    activeBands: activeBands.length ? activeBands : [...ALL_ANALYSIS_BANDS],
    sortDirection: raw.sortDirection === "asc" ? "asc" : "desc",
  };
}

/**
 * Faixas absolutas do índice, ancoradas nos limiares de bloco do registro.
 * Para métricas percentuais a escala é fixa de 0 a 100.
 */
export function getAbsoluteThresholds(
  metricId: SpectrumMetricId,
  registry: PartySpectrumRegistry,
) {
  // Deslocamento: limiares fixos e simétricos em torno de zero, com a faixa
  // central lendo como estabilidade (−0,25 a +0,25 ponto).
  if (metricId === "shift") return [...SPECTRUM_SHIFT_THRESHOLDS];
  if (metricId !== "index") return [20, 40, 60, 80];
  const { leftMaximum, rightMinimum } = registry.metadata.blockThresholds;
  const { minimum, maximum } = registry.metadata.scale;
  const lower = minimum + (leftMaximum - minimum) / 2;
  const upper = rightMinimum + (maximum - rightMinimum) / 2;
  return [lower, leftMaximum, rightMinimum, upper];
}

function getMetricValue(
  metricId: SpectrumMetricId,
  item: {
    index: number | null;
    shift: number | null;
    blockSharePct: Record<SpectrumBlock, number>;
    coveragePct: number;
  },
): number | null {
  switch (metricId) {
    case "shift":
      return item.shift;
    case "left":
      return item.index === null ? null : item.blockSharePct.left;
    case "center":
      return item.index === null ? null : item.blockSharePct.center;
    case "right":
      return item.index === null ? null : item.blockSharePct.right;
    case "coverage":
      return item.coveragePct;
    case "index":
    default:
      return item.index;
  }
}

/**
 * Índice 0–10 por município de um pleito, sem o restante do modelo. Usado
 * para o pleito de comparação do deslocamento: municípios cujos votos caíram
 * todos em siglas sem nota na onda do pleito ficam null, nunca zero.
 */
export function computeContestIndices(
  contest: SpectrumSourceContest,
  index: PartySpectrumIndex,
): { byMunicipality: Map<string, number | null>; stateIndex: number | null } {
  const byMunicipality = new Map<string, number | null>();
  let stateScoredVotes = 0;
  let stateWeightedSum = 0;
  for (const [ibgeCode, byParty] of Object.entries(contest.municipalities)) {
    let scoredVotes = 0;
    let weightedSum = 0;
    for (const [party, votes] of Object.entries(byParty)) {
      if (!Number.isFinite(votes) || votes <= 0) continue;
      const resolved = resolvePartyScore(index, party, contest.waveYear);
      if (!resolved) continue;
      scoredVotes += votes;
      weightedSum += votes * resolved.score;
    }
    byMunicipality.set(
      ibgeCode,
      scoredVotes > 0 ? weightedSum / scoredVotes : null,
    );
    stateScoredVotes += scoredVotes;
    stateWeightedSum += weightedSum;
  }
  return {
    byMunicipality,
    stateIndex: stateScoredVotes > 0 ? stateWeightedSum / stateScoredVotes : null,
  };
}

export function buildSpectrumModel(
  contests: SpectrumSourceContest[],
  municipalities: MunicipalityProfile[],
  index: PartySpectrumIndex,
  state: SpectrumState,
): SpectrumModel {
  const sanitized = sanitizeSpectrumState(state, contests);
  const contest =
    contests.find((item) => item.id === sanitized.contestId) ?? contests[0];
  const wave =
    index.waves.get(contest.waveYear) ?? index.registry.metadata.waves[0];
  // sanitizeSpectrumState já garante que a comparação existe na lista e não é
  // o próprio pleito; aqui só a resolvemos.
  //
  // ATENÇÃO metodológica: cada pleito usa a onda do survey do seu ano. Ao
  // comparar pleitos de ONDAS DIFERENTES (ex.: 2018 vs 2022), misturam-se
  // duas réguas — parte do deslocamento vem da reavaliação dos partidos pelos
  // especialistas, não do movimento do eleitorado. A comparação não é
  // bloqueada; o painel exibe o aviso sempre que as ondas diferem.
  const comparisonContest = sanitized.comparisonContestId
    ? contests.find(
        (item) =>
          item.id === sanitized.comparisonContestId && item.id !== contest.id,
      ) ?? null
    : null;
  const comparisonWave = comparisonContest
    ? index.waves.get(comparisonContest.waveYear) ??
      index.registry.metadata.waves[0]
    : null;
  const comparison = comparisonContest
    ? computeContestIndices(comparisonContest, index)
    : null;
  // Sem pleito de comparação o deslocamento não existe: a métrica EFETIVA cai
  // para o índice, mesmo padrão adotado em elections para o swing sem série.
  const metricId: SpectrumMetricId =
    sanitized.metricId === "shift" && !comparisonContest
      ? "index"
      : sanitized.metricId;

  const stateBlockVotes = emptyBlocks();
  const unscoredByParty = new Map<string, number>();
  let stateScoredVotes = 0;
  let stateWeightedSum = 0;
  let stateTotalVotes = 0;

  const rawItems = municipalities.map((municipality) => {
    const byParty = contest.municipalities[municipality.ibgeCode] ?? {};
    const blockVotes = emptyBlocks();
    let totalVotes = 0;
    let scoredVotes = 0;
    let weightedSum = 0;
    let leadingPartyCode = "";
    let leadingPartyVotes = 0;

    for (const [party, votes] of Object.entries(byParty)) {
      if (!Number.isFinite(votes) || votes <= 0) continue;
      totalVotes += votes;
      if (
        votes > leadingPartyVotes ||
        (votes === leadingPartyVotes && party.localeCompare(leadingPartyCode, "pt-BR") < 0)
      ) {
        leadingPartyVotes = votes;
        leadingPartyCode = party;
      }
      const resolved = resolvePartyScore(index, party, contest.waveYear);
      if (!resolved) {
        unscoredByParty.set(party, (unscoredByParty.get(party) ?? 0) + votes);
        continue;
      }
      scoredVotes += votes;
      weightedSum += votes * resolved.score;
      blockVotes[resolved.block] += votes;
    }

    const municipalIndex = scoredVotes > 0 ? weightedSum / scoredVotes : null;
    const comparisonIndex = comparison
      ? comparison.byMunicipality.get(municipality.ibgeCode) ?? null
      : null;
    // Deslocamento em pontos da escala 0–10: positivo = moveu para a direita.
    // Sem índice em QUALQUER um dos dois pleitos, fica null (cinza no mapa,
    // fora de ranking e quintis), nunca zero.
    const shift =
      municipalIndex !== null && comparisonIndex !== null
        ? municipalIndex - comparisonIndex
        : null;
    const blockSharePct: Record<SpectrumBlock, number> = {
      left: scoredVotes > 0 ? (blockVotes.left / scoredVotes) * 100 : 0,
      center: scoredVotes > 0 ? (blockVotes.center / scoredVotes) * 100 : 0,
      right: scoredVotes > 0 ? (blockVotes.right / scoredVotes) * 100 : 0,
    };

    stateTotalVotes += totalVotes;
    stateScoredVotes += scoredVotes;
    stateWeightedSum += weightedSum;
    stateBlockVotes.left += blockVotes.left;
    stateBlockVotes.center += blockVotes.center;
    stateBlockVotes.right += blockVotes.right;

    return {
      municipality,
      index: municipalIndex,
      comparisonIndex,
      shift,
      totalVotes,
      scoredVotes,
      unscoredVotes: totalVotes - scoredVotes,
      coveragePct: totalVotes > 0 ? (scoredVotes / totalVotes) * 100 : 0,
      blockVotes,
      blockSharePct,
      leadingPartyCode,
      leadingPartyVotes,
    };
  });

  const withValue = rawItems.map((item) => ({
    ...item,
    value: getMetricValue(metricId, item),
  }));
  const measurable = withValue.filter(
    (item): item is (typeof withValue)[number] & { value: number } =>
      item.value !== null && Number.isFinite(item.value),
  );

  const thresholds =
    sanitized.bandMode === "quantile"
      ? calculateQuantileThresholds(measurable.map((item) => item.value))
      : getAbsoluteThresholds(metricId, index.registry);

  const ranked = measurable
    .slice()
    .sort(
      (a, b) =>
        b.value - a.value ||
        a.municipality.name.localeCompare(b.municipality.name, "pt-BR"),
    );
  const rankById = new Map(
    ranked.map((item, position) => [item.municipality.ibgeCode, position + 1]),
  );

  const allItems: SpectrumMunicipalityItem[] = withValue.map((item) => ({
    ...item,
    band: item.value === null ? 0 : getAnalysisBand(item.value, thresholds),
    rank: rankById.get(item.municipality.ibgeCode) ?? 0,
  }));

  const activeBandSet = new Set(sanitized.activeBands);
  const direction = sanitized.sortDirection === "desc" ? -1 : 1;
  const filteredItems = allItems
    .filter((item) => item.value !== null && activeBandSet.has(item.band))
    .sort(
      (a, b) =>
        ((a.value ?? 0) - (b.value ?? 0)) * direction ||
        a.municipality.name.localeCompare(b.municipality.name, "pt-BR"),
    );

  const focusedValues = filteredItems.map((item) => item.value ?? 0);
  const metric = SPECTRUM_METRICS.find((item) => item.id === metricId)!;

  const unscoredParties: SpectrumUnscoredParty[] = [...unscoredByParty.entries()]
    .map(([code, votes]) => ({
      code,
      votes,
      stateSharePct: stateTotalVotes > 0 ? (votes / stateTotalVotes) * 100 : 0,
    }))
    .sort((a, b) => b.votes - a.votes || a.code.localeCompare(b.code, "pt-BR"));

  const stateIndex = stateScoredVotes > 0 ? stateWeightedSum / stateScoredVotes : null;
  const stateComparisonIndex = comparison ? comparison.stateIndex : null;

  return {
    contest,
    wave,
    comparisonContest,
    comparisonWave,
    metricId,
    metricLabel: metric.label,
    metricShortLabel: metric.shortLabel,
    bandMode: sanitized.bandMode,
    thresholds,
    bandCounts: ALL_ANALYSIS_BANDS.map(
      (band) =>
        allItems.filter((item) => item.value !== null && item.band === band).length,
    ),
    allItems,
    filteredItems,
    missingMunicipalityCount: allItems.filter((item) => item.value === null).length,
    focusedMinimum: focusedValues.length ? Math.min(...focusedValues) : 0,
    focusedMaximum: focusedValues.length ? Math.max(...focusedValues) : 0,
    stateIndex,
    stateComparisonIndex,
    stateShift:
      stateIndex !== null && stateComparisonIndex !== null
        ? stateIndex - stateComparisonIndex
        : null,
    stateBlockSharePct: {
      left: stateScoredVotes > 0 ? (stateBlockVotes.left / stateScoredVotes) * 100 : 0,
      center: stateScoredVotes > 0 ? (stateBlockVotes.center / stateScoredVotes) * 100 : 0,
      right: stateScoredVotes > 0 ? (stateBlockVotes.right / stateScoredVotes) * 100 : 0,
    },
    stateCoveragePct: stateTotalVotes > 0 ? (stateScoredVotes / stateTotalVotes) * 100 : 0,
    stateTotalVotes,
    stateScoredVotes,
    unscoredParties,
    weightedByElectorate: false,
  };
}

export function formatSpectrumValue(metricId: SpectrumMetricId, value: number) {
  if (metricId === "index") return formatDecimal(value);
  if (metricId === "shift") {
    // Sinal explícito: o deslocamento diverge em torno de zero.
    const sign = value > 0 ? "+" : "";
    return `${sign}${formatDecimal(value)} pts`;
  }
  return formatPercent(value);
}

export function getSpectrumRangeLabel(
  metricId: SpectrumMetricId,
  thresholds: number[],
  band: AnalysisBand,
) {
  const format = (value: number) => formatSpectrumValue(metricId, value);
  if (band === 0) return `Até ${format(thresholds[0] ?? 0)}`;
  if (band === 4) return `Acima de ${format(thresholds[3] ?? 0)}`;
  return `> ${format(thresholds[band - 1] ?? 0)} até ${format(thresholds[band] ?? 0)}`;
}

export function getSpectrumBandLabel(band: AnalysisBand) {
  return ["Mais à esquerda", "À esquerda", "Centro", "À direita", "Mais à direita"][band];
}

export function getSpectrumShiftBandLabel(band: AnalysisBand) {
  return [
    "Forte para a esquerda",
    "Para a esquerda",
    "Estável",
    "Para a direita",
    "Forte para a direita",
  ][band];
}

/**
 * Leitura em linguagem natural do deslocamento de um município:
 * "moveu-se X pontos para a direita/esquerda entre A e B".
 */
export function describeSpectrumShift(
  shift: number,
  comparisonLabel: string,
  currentLabel: string,
) {
  const magnitude = formatDecimal(Math.abs(shift));
  if (Math.abs(shift) < 0.05) {
    return `manteve o índice praticamente estável entre ${comparisonLabel} e ${currentLabel}`;
  }
  const direction = shift > 0 ? "direita" : "esquerda";
  return `moveu-se ${magnitude} pontos para a ${direction} entre ${comparisonLabel} e ${currentLabel}`;
}

export function describeSpectrumIndex(
  value: number,
  registry: PartySpectrumRegistry,
) {
  const block = classifySpectrumBlock(value, registry);
  if (block === "left") return "tende a votar em partidos mais à esquerda";
  if (block === "right") return "tende a votar em partidos mais à direita";
  return "distribui votos entre partidos de posições opostas, sem predominância clara";
}

export function createSpectrumCsv(model: SpectrumModel) {
  // Com a métrica de deslocamento, o CSV carrega também o pleito comparado e
  // o deslocamento — ausência de índice em um dos lados vira célula vazia.
  const comparisonContest =
    model.metricId === "shift" ? model.comparisonContest : null;
  const withShift = comparisonContest !== null;
  const rows = model.filteredItems.map((item) => [
    item.municipality.ibgeCode,
    item.municipality.tseCode,
    item.municipality.name,
    model.contest.electionYear,
    model.contest.officeName,
    model.contest.round,
    model.wave.year,
    item.index === null ? "" : formatCsvDecimal(item.index),
    ...(comparisonContest
      ? [
          comparisonContest.electionYear,
          comparisonContest.officeName,
          comparisonContest.round,
          model.comparisonWave?.year ?? "",
          item.comparisonIndex === null ? "" : formatCsvDecimal(item.comparisonIndex),
          item.shift === null ? "" : formatCsvDecimal(item.shift),
        ]
      : []),
    formatCsvDecimal(item.blockSharePct.left),
    formatCsvDecimal(item.blockSharePct.center),
    formatCsvDecimal(item.blockSharePct.right),
    item.totalVotes,
    item.scoredVotes,
    item.unscoredVotes,
    formatCsvDecimal(item.coveragePct),
    item.leadingPartyCode,
    item.rank,
  ]);
  return createCsv(
    [
      "codigo_ibge",
      "codigo_tse",
      "municipio",
      "ano",
      "cargo",
      "turno",
      "onda_survey",
      "indice_ideologico",
      ...(withShift
        ? [
            "ano_comparacao",
            "cargo_comparacao",
            "turno_comparacao",
            "onda_survey_comparacao",
            "indice_comparacao",
            "deslocamento_pontos",
          ]
        : []),
      "esquerda_pct",
      "centro_pct",
      "direita_pct",
      "votos_totais",
      "votos_com_nota",
      "votos_sem_nota",
      "cobertura_pct",
      "partido_mais_votado",
      "posicao",
    ],
    rows,
  );
}

export function getSpectrumCsvFilename(model: SpectrumModel) {
  return `espectro-${model.contest.electionYear}-${model.contest.officeName.toLowerCase()}-${model.contest.round}t.csv`;
}

export { toggleAnalysisBand as toggleSpectrumBand };
