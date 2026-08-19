import type { Workbook, Worksheet } from "exceljs";
import { downloadBlobFile } from "./browser.ts";
import {
  buildWorkbookPlan,
  formatGeneratedAt,
  isNumericColumn,
  type CoverBlock,
  type ReportDocument,
  type ReportTable,
  type WorkbookPlan,
} from "./reportModel.ts";

/**
 * Pasta de trabalho .xlsx: traduz o plano (reportModel) em chamadas do exceljs.
 * Nenhuma decisão de conteúdo mora aqui; teste de conteúdo olha o PLANO.
 *
 * exceljs e não SheetJS porque a versão comunitária do SheetJS não escreve
 * estilo de célula (`cellStyles` é do build pago). A biblioteca é carregada por
 * IMPORT DINÂMICO: são ~940 kB minificados, baixados só ao clicar em "Excel".
 */

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/* Paleta da campanha em ARGB, como o OOXML exige. */
const VERMELHO = "FFC1121F";
const VERMELHO_CLARO = "FFF0433B";
const SUPERFICIE_ALT = "FFF6F3F2";
const TINTA = "FF201B1A";
const TINTA_SUAVE = "FF554E4C";
const TINTA_FRACA = "FF6E6560";
const BRANCO = "FFFFFFFF";

type ExcelModule = { Workbook: new () => Workbook };

/**
 * Resolve o namespace do exceljs nos dois ambientes: no navegador o Vite
 * entrega o build UMD sob `default`; no Node o interop de CJS expõe os dois.
 */
async function loadExcel(): Promise<ExcelModule> {
  const mod = (await import("exceljs")) as unknown as {
    default?: ExcelModule;
  } & ExcelModule;
  return mod.default ?? mod;
}

function aplicarCapa(sheet: Worksheet, blocks: CoverBlock[]) {
  /* A capa tem cinco colunas largas (fonte, recorte, endereço): sem paisagem
     com ajuste à largura, a impressão joga as três últimas para páginas
     soltas. */
  sheet.pageSetup = {
    orientation: "landscape",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: {
      left: 0.4,
      right: 0.4,
      top: 0.6,
      bottom: 0.6,
      header: 0.3,
      footer: 0.3,
    },
  };
  sheet.columns = [
    { width: 34 },
    { width: 42 },
    { width: 34 },
    { width: 38 },
    { width: 46 },
  ];
  let linha = 1;

  for (const block of blocks) {
    if (block.kind === "titulo") {
      const cell = sheet.getCell(linha, 1);
      cell.value = block.text;
      cell.font = { name: "Calibri", size: 22, bold: true, color: { argb: VERMELHO } };
      sheet.getRow(linha).height = 30;
      sheet.mergeCells(linha, 1, linha, 5);
      linha += 1;
      continue;
    }
    if (block.kind === "subtitulo") {
      const cell = sheet.getCell(linha, 1);
      cell.value = block.text;
      cell.font = { name: "Calibri", size: 12, color: { argb: TINTA_SUAVE } };
      sheet.mergeCells(linha, 1, linha, 5);
      linha += 2;
      continue;
    }
    if (block.kind === "campo") {
      const rotulo = sheet.getCell(linha, 1);
      rotulo.value = block.label;
      rotulo.font = { name: "Calibri", size: 11, bold: true, color: { argb: TINTA_FRACA } };
      const valor = sheet.getCell(linha, 2);
      valor.value = block.value;
      valor.font = { name: "Calibri", size: 11, color: { argb: TINTA } };
      sheet.mergeCells(linha, 2, linha, 5);
      linha += 1;
      continue;
    }
    if (block.kind === "secao") {
      linha += 1;
      const cell = sheet.getCell(linha, 1);
      cell.value = block.text;
      cell.font = { name: "Calibri", size: 13, bold: true, color: { argb: VERMELHO } };
      sheet.mergeCells(linha, 1, linha, 5);
      linha += 1;
      continue;
    }
    if (block.kind === "tabela") {
      block.headers.forEach((header, indice) => {
        const cell = sheet.getCell(linha, indice + 1);
        cell.value = header;
        cell.font = { name: "Calibri", size: 10, bold: true, color: { argb: BRANCO } };
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: VERMELHO },
        };
        cell.alignment = { vertical: "middle" };
      });
      linha += 1;
      for (const row of block.rows) {
        row.forEach((valor, indice) => {
          const cell = sheet.getCell(linha, indice + 1);
          // String vazia continua vazia: na capa, "sem endereço publicado" não
          // pode virar um traço que pareça dado.
          cell.value = valor === "" ? null : valor;
          cell.font = { name: "Calibri", size: 10, color: { argb: TINTA } };
          cell.alignment = { vertical: "top", wrapText: true };
        });
        linha += 1;
      }
      linha += 1;
      continue;
    }
    const nota = sheet.getCell(linha, 1);
    nota.value = block.text;
    nota.font = { name: "Calibri", size: 9, italic: true, color: { argb: TINTA_FRACA } };
    sheet.mergeCells(linha, 1, linha, 5);
    nota.alignment = { wrapText: true, vertical: "top" };
    linha += 1;
  }
}

