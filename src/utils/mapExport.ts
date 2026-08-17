import type { AnalysisModel } from "../types/analysis";
import type { ElectionModel } from "../types/elections";
import type { PollingModel } from "../types/pollingPlaces";
import type { SpectrumModel } from "../types/spectrum";
import {
  ALL_ANALYSIS_BANDS,
  formatAnalysisMetricValue,
  getAnalysisRangeLabel,
} from "./analysis.ts";
import {
  formatElectionMetricValue,
  getElectionRangeLabel,
} from "./elections.ts";
import { ELECTORATE_COLORS, MISSING_DATA_COLOR } from "./electorate.ts";
import {
  formatPollingValue,
  getPollingMetricColors,
  getPollingRangeLabel,
} from "./pollingPlaces.ts";
import {
  formatSpectrumValue,
  getSpectrumBandLabel,
  getSpectrumContestLabel,
  getSpectrumMetricColors,
  getSpectrumRangeLabel,
  getSpectrumShiftBandLabel,
} from "./spectrum.ts";

/**
 * Exportação do mapa coroplético como PNG.
 *
 * Nunca capturamos os tiles do Google (viola os termos de uso e "suja" o
 * canvas): desenhamos um mapa autônomo em canvas offscreen a partir das
 * geometrias já carregadas no `map.data`, com projeção equiretangular
 * corrigida por cos(latitude média) — para a extensão de um estado a
 * distorção é desprezível.
 */

export type MapExportPoint = { lat: number; lng: number };

/** Município como lista de anéis de coordenadas (furos inclusos). */
export type MapExportShape = { id: string; rings: MapExportPoint[][] };

export type MapExportFeatureStyle = {
  fillColor: string;
  /** valor formatado da métrica, para inspeção e usos futuros */
  valueLabel: string;
  name: string;
  /** faixa fora do foco atual: desenhada esmaecida, como no app */
  muted: boolean;
};

export type MapExportLegendEntry = {
  color: string;
  label: string;
  count: number;
};

export type MapExportBounds = {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
};

export type MapExportData = {
  styleById: Map<string, MapExportFeatureStyle>;
  title: string;
  subtitle: string;
  legend: MapExportLegendEntry[];
  attribution: string;
  filename: string;
};

export const MAP_EXPORT_WIDTH = 2000;
export const MAP_EXPORT_BACKGROUND = "#ffffff";
export const MAP_EXPORT_ATTRIBUTION =
  "Elaborado com dados públicos TSE/IBGE · Malha: IBGE";

const EXPORT_PADDING = 64;
const HEADER_HEIGHT = 168;
const LEGEND_COLUMNS = 2;
const LEGEND_ROW_HEIGHT = 56;
const FOOTER_HEIGHT = 72;
const STROKE_COLOR = "#ffffff";
const TITLE_COLOR = "#201b1a";
const SUBTITLE_COLOR = "#554e4c";
const LABEL_COLOR = "#201b1a";
const MUTED_TEXT_COLOR = "#6e6560";

export function computeShapeBounds(
  shapes: MapExportShape[],
): MapExportBounds | null {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const shape of shapes) {
    for (const ring of shape.rings) {
      for (const point of ring) {
        if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) continue;
        if (point.lat < minLat) minLat = point.lat;
        if (point.lat > maxLat) maxLat = point.lat;
        if (point.lng < minLng) minLng = point.lng;
        if (point.lng > maxLng) maxLng = point.lng;
      }
    }
  }
  if (!Number.isFinite(minLat) || !Number.isFinite(minLng)) return null;
  return { minLat, maxLat, minLng, maxLng };
}

/**
 * Projeção equiretangular com correção cos(latitude média): um grau de
 * longitude encolhe pelo cosseno da latitude média do recorte. A geometria é
 * ajustada (letterbox) e centralizada na área útil; y cresce para o sul.
 */
