import assert from "node:assert/strict";
import test from "node:test";
import type {
  CandidateContest,
  CandidateDataset,
  CandidateMunicipio,
} from "../../src/types/candidate.ts";
import {
  buildGrowthModel,
  createGrowthCsv,
  getMunicipalScope,
  getMunicipioDestaques,
} from "../../src/utils/candidateStats.ts";

/**
 * Escopo municipal e visão "Geral" de crescimento.
 *
 * Payloads sintéticos inline — nada é lido de `src/data`, então NENHUM teste
 * deste arquivo é pulado: ele roda igual antes e depois do gerar_dados.sh.
 *
 * As duas disciplinas sob teste, que são as que produzem número errado quando
 * afrouxam:
 *
 * 1. Ausência nunca vira zero. Um bairro que não aparece num pleito sai como
 *    `null` e NÃO gera variação — não é "caiu 100%", é "não foi apurado".
 * 2. Voto de eleições diferentes nunca é somado, e a variação entre cargos
 *    diferentes sai MARCADA (`comparavel: false`), porque disputar prefeitura
 *    e disputar uma cadeira na Assembleia não são a mesma corrida.
 */

const GOIANIA = "5208707";
const ANAPOLIS = "5201108";

function municipio(
  nome: string,
  votos: number,
  extras: Partial<CandidateMunicipio> = {},
): CandidateMunicipio {
  return {
    nome,
    votos,
    validos: extras.validos ?? votos * 10,
    percentualValidos: extras.percentualValidos ?? 10,
    votosDoPartido: extras.votosDoPartido ?? null,
    percentualDoPartido: extras.percentualDoPartido ?? null,
    posicaoNoMunicipio: extras.posicaoNoMunicipio ?? 3,
    candidaturasComVoto: extras.candidaturasComVoto ?? 12,
  };
}

function pleito(
  id: string,
  electionYear: number,
  officeCode: number,
  officeName: string,
  votosNoEstado: number,
  municipios: Record<string, CandidateMunicipio>,
  bairros: CandidateContest["bairros"] = null,
): CandidateContest {
  return {
    id,
    electionYear,
    officeCode,
    officeName,
    round: 1,
    candidatura: {
      sqCandidato: `SQ-${id}`,
      nomeCompleto: "ADRIANA SAUTHIER ACCORSI",
      nomeUrna: "ADRIANA ACCORSI",
      partido: "PT",
      numero: "13",
      situacaoCandidatura: "APTO",
      resultado: "NAO ELEITO",
    },
    votosNoEstado,
    posicaoNoEstado: 3,
    candidaturasNoPleito: 627,
    municipiosComVoto: Object.keys(municipios).length,
    concentracaoPercentual: { top5: 100, top10: 100, top20: 100 },
    votosSemLocalDeVotacao: 0,
    temRecorteSubmunicipal: bairros !== null,
    municipios,
    locais: null,
    bairros,
  };
}

/** Três eleições de prefeita em Goiânia — o caso real da candidata. */
function datasetMunicipal(): CandidateDataset {
  return {
    metadata: {
      schemaVersion: 1,
      state: "GO",
      slug: "adriana-accorsi",
      pleitos: 3,
      anos: [2016, 2020, 2024],
      cargos: ["Prefeito"],
    },
    contests: [
      pleito("2016-11-1", 2016, 11, "Prefeito", 46103, {
        [GOIANIA]: municipio("Goiânia", 46103, { posicaoNoMunicipio: 8 }),
      }, {
        [GOIANIA]: { "setor central": 4000, "setor bueno": 3000 },
      }),
      pleito("2020-11-1", 2020, 11, "Prefeito", 80715, {
        [GOIANIA]: municipio("Goiânia", 80715, { posicaoNoMunicipio: 5 }),
      }, {
        // "setor bueno" some deste pleito de propósito: ausência, não zero.
        [GOIANIA]: { "setor central": 6000 },
      }),
      pleito("2024-11-1", 2024, 11, "Prefeito", 168145, {
        [GOIANIA]: municipio("Goiânia", 168145, { posicaoNoMunicipio: 3 }),
      }, {
        [GOIANIA]: { "setor central": 9000, "setor bueno": 7500 },
      }),
    ],
  };
}

