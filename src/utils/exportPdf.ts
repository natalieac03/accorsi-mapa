import type { jsPDF } from "jspdf";
import { downloadBlobFile } from "./browser.ts";
import {
  criarTemaPdf,
  definirTexto,
  desenharGrafico,
  encurtar,
  medirGrafico,
  paragrafo,
  quebrar,
  toPdfText,
  type PdfTheme,
} from "./pdfDraw.ts";
import {
  buildReportFilename,
  formatGeneratedAt,
  formatReportCell,
  hasExportableContent,
  isNumericColumn,
  type ReportBlock,
  type ReportColumn,
  type ReportDocument,
  type ReportPdfOptions,
  type ReportSection,
  type ReportSource,
  type ReportTable,
} from "./reportModel.ts";

/**
 * Relatório em PDF: traduz o modelo num documento de leitura.
 *
 * O documento é montado em SEÇÕES (`report.sections`), na ordem em que se lê.
 * Documento ainda sem seções próprias recebe as seções padrão montadas dos
 * cartões, fontes e tabelas: o renderizador tem UM caminho só.
 *
 * jsPDF + jspdf-autotable, e não pdfmake:
 *
 * - o autotable dá cabeçalho repetido em toda página (`showHead: "everyPage"`),
 *   quebra de página por linha e zebra;
 * - o jsPDF desenha em COORDENADAS, que é o que a capa, a grade de cartões e os
 *   gráficos em vetor precisam (`pdfDraw.ts`);
 * - somam ~380 kB minificados contra ~1,2 MB do pdfmake com o vfs de fontes
 *   embutido, e as duas entram por import dinâmico.
 *
 * ACENTUAÇÃO: as fontes padrão do PDF usam WinAnsi (cp1252), que cobre todo o
 * português e sai extraível como texto. Símbolo fora dela, como a seta "→",
 * passa por `toPdfText`; embutir uma fonte UTF-8 custaria ~400 kB por arquivo.
 */

const PDF_MIME = "application/pdf";

/* Geometria da página A4 retrato, em milímetros. */
const LARGURA = 210;
const ALTURA = 297;
const MARGEM = 16;
const TOPO = 18;
const RODAPE = 20;
const UTIL = LARGURA - 2 * MARGEM;

/**
 * Teto de linhas por tabela no PDF: um recorte de locais de votação pode ter
 * milhares de unidades. O PDF é o documento de leitura, a planilha é a base
 * completa, e o corte é declarado na própria tabela, nunca silencioso.
 */
export const PDF_MAX_ROWS = 250;

/** Reexportado de `pdfDraw` para os testes de texto. */
export { toPdfText } from "./pdfDraw.ts";

/* -------------------------------------------------------------------------
 * Estado do desenho
 * ------------------------------------------------------------------------- */

type AutoTable = (doc: jsPDF, options: Record<string, unknown>) => void;

type Contexto = {
  doc: jsPDF;
  tema: PdfTheme;
  autoTable: AutoTable;
  y: number;
  /** Páginas que levam marcador no topo ("Anexo municipal"). */
  marcadores: Map<number, string>;
};

function garantirEspaco(ctx: Contexto, necessario: number) {
  if (ctx.y + necessario <= ALTURA - RODAPE) return;
  novaPagina(ctx);
}

function novaPagina(ctx: Contexto) {
  ctx.doc.addPage();
  ctx.y = TOPO;
}

function noTopo(ctx: Contexto) {
  return ctx.y <= TOPO + 0.5;
}

/* -------------------------------------------------------------------------
 * Capa
 * ------------------------------------------------------------------------- */

/** Altura mínima da faixa; ela cresce quando o título ocupa mais linhas. */
const FAIXA_MINIMA = 72;

/**
 * A capa. A faixa tem altura VARIÁVEL: cada linha é escrita a partir do fim da
 * anterior e a faixa fecha onde o texto terminou, porque com altura fixa um
 * título de duas linhas empurrava o subtítulo para cima do recorte.
 */
