export type AgeStructureBands = {
  a16to17: number;
  a18to24: number;
  a25to39: number;
  a40to59: number;
  a60plus: number;
};

export type MunicipalityAgeStructure = {
  populationTotal: number;
  population16Plus: number;
  bands: AgeStructureBands;
};

export type AgeStructureMetadata = {
  schemaVersion: number;
  referenceYear: number;
  municipalityCount: number;
  /** "pendente" enquanto o ETL do Censo 2022 não publica o arquivo completo. */
  status?: string;
};

export type AgeStructureDataset = {
  metadata: AgeStructureMetadata;
  municipalities: Record<string, MunicipalityAgeStructure>;
};
