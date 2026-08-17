import type { jsPDF } from "jspdf";
import { downloadBlobFile } from "./browser.ts";
import {
  buildReportFilename,
  formatGeneratedAt,
  formatReportCell,
  isNumericColumn,
  type ReportColumn,
  type ReportDocument,
  type ReportTable,
} from "./reportModel.ts";

/**
 * Relatório em PDF — tradução do modelo (reportModel) em um documento com
 * capa, sumário, tabelas paginadas e rodapé numerado.
 *
 * ESCOLHA DA BIBLIOTECA: jsPDF + jspdf-autotable, e não pdfmake.
 *
 * - o autotable resolve de graça as três coisas que fazem uma tabela longa
 *   parecer relatório e não despejo: cabeçalho repetido em toda página
 *   (`showHead: "everyPage"`), quebra de página por linha e zebra;
 * - o jsPDF desenha em coordenadas, o que é exatamente o que a capa com faixa
 *   vermelha e a grade de cartões precisam — em pdfmake isso viraria uma
 *   árvore declarativa com tabelas invisíveis fazendo as vezes de layout;
 * - tamanho: jsPDF + autotable somam ~380 kB minificados contra ~1,2 MB do
 *   pdfmake com o vfs de fontes embutido. Como as duas bibliotecas entram por
 *   import dinâmico, isso só pesa para quem exporta — mas o de menor peso
 *   ganha o desempate;
 * - as imagens (mapa e gráficos) já chegam como PNG em data URL, e
 *   `addImage` as coloca direto.
 *
 * ACENTUAÇÃO: as fontes padrão do PDF usam WinAnsi (cp1252), que cobre todo o
 * português — "Goiânia", "Anápolis", "Luziânia", "eleição", "índice" saem
 * corretos e são extraíveis como texto. O que cp1252 NÃO cobre são símbolos
 * como a seta "→", que sairiam como lixo: `toPdfText` os transcreve antes de
 * escrever. Embutir uma fonte UTF-8 custaria ~400 kB por arquivo gerado para
 * resolver meia dúzia de setas — não compensa.
 */

const PDF_MIME = "application/pdf";

/* Paleta da campanha em RGB, como o jsPDF pede. */
const VERMELHO: [number, number, number] = [193, 18, 31];
const VERMELHO_CLARO: [number, number, number] = [240, 67, 59];
const SUPERFICIE: [number, number, number] = [246, 243, 242];
const BRANCO: [number, number, number] = [255, 255, 255];
const TINTA: [number, number, number] = [32, 27, 26];
const TINTA_SUAVE: [number, number, number] = [85, 78, 76];
const TINTA_FRACA: [number, number, number] = [110, 101, 96];
const LINHA: [number, number, number] = [225, 218, 216];

/* Geometria da página A4 retrato, em milímetros. */
const LARGURA = 210;
const ALTURA = 297;
const MARGEM = 16;
const TOPO = 18;
const RODAPE = 20;
const UTIL = LARGURA - 2 * MARGEM;

/**
 * Teto de linhas por tabela no PDF. Um recorte de locais de votação pode ter
 * milhares de unidades: imprimir tudo geraria um documento de centenas de
 * páginas que ninguém abre. O PDF é o documento de leitura; a planilha é a
 * base completa — e o corte é declarado na própria tabela, nunca silencioso.
 */
export const PDF_MAX_ROWS = 250;

/* -------------------------------------------------------------------------
 * Texto seguro para as fontes padrão (cp1252)
 * ------------------------------------------------------------------------- */

/** Símbolos fora do cp1252 que aparecem nos textos da plataforma. */
const SUBSTITUICOES: Record<string, string> = {
  "→": "->",
  "←": "<-",
  "↑": "^",
  "↓": "v",
  "≥": ">=",
  "≤": "<=",
  "≠": "!=",
  "≈": "~",
  "⁰": "0",
  "′": "'",
  "″": '"',
  "∞": "infinito",
};