function aplicarDados(
  sheet: Worksheet,
  table: ReportTable,
  widths: number[],
  numberFormats: Array<string | null>,
) {
  sheet.columns = widths.map((width) => ({ width }));

  const header = sheet.getRow(1);
  table.columns.forEach((column, indice) => {
    const cell = header.getCell(indice + 1);
    cell.value = column.header;
    cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: BRANCO } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: VERMELHO },
    };
    cell.alignment = {
      vertical: "middle",
      horizontal: isNumericColumn(column) ? "right" : "left",
      wrapText: true,
    };
    cell.border = { bottom: { style: "thin", color: { argb: VERMELHO_CLARO } } };
  });
  header.height = 30;

  table.rows.forEach((row, indiceLinha) => {
    const excelRow = sheet.getRow(indiceLinha + 2);
    table.columns.forEach((column, indiceColuna) => {
      const valor = row[indiceColuna] ?? null;
      const cell = excelRow.getCell(indiceColuna + 1);
      // AUSÊNCIA É CÉLULA VAZIA: `null` aqui viraria zero e a coluna somaria a
      // mentira sem avisar ninguém.
      cell.value = valor === null || valor === "" ? null : valor;
      const formato = numberFormats[indiceColuna];
      if (formato && typeof valor === "number") cell.numFmt = formato;
      cell.font = { name: "Calibri", size: 10, color: { argb: TINTA } };
      cell.alignment = {
        vertical: "middle",
        horizontal: isNumericColumn(column) ? "right" : "left",
      };
      // Zebra discreta: linhas pares recebem a superfície secundária da paleta.
      if (indiceLinha % 2 === 1) {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: SUPERFICIE_ALT },
        };
      }
    });
  });

  sheet.views = [{ state: "frozen", ySplit: 1 }];
  if (table.columns.length > 0) {
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: table.columns.length },
    };
  }

  sheet.pageSetup = {
    orientation: "landscape",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    printTitlesRow: "1:1",
    margins: {
      left: 0.4,
      right: 0.4,
      top: 0.6,
      bottom: 0.6,
      header: 0.3,
      footer: 0.3,
    },
  };
  const fonte = [table.source.label, table.source.detail]
    .filter(Boolean)
    .join(" · ");
  sheet.headerFooter = {
    oddHeader: `&L&"Calibri,Bold"${table.title}&R&"Calibri,Regular"${table.subtitle ?? ""}`,
    oddFooter: `&L&"Calibri,Regular"&8${fonte}&RPágina &P de &N`,
  };
}

/** Traduz o plano em uma pasta de trabalho do exceljs. */
export async function renderWorkbook(plan: WorkbookPlan): Promise<Workbook> {
  const Excel = await loadExcel();
  const workbook = new Excel.Workbook();
  workbook.creator = plan.creator;
  workbook.lastModifiedBy = plan.creator;
  workbook.created = plan.generatedAt;
  workbook.modified = plan.generatedAt;
  workbook.title = plan.title;
  workbook.description = `Gerado em ${formatGeneratedAt(plan.generatedAt)}`;

  for (const sheetPlan of plan.sheets) {
    const sheet = workbook.addWorksheet(sheetPlan.name, {
      properties: { tabColor: { argb: VERMELHO } },
    });
    if (sheetPlan.kind === "capa") {
      aplicarCapa(sheet, sheetPlan.blocks);
    } else {
      aplicarDados(
        sheet,
        sheetPlan.table,
        sheetPlan.widths,
        sheetPlan.numberFormats,
      );
    }
  }
  return workbook;
}

/** Bytes do .xlsx, usado pelos testes e pelo gerador de exemplos. */
export async function buildWorkbookBuffer(
  doc: ReportDocument,
): Promise<ArrayBuffer> {
  const workbook = await renderWorkbook(buildWorkbookPlan(doc));
  return (await workbook.xlsx.writeBuffer()) as ArrayBuffer;
}

/**
 * Gera e baixa a pasta de trabalho. Resolve `false` quando o documento não tem
 * nenhuma linha para exportar: arquivo vazio é pior que nenhum arquivo.
 */
export async function exportReportAsExcel(doc: ReportDocument): Promise<boolean> {
  const plan = buildWorkbookPlan(doc);
  if (plan.sheets.every((sheet) => sheet.kind === "capa")) return false;
  const buffer = await buildWorkbookBuffer(doc);
  downloadBlobFile(new Blob([buffer], { type: XLSX_MIME }), plan.filename);
  return true;
}
