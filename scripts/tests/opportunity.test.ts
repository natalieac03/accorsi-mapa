import assert from "node:assert/strict";
import test from "node:test";
import type {
  CandidateContest,
  CandidateMunicipio,
} from "../../src/types/candidate.ts";
import {
  buildContestMetrics,
  estimateBetaPrior,
  liftAgainst,
  rankTerritories,
  smoothRate,
  summarizeConcentration,
  SUAVIZACAO_PADRAO,
} from "../../src/utils/opportunity.ts";

/**
 * Fixtures SINTÉTICOS, inline: nenhum teste aqui depende de `src/data`, então
 * nenhum fica SKIP antes de rodar o `gerar_dados.sh`. Os números foram
 * escolhidos para serem conferíveis de cabeça — é esse o ponto da Rodada 1.
 */

function municipio(
  nome: string,
  votos: number,
  validos: number,
  extras: Partial<CandidateMunicipio> = {},
): CandidateMunicipio {
  return {
    nome,
    votos,
    validos,
    percentualValidos: validos > 0 ? (votos / validos) * 100 : null,
    votosDoPartido: null,
    percentualDoPartido: null,
    posicaoNoMunicipio: null,
    candidaturasComVoto: 1,
    ...extras,
  };
}

function pleito(
  municipios: Record<string, CandidateMunicipio>,
  votosNoEstado: number,
): CandidateContest {
  return {
    id: "2022-6-1",
    electionYear: 2022,
    officeCode: 6,
    officeName: "Deputado Federal",
    round: 1,
    candidatura: {
      sqCandidato: "0",
      nomeCompleto: "FULANO DE TAL",
      nomeUrna: "FULANO",
      partido: "PT",
      numero: "1310",
      situacaoCandidatura: "APTO",
      resultado: "NAO ELEITO",
    },
    votosNoEstado,
    posicaoNoEstado: null,
    candidaturasNoPleito: 1,
    municipiosComVoto: Object.keys(municipios).length,
    concentracaoPercentual: { top5: 0, top10: 0, top20: 0 },
    votosSemLocalDeVotacao: 0,
    temRecorteSubmunicipal: false,
    municipios,
    locais: null,
    bairros: null,
  } as CandidateContest;
}

// --------------------------------------------------------------- suavização --

test("taxa suavizada converge para a bruta quando o território é grande", () => {
  const prior = { alpha: 5, beta: 45, strength: 50, mean: 0.1, origin: "configurado" as const, capped: false };
  // 100.000 válidos: o prior de 50 votos é ruído.
  const grande = smoothRate(20_000, 100_000, prior);
  assert.ok(grande !== null);
  assert.ok(Math.abs(grande - 0.2) < 0.001);
});

test("taxa suavizada puxa o território minúsculo para a média", () => {
  const prior = { alpha: 5, beta: 45, strength: 50, mean: 0.1, origin: "configurado" as const, capped: false };
  // 3 de 7 válidos = 42,9% bruto. Suavizado: (3+5)/(7+50) = 14,0%.
  const bruta = 3 / 7;
  const suave = smoothRate(3, 7, prior);
  assert.ok(suave !== null);
  assert.ok(Math.abs(suave - 8 / 57) < 1e-9);
  assert.ok(suave < bruta / 2, "o extremo precisa encolher de verdade");
});

test("sem válidos não existe taxa suavizada — e não vira zero", () => {
  const prior = { alpha: 5, beta: 45, strength: 50, mean: 0.1, origin: "configurado" as const, capped: false };
  assert.equal(smoothRate(0, 0, prior), null);
});

test("prior estimado da distribuição quando ela sustenta; configurado quando não", () => {
  // Taxas dispersas -> variância real -> estimativa sustentável.
  const dispersas = Array.from({ length: 40 }, (_, i) => 0.05 + (i % 8) * 0.02);
  const estimado = estimateBetaPrior(dispersas);
  assert.equal(estimado.origin, "estimado");

  // Amostra pequena demais não sustenta estimativa de variância.
  assert.equal(estimateBetaPrior([0.1, 0.3, 0.2]).origin, "configurado");
});

