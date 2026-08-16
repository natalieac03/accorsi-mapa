import { BarChart3, RotateCcw } from "lucide-react";
import type { AnalysisBand, AnalysisMetricId } from "../types/analysis";
import {
  ALL_ANALYSIS_BANDS,
  getAnalysisRangeLabel,
} from "../utils/analysis";
import { ELECTORATE_COLORS, MISSING_DATA_COLOR } from "../utils/electorate";

type ElectorateLegendProps = {
  metricId: AnalysisMetricId;
  metricLabel: string;
  thresholds: number[];
  bandCounts: number[];
  source: "TSE" | "IBGE";
  referenceYear: number;
  missingMunicipalityCount: number;
  activeBands: AnalysisBand[];
  onToggleBand: (band: AnalysisBand) => void;
  onShowAllBands: () => void;
};

export function ElectorateLegend({
  metricId,
  metricLabel,
  thresholds,
  bandCounts,
  source,
  referenceYear,
  missingMunicipalityCount,
  activeBands,
  onToggleBand,
  onShowAllBands,
}: ElectorateLegendProps) {
  const allBandsActive = activeBands.length === ALL_ANALYSIS_BANDS.length;

  return (
    <section className="electorate-legend" aria-label={`Legenda: ${metricLabel}`}>
      <div className="legend-title">
        <BarChart3 size={16} />
        <span>{metricLabel}</span>
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
          return (
            <button
              className={`legend-item ${active ? "legend-item--active" : ""}`}
              type="button"
              key={band}
              aria-pressed={active}
              onClick={() => onToggleBand(band)}
            >
              <span
                className="legend-swatch"
                style={{ backgroundColor: ELECTORATE_COLORS[band] }}
              />
              <span>{getAnalysisRangeLabel(metricId, thresholds, band)}</span>
              <small>{bandCounts[band]}</small>
            </button>
          );
        })}
        {missingMunicipalityCount > 0 && (
          <div className="legend-item legend-item--missing">
            <span
              className="legend-swatch"
              style={{ backgroundColor: MISSING_DATA_COLOR }}
            />
            <span>Sem dado neste ano</span>
            <small>{missingMunicipalityCount}</small>
          </div>
        )}
      </div>

      <small>
        Faixas por quintis · {source} {referenceYear}
      </small>
    </section>
  );
}
