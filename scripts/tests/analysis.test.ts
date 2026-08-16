import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { AgeStructureDataset } from "../../src/types/ageStructure.ts";
import type { AnalysisState } from "../../src/types/analysis.ts";
import type {
  ElectorateDataset,
  MunicipalityProfile,
} from "../../src/types/electorate.ts";
import type { LiteracyDataset } from "../../src/types/literacy.ts";
import type { SocioeconomicDataset } from "../../src/types/socioeconomic.ts";
import {
  buildAnalysisModel,
  calculateQuantileThresholds,
  createAnalysisCsv,
  formatAnalysisMetricValue,
  getAnalysisBand,
  getAnalysisMetricValue,
  getDefaultAnalysisState,
  sanitizeAnalysisState,
  toggleAnalysisBand,
} from "../../src/utils/analysis.ts";
import { createCsv } from "../../src/utils/csv.ts";
import { buildTerritorialDataset } from "../../src/utils/socioeconomic.ts";
import { BASE_PENDENTE, INSTRUCAO_GERAR } from "./dadosPendentes.ts";

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
      populationEstimate: electorate,
      censusPopulation: electorate,
      populationDensity: electorate,
      gdpPerCapita: electorate * 1_000,
      schoolAttendance: 95,
      occupiedPopulation: 30,
      formalAverageSalary: 2.5,
      adequateSanitation: 70,
      lowIncomePopulation: 35,
    },
    age: null,
    literacy: null,
    ...overrides,
  };
}

function loadJson<T>(relative: string): T {
  return JSON.parse(
    readFileSync(new URL(relative, import.meta.url), "utf8"),
  ) as T;
}

function loadRealDataset() {
  return buildTerritorialDataset(
    loadJson<ElectorateDataset>("../../src/data/electorate-go.json"),
    loadJson<SocioeconomicDataset>("../../src/data/socioeconomic-go.json"),
    loadJson<AgeStructureDataset>("../../src/data/age-structure-go.json"),
    loadJson<LiteracyDataset>("../../src/data/literacy-go.json"),
  );
}

test("calcula quatro cortes e cinco faixas por quintis", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, () => {
  const thresholds = calculateQuantileThresholds([
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
  ]);

  assert.deepEqual(thresholds, [2, 4, 6, 8]);
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((value) =>
      getAnalysisBand(value, thresholds),
    ),
    [0, 0, 1, 1, 2, 2, 3, 3, 4, 4],
  );
});

test("recupera somente preferências de análise válidas", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, () => {
  assert.deepEqual(
    sanitizeAnalysisState({
      metricId: "female",
      activeBands: [4, 4, 2, 9, "1"],
      sortDirection: "asc",
    }),
    { metricId: "female", activeBands: [2, 4], sortDirection: "asc" },
  );

  assert.deepEqual(
    sanitizeAnalysisState({
      metricId: "inventado",
      activeBands: [],
      sortDirection: "lado",
    }),
    getDefaultAnalysisState(),
  );
});

test("o filtro nunca permite ocultar a última faixa ativa", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, () => {
  assert.deepEqual(toggleAnalysisBand([0, 2], 0), [2]);
  assert.deepEqual(toggleAnalysisBand([2], 2), [2]);
  assert.deepEqual(toggleAnalysisBand([2], 4), [2, 4]);
});

test("deriva taxas sem alterar o dado eleitoral original", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, () => {
  const sample = municipality("1", "Teste", 200, {
    zoneCount: 2,
    biometricsPct: 92.5,
    registeredDisability: 10,
    socialName: 2,
    gender: { female: 110, male: 90, notInformed: 0 },
  });

  assert.equal(getAnalysisMetricValue(sample, "electorate"), 200);
  assert.equal(getAnalysisMetricValue(sample, "biometrics"), 92.5);
  assert.equal(getAnalysisMetricValue(sample, "disability"), 5);
  assert.equal(
    Number(getAnalysisMetricValue(sample, "female")?.toFixed(2)),
    55,
  );
  assert.equal(getAnalysisMetricValue(sample, "socialName"), 100);
  assert.equal(getAnalysisMetricValue(sample, "electorsPerZone"), 100);
});

test("monta recorte, ordenação e participação no eleitorado estadual", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, () => {
  const municipalities = Array.from({ length: 10 }, (_, index) =>
    municipality(String(index + 1), `Cidade ${index + 1}`, index + 1),
  );
  const state: AnalysisState = {
    metricId: "electorate",
    activeBands: [4],
    sortDirection: "desc",
  };
  const model = buildAnalysisModel(municipalities, state, 55);

  assert.deepEqual(model.bandCounts, [2, 2, 2, 2, 2]);
  assert.deepEqual(
    model.filteredItems.map((item) => item.value),
    [10, 9],
  );
  assert.equal(model.focusedElectorate, 19);
  assert.equal(Number(model.focusedElectoratePct.toFixed(2)), 34.55);
  assert.equal(model.median, 5.5);
});

