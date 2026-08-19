import type { AnalysisBand } from "../types/analysis";
import type { CandidateContest, CandidateDataset } from "../types/candidate";
import type {
  PollingBubble,
  PollingCandidateAvailability,
  PollingCandidateContestOption,
  PollingCandidateInfo,
  PollingMetric,
  PollingMunicipalityAggregate,
  PollingPartyOption,
  PollingPlace,
  PollingPlacesDataset,
  PollingState,
  PollingUnit,
  PollingViewMode,
  PollingVotesDataset,
  PollingModel,
} from "../types/pollingPlaces";
import type {
  PartySpectrumRegistry,
  SpectrumBlock,
  SpectrumSourceContest,
} from "../types/spectrum";
import {
  ALL_ANALYSIS_BANDS,
  calculateQuantileThresholds,
  getAnalysisBand,
  toggleAnalysisBand,
} from "./analysis.ts";
import {
  getOfficeLabel,
  isCandidatePendente,
  votosPorMilEleitores,
} from "./candidate.ts";
import { isMunicipalContest } from "./candidateStats.ts";
import { createCsv, formatCsvDecimal } from "./csv.ts";
import {
  formatDecimal,
  formatInteger,
  formatPercent,
  MISSING_DATA_COLOR,
} from "./electorate.ts";
import { normalizeNeighborhoodKey } from "./registrations.ts";
import {
  classifySpectrumBlock,
  getAbsoluteThresholds,
  getSpectrumBandLabel,
  getSpectrumContestLabel,
  getSpectrumRangeLabel,
  resolvePartyScore,
  resolveWaveYear,
  SPECTRUM_COLORS,
  type PartySpectrumIndex,
} from "./spectrum.ts";
import { STATE_LABEL, STATE_UF } from "./state.ts";

/**
 * Camada SUBMUNICIPAL: votação por local de votação.
 *
 * Reusa as primitivas de `spectrum.ts` (`resolvePartyScore`,
 * `classifySpectrumBlock`, `resolveWaveYear`, `getAbsoluteThresholds`) e a
 * disciplina de nulos do projeto: unidade sem voto com nota fica com índice
 * `null`, fora do ranking e das faixas, nunca contada como zero.
 *
 * O que vira cor, faixa, ranking e CSV é `unit.value`, o valor da métrica
 * ativa (ver `getPollingMetric`); o índice segue calculado sempre, porque o
 * agregado municipal depende dele.
 *
 * Gancho de malha de bairros: não há polígono de bairro no projeto. Se um dia
 * existir `src/data/neighborhoods-{ibge}.geojson`, a camada deve pintar o
 * polígono em vez da bolha agregada; até lá o modo "Bairros" desenha uma bolha
 * por bairro no centroide dos locais. Teste do gancho: `hasNeighborhoodMesh`
 * em `pollingData.ts`.
 */

export const POLLING_VIEW_MODES: Array<{
  id: PollingViewMode;
  label: string;
  description: string;
}> = [
  {
    id: "places",
    label: "Locais de votação",
    description:
      "Uma bolha por local de votação, com área proporcional ao eleitorado do local.",
  },
  {
    id: "neighborhoods",
    label: "Bairros",
    description:
      "Uma bolha por bairro, somando os votos dos locais antes de calcular a medida. É agregação de locais, não polígono de bairro.",
  },
];

/**
 * Métrica da camada, disponível em qualquer cargo. Ordem de precedência única,
 * aplicada só aqui: pleito da candidata escolhido vence; senão, sigla em foco
 * = percentual da sigla; sem sigla = índice ideológico 0–10 (padrão).
 *
 * Os votos da candidata moram em campo próprio porque não saem de
 * `votes-*.json` (que agrega por partido, não por candidatura) e usam outra
 * lista de pleitos.
 */
export function getPollingMetric(
  partyCode: string | null | undefined,
  candidateContestId?: string | null,
): PollingMetric {
  if (candidateContestId) return "votosCandidata";
  return partyCode ? "votoPartido" : "indice";
}

/** As três medidas do alternador, na ordem em que aparecem na tela. */
export const POLLING_METRICS: Array<{
  id: PollingMetric;
  label: string;
  description: string;
}> = [
  {
    id: "indice",
    label: "Índice ideológico",
    description:
      "Média ponderada 0–10 das notas dos partidos votados em cada unidade, na mesma régua da camada de espectro.",
  },
  {
    id: "votoPartido",
    label: "% de voto por sigla",
    description:
      "Quanto do voto apurado em cada unidade foi para uma sigla escolhida, numa escala fixa de 0 a 100%.",
  },
  {
    id: "votosCandidata",
    label: "Votos da candidata",
    description:
      "Os votos nominais da candidata em foco em cada local de votação, no pleito dela que for escolhido. Tem lista de pleitos própria: só as eleições que ela disputou com cadastro de locais publicado.",
  },
];

/**
 * Rampa sequencial de um tom só para o percentual de uma sigla: claro = pouco
 * voto, escuro = muito. Percentual é magnitude, não polaridade, por isso não
 * se usa aqui a paleta divergente do espectro. O azul também não é a cor de
 * nenhuma sigla do seletor.
 *
 * Passos 300→700 do azul sequencial da skill de dataviz. Validada como rampa
 * ordinal (`--ordinal`) nas duas superfícies claras do app: lightness
 * monótona, ΔL adjacente ≥ 0,06, tom único (3° de variação), ponta clara em
 * 2,50:1 sobre o branco e 2,27:1 sobre #f6f3f2 (piso 2:1). Todo passo fica a
 * ΔE ≥ 14,6 (OKLab ×100, visão normal, protanopia e deuteranopia) do cinza de
 * dado ausente #788382.
 */
export const POLLING_SHARE_COLORS = [
  "#6da7ec",
  "#3987e5",
  "#256abf",
  "#184f95",
  "#0d366b",
] as const;

/**
 * Faixas do percentual de uma sigla: escala fixa de 0 a 100, os mesmos cortes
 * das métricas percentuais do espectro. Fixas de propósito: por quantil, a
 * mesma cor mudaria de significado a cada troca de sigla ou de recorte.
 */
export const POLLING_SHARE_THRESHOLDS = [20, 40, 60, 80];

/**
 * Rampa sequencial de um tom só para os votos da candidata: claro = poucos
 * votos, escuro = muitos. O passo do meio é o vermelho da campanha (#c1121f,
 * o mesmo dos botões do app).
 *
 * Validada como rampa ordinal (`--ordinal`, validador da skill de dataviz) nas
 * duas superfícies claras do app: lightness monótona (OKLCH L 0,760 · 0,640 ·
 * 0,516 · 0,397 · 0,271, ΔL adjacente 0,120 · 0,124 · 0,119 · 0,126, piso
 * 0,06), tom único (1° de dispersão), ponta clara em 2,28:1 sobre o branco e
 * 2,07:1 sobre #f6f3f2 (piso 2:1).
 *
 * Contra o cinza de dado ausente #788382 (distinguir "0 voto dela" de "ela não
 * era candidata nesta cidade"): todo passo fica a ΔE 9,8 · 10,6 · 12,6 · 20,8
 * · 32,5 (OKLab ×100, pior entre protanopia e deuteranopia; alvo 8,0) e 22,3 ·
 * 23,6 · 23,1 · 26,8 · 35,1 em visão normal (piso 15).
 */
export const POLLING_CANDIDATE_COLORS = [
  "#ff8a81",
  "#f53d3d",
  "#c1121f",
  "#89000e",
  "#500004",
] as const;

export function getPollingMetricColors(metric: PollingMetric) {
  if (metric === "indice") return SPECTRUM_COLORS;
  if (metric === "votosCandidata") return POLLING_CANDIDATE_COLORS;
  return POLLING_SHARE_COLORS;
}

/**
 * Cortes das faixas. Índice e percentual têm escala fixa (0–10 e 0–100): a
 * mesma cor quer dizer a mesma coisa entre dois mapas. Voto absoluto não tem
 * escala fixa possível, então sai por quantil do recorte, calculado em
 * `buildPollingModel` e declarado na legenda.
 */
