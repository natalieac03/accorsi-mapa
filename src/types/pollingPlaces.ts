import type { AnalysisBand, AnalysisSortDirection } from "./analysis";
import type { SpectrumBlock } from "./spectrum";

/**
 * Local de votação do TSE (escola, clube, sede) com o eleitorado agregado das
 * seções que funcionam ali. `latitude`/`longitude` `null` = não geocodificado:
 * não vira bolha no mapa, mas continua contando na agregação por bairro.
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
 * O que a camada mede em cada unidade. `indice` = índice ideológico 0–10
 * (padrão). `votoPartido` = percentual de voto de UMA sigla sobre os votos
 * apurados da unidade; as duas saem de qualquer pleito do arquivo de votos por
 * local e quem decide entre elas é a sigla em foco (`PollingState.partyCode`).
 * `votosCandidata` = votos NOMINAIS da candidata no local; vem da trajetória
 * dela, tem estado próprio (`PollingState.candidateContestId`) e lista de
 * pleitos própria (os com cadastro de locais). Ver `getPollingMetric`.
 */
export type PollingMetric = "indice" | "votoPartido" | "votosCandidata";

/** Sigla com voto apurado no pleito, para o seletor da métrica de partido. */
export type PollingPartyOption = {
  code: string;
  /** votos apurados da sigla em TODOS os locais do pleito */
  votes: number;
  /** participação da sigla no total apurado do pleito */
  sharePct: number;
};

/** Carregamento sob demanda; `missing` = ETL não gerou o arquivo, camada desabilitada. */
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
   * Sigla em foco e, por consequência, a MEDIDA da camada. `null` = índice
   * ideológico (o padrão). Na troca de pleito cede lugar à mais votada quando
   * a sigla não tem voto lá.
   */
  partyCode: string | null;
  /**
   * Pleito DELA em foco e, por consequência, a terceira MEDIDA da camada.
   * `null` = a camada não mede o voto dela. É o `CandidateContest.id`
   * ("2018-7-1"), de lista PRÓPRIA, sem relação com o `contestId` acima.
   */
  candidateContestId: string | null;
  /**
   * Na medida da candidata: `false` = voto absoluto do local, `true` = votos
   * por 1.000 eleitores. Cor, faixa, ranking e CSV mudam juntos.
   */
  candidateRate: boolean;
  activeBands: AnalysisBand[];
  sortDirection: AnalysisSortDirection;
};

/**
 * Unidade submunicipal: um local de votação ou um bairro agregado. O bairro
 * NÃO é polígono: soma dos locais dele, no centroide dos que têm coordenada.
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
  /** Votos apurados da sigla nesta unidade; 0 com `totalVotes` positivo é zero de verdade. */
  partyVotes: number;
  /** % da sigla sobre os votos apurados da unidade; `null` sem denominador, nunca 0%. */
  partySharePct: number | null;
  /**
   * Votos NOMINAIS da candidata nesta unidade, no pleito dela escolhido.
   * `null` = ela NÃO estava na urna aqui (ver `candidateInScope`); `0` =
   * estava na urna e não teve voto, zero de verdade.
   */
  candidateVotes: number | null;
  /** Votos dela por 1.000 eleitores; `null` sem eleitorado positivo ou fora da disputa. */
  candidateVotesPerThousand: number | null;
  /** true quando ela estava na urna aqui; só faz sentido na medida `votosCandidata`. */
  candidateInScope: boolean;
  /** valor da MÉTRICA ATIVA: índice 0–10, % da sigla ou voto dela; null = ausente */
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
  /** false = a candidata não disputou aqui (só na medida `votosCandidata`). */
  candidateInScope: boolean;
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
  /** votos dela no município; null quando ela não disputou nesta cidade */
  candidateVotes: number | null;
  candidateVotesPerThousand: number | null;
  candidateInScope: boolean;
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
  /** votos dela somados no recorte; null quando o recorte inteiro está fora */
  candidateVotes: number | null;
  candidateVotesPerThousand: number | null;
  /** unidades do recorte em que ela teve pelo menos um voto */
  candidateUnitsWithVotes: number;
  /** unidades do recorte onde ela nem estava na urna (só na medida dela) */
  candidateUnitsOutOfScope: number;
  placeCount: number;
  mappedPlaceCount: number;
  neighborhoodCount: number;
  leadingPartyCode: string;
};

