import type { AnalysisBand } from "../types/analysis";
import type {
  PollingBubble,
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
  getAnalysisBand,
  toggleAnalysisBand,
} from "./analysis.ts";
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

/**
 * Camada SUBMUNICIPAL: votação por LOCAL DE VOTAÇÃO.
 *
 * O motor não reimplementa nada do espectro — ele reusa as primitivas de
 * `spectrum.ts` (`resolvePartyScore`, `classifySpectrumBlock`,
 * `resolveWaveYear`, `getAbsoluteThresholds`) e aplica a MESMA disciplina de
 * nulos do projeto: unidade sem nenhum voto com nota fica com índice `null`,
 * fora do ranking e das faixas — nunca contada como zero.
 *
 * DUAS MÉTRICAS, ESCOLHA DE QUEM OLHA: a unidade pode ser medida pelo índice
 * ideológico (padrão, em qualquer cargo) ou pelo percentual de voto de uma
 * sigla escolhida (também em qualquer cargo). O modelo continua calculando o
 * índice nos dois casos (o agente de dados e o agregado municipal dependem
 * dele), mas o que vira cor, faixa, ranking e CSV é `unit.value` — o valor da
 * métrica ativa. Ver `getPollingMetric`.
 *
 * GANCHO DE MALHA DE BAIRROS: não existe polígono de bairro no projeto. Se um
 * dia existir `src/data/neighborhoods-{ibge}.geojson`, a camada deve pintar o
 * polígono do bairro em vez da bolha agregada; até lá, o modo "Bairros"
 * desenha UMA bolha por bairro no centroide dos locais daquele bairro, e a
 * interface diz explicitamente que é agregação de locais, não polígono.
 * O teste do gancho vive em `pollingData.ts` (`hasNeighborhoodMesh`).
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
 * MÉTRICA DA CAMADA, ESCOLHA DE QUEM OLHA — em todo pleito, sem exceção.
 *
 * O índice ideológico 0–10 é o PADRÃO e existe em qualquer cargo: é a régua
 * histórica da plataforma, a mesma da camada de espectro, e é o que aparece ao
 * abrir a camada. O percentual de voto de uma sigla é a segunda medida, também
 * disponível em qualquer cargo, para quem quer ler distribuição de voto em vez
 * de posição no espectro. Nenhum cargo perde uma das duas: cabe a quem olha
 * decidir qual pergunta está fazendo.
 *
 * A escolha se expressa pela SIGLA EM FOCO, e não por um campo separado: sem
 * sigla escolhida a camada mede o índice; com uma sigla escolhida, mede o
 * percentual dela. Um estado só, que não tem como divergir de si mesmo — e o
 * alternador da tela é exatamente isto: escolher uma sigla ou nenhuma.
 */
export function getPollingMetric(
  partyCode: string | null | undefined,
): PollingMetric {
  return partyCode ? "votoPartido" : "indice";
}

/** As duas medidas do alternador, na ordem em que aparecem na tela. */
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
];

/**
 * Rampa SEQUENCIAL de um tom só para o percentual de UMA sigla: claro = pouco
 * voto, escuro = muito voto. Percentual de uma sigla é magnitude, não
 * polaridade — usar aqui a paleta divergente do espectro sugeriria dois polos
 * onde existe uma única grandeza crescente.
 *
 * São os passos 300→700 do azul sequencial documentado na skill de dataviz.
 * Validada como rampa ordinal (`--ordinal`) nas duas superfícies claras do
 * app: lightness monótona, ΔL adjacente ≥ 0,06, tom único (3° de variação) e
 * a ponta clara em 2,50:1 sobre o branco e 2,27:1 sobre #f6f3f2 (piso 2:1).
 * Todo passo fica a ΔE ≥ 14,6 (OKLab ×100, visão normal, protanopia e
 * deuteranopia) do cinza de dado ausente #788382, então "0% da sigla" nunca se
 * confunde com "sem voto apurado aqui". O azul também não é a cor de nenhuma
 * das siglas que o seletor oferece — a bolha mede o quanto, não quem.
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
 * que o espectro usa nas suas métricas percentuais. Fixas de propósito — corte
 * por quantil mudaria de significado a cada troca de sigla ou de recorte, e a
 * mesma cor deixaria de querer dizer a mesma coisa entre dois mapas.
 */
