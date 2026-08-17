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
  /** nome de urna da candidata; "" fora da medida de voto dela */
  candidateName: string;
  /** true = a medida da candidata está em votos por 1.000 eleitores */
  candidateRate: boolean;
  /** locais dela ausentes do cadastro de locais: contados, nunca calados */
  candidateUnmatchedPlaceCount: number;
  candidateUnmatchedVotes: number;
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
  candidateName,
  candidateRate,
  candidateUnmatchedPlaceCount,
  candidateUnmatchedVotes,
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
  const isCandidate = metric === "votosCandidata";
  const labelOptions = { rate: candidateRate, nome: candidateName || undefined };
  const metricLabel = getPollingMetricShortLabel(metric, partyCode, labelOptions);
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
          // No índice o nome do bloco vem antes do intervalo; no percentual e
          // no voto da candidata o rótulo JÁ é o intervalo e repeti-lo só faria
          // ruído.
          const label =
            isPartyShare || isCandidate
              ? getPollingRangeLabel(metric, thresholds, band, labelOptions)
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
              {isCandidate
                ? "Fora da disputa (ela não era candidata aqui)"
                : isPartyShare
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
        {isCandidate
          ? `votos nominais ${candidateName ? `de ${candidateName}` : "da candidata"}${candidateRate ? " por 1.000 eleitores" : ""}, faixas por quantil do recorte`
          : isPartyShare
            ? "percentual sobre os votos apurados de cada unidade"
            : `onda ${waveYear} do survey`}
        {hiddenBubbleCount > 0
          ? ` · ${formatInteger(hiddenBubbleCount)} bolhas menores fora do desenho (filtre por município para vê-las)`
          : ""}
        {placesWithoutCoordinateCount > 0
          ? ` · ${formatInteger(placesWithoutCoordinateCount)} locais sem coordenada ficam fora do mapa e contam no bairro`
          : ""}
        {/* O TSE renumera locais entre eleições: o que não casou com o cadastro
            é declarado aqui, porque é a medida de confiança deste recorte. */}
        {isCandidate && candidateUnmatchedPlaceCount > 0
          ? ` · ${formatInteger(candidateUnmatchedPlaceCount)} locais com voto dela não existem no cadastro (${formatInteger(candidateUnmatchedVotes)} votos fora do mapa)`
          : ""}
        {viewMode === "neighborhoods"
          ? " · bairro = agregação de locais, não polígono"
          : ""}
      </small>
    </section>
  );
}
