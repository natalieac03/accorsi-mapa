import { RotateCcw, Scale } from "lucide-react";
import type { AnalysisBand } from "../types/analysis";
import type { SpectrumBandMode, SpectrumMetricId } from "../types/spectrum";
import { ALL_ANALYSIS_BANDS } from "../utils/analysis";
import { formatInteger, MISSING_DATA_COLOR } from "../utils/electorate";
import {
  getSpectrumBandLabel,
  getSpectrumMetricColors,
  getSpectrumRangeLabel,
  getSpectrumShiftBandLabel,
} from "../utils/spectrum";

type SpectrumLegendProps = {
  metricId: SpectrumMetricId;
  metricLabel: string;
  thresholds: number[];
  bandCounts: number[];
  missingMunicipalityCount: number;
  activeBands: AnalysisBand[];
  bandMode: SpectrumBandMode;
  waveYear: number;
  waveRespondents: number;
  onToggleBand: (band: AnalysisBand) => void;
  onShowAllBands: () => void;
};

export function SpectrumLegend({
  metricId,
  metricLabel,
  thresholds,
  bandCounts,
  missingMunicipalityCount,
  activeBands,
  bandMode,
  waveYear,
  waveRespondents,
  onToggleBand,
  onShowAllBands,
}: SpectrumLegendProps) {
  const allBandsActive = activeBands.length === ALL_ANALYSIS_BANDS.length;
  const colors = getSpectrumMetricColors(metricId);

  return (
    <section className="electorate-legend" aria-label={`Legenda: ${metricLabel}`}>
      <div className="legend-title">
        <Scale size={16} />
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
          const range = getSpectrumRangeLabel(metricId, thresholds, band);
          const label =
            metricId === "index"
              ? `${getSpectrumBandLabel(band)} · ${range}`
              : metricId === "shift"
                ? `${getSpectrumShiftBandLabel(band)} · ${range}`
                : range;
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
        {missingMunicipalityCount > 0 && (
          <div className="legend-item legend-item--missing">
            <span
              className="legend-swatch"
              style={{ backgroundColor: MISSING_DATA_COLOR }}
            />
            <span>
              {metricId === "shift"
                ? "Sem índice em um dos pleitos"
                : "Sem índice neste pleito"}
            </span>
            <small>{missingMunicipalityCount}</small>
          </div>
        )}
      </div>

      <small>
        Faixas {bandMode === "quantile" ? "por quintis" : "absolutas"} · onda{" "}
        {waveYear} do survey · {formatInteger(waveRespondents)} respondentes
      </small>
    </section>
  );
}