/** Faixa extra do cp1252 (0x80–0x9F): aspas curvas, travessões, bullet… */
const CP1252_EXTRA = new Set([
  "\u20ac", "\u201a", "\u0192", "\u201e", "\u2026", "\u2020", "\u2021",
  "\u02c6", "\u2030", "\u0160", "\u2039", "\u0152", "\u017d", "\u2018",
  "\u2019", "\u201c", "\u201d", "\u2022", "\u2013", "\u2014", "\u02dc",
  "\u2122", "\u0161", "\u203a", "\u0153", "\u017e", "\u0178",
]);

/**
 * Prepara um texto para as fontes padrão do PDF.
 *
 * Acentuação portuguesa passa intacta (está toda em Latin-1). Símbolos
 * conhecidos viram equivalentes legíveis; o que sobrar fora do cp1252 perde os
 * diacríticos e, em último caso, é descartado — melhor uma palavra sem acento
 * do que um glifo aleatório no meio de um relatório de campanha.
 */
export function toPdfText(value: string): string {
  let saida = "";
  for (const char of value) {
    const substituto = SUBSTITUICOES[char];
    if (substituto !== undefined) {
      saida += substituto;
      continue;
    }
    const codigo = char.codePointAt(0) ?? 0;
    if (codigo < 0x80 || (codigo >= 0xa0 && codigo <= 0xff)) {
      saida += char;
      continue;
    }
    if (CP1252_EXTRA.has(char)) {
      saida += char;
      continue;
    }
    const semAcento = char
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    saida += [...semAcento].every(
      (item) => (item.codePointAt(0) ?? 0) <= 0xff,
    )
      ? semAcento
      : "";
  }
  return saida;
}

/* -------------------------------------------------------------------------
 * Utilidades de desenho
 * ------------------------------------------------------------------------- */

type Cursor = { y: number };

function definirTexto(
  doc: jsPDF,
  size: number,
  color: [number, number, number],
  style: "normal" | "bold" | "italic" = "normal",
) {
  doc.setFont("helvetica", style);
  doc.setFontSize(size);
  doc.setTextColor(color[0], color[1], color[2]);
}

/** Escreve um parágrafo com quebra automática e devolve a altura ocupada. */
function paragrafo(
  doc: jsPDF,
  texto: string,
  x: number,
  y: number,
  largura: number,
  alturaLinha: number,
) {
  const linhas = doc.splitTextToSize(toPdfText(texto), largura) as string[];
  linhas.forEach((linha, indice) => {
    doc.text(linha, x, y + indice * alturaLinha);
  });
  return linhas.length * alturaLinha;
}

function garantirEspaco(doc: jsPDF, cursor: Cursor, necessario: number) {
  if (cursor.y + necessario <= ALTURA - RODAPE) return;
  doc.addPage();
  cursor.y = TOPO;
}

function tituloSecao(doc: jsPDF, cursor: Cursor, texto: string, sub?: string) {
  garantirEspaco(doc, cursor, sub ? 22 : 16);
  definirTexto(doc, 13, VERMELHO, "bold");
  doc.text(toPdfText(texto), MARGEM, cursor.y);
  cursor.y += 5;
  if (sub) {
    definirTexto(doc, 9, TINTA_SUAVE);
    cursor.y += paragrafo(doc, sub, MARGEM, cursor.y, UTIL, 4);
  }
  doc.setDrawColor(VERMELHO_CLARO[0], VERMELHO_CLARO[1], VERMELHO_CLARO[2]);
  doc.setLineWidth(0.4);
  doc.line(MARGEM, cursor.y, MARGEM + UTIL, cursor.y);
  cursor.y += 5;
}

/* -------------------------------------------------------------------------
 * Capa
 * ------------------------------------------------------------------------- */

const FAIXA_ALTURA = 74;

