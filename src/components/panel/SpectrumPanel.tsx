import {
  ArrowDown,
  ArrowUp,
  ExternalLink,
  GitCompareArrows,
  MapPin,
  RotateCcw,
  Scale,
  ShieldAlert,
  SlidersHorizontal,
  TriangleAlert,
} from "lucide-react";
import { useState } from "react";
import type { AnalysisBand, AnalysisSortDirection } from "../../types/analysis";
import type {
  PartySpectrumRegistry,
  SpectrumBandMode,
  SpectrumMetricId,
  SpectrumModel,
  SpectrumSourceContest,
  SpectrumState,
} from "../../types/spectrum";
import { ALL_ANALYSIS_BANDS } from "../../utils/analysis";
import { downloadTextFile } from "../../utils/browser";
import {
  buildSpectrumMapExport,
  exportMapAsPng,
  renderMapExportCanvas,
  type MapExportShape,
} from "../../utils/mapExport";
import { canvasToReportImage } from "../../utils/chartImage";
import { useReportExport, type ReportFormat } from "../../hooks/useReportExport";
import { buildSpectrumReport } from "../../utils/reportLayers";
import { ExportActions } from "./ExportActions";
import {
  formatDecimal,
  formatInteger,
  formatPercent,
} from "../../utils/electorate";
import {
  createSpectrumCsv,
  describeSpectrumIndex,
  describeSpectrumShift,
  formatSpectrumValue,
  getSpectrumBandLabel,
  getSpectrumContestLabel,
  getSpectrumCsvFilename,
  getSpectrumMetricColors,
  getSpectrumRangeLabel,
  getSpectrumShiftBandLabel,
  SPECTRUM_BLOCK_LABELS,
  SPECTRUM_BLOCKS,
  SPECTRUM_METRICS,
} from "../../utils/spectrum";

type SpectrumPanelProps = {
  contests: SpectrumSourceContest[];
  registry: PartySpectrumRegistry;
  model: SpectrumModel;
  state: SpectrumState;
  /** geometrias do map.data; null enquanto o mapa não carregou */
  mapShapes: MapExportShape[] | null;
  selectedMunicipalityId: string | null;
  onContestChange: (contestId: string) => void;
  onComparisonContestChange: (contestId: string | null) => void;
  onMetricChange: (metricId: SpectrumMetricId) => void;
  onBandModeChange: (bandMode: SpectrumBandMode) => void;
  onToggleBand: (band: AnalysisBand) => void;
  onShowAllBands: () => void;
  onSortChange: (direction: AnalysisSortDirection) => void;
  onReset: () => void;
  onSelect: (id: string) => void;
};

const INITIAL_RANKING_SIZE = 10;
const INITIAL_UNSCORED_SIZE = 6;