/** Dep. Estadual 2018 e Dep. Federal 2022: cargos DIFERENTES no mesmo grupo. */
function datasetFederal(): CandidateDataset {
  return {
    metadata: {
      schemaVersion: 1,
      state: "GO",
      slug: "adriana-accorsi",
      pleitos: 2,
      anos: [2018, 2022],
      cargos: ["Deputado Estadual", "Deputado Federal"],
    },
    contests: [
      pleito("2018-7-1", 2018, 7, "Deputado Estadual", 39283, {
        [GOIANIA]: municipio("Goiânia", 30000),
        [ANAPOLIS]: municipio("Anápolis", 9283),
      }),
      pleito("2022-6-1", 2022, 6, "Deputado Federal", 96714, {
        [GOIANIA]: municipio("Goiânia", 70000),
        [ANAPOLIS]: municipio("Anápolis", 26714),
      }),
    ],
  };
}

/* ---------------------------------------------------------------- escopo -- */

test("pleito de prefeita é lido na régua da cidade, não do estado", () => {
  const contest = datasetMunicipal().contests[2];
  const escopo = getMunicipalScope(contest);
  assert.ok(escopo);
  assert.equal(escopo.nome, "Goiânia");
  assert.equal(escopo.votos, 168145);
  // A colocação que vale é a DE GOIÂNIA (3ª de 12), não a do estado
  // (3ª de 627), que compararia com quem disputava outra cidade.
  assert.equal(escopo.posicaoNoMunicipio, 3);
  assert.equal(escopo.candidaturasComVoto, 12);
});

test("cargo estadual não tem escopo municipal", () => {
  assert.equal(getMunicipalScope(datasetFederal().contests[0]), null);
});

test("pleito municipal com mais de uma cidade não escolhe uma em silêncio", () => {
  const contest = pleito("2024-11-1", 2024, 11, "Prefeito", 100, {
    [GOIANIA]: municipio("Goiânia", 60),
    [ANAPOLIS]: municipio("Anápolis", 40),
  });
  assert.equal(getMunicipalScope(contest), null);
});

/* -------------------------------------------------------------- setas ----- */

test("série total encadeia as três eleições com a variação de cada passo", () => {
  const model = buildGrowthModel(datasetMunicipal(), "municipais");
  assert.ok(model);
  assert.equal(model.series.length, 1);

  const total = model.series[0];
  assert.equal(total.label, "Total em Goiânia");
  assert.deepEqual(
    total.points.map((ponto) => ponto.votos),
    [46103, 80715, 168145],
  );
  assert.equal(total.arrows.length, 2);
  assert.equal(total.arrows[0].variacaoPct, 75.1);
  assert.equal(total.arrows[1].variacaoPct, 108.3);
  assert.equal(total.arrows[0].comparavel, true);
  assert.equal(total.variacaoTotalPct, 264.7);
  assert.equal(total.variacaoTotalComparavel, true);
});

test("bairro ausente num pleito fica null e não vira queda de 100%", () => {
  const model = buildGrowthModel(datasetMunicipal(), "municipais", [
    "bairro:setor bueno",
  ]);
  assert.ok(model);
  const bueno = model.series[1];
  assert.equal(bueno.label, "setor bueno");
  assert.deepEqual(
    bueno.points.map((ponto) => ponto.votos),
    [3000, null, 7500],
  );
  // 2016 -> 2020: o destino é ausente, então NÃO existe variação.
  assert.equal(bueno.arrows[0].variacaoPct, null);
  // 2020 -> 2024: a base é ausente, então também não existe.
  assert.equal(bueno.arrows[1].variacaoPct, null);
  // A ponta a ponta, sim: 3000 -> 7500 são duas medições reais.
  assert.equal(bueno.variacaoTotalPct, 150);
});

test("variação entre cargos diferentes sai marcada como não comparável", () => {
  const model = buildGrowthModel(datasetFederal(), "federaisEstaduais");
  assert.ok(model);
  assert.equal(model.temCargosDiferentes, true);
  const total = model.series[0];
  assert.equal(total.arrows.length, 1);
  // O número é calculado — é o crescimento que a campanha quer ver...
  assert.equal(total.arrows[0].variacaoPct, 146.2);
  // ...mas fica marcado, porque não são a mesma disputa.
  assert.equal(total.arrows[0].comparavel, false);
  assert.equal(total.variacaoTotalComparavel, false);
});