export function createEquirectangularProjection(
  bounds: MapExportBounds,
  width: number,
  height: number,
  padding = 0,
): (point: MapExportPoint) => { x: number; y: number } {
  const midLat = (bounds.minLat + bounds.maxLat) / 2;
  const cosine = Math.cos((midLat * Math.PI) / 180);
  const spanX = Math.max((bounds.maxLng - bounds.minLng) * cosine, 1e-12);
  const spanY = Math.max(bounds.maxLat - bounds.minLat, 1e-12);
  const innerWidth = Math.max(width - 2 * padding, 1);
  const innerHeight = Math.max(height - 2 * padding, 1);
  const scale = Math.min(innerWidth / spanX, innerHeight / spanY);
  const offsetX = padding + (innerWidth - spanX * scale) / 2;
  const offsetY = padding + (innerHeight - spanY * scale) / 2;
  return (point) => ({
    x: offsetX + (point.lng - bounds.minLng) * cosine * scale,
    y: offsetY + (bounds.maxLat - point.lat) * scale,
  });
}

export type MapExportLayout = {
  width: number;
  padding: number;
  headerHeight: number;
  mapHeight: number;
  legendColumns: number;
  legendRows: number;
  legendHeight: number;
  footerHeight: number;
  totalHeight: number;
};

/**
 * Layout do PNG: cabeçalho, área do mapa com altura proporcional ao bounding
 * box (já com a correção do cosseno), grade da legenda e rodapé de fonte.
 */
export function computeExportLayout(
  bounds: MapExportBounds,
  legendCount: number,
  width = MAP_EXPORT_WIDTH,
): MapExportLayout {
  const midLat = (bounds.minLat + bounds.maxLat) / 2;
  const cosine = Math.cos((midLat * Math.PI) / 180);
  const spanX = Math.max((bounds.maxLng - bounds.minLng) * cosine, 1e-12);
  const spanY = Math.max(bounds.maxLat - bounds.minLat, 1e-12);
  const innerWidth = width - 2 * EXPORT_PADDING;
  const rawMapHeight = Math.round((innerWidth * spanY) / spanX);
  const mapHeight = Math.min(Math.max(rawMapHeight, 400), 2600) + EXPORT_PADDING;
  const legendRows = Math.ceil(Math.max(legendCount, 0) / LEGEND_COLUMNS);
  const legendHeight = legendRows * LEGEND_ROW_HEIGHT + EXPORT_PADDING / 2;
  return {
    width,
    padding: EXPORT_PADDING,
    headerHeight: HEADER_HEIGHT,
    mapHeight,
    legendColumns: LEGEND_COLUMNS,
    legendRows,
    legendHeight,
    footerHeight: FOOTER_HEIGHT,
    totalHeight: HEADER_HEIGHT + mapHeight + legendHeight + FOOTER_HEIGHT,
  };
}

type BandItem = {
  id: string;
  name: string;
  value: number | null;
  band: number;
  valueLabel: string;
  focused: boolean;
};

/**
 * Mapeamento id → estilo a partir das faixas: valor nulo cai no cinza de
 * "sem dado" (nunca pintado como faixa 0), faixa fora do foco fica esmaecida.
 */
export function buildBandStyleMap(
  items: BandItem[],
  colors: readonly string[],
  missingColor = MISSING_DATA_COLOR,
): Map<string, MapExportFeatureStyle> {
  const styleById = new Map<string, MapExportFeatureStyle>();
  for (const item of items) {
    const missing = item.value === null || !Number.isFinite(item.value);
    styleById.set(item.id, {
      fillColor: missing ? missingColor : colors[item.band] ?? missingColor,
      valueLabel: item.valueLabel,
      name: item.name,
      muted: !missing && !item.focused,
    });
  }
  return styleById;
}

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function missingLegendEntry(label: string, count: number): MapExportLegendEntry[] {
  return count > 0 ? [{ color: MISSING_DATA_COLOR, label, count }] : [];
}

