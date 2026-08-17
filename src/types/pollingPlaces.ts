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
 * O que a camada mede em cada unidade.
 *
 * `indice` = índice ideológico 0–10, a régua do espectro aplicada abaixo do
 * município. `votoPartido` = percentual de voto de UMA sigla sobre os votos
 * apurados da unidade.
 *
 * As duas existem em QUALQUER pleito e a escolha é de quem olha: o índice é o
 * padrão, o percentual é a segunda opção do alternador. Quem decide é a sigla
 * em foco (`PollingState.partyCode`), lida por `getPollingMetric` — o cargo do
 * pleito não entra nessa conta.
 */
export type PollingMetric = "indice" | "votoPartido";

/** Sigla com voto apurado no pleito, para o seletor da métrica de partido. */
export type PollingPartyOption = {
  code: string;
  /** votos apurados da sigla em TODOS os locais do pleito */
  votes: number;
  /** participação da sigla no total apurado do pleito */
  sharePct: number;
};

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
  /**
   * Sigla em foco — e, por consequência, a MEDIDA da camada. `null` = nenhuma
   * sigla escolhida, ou seja, índice ideológico (o padrão). Uma sigla aqui
   * significa "meça o percentual dela"; a escolha sobrevive à troca de pleito
   * quando a sigla também tem voto lá, e cede lugar à mais votada quando não
   * tem.
   */
  partyCode: string | null;
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
  /**
   * Votos apurados da sigla escolhida nesta unidade. Zero aqui com
   * `totalVotes` positivo é zero DE VERDADE: a urna apurou e a sigla não teve
   * voto. Sem apuração nenhuma o que fica ausente é `partySharePct`.
   */
  partyVotes: number;
  /**
   * Percentual da sigla escolhida sobre os votos apurados da unidade. `null`
   * quando não há denominador (nenhum voto apurado ali) — nunca 0%.
   */
  partySharePct: number | null;
  /** valor da MÉTRICA ATIVA: índice 0–10 ou % da sigla. null = ausente. */
  value: number | null;
  /** faixa da paleta; só tem sentido quando `value` não é null */
  band: AnalysisBand;
  /** posição no ranking do recorte; 0 quando a unidade não tem valor */
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
  /** valor da métrica ativa da camada; null = sem dado, cor de ausência */
  value: number | null;
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
  partyVotes: number;
  partySharePct: number | null;
  /** valor da métrica ativa; é o que pinta o polígono do município */
  value: number | null;
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
  partyVotes: number;
  partySharePct: number | null;
  placeCount: number;
  mappedPlaceCount: number;
  neighborhoodCount: number;
  leadingPartyCode: string;
};

export type PollingModel = {
  contestId: string;
  contestLabel: string;
  waveYear: number;
  /** cargo do pleito (TSE), só para rótulo: não decide nada da métrica */
  officeCode: number;
  officeName: string;
  metric: PollingMetric;
  /** sigla em foco na métrica de voto por partido; "" quando não há sigla */
  partyCode: string;
  /** siglas com voto apurado no pleito, da mais votada para a menos votada */
  partyOptions: PollingPartyOption[];
  viewMode: PollingViewMode;
  municipalityId: string | null;
  municipalityName: string | null;
  thresholds: number[];
  bandCounts: number[];
  /** todas as unidades do recorte, com e sem valor */
  units: PollingUnit[];
  /** unidades com valor, dentro das faixas em foco, já ordenadas */
  filteredUnits: PollingUnit[];
  bubbles: PollingBubble[];
  /** unidades com coordenada que ficaram fora do mapa pelo teto de bolhas */
  hiddenBubbleCount: number;
  /**
   * Unidades do recorte sem nenhum voto com nota — SEMPRE sobre o índice
   * ideológico, independente da métrica ativa. É o número que o agente de
   * dados reporta; a interface da camada usa `missingValueCount`.
   */
  missingIndexCount: number;
  /** unidades do recorte sem valor na MÉTRICA ATIVA (fora do ranking) */
  missingValueCount: number;
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
