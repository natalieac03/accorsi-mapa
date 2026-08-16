import assert from "node:assert/strict";
import test from "node:test";
import type {
  CandidateContest,
  CandidateDataset,
  CandidateMunicipio,
  StatsIndicatorSource,
} from "../../src/types/candidate.ts";
import {
  buildCareerBest,
  buildCareerOverview,
  buildMunicipalGrowth,
  buildScatter,
  buildStatsProfiles,
  createScatterCsv,
  createTrajectoryCsv,
  getScatterCsvFilename,
  groupContests,
  isMunicipalContest,
  PEARSON_MIN_N,
  pctValidosNoEstado,
  pearson,
  STATS_INDICATORS,
} from "../../src/utils/candidateStats.ts";

/**
 * Payloads SINTÉTICOS, espelhando o shape de `process_candidato_foco.py`
 * (consolidar) e do electorate-go.json. Nada aqui depende dos snapshots
 * reais de `src/data` — nesta instalação eles são placeholders e o motor
 * precisa ser verificável antes de qualquer `gerar_dados.sh`. Nenhum teste
 * é pulado.
 */

function municipio(
  nome: string,
  votos: number,
  overrides: Partial<CandidateMunicipio> = {},
): CandidateMunicipio {
  return {
    nome,
    votos,
    validos: votos * 4,
    percentualValidos: 25,
    votosDoPartido: votos * 2,
    percentualDoPartido: 50,
    posicaoNoMunicipio: 1,
    candidaturasComVoto: 10,
    ...overrides,
  };
}

function contest(
  id: string,
  electionYear: number,
  overrides: Partial<CandidateContest> = {},
): CandidateContest {
  return {
    id,
    electionYear,
    officeCode: 6,
    officeName: "Deputado Federal",
    round: 1,
    candidatura: {
      sqCandidato: "900001",
      nomeCompleto: "CANDIDATA SINTETICA",
      nomeUrna: "SINTETICA",
      partido: "PT",
      numero: "1313",
      situacaoCandidatura: "APTO",
      resultado: "ELEITO",
    },
    votosNoEstado: 1000,
    posicaoNoEstado: 1,
    candidaturasNoPleito: 20,
    municipiosComVoto: 1,
    concentracaoPercentual: { top5: 80, top10: 95, top20: 100 },
    votosSemLocalDeVotacao: 0,
    temRecorteSubmunicipal: false,
    municipios: { "5200001": municipio("Cidade Única", 1000) },
    locais: null,
    bairros: null,
    ...overrides,
  };
}

function dataset(contests: CandidateContest[]): CandidateDataset {
  return {
    metadata: {
      schemaVersion: 1,
      state: "GO",
      slug: "sintetica",
      pleitos: contests.length,
      anos: [...new Set(contests.map((c) => c.electionYear))],
      cargos: [...new Set(contests.map((c) => c.officeName))],
    },
    contests,
  };
}

/* Uma carreira sintética completa: 2 federais/estaduais + 3 municipais
   (2020 com dois turnos), fora de ordem cronológica de propósito. */
const carreira = dataset([
  contest("2022-6-1", 2022, { votosNoEstado: 120_000, municipiosComVoto: 3 }),
  contest("2016-13-1", 2016, {
    officeCode: 13,
    officeName: "Vereador",
    votosNoEstado: 8_000,
  }),
  contest("2024-11-1", 2024, {
    officeCode: 11,
    officeName: "Prefeito",
    votosNoEstado: 66_000,
    municipios: { "5208707": municipio("Goiânia", 66_000) },
  }),
  contest("2020-11-2", 2020, {
    officeCode: 11,
    officeName: "Prefeito",
    round: 2,
    votosNoEstado: 90_000,
    municipios: { "5208707": municipio("Goiânia", 90_000) },
  }),
  contest("2020-11-1", 2020, {
    officeCode: 11,
    officeName: "Prefeito",
    votosNoEstado: 55_000,
    municipios: { "5208707": municipio("Goiânia", 55_000) },
  }),
  contest("2014-6-1", 2014, { votosNoEstado: 70_000 }),
]);

