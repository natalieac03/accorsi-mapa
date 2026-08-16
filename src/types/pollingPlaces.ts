import type { AnalysisBand, AnalysisSortDirection } from "./analysis";
import type { SpectrumBlock } from "./spectrum";

/**
 * Local de votação do TSE (escola, clube, sede) com o eleitorado agregado das
 * seções que funcionam ali. `latitude`/`longitude` são `null` quando o local
 * não foi geocodificado: ele NÃO vira bolha no mapa, mas continua contando na
 * agregação por bairro — ausência de coordenada nunca vira zero.
 */
export type PollingPlace = {
  id: string;
  ibgeCode: string;
  municipalityName: string;
  zone: number;
  localCode: number;
  name: string;
  address: string;
  neighborhood: string;
  /** chave normalizada do bairro (sem acento, minúscula, espaços colapsados) */
  neighborhoodKey: string;
  cep: string;
  latitude: number | null;
  longitude: number | null;
  sectionCount: number;
  electorate: number;
};

export type PollingPlacesMetadata = {
  schemaVersion: number;
  /** "pendente" enquanto o ETL não rodou */
  status?: string;
  state?: string;
  placeCount: number;
  geocodedPlaceCount?: number;
  municipalityCount?: number;
  generatedAt?: string;
  source?: string;
  sourceUrl?: string;
  note?: string;
};

export type PollingPlacesDataset = {
  metadata: PollingPlacesMetadata;
  places: PollingPlace[];
};

/** Votos por local de votação e por sigla, de um único pleito. */
export type PollingVotesDataset = {
  metadata: {
    schemaVersion?: number;
    contestId: string;
    electionYear?: number;
    round?: number;
    officeCode?: number;
    officeName?: string;
    placeCount?: number;
    generatedAt?: string;
    source?: string;
  };
  votes: Record<string, Record<string, number>>;
};

/** Bolhas por local de votação ou uma bolha agregada por bairro. */
export type PollingViewMode = "places" | "neighborhoods";

/**
 * Estado de carregamento sob demanda dos arquivos da camada.
 * `missing` = o arquivo ainda não foi gerado pelo ETL (placeholder vazio ou
 * ausente): a camada fica desabilitada, com mensagem na tela, sem quebrar.
 */
export type PollingDataStatus =
  | "idle"
  | "loading"
  | "ready"
  | "missing"
  | "error";

export type PollingState = {
  contestId: string;
  viewMode: PollingViewMode;
  /** filtro por município (código IBGE); null = todo o estado */
  municipalityId: string | null;
  activeBands: AnalysisBand[];
  sortDirection: AnalysisSortDirection;
};

/**
 * Unidade submunicipal do modelo: um local de votação ou um bairro agregado.
 * O bairro NÃO é polígono — é a soma dos locais daquele bairro, posicionada
 * no centroide dos locais com coordenada.
 */
export type PollingUnit = {
  /** `88013-1-1015` (local) ou `4314902|centro historico` (bairro) */
  id: string;
  kind: "place" | "neighborhood";
  name: string;
  ibgeCode: string;
  municipalityName: string;
  neighborhood: string;
  neighborhoodKey: string;
  address: string;
  /** zona eleitoral do local; 0 no bairro agregado */
  zone: number;
  latitude: number | null;
  longitude: number | null;
  electorate: number;
  sectionCount: number;
  /** locais somados na unidade (1 no modo local de votação) */
  placeCount: number;
  /** locais com coordenada; os demais contam no índice e ficam fora do mapa */
  mappedPlaceCount: number;
  /** índice ideológico 0–10; null quando nenhum voto caiu em partido com nota */
  index: number | null;
  totalVotes: number;
  scoredVotes: number;
  unscoredVotes: number;
  coveragePct: number;
  blockVotes: Record<SpectrumBlock, number>;
  blockSharePct: Record<SpectrumBlock, number>;
  leadingPartyCode: string;
  leadingPartyVotes: number;
  /** faixa da paleta; só tem sentido quando `index` não é null */
  band: AnalysisBand;
  /** posição no ranking do recorte; 0 quando a unidade não tem índice */
  rank: number;
};

/** Bolha desenhada no mapa: só existe com coordenada. */
export type PollingBubble = {
  id: string;
  kind: "place" | "neighborhood";
  name: string;
  ibgeCode: string;
  municipalityName: string;
  neighborhood: string;
  latitude: number;
  longitude: number;
  /** raio em pixels, com área proporcional ao eleitorado (raiz quadrada) */
  radius: number;
  color: string;
  index: number | null;
  electorate: number;
  coveragePct: number;
  placeCount: number;
  /** dentro das faixas em foco: fora disso a bolha é desenhada esmaecida */
  focused: boolean;
};

export type PollingMunicipalityAggregate = {
  ibgeCode: string;
  name: string;
  placeCount: number;
  mappedPlaceCount: number;
  electorate: number;
  index: number | null;
  totalVotes: number;
  scoredVotes: number;
  coveragePct: number;
  band: AnalysisBand;
};

export type PollingSummary = {
  index: number | null;
  block: SpectrumBlock | null;
  electorate: number;
  totalVotes: number;
  scoredVotes: number;
  unscoredVotes: number;
  coveragePct: number;
  blockSharePct: Record<SpectrumBlock, number>;
  placeCount: number;
  mappedPlaceCount: number;
  neighborhoodCount: number;
  leadingPartyCode: string;
};

export type PollingModel = {
  contestId: string;
  contestLabel: string;
  waveYear: number;
  viewMode: PollingViewMode;
  municipalityId: string | null;
  municipalityName: string | null;
  thresholds: number[];
  bandCounts: number[];
  /** todas as unidades do recorte, com e sem índice */
  units: PollingUnit[];
  /** unidades com índice, dentro das faixas em foco, já ordenadas */
  filteredUnits: PollingUnit[];
  bubbles: PollingBubble[];
  /** unidades com coordenada que ficaram fora do mapa pelo teto de bolhas */
  hiddenBubbleCount: number;
  /** unidades do recorte sem nenhum voto com nota */
  missingIndexCount: number;
  /** locais sem coordenada no recorte: contam no bairro, não viram bolha */
  placesWithoutCoordinateCount: number;
  electorateWithoutCoordinate: number;
  summary: PollingSummary;
  /** agregado por município, sempre sobre TODOS os locais (para o export) */
  municipalityAggregates: PollingMunicipalityAggregate[];
  availableMunicipalities: Array<{
    ibgeCode: string;
    name: string;
    placeCount: number;
  }>;
};
