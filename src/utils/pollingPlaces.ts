import type { AnalysisBand } from "../types/analysis";
import type {
  PollingBubble,
  PollingMunicipalityAggregate,
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
import { formatDecimal, MISSING_DATA_COLOR } from "./electorate.ts";
import { normalizeNeighborhoodKey } from "./registrations.ts";
import {
  classifySpectrumBlock,
  getAbsoluteThresholds,
  getSpectrumContestLabel,
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
      "Uma bolha por bairro, somando os votos dos locais antes de calcular o índice. É agregação de locais, não polígono de bairro.",
  },
];

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
    activeBands: [...ALL_ANALYSIS_BANDS],
    sortDirection: "desc",
  };
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
};

function createTally(): Tally {
  return {
    totalVotes: 0,
    scoredVotes: 0,
    weightedSum: 0,
    blockVotes: { left: 0, center: 0, right: 0 },
    leadingPartyCode: "",
    leadingPartyVotes: 0,
  };
}

/**
 * Soma um conjunto de votos por sigla no acumulador, usando exatamente as
 * primitivas do espectro para resolver a nota do partido na onda do pleito.
 */
function addVotesToTally(
  tally: Tally,
  byParty: Record<string, number>,
  index: PartySpectrumIndex,
  waveYear: number,
) {
  for (const [party, votes] of Object.entries(byParty)) {
    if (!Number.isFinite(votes) || votes <= 0) continue;
    tally.totalVotes += votes;
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

function finishTally(tally: Tally) {
  const index = tally.scoredVotes > 0 ? tally.weightedSum / tally.scoredVotes : null;
  return {
    index,
    totalVotes: tally.totalVotes,
    scoredVotes: tally.scoredVotes,
    unscoredVotes: tally.totalVotes - tally.scoredVotes,
    coveragePct:
      tally.totalVotes > 0 ? (tally.scoredVotes / tally.totalVotes) * 100 : 0,
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
  const thresholds = getAbsoluteThresholds("index", registry);
  const votesByPlace = votes ?? {};

  // ---- Locais de votação -------------------------------------------------
  const placeUnits: PollingUnit[] = places.map((place) => {
    const tally = createTally();
    addVotesToTally(tally, votesByPlace[place.id] ?? {}, index, waveYear);
    const measures = finishTally(tally);
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
      addVotesToTally(tally, group.byParty, index, waveYear);
      const measures = finishTally(tally);
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
      addVotesToTally(tally, group.byParty, index, waveYear);
      const measures = finishTally(tally);
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
        band:
          measures.index === null
            ? (0 as AnalysisBand)
            : getAnalysisBand(measures.index, thresholds),
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
  const ranked = scopedUnits
    .filter((unit) => unit.index !== null)
    .slice()
    .sort(
      (a, b) =>
        (b.index ?? 0) - (a.index ?? 0) || a.name.localeCompare(b.name, "pt-BR"),
    );
  const rankById = new Map(ranked.map((unit, position) => [unit.id, position + 1]));
  const units = scopedUnits.map((unit) => ({
    ...unit,
    band:
      unit.index === null
        ? (0 as AnalysisBand)
        : getAnalysisBand(unit.index, thresholds),
    rank: rankById.get(unit.id) ?? 0,
  }));

  const activeBandSet = new Set(state.activeBands);
  const direction = state.sortDirection === "desc" ? -1 : 1;
  const filteredUnits = units
    .filter((unit) => unit.index !== null && activeBandSet.has(unit.band))
    .sort(
      (a, b) =>
        ((a.index ?? 0) - (b.index ?? 0)) * direction ||
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
    color: unit.index === null ? MISSING_DATA_COLOR : SPECTRUM_COLORS[unit.band],
    index: unit.index,
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
  addVotesToTally(summaryTally, summaryByParty, index, waveYear);
  const summaryMeasures = finishTally(summaryTally);
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
    viewMode: state.viewMode,
    municipalityId,
    municipalityName: municipalityId
      ? municipalityGroups.get(municipalityId)?.name ?? null
      : null,
    thresholds,
    bandCounts: ALL_ANALYSIS_BANDS.map(
      (band) => units.filter((unit) => unit.index !== null && unit.band === band).length,
    ),
    units,
    filteredUnits,
    bubbles,
    hiddenBubbleCount: mappedUnits.length - drawableUnits.length,
    missingIndexCount: units.filter((unit) => unit.index === null).length,
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
      placeCount: scopedPlaces.length,
      mappedPlaceCount: scopedPlaces.length - placesWithoutCoordinate.length,
      neighborhoodCount: scopedNeighborhoods.length,
      leadingPartyCode: summaryMeasures.leadingPartyCode,
    },
    municipalityAggregates,
    availableMunicipalities,
  };
}

export function formatPollingIndex(value: number | null) {
  return value === null ? "Sem índice" : formatDecimal(value);
}

export function getPollingUnitLabel(viewMode: PollingViewMode) {
  return viewMode === "neighborhoods" ? "bairros" : "locais de votação";
}

/**
 * Leitura em linguagem natural do recorte, sempre com a ressalva de que a
 * medida é do LOCAL onde se vota, não do domicílio de quem vota.
 */
export function describePollingScope(model: PollingModel) {
  const scope = model.municipalityName ?? "Goiás";
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
  ]);
  return createCsv(
    [
      ...headers,
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
    ],
    rows,
  );
}

export function getPollingCsvFilename(model: PollingModel) {
  const scope = model.municipalityId ?? "rs";
  const mode = model.viewMode === "neighborhoods" ? "bairros" : "locais";
  return `${mode}-votacao-${scope}-${model.contestId || "pleito"}.csv`;
}

export { toggleAnalysisBand as togglePollingBand };