test("variância praticamente nula não vira prior astronômico", () => {
  // REGRESSÃO: 40 taxas idênticas dão variância ~7e-33 em ponto flutuante,
  // não zero. Com a guarda antiga (`variancia <= 0`), a fórmula devolvia
  // força ~2e+31 — um prior que puxaria TODO território para a média exata,
  // apagando o sinal que a aba existe para achar.
  const identicas = Array.from({ length: 40 }, () => 0.2);
  const prior = estimateBetaPrior(identicas);
  assert.equal(prior.origin, "configurado");
  assert.equal(prior.strength, SUAVIZACAO_PADRAO.strength);
  assert.ok(prior.strength < 1e6, "força do prior não pode explodir");
});

test("prior estimado forte demais é limitado pelo teto, e isso fica registrado", () => {
  // Taxas muito concentradas -> método dos momentos pede força enorme.
  const concentradas = Array.from({ length: 40 }, (_, i) => 0.1 + (i % 5) * 0.002);
  const prior = estimateBetaPrior(concentradas);
  assert.equal(prior.origin, "estimado");
  assert.equal(prior.capped, true);
  assert.equal(prior.strength, SUAVIZACAO_PADRAO.maxStrength);
});

test("prior dentro do teto não é marcado como limitado", () => {
  const dispersas = Array.from({ length: 40 }, (_, i) => 0.05 + (i % 8) * 0.02);
  const prior = estimateBetaPrior(dispersas);
  assert.ok(prior.strength <= SUAVIZACAO_PADRAO.maxStrength);
  assert.equal(prior.capped, false);
});

test("prior sempre tem média entre 0 e 1, mesmo com entrada degenerada", () => {
  for (const entrada of [[], [0], [1], [0, 1]]) {
    const prior = estimateBetaPrior(entrada);
    assert.ok(prior.mean > 0 && prior.mean < 1, `média inválida para ${JSON.stringify(entrada)}`);
    assert.ok(prior.alpha > 0 && prior.beta > 0);
  }
});

// ------------------------------------------------------------- concentração --

test("concentração: top-N, HHI e territórios para metade", () => {
  // 4 territórios: 500, 300, 150, 50 -> total 1000.
  const resumo = summarizeConcentration([500, 300, 150, 50], 1000);
  assert.ok(Math.abs(resumo.top5 - 1) < 1e-9, "só há 4, então top5 é tudo");
  // HHI = (0,5² + 0,3² + 0,15² + 0,05²) * 10000 = 3650
  assert.ok(Math.abs(resumo.hhi - 3650) < 1e-6);
  // 500 já é 50% -> um território basta.
  assert.equal(resumo.territoriosParaMetade, 1);
});

test("concentração pulverizada tem HHI baixo", () => {
  const iguais = Array.from({ length: 100 }, () => 10);
  const resumo = summarizeConcentration(iguais, 1000);
  // 100 territórios iguais -> HHI = 10000/100 = 100
  assert.ok(Math.abs(resumo.hhi - 100) < 1e-6);
  assert.equal(resumo.territoriosParaMetade, 50);
});

test("concentração sem total apurado não divide por zero", () => {
  const resumo = summarizeConcentration([10, 20], 0);
  assert.equal(resumo.hhi, 0);
  assert.equal(resumo.top5, 0);
});

// ------------------------------------------------------ métricas do pleito --

test("soma dos municípios é reportada separada do total do estado", () => {
  const contest = pleito(
    {
      "5208707": municipio("Capital", 600, 3000),
      "5201405": municipio("Interior", 400, 2000),
    },
    1000,
  );
  const m = buildContestMetrics(contest, null);
  assert.equal(m.votosSomados, 1000);
  assert.equal(m.votosNoEstado, 1000);
  assert.equal(m.validosSomados, 5000);
  // taxa de referência = 1000 / 5000 = 20%
  assert.ok(m.taxaReferencia !== null && Math.abs(m.taxaReferencia - 0.2) < 1e-9);
});

