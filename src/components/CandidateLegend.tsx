import { RotateCcw, TrendingUp } from "lucide-react";
import type { AnalysisBand } from "../types/analysis";
import type { CandidateLayerModel } from "../types/candidate";
import { ALL_ANALYSIS_BANDS } from "../utils/analysis";
import { formatRankingValue } from "../utils/candidate";
import {
  CANDIDATE_LAYER_COLORS,
  getCandidateLayerRangeLabel,
} from "../utils/candidateLayer";
import { formatInteger, MISSING_DATA_COLOR } from "../utils/electorate";

type CandidateLegendProps = {
  model: CandidateLayerModel;
  onToggleBand: (band: AnalysisBand) => void;
  onShowAllBands: () => void;
};

/**
 * Legenda da camada do desempenho dela. Duas leituras, decididas pelo dado e
 * não pelo cargo: com distribuição, cinco faixas por quintil; com um valor só
 * (caso do pleito municipal), uma faixa e a frase que explica o mapa cinza,
 * sem a qual ele parece defeito.
 */
export function CandidateLegend({
  model,
  onToggleBand,
  onShowAllBands,
}: CandidateLegendProps) {
  const allBandsActive =
    model.activeBands.length === ALL_ANALYSIS_BANDS.length;
  const cidade = model.escopoMunicipal;
  /* Sem escala por quantil existe no máximo UM município com valor. A regra é
     do dado, não do cargo: pleito estadual com um só denominador cai aqui. */
  const unicoItem = model.escalaPorQuantil
    ? null
    : model.allItems.find((item) => item.value !== null) ?? null;

  return (
    <section
      className="electorate-legend"
      aria-label={`Legenda: ${model.contest.candidatura.nomeUrna} · ${model.metric.label}`}
    >
      <div className="legend-title">
        <TrendingUp size={16} />
        <span>
          {model.contest.candidatura.nomeUrna} · {model.metric.shortLabel}
        </span>
        {model.escalaPorQuantil && !allBandsActive && (
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
        {model.escalaPorQuantil
          ? ALL_ANALYSIS_BANDS.map((band) => {
              const active = model.activeBands.includes(band);
              const label = getCandidateLayerRangeLabel(
                model.metricId,
                model.thresholds,
                band,
              );
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
                    style={{ backgroundColor: CANDIDATE_LAYER_COLORS[band] }}
                  />
                  <span>{label}</span>
                  <small>{model.bandCounts[band]}</small>
                </button>
              );
            })
          : unicoItem && (
              /* Um valor só: sem faixa por quintil, mostra o município medido. */
              <div className="legend-item legend-item--active">
                <span
                  className="legend-swatch"
                  style={{ backgroundColor: CANDIDATE_LAYER_COLORS[2] }}
                />
                <span>
                  {unicoItem.nome} ·{" "}
                  {formatRankingValue(
                    model.metricId,
                    unicoItem.value as number,
                  )}
                </span>
                <small>1</small>
              </div>
            )}

        {model.foraDaDisputaCount > 0 && (
          <div className="legend-item legend-item--missing">
            <span
              className="legend-swatch"
              style={{ backgroundColor: MISSING_DATA_COLOR }}
            />
            <span>Fora da disputa (ela não era candidata aqui)</span>
            <small>{model.foraDaDisputaCount}</small>
          </div>
        )}
        {model.semDenominadorCount > 0 && (
          <div className="legend-item legend-item--missing">
            <span
              className="legend-swatch"
              style={{ backgroundColor: MISSING_DATA_COLOR }}
            />
            <span>
              {model.metricId === "votosPorMilEleitores"
                ? "Sem eleitorado apurado (sem taxa)"
                : "Sem denominador apurado nesta métrica"}
            </span>
            <small>{model.semDenominadorCount}</small>
          </div>
        )}
      </div>

      <small>
        {model.contest.electionYear} · {model.officeLabel} ·{" "}
        {model.escalaPorQuantil
          ? `faixas por quintis dos ${formatInteger(model.medidosCount)} municípios com valor`
          : cidade
            ? `pleito municipal: a disputa aconteceu só em ${cidade.nome}, e os demais municípios ficam cinza porque ela não estava na urna deles — não porque tiveram zero voto`
            : `${formatInteger(model.medidosCount)} município(s) com valor nesta métrica: sem distribuição, não há faixas por quintil para desenhar`}
        {model.denominadorNota ? ` · ${model.denominadorNota}` : ""}
        {model.eleitoradoPendente && model.metricId === "votos"
          ? " · votos por 1.000 eleitores exige o snapshot do eleitorado (ainda pendente)"
          : ""}
      </small>
    </section>
  );
}
