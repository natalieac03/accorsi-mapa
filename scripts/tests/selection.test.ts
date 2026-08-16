import assert from "node:assert/strict";
import test from "node:test";
import type { MunicipalityProfile } from "../../src/types/electorate.ts";
import { BASE_PENDENTE, INSTRUCAO_GERAR } from "./dadosPendentes.ts";
import {
  addTerritorialSelectionIds,
  aggregateTerritorialSelection,
  createSharedWorkspaceUrl,
  createTerritorialSelectionCsv,
  parseSharedWorkspaceUrl,
  sanitizeTerritorialSelectionIds,
  toggleTerritorialSelectionId,
} from "../../src/utils/selection.ts";

function municipality(
  code: string,
  name: string,
  electorate: number,
  overrides: Partial<MunicipalityProfile> = {},
): MunicipalityProfile {
  return {
    ibgeCode: code,
    tseCode: code,
    name,
    electorate,
    stateSharePct: 0,
    stateRank: 1,
    zoneCount: 1,
    biometrics: electorate,
    biometricsPct: 100,
    registeredDisability: 0,
    socialName: 0,
    topAgeGroup: {
      label: "30 a 34 anos",
      electorate,
      percentage: 100,
    },
    gender: {
      female: Math.floor(electorate / 2),
      male: Math.ceil(electorate / 2),
      notInformed: 0,
    },
    socioeconomic: {
      populationEstimate: electorate + 10,
      censusPopulation: electorate,
      populationDensity: 10,
      gdpPerCapita: 25_000,
      schoolAttendance: 98,
      occupiedPopulation: 30,
      formalAverageSalary: 2.2,
      adequateSanitation: 70,
      lowIncomePopulation: 35,
    },
    age: null,
    literacy: null,
    ...overrides,
  };
}

test("limpa o recorte persistido e respeita o limite", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, () => {
  const validIds = new Set(["1", "2", "3", "4"]);
  assert.deepEqual(
    sanitizeTerritorialSelectionIds(["1", "1", 2, "x", "2", "3"], validIds, 2),
    ["1", "2"],
  );
});

test("alterna municípios e adiciona lotes sem duplicar", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, () => {
  const validIds = new Set(["1", "2", "3", "4"]);
  assert.deepEqual(toggleTerritorialSelectionId(["1"], "1"), []);
  assert.deepEqual(toggleTerritorialSelectionId(["1"], "2", 2), ["1", "2"]);
  assert.deepEqual(toggleTerritorialSelectionId(["1", "2"], "3", 2), ["1", "2"]);
  assert.deepEqual(
    addTerritorialSelectionIds(["1"], ["2", "2", "x", "3"], validIds, 3),
    ["1", "2", "3"],
  );
});

test("agrega taxas a partir das somas e não pela média simples", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, () => {
  const first = municipality("1", "Cidade A", 100, {
    biometrics: 80,
    biometricsPct: 80,
    registeredDisability: 10,
    socialName: 1,
    gender: { female: 60, male: 40, notInformed: 0 },
  });
  const second = municipality("2", "Cidade B", 300, {
    biometrics: 270,
    biometricsPct: 90,
    registeredDisability: 15,
    socialName: 3,
    gender: { female: 150, male: 150, notInformed: 0 },
  });
  const summary = aggregateTerritorialSelection([first, second], 1_000);

  assert.equal(summary.municipalityCount, 2);
  assert.equal(summary.electorate, 400);
  assert.equal(summary.populationEstimate, 420);
  assert.equal(summary.stateSharePct, 40);
  assert.equal(summary.biometricsPct, 87.5);
  assert.equal(summary.disabilityPct, 6.25);
  assert.equal(summary.femalePct, 52.5);
  assert.equal(summary.socialNamePerTenThousand, 100);
  assert.equal(summary.largestMunicipality?.name, "Cidade B");
});

