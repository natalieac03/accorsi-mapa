import assert from "node:assert/strict";
import test from "node:test";
import type {
  CandidateContest,
  CandidateDataset,
  CandidateMunicipio,
  StatsIndicatorSource,
} from "../../src/types/candidate.ts";
import type { AnalysisMetricId } from "../../src/types/analysis.ts";
import {
  buildReportDataset,
  getAvailableIndicators,
  getUnavailableIndicators,
  orderIndicators,
  type ReportDataset,
} from "../../src/utils/reportDataset.ts";
import {
  buildReportAnalysis,
  classifyAssociation,
  collectAnalysisTexts,
  postosComEmpate,
  spearman,
  RESSALVA_CAUSALIDADE,
  RESSALVA_DADO_AGREGADO,
} from "../../src/utils/reportAnalysis.ts";
import { buildContestReport } from "../../src/utils/reportStats.ts";
import type { ReportDocument } from "../../src/utils/reportModel.ts";
import { PEARSON_MIN_N } from "../../src/utils/candidateStats.ts";

/**
 * MOTOR DE ANÁLISE DO RELATÓRIO — payloads SINTÉTICOS inline, nenhum teste
 * pulado. Os snapshots de `src/data` são placeholders nesta instalação, e o
 * motor precisa ser verificável antes de qualquer `gerar_dados.sh`.
 *
 * O que estes testes protegem, em ordem de gravidade:
 *
 * 1. O FILTRO DA TELA NÃO LIMITA O RELATÓRIO. É o defeito que motivou o
 *    motor: com "Mulheres" selecionado, o PDF saía com um cruzamento só e
 *    aparência de completo. O primeiro teste do arquivo trava isso;
 * 2. ausência nunca vira zero: município sem denominador fica fora, contado,
 *    e indicador sem dado vira omissão declarada — nunca some da lista;
 * 3. vocabulário: nenhum texto gerado diz causa, impacto, influência,
 *    preferência, determinou ou provocou;
 * 4. a aritmética declarada: Spearman com empates, cortes da classificação,
 *    quadrantes pela mediana, compatibilidade temporal propagada.
 */

/* -------------------------------------------------------------------------
 * Fixtures sintéticos
 * ------------------------------------------------------------------------- */

function municipio(
  nome: string,
  votos: number,
  overrides: Partial<CandidateMunicipio> = {},
): CandidateMunicipio {
  return {
    nome,
    votos,
    validos: votos * 40,
    percentualValidos: 2.5,
    votosDoPartido: votos * 2,
    percentualDoPartido: 5,
    posicaoNoMunicipio: 4,
    candidaturasComVoto: 120,
    ...overrides,
  };
}

/** Código IBGE sintético do estado configurado, estável por índice. */
function ibgeSintetico(indice: number): string {
  return `5200${String(indice).padStart(3, "0")}`;
}

/**
 * Pleito com `quantidade` municípios. `percentuais` define o % dos válidos de
 * cada um (null = município sem denominador apurado).
 */
function contest(input: {
  quantidade: number;
  percentuais?: Array<number | null>;
  votos?: number[];
  electionYear?: number;
  overrides?: Partial<CandidateContest>;
}): CandidateContest {
  const municipios: Record<string, CandidateMunicipio> = {};
  let total = 0;
  for (let indice = 0; indice < input.quantidade; indice += 1) {
    const votos = input.votos?.[indice] ?? 1000 - indice * 10;
    total += votos;
    const percentual =
      input.percentuais === undefined ? 2.5 : input.percentuais[indice];
    municipios[ibgeSintetico(indice)] = municipio(
      `Cidade ${String(indice).padStart(2, "0")}`,
      votos,
      {
        percentualValidos: percentual ?? null,
        ...(percentual === null ? { validos: 0, posicaoNoMunicipio: null } : {}),
      },
    );
  }
  return {
    id: `${input.electionYear ?? 2022}-6-1`,
    electionYear: input.electionYear ?? 2022,
    officeCode: 6,
    officeName: "Deputado Federal",
    round: 1,
    candidatura: {
      sqCandidato: "520001",
      nomeCompleto: "CANDIDATA SINTETICA",
      nomeUrna: "Sintética",
      partido: "PT",
      numero: "1313",
      situacaoCandidatura: "Deferido",
      resultado: "Eleita por QP",
    },
    votosNoEstado: total,
    posicaoNoEstado: 4,
    candidaturasNoPleito: 627,
    municipiosComVoto: input.quantidade,
    concentracaoPercentual: { top5: 0, top10: 0, top20: 0 },
    votosSemLocalDeVotacao: 0,
    temRecorteSubmunicipal: false,
    municipios,
    locais: null,
    bairros: null,
    ...input.overrides,
  };
}