test("grupo municipal de cargo e turno iguais não marca nada", () => {
  const model = buildGrowthModel(datasetMunicipal(), "municipais");
  assert.ok(model);
  assert.equal(model.temCargosDiferentes, false);
});

/* ------------------------------------------------------------- recortes --- */

test("municipal oferece bairros da cidade; federal oferece municípios", () => {
  const municipal = buildGrowthModel(datasetMunicipal(), "municipais");
  assert.ok(municipal);
  assert.equal(municipal.breakdownLabel, "Bairros de Goiânia");
  assert.deepEqual(
    municipal.options.map((opcao) => opcao.id),
    // Ordenado pelo voto no pleito MAIS RECENTE: central 9000 > bueno 7500.
    ["bairro:setor central", "bairro:setor bueno"],
  );

  const federal = buildGrowthModel(datasetFederal(), "federaisEstaduais");
  assert.ok(federal);
  assert.equal(federal.breakdownLabel, "Municípios");
  assert.deepEqual(
    federal.options.map((opcao) => opcao.label),
    ["Goiânia", "Anápolis"],
  );
});

test("ordenação dos recortes usa o pleito mais recente, nunca a soma dos anos", () => {
  // Bairro A: 10 em 2016, 10 em 2020, 10 em 2024  -> soma 30, recente 10
  // Bairro B: 1 em 2016, 1 em 2020, 25 em 2024    -> soma 27, recente 25
  // Somando os anos, A viria primeiro. Pelo pleito mais recente — que é o
  // certo, porque votos de eleições diferentes não formam um total — é B.
  const dataset: CandidateDataset = {
    metadata: {
      schemaVersion: 1,
      state: "GO",
      slug: "teste",
      pleitos: 3,
      anos: [2016, 2020, 2024],
      cargos: ["Prefeito"],
    },
    contests: [2016, 2020, 2024].map((ano, indice) =>
      pleito(
        `${ano}-11-1`,
        ano,
        11,
        "Prefeito",
        100,
        { [GOIANIA]: municipio("Goiânia", 100) },
        { [GOIANIA]: { a: 10, b: [1, 1, 25][indice] } },
      ),
    ),
  };
  const model = buildGrowthModel(dataset, "municipais");
  assert.ok(model);
  assert.deepEqual(
    model.options.map((opcao) => opcao.id),
    ["bairro:b", "bairro:a"],
  );
});

test("recorte inexistente é ignorado em vez de virar série vazia", () => {
  const model = buildGrowthModel(datasetMunicipal(), "municipais", [
    "bairro:nao existe",
  ]);
  assert.ok(model);
  assert.equal(model.series.length, 1);
});

test("grupo com um pleito só não tem crescimento para mostrar", () => {
  const dataset = datasetMunicipal();
  dataset.contests = [dataset.contests[0]];
  assert.equal(buildGrowthModel(dataset, "municipais"), null);
});

/* ------------------------------------------------------------------ CSV --- */

test("CSV deixa a célula vazia onde não houve apuração", () => {
  const model = buildGrowthModel(datasetMunicipal(), "municipais", [
    "bairro:setor bueno",
  ]);
  assert.ok(model);
  const linhas = createGrowthCsv(model).trim().split("\n");
  const bueno2020 = linhas.find(
    (linha) => linha.includes("setor bueno") && linha.includes("2020"),
  );
  assert.ok(bueno2020);
  // Votos e variação vazios — jamais "0", que a planilha somaria como voto.
  assert.equal(bueno2020.includes(';"0";'), false);
  assert.ok(bueno2020.endsWith(';"";"";""'));

  // E a linha com apuração dos dois lados traz variação e qualificação.
  const total2020 = linhas.find(
    (linha) => linha.includes("Total em Goiânia") && linha.includes("2020"),
  );
  assert.ok(total2020);
  assert.ok(total2020.endsWith(';"75,1";"sim"'));
});

/* ------------------------------------------------- rótulo de resultado ---- */