/** Montagem dos dados de export da camada do espectro ideológico. */
export function buildSpectrumMapExport(model: SpectrumModel): MapExportData {
  const colors = getSpectrumMetricColors(model.metricId);
  const focusedIds = new Set(
    model.filteredItems.map((item) => item.municipality.ibgeCode),
  );
  const styleById = buildBandStyleMap(
    model.allItems.map((item) => ({
      id: item.municipality.ibgeCode,
      name: item.municipality.name,
      value: item.value,
      band: item.band,
      valueLabel:
        item.value === null
          ? "Sem índice"
          : formatSpectrumValue(model.metricId, item.value),
      focused: focusedIds.has(item.municipality.ibgeCode),
    })),
    colors,
  );
  const legend: MapExportLegendEntry[] = [
    ...ALL_ANALYSIS_BANDS.map((band) => {
      const range = getSpectrumRangeLabel(model.metricId, model.thresholds, band);
      const label =
        model.metricId === "index"
          ? `${getSpectrumBandLabel(band)} · ${range}`
          : model.metricId === "shift"
            ? `${getSpectrumShiftBandLabel(band)} · ${range}`
            : range;
      return {
        color: colors[band],
        label,
        count: model.bandCounts[band] ?? 0,
      };
    }),
    ...missingLegendEntry(
      model.metricId === "shift"
        ? "Sem índice em um dos pleitos"
        : "Sem índice neste pleito",
      model.missingMunicipalityCount,
    ),
  ];
  const contestLabel = getSpectrumContestLabel(model.contest);
  const comparisonContest =
    model.metricId === "shift" ? model.comparisonContest : null;
  const subtitle = comparisonContest
    ? `${getSpectrumContestLabel(comparisonContest)} → ${contestLabel} · ondas ${model.comparisonWave?.year ?? "?"}/${model.wave.year} do survey`
    : `${contestLabel} · onda ${model.wave.year} do survey`;
  const filename = comparisonContest
    ? `espectro-deslocamento-${comparisonContest.electionYear}-${model.contest.electionYear}-${slugify(model.contest.officeName)}-${model.contest.round}t.png`
    : `espectro-${model.contest.electionYear}-${slugify(model.contest.officeName)}-${model.contest.round}t.png`;
  return {
    styleById,
    title: `Espectro ideológico · ${model.metricLabel}`,
    subtitle,
    legend,
    attribution: MAP_EXPORT_ATTRIBUTION,
    filename,
  };
}

/**
 * Montagem dos dados de export da camada submunicipal (locais de votação).
 *
 * O PNG é desenhado a partir das geometrias MUNICIPAIS já carregadas — não
 * existe malha de local nem de bairro. Por isso o mapa exportado mostra a
 * métrica AGREGADA POR MUNICÍPIO a partir dos locais de votação (soma dos
 * votos dos locais antes de calcular índice ou percentual, nunca média de
 * médias), e o subtítulo diz isso explicitamente. As bolhas por local/bairro
 * continuam só na tela.
 */
export function buildPollingMapExport(model: PollingModel): MapExportData {
  // O PNG carrega a MESMA métrica da tela: em Presidente e Governador o mapa
  // exportado é de percentual de uma sigla, com a rampa sequencial e sem
  // nenhuma palavra sobre índice ideológico.
  const isPartyShare = model.metric === "votoPartido";
  const colors = getPollingMetricColors(model.metric);
  const focusedIds = new Set(
    model.municipalityId ? [model.municipalityId] : model.municipalityAggregates.map((item) => item.ibgeCode),
  );
  const styleById = buildBandStyleMap(
    model.municipalityAggregates.map((item) => ({
      id: item.ibgeCode,
      name: item.name,
      value: item.value,
      band: item.band,
      valueLabel: formatPollingValue(model.metric, item.value),
      focused: focusedIds.has(item.ibgeCode),
    })),
    colors,
  );
  const bandCounts = ALL_ANALYSIS_BANDS.map(
    (band) =>
      model.municipalityAggregates.filter(
        (item) => item.value !== null && item.band === band,
      ).length,
  );
  const missingCount = model.municipalityAggregates.filter(
    (item) => item.value === null,
  ).length;
  const legend: MapExportLegendEntry[] = [
    ...ALL_ANALYSIS_BANDS.map((band) => ({
      color: colors[band],
      label: isPartyShare
        ? `${getPollingRangeLabel(model.metric, model.thresholds, band)} do voto apurado`
        : `${getSpectrumBandLabel(band)} · ${getSpectrumRangeLabel("index", model.thresholds, band)}`,
      count: bandCounts[band] ?? 0,
    })),
    ...missingLegendEntry(
      isPartyShare ? "Sem voto apurado neste pleito" : "Sem índice neste pleito",
      missingCount,
    ),
  ];
  const scope = model.municipalityName ?? "Goiás";
  return {
    styleById,
    title: isPartyShare
      ? `Locais de votação · % de voto do ${model.partyCode || "partido"}`
      : "Locais de votação · índice ideológico",
    subtitle: isPartyShare
      ? `${model.contestLabel} · percentual sobre os votos apurados · agregado por município a partir de ${model.summary.placeCount} locais de votação`
      : `${model.contestLabel} · onda ${model.waveYear} do survey · agregado por município a partir de ${model.summary.placeCount} locais de votação`,
    legend,
    attribution: MAP_EXPORT_ATTRIBUTION,
    filename: isPartyShare
      ? `locais-voto-${slugify(model.partyCode || "partido")}-${slugify(scope)}-${model.contestId || "pleito"}.png`
      : `locais-votacao-${slugify(scope)}-${model.contestId || "pleito"}.png`,
  };
}

