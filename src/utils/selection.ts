import type { MunicipalityAgeStructure } from "../types/ageStructure";
import type { MunicipalityLiteracy } from "../types/literacy";
import type { AnalysisState } from "../types/analysis";
import type { MunicipalityProfile } from "../types/electorate";
import type {
  SharedWorkspaceState,
  TerritorialSelectionSummary,
} from "../types/selection";
import { getAnalysisMetricValue, sanitizeAnalysisState } from "./analysis.ts";
import { createCsv, formatCsvDecimal } from "./csv.ts";
import { percentage } from "./electorate.ts";

export const MAX_TERRITORIAL_SELECTION = 30;

function nullableCsvDecimal(value: number | null) {
  return value === null ? "" : formatCsvDecimal(value);
}

export function sanitizeTerritorialSelectionIds(
  value: unknown,
  validIds: ReadonlySet<string>,
  maximum = MAX_TERRITORIAL_SELECTION,
) {
  if (!Array.isArray(value)) return [];

  const result: string[] = [];
  for (const item of value) {
    if (
      typeof item === "string" &&
      validIds.has(item) &&
      !result.includes(item)
    ) {
      result.push(item);
    }

    if (result.length >= maximum) break;
  }

  return result;
}

export function toggleTerritorialSelectionId(
  ids: string[],
  id: string,
  maximum = MAX_TERRITORIAL_SELECTION,
) {
  if (ids.includes(id)) return ids.filter((candidate) => candidate !== id);
  if (ids.length >= maximum) return ids;
  return [...ids, id];
}

export function addTerritorialSelectionIds(
  current: string[],
  candidates: string[],
  validIds: ReadonlySet<string>,
  maximum = MAX_TERRITORIAL_SELECTION,
) {
  return sanitizeTerritorialSelectionIds(
    [...current, ...candidates],
    validIds,
    maximum,
  );
}

export function aggregateTerritorialSelection(
  municipalities: MunicipalityProfile[],
  stateElectorate: number,
): TerritorialSelectionSummary {
  const electorate = municipalities.reduce(
    (total, municipality) => total + municipality.electorate,
    0,
  );
  const populationEstimate = municipalities.reduce(
    (total, municipality) =>
      total + (municipality.socioeconomic.populationEstimate ?? 0),
    0,
  );
  // Municípios sem dado etário ficam fora do numerador E do denominador;
  // a lacuna vira contagem informada, nunca zero.
  const withAge = municipalities.filter(
    (
      municipality,
    ): municipality is MunicipalityProfile & {
      age: MunicipalityAgeStructure;
    } => municipality.age !== null,
  );
  const population16Plus = withAge.reduce(
    (total, municipality) => total + municipality.age.population16Plus,
    0,
  );
  const electorateWithAge = withAge.reduce(
    (total, municipality) => total + municipality.electorate,
    0,
  );
  const population16to24 = withAge.reduce(
    (total, municipality) =>
      total + municipality.age.bands.a16to17 + municipality.age.bands.a18to24,
    0,
  );
  const population60Plus = withAge.reduce(
    (total, municipality) => total + municipality.age.bands.a60plus,
    0,
  );
  // Alfabetização 15+: soma de numerador e denominador dos municípios com
  // dado — nunca média das taxas municipais; sem cobertura o resultado é null.
  const withLiteracy = municipalities.filter(
    (
      municipality,
    ): municipality is MunicipalityProfile & {
      literacy: MunicipalityLiteracy;
    } => municipality.literacy !== null,
  );
  const literate15Plus = withLiteracy.reduce(
    (total, municipality) => total + municipality.literacy.literate15Plus,
    0,
  );
  const population15Plus = withLiteracy.reduce(
    (total, municipality) => total + municipality.literacy.population15Plus,
    0,
  );
  const biometrics = municipalities.reduce(
    (total, municipality) => total + municipality.biometrics,
    0,
  );
  const registeredDisability = municipalities.reduce(
    (total, municipality) => total + municipality.registeredDisability,
    0,
  );
  const female = municipalities.reduce(
    (total, municipality) => total + municipality.gender.female,
    0,
  );
  const socialName = municipalities.reduce(
    (total, municipality) => total + municipality.socialName,
    0,
  );
  const largestMunicipality =
    municipalities
      .slice()
      .sort(
        (a, b) =>
          b.electorate - a.electorate ||
          a.name.localeCompare(b.name, "pt-BR"),
      )[0] ?? null;

  return {
    municipalityCount: municipalities.length,
    electorate,
    populationEstimate,
    population16Plus,
    electoralPenetrationPct:
      population16Plus > 0
        ? percentage(electorateWithAge, population16Plus)
        : null,
    share16to24Pct:
      population16Plus > 0
        ? percentage(population16to24, population16Plus)
        : null,
    share60PlusPct:
      population16Plus > 0
        ? percentage(population60Plus, population16Plus)
        : null,
    missingAgeCount: municipalities.length - withAge.length,
    literacyRatePct:
      population15Plus > 0
        ? percentage(literate15Plus, population15Plus)
        : null,
    missingLiteracyCount: municipalities.length - withLiteracy.length,
    stateSharePct: percentage(electorate, stateElectorate),
    biometricsPct: percentage(biometrics, electorate),
    disabilityPct: percentage(registeredDisability, electorate),
    femalePct: percentage(female, electorate),
    socialNamePerTenThousand:
      electorate > 0 ? (socialName / electorate) * 10_000 : 0,
    largestMunicipality,
  };
}