function desenharCapa(ctx: Contexto, report: ReportDocument) {
  const { doc, tema } = ctx;
  definirTexto(doc, 23, tema.branco, "bold");
  const titulo = quebrar(doc, report.title, UTIL).slice(0, 3);
  let base = 34 + titulo.length * 10;
  const linhas: Array<{ texto: string; size: number; y: number }> = [];
  linhas.push({ texto: report.subtitle, size: 12, y: base });
  base += 7;
  // O estado só entra quando o recorte ainda não o nomeia, para a capa não
  // sair com "Goiás · Goiás".
  const escopo = report.scope.includes(report.estado)
    ? report.scope
    : `${report.scope} · ${report.estado}`;
  linhas.push({ texto: escopo, size: 9.5, y: base });
  base += 6.4;
  linhas.push({
    texto: `Gerado em ${formatGeneratedAt(report.generatedAt)}`,
    size: 8,
    y: base,
  });
  const altura = Math.max(FAIXA_MINIMA, base + 9);

  doc.setFillColor(tema.marca[0], tema.marca[1], tema.marca[2]);
  doc.rect(0, 0, LARGURA, altura, "F");
  definirTexto(doc, 9, tema.branco, "bold");
  // Topo dividido: candidatura à esquerda, marca da versão à direita. Com o
  // nome ocupando a largura inteira, o badge cairia por cima dele.
  const badge = report.versionBadge ?? "";
  const larguraNome = badge === "" ? UTIL : UTIL * 0.52;
  doc.text(encurtar(doc, report.candidatura, larguraNome), MARGEM, 20);
  if (badge !== "") {
    definirTexto(doc, 8, tema.branco, "bold");
    doc.text(encurtar(doc, badge, UTIL * 0.46), MARGEM + UTIL, 20, {
      align: "right",
    });
  }
  definirTexto(doc, 23, tema.branco, "bold");
  titulo.forEach((linha, indice) => doc.text(linha, MARGEM, 34 + indice * 10));
  for (const linha of linhas) {
    definirTexto(doc, linha.size, tema.branco);
    doc.text(encurtar(doc, linha.texto, UTIL), MARGEM, linha.y);
  }
  ctx.y = altura + 10;
}

/* -------------------------------------------------------------------------
 * Títulos
 * ------------------------------------------------------------------------- */

/**
 * Corpo mínimo que precisa caber DEPOIS do título de uma seção, para não sair
 * título órfão no pé da página na versão resumida, que não quebra folha a cada
 * seção. Em seção que começa em página nova nunca dispara: sobram 259 mm.
 */
const CORPO_MINIMO_APOS_TITULO = 24;

function tituloSecao(ctx: Contexto, texto: string, sub?: string) {
  const { doc, tema } = ctx;
  definirTexto(doc, 7.4, tema.tintaSuave);
  const alturaSub = sub ? quebrar(doc, sub, UTIL).length * 3.6 : 0;
  garantirEspaco(ctx, 14 + alturaSub + CORPO_MINIMO_APOS_TITULO);
  definirTexto(doc, 14, tema.marca, "bold");
  doc.text(encurtar(doc, texto, UTIL), MARGEM, ctx.y + 4);
  ctx.y += 6.4;
  if (sub) {
    definirTexto(doc, 7.4, tema.tintaSuave);
    ctx.y += paragrafo(doc, sub, MARGEM, ctx.y + 1, UTIL, 3.6) + 0.6;
  }
  doc.setDrawColor(tema.marca[0], tema.marca[1], tema.marca[2]);
  doc.setLineWidth(0.5);
  doc.line(MARGEM, ctx.y + 1, MARGEM + UTIL, ctx.y + 1);
  ctx.y += 5.5;
}

function subtitulo(ctx: Contexto, texto: string) {
  const { doc, tema } = ctx;
  // 26 mm: o título mais três linhas do que vem depois. Sem essa reserva o
  // subtítulo caía sozinho no pé da página e o conteúdo abria a seguinte.
  garantirEspaco(ctx, 26);
  definirTexto(doc, 10, tema.tinta, "bold");
  doc.text(encurtar(doc, texto, UTIL), MARGEM, ctx.y + 3.4);
  ctx.y += 5;
  doc.setDrawColor(tema.linha[0], tema.linha[1], tema.linha[2]);
  doc.setLineWidth(0.2);
  doc.line(MARGEM, ctx.y, MARGEM + UTIL, ctx.y);
  ctx.y += 3.4;
}

/* -------------------------------------------------------------------------
 * Blocos
 * ------------------------------------------------------------------------- */

function blocoParagrafo(ctx: Contexto, texto: string, suave: boolean) {
  const { doc, tema } = ctx;
  definirTexto(doc, 8.6, suave ? tema.tintaFraca : tema.tinta);
  const linhas = quebrar(doc, texto, UTIL);
  // Parágrafo curto nunca é partido; longo quebra por linha, com pelo menos
  // duas linhas em cada página (viúva de uma linha só lê como erro).
  garantirEspaco(ctx, Math.min(linhas.length, 3) * 4.1);
  for (const linha of linhas) {
    garantirEspaco(ctx, 4.1);
    doc.text(linha, MARGEM, ctx.y + 3);
    ctx.y += 4.1;
  }
  ctx.y += 2.2;
}