/** Montagem dos dados de export da camada de análise territorial. */
export function buildAnalysisMapExport(model: AnalysisModel): MapExportData {
  const focusedIds = new Set(
    model.filteredItems.map((item) => item.municipality.ibgeCode),
  );
  const styleById = buildBandStyleMap(
    model.allItems.map((item) => ({
      id: item.municipality.ibgeCode,
      name: item.municipality.name,
      value: item.value,
      band: item.band,
      valueLabel: formatAnalysisMetricValue(model.metric.id, item.value),
      focused: focusedIds.has(item.municipality.ibgeCode),
    })),
    ELECTORATE_COLORS,
  );
  const legend: MapExportLegendEntry[] = [
    ...ALL_ANALYSIS_BANDS.map((band) => ({
      color: ELECTORATE_COLORS[band],
      label: getAnalysisRangeLabel(model.metric.id, model.thresholds, band),
      count: model.bandCounts[band] ?? 0,
    })),
    ...missingLegendEntry("Sem dado", model.missingMunicipalityCount),
  ];
  return {
    styleById,
    title: model.metric.label,
    subtitle: `${model.metric.sourceLabel} · ${model.metric.referenceYear} · faixas por quintis`,
    legend,
    attribution: MAP_EXPORT_ATTRIBUTION,
    filename: `analise-${slugify(model.metric.shortLabel)}-${model.metric.referenceYear}.png`,
  };
}

/** Montagem dos dados de export da camada de histórico eleitoral. */
export function buildElectionMapExport(model: ElectionModel): MapExportData {
  const focusedIds = new Set(
    model.filteredItems.map((item) => item.municipality.ibgeCode),
  );
  const styleById = buildBandStyleMap(
    model.allItems.map((item) => ({
      id: item.municipality.ibgeCode,
      name: item.municipality.name,
      value: item.value,
      band: item.band,
      valueLabel: formatElectionMetricValue(model.metricId, item.value),
      focused: focusedIds.has(item.municipality.ibgeCode),
    })),
    ELECTORATE_COLORS,
  );
  const legend: MapExportLegendEntry[] = ALL_ANALYSIS_BANDS.map((band) => ({
    color: ELECTORATE_COLORS[band],
    label: getElectionRangeLabel(model.metricId, model.thresholds, band),
    count: model.bandCounts[band] ?? 0,
  }));
  const contestLabel = `${model.contest.electionYear} · ${model.contest.officeName} · ${model.contest.round}º turno`;
  const subtitle =
    model.metricId === "swing" && model.comparisonCandidate
      ? `${contestLabel} vs ${model.comparisonContest.electionYear} · ${model.metricShortLabel}`
      : `${contestLabel} · ${model.metricShortLabel}`;
  return {
    styleById,
    title: model.candidate.party
      ? `${model.candidate.ballotName} (${model.candidate.party})`
      : model.candidate.ballotName,
    subtitle,
    legend,
    attribution: MAP_EXPORT_ATTRIBUTION,
    filename: `historico-${model.contest.electionYear}-${slugify(model.contest.officeName)}-${model.contest.round}t-${slugify(model.candidate.ballotName)}.png`,
  };
}