function candidateDataset(contests: CandidateContest[]): CandidateDataset {
  return {
    metadata: {
      schemaVersion: 1,
      state: "GO",
      slug: "candidata-sintetica",
      pleitos: contests.length,
      anos: contests.map((item) => item.electionYear),
      cargos: ["Deputado Federal"],
      source: "TSE · Resultados por município",
      sourceUrl: "https://dadosabertos.tse.jus.br/",
    },
    contests,
  };
}

/**
 * Snapshot territorial sintético.
 *
 * `femininoPct` é exato por construção (eleitorado fixo em 100 mil), o que
 * permite conferir mediana e quadrantes na mão. `alfabetizados` cobre só os
 * primeiros `coberturaLiteracia` municípios — é o caso do indicador sem dado
 * suficiente.
 */
function fonte(input: {
  quantidade: number;
  femininoPct?: number[];
  coberturaLiteracia?: number;
  comSocioeconomico?: boolean;
  eleitoradoPendente?: boolean;
}): StatsIndicatorSource {
  const eleitorado = 100_000;
  const municipalities: StatsIndicatorSource["electorate"]["municipalities"] = {};
  const literacy: StatsIndicatorSource["literacy"]["municipalities"] = {};
  const socioeconomic: NonNullable<
    StatsIndicatorSource["socioeconomic"]
  >["municipalities"] = {};

  for (let indice = 0; indice < input.quantidade; indice += 1) {
    const ibge = ibgeSintetico(indice);
    const pct = input.femininoPct?.[indice] ?? 48 + indice * 0.2;
    municipalities[ibge] = {
      name: `Cidade ${String(indice).padStart(2, "0")}`,
      electorate: eleitorado,
      gender: {
        female: Math.round((pct / 100) * eleitorado),
        male: eleitorado - Math.round((pct / 100) * eleitorado),
        notInformed: 0,
      },
    };
    if (indice < (input.coberturaLiteracia ?? input.quantidade)) {
      literacy[ibge] = {
        literate15Plus: 90_000 + indice * 100,
        population15Plus: 100_000,
        literacyRate: 90 + indice * 0.1,
      };
    }
    if (input.comSocioeconomico) {
      socioeconomic[ibge] = {
        values: {
          populationEstimate: 50_000 + indice * 1_000,
          censusPopulation: 48_000 + indice * 1_000,
          populationDensity: 10 + indice * 3,
          gdpPerCapita: 20_000 + indice * 1_500,
          schoolAttendance: 96 + indice * 0.1,
          occupiedPopulation: 20 + indice * 0.5,
          formalAverageSalary: 1.8 + indice * 0.05,
          adequateSanitation: 30 + indice * 2,
          lowIncomePopulation: 40 - indice * 0.5,
        },
      };
    }
  }

  return {
    electorate: {
      metadata: input.eleitoradoPendente ? { status: "pendente" } : {},
      municipalities,
    },
    age: { metadata: {}, municipalities: {} },
    literacy: { metadata: {}, municipalities: literacy },
    ...(input.comSocioeconomico
      ? { socioeconomic: { metadata: {}, municipalities: socioeconomic } }
      : {}),
  };
}

/** Universo padrão: 12 municípios, associação positiva entre feminino e voto. */
function universoPadrao(): {
  contest: CandidateContest;
  dataset: ReportDataset;
} {
  const quantidade = 12;
  const percentuais = Array.from(
    { length: quantidade },
    (_, indice) => 1 + indice * 0.4,
  );
  const alvo = contest({ quantidade, percentuais });
  return {
    contest: alvo,
    dataset: buildReportDataset({ contest: alvo, source: fonte({ quantidade }) }),
  };
}

/* -------------------------------------------------------------------------
 * 1. O filtro da tela não limita o relatório
 * ------------------------------------------------------------------------- */