test("classifica cargo municipal pelo código do TSE (11 e 13)", () => {
  assert.equal(isMunicipalContest({ officeCode: 11 }), true);
  assert.equal(isMunicipalContest({ officeCode: 13 }), true);
  assert.equal(isMunicipalContest({ officeCode: 6 }), false);
  assert.equal(isMunicipalContest({ officeCode: 7 }), false);
});

test("agrupa a trajetória em municipais × federais/estaduais, derivado do dado", () => {
  const groups = groupContests(carreira);
  assert.deepEqual(
    groups.municipais.map((c) => c.id),
    ["2024-11-1", "2020-11-1", "2020-11-2", "2016-13-1"],
  );
  assert.deepEqual(
    groups.federaisEstaduais.map((c) => c.id),
    ["2022-6-1", "2014-6-1"],
  );
  // nada se perde nem se duplica entre os grupos
  assert.equal(
    groups.municipais.length + groups.federaisEstaduais.length,
    carreira.contests.length,
  );
});

test("melhor votação da carreira é o maior voto num único pleito", () => {
  const best = buildCareerBest(carreira);
  assert.equal(best?.contestId, "2022-6-1");
  assert.equal(best?.votos, 120_000);
  assert.equal(buildCareerBest(dataset([])), null);
});

test("crescimento municipal exige mesmo cargo e mesmo turno", () => {
  // 2024 (prefeita, 1º turno) só se compara com 2020 (prefeita, 1º turno) —
  // nunca com o 2º turno de 2020 nem com vereadora 2016.
  const growth = buildMunicipalGrowth(carreira);
  assert.equal(growth?.anteriorId, "2020-11-1");
  assert.equal(growth?.recenteId, "2024-11-1");
  // (66000 - 55000) / 55000 = 20% exatos
  assert.equal(growth?.variacaoPct, 20);
});

test("sem par municipal comparável o crescimento é null, não um número inventado", () => {
  const soCargosDiferentes = dataset([
    contest("2016-13-1", 2016, { officeCode: 13, officeName: "Vereador" }),
    contest("2020-11-1", 2020, { officeCode: 11, officeName: "Prefeito" }),
  ]);
  assert.equal(buildMunicipalGrowth(soCargosDiferentes), null);
  // federais/estaduais não entram no crescimento "municipal"
  const soFederais = dataset([
    contest("2018-6-1", 2018),
    contest("2022-6-1", 2022),
  ]);
  assert.equal(buildMunicipalGrowth(soFederais), null);
});

test("visão geral: municípios alcançados é união (contagem), campanhas fundem turnos", () => {
  const overview = buildCareerOverview(carreira);
  // "5200001" (4 pleitos) + "5208707" (3 pleitos) = 2 municípios distintos
  assert.equal(overview.municipiosAlcancados, 2);
  // 2014-6, 2016-13, 2020-11 (1º e 2º turno = UMA campanha), 2022-6, 2024-11
  assert.equal(overview.campanhas, 5);
  assert.equal(overview.best?.votos, 120_000);
  assert.equal(overview.growth?.variacaoPct, 20);
});

test("% dos válidos no estado só existe para cargo estadual/federal", () => {
  const estadual = contest("2022-6-1", 2022, {
    votosNoEstado: 30_000,
    municipios: {
      "5200001": municipio("A", 20_000, { validos: 200_000 }),
      "5200002": municipio("B", 10_000, { validos: 100_000 }),
    },
  });
  // 30000 / 300000 = 10%
  assert.equal(pctValidosNoEstado(estadual), 10);
  const municipal = contest("2024-11-1", 2024, {
    officeCode: 11,
    officeName: "Prefeito",
  });
  assert.equal(pctValidosNoEstado(municipal), null);
  const semValidos = contest("2022-6-1", 2022, {
    municipios: { "5200001": municipio("A", 100, { validos: 0 }) },
  });
  assert.equal(pctValidosNoEstado(semValidos), null);
});

test("pearson: reta perfeita dá r = 1 (e r = -1 na descendente)", () => {
  const subida = [1, 2, 3, 4].map((x) => ({ x, y: 3 * x + 2 }));
  assert.ok(Math.abs((pearson(subida) ?? 0) - 1) < 1e-12);
  const descida = [1, 2, 3, 4].map((x) => ({ x, y: 10 - 2 * x }));
  assert.ok(Math.abs((pearson(descida) ?? 0) + 1) < 1e-12);
});

