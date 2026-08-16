import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { AgeStructureDataset } from "../../src/types/ageStructure.ts";
import type { ElectorateDataset } from "../../src/types/electorate.ts";
import type { LiteracyDataset } from "../../src/types/literacy.ts";
import type {
  CampaignRegistration,
  CampaignRegistrationDataset,
} from "../../src/types/registrations.ts";
import type { SocioeconomicDataset } from "../../src/types/socioeconomic.ts";
import {
  buildRegistrationModel,
  createRegistrationAggregateCsv,
  createRegistrationImportTemplateCsv,
  getDefaultRegistrationState,
  normalizeNeighborhoodKey,
  parseRegistrationImportCsv,
  sanitizeRegistrationState,
  toLocalRegistration,
} from "../../src/utils/registrations.ts";
import { buildTerritorialDataset } from "../../src/utils/socioeconomic.ts";
import { BASE_PENDENTE, INSTRUCAO_GERAR } from "./dadosPendentes.ts";

function loadData() {
  const registrations = JSON.parse(
    readFileSync(
      new URL("../../src/data/campaign-registrations-demo.json", import.meta.url),
      "utf8",
    ),
  ) as CampaignRegistrationDataset;
  const electorate = JSON.parse(
    readFileSync(new URL("../../src/data/electorate-go.json", import.meta.url), "utf8"),
  ) as ElectorateDataset;
  const socioeconomic = JSON.parse(
    readFileSync(new URL("../../src/data/socioeconomic-go.json", import.meta.url), "utf8"),
  ) as SocioeconomicDataset;
  const ageStructure = JSON.parse(
    readFileSync(new URL("../../src/data/age-structure-go.json", import.meta.url), "utf8"),
  ) as AgeStructureDataset;
  const literacy = JSON.parse(
    readFileSync(new URL("../../src/data/literacy-go.json", import.meta.url), "utf8"),
  ) as LiteracyDataset;
  return {
    registrations,
    municipalities: Object.values(
      buildTerritorialDataset(electorate, socioeconomic, ageStructure, literacy)
        .municipalities,
    ),
  };
}

test("demonstração é sintética, minimizada e cobre bairros sem expor CEP completo", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, () => {
  const { registrations } = loadData();
  assert.equal(registrations.metadata.mode, "synthetic-demo");
  assert.equal(registrations.records.length, 306);
  assert.equal(registrations.metadata.municipalityCount, 18);
  for (const record of registrations.records) {
    assert.match(record.cepPrefix, /^\d{5}$/);
    assert.equal("name" in record, false);
    assert.equal("phone" in record, false);
    assert.equal("cpf" in record, false);
    assert.equal(Number(record.latitude?.toFixed(3)), record.latitude);
    assert.equal(Number(record.longitude?.toFixed(3)), record.longitude);
  }
});

test("modelo mantém 246 municípios, distingue zero e suprime grupos pequenos", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, () => {
  const { registrations, municipalities } = loadData();
  const state = getDefaultRegistrationState();
  const model = buildRegistrationModel(
    registrations.records,
    municipalities,
    state,
    registrations.metadata.referenceDate,
    registrations.metadata.privacyThreshold,
  );
  assert.equal(model.allItems.length, 246);
  assert.equal(model.coveredMunicipalityCount, 18);
  assert.equal(model.validRecordCount, 306);
  assert.equal(
    model.bandCounts.reduce((total, count) => total + count, 0),
    18,
  );
  assert.ok(model.clusters.every((cluster) => cluster.count >= 5));
  assert.ok(model.suppressedClusterCount > 0);
  assert.equal(
    model.allItems.find((item) => item.municipality.name === "Porto Alegre")?.total,
    48,
  );

  const centro = model.availableClusters.find(
    (cluster) =>
      cluster.municipalityName === "Porto Alegre" &&
      cluster.neighborhood === "Centro Histórico",
  );
  assert.ok(centro);
  const neighborhoodModel = buildRegistrationModel(
    registrations.records,
    municipalities,
    {
      ...state,
      municipalityId: centro.municipalityId,
      neighborhood: centro.neighborhood,
      cepPrefix: centro.cepPrefix,
    },
    registrations.metadata.referenceDate,
    registrations.metadata.privacyThreshold,
  );
  assert.equal(neighborhoodModel.coveredMunicipalityCount, 1);
  assert.equal(neighborhoodModel.validRecordCount, centro.count);
  assert.equal(
    neighborhoodModel.allItems.find(
      (item) => item.municipality.name === "Porto Alegre",
    )?.total,
    centro.count,
  );
});

test("estado inválido volta para filtros seguros e a última faixa permanece ativa", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, () => {
  assert.deepEqual(
    sanitizeRegistrationState({
      metricId: "inexistente",
      window: "365",
      sources: [],
      statuses: ["x"],
      activeBands: [],
      sortDirection: "lado",
    }),
    getDefaultRegistrationState(),
  );
});

test("exporta somente agregados e importa o modelo sem persistir CEP completo", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, () => {
  const { registrations, municipalities } = loadData();
  const state = getDefaultRegistrationState();
  const model = buildRegistrationModel(
    registrations.records,
    municipalities,
    state,
    registrations.metadata.referenceDate,
    registrations.metadata.privacyThreshold,
  );
  const aggregate = createRegistrationAggregateCsv(model, state);
  assert.match(aggregate, /"codigo_ibge"/);
  assert.doesNotMatch(aggregate, /"cep"/);
  assert.equal(aggregate.trim().split("\n").length, 19);

  const parsed = parseRegistrationImportCsv(createRegistrationImportTemplateCsv());
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].cep, "90010000");
  const local = toLocalRegistration(parsed[0], "local-1");
  assert.equal(local.cepPrefix, "90010");
  assert.equal("cep" in local, false);
});

