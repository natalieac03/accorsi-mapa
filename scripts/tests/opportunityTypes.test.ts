import assert from "node:assert/strict";
import test from "node:test";
import type { TerritoryMetrics } from "../../src/types/opportunity.ts";
import {
  classifyTerritory,
  groupByType,
  LIMIARES,
  selectAnchors,
  type TerritoryEvidence,
} from "../../src/utils/opportunityTypes.ts";
import {
  FEATURES,
  findSimilarTerritories,
  gowerDistance,
  similarityToAnchors,
  type FeatureMatrix,
  type TerritoryFeatures,
} from "../../src/utils/territoryFeatures.ts";

/** Fixtures sintéticos: nada aqui depende de src/data, nada fica SKIP. */

function territorio(
  ibgeCode: string,
  nome: string,
  valores: Record<string, number | null>,
): TerritoryFeatures {
  const completos: Record<string, number | null> = {};
  for (const definicao of FEATURES) {
    completos[definicao.id] = valores[definicao.id] ?? null;
  }
  return { ibgeCode, nome, valores: completos };
}

function matriz(territorios: TerritoryFeatures[]): FeatureMatrix {
  const intervalos: FeatureMatrix["intervalos"] = {};
  const cobertura: FeatureMatrix["cobertura"] = {};
  for (const definicao of FEATURES) {
    const valores = territorios
      .map((t) => t.valores[definicao.id])
      .filter((v): v is number => v !== null);
    cobertura[definicao.id] = valores.length;
    intervalos[definicao.id] =
      valores.length > 0
        ? { min: Math.min(...valores), max: Math.max(...valores) }
        : null;
  }
  return { definicoes: FEATURES, territorios, intervalos, cobertura };
}

function metricas(over: Partial<TerritoryMetrics> = {}): TerritoryMetrics {
  return {
    ibgeCode: "5200000",
    nome: "Teste",
    votos: 1000,
    validos: 10_000,
    taxa: 0.1,
    taxaSuavizada: 0.1,
    votosPorMil: null,
    lift: 1,
    participacaoNoBloco: 0.2,
    concentracao: 0.05,
    posicaoNoMunicipio: null,
    eleitorado: null,
    ...over,
  };
}

function evidencia(over: Partial<TerritoryEvidence> = {}): TerritoryEvidence {
  return {
    ibgeCode: "5200000",
    nome: "Teste",
    atual: metricas(),
    anterior: null,
    similaridade: null,
    comparecimento: null,
    comparecimentoReferencia: null,
    ...over,
  };
}

// -------------------------------------------------------------------- Gower --

test("territórios idênticos têm distância zero e similaridade 100", () => {
  const valores = { densidade: 50, pibPerCapita: 30_000, alfabetizacao: 95 };
  const m = matriz([
    territorio("A", "A", valores),
    territorio("B", "B", valores),
    // Um terceiro só para o intervalo de cada variável não ser degenerado.
    territorio("C", "C", { densidade: 10, pibPerCapita: 10_000, alfabetizacao: 80 }),
  ]);
  const { distancia } = gowerDistance(m.territorios[0], m.territorios[1], m);
  assert.equal(distancia, 0);
});

test("extremos opostos do intervalo dão distância 1", () => {
  const m = matriz([
    territorio("A", "A", { densidade: 10 }),
    territorio("B", "B", { densidade: 110 }),
  ]);
  const { distancia } = gowerDistance(m.territorios[0], m.territorios[1], m);
  assert.equal(distancia, 1);
});

test("variável ausente sai da conta em vez de virar zero", () => {
  // A e B iguais em densidade; B não tem PIB. Se o ausente virasse 0, a
  // distância dispararia. Saindo da conta, permanece 0.
  const m = matriz([
    territorio("A", "A", { densidade: 50, pibPerCapita: 30_000 }),
    territorio("B", "B", { densidade: 50 }),
    territorio("C", "C", { densidade: 10, pibPerCapita: 10_000 }),
  ]);
  const { distancia, detalhes, ausentes } = gowerDistance(
    m.territorios[0],
    m.territorios[1],
    m,
  );
  assert.equal(distancia, 0);
  assert.equal(detalhes.length, 1, "só densidade era comparável");
  assert.ok(ausentes > 0);
});

test("sem nenhuma variável comparável, a distância é null e não zero", () => {
  const m = matriz([
    territorio("A", "A", { densidade: 50 }),
    territorio("B", "B", { pibPerCapita: 30_000 }),
  ]);
  const { distancia } = gowerDistance(m.territorios[0], m.territorios[1], m);
  assert.equal(distancia, null, "null = não sei; zero significaria idênticos");
});

