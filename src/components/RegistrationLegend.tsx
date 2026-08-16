import { RotateCcw, Users } from "lucide-react";
import type { AnalysisBand } from "../types/analysis";
import type { RegistrationMetricId } from "../types/registrations";
import { ALL_ANALYSIS_BANDS } from "../utils/analysis";
import { ELECTORATE_COLORS, MISSING_DATA_COLOR } from "../utils/electorate";
import { getRegistrationRangeLabel } from "../utils/registrations";

type Props = {
  metricId: RegistrationMetricId;
  metricLabel: string;
  thresholds: number[];
  bandCounts: number[];
  zeroMunicipalityCount: number;
  activeBands: AnalysisBand[];
  privacyThreshold: number;
  onToggleBand: (band: AnalysisBand) => void;
  onShowAllBands: () => void;
};

export function RegistrationLegend({
  metricId,
  metricLabel,
  thresholds,
  bandCounts,
  zeroMunicipalityCount,
  activeBands,
  privacyThreshold,
  onToggleBand,
  onShowAllBands,
}: Props) {
  const allBandsActive = activeBands.length === ALL_ANALYSIS_BANDS.length;
  return (
    <section className="electorate-legend" aria-label={`Legenda: ${metricLabel}`}>
      <div className="legend-title">
        <Users size={16} />
        <span>{metricLabel}</span>
        {!allBandsActive && (
          <button type="button" onClick={onShowAllBands} aria-label="Mostrar todas as faixas">
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
              <span className="legend-swatch" style={{ backgroundColor: ELECTORATE_COLORS[band] }} />
              <span>{getRegistrationRangeLabel(metricId, thresholds, band)}</span>
              <small>{bandCounts[band]}</small>
            </button>
          );
        })}
        <div className="legend-item legend-item--missing">
          <span className="legend-swatch" style={{ backgroundColor: MISSING_DATA_COLOR }} />
          <span>Sem cadastro no recorte</span>
          <small>{zeroMunicipalityCount}</small>
        </div>
      </div>
      <small>Quintis entre municípios com valor · bolhas ≥ {privacyThreshold}</small>
    </section>
  );
}
