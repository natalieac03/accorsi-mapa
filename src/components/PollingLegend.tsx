import { RotateCcw, School } from "lucide-react";
import type { AnalysisBand } from "../types/analysis";
import type { PollingMetric, PollingViewMode } from "../types/pollingPlaces";
import { ALL_ANALYSIS_BANDS } from "../utils/analysis";
import { formatInteger, MISSING_DATA_COLOR } from "../utils/electorate";
import {
  getPollingBandLabel,
  getPollingMetricColors,
  getPollingMetricShortLabel,
  getPollingRangeLabel,
} from "../utils/pollingPlaces";

type PollingLegendProps = {
  viewMode: PollingViewMode;
  metric: PollingMetric;
  partyCode: string;
  thresholds: number[];
  bandCounts: number[];
  missingValueCount: number;
  placesWithoutCoordinateCount: number;
  activeBands: AnalysisBand[];
  waveYear: number;
  bubbleCount: number;
  hiddenBubbleCount: number;
  onToggleBand: (band: AnalysisBand) => void;
  onShowAllBands: () => void;
};

export function PollingLegend({
  viewMode,
  metric,
  partyCode,
  thresholds,
  bandCounts,
  missingValueCount,
  placesWithoutCoordinateCount,
  activeBands,
  waveYear,
  bubbleCount,
  hiddenBubbleCount,
  onToggleBand,
  onShowAllBands,
}: PollingLegendProps) {
  const allBandsActive = activeBands.length === ALL_ANALYSIS_BANDS.length;
  const unitLabel = viewMode === "neighborhoods" ? "bairros" : "locais";
  const isPartyShare = metric === "votoPartido";
  const metricLabel = getPollingMetricShortLabel(metric, partyCode);
  const colors = getPollingMetricColors(metric);

  return (
    <section
      className="electorate-legend"
      aria-label={`Legenda: ${metricLabel} por ${unitLabel}`}
    >
      <div className="legend-title">
        <School size={16} />
        <span>Locais de votação · {metricLabel}</span>
        {!allBandsActive && (
          <button
            type="button"
            onClick={onShowAllBands}
            aria-label="Mostrar todas as faixas"
            title="Mostrar todas as faixas"
          >
            <RotateCcw size={13} />
          </button>
        )}
      </div>

      <div className="legend-scale">
        {ALL_ANALYSIS_BANDS.map((band) => {
          const active = activeBands.includes(band);
          // No índice o nome do bloco vem antes do intervalo; no percentual o
          // rótulo JÁ é o intervalo e repeti-lo só faria ruído.
          const label = isPartyShare
            ? getPollingRangeLabel(metric, thresholds, band)
            : `${getPollingBandLabel(metric, thresholds, band)} · ${getPollingRangeLabel(metric, thresholds, band)}`;
          return (
            <button
              className={`legend-item ${active ? "legend-item--active" : ""}`}
              type="button"
              key={band}
              aria-pressed={active}
              title={label}
              onClick={() => onToggleBand(band)}
            >
              <span
                className="legend-swatch"
                style={{ backgroundColor: colors[band] }}
              />
              <span>{label}</span>
              <small>{bandCounts[band]}</small>
            </button>
          );
        })}
        {missingValueCount > 0 && (
          <div className="legend-item legend-item--missing">
            <span
              className="legend-swatch"
              style={{ backgroundColor: MISSING_DATA_COLOR }}
            />
            <span>
              {isPartyShare
                ? "Sem voto apurado neste pleito"
                : "Sem índice neste pleito"}
            </span>
            <small>{missingValueCount}</small>
          </div>
        )}
      </div>

      <small>
        {formatInteger(bubbleCount)} bolhas ({unitLabel}) · área proporcional ao
        eleitorado ·{" "}
        {isPartyShare
          ? "percentual sobre os votos apurados de cada unidade"
          : `onda ${waveYear} do survey`}
        {hiddenBubbleCount > 0
          ? ` · ${formatInteger(hiddenBubbleCount)} bolhas menores fora do desenho (filtre por município para vê-las)`
          : ""}
        {placesWithoutCoordinateCount > 0
          ? ` · ${formatInteger(placesWithoutCoordinateCount)} locais sem coordenada ficam fora do mapa e contam no bairro`
          : ""}
        {viewMode === "neighborhoods"
          ? " · bairro = agregação de locais, não polígono"
          : ""}
      </small>
    </section>
  );
}