export function SpectrumPanel({
  contests,
  registry,
  model,
  state,
  mapShapes,
  selectedMunicipalityId,
  onContestChange,
  onComparisonContestChange,
  onMetricChange,
  onBandModeChange,
  onToggleBand,
  onShowAllBands,
  onSortChange,
  onReset,
  onSelect,
}: SpectrumPanelProps) {
  const [showAllRanking, setShowAllRanking] = useState(false);
  const [showAllUnscored, setShowAllUnscored] = useState(false);
  const [exportMessage, setExportMessage] = useState("");

  // A seleção crua continua visível quando o modelo cai para o índice (métrica
  // efetiva sem comparação), como elections faz com o swing.
  const metric = SPECTRUM_METRICS.find((item) => item.id === state.metricId);
  const allBandsActive = state.activeBands.length === ALL_ANALYSIS_BANDS.length;
  const visibleRanking = showAllRanking
    ? model.filteredItems
    : model.filteredItems.slice(0, INITIAL_RANKING_SIZE);
  const visibleUnscored = showAllUnscored
    ? model.unscoredParties
    : model.unscoredParties.slice(0, INITIAL_UNSCORED_SIZE);
  const range = model.focusedMaximum - model.focusedMinimum;
  const selectedItem = selectedMunicipalityId
    ? model.allItems.find(
        (item) => item.municipality.ibgeCode === selectedMunicipalityId,
      )
    : undefined;
  const unscoredVotes = model.stateTotalVotes - model.stateScoredVotes;
  const comparisonContest = model.comparisonContest;
  const comparisonOptions = contests.filter(
    (contest) => contest.id !== model.contest.id,
  );
  const shiftRequested = state.metricId === "shift";
  const shiftActive = model.metricId === "shift" && comparisonContest !== null;
  const wavesDiffer =
    comparisonContest !== null &&
    model.comparisonWave !== null &&
    model.comparisonWave.year !== model.wave.year;
  const officesDiffer =
    comparisonContest !== null &&
    comparisonContest.officeCode !== model.contest.officeCode;
  const contestLabel = getSpectrumContestLabel(model.contest);
  const comparisonLabel = comparisonContest
    ? getSpectrumContestLabel(comparisonContest)
    : "";
  const metricColors = getSpectrumMetricColors(model.metricId);

  const handleExport = () => {
    if (model.filteredItems.length === 0) return;

    downloadTextFile(
      createSpectrumCsv(model),
      getSpectrumCsvFilename(model),
      "text/csv;charset=utf-8",
    );
    setExportMessage(
      `${formatInteger(model.filteredItems.length)} municípios exportados.`,
    );
  };

  const canExportImage = mapShapes !== null && mapShapes.length > 0;
  const handleImageExport = () => {
    if (!mapShapes || mapShapes.length === 0) return;
    void exportMapAsPng(mapShapes, buildSpectrumMapExport(model)).then(
      (exported) =>
        setExportMessage(
          exported
            ? "Imagem do mapa exportada em PNG."
            : "Não foi possível gerar a imagem do mapa.",
        ),
    );
  };

  /* O desenho do PNG do mapa, reaproveitado como figura do relatório. Só o PDF
     embute imagem; a planilha é para trabalhar os números. */
  const imagensDoMapa = (formato: ReportFormat) => {
    if (formato !== "pdf" || !mapShapes || mapShapes.length === 0) return [];
    const exportData = buildSpectrumMapExport(model);
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
      buildSpectrumReport({
        model,
        generatedAt: new Date(),
        images: imagensDoMapa(formato),
      }),
    setExportMessage,
  );

  return (
    <div className="sidebar-view" role="tabpanel" id="sidebar-spectrum-panel">
      <div className="workspace-view-header">
        <div>
          <span className="panel-eyebrow">Descrição de resultado apurado</span>
          <h2>Espectro ideológico</h2>
        </div>
        <button
          className="workspace-clear-button analysis-reset-button"
          type="button"
          onClick={onReset}
          aria-label="Restaurar espectro padrão"
          title="Restaurar espectro padrão"
        >
          <RotateCcw size={16} />
        </button>
      </div>

      <p className="workspace-description">
        Cada partido votado recebe uma nota de 0 (extrema esquerda) a 10
        (extrema direita) atribuída por especialistas. O índice do município é a
        média dessas notas, ponderada pelos votos que cada partido recebeu ali.
      </p>

      <label className="analysis-metric-control">
        <span>
          <Scale size={15} />
          Pleito analisado
        </span>
        <select
          value={model.contest.id}
          onChange={(event) => {
            onContestChange(event.target.value);
            setShowAllRanking(false);
            setShowAllUnscored(false);
          }}
        >
          {contests.map((contest) => (
            <option value={contest.id} key={contest.id}>
              {getSpectrumContestLabel(contest)}
            </option>
          ))}
        </select>
        <small>
          Onda {model.wave.year} do survey ·{" "}
          {formatInteger(model.wave.respondents)} respondentes ·{" "}
          {model.wave.institution}
        </small>
      </label>

      <section
        className="election-comparison-box"
        aria-label="Pleito de comparação do deslocamento"
      >
        <div>
          <GitCompareArrows size={14} />
          <strong>Comparar com</strong>
        </div>
        <select
          value={comparisonContest?.id ?? ""}
          onChange={(event) => {
            onComparisonContestChange(event.target.value || null);
            setShowAllRanking(false);
          }}
        >
          <option value="">Sem comparação</option>
          {comparisonOptions.map((contest) => (
            <option value={contest.id} key={contest.id}>
              {getSpectrumContestLabel(contest)}
            </option>
          ))}
        </select>
        {shiftRequested && !comparisonContest ? (
          <small role="status">
            Escolha um pleito de comparação para ver o deslocamento. Até lá, o
            mapa mostra o índice ideológico do pleito analisado.
          </small>
        ) : comparisonContest ? (
          <small>
            Deslocamento = índice de {contestLabel} menos índice de{" "}
            {comparisonLabel}, em pontos da escala 0–10. Positivo = moveu para a
            direita.
          </small>
        ) : (
          <small>
            Com um pleito de comparação, o indicador “Deslocamento do índice”
            mostra quanto cada município se moveu na escala 0–10.
          </small>
        )}
        {wavesDiffer && (
          <small className="registration-metric-help" role="note">
            <TriangleAlert size={12} /> Ondas diferentes do survey (
            {model.comparisonWave?.year} vs {model.wave.year}): parte do
            deslocamento vem da reavaliação dos partidos pelos especialistas,
            não do eleitorado. Leia como tendência, não como medida exata.
          </small>
        )}
        {officesDiffer && (
          <small className="registration-metric-help" role="note">
            <TriangleAlert size={12} /> Cargos diferentes; leia como mudança de
            contexto, não de eleitorado.
          </small>
        )}
      </section>

      <label className="analysis-metric-control">
        <span>
          <SlidersHorizontal size={15} />
          Indicador do mapa
        </span>
        <select
          value={state.metricId}
          onChange={(event) => {
            onMetricChange(event.target.value as SpectrumMetricId);
            setShowAllRanking(false);
          }}
        >
          {SPECTRUM_METRICS.map((item) => (
            <option value={item.id} key={item.id}>
              {item.label}
            </option>
          ))}
        </select>
        {metric && <small>{metric.description}</small>}
      </label>

      <div
        className="registration-filter-grid spectrum-band-mode"
        role="group"
        aria-label="Modo das faixas do mapa"
      >
        {(
          [
            { id: "absolute", label: "Faixas absolutas" },
            { id: "quantile", label: "Quintis do recorte" },
          ] as Array<{ id: SpectrumBandMode; label: string }>
        ).map((option) => (
          <button
            type="button"
            key={option.id}
            className={
              model.bandMode === option.id ? "registration-filter--active" : ""
            }
            aria-pressed={model.bandMode === option.id}
            onClick={() => onBandModeChange(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <small className="registration-metric-help">
        {model.bandMode === "absolute"
          ? model.metricId === "shift"
            ? "Cortes fixos e simétricos em torno de zero (±0,25 e ±1 ponto): a faixa central lê como estabilidade."
            : "Cortes fixos, ancorados nos limiares de bloco do registro de partidos: comparáveis entre pleitos."
          : "Cortes por quintis dos municípios com valor neste recorte: sempre 5 grupos de tamanho parecido."}
      </small>

      <section className="analysis-summary" aria-label="Resumo estadual">
        <div>
          <span>Índice de Goiás</span>
          <strong>
            {model.stateIndex === null
              ? "Sem índice"
              : formatDecimal(model.stateIndex)}
          </strong>
          <small>escala de 0 a 10</small>
        </div>
        <div>
          <span>Cobertura do índice</span>
          <strong>{formatPercent(model.stateCoveragePct)}</strong>
          <small>
            {formatInteger(model.stateScoredVotes)} de{" "}
            {formatInteger(model.stateTotalVotes)} votos em partidos com nota
          </small>
        </div>
        <div>
          <span>Municípios sem índice</span>
          <strong>{formatInteger(model.missingMunicipalityCount)}</strong>
          <small>de {formatInteger(model.allItems.length)} em Goiás</small>
        </div>
      </section>

      {model.stateIndex !== null && (
        <p className="analysis-note">
          No resultado de {getSpectrumContestLabel(model.contest)}, o eleitorado
          de Goiás {describeSpectrumIndex(model.stateIndex, registry)}.
        </p>
      )}

      {shiftActive && (
        <section
          className="analysis-summary"
          aria-label="Resumo estadual do deslocamento"
        >
          <div>
            <span>Deslocamento de Goiás</span>
            <strong>
              {model.stateShift === null
                ? "Sem deslocamento"
                : formatSpectrumValue("shift", model.stateShift)}
            </strong>
            <small>pontos na escala 0–10</small>
          </div>
          <div>
            <span>Índice comparado</span>
            <strong>
              {model.stateComparisonIndex === null
                ? "Sem índice"
                : formatDecimal(model.stateComparisonIndex)}
            </strong>
            <small>{comparisonLabel}</small>
          </div>
          <div>
            <span>Sem deslocamento</span>
            <strong>{formatInteger(model.missingMunicipalityCount)}</strong>
            <small>municípios sem índice em um dos dois pleitos</small>
          </div>
        </section>
      )}

      {shiftActive && model.stateShift !== null && (
        <p className="analysis-note">
          No agregado, o eleitorado de Goiás{" "}
          {describeSpectrumShift(model.stateShift, comparisonLabel, contestLabel)}.
        </p>
      )}

      <section className="insight-section" aria-label="Blocos em Goiás">
        <div className="section-heading-inline">
          <Scale size={14} />
          <strong>Participação dos blocos em Goiás</strong>
        </div>
        <div className="insight-list">
          {SPECTRUM_BLOCKS.map((block) => (
            <div key={block}>
              <span>{SPECTRUM_BLOCK_LABELS[block]}</span>
              <strong>{formatPercent(model.stateBlockSharePct[block])}</strong>
            </div>
          ))}
        </div>
        <small className="registration-metric-help">
          Percentuais sobre os votos com nota. Blocos definidos pelos limiares do
          registro: até {formatDecimal(registry.metadata.blockThresholds.leftMaximum)}{" "}
          é esquerda, a partir de{" "}
          {formatDecimal(registry.metadata.blockThresholds.rightMinimum)} é
          direita.
        </small>
      </section>

      {selectedItem && (
        <section
          className="election-selected-card"
          aria-label="Espectro do município selecionado"
        >
          <div>
            <MapPin size={15} />
            <span>Município selecionado</span>
          </div>
          <strong>{selectedItem.municipality.name}</strong>
          {selectedItem.index === null ? (
            <small>
              Nenhum voto deste município caiu em partido com nota na onda{" "}
              {model.wave.year}. O município fica sem índice, fora do ranking e
              das faixas — nunca contado como zero.
            </small>
          ) : (
            <>
              <small>
                No resultado de {getSpectrumContestLabel(model.contest)}, o
                eleitorado deste município{" "}
                {describeSpectrumIndex(selectedItem.index, registry)}.
              </small>
              <dl>
                <div>
                  <dt>Índice</dt>
                  <dd>{formatDecimal(selectedItem.index)}</dd>
                </div>
                <div>
                  <dt>Posição em Goiás</dt>
                  <dd>{selectedItem.rank > 0 ? `#${selectedItem.rank}` : "—"}</dd>
                </div>
                <div>
                  <dt>Esquerda</dt>
                  <dd>{formatPercent(selectedItem.blockSharePct.left)}</dd>
                </div>
                <div>
                  <dt>Centro</dt>
                  <dd>{formatPercent(selectedItem.blockSharePct.center)}</dd>
                </div>
                <div>
                  <dt>Direita</dt>
                  <dd>{formatPercent(selectedItem.blockSharePct.right)}</dd>
                </div>
                <div>
                  <dt>Cobertura</dt>
                  <dd>{formatPercent(selectedItem.coveragePct)}</dd>
                </div>
              </dl>
              {shiftActive && selectedItem.shift !== null && (
                <small>
                  Este município{" "}
                  {describeSpectrumShift(
                    selectedItem.shift,
                    comparisonLabel,
                    contestLabel,
                  )}
                  {selectedItem.comparisonIndex === null
                    ? ""
                    : ` (índice ${formatDecimal(selectedItem.comparisonIndex)} → ${formatDecimal(selectedItem.index ?? 0)})`}
                  .
                </small>
              )}
              {shiftActive && selectedItem.shift === null && (
                <small>
                  Sem deslocamento calculável: o município não tem índice em um
                  dos dois pleitos comparados — ele fica cinza no mapa, fora do
                  ranking e das faixas, nunca contado como zero.
                </small>
              )}
              <small>
                Posição em ordem decrescente de {model.metricShortLabel}, entre
                os{" "}
                {formatInteger(
                  model.allItems.length - model.missingMunicipalityCount,
                )}{" "}
                municípios com valor neste pleito.
              </small>
            </>
          )}
        </section>
      )}

      <section className="analysis-filter-section">
        <div className="analysis-section-heading">
          <span>
            <SlidersHorizontal size={14} /> Faixas em foco
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
                onClick={() => onToggleBand(band)}
              >
                <span
                  className="analysis-band-swatch"
                  style={{ backgroundColor: metricColors[band] }}
                />
                <span className="analysis-band-copy">
                  <strong>
                    {model.metricId === "index"
                      ? getSpectrumBandLabel(band)
                      : model.metricId === "shift"
                        ? getSpectrumShiftBandLabel(band)
                        : `Faixa ${band + 1}`}
                  </strong>
                  <small>
                    {getSpectrumRangeLabel(model.metricId, model.thresholds, band)}
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
            <span>Ranking municipal</span>
            <small>{model.metricShortLabel}</small>
          </div>
          <div className="analysis-sort" aria-label="Ordem do ranking">
            <button
              type="button"
              className={state.sortDirection === "desc" ? "analysis-sort--active" : ""}
              onClick={() => onSortChange("desc")}
            >
              <ArrowDown size={14} /> Maiores
            </button>
            <button
              type="button"
              className={state.sortDirection === "asc" ? "analysis-sort--active" : ""}
              onClick={() => onSortChange("asc")}
            >
              <ArrowUp size={14} /> Menores
            </button>
          </div>
        </div>
        {model.filteredItems.length === 0 ? (
          <div className="analysis-ranking-empty">
            <span>Nenhum município no recorte atual.</span>
            <button type="button" onClick={onShowAllBands}>
              Mostrar todas as faixas
            </button>
          </div>
        ) : (
          <div className="analysis-ranking-list">
            {visibleRanking.map((item) => {
              const value = item.value ?? 0;
              const normalized =
                range === 0 ? 100 : ((value - model.focusedMinimum) / range) * 100;
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
                      <em>{formatSpectrumValue(model.metricId, value)}</em>
                    </span>
                    <span className="analysis-rank-track" aria-hidden="true">
                      <span
                        style={{
                          width: `${Math.max(7, normalized)}%`,
                          backgroundColor: metricColors[item.band],
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
        csvLabel="Arquivo .csv com o índice, os blocos e a cobertura de cada município, para cruzar em outra ferramenta"
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

      {model.unscoredParties.length > 0 && (
        <section className="insight-section" aria-label="Votos fora do índice">
          <div className="section-heading-inline">
            <TriangleAlert size={14} />
            <strong>Votos fora do índice</strong>
          </div>
          <small className="registration-metric-help">
            {formatInteger(unscoredVotes)} dos{" "}
            {formatInteger(model.stateTotalVotes)} votos do pleito foram para{" "}
            {model.unscoredParties.length}{" "}
            {model.unscoredParties.length === 1 ? "sigla" : "siglas"} sem nota na
            onda {model.wave.year} — a cobertura do índice fica em{" "}
            {formatPercent(model.stateCoveragePct)}. Esses votos ficam fora do
            numerador e do denominador, nunca contados como zero.
          </small>
          <div className="insight-list">
            {visibleUnscored.map((party) => (
              <div key={party.code}>
                <span>{party.code}</span>
                <strong>
                  {formatInteger(party.votes)} votos ·{" "}
                  {formatPercent(party.stateSharePct)}
                </strong>
              </div>
            ))}
          </div>
          {model.unscoredParties.length > INITIAL_UNSCORED_SIZE && (
            <button
              className="analysis-ranking-toggle"
              type="button"
              onClick={() => setShowAllUnscored((current) => !current)}
            >
              {showAllUnscored
                ? `Mostrar somente as ${INITIAL_UNSCORED_SIZE} primeiras`
                : `Ver as ${model.unscoredParties.length} siglas`}
            </button>
          )}
        </section>
      )}

      <section className="insight-section" aria-label="Limites desta leitura">
        <div className="section-heading-inline">
          <ShieldAlert size={14} />
          <strong>Limites desta leitura</strong>
        </div>
        <div className="insight-list">
          {registry.metadata.limitations.map((limitation) => (
            <div key={limitation}>
              <strong>{limitation}</strong>
            </div>
          ))}
        </div>
        <small className="registration-metric-help">
          Onda aplicada a este pleito: {model.wave.year} ·{" "}
          {formatInteger(model.wave.respondents)} respondentes ·{" "}
          {model.wave.institution}.
        </small>
        <small className="registration-metric-help">
          {model.wave.citation}
        </small>
      </section>

      <a
        className="analysis-source"
        href={model.wave.url}
        target="_blank"
        rel="noreferrer"
      >
        <span>Artigo da onda {model.wave.year} do survey</span>
        <strong>DOI {model.wave.doi}</strong>
        <ExternalLink size={13} />
      </a>

      <p className="comparison-note analysis-note">
        O índice descreve como os votos já apurados se distribuíram entre
        partidos com nota. Não é intenção de voto, projeção nem pesquisa
        eleitoral, e não mede a posição de eleitores individuais.
      </p>
    </div>
  );
}
