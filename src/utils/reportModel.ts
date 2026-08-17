/**
 * MODELO DE RELATÓRIO — a camada intermediária entre os motores de dados e as
 * duas bibliotecas de saída (exceljs e jsPDF).
 *
 * Por que existe uma camada no meio, em vez de cada painel falar direto com a
 * biblioteca: o que precisa ser verificado neste projeto não é "o exceljs
 * escreveu um arquivo", é "a célula do município sem apuração saiu VAZIA e não
 * zero", "o percentual declarou 1 casa", "o conjunto pendente não virou aba".
 * Essas afirmações são sobre a ESTRUTURA do documento, e a estrutura mora
 * aqui — pura, sem DOM e sem dependência externa, testável com payload
 * sintético inline como o resto dos utils.
 *
 * Disciplinas herdadas do projeto e reforçadas aqui:
 *
 * - `null` é ausência: vira célula VAZIA no Excel e travessão no PDF. Nunca 0.
 *   Numa planilha isso é ainda mais grave que na tela, porque a coluna soma;
 * - conjunto pendente (`metadata.status === "pendente"`) não vira aba nem
 *   seção: entra na lista de omissões, declarado com o motivo;
 * - toda tabela carrega a sua procedência (fonte, pleito, ano) — a capa
 *   reúne todas para o número exportado continuar rastreável fora da tela.
 */

import type { AnalysisMetricDefinition } from "../types/analysis";

/* -------------------------------------------------------------------------
 * Tipos
 * ------------------------------------------------------------------------- */

/**
 * Formato da coluna: decide o formato numérico do Excel, o alinhamento e o
 * texto do PDF. "decimal" e "percentual" declaram as casas em `decimals`.
 */
export type ReportColumnFormat =
  | "texto"
  /** Contagem com separador de milhar: 1.234.567 */
  | "inteiro"
  /**
   * Número sem separador de milhar: ano (2024, jamais "2.024"), turno,
   * posição, código. Agrupar milhar num ano é o tipo de detalhe que faz uma
   * planilha parecer gerada às pressas.
   */
  | "numero"
  | "decimal"
  | "percentual";

export type ReportColumn = {
  header: string;
  format: ReportColumnFormat;
  /** Casas decimais de decimal/percentual (padrão 1). Sempre declarado. */
  decimals?: number;
  /**
   * true para colunas que só fazem sentido na planilha (códigos IBGE/TSE,
   * denominadores). O PDF é documento de leitura: 20 colunas numa página A4
   * viram uma tabela ilegível, então essas ficam fora dele — e não fora do
   * Excel, que é justamente o formato de quem vai cruzar com outra base.
   */
  pdfHidden?: boolean;
};

/** `null` = dado ausente. Jamais substituído por 0 em nenhuma saída. */
export type ReportCell = string | number | null;

/** Procedência de um conjunto — o que torna o número rastreável fora da tela. */
export type ReportSource = {
  /** "TSE · Resultados por município" */
  label: string;
  /** "Eleições 2022 · Deputada Federal · 1º turno" */
  detail?: string;
  url?: string;
};

export type ReportTable = {
  id: string;
  /** Vira o nome da aba (sanitizado) e o título da seção no PDF. */
  title: string;
  subtitle?: string;
  columns: ReportColumn[];
  rows: ReportCell[][];
  /** Regras de leitura, exclusões contadas, avisos. */
  notes?: string[];
  source: ReportSource;
};

/** Cartão de destaque — os mesmos números que a tela mostra, já formatados. */
export type ReportHighlight = {
  label: string;
  /** Já formatado; "—" quando o dado não existe. */
  value: string;
  note?: string;
};

/** Conjunto que NÃO entrou no arquivo, com o motivo. Nunca preenchido. */
export type ReportOmission = { title: string; reason: string };

/** Imagem rasterizada (PNG em data URL) para embutir no PDF. */
export type ReportImage = {
  title: string;
  dataUrl: string;
  /** Proporção largura/altura, para o PDF escalar sem deformar. */
  aspectRatio: number;
  caption?: string;
};

export type ReportDocument = {
  /** Nome do arquivo sem extensão e sem data (o sufixo é acrescentado). */
  filenameBase: string;
  title: string;
  subtitle: string;
  /** O recorte visível: "Deputada Federal 2022 · 1º turno", "Goiás"… */
  scope: string;
  candidatura: string;
  estado: string;
  generatedAt: Date;
  highlights: ReportHighlight[];
  tables: ReportTable[];
  omitted: ReportOmission[];
  images: ReportImage[];
  attribution: string;
};