test("os quintis reais do eleitorado permanecem iguais aos dados validados", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, () => {
  const dataset = loadRealDataset();
  const model = buildAnalysisModel(
    Object.values(dataset.municipalities),
    getDefaultAnalysisState(),
    dataset.metadata.stateElectorate,
  );

  assert.equal(model.allItems.length, 246);
  assert.deepEqual(model.thresholds, dataset.metadata.electorateThresholds);
  assert.deepEqual(model.bandCounts, [100, 99, 100, 99, 99]);
  assert.equal(model.filteredItems[0].municipality.name, "Porto Alegre");
});

test("as lentes TSE e as sete lentes IBGE principais cobrem os 246 municípios", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, () => {
  const dataset = loadRealDataset();
  const municipalities = Object.values(dataset.municipalities);

  for (const metricId of [
    "electorate",
    "biometrics",
    "disability",
    "female",
    "socialName",
    "electorsPerZone",
    "populationEstimate",
    "censusPopulation",
    "populationDensity",
    "gdpPerCapita",
    "schoolAttendance",
    "occupiedPopulation",
    "formalAverageSalary",
  ] as const) {
    const model = buildAnalysisModel(
      municipalities,
      { ...getDefaultAnalysisState(), metricId },
      dataset.metadata.stateElectorate,
    );

    assert.equal(model.allItems.length, 246);
    assert.equal(
      model.bandCounts.reduce((total, count) => total + count, 0),
      246,
    );
    assert.equal(model.allItems.every((item) => Number.isFinite(item.value)), true);
  }
});

test("mantém lacunas oficiais fora dos quintis e contabiliza municípios em cinza", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, () => {
  const withData = municipality("1", "Cidade com dado", 10);
  const missing = municipality("2", "Cidade sem dado", 20, {
    socioeconomic: {
      ...municipality("x", "aux", 1).socioeconomic,
      adequateSanitation: null,
    },
  });
  const model = buildAnalysisModel(
    [withData, missing],
    {
      metricId: "adequateSanitation",
      activeBands: [0, 1, 2, 3, 4],
      sortDirection: "desc",
    },
    30,
  );

  assert.equal(model.allItems.length, 1);
  assert.equal(model.missingMunicipalityCount, 1);
  assert.equal(model.filteredItems[0].municipality.name, "Cidade com dado");
});

