import type { jsPDF } from "jspdf";
import { MISSING_DATA_COLOR } from "./electorate.ts";
import type {
  ReportAxisSpec,
  ReportBarItem,
  ReportBoxSeries,
  ReportChart,
  ReportChartLegendItem,
  ReportPanel,
  ReportParetoPoint,
  ReportQuadrantCell,
  ReportScatterPoint,
} from "./reportModel.ts";

/**
 * PRIMITIVAS DE DESENHO DO PDF — tipografia, tema visual e gráficos em VETOR.
 *
 * Todo gráfico deste relatório é desenhado com linhas, retângulos e texto do
 * próprio jsPDF. Nenhuma página vira imagem: o texto continua pesquisável e
 * selecionável, o arquivo fica em dezenas de kB em vez de megabytes, e a
 * ampliação não pixeliza um nome de município. É por isso que este módulo
 * existe em vez de um `svgToPng` — que era o caminho antigo e transformava
 * gráfico em bitmap opaco.
 *
 * DISCIPLINAS DE DESENHO, todas verificáveis olhando uma página:
 *
 * 1. AUSÊNCIA NÃO É ZERO. Município sem valor não recebe ponto, não recebe
 *    barra e não encosta no eixo: ele é contado e declarado em cinza
 *    (`MISSING_DATA_COLOR`, o mesmo cinza do mapa) ao lado do gráfico;
 * 2. COR SÓ ONDE SIGNIFICA. Uma única matiz — a cor principal configurável —
 *    em três passos de luminosidade. Grupos ordenados (abaixo/acima da
 *    mediana) usam passos diferentes da MESMA rampa, o que sobrevive à
 *    impressão em preto e branco; nada aqui depende de distinguir vermelho de
 *    azul. Os quatro quadrantes têm todos a mesma superfície: o dado ali é a
 *    contagem, e pintar cada célula de uma cor inventaria uma escala;
 * 3. NENHUM EIXO MUDO. Rótulo, unidade e escala saem escritos; escala log é
 *    declarada no eixo, não deduzida;
 * 4. RÓTULO NÃO SE CORTA. Toda etiqueta é MEDIDA (`getTextWidth`) antes de ser
 *    escrita; a que não cabe fora da barra não é escrita por cima dela — o
 *    número segue legível na tabela e na descrição textual;
 * 5. TODO GRÁFICO TEM DESCRIÇÃO. `chart.description` é obrigatório no tipo e
 *    sai impresso abaixo do desenho: o gráfico nunca é a única forma de ler.
 */

/* -------------------------------------------------------------------------
 * Cor
 * ------------------------------------------------------------------------- */

export type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  const limpo = hex.replace("#", "").trim();
  const cheio =
    limpo.length === 3
      ? limpo
          .split("")
          .map((canal) => canal + canal)
          .join("")
      : limpo;
  return [
    Number.parseInt(cheio.slice(0, 2), 16),
    Number.parseInt(cheio.slice(2, 4), 16),
    Number.parseInt(cheio.slice(4, 6), 16),
  ];
}

/** Mistura linear entre duas cores; `peso` 0 devolve `a`, 1 devolve `b`. */
export function misturar(a: RGB, b: RGB, peso: number): RGB {
  return [
    Math.round(a[0] + (b[0] - a[0]) * peso),
    Math.round(a[1] + (b[1] - a[1]) * peso),
    Math.round(a[2] + (b[2] - a[2]) * peso),
  ];
}

const BRANCO: RGB = [255, 255, 255];
const PRETO: RGB = [0, 0, 0];

/**
 * A cor principal do relatório. Configurável: é o único ponto onde a identidade
 * visual entra, e a rampa dos gráficos é DERIVADA dela, não uma segunda lista
 * de hexadecimais que alguém teria de manter em sincronia.
 */
export const COR_PRINCIPAL_PADRAO = "#c1121f";

/**
 * Rampa de uma matiz só, em três passos.
 *
 * Os pesos (45% de branco, a própria cor, 35% de preto) foram escolhidos para
 * a rampa passar nos testes de rampa ordinal do validador de paleta com a cor
 * padrão #c1121f: `#dd7d84 → #c1121f → #7d0c14`, luminosidade monótona, ΔL
 * adjacente acima de 0,06 e a ponta clara em 2,86:1 contra o papel branco.
 * Em escala de cinza os três passos ficam em 0,32 / 0,12 / 0,05 de
 * luminância relativa — é o que faz o gráfico sobreviver a uma impressora
 * preto e branco.
 */
const PESO_CLARO = 0.45;
const PESO_ESCURO = 0.35;

export type PdfTheme = {
  /** A cor principal, como veio da configuração. */
  marca: RGB;
  /** Rampa de uma matiz: [claro, principal, escuro]. */
  rampa: [RGB, RGB, RGB];
  superficie: RGB;
  superficieForte: RGB;
  branco: RGB;
  tinta: RGB;
  tintaSuave: RGB;
  tintaFraca: RGB;
  linha: RGB;
  /** O cinza de "sem dado" — o mesmo do mapa e das legendas da tela. */
  semDado: RGB;
};

export function criarTemaPdf(corPrincipal = COR_PRINCIPAL_PADRAO): PdfTheme {
  const marca = hexToRgb(corPrincipal);
  return {
    marca,
    rampa: [
      misturar(marca, BRANCO, PESO_CLARO),
      marca,
      misturar(marca, PRETO, PESO_ESCURO),
    ],
    superficie: hexToRgb("#f6f3f2"),
    superficieForte: hexToRgb("#ebe5e3"),
    branco: BRANCO,
    tinta: hexToRgb("#201b1a"),
    tintaSuave: hexToRgb("#554e4c"),
    tintaFraca: hexToRgb("#6e6560"),
    linha: hexToRgb("#e1dad8"),
    semDado: hexToRgb(MISSING_DATA_COLOR),
  };
}

export const TEMA_PADRAO = criarTemaPdf();

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
  "ρ": "rho",
  "−": "-",
  "√": "raiz de ",
  "×": "x",
};

/** Faixa extra do cp1252 (0x80–0x9F): aspas curvas, travessões, bullet… */
const CP1252_EXTRA = new Set([
  "€", "‚", "ƒ", "„", "…", "†", "‡",
  "ˆ", "‰", "Š", "‹", "Œ", "Ž", "‘",
  "’", "“", "”", "•", "–", "—", "˜",
  "™", "š", "›", "œ", "ž", "Ÿ",
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
    const semAcento = char.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    saida += [...semAcento].every((item) => (item.codePointAt(0) ?? 0) <= 0xff)
      ? semAcento
      : "";
  }
  return saida;
}

/* -------------------------------------------------------------------------
 * Tipografia
 * ------------------------------------------------------------------------- */