test("variável constante em todo o estado não infla a similaridade", () => {
  // alfabetizacao igual em todos: amplitude 0. Se entrasse com distância 0,
  // puxaria toda comparação para "mais parecido do que realmente é".
  const m = matriz([
    territorio("A", "A", { densidade: 10, alfabetizacao: 95 }),
    territorio("B", "B", { densidade: 110, alfabetizacao: 95 }),
  ]);
  const { distancia, detalhes } = gowerDistance(m.territorios[0], m.territorios[1], m);
  assert.equal(detalhes.length, 1, "alfabetização constante precisa sair");
  assert.equal(distancia, 1);
});

test("similaridade sempre entre 0 e 100, e ordenada do mais parecido", () => {
  const m = matriz([
    territorio("A", "Ancora", { densidade: 50, pibPerCapita: 30_000, alfabetizacao: 95 }),
    territorio("B", "Perto", { densidade: 55, pibPerCapita: 31_000, alfabetizacao: 94 }),
    territorio("C", "Longe", { densidade: 5, pibPerCapita: 8_000, alfabetizacao: 70 }),
  ]);
  const resultados = findSimilarTerritories("A", m, { minimoDeFeatures: 1 });
  assert.equal(resultados.length, 2);
  assert.equal(resultados[0].ibgeCode, "B");
  for (const resultado of resultados) {
    assert.ok(resultado.similaridade >= 0 && resultado.similaridade <= 100);
  }
});

test("pares com pouquíssimas variáveis comparadas são descartados", () => {
  const m = matriz([
    territorio("A", "Ancora", { densidade: 50, pibPerCapita: 30_000 }),
    territorio("B", "QuaseVazio", { densidade: 50 }),
    territorio("C", "C", { densidade: 10, pibPerCapita: 10_000 }),
  ]);
  // Com mínimo 1, B entra (bate em densidade). Com mínimo 2, sai — uma
  // variável em comum não é evidência de perfil parecido.
  assert.ok(findSimilarTerritories("A", m, { minimoDeFeatures: 1 }).some((r) => r.ibgeCode === "B"));
  assert.ok(!findSimilarTerritories("A", m, { minimoDeFeatures: 2 }).some((r) => r.ibgeCode === "B"));
});

test("similaridade contra âncoras é a média das comparações válidas", () => {
  const m = matriz([
    territorio("X", "Alvo", { densidade: 50 }),
    territorio("A1", "Ancora1", { densidade: 50 }),
    territorio("A2", "Ancora2", { densidade: 150 }),
  ]);
  const { similaridade, comparacoes } = similarityToAnchors("X", ["A1", "A2"], m, {
    minimoDeFeatures: 1,
  });
  assert.equal(comparacoes, 2);
  // 100 (idêntico a A1) e 0 (extremo oposto de A2) -> média 50.
  assert.ok(similaridade !== null && Math.abs(similaridade - 50) < 1e-9);
});

test("âncora inexistente não derruba o cálculo", () => {
  const m = matriz([territorio("X", "Alvo", { densidade: 50 })]);
  const { similaridade, comparacoes } = similarityToAnchors("X", ["NAO_EXISTE"], m);
  assert.equal(similaridade, null);
  assert.equal(comparacoes, 0);
});

// ----------------------------------------------------------------- âncoras --

test("âncoras saem por LIFT, não por volume de votos", () => {
  const contest = {
    territorios: [
      // Colégio eleitoral gigante, desempenho medíocre.
      metricas({ ibgeCode: "GRANDE", nome: "Capital", votos: 50_000, validos: 900_000, lift: 0.9 }),
      // Cidade pequena com desempenho muito acima da média.
      metricas({ ibgeCode: "FORTE", nome: "Pequena forte", votos: 900, validos: 3_000, lift: 2.1 }),
    ],
  } as never;

  const ancoras = selectAnchors(contest);
  assert.deepEqual(
    ancoras.map((a) => a.ibgeCode),
    ["FORTE"],
    "usar os maiores colégios como âncora faria a similaridade virar 'cidade grande'",
  );
});

