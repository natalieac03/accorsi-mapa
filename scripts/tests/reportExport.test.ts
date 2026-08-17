import assert from "node:assert/strict";
import test from "node:test";
import type { ReportDocument } from "../../src/utils/reportModel.ts";
import { buildReportFilename } from "../../src/utils/reportModel.ts";
import { buildWorkbookBuffer } from "../../src/utils/exportExcel.ts";
import { buildPdfBuffer, renderReportPdf } from "../../src/utils/exportPdf.ts";

/**
 * Verificação de IDA E VOLTA dos dois arquivos, com payload sintético inline.
 *
 * O teste do plano (reportModel.test.ts) prova que o MODELO está certo; este
 * prova que o modelo chegou intacto ao arquivo — que a célula ausente saiu de
 * fato vazia no .xlsx, que o painel congelou, que o autofiltro existe e que a
 * acentuação portuguesa sobreviveu ao PDF. As duas bibliotecas rodam no runner
 * do node:test sem adaptação, então nada aqui é pulado.
 */

const AGORA = new Date("2026-08-17T17:32:00Z");

function documento(): ReportDocument {
  return {
    filenameBase: "relatorio-teste",
    title: "Trajetória eleitoral",
    subtitle: "Visão geral da carreira",
    scope: "Deputada Federal 2022 · 1º turno",
    candidatura: "Dra. Adriana Accorsi · PT",
    estado: "Goiás",
    generatedAt: AGORA,
    highlights: [
      {
        label: "Melhor votação",
        value: "96.000",
        note: "2022 · Deputada Federal",
      },
      { label: "Crescimento municipal", value: "—", note: "sem par comparável" },
    ],
    tables: [
      {
        id: "municipios",
        title: "Municípios 2022",
        subtitle: "Ordenado por votos absolutos",
        columns: [
          { header: "Posição", format: "numero" },
          { header: "Município", format: "texto" },
          { header: "Código IBGE", format: "texto", pdfHidden: true },
          { header: "Votos", format: "inteiro" },
          { header: "% dos válidos", format: "percentual", decimals: 2 },
          { header: "Índice", format: "decimal", decimals: 1 },
        ],
        rows: [
          [1, "Goiânia", "5208707", 40000, 12.35, 4.2],
          [2, "Anápolis", "5201405", 12000, 8.4, 5],
          // Município sem denominador apurado: as duas últimas células ficam
          // VAZIAS no arquivo, e a de votos zerados continua sendo zero.
          [3, "Luziânia", "5212501", 0, null, null],
        ],
        notes: ["Percentual sobre os válidos apurados no município."],
        source: {
          label: "TSE · Resultados por município",
          detail: "Eleições 2022 · Deputada Federal · 1º turno",
          url: "https://dadosabertos.tse.jus.br/",
        },
      },
    ],
    omitted: [
      {
        title: "Cruzamento com indicadores",
        reason: "Nenhum município tem % dos válidos e o indicador ao mesmo tempo.",
      },
    ],
    images: [],
    attribution: "Elaborado com dados públicos TSE/IBGE",
  };
}