test("o mesmo reportDataset sai idêntico com activeViewFilter diferente", () => {
  const { contest: alvo } = universoPadrao();
  const source = fonte({ quantidade: 12, comSocioeconomico: true });

  // O universo é montado DUAS vezes, do zero, sem que nada da tela participe:
  // a assinatura de buildReportDataset nem sequer aceita um filtro.
  const primeiro = buildReportDataset({ contest: alvo, source });
  const segundo = buildReportDataset({ contest: alvo, source });
  assert.deepEqual(primeiro, segundo);

  const comFeminino = buildReportAnalysis({
    dataset: primeiro,
    activeViewFilter: { featuredIndicatorId: "female" },
  });
  const comPib = buildReportAnalysis({
    dataset: segundo,
    activeViewFilter: { featuredIndicatorId: "gdpPerCapita" },
  });
  const semFiltro = buildReportAnalysis({ dataset: primeiro });

  // 1. O conjunto de municípios é o mesmo, byte a byte.
  assert.deepEqual(comFeminino.dataset, comPib.dataset);
  assert.deepEqual(comFeminino.dataset, semFiltro.dataset);

  // 2. O conjunto de indicadores analisados é o mesmo — o filtro não exclui
  //    ninguém. Só a ORDEM muda.
  const ids = (analise: typeof comFeminino) =>
    analise.indicadores.map((item) => item.indicator.id);
  assert.deepEqual([...ids(comFeminino)].sort(), [...ids(comPib)].sort());
  assert.deepEqual([...ids(comFeminino)].sort(), [...ids(semFiltro)].sort());
  assert.equal(ids(comFeminino)[0], "female");
  assert.equal(ids(comPib)[0], "gdpPerCapita");
  assert.notDeepEqual(ids(comFeminino), ids(comPib));

  // 3. A ESTATÍSTICA de cada indicador é idêntica nas duas montagens.
  for (const item of comFeminino.indicadores) {
    const par = comPib.indicadores.find(
      (outro) => outro.indicator.id === item.indicator.id,
    );
    assert.ok(par, `${item.indicator.id} sumiu com o outro filtro`);
    if (!par) continue;
    assert.deepEqual(par.correlacao, item.correlacao);
    assert.deepEqual(par.grupos, item.grupos);
    assert.deepEqual(par.quadrantes, item.quadrantes);
    assert.deepEqual(par.atipicos, item.atipicos);
    assert.equal(par.interpretacao, item.interpretacao);
  }

  // 4. E o resumo, a concentração e as omissões também não mudam.
  assert.deepEqual(comFeminino.resumo, comPib.resumo);
  assert.deepEqual(comFeminino.concentracao, comPib.concentracao);
  assert.deepEqual(comFeminino.omissoes, comPib.omissoes);
});

test("o documento do pleito traz TODOS os cruzamentos, seja qual for o filtro", () => {
  const alvo = contest({
    quantidade: 12,
    percentuais: Array.from({ length: 12 }, (_, indice) => 1 + indice * 0.4),
  });
  const base = candidateDataset([alvo]);
  const reportDataset = buildReportDataset({
    contest: alvo,
    source: fonte({ quantidade: 12, comSocioeconomico: true }),
  });
  const gerar = (featuredIndicatorId: AnalysisMetricId): ReportDocument =>
    buildContestReport({
      dataset: base,
      contest: alvo,
      reportDataset,
      activeViewFilter: { featuredIndicatorId },
      generatedAt: new Date("2026-08-17T17:32:00Z"),
    });

  const comFeminino = gerar("female");
  const comPib = gerar("gdpPerCapita");

  const cruzamentos = (doc: ReportDocument) =>
    doc.tables.filter((tabela) => tabela.id.startsWith("cruzamento-"));

  // O documento com "Mulheres" em destaque NÃO tem só o cruzamento feminino:
  // era exatamente esse o defeito.
  assert.ok(cruzamentos(comFeminino).length > 1);
  assert.deepEqual(
    cruzamentos(comFeminino)
      .map((tabela) => tabela.id)
      .sort(),
    cruzamentos(comPib)
      .map((tabela) => tabela.id)
      .sort(),
  );

  // E as LINHAS de cada cruzamento são as mesmas nos dois documentos.
  for (const tabela of cruzamentos(comFeminino)) {
    const par = cruzamentos(comPib).find((outra) => outra.id === tabela.id);
    assert.ok(par);
    if (!par) continue;
    assert.deepEqual(par.rows, tabela.rows);
  }

  // O quadro municipal também é idêntico: ele não herda métrica da tela.
  const quadro = (doc: ReportDocument) =>
    doc.tables.find((tabela) => tabela.id === "municipios");
  assert.deepEqual(quadro(comPib)?.rows, quadro(comFeminino)?.rows);
  assert.equal(quadro(comFeminino)?.rows.length, 12);

  // O destaque muda só qual indicador ganha as tabelas de detalhe.
  assert.ok(comFeminino.tables.some((tabela) => tabela.id === "quadrantes-female"));
  assert.ok(comPib.tables.some((tabela) => tabela.id === "quadrantes-gdpPerCapita"));
});

test("orderIndicators põe o destaque na frente e mantém a ordem do catálogo", () => {
  const { dataset } = universoPadrao();
  const disponiveis = getAvailableIndicators(dataset);
  const semDestaque = orderIndicators(disponiveis, null).map((item) => item.id);
  const comDestaque = orderIndicators(disponiveis, "literacyRate15Plus").map(
    (item) => item.id,
  );
  assert.equal(comDestaque[0], "literacyRate15Plus");
  assert.deepEqual([...comDestaque].sort(), [...semDestaque].sort());
  // Tirando o destaque, a ordem continua sendo a do catálogo.
  assert.deepEqual(
    comDestaque.filter((id) => id !== "literacyRate15Plus"),
    semDestaque.filter((id) => id !== "literacyRate15Plus"),
  );
  // Destaque sem dado no recorte não inventa capítulo nem remove nenhum.
  const inexistente = orderIndicators(disponiveis, "occupiedPopulation").map(
    (item) => item.id,
  );
  assert.deepEqual(inexistente, semDestaque);
});

