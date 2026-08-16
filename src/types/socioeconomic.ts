export type SocioeconomicIndicatorId =
  | "populationEstimate"
  | "censusPopulation"
  | "populationDensity"
  | "gdpPerCapita"
  | "schoolAttendance"
  | "occupiedPopulation"
  | "formalAverageSalary"
  | "adequateSanitation"
  | "lowIncomePopulation";

export type SocioeconomicValueFormat =
  | "integer"
  | "decimal"
  | "currency"
  | "percent";

export type SocioeconomicIndicatorDefinition = {
  code: SocioeconomicIndicatorId;
  ibgeIndicatorId: number;
  label: string;
  shortLabel: string;
  description: string;
  referenceYear: number;
  unit: string;
  valueFormat: SocioeconomicValueFormat;
  requiredCoverage: boolean;
  coverageCount: number;
  missingMunicipalityCodes: string[];
};

export type MunicipalitySocioeconomicValues = Record<
  SocioeconomicIndicatorId,
  number | null
>;

export type MunicipalitySocioeconomic = {
  ibgeCode: string;
  name: string;
  values: MunicipalitySocioeconomicValues;
};

export type SocioeconomicMetadata = {
  state: string;
  municipalityCount: number;
  source: string;
  sourceUrl: string;
  apiVersion: string;
  retrievedAtUtc: string;
  indicatorCount: number;
  indicators: SocioeconomicIndicatorDefinition[];
};

export type SocioeconomicDataset = {
  metadata: SocioeconomicMetadata;
  municipalities: Record<string, MunicipalitySocioeconomic>;
};