function desenharCapa(doc: jsPDF, report: ReportDocument): Cursor {
  doc.setFillColor(VERMELHO[0], VERMELHO[1], VERMELHO[2]);
  doc.rect(0, 0, LARGURA, FAIXA_ALTURA, "F");

  definirTexto(doc, 9, BRANCO, "bold");
  doc.text(toPdfText(report.candidatura.toUpperCase()), MARGEM, 22);

  definirTexto(doc, 26, BRANCO, "bold");
  const titulo = doc.splitTextToSize(
    toPdfText(report.title),
    UTIL,
  ) as string[];
  titulo.forEach((linha, indice) => doc.text(linha, MARGEM, 36 + indice * 11));

  definirTexto(doc, 13, BRANCO);
  doc.text(toPdfText(report.subtitle), MARGEM, 36 + titulo.length * 11 + 4);

  definirTexto(doc, 9.5, BRANCO);
  // O estado só entra quando o recorte ainda não o nomeia — "Goiás · Goiás"
  // na capa é o tipo de repetição que denuncia arquivo montado por script.
  const escopo = report.scope.includes(report.estado)
    ? report.scope
    : `${report.scope} · ${report.estado}`;
  doc.text(toPdfText(escopo), MARGEM, FAIXA_ALTURA - 10);

  const cursor: Cursor = { y: FAIXA_ALTURA + 12 };
  definirTexto(doc, 9, TINTA_FRACA);
  doc.text(
    toPdfText(`Gerado em ${formatGeneratedAt(report.generatedAt)}`),
    MARGEM,
    cursor.y,
  );
  cursor.y += 10;
  return cursor;
}

const CARTAO_COLUNAS = 2;
const CARTAO_ALTURA = 26;
const CARTAO_ESPACO = 4;

/** Os mesmos cartões que a tela mostra, na grade da capa. */
function desenharCartoes(doc: jsPDF, cursor: Cursor, report: ReportDocument) {
  if (report.highlights.length === 0) return;
  tituloSecao(doc, cursor, "Números do recorte");
  const largura = (UTIL - CARTAO_ESPACO * (CARTAO_COLUNAS - 1)) / CARTAO_COLUNAS;

  report.highlights.forEach((item, indice) => {
    const coluna = indice % CARTAO_COLUNAS;
    if (coluna === 0) garantirEspaco(doc, cursor, CARTAO_ALTURA + 2);
    const x = MARGEM + coluna * (largura + CARTAO_ESPACO);
    const y = cursor.y;
    doc.setFillColor(SUPERFICIE[0], SUPERFICIE[1], SUPERFICIE[2]);
    doc.roundedRect(x, y, largura, CARTAO_ALTURA, 1.6, 1.6, "F");
    definirTexto(doc, 7.5, TINTA_FRACA, "bold");
    doc.text(toPdfText(item.label.toUpperCase()), x + 4, y + 6);
    definirTexto(doc, 16, TINTA, "bold");
    doc.text(toPdfText(item.value), x + 4, y + 15);
    if (item.note) {
      definirTexto(doc, 7, TINTA_SUAVE);
      const linhas = (
        doc.splitTextToSize(toPdfText(item.note), largura - 8) as string[]
      ).slice(0, 2);
      linhas.forEach((linha, posicao) =>
        doc.text(linha, x + 4, y + 20 + posicao * 3.2),
      );
    }
    if (coluna === CARTAO_COLUNAS - 1) cursor.y += CARTAO_ALTURA + CARTAO_ESPACO;
  });
  if (report.highlights.length % CARTAO_COLUNAS !== 0) {
    cursor.y += CARTAO_ALTURA + CARTAO_ESPACO;
  }
  cursor.y += 4;
}