/* -------------------------------------------------------------------------
 * 2. Ausência nunca vira zero
 * ------------------------------------------------------------------------- */

test("indicador sem dado suficiente vira omissão declarada, não some", () => {
  const alvo = contest({ quantidade: 12 });
  const dataset = buildReportDataset({
    contest: alvo,
    // Alfabetização cobre 3 dos 12 municípios: abaixo do mínimo de amostra.
    source: fonte({ quantidade: 12, coberturaLiteracia: 3 }),
  });

  const literacia = dataset.indicadores.find(
    (item) => item.id === "literacyRate15Plus",
  );
  assert.ok(literacia);
  if (!literacia) return;
  assert.equal(literacia.disponivel, false);
  assert.equal(literacia.cobertura, 3);
  assert.equal(literacia.semValor, 9);
  assert.match(literacia.motivoIndisponibilidade ?? "", /só 3 de 12/);
  assert.match(
    literacia.motivoIndisponibilidade ?? "",
    new RegExp(`mínimo de ${PEARSON_MIN_N}`),
  );

  // O indicador continua listado no dataset (nada é escondido) e aparece nas
  // omissões declaradas do relatório.
  assert.ok(dataset.indicadores.some((item) => item.id === "literacyRate15Plus"));
  const analise = buildReportAnalysis({ dataset });
  assert.ok(
    !analise.indicadores.some((item) => item.indicator.id === "literacyRate15Plus"),
  );
  assert.ok(
    analise.omissoes.some((omissao) =>
      omissao.title.includes("Alfabetização 15+"),
    ),
  );
});

test("indicador do IBGE sem snapshot não entra valendo zero", () => {
  const alvo = contest({ quantidade: 12 });
  const semIbge = buildReportDataset({
    contest: alvo,
    source: fonte({ quantidade: 12 }),
  });
  const comIbge = buildReportDataset({
    contest: alvo,
    source: fonte({ quantidade: 12, comSocioeconomico: true }),
  });

  assert.equal(semIbge.socioeconomicoDisponivel, false);
  assert.equal(comIbge.socioeconomicoDisponivel, true);

  const pibSem = semIbge.indicadores.find((item) => item.id === "gdpPerCapita");
  assert.equal(pibSem?.disponivel, false);
  assert.equal(pibSem?.cobertura, 0);
  // Todos os municípios ficam com null — nenhum com 0.
  for (const municipioLinha of semIbge.municipios) {
    assert.equal(municipioLinha.indicadores.gdpPerCapita, null);
    assert.equal(municipioLinha.indicadores.populationDensity, null);
    assert.equal(municipioLinha.indicadores.formalAverageSalary, null);
  }

  const pibCom = comIbge.indicadores.find((item) => item.id === "gdpPerCapita");
  assert.equal(pibCom?.disponivel, true);
  assert.equal(comIbge.municipios[0].indicadores.gdpPerCapita !== null, true);
  // Renda, população e urbanização (densidade) chegam ao relatório.
  const analise = buildReportAnalysis({ dataset: comIbge });
  const analisados = analise.indicadores.map((item) => item.indicator.id);
  for (const id of [
    "gdpPerCapita",
    "populationDensity",
    "censusPopulation",
    "formalAverageSalary",
  ] as AnalysisMetricId[]) {
    assert.ok(analisados.includes(id), `${id} deveria estar analisado`);
  }
});

test("campo bruto ausente no snapshot não vira indicador zerado", () => {
  // O insumo não traz biometria, deficiência, nome social nem zonas: esses
  // indicadores NÃO podem sair com 0% em todos os municípios (o que seria um
  // dado sintético com variância zero entrando em correlação).
  const alvo = contest({ quantidade: 12 });
  const dataset = buildReportDataset({
    contest: alvo,
    source: fonte({ quantidade: 12 }),
  });
  for (const id of [
    "biometrics",
    "disability",
    "socialName",
    "electorsPerZone",
  ] as AnalysisMetricId[]) {
    const disponibilidade = dataset.indicadores.find((item) => item.id === id);
    assert.equal(disponibilidade?.disponivel, false, `${id} não pode ser analisado`);
    assert.equal(disponibilidade?.cobertura, 0, `${id} não tem dado no insumo`);
    for (const linha of dataset.municipios) {
      assert.equal(linha.indicadores[id], null, `${id} não pode valer zero`);
    }
  }
});