test("pearson: nuvem simétrica dá r = 0 e caso conferido à mão dá 0,5", () => {
  // covariância soma 1 - 1 - 1 + 1 = 0
  const nuvem = [
    { x: 1, y: 1 },
    { x: 1, y: -1 },
    { x: -1, y: 1 },
    { x: -1, y: -1 },
  ];
  assert.equal(pearson(nuvem), 0);
  // x=[1,2,3], y=[1,3,2]: cov=1, varX=2, varY=2 -> r = 1/2
  const mao = [
    { x: 1, y: 1 },
    { x: 2, y: 3 },
    { x: 3, y: 2 },
  ];
  assert.ok(Math.abs((pearson(mao) ?? 0) - 0.5) < 1e-12);
});

test("pearson: sem variância ou com menos de 2 pontos não há coeficiente", () => {
  assert.equal(pearson([]), null);
  assert.equal(pearson([{ x: 1, y: 1 }]), null);
  // reta vertical (varX = 0) e horizontal (varY = 0)
  assert.equal(
    pearson([
      { x: 5, y: 1 },
      { x: 5, y: 9 },
    ]),
    null,
  );
  assert.equal(
    pearson([
      { x: 1, y: 4 },
      { x: 8, y: 4 },
    ]),
    null,
  );
});

function indicadorSource(): StatsIndicatorSource {
  const municipalities: StatsIndicatorSource["electorate"]["municipalities"] = {};
  const literacy: StatsIndicatorSource["literacy"]["municipalities"] = {};
  // 12 municípios com % de mulheres crescendo junto com o % dos válidos —
  // correlação positiva perfeita construída de propósito.
  for (let i = 1; i <= 12; i += 1) {
    const ibge = `52000${String(i).padStart(2, "0")}`;
    municipalities[ibge] = {
      name: `Cidade ${String(i).padStart(2, "0")}`,
      electorate: 1000,
      gender: { female: 400 + i * 10, male: 600 - i * 10, notInformed: 0 },
    };
    // alfabetização só existe na metade dos municípios (cobertura parcial)
    if (i <= 6) {
      literacy[ibge] = {
        literate15Plus: 800 + i,
        population15Plus: 1000,
        literacyRate: (800 + i) / 10,
      };
    }
  }
  return {
    electorate: { metadata: {}, municipalities },
    age: { metadata: { status: "pendente" }, municipalities: {} },
    literacy: { metadata: {}, municipalities: literacy },
  };
}

function contestParaScatter(): CandidateContest {
  const municipios: Record<string, CandidateMunicipio> = {};
  for (let i = 1; i <= 12; i += 1) {
    const ibge = `52000${String(i).padStart(2, "0")}`;
    municipios[ibge] = municipio(`Cidade ${String(i).padStart(2, "0")}`, i * 100, {
      percentualValidos: i,
    });
  }
  // município sem denominador de válidos: fica FORA do scatter, contado
  municipios["5209999"] = municipio("Sem Válidos", 50, {
    validos: 0,
    percentualValidos: null,
  });
  // município que não existe no eleitorado: sem indicador, contado
  municipios["5208888"] = municipio("Sem Indicador", 70, {
    percentualValidos: 3,
  });
  return contest("2022-6-1", 2022, { municipios });
}

test("scatter: município sem indicador ou sem denominador fica FORA e é contado", () => {
  const profiles = buildStatsProfiles(indicadorSource());
  assert.notEqual(profiles, null);
  const model = buildScatter(contestParaScatter(), "female", profiles);
  assert.equal(model.points.length, 12);
  assert.equal(model.semIndicador, 1); // "Sem Indicador"
  assert.equal(model.semPercentual, 1); // "Sem Válidos"
  // valor do indicador REUSA a fórmula da aba Análise: 410/1000 = 41%
  const primeira = model.points.find((p) => p.ibgeCode === "5200001");
  assert.equal(primeira?.indicadorValor, 41);
  assert.equal(primeira?.x, 41);
  assert.equal(primeira?.y, 1);
  // % de mulheres e % dos válidos crescem juntos: r = 1
  assert.ok(Math.abs((model.pearson ?? 0) - 1) < 1e-12);
  assert.equal(model.amostraInsuficiente, false);
});