test("derrota não vira etiqueta na tela, vitória continua aparecendo", async () => {
  const { formatResultado, formatResultadoVitrine, formatResultadoVitrineShort } =
    await import("../../src/utils/candidate.ts");

  // O dado bruto continua traduzível — é o que o CSV e a consulta usam.
  assert.equal(formatResultado("NAO ELEITO"), "Não eleita");
  // Mas a vitrine não carimba derrota.
  assert.equal(formatResultadoVitrine("NAO ELEITO"), "");
  assert.equal(formatResultadoVitrine("NÃO ELEITO"), "");
  assert.equal(formatResultadoVitrineShort("NÃO ELEITA"), "");
  assert.equal(formatResultadoVitrine(""), "");
  // O que o voto sozinho não conta continua na tela.
  assert.equal(formatResultadoVitrine("ELEITO POR QP"), "Eleita por QP");
  assert.equal(formatResultadoVitrineShort("ELEITO POR QP"), "Eleita QP");
  assert.equal(formatResultadoVitrine("2 TURNO"), "Foi ao 2º turno");
  assert.equal(formatResultadoVitrine("SUPLENTE"), "Suplente");
});

test("trajetória entrega rótulo de vitrine, mas guarda o resultado cru", async () => {
  const { buildTrajectory } = await import("../../src/utils/candidate.ts");
  const pontos = buildTrajectory(datasetMunicipal());
  for (const ponto of pontos) {
    assert.equal(ponto.resultado, "NAO ELEITO"); // dado preservado
    assert.equal(ponto.resultadoLabel, ""); // tela limpa
    assert.equal(ponto.resultadoShort, "");
  }
});

/* ------------------------------------------- destaques por município ------ */

/** Trajetória completa: 3 de prefeita (só Goiânia) + 2 legislativas (estado). */
function datasetCompleto(): CandidateDataset {
  return {
    metadata: {
      schemaVersion: 1,
      state: "GO",
      slug: "adriana-accorsi",
      pleitos: 5,
      anos: [2016, 2018, 2020, 2022, 2024],
      cargos: ["Prefeito", "Deputado Estadual", "Deputado Federal"],
    },
    contests: [
      ...datasetMunicipal().contests,
      ...datasetFederal().contests,
    ],
  };
}

test("Goiânia mostra os dois universos: a última de prefeita e a última legislativa", () => {
  const destaques = getMunicipioDestaques(datasetCompleto(), GOIANIA);
  assert.equal(destaques.length, 2);

  // Mais recente primeiro: prefeita 2024 antes de deputada federal 2022.
  assert.equal(destaques[0].electionYear, 2024);
  assert.equal(destaques[0].officeName, "Prefeito");
  assert.equal(destaques[0].municipal, true);
  assert.equal(destaques[0].votos, 168145);

  assert.equal(destaques[1].electionYear, 2022);
  assert.equal(destaques[1].officeName, "Deputado Federal");
  assert.equal(destaques[1].municipal, false);
  assert.equal(destaques[1].votos, 70000);

  // O que NÃO pode acontecer: virar um total só. São disputas diferentes.
  const soma = destaques.reduce((total, item) => total + item.votos, 0);
  assert.notEqual(soma, destaques[0].votos);
});

test("município comum traz só a última legislativa, sem inventar pleito municipal", () => {
  const destaques = getMunicipioDestaques(datasetCompleto(), ANAPOLIS);
  assert.equal(destaques.length, 1);
  assert.equal(destaques[0].municipal, false);
  assert.equal(destaques[0].electionYear, 2022);
  assert.equal(destaques[0].votos, 26714);
});

test("município sem voto apurado dela não vira cartão de zero", () => {
  // 5200050 não aparece em pleito nenhum do dataset.
  assert.deepEqual(getMunicipioDestaques(datasetCompleto(), "5200050"), []);
});

test("universo mais antigo não substitui o mais recente do mesmo universo", () => {
  const destaques = getMunicipioDestaques(datasetCompleto(), GOIANIA);
  const anos = destaques.map((item) => item.electionYear);
  // 2016 e 2020 (prefeita) e 2018 (estadual) existem no dataset e NÃO podem
  // aparecer: cada universo entrega só a eleição mais recente.
  assert.equal(anos.includes(2016), false);
  assert.equal(anos.includes(2020), false);
  assert.equal(anos.includes(2018), false);
});

test("trajetória pendente não produz destaque nenhum", () => {
  const vazio: CandidateDataset = {
    metadata: {
      schemaVersion: 1,
      state: "GO",
      slug: "adriana-accorsi",
      status: "pendente",
      pleitos: 0,
      anos: [],
      cargos: [],
    },
    contests: [],
  };
  assert.deepEqual(getMunicipioDestaques(vazio, GOIANIA), []);
});