function blocoLista(ctx: Contexto, itens: readonly string[]) {
  const { doc, tema } = ctx;
  const recuo = 4.6;
  for (const item of itens) {
    definirTexto(doc, 8.6, tema.tinta);
    const linhas = quebrar(doc, item, UTIL - recuo);
    garantirEspaco(ctx, Math.min(linhas.length, 3) * 4.1 + 1);
    definirTexto(doc, 8.6, tema.marca, "bold");
    doc.text("•", MARGEM, ctx.y + 3);
    definirTexto(doc, 8.6, tema.tinta);
    linhas.forEach((linha, indice) => {
      if (indice > 0) garantirEspaco(ctx, 4.1);
      doc.text(linha, MARGEM + recuo, ctx.y + 3);
      ctx.y += 4.1;
    });
    ctx.y += 1.2;
  }
  ctx.y += 1.4;
}

const CARTAO_ALTURA = 25;
const CARTAO_ESPACO = 4;

function blocoCartoes(
  ctx: Contexto,
  itens: ReadonlyArray<{ label: string; value: string; note?: string }>,
  colunas: number,
) {
  const { doc, tema } = ctx;
  if (itens.length === 0) return;
  const largura = (UTIL - CARTAO_ESPACO * (colunas - 1)) / colunas;
  itens.forEach((item, indice) => {
    const coluna = indice % colunas;
    if (coluna === 0) garantirEspaco(ctx, CARTAO_ALTURA + 2);
    const x = MARGEM + coluna * (largura + CARTAO_ESPACO);
    const y = ctx.y;
    doc.setFillColor(tema.superficie[0], tema.superficie[1], tema.superficie[2]);
    doc.roundedRect(x, y, largura, CARTAO_ALTURA, 1.6, 1.6, "F");
    doc.setFillColor(tema.marca[0], tema.marca[1], tema.marca[2]);
    doc.rect(x, y, 1.2, CARTAO_ALTURA, "F");
    definirTexto(doc, 7, tema.tintaFraca, "bold");
    doc.text(
      encurtar(doc, item.label.toUpperCase(), largura - 7),
      x + 4.4,
      y + 5.6,
    );
    definirTexto(doc, 15, tema.tinta, "bold");
    doc.text(encurtar(doc, item.value, largura - 7), x + 4.4, y + 14);
    if (item.note) {
      definirTexto(doc, 6.8, tema.tintaSuave);
      quebrar(doc, item.note, largura - 7)
        .slice(0, 2)
        .forEach((texto, posicao) =>
          doc.text(texto, x + 4.4, y + 18.4 + posicao * 3.2),
        );
    }
    if (coluna === colunas - 1) ctx.y += CARTAO_ALTURA + CARTAO_ESPACO;
  });
  if (itens.length % colunas !== 0) ctx.y += CARTAO_ALTURA + CARTAO_ESPACO;
  ctx.y += 1.6;
}

function blocoCampos(
  ctx: Contexto,
  itens: ReadonlyArray<{ label: string; value: string }>,
  colunas: number,
) {
  const { doc, tema } = ctx;
  const largura = (UTIL - 4 * (colunas - 1)) / colunas;
  for (let inicio = 0; inicio < itens.length; inicio += colunas) {
    const linha = itens.slice(inicio, inicio + colunas);
    definirTexto(doc, 8, tema.tinta);
    const alturas = linha.map(
      (item) => quebrar(doc, item.value, largura).length * 3.6,
    );
    const alturaLinha = Math.max(...alturas) + 4.6;
    garantirEspaco(ctx, alturaLinha + 1);
    linha.forEach((item, coluna) => {
      const x = MARGEM + coluna * (largura + 4);
      definirTexto(doc, 6.8, tema.tintaFraca);
      doc.text(encurtar(doc, item.label, largura), x, ctx.y + 2.6);
      definirTexto(doc, 8, tema.tinta);
      quebrar(doc, item.value, largura).forEach((texto, indice) =>
        doc.text(texto, x, ctx.y + 6.6 + indice * 3.6),
      );
    });
    ctx.y += alturaLinha + 1;
    doc.setDrawColor(tema.linha[0], tema.linha[1], tema.linha[2]);
    doc.setLineWidth(0.2);
    doc.line(MARGEM, ctx.y - 1, MARGEM + UTIL, ctx.y - 1);
  }
  ctx.y += 2.4;
}

function blocoAviso(ctx: Contexto, titulo: string | undefined, texto: string) {
  const { doc, tema } = ctx;
  definirTexto(doc, 7.8, tema.tintaSuave);
  const linhas = quebrar(doc, texto, UTIL - 9);
  const altura = linhas.length * 3.7 + (titulo ? 4.4 : 0) + 5;
  garantirEspaco(ctx, altura + 2);
  doc.setFillColor(tema.superficie[0], tema.superficie[1], tema.superficie[2]);
  doc.rect(MARGEM, ctx.y, UTIL, altura, "F");
  doc.setFillColor(tema.marca[0], tema.marca[1], tema.marca[2]);
  doc.rect(MARGEM, ctx.y, 1.2, altura, "F");
  let interno = ctx.y + 4.4;
  if (titulo) {
    definirTexto(doc, 8, tema.tinta, "bold");
    doc.text(encurtar(doc, titulo, UTIL - 9), MARGEM + 5, interno);
    interno += 4.4;
  }
  definirTexto(doc, 7.8, tema.tintaSuave);
  linhas.forEach((linha, indice) =>
    doc.text(linha, MARGEM + 5, interno + indice * 3.7),
  );
  ctx.y += altura + 3.4;
}