export function definirTexto(
  doc: jsPDF,
  size: number,
  color: RGB,
  style: "normal" | "bold" | "italic" = "normal",
) {
  doc.setFont("helvetica", style);
  doc.setFontSize(size);
  doc.setTextColor(color[0], color[1], color[2]);
}

export function quebrar(doc: jsPDF, texto: string, largura: number): string[] {
  return doc.splitTextToSize(toPdfText(texto), largura) as string[];
}

/**
 * Texto girado 90°, centrado no eixo vertical — o título do eixo y.
 *
 * Não usa `align: "center"` de propósito: com `angle`, o jsPDF aplica o
 * alinhamento ANTES de girar, deslocando o texto meia largura para a
 * esquerda. Num eixo, isso jogava o rótulo para fora da margem da página (e o
 * deslocamento variava com o tamanho do texto, o que fazia o defeito parecer
 * aleatório). Aqui o começo do texto é calculado à mão: ele sobe a partir de
 * `centro + largura/2`, o que o deixa centrado de fato.
 */
export function escreverVertical(
  doc: jsPDF,
  texto: string,
  x: number,
  centroY: number,
) {
  const pronto = toPdfText(texto);
  doc.text(pronto, x, centroY + doc.getTextWidth(pronto) / 2, { angle: 90 });
}

/** Escreve um parágrafo com quebra automática e devolve a altura ocupada. */
export function paragrafo(
  doc: jsPDF,
  texto: string,
  x: number,
  y: number,
  largura: number,
  alturaLinha: number,
) {
  const linhas = quebrar(doc, texto, largura);
  linhas.forEach((linha, indice) => {
    doc.text(linha, x, y + indice * alturaLinha);
  });
  return linhas.length * alturaLinha;
}

/** Encurta um texto até caber em `largura`, com reticências. Nunca corta seco. */
export function encurtar(doc: jsPDF, texto: string, largura: number): string {
  const pronto = toPdfText(texto);
  if (doc.getTextWidth(pronto) <= largura) return pronto;
  let corte = pronto;
  while (corte.length > 1 && doc.getTextWidth(`${corte}…`) > largura) {
    corte = corte.slice(0, -1);
  }
  return `${corte.trimEnd()}…`;
}

function preencher(doc: jsPDF, cor: RGB) {
  doc.setFillColor(cor[0], cor[1], cor[2]);
}

function tracar(doc: jsPDF, cor: RGB, espessura: number) {
  doc.setDrawColor(cor[0], cor[1], cor[2]);
  doc.setLineWidth(espessura);
}

/* -------------------------------------------------------------------------
 * Escalas
 * ------------------------------------------------------------------------- */

const inteiroPt = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

function formatarTick(valor: number, decimais: number) {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: decimais,
    maximumFractionDigits: decimais,
  }).format(valor);
}

type Tick = { valor: number; texto: string };

type Escala = {
  min: number;
  max: number;
  log: boolean;
  /** Coordenada em mm de um valor BRUTO do dado. */
  para: (valor: number) => number;
  ticks: Tick[];
};

function passoAgradavel(bruto: number) {
  if (!Number.isFinite(bruto) || bruto <= 0) return 1;
  const expoente = Math.floor(Math.log10(bruto));
  const base = bruto / 10 ** expoente;
  const passo = base <= 1 ? 1 : base <= 2 ? 2 : base <= 5 ? 5 : 10;
  return passo * 10 ** expoente;
}

function decimaisDoPasso(passo: number, declarado?: number) {
  if (declarado !== undefined) return declarado;
  if (passo >= 10) return 0;
  if (passo >= 1) return 0;
  if (passo >= 0.1) return 1;
  return 2;
}

/**
 * Escala de um eixo. `inicio` é a coordenada do MENOR valor e `fim` a do maior
 * — quem chama passa (base, topo) num eixo vertical e (esquerda, direita) num
 * horizontal. `inverted` troca os dois: é o que põe a 1ª colocação no alto.
 */
function criarEscala(
  valores: readonly number[],
  axis: ReportAxisSpec,
  inicio: number,
  fim: number,
  alvoTicks = 4,
): Escala {
  const log = axis.scale === "log10";
  const uteis = valores.filter(
    (valor) => Number.isFinite(valor) && (!log || valor > 0),
  );
  const de = inicio;
  const ate = fim;
  const mapear = (bruto: number, min: number, max: number) => {
    const span = max - min || 1;
    const t = (bruto - min) / span;
    return axis.inverted ? ate - t * (ate - de) : de + t * (ate - de);
  };

  if (log) {
    const logs = uteis.map((valor) => Math.log10(valor));
    const minLog = Math.floor(Math.min(...(logs.length ? logs : [0])));
    const maxLog = Math.ceil(Math.max(...(logs.length ? logs : [1])));
    const baixo = minLog;
    const alto = maxLog === minLog ? minLog + 1 : maxLog;
    // Uma potência de dez abaixo de 1 precisa das casas decimais que ela tem:
    // 10^-2 formatado como inteiro vira "0", e um eixo que começa em "0" numa
    // escala logarítmica é uma escala mentindo sobre si mesma.
    const textoLog = (valor: number, expoente: number) =>
      formatarTick(valor, Math.max(0, -expoente));
    const ticks: Tick[] = [];
    for (let expoente = baixo; expoente <= alto; expoente += 1) {
      ticks.push({
        valor: 10 ** expoente,
        texto: textoLog(10 ** expoente, expoente),
      });
    }
    // Com uma década só, as potências de dez dariam dois traços no eixo
    // inteiro: acrescenta 2× e 5× para a escala ficar legível.
    if (ticks.length <= 2) {
      const extras: Tick[] = [];
      for (let expoente = baixo; expoente < alto; expoente += 1) {
        for (const fator of [2, 5]) {
          const valor = fator * 10 ** expoente;
          extras.push({ valor, texto: textoLog(valor, expoente) });
        }
      }
      ticks.push(...extras);
      ticks.sort((a, b) => a.valor - b.valor);
    }
    return {
      min: 10 ** baixo,
      max: 10 ** alto,
      log: true,
      para: (valor) =>
        mapear(
          Math.log10(Math.max(valor, 10 ** baixo)),
          baixo,
          alto,
        ),
      ticks,
    };
  }

  const bruttoMin = uteis.length ? Math.min(...uteis) : 0;
  const bruttoMax = uteis.length ? Math.max(...uteis) : 1;
  const passo = passoAgradavel(
    Math.abs((bruttoMax - bruttoMin) / Math.max(1, alvoTicks)) || 1,
  );
  let min = axis.min ?? Math.floor(bruttoMin / passo) * passo;
  let max = axis.max ?? Math.ceil(bruttoMax / passo) * passo;
  if (max === min) max = min + passo;
  // Percentual nunca é desenhado numa janela estreita que exagere a diferença:
  // escala enganosa é o defeito mais fácil de cometer aqui.
  if (axis.min !== undefined) min = axis.min;
  if (axis.max !== undefined) max = axis.max;
  const decimais = decimaisDoPasso(passo, axis.decimals);
  const ticks: Tick[] = [];
  for (let valor = min; valor <= max + passo / 2; valor += passo) {
    const arredondado = Math.round(valor / passo) * passo;
    ticks.push({
      valor: arredondado,
      texto: formatarTick(arredondado, decimais),
    });
  }
  return {
    min,
    max,
    log: false,
    para: (valor) => mapear(Math.min(Math.max(valor, min), max), min, max),
    ticks,
  };
}

