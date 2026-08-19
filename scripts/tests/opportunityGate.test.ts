import assert from "node:assert/strict";
import test from "node:test";
import {
  kmeans,
  padronizar,
  silhouetteDeReferencia,
  silhouetteScores,
  testarValoresDeK,
  type ClusterPoint,
} from "../../src/utils/clustering.ts";
import {
  crossValidate,
  explainModel,
  performanceGap,
  predictRate,
  type ModelObservation,
} from "../../src/utils/expectedPerformance.ts";
import {
  CRITERIOS,
  decidir,
  avaliarClusterizacao,
  avaliarModelo,
} from "../../src/utils/opportunityGate.ts";

/**
 * Fixtures sintéticos com estrutura CONHECIDA. É o único jeito honesto de
 * testar k-means e regressão: se eu montar dado sem estrutura nenhuma e o
 * gate aprovar, o gate está quebrado — e é justamente esse o teste que mais
 * importa aqui.
 */

/** Gera dado com semente fixa, para os testes serem determinísticos também. */
function rng(semente: number): () => number {
  let estado = semente >>> 0;
  return () => {
    estado = (estado + 0x6d2b79f5) >>> 0;
    let t = estado;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Três nuvens bem separadas: estrutura óbvia, silhouette deve ser alto. */
function nuvensSeparadas(porGrupo = 30): ClusterPoint[] {
  const aleatorio = rng(7);
  const centros = [
    [0, 0],
    [10, 10],
    [-10, 10],
  ];
  const pontos: ClusterPoint[] = [];
  centros.forEach((centro, grupo) => {
    for (let i = 0; i < porGrupo; i += 1) {
      pontos.push({
        id: `g${grupo}-${i}`,
        valores: [
          centro[0] + (aleatorio() - 0.5) * 1.5,
          centro[1] + (aleatorio() - 0.5) * 1.5,
        ],
      });
    }
  });
  return pontos;
}

/** Nuvem única e uniforme: NÃO há grupos. O gate precisa reprovar. */
function nuvemUniforme(total = 90): ClusterPoint[] {
  const aleatorio = rng(13);
  return Array.from({ length: total }, (_, i) => ({
    id: `u-${i}`,
    valores: [aleatorio() * 10, aleatorio() * 10],
  }));
}

// ------------------------------------------------------------- k-means ------

test("k-means é determinístico: mesma entrada e semente, mesmo resultado", () => {
  const pontos = nuvensSeparadas();
  const a = kmeans(pontos, 3, { semente: 42 });
  const b = kmeans(pontos, 3, { semente: 42 });
  assert.deepEqual(
    a.atribuicoes.map((x) => x.cluster),
    b.atribuicoes.map((x) => x.cluster),
  );
  assert.equal(a.silhouette, b.silhouette);
});

test("k-means separa nuvens obviamente distintas", () => {
  const resultado = kmeans(nuvensSeparadas(), 3, { semente: 42 });
  assert.ok(
    resultado.silhouette > 0.7,
    `silhouette ${resultado.silhouette} baixo para grupos bem separados`,
  );
  // Cada grupo sintético deve cair inteiro num cluster só.
  for (const grupo of [0, 1, 2]) {
    const clusters = new Set(
      resultado.atribuicoes
        .filter((a) => a.id.startsWith(`g${grupo}-`))
        .map((a) => a.cluster),
    );
    assert.equal(clusters.size, 1, `grupo ${grupo} ficou dividido`);
  }
});

test("silhouette de ponto sozinho no cluster é 0, não 1", () => {
  const pontos: ClusterPoint[] = [
    { id: "a", valores: [0, 0] },
    { id: "b", valores: [0.1, 0.1] },
    { id: "c", valores: [50, 50] },
  ];
  const scores = silhouetteScores(pontos, [0, 0, 1], 2);
  assert.equal(scores[2], 0, "sozinho no cluster não é agrupamento perfeito");
});

test("testarValoresDeK devolve TODOS os k, ordenados por silhouette", () => {
  const resultados = testarValoresDeK(nuvensSeparadas(), { semente: 42 });
  assert.ok(resultados.length >= 3);
  for (let i = 1; i < resultados.length; i += 1) {
    assert.ok(resultados[i - 1].silhouette >= resultados[i].silhouette);
  }
  // Com três nuvens, k=3 deve vencer.
  assert.equal(resultados[0].k, 3);
});

test("padronização deixa média 0 e desvio 1, e não quebra em coluna constante", () => {
  const { padronizadas, desvios } = padronizar([
    [1, 5],
    [2, 5],
    [3, 5],
  ]);
  const coluna0 = padronizadas.map((linha) => linha[0]);
  const media = coluna0.reduce((s, v) => s + v, 0) / coluna0.length;
  assert.ok(Math.abs(media) < 1e-9);
  // Coluna constante vira zeros, sem NaN.
  assert.deepEqual(
    padronizadas.map((linha) => linha[1]),
    [0, 0, 0],
  );
  assert.equal(desvios[1], 1);
});

// -------------------------------------------------------- Elastic Net -------

/** y depende linearmente de x0; x1 é ruído puro. */
function observacoesComSinal(total = 120): ModelObservation[] {
  const aleatorio = rng(21);
  return Array.from({ length: total }, (_, i) => {
    const x0 = aleatorio() * 4 - 2;
    const x1 = aleatorio() * 4 - 2;
    const logit = -2 + 0.9 * x0 + (aleatorio() - 0.5) * 0.3;
    const taxa = 1 / (1 + Math.exp(-logit));
    return {
      id: `obs-${String(i).padStart(4, "0")}`,
      features: [x0, x1],
      taxa,
      peso: 1000,
    };
  });
}

/** y é ruído: nenhuma feature explica nada. O gate precisa reprovar. */
function observacoesSemSinal(total = 120): ModelObservation[] {
  const aleatorio = rng(33);
  return Array.from({ length: total }, (_, i) => ({
    id: `obs-${String(i).padStart(4, "0")}`,
    features: [aleatorio() * 4 - 2, aleatorio() * 4 - 2],
    taxa: 0.05 + aleatorio() * 0.2,
    peso: 1000,
  }));
}

test("com sinal real, o R² fora da amostra é alto", () => {
  const resultado = crossValidate(observacoesComSinal(), ["x0", "x1"]);
  assert.ok(resultado);
  assert.ok(
    resultado.r2ForaDaAmostra > 0.7,
    `R² fora da amostra ${resultado.r2ForaDaAmostra} baixo para sinal forte`,
  );
});

test("REGRESSÃO DO GATE: com ruído puro, o R² fora da amostra fica abaixo do limiar", () => {
  const resultado = crossValidate(observacoesSemSinal(), ["x0", "x1"]);
  assert.ok(resultado);
  assert.ok(
    resultado.r2ForaDaAmostra < CRITERIOS.r2Minimo,
    `R² ${resultado.r2ForaDaAmostra} passou do limiar com dado sem sinal — ` +
      "o gate estaria cego",
  );
});

test("validação cruzada é determinística", () => {
  const dados = observacoesComSinal();
  const a = crossValidate(dados, ["x0", "x1"]);
  const b = crossValidate(dados, ["x0", "x1"]);
  assert.equal(a?.r2ForaDaAmostra, b?.r2ForaDaAmostra);
});

test("poucas observações não produzem validação — devolve null em vez de número frágil", () => {
  assert.equal(crossValidate(observacoesComSinal(6), ["x0", "x1"]), null);
});

test("o modelo identifica a feature que importa e descarta a que não importa", () => {
  const resultado = crossValidate(observacoesComSinal(), ["x0", "x1"]);
  assert.ok(resultado);
  const explicacao = explainModel(resultado.modelo);
  assert.equal(explicacao[0].featureId, "x0", "x0 deveria dominar");
  const x1 = explicacao.find((item) => item.featureId === "x1");
  const x0 = explicacao.find((item) => item.featureId === "x0");
  assert.ok(
    !x1 || Math.abs(x1.coeficiente) < Math.abs(x0!.coeficiente) / 3,
    "o ruído não pode pesar como o sinal",
  );
});

test("taxa prevista fica sempre dentro de (0,1)", () => {
  const resultado = crossValidate(observacoesComSinal(), ["x0", "x1"]);
  assert.ok(resultado);
  for (const features of [[-99, -99], [0, 0], [99, 99], [null, 3]]) {
    const previsto = predictRate(resultado.modelo, features as (number | null)[]);
    assert.ok(previsto > 0 && previsto < 1, `previsão fora de (0,1): ${previsto}`);
  }
});

test("feature ausente na previsão é imputada, não vira zero cru", () => {
  const resultado = crossValidate(observacoesComSinal(), ["x0", "x1"]);
  assert.ok(resultado);
  const comAusente = predictRate(resultado.modelo, [1.5, null]);
  assert.ok(Number.isFinite(comAusente));
});

test("lacuna é truncada em zero — desempenho acima do estimado não é lacuna negativa", () => {
  assert.equal(performanceGap(0.2, 0.3), 0);
  assert.ok(Math.abs(performanceGap(0.3, 0.2) - 0.1) < 1e-9);
});

// -------------------------------------------------------------- o gate ------

test("GATE APROVA quando há estrutura e sinal de verdade", () => {
  const pontos = nuvensSeparadas();
  const cluster = kmeans(pontos, 3, { semente: 42 });
  const validacao = crossValidate(observacoesComSinal(), ["x0", "x1"]);
  const decisao = decidir(cluster, 90, validacao, CRITERIOS, pontos);

  assert.equal(decisao.clusterizacaoAprovada, true);
  assert.equal(decisao.modeloAprovado, true);
  assert.equal(decisao.aprovado, true);
});

test("DESCOBERTA: silhouette absoluto sozinho aprovaria ruído puro", () => {
  // Documenta o motivo de existir a comparação com modelo nulo. Uma nuvem
  // uniforme — sem grupo nenhum — chega a silhouette ~0,51 com k=4, ACIMA do
  // limiar absoluto de 0,35. Silhouette premia compacidade, e qualquer
  // partição de uma nuvem uniforme é compacta.
  const melhor = testarValoresDeK(nuvemUniforme(), { semente: 42 })[0];
  assert.ok(
    melhor.silhouette > CRITERIOS.silhouetteMinimo,
    "se isto falhar, o exemplo perdeu a graça — mas o modelo nulo continua certo",
  );
});

test("o modelo nulo distingue ruído de estrutura de verdade", () => {
  const ruido = nuvemUniforme();
  const melhorRuido = testarValoresDeK(ruido, { semente: 42 })[0];
  const refRuido = silhouetteDeReferencia(ruido, melhorRuido.k);
  const folgaRuido = melhorRuido.silhouette - refRuido.media;

  const estruturado = nuvensSeparadas();
  const melhorReal = testarValoresDeK(estruturado, { semente: 42 })[0];
  const refReal = silhouetteDeReferencia(estruturado, melhorReal.k);
  const folgaReal = melhorReal.silhouette - refReal.media;

  assert.ok(folgaRuido < CRITERIOS.margemSobreReferencia, `ruído com folga ${folgaRuido}`);
  assert.ok(folgaReal >= CRITERIOS.margemSobreReferencia, `estrutura com folga ${folgaReal}`);
  assert.ok(folgaReal > folgaRuido * 3, "a separação precisa ser ampla, não marginal");
});

test("GATE REPROVA a clusterização quando não existe grupo no dado", () => {
  const ruido = nuvemUniforme();
  const melhor = testarValoresDeK(ruido, { semente: 42 })[0];
  const verificacoes = avaliarClusterizacao(melhor, 90, CRITERIOS, ruido);
  const nulo = verificacoes.find((v) => v.nome === "Silhouette acima do modelo nulo");
  assert.equal(
    nulo?.aprovado,
    false,
    "k-means sempre devolve k grupos; o gate existe justamente para isso",
  );
});

test("sem os pontos, o gate NÃO assume que a clusterização vale", () => {
  const melhor = testarValoresDeK(nuvensSeparadas(), { semente: 42 })[0];
  const verificacoes = avaliarClusterizacao(melhor, 90, CRITERIOS);
  const nulo = verificacoes.find((v) => v.nome === "Silhouette acima do modelo nulo");
  assert.equal(nulo?.aprovado, false, "ausência de evidência não pode virar aprovação");
});

test("GATE REPROVA o modelo quando o dado é ruído", () => {
  const validacao = crossValidate(observacoesSemSinal(), ["x0", "x1"]);
  const verificacoes = avaliarModelo(validacao);
  const r2 = verificacoes.find((v) => v.nome === "R² fora da amostra");
  assert.equal(r2?.aprovado, false);
});

test("GATE REPROVA por amostra pequena, mesmo com estrutura perfeita", () => {
  const pontos = nuvensSeparadas(5);
  const cluster = kmeans(pontos, 3, { semente: 42 });
  const decisao = decidir(cluster, 15, null, CRITERIOS, pontos);
  assert.equal(decisao.aprovado, false);
  const observacoes = decisao.verificacoes.find(
    (v) => v.nome === "Observações suficientes",
  );
  assert.equal(observacoes?.aprovado, false);
});

test("GATE REPROVA quando um cluster fica minúsculo", () => {
  // 60 pontos numa nuvem + 3 isolados: k=2 separa bem (silhouette alto),
  // mas um dos grupos tem 3 territórios. Não é perfil, é coincidência.
  const pontos: ClusterPoint[] = [
    ...Array.from({ length: 60 }, (_, i) => ({
      id: `massa-${i}`,
      valores: [rng(5 + i)() * 0.5, rng(9 + i)() * 0.5],
    })),
    { id: "iso-1", valores: [40, 40] },
    { id: "iso-2", valores: [40.1, 40.1] },
    { id: "iso-3", valores: [40.2, 39.9] },
  ];
  const cluster = kmeans(pontos, 2, { semente: 42 });
  const verificacoes = avaliarClusterizacao(cluster, pontos.length, CRITERIOS, pontos);
  const tamanho = verificacoes.find((v) => v.nome === "Tamanho do menor grupo");
  assert.equal(tamanho?.aprovado, false);
});

test("a decisão do gate explica em português o que reprovou e o que significa", () => {
  const validacao = crossValidate(observacoesSemSinal(), ["x0", "x1"]);
  const ruido = nuvemUniforme();
  const melhor = testarValoresDeK(ruido, { semente: 42 })[0];
  const decisao = decidir(melhor, 90, validacao, CRITERIOS, ruido);

  assert.equal(decisao.aprovado, false);
  assert.match(decisao.resumo, /não foram atendidos|Nenhum critério/);
  assert.match(decisao.resumo, /classificação por\s+regra continua valendo/);
  for (const verificacao of decisao.verificacoes) {
    assert.ok(verificacao.significado.length > 30, "toda verificação precisa explicar-se");
  }
});

test("reprovar o modelo não derruba a clusterização, e vice-versa", () => {
  // Estrutura boa, modelo ruim: perfis podem subir, lacuna não.
  const pontos = nuvensSeparadas();
  const cluster = kmeans(pontos, 3, { semente: 42 });
  const ruim = crossValidate(observacoesSemSinal(), ["x0", "x1"]);
  const decisao = decidir(cluster, 90, ruim, CRITERIOS, pontos);

  assert.equal(decisao.clusterizacaoAprovada, true);
  assert.equal(decisao.modeloAprovado, false);
  assert.equal(decisao.aprovado, false, "o conjunto só passa se os dois passarem");
});

test("sem validação nenhuma, o gate reprova em vez de assumir que está tudo bem", () => {
  const decisao = decidir(null, 0, null);
  assert.equal(decisao.aprovado, false);
  assert.ok(decisao.verificacoes.some((v) => !v.aprovado));
});