function textoFonte(source: ReportSource) {
  return [source.label, source.detail].filter(Boolean).join(" · ");
}

function blocoFonte(ctx: Contexto, source: ReportSource, nota?: string) {
  const { doc, tema } = ctx;
  definirTexto(doc, 7, tema.tintaFraca);
  const texto = [textoFonte(source), source.url, nota]
    .filter(Boolean)
    .join(" · ");
  garantirEspaco(ctx, 6);
  ctx.y += paragrafo(doc, `Fonte: ${texto}`, MARGEM, ctx.y + 2.4, UTIL, 3.3) + 3;
}

function blocoLinks(
  ctx: Contexto,
  itens: ReadonlyArray<{ label: string; url: string }>,
) {
  const { doc, tema } = ctx;
  for (const item of itens) {
    garantirEspaco(ctx, 8);
    definirTexto(doc, 8, tema.tinta);
    doc.text(encurtar(doc, item.label, UTIL), MARGEM, ctx.y + 3);
    ctx.y += 4;
    definirTexto(doc, 7.2, tema.marca);
    // Link clicável: o endereço é o texto e o retângulo acompanha a linha.
    doc.textWithLink(encurtar(doc, item.url, UTIL), MARGEM, ctx.y + 2.6, {
      url: item.url,
    });
    ctx.y += 5;
  }
  ctx.y += 1.4;
}

function blocoImagem(
  ctx: Contexto,
  image: { title: string; dataUrl: string; aspectRatio: number; caption?: string },
) {
  const { doc, tema } = ctx;
  const largura = UTIL;
  const altura = Math.min(
    largura / (image.aspectRatio > 0 ? image.aspectRatio : 1.6),
    ALTURA - TOPO - RODAPE - 30,
  );
  garantirEspaco(ctx, altura + 14);
  definirTexto(doc, 9.5, tema.tinta, "bold");
  doc.text(encurtar(doc, image.title, UTIL), MARGEM, ctx.y + 3.6);
  ctx.y += 6;
  doc.addImage(image.dataUrl, "PNG", MARGEM, ctx.y, largura, altura, undefined, "FAST");
  ctx.y += altura + 2;
  if (image.caption) {
    definirTexto(doc, 7.4, tema.tintaFraca);
    ctx.y += paragrafo(doc, image.caption, MARGEM, ctx.y + 2, UTIL, 3.4);
  }
  ctx.y += 5;
}

function blocoGrafico(ctx: Contexto, chart: Parameters<typeof desenharGrafico>[1]) {
  const altura = medirGrafico(ctx.doc, chart, UTIL);
  // O gráfico é indivisível: título, desenho, descrição e fonte na mesma
  // página. Se não couber, a página vira ANTES de desenhar qualquer traço.
  garantirEspaco(ctx, altura);
  ctx.y += desenharGrafico(ctx.doc, chart, MARGEM, ctx.y, UTIL, ctx.tema);
}

/* -------------------------------------------------------------------------
 * Tabelas
 * ------------------------------------------------------------------------- */

/** Colunas que entram no PDF (as técnicas ficam só na planilha). */
export function getPdfColumns(table: ReportTable): ReportColumn[] {
  const visiveis = table.columns.filter((column) => !column.pdfHidden);
  return visiveis.length > 0 ? visiveis : table.columns;
}

function linhasVisiveis(table: ReportTable, maxRows: number) {
  const indices = table.columns
    .map((column, indice) => ({ column, indice }))
    .filter(({ column }) => !column.pdfHidden)
    .map(({ indice }) => indice);
  const usados = indices.length > 0 ? indices : table.columns.map((_, i) => i);
  return table.rows
    .slice(0, maxRows)
    .map((row) =>
      usados.map((indice) =>
        formatReportCell(row[indice] ?? null, table.columns[indice]),
      ),
    );
}