/** Valor no espaço do eixo (log10 quando a escala é logarítmica). */
function noEixo(valor: number, escala: Escala) {
  return escala.log ? Math.log10(Math.max(valor, Number.MIN_VALUE)) : valor;
}

/* -------------------------------------------------------------------------
 * Aritmética de apoio ao desenho
 * ------------------------------------------------------------------------- */

function quantil(ordenado: readonly number[], p: number): number {
  if (ordenado.length === 0) return 0;
  if (ordenado.length === 1) return ordenado[0];
  const posicao = (ordenado.length - 1) * p;
  const base = Math.floor(posicao);
  const resto = posicao - base;
  const proximo = ordenado[Math.min(base + 1, ordenado.length - 1)];
  return ordenado[base] + resto * (proximo - ordenado[base]);
}

/** Resumo de cinco números de uma distribuição, para o boxplot. */
export type ResumoCaixa = {
  minimo: number;
  q1: number;
  mediana: number;
  q3: number;
  maximo: number;
  /** Pontos além de 1,5 amplitudes interquartis — desenhados um a um. */
  extremos: number[];
};

export function resumirCaixa(values: readonly number[]): ResumoCaixa | null {
  const ordenado = [...values].filter(Number.isFinite).sort((a, b) => a - b);
  if (ordenado.length === 0) return null;
  const q1 = quantil(ordenado, 0.25);
  const mediana = quantil(ordenado, 0.5);
  const q3 = quantil(ordenado, 0.75);
  const amplitude = q3 - q1;
  const limiteBaixo = q1 - 1.5 * amplitude;
  const limiteAlto = q3 + 1.5 * amplitude;
  const dentro = ordenado.filter(
    (valor) => valor >= limiteBaixo && valor <= limiteAlto,
  );
  return {
    minimo: dentro.length ? dentro[0] : ordenado[0],
    q1,
    mediana,
    q3,
    maximo: dentro.length ? dentro[dentro.length - 1] : ordenado[ordenado.length - 1],
    extremos: ordenado.filter(
      (valor) => valor < limiteBaixo || valor > limiteAlto,
    ),
  };
}

