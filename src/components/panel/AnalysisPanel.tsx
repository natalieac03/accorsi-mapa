import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  ExternalLink,
  MapPin,
  RotateCcw,
  SlidersHorizontal,
} from "lucide-react";
import { useState } from "react";
import type {
  AnalysisBand,
  AnalysisMetricId,
  AnalysisModel,
  AnalysisSortDirection,
  AnalysisState,
} from "../../types/analysis";
import {
  ALL_ANALYSIS_BANDS,
  createAnalysisCsv,
  ELECTORAL_ANALYSIS_METRICS,
  formatAnalysisMetricValue,
  getAnalysisCsvFilename,
  getAnalysisRangeLabel,
  SOCIOECONOMIC_ANALYSIS_METRICS,
} from "../../utils/analysis";
import { ELECTORATE_COLORS, formatInteger, formatPercent } from "../../utils/electorate";
import { downloadTextFile } from "../../utils/browser";
import {
  buildAnalysisMapExport,
  exportMapAsPng,
  renderMapExportCanvas,
  type MapExportShape,
} from "../../utils/mapExport";
import { canvasToReportImage } from "../../utils/chartImage";
import { useReportExport, type ReportFormat } from "../../hooks/useReportExport";
import { buildAnalysisReport } from "../../utils/reportLayers";
import { ExportActions } from "./ExportActions";

type AnalysisPanelProps = {
  model: AnalysisModel;
  state: AnalysisState;
  /** geometrias do map.data; null enquanto o mapa não carregou */
  mapShapes: MapExportShape[] | null;
  municipalityCount: number;
  onMetricChange: (metricId: AnalysisMetricId) => void;
  onToggleBand: (band: AnalysisBand) => void;
  onShowAllBands: () => void;
  onSortChange: (direction: AnalysisSortDirection) => void;
  onReset: () => void;
  onSelect: (id: string) => void;
};

const INITIAL_RANKING_SIZE = 10;