/* -------------------------------------------------------------------------
 * Formatação pt-BR
 * ------------------------------------------------------------------------- */

export const REPORT_MISSING_TEXT = "—";

const integerPt = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

const decimalCache = new Map<number, Intl.NumberFormat>();

function decimalPt(decimals: number) {
  const cached = decimalCache.get(decimals);
  if (cached) return cached;
  const formatter = new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  decimalCache.set(decimals, formatter);
  return formatter;
}

export function getColumnDecimals(column: ReportColumn) {
  if (column.format === "decimal" || column.format === "percentual") {
    return column.decimals ?? 1;
  }
  return 0;
}

/**
 * Texto de uma célula para o PDF (e para o cálculo de largura das colunas).
 * Ausência vira travessão — nunca "0", nunca string vazia, que se confundiria
 * com um dado que existe e é vazio.
 */
export function formatReportCell(value: ReportCell, column: ReportColumn) {
  if (value === null || value === undefined) return REPORT_MISSING_TEXT;
  if (typeof value === "string") {
    return value.trim() === "" ? REPORT_MISSING_TEXT : value;
  }
  if (!Number.isFinite(value)) return REPORT_MISSING_TEXT;
  const decimals = getColumnDecimals(column);
  if (column.format === "numero") return String(value);
  if (column.format === "inteiro") return integerPt.format(value);
  if (column.format === "percentual") {
    return `${decimalPt(decimals).format(value)}%`;
  }
  if (column.format === "decimal") return decimalPt(decimals).format(value);
  return integerPt.format(value);
}

/**
 * Marcação de idioma do OOXML para o português do Brasil (LCID 0x416).
 *
 * O código de formato é sempre gravado no dialeto canônico — vírgula para
 * milhar, ponto para decimal — e cada aplicativo o RENDERIZA no idioma do
 * usuário. Sem o `[$-416]`, um coordenador com o Excel em inglês abriria a
 * planilha e leria "41,250 votos", que em pt-BR se lê como quarenta e um
 * inteiros. Com a marcação, o arquivo mostra 41.250 em qualquer máquina —
 * e é um arquivo que circula por e-mail e grupo de mensagem.
 */
const IDIOMA_PT_BR = "[$-416]";

/**
 * Código de formato numérico do Excel para a coluna.
 *
 * Percentual: o projeto guarda percentuais já em pontos (25,4 = 25,4%), então
 * o "%" entra como literal no formato, e não como o operador `%` do Excel,
 * que dividiria o valor por 100 na exibição.
 */
export function getExcelNumberFormat(column: ReportColumn): string | null {
  const decimals = getColumnDecimals(column);
  const casas = decimals > 0 ? `.${"0".repeat(decimals)}` : "";
  // Ano e código não levam separador nem marcação: "2024" é igual em todo
  // idioma, e o `[$-416]` só serviria para inchar o arquivo.
  if (column.format === "numero") return "0";
  if (column.format === "inteiro") return `${IDIOMA_PT_BR}#,##0`;
  if (column.format === "decimal") return `${IDIOMA_PT_BR}#,##0${casas}`;
  if (column.format === "percentual") {
    return `${IDIOMA_PT_BR}#,##0${casas}"%"`;
  }
  return null;
}

export function isNumericColumn(column: ReportColumn) {
  return column.format !== "texto";
}

/**
 * Traduz o formato de um indicador da aba Análise para o formato de coluna do
 * relatório — a mesma definição que decide como o número aparece na tela
 * decide como ele aparece na planilha, sem uma segunda tabela de regras.
 * Moeda vira decimal com 2 casas: R$ por extenso em cada célula atrapalharia
 * a leitura de uma coluna inteira, e o cabeçalho já diz a unidade.
 */
/**
 * Cabeçalho de coluna com a unidade — sem repeti-la quando o próprio rótulo do
 * indicador já a carrega. Sem isto sai "Alfabetização 15+ (%) (% da população
 * 15+)", que ocupa duas linhas para dizer a mesma coisa duas vezes.
 */
export function columnHeaderWithUnit(label: string, unit: string) {
  if (!unit.trim()) return label;
  if (label.includes("(")) return label;
  return `${label} (${unit})`;
}

export function columnFormatFromMetric(
  valueFormat: AnalysisMetricDefinition["valueFormat"],
): Pick<ReportColumn, "format" | "decimals"> {
  if (valueFormat === "integer") return { format: "inteiro" };
  if (valueFormat === "percent") return { format: "percentual", decimals: 1 };
  if (valueFormat === "currency") return { format: "decimal", decimals: 2 };
  return { format: "decimal", decimals: 1 };
}