/** Reta de mínimos quadrados; null sem variação no eixo x. */
function reta(pontos: ReadonlyArray<{ x: number; y: number }>) {
  if (pontos.length < 2) return null;
  const n = pontos.length;
  const mediaX = pontos.reduce((soma, p) => soma + p.x, 0) / n;
  const mediaY = pontos.reduce((soma, p) => soma + p.y, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (const ponto of pontos) {
    sxy += (ponto.x - mediaX) * (ponto.y - mediaY);
    sxx += (ponto.x - mediaX) ** 2;
  }
  if (sxx === 0) return null;
  const inclinacao = sxy / sxx;
  return { inclinacao, intercepto: mediaY - inclinacao * mediaX };
}

/* -------------------------------------------------------------------------
 * Anatomia comum dos gráficos
 * ------------------------------------------------------------------------- */

/** Corpos de texto do gráfico, em pontos. Nada abaixo de 6,4 pt. */
const T_TITULO = 9.5;
const T_SUB = 7.4;
const T_LEGENDA = 6.8;
const T_DESCRICAO = 7.6;
const T_FONTE = 6.8;
const T_TICK = 6.4;
const T_EIXO = 7;
const T_MARCA = 6.6;

const L_SUB = 3.4;
const L_DESCRICAO = 3.6;

/** Margens internas da área de desenho (mm). */
const EIXO_ESQUERDA = 17;
const EIXO_BASE = 11;
const EIXO_TOPO = 4;
const EIXO_DIREITA = 5;

/** Espessura de traço: um "hairline" de 1 px a 96 dpi ~ 0,26 mm. */
const FIO = 0.2;
const TRACO_DADO = 0.5;

/** Altura de desenho padrão por tipo de gráfico, quando não vem declarada. */
function alturaDesenho(chart: ReportChart): number {
  if (chart.plotHeight) return chart.plotHeight;
  const spec = chart.spec;
  switch (spec.kind) {
    case "barras":
      return EIXO_BASE + EIXO_TOPO + Math.max(1, spec.items.length) * 10;
    case "boxplot":
      return EIXO_BASE + EIXO_TOPO + Math.max(1, spec.series.length) * 13;
    case "quadrantes":
      return 96;
    case "multiplos": {
      const linhas = Math.ceil(spec.panels.length / Math.max(1, spec.colunas));
      return linhas * 44 + 2;
    }
    default:
      return 62;
  }
}

function alturaLegenda(chart: ReportChart) {
  return chart.legend.length > 0 ? 4.6 : 0;
}

/**
 * Altura total do bloco do gráfico: título, subtítulo, legenda, desenho,
 * descrição textual e fonte. Medida ANTES de desenhar para o renderizador
 * decidir se a página aguenta o bloco inteiro — gráfico partido no meio ou
 * descrição órfã numa página nova são os dois defeitos que isto evita.
 */
export function medirGrafico(
  doc: jsPDF,
  chart: ReportChart,
  largura: number,
): number {
  let altura = 5.4;
  if (chart.subtitle) {
    definirTexto(doc, T_SUB, TEMA_PADRAO.tintaSuave);
    altura += quebrar(doc, chart.subtitle, largura).length * L_SUB + 1;
  }
  altura += alturaLegenda(chart);
  altura += alturaDesenho(chart);
  definirTexto(doc, T_DESCRICAO, TEMA_PADRAO.tintaSuave);
  altura += quebrar(doc, chart.description, largura).length * L_DESCRICAO + 1.5;
  if (chart.semDado && chart.semDado.count > 0) {
    definirTexto(doc, T_FONTE, TEMA_PADRAO.tintaFraca);
    altura += quebrar(doc, textoSemDado(chart), largura).length * 3.2;
  }
  if (chart.source) {
    definirTexto(doc, T_FONTE, TEMA_PADRAO.tintaFraca);
    altura += quebrar(doc, textoFonte(chart.source), largura).length * 3.2;
  }
  return altura + 4;
}

function textoSemDado(chart: ReportChart) {
  const semDado = chart.semDado;
  if (!semDado) return "";
  return `Sem dado (cinza): ${semDado.count} ${semDado.label}. Municípios sem valor não entram no gráfico e não valem zero.`;
}

function textoFonte(source: { label: string; detail?: string; url?: string }) {
  return [source.label, source.detail, source.url].filter(Boolean).join(" · ");
}

type Caixa = { x: number; y: number; largura: number; altura: number };

/** Desenha a legenda e devolve a altura ocupada. */
function desenharLegenda(
  doc: jsPDF,
  tema: PdfTheme,
  itens: readonly ReportChartLegendItem[],
  x: number,
  y: number,
  largura: number,
) {
  if (itens.length === 0) return 0;
  definirTexto(doc, T_LEGENDA, tema.tintaSuave);
  let cursorX = x;
  const linhaY = y + 2;
  for (const item of itens) {
    const texto = toPdfText(item.label);
    const larguraTexto = doc.getTextWidth(texto);
    const bloco = larguraTexto + 8;
    if (cursorX + bloco > x + largura && cursorX > x) break;
    const cor = item.cinza ? tema.semDado : tema.rampa[item.step ?? 1];
    preencher(doc, cor);
    if (item.kind === "ponto") {
      doc.circle(cursorX + 1.4, linhaY - 0.8, 1.2, "F");
    } else if (item.kind === "linha") {
      tracar(doc, cor, TRACO_DADO);
      doc.line(cursorX, linhaY - 0.8, cursorX + 4.4, linhaY - 0.8);
    } else if (item.kind === "caixaMediana") {
      // A marca da legenda é a MARCA do gráfico: caixa com o traço claro da
      // mediana dentro. Uma linha vermelha na legenda para uma mediana branca
      // no desenho seria uma legenda que não corresponde ao que se vê.
      doc.rect(cursorX, linhaY - 2.2, 4.4, 2.6, "F");
      tracar(doc, tema.branco, 0.5);
      doc.line(cursorX + 2.2, linhaY - 2.2, cursorX + 2.2, linhaY + 0.4);
    } else {
      doc.rect(cursorX, linhaY - 2.2, 4.4, 2.6, "F");
    }
    definirTexto(doc, T_LEGENDA, tema.tintaSuave);
    doc.text(texto, cursorX + 5.6, linhaY);
    cursorX += bloco;
  }
  return 4.6;
}

/**
 * Moldura do gráfico: grade horizontal, eixos e rótulos de escala.
 *
 * A grade é fio sólido, um passo acima da superfície — nunca tracejada, que
 * lê como "projeção", e nunca escura, que compete com o dado.
 */
function desenharMoldura(
  doc: jsPDF,
  tema: PdfTheme,
  plot: Caixa,
  input: {
    x?: { escala: Escala; axis: ReportAxisSpec };
    y?: { escala: Escala; axis: ReportAxisSpec };
    grade?: "horizontal" | "vertical" | "nenhuma";
  },
) {
  const base = plot.y + plot.altura;
  const direita = plot.x + plot.largura;
  const grade = input.grade ?? "horizontal";

  if (input.y && grade === "horizontal") {
    tracar(doc, tema.linha, FIO);
    for (const tick of input.y.escala.ticks) {
      const y = input.y.escala.para(tick.valor);
      doc.line(plot.x, y, direita, y);
    }
  }
  if (input.x && grade === "vertical") {
    tracar(doc, tema.linha, FIO);
    for (const tick of input.x.escala.ticks) {
      const x = input.x.escala.para(tick.valor);
      doc.line(x, plot.y, x, base);
    }
  }

  tracar(doc, tema.linha, FIO);
  doc.line(plot.x, base, direita, base);
  doc.line(plot.x, plot.y, plot.x, base);

  if (input.y) {
    definirTexto(doc, T_TICK, tema.tintaFraca);
    for (const tick of input.y.escala.ticks) {
      const y = input.y.escala.para(tick.valor);
      doc.text(tick.texto, plot.x - 1.6, y + 0.9, { align: "right" });
    }
    definirTexto(doc, T_EIXO, tema.tintaSuave);
    const titulo = encurtar(
      doc,
      `${input.y.axis.label} (${input.y.axis.unit})`,
      plot.altura,
    );
    escreverVertical(doc, titulo, plot.x - 13.4, plot.y + plot.altura / 2);
  }

  if (input.x) {
    definirTexto(doc, T_TICK, tema.tintaFraca);
    let ultimoFim = -Infinity;
    for (const tick of input.x.escala.ticks) {
      const x = input.x.escala.para(tick.valor);
      const meia = doc.getTextWidth(tick.texto) / 2;
      // Rótulo de escala não se sobrepõe: o que não cabe some, e a grade
      // continua contando a história.
      if (x - meia < ultimoFim + 1.2) continue;
      if (x + meia > direita + 2) continue;
      doc.text(tick.texto, x, base + 3.4, { align: "center" });
      ultimoFim = x + meia;
    }
    definirTexto(doc, T_EIXO, tema.tintaSuave);
    const escalaTexto =
      input.x.axis.scale === "log10" ? " · escala logarítmica" : "";
    doc.text(
      encurtar(
        doc,
        `${input.x.axis.label} (${input.x.axis.unit})${escalaTexto}`,
        plot.largura,
      ),
      plot.x + plot.largura / 2,
      base + 7.6,
      { align: "center" },
    );
  }
}

/* -------------------------------------------------------------------------
 * Dispersão com linha de tendência
 * ------------------------------------------------------------------------- */

function desenharDispersao(
  doc: jsPDF,
  tema: PdfTheme,
  plot: Caixa,
  spec: {
    points: readonly ReportScatterPoint[];
    x: ReportAxisSpec;
    y: ReportAxisSpec;
    tendencia?: boolean;
  },
  mini = false,
) {
  const escalaX = criarEscala(
    spec.points.map((ponto) => ponto.x),
    spec.x,
    plot.x,
    plot.x + plot.largura,
    mini ? 2 : 4,
  );
  const escalaY = criarEscala(
    spec.points.map((ponto) => ponto.y),
    spec.y,
    plot.y + plot.altura,
    plot.y,
    mini ? 2 : 4,
  );
  desenharMoldura(doc, tema, plot, {
    x: mini ? undefined : { escala: escalaX, axis: spec.x },
    y: mini ? undefined : { escala: escalaY, axis: spec.y },
  });
  if (mini) {
    tracar(doc, tema.linha, FIO);
    doc.line(plot.x, plot.y + plot.altura, plot.x + plot.largura, plot.y + plot.altura);
    doc.line(plot.x, plot.y, plot.x, plot.y + plot.altura);
  }

  const pesos = spec.points
    .map((ponto) => ponto.weight ?? 0)
    .filter((peso) => peso > 0);
  const pesoMaximo = pesos.length ? Math.max(...pesos) : 0;
  const raioMin = mini ? 0.45 : 0.8;
  const raioMax = mini ? 1.1 : 2.4;
  const raio = (peso: number | null | undefined) => {
    if (!peso || pesoMaximo <= 0) return raioMin;
    // Raio pela RAIZ do peso: é a área que o olho compara, não o raio.
    return raioMin + (raioMax - raioMin) * Math.sqrt(peso / pesoMaximo);
  };

  // A tendência vai por baixo dos pontos: a reta é contexto, o município é o dado.
  if (spec.tendencia !== false) {
    const ajuste = reta(
      spec.points.map((ponto) => ({
        x: noEixo(ponto.x, escalaX),
        y: ponto.y,
      })),
    );
    if (ajuste) {
      const de = noEixo(escalaX.min, escalaX);
      const ate = noEixo(escalaX.max, escalaX);
      const yDe = ajuste.intercepto + ajuste.inclinacao * de;
      const yAte = ajuste.intercepto + ajuste.inclinacao * ate;
      const dentro = (valor: number) =>
        Math.min(Math.max(valor, escalaY.min), escalaY.max);
      tracar(doc, tema.rampa[2], mini ? 0.35 : TRACO_DADO);
      doc.line(
        escalaX.para(escalaX.min),
        escalaY.para(dentro(yDe)),
        escalaX.para(escalaX.max),
        escalaY.para(dentro(yAte)),
      );
    }
  }

  for (const ponto of spec.points) {
    if (!Number.isFinite(ponto.x) || !Number.isFinite(ponto.y)) continue;
    if (escalaX.log && ponto.x <= 0) continue;
    const cx = escalaX.para(ponto.x);
    const cy = escalaY.para(ponto.y);
    preencher(doc, tema.rampa[0]);
    // Anel na cor da superfície: é o que mantém dois municípios vizinhos
    // legíveis onde os pontos se tocam, sem desenhar borda de dado.
    tracar(doc, tema.branco, mini ? 0.15 : 0.3);
    doc.circle(cx, cy, raio(ponto.weight), "FD");
  }

  if (!mini) {
    definirTexto(doc, T_MARCA, tema.tinta);
    // Rótulo direto só onde ele CABE e não encosta em outro: dois nomes de
    // município sobrepostos são menos legíveis que um nome só.
    const ocupados: Array<[number, number, number, number]> = [];
    for (const ponto of spec.points) {
      if (!ponto.callout) continue;
      if (escalaX.log && ponto.x <= 0) continue;
      const cx = escalaX.para(ponto.x);
      const cy = escalaY.para(ponto.y);
      const r = raio(ponto.weight);
      const texto = toPdfText(ponto.label);
      const largura = doc.getTextWidth(texto);
      const cabeDireita = cx + r + 1.4 + largura <= plot.x + plot.largura;
      const x1 = cabeDireita ? cx + r + 1.4 : cx - r - 1.4 - largura;
      if (x1 < plot.x) continue;
      const caixa: [number, number, number, number] = [
        x1 - 1,
        cy - 2.2,
        x1 + largura + 1,
        cy + 1.8,
      ];
      const colide = ocupados.some(
        (outra) =>
          caixa[0] < outra[2] &&
          caixa[2] > outra[0] &&
          caixa[1] < outra[3] &&
          caixa[3] > outra[1],
      );
      if (colide) continue;
      ocupados.push(caixa);
      doc.text(texto, x1, cy + 0.8);
    }
  }
}

/* -------------------------------------------------------------------------
 * Barras de comparação
 * ------------------------------------------------------------------------- */

/** Espessura máxima de uma barra: 24 px a 96 dpi. */
const BARRA_MAXIMA = 6.4;

function desenharBarras(
  doc: jsPDF,
  tema: PdfTheme,
  plot: Caixa,
  spec: { items: readonly ReportBarItem[]; axis: ReportAxisSpec },
) {
  definirTexto(doc, T_LEGENDA, tema.tintaSuave);
  const larguraRotulo = Math.min(
    plot.largura * 0.42,
    Math.max(
      ...spec.items.map((item) => doc.getTextWidth(toPdfText(item.label))),
      20,
    ) + 2,
  );
  // Faixa reservada à etiqueta do valor: a barra nunca cresce por cima dela,
  // então nenhum número precisa ser escrito dentro da barra nem cortado.
  const larguraValor = 20;
  const trilho: Caixa = {
    x: plot.x + larguraRotulo,
    y: plot.y,
    largura: Math.max(20, plot.largura - larguraRotulo - larguraValor),
    altura: plot.altura,
  };
  const valores = spec.items
    .map((item) => item.value)
    .filter((valor): valor is number => valor !== null);
  const escala = criarEscala(
    [0, ...valores],
    { ...spec.axis, min: spec.axis.min ?? 0 },
    trilho.x,
    trilho.x + trilho.largura,
    3,
  );

  const faixa = plot.altura / Math.max(1, spec.items.length);
  const espessura = Math.min(BARRA_MAXIMA, faixa * 0.5);
  const decimais = spec.axis.decimals ?? 1;

  tracar(doc, tema.linha, FIO);
  for (const tick of escala.ticks) {
    const x = escala.para(tick.valor);
    doc.line(x, plot.y, x, plot.y + plot.altura - 2);
  }
  definirTexto(doc, T_TICK, tema.tintaFraca);
  let ultimoFim = -Infinity;
  for (const tick of escala.ticks) {
    const x = escala.para(tick.valor);
    const meia = doc.getTextWidth(tick.texto) / 2;
    if (x - meia < ultimoFim + 1.2) continue;
    doc.text(tick.texto, x, plot.y + plot.altura + 2.6, { align: "center" });
    ultimoFim = x + meia;
  }
  definirTexto(doc, T_EIXO, tema.tintaSuave);
  doc.text(
    encurtar(doc, `${spec.axis.label} (${spec.axis.unit})`, trilho.largura),
    trilho.x + trilho.largura / 2,
    plot.y + plot.altura + 6.4,
    { align: "center" },
  );

  spec.items.forEach((item, indice) => {
    const centro = plot.y + faixa * indice + faixa / 2;
    definirTexto(doc, T_LEGENDA, tema.tinta);
    doc.text(
      encurtar(doc, item.label, larguraRotulo - 2),
      plot.x,
      centro + 0.6,
    );
    if (item.note) {
      definirTexto(doc, T_MARCA, tema.tintaFraca);
      doc.text(
        encurtar(doc, item.note, larguraRotulo - 2),
        plot.x,
        centro + 3.6,
      );
    }
    if (item.value === null) {
      // Sem dado: nenhuma barra. Escrever zero aqui seria inventar apuração.
      definirTexto(doc, T_LEGENDA, tema.semDado);
      doc.text("sem dado", trilho.x + 1, centro + 0.8);
      return;
    }
    const fim = escala.para(item.value);
    preencher(doc, tema.rampa[item.step ?? 1]);
    doc.rect(
      trilho.x,
      centro - espessura / 2,
      Math.max(0.4, fim - trilho.x),
      espessura,
      "F",
    );
    definirTexto(doc, T_LEGENDA, tema.tinta);
    doc.text(
      `${formatarTick(item.value, decimais)}${spec.axis.unit.startsWith("%") ? "%" : ""}`,
      fim + 1.6,
      centro + 0.8,
    );
  });
}

/* -------------------------------------------------------------------------
 * Boxplot
 * ------------------------------------------------------------------------- */

function desenharBoxplot(
  doc: jsPDF,
  tema: PdfTheme,
  plot: Caixa,
  spec: { series: readonly ReportBoxSeries[]; axis: ReportAxisSpec },
) {
  definirTexto(doc, T_LEGENDA, tema.tintaSuave);
  const larguraRotulo = Math.min(
    plot.largura * 0.4,
    Math.max(
      ...spec.series.map((serie) => doc.getTextWidth(toPdfText(serie.label))),
      20,
    ) + 2,
  );
  const trilho: Caixa = {
    x: plot.x + larguraRotulo,
    y: plot.y,
    largura: Math.max(20, plot.largura - larguraRotulo - 3),
    altura: plot.altura,
  };
  const todos = spec.series.flatMap((serie) => serie.values);
  const escala = criarEscala(
    todos,
    spec.axis,
    trilho.x,
    trilho.x + trilho.largura,
    4,
  );

  tracar(doc, tema.linha, FIO);
  for (const tick of escala.ticks) {
    const x = escala.para(tick.valor);
    doc.line(x, plot.y, x, plot.y + plot.altura - 2);
  }
  definirTexto(doc, T_TICK, tema.tintaFraca);
  let ultimoFim = -Infinity;
  for (const tick of escala.ticks) {
    const x = escala.para(tick.valor);
    const meia = doc.getTextWidth(tick.texto) / 2;
    if (x - meia < ultimoFim + 1.2) continue;
    doc.text(tick.texto, x, plot.y + plot.altura + 2.6, { align: "center" });
    ultimoFim = x + meia;
  }
  definirTexto(doc, T_EIXO, tema.tintaSuave);
  doc.text(
    encurtar(doc, `${spec.axis.label} (${spec.axis.unit})`, trilho.largura),
    trilho.x + trilho.largura / 2,
    plot.y + plot.altura + 6.4,
    { align: "center" },
  );

  const faixa = plot.altura / Math.max(1, spec.series.length);
  const altura = Math.min(7, faixa * 0.42);

  spec.series.forEach((serie, indice) => {
    const centro = plot.y + faixa * indice + faixa / 2;
    definirTexto(doc, T_LEGENDA, tema.tinta);
    doc.text(encurtar(doc, serie.label, larguraRotulo - 2), plot.x, centro - 0.4);
    if (serie.note) {
      definirTexto(doc, T_MARCA, tema.tintaFraca);
      doc.text(
        encurtar(doc, serie.note, larguraRotulo - 2),
        plot.x,
        centro + 2.8,
      );
    }
    const resumo = resumirCaixa(serie.values);
    if (!resumo) {
      definirTexto(doc, T_LEGENDA, tema.semDado);
      doc.text("sem dado", trilho.x + 1, centro + 0.8);
      return;
    }
    // Hastes até o último ponto dentro de 1,5 amplitudes interquartis.
    tracar(doc, tema.tintaFraca, FIO);
    doc.line(
      escala.para(resumo.minimo),
      centro,
      escala.para(resumo.maximo),
      centro,
    );
    doc.line(
      escala.para(resumo.minimo),
      centro - altura / 3,
      escala.para(resumo.minimo),
      centro + altura / 3,
    );
    doc.line(
      escala.para(resumo.maximo),
      centro - altura / 3,
      escala.para(resumo.maximo),
      centro + altura / 3,
    );
    const x1 = escala.para(resumo.q1);
    const x3 = escala.para(resumo.q3);
    preencher(doc, tema.rampa[serie.step ?? 0]);
    doc.rect(x1, centro - altura / 2, Math.max(0.6, x3 - x1), altura, "F");
    // Mediana em branco DENTRO da caixa: separa por vão, não por borda.
    tracar(doc, tema.branco, 0.6);
    const xm = escala.para(resumo.mediana);
    doc.line(xm, centro - altura / 2, xm, centro + altura / 2);
    preencher(doc, tema.tintaFraca);
    for (const extremo of resumo.extremos) {
      doc.circle(escala.para(extremo), centro, 0.55, "F");
    }
  });
}

/* -------------------------------------------------------------------------
 * Matriz de quadrantes
 * ------------------------------------------------------------------------- */

function desenharQuadrantes(
  doc: jsPDF,
  tema: PdfTheme,
  plot: Caixa,
  spec: {
    cells: readonly ReportQuadrantCell[];
    x: ReportAxisSpec;
    y: ReportAxisSpec;
    medianaX: number;
    medianaY: number;
  },
) {
  const vao = 2;
  const larguraCelula = (plot.largura - vao) / 2;
  const alturaCelula = (plot.altura - vao) / 2;
  const posicao = (xAcima: boolean, yAcima: boolean) => ({
    x: plot.x + (xAcima ? larguraCelula + vao : 0),
    y: plot.y + (yAcima ? 0 : alturaCelula + vao),
  });

  for (const celula of spec.cells) {
    const { x, y } = posicao(celula.xAcima, celula.yAcima);
    // Todas as células com a MESMA superfície: o dado aqui é a contagem, e
    // pintar cada quadrante de uma cor inventaria uma escala que não existe.
    preencher(doc, tema.superficie);
    doc.rect(x, y, larguraCelula, alturaCelula, "F");

    // A contagem é medida na PRÓPRIA fonte em que foi escrita: calcular a
    // largura na fonte errada era o que colava "31municípios".
    const contagem = inteiroPt.format(celula.count);
    definirTexto(doc, 15, tema.tinta, "bold");
    doc.text(contagem, x + 3.4, y + 8.6);
    const larguraContagem = doc.getTextWidth(contagem);
    definirTexto(doc, T_MARCA, tema.tintaFraca);
    doc.text(
      celula.count === 1 ? "município" : "municípios",
      x + 3.4 + larguraContagem + 1.6,
      y + 8.6,
    );

    definirTexto(doc, T_LEGENDA, tema.tintaSuave);
    const rotulo = quebrar(doc, celula.label, larguraCelula - 6.8).slice(0, 3);
    rotulo.forEach((linha, indice) => {
      doc.text(linha, x + 3.4, y + 13 + indice * 3.1);
    });

    let cursor = y + 13 + rotulo.length * 3.1 + 2.4;
    definirTexto(doc, T_MARCA, tema.tinta);
    for (const nome of celula.items.slice(0, celula.limite)) {
      if (cursor > y + alturaCelula - 2.4) break;
      doc.text(encurtar(doc, `· ${nome}`, larguraCelula - 6.8), x + 3.4, cursor);
      cursor += 3.1;
    }
    if (celula.count > celula.items.length && cursor <= y + alturaCelula - 2.4) {
      definirTexto(doc, T_MARCA, tema.tintaFraca);
      doc.text(
        `+ ${inteiroPt.format(celula.count - celula.items.length)} no grupo`,
        x + 3.4,
        cursor,
      );
    }
  }

  definirTexto(doc, T_EIXO, tema.tintaSuave);
  escreverVertical(
    doc,
    encurtar(doc, `${spec.y.label} (${spec.y.unit})`, plot.altura),
    plot.x - 4.6,
    plot.y + plot.altura / 2,
  );
  definirTexto(doc, T_EIXO, tema.tintaSuave);
  doc.text(
    encurtar(doc, `${spec.x.label} (${spec.x.unit})`, plot.largura),
    plot.x + plot.largura / 2,
    plot.y + plot.altura + 6.6,
    { align: "center" },
  );
  definirTexto(doc, T_MARCA, tema.tintaFraca);
  doc.text("abaixo da mediana", plot.x + larguraCelula / 2, plot.y + plot.altura + 3, {
    align: "center",
  });
  doc.text(
    "igual ou acima da mediana",
    plot.x + larguraCelula + vao + larguraCelula / 2,
    plot.y + plot.altura + 3,
    { align: "center" },
  );
}

/* -------------------------------------------------------------------------
 * Curva de Pareto (acumulada)
 * ------------------------------------------------------------------------- */

function desenharPareto(
  doc: jsPDF,
  tema: PdfTheme,
  plot: Caixa,
  spec: {
    points: readonly ReportParetoPoint[];
    marcos: readonly { posicao: number; acumuladoPct: number; label: string }[];
    axis: ReportAxisSpec;
  },
) {
  const total = spec.points.length;
  const escalaX = criarEscala(
    [1, Math.max(1, total)],
    { label: "Municípios", unit: "posição no ranking", min: 0, max: Math.max(1, total), decimals: 0 },
    plot.x,
    plot.x + plot.largura,
    4,
  );
  const escalaY = criarEscala(
    [0, 100],
    { ...spec.axis, min: 0, max: 100, decimals: 0 },
    plot.y + plot.altura,
    plot.y,
    4,
  );
  desenharMoldura(doc, tema, plot, {
    x: {
      escala: escalaX,
      axis: { label: "Municípios ordenados do mais votado ao menos votado", unit: "posição" },
    },
    y: { escala: escalaY, axis: spec.axis },
  });

  // Barras da participação individual e linha do acumulado dividem O MESMO
  // eixo: as duas são percentagem do mesmo total de votos. Dois eixos y aqui
  // inventariam uma relação que o dado não tem.
  const largura = Math.max(0.35, plot.largura / Math.max(1, total) - 0.15);
  preencher(doc, tema.rampa[0]);
  for (const ponto of spec.points) {
    const x = escalaX.para(ponto.posicao);
    const y = escalaY.para(ponto.participacaoPct);
    const base = escalaY.para(0);
    doc.rect(x - largura / 2, y, largura, Math.max(0.3, base - y), "F");
  }

  tracar(doc, tema.rampa[1], TRACO_DADO);
  let anterior: { x: number; y: number } | null = null;
  for (const ponto of spec.points) {
    const atual = {
      x: escalaX.para(ponto.posicao),
      y: escalaY.para(ponto.acumuladoPct),
    };
    if (anterior) doc.line(anterior.x, anterior.y, atual.x, atual.y);
    anterior = atual;
  }

  /* Marcos anotados. As etiquetas NÃO ficam ao lado do ponto: os cortes de 5,
     10 e 20 municípios caem quase no mesmo lugar do eixo, e três etiquetas ali
     se sobrepõem entre si e por cima da curva. Elas são empilhadas no alto —
     a região vazia do gráfico —, cada uma ligada ao seu ponto por uma linha de
     chamada fina. */
  spec.marcos.forEach((marco, indice) => {
    if (marco.posicao > total) return;
    const x = escalaX.para(marco.posicao);
    const y = escalaY.para(marco.acumuladoPct);
    tracar(doc, tema.linha, FIO);
    doc.line(x, plot.y + plot.altura, x, y);
    definirTexto(doc, T_MARCA, tema.tinta);
    const texto = toPdfText(marco.label);
    const larguraTexto = doc.getTextWidth(texto);
    // As etiquetas empilham no canto INFERIOR direito — a única região
    // sistematicamente vazia de uma curva acumulada, que sobe rápido e depois
    // corre colada no topo.
    const alvoY = plot.y + plot.altura - 3.4 - indice * 4.2;
    const cabeDireita = x + 2.6 + larguraTexto <= plot.x + plot.largura;
    const alvoX = cabeDireita ? x + 2.6 : x - 2.6 - larguraTexto;
    // Linha de chamada: liga a etiqueta ao ponto sem que ela precise encostar
    // nele. Só é desenhada quando há distância suficiente para ela existir.
    if (alvoY - y > 3) {
      tracar(doc, tema.linha, FIO);
      doc.line(cabeDireita ? x + 1.2 : x - 1.2, alvoY - 1, x, y + 1.6);
    }
    doc.text(texto, alvoX, alvoY);
    preencher(doc, tema.rampa[2]);
    tracar(doc, tema.branco, 0.3);
    doc.circle(x, y, 1.1, "FD");
  });
}

/* -------------------------------------------------------------------------
 * Pequenos múltiplos
 * ------------------------------------------------------------------------- */

/** Uma tira de distribuição: caixa, mediana e um ponto por município. */
function desenharTira(
  doc: jsPDF,
  tema: PdfTheme,
  caixa: Caixa,
  values: readonly number[],
  axis: ReportAxisSpec,
) {
  const escala = criarEscala(values, axis, caixa.x, caixa.x + caixa.largura, 2);
  const centro = caixa.y + caixa.altura * 0.42;
  const resumo = resumirCaixa(values);

  tracar(doc, tema.linha, FIO);
  doc.line(caixa.x, caixa.y + caixa.altura - 4.6, caixa.x + caixa.largura, caixa.y + caixa.altura - 4.6);
  definirTexto(doc, T_TICK, tema.tintaFraca);
  const primeiro = escala.ticks[0];
  const ultimo = escala.ticks[escala.ticks.length - 1];
  if (primeiro) doc.text(primeiro.texto, caixa.x, caixa.y + caixa.altura - 1.4);
  if (ultimo && ultimo !== primeiro) {
    doc.text(ultimo.texto, caixa.x + caixa.largura, caixa.y + caixa.altura - 1.4, {
      align: "right",
    });
  }

  if (!resumo) {
    definirTexto(doc, T_LEGENDA, tema.semDado);
    doc.text("sem dado", caixa.x, centro);
    return;
  }

  const altura = 4.4;
  tracar(doc, tema.tintaFraca, FIO);
  doc.line(escala.para(resumo.minimo), centro, escala.para(resumo.maximo), centro);
  const x1 = escala.para(resumo.q1);
  const x3 = escala.para(resumo.q3);
  preencher(doc, tema.rampa[0]);
  doc.rect(x1, centro - altura / 2, Math.max(0.6, x3 - x1), altura, "F");
  tracar(doc, tema.branco, 0.6);
  doc.line(
    escala.para(resumo.mediana),
    centro - altura / 2,
    escala.para(resumo.mediana),
    centro + altura / 2,
  );
  preencher(doc, tema.rampa[2]);
  for (const valor of values) {
    if (!Number.isFinite(valor)) continue;
    if (escala.log && valor <= 0) continue;
    doc.circle(escala.para(valor), centro + altura / 2 + 1.8, 0.42, "F");
  }
  definirTexto(doc, T_MARCA, tema.tintaFraca);
  doc.text(
    `mediana ${formatarTick(resumo.mediana, axis.decimals ?? 1)}`,
    caixa.x,
    centro - altura / 2 - 1.4,
  );
}

function desenharMultiplos(
  doc: jsPDF,
  tema: PdfTheme,
  plot: Caixa,
  spec: { panels: readonly ReportPanel[]; colunas: number },
) {
  const colunas = Math.max(1, spec.colunas);
  const linhas = Math.ceil(spec.panels.length / colunas);
  const vao = 4;
  const largura = (plot.largura - vao * (colunas - 1)) / colunas;
  // -3 mm de respiro no pé de cada painel: sem ele, a contagem de "sem dado"
  // do último painel encostava na descrição textual do gráfico.
  const altura = (plot.altura - vao * (linhas - 1)) / linhas - 3;

  spec.panels.forEach((painel, indice) => {
    const coluna = indice % colunas;
    const linha = Math.floor(indice / colunas);
    const x = plot.x + coluna * (largura + vao);
    const y = plot.y + linha * (altura + vao);

    definirTexto(doc, T_SUB, tema.tinta, "bold");
    doc.text(encurtar(doc, painel.title, largura), x, y + 3.2);
    let topo = y + 6.4;
    if (painel.subtitle) {
      definirTexto(doc, T_MARCA, tema.tintaFraca);
      doc.text(encurtar(doc, painel.subtitle, largura), x, y + 6.4);
      topo = y + 9;
    }
    const notaAltura = painel.note ? 6 : 0;
    const semDadoAltura = painel.semDado && painel.semDado > 0 ? 3.4 : 0;
    const corpo: Caixa = {
      x,
      y: topo,
      largura,
      altura: Math.max(12, y + altura - topo - notaAltura - semDadoAltura),
    };
    if (painel.spec.kind === "tira") {
      desenharTira(doc, tema, corpo, painel.spec.values, painel.spec.axis);
    } else {
      desenharDispersao(doc, tema, corpo, painel.spec, true);
    }
    let rodape = corpo.y + corpo.altura + 2.6;
    if (painel.semDado && painel.semDado > 0) {
      preencher(doc, tema.semDado);
      doc.rect(x, rodape - 1.8, 2.2, 2.2, "F");
      definirTexto(doc, T_MARCA, tema.tintaFraca);
      doc.text(
        `${inteiroPt.format(painel.semDado)} sem dado`,
        x + 3.2,
        rodape,
      );
      rodape += 3.2;
    }
    if (painel.note) {
      definirTexto(doc, T_MARCA, tema.tintaSuave);
      quebrar(doc, painel.note, largura)
        .slice(0, 2)
        .forEach((texto, posicao) => doc.text(texto, x, rodape + posicao * 2.9));
    }
  });
}

/* -------------------------------------------------------------------------
 * Composição de um gráfico
 * ------------------------------------------------------------------------- */

/**
 * Desenha o bloco completo — título, subtítulo, legenda, gráfico, descrição
 * textual, contagem de sem-dado e fonte — e devolve a altura consumida, que é
 * a mesma que `medirGrafico` prometeu.
 */
export function desenharGrafico(
  doc: jsPDF,
  chart: ReportChart,
  x: number,
  y: number,
  largura: number,
  tema: PdfTheme = TEMA_PADRAO,
): number {
  let cursor = y;
  definirTexto(doc, T_TITULO, tema.tinta, "bold");
  doc.text(encurtar(doc, chart.title, largura), x, cursor + 3.6);
  cursor += 5.4;
  if (chart.subtitle) {
    definirTexto(doc, T_SUB, tema.tintaSuave);
    cursor += paragrafo(doc, chart.subtitle, x, cursor + 1.4, largura, L_SUB) + 1;
  }
  cursor += desenharLegenda(doc, tema, chart.legend, x, cursor, largura);

  const altura = alturaDesenho(chart);
  const spec = chart.spec;
  const plot: Caixa = {
    x: x + EIXO_ESQUERDA,
    y: cursor + EIXO_TOPO,
    largura: largura - EIXO_ESQUERDA - EIXO_DIREITA,
    altura: altura - EIXO_TOPO - EIXO_BASE,
  };

  if (spec.kind === "dispersao") {
    desenharDispersao(doc, tema, plot, spec);
  } else if (spec.kind === "barras") {
    desenharBarras(doc, tema, { ...plot, x, largura }, spec);
  } else if (spec.kind === "boxplot") {
    desenharBoxplot(doc, tema, { ...plot, x, largura }, spec);
  } else if (spec.kind === "quadrantes") {
    desenharQuadrantes(
      doc,
      tema,
      { ...plot, x: x + 8, largura: largura - 8 },
      spec,
    );
  } else if (spec.kind === "pareto") {
    desenharPareto(doc, tema, plot, spec);
  } else {
    desenharMultiplos(
      doc,
      tema,
      { x, y: cursor, largura, altura },
      spec,
    );
  }
  cursor += altura;

  definirTexto(doc, T_DESCRICAO, tema.tintaSuave);
  cursor += paragrafo(doc, chart.description, x, cursor + 2, largura, L_DESCRICAO) + 1.5;
  if (chart.semDado && chart.semDado.count > 0) {
    definirTexto(doc, T_FONTE, tema.tintaFraca);
    cursor += paragrafo(doc, textoSemDado(chart), x, cursor, largura, 3.2);
  }
  if (chart.source) {
    definirTexto(doc, T_FONTE, tema.tintaFraca);
    cursor += paragrafo(doc, textoFonte(chart.source), x, cursor, largura, 3.2);
  }
  return cursor - y + 4;
}