export const POLLING_SHARE_THRESHOLDS = [20, 40, 60, 80];

export function getPollingMetricColors(metric: PollingMetric) {
  return metric === "indice" ? SPECTRUM_COLORS : POLLING_SHARE_COLORS;
}

export function getPollingThresholds(
  metric: PollingMetric,
  registry: PartySpectrumRegistry,
) {
  return metric === "indice"
    ? getAbsoluteThresholds("index", registry)
    : [...POLLING_SHARE_THRESHOLDS];
}

/**
 * Teto de bolhas desenhadas de uma vez. Goiás tem milhares de locais de votação e
 * cada bolha é um marcador do mapa: sem teto o navegador trava. Acima do
 * limite ficam as maiores por eleitorado, e a interface informa quantas
 * ficaram de fora — filtrar por município mostra todas as daquele município.
 */
export const POLLING_MAX_BUBBLES = 600;

/** Raio mínimo e máximo das bolhas, em pixels. */
export const POLLING_BUBBLE_MIN_RADIUS = 5;
export const POLLING_BUBBLE_MAX_RADIUS = 34;

/**
 * Raio da bolha com ÁREA proporcional ao eleitorado: raio ∝ √eleitorado.
 * Escalar o raio direto pelo valor infla visualmente os locais grandes pelo
 * quadrado — o erro clássico de bolha proporcional.
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
 * Identificador do arquivo de votos do pleito (`votes-{contestId}.json`).
 * Os pleitos do espectro carregam o prefixo da origem (`elections:2022-1-1`);
 * o arquivo do ETL usa apenas o sufixo (`2022-1-1`).
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
    // null = nenhuma sigla em foco, ou seja, a camada abre no índice
    // ideológico — o comportamento histórico da plataforma.
    partyCode: null,
    activeBands: [...ALL_ANALYSIS_BANDS],
    sortDirection: "desc",
  };
}

/**
 * Sigla vinda de fora (armazenamento local, link antigo): só sobrevive se
 * parecer um código de partido. Ela ainda passa pelo filtro do modelo, que a
 * descarta se não houver voto apurado dela no pleito.
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
 * Leitura defensiva do arquivo de locais: qualquer coisa que não case com o
 * contrato vira `null` e a camada informa que o dado não foi gerado, em vez
 * de quebrar o app.
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
 * Soma um conjunto de votos por sigla no acumulador, usando exatamente as
 * primitivas do espectro para resolver a nota do partido na onda do pleito.
 * `partyCode` é a sigla em foco na métrica de voto por partido: os votos dela
 * são somados à parte, sem interferir em nada do índice.
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
    // sem sigla escolhida) o valor é AUSENTE, jamais 0%. Com apuração e sem
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
 * (dois locais, duas grafias), vence a grafia do local com mais eleitores —
 * critério determinístico, para o rótulo não oscilar entre execuções.
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

export type PollingModelInput = {
  places: PollingPlace[];
  /** votos por local; null quando o arquivo do pleito ainda não existe */
  votes: Record<string, Record<string, number>> | null;
  index: PartySpectrumIndex;
  registry: PartySpectrumRegistry;
  /** pleito do espectro selecionado; null quando não há pleitos */
  contest: SpectrumSourceContest | null;
  state: PollingState;
  /** teto de bolhas desenhadas; o excedente sai do mapa, nunca do índice */
  maxBubbles?: number;
};

