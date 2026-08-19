/**
 * MODELO DE RELATÓRIO: camada entre os motores de dados e as bibliotecas de
 * saída (exceljs e jsPDF). Descreve a ESTRUTURA do documento, sem DOM e sem
 * dependência externa.
 *
 * Regras:
 * - `null` é ausência: célula VAZIA no Excel e travessão no PDF, nunca 0;
 * - conjunto pendente (`metadata.status === "pendente"`) não vira aba nem
 *   seção: entra na lista de omissões, com o motivo;
 * - toda tabela carrega a procedência (fonte, pleito, ano); a capa reúne todas.
 */

import type { AnalysisMetricDefinition } from "../types/analysis";

/* -------------------------------------------------------------------------
 * Tipos
 * ------------------------------------------------------------------------- */

/**
 * Formato da coluna: decide formato numérico do Excel, alinhamento e texto do
 * PDF. "decimal" e "percentual" declaram as casas em `decimals`.
 */
export type ReportColumnFormat =
  | "texto"
  /** Contagem com separador de milhar: 1.234.567 */
  | "inteiro"
  /**
   * Sem separador de milhar: ano (2024, não "2.024"), turno, posição, código.
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
   * true para colunas só da planilha (códigos IBGE/TSE, denominadores). Ficam
   * fora do PDF, onde 20 colunas numa página A4 viram tabela ilegível.
   */
  pdfHidden?: boolean;
};

/** `null` = dado ausente. Jamais substituído por 0 em nenhuma saída. */
export type ReportCell = string | number | null;

/** Procedência de um conjunto: torna o número rastreável fora da tela. */
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