/** As notas de rodapé de uma tabela, na ordem em que são lidas. */
function montarNotas(table: ReportTable, maxRows: number): string[] {
  const notas = [...(table.notes ?? [])];
  if (table.rows.length > maxRows) {
    notas.unshift(
      `Mostrando as ${maxRows} primeiras de ${table.rows.length} linhas. A pasta de trabalho em Excel traz todas.`,
    );
  }
  if (table.columns.some((column) => column.pdfHidden)) {
    notas.push(
      "Colunas técnicas (códigos e denominadores) ficaram fora deste documento e estão na planilha em Excel.",
    );
  }
  notas.push(
    "Travessão (—) significa dado não apurado. Zero significa zero apurado.",
  );
  return notas;
}

function desenharTabela(ctx: Contexto, table: ReportTable, maxRows: number) {
  const { doc, tema } = ctx;
  const columns = getPdfColumns(table);
  const linhas = linhasVisiveis(table, maxRows);

  definirTexto(doc, 7.4, tema.tintaSuave);
  const alturaSub = table.subtitle
    ? quebrar(doc, table.subtitle, UTIL).length * 3.4
    : 0;
  // Cabeçalho da tabela mais três linhas: menos que isso na página é órfão.
  garantirEspaco(ctx, 22 + alturaSub);

  /* LARGURA DE COLUNA MEDIDA, não estimada por contagem de caracteres: contar
     letras dava 9 mm a "Ano" e o autotable quebrava "2026" em "20 / 26". Cada
     coluna declara duas larguras, medidas em mm com a fonte da tabela:
     mínimo (a maior PALAVRA do cabeçalho e, nas colunas numéricas, o número
     inteiro) e desejado (cabeçalho inteiro e maior célula em uma linha só). O
     que sobra dos mínimos é distribuído na proporção do que cada coluna ainda
     queria, e só as colunas de texto encolhem. */
  const PADDING = 4.4;
  const maiorPalavra = (texto: string) =>
    Math.max(
      ...toPdfText(texto)
        .split(/[\s·]+/)
        .map((palavra) => doc.getTextWidth(palavra)),
      0,
    );
  definirTexto(doc, 8, tema.tinta, "bold");
  const cabecalhoCheio = columns.map((column) =>
    doc.getTextWidth(toPdfText(column.header)),
  );
  const cabecalhoPalavra = columns.map((column) => maiorPalavra(column.header));
  definirTexto(doc, 8, tema.tinta);
  const celulaCheia = columns.map((_, indice) =>
    linhas.reduce(
      (maior, linha) => Math.max(maior, doc.getTextWidth(linha[indice] ?? "")),
      0,
    ),
  );
  const celulaPalavra = columns.map((_, indice) =>
    linhas.reduce(
      (maior, linha) => Math.max(maior, maiorPalavra(linha[indice] ?? "")),
      0,
    ),
  );
  const minimos = columns.map((column, indice) =>
    Math.max(
      cabecalhoPalavra[indice],
      isNumericColumn(column) ? celulaCheia[indice] : celulaPalavra[indice],
    ) + PADDING,
  );
  const desejados = columns.map((_, indice) =>
    Math.max(cabecalhoCheio[indice], celulaCheia[indice], minimos[indice] - PADDING) +
    PADDING,
  );
  const somaMinimos = minimos.reduce((soma, valor) => soma + valor, 0);
  const somaDesejados = desejados.reduce((soma, valor) => soma + valor, 0);
  let larguras: number[];
  if (somaDesejados <= UTIL) {
    // Sobrou espaço: cresce todo mundo na proporção do que pediu.
    larguras = desejados.map((valor) => (valor * UTIL) / somaDesejados);
  } else if (somaMinimos <= UTIL) {
    const folga = UTIL - somaMinimos;
    const excedentes = desejados.map(
      (valor, indice) => valor - minimos[indice],
    );
    const somaExcedentes = excedentes.reduce((soma, valor) => soma + valor, 0) || 1;
    larguras = minimos.map(
      (valor, indice) => valor + (folga * excedentes[indice]) / somaExcedentes,
    );
  } else {
    // Nem os mínimos cabem: encolhe proporcionalmente e o cabeçalho quebra.
    larguras = minimos.map((valor) => (valor * UTIL) / somaMinimos);
  }
  const columnStyles: Record<
    number,
    { halign: "right" | "left"; cellWidth: number }
  > = {};
  columns.forEach((column, indice) => {
    columnStyles[indice] = {
      halign: isNumericColumn(column) ? "right" : "left",
      cellWidth: larguras[indice],
    };
  });

  /* Tabela CURTA não se parte: se cabe inteira numa página e não cabe no que
     sobrou desta, a página vira antes. Tabela longa (o anexo municipal)
     continua paginando, com o cabeçalho repetido em cada folha. */
  const notas = montarNotas(table, maxRows);
  definirTexto(doc, 7.5, tema.tintaFraca);
  const blocosNotas = notas.map((nota) => ({
    linhas: quebrar(doc, `• ${nota}`, UTIL),
  }));
  const alturaNotas = blocosNotas.reduce(
    (soma, bloco) => soma + bloco.linhas.length * 3.4 + 1,
    0,
  );
  /* Altura estimada da tabela, contando a célula que QUEBRA em duas linhas e
     a reserva das notas (a mesma margem inferior que o autotable aplica). Sem
     as duas, a última linha caía sozinha na página seguinte. */
  definirTexto(doc, 8, tema.tinta);
  const linhasDaLinha = (linha: string[]) =>
    Math.max(
      1,
      ...linha.map((celula, indice) =>
        Math.ceil(
          doc.getTextWidth(celula ?? "") / Math.max(2, larguras[indice] - PADDING),
        ),
      ),
    );
  const alturaCorpo = linhas.reduce(
    (soma, linha) => soma + 3.6 + linhasDaLinha(linha) * 3.2,
    0,
  );
  const alturaCabecalho =
    3.6 +
    Math.max(
      ...columns.map((_, indice) =>
        Math.ceil(
          cabecalhoCheio[indice] / Math.max(2, larguras[indice] - PADDING),
        ),
      ),
      1,
    ) * 3.2;
  const alturaEstimada =
    12 + alturaSub + alturaCabecalho + alturaCorpo + alturaNotas + 9;
  const alturaUtil = ALTURA - TOPO - RODAPE;
  if (
    linhas.length <= 25 &&
    ctx.y + alturaEstimada > ALTURA - RODAPE &&
    alturaEstimada <= alturaUtil
  ) {
    novaPagina(ctx);
  }
  definirTexto(doc, 9.5, tema.tinta, "bold");
  doc.text(encurtar(doc, table.title, UTIL), MARGEM, ctx.y + 3.4);
  ctx.y += 5;
  if (table.subtitle) {
    definirTexto(doc, 7.4, tema.tintaSuave);
    ctx.y += paragrafo(doc, table.subtitle, MARGEM, ctx.y + 1, UTIL, 3.4) + 1;
  }
  doc.setDrawColor(tema.linha[0], tema.linha[1], tema.linha[2]);
  doc.setLineWidth(0.2);
  doc.line(MARGEM, ctx.y, MARGEM + UTIL, ctx.y);
  ctx.y += 2.6;

  /* As notas foram montadas e MEDIDAS acima, e a altura delas entra na margem
     inferior do autotable: sem essa reserva o bloco de notas, que não pode ser
     partido, migrava inteiro para uma folha nova. */
  ctx.autoTable(doc, {
    head: [columns.map((column) => toPdfText(column.header))],
    body: linhas,
    startY: ctx.y,
    margin: {
      left: MARGEM,
      right: MARGEM,
      top: TOPO,
      // +9 = 5 mm de respiro entre tabela e notas, 2 mm exigidos pelo
      // garantirEspaco e 2 mm de sobra. Com +4 a conta fechava 1,9 mm curta e
      // o bloco de notas caía sozinho numa página nova.
      bottom: RODAPE + alturaNotas + 9,
    },
    // "striped" é o único tema do autotable que aplica a zebra; as cores são
    // todas sobrescritas abaixo pela paleta da campanha.
    theme: "striped",
    showHead: "everyPage",
    styles: {
      font: "helvetica",
      fontSize: 8,
      cellPadding: { top: 1.8, right: 2, bottom: 1.8, left: 2 },
      textColor: tema.tinta,
      lineColor: tema.linha,
      lineWidth: 0,
      overflow: "linebreak",
    },
    headStyles: {
      fillColor: tema.marca,
      textColor: tema.branco,
      fontStyle: "bold",
      fontSize: 8,
    },
    // Zebra discreta: a superfície secundária da paleta, o suficiente para o
    // olho seguir a linha numa tabela de 246 municípios.
    alternateRowStyles: { fillColor: tema.superficie },
    columnStyles,
  });

  const finalY =
    (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable
      ?.finalY ?? ctx.y;
  ctx.y = finalY + 5;

  garantirEspaco(ctx, alturaNotas + 2);
  definirTexto(doc, 7.5, tema.tintaFraca);
  for (const bloco of blocosNotas) {
    bloco.linhas.forEach((linha, indice) => {
      doc.text(linha, MARGEM, ctx.y + indice * 3.4);
    });
    ctx.y += bloco.linhas.length * 3.4 + 1;
  }
  ctx.y += 6;
}

/* -------------------------------------------------------------------------
 * Seções
 * ------------------------------------------------------------------------- */

function desenharBloco(ctx: Contexto, block: ReportBlock) {
  switch (block.kind) {
    case "subtitulo":
      subtitulo(ctx, block.text);
      break;
    case "paragrafo":
      blocoParagrafo(ctx, block.text, block.tone === "suave");
      break;
    case "lista":
      blocoLista(ctx, block.items);
      break;
    case "cartoes":
      blocoCartoes(ctx, block.items, block.colunas ?? 2);
      break;
    case "campos":
      blocoCampos(ctx, block.items, block.colunas ?? 2);
      break;
    case "grafico":
      blocoGrafico(ctx, block.chart);
      break;
    case "imagem":
      blocoImagem(ctx, block.image);
      break;
    case "tabela":
      desenharTabela(ctx, block.table, block.maxRows ?? PDF_MAX_ROWS);
      break;
    case "aviso":
      blocoAviso(ctx, block.title, block.text);
      break;
    case "fonte":
      blocoFonte(ctx, block.source, block.note);
      break;
    case "links":
      blocoLinks(ctx, block.items);
      break;
  }
}

function desenharSecao(ctx: Contexto, section: ReportSection) {
  if (section.startsNewPage && !noTopo(ctx)) novaPagina(ctx);
  const inicio = ctx.doc.getNumberOfPages();
  tituloSecao(ctx, section.title, section.subtitle);
  section.blocks.forEach((block, indice) => {
    /* Um subtítulo NUNCA fica sozinho no pé da página: quando o bloco seguinte
       é um gráfico (indivisível e alto), os dois são reservados JUNTOS. */
    const proximo = section.blocks[indice + 1];
    if (block.kind === "subtitulo" && proximo?.kind === "grafico") {
      garantirEspaco(ctx, 9 + medirGrafico(ctx.doc, proximo.chart, UTIL));
    }
    desenharBloco(ctx, block);
  });
  if (section.marker) {
    for (let pagina = inicio; pagina <= ctx.doc.getNumberOfPages(); pagina += 1) {
      ctx.marcadores.set(pagina, section.marker);
    }
  }
}

/**
 * Seções de um documento sem narrativa própria (trajetória, crescimento,
 * painéis do mapa): cartões, imagens, fontes, omissões e uma seção por tabela.
 */
function secoesPadrao(report: ReportDocument): ReportSection[] {
  const secoes: ReportSection[] = [];
  const capa: ReportBlock[] = [];
  if (report.highlights.length > 0) {
    capa.push({ kind: "cartoes", items: report.highlights, colunas: 2 });
  }
  for (const image of report.images) capa.push({ kind: "imagem", image });
  if (report.tables.length > 0) {
    capa.push({ kind: "subtitulo", text: "Fontes e procedência" });
    for (const table of report.tables) {
      capa.push({ kind: "fonte", source: table.source, note: table.title });
    }
  }
  if (report.omitted.length > 0) {
    capa.push({ kind: "subtitulo", text: "Conjuntos não incluídos" });
    capa.push({
      kind: "lista",
      items: report.omitted.map((item) => `${item.title}: ${item.reason}`),
    });
  }
  if (capa.length > 0) {
    secoes.push({ id: "resumo", title: "Números do recorte", blocks: capa });
  }
  const comLinhas = report.tables.filter((table) => table.rows.length > 0);
  comLinhas.forEach((table, indice) => {
    secoes.push({
      id: `tabela-${table.id}`,
      title: table.title,
      subtitle: table.subtitle,
      startsNewPage: indice === 0,
      blocks: [
        { kind: "tabela", table: { ...table, title: "", subtitle: undefined } },
      ],
    });
  });
  return secoes;
}

/**
 * Anexo municipal: a base inteira, página a página, DESLIGADO por padrão.
 * Ligado, entra depois do relatório analítico, com marcador próprio no topo de
 * cada página. Desligado, o relatório termina na metodologia.
 */
function secaoAnexo(table: ReportTable): ReportSection {
  return {
    id: "anexo-municipal",
    title: "Anexo municipal",
    subtitle:
      "Uma linha por município com voto apurado, do mais votado ao menos votado.",
    marker: "Anexo municipal",
    startsNewPage: true,
    blocks: [
      {
        kind: "paragrafo",
        text: "Esta é a mesma base que a pasta de trabalho em Excel e o CSV entregam — aqui ela vem impressa, para consulta em papel. Para cruzar com outra base, use os arquivos: eles trazem também as colunas técnicas (código IBGE, denominadores) que ficam fora do PDF.",
        tone: "suave",
      },
      {
        kind: "tabela",
        table: { ...table, title: "", subtitle: undefined },
        maxRows: PDF_MAX_ROWS,
      },
    ],
  };
}

/* -------------------------------------------------------------------------
 * Rodapé e marcadores
 * ------------------------------------------------------------------------- */

/**
 * Rodapé desenhado no fim, com o total de páginas já conhecido: "página X de
 * Y" sai com o número real, sem placeholder trocado depois. O marcador de
 * anexo entra no mesmo passo, pelo mesmo motivo.
 */
function desenharRodapes(ctx: Contexto, report: ReportDocument) {
  const { doc, tema } = ctx;
  const total = doc.getNumberOfPages();
  const data = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(report.generatedAt);
  for (let pagina = 1; pagina <= total; pagina += 1) {
    doc.setPage(pagina);
    const marcador = ctx.marcadores.get(pagina);
    if (marcador && pagina > 1) {
      definirTexto(doc, 7, tema.tintaFraca);
      doc.text(toPdfText(marcador), MARGEM + UTIL, TOPO - 8, { align: "right" });
      doc.setDrawColor(tema.linha[0], tema.linha[1], tema.linha[2]);
      doc.setLineWidth(0.2);
      doc.line(MARGEM, TOPO - 6, MARGEM + UTIL, TOPO - 6);
    }
    if (pagina === 1) continue;
    doc.setDrawColor(tema.linha[0], tema.linha[1], tema.linha[2]);
    doc.setLineWidth(0.2);
    doc.line(MARGEM, ALTURA - 14, MARGEM + UTIL, ALTURA - 14);
    definirTexto(doc, 7, tema.tintaFraca);
    doc.text(toPdfText(report.attribution), MARGEM, ALTURA - 10);
    doc.text(
      toPdfText(`Página ${pagina} de ${total} · ${data}`),
      MARGEM + UTIL,
      ALTURA - 10,
      { align: "right" },
    );
  }
  // A capa também leva rodapé: capa sem paginação parece página perdida.
  doc.setPage(1);
  definirTexto(doc, 7, tema.tintaFraca);
  doc.text(toPdfText(report.attribution), MARGEM, ALTURA - 10);
  doc.text(
    toPdfText(`Página 1 de ${total} · ${data}`),
    MARGEM + UTIL,
    ALTURA - 10,
    { align: "right" },
  );
  doc.setDrawColor(tema.linha[0], tema.linha[1], tema.linha[2]);
  doc.setLineWidth(0.2);
  doc.line(MARGEM, ALTURA - 14, MARGEM + UTIL, ALTURA - 14);
}

/* -------------------------------------------------------------------------
 * Composição
 * ------------------------------------------------------------------------- */

async function carregarJsPdf() {
  const [jspdf, autotable] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const autoTable = ((autotable as unknown as { default?: AutoTable })
    .default ?? (autotable as unknown as { autoTable: AutoTable }).autoTable) as AutoTable;
  return { jsPDF: jspdf.jsPDF, autoTable };
}

/** Monta o documento inteiro e devolve a instância do jsPDF. */
export async function renderReportPdf(
  report: ReportDocument,
  options: ReportPdfOptions = {},
) {
  const { jsPDF: JsPdf, autoTable } = await carregarJsPdf();
  const doc = new JsPdf({ unit: "mm", format: "a4", orientation: "portrait" });
  doc.setProperties({
    title: report.title,
    subject: `${report.subtitle} · ${report.scope}`,
    author: report.candidatura,
    keywords: [report.estado, report.scope, "TSE", "IBGE"].join(", "),
    creator: "Plataforma de inteligência eleitoral",
  });

  const ctx: Contexto = {
    doc,
    tema: criarTemaPdf(),
    autoTable,
    y: TOPO,
    marcadores: new Map<number, string>(),
  };

  desenharCapa(ctx, report);
  const secoes =
    report.sections && report.sections.length > 0
      ? [...report.sections]
      : secoesPadrao(report);
  // O anexo é o ÚLTIMO conteúdo do documento e só existe se for pedido.
  if (options.incluirAnexoMunicipal && report.annexTable) {
    secoes.push(secaoAnexo(report.annexTable));
  }
  for (const section of secoes) desenharSecao(ctx, section);
  desenharRodapes(ctx, report);
  return doc;
}

/** Bytes do PDF, usados pelos testes e pelo gerador de exemplos. */
export async function buildPdfBuffer(
  report: ReportDocument,
  options: ReportPdfOptions = {},
): Promise<ArrayBuffer> {
  const doc = await renderReportPdf(report, options);
  return doc.output("arraybuffer") as ArrayBuffer;
}

/**
 * Gera e baixa o PDF. Resolve `false` quando não há nada para imprimir: um
 * relatório só com capa passaria a impressão de que os dados estão ali.
 */
export async function exportReportAsPdf(
  report: ReportDocument,
  options: ReportPdfOptions = {},
): Promise<boolean> {
  const temNarrativa = (report.sections?.length ?? 0) > 0;
  if (!temNarrativa && !hasExportableContent(report)) return false;
  const doc = await renderReportPdf(report, options);
  downloadBlobFile(
    new Blob([doc.output("arraybuffer") as ArrayBuffer], { type: PDF_MIME }),
    buildReportFilename(report, "pdf"),
  );
  return true;
}
