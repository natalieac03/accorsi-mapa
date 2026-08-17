import assert from "node:assert/strict";
import test from "node:test";
import type {
  CandidateContest,
  CandidateDataset,
  CandidateMunicipio,
  StatsIndicatorSource,
} from "../../src/types/candidate.ts";
import type { AnalysisMetricId } from "../../src/types/analysis.ts";
import { buildReportDataset } from "../../src/utils/reportDataset.ts";
import { buildContestReport } from "../../src/utils/reportStats.ts";
import { buildReportAnalysis } from "../../src/utils/reportAnalysis.ts";
import {
  MAX_CAPITULOS_RESUMIDO,
  selecionarIndicadoresResumidos,
} from "../../src/utils/reportNarrative.ts";
import { buildReportFilename } from "../../src/utils/reportModel.ts";
import { buildPdfBuffer, renderReportPdf } from "../../src/utils/exportPdf.ts";
import type {
  ReportBlock,
  ReportChart,
  ReportDocument,
  ReportSection,
} from "../../src/utils/reportModel.ts";

/**
 * O DOCUMENTO ANALÍTICO DO PDF — payload sintético inline, nenhum teste pulado.
 *
 * O que estes testes protegem, em ordem de gravidade:
 *
 * 1. O FILTRO DA TELA NÃO LIMITA O PDF. Com "Mulheres" selecionado, o
 *    documento tem de trazer a seção de TODOS os indicadores com dado, o mesmo
 *    universo de municípios e o MESMO TÍTULO. O filtro só reordena e destaca;
 * 2. o título é sempre geral ("Desempenho eleitoral — ano · cargo"), nunca o
 *    nome do indicador selecionado;
 * 3. o anexo municipal sai DESLIGADO por padrão — a base completa é do Excel;
 * 4. ausência vira travessão no papel, nunca zero;
 * 5. todo gráfico tem descrição textual, legenda e unidade declarada: o
 *    gráfico não pode ser a única forma de ler o dado.
 */

const AGORA = new Date("2026-08-17T17:32:00Z");
const QUANTIDADE = 14;

/**
 * O travessão como ele chega ao arquivo. As fontes padrão do PDF gravam em
 * cp1252, onde o travessão é o byte 0x97; lendo o buffer como latin1 ele volta
 * como U+0097 — a mesma marca que o pdftotext reconverte para o travessão.
 */
const TRAVESSAO_CP1252 = String.fromCharCode(0x97);

function ibgeSintetico(indice: number) {
  return `5200${String(indice).padStart(3, "0")}`;
}

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

/**
 * Pleito com `QUANTIDADE` municípios. O de índice 5 entra SEM denominador
 * apurado: é o município que precisa sair do universo analítico contado e
 * declarado, e virar travessão no papel.
 */
