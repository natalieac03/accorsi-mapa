import type { AnalysisBand } from "../types/analysis";
import type { MunicipalityProfile } from "../types/electorate";
import type {
  CampaignRegistration,
  RegistrationCluster,
  RegistrationCreateInput,
  RegistrationFollowUpStatus,
  RegistrationMetricId,
  RegistrationModel,
  RegistrationSource,
  RegistrationState,
  RegistrationWindow,
} from "../types/registrations";
import {
  ALL_ANALYSIS_BANDS,
  calculateQuantileThresholds,
  getAnalysisBand,
  toggleAnalysisBand,
} from "./analysis.ts";
import { createCsv, formatCsvDecimal } from "./csv.ts";
import { formatDecimal, formatInteger } from "./electorate.ts";

export const REGISTRATION_SOURCES: RegistrationSource[] = [
  "field",
  "event",
  "digital",
  "referral",
];
export const REGISTRATION_STATUSES: RegistrationFollowUpStatus[] = [
  "pending",
  "contacted",
  "completed",
  "revoked",
];

export const REGISTRATION_SOURCE_LABELS: Record<RegistrationSource, string> = {
  field: "Campo",
  event: "Evento",
  digital: "Digital",
  referral: "Indicação",
};

export const REGISTRATION_STATUS_LABELS: Record<
  RegistrationFollowUpStatus,
  string
> = {
  pending: "Pendente",
  contacted: "Contatado",
  completed: "Concluído",
  revoked: "Consentimento revogado",
};

export const REGISTRATION_WINDOW_LABELS: Record<RegistrationWindow, string> = {
  "30": "Últimos 30 dias",
  "90": "Últimos 90 dias",
  all: "Todo o histórico",
};

export const REGISTRATION_METRICS: Array<{
  id: RegistrationMetricId;
  label: string;
  shortLabel: string;
  description: string;
}> = [
  {
    id: "total",
    label: "Cadastros no recorte",
    shortLabel: "Cadastros",
    description: "Quantidade de cadastros consentidos que atendem aos filtros.",
  },
  {
    id: "rate",
    label: "Cadastros por 10 mil eleitores",
    shortLabel: "Por 10 mil",
    description:
      "Cadastros no recorte a cada 10 mil pessoas do eleitorado municipal.",
  },
  {
    id: "recent",
    label: "Cadastros recentes",
    shortLabel: "Últimos 30 dias",
    description:
      "Cadastros do recorte criados nos 30 dias anteriores à data de referência.",
  },
];

const metricIds = new Set(REGISTRATION_METRICS.map((metric) => metric.id));
const sourceIds = new Set(REGISTRATION_SOURCES);
const statusIds = new Set(REGISTRATION_STATUSES);

export function getDefaultRegistrationState(): RegistrationState {
  return {
    metricId: "total",
    window: "all",
    municipalityId: null,
    neighborhood: null,
    cepPrefix: null,
    sources: [...REGISTRATION_SOURCES],
    statuses: ["pending", "contacted", "completed"],
    activeBands: [...ALL_ANALYSIS_BANDS],
    sortDirection: "desc",
  };
}