test("âncora precisa de volume mínimo — extremo minúsculo não entra", () => {
  const contest = {
    territorios: [
      metricas({ ibgeCode: "MINI", nome: "Minúsculo", votos: 20, validos: 40, lift: 3 }),
      metricas({ ibgeCode: "OK", nome: "Suficiente", votos: 900, validos: 3_000, lift: 1.5 }),
    ],
  } as never;
  assert.deepEqual(
    selectAnchors(contest).map((a) => a.ibgeCode),
    ["OK"],
  );
});

// ----------------------------------------------------- classificação por regra --

test("consolidação: lift alto e estável entre eleições", () => {
  const c = classifyTerritory(
    evidencia({
      atual: metricas({ lift: 1.5 }),
      anterior: metricas({ lift: 1.45 }),
    }),
  );
  assert.ok(c.tipos.includes("consolidacao"));
  assert.equal(c.tipoPrincipal, "consolidacao");
});

test("recuperação: queda proporcional relevante do lift", () => {
  const c = classifyTerritory(
    evidencia({
      atual: metricas({ lift: 0.9 }),
      anterior: metricas({ lift: 1.5 }),
    }),
  );
  assert.ok(c.tipos.includes("recuperacao"));
  assert.match(c.explicacao, /queda/i);
});

test("força pessoal: participação alta dentro do bloco partidário", () => {
  const c = classifyTerritory(
    evidencia({ atual: metricas({ participacaoNoBloco: 0.45 }) }),
  );
  assert.ok(c.tipos.includes("forcaPessoal"));
});

test("afinidade não convertida: bloco presente, candidatura com fatia pequena", () => {
  const c = classifyTerritory(
    evidencia({ atual: metricas({ participacaoNoBloco: 0.08, votos: 500 }) }),
  );
  assert.ok(c.tipos.includes("afinidadeNaoConvertida"));
});

test("nova fronteira exige perfil compatível E desempenho baixo", () => {
  const compativelFraco = classifyTerritory(
    evidencia({ atual: metricas({ lift: 0.5 }), similaridade: 85 }),
  );
  assert.ok(compativelFraco.tipos.includes("novaFronteira"));

  // Mesmo desempenho baixo, mas perfil incompatível: não é fronteira.
  const incompativel = classifyTerritory(
    evidencia({ atual: metricas({ lift: 0.5 }), similaridade: 30 }),
  );
  assert.ok(!incompativel.tipos.includes("novaFronteira"));
});

test("sem similaridade não há classificação por perfil, e isso vira aviso", () => {
  const c = classifyTerritory(
    evidencia({ atual: metricas({ lift: 0.5 }), similaridade: null }),
  );
  assert.ok(!c.tipos.includes("novaFronteira"));
  assert.ok(!c.tipos.includes("expansao"));
  assert.ok(c.avisos.some((aviso) => /[Ss]imilaridade indisponível/.test(aviso)));
});

test("mobilização exige perfil compatível e comparecimento abaixo da referência", () => {
  const c = classifyTerritory(
    evidencia({
      similaridade: 80,
      comparecimento: 0.7,
      comparecimentoReferencia: 0.8,
    }),
  );
  assert.ok(c.tipos.includes("mobilizacao"));

  const acima = classifyTerritory(
    evidencia({
      similaridade: 80,
      comparecimento: 0.85,
      comparecimentoReferencia: 0.8,
    }),
  );
  assert.ok(!acima.tipos.includes("mobilizacao"));
});

test("território pequeno demais é classificado COM aviso, nunca em silêncio", () => {
  const c = classifyTerritory(
    evidencia({ atual: metricas({ validos: 50, lift: 2.5 }) }),
  );
  assert.ok(
    c.avisos.some((aviso) => aviso.includes(String(LIMIARES.minimoDeValidos))),
  );
});

test("uma eleição só gera aviso de tendência indisponível", () => {
  const c = classifyTerritory(evidencia({ anterior: null }));
  assert.ok(c.avisos.some((aviso) => /uma eleição/i.test(aviso)));
});

test("tipo principal segue a ordem de prioridade declarada, não a de avaliação", () => {
  // Cai em recuperação E afinidade não convertida ao mesmo tempo.
  const c = classifyTerritory(
    evidencia({
      atual: metricas({ lift: 0.8, participacaoNoBloco: 0.05, votos: 400 }),
      anterior: metricas({ lift: 1.4 }),
    }),
  );
  assert.ok(c.tipos.includes("recuperacao"));
  assert.ok(c.tipos.includes("afinidadeNaoConvertida"));
  assert.equal(c.tipoPrincipal, "recuperacao", "recuperação tem prioridade sobre afinidade");
});