test("scatter: cobertura parcial do Censo derruba só os municípios sem dado", () => {
  const profiles = buildStatsProfiles(indicadorSource());
  const model = buildScatter(contestParaScatter(), "literacyRate15Plus", profiles);
  // só 6 municípios têm alfabetização -> 6 pontos, os outros contados
  assert.equal(model.points.length, 6);
  assert.equal(model.semIndicador, 7); // 6 sem Censo + 1 fora do eleitorado
  assert.equal(model.semPercentual, 1);
  // n < 10: coeficiente vira "amostra insuficiente", nunca um número frágil
  assert.equal(model.amostraInsuficiente, true);
  assert.equal(model.pearson, null);
  assert.ok(PEARSON_MIN_N === 10);
});

test("scatter: eleitorado usa escala log10 no eixo e no coeficiente", () => {
  const source = indicadorSource();
  source.electorate.municipalities["5200001"].electorate = 100_000;
  const profiles = buildStatsProfiles(source);
  const model = buildScatter(contestParaScatter(), "electorate", profiles);
  const grande = model.points.find((p) => p.ibgeCode === "5200001");
  assert.equal(grande?.indicadorValor, 100_000);
  assert.equal(grande?.x, 5); // log10(100000)
  const comum = model.points.find((p) => p.ibgeCode === "5200002");
  assert.equal(comum?.x, 3); // log10(1000)
});

test("scatter: índice de indicadores pendente zera o gráfico sem quebrar", () => {
  const pendente = buildStatsProfiles({
    electorate: { metadata: { status: "pendente" }, municipalities: {} },
    age: { metadata: { status: "pendente" }, municipalities: {} },
    literacy: { metadata: { status: "pendente" }, municipalities: {} },
  });
  assert.equal(pendente, null);
  const model = buildScatter(contestParaScatter(), "female", pendente);
  assert.equal(model.points.length, 0);
  // todos os municípios com % válido caem em "sem indicador"; o sem
  // denominador continua na própria contagem
  assert.equal(model.semIndicador, 13);
  assert.equal(model.semPercentual, 1);
  assert.equal(model.pearson, null);
  assert.equal(model.amostraInsuficiente, true);
});

test("perfil ignora município com eleitorado zerado (não vira denominador)", () => {
  const source = indicadorSource();
  source.electorate.municipalities["5200099"] = {
    name: "Zerada",
    electorate: 0,
    gender: { female: 0, male: 0, notInformed: 0 },
  };
  const profiles = buildStatsProfiles(source);
  assert.equal(profiles?.["5200099"], undefined);
  assert.notEqual(profiles?.["5200001"], undefined);
});

test("indicadores oferecidos: os 5 combinados, com log só no eleitorado", () => {
  assert.deepEqual(
    STATS_INDICATORS.map((i) => i.id),
    ["female", "literacyRate15Plus", "share60Plus", "electoralPenetration", "electorate"],
  );
  for (const indicator of STATS_INDICATORS) {
    assert.equal(indicator.logScale, indicator.id === "electorate");
    assert.ok(indicator.label.length > 0);
  }
});

test("CSV da trajetória: uma linha por pleito, cronológico, SEM linha de total", () => {
  const csv = createTrajectoryCsv(carreira);
  const lines = csv.trim().split("\n");
  assert.equal(lines.length, 1 + carreira.contests.length);
  assert.ok(lines[1].includes("2014"));
  assert.ok(lines[lines.length - 1].includes("2024"));
  assert.ok(!csv.toLowerCase().includes("total"));
});

test("CSV do scatter: só os pontos plotados, decimais com vírgula", () => {
  const profiles = buildStatsProfiles(indicadorSource());
  const model = buildScatter(contestParaScatter(), "female", profiles);
  const csv = createScatterCsv(model);
  const lines = csv.trim().split("\n");
  assert.equal(lines.length, 1 + model.points.length);
  assert.ok(lines[0].includes("Mulheres no cadastro"));
  // excluídos não vazam para o arquivo
  assert.ok(!csv.includes("Sem Válidos"));
  assert.ok(!csv.includes("Sem Indicador"));
  assert.equal(
    getScatterCsvFilename(contestParaScatter(), "female"),
    "estatisticas-2022-6-1-female.csv",
  );
});