function contest(): CandidateContest {
  const municipios: Record<string, CandidateMunicipio> = {};
  let total = 0;
  for (let indice = 0; indice < QUANTIDADE; indice += 1) {
    const votos = 1000 - indice * 40;
    total += votos;
    municipios[ibgeSintetico(indice)] = municipio(
      `Cidade ${String(indice).padStart(2, "0")}`,
      votos,
      indice === 5
        ? { percentualValidos: null, validos: 0, posicaoNoMunicipio: null }
        : { percentualValidos: 1 + indice * 0.4 },
    );
  }
  return {
    id: "2022-6-1",
    electionYear: 2022,
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
    municipiosComVoto: QUANTIDADE,
    concentracaoPercentual: { top5: 0, top10: 0, top20: 0 },
    votosSemLocalDeVotacao: 0,
    temRecorteSubmunicipal: false,
    municipios,
    locais: null,
    bairros: null,
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

/** Snapshot territorial sintético, com socioeconômico e alfabetização. */
function fonte(): StatsIndicatorSource {
  const eleitorado = 100_000;
  const electorate: StatsIndicatorSource["electorate"]["municipalities"] = {};
  const literacy: StatsIndicatorSource["literacy"]["municipalities"] = {};
  const socioeconomic: NonNullable<
    StatsIndicatorSource["socioeconomic"]
  >["municipalities"] = {};
  for (let indice = 0; indice < QUANTIDADE; indice += 1) {
    const ibge = ibgeSintetico(indice);
    const pct = 48 + indice * 0.4;
    electorate[ibge] = {
      name: `Cidade ${String(indice).padStart(2, "0")}`,
      electorate: eleitorado + indice * 1_000,
      gender: {
        female: Math.round((pct / 100) * eleitorado),
        male: eleitorado - Math.round((pct / 100) * eleitorado),
        notInformed: 0,
      },
    };
    literacy[ibge] = {
      literate15Plus: 90_000 + indice * 100,
      population15Plus: 100_000,
      literacyRate: 90 + indice * 0.1,
    };
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
  return {
    electorate: { metadata: {}, municipalities: electorate },
    age: { metadata: {}, municipalities: {} },
    literacy: { metadata: {}, municipalities: literacy },
    socioeconomic: { metadata: {}, municipalities: socioeconomic },
  };
}

const ALVO = contest();
const BASE = candidateDataset([ALVO]);
const UNIVERSO = buildReportDataset({ contest: ALVO, source: fonte() });

function documento(featured: AnalysisMetricId | null): ReportDocument {
  return buildContestReport({
    dataset: BASE,
    contest: ALVO,
    reportDataset: UNIVERSO,
    activeViewFilter: featured ? { featuredIndicatorId: featured } : null,
    generatedAt: AGORA,
  });
}

function secoes(doc: ReportDocument): ReportSection[] {
  return doc.sections ?? [];
}

function idsDeIndicador(doc: ReportDocument): string[] {
  return secoes(doc)
    .map((secao) => secao.id)
    .filter((id) => id.startsWith("indicador-"));
}

function blocos(doc: ReportDocument): ReportBlock[] {
  return secoes(doc).flatMap((secao) => secao.blocks);
}

function graficos(doc: ReportDocument): ReportChart[] {
  const lista: ReportChart[] = [];
  for (const bloco of blocos(doc)) {
    if (bloco.kind === "grafico") lista.push(bloco.chart);
  }
  return lista;
}

/* -------------------------------------------------------------------------
 * 1. O filtro da tela ordena e destaca — não limita
 * ------------------------------------------------------------------------- */

test("o PDF traz TODAS as seções de indicador, seja qual for o filtro da tela", () => {
  const semFiltro = documento(null);
  const comMulheres = documento("female");
  const comPib = documento("gdpPerCapita");

  const ids = idsDeIndicador(semFiltro);
  assert.ok(ids.length > 3, `esperava vários capítulos, veio ${ids.length}`);

  // O mesmo CONJUNTO nos três documentos: o filtro não exclui capítulo nenhum.
  for (const outro of [comMulheres, comPib]) {
    assert.deepEqual(
      [...idsDeIndicador(outro)].sort(),
      [...ids].sort(),
      "o filtro da tela mudou o conjunto de indicadores do documento",
    );
  }

  // Só a ORDEM muda: o indicador em destaque vai para a frente.
  assert.equal(idsDeIndicador(comMulheres)[0], "indicador-female");
  assert.equal(idsDeIndicador(comPib)[0], "indicador-gdpPerCapita");
  assert.notDeepEqual(idsDeIndicador(comMulheres), idsDeIndicador(comPib));

  // E as seções estruturais existem nos três, na mesma ordem.
  const estruturais = (doc: ReportDocument) =>
    secoes(doc)
      .map((secao) => secao.id)
      .filter((id) => !id.startsWith("indicador-"));
  assert.deepEqual(estruturais(comMulheres), estruturais(semFiltro));
  assert.deepEqual(estruturais(comPib), estruturais(semFiltro));
  for (const id of [
    "capa",
    "territorio",
    "concentracao",
    "rankings",
    "resumo-comparativo",
    "metodologia",
  ]) {
    assert.ok(
      estruturais(semFiltro).includes(id),
      `a seção ${id} sumiu do documento`,
    );
  }
});

test("o título do documento não muda com o filtro — e nunca vira o nome do indicador", () => {
  const titulos = [
    documento(null),
    documento("female"),
    documento("gdpPerCapita"),
  ].map((doc) => doc.title);
  assert.equal(new Set(titulos).size, 1, "o título mudou com o filtro da tela");
  assert.equal(titulos[0], "Desempenho eleitoral — 2022 · Deputada Federal");
  // A palavra do filtro só pode aparecer no capítulo em destaque, jamais no
  // título: "Relatório de mulheres" era exatamente o defeito.
  assert.ok(!/mulher/i.test(titulos[0]));
  const destaque = secoes(documento("female")).find(
    (secao) => secao.id === "indicador-female",
  );
  assert.ok(destaque);
  assert.match(destaque?.title ?? "", /^Análise em destaque — /);
});

test("o universo municipal é o mesmo com qualquer filtro", () => {
  const tabelas = (doc: ReportDocument) => {
    const saida: string[] = [];
    for (const bloco of blocos(doc)) {
      if (bloco.kind === "tabela") {
        saida.push(`${bloco.table.id}:${bloco.table.rows.length}`);
      }
    }
    return saida.sort();
  };
  assert.deepEqual(tabelas(documento("female")), tabelas(documento("gdpPerCapita")));
  assert.deepEqual(tabelas(documento(null)), tabelas(documento("female")));

  // O quadro municipal do Excel também não muda de tamanho.
  const linhas = (doc: ReportDocument) =>
    doc.tables.find((tabela) => tabela.id === "municipios")?.rows.length;
  assert.equal(linhas(documento("female")), QUANTIDADE);
  assert.equal(linhas(documento("gdpPerCapita")), QUANTIDADE);
});

/* -------------------------------------------------------------------------
 * 2. Anexo municipal: desligado por padrão
 * ------------------------------------------------------------------------- */

test("o anexo municipal sai desligado por padrão e só entra quando pedido", async () => {
  const doc = documento("female");
  assert.ok(doc.annexTable, "o documento aponta a tabela do anexo");
  assert.equal(doc.annexTable?.id, "municipios");

  const semAnexo = Buffer.from(await buildPdfBuffer(doc)).toString("latin1");
  assert.ok(
    !semAnexo.includes("Anexo municipal"),
    "o anexo apareceu sem ninguém pedir",
  );

  const comAnexo = Buffer.from(
    await buildPdfBuffer(doc, { incluirAnexoMunicipal: true }),
  ).toString("latin1");
  assert.ok(comAnexo.includes("Anexo municipal"), "o anexo não entrou quando pedido");
  assert.ok(
    comAnexo.includes("mesma base que a pasta de trabalho em Excel"),
    "o anexo declara que a base completa está no Excel e no CSV",
  );

  const paginasSem = (await renderReportPdf(doc)).getNumberOfPages();
  const paginasCom = (
    await renderReportPdf(doc, { incluirAnexoMunicipal: true })
  ).getNumberOfPages();
  assert.ok(
    paginasCom > paginasSem,
    `o anexo tinha de acrescentar páginas (${paginasSem} -> ${paginasCom})`,
  );
});

/* -------------------------------------------------------------------------
 * 3. Ausência é ausência
 * ------------------------------------------------------------------------- */

test("município sem denominador vira travessão no papel, nunca zero", async () => {
  const doc = documento("female");
  // O município sem denominador continua no documento — com célula ausente.
  const quadro = doc.tables.find((tabela) => tabela.id === "municipios");
  const linha = quadro?.rows.find((item) => item[1] === "Cidade 05");
  assert.ok(linha, "o município sem denominador sumiu do quadro");
  assert.equal(linha?.[4], null, "o percentual dos válidos tinha de ser ausente");

  const conteudo = Buffer.from(await buildPdfBuffer(doc)).toString("latin1");
  assert.ok(
    conteudo.includes(TRAVESSAO_CP1252),
    "travessão de dado ausente presente",
  );
  assert.ok(
    conteudo.includes("Zero significa zero apurado"),
    "a convenção de leitura é declarada no documento",
  );
  assert.ok(
    conteudo.includes("Cidade 05"),
    "o município sem denominador continua impresso",
  );
});

/* -------------------------------------------------------------------------
 * 4. Gráficos: vetor, com legenda, unidade e descrição
 * ------------------------------------------------------------------------- */

test("todo gráfico declara descrição textual, legenda e unidade dos eixos", () => {
  const doc = documento("female");
  const lista = graficos(doc);
  assert.ok(lista.length >= 4, `esperava vários gráficos, veio ${lista.length}`);
  for (const chart of lista) {
    assert.ok(
      chart.description.trim().length > 40,
      `${chart.id} sem descrição textual`,
    );
    assert.ok(chart.legend.length > 0, `${chart.id} sem legenda`);
    const spec = chart.spec;
    const eixos =
      spec.kind === "dispersao"
        ? [spec.x, spec.y]
        : spec.kind === "barras" || spec.kind === "boxplot"
          ? [spec.axis]
          : spec.kind === "quadrantes"
            ? [spec.x, spec.y]
            : spec.kind === "pareto"
              ? [spec.axis]
              : spec.panels.map((painel) =>
                  painel.spec.kind === "tira" ? painel.spec.axis : painel.spec.x,
                );
    for (const eixo of eixos) {
      assert.ok(eixo.label.trim() !== "", `${chart.id} tem eixo sem rótulo`);
      assert.ok(eixo.unit.trim() !== "", `${chart.id} tem eixo sem unidade`);
    }
  }

  // As quatro leituras do território são quatro painéis distintos.
  const territorio = lista.find(
    (chart) => chart.id === "territorio-quatro-leituras",
  );
  assert.ok(territorio);
  if (territorio?.spec.kind === "multiplos") {
    assert.deepEqual(
      territorio.spec.panels.map((painel) => painel.title),
      [
        "Volume",
        "Desempenho relativo",
        "Importância para a campanha",
        "Competitividade",
      ],
    );
  } else {
    assert.fail("a distribuição territorial precisa ser pequenos múltiplos");
  }
});

test("os quadrantes têm nomes descritivos do corte, sem juízo de campanha", () => {
  const doc = documento("female");
  const quadrantes = graficos(doc).find(
    (chart) => chart.spec.kind === "quadrantes",
  );
  assert.ok(quadrantes, "o indicador em destaque tem matriz de quadrantes");
  if (!quadrantes || quadrantes.spec.kind !== "quadrantes") return;
  assert.equal(quadrantes.spec.cells.length, 4);
  for (const celula of quadrantes.spec.cells) {
    assert.ok(celula.limite <= 5, "no máximo cinco municípios por célula");
    assert.ok(celula.items.length <= celula.limite);
    assert.doesNotMatch(
      celula.label,
      /oportunidade|ameaça|prioridade|alvo|risco/i,
      `rótulo com juízo de campanha: ${celula.label}`,
    );
  }
});

test("o PDF não embute imagem: os gráficos são desenhados em vetor", async () => {
  const conteudo = Buffer.from(
    await buildPdfBuffer(documento("female")),
  ).toString("latin1");
  assert.ok(
    !conteudo.includes("/Subtype /Image"),
    "o documento embutiu bitmap — os gráficos precisam ser vetor e o texto, pesquisável",
  );
  // E o texto continua extraível: acentuação portuguesa intacta.
  assert.ok(conteudo.includes("Distribuição territorial"));
  assert.ok(conteudo.includes("Metodologia e fontes"));
});

/* -------------------------------------------------------------------------
 * 5. Vocabulário e ressalvas do documento inteiro
 * ------------------------------------------------------------------------- */

const PROIBIDOS =
  /\b(caus(a|ou|am|ar)|impact\w*|influ[êe]nc\w*|prefer[êe]nc\w*|determin(ou|aram|a)|provoc\w*)\b/i;

function textosDaSecao(secao: ReportSection): string[] {
  const textos = [secao.title, secao.subtitle ?? ""];
  for (const bloco of secao.blocks) {
    switch (bloco.kind) {
      case "subtitulo":
      case "paragrafo":
        textos.push(bloco.text);
        break;
      case "lista":
        textos.push(...bloco.items);
        break;
      case "cartoes":
        textos.push(
          ...bloco.items.flatMap((item) => [item.label, item.note ?? ""]),
        );
        break;
      case "campos":
        textos.push(...bloco.items.flatMap((item) => [item.label, item.value]));
        break;
      case "aviso":
        textos.push(bloco.title ?? "", bloco.text);
        break;
      case "grafico":
        textos.push(
          bloco.chart.title,
          bloco.chart.subtitle ?? "",
          bloco.chart.description,
          ...bloco.chart.legend.map((item) => item.label),
        );
        break;
      case "tabela":
        textos.push(
          bloco.table.title,
          bloco.table.subtitle ?? "",
          ...(bloco.table.notes ?? []),
          ...bloco.table.rows.flatMap((linha) =>
            linha.filter(
              (celula): celula is string => typeof celula === "string",
            ),
          ),
        );
        break;
      default:
        break;
    }
  }
  return textos.filter((texto) => texto.trim() !== "");
}

test("nenhum texto do documento usa o vocabulário proibido", () => {
  const textos = secoes(documento("female")).flatMap(textosDaSecao);
  const proibidos = textos.filter((texto) => PROIBIDOS.test(texto));
  assert.deepEqual(proibidos, []);
});

test("a metodologia publica as convenções e as duas ressalvas obrigatórias", () => {
  const metodologia = secoes(documento(null)).find(
    (secao) => secao.id === "metodologia",
  );
  assert.ok(metodologia);
  const texto = textosDaSecao(metodologia as ReportSection).join(" ");
  assert.match(texto, /Travessão .* dado não apurado/);
  assert.match(texto, /não entra na análise valendo zero/);
  assert.match(texto, /não identifica quem votou/);
  assert.match(texto, /não é causalidade/);
  assert.match(texto, /Correlação não implica causalidade/);
  assert.match(texto, /perfil individual de quem votou/);
  // Fontes com endereço clicável.
  const links = (metodologia as ReportSection).blocks.find(
    (bloco) => bloco.kind === "links",
  );
  assert.ok(links && links.kind === "links" && links.items.length > 0);
  if (links?.kind === "links") {
    for (const item of links.items) assert.match(item.url, /^https?:\/\//);
  }
});

/* -------------------------------------------------------------------------
 * 6. As DUAS versões do PDF — a completa e a resumida
 * ------------------------------------------------------------------------- */

function resumido(featured: AnalysisMetricId | null): ReportDocument {
  return buildContestReport({
    dataset: BASE,
    contest: ALVO,
    reportDataset: UNIVERSO,
    activeViewFilter: featured ? { featuredIndicatorId: featured } : null,
    generatedAt: AGORA,
    variante: "resumido",
  });
}

/** A tabela de um documento, pelo id — é a mesma busca em toda asserção. */
function tabela(doc: ReportDocument, id: string) {
  for (const bloco of blocos(doc)) {
    if (bloco.kind === "tabela" && bloco.table.id === id) return bloco.table;
  }
  return null;
}

function textoDoDocumento(doc: ReportDocument): string {
  return secoes(doc).flatMap(textosDaSecao).join(" ");
}

test("a versão resumida tem menos páginas e menos seções que a completa", async () => {
  const completo = documento("female");
  const curto = resumido("female");

  const secoesCompleto = secoes(completo).length;
  const secoesCurto = secoes(curto).length;
  assert.ok(
    secoesCurto < secoesCompleto,
    `a resumida tinha de ter menos seções (${secoesCurto} contra ${secoesCompleto})`,
  );

  const paginasCompleto = (await renderReportPdf(completo)).getNumberOfPages();
  const paginasCurto = (await renderReportPdf(curto)).getNumberOfPages();
  assert.ok(
    paginasCurto < paginasCompleto,
    `a resumida tinha de ter menos páginas (${paginasCurto} contra ${paginasCompleto})`,
  );
  // E ela não pode virar um folheto de duas páginas: se o recorte tem
  // território, ela traz capa, território, cruzamentos, comparativo e método.
  assert.ok(secoesCurto >= 4, `esperava ao menos 4 seções, veio ${secoesCurto}`);
});

test("a completa não regrediu: todas as seções estruturais e um capítulo por indicador", () => {
  const completo = documento("female");
  const ids = secoes(completo).map((secao) => secao.id);
  for (const id of [
    "capa",
    "territorio",
    "concentracao",
    "rankings",
    "resumo-comparativo",
    "resumo-comparativo-graficos",
    "metodologia",
  ]) {
    assert.ok(ids.includes(id), `a seção ${id} sumiu da versão completa`);
  }
  // Um capítulo para CADA indicador analisado — a resumida corta capítulos, a
  // completa não corta nenhum.
  const analisados = tabela(completo, "comparativo")?.rows.length ?? 0;
  assert.ok(analisados > 5, `esperava vários indicadores, veio ${analisados}`);
  assert.equal(idsDeIndicador(completo).length, analisados);
});

test("a resumida traz a tabela com TODOS os indicadores, igual à da completa", () => {
  const completa = tabela(documento("female"), "comparativo");
  const curta = tabela(resumido("female"), "comparativo");
  assert.ok(completa && curta, "as duas versões precisam da tabela comparativa");
  assert.deepEqual(
    curta?.rows,
    completa?.rows,
    "a tabela dos indicadores da resumida não é a mesma da completa",
  );
  // E ela tem mais linhas do que capítulos: é esse o ponto da tabela.
  const capitulos = secoes(resumido("female")).find(
    (secao) => secao.id === "cruzamentos-resumido",
  );
  const graficosDoCapitulo = (capitulos?.blocks ?? []).filter(
    (bloco) => bloco.kind === "grafico",
  ).length;
  assert.ok(graficosDoCapitulo <= MAX_CAPITULOS_RESUMIDO);
  assert.ok(
    (curta?.rows.length ?? 0) > graficosDoCapitulo,
    "a tabela precisa cobrir indicadores que não ganharam capítulo",
  );
});

test("a resumida declara quantos indicadores ficaram sem capítulo, e o critério", () => {
  const doc = resumido("female");
  const analise = tabela(doc, "comparativo")?.rows.length ?? 0;
  const selecionados = selecionarIndicadoresResumidos(
    buildReportAnalysis({ dataset: UNIVERSO, activeViewFilter: { featuredIndicatorId: "female" } })
      .indicadores,
  );
  const semCapitulo = analise - selecionados.length;
  assert.ok(semCapitulo > 0, "o recorte de teste precisa deixar alguém de fora");

  // A contagem aparece na CAPA e na METODOLOGIA — as duas exigidas.
  for (const id of ["capa", "metodologia"]) {
    const secao = secoes(doc).find((item) => item.id === id);
    assert.ok(secao, `a seção ${id} precisa existir na resumida`);
    const texto = textosDaSecao(secao as ReportSection).join(" ");
    assert.match(texto, /versão resumida/i, `${id} não se declara resumida`);
    assert.ok(
      texto.includes(`${semCapitulo} ficaram sem capítulo`) ||
        texto.includes(`${semCapitulo} indicadores`),
      `${id} não declara quantos ficaram sem capítulo`,
    );
    assert.match(texto, /VERSÃO COMPLETA/, `${id} não aponta para a versão completa`);
    assert.match(texto, /Excel/, `${id} não aponta para a pasta em Excel`);
  }

  // O critério é escrito por extenso, com a régua — nada de "os mais relevantes".
  const texto = textoDoDocumento(doc);
  assert.match(texto, /Régua desta versão/);
  assert.match(texto, /Spearman/);
  assert.match(texto, new RegExp(`no máximo ${MAX_CAPITULOS_RESUMIDO} indicadores`));
  assert.doesNotMatch(texto, /os mais relevantes/i);
});

test("o filtro da tela não muda dado nem título em nenhuma das duas versões", () => {
  for (const variante of ["completo", "resumido"] as const) {
    const construir = variante === "completo" ? documento : resumido;
    const docs = [construir(null), construir("female"), construir("gdpPerCapita")];

    // Título: sempre o mesmo, e sempre o geral.
    assert.equal(
      new Set(docs.map((doc) => doc.title)).size,
      1,
      `o título mudou com o filtro na versão ${variante}`,
    );
    assert.equal(docs[0].title, "Desempenho eleitoral — 2022 · Deputada Federal");

    // Universo municipal: o mesmo quadro, com o mesmo número de linhas.
    const municipais = docs.map(
      (doc) => doc.tables.find((item) => item.id === "municipios")?.rows.length,
    );
    assert.deepEqual(municipais, [QUANTIDADE, QUANTIDADE, QUANTIDADE]);

    // A tabela com todos os indicadores: as MESMAS linhas, na mesma ordem de
    // conteúdo — o filtro reordena, e o conjunto continua inteiro.
    const conjuntos = docs.map((doc) =>
      [...(tabela(doc, "comparativo")?.rows ?? [])]
        .map((linha) => String(linha[0]))
        .sort(),
    );
    assert.deepEqual(conjuntos[1], conjuntos[0]);
    assert.deepEqual(conjuntos[2], conjuntos[0]);
    assert.ok(conjuntos[0].length > 5);
  }
});

test("na resumida o filtro da tela ocupa a primeira vaga de capítulo, e só isso", () => {
  const comMulheres = resumido("female");
  const capitulos = (doc: ReportDocument) => {
    const secao = secoes(doc).find((item) => item.id === "cruzamentos-resumido");
    return (secao?.blocks ?? [])
      .filter((bloco) => bloco.kind === "grafico")
      .map((bloco) => (bloco.kind === "grafico" ? bloco.chart.id : ""));
  };
  const primeiro = capitulos(comMulheres)[0];
  assert.equal(primeiro, "resumido-dispersao-female");
  assert.ok(capitulos(comMulheres).length <= MAX_CAPITULOS_RESUMIDO);

  // Sem filtro, quem abre é o de maior módulo de Spearman — não o do catálogo.
  const semFiltro = resumido(null);
  assert.ok(capitulos(semFiltro).length <= MAX_CAPITULOS_RESUMIDO);
  assert.ok(capitulos(semFiltro).length > 0);
});

test("a régua respeita o teto e nunca escolhe quem está abaixo do corte de associação", () => {
  const analise = buildReportAnalysis({
    dataset: UNIVERSO,
    activeViewFilter: null,
  });
  const escolhidos = selecionarIndicadoresResumidos(analise.indicadores);
  assert.ok(escolhidos.length <= MAX_CAPITULOS_RESUMIDO);
  for (const item of escolhidos) {
    assert.notEqual(
      item.classificacao.direction,
      "sem associação clara",
      `${item.indicator.id} entrou sem associação classificada e sem ser destaque`,
    );
  }
  // Ordenados por módulo decrescente do coeficiente.
  const modulos = escolhidos.map((item) =>
    Math.abs(item.classificacao.coeficiente as number),
  );
  assert.deepEqual(modulos, [...modulos].sort((a, b) => b - a));

  // Com destaque, o selecionado entra mesmo sem passar do corte — e ocupa a
  // primeira vaga. É a única coisa que a tela decide.
  const comDestaque = buildReportAnalysis({
    dataset: UNIVERSO,
    activeViewFilter: { featuredIndicatorId: "female" },
  });
  const escolha = selecionarIndicadoresResumidos(comDestaque.indicadores);
  assert.equal(escolha[0]?.indicator.id, "female");
  assert.ok(escolha.length <= MAX_CAPITULOS_RESUMIDO);
});

test("o nome do arquivo distingue as duas versões", () => {
  const completo = buildReportFilename(documento("female"), "pdf");
  const curto = buildReportFilename(resumido("female"), "pdf");
  assert.notEqual(completo, curto);
  assert.match(curto, /resumido/);
  assert.doesNotMatch(completo, /resumido/);
  // E o documento diz de si mesmo qual versão é — quem consome o modelo não
  // precisa deduzir isso do nome do arquivo.
  assert.equal(documento("female").variant, "completo");
  assert.equal(resumido("female").variant, "resumido");
  // As duas continuam datadas e com a mesma extensão.
  assert.match(completo, /-2026-08-17\.pdf$/);
  assert.match(curto, /-2026-08-17\.pdf$/);
});

test("a resumida imprime, mantém o vocabulário e não transforma ausência em zero", async () => {
  const doc = resumido("female");
  const conteudo = Buffer.from(await buildPdfBuffer(doc)).toString("latin1");
  assert.ok(conteudo.includes(TRAVESSAO_CP1252), "travessão ausente do papel");
  assert.ok(conteudo.includes("Zero significa zero apurado"));
  assert.ok(
    conteudo.includes("Metodologia e fontes"),
    "a resumida precisa da página de metodologia",
  );
  assert.ok(
    !conteudo.includes("/Subtype /Image"),
    "a resumida também desenha em vetor",
  );
  // A capa marca a versão para as duas impressões não se confundirem.
  assert.match(doc.versionBadge ?? "", /resumida/i);
  assert.match(documento("female").versionBadge ?? "", /completa/i);

  const proibidos = secoes(doc)
    .flatMap(textosDaSecao)
    .filter((texto) => PROIBIDOS.test(texto));
  assert.deepEqual(proibidos, []);
});

test("a resumida publica as ressalvas obrigatórias e as convenções", () => {
  const metodologia = secoes(resumido(null)).find(
    (secao) => secao.id === "metodologia",
  );
  assert.ok(metodologia);
  const texto = textosDaSecao(metodologia as ReportSection).join(" ");
  assert.match(texto, /Travessão .* dado não apurado/);
  assert.match(texto, /não é causalidade/);
  assert.match(texto, /Correlação não implica causalidade/);
  assert.match(texto, /perfil individual de quem votou/);
  const links = (metodologia as ReportSection).blocks.find(
    (bloco) => bloco.kind === "links",
  );
  assert.ok(links && links.kind === "links" && links.items.length > 0);
});