test("território sem enquadramento não é forçado num tipo", () => {
  const c = classifyTerritory(evidencia({ atual: metricas({ lift: 1, participacaoNoBloco: 0.2 }) }));
  assert.equal(c.tipoPrincipal, null);
  assert.equal(c.tipos.length, 0);
  assert.match(c.explicacao, /não sustentam uma classificação/);
});

// ------------------------------------------------------------- explicações --

test("a explicação nomeia o território, o tipo e o motivo", () => {
  const c = classifyTerritory(
    evidencia({
      nome: "Anápolis",
      atual: metricas({ lift: 1.6 }),
      anterior: metricas({ lift: 1.55 }),
    }),
  );
  assert.match(c.explicacao, /Anápolis/);
  assert.match(c.explicacao, /Base consolidada/);
  assert.match(c.explicacao, /classificado assim porque/);
});

test("a explicação NUNCA afirma causa nem fala de pessoas", () => {
  const casos = [
    evidencia({ atual: metricas({ lift: 1.6 }), anterior: metricas({ lift: 1.55 }) }),
    evidencia({ atual: metricas({ lift: 0.5 }), similaridade: 88 }),
    evidencia({ atual: metricas({ participacaoNoBloco: 0.45 }) }),
    evidencia({ similaridade: 80, comparecimento: 0.6, comparecimentoReferencia: 0.75 }),
  ];
  // Vocabulário proibido: linguagem causal e sujeito humano coletivo.
  const proibido =
    /\b(idosos|jovens|mulheres|homens|eleitores) (preferem|votam|votariam|apoiam)\b|\bpor causa d|\bcausa\b|\bgarantid|\bvai render\b|\bdará\b/i;
  for (const caso of casos) {
    const { explicacao } = classifyTerritory(caso);
    assert.ok(!proibido.test(explicacao), `linguagem causal em: ${explicacao}`);
  }
});

test("com similaridade, a explicação declara que é semelhança e não previsão", () => {
  const c = classifyTerritory(
    evidencia({ atual: metricas({ lift: 0.5 }), similaridade: 88 }),
  );
  assert.match(c.explicacao, /não\s+uma previsão/);
});

// ------------------------------------------------------------------ grupos --

test("um território aparece em todos os tipos em que se enquadra", () => {
  const c = classifyTerritory(
    evidencia({
      atual: metricas({ lift: 0.8, participacaoNoBloco: 0.05, votos: 400 }),
      anterior: metricas({ lift: 1.4 }),
    }),
  );
  const grupos = groupByType([c]);
  assert.equal(grupos.get("recuperacao")?.length, 1);
  assert.equal(grupos.get("afinidadeNaoConvertida")?.length, 1);
  assert.equal(grupos.get("consolidacao")?.length, 0);
});

// ------------------------------------------------- motivo x explicação --

test("motivo diz o porquê sem repetir nome, tipo e ressalva", () => {
  const c = classifyTerritory(
    evidencia({
      nome: "Anápolis",
      atual: metricas({ lift: 1.5 }),
      anterior: metricas({ lift: 1.45 }),
      similaridade: 80,
    }),
  );

  // O que o card mostra: só a razão.
  assert.match(c.motivo, /desempenho/i);
  assert.ok(!c.motivo.includes("Anápolis"), "o nome já está no título do card");
  assert.ok(
    !c.motivo.includes("Base consolidada"),
    "o tipo já está no rail e no cabeçalho",
  );
  assert.ok(
    !/previsão/.test(c.motivo),
    "a ressalva de similaridade é dita uma vez por lista, não uma por card",
  );

  // O que a exportação continua mostrando: a frase inteira, que precisa se
  // apresentar sozinha numa linha de PDF ou de planilha.
  assert.match(c.explicacao, /Anápolis/);
  assert.match(c.explicacao, /Base consolidada/);
  assert.match(c.explicacao, /não\s+uma previsão/);

  // E as duas não podem divergir: a razão da tela tem de estar na frase longa.
  assert.ok(
    c.explicacao.includes(c.motivo.replace(/\.$/, "")),
    "motivo e explicação precisam sair das MESMAS razões",
  );
});

test("território sem classificação tem motivo vazio, não frase inventada", () => {
  const c = classifyTerritory(
    evidencia({ atual: metricas({ lift: 1.0 }), anterior: null, similaridade: null }),
  );
  assert.equal(c.tipoPrincipal, null);
  assert.equal(c.motivo, "");
});
