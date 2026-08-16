import type { AgeStructureDataset } from "../types/ageStructure";
import type { LiteracyDataset } from "../types/literacy";
import type {
  ElectorateDataset,
  MunicipalityProfile,
  TerritorialDataset,
} from "../types/electorate";
import type {
  SocioeconomicDataset,
  SocioeconomicIndicatorDefinition,
  SocioeconomicIndicatorId,
} from "../types/socioeconomic";

export function buildTerritorialDataset(
  electorate: ElectorateDataset,
  socioeconomic: SocioeconomicDataset,
  ageStructure: AgeStructureDataset,
  literacy: LiteracyDataset,
): TerritorialDataset {
  const electorateIds = Object.keys(electorate.municipalities);
  const socioeconomicIds = Object.keys(socioeconomic.municipalities);

  if (
    socioeconomic.metadata.state !== electorate.metadata.state ||
    socioeconomic.metadata.municipalityCount !==
      electorate.metadata.municipalityCount ||
    electorateIds.length !== socioeconomicIds.length
  ) {
    throw new Error("As bases TSE e IBGE não possuem o mesmo recorte territorial.");
  }

  const municipalities: Record<string, MunicipalityProfile> = {};
  for (const id of electorateIds) {
    const electoral = electorate.municipalities[id];
    const ibge = socioeconomic.municipalities[id];
    if (!ibge || ibge.ibgeCode !== id || ibge.name !== electoral.name) {
      throw new Error(`Município ausente ou divergente na base IBGE: ${id}.`);
    }
    municipalities[id] = {
      ...electoral,
      socioeconomic: ibge.values,
      // Cobertura parcial (ou placeholder vazio) vira null, nunca zero.
      age: ageStructure.municipalities[id] ?? null,
      literacy: literacy.municipalities[id] ?? null,
    };
  }

  return {
    metadata: electorate.metadata,
    socioeconomicMetadata: socioeconomic.metadata,
    municipalities,
  };
}

export function getSocioeconomicDefinition(
  metadata: { indicators: SocioeconomicIndicatorDefinition[] },
  indicatorId: SocioeconomicIndicatorId,
) {
  return metadata.indicators.find((indicator) => indicator.code === indicatorId);
}

export function formatSourceRetrievalDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}
