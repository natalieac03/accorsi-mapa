import type { MunicipalityAgeStructure } from "./ageStructure";
import type { MunicipalityLiteracy } from "./literacy";
import type {
  MunicipalitySocioeconomicValues,
  SocioeconomicMetadata,
} from "./socioeconomic";

export type GenderCounts = {
  female: number;
  male: number;
  notInformed: number;
};

export type AgeGroupSummary = {
  label: string;
  electorate: number;
  percentage: number;
};

export type MunicipalityElectorate = {
  ibgeCode: string;
  tseCode: string;
  name: string;
  electorate: number;
  stateSharePct: number;
  stateRank: number;
  zoneCount: number;
  biometrics: number;
  biometricsPct: number;
  registeredDisability: number;
  socialName: number;
  topAgeGroup: AgeGroupSummary;
  gender: GenderCounts;
};

export type MunicipalityProfile = MunicipalityElectorate & {
  socioeconomic: MunicipalitySocioeconomicValues;
  /** Estrutura etária do Censo 2022; null enquanto o município não tem dado. */
  age: MunicipalityAgeStructure | null;
  /** Alfabetização 15+ do Censo 2022; null enquanto o município não tem dado. */
  literacy: MunicipalityLiteracy | null;
};

export type ElectorateMetadata = {
  state: string;
  year: number;
  source: string;
  dataset: string;
  profileGeneratedAt: string;
  mappingGeneratedAt: string;
  processedAtUtc: string;
  processedRows: number;
  municipalityCount: number;
  stateElectorate: number;
  electorateThresholds: number[];
  inputFiles: Record<
    string,
    {
      name: string;
      sha256: string;
    }
  >;
};

export type ElectorateDataset = {
  metadata: ElectorateMetadata;
  municipalities: Record<string, MunicipalityElectorate>;
};

export type TerritorialDataset = Omit<ElectorateDataset, "municipalities"> & {
  socioeconomicMetadata: SocioeconomicMetadata;
  municipalities: Record<string, MunicipalityProfile>;
};

export type MunicipalitySelection = {
  id: string;
  name: string;
  metrics: MunicipalityProfile | null;
};