/** Procedência: de onde veio cada tabela do documento. */
function desenharFontes(doc: jsPDF, cursor: Cursor, report: ReportDocument) {
  if (report.tables.length === 0) return;
  tituloSecao(doc, cursor, "Fontes e procedência");
  for (const table of report.tables) {
    garantirEspaco(doc, cursor, 16);
    definirTexto(doc, 9.5, TINTA, "bold");
    doc.text(toPdfText(table.title), MARGEM, cursor.y);
    cursor.y += 4;
    definirTexto(doc, 8.5, TINTA_SUAVE);
    const fonte = [table.source.label, table.source.detail]
      .filter(Boolean)
      .join(" · ");
    cursor.y += paragrafo(doc, fonte, MARGEM, cursor.y, UTIL, 3.8);
    if (table.source.url) {
      definirTexto(doc, 7.5, TINTA_FRACA);
      cursor.y += paragrafo(doc, table.source.url, MARGEM, cursor.y, UTIL, 3.4);
    }
    cursor.y += 3;
  }
}

/**
 * Conjuntos que NÃO estão no documento, com o motivo. Declarar a ausência é
 * parte do relatório: quem lê precisa distinguir "não houve voto" de "este
 * dado não foi gerado nesta instalação".
 */
function desenharOmissoes(doc: jsPDF, cursor: Cursor, report: ReportDocument) {
  if (report.omitted.length === 0) return;
  tituloSecao(doc, cursor, "Conjuntos não incluídos");
  for (const item of report.omitted) {
    garantirEspaco(doc, cursor, 14);
    definirTexto(doc, 9.5, TINTA, "bold");
    doc.text(toPdfText(item.title), MARGEM, cursor.y);
    cursor.y += 4;
    definirTexto(doc, 8.5, TINTA_SUAVE);
    cursor.y += paragrafo(doc, item.reason, MARGEM, cursor.y, UTIL, 3.8);
    cursor.y += 3;
  }
}

/* -------------------------------------------------------------------------
 * Imagens e tabelas
 * ------------------------------------------------------------------------- */

function desenharImagens(doc: jsPDF, cursor: Cursor, report: ReportDocument) {
  for (const image of report.images) {
    const largura = UTIL;
    const altura = Math.min(
      largura / (image.aspectRatio > 0 ? image.aspectRatio : 1.6),
      ALTURA - TOPO - RODAPE - 24,
    );
    garantirEspaco(doc, cursor, altura + 22);
    tituloSecao(doc, cursor, image.title);
    doc.addImage(
      image.dataUrl,
      "PNG",
      MARGEM,
      cursor.y,
      largura,
      altura,
      undefined,
      "FAST",
    );
    cursor.y += altura + 3;
    if (image.caption) {
      definirTexto(doc, 8, TINTA_FRACA, "italic");
      cursor.y += paragrafo(doc, image.caption, MARGEM, cursor.y, UTIL, 3.6);
    }
    cursor.y += 6;
  }
}

/** Colunas que entram no PDF (as técnicas ficam só na planilha). */
export function getPdfColumns(table: ReportTable): ReportColumn[] {
  const visiveis = table.columns.filter((column) => !column.pdfHidden);
  return visiveis.length > 0 ? visiveis : table.columns;
}

function linhasVisiveis(table: ReportTable) {
  const indices = table.columns
    .map((column, indice) => ({ column, indice }))
    .filter(({ column }) => !column.pdfHidden)
    .map(({ indice }) => indice);
  const usados = indices.length > 0 ? indices : table.columns.map((_, i) => i);
  return table.rows
    .slice(0, PDF_MAX_ROWS)
    .map((row) =>
      usados.map((indice) =>
        formatReportCell(row[indice] ?? null, table.columns[indice]),
      ),
    );
}

type AutoTable = (doc: jsPDF, options: Record<string, unknown>) => void;