test("exporta apenas o recorte atual em CSV seguro para planilha", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, () => {
  const municipalities = [
    municipality("1", "Cidade 1", 10),
    municipality("2", "Cidade 2", 20),
    municipality("3", "Cidade 3", 30),
    municipality("4", "Cidade 4", 40),
    municipality("5", "=Cidade teste", 50),
  ];
  const model = buildAnalysisModel(
    municipalities,
    { metricId: "electorate", activeBands: [4], sortDirection: "desc" },
    150,
  );
  const csv = createAnalysisCsv(model);

  assert.equal(csv.startsWith("\uFEFF"), true);
  assert.match(csv, /"codigo_ibge"/);
  assert.match(csv, /"ano_referencia_indicador"/);
  assert.match(csv, /"'=Cidade teste"/);
  assert.doesNotMatch(csv, /"Cidade 4"/);
  assert.equal(csv.trim().split("\n").length, 2);

  const numericCsv = createCsv(
    ["valor"],
    [["-0,007"], ["-5"], [-30.03], ["=SOMA(A1)"], ["+ABC"], ["@x"]],
  );
  assert.match(numericCsv, /"-0,007"/);
  assert.match(numericCsv, /"-5"/);
  assert.match(numericCsv, /"-30\.03"/);
  assert.doesNotMatch(numericCsv, /'-/);
  assert.match(numericCsv, /"'=SOMA\(A1\)"/);
  assert.match(numericCsv, /"'\+ABC"/);
  assert.match(numericCsv, /"'@x"/);
});

const SAMPLE_AGE = {
  populationTotal: 1_000,
  population16Plus: 800,
  bands: {
    a16to17: 40,
    a18to24: 120,
    a25to39: 200,
    a40to59: 240,
    a60plus: 200,
  },
};

const SAMPLE_LITERACY = {
  literate15Plus: 831,
  population15Plus: 865,
  literacyRate: 96.1,
};

test("alfabetização 15+ é alfabetizados / população 15+, em %", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, () => {
  const sample = municipality("1", "Teste", 600, { literacy: SAMPLE_LITERACY });

  // 831 / 865 = 96,069...% — o valor sai do quociente, não do campo pronto.
  const value = getAnalysisMetricValue(sample, "literacyRate15Plus");
  assert.equal(value, (831 / 865) * 100);
  assert.equal(
    formatAnalysisMetricValue("literacyRate15Plus", value),
    "96,1%",
  );
});

test("sem alfabetização (ou população 15+ zero) a métrica retorna null", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, () => {
  const missing = municipality("1", "Sem dado", 100);
  const zero = municipality("2", "Zerado", 100, {
    literacy: { literate15Plus: 0, population15Plus: 0, literacyRate: 0 },
  });

  assert.equal(getAnalysisMetricValue(missing, "literacyRate15Plus"), null);
  assert.equal(getAnalysisMetricValue(zero, "literacyRate15Plus"), null);
});

test("calcula à mão as quatro métricas etárias do Censo 2022", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, () => {
  const sample = municipality("1", "Teste", 600, { age: SAMPLE_AGE });

  assert.equal(getAnalysisMetricValue(sample, "population16Plus"), 800);
  // 600 eleitores / 800 pessoas 16+ = 75%
  assert.equal(getAnalysisMetricValue(sample, "electoralPenetration"), 75);
  // (40 + 120) / 800 = 20% — denominador é a população 16+, não a total
  assert.equal(getAnalysisMetricValue(sample, "share16to24"), 20);
  // 200 / 800 = 25%
  assert.equal(getAnalysisMetricValue(sample, "share60Plus"), 25);
});

test("sem estrutura etária (ou população 16+ zero) as lentes retornam null", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, () => {
  const missing = municipality("1", "Sem dado", 100);
  const zero = municipality("2", "Zerado", 100, {
    age: {
      populationTotal: 0,
      population16Plus: 0,
      bands: { a16to17: 0, a18to24: 0, a25to39: 0, a40to59: 0, a60plus: 0 },
    },
  });

  for (const metricId of [
    "population16Plus",
    "electoralPenetration",
    "share16to24",
    "share60Plus",
  ] as const) {
    assert.equal(getAnalysisMetricValue(missing, metricId), null);
  }
  assert.equal(getAnalysisMetricValue(zero, "electoralPenetration"), null);
  assert.equal(getAnalysisMetricValue(zero, "share16to24"), null);
  assert.equal(getAnalysisMetricValue(zero, "share60Plus"), null);
});

test("penetração acima de 100% é valor legítimo, não erro", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, () => {
  // Títulos não transferidos: eleitorado maior que a população 16+ local.
  const sample = municipality("1", "Fronteira", 900, { age: SAMPLE_AGE });
  const value = getAnalysisMetricValue(sample, "electoralPenetration");

  assert.equal(value, 112.5);
  assert.equal(formatAnalysisMetricValue("electoralPenetration", value), "112,5%");

  const model = buildAnalysisModel(
    [sample],
    {
      metricId: "electoralPenetration",
      activeBands: [0, 1, 2, 3, 4],
      sortDirection: "desc",
    },
    900,
  );
  assert.equal(model.allItems.length, 1);
  assert.equal(model.allItems[0].value, 112.5);
  assert.equal(model.missingMunicipalityCount, 0);
});

test("o app inteiro funciona com os placeholders etário e de alfabetização vazios", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, () => {
  const dataset = loadRealDataset();
  const municipalities = Object.values(dataset.municipalities);

  for (const metricId of [
    "population16Plus",
    "electoralPenetration",
    "share16to24",
    "share60Plus",
    "literacyRate15Plus",
  ] as const) {
    const model = buildAnalysisModel(
      municipalities,
      { ...getDefaultAnalysisState(), metricId },
      dataset.metadata.stateElectorate,
    );

    // Vale com o placeholder (0 + 246) e com o arquivo cheio (246 + 0).
    assert.equal(
      model.allItems.length + model.missingMunicipalityCount,
      246,
    );
    assert.equal(
      model.allItems.every((item) => Number.isFinite(item.value)),
      true,
    );
  }
});

test("CSV da análise deixa célula vazia para município sem estrutura etária", { skip: BASE_PENDENTE ? INSTRUCAO_GERAR : false }, () => {
  const withAge = municipality("1", "Com dado", 600, {
    age: SAMPLE_AGE,
    literacy: SAMPLE_LITERACY,
  });
  const withoutAge = municipality("2", "Cidade cinza", 400);
  const model = buildAnalysisModel(
    [withAge, withoutAge],
    { metricId: "electorate", activeBands: [0, 1, 2, 3, 4], sortDirection: "desc" },
    1_000,
  );
  const csv = createAnalysisCsv(model);
  const lines = csv.trim().split("\n");
  const header = lines[0].split(";");

  assert.equal(header.at(-5), '"populacao_16_mais_2022"');
  assert.equal(header.at(-4), '"penetracao_eleitoral_percentual"');
  assert.equal(header.at(-3), '"populacao_16_a_24_2022_percentual"');
  assert.equal(header.at(-2), '"populacao_60_mais_2022_percentual"');
  assert.equal(header.at(-1), '"alfabetizacao_15_mais_2022_percentual"');

  const covered = lines.find((line) => line.includes('"Com dado"'));
  const missing = lines.find((line) => line.includes('"Cidade cinza"'));
  // (831 / 865) * 100 = 96,0693...% — o CSV guarda o quociente com 4 casas.
  assert.deepEqual(covered?.split(";").slice(-5), [
    '"800"',
    '"75"',
    '"20"',
    '"25"',
    '"96,0694"',
  ]);
  assert.deepEqual(missing?.split(";").slice(-5), ['""', '""', '""', '""', '""']);
});