test("um recorte vazio retorna indicadores neutros", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, () => {
  assert.deepEqual(aggregateTerritorialSelection([], 1_000), {
    municipalityCount: 0,
    electorate: 0,
    populationEstimate: 0,
    population16Plus: 0,
    electoralPenetrationPct: null,
    share16to24Pct: null,
    share60PlusPct: null,
    missingAgeCount: 0,
    literacyRatePct: null,
    missingLiteracyCount: 0,
    stateSharePct: 0,
    biometricsPct: 0,
    disabilityPct: 0,
    femalePct: 0,
    socialNamePerTenThousand: 0,
    largestMunicipality: null,
  });
});

test("penetração do recorte é ponderada de verdade, nunca média de médias", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, () => {
  const first = municipality("1", "Cidade A", 100, {
    age: {
      populationTotal: 500,
      population16Plus: 400,
      bands: { a16to17: 20, a18to24: 60, a25to39: 120, a40to59: 100, a60plus: 100 },
    },
  });
  const second = municipality("2", "Cidade B", 300, {
    age: {
      populationTotal: 400,
      population16Plus: 300,
      bands: { a16to17: 10, a18to24: 50, a25to39: 90, a40to59: 90, a60plus: 60 },
    },
  });
  // Sem dado etário: fica fora do numerador E do denominador.
  const third = municipality("3", "Cidade C", 1_000);
  const summary = aggregateTerritorialSelection([first, second, third], 10_000);

  assert.equal(summary.population16Plus, 700);
  // Penetrações municipais: 25% e 100%. Média de médias daria 62,5%;
  // a ponderada correta é (100 + 300) / 700 = 57,14%.
  assert.equal(Number(summary.electoralPenetrationPct?.toFixed(2)), 57.14);
  // (20 + 60 + 10 + 50) / 700 = 20%
  assert.equal(summary.share16to24Pct, 20);
  // (100 + 60) / 700 = 22,86%
  assert.equal(Number(summary.share60PlusPct?.toFixed(2)), 22.86);
  assert.equal(summary.missingAgeCount, 1);
});

test("recorte inteiro sem dado etário devolve null e contagem completa", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, () => {
  const summary = aggregateTerritorialSelection(
    [municipality("1", "Cidade A", 100), municipality("2", "Cidade B", 300)],
    10_000,
  );

  assert.equal(summary.population16Plus, 0);
  assert.equal(summary.electoralPenetrationPct, null);
  assert.equal(summary.share16to24Pct, null);
  assert.equal(summary.share60PlusPct, null);
  assert.equal(summary.missingAgeCount, 2);
});

test("alfabetização do recorte soma numerador e denominador, nunca média de taxas", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, () => {
  const first = municipality("1", "Cidade A", 100, {
    // Taxa municipal 90%: 900 alfabetizadas em 1.000 pessoas 15+.
    literacy: { literate15Plus: 900, population15Plus: 1_000, literacyRate: 90 },
  });
  const second = municipality("2", "Cidade B", 300, {
    // Taxa municipal 99%: 8.910 alfabetizadas em 9.000 pessoas 15+.
    literacy: { literate15Plus: 8_910, population15Plus: 9_000, literacyRate: 99 },
  });
  // Sem dado de alfabetização: fica fora do numerador E do denominador.
  const third = municipality("3", "Cidade C", 1_000);
  const summary = aggregateTerritorialSelection([first, second, third], 10_000);

  // Média de médias daria 94,5%; a ponderada correta é 9.810 / 10.000 = 98,1%.
  assert.equal(summary.literacyRatePct, 98.1);
  assert.equal(summary.missingLiteracyCount, 1);
});

test("recorte inteiro sem alfabetização devolve null e contagem completa", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, () => {
  const summary = aggregateTerritorialSelection(
    [municipality("1", "Cidade A", 100), municipality("2", "Cidade B", 300)],
    10_000,
  );

  assert.equal(summary.literacyRatePct, null);
  assert.equal(summary.missingLiteracyCount, 2);
});