test("município sem denominador fica fora da análise — e nunca vira zero", () => {
  const percentuais: Array<number | null> = Array.from(
    { length: 12 },
    (_, indice) => 1 + indice * 0.4,
  );
  // Dois municípios sem total de válidos apurado.
  percentuais[3] = null;
  percentuais[7] = null;
  const alvo = contest({ quantidade: 12, percentuais });
  const dataset = buildReportDataset({
    contest: alvo,
    source: fonte({ quantidade: 12 }),
  });

  assert.equal(dataset.municipios.length, 12);
  assert.equal(dataset.analiticos.length, 10);
  assert.equal(dataset.exclusoes.length, 2);
  for (const exclusao of dataset.exclusoes) {
    assert.equal(exclusao.motivo, "sem-percentual-valido");
    assert.match(exclusao.descricao, /não entra como zero/);
  }

  // O percentual continua null no conjunto — jamais 0.
  const excluido = dataset.municipios.find(
    (linha) => linha.ibgeCode === ibgeSintetico(3),
  );
  assert.equal(excluido?.percentualValidos, null);
  assert.ok((excluido?.votos ?? 0) > 0);

  const analise = buildReportAnalysis({ dataset });
  const feminino = analise.indicadores.find(
    (item) => item.indicator.id === "female",
  );
  assert.ok(feminino);
  if (!feminino) return;

  // n é o dos municípios COM denominador; os dois excluídos não entram.
  assert.equal(feminino.correlacao.n, 10);
  const soma = (feminino.grupos?.grupos ?? []).reduce(
    (total, grupo) => total + grupo.municipios,
    0,
  );
  assert.equal(soma, 10);
  assert.equal(
    feminino.quadrantes?.quadrantes.reduce(
      (total, quadrante) => total + quadrante.municipios,
      0,
    ),
    10,
  );

  // A nota do relatório declara quantos ficaram fora e por quê.
  assert.match(analise.notaExclusoes, /2 de 12/);
  assert.equal(analise.municipiosExcluidos, 2);

  // Mas os votos deles seguem contados: a concentração usa os 12.
  assert.equal(analise.concentracao.municipios, 12);
});

test("snapshot do eleitorado pendente deixa TODOS os indicadores declarados", () => {
  const alvo = contest({ quantidade: 12 });
  const dataset = buildReportDataset({
    contest: alvo,
    source: fonte({ quantidade: 12, eleitoradoPendente: true }),
  });
  assert.equal(dataset.perfisDisponiveis, false);
  assert.equal(getAvailableIndicators(dataset).length, 0);
  assert.equal(getUnavailableIndicators(dataset).length, dataset.indicadores.length);
  for (const item of dataset.indicadores) {
    assert.match(item.motivoIndisponibilidade ?? "", /gerar_dados\.sh/);
  }
  // O universo de VOTOS continua completo: o que falta é o dado territorial.
  assert.equal(dataset.municipios.length, 12);
  assert.equal(dataset.eleitoradoCoberto, null);
});

/* -------------------------------------------------------------------------
 * 3. Vocabulário proibido
 * ------------------------------------------------------------------------- */

/**
 * Termos banidos do texto automático. O padrão é sobre o texto SEM acento e
 * em minúsculas, com fronteira de palavra: "causalidade" (que aparece na
 * ressalva obrigatória) não pode disparar o alarme de "causa".
 */
const PROIBIDOS: Array<{ termo: string; padrao: RegExp }> = [
  { termo: "causa", padrao: /\bcausa(?:s|r|ram|va|do|dor|dora|ndo)?\b/ },
  { termo: "causou", padrao: /\bcausou\b/ },
  { termo: "impacto", padrao: /\bimpact\w*/ },
  { termo: "influência", padrao: /\binfluenc\w*/ },
  { termo: "preferência", padrao: /\bprefer\w*/ },
  { termo: "determinou", padrao: /\bdetermin\w*/ },
  { termo: "provocou", padrao: /\bprovoc\w*/ },
];

function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function encontrarProibidos(textos: string[]): string[] {
  const achados: string[] = [];
  for (const texto of textos) {
    const alvo = normalizar(texto);
    for (const { termo, padrao } of PROIBIDOS) {
      if (padrao.test(alvo)) achados.push(`${termo} em: ${texto}`);
    }
  }
  return achados;
}

test("a varredura de vocabulário pega o que precisa pegar", () => {
  // Se o padrão quebrar, este teste falha ANTES do de baixo passar em falso.
  assert.equal(
    encontrarProibidos([
      "O indicador causa o resultado",
      "O impacto da renda",
      "A influência do eleitorado",
      "A preferência das eleitoras",
      "O indicador determinou o resultado",
      "O indicador provocou o resultado",
    ]).length,
    6,
  );
  // E não pode confundir "causalidade", que é palavra da ressalva obrigatória.
  assert.deepEqual(encontrarProibidos([RESSALVA_CAUSALIDADE]), []);
});