/* -------------------------------------------------------------------------
 * Nomes de aba e de arquivo
 * ------------------------------------------------------------------------- */

/**
 * O Excel rejeita `: \ / ? * [ ]` no nome da aba e corta em 31 caracteres.
 * Sanitizamos preservando acentuação (o Excel aceita) — "Trajetória" continua
 * "Trajetória", não vira "Trajetoria".
 */
export function sanitizeSheetName(name: string) {
  const limpo = name
    .replace(/[:\\/?*[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const cortado = limpo.slice(0, 31).trim();
  return cortado || "Dados";
}

/**
 * Nomes de aba únicos: o Excel se recusa a abrir uma pasta com duas abas de
 * mesmo nome, e dois pleitos do mesmo cargo produzem títulos parecidos que o
 * corte em 31 caracteres pode igualar. O sufixo entra dentro do limite.
 */
export function resolveSheetNames(titles: string[]) {
  const usados = new Set<string>();
  return titles.map((title) => {
    const base = sanitizeSheetName(title);
    if (!usados.has(base.toLowerCase())) {
      usados.add(base.toLowerCase());
      return base;
    }
    for (let indice = 2; indice < 100; indice += 1) {
      const sufixo = ` (${indice})`;
      const candidato = `${base.slice(0, 31 - sufixo.length).trim()}${sufixo}`;
      if (!usados.has(candidato.toLowerCase())) {
        usados.add(candidato.toLowerCase());
        return candidato;
      }
    }
    return base;
  });
}

export function slugifyReport(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/** aaaa-mm-dd no fuso de Brasília — o arquivo é datado para a reunião. */
export function formatFileDate(date: Date) {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  return partes;
}

/**
 * Nome final do arquivo. A data entra no nome porque estes arquivos circulam
 * por e-mail e grupo de mensagem: dois envios do mesmo recorte em dias
 * diferentes não podem se confundir na pasta de quem recebe.
 */
export function buildReportFilename(
  doc: ReportDocument,
  extension: "xlsx" | "pdf",
) {
  const base = slugifyReport(doc.filenameBase) || "relatorio";
  return `${base}-${formatFileDate(doc.generatedAt)}.${extension}`;
}

/** "17/08/2026 às 14:32 (horário de Brasília)" */
export function formatGeneratedAt(date: Date) {
  const data = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
  const hora = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
  return `${data} às ${hora} (horário de Brasília)`;
}

/* -------------------------------------------------------------------------
 * Larguras de coluna
 * ------------------------------------------------------------------------- */

const LARGURA_MINIMA = 11;
const LARGURA_MAXIMA = 46;

/**
 * Largura em caracteres calculada pelo CONTEÚDO já formatado (é o que o leitor
 * vê: "1.234.567" ocupa 9, não 7). Cabeçalho conta com folga porque vai em
 * negrito, que é mais largo que o corpo na mesma fonte.
 */
export function computeColumnWidths(table: ReportTable) {
  return table.columns.map((column, indice) => {
    let maior = column.header.length + 3;
    for (const row of table.rows) {
      const texto = formatReportCell(row[indice] ?? null, column);
      if (texto.length > maior) maior = texto.length;
    }
    return Math.min(LARGURA_MAXIMA, Math.max(LARGURA_MINIMA, maior + 2));
  });
}

/* -------------------------------------------------------------------------
 * Capa / procedência
 * ------------------------------------------------------------------------- */

export type CoverBlock =
  | { kind: "titulo"; text: string }
  | { kind: "subtitulo"; text: string }
  | { kind: "campo"; label: string; value: string }
  | { kind: "secao"; text: string }
  | { kind: "tabela"; headers: string[]; rows: string[][] }
  | { kind: "nota"; text: string };

/**
 * A capa da pasta de trabalho. É a aba que responde "de onde veio este
 * número": título, candidatura, estado, data/hora da geração, a fonte de CADA
 * aba e — explicitamente — o que NÃO foi gerado.
 */
export function buildCoverBlocks(doc: ReportDocument): CoverBlock[] {
  const sheetNames = resolveSheetNames(doc.tables.map((table) => table.title));
  const blocks: CoverBlock[] = [
    { kind: "titulo", text: doc.title },
    { kind: "subtitulo", text: doc.subtitle },
    { kind: "campo", label: "Candidatura", value: doc.candidatura },
    { kind: "campo", label: "Estado", value: doc.estado },
    { kind: "campo", label: "Recorte", value: doc.scope },
    {
      kind: "campo",
      label: "Gerado em",
      value: formatGeneratedAt(doc.generatedAt),
    },
  ];

  if (doc.highlights.length > 0) {
    blocks.push({ kind: "secao", text: "Números do recorte" });
    blocks.push({
      kind: "tabela",
      headers: ["Indicador", "Valor", "Observação"],
      rows: doc.highlights.map((item) => [
        item.label,
        item.value,
        item.note ?? "",
      ]),
    });
  }

  blocks.push({ kind: "secao", text: "Procedência dos dados" });
  blocks.push({
    kind: "tabela",
    headers: ["Aba", "Conjunto", "Fonte", "Recorte da fonte", "Endereço"],
    rows: doc.tables.map((table, indice) => [
      sheetNames[indice],
      table.title,
      table.source.label,
      table.source.detail ?? "",
      table.source.url ?? "",
    ]),
  });

  // A ausência é declarada, nunca preenchida com exemplo: quem abrir a pasta
  // precisa saber que aquele conjunto não existe nesta instalação — e não
  // concluir que a candidata não teve voto ali.
  if (doc.omitted.length > 0) {
    blocks.push({ kind: "secao", text: "Conjuntos não gerados" });
    blocks.push({
      kind: "tabela",
      headers: ["Conjunto", "Por que não está neste arquivo"],
      rows: doc.omitted.map((item) => [item.title, item.reason]),
    });
  }

  blocks.push({ kind: "nota", text: doc.attribution });
  blocks.push({
    kind: "nota",
    text: "Célula vazia significa dado não apurado. Zero significa zero apurado — os dois nunca se confundem neste arquivo.",
  });
  return blocks;
}

/* -------------------------------------------------------------------------
 * Plano da pasta de trabalho
 * ------------------------------------------------------------------------- */

export type WorkbookSheetPlan =
  | { kind: "capa"; name: string; blocks: CoverBlock[] }
  | {
      kind: "dados";
      name: string;
      table: ReportTable;
      widths: number[];
      numberFormats: Array<string | null>;
    };

export type WorkbookPlan = {
  filename: string;
  title: string;
  creator: string;
  generatedAt: Date;
  sheets: WorkbookSheetPlan[];
};

export const COVER_SHEET_NAME = "Capa e fontes";

/**
 * Plano completo da pasta: é ESTE objeto que os testes verificam. O renderer
 * de exceljs só traduz o plano para chamadas da biblioteca, sem decidir nada.
 */
export function buildWorkbookPlan(doc: ReportDocument): WorkbookPlan {
  const nomes = resolveSheetNames(doc.tables.map((table) => table.title));
  return {
    filename: buildReportFilename(doc, "xlsx"),
    title: doc.title,
    creator: `${doc.candidatura} · ${doc.estado}`,
    generatedAt: doc.generatedAt,
    sheets: [
      { kind: "capa", name: COVER_SHEET_NAME, blocks: buildCoverBlocks(doc) },
      ...doc.tables.map((table, indice): WorkbookSheetPlan => ({
        kind: "dados",
        name: nomes[indice],
        table,
        widths: computeColumnWidths(table),
        numberFormats: table.columns.map((column) =>
          getExcelNumberFormat(column),
        ),
      })),
    ],
  };
}

/* -------------------------------------------------------------------------
 * Helpers de construção
 * ------------------------------------------------------------------------- */

export function createReportDocument(
  input: Omit<ReportDocument, "highlights" | "tables" | "omitted" | "images"> &
    Partial<Pick<ReportDocument, "highlights" | "tables" | "omitted" | "images">>,
): ReportDocument {
  return {
    highlights: [],
    tables: [],
    omitted: [],
    images: [],
    ...input,
  };
}

/** Valor de cartão já formatado; ausência vira travessão, jamais "0". */
export function highlightValue(
  value: number | null,
  format: (value: number) => string,
) {
  return value === null || !Number.isFinite(value)
    ? REPORT_MISSING_TEXT
    : format(value);
}

/**
 * Um documento sem nenhuma tabela não deve virar arquivo: um .xlsx só com capa
 * ou um PDF só com rosto passariam a impressão de que "os dados estão aí" para
 * quem abrir no celular e não rolar até o fim.
 */
export function hasExportableContent(doc: ReportDocument) {
  return doc.tables.some((table) => table.rows.length > 0);
}