export function buildPollingModel(input: PollingModelInput): PollingModel {
  const {
    places,
    votes,
    index,
    registry,
    contest,
    state,
    maxBubbles = POLLING_MAX_BUBBLES,
  } = input;
  // Onda do survey resolvida pela MESMA regra do espectro municipal.
  const waveYear = contest
    ? resolveWaveYear(registry, contest.electionYear)
    : registry.metadata.waves[0].year;
  // A métrica sai da ESCOLHA guardada no estado, não do cargo do pleito: sem
  // sigla em foco a camada mede o índice ideológico, em Presidente, Governador
  // ou qualquer outro cargo.
  const metric = getPollingMetric(state.partyCode);
  const thresholds = getPollingThresholds(metric, registry);
  const votesByPlace = votes ?? {};

  // ---- Siglas do pleito ---------------------------------------------------
  // O leque de siglas sai do pleito INTEIRO, não do recorte: filtrar por
  // município não pode fazer a sigla escolhida sumir do seletor. Uma sigla só
  // entra na lista se realmente teve voto apurado — nada de sigla inventada.
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
  // Na métrica de sigla, uma escolha que não tem voto apurado aqui (outro
  // pleito, outro cargo) não vale como filtro vazio — ela cede lugar à sigla
  // mais votada do pleito, para o mapa não ficar inteiro sem valor.
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
      value: metric === "indice" ? measures.index : measures.partySharePct,
      band: 0 as AnalysisBand,
      rank: 0,
    };
  });

  // ---- Bairros: soma os VOTOS antes de calcular o índice ------------------
  // Média ponderada de verdade (mesmo princípio de selection.ts): jamais a
  // média das médias dos locais, que ignoraria o tamanho de cada local.
  type NeighborhoodGroup = {
    ibgeCode: string;
    municipalityName: string;
    neighborhoodKey: string;
    spellings: Array<{ value: string; weight: number }>;
    byParty: Record<string, number>;
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
        value: metric === "indice" ? measures.index : measures.partySharePct,
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
      electorate: number;
      placeCount: number;
      mappedPlaceCount: number;
    }
  >();
  for (const place of places) {
    const group = municipalityGroups.get(place.ibgeCode) ?? {
      name: place.municipalityName,
      byParty: {},
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
    municipalityGroups.set(place.ibgeCode, group);
  }
  const municipalityAggregates: PollingMunicipalityAggregate[] = [
    ...municipalityGroups.entries(),
  ]
    .map(([ibgeCode, group]) => {
      const tally = createTally();
      addVotesToTally(tally, group.byParty, index, waveYear, partyCode);
      const measures = finishTally(tally, partyCode);
      const value = metric === "indice" ? measures.index : measures.partySharePct;
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
        value,
        band:
          value === null
            ? (0 as AnalysisBand)
            : getAnalysisBand(value, thresholds),
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
  // Ranking, faixas e cor saem sempre do valor da MÉTRICA ATIVA: unidade sem
  // valor (sem voto com nota no índice, sem denominador no percentual) fica
  // fora de tudo isso, nunca no fim da fila como se valesse zero.
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

  const availableMunicipalities = municipalityAggregates.map((item) => ({
    ibgeCode: item.ibgeCode,
    name: item.name,
    placeCount: item.placeCount,
  }));

  return {
    contestId: contest ? getPollingContestId(contest) : "",
    contestLabel: contest ? getSpectrumContestLabel(contest) : "",
    waveYear,
    officeCode: contest?.officeCode ?? 0,
    officeName: contest?.officeName ?? "",
    metric,
    partyCode,
    partyOptions,
    viewMode: state.viewMode,
    municipalityId,
    municipalityName: municipalityId
      ? municipalityGroups.get(municipalityId)?.name ?? null
      : null,
    thresholds,
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
      electorate: scopedPlaces.reduce((total, place) => total + place.electorate, 0),
      totalVotes: summaryMeasures.totalVotes,
      scoredVotes: summaryMeasures.scoredVotes,
      unscoredVotes: summaryMeasures.unscoredVotes,
      coveragePct: summaryMeasures.coveragePct,
      blockSharePct: summaryMeasures.blockSharePct,
      partyVotes: summaryMeasures.partyVotes,
      partySharePct: summaryMeasures.partySharePct,
      placeCount: scopedPlaces.length,
      mappedPlaceCount: scopedPlaces.length - placesWithoutCoordinate.length,
      neighborhoodCount: scopedNeighborhoods.length,
      leadingPartyCode: summaryMeasures.leadingPartyCode,
    },
    municipalityAggregates,
    availableMunicipalities,
  };
}

/** Valor da métrica ativa em texto; ausência tem palavra própria, nunca "0". */
export function formatPollingValue(
  metric: PollingMetric,
  value: number | null,
) {
  if (value === null) {
    return metric === "indice" ? "Sem índice" : "Sem voto apurado";
  }
  return metric === "indice" ? formatDecimal(value) : formatPercent(value);
}

/** Nome curto da métrica, já com a sigla escolhida quando existe. */
export function getPollingMetricLabel(metric: PollingMetric, partyCode: string) {
  if (metric === "indice") return "índice ideológico 0–10";
  return partyCode ? `% de voto do ${partyCode}` : "% de voto por sigla";
}

export function getPollingMetricShortLabel(
  metric: PollingMetric,
  partyCode: string,
) {
  if (metric === "indice") return "índice 0–10";
  return partyCode ? `% do ${partyCode}` : "% por sigla";
}

/** Rótulo principal da faixa: nome do bloco no índice, intervalo no percentual. */
export function getPollingBandLabel(
  metric: PollingMetric,
  thresholds: number[],
  band: AnalysisBand,
) {
  return metric === "indice"
    ? getSpectrumBandLabel(band)
    : getPollingRangeLabel(metric, thresholds, band);
}

export function getPollingRangeLabel(
  metric: PollingMetric,
  thresholds: number[],
  band: AnalysisBand,
) {
  if (metric === "indice") {
    return getSpectrumRangeLabel("index", thresholds, band);
  }
  const format = (value: number) => formatPercent(value);
  if (band === 0) return `Até ${format(thresholds[0] ?? 0)}`;
  if (band === 4) return `Acima de ${format(thresholds[3] ?? 0)}`;
  return `> ${format(thresholds[band - 1] ?? 0)} até ${format(thresholds[band] ?? 0)}`;
}

/**
 * Proporção 0–1 do valor dentro da escala da métrica, para a barrinha do
 * ranking. O índice mora em 0–10; o percentual, em 0–100.
 */
export function getPollingValueRatio(
  metric: PollingMetric,
  value: number | null,
) {
  if (value === null) return 0;
  const ratio = metric === "indice" ? value / 10 : value / 100;
  return Math.min(Math.max(ratio, 0), 1);
}

export function getPollingUnitLabel(viewMode: PollingViewMode) {
  return viewMode === "neighborhoods" ? "bairros" : "locais de votação";
}

/**
 * O que a camada está mostrando e POR QUE, em uma frase que muda com a MEDIDA
 * escolhida — nunca com o cargo. A explicação anda junto com o dado, não num
 * rodapé, e cada texto diz também qual é a outra leitura disponível.
 */
export function describePollingLayer(model: PollingModel) {
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
  const scope = model.municipalityName ?? "Goiás";
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
  const headers = isNeighborhood
    ? [
        "pleito",
        "onda_survey",
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
        "onda_survey",
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
    model.waveYear,
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
    // A cauda do arquivo segue a MÉTRICA ATIVA: numa tela de percentual não
    // sobra coluna de índice ideológico nem de blocos, que ali não descrevem
    // nada. Célula vazia = valor ausente; 0 escrito é zero apurado.
    ...(isPartyShare
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
      ...(isPartyShare
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
  const scope = model.municipalityId ?? "rs";
  const mode = model.viewMode === "neighborhoods" ? "bairros" : "locais";
  // O nome do arquivo diz qual é a medida: dois downloads do mesmo pleito com
  // siglas diferentes não podem cair um por cima do outro.
  const measure =
    model.metric === "votoPartido" && model.partyCode
      ? `voto-${model.partyCode.toLowerCase()}`
      : "votacao";
  return `${mode}-${measure}-${scope}-${model.contestId || "pleito"}.csv`;
}

export { toggleAnalysisBand as togglePollingBand };