test("nenhum texto gerado usa o vocabulário proibido", () => {
  const alvo = contest({
    quantidade: 12,
    percentuais: Array.from({ length: 12 }, (_, indice) =>
      indice === 5 ? null : 1 + indice * 0.4,
    ),
  });
  const dataset = buildReportDataset({
    contest: alvo,
    source: fonte({ quantidade: 12, comSocioeconomico: true, coberturaLiteracia: 2 }),
  });
  const analise = buildReportAnalysis({
    dataset,
    activeViewFilter: { featuredIndicatorId: "female" },
  });
  assert.deepEqual(encontrarProibidos(collectAnalysisTexts(analise)), []);

  // E o documento inteiro: títulos, subtítulos, notas, omissões e cartões.
  const doc = buildContestReport({
    dataset: candidateDataset([alvo]),
    contest: alvo,
    reportDataset: dataset,
    activeViewFilter: { featuredIndicatorId: "female" },
    generatedAt: new Date("2026-08-17T17:32:00Z"),
  });
  const textos: string[] = [doc.title, doc.subtitle, doc.scope];
  for (const tabela of doc.tables) {
    textos.push(tabela.title, tabela.subtitle ?? "", ...(tabela.notes ?? []));
    for (const linha of tabela.rows) {
      for (const celula of linha) {
        if (typeof celula === "string") textos.push(celula);
      }
    }
  }
  for (const omissao of doc.omitted) textos.push(omissao.title, omissao.reason);
  for (const destaque of doc.highlights) {
    textos.push(destaque.label, destaque.note ?? "");
  }
  assert.deepEqual(encontrarProibidos(textos), []);
});

test("toda análise carrega as duas ressalvas obrigatórias", () => {
  const { dataset } = universoPadrao();
  const analise = buildReportAnalysis({ dataset });
  assert.deepEqual(analise.ressalvas, [
    RESSALVA_CAUSALIDADE,
    RESSALVA_DADO_AGREGADO,
  ]);
  assert.ok(analise.indicadores.length > 0);
  for (const item of analise.indicadores) {
    assert.ok(item.ressalvas.includes(RESSALVA_CAUSALIDADE));
    assert.ok(item.ressalvas.includes(RESSALVA_DADO_AGREGADO));
    // A limitação conhecida do indicador acompanha a análise.
    assert.ok(item.ressalvas.includes(item.indicator.limitation));
  }
});

/* -------------------------------------------------------------------------
 * 4. Aritmética declarada
 * ------------------------------------------------------------------------- */

test("postos empatados recebem o posto médio", () => {
  assert.deepEqual(postosComEmpate([10, 20, 20, 30]), [1, 2.5, 2.5, 4]);
  assert.deepEqual(postosComEmpate([5, 5, 5]), [2, 2, 2]);
  // A ordem de leitura não pode decidir quem fica na frente num empate.
  assert.deepEqual(postosComEmpate([2, 1, 2]), [2.5, 1, 2.5]);
});

test("Spearman trata empates por posto médio, não pela fórmula abreviada", () => {
  const pontos = [
    { x: 1, y: 2 },
    { x: 2, y: 2 },
    { x: 3, y: 3 },
    { x: 4, y: 4 },
    { x: 5, y: 4 },
  ];
  const coeficiente = spearman(pontos);
  assert.ok(coeficiente !== null);
  if (coeficiente === null) return;
  // Pearson sobre os postos [1..5] e [1,5;1,5;3;4,5;4,5] = 9/√90.
  assert.ok(Math.abs(coeficiente - 9 / Math.sqrt(90)) < 1e-12);
  // A fórmula 1-6Σd²/n(n²-1), que só vale sem empate, daria 0,95.
  assert.ok(Math.abs(coeficiente - 0.95) > 1e-3);

  // Sem empate, as duas definições coincidem.
  const semEmpate = spearman([
    { x: 1, y: 1 },
    { x: 2, y: 2 },
    { x: 3, y: 3 },
  ]);
  assert.equal(semEmpate, 1);

  // Monotônico: o coeficiente de postos não muda com transformação log.
  const cru = [
    { x: 10, y: 1 },
    { x: 100, y: 3 },
    { x: 1000, y: 2 },
    { x: 10000, y: 5 },
  ];
  assert.equal(
    spearman(cru),
    spearman(cru.map((ponto) => ({ x: Math.log10(ponto.x), y: ponto.y }))),
  );
});

test("a classificação respeita os cortes declarados", () => {
  const casos: Array<[number, string, string]> = [
    [0.19, "sem associação clara", "fraca"],
    [-0.19, "sem associação clara", "fraca"],
    [0.2, "positiva", "fraca"],
    [-0.2, "negativa", "fraca"],
    [0.39, "positiva", "fraca"],
    [0.4, "positiva", "moderada"],
    [-0.4, "negativa", "moderada"],
    [0.59, "positiva", "moderada"],
    [0.6, "positiva", "forte"],
    [-0.6, "negativa", "forte"],
    [1, "positiva", "forte"],
  ];
  for (const [coeficiente, direcao, intensidade] of casos) {
    const classificacao = classifyAssociation(coeficiente);
    assert.equal(classificacao.direction, direcao, `direção de ${coeficiente}`);
    assert.equal(classificacao.strength, intensidade, `força de ${coeficiente}`);
  }
  // Sem coeficiente não há classificação inventada.
  const semDado = classifyAssociation(null);
  assert.equal(semDado.direction, "sem associação clara");
  assert.equal(semDado.coeficiente, null);
  // O critério é publicado junto, sempre.
  assert.match(classifyAssociation(0.5).criterio, /Spearman/);
});