test("a pasta de trabalho abre e preserva ausência, formato e congelamento", async () => {
  const buffer = await buildWorkbookBuffer(documento());
  const mod = (await import("exceljs")) as unknown as {
    default?: { Workbook: new () => import("exceljs").Workbook };
    Workbook: new () => import("exceljs").Workbook;
  };
  const Excel = mod.default ?? mod;
  const lida = new Excel.Workbook();
  await lida.xlsx.load(buffer);

  assert.deepEqual(
    lida.worksheets.map((sheet) => sheet.name),
    ["Capa e fontes", "Municípios 2022"],
  );

  const capa = lida.getWorksheet("Capa e fontes");
  assert.ok(capa);
  if (!capa) return;
  // A capa leva a procedência a sério: título, candidatura e a fonte da aba.
  const textoDaCapa: string[] = [];
  capa.eachRow((row) => {
    row.eachCell((cell) => {
      if (typeof cell.value === "string") textoDaCapa.push(cell.value);
    });
  });
  assert.ok(textoDaCapa.includes("Trajetória eleitoral"));
  assert.ok(textoDaCapa.includes("Dra. Adriana Accorsi · PT"));
  assert.ok(textoDaCapa.includes("TSE · Resultados por município"));
  assert.ok(
    textoDaCapa.some((texto) => texto.includes("17/08/2026 às 14:32")),
    "a capa declara data e hora de geração",
  );
  // A ausência é declarada, nunca preenchida.
  assert.ok(textoDaCapa.includes("Cruzamento com indicadores"));

  const dados = lida.getWorksheet("Municípios 2022");
  assert.ok(dados);
  if (!dados) return;

  // Cabeçalho em negrito, sobre o vermelho da campanha.
  const cabecalho = dados.getRow(1);
  assert.equal(cabecalho.getCell(2).value, "Município");
  assert.equal(cabecalho.getCell(2).font?.bold, true);
  assert.deepEqual(cabecalho.getCell(2).fill, {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFC1121F" },
  });

  // Painel congelado na primeira linha e autofiltro sobre o cabeçalho.
  assert.equal(dados.views.length, 1);
  assert.equal(dados.views[0].state, "frozen");
  assert.equal(
    (dados.views[0] as { ySplit?: number }).ySplit,
    1,
    "o cabeçalho continua visível ao rolar 246 municípios",
  );
  // O exceljs normaliza o intervalo do autofiltro para a notação A1 na leitura.
  assert.equal(dados.autoFilter, "A1:F1");

  // Larguras calculadas pelo conteúdo: "Município" cabe sem cortar.
  assert.ok((dados.getColumn(2).width ?? 0) >= 11);

  // A LINHA QUE IMPORTA: ausente é vazio, zero é zero.
  const luziania = dados.getRow(4);
  assert.equal(luziania.getCell(2).value, "Luziânia");
  assert.equal(luziania.getCell(4).value, 0);
  assert.equal(luziania.getCell(5).value, null);
  assert.equal(luziania.getCell(6).value, null);

  // Formatos numéricos declarados, no dialeto canônico do OOXML.
  const goiania = dados.getRow(2);
  assert.equal(goiania.getCell(4).value, 40000);
  assert.equal(goiania.getCell(4).numFmt, "[$-416]#,##0");
  assert.equal(goiania.getCell(5).numFmt, '[$-416]#,##0.00"%"');
  assert.equal(goiania.getCell(6).numFmt, "[$-416]#,##0.0");
  // Código IBGE segue texto: não pode virar número e perder zero à esquerda.
  assert.equal(goiania.getCell(3).value, "5208707");
  assert.equal(goiania.getCell(3).numFmt, undefined);

  // Zebra discreta nas linhas pares dos dados.
  assert.deepEqual(dados.getRow(3).getCell(1).fill, {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFF6F3F2" },
  });

  assert.equal(
    buildReportFilename(documento(), "xlsx"),
    "relatorio-teste-2026-08-17.xlsx",
  );
});

test("o PDF sai paginado, com rodapé numerado e acentuação correta", async () => {
  const doc = await renderReportPdf(documento());
  const paginas = doc.getNumberOfPages();
  assert.ok(paginas >= 1, `esperava ao menos 1 página, veio ${paginas}`);

  const buffer = Buffer.from(await buildPdfBuffer(documento()));
  assert.equal(buffer.subarray(0, 5).toString("latin1"), "%PDF-");

  // As fontes padrão do PDF gravam texto em cp1252: "Goiânia" aparece com o
  // byte 0xE2 no lugar do "â". É exatamente isso que o pdftotext lê de volta.
  const conteudo = buffer.toString("latin1");
  assert.ok(conteudo.includes("Goiânia"), "Goiânia saiu acentuado");
  assert.ok(conteudo.includes("Luziânia"), "Luziânia saiu acentuado");
  assert.ok(conteudo.includes("Anápolis"), "Anápolis saiu acentuado");
  assert.ok(conteudo.includes("Trajetória eleitoral"), "título acentuado");
  assert.ok(
    conteudo.includes(`Página 1 de ${paginas}`),
    "o rodapé traz página X de Y",
  );
  // O travessão do dado ausente chega ao documento; nenhum zero no lugar.
  // Em cp1252 o travessão é o byte 0x97, que a leitura latin1 devolve como
  // U+0097 — é a mesma marca que o pdftotext reconverte para "—".
  assert.ok(conteudo.includes("\u0097"), "travessão de dado ausente presente");
});