test("gera e recupera um link limpo com análise e códigos municipais", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, () => {
  const validIds = new Set(["1", "2", "3"]);
  const url = createSharedWorkspaceUrl(
    "https://acqr.test/map?key=AIzaSEGREDO&foo=bar#privado",
    { metricId: "female", activeBands: [2, 4], sortDirection: "asc" },
    ["1", "2"],
  );
  const parsed = parseSharedWorkspaceUrl(url, validIds);

  assert.equal(url.includes("AIzaSEGREDO"), false);
  assert.equal(url.includes("foo=bar"), false);
  assert.equal(url.includes("privado"), false);
  assert.deepEqual(parsed, {
    analysisState: {
      metricId: "female",
      activeBands: [2, 4],
      sortDirection: "asc",
    },
    selectionIds: ["1", "2"],
  });
});

test("descarta parâmetros compartilhados inválidos", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, () => {
  const validIds = new Set(["1", "2"]);
  const parsed = parseSharedWorkspaceUrl(
    "https://acqr.test/?acqr=1&metric=falso&bands=8&order=lateral&territories=1,x,1",
    validIds,
  );

  assert.deepEqual(parsed, {
    analysisState: {
      metricId: "electorate",
      activeBands: [0, 1, 2, 3, 4],
      sortDirection: "desc",
    },
    selectionIds: ["1"],
  });
  assert.equal(parseSharedWorkspaceUrl("não é uma URL", validIds), null);
});

test("o link limita o recorte a trinta códigos", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, () => {
  const ids = Array.from({ length: 40 }, (_, index) => String(index + 1));
  const validIds = new Set(ids);
  const url = createSharedWorkspaceUrl(
    "https://acqr.test/",
    { metricId: "electorate", activeBands: [0, 1, 2, 3, 4], sortDirection: "desc" },
    ids,
  );
  const parsed = parseSharedWorkspaceUrl(url, validIds);

  assert.equal(parsed?.selectionIds.length, 30);
  assert.equal(parsed?.selectionIds.at(-1), "30");
});

test("exporta somente os municípios escolhidos em CSV seguro", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, () => {
  const csv = createTerritorialSelectionCsv(
    [
      municipality("2", "Cidade B", 20),
      municipality("1", "=Cidade A", 10),
    ],
    2026,
  );

  assert.equal(csv.startsWith("\uFEFF"), true);
  assert.match(csv, /"'=Cidade A"/);
  assert.match(csv, /"Cidade B"/);
  assert.match(csv, /"populacao_estimada_2025"/);
  assert.match(csv, /"populacao_16_mais_2022"/);
  assert.match(csv, /"penetracao_eleitoral_percentual"/);
  assert.equal(csv.trim().split("\n").length, 3);
  assert.equal(csv.indexOf("'=Cidade A") < csv.indexOf("Cidade B"), true);
});

test("CSV do recorte deixa célula vazia para município sem dado do Censo", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, () => {
  const covered = municipality("1", "Cidade A", 100, {
    age: {
      populationTotal: 500,
      population16Plus: 400,
      bands: { a16to17: 20, a18to24: 60, a25to39: 120, a40to59: 100, a60plus: 100 },
    },
    // Taxa 96%: 480 alfabetizadas em 500 pessoas 15+.
    literacy: { literate15Plus: 480, population15Plus: 500, literacyRate: 96 },
  });
  const missing = municipality("2", "Cidade B", 300);
  const csv = createTerritorialSelectionCsv([covered, missing], 2026);
  const lines = csv.trim().split("\n");
  const coveredLine = lines.find((line) => line.includes('"Cidade A"'));
  const missingLine = lines.find((line) => line.includes('"Cidade B"'));

  assert.deepEqual(coveredLine?.split(";").slice(-5), [
    '"400"',
    '"25"',
    '"20"',
    '"25"',
    '"96"',
  ]);
  assert.deepEqual(missingLine?.split(";").slice(-5), ['""', '""', '""', '""', '""']);
});