test("comparação de grupos corta pela mediana e mede dispersão", () => {
  const { dataset } = universoPadrao();
  const analise = buildReportAnalysis({ dataset });
  const feminino = analise.indicadores.find(
    (item) => item.indicator.id === "female",
  );
  assert.ok(feminino?.grupos);
  if (!feminino?.grupos) return;

  // 12 municípios, feminino de 48,0% a 50,2% em passos de 0,2 -> mediana 49,1.
  assert.ok(Math.abs(feminino.grupos.corte - 49.1) < 1e-9);
  const [acima, abaixo] = feminino.grupos.grupos;
  assert.equal(acima.municipios, 6);
  assert.equal(abaixo.municipios, 6);
  assert.equal(acima.eleitoradoCoberto, 600_000);
  // Percentuais 1,0…5,4 em passos de 0,4: mediana do grupo alto 4,4; do baixo 2,0.
  assert.ok(Math.abs((acima.medianaPctValidos ?? 0) - 4.4) < 1e-9);
  assert.ok(Math.abs((abaixo.medianaPctValidos ?? 0) - 2.0) < 1e-9);
  assert.ok(Math.abs((feminino.grupos.diferencaMediana ?? 0) - 2.4) < 1e-9);
  assert.ok((acima.desvioPadraoPctValidos ?? 0) > 0);
  assert.ok((acima.amplitudeInterquartilPctValidos ?? 0) > 0);
  assert.match(feminino.grupos.criterio, /mediana/);
});

test("quadrantes saem das medianas dos dois eixos e param em 5 exemplos", () => {
  // Indicador crescente, votação em zigue-zague: cada quadrante com 3.
  const percentuais = [10, 11, 12, 1, 2, 3, 13, 14, 15, 4, 5, 6];
  const alvo = contest({ quantidade: 12, percentuais });
  const dataset = buildReportDataset({
    contest: alvo,
    source: fonte({ quantidade: 12 }),
  });
  const analise = buildReportAnalysis({ dataset });
  const feminino = analise.indicadores.find(
    (item) => item.indicator.id === "female",
  );
  assert.ok(feminino?.quadrantes);
  if (!feminino?.quadrantes) return;

  assert.ok(Math.abs(feminino.quadrantes.medianaIndicador - 49.1) < 1e-9);
  assert.equal(feminino.quadrantes.medianaPercentualValidos, 8);
  for (const quadrante of feminino.quadrantes.quadrantes) {
    assert.equal(quadrante.municipios, 3, quadrante.label);
    // Nome NEUTRO: descreve o corte, não uma decisão de campanha.
    assert.match(quadrante.label, /mediana/);
    assert.doesNotMatch(quadrante.label, /oportunidade|ameaça|prioridade/i);
  }

  // Com associação monotônica, dois quadrantes ficam com 6 municípios — e a
  // lista de exemplos para em 5.
  const { dataset: monotonico } = universoPadrao();
  const monotonica = buildReportAnalysis({ dataset: monotonico });
  const quadrantes = monotonica.indicadores.find(
    (item) => item.indicator.id === "female",
  )?.quadrantes;
  assert.ok(quadrantes);
  if (!quadrantes) return;
  const cheio = quadrantes.quadrantes.find(
    (quadrante) => quadrante.id === "indicadorAcimaVotacaoAcima",
  );
  assert.equal(cheio?.municipios, 6);
  assert.equal(cheio?.exemplos.length, 5);
  assert.equal(cheio?.limiteExemplos, 5);
});

test("municípios atípicos usam o resíduo padronizado declarado", () => {
  const percentuais = Array.from({ length: 12 }, (_, indice) => 1 + indice * 0.4);
  // Um município muito acima da tendência: é o que a lista precisa achar.
  percentuais[6] = 40;
  const alvo = contest({ quantidade: 12, percentuais });
  const dataset = buildReportDataset({
    contest: alvo,
    source: fonte({ quantidade: 12 }),
  });
  const feminino = buildReportAnalysis({ dataset }).indicadores.find(
    (item) => item.indicator.id === "female",
  );
  assert.ok(feminino);
  if (!feminino) return;
  const atipicos = feminino.atipicos;
  assert.equal(atipicos.limite, 2);
  assert.equal(atipicos.municipios.length, 1);
  assert.equal(atipicos.municipios[0].nome, "Cidade 06");
  assert.equal(atipicos.municipios[0].sentido, "acima da tendência");
  assert.ok(Math.abs(atipicos.municipios[0].residuoPadronizado) > 2);
  assert.match(atipicos.criterio, /desvios padrão dos resíduos/);

  // Sem afastamento, a lista é vazia — e não um "top N" inventado.
  const { dataset: comportado } = universoPadrao();
  const semAtipicos = buildReportAnalysis({ dataset: comportado }).indicadores.find(
    (item) => item.indicator.id === "female",
  );
  assert.deepEqual(semAtipicos?.atipicos.municipios, []);
});

