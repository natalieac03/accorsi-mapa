import type { AnalysisBand, AnalysisSortDirection } from "./analysis";
import type { MunicipalityProfile } from "./electorate";

export type RegistrationSource = "field" | "event" | "digital" | "referral";
export type RegistrationFollowUpStatus =
  | "pending"
  | "contacted"
  | "completed"
  | "revoked";
export type RegistrationMetricId = "total" | "rate" | "recent";
export type RegistrationWindow = "30" | "90" | "all";
export type RegistrationDataMode = "synthetic-demo" | "api";

export type CampaignRegistration = {
  id: string;
  municipalityId: string;
  municipalityName: string;
  cepPrefix: string;
  neighborhood: string;
  latitude: number | null;
  longitude: number | null;
  geocodePrecision: "cep_centroid" | "neighborhood" | "municipality";
  source: RegistrationSource;
  followUpStatus: RegistrationFollowUpStatus;
  consentAt: string;
  consentChannel: string;
  consentVersion: string;
  retentionUntil: string;
  createdAt: string;
  revokedAt: string | null;
};

export type CampaignRegistrationDataset = {
  metadata: {
    mode: "synthetic-demo";
    state: "GO";
    referenceDate: string;
    privacyThreshold: number;
    recordCount: number;
    municipalityCount: number;
    generatedAt: string;
    warning: string;
  };
  records: CampaignRegistration[];
};

export type RegistrationState = {
  metricId: RegistrationMetricId;
  window: RegistrationWindow;
  municipalityId: string | null;
  neighborhood: string | null;
  cepPrefix: string | null;
  sources: RegistrationSource[];
  statuses: RegistrationFollowUpStatus[];
  activeBands: AnalysisBand[];
  sortDirection: AnalysisSortDirection;
};

export type RegistrationMunicipalityItem = {
  municipality: MunicipalityProfile;
  total: number;
  recent: number;
  rate: number;
  pending: number;
  value: number;
  band: AnalysisBand | null;
  rank: number;
};

export type RegistrationCluster = {
  id: string;
  municipalityId: string;
  municipalityName: string;
  /** Normalized key (no diacritics, lower case, collapsed spaces). */
  neighborhoodKey: string;
  /** Display name: the most frequent spelling within the group. */
  neighborhood: string;
  cepPrefix: string;
  latitude: number;
  longitude: number;
  count: number;
};

export type RegistrationModel = {
  metricId: RegistrationMetricId;
  metricLabel: string;
  metricShortLabel: string;
  metricDescription: string;
  referenceDate: string;
  privacyThreshold: number;
  filteredRecordCount: number;
  validRecordCount: number;
  recentRecordCount: number;
  pendingRecordCount: number;
  coveredMunicipalityCount: number;
  suppressedClusterCount: number;
  availableMunicipalities: Array<{
    municipalityId: string;
    municipalityName: string;
    count: number;
  }>;
  availableClusters: RegistrationCluster[];
  thresholds: number[];
  bandCounts: number[];
  allItems: RegistrationMunicipalityItem[];
  filteredItems: RegistrationMunicipalityItem[];
  clusters: RegistrationCluster[];
};

export type RegistrationCreateInput = {
  externalReference?: string;
  municipalityId: string;
  municipalityName: string;
  cep: string;
  neighborhood: string;
  latitude?: number | null;
  longitude?: number | null;
  geocodePrecision: CampaignRegistration["geocodePrecision"];
  source: RegistrationSource;
  followUpStatus: Exclude<RegistrationFollowUpStatus, "revoked">;
  consentAt: string;
  consentChannel: string;
  consentVersion: string;
  retentionUntil: string;
};

export type RegistrationApiList = {
  items: Array<{
    id: string;
    municipality_ibge_code: string;
    municipality_name: string;
    cep_prefix: string;
    neighborhood: string;
    latitude: number | null;
    longitude: number | null;
    geocode_precision: CampaignRegistration["geocodePrecision"];
    source: RegistrationSource;
    follow_up_status: RegistrationFollowUpStatus;
    consent_at: string;
    consent_channel: string;
    consent_version: string;
    retention_until: string;
    created_at: string;
    revoked_at: string | null;
  }>;
  total: number;
  offset: number;
  limit: number;
};
