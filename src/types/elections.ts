import type { AnalysisBand, AnalysisSortDirection } from "./analysis";
import type { MunicipalityProfile } from "./electorate";

export type ElectionMetadata = {
  state: "GO";
  /** "pendente" no placeholder inicial, ausente depois de gerar os dados. */
  status?: string;
  years: number[];
  offices: string[];
  rounds: number[];
  source: string;
  dataset: string;
  sourceUrl: string;
  processedAtUtc: string;
  municipalityCount: number;
  contestCount: number;
  municipalResultCount: number;
  sourceRows: number;
  selectedRows: number;
  privacyLevel: string;
  inputFiles: Record<string, { name: string; sha256: string }>;
};

export type ElectionCandidate = {
  id: string;
  number: string;
  ballotName: string;
  fullName: string;
  party: string;
  partyName: string;
  registrationStatus: string;
  resultStatus: string;
  stateVotes: number;
  stateSharePct: number;
  stateRank: number;
  municipalitiesWon: number;
};

export type MunicipalityElectionResult = {
  validVotes: number;
  winnerCandidateId: string;
  votes: Record<string, number>;
};

export type ElectionContest = {
  id: string;
  electionYear: number;
  round: number;
  officeCode: number;
  officeName: string;
  electionDate: string;
  generatedAt: string;
  stateValidVotes: number;
  municipalityCount: number;
  candidates: ElectionCandidate[];
  municipalities: Record<string, MunicipalityElectionResult>;
};

export type ElectionDataset = {
  metadata: ElectionMetadata;
  contests: ElectionContest[];
};

export type ElectionMetricId = "share" | "votes" | "swing";

/**
 * Estado da camada de eleições. Com o snapshot ainda pendente (nenhum pleito)
 * os identificadores ficam VAZIOS, nunca apontando para um pleito inventado.
 */
export type ElectionState = {
  contestId: string;
  candidateId: string;
  metricId: ElectionMetricId;
  comparisonContestId: string;
  comparisonCandidateId: string | null;
  activeBands: AnalysisBand[];
  sortDirection: AnalysisSortDirection;
};

export type ElectionMunicipalityItem = {
  municipality: MunicipalityProfile;
  votes: number;
  validVotes: number;
  sharePct: number;
  comparisonVotes: number;
  comparisonValidVotes: number;
  comparisonSharePct: number;
  value: number;
  band: AnalysisBand;
  rank: number;
  winner: boolean;
};

export type ElectionModel = {
  contest: ElectionContest;
  candidate: ElectionCandidate;
  comparisonContest: ElectionContest;
  /** Null quando o pleito comparado não tem candidatura equivalente. */
  comparisonCandidate: ElectionCandidate | null;
  /** Métrica efetiva: cai em "share" quando o swing não está disponível. */
  metricId: ElectionMetricId;
  metricLabel: string;
  metricShortLabel: string;
  thresholds: number[];
  bandCounts: number[];
  allItems: ElectionMunicipalityItem[];
  filteredItems: ElectionMunicipalityItem[];
  focusedMinimum: number;
  focusedMaximum: number;
  stateValue: number;
  stateSharePct: number;
  comparisonStateSharePct: number;
  stateVotes: number;
  municipalitiesWon: number;
  bestMunicipality: ElectionMunicipalityItem;
};