export function sanitizeRegistrationState(value: unknown): RegistrationState {
  const fallback = getDefaultRegistrationState();
  if (!value || typeof value !== "object") return fallback;
  const candidate = value as Record<string, unknown>;
  const metricId =
    typeof candidate.metricId === "string" &&
    metricIds.has(candidate.metricId as RegistrationMetricId)
      ? (candidate.metricId as RegistrationMetricId)
      : fallback.metricId;
  const window =
    candidate.window === "30" ||
    candidate.window === "90" ||
    candidate.window === "all"
      ? candidate.window
      : fallback.window;
  const municipalityId =
    typeof candidate.municipalityId === "string" && /^\d{7}$/.test(candidate.municipalityId)
      ? candidate.municipalityId
      : null;
  const neighborhood =
    municipalityId && typeof candidate.neighborhood === "string" && candidate.neighborhood.trim()
      ? candidate.neighborhood.trim().replace(/\s+/g, " ").slice(0, 160)
      : null;
  const cepPrefix =
    municipalityId && typeof candidate.cepPrefix === "string" && /^\d{5}$/.test(candidate.cepPrefix.trim())
      ? candidate.cepPrefix.trim()
      : null;
  const sources = Array.isArray(candidate.sources)
    ? Array.from(
        new Set(
          candidate.sources.filter(
            (source): source is RegistrationSource =>
              typeof source === "string" &&
              sourceIds.has(source as RegistrationSource),
          ),
        ),
      )
    : fallback.sources;
  const statuses = Array.isArray(candidate.statuses)
    ? Array.from(
        new Set(
          candidate.statuses.filter(
            (item): item is RegistrationFollowUpStatus =>
              typeof item === "string" &&
              statusIds.has(item as RegistrationFollowUpStatus),
          ),
        ),
      )
    : fallback.statuses;
  const activeBands = Array.isArray(candidate.activeBands)
    ? Array.from(
        new Set(
          candidate.activeBands.filter(
            (band): band is AnalysisBand =>
              typeof band === "number" && Number.isInteger(band) && band >= 0 && band <= 4,
          ),
        ),
      ).sort((a, b) => a - b)
    : fallback.activeBands;

  return {
    metricId,
    window,
    municipalityId,
    neighborhood,
    cepPrefix,
    sources: sources.length > 0 ? sources : fallback.sources,
    statuses: statuses.length > 0 ? statuses : fallback.statuses,
    activeBands: activeBands.length > 0 ? activeBands : fallback.activeBands,
    sortDirection: candidate.sortDirection === "asc" ? "asc" : "desc",
  };
}

export function toggleRegistrationBand(
  activeBands: AnalysisBand[],
  band: AnalysisBand,
) {
  return toggleAnalysisBand(activeBands, band);
}

function endOfReferenceDay(referenceDate: string) {
  // No timezone suffix: the cutoff is the end of the LOCAL day, so a record
  // created at 21h in Brasília still belongs to the current day (the old
  // "T23:59:59.999Z" cutoff ended the day at 20:59 local time).
  const date = new Date(`${referenceDate}T23:59:59.999`);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function endOfLocalDay(date: Date) {
  const copy = new Date(date);
  copy.setHours(23, 59, 59, 999);
  return copy;
}

function resolveReferenceDay(
  referenceDate: string,
  records: CampaignRegistration[],
) {
  // The effective reference is the latest of the snapshot reference date and
  // the newest record present in the data. Without this, a record created
  // after the snapshot reference (e.g. added through the form today) would
  // get a negative age and silently disappear from every count.
  let reference = endOfReferenceDay(referenceDate);
  for (const record of records) {
    const createdAt = new Date(record.createdAt);
    if (Number.isNaN(createdAt.getTime())) continue;
    if (createdAt.getTime() > reference.getTime()) {
      reference = endOfLocalDay(createdAt);
    }
  }
  return reference;
}

function ageInDays(createdAt: string, referenceDate: Date) {
  return Math.floor(
    (referenceDate.getTime() - new Date(createdAt).getTime()) / 86_400_000,
  );
}

function metricValue(
  metricId: RegistrationMetricId,
  total: number,
  recent: number,
  electorate: number,
) {
  if (metricId === "recent") return recent;
  if (metricId === "rate") return electorate > 0 ? (total / electorate) * 10_000 : 0;
  return total;
}

export function normalizeNeighborhoodKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .trim()
    .replace(/\s+/g, " ");
}