test("divergência entre soma e total do estado fica VISÍVEL, não é escondida", () => {
  const contest = pleito({ "5208707": municipio("Capital", 600, 3000) }, 1000);
  const m = buildContestMetrics(contest, null);
  assert.equal(m.votosSomados, 600);
  assert.equal(m.votosNoEstado, 1000);
  assert.notEqual(m.votosSomados, m.votosNoEstado);
});

test("município sem denominador não vira taxa zero — fica null e é contado", () => {
  const contest = pleito(
    {
      "5208707": municipio("Com apuração", 600, 3000),
      "5201405": municipio("Sem apuração", 40, 0),
    },
    640,
  );
  const m = buildContestMetrics(contest, null);
  const sem = m.territorios.find((t) => t.ibgeCode === "5201405");
  assert.equal(sem?.taxa, null);
  assert.equal(sem?.taxaSuavizada, null);
  assert.equal(sem?.lift, null);
  assert.equal(m.territoriosSemDenominador, 1);
});

test("votos por mil usa o ELEITORADO apto, não os válidos", () => {
  const contest = pleito({ "5208707": municipio("Capital", 500, 2000) }, 500);
  const m = buildContestMetrics(contest, { "5208707": 100_000 });
  const capital = m.territorios[0];
  // 500 / 100000 * 1000 = 5 por mil — e NÃO 500/2000*1000 = 250.
  assert.ok(capital.votosPorMil !== null);
  assert.ok(Math.abs(capital.votosPorMil - 5) < 1e-9);
});

test("sem snapshot de eleitorado, votos por mil é null e não zero", () => {
  const contest = pleito({ "5208707": municipio("Capital", 500, 2000) }, 500);
  const m = buildContestMetrics(contest, null);
  assert.equal(m.territorios[0].votosPorMil, null);
  assert.equal(m.territorios[0].eleitorado, null);
});

test("participação no bloco vem do percentual do partido, em fração", () => {
  const contest = pleito(
    {
      "5208707": municipio("Capital", 300, 2000, {
        votosDoPartido: 1200,
        percentualDoPartido: 25,
      }),
    },
    300,
  );
  const m = buildContestMetrics(contest, null);
  assert.ok(Math.abs((m.territorios[0].participacaoNoBloco ?? 0) - 0.25) < 1e-9);
});

test("lift acima de 1 em território forte, abaixo em fraco", () => {
  const municipios: Record<string, CandidateMunicipio> = {};
  // 30 municípios em 10%, um em 30% — todos grandes, para o prior não dominar.
  for (let i = 0; i < 30; i += 1) {
    municipios[`52000${String(i).padStart(2, "0")}`] = municipio(
      `Media ${i}`,
      1000,
      10_000,
    );
  }
  municipios["5208707"] = municipio("Forte", 3000, 10_000);
  municipios["5201405"] = municipio("Fraco", 200, 10_000);

  const contest = pleito(municipios, 33_200);
  const m = buildContestMetrics(contest, null);
  const forte = m.territorios.find((t) => t.ibgeCode === "5208707");
  const fraco = m.territorios.find((t) => t.ibgeCode === "5201405");

  assert.ok((forte?.lift ?? 0) > 1.5, "território forte precisa passar de 1,5");
  assert.ok((fraco?.lift ?? 9) < 0.5, "território fraco precisa ficar abaixo de 0,5");
});