function newRecord(overrides: Partial<CampaignRegistration>): CampaignRegistration {
  return {
    id: "local-test",
    municipalityId: "4314902",
    municipalityName: "Porto Alegre",
    cepPrefix: "90010",
    neighborhood: "Centro Histórico",
    latitude: -30.03,
    longitude: -51.23,
    geocodePrecision: "cep_centroid",
    source: "field",
    followUpStatus: "pending",
    consentAt: "2026-08-20T12:00:00Z",
    consentChannel: "formulario_web",
    consentVersion: "v1",
    retentionUntil: "2027-08-20",
    createdAt: "2026-08-20T22:30:00-03:00",
    revokedAt: null,
    ...overrides,
  };
}

test("cadastro criado depois da data de referência conta no total do município", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, () => {
  const { registrations, municipalities } = loadData();
  const created = newRecord({});
  const model = buildRegistrationModel(
    [...registrations.records, created],
    municipalities,
    getDefaultRegistrationState(),
    registrations.metadata.referenceDate,
    registrations.metadata.privacyThreshold,
  );
  assert.equal(model.validRecordCount, 307);
  assert.equal(
    model.allItems.find((item) => item.municipality.name === "Porto Alegre")?.total,
    49,
  );

  const recentModel = buildRegistrationModel(
    [...registrations.records, created],
    municipalities,
    { ...getDefaultRegistrationState(), window: "30" },
    registrations.metadata.referenceDate,
    registrations.metadata.privacyThreshold,
  );
  assert.ok(
    (recentModel.allItems.find((item) => item.municipality.name === "Porto Alegre")
      ?.total ?? 0) >= 1,
  );
});

test("filtro de bairro casa grafia com caixa e acento diferentes e funciona sem prefixo de CEP", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, () => {
  const { registrations, municipalities } = loadData();
  assert.equal(normalizeNeighborhoodKey("  CENTRO   HISTÓRICO "), "centro historico");

  const state = getDefaultRegistrationState();
  const neighborhoodOnly = buildRegistrationModel(
    registrations.records,
    municipalities,
    {
      ...state,
      municipalityId: "4314902",
      neighborhood: "CENTRO HISTORICO",
      cepPrefix: null,
    },
    registrations.metadata.referenceDate,
    registrations.metadata.privacyThreshold,
  );
  assert.equal(neighborhoodOnly.filteredRecordCount, 12);
  assert.equal(
    neighborhoodOnly.allItems.find(
      (item) => item.municipality.name === "Porto Alegre",
    )?.total,
    12,
  );

  const cluster = neighborhoodOnly.availableClusters.find(
    (item) =>
      item.municipalityId === "4314902" &&
      item.neighborhoodKey === "centro historico",
  );
  assert.ok(cluster);
  assert.equal(cluster.neighborhood, "Centro Histórico");
  const withPrefix = buildRegistrationModel(
    registrations.records,
    municipalities,
    {
      ...state,
      municipalityId: cluster.municipalityId,
      neighborhood: "centro histórico",
      cepPrefix: cluster.cepPrefix,
    },
    registrations.metadata.referenceDate,
    registrations.metadata.privacyThreshold,
  );
  assert.equal(withPrefix.validRecordCount, cluster.count);
  assert.equal(withPrefix.filteredRecordCount, cluster.count);
});

test("seleção de bairro que não casa devolve recorte vazio, nunca tudo", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, () => {
  const { registrations, municipalities } = loadData();
  const model = buildRegistrationModel(
    registrations.records,
    municipalities,
    {
      ...getDefaultRegistrationState(),
      municipalityId: "4314902",
      neighborhood: "Bairro Que Não Existe",
      cepPrefix: null,
    },
    registrations.metadata.referenceDate,
    registrations.metadata.privacyThreshold,
  );
  assert.equal(model.filteredRecordCount, 0);
  assert.equal(model.validRecordCount, 0);
  assert.equal(model.coveredMunicipalityCount, 0);
  assert.deepEqual(model.filteredItems, []);
  assert.deepEqual(model.clusters, []);
});

test("estado antigo do localStorage é normalizado antes de filtrar", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, () => {
  const sanitized = sanitizeRegistrationState({
    ...getDefaultRegistrationState(),
    municipalityId: "4314902",
    neighborhood: "  Centro   Histórico  ",
    cepPrefix: "90010",
  });
  assert.equal(sanitized.neighborhood, "Centro Histórico");
  assert.equal(sanitized.cepPrefix, "90010");

  const prefixOnly = sanitizeRegistrationState({
    ...getDefaultRegistrationState(),
    municipalityId: "4314902",
    neighborhood: null,
    cepPrefix: "90010",
  });
  assert.equal(prefixOnly.cepPrefix, "90010");
});

test("coordenadas negativas exportam limpas e o CSV antigo com apóstrofo reimporta", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, () => {
  const template = createRegistrationImportTemplateCsv();
  assert.match(template, /"-30,030"/);
  assert.doesNotMatch(template, /'-30,030/);

  const parsed = parseRegistrationImportCsv(template);
  assert.equal(parsed[0].latitude, -30.03);
  assert.equal(parsed[0].longitude, -51.23);

  const legacy = template
    .replace('"-30,030"', "\"'-30,030\"")
    .replace('"-51,230"', "\"'-51,230\"");
  const legacyParsed = parseRegistrationImportCsv(legacy);
  assert.equal(legacyParsed[0].latitude, -30.03);
  assert.equal(legacyParsed[0].longitude, -51.23);
});
