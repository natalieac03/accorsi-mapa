export type MunicipalityLiteracy = {
  /** Pessoas alfabetizadas de 15 anos ou mais (Censo 2022, tabela 9542). */
  literate15Plus: number;
  /** População de 15 anos ou mais (denominador da taxa). */
  population15Plus: number;
  /** Taxa de alfabetização em % (0–100, 1 casa decimal). */
  literacyRate: number;
};

export type LiteracyMetadata = {
  schemaVersion: number;
  referenceYear?: number;
  municipalityCount: number;
  /** "pendente" enquanto o ETL do Censo 2022 não publica o arquivo completo. */
  status?: string;
};

export type LiteracyDataset = {
  metadata: LiteracyMetadata;
  municipalities: Record<string, MunicipalityLiteracy>;
};