test("lift contra o conjunto responde pergunta diferente do lift estadual", () => {
  const municipios: Record<string, CandidateMunicipio> = {
    "5208707": municipio("A", 3000, 10_000),
    "5201405": municipio("B", 2500, 10_000),
    "5203302": municipio("C", 500, 10_000),
  };
  const contest = pleito(municipios, 6000);
  const m = buildContestMetrics(contest, null);

  const subconjunto = m.territorios.filter((t) => t.ibgeCode !== "5203302");
  const contraConjunto = liftAgainst(subconjunto, "conjunto", m);
  const contraEstado = liftAgainst(subconjunto, "estado", m);

  const aConjunto = contraConjunto.get("5208707");
  const aEstado = contraEstado.get("5208707");
  assert.ok(aConjunto !== null && aEstado !== null);
  // Contra os pares fortes o mesmo território parece menos excepcional.
  assert.ok((aConjunto ?? 0) < (aEstado ?? 0));
});

// ------------------------------------------------------------------ ranking --

test("ranking exclui território sem valor em vez de mandá-lo para o fim com zero", () => {
  const contest = pleito(
    {
      "5208707": municipio("Com taxa", 600, 3000),
      "5201405": municipio("Sem denominador", 40, 0),
    },
    640,
  );
  const m = buildContestMetrics(contest, null);
  const ranking = rankTerritories(m, "taxaSuavizada");
  assert.equal(ranking.length, 1);
  assert.equal(ranking[0].ibgeCode, "5208707");
});

test("ranking respeita o mínimo de válidos configurado", () => {
  const contest = pleito(
    {
      "5208707": municipio("Grande", 600, 3000),
      "5201405": municipio("Minusculo", 3, 7),
    },
    603,
  );
  const m = buildContestMetrics(contest, null);
  assert.equal(rankTerritories(m, "taxaSuavizada").length, 2);
  assert.equal(rankTerritories(m, "taxaSuavizada", { minimoDeValidos: 100 }).length, 1);
});

test("desempate é estável e determinístico: votos, depois nome", () => {
  const contest = pleito(
    {
      "5200001": municipio("Zeta", 500, 5000),
      "5200002": municipio("Alfa", 500, 5000),
      "5200003": municipio("Beta", 800, 8000),
    },
    1800,
  );
  const m = buildContestMetrics(contest, null);
  const primeira = rankTerritories(m, "taxaSuavizada").map((r) => r.ibgeCode);
  const segunda = rankTerritories(m, "taxaSuavizada").map((r) => r.ibgeCode);
  assert.deepEqual(primeira, segunda, "duas execuções, mesma ordem");
  // Mesma taxa (10%): quem tem mais votos vem antes; empatados em votos, o
  // desempate é o NOME — "Alfa" (5200002) antes de "Zeta" (5200001).
  assert.deepEqual(primeira, ["5200003", "5200002", "5200001"]);
});

test("posições do ranking são sequenciais a partir de 1", () => {
  const contest = pleito(
    {
      "5200001": municipio("A", 900, 3000),
      "5200002": municipio("B", 500, 5000),
      "5200003": municipio("C", 100, 5000),
    },
    1500,
  );
  const m = buildContestMetrics(contest, null);
  const ranking = rankTerritories(m, "votos");
  assert.deepEqual(
    ranking.map((r) => r.posicao),
    [1, 2, 3],
  );
  assert.equal(ranking[0].ibgeCode, "5200001");
});

test("nenhuma métrica produz NaN ou Infinity com entradas degeneradas", () => {
  const contest = pleito(
    {
      "5200001": municipio("Zerado", 0, 0),
      "5200002": municipio("Sem voto", 0, 5000),
    },
    0,
  );
  const m = buildContestMetrics(contest, null);
  for (const territorio of m.territorios) {
    for (const valor of [
      territorio.taxa,
      territorio.taxaSuavizada,
      territorio.votosPorMil,
      territorio.lift,
      territorio.participacaoNoBloco,
      territorio.concentracao,
    ]) {
      assert.ok(
        valor === null || Number.isFinite(valor),
        `valor não finito: ${valor}`,
      );
    }
  }
  assert.ok(Number.isFinite(m.concentracao.hhi));
});
