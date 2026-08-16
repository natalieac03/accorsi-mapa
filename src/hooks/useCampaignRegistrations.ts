import { useCallback, useEffect, useMemo, useState } from "react";
import demoJson from "../data/campaign-registrations-demo.json";
import { apiRequest } from "../auth/api";
import type {
  CampaignRegistration,
  CampaignRegistrationDataset,
  RegistrationApiList,
  RegistrationCreateInput,
  RegistrationDataMode,
} from "../types/registrations";
import { toLocalRegistration } from "../utils/registrations";

const demoDataset = demoJson as unknown as CampaignRegistrationDataset;
const STORAGE_KEY = "acqr:campaign-registrations:demo:v1";
const configuredMode: RegistrationDataMode =
  import.meta.env.VITE_REGISTRATIONS_MODE === "api" ? "api" : "synthetic-demo";

function readLocalRecords() {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? (parsed as CampaignRegistration[]) : [];
  } catch {
    return [];
  }
}

function writeLocalRecords(records: CampaignRegistration[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch {
    // O modo demonstrativo continua com os dados da sessão atual.
  }
}

function fromApi(item: RegistrationApiList["items"][number]): CampaignRegistration {
  return {
    id: item.id,
    municipalityId: item.municipality_ibge_code,
    municipalityName: item.municipality_name,
    cepPrefix: item.cep_prefix,
    neighborhood: item.neighborhood,
    latitude: item.latitude,
    longitude: item.longitude,
    geocodePrecision: item.geocode_precision,
    source: item.source,
    followUpStatus: item.follow_up_status,
    consentAt: item.consent_at,
    consentChannel: item.consent_channel,
    consentVersion: item.consent_version,
    retentionUntil: item.retention_until,
    createdAt: item.created_at,
    revokedAt: item.revoked_at,
  };
}

function toApi(input: RegistrationCreateInput) {
  return {
    external_reference: input.externalReference || null,
    municipality_ibge_code: input.municipalityId,
    cep: input.cep,
    neighborhood: input.neighborhood,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    geocode_precision: input.geocodePrecision,
    source: input.source,
    follow_up_status: input.followUpStatus,
    consent_at: input.consentAt,
    consent_channel: input.consentChannel,
    consent_version: input.consentVersion,
    retention_until: input.retentionUntil,
  };
}

function newLocalId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? `local-${crypto.randomUUID()}`
    : `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function useCampaignRegistrations() {
  const [localRecords, setLocalRecords] = useState<CampaignRegistration[]>(readLocalRecords);
  const [apiRecords, setApiRecords] = useState<CampaignRegistration[]>([]);
  const [loading, setLoading] = useState(configuredMode === "api");
  const [error, setError] = useState<string | null>(null);

  const loadApiRecords = useCallback(async () => {
    if (configuredMode !== "api") return;
    setLoading(true);
    setError(null);
    try {
      const loaded: CampaignRegistration[] = [];
      let offset = 0;
      let total = 0;
      do {
        const response = await apiRequest<RegistrationApiList>(
          `/registrations?offset=${offset}&limit=1000&include_revoked=true`,
        );
        loaded.push(...response.items.map(fromApi));
        total = response.total;
        offset += response.items.length;
        if (response.items.length === 0) break;
      } while (offset < total);
      setApiRecords(loaded);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Não foi possível carregar os cadastros.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadApiRecords();
  }, [loadApiRecords]);

  useEffect(() => {
    if (configuredMode === "synthetic-demo") writeLocalRecords(localRecords);
  }, [localRecords]);

  const records = useMemo(
    () =>
      configuredMode === "api"
        ? apiRecords
        : [...demoDataset.records, ...localRecords],
    [apiRecords, localRecords],
  );

  const addRegistration = useCallback(async (input: RegistrationCreateInput) => {
    setError(null);
    if (configuredMode === "api") {
      const created = await apiRequest<RegistrationApiList["items"][number]>(
        "/registrations",
        { method: "POST", body: JSON.stringify(toApi(input)) },
      );
      setApiRecords((current) => [fromApi(created), ...current]);
      return fromApi(created);
    }
    const created = toLocalRegistration(input, newLocalId());
    setLocalRecords((current) => [created, ...current]);
    return created;
  }, []);

  const importRegistrations = useCallback(
    async (inputs: RegistrationCreateInput[]) => {
      setError(null);
      if (configuredMode === "api") {
        const response = await apiRequest<{
          imported_count: number;
          items: RegistrationApiList["items"];
        }>("/registrations/import", {
          method: "POST",
          body: JSON.stringify({ items: inputs.map(toApi) }),
        });
        setApiRecords((current) => [
          ...response.items.map(fromApi),
          ...current,
        ]);
        return response.imported_count;
      }
      const created = inputs.map((input) =>
        toLocalRegistration(input, newLocalId()),
      );
      setLocalRecords((current) => [...created, ...current]);
      return created.length;
    },
    [],
  );

  const clearLocalAdditions = useCallback(() => setLocalRecords([]), []);

  return {
    mode: configuredMode,
    records,
    loading,
    error,
    referenceDate:
      configuredMode === "synthetic-demo"
        ? demoDataset.metadata.referenceDate
        : new Date().toISOString().slice(0, 10),
    privacyThreshold: demoDataset.metadata.privacyThreshold,
    syntheticRecordCount: demoDataset.records.length,
    localRecordCount: localRecords.length,
    addRegistration,
    importRegistrations,
    clearLocalAdditions,
    reload: loadApiRecords,
  };
}