function drawShapes(
  context: CanvasRenderingContext2D,
  shapes: MapExportShape[],
  styleById: Map<string, MapExportFeatureStyle>,
  project: (point: MapExportPoint) => { x: number; y: number },
  offsetY: number,
) {
  for (const shape of shapes) {
    const style = styleById.get(shape.id);
    const path = new Path2D();
    for (const ring of shape.rings) {
      if (ring.length < 3) continue;
      ring.forEach((point, position) => {
        const projected = project(point);
        if (position === 0) path.moveTo(projected.x, projected.y + offsetY);
        else path.lineTo(projected.x, projected.y + offsetY);
      });
      path.closePath();
    }
    context.globalAlpha = style ? (style.muted ? 0.22 : 0.92) : 0.92;
    context.fillStyle = style?.fillColor ?? MISSING_DATA_COLOR;
    // evenodd: anéis internos viram furos, como no GeoJSON original.
    context.fill(path, "evenodd");
    context.globalAlpha = 1;
    context.strokeStyle = STROKE_COLOR;
    context.lineWidth = 1.4;
    context.stroke(path);
  }
}

function drawChrome(
  context: CanvasRenderingContext2D,
  data: MapExportData,
  layout: MapExportLayout,
) {
  const { width, padding } = layout;
  context.fillStyle = MAP_EXPORT_BACKGROUND;
  context.fillRect(0, 0, width, layout.totalHeight);

  context.textBaseline = "alphabetic";
  context.fillStyle = TITLE_COLOR;
  context.font = "600 54px system-ui, sans-serif";
  context.fillText(data.title, padding, padding + 42);
  context.fillStyle = SUBTITLE_COLOR;
  context.font = "400 32px system-ui, sans-serif";
  context.fillText(data.subtitle, padding, padding + 96);

  const legendTop = layout.headerHeight + layout.mapHeight;
  const columnWidth = (width - 2 * padding) / layout.legendColumns;
  data.legend.forEach((entry, position) => {
    const column = position % layout.legendColumns;
    const row = Math.floor(position / layout.legendColumns);
    const x = padding + column * columnWidth;
    const y = legendTop + row * LEGEND_ROW_HEIGHT;
    context.fillStyle = entry.color;
    context.fillRect(x, y, 36, 36);
    context.strokeStyle = STROKE_COLOR;
    context.lineWidth = 2;
    context.strokeRect(x, y, 36, 36);
    context.fillStyle = LABEL_COLOR;
    context.font = "400 27px system-ui, sans-serif";
    context.fillText(`${entry.label} (${entry.count})`, x + 52, y + 28);
  });

  context.fillStyle = MUTED_TEXT_COLOR;
  context.font = "400 24px system-ui, sans-serif";
  context.fillText(
    data.attribution,
    padding,
    layout.totalHeight - FOOTER_HEIGHT / 2,
  );
}

/** Desenha o mapa completo em um canvas offscreen já dimensionado. */
export function renderMapExportCanvas(
  shapes: MapExportShape[],
  data: MapExportData,
): HTMLCanvasElement | null {
  const bounds = computeShapeBounds(shapes);
  if (!bounds || typeof document === "undefined") return null;
  const layout = computeExportLayout(bounds, data.legend.length);
  const canvas = document.createElement("canvas");
  canvas.width = layout.width;
  canvas.height = layout.totalHeight;
  const context = canvas.getContext("2d");
  if (!context) return null;
  drawChrome(context, data, layout);
  const project = createEquirectangularProjection(
    bounds,
    layout.width,
    layout.mapHeight,
    layout.padding / 2,
  );
  drawShapes(context, shapes, data.styleById, project, layout.headerHeight);
  return canvas;
}

/**
 * Gera o PNG e dispara o download com nome descritivo. Resolve `false`
 * quando o canvas ou o blob não puderam ser criados.
 */
export function exportMapAsPng(
  shapes: MapExportShape[],
  data: MapExportData,
): Promise<boolean> {
  const canvas = renderMapExportCanvas(shapes, data);
  if (!canvas) return Promise.resolve(false);
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        resolve(false);
        return;
      }
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = data.filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      resolve(true);
    }, "image/png");
  });
}