export function getPollingThresholds(
  metric: PollingMetric,
  registry: PartySpectrumRegistry,
  values: number[] = [],
) {
  if (metric === "indice") return getAbsoluteThresholds("index", registry);
  if (metric === "votosCandidata") return calculateQuantileThresholds(values);
  return [...POLLING_SHARE_THRESHOLDS];
}

/**
 * Teto de bolhas desenhadas de uma vez: Goiás tem milhares de locais e cada
 * bolha é um marcador do mapa, sem teto o navegador trava. Acima do limite
 * ficam as maiores por eleitorado e a interface informa quantas ficaram de
 * fora.
 */
export const POLLING_MAX_BUBBLES = 600;

/** Raio mínimo e máximo das bolhas, em pixels. */
export const POLLING_BUBBLE_MIN_RADIUS = 5;
export const POLLING_BUBBLE_MAX_RADIUS = 34;

/**
 * Raio da bolha com ÁREA proporcional ao eleitorado: raio ∝ √eleitorado.
 * Escalar o raio direto pelo valor infla os locais grandes pelo quadrado.
 */
export function getPollingBubbleRadius(
  electorate: number,
  maximumElectorate: number,
  minimumRadius = POLLING_BUBBLE_MIN_RADIUS,
  maximumRadius = POLLING_BUBBLE_MAX_RADIUS,
) {
  if (!Number.isFinite(electorate) || electorate <= 0) return minimumRadius;
  if (!Number.isFinite(maximumElectorate) || maximumElectorate <= 0) {
    return minimumRadius;
  }
  const ratio = Math.min(electorate / maximumElectorate, 1);
  return Math.max(minimumRadius, maximumRadius * Math.sqrt(ratio));
}

/**
 * Identificador do arquivo de votos do pleito (`votes-{contestId}.json`). Os
 * pleitos do espectro carregam o prefixo da origem (`elections:2022-1-1`); o
 * arquivo do ETL usa apenas o sufixo (`2022-1-1`).
 */
export function getPollingContestId(contest: SpectrumSourceContest) {
  const separator = contest.id.indexOf(":");
  return separator >= 0 ? contest.id.slice(separator + 1) : contest.id;
}

export function getPollingNeighborhoodKey(place: PollingPlace) {
  const raw = place.neighborhoodKey?.trim()
    ? place.neighborhoodKey
    : place.neighborhood;
  return normalizeNeighborhoodKey(raw ?? "");
}

export function getDefaultPollingState(
  contests: SpectrumSourceContest[],
): PollingState {
  return {
    contestId: contests[0]?.id ?? "",
    viewMode: "places",
    municipalityId: null,
    // null = nenhuma sigla em foco: a camada abre no índice ideológico.
    partyCode: null,
    // null = a medida da candidata não é padrão, é escolha deliberada.
    candidateContestId: null,
    candidateRate: false,
    activeBands: [...ALL_ANALYSIS_BANDS],
    sortDirection: "desc",
  };
}

/**
 * Id de pleito da candidata vindo de fora (armazenamento local, link antigo):
 * só sobrevive na forma "ano-cargo-turno". O modelo ainda o descarta se o
 * pleito não tiver cadastro de locais.
 */
function sanitizeCandidateContestId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim();
  return /^\d{4}-\d{1,2}-\d{1,2}$/.test(id) ? id : null;
}

/**
 * Sigla vinda de fora (armazenamento local, link antigo): só sobrevive se
 * parecer código de partido. O modelo ainda a descarta se não houver voto
 * apurado dela no pleito.
 */
function sanitizePartyCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  return /^[A-Z0-9ÇÃÁÉÍÓÚÂÊÔ.\- ]{1,24}$/.test(code) ? code : null;
}

