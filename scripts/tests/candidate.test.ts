import assert from "node:assert/strict";
import test from "node:test";
import type {
  CandidateContest,
  CandidateDataset,
  CandidateMunicipio,
  ElectorateSource,
} from "../../src/types/candidate.ts";
import {
  buildAxisTicks,
  buildElectorateIndex,
  buildMunicipioRanking,
  buildTrajectory,
  compareBairros,
  createCandidateRankingCsv,
  formatCompactPt,
  formatResultado,
  formatResultadoShort,
  getBairros,
  GOIANIA_IBGE,
  isCandidatePendente,
  listContestsComBairros,
  votosPorMilEleitores,
} from "../../src/utils/candidate.ts";

/**
 * Payload SINTÉTICO, espelhando o shape de `process_candidato_foco.py`
 * (consolidar). Nada aqui depende dos snapshots reais de `src/data`, que
 * nesta instalação são placeholders: o motor precisa ser verificável antes
 * de qualquer `gerar_dados.sh`.
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
    electionDates: [`02/10/${electionYear}`],
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
    municipiosComVoto: 3,
    concentracaoPercentual: { top5: 80, top10: 95, top20: 100 },
    votosSemLocalDeVotacao: 0,
    temRecorteSubmunicipal: false,
    municipios: {},
    locais: null,
    bairros: null,
    ...overrides,
  };
}

const GYN = GOIANIA_IBGE;

// 2020 e 2024 têm recorte de bairros em Goiânia; 2022 não (sem cadastro).
const contest2020 = contest("2020-13-1", 2020, {
  officeCode: 13,
  officeName: "Vereador",
  votosNoEstado: 20000,
  candidatura: {
    sqCandidato: "900001",
    nomeCompleto: "CANDIDATA SINTETICA",
    nomeUrna: "SINTETICA",
    partido: "PT",
    numero: "13131",
    situacaoCandidatura: "APTO",
    resultado: "ELEITO POR QP",
  },
  municipios: { [GYN]: municipio("Goiânia", 20000) },
  temRecorteSubmunicipal: true,
  bairros: {
    [GYN]: {
      CENTRO: 1000,
      "VILA CRESCIMENTO": 100,
      "SETOR QUEDA": 200,
      "BAIRRO QUE SUMIU": 300,
    },
  },
});

const contest2022 = contest("2022-6-1", 2022, {
  votosNoEstado: 120000,
  municipios: {
    [GYN]: municipio("Goiânia", 60000, { percentualValidos: 10 }),
    "5201108": municipio("Anápolis", 9000, {
      percentualValidos: 12,
      percentualDoPartido: 45,
    }),
    "5201405": municipio("Aparecida de Goiânia", 15000, {
      percentualValidos: 15,
      percentualDoPartido: 60,
    }),
    // Município sem denominadores apurados: taxas null, só votos contam.
    "5200050": municipio("Abadia de Goiás", 500, {
      validos: 0,
      percentualValidos: null,
      votosDoPartido: null,
      percentualDoPartido: null,
    }),
  },
});

const contest2024 = contest("2024-13-1", 2024, {
  officeCode: 13,
  officeName: "Vereador",
  votosNoEstado: 30000,
  candidatura: {
    sqCandidato: "900001",
    nomeCompleto: "CANDIDATA SINTETICA",
    nomeUrna: "SINTETICA",
    partido: "PT",
    numero: "13131",
    situacaoCandidatura: "APTO",
    resultado: "ELEITO POR QP",
  },
  municipios: { [GYN]: municipio("Goiânia", 30000) },
  temRecorteSubmunicipal: true,
  votosSemLocalDeVotacao: 40,
  bairros: {
    [GYN]: {
      CENTRO: 1500,
      "VILA CRESCIMENTO": 400,
      "SETOR QUEDA": 120,
      "BAIRRO NOVO": 250,
    },
  },
});

// O arquivo real vem do mais recente para o mais antigo — de propósito, para
// provar que a trajetória reordena cronologicamente.
const dataset: CandidateDataset = {
  metadata: {
    schemaVersion: 1,
    state: "GO",
    slug: "candidata-sintetica",
    nomeConsultado: "CANDIDATA SINTETICA",
    pleitos: 3,
    anos: [2020, 2022, 2024],
    cargos: ["Deputado Federal", "Vereador"],
  },
  contests: [contest2024, contest2022, contest2020],
};

const electorateReady: ElectorateSource = {
  metadata: {},
  municipalities: {
    [GYN]: { electorate: 1_000_000 },
    "5201108": { electorate: 250_000 },
    "5201405": { electorate: 400_000 },
    // Abadia de Goiás de fora: eleitorado ausente => linha fora do ranking.
  },
};

const electoratePendente: ElectorateSource = {
  metadata: { status: "pendente" },
  municipalities: {},
};

test("detecção de placeholder: status pendente ou contests vazio", () => {
  assert.equal(isCandidatePendente(dataset), false);
  assert.equal(
    isCandidatePendente({
      metadata: { ...dataset.metadata, status: "pendente" },
      contests: [],
    }),
    true,
  );
  assert.equal(
    isCandidatePendente({ metadata: dataset.metadata, contests: [] }),
    true,
  );
});

test("trajetória sai em ordem cronológica com rótulos de cargo e resultado", () => {
  const points = buildTrajectory(dataset);
  assert.deepEqual(
    points.map((point) => point.electionYear),
    [2020, 2022, 2024],
  );
  assert.deepEqual(
    points.map((point) => point.votos),
    [20000, 120000, 30000],
  );
  assert.equal(points[1].officeShort, "Dep. Fed.");
  assert.equal(points[1].resultadoLabel, "Eleita");
  assert.equal(points[0].resultadoLabel, "Eleita por QP");
  // Sob a barra vai a forma curta, para não colidir com o pleito vizinho.
  assert.equal(points[0].resultadoShort, "Eleita QP");
  assert.equal(formatResultado("2 TURNO"), "Foi ao 2º turno");
  assert.equal(formatResultadoShort("2 TURNO"), "2º turno");
});

test("votos por 1.000 eleitores calcula certo e declara o arredondamento", () => {
  // 60.000 votos sobre 1.000.000 de eleitores = 60 por mil, exato.
  assert.equal(votosPorMilEleitores(60000, 1_000_000), 60);
  // 9.000 / 250.000 * 1000 = 36; caso com arredondamento a 2 casas:
  assert.equal(votosPorMilEleitores(1234, 300_000), 4.11);
});

test("sem eleitorado a taxa é null, nunca zero", () => {
  assert.equal(votosPorMilEleitores(500, null), null);
  assert.equal(votosPorMilEleitores(500, 0), null);
  assert.equal(votosPorMilEleitores(500, undefined), null);
});

test("índice de eleitorado devolve null enquanto o snapshot é placeholder", () => {
  assert.equal(buildElectorateIndex(electoratePendente), null);
  const index = buildElectorateIndex(electorateReady);
  assert.ok(index);
  assert.equal(index[GYN], 1_000_000);
});

test("ranking por votos ordena decrescente e inclui quem não tem taxa", () => {
  const rows = buildMunicipioRanking(contest2022, "votos", null);
  assert.deepEqual(
    rows.map((row) => row.nome),
    ["Goiânia", "Aparecida de Goiânia", "Anápolis", "Abadia de Goiás"],
  );
  assert.ok(
    rows.every((row, i) => i === 0 || rows[i - 1].value >= row.value),
    "ranking precisa ser monotônico decrescente",
  );
});

test("ranking percentual exclui município sem denominador (null fora, não 0)", () => {
  const rows = buildMunicipioRanking(contest2022, "percentualValidos", null);
  assert.deepEqual(
    rows.map((row) => row.nome),
    ["Aparecida de Goiânia", "Anápolis", "Goiânia"],
  );
  assert.ok(!rows.some((row) => row.nome === "Abadia de Goiás"));
});

test("ranking por 1.000 eleitores usa o eleitorado e tira quem não tem dado", () => {
  const index = buildElectorateIndex(electorateReady);
  const rows = buildMunicipioRanking(contest2022, "votosPorMilEleitores", index);
  // 60000/1M=60 · 15000/400k=37,5 · 9000/250k=36; Abadia sem eleitorado sai.
  assert.deepEqual(
    rows.map((row) => [row.nome, row.value]),
    [
      ["Goiânia", 60],
      ["Aparecida de Goiânia", 37.5],
      ["Anápolis", 36],
    ],
  );
  // Com o eleitorado pendente (índice null) a métrica não produz linha alguma.
  assert.deepEqual(
    buildMunicipioRanking(contest2022, "votosPorMilEleitores", null),
    [],
  );
});

test("ranking respeita o limite pedido", () => {
  const rows = buildMunicipioRanking(contest2022, "votos", null, 2);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].nome, "Goiânia");
});

test("bairros do pleito saem ordenados; pleito sem recorte devolve null", () => {
  const rows = getBairros(contest2024);
  assert.ok(rows);
  assert.deepEqual(rows[0], { bairro: "CENTRO", votos: 1500 });
  assert.equal(getBairros(contest2022), null);
  assert.deepEqual(
    listContestsComBairros(dataset).map((item) => item.id),
    ["2020-13-1", "2024-13-1"],
  );
});

test("variação por bairro cobre crescimento, queda, estreia e sumiço", () => {
  const rows = compareBairros(contest2020, contest2024);
  const byName = new Map(rows.map((row) => [row.bairro, row]));

  // Crescimento: 100 -> 400 = +300%.
  assert.equal(byName.get("VILA CRESCIMENTO")?.variacaoPct, 300);
  // Crescimento moderado: 1000 -> 1500 = +50%.
  assert.equal(byName.get("CENTRO")?.variacaoPct, 50);
  // Queda: 200 -> 120 = -40%.
  assert.equal(byName.get("SETOR QUEDA")?.variacaoPct, -40);
  // Estreia: sem base, variação não existe (null), anterior é null e não 0.
  const novo = byName.get("BAIRRO NOVO");
  assert.equal(novo?.votosAnterior, null);
  assert.equal(novo?.variacaoPct, null);
  // Sumiço: sem valor recente, sem taxa.
  const sumiu = byName.get("BAIRRO QUE SUMIU");
  assert.equal(sumiu?.votosRecente, null);
  assert.equal(sumiu?.variacaoPct, null);
  // Ordena pela força no pleito recente; quem sumiu vai para o fim.
  assert.equal(rows[0].bairro, "CENTRO");
  assert.equal(rows[rows.length - 1].bairro, "BAIRRO QUE SUMIU");
});

test("CSV do ranking sai com BOM, ponto e vírgula e colunas esperadas", () => {
  const rows = buildMunicipioRanking(contest2022, "percentualValidos", null);
  const csv = createCandidateRankingCsv("percentualValidos", rows);

  assert.ok(csv.startsWith("﻿"), "CSV precisa abrir com BOM (Excel pt-BR)");
  const lines = csv.slice(1).trimEnd().split("\n");
  assert.equal(
    lines[0],
    '"Posição";"Município";"Votos";"% dos válidos"',
  );
  // 1ª linha de dados: Aparecida, 15.000 votos, 15% dos válidos.
  assert.equal(lines[1], '"1";"Aparecida de Goiânia";"15000";"15"');
  assert.equal(lines.length, 1 + rows.length);
});

test("CSV de votos por 1.000 eleitores usa vírgula decimal", () => {
  const index = buildElectorateIndex(electorateReady);
  const rows = buildMunicipioRanking(contest2022, "votosPorMilEleitores", index);
  const csv = createCandidateRankingCsv("votosPorMilEleitores", rows);
  assert.match(csv, /"37,5"/);
  assert.match(csv, /"Votos por 1\.000 eleitores"/);
});

test("ticks do eixo são números redondos a partir do zero", () => {
  assert.deepEqual(buildAxisTicks(120000), [0, 50000, 100000]);
  assert.deepEqual(buildAxisTicks(0), [0]);
  const ticks = buildAxisTicks(97);
  assert.equal(ticks[0], 0);
  assert.ok(ticks.every((tick, i) => i === 0 || tick > ticks[i - 1]));
});

test("rótulos compactos ficam em pt-BR", () => {
  assert.equal(formatCompactPt(127514), "127,5 mil");
  assert.equal(formatCompactPt(1_200_000), "1,2 mi");
  assert.equal(formatCompactPt(950), "950");
});