export function AnalysisPanel({
  model,
  state,
  mapShapes,
  municipalityCount,
  onMetricChange,
  onToggleBand,
  onShowAllBands,
  onSortChange,
  onReset,
  onSelect,
}: AnalysisPanelProps) {
  const [showAllRanking, setShowAllRanking] = useState(false);
  const [exportMessage, setExportMessage] = useState("");
  const allBandsActive = state.activeBands.length === ALL_ANALYSIS_BANDS.length;
  const visibleRanking = showAllRanking
    ? model.filteredItems
    : model.filteredItems.slice(0, INITIAL_RANKING_SIZE);
  const range = model.focusedMaximum - model.focusedMinimum;

  const handleExport = () => {
    if (model.filteredItems.length === 0) return;

    downloadTextFile(
      createAnalysisCsv(model),
      getAnalysisCsvFilename(state.metricId),
      "text/csv;charset=utf-8",
    );
    setExportMessage(
      `${formatInteger(model.filteredItems.length)} municípios exportados.`,
    );
  };

  const canExportImage = mapShapes !== null && mapShapes.length > 0;
  const handleImageExport = () => {
    if (!mapShapes || mapShapes.length === 0) return;
    void exportMapAsPng(mapShapes, buildAnalysisMapExport(model)).then(
      (exported) =>
        setExportMessage(
          exported
            ? "Imagem do mapa exportada em PNG."
            : "Não foi possível gerar a imagem do mapa.",
        ),
    );
  };

  /* O mesmo desenho do PNG do mapa, reaproveitado como figura do relatório —
     sem o mapa, o PDF perderia justamente o que se olha primeiro na reunião.
     Só o PDF embute imagem; a planilha é para trabalhar os números. */
  const imagensDoMapa = (formato: ReportFormat) => {
    if (formato !== "pdf" || !mapShapes || mapShapes.length === 0) return [];
    const exportData = buildAnalysisMapExport(model);
    const canvas = renderMapExportCanvas(mapShapes, exportData);
    const imagem = canvas
      ? canvasToReportImage(canvas, {
          title: "Mapa do recorte",
          caption: `${exportData.title} · ${exportData.subtitle}`,
        })
      : null;
    return imagem ? [imagem] : [];
  };

  const { exportando, exportar } = useReportExport(
    (formato) =>
      buildAnalysisReport({
        model,
        municipalityCount,
        generatedAt: new Date(),
        images: imagensDoMapa(formato),
      }),
    setExportMessage,
  );

  return (
    <div className="sidebar-view" role="tabpanel" id="sidebar-analysis-panel">
      <div className="workspace-view-header">
        <div>
          <span className="panel-eyebrow">Exploração dos dados</span>
          <h2>Análise territorial</h2>
        </div>
        <button
          className="workspace-clear-button analysis-reset-button"
          type="button"
          onClick={onReset}
          aria-label="Restaurar análise padrão"
          title="Restaurar análise padrão"
        >
          <RotateCcw size={16} />
        </button>
      </div>

      <p className="workspace-description">
        Troque a lente do mapa, destaque faixas e abra municípios diretamente
        pelo ranking.
      </p>

      <label className="analysis-metric-control">
        <span>
          <BarChart3 size={15} />
          Indicador do mapa
        </span>
        <select
          value={state.metricId}
          onChange={(event) => {
            onMetricChange(event.target.value as AnalysisMetricId);
            setShowAllRanking(false);
          }}
        >
          <optgroup label="TSE · Eleitorado 2026">
            {ELECTORAL_ANALYSIS_METRICS.map((metric) => (
              <option value={metric.id} key={metric.id}>
                {metric.label}
              </option>
            ))}
          </optgroup>
          <optgroup label="IBGE · População e socioeconomia">
            {SOCIOECONOMIC_ANALYSIS_METRICS.map((metric) => (
              <option value={metric.id} key={metric.id}>
                {metric.label} ({metric.referenceYear})
              </option>
            ))}
          </optgroup>
        </select>
        <small>{model.metric.description}</small>
      </label>

      <a
        className="analysis-source"
        href={model.metric.sourceUrl}
        target="_blank"
        rel="noreferrer"
      >
        <span>
          {model.metric.sourceLabel} · indicador {model.metric.sourceIndicatorId}
        </span>
        <strong>Ano {model.metric.referenceYear}</strong>
        <ExternalLink size={13} />
      </a>

      <section className="analysis-summary" aria-label="Resumo do recorte">
        <div>
          <span>Municípios em foco</span>
          <strong>
            {formatInteger(model.filteredItems.length)} / {model.allItems.length}
          </strong>
        </div>
        <div>
          <span>Eleitorado reunido</span>
          <strong>{formatInteger(model.focusedElectorate)}</strong>
          <small>{formatPercent(model.focusedElectoratePct)} de Goiás</small>
        </div>
        <div>
          <span>Mediana estadual</span>
          <strong>
            {formatAnalysisMetricValue(state.metricId, model.median)}
          </strong>
        </div>
      </section>

      {model.missingMunicipalityCount > 0 && (
        <p className="analysis-missing-note" role="note">
          {model.missingMunicipalityCount} de {municipalityCount} municípios não
          possuem valor oficial para este indicador e aparecem em cinza.
        </p>
      )}

      <section className="analysis-filter-section">
        <div className="analysis-section-heading">
          <span>
            <SlidersHorizontal size={14} />
            Faixas em foco
          </span>
          {!allBandsActive && (
            <button type="button" onClick={onShowAllBands}>
              Mostrar todas
            </button>
          )}
        </div>

        <div className="analysis-band-list">
          {ALL_ANALYSIS_BANDS.map((band) => {
            const active = state.activeBands.includes(band);
            return (
              <button
                className={active ? "analysis-band--active" : ""}
                type="button"
                key={band}
                aria-pressed={active}
                onClick={() => {
                  onToggleBand(band);
                  setShowAllRanking(false);
                }}
              >
                <span
                  className="analysis-band-swatch"
                  style={{ backgroundColor: ELECTORATE_COLORS[band] }}
                />
                <span className="analysis-band-copy">
                  <strong>Faixa {band + 1}</strong>
                  <small>
                    {getAnalysisRangeLabel(
                      state.metricId,
                      model.thresholds,
                      band,
                    )}
                  </small>
                </span>
                <em>{model.bandCounts[band]}</em>
              </button>
            );
          })}
        </div>
      </section>

      <section className="analysis-ranking-section">
        <div className="analysis-ranking-header">
          <div>
            <span>Ranking no recorte</span>
            <small>{model.metric.shortLabel}</small>
          </div>
          <div className="analysis-sort" aria-label="Ordem do ranking">
            <button
              type="button"
              className={state.sortDirection === "desc" ? "analysis-sort--active" : ""}
              aria-pressed={state.sortDirection === "desc"}
              onClick={() => onSortChange("desc")}
              title="Maiores primeiro"
            >
              <ArrowDown size={14} />
              Maiores
            </button>
            <button
              type="button"
              className={state.sortDirection === "asc" ? "analysis-sort--active" : ""}
              aria-pressed={state.sortDirection === "asc"}
              onClick={() => onSortChange("asc")}
              title="Menores primeiro"
            >
              <ArrowUp size={14} />
              Menores
            </button>
          </div>
        </div>

        {visibleRanking.length === 0 ? (
          <div className="analysis-ranking-empty">
            Nenhum município pertence às faixas selecionadas.
            <button type="button" onClick={onShowAllBands}>
              Mostrar todas as faixas
            </button>
          </div>
        ) : (
          <div className="analysis-ranking-list">
            {visibleRanking.map((item) => {
              const normalized =
                range === 0
                  ? 100
                  : ((item.value - model.focusedMinimum) / range) * 100;
              return (
                <button
                  type="button"
                  key={item.municipality.ibgeCode}
                  onClick={() => onSelect(item.municipality.ibgeCode)}
                >
                  <span className="analysis-rank-number">#{item.rank}</span>
                  <span className="analysis-rank-main">
                    <span>
                      <strong>{item.municipality.name}</strong>
                      <em>
                        {formatAnalysisMetricValue(state.metricId, item.value)}
                      </em>
                    </span>
                    <span className="analysis-rank-track" aria-hidden="true">
                      <span
                        style={{
                          width: `${Math.max(7, normalized)}%`,
                          backgroundColor: ELECTORATE_COLORS[item.band],
                        }}
                      />
                    </span>
                  </span>
                  <MapPin size={14} />
                </button>
              );
            })}
          </div>
        )}

        {model.filteredItems.length > INITIAL_RANKING_SIZE && (
          <button
            className="analysis-ranking-toggle"
            type="button"
            onClick={() => setShowAllRanking((current) => !current)}
          >
            {showAllRanking
              ? "Mostrar somente os 10 primeiros"
              : `Ver todos os ${formatInteger(model.filteredItems.length)}`}
          </button>
        )}
      </section>

      <ExportActions
        exportando={exportando}
        onExport={exportar}
        onCsv={handleExport}
        onImage={handleImageExport}
        csvLabel="Arquivo .csv com todas as colunas técnicas do recorte, para cruzar em outra ferramenta"
        csvDisabled={model.filteredItems.length === 0}
        imageDisabled={!canExportImage}
        imageTitle={
          canExportImage
            ? "Gera um PNG do mapa coroplético atual, com legenda e fonte"
            : "O mapa ainda não carregou: a imagem é desenhada a partir das geometrias da malha exibida"
        }
      />
      <div className="sr-only" role="status" aria-live="polite">
        {exportMessage}
      </div>

      <p className="comparison-note analysis-note">
        Quintis comparam somente municípios com dado no mesmo ano de referência.
        Valores iguais podem ficar na mesma faixa. Cores e ranking não representam
        voto ou desempenho eleitoral.
      </p>
    </div>
  );
}
