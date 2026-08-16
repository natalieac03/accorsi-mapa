import { RotateCcw, Vote } from "lucide-react";
import type { AnalysisBand } from "../types/analysis";
import type { ElectionMetricId } from "../types/elections";
import { ALL_ANALYSIS_BANDS } from "../utils/analysis";
import { getElectionRangeLabel } from "../utils/elections";
import { ELECTORATE_COLORS } from "../utils/electorate";

type ElectionLegendProps = {
  metricId: ElectionMetricId;
  metricLabel: string;
  thresholds: number[];
  bandCounts: number[];
  activeBands: AnalysisBand[];
  year: number;
  round: number;
  onToggleBand: (band: AnalysisBand) => void;
  onShowAllBands: () => void;
};

export function ElectionLegend({
  metricId,
  metricLabel,
  thresholds,
  bandCounts,
  activeBands,
  year,
  round,
  onToggleBand,
  onShowAllBands,
}: ElectionLegendProps) {
  const allBandsActive = activeBands.length === ALL_ANALYSIS_BANDS.length;
  return (
    <section className="electorate-legend" aria-label={`Legenda: ${metricLabel}`}>
      <div className="legend-title">
        <Vote size={16} />
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
              <span>{getElectionRangeLabel(metricId, thresholds, band)}</span>
              <small>{bandCounts[band]}</small>
            </button>
          );
        })}
      </div>
      <small>
        Quintis municipais · TSE {year} · {round}º turno
      </small>
    </section>
  );
}