/** Cartão de destaque: os mesmos números da tela, já formatados. */
export type ReportHighlight = {
  label: string;
  /** Já formatado; vira REPORT_MISSING_TEXT quando o dado não existe. */
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

/* -------------------------------------------------------------------------
 * Documento analítico do PDF: seções, blocos e gráficos
 *
 * A pasta de trabalho é uma lista de TABELAS; o PDF consome a projeção
 * `sections`, declarativa e sem DOM (testável sem abrir um PDF). Os gráficos
 * são ESPECIFICAÇÕES desenhadas em vetor no jsPDF, e não imagens: o texto
 * segue pesquisável e a página não vira um PNG de 2 MB. Todo gráfico traz
 * `description`, porque o gráfico nunca é a única forma de ler o dado.
 * ------------------------------------------------------------------------- */

/** Um eixo declarado: rótulo, unidade, escala. Nada de eixo mudo. */
export type ReportAxisSpec = {
  /** "Mulheres no cadastro", "Votos apurados"… */
  label: string;
  /** Unidade por extenso: "% do eleitorado", "votos". Sempre declarada. */
  unit: string;
  /** log10 quando a distribuição é muito assimétrica; declarado no eixo. */
  scale?: "linear" | "log10";
  /** Casas decimais dos rótulos da escala. */
  decimals?: number;
  /** Domínio fixado (0–100 num percentual); calculado do dado quando ausente. */
  min?: number;
  max?: number;
  /** true quando o valor menor fica no alto (posição no município: 1º é o topo). */
  inverted?: boolean;
};

/** Um município no gráfico de dispersão. `weight` vira o raio do ponto. */
export type ReportScatterPoint = {
  label: string;
  x: number;
  y: number;
  /** Eleitorado do município; null quando não há snapshot (raio mínimo). */
  weight?: number | null;
  /** true nos poucos pontos que recebem rótulo direto (os extremos). */
  callout?: boolean;
};

/** Uma barra. `value` null = sem dado: a barra não é desenhada, é declarada. */
export type ReportBarItem = {
  label: string;
  value: number | null;
  note?: string;
  /** Passo da rampa de uma cor só (0 claro … 2 escuro). Grupos ordenados. */
  step?: number;
};

export type ReportBoxSeries = {
  label: string;
  values: number[];
  note?: string;
  step?: number;
};

/** Uma célula da matriz de quadrantes. O nome é o do corte, nunca um juízo. */
export type ReportQuadrantCell = {
  label: string;
  count: number;
  /** No máximo `limite` nomes; a lista é ilustrativa, não um ranking. */
  items: string[];
  limite: number;
  xAcima: boolean;
  yAcima: boolean;
};

export type ReportParetoPoint = {
  posicao: number;
  label: string;
  participacaoPct: number;
  acumuladoPct: number;
};

/** Um marco anotado na curva acumulada (top 5, top 10, metade dos votos…). */
export type ReportParetoMark = {
  posicao: number;
  acumuladoPct: number;
  label: string;
};

/** O conteúdo de um painel de pequenos múltiplos. */
export type ReportPanelSpec =
  | {
      kind: "tira";
      /** Um valor por município; a tira mostra a distribuição inteira. */
      values: number[];
      axis: ReportAxisSpec;
    }
  | {
      kind: "dispersaoMini";
      points: ReportScatterPoint[];
      x: ReportAxisSpec;
      y: ReportAxisSpec;
    };

export type ReportPanel = {
  title: string;
  subtitle?: string;
  /** Municípios sem dado neste painel: cinza no desenho e número declarado. */
  semDado?: number;
  /** Leitura textual do painel: o conteúdo existe também fora do desenho. */
  note?: string;
  spec: ReportPanelSpec;
};

export type ReportChartSpec =
  | {
      kind: "dispersao";
      points: ReportScatterPoint[];
      x: ReportAxisSpec;
      y: ReportAxisSpec;
      /** Reta de mínimos quadrados sobre os pontos desenhados. */
      tendencia?: boolean;
      /** O que o tamanho do ponto significa: "eleitorado do município". */
      pesoLabel?: string;
    }
  | { kind: "barras"; items: ReportBarItem[]; axis: ReportAxisSpec }
  | { kind: "boxplot"; series: ReportBoxSeries[]; axis: ReportAxisSpec }
  | {
      kind: "quadrantes";
      cells: ReportQuadrantCell[];
      x: ReportAxisSpec;
      y: ReportAxisSpec;
      medianaX: number;
      medianaY: number;
    }
  | {
      kind: "pareto";
      points: ReportParetoPoint[];
      marcos: ReportParetoMark[];
      axis: ReportAxisSpec;
    }
  | { kind: "multiplos"; panels: ReportPanel[]; colunas: number };

export type ReportChartLegendItem = {
  label: string;
  kind: "ponto" | "linha" | "caixa" | "caixaMediana" | "barra";
  /** Passo da rampa; ausente = cinza de apoio (sem dado, referência). */
  step?: number;
  cinza?: boolean;
};

export type ReportChart = {
  id: string;
  title: string;
  /** Escala, ano de referência, recorte: o que a leitura precisa saber. */
  subtitle?: string;
  legend: ReportChartLegendItem[];
  /**
   * A leitura do gráfico em palavras. OBRIGATÓRIA: impressão em preto e branco
   * e leitor de tela precisam do mesmo conteúdo.
   */
  description: string;
  /** Municípios sem dado: desenhados em cinza, contados e declarados. */
  semDado?: { count: number; label: string };
  source?: ReportSource;
  /** Altura do desenho em mm, sem título nem descrição. */
  plotHeight?: number;
  spec: ReportChartSpec;
};

/** Um par rótulo/valor da ficha de identificação. */
export type ReportField = { label: string; value: string };

export type ReportBlock =
  /** Divisão interna de uma seção: "Resumo da análise", "Convenções". */
  | { kind: "subtitulo"; text: string }
  | { kind: "paragrafo"; text: string; tone?: "normal" | "suave" }
  | { kind: "lista"; items: string[] }
  | { kind: "cartoes"; items: ReportHighlight[]; colunas?: 2 | 3 }
  | { kind: "campos"; items: ReportField[]; colunas?: 2 | 3 }
  | { kind: "grafico"; chart: ReportChart }
  /** Imagem rasterizada: só o mapa, que é captura de tela e não gráfico. */
  | { kind: "imagem"; image: ReportImage }
  | { kind: "tabela"; table: ReportTable; maxRows?: number }
  /** Aviso emoldurado: compatibilidade temporal, limitação metodológica. */
  | { kind: "aviso"; title?: string; text: string }
  | { kind: "fonte"; source: ReportSource; note?: string }
  | { kind: "links"; items: Array<{ label: string; url: string }> };

export type ReportSection = {
  id: string;
  title: string;
  subtitle?: string;
  /** Marcador no topo da página ("Anexo municipal"). */
  marker?: string;
  /** true quando a seção precisa começar em página nova. */
  startsNewPage?: boolean;
  blocks: ReportBlock[];
};

/** Opções de renderização do PDF. O anexo municipal sai DESLIGADO por padrão. */
export type ReportPdfOptions = {
  /**
   * Anexa a tabela municipal completa depois do relatório analítico.
   * Desligada por padrão: a base completa é do Excel/CSV.
   */
  incluirAnexoMunicipal?: boolean;
};

/**
 * As duas versões do relatório em PDF. "completo": um capítulo por indicador
 * com dado, os quatro recortes do território, os três rankings e a metodologia.
 * "resumido": as leituras principais, capítulos escolhidos por régua declarada
 * e a tabela com TODOS os indicadores.
 *
 * A variante muda só o QUE ENTRA no papel. As duas saem da mesma
 * `ReportAnalysis` e nenhum número muda entre elas.
 */
export type ReportVariant = "completo" | "resumido";

export type ReportDocument = {
  /** Nome do arquivo sem extensão e sem data (o sufixo é acrescentado). */
  filenameBase: string;
  title: string;
  subtitle: string;
  /**
   * Qual versão este documento imprime. Ausente nos relatórios sem variante
   * (trajetória, crescimento).
   */
  variant?: ReportVariant;
  /**
   * Marca da versão impressa na CAPA, à direita do nome da candidatura, para
   * que a resumida nunca passe por completa.
   */
  versionBadge?: string;
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
  /**
   * O relatório analítico do PDF. Vazio nos documentos só de tabelas: o
   * renderizador monta seções padrão a partir de cartões, fontes e tabelas.
   */
  sections?: ReportSection[];
  /**
   * A tabela municipal do anexo OPCIONAL do PDF. Também está em `tables` (é de
   * lá que o Excel lê); aqui só é apontada para o anexo saber qual imprimir.
   */
  annexTable?: ReportTable;
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
 * Ausência vira travessão: nunca "0", nunca string vazia.
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
 * Marcação de idioma do OOXML para pt-BR (LCID 0x416). O código de formato é
 * gravado no dialeto canônico (vírgula de milhar, ponto decimal) e cada
 * aplicativo o RENDERIZA no idioma do usuário. Sem o `[$-416]`, um Excel em
 * inglês exibiria "41,250 votos" onde o arquivo quer dizer 41.250.
 */
const IDIOMA_PT_BR = "[$-416]";

/**
 * Código de formato numérico do Excel para a coluna. Percentual: o projeto
 * guarda percentuais já em pontos (25,4 = 25,4%), então o "%" entra como
 * literal, e não como o operador `%` do Excel, que dividiria o valor por 100.
 */
export function getExcelNumberFormat(column: ReportColumn): string | null {
  const decimals = getColumnDecimals(column);
  const casas = decimals > 0 ? `.${"0".repeat(decimals)}` : "";
  // Ano e código não levam separador nem marcação de idioma: "2024" é igual
  // em qualquer Excel.
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
 * Cabeçalho de coluna com a unidade, sem repeti-la quando o rótulo do indicador
 * já a carrega (evita "Alfabetização 15+ (%) (% da população 15+)").
 */
export function columnHeaderWithUnit(label: string, unit: string) {
  if (!unit.trim()) return label;
  if (label.includes("(")) return label;
  return `${label} (${unit})`;
}

/**
 * Traduz o formato do indicador da aba Análise para o formato de coluna do
 * relatório: a mesma definição vale para a tela e para a planilha. Moeda vira
 * decimal de 2 casas, com a unidade declarada no cabeçalho.
 */
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
 * Sanitiza preservando acentuação, que o Excel aceita.
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
 * Nomes de aba únicos: o Excel não abre pasta com duas abas de mesmo nome, e o
 * corte em 31 caracteres pode igualar títulos parecidos. O sufixo entra dentro
 * do limite.
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

/** aaaa-mm-dd no fuso de Brasília. */
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
 * Nome final do arquivo. A data entra no nome para que dois envios do mesmo
 * recorte em dias diferentes não se confundam na pasta de quem recebe.
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
 * Largura em caracteres calculada pelo CONTEÚDO já formatado ("1.234.567" ocupa
 * 9, não 7). O cabeçalho conta com folga porque vai em negrito.
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
 * A capa da pasta de trabalho: título, candidatura, estado, data/hora da
 * geração, a fonte de CADA aba e, explicitamente, o que NÃO foi gerado.
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

  // A ausência é declarada, nunca preenchida com exemplo: quem abrir precisa
  // saber que o conjunto não existe nesta instalação, e não concluir que a
  // candidata não teve voto ali.
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
 * Plano completo da pasta: é ESTE objeto que os testes verificam. O renderer de
 * exceljs só o traduz para chamadas da biblioteca, sem decidir nada.
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
 * Documento sem nenhuma tabela não vira arquivo: um .xlsx só com capa passaria
 * a impressão de que "os dados estão aí".
 */
export function hasExportableContent(doc: ReportDocument) {
  return doc.tables.some((table) => table.rows.length > 0);
}