/** As notas de rodapé de uma tabela, na ordem em que são lidas. */
function montarNotas(table: ReportTable): string[] {
  const notas = [...(table.notes ?? [])];
  if (table.rows.length > PDF_MAX_ROWS) {
    notas.unshift(
      `Mostrando as ${PDF_MAX_ROWS} primeiras de ${table.rows.length} linhas. A pasta de trabalho em Excel traz todas.`,
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

function desenharTabela(
  doc: jsPDF,
  cursor: Cursor,
  table: ReportTable,
  autoTable: AutoTable,
) {
  const columns = getPdfColumns(table);
  const linhas = linhasVisiveis(table);
  garantirEspaco(doc, cursor, 40);
  tituloSecao(doc, cursor, table.title, table.subtitle);

  /* Largura proporcional ao CONTEÚDO, e não a divisão igual que o autotable
     faz por padrão: numa tabela de três colunas a divisão igual deixa
     "Posição" com 6 cm vazios e "Município" apertado.
     O cabeçalho pesa MENOS que as células (fator 0,55) porque ele quebra em
     várias linhas sem prejuízo, enquanto um nome de município cortado no meio
     é ilegível — sem esse desconto, "Mulheres no cadastro (% do eleitorado)"
     roubaria metade da página para exibir um número de quatro dígitos. */
  const pesos = columns.map((column, indice) => {
    const cabecalho = column.header.length * 0.55;
    // Piso: a MAIOR PALAVRA do cabeçalho tem de caber inteira. Sem esse piso,
    // "Turno" (5 letras, células de 1 dígito) ganhava largura de 3 caracteres
    // e o cabeçalho saía partido como "Turn / o".
    const maiorPalavra = Math.max(
      ...column.header.split(/[\s·]+/).map((palavra) => palavra.length),
    );
    const maiorCelula = linhas.reduce(
      (maior, linha) => Math.max(maior, (linha[indice] ?? "").length),
      0,
    );
    return Math.max(cabecalho, maiorPalavra, maiorCelula) + 2;
  });
  const somaPesos = pesos.reduce((soma, peso) => soma + peso, 0) || 1;
  const columnStyles: Record<
    number,
    { halign: "right" | "left"; cellWidth: number }
  > = {};
  columns.forEach((column, indice) => {
    columnStyles[indice] = {
      halign: isNumericColumn(column) ? "right" : "left",
      cellWidth: (UTIL * pesos[indice]) / somaPesos,
    };
  });

  /* As notas são montadas e MEDIDAS antes da tabela, e a altura delas entra na
     margem inferior do autotable. Sem isso a tabela ocupava até o pé da página
     e o bloco de notas — que não pode ser partido — migrava inteiro para uma
     folha nova, deixando o relatório terminar numa página quase vazia com
     meia dúzia de linhas de legenda. Reservando o espaço, a tabela quebra um
     pouco antes e as notas ficam sempre logo abaixo dela. */
  const notas = montarNotas(table);
  definirTexto(doc, 7.5, TINTA_FRACA);
  const blocosNotas = notas.map((nota) => ({
    linhas: doc.splitTextToSize(toPdfText(`• ${nota}`), UTIL) as string[],
  }));
  const alturaNotas = blocosNotas.reduce(
    (soma, bloco) => soma + bloco.linhas.length * 3.4 + 1,
    0,
  );

  autoTable(doc, {
    head: [columns.map((column) => toPdfText(column.header))],
    body: linhas,
    startY: cursor.y,
    margin: {
      left: MARGEM,
      right: MARGEM,
      top: TOPO,
      // +9 não é folga arbitrária: são os 5 mm de respiro entre a tabela e as
      // notas mais os 2 mm que o garantirEspaco exige, e ainda 2 mm de sobra.
      // Com +4 a conta fechava 1,9 mm curta e o bloco de notas caía sozinho
      // numa página nova — o relatório terminava numa folha quase branca.
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
      textColor: TINTA,
      lineColor: LINHA,
      lineWidth: 0,
      overflow: "linebreak",
    },
    headStyles: {
      fillColor: VERMELHO,
      textColor: BRANCO,
      fontStyle: "bold",
      fontSize: 8,
    },
    // Zebra discreta: a superfície secundária da paleta, o suficiente para o
    // olho seguir a linha numa tabela de 246 municípios.
    alternateRowStyles: { fillColor: SUPERFICIE },
    columnStyles,
  });

  const finalY =
    (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable
      ?.finalY ?? cursor.y;
  cursor.y = finalY + 5;

  garantirEspaco(doc, cursor, alturaNotas + 2);
  definirTexto(doc, 7.5, TINTA_FRACA);
  for (const bloco of blocosNotas) {
    bloco.linhas.forEach((linha, indice) => {
      doc.text(linha, MARGEM, cursor.y + indice * 3.4);
    });
    cursor.y += bloco.linhas.length * 3.4 + 1;
  }
  cursor.y += 6;
}

/* -------------------------------------------------------------------------
 * Rodapé
 * ------------------------------------------------------------------------- */

/**
 * Rodapé desenhado no fim, quando o total de páginas já é conhecido — assim
 * "página X de Y" é o número real, sem placeholder trocado depois.
 */
function desenharRodapes(doc: jsPDF, report: ReportDocument) {
  const total = doc.getNumberOfPages();
  const data = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(report.generatedAt);
  for (let pagina = 1; pagina <= total; pagina += 1) {
    doc.setPage(pagina);
    doc.setDrawColor(LINHA[0], LINHA[1], LINHA[2]);
    doc.setLineWidth(0.2);
    doc.line(MARGEM, ALTURA - 14, MARGEM + UTIL, ALTURA - 14);
    definirTexto(doc, 7, TINTA_FRACA);
    doc.text(toPdfText(report.attribution), MARGEM, ALTURA - 10);
    doc.text(
      toPdfText(`Página ${pagina} de ${total} · ${data}`),
      MARGEM + UTIL,
      ALTURA - 10,
      { align: "right" },
    );
  }
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
export async function renderReportPdf(report: ReportDocument) {
  const { jsPDF: JsPdf, autoTable } = await carregarJsPdf();
  const doc = new JsPdf({ unit: "mm", format: "a4", orientation: "portrait" });
  doc.setProperties({
    title: report.title,
    subject: `${report.subtitle} · ${report.scope}`,
    author: report.candidatura,
    creator: "Plataforma de inteligência eleitoral",
  });

  const cursor = desenharCapa(doc, report);
  desenharCartoes(doc, cursor, report);
  desenharFontes(doc, cursor, report);
  desenharOmissoes(doc, cursor, report);
  desenharImagens(doc, cursor, report);

  // As tabelas começam em página nova: a primeira página fica sendo a capa com
  // o sumário do recorte, que é o que se projeta numa reunião, e nenhuma
  // tabela nasce espremida no rodapé dela.
  const comLinhas = report.tables.filter((table) => table.rows.length > 0);
  if (comLinhas.length > 0) {
    doc.addPage();
    cursor.y = TOPO;
  }
  for (const table of comLinhas) {
    desenharTabela(doc, cursor, table, autoTable);
  }
  desenharRodapes(doc, report);
  return doc;
}

/** Bytes do PDF — usado pelos testes e pelo gerador de exemplos. */
export async function buildPdfBuffer(
  report: ReportDocument,
): Promise<ArrayBuffer> {
  const doc = await renderReportPdf(report);
  return doc.output("arraybuffer") as ArrayBuffer;
}

/**
 * Gera e baixa o PDF. Resolve `false` quando não há nenhuma linha para
 * imprimir — um relatório só com capa passaria a impressão de que os dados
 * estão ali para quem não rolar até o fim.
 */
export async function exportReportAsPdf(report: ReportDocument): Promise<boolean> {
  if (!report.tables.some((table) => table.rows.length > 0)) return false;
  const doc = await renderReportPdf(report);
  downloadBlobFile(
    new Blob([doc.output("arraybuffer") as ArrayBuffer], { type: PDF_MIME }),
    buildReportFilename(report, "pdf"),
  );
  return true;
}
