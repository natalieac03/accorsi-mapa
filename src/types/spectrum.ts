import type { AnalysisBand, AnalysisSortDirection } from "./analysis";
import type { MunicipalityProfile } from "./electorate";

export type SpectrumBlock = "left" | "center" | "right";

export type SpectrumWaveYear = number;

export type PartySpectrumWave = {
  year: SpectrumWaveYear;
  respondents: number;
  institution: string;
  citation: string;
  doi: string;
  url: string;
};

export type PartySpectrumEntry = {
  code: string;
  name: string;
  tseNumbers: number[];
  aliases: string[];
  scores: Record<string, number | null>;
  derivedFrom?: Record<string, string[]>;
  absorbed?: string[];
  mergedInto?: string;
  mergedYear?: number;
  note?: string;
};

export type PartySpectrumRegistry = {
  metadata: {
    schemaVersion: number;
    title: string;
    description: string;
    scale: {
      minimum: number;
      maximum: number;
      minimumLabel: string;
      maximumLabel: string;
    };
    blockThresholds: {
      leftMaximum: number;
      rightMinimum: number;
      rationale: string;
    };
    waveByElectionYear: Record<string, number>;
    waves: PartySpectrumWave[];
    limitations: string[];
  };
  parties: PartySpectrumEntry[];
};

/** Nota de um partido já resolvida para uma onda específica do survey. */
export type ResolvedPartyScore = {
  code: string;
  name: string;
  score: number;
  block: SpectrumBlock;
  derived: boolean;
};

/**
 * Pleito normalizado que o índice sabe ler, venha ele do snapshot de
 * candidaturas (2018/2022) ou do snapshot de votos por partido (2020/2024).
 */
export type SpectrumSourceContest = {
  id: string;
  electionYear: number;
  round: number;
  officeCode: number;
  officeName: string;
  origin: "candidates" | "parties";
  waveYear: SpectrumWaveYear;
  stateTotalVotes: number;
  /** votos por município e por sigla, já agregados por partido */
  municipalities: Record<string, Record<string, number>>;
};

export type SpectrumMetricId =
  | "index"
  | "shift"
  | "left"
  | "center"
  | "right"
  | "coverage";

export type SpectrumBandMode = "absolute" | "quantile";

export type SpectrumState = {
  contestId: string;
  metricId: SpectrumMetricId;
  /**
   * Pleito usado como base do deslocamento do índice. Nunca aponta para o
   * próprio pleito analisado; `null` desliga a comparação.
   */
  comparisonContestId: string | null;
  bandMode: SpectrumBandMode;
  activeBands: AnalysisBand[];
  sortDirection: AnalysisSortDirection;
};

export type SpectrumMunicipalityItem = {
  municipality: MunicipalityProfile;
  /** null quando nenhum voto do município caiu em partido com nota */
  index: number | null;
  totalVotes: number;
  scoredVotes: number;
  unscoredVotes: number;
  coveragePct: number;
  blockVotes: Record<SpectrumBlock, number>;
  blockSharePct: Record<SpectrumBlock, number>;
  leadingPartyCode: string;
  leadingPartyVotes: number;
  /** índice 0–10 do município no pleito de comparação; null sem comparação ou sem índice lá */
  comparisonIndex: number | null;
  /**
   * Deslocamento em pontos da escala 0–10 (índice atual − índice comparado).
   * Positivo = moveu para a direita. Null quando falta índice em qualquer um
   * dos dois pleitos — nunca convertido em zero.
   */
  shift: number | null;
  value: number | null;
  band: AnalysisBand;
  rank: number;
};

export type SpectrumUnscoredParty = {
  code: string;
  votes: number;
  stateSharePct: number;
};

export type SpectrumModel = {
  contest: SpectrumSourceContest;
  wave: PartySpectrumWave;
  /** pleito base do deslocamento; null quando a comparação está desligada */
  comparisonContest: SpectrumSourceContest | null;
  comparisonWave: PartySpectrumWave | null;
  metricId: SpectrumMetricId;
  metricLabel: string;
  metricShortLabel: string;
  bandMode: SpectrumBandMode;
  thresholds: number[];
  bandCounts: number[];
  allItems: SpectrumMunicipalityItem[];
  filteredItems: SpectrumMunicipalityItem[];
  missingMunicipalityCount: number;
  focusedMinimum: number;
  focusedMaximum: number;
  stateIndex: number | null;
  /** índice de Goiás no pleito de comparação; null sem comparação */
  stateComparisonIndex: number | null;
  /** deslocamento do índice estadual (atual − comparado); null sem comparação */
  stateShift: number | null;
  stateBlockSharePct: Record<SpectrumBlock, number>;
  stateCoveragePct: number;
  stateTotalVotes: number;
  stateScoredVotes: number;
  unscoredParties: SpectrumUnscoredParty[];
  weightedByElectorate: boolean;
};