function mostFrequentSpelling(values: string[]) {
  const counts = new Map<string, number>();
  let best = values[0];
  let bestCount = 0;
  for (const value of values) {
    const count = (counts.get(value) ?? 0) + 1;
    counts.set(value, count);
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

function buildClusters(
  records: CampaignRegistration[],
  privacyThreshold: number,
) {
  const groups = new Map<string, CampaignRegistration[]>();
  for (const record of records) {
    if (record.latitude === null || record.longitude === null) continue;
    const key = [
      record.municipalityId,
      normalizeNeighborhoodKey(record.neighborhood),
      record.cepPrefix,
    ].join(":");
    const group = groups.get(key) ?? [];
    group.push(record);
    groups.set(key, group);
  }

  let suppressedClusterCount = 0;
  const clusters: RegistrationCluster[] = [];
  for (const [id, group] of groups) {
    if (group.length < privacyThreshold) {
      suppressedClusterCount += 1;
      continue;
    }
    const first = group[0];
    clusters.push({
      id,
      municipalityId: first.municipalityId,
      municipalityName: first.municipalityName,
      neighborhoodKey: normalizeNeighborhoodKey(first.neighborhood),
      neighborhood: mostFrequentSpelling(
        group.map((record) => record.neighborhood),
      ),
      cepPrefix: first.cepPrefix,
      latitude: Number(
        (
          group.reduce((sum, record) => sum + (record.latitude ?? 0), 0) /
          group.length
        ).toFixed(3),
      ),
      longitude: Number(
        (
          group.reduce((sum, record) => sum + (record.longitude ?? 0), 0) /
          group.length
        ).toFixed(3),
      ),
      count: group.length,
    });
  }
  return { clusters, suppressedClusterCount };
}

export function buildRegistrationModel(
  records: CampaignRegistration[],
  municipalities: MunicipalityProfile[],
  state: RegistrationState,
  referenceDate: string,
  privacyThreshold: number,
): RegistrationModel {
  const reference = resolveReferenceDay(referenceDate, records);
  const sourceSet = new Set(state.sources);
  const statusSet = new Set(state.statuses);
  const maximumAge = state.window === "all" ? Infinity : Number(state.window);
  const baseFilteredRecords = records.filter((record) => {
    const age = ageInDays(record.createdAt, reference);
    return (
      age >= 0 &&
      age <= maximumAge &&
      sourceSet.has(record.source) &&
      statusSet.has(record.followUpStatus)
    );
  });
  const availableMunicipalityGroups = new Map<string, CampaignRegistration[]>();
  for (const record of baseFilteredRecords) {
    const group = availableMunicipalityGroups.get(record.municipalityId) ?? [];
    group.push(record);
    availableMunicipalityGroups.set(record.municipalityId, group);
  }
  const availableMunicipalities = Array.from(availableMunicipalityGroups.entries())
    .map(([municipalityId, group]) => ({
      municipalityId,
      municipalityName: group[0].municipalityName,
      count: group.length,
    }))
    .sort((a, b) => a.municipalityName.localeCompare(b.municipalityName, "pt-BR"));
  const availableClusterResult = buildClusters(
    baseFilteredRecords.filter((record) => record.followUpStatus !== "revoked"),
    privacyThreshold,
  );
  // The geography filter derives from the RECORDS with normalized comparison,
  // never from the cluster list (which is truncated for privacy and only
  // feeds the map bubbles). A selection that matches nothing yields an empty
  // list — an explicit state the UI reports — instead of silently showing
  // every record of the municipality.
  const neighborhoodKey = state.neighborhood
    ? normalizeNeighborhoodKey(state.neighborhood)
    : null;
  const filteredRecords = baseFilteredRecords.filter(
    (record) =>
      (!state.municipalityId || record.municipalityId === state.municipalityId) &&
      (!neighborhoodKey ||
        normalizeNeighborhoodKey(record.neighborhood) === neighborhoodKey) &&
      (!state.cepPrefix || record.cepPrefix === state.cepPrefix),
  );
  const byMunicipality = new Map<string, CampaignRegistration[]>();
  for (const record of filteredRecords) {
    const group = byMunicipality.get(record.municipalityId) ?? [];
    group.push(record);
    byMunicipality.set(record.municipalityId, group);
  }

  const rawItems = municipalities.map((municipality) => {
    const municipalityRecords = byMunicipality.get(municipality.ibgeCode) ?? [];
    const total = municipalityRecords.length;
    const recent = municipalityRecords.filter(
      (record) => ageInDays(record.createdAt, reference) <= 30,
    ).length;
    const pending = municipalityRecords.filter(
      (record) => record.followUpStatus === "pending",
    ).length;
    const rate = municipality.electorate
      ? (total / municipality.electorate) * 10_000
      : 0;
    return {
      municipality,
      total,
      recent,
      rate,
      pending,
      value: metricValue(state.metricId, total, recent, municipality.electorate),
    };
  });
  const positiveValues = rawItems.map((item) => item.value).filter((value) => value > 0);
  const thresholds = calculateQuantileThresholds(positiveValues);
  const rankedPositive = rawItems
    .filter((item) => item.value > 0)
    .slice()
    .sort(
      (a, b) =>
        b.value - a.value ||
        a.municipality.name.localeCompare(b.municipality.name, "pt-BR"),
    );
  const rankById = new Map(
    rankedPositive.map((item, index) => [item.municipality.ibgeCode, index + 1]),
  );
  const allItems = rawItems.map((item) => ({
    ...item,
    band: item.value > 0 ? getAnalysisBand(item.value, thresholds) : null,
    rank: rankById.get(item.municipality.ibgeCode) ?? 0,
  }));
  const activeBandSet = new Set(state.activeBands);
  const filteredItems = allItems
    .filter(
      (item) => item.band !== null && activeBandSet.has(item.band),
    )
    .sort((a, b) => {
      const order =
        state.sortDirection === "desc" ? b.value - a.value : a.value - b.value;
      return order || a.municipality.name.localeCompare(b.municipality.name, "pt-BR");
    });
  const { clusters, suppressedClusterCount } = buildClusters(
    filteredRecords.filter((record) => record.followUpStatus !== "revoked"),
    privacyThreshold,
  );
  const metric =
    REGISTRATION_METRICS.find((item) => item.id === state.metricId) ??
    REGISTRATION_METRICS[0];

  return {
    metricId: state.metricId,
    metricLabel: metric.label,
    metricShortLabel: metric.shortLabel,
    metricDescription: metric.description,
    referenceDate,
    privacyThreshold,
    filteredRecordCount: filteredRecords.length,
    validRecordCount: filteredRecords.filter(
      (record) => record.followUpStatus !== "revoked",
    ).length,
    recentRecordCount: filteredRecords.filter(
      (record) =>
        record.followUpStatus !== "revoked" &&
        ageInDays(record.createdAt, reference) <= 30,
    ).length,
    pendingRecordCount: filteredRecords.filter(
      (record) => record.followUpStatus === "pending",
    ).length,
    coveredMunicipalityCount: allItems.filter((item) => item.total > 0).length,
    suppressedClusterCount,
    availableMunicipalities,
    availableClusters: availableClusterResult.clusters,
    thresholds,
    bandCounts: ALL_ANALYSIS_BANDS.map(
      (band) => allItems.filter((item) => item.band === band).length,
    ),
    allItems,
    filteredItems,
    clusters,
  };
}

export function formatRegistrationMetricValue(
  metricId: RegistrationMetricId,
  value: number,
) {
  return metricId === "rate"
    ? `${formatDecimal(value)} / 10 mil`
    : formatInteger(Math.round(value));
}

export function getRegistrationRangeLabel(
  metricId: RegistrationMetricId,
  thresholds: number[],
  band: AnalysisBand,
) {
  const format = (value: number) => formatRegistrationMetricValue(metricId, value);
  if (band === 0) return `Até ${format(thresholds[0] ?? 0)}`;
  if (band === 4) return `Acima de ${format(thresholds[3] ?? 0)}`;
  return `> ${format(thresholds[band - 1] ?? 0)} até ${format(thresholds[band] ?? 0)}`;
}

export function createRegistrationAggregateCsv(
  model: RegistrationModel,
  state: RegistrationState,
) {
  const headers = [
    "data_referencia",
    "codigo_ibge",
    "municipio",
    "metrica",
    "valor",
    "cadastros_no_recorte",
    "cadastros_ultimos_30_dias",
    "acompanhamentos_pendentes",
    "cadastros_por_10_mil_eleitores",
    "faixa_quintil",
    "posicao_rs",
    "janela",
    "fontes",
    "status",
  ];
  const rows = model.filteredItems.map((item) => [
    model.referenceDate,
    item.municipality.ibgeCode,
    item.municipality.name,
    model.metricLabel,
    formatCsvDecimal(item.value),
    item.total,
    item.recent,
    item.pending,
    formatCsvDecimal(item.rate),
    item.band === null ? "" : item.band + 1,
    item.rank,
    REGISTRATION_WINDOW_LABELS[state.window],
    state.sources.map((source) => REGISTRATION_SOURCE_LABELS[source]).join(" | "),
    state.statuses.map((status) => REGISTRATION_STATUS_LABELS[status]).join(" | "),
  ]);
  return createCsv(headers, rows);
}

export function createRegistrationImportTemplateCsv() {
  return createCsv(
    [
      "referencia_externa_opcional",
      "cep",
      "codigo_ibge",
      "municipio",
      "bairro",
      "latitude_opcional",
      "longitude_opcional",
      "fonte",
      "acompanhamento",
      "consentimento_em",
      "canal_consentimento",
      "versao_consentimento",
      "retencao_ate",
    ],
    [
      [
        "CRM-0001",
        "90010-000",
        "4314902",
        "Porto Alegre",
        "Centro Histórico",
        "-30,030",
        "-51,230",
        "field",
        "pending",
        "2026-08-14T12:00:00Z",
        "ficha_de_campo",
        "v1",
        "2027-08-14",
      ],
    ],
  );
}

function parseDelimitedLine(line: string) {
  const cells: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === ";" && !quoted) {
      cells.push(value.trim());
      value = "";
    } else {
      value += character;
    }
  }
  cells.push(value.trim());
  return cells;
}

