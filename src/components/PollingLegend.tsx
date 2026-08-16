import { RotateCcw, School } from "lucide-react";
import type { AnalysisBand } from "../types/analysis";
import type { PollingViewMode } from "../types/pollingPlaces";
import { ALL_ANALYSIS_BANDS } from "../utils/analysis";
import { formatInteger, MISSING_DATA_COLOR } from "../utils/electorate";
import {
  getSpectrumBandLabel,
  getSpectrumRangeLabel,
  SPECTRUM_COLORS,
} from "../utils/spectrum";

type PollingLegendProps = {
  viewMode: PollingViewMode;
  thresholds: number[];
  bandCounts: number[];
  missingIndexCount: number;
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
  thresholds,
  bandCounts,
  missingIndexCount,
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

  return (
    <section
      className="electorate-legend"
      aria-label={`Legenda: índice ideológico por ${unitLabel}`}
    >
      <div className="legend-title">
        <School size={16} />
        <span>Locais de votação · índice 0–10</span>
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
          const label = `${getSpectrumBandLabel(band)} · ${getSpectrumRangeLabel("index", thresholds, band)}`;
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
                style={{ backgroundColor: SPECTRUM_COLORS[band] }}
              />
              <span>{label}</span>
              <small>{bandCounts[band]}</small>
            </button>
          );
        })}
        {missingIndexCount > 0 && (
          <div className="legend-item legend-item--missing">
            <span
              className="legend-swatch"
              style={{ backgroundColor: MISSING_DATA_COLOR }}
            />
            <span>Sem índice neste pleito</span>
            <small>{missingIndexCount}</small>
          </div>
        )}
      </div>

      <small>
        {formatInteger(bubbleCount)} bolhas ({unitLabel}) · área proporcional ao
        eleitorado · onda {waveYear} do survey
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