export function createTerritorialSelectionCsv(
  municipalities: MunicipalityProfile[],
  year: number,
) {
  const headers = [
    "ano",
    "codigo_ibge",
    "codigo_tse",
    "municipio",
    "eleitorado_total",
    "participacao_rs_percentual",
    "biometria_percentual",
    "deficiencia_cadastrada_percentual",
    "mulheres_percentual",
    "nome_social_por_10_mil",
    "zonas_informadas_no_municipio",
    "ranking_eleitorado_rs",
    "populacao_estimada_2025",
    "populacao_censo_2022",
    "densidade_demografica_2022",
    "pib_per_capita_2023",
    "escolarizacao_6_a_14_2022_percentual",
    "populacao_ocupada_2022_percentual",
    "salario_formal_medio_2024_salarios_minimos",
    "saneamento_adequado_2022_percentual",
    "renda_baixa_2010_percentual",
    "populacao_16_mais_2022",
    "penetracao_eleitoral_percentual",
    "populacao_16_a_24_2022_percentual",
    "populacao_60_mais_2022_percentual",
    "alfabetizacao_15_mais_2022_percentual",
  ];
  const rows = municipalities
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
    .map((municipality) => [
      year,
      municipality.ibgeCode,
      municipality.tseCode,
      municipality.name,
      municipality.electorate,
      formatCsvDecimal(municipality.stateSharePct),
      formatCsvDecimal(municipality.biometricsPct),
      formatCsvDecimal(
        percentage(municipality.registeredDisability, municipality.electorate),
      ),
      formatCsvDecimal(
        percentage(municipality.gender.female, municipality.electorate),
      ),
      formatCsvDecimal(
        (municipality.socialName / municipality.electorate) * 10_000,
      ),
      municipality.zoneCount,
      municipality.stateRank,
      nullableCsvDecimal(municipality.socioeconomic.populationEstimate),
      nullableCsvDecimal(municipality.socioeconomic.censusPopulation),
      nullableCsvDecimal(municipality.socioeconomic.populationDensity),
      nullableCsvDecimal(municipality.socioeconomic.gdpPerCapita),
      nullableCsvDecimal(municipality.socioeconomic.schoolAttendance),
      nullableCsvDecimal(municipality.socioeconomic.occupiedPopulation),
      nullableCsvDecimal(municipality.socioeconomic.formalAverageSalary),
      nullableCsvDecimal(municipality.socioeconomic.adequateSanitation),
      nullableCsvDecimal(municipality.socioeconomic.lowIncomePopulation),
      nullableCsvDecimal(getAnalysisMetricValue(municipality, "population16Plus")),
      nullableCsvDecimal(
        getAnalysisMetricValue(municipality, "electoralPenetration"),
      ),
      nullableCsvDecimal(getAnalysisMetricValue(municipality, "share16to24")),
      nullableCsvDecimal(getAnalysisMetricValue(municipality, "share60Plus")),
      nullableCsvDecimal(
        getAnalysisMetricValue(municipality, "literacyRate15Plus"),
      ),
    ]);

  return createCsv(headers, rows);
}

export function getTerritorialSelectionCsvFilename() {
  return "acqr-recorte-territorial-tse2026-ibge.csv";
}

export function createSharedWorkspaceUrl(
  currentUrl: string,
  analysisState: AnalysisState,
  selectionIds: string[],
) {
  const url = new URL(currentUrl);
  url.search = "";
  url.hash = "";
  url.searchParams.set("acqr", "1");
  url.searchParams.set("metric", analysisState.metricId);
  url.searchParams.set("bands", analysisState.activeBands.join(","));
  url.searchParams.set("order", analysisState.sortDirection);
  url.searchParams.set(
    "territories",
    selectionIds.slice(0, MAX_TERRITORIAL_SELECTION).join(","),
  );
  return url.toString();
}

export function parseSharedWorkspaceUrl(
  value: string,
  validIds: ReadonlySet<string>,
): SharedWorkspaceState | null {
  try {
    const url = new URL(value);
    if (url.searchParams.get("acqr") !== "1") return null;

    const rawBands = (url.searchParams.get("bands") ?? "")
      .split(",")
      .filter(Boolean)
      .map(Number);
    const analysisState = sanitizeAnalysisState({
      metricId: url.searchParams.get("metric"),
      activeBands: rawBands,
      sortDirection: url.searchParams.get("order"),
    });
    const selectionIds = sanitizeTerritorialSelectionIds(
      (url.searchParams.get("territories") ?? "")
        .split(",")
        .filter(Boolean),
      validIds,
    );

    return { analysisState, selectionIds };
  } catch {
    return null;
  }
}