export function sanitizePollingState(
  value: unknown,
  contests: SpectrumSourceContest[],
): PollingState {
  const fallback = getDefaultPollingState(contests);
  if (!value || typeof value !== "object") return fallback;
  const raw = value as Record<string, unknown>;
  const contest =
    typeof raw.contestId === "string"
      ? contests.find((item) => item.id === raw.contestId)
      : undefined;
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
    contestId: contest?.id ?? fallback.contestId,
    viewMode: raw.viewMode === "neighborhoods" ? "neighborhoods" : "places",
    municipalityId:
      typeof raw.municipalityId === "string" && /^\d{7}$/.test(raw.municipalityId)
        ? raw.municipalityId
        : null,
    partyCode: sanitizePartyCode(raw.partyCode),
    candidateContestId: sanitizeCandidateContestId(raw.candidateContestId),
    candidateRate: raw.candidateRate === true,
    activeBands: activeBands.length ? activeBands : [...ALL_ANALYSIS_BANDS],
    sortDirection: raw.sortDirection === "asc" ? "asc" : "desc",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toFiniteNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Coordenada ausente é `null`, jamais 0 (0,0 fica no Golfo da Guiné). */
function toCoordinate(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toText(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

/**
 * Leitura defensiva do arquivo de locais: o que não casa com o contrato vira
 * `null` e a camada informa que o dado não foi gerado.
 */
export function parsePollingPlacesDataset(
  value: unknown,
): PollingPlacesDataset | null {
  if (!isRecord(value) || !Array.isArray(value.places)) return null;
  const metadataRaw = isRecord(value.metadata) ? value.metadata : {};
  const places: PollingPlace[] = [];
  for (const item of value.places) {
    if (!isRecord(item)) continue;
    const id = toText(item.id);
    const ibgeCode = toText(item.ibgeCode);
    if (!id || !/^\d{7}$/.test(ibgeCode)) continue;
    const neighborhood = toText(item.neighborhood, "Bairro não informado");
    places.push({
      id,
      ibgeCode,
      municipalityName: toText(item.municipalityName, `Município ${ibgeCode}`),
      zone: toFiniteNumber(item.zone, 0),
      localCode: toFiniteNumber(item.localCode, 0),
      name: toText(item.name, `Local ${id}`),
      address: toText(item.address),
      neighborhood: neighborhood || "Bairro não informado",
      neighborhoodKey: toText(item.neighborhoodKey),
      cep: toText(item.cep),
      latitude: toCoordinate(item.latitude),
      longitude: toCoordinate(item.longitude),
      sectionCount: toFiniteNumber(item.sectionCount, 0),
      electorate: toFiniteNumber(item.electorate, 0),
    });
  }
  return {
    metadata: {
      schemaVersion: toFiniteNumber(metadataRaw.schemaVersion, 1),
      status: typeof metadataRaw.status === "string" ? metadataRaw.status : undefined,
      state: typeof metadataRaw.state === "string" ? metadataRaw.state : undefined,
      placeCount: toFiniteNumber(metadataRaw.placeCount, places.length),
      geocodedPlaceCount:
        typeof metadataRaw.geocodedPlaceCount === "number"
          ? metadataRaw.geocodedPlaceCount
          : undefined,
      municipalityCount:
        typeof metadataRaw.municipalityCount === "number"
          ? metadataRaw.municipalityCount
          : undefined,
      generatedAt:
        typeof metadataRaw.generatedAt === "string" ? metadataRaw.generatedAt : undefined,
      source: typeof metadataRaw.source === "string" ? metadataRaw.source : undefined,
      sourceUrl:
        typeof metadataRaw.sourceUrl === "string" ? metadataRaw.sourceUrl : undefined,
      note: typeof metadataRaw.note === "string" ? metadataRaw.note : undefined,
    },
    places,
  };
}

/** Leitura defensiva do arquivo de votos de um pleito. */
export function parsePollingVotesDataset(
  value: unknown,
): PollingVotesDataset | null {
  if (!isRecord(value) || !isRecord(value.votes)) return null;
  const metadataRaw = isRecord(value.metadata) ? value.metadata : {};
  const votes: Record<string, Record<string, number>> = {};
  for (const [placeId, byParty] of Object.entries(value.votes)) {
    if (!isRecord(byParty)) continue;
    const parsed: Record<string, number> = {};
    for (const [party, amount] of Object.entries(byParty)) {
      if (typeof amount !== "number" || !Number.isFinite(amount)) continue;
      parsed[party] = amount;
    }
    votes[placeId] = parsed;
  }
  return {
    metadata: {
      schemaVersion: toFiniteNumber(metadataRaw.schemaVersion, 1),
      contestId: toText(metadataRaw.contestId),
      electionYear:
        typeof metadataRaw.electionYear === "number" ? metadataRaw.electionYear : undefined,
      round: typeof metadataRaw.round === "number" ? metadataRaw.round : undefined,
      officeCode:
        typeof metadataRaw.officeCode === "number" ? metadataRaw.officeCode : undefined,
      officeName:
        typeof metadataRaw.officeName === "string" ? metadataRaw.officeName : undefined,
      placeCount:
        typeof metadataRaw.placeCount === "number" ? metadataRaw.placeCount : undefined,
      generatedAt:
        typeof metadataRaw.generatedAt === "string" ? metadataRaw.generatedAt : undefined,
      source: typeof metadataRaw.source === "string" ? metadataRaw.source : undefined,
    },
    votes,
  };
}

/** O dataset existe mas ainda não tem conteúdo gerado pelo ETL. */
export function isPollingPlacesDatasetPending(
  dataset: PollingPlacesDataset | null,
) {
  return !dataset || dataset.places.length === 0;
}

type Tally = {
  totalVotes: number;
  scoredVotes: number;
  weightedSum: number;
  blockVotes: Record<SpectrumBlock, number>;
  leadingPartyCode: string;
  leadingPartyVotes: number;
  partyVotes: number;
};

function createTally(): Tally {
  return {
    totalVotes: 0,
    scoredVotes: 0,
    weightedSum: 0,
    blockVotes: { left: 0, center: 0, right: 0 },
    leadingPartyCode: "",
    leadingPartyVotes: 0,
    partyVotes: 0,
  };
}

/**
 * Soma votos por sigla no acumulador, usando as primitivas do espectro para
 * resolver a nota do partido na onda do pleito. `partyCode` é a sigla em foco:
 * seus votos são somados à parte, sem interferir no índice.
 */
function addVotesToTally(
  tally: Tally,
  byParty: Record<string, number>,
  index: PartySpectrumIndex,
  waveYear: number,
  partyCode = "",
) {
  for (const [party, votes] of Object.entries(byParty)) {
    if (!Number.isFinite(votes) || votes <= 0) continue;
    tally.totalVotes += votes;
    if (party === partyCode) tally.partyVotes += votes;
    if (
      votes > tally.leadingPartyVotes ||
      (votes === tally.leadingPartyVotes &&
        party.localeCompare(tally.leadingPartyCode, "pt-BR") < 0)
    ) {
      tally.leadingPartyVotes = votes;
      tally.leadingPartyCode = party;
    }
    const resolved = resolvePartyScore(index, party, waveYear);
    if (!resolved) continue;
    tally.scoredVotes += votes;
    tally.weightedSum += votes * resolved.score;
    tally.blockVotes[resolved.block] += votes;
  }
}

function finishTally(tally: Tally, partyCode = "") {
  const index = tally.scoredVotes > 0 ? tally.weightedSum / tally.scoredVotes : null;
  return {
    index,
    totalVotes: tally.totalVotes,
    scoredVotes: tally.scoredVotes,
    unscoredVotes: tally.totalVotes - tally.scoredVotes,
    coveragePct:
      tally.totalVotes > 0 ? (tally.scoredVotes / tally.totalVotes) * 100 : 0,
    partyVotes: tally.partyVotes,
    // Percentual só existe com denominador: sem voto apurado na unidade (ou
    // sem sigla escolhida) o valor é ausente, jamais 0%. Com apuração e sem
    // voto da sigla, 0 é zero de verdade e a unidade continua no ranking.
    partySharePct:
      partyCode && tally.totalVotes > 0
        ? (tally.partyVotes / tally.totalVotes) * 100
        : null,
    blockVotes: { ...tally.blockVotes },
    blockSharePct: {
      left: tally.scoredVotes > 0 ? (tally.blockVotes.left / tally.scoredVotes) * 100 : 0,
      center:
        tally.scoredVotes > 0 ? (tally.blockVotes.center / tally.scoredVotes) * 100 : 0,
      right:
        tally.scoredVotes > 0 ? (tally.blockVotes.right / tally.scoredVotes) * 100 : 0,
    },
    leadingPartyCode: tally.leadingPartyCode,
    leadingPartyVotes: tally.leadingPartyVotes,
  };
}

/**
 * Grafia de exibição do bairro: a mais frequente entre os locais. No empate
 * vence a grafia do local com mais eleitores (critério determinístico, para o
 * rótulo não oscilar entre execuções).
 */
function mostFrequentSpelling(entries: Array<{ value: string; weight: number }>) {
  const counts = new Map<string, { count: number; weight: number }>();
  for (const entry of entries) {
    const current = counts.get(entry.value) ?? { count: 0, weight: 0 };
    counts.set(entry.value, {
      count: current.count + 1,
      weight: current.weight + entry.weight,
    });
  }
  let best = entries[0]?.value ?? "";
  let bestCount = 0;
  let bestWeight = -1;
  for (const [value, tally] of counts) {
    if (
      tally.count > bestCount ||
      (tally.count === bestCount && tally.weight > bestWeight) ||
      (tally.count === bestCount &&
        tally.weight === bestWeight &&
        value.localeCompare(best, "pt-BR") < 0)
    ) {
      best = value;
      bestCount = tally.count;
      bestWeight = tally.weight;
    }
  }
  return best;
}

/* -------------------------------------------------------------------------
 * Medida "votos da candidata": lista de pleitos própria
 *
 * Os pleitos das outras duas medidas vêm dos `votes-*.json` do espectro
 * (2022-1-1, 2024-11-1…); os dela (2016-11-1, 2018-7-1, 2020-11-1, 2022-6-1,
 * 2024-11-1) quase não coincidem. Misturar as listas mostraria "sem dado" em
 * pleito que ela nem disputou.
 * ------------------------------------------------------------------------- */

/** Rótulo do pleito dela: ano + cargo no feminino (+ turno quando > 1). */
export function getPollingCandidateContestLabel(contest: CandidateContest) {
  return `${contest.electionYear} · ${getOfficeLabel(contest)}`;
}

/**
 * Pleitos dela que podem virar mapa: os com recorte por local preenchido. Ano
 * sem cadastro de locais publicado pelo TSE chega com `locais: null` e fica de
 * fora da lista. Ordem: do mais recente para o mais antigo.
 */
export function listPollingCandidateContests(
  dataset: CandidateDataset | null | undefined,
): PollingCandidateContestOption[] {
  if (!dataset || isCandidatePendente(dataset)) return [];
  return dataset.contests
    .filter((contest) => Object.keys(contest.locais ?? {}).length > 0)
    .slice()
    .sort(
      (a, b) =>
        b.electionYear - a.electionYear ||
        a.round - b.round ||
        a.officeCode - b.officeCode,
    )
    .map((contest) => ({
      id: contest.id,
      label: getPollingCandidateContestLabel(contest),
      electionYear: contest.electionYear,
      officeCode: contest.officeCode,
      officeName: contest.officeName,
      round: contest.round,
      municipal: isMunicipalContest(contest),
      placeCount: Object.keys(contest.locais ?? {}).length,
      votes: contest.votosNoEstado,
    }));
}

export function getPollingCandidateAvailability(
  dataset: CandidateDataset | null | undefined,
): PollingCandidateAvailability {
  if (!dataset || isCandidatePendente(dataset)) return "pendente";
  return listPollingCandidateContests(dataset).length > 0
    ? "disponivel"
    : "sem-recorte";
}

/**
 * AUSÊNCIA × ZERO na medida da candidata, a regra decisiva desta camada. O ETL
 * só acumula voto onde ela teve voto, então local ausente do mapa `locais`
 * significa:
 *
 *  - pleito MUNICIPAL (Prefeita/Vereadora, cargos 11 e 13): ela disputou uma
 *    cidade. Local naquela cidade = 0 voto de verdade; local em outra cidade =
 *    fora da disputa, valor null, cor de dado ausente, fora do ranking, nunca
 *    0, porque ela não era candidata ali;
 *  - pleito ESTADUAL/FEDERAL: ela estava na urna no estado inteiro, então
 *    local ausente = 0 voto de verdade, em qualquer cidade.
 *
 * Devolve o conjunto de IBGEs em que ela estava na urna (de
 * `contest.municipios`, uma entrada só num pleito municipal), ou `null` quando
 * a urna era o estado inteiro.
 */
export function getPollingCandidateScope(
  contest: CandidateContest,
): Set<string> | null {
  if (!isMunicipalContest(contest)) return null;
  return new Set(Object.keys(contest.municipios));
}

export type PollingModelInput = {
  places: PollingPlace[];
  /** votos por local; null quando o arquivo do pleito ainda não existe */
  votes: Record<string, Record<string, number>> | null;
  index: PartySpectrumIndex;
  registry: PartySpectrumRegistry;
  /** pleito do espectro selecionado; null quando não há pleitos */
  contest: SpectrumSourceContest | null;
  /**
   * Trajetória da candidata em foco (o mesmo arquivo da aba dela). `null` ou
   * pendente = a medida de votos da candidata não é oferecida.
   */
  candidate?: CandidateDataset | null;
  state: PollingState;
  /** teto de bolhas desenhadas; o excedente sai do mapa, nunca do índice */
  maxBubbles?: number;
};

/**
 * Reindexa os locais dela pela convenção de id do CADASTRO de locais.
 *
 * Armadilha silenciosa: os dois ETLs normalizam o código TSE do município de
 * formas opostas. `process_tse_sections.py` (gera `places-go.json`) preenche o
 * código com zeros à esquerda até cinco dígitos; `process_candidato_foco.py`
 * (grava `contest.locais`) remove os zeros. Em Goiás os códigos têm zero à
 * esquerda (Goiânia é 09373), então `9373-1-1015` não casaria com
 * `09373-1-1015`: zero voto em toda parte e 100% de "locais não casados", sem
 * erro nenhum. Canonicalizar aqui vira operação sem efeito depois que o ETL
 * for alinhado.
 */
export function canonicalPlaceId(id: string): string {
  const partes = id.split("-");
  if (partes.length !== 3) return id;
  const [municipio, zona, local] = partes;
  if (!/^\d+$/.test(municipio)) return id;
  return `${municipio.padStart(5, "0")}-${zona}-${local}`;
}

function reindexarLocaisDaCandidata(
  locais: Record<string, number> | null | undefined,
): Record<string, number> {
  if (!locais) return {};
  const reindexado: Record<string, number> = {};
  for (const [id, votos] of Object.entries(locais)) {
    const chave = canonicalPlaceId(id);
    // Soma em vez de sobrescrever: se dois ids diferentes canonizarem para o
    // mesmo local, perder um deles seria perder voto apurado.
    reindexado[chave] = (reindexado[chave] ?? 0) + votos;
  }
  return reindexado;
}

export function buildPollingModel(input: PollingModelInput): PollingModel {
  const {
    places,
    votes,
    index,
    registry,
    contest,
    candidate = null,
    state,
    maxBubbles = POLLING_MAX_BUBBLES,
  } = input;
  // Onda do survey resolvida pela MESMA regra do espectro municipal.
  const waveYear = contest
    ? resolveWaveYear(registry, contest.electionYear)
    : registry.metadata.waves[0].year;

  // ---- Pleito da candidata ----------------------------------------------
  // A medida dela exige trajetória gerada e pleito com cadastro de locais. Id
  // guardado que não vale mais cede lugar ao pleito dela mais recente, nunca a
  // um mapa vazio.
  const candidateAvailability = getPollingCandidateAvailability(candidate);
  const candidateOptions = listPollingCandidateContests(candidate);
  const candidateContest = state.candidateContestId
    ? (candidate?.contests.find(
        (item) =>
          item.id === state.candidateContestId &&
          candidateOptions.some((option) => option.id === item.id),
      ) ??
      candidate?.contests.find(
        (item) => item.id === candidateOptions[0]?.id,
      ) ??
      null)
    : null;

  // A métrica sai da ESCOLHA guardada no estado, não do cargo do pleito.
  const metric = getPollingMetric(
    state.partyCode,
    candidateContest ? candidateContest.id : null,
  );
  const candidateRate = metric === "votosCandidata" && state.candidateRate;
  const votesByPlace = votes ?? {};

  // ---- Votos dela por local ----------------------------------------------
  // Reindexado pela convenção do CADASTRO antes de qualquer cruzamento (ver
  // canonicalPlaceId, logo acima do buildPollingModel).
  const candidateByPlace = reindexarLocaisDaCandidata(candidateContest?.locais);
  const candidateScope = candidateContest
    ? getPollingCandidateScope(candidateContest)
    : null;
  /**
   * Ver `getPollingCandidateScope`: fora do escopo é ausência (null); dentro
   * do escopo, falta de registro é zero medido.
   */
  const candidateVotesAt = (placeId: string, ibgeCode: string) => {
    if (!candidateContest) return null;
    if (candidateScope && !candidateScope.has(ibgeCode)) return null;
    return candidateByPlace[canonicalPlaceId(placeId)] ?? 0;
  };
  const candidateValueOf = (
    votesHere: number | null,
    electorate: number,
  ): number | null => {
    if (votesHere === null) return null;
    return candidateRate
      ? votosPorMilEleitores(votesHere, electorate)
      : votesHere;
  };

  // ---- Siglas do pleito ---------------------------------------------------
  // O leque de siglas sai do pleito INTEIRO, não do recorte: filtrar por
  // município não pode fazer a sigla escolhida sumir do seletor. Só entra
  // sigla com voto apurado.
  const contestVotesByParty: Record<string, number> = {};
  let contestTotalVotes = 0;
  for (const place of places) {
    for (const [party, amount] of Object.entries(votesByPlace[place.id] ?? {})) {
      if (!Number.isFinite(amount) || amount <= 0) continue;
      contestVotesByParty[party] = (contestVotesByParty[party] ?? 0) + amount;
      contestTotalVotes += amount;
    }
  }
  const partyOptions: PollingPartyOption[] = Object.entries(contestVotesByParty)
    .map(([code, partyVotes]) => ({
      code,
      votes: partyVotes,
      sharePct: contestTotalVotes > 0 ? (partyVotes / contestTotalVotes) * 100 : 0,
    }))
    .sort(
      (a, b) => b.votes - a.votes || a.code.localeCompare(b.code, "pt-BR"),
    );
  // Na métrica de sigla, escolha sem voto apurado aqui cede lugar à sigla mais
  // votada do pleito, para o mapa não ficar inteiro sem valor.
  const partyCode =
    metric === "votoPartido"
      ? partyOptions.find((option) => option.code === state.partyCode)?.code ??
        partyOptions[0]?.code ??
        ""
      : "";

  // ---- Locais de votação -------------------------------------------------
  const placeUnits: PollingUnit[] = places.map((place) => {
    const tally = createTally();
    addVotesToTally(
      tally,
      votesByPlace[place.id] ?? {},
      index,
      waveYear,
      partyCode,
    );
    const measures = finishTally(tally, partyCode);
    const hasCoordinate = place.latitude !== null && place.longitude !== null;
    const candidateVotes = candidateVotesAt(place.id, place.ibgeCode);
    return {
      id: place.id,
      kind: "place" as const,
      name: place.name,
      ibgeCode: place.ibgeCode,
      municipalityName: place.municipalityName,
      neighborhood: place.neighborhood,
      neighborhoodKey: getPollingNeighborhoodKey(place),
      address: place.address,
      zone: place.zone,
      latitude: place.latitude,
      longitude: place.longitude,
      electorate: place.electorate,
      sectionCount: place.sectionCount,
      placeCount: 1,
      mappedPlaceCount: hasCoordinate ? 1 : 0,
      ...measures,
      candidateVotes,
      candidateVotesPerThousand:
        candidateVotes === null
          ? null
          : votosPorMilEleitores(candidateVotes, place.electorate),
      candidateInScope: candidateVotes !== null,
      value:
        metric === "indice"
          ? measures.index
          : metric === "votoPartido"
            ? measures.partySharePct
            : candidateValueOf(candidateVotes, place.electorate),
      band: 0 as AnalysisBand,
      rank: 0,
    };
  });

  // ---- Bairros: soma os VOTOS antes de calcular o índice ------------------
  // Média ponderada de verdade (mesmo princípio de selection.ts), jamais a
  // média das médias dos locais.
  type NeighborhoodGroup = {
    ibgeCode: string;
    municipalityName: string;
    neighborhoodKey: string;
    spellings: Array<{ value: string; weight: number }>;
    byParty: Record<string, number>;
    /** votos dela somados nos locais do bairro; null = bairro fora da disputa */
    candidateVotes: number | null;
    electorate: number;
    sectionCount: number;
    placeCount: number;
    mappedPlaceCount: number;
    latitudeSum: number;
    longitudeSum: number;
  };
  const neighborhoodGroups = new Map<string, NeighborhoodGroup>();
  for (const place of places) {
    const neighborhoodKey = getPollingNeighborhoodKey(place);
    const groupId = `${place.ibgeCode}|${neighborhoodKey}`;
    const group: NeighborhoodGroup = neighborhoodGroups.get(groupId) ?? {
      ibgeCode: place.ibgeCode,
      municipalityName: place.municipalityName,
      neighborhoodKey,
      spellings: [],
      byParty: {},
      candidateVotes: null,
      electorate: 0,
      sectionCount: 0,
      placeCount: 0,
      mappedPlaceCount: 0,
      latitudeSum: 0,
      longitudeSum: 0,
    };
    group.spellings.push({ value: place.neighborhood, weight: place.electorate });
    group.electorate += place.electorate;
    group.sectionCount += place.sectionCount;
    group.placeCount += 1;
    if (place.latitude !== null && place.longitude !== null) {
      group.mappedPlaceCount += 1;
      group.latitudeSum += place.latitude;
      group.longitudeSum += place.longitude;
    }
    for (const [party, amount] of Object.entries(votesByPlace[place.id] ?? {})) {
      if (!Number.isFinite(amount) || amount <= 0) continue;
      group.byParty[party] = (group.byParty[party] ?? 0) + amount;
    }
    // O bairro é a soma dos VOTOS dos seus locais. A chave do grupo carrega o
    // IBGE, então ou todos os locais estão na disputa dela ou nenhum: o null
    // sobrevive só quando nenhum local do bairro entrou na conta.
    const candidateHere = candidateVotesAt(place.id, place.ibgeCode);
    if (candidateHere !== null) {
      group.candidateVotes = (group.candidateVotes ?? 0) + candidateHere;
    }
    neighborhoodGroups.set(groupId, group);
  }

  const neighborhoodUnits: PollingUnit[] = [...neighborhoodGroups.entries()].map(
    ([groupId, group]) => {
      const tally = createTally();
      addVotesToTally(tally, group.byParty, index, waveYear, partyCode);
      const measures = finishTally(tally, partyCode);
      const displayName = mostFrequentSpelling(group.spellings);
      return {
        id: groupId,
        kind: "neighborhood" as const,
        name: displayName,
        ibgeCode: group.ibgeCode,
        municipalityName: group.municipalityName,
        neighborhood: displayName,
        neighborhoodKey: group.neighborhoodKey,
        address: "",
        zone: 0,
        // Centroide dos locais COM coordenada. Sem nenhum local geocodificado
        // o bairro não vira bolha, mas continua no ranking e no CSV.
        latitude:
          group.mappedPlaceCount > 0
            ? group.latitudeSum / group.mappedPlaceCount
            : null,
        longitude:
          group.mappedPlaceCount > 0
            ? group.longitudeSum / group.mappedPlaceCount
            : null,
        electorate: group.electorate,
        sectionCount: group.sectionCount,
        placeCount: group.placeCount,
        mappedPlaceCount: group.mappedPlaceCount,
        ...measures,
        candidateVotes: group.candidateVotes,
        candidateVotesPerThousand:
          group.candidateVotes === null
            ? null
            : votosPorMilEleitores(group.candidateVotes, group.electorate),
        candidateInScope: group.candidateVotes !== null,
        value:
          metric === "indice"
            ? measures.index
            : metric === "votoPartido"
              ? measures.partySharePct
              : candidateValueOf(group.candidateVotes, group.electorate),
        band: 0 as AnalysisBand,
        rank: 0,
      };
    },
  );

  // ---- Agregado municipal (sempre sobre TODOS os locais) ------------------
  const municipalityGroups = new Map<
    string,
    {
      name: string;
      byParty: Record<string, number>;
      candidateVotes: number | null;
      electorate: number;
      placeCount: number;
      mappedPlaceCount: number;
    }
  >();
  for (const place of places) {
    const group = municipalityGroups.get(place.ibgeCode) ?? {
      name: place.municipalityName,
      byParty: {},
      candidateVotes: null,
      electorate: 0,
      placeCount: 0,
      mappedPlaceCount: 0,
    };
    group.electorate += place.electorate;
    group.placeCount += 1;
    if (place.latitude !== null && place.longitude !== null) {
      group.mappedPlaceCount += 1;
    }
    for (const [party, amount] of Object.entries(votesByPlace[place.id] ?? {})) {
      if (!Number.isFinite(amount) || amount <= 0) continue;
      group.byParty[party] = (group.byParty[party] ?? 0) + amount;
    }
    const candidateHere = candidateVotesAt(place.id, place.ibgeCode);
    if (candidateHere !== null) {
      group.candidateVotes = (group.candidateVotes ?? 0) + candidateHere;
    }
    municipalityGroups.set(place.ibgeCode, group);
  }
  // A banda fica para depois: na medida da candidata os cortes do agregado
  // municipal saem por quantil dos PRÓPRIOS totais municipais (ver
  // `municipalityThresholds`), que só existem depois desta volta.
  const municipalityValues: PollingMunicipalityAggregate[] = [
    ...municipalityGroups.entries(),
  ]
    .map(([ibgeCode, group]) => {
      const tally = createTally();
      addVotesToTally(tally, group.byParty, index, waveYear, partyCode);
      const measures = finishTally(tally, partyCode);
      const value =
        metric === "indice"
          ? measures.index
          : metric === "votoPartido"
            ? measures.partySharePct
            : candidateValueOf(group.candidateVotes, group.electorate);
      return {
        ibgeCode,
        name: group.name,
        placeCount: group.placeCount,
        mappedPlaceCount: group.mappedPlaceCount,
        electorate: group.electorate,
        index: measures.index,
        totalVotes: measures.totalVotes,
        scoredVotes: measures.scoredVotes,
        coveragePct: measures.coveragePct,
        partyVotes: measures.partyVotes,
        partySharePct: measures.partySharePct,
        candidateVotes: group.candidateVotes,
        candidateVotesPerThousand:
          group.candidateVotes === null
            ? null
            : votosPorMilEleitores(group.candidateVotes, group.electorate),
        candidateInScope: group.candidateVotes !== null,
        value,
        band: 0 as AnalysisBand,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  // ---- Recorte, faixas e ranking -----------------------------------------
  const municipalityId = state.municipalityId;
  const sourceUnits =
    state.viewMode === "neighborhoods" ? neighborhoodUnits : placeUnits;
  const scopedUnits = municipalityId
    ? sourceUnits.filter((unit) => unit.ibgeCode === municipalityId)
    : sourceUnits;
  // Cortes das faixas. Índice e percentual têm escala fixa; o voto da
  // candidata sai por quantil dos valores do RECORTE, e a legenda declara
  // isso. O agregado municipal tem régua própria: total de uma cidade e voto
  // de um único local não cabem na mesma escala.
  const thresholds = getPollingThresholds(
    metric,
    registry,
    scopedUnits
      .map((unit) => unit.value)
      .filter((value): value is number => value !== null),
  );
  const municipalityThresholds =
    metric === "votosCandidata"
      ? calculateQuantileThresholds(
          municipalityValues
            .map((item) => item.value)
            .filter((value): value is number => value !== null),
        )
      : thresholds;
  const municipalityAggregates: PollingMunicipalityAggregate[] =
    municipalityValues.map((item) => ({
      ...item,
      band:
        item.value === null
          ? (0 as AnalysisBand)
          : getAnalysisBand(item.value, municipalityThresholds),
    }));
  // Ranking, faixas e cor saem do valor da MÉTRICA ATIVA: unidade sem valor
  // fica fora de tudo isso, nunca no fim da fila como se valesse zero.
  const ranked = scopedUnits
    .filter((unit) => unit.value !== null)
    .slice()
    .sort(
      (a, b) =>
        (b.value ?? 0) - (a.value ?? 0) || a.name.localeCompare(b.name, "pt-BR"),
    );
  const rankById = new Map(ranked.map((unit, position) => [unit.id, position + 1]));
  const units = scopedUnits.map((unit) => ({
    ...unit,
    band:
      unit.value === null
        ? (0 as AnalysisBand)
        : getAnalysisBand(unit.value, thresholds),
    rank: rankById.get(unit.id) ?? 0,
  }));

  const activeBandSet = new Set(state.activeBands);
  const direction = state.sortDirection === "desc" ? -1 : 1;
  const filteredUnits = units
    .filter((unit) => unit.value !== null && activeBandSet.has(unit.band))
    .sort(
      (a, b) =>
        ((a.value ?? 0) - (b.value ?? 0)) * direction ||
        a.name.localeCompare(b.name, "pt-BR"),
    );
  const focusedIds = new Set(filteredUnits.map((unit) => unit.id));

  const mappedUnits = units.filter(
    (unit) => unit.latitude !== null && unit.longitude !== null,
  );
  const maximumElectorate = mappedUnits.reduce(
    (maximum, unit) => Math.max(maximum, unit.electorate),
    0,
  );
  // O teto de bolhas afeta APENAS o desenho: ranking, CSV, resumo e índice
  // continuam sobre todas as unidades do recorte.
  const drawableUnits = mappedUnits
    .slice()
    .sort(
      (a, b) =>
        b.electorate - a.electorate || a.name.localeCompare(b.name, "pt-BR"),
    )
    .slice(0, Math.max(maxBubbles, 0));
  const bubbles: PollingBubble[] = drawableUnits.map((unit) => ({
    id: unit.id,
    kind: unit.kind,
    name: unit.name,
    ibgeCode: unit.ibgeCode,
    municipalityName: unit.municipalityName,
    neighborhood: unit.neighborhood,
    latitude: unit.latitude as number,
    longitude: unit.longitude as number,
    radius: getPollingBubbleRadius(unit.electorate, maximumElectorate),
    color:
      unit.value === null
        ? MISSING_DATA_COLOR
        : getPollingMetricColors(metric)[unit.band],
    value: unit.value,
    electorate: unit.electorate,
    coveragePct: unit.coveragePct,
    placeCount: unit.placeCount,
    focused: focusedIds.has(unit.id),
    candidateInScope: unit.candidateInScope,
  }));

  // Resumo do recorte: soma dos votos das unidades ANTES do índice.
  const summaryTally = createTally();
  const scopedPlaces = municipalityId
    ? places.filter((place) => place.ibgeCode === municipalityId)
    : places;
  const summaryByParty: Record<string, number> = {};
  for (const place of scopedPlaces) {
    for (const [party, amount] of Object.entries(votesByPlace[place.id] ?? {})) {
      if (!Number.isFinite(amount) || amount <= 0) continue;
      summaryByParty[party] = (summaryByParty[party] ?? 0) + amount;
    }
  }
  addVotesToTally(summaryTally, summaryByParty, index, waveYear, partyCode);
  const summaryMeasures = finishTally(summaryTally, partyCode);
  const scopedNeighborhoods = municipalityId
    ? neighborhoodUnits.filter((unit) => unit.ibgeCode === municipalityId)
    : neighborhoodUnits;
  const placesWithoutCoordinate = scopedPlaces.filter(
    (place) => place.latitude === null || place.longitude === null,
  );

  // ---- Recorte da candidata ----------------------------------------------
  // Voto dela no recorte: soma dos locais que estavam na disputa. Recorte
  // inteiramente fora da disputa fica com null, não com 0.
  let summaryCandidateVotes: number | null = null;
  // Denominador da taxa: só o eleitorado dos locais em que ela ESTAVA NA URNA.
  let summaryCandidateElectorate = 0;
  for (const place of scopedPlaces) {
    const votesHere = candidateVotesAt(place.id, place.ibgeCode);
    if (votesHere === null) continue;
    summaryCandidateVotes = (summaryCandidateVotes ?? 0) + votesHere;
    summaryCandidateElectorate += place.electorate;
  }
  const scopedElectorate = scopedPlaces.reduce(
    (total, place) => total + place.electorate,
    0,
  );

  /**
   * Locais que não casam: a medida de confiança deste recorte.
   *
   * `places-go.json` foi montado com os cadastros de 2022 e 2024, mas os
   * pleitos dela vão até 2016 e o TSE renumera seções e locais entre eleições.
   * Local presente no mapa dela e ausente do cadastro não tem coordenada,
   * bairro nem eleitorado: não vira bolha nem entra em soma alguma, mas é
   * contado e declarado na interface.
   *
   * A contagem é sempre ESTADUAL, mesmo com filtro de município: sem cadastro
   * não há como saber a que cidade o local não casado pertencia.
   */
  const registryPlaceIds = new Set(
    places.map((place) => canonicalPlaceId(place.id)),
  );
  let candidateUnmatchedPlaceCount = 0;
  let candidateUnmatchedVotes = 0;
  let candidateMatchedPlaceCount = 0;
  let candidateMatchedVotes = 0;
  for (const [placeId, amount] of Object.entries(candidateByPlace)) {
    if (!Number.isFinite(amount)) continue;
    if (registryPlaceIds.has(placeId)) {
      candidateMatchedPlaceCount += 1;
      candidateMatchedVotes += amount;
    } else {
      candidateUnmatchedPlaceCount += 1;
      candidateUnmatchedVotes += amount;
    }
  }
  const candidateInfo: PollingCandidateInfo | null = candidateContest
    ? {
        nomeUrna: candidateContest.candidatura.nomeUrna,
        partido: candidateContest.candidatura.partido,
        contestId: candidateContest.id,
        contestLabel: getPollingCandidateContestLabel(candidateContest),
        electionYear: candidateContest.electionYear,
        officeCode: candidateContest.officeCode,
        officeName: candidateContest.officeName,
        round: candidateContest.round,
        municipal: isMunicipalContest(candidateContest),
        scopeIbgeCodes: candidateScope ? [...candidateScope] : null,
        scopeLabel: candidateScope
          ? [...candidateScope]
              .map(
                (ibge) =>
                  candidateContest.municipios[ibge]?.nome ??
                  municipalityGroups.get(ibge)?.name ??
                  ibge,
              )
              .sort((a, b) => a.localeCompare(b, "pt-BR"))
              .join(", ")
          : STATE_LABEL,
        votesInContest: candidateContest.votosNoEstado,
        placesInContest: Object.keys(candidateByPlace).length,
        matchedVotes: candidateMatchedVotes,
        matchedPlaceCount: candidateMatchedPlaceCount,
        unmatchedPlaceCount: candidateUnmatchedPlaceCount,
        unmatchedVotes: candidateUnmatchedVotes,
        votesWithoutPlace: candidateContest.votosSemLocalDeVotacao,
      }
    : null;

  const availableMunicipalities = municipalityAggregates.map((item) => ({
    ibgeCode: item.ibgeCode,
    name: item.name,
    placeCount: item.placeCount,
  }));

  return {
    // Na medida da candidata o pleito é o DELA: é o que nomeia o CSV, o PNG e
    // o relatório.
    contestId: candidateContest
      ? candidateContest.id
      : contest
        ? getPollingContestId(contest)
        : "",
    contestLabel: candidateContest
      ? getPollingCandidateContestLabel(candidateContest)
      : contest
        ? getSpectrumContestLabel(contest)
        : "",
    waveYear,
    officeCode: candidateContest?.officeCode ?? contest?.officeCode ?? 0,
    officeName: candidateContest?.officeName ?? contest?.officeName ?? "",
    metric,
    partyCode,
    partyOptions,
    candidateRate,
    candidateAvailability,
    candidateOptions,
    candidate: candidateInfo,
    viewMode: state.viewMode,
    municipalityId,
    municipalityName: municipalityId
      ? municipalityGroups.get(municipalityId)?.name ?? null
      : null,
    thresholds,
    municipalityThresholds,
    bandCounts: ALL_ANALYSIS_BANDS.map(
      (band) => units.filter((unit) => unit.value !== null && unit.band === band).length,
    ),
    units,
    filteredUnits,
    bubbles,
    hiddenBubbleCount: mappedUnits.length - drawableUnits.length,
    missingIndexCount: units.filter((unit) => unit.index === null).length,
    missingValueCount: units.filter((unit) => unit.value === null).length,
    placesWithoutCoordinateCount: placesWithoutCoordinate.length,
    electorateWithoutCoordinate: placesWithoutCoordinate.reduce(
      (total, place) => total + place.electorate,
      0,
    ),
    summary: {
      index: summaryMeasures.index,
      block:
        summaryMeasures.index === null
          ? null
          : classifySpectrumBlock(summaryMeasures.index, registry),
      electorate: scopedElectorate,
      totalVotes: summaryMeasures.totalVotes,
      scoredVotes: summaryMeasures.scoredVotes,
      unscoredVotes: summaryMeasures.unscoredVotes,
      coveragePct: summaryMeasures.coveragePct,
      blockSharePct: summaryMeasures.blockSharePct,
      partyVotes: summaryMeasures.partyVotes,
      partySharePct: summaryMeasures.partySharePct,
      candidateVotes: summaryCandidateVotes,
      candidateVotesPerThousand:
        summaryCandidateVotes === null
          ? null
          : votosPorMilEleitores(
              summaryCandidateVotes,
              summaryCandidateElectorate,
            ),
      candidateUnitsWithVotes: units.filter(
        (unit) => (unit.candidateVotes ?? 0) > 0,
      ).length,
      candidateUnitsOutOfScope: units.filter((unit) => !unit.candidateInScope)
        .length,
      placeCount: scopedPlaces.length,
      mappedPlaceCount: scopedPlaces.length - placesWithoutCoordinate.length,
      neighborhoodCount: scopedNeighborhoods.length,
      leadingPartyCode: summaryMeasures.leadingPartyCode,
    },
    municipalityAggregates,
    availableMunicipalities,
  };
}

/**
 * Opções de texto das medidas. `rate` = medida da candidata em votos por 1.000
 * eleitores; `nome` = nome de urna dela; `inScope` = a unidade estava na
 * disputa dela (só `false` distingue "fora da disputa" de "sem denominador").
 */
export type PollingLabelOptions = {
  rate?: boolean;
  nome?: string;
  inScope?: boolean;
};

/** Valor da métrica ativa em texto; ausência tem palavra própria, nunca "0". */
export function formatPollingValue(
  metric: PollingMetric,
  value: number | null,
  options: PollingLabelOptions = {},
) {
  if (metric === "votosCandidata") {
    if (value === null) {
      // Duas ausências distintas: "ela não era candidata aqui" e "não há
      // eleitorado para dividir". Nenhuma das duas é zero voto.
      if (options.inScope === false) return "Fora da disputa";
      return options.rate ? "Sem eleitorado no local" : "Sem dado";
    }
    return options.rate ? formatDecimal(value) : formatInteger(value);
  }
  if (value === null) {
    return metric === "indice" ? "Sem índice" : "Sem voto apurado";
  }
  return metric === "indice" ? formatDecimal(value) : formatPercent(value);
}

/** Nome curto da métrica, já com a sigla ou a candidata em foco. */
export function getPollingMetricLabel(
  metric: PollingMetric,
  partyCode: string,
  options: PollingLabelOptions = {},
) {
  if (metric === "indice") return "índice ideológico 0–10";
  if (metric === "votosCandidata") {
    const quem = options.nome ? `de ${options.nome}` : "da candidata";
    return options.rate
      ? `votos ${quem} por 1.000 eleitores`
      : `votos ${quem} por local`;
  }
  return partyCode ? `% de voto do ${partyCode}` : "% de voto por sigla";
}

export function getPollingMetricShortLabel(
  metric: PollingMetric,
  partyCode: string,
  options: PollingLabelOptions = {},
) {
  if (metric === "indice") return "índice 0–10";
  if (metric === "votosCandidata") {
    const quem = options.nome ? `de ${options.nome}` : "da candidata";
    return options.rate ? `votos ${quem} por mil eleitores` : `votos ${quem}`;
  }
  return partyCode ? `% do ${partyCode}` : "% por sigla";
}

/** Rótulo principal da faixa: nome do bloco no índice, intervalo nas demais. */
export function getPollingBandLabel(
  metric: PollingMetric,
  thresholds: number[],
  band: AnalysisBand,
  options: PollingLabelOptions = {},
) {
  return metric === "indice"
    ? getSpectrumBandLabel(band)
    : getPollingRangeLabel(metric, thresholds, band, options);
}

export function getPollingRangeLabel(
  metric: PollingMetric,
  thresholds: number[],
  band: AnalysisBand,
  options: PollingLabelOptions = {},
) {
  if (metric === "indice") {
    return getSpectrumRangeLabel("index", thresholds, band);
  }
  // Voto é contagem (inteiro); taxa por mil e percentual são decimais.
  const format = (value: number) =>
    metric === "votosCandidata"
      ? options.rate
        ? formatDecimal(value)
        : formatInteger(value)
      : formatPercent(value);
  if (band === 0) return `Até ${format(thresholds[0] ?? 0)}`;
  if (band === 4) return `Acima de ${format(thresholds[3] ?? 0)}`;
  return `> ${format(thresholds[band - 1] ?? 0)} até ${format(thresholds[band] ?? 0)}`;
}

/**
 * Proporção 0–1 do valor na escala da métrica, para a barrinha do ranking.
 * Índice em 0–10, percentual em 0–100. O voto da candidata não tem teto fixo:
 * a barra é relativa ao maior valor do recorte, informado pelo chamador.
 */
export function getPollingValueRatio(
  metric: PollingMetric,
  value: number | null,
  maximum = 0,
) {
  if (value === null) return 0;
  const ratio =
    metric === "indice"
      ? value / 10
      : metric === "votosCandidata"
        ? maximum > 0
          ? value / maximum
          : 0
        : value / 100;
  return Math.min(Math.max(ratio, 0), 1);
}

/** Maior valor da métrica ativa no recorte: a escala da barrinha do ranking. */
export function getPollingMaximumValue(model: PollingModel) {
  return model.units.reduce(
    (maximum, unit) => (unit.value === null ? maximum : Math.max(maximum, unit.value)),
    0,
  );
}

export function getPollingUnitLabel(viewMode: PollingViewMode) {
  return viewMode === "neighborhoods" ? "bairros" : "locais de votação";
}

/**
 * Frase do que a camada mostra, variando com a MEDIDA escolhida e nunca com o
 * cargo. Cada texto diz também qual é a outra leitura disponível.
 */
export function describePollingLayer(model: PollingModel) {
  if (model.metric === "votosCandidata") {
    const nome = model.candidate?.nomeUrna ?? "a candidata";
    const onde = model.candidate?.municipal
      ? `Ela disputou só em ${model.candidate.scopeLabel}: local fora dessa cidade não recebe zero, recebe "fora da disputa" — ela não estava naquela urna.`
      : "Ela estava na urna em todo o estado, então local sem registro de voto dela é zero de verdade.";
    const escala = model.candidateRate
      ? "Cada bolha mostra os votos dela por 1.000 eleitores do local, para comparar colégio grande com colégio pequeno."
      : "Cada bolha mostra quantos votos ela teve naquele local.";
    return `Recorte submunicipal: os votos nominais de ${nome} em cada local de votação no pleito escolhido, e a soma desses locais por bairro. ${escala} ${onde} Esta medida tem lista de pleitos própria — só as eleições dela com cadastro de locais publicado.`;
  }
  if (model.metric === "indice") {
    return "Recorte submunicipal: o índice ideológico 0–10 calculado sobre os votos apurados em cada local de votação, e a soma desses locais por bairro. É a mesma régua da camada de espectro, aplicada abaixo do município. Para ler distribuição de voto em vez de posição no espectro, troque a medida para o percentual de uma sigla.";
  }
  const party = model.partyCode || "uma sigla";
  return `Recorte submunicipal: quanto do voto apurado em cada local de votação foi para o ${party}, e a soma desses locais por bairro. Aqui o mapa mostra distribuição de voto, não posição no espectro — o índice ideológico 0–10 continua a um clique, na outra medida da camada.`;
}

/**
 * Leitura em linguagem natural do recorte, sempre com a ressalva de que a
 * medida é do LOCAL onde se vota, não do domicílio de quem vota.
 */
export function describePollingScope(model: PollingModel) {
  const scope = model.municipalityName ?? STATE_LABEL;
  if (model.metric === "votosCandidata") {
    const nome = model.candidate?.nomeUrna ?? "A candidata";
    if (model.summary.candidateVotes === null) {
      return `${nome} não era candidata em ${scope} neste pleito: ela disputou apenas em ${model.candidate?.scopeLabel ?? "outra cidade"}, então os locais daqui ficam sem valor e fora do ranking — nunca com 0 voto, que diria outra coisa.`;
    }
    const taxa =
      model.summary.candidateVotesPerThousand === null
        ? ""
        : ` — ${formatDecimal(model.summary.candidateVotesPerThousand)} votos por 1.000 eleitores`;
    // Com recorte estadual, o total do pleito entra na frase: sem ele a soma
    // dos locais casados pareceria ser a votação dela, e a diferença (locais
    // fora do cadastro, voto sem local) sumiria da leitura.
    const noPleito =
      model.municipalityId === null &&
      model.candidate !== null &&
      model.summary.candidateVotes < model.candidate.votesInContest
        ? ` No pleito inteiro ela teve ${formatInteger(model.candidate.votesInContest)} votos: a diferença está nos limites desta leitura.`
        : "";
    return `Nos ${formatInteger(model.summary.placeCount)} locais de votação de ${scope}, ${nome} teve ${formatInteger(model.summary.candidateVotes)} votos${taxa}. Ela teve voto em ${formatInteger(model.summary.candidateUnitsWithVotes)} das ${formatInteger(model.units.length)} unidades do recorte.${noPleito} A medida é do local onde se vota, não do bairro onde se mora.`;
  }
  if (model.metric === "votoPartido") {
    if (!model.partyCode) {
      return `Nenhum voto apurado nos locais de ${scope} neste pleito: sem denominador não existe percentual, e o recorte fica sem valor — nunca zerado.`;
    }
    if (model.summary.partySharePct === null) {
      return `Nenhum voto apurado nos locais de ${scope} neste pleito: sem denominador não existe percentual do ${model.partyCode}, e o recorte fica fora do ranking — nunca contado como 0%.`;
    }
    return `Nos ${model.summary.placeCount} locais de votação de ${scope}, o ${model.partyCode} teve ${formatPercent(model.summary.partySharePct)} do voto apurado (${formatInteger(model.summary.partyVotes)} de ${formatInteger(model.summary.totalVotes)} votos). O mapa mostra onde essa fatia é maior e onde é menor, local a local. A medida é do local onde se vota, não do bairro onde se mora.`;
  }
  if (model.summary.index === null) {
    return `Nenhum voto apurado nos locais de ${scope} caiu em partido com nota na onda ${model.waveYear} do survey: o recorte fica sem índice, fora do ranking e das faixas.`;
  }
  const block = model.summary.block;
  const tendency =
    block === "left"
      ? "tende a votar em partidos mais à esquerda"
      : block === "right"
        ? "tende a votar em partidos mais à direita"
        : "distribui votos entre partidos de posições opostas, sem predominância clara";
  return `Nos ${model.summary.placeCount} locais de votação de ${scope}, o índice agregado é ${formatDecimal(model.summary.index)} — quem vota nesses locais ${tendency}. A medida é do local onde se vota, não do bairro onde se mora.`;
}

export function createPollingCsv(model: PollingModel) {
  const isNeighborhood = model.viewMode === "neighborhoods";
  const isPartyShare = model.metric === "votoPartido";
  const isCandidate = model.metric === "votosCandidata";
  // Numa exportação de voto da candidata a coluna "onda_survey" não descreve
  // nada: a onda é do índice ideológico, que ali não está sendo medido.
  const headers = isNeighborhood
    ? [
        "pleito",
        isCandidate ? "candidata" : "onda_survey",
        "codigo_ibge",
        "municipio",
        "bairro",
        "chave_bairro",
        "locais_agregados",
        "locais_com_coordenada",
        "secoes",
        "eleitorado",
        "latitude_centroide",
        "longitude_centroide",
      ]
    : [
        "pleito",
        isCandidate ? "candidata" : "onda_survey",
        "codigo_ibge",
        "municipio",
        "id_local",
        "zona_local",
        "local_de_votacao",
        "endereco",
        "bairro",
        "chave_bairro",
        "secoes",
        "eleitorado",
        "latitude",
        "longitude",
      ];
  const rows = model.filteredUnits.map((unit) => [
    model.contestLabel,
    isCandidate ? (model.candidate?.nomeUrna ?? "") : model.waveYear,
    unit.ibgeCode,
    unit.municipalityName,
    ...(isNeighborhood
      ? [
          unit.neighborhood,
          unit.neighborhoodKey,
          unit.placeCount,
          unit.mappedPlaceCount,
          unit.sectionCount,
          unit.electorate,
          unit.latitude === null ? "" : formatCsvDecimal(unit.latitude),
          unit.longitude === null ? "" : formatCsvDecimal(unit.longitude),
        ]
      : [
          unit.id,
          unit.zone,
          unit.name,
          unit.address,
          unit.neighborhood,
          unit.neighborhoodKey,
          unit.sectionCount,
          unit.electorate,
          unit.latitude === null ? "" : formatCsvDecimal(unit.latitude),
          unit.longitude === null ? "" : formatCsvDecimal(unit.longitude),
        ]),
    // A cauda do arquivo segue a MÉTRICA ATIVA. Célula vazia = valor ausente;
    // 0 escrito é zero apurado.
    ...(isCandidate
      ? // Célula vazia = ela não era candidata ali; 0 escrito é zero de
        // verdade, com ela na urna daquele local.
        [
          model.candidate?.partido ?? "",
          unit.candidateVotes === null ? "" : unit.candidateVotes,
          unit.candidateVotesPerThousand === null
            ? ""
            : formatCsvDecimal(unit.candidateVotesPerThousand),
          unit.candidateInScope ? "sim" : "nao",
          unit.rank,
        ]
      : isPartyShare
      ? [
          model.partyCode,
          unit.partyVotes,
          unit.partySharePct === null
            ? ""
            : formatCsvDecimal(unit.partySharePct),
          unit.totalVotes,
          unit.leadingPartyCode,
          unit.rank,
        ]
      : [
          unit.index === null ? "" : formatCsvDecimal(unit.index),
          formatCsvDecimal(unit.blockSharePct.left),
          formatCsvDecimal(unit.blockSharePct.center),
          formatCsvDecimal(unit.blockSharePct.right),
          unit.totalVotes,
          unit.scoredVotes,
          unit.unscoredVotes,
          formatCsvDecimal(unit.coveragePct),
          unit.leadingPartyCode,
          unit.rank,
        ]),
  ]);
  return createCsv(
    [
      ...headers,
      ...(isCandidate
        ? [
            "partido_da_candidata",
            "votos_da_candidata",
            "votos_por_mil_eleitores",
            "na_disputa",
            "posicao",
          ]
        : isPartyShare
        ? [
            "sigla",
            "votos_da_sigla",
            "percentual_da_sigla",
            "votos_apurados",
            "partido_mais_votado",
            "posicao",
          ]
        : [
            "indice_ideologico",
            "esquerda_pct",
            "centro_pct",
            "direita_pct",
            "votos_totais",
            "votos_com_nota",
            "votos_sem_nota",
            "cobertura_pct",
            "partido_mais_votado",
            "posicao",
          ]),
    ],
    rows,
  );
}

export function getPollingCsvFilename(model: PollingModel) {
  const scope = model.municipalityId ?? STATE_UF;
  const mode = model.viewMode === "neighborhoods" ? "bairros" : "locais";
  // O nome do arquivo diz qual é a medida: dois downloads do mesmo pleito com
  // siglas diferentes não podem cair um por cima do outro.
  const measure =
    model.metric === "votosCandidata"
      ? model.candidateRate
        ? "votos-candidata-por-mil"
        : "votos-candidata"
      : model.metric === "votoPartido" && model.partyCode
        ? `voto-${model.partyCode.toLowerCase()}`
        : "votacao";
  return `${mode}-${measure}-${scope}-${model.contestId || "pleito"}.csv`;
}

export { toggleAnalysisBand as togglePollingBand };
