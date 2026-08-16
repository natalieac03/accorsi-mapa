import type { MunicipalityProfile } from "./electorate";

export type AnalysisMetricId =
  | "electorate"
  | "biometrics"
  | "disability"
  | "female"
  | "socialName"
  | "electorsPerZone"
  | "populationEstimate"
  | "censusPopulation"
  | "population16Plus"
  | "electoralPenetration"
  | "literacyRate15Plus"
  | "share16to24"
  | "share60Plus"
  | "populationDensity"
  | "gdpPerCapita"
  | "schoolAttendance"
  | "occupiedPopulation"
  | "formalAverageSalary"
  | "adequateSanitation"
  | "lowIncomePopulation";

export type AnalysisBand = 0 | 1 | 2 | 3 | 4;

export type AnalysisSortDirection = "desc" | "asc";

export type AnalysisState = {
  metricId: AnalysisMetricId;
  activeBands: AnalysisBand[];
  sortDirection: AnalysisSortDirection;
};

export type AnalysisMetricDefinition = {
  id: AnalysisMetricId;
  label: string;
  shortLabel: string;
  description: string;
  unit: string;
  source: "TSE" | "IBGE";
  sourceLabel: string;
  sourceUrl: string;
  referenceYear: number;
  sourceIndicatorId: string;
  valueFormat: "integer" | "decimal" | "currency" | "percent" | "rate";
};

export type AnalysisMunicipality = {
  municipality: MunicipalityProfile;
  value: number;
  band: AnalysisBand;
  rank: number;
};

export type AnalysisModel = {
  metric: AnalysisMetricDefinition;
  thresholds: number[];
  bandCounts: number[];
  allItems: AnalysisMunicipality[];
  filteredItems: AnalysisMunicipality[];
  missingMunicipalityCount: number;
  median: number;
  focusedMinimum: number;
  focusedMaximum: number;
  focusedElectorate: number;
  focusedElectoratePct: number;
};