function parseOptionalCoordinate(value: string) {
  if (!value) return null;
  // Files exported by older versions of the model carry the CSV-injection
  // apostrophe before negative coordinates; accept them defensively.
  const cleaned = value.replace(/^'/, "").replace(",", ".");
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseRegistrationImportCsv(content: string) {
  const lines = content
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim());
  if (lines.length < 2) throw new Error("O CSV não possui linhas de cadastro.");
  const headers = parseDelimitedLine(lines[0]);
  const required = [
    "cep",
    "codigo_ibge",
    "municipio",
    "bairro",
    "fonte",
    "acompanhamento",
    "consentimento_em",
    "canal_consentimento",
    "versao_consentimento",
    "retencao_ate",
  ];
  for (const header of required) {
    if (!headers.includes(header)) throw new Error(`Coluna obrigatória ausente: ${header}.`);
  }
  const index = (name: string) => headers.indexOf(name);
  return lines.slice(1).map((line, rowIndex): RegistrationCreateInput => {
    const values = parseDelimitedLine(line);
    const source = values[index("fonte")] as RegistrationSource;
    const followUpStatus = values[index("acompanhamento")] as Exclude<
      RegistrationFollowUpStatus,
      "revoked"
    >;
    const cep = (values[index("cep")] ?? "").replace(/\D/g, "");
    const municipalityId = values[index("codigo_ibge")] ?? "";
    if (!/^9\d{7}$/.test(cep) || !/^\d{7}$/.test(municipalityId)) {
      throw new Error(`Linha ${rowIndex + 2}: CEP ou código IBGE inválido.`);
    }
    if (!REGISTRATION_SOURCES.includes(source)) {
      throw new Error(`Linha ${rowIndex + 2}: fonte inválida.`);
    }
    if (!["pending", "contacted", "completed"].includes(followUpStatus)) {
      throw new Error(`Linha ${rowIndex + 2}: acompanhamento inválido.`);
    }
    const latitude = parseOptionalCoordinate(values[index("latitude_opcional")] ?? "");
    const longitude = parseOptionalCoordinate(values[index("longitude_opcional")] ?? "");
    return {
      externalReference: values[index("referencia_externa_opcional")] || undefined,
      cep,
      municipalityId,
      municipalityName: values[index("municipio")] ?? "",
      neighborhood: values[index("bairro")] ?? "",
      latitude,
      longitude,
      geocodePrecision:
        latitude !== null && longitude !== null ? "cep_centroid" : "municipality",
      source,
      followUpStatus,
      consentAt: values[index("consentimento_em")] ?? "",
      consentChannel: values[index("canal_consentimento")] ?? "",
      consentVersion: values[index("versao_consentimento")] ?? "",
      retentionUntil: values[index("retencao_ate")] ?? "",
    };
  });
}

export function toLocalRegistration(
  input: RegistrationCreateInput,
  id: string,
): CampaignRegistration {
  const now = new Date().toISOString();
  return {
    id,
    municipalityId: input.municipalityId,
    municipalityName: input.municipalityName,
    cepPrefix: input.cep.replace(/\D/g, "").slice(0, 5),
    neighborhood: input.neighborhood || "Bairro não informado",
    latitude:
      input.latitude === null || input.latitude === undefined
        ? null
        : Number(input.latitude.toFixed(3)),
    longitude:
      input.longitude === null || input.longitude === undefined
        ? null
        : Number(input.longitude.toFixed(3)),
    geocodePrecision: input.geocodePrecision,
    source: input.source,
    followUpStatus: input.followUpStatus,
    consentAt: input.consentAt,
    consentChannel: input.consentChannel,
    consentVersion: input.consentVersion,
    retentionUntil: input.retentionUntil,
    createdAt: now,
    revokedAt: null,
  };
}
