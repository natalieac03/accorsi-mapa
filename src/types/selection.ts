import type { AnalysisState } from "./analysis";
import type { MunicipalityProfile } from "./electorate";

export type TerritorialSelectionSummary = {
  municipalityCount: number;
  electorate: number;
  populationEstimate: number;
  /** Soma da população 16+ (Censo 2022) dos municípios com dado etário. */
  population16Plus: number;
  /** Σ eleitorado / Σ população 16+ dos municípios com dado; null sem cobertura. */
  electoralPenetrationPct: number | null;
  share16to24Pct: number | null;
  share60PlusPct: number | null;
  /** Municípios do recorte sem estrutura etária do Censo 2022. */
  missingAgeCount: number;
  /** Σ alfabetizadas 15+ / Σ população 15+ dos municípios com dado; null sem cobertura. */
  literacyRatePct: number | null;
  /** Municípios do recorte sem alfabetização do Censo 2022. */
  missingLiteracyCount: number;
  stateSharePct: number;
  biometricsPct: number;
  disabilityPct: number;
  femalePct: number;
  socialNamePerTenThousand: number;
  largestMunicipality: MunicipalityProfile | null;
};

export type SharedWorkspaceState = {
  analysisState: AnalysisState;
  selectionIds: string[];
};