/**
 * Por que a medida "votos da candidata" pode não estar disponível.
 * `pendente` = trajetória ainda não gerada; `sem-recorte` = trajetória existe,
 * mas nenhum pleito dela tem cadastro de locais. A interface DIZ o porquê.
 */
export type PollingCandidateAvailability =
  | "disponivel"
  | "pendente"
  | "sem-recorte";

/** Um pleito DELA oferecido no seletor da medida de voto da candidata. */
export type PollingCandidateContestOption = {
  /** `CandidateContest.id`, ex.: "2018-7-1" */
  id: string;
  /** "2018 · Deputada Federal" (cargo no feminino, turno quando > 1) */
  label: string;
  electionYear: number;
  officeCode: number;
  officeName: string;
  round: number;
  /** true = Prefeita/Vereadora: a disputa aconteceu em UMA cidade só */
  municipal: boolean;
  /** locais em que ela teve voto naquele pleito (tamanho do mapa `locais`) */
  placeCount: number;
  /** votos nominais dela no pleito inteiro */
  votes: number;
};

/**
 * O recorte da candidata no pleito escolhido, inclusive o que NÃO deu para
 * medir: `places-go.json` vem dos cadastros de 2022/2024 e o TSE renumera
 * seções, então pleito antigo dela sempre perde alguns locais.
 */
export type PollingCandidateInfo = {
  nomeUrna: string;
  partido: string;
  contestId: string;
  contestLabel: string;
  electionYear: number;
  officeCode: number;
  officeName: string;
  round: number;
  /** true = Prefeita/Vereadora: ela estava na urna de UMA cidade só */
  municipal: boolean;
  /**
   * IBGE das cidades em que ela estava na urna; `null` = estado inteiro.
   * Separa "0 voto de verdade" de "fora da disputa".
   */
  scopeIbgeCodes: string[] | null;
  scopeLabel: string;
  /** votos nominais dela no pleito inteiro, direto do ETL */
  votesInContest: number;
  /** locais do pleito dela (tamanho do mapa `locais`) */
  placesInContest: number;
  /** votos dela somados nos locais que casaram com o cadastro de locais */
  matchedVotes: number;
  matchedPlaceCount: number;
  /** locais do mapa dela AUSENTES do cadastro de locais; nunca descartados em silêncio */
  unmatchedPlaceCount: number;
  unmatchedVotes: number;
  /** votos dela sem local de votação identificado no próprio ETL */
  votesWithoutPlace: number;
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
  /** true = a medida da candidata está em votos por 1.000 eleitores */
  candidateRate: boolean;
  /** por que a medida da candidata está (ou não) disponível */
  candidateAvailability: PollingCandidateAvailability;
  /** pleitos DELA com cadastro de locais, do mais recente para o mais antigo */
  candidateOptions: PollingCandidateContestOption[];
  /** recorte da candidata no pleito escolhido; null fora dessa medida */
  candidate: PollingCandidateInfo | null;
  viewMode: PollingViewMode;
  municipalityId: string | null;
  municipalityName: string | null;
  thresholds: number[];
  /**
   * Faixas do AGREGADO MUNICIPAL (polígono do mapa e PNG). Iguais a
   * `thresholds` no índice e no percentual (escalas fixas); na medida da
   * candidata saem por quantil, porque cidade e local não cabem na mesma régua.
   */
  municipalityThresholds: number[];
  bandCounts: number[];
  /** todas as unidades do recorte, com e sem valor */
  units: PollingUnit[];
  /** unidades com valor, dentro das faixas em foco, já ordenadas */
  filteredUnits: PollingUnit[];
  bubbles: PollingBubble[];
  /** unidades com coordenada que ficaram fora do mapa pelo teto de bolhas */
  hiddenBubbleCount: number;
  /**
   * Unidades do recorte sem nenhum voto com nota, SEMPRE sobre o índice
   * ideológico. É o que o agente reporta; a interface usa `missingValueCount`.
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
