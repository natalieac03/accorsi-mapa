import {
  ArrowDown,
  ArrowUp,
  Download,
  ExternalLink,
  ImageDown,
  GitCompareArrows,
  MapPin,
  RotateCcw,
  SlidersHorizontal,
  Trophy,
  Vote,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { AnalysisBand, AnalysisSortDirection } from "../../types/analysis";
import type {
  ElectionDataset,
  ElectionMetricId,
  ElectionModel,
  ElectionState,
} from "../../types/elections";
import { ALL_ANALYSIS_BANDS } from "../../utils/analysis";
import { downloadTextFile } from "../../utils/browser";
import {
  buildElectionMapExport,
  exportMapAsPng,
  type MapExportShape,
} from "../../utils/mapExport";
import {
  createElectionCsv,
  ELECTION_METRICS,
  formatElectionMetricValue,
  getComparableContests,
  getElectionCsvFilename,
  getElectionRangeLabel,
} from "../../utils/elections";
import { ELECTORATE_COLORS, formatInteger, formatPercent } from "../../utils/electorate";

type ElectionHistoryPanelProps = {
  dataset: ElectionDataset;
  model: ElectionModel;
  state: ElectionState;
  /** geometrias do map.data; null enquanto o mapa não carregou */
  mapShapes: MapExportShape[] | null;
  selectedMunicipalityId: string | null;
  onContestChange: (contestId: string) => void;
  onCandidateChange: (candidateId: string) => void;
  onMetricChange: (metricId: ElectionMetricId) => void;
  onComparisonContestChange: (contestId: string) => void;
  onComparisonCandidateChange: (candidateId: string) => void;
  onToggleBand: (band: AnalysisBand) => void;
  onShowAllBands: () => void;
  onSortChange: (direction: AnalysisSortDirection) => void;
  onReset: () => void;
  onSelect: (id: string) => void;
};

const INITIAL_RANKING_SIZE = 10;

function contestLabel(year: number, officeName: string, round: number) {
  return `${year} · ${officeName} · ${round}º turno`;
}

function candidateLabel(number: string, name: string, party: string) {
  return `${number} · ${name}${party ? ` (${party})` : ""}`;
}

export function ElectionHistoryPanel({
  dataset,
  model,
  state,
  mapShapes,
  selectedMunicipalityId,
  onContestChange,
  onCandidateChange,
  onMetricChange,
  onComparisonContestChange,
  onComparisonCandidateChange,
  onToggleBand,
  onShowAllBands,
  onSortChange,
  onReset,
  onSelect,
}: ElectionHistoryPanelProps) {
  const [showAllRanking, setShowAllRanking] = useState(false);
  const [showAllCandidates, setShowAllCandidates] = useState(false);
  const [exportMessage, setExportMessage] = useState("");
  const years = useMemo(
    () => Array.from(new Set(dataset.contests.map((item) => item.electionYear))).sort((a, b) => b - a),
    [dataset.contests],
  );
  const offices = useMemo(
    () => Array.from(new Set(dataset.contests.map((item) => item.officeName))),
    [dataset.contests],
  );
  const comparableContests = getComparableContests(dataset, model.contest);
  const comparisonMissing =
    state.metricId === "swing" && !model.comparisonCandidate;
  const selectedItem = selectedMunicipalityId
    ? model.allItems.find(
        (item) => item.municipality.ibgeCode === selectedMunicipalityId,
      )
    : undefined;
  const visibleRanking = showAllRanking
    ? model.filteredItems
    : model.filteredItems.slice(0, INITIAL_RANKING_SIZE);
  const visibleCandidates = showAllCandidates
    ? model.contest.candidates
    : model.contest.candidates.slice(0, 5);
  const allBandsActive = state.activeBands.length === ALL_ANALYSIS_BANDS.length;
  const range = model.focusedMaximum - model.focusedMinimum;

  const findContest = (year: number, officeName: string, round: number) =>
    dataset.contests.find(
      (contest) =>
        contest.electionYear === year &&
        contest.officeName === officeName &&
        contest.round === round,
    ) ??
    dataset.contests.find(
      (contest) =>
        contest.electionYear === year && contest.officeName === officeName,
    ) ??
    dataset.contests.find((contest) => contest.electionYear === year) ??
    model.contest;

  const selectContest = (year: number, officeName: string, round: number) => {
    onContestChange(findContest(year, officeName, round).id);
    setShowAllRanking(false);
    setShowAllCandidates(false);
  };

  const handleExport = () => {
    downloadTextFile(
      createElectionCsv(model),
      getElectionCsvFilename(model),
      "text/csv;charset=utf-8",
    );
    setExportMessage(`${formatInteger(model.filteredItems.length)} municípios exportados.`);
  };

  const canExportImage = mapShapes !== null && mapShapes.length > 0;
  const handleImageExport = () => {
    if (!mapShapes || mapShapes.length === 0) return;
    void exportMapAsPng(mapShapes, buildElectionMapExport(model)).then(
      (exported) =>
        setExportMessage(
          exported
            ? "Imagem do mapa exportada em PNG."
            : "Não foi possível gerar a imagem do mapa.",
        ),
    );
  };

  return (
    <div className="sidebar-view election-view" role="tabpanel" id="sidebar-elections-panel">
      <div className="workspace-view-header">
        <div>
          <span className="panel-eyebrow">Resultados oficiais agregados</span>
          <h2>Histórico de votação</h2>
        </div>
        <button
          className="workspace-clear-button analysis-reset-button"
          type="button"
          onClick={onReset}
          aria-label="Restaurar histórico padrão"
          title="Restaurar histórico padrão"
        >
          <RotateCcw size={16} />
        </button>
      </div>

      {/* Sem anos fixos no texto: a lista vem do próprio snapshot, então citar
          anos aqui envelhece mal a cada eleição nova ou ano removido. */}
      <p className="workspace-description">
        Consulte Presidente e Governador, compare participações municipais e
        abra qualquer território pelo ranking. Eleições municipais (Prefeito e
        Vereador) ficam nas camadas Espectro e Locais.
      </p>

      <div className="election-contest-grid" aria-label="Filtros do pleito">
        <label>
          <span>Ano</span>
          <select
            value={model.contest.electionYear}
            onChange={(event) =>
              selectContest(Number(event.target.value), model.contest.officeName, model.contest.round)
            }
          >
            {years.map((year) => <option key={year}>{year}</option>)}
          </select>
        </label>
        <label>
          <span>Cargo</span>
          <select
            value={model.contest.officeName}
            onChange={(event) =>
              selectContest(model.contest.electionYear, event.target.value, model.contest.round)
            }
          >
            {offices.map((office) => <option key={office}>{office}</option>)}
          </select>
        </label>
        <label>
          <span>Turno</span>
          <select
            value={model.contest.round}
            onChange={(event) =>
              selectContest(model.contest.electionYear, model.contest.officeName, Number(event.target.value))
            }
          >
            {[1, 2].map((round) => <option value={round} key={round}>{round}º</option>)}
          </select>
        </label>
      </div>

      <label className="analysis-metric-control election-candidate-control">
        <span><Vote size={15} /> Candidato exibido no mapa</span>
        <select
          value={model.candidate.id}
          onChange={(event) => {
            onCandidateChange(event.target.value);
            setShowAllRanking(false);
          }}
        >
          {model.contest.candidates.map((candidate) => (
            <option value={candidate.id} key={candidate.id}>
              {candidateLabel(candidate.number, candidate.ballotName, candidate.party)}
            </option>
          ))}
        </select>
        <small>{model.candidate.fullName}</small>
      </label>

      <div className="election-metric-tabs" role="group" aria-label="Métrica do mapa">
        {ELECTION_METRICS.map((metric) => (
          <button
            type="button"
            key={metric.id}
            className={state.metricId === metric.id ? "election-metric--active" : ""}
            aria-pressed={state.metricId === metric.id}
            onClick={() => onMetricChange(metric.id)}
            title={metric.description}
          >
            {metric.id === "share" ? "%" : metric.id === "votes" ? <Vote size={13} /> : <GitCompareArrows size={13} />}
            {metric.id === "share" ? "Participação" : metric.id === "votes" ? "Votos" : "Evolução"}
          </button>
        ))}
      </div>

      {state.metricId === "swing" && (
        <section className="election-comparison-box" aria-label="Série de comparação">
          <div><GitCompareArrows size={14} /><strong>Comparar com</strong></div>
          <select
            value={model.comparisonContest.id}
            onChange={(event) => onComparisonContestChange(event.target.value)}
          >
            {comparableContests.map((contest) => (
              <option value={contest.id} key={contest.id}>
                {contestLabel(contest.electionYear, contest.officeName, contest.round)}
              </option>
            ))}
          </select>
          <select
            value={model.comparisonCandidate?.id ?? ""}
            onChange={(event) => onComparisonCandidateChange(event.target.value)}
          >
            {!model.comparisonCandidate && (
              <option value="" disabled>
                Escolha uma candidatura
              </option>
            )}
            {model.comparisonContest.candidates.map((candidate) => (
              <option value={candidate.id} key={candidate.id}>
                {candidateLabel(candidate.number, candidate.ballotName, candidate.party)}
              </option>
            ))}
          </select>
          {comparisonMissing ? (
            <small role="status">
              Sem candidatura equivalente no pleito comparado. O mapa mostra a
              participação nos votos válidos até você escolher uma candidatura.
            </small>
          ) : (
            <small>
              O mapa mostra participação atual menos participação comparada, em pontos percentuais.
            </small>
          )}
        </section>
      )}

      <a
        className="analysis-source"
        href={dataset.metadata.sourceUrl}
        target="_blank"
        rel="noreferrer"
      >
        <span>TSE · Votação por seção e candidaturas</span>
        <strong>{dataset.metadata.municipalResultCount.toLocaleString("pt-BR")} resultados municipais</strong>
        <ExternalLink size={13} />
      </a>

      <section className="analysis-summary election-summary" aria-label="Resumo da série">
        <div>
          <span>Votos em Goiás</span>
          <strong>{formatInteger(model.stateVotes)}</strong>
          <small>{formatPercent(model.stateSharePct)} dos válidos</small>
        </div>
        <div>
          <span>Liderou em</span>
          <strong>{model.municipalitiesWon}</strong>
          <small>de 246 municípios</small>
        </div>
        <div>
          <span>{model.metricId === "swing" ? "Diferença estadual" : "Melhor participação"}</span>
          <strong>
            {model.metricId === "swing"
              ? formatElectionMetricValue("swing", model.stateSharePct - model.comparisonStateSharePct)
              : formatPercent(model.bestMunicipality.sharePct)}
          </strong>
          <small>{model.metricId === "swing" ? "pontos percentuais" : model.bestMunicipality.municipality.name}</small>
        </div>
      </section>

      {selectedItem && (
        <section className="election-selected-card" aria-label="Resultado do município selecionado">
          <div>
            <MapPin size={15} />
            <span>Município selecionado</span>
          </div>
          <strong>{selectedItem.municipality.name}</strong>
          <dl>
            <div><dt>Votos</dt><dd>{formatInteger(selectedItem.votes)}</dd></div>
            <div><dt>Participação</dt><dd>{formatPercent(selectedItem.sharePct)}</dd></div>
            <div><dt>Posição</dt><dd>#{selectedItem.rank}</dd></div>
            <div><dt>Liderou</dt><dd>{selectedItem.winner ? "Sim" : "Não"}</dd></div>
          </dl>
          {model.metricId === "swing" && (
            <small>
              Comparação: {formatPercent(selectedItem.comparisonSharePct)} · diferença {formatElectionMetricValue("swing", selectedItem.sharePct - selectedItem.comparisonSharePct)}
            </small>
          )}
        </section>
      )}

      <section className="analysis-filter-section">
        <div className="analysis-section-heading">
          <span><SlidersHorizontal size={14} /> Faixas em foco</span>
          {!allBandsActive && <button type="button" onClick={onShowAllBands}>Mostrar todas</button>}
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
                <span className="analysis-band-swatch" style={{ backgroundColor: ELECTORATE_COLORS[band] }} />
                <span className="analysis-band-copy">
                  <strong>Faixa {band + 1}</strong>
                  <small>{getElectionRangeLabel(model.metricId, model.thresholds, band)}</small>
                </span>
                <em>{model.bandCounts[band]}</em>
              </button>
            );
          })}
        </div>
      </section>

      <section className="election-standings">
        <div className="analysis-section-heading">
          <span><Trophy size={14} /> Resultado estadual</span>
          <small>{formatInteger(model.contest.stateValidVotes)} válidos</small>
        </div>
        <div className="election-standings-list">
          {visibleCandidates.map((candidate) => (
            <button
              type="button"
              key={candidate.id}
              className={candidate.id === model.candidate.id ? "election-standing--active" : ""}
              onClick={() => onCandidateChange(candidate.id)}
            >
              <span>#{candidate.stateRank}</span>
              <strong>{candidate.ballotName}<small>{candidate.number} · {candidate.party}</small></strong>
              <em>{formatPercent(candidate.stateSharePct)}<small>{formatInteger(candidate.stateVotes)}</small></em>
            </button>
          ))}
        </div>
        {model.contest.candidates.length > 5 && (
          <button className="analysis-ranking-toggle" type="button" onClick={() => setShowAllCandidates((current) => !current)}>
            {showAllCandidates ? "Mostrar os 5 primeiros" : `Ver os ${model.contest.candidates.length} candidatos`}
          </button>
        )}
      </section>

      <section className="analysis-ranking-section">
        <div className="analysis-ranking-header">
          <div><span>Ranking municipal</span><small>{model.metricShortLabel}</small></div>
          <div className="analysis-sort" aria-label="Ordem do ranking">
            <button type="button" className={state.sortDirection === "desc" ? "analysis-sort--active" : ""} onClick={() => onSortChange("desc")}><ArrowDown size={14} /> Maiores</button>
            <button type="button" className={state.sortDirection === "asc" ? "analysis-sort--active" : ""} onClick={() => onSortChange("asc")}><ArrowUp size={14} /> Menores</button>
          </div>
        </div>
        <div className="analysis-ranking-list">
          {visibleRanking.map((item) => {
            const normalized = range === 0 ? 100 : ((item.value - model.focusedMinimum) / range) * 100;
            return (
              <button type="button" key={item.municipality.ibgeCode} onClick={() => onSelect(item.municipality.ibgeCode)}>
                <span className="analysis-rank-number">#{item.rank}</span>
                <span className="analysis-rank-main">
                  <span><strong>{item.municipality.name}</strong><em>{formatElectionMetricValue(model.metricId, item.value)}</em></span>
                  <span className="analysis-rank-track" aria-hidden="true"><span style={{ width: `${Math.max(7, normalized)}%`, backgroundColor: ELECTORATE_COLORS[item.band] }} /></span>
                </span>
                <MapPin size={14} />
              </button>
            );
          })}
        </div>
        {model.filteredItems.length > INITIAL_RANKING_SIZE && (
          <button className="analysis-ranking-toggle" type="button" onClick={() => setShowAllRanking((current) => !current)}>
            {showAllRanking ? "Mostrar somente os 10 primeiros" : `Ver todos os ${formatInteger(model.filteredItems.length)}`}
          </button>
        )}
      </section>

      <button className="analysis-export-button" type="button" onClick={handleExport}>
        <Download size={16} /> Baixar série municipal em CSV
      </button>
      <button
        className="analysis-export-button"
        type="button"
        onClick={handleImageExport}
        disabled={!canExportImage}
        title={
          canExportImage
            ? "Gera um PNG do mapa coroplético atual, com legenda e fonte"
            : "O mapa ainda não carregou: a imagem é desenhada a partir das geometrias da malha exibida"
        }
      >
        <ImageDown size={16} /> Exportar imagem do mapa
      </button>
      <div className="sr-only" role="status" aria-live="polite">{exportMessage}</div>

      <p className="comparison-note analysis-note">
        Resultados oficiais e agregados. A diferença compara participação entre
        séries; não é projeção, pesquisa ou intenção de voto. Brancos e nulos não
        entram no total de votos válidos.
      </p>
    </div>
  );
}