test("compatibilidade temporal é propagada para cada indicador", () => {
  // Eleição de 2010 contra indicador do eleitorado de 2026: leitura exploratória.
  const antigo = contest({
    quantidade: 12,
    percentuais: Array.from({ length: 12 }, (_, indice) => 1 + indice * 0.4),
    electionYear: 2010,
  });
  const datasetAntigo = buildReportDataset({
    contest: antigo,
    source: fonte({ quantidade: 12 }),
  });
  const analiseAntiga = buildReportAnalysis({ dataset: datasetAntigo });
  const feminino = analiseAntiga.indicadores.find(
    (item) => item.indicator.id === "female",
  );
  assert.ok(feminino);
  if (!feminino) return;
  assert.equal(feminino.compatibilidade.electionYear, 2010);
  assert.equal(feminino.compatibilidade.indicatorYear, 2026);
  assert.equal(feminino.compatibilidade.gap, 16);
  assert.equal(feminino.compatibilidade.level, "exploratorio");
  assert.ok(feminino.ressalvas.includes(feminino.compatibilidade.notice));

  // O aviso chega ao documento, junto da tabela do cruzamento.
  const doc = buildContestReport({
    dataset: candidateDataset([antigo]),
    contest: antigo,
    reportDataset: datasetAntigo,
    generatedAt: new Date("2026-08-17T17:32:00Z"),
  });
  const tabela = doc.tables.find((item) => item.id === "cruzamento-female");
  assert.ok(tabela?.notes?.includes(feminino.compatibilidade.notice));

  // Eleição no mesmo ano do indicador: nada a avisar, e nada inventado.
  const mesmoAno = contest({
    quantidade: 12,
    percentuais: Array.from({ length: 12 }, (_, indice) => 1 + indice * 0.4),
    electionYear: 2026,
  });
  const analiseAtual = buildReportAnalysis({
    dataset: buildReportDataset({
      contest: mesmoAno,
      source: fonte({ quantidade: 12 }),
    }),
  });
  const atual = analiseAtual.indicadores.find(
    (item) => item.indicator.id === "female",
  );
  assert.equal(atual?.compatibilidade.level, "mesmo-ano");
  assert.equal(atual?.compatibilidade.notice, "");
});

test("concentração acumula sobre todos os municípios com voto", () => {
  const votos = [500, 200, 100, 100, 50, 20, 10, 8, 6, 4, 1, 1];
  const alvo = contest({ quantidade: 12, votos });
  const dataset = buildReportDataset({
    contest: alvo,
    source: fonte({ quantidade: 12 }),
  });
  const { concentracao } = buildReportAnalysis({ dataset });
  const total = votos.reduce((soma, valor) => soma + valor, 0);
  assert.equal(concentracao.totalVotos, total);
  assert.equal(concentracao.municipios, 12);
  assert.equal(concentracao.pontos[0].nome, "Cidade 00");
  assert.ok(
    Math.abs((concentracao.top5Pct ?? 0) - ((500 + 200 + 100 + 100 + 50) / total) * 100) <
      1e-9,
  );
  assert.equal(concentracao.top20Pct, 100);
  // 500 de 1000 votos: o primeiro município já reúne metade.
  assert.equal(concentracao.municipiosParaMetade, 1);
  assert.ok(Math.abs(concentracao.pontos[11].acumuladoPct - 100) < 1e-9);
});

test("o resumo executivo tem no máximo quatro frases, só de número apurado", () => {
  const { dataset } = universoPadrao();
  const analise = buildReportAnalysis({ dataset });
  assert.ok(analise.resumo.frases.length > 0);
  assert.ok(analise.resumo.frases.length <= 4);
  const texto = analise.resumo.frases.join(" ");
  assert.match(texto, /Eleição de 2022/);
  assert.match(texto, /municípios de Goiás/);
  assert.match(texto, /indicadores territoriais/);
  assert.deepEqual(encontrarProibidos(analise.resumo.frases), []);
});

test("interpretação sem amostra diz que não há coeficiente, em vez de inventar", () => {
  // Cinco municípios: abaixo do mínimo de amostra.
  const alvo = contest({ quantidade: 5, percentuais: [1, 2, 3, 4, 5] });
  const dataset = buildReportDataset({
    contest: alvo,
    source: fonte({ quantidade: 5 }),
  });
  assert.equal(getAvailableIndicators(dataset).length, 0);
  const analise = buildReportAnalysis({ dataset });
  assert.deepEqual(analise.indicadores, []);
  assert.ok(analise.omissoes.length > 0);
  for (const omissao of analise.omissoes) {
    assert.match(omissao.reason, /5 municípios|abaixo do mínimo|só 5 de 5/);
  }
});
