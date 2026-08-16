import {
  ArrowDown,
  ArrowUp,
  Building2,
  Download,
  ImageDown,
  LoaderCircle,
  MapPin,
  RotateCcw,
  School,
  ShieldAlert,
  SlidersHorizontal,
  TriangleAlert,
} from "lucide-react";
import { useState } from "react";
import type { AnalysisBand, AnalysisSortDirection } from "../../types/analysis";
import type {
  PollingDataStatus,
  PollingModel,
  PollingPlacesMetadata,
  PollingState,
  PollingViewMode,
} from "../../types/pollingPlaces";
import type {
  PartySpectrumRegistry,
  SpectrumSourceContest,
} from "../../types/spectrum";
import { ALL_ANALYSIS_BANDS } from "../../utils/analysis";
import { downloadTextFile } from "../../utils/browser";
import {
  formatDecimal,
  formatInteger,
  formatPercent,
} from "../../utils/electorate";
import {
  buildPollingMapExport,
  exportMapAsPng,
  type MapExportShape,
} from "../../utils/mapExport";
import {
  createPollingCsv,
  describePollingScope,
  getPollingCsvFilename,
  getPollingUnitLabel,
  POLLING_VIEW_MODES,
} from "../../utils/pollingPlaces";
import {
  describeSpectrumIndex,
  getSpectrumBandLabel,
  getSpectrumContestLabel,
  getSpectrumRangeLabel,
  SPECTRUM_BLOCK_LABELS,
  SPECTRUM_BLOCKS,
  SPECTRUM_COLORS,
} from "../../utils/spectrum";

type PollingPlacesPanelProps = {
  contests: SpectrumSourceContest[];
  registry: PartySpectrumRegistry;
  model: PollingModel;
  state: PollingState;
  placesStatus: PollingDataStatus;
  votesStatus: PollingDataStatus;
  placesMetadata: PollingPlacesMetadata | null;
  /** geometrias do map.data; null enquanto o mapa não carregou */
  mapShapes: MapExportShape[] | null;
  selectedMunicipalityId: string | null;
  onContestChange: (contestId: string) => void;
  onViewModeChange: (viewMode: PollingViewMode) => void;
  onMunicipalityChange: (municipalityId: string | null) => void;
  onToggleBand: (band: AnalysisBand) => void;
  onShowAllBands: () => void;
  onSortChange: (direction: AnalysisSortDirection) => void;
  onReset: () => void;
  onSelect: (ibgeCode: string) => void;
};

const INITIAL_RANKING_SIZE = 10;

const PENDING_DATA_MESSAGE =
  "Dados por local de votação ainda não gerados — rode scripts/process_tse_sections.py";

export function PollingPlacesPanel({
  contests,
  registry,
  model,
  state,
  placesStatus,
  votesStatus,
  placesMetadata,
  mapShapes,
  selectedMunicipalityId,
  onContestChange,
  onViewModeChange,
  onMunicipalityChange,
  onToggleBand,
  onShowAllBands,
  onSortChange,
  onReset,
  onSelect,
}: PollingPlacesPanelProps) {
  const [showAllRanking, setShowAllRanking] = useState(false);
  const [exportMessage, setExportMessage] = useState("");

  const loading = placesStatus === "loading" || votesStatus === "loading";
  const placesMissing = placesStatus === "missing" || placesStatus === "error";
  const votesMissing =
    placesStatus === "ready" &&
    (votesStatus === "missing" || votesStatus === "error");
  const dataReady = placesStatus === "ready" && votesStatus === "ready";
  const allBandsActive = state.activeBands.length === ALL_ANALYSIS_BANDS.length;
  const visibleRanking = showAllRanking
    ? model.filteredUnits
    : model.filteredUnits.slice(0, INITIAL_RANKING_SIZE);
  const unitLabel = getPollingUnitLabel(model.viewMode);
  const viewMode = POLLING_VIEW_MODES.find((item) => item.id === model.viewMode);
  const scopeName = model.municipalityName ?? "Goiás";

  const handleExport = () => {
    if (model.filteredUnits.length === 0) return;
    downloadTextFile(
      createPollingCsv(model),
      getPollingCsvFilename(model),
      "text/csv;charset=utf-8",
    );
    setExportMessage(
      `${formatInteger(model.filteredUnits.length)} ${unitLabel} exportados.`,
    );
  };

  const canExportImage =
    dataReady && mapShapes !== null && mapShapes.length > 0;
  const handleImageExport = () => {
    if (!mapShapes || mapShapes.length === 0) return;
    void exportMapAsPng(mapShapes, buildPollingMapExport(model)).then(
      (exported) =>
        setExportMessage(
          exported
            ? "Imagem do mapa exportada em PNG."
            : "Não foi possível gerar a imagem do mapa.",
        ),
    );
  };

  return (
    <div className="sidebar-view" role="tabpanel" id="sidebar-polling-panel">
      <div className="workspace-view-header">
        <div>
          <span className="panel-eyebrow">Descrição de resultado apurado</span>
          <h2>Locais de votação</h2>
        </div>
        <button
          className="workspace-clear-button analysis-reset-button"
          type="button"
          onClick={onReset}
          aria-label="Restaurar camada padrão"
          title="Restaurar camada padrão"
        >
          <RotateCcw size={16} />
        </button>
      </div>

      <p className="workspace-description">
        Recorte submunicipal: o índice ideológico 0–10 calculado sobre os votos
        apurados em cada local de votação, e a soma desses locais por bairro. É
        a mesma régua da camada de espectro, aplicada abaixo do município.
      </p>

      {loading && (
        <div className="registration-mode" role="status" aria-live="polite">
          <LoaderCircle className="spin" size={15} />
          <span>
            {placesStatus === "loading"
              ? "Carregando locais de votação…"
              : "Carregando votos deste pleito…"}{" "}
            Os arquivos são baixados sob demanda, só na primeira vez.
          </span>
        </div>
      )}

      {placesMissing && (
        <div className="registration-mode" role="alert">
          <TriangleAlert size={15} />
          <span>
            {PENDING_DATA_MESSAGE}. A camada fica desabilitada até que
            <code> src/data/polling/places-go.json</code> tenha locais.
            {placesMetadata?.note ? ` ${placesMetadata.note}` : ""}
          </span>
        </div>
      )}

      {votesMissing && (
        <div className="registration-mode" role="alert">
          <TriangleAlert size={15} />
          <span>
            Locais carregados, mas o arquivo de votos deste pleito
            (<code>votes-{model.contestId}.json</code>) ainda não existe. Escolha
            outro pleito ou rode scripts/process_tse_sections.py.
          </span>
        </div>
      )}

      <label className="analysis-metric-control">
        <span>
          <School size={15} />
          Pleito analisado
        </span>
        <select
          value={state.contestId}
          disabled={placesMissing}
          onChange={(event) => {
            onContestChange(event.target.value);
            setShowAllRanking(false);
          }}
        >
          {contests.map((contest) => (
            <option value={contest.id} key={contest.id}>
              {getSpectrumContestLabel(contest)}
            </option>
          ))}
        </select>
        <small>
          Onda {model.waveYear} do survey · mesmas notas de partido da camada de
          espectro.
        </small>
      </label>

      <div
        className="registration-filter-grid"
        role="group"
        aria-label="Unidade do mapa"
      >
        {POLLING_VIEW_MODES.map((option) => (
          <button
            type="button"
            key={option.id}
            className={
              model.viewMode === option.id ? "registration-filter--active" : ""
            }
            aria-pressed={model.viewMode === option.id}
            disabled={placesMissing}
            onClick={() => {
              onViewModeChange(option.id);
              setShowAllRanking(false);
            }}
          >
            {option.label}
          </button>
        ))}
      </div>
      <small className="registration-metric-help">
        {viewMode?.description}
        {model.viewMode === "neighborhoods" &&
          " Não existe malha de bairros no projeto: a bolha do bairro é a agregação dos locais, posicionada no centroide deles, e não um polígono de bairro."}
      </small>

      <label className="analysis-metric-control">
        <span>
          <Building2 size={15} />
          Município em foco
        </span>
        <select
          value={state.municipalityId ?? ""}
          disabled={placesMissing}
          onChange={(event) => {
            onMunicipalityChange(event.target.value || null);
            setShowAllRanking(false);
          }}
        >
          <option value="">Todos os municípios com dados</option>
          {model.availableMunicipalities.map((municipality) => (
            <option value={municipality.ibgeCode} key={municipality.ibgeCode}>
              {municipality.name} ({formatInteger(municipality.placeCount)})
            </option>
          ))}
        </select>
        <small>
          {selectedMunicipalityId && selectedMunicipalityId !== state.municipalityId
            ? "Clique em um município no mapa para filtrar por ele."
            : `Recorte atual: ${scopeName}.`}
        </small>
      </label>

      <section className="analysis-summary" aria-label="Resumo do recorte">
        <div>
          <span>Índice de {scopeName}</span>
          <strong>
            {model.summary.index === null
              ? "Sem índice"
              : formatDecimal(model.summary.index)}
          </strong>
          <small>escala de 0 a 10</small>
        </div>
        <div>
          <span>Cobertura do índice</span>
          <strong>{formatPercent(model.summary.coveragePct)}</strong>
          <small>
            {formatInteger(model.summary.scoredVotes)} de{" "}
            {formatInteger(model.summary.totalVotes)} votos em partidos com nota
          </small>
        </div>
        <div>
          <span>Locais de votação</span>
          <strong>{formatInteger(model.summary.placeCount)}</strong>
          <small>
            {formatInteger(model.summary.neighborhoodCount)} bairros ·{" "}
            {formatInteger(model.summary.electorate)} eleitores
          </small>
        </div>
      </section>

      {dataReady && (
        <p className="analysis-note">{describePollingScope(model)}</p>
      )}

      {dataReady && model.summary.index !== null && (
        <section className="insight-section" aria-label="Blocos no recorte">
          <div className="section-heading-inline">
            <SlidersHorizontal size={14} />
            <strong>Participação dos blocos em {scopeName}</strong>
          </div>
          <div className="insight-list">
            {SPECTRUM_BLOCKS.map((block) => (
              <div key={block}>
                <span>{SPECTRUM_BLOCK_LABELS[block]}</span>
                <strong>{formatPercent(model.summary.blockSharePct[block])}</strong>
              </div>
            ))}
          </div>
          <small className="registration-metric-help">
            Quem vota nos locais deste recorte{" "}
            {describeSpectrumIndex(model.summary.index, registry)}. Percentuais
            sobre os votos com nota.
          </small>
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
                  style={{ backgroundColor: SPECTRUM_COLORS[band] }}
                />
                <span className="analysis-band-copy">
                  <strong>{getSpectrumBandLabel(band)}</strong>
                  <small>
                    {getSpectrumRangeLabel("index", model.thresholds, band)}
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
            <span>
              Ranking de {model.viewMode === "neighborhoods" ? "bairros" : "locais"}
            </span>
            <small>índice 0–10 · {scopeName}</small>
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
        {model.filteredUnits.length === 0 ? (
          <div className="analysis-ranking-empty">
            <span>
              {dataReady
                ? `Nenhum ${model.viewMode === "neighborhoods" ? "bairro" : "local"} com índice no recorte atual.`
                : "Sem dados carregados para esta camada."}
            </span>
            {dataReady && (
              <button type="button" onClick={onShowAllBands}>
                Mostrar todas as faixas
              </button>
            )}
          </div>
        ) : (
          <div className="analysis-ranking-list">
            {visibleRanking.map((unit) => (
              <button
                type="button"
                key={unit.id}
                onClick={() => onSelect(unit.ibgeCode)}
              >
                <span className="analysis-rank-number">#{unit.rank}</span>
                <span className="analysis-rank-main">
                  <span>
                    <strong>{unit.name}</strong>
                    <em>{formatDecimal(unit.index ?? 0)}</em>
                  </span>
                  <span className="analysis-rank-track" aria-hidden="true">
                    <span
                      style={{
                        width: `${Math.max(7, ((unit.index ?? 0) / 10) * 100)}%`,
                        backgroundColor: SPECTRUM_COLORS[unit.band],
                      }}
                    />
                  </span>
                  <small>
                    {unit.kind === "place"
                      ? `${unit.neighborhood} · ${unit.municipalityName} · ${formatInteger(unit.electorate)} eleitores`
                      : `${unit.municipalityName} · ${formatInteger(unit.placeCount)} locais · ${formatInteger(unit.electorate)} eleitores`}
                  </small>
                </span>
                <MapPin size={14} />
              </button>
            ))}
          </div>
        )}
        {model.filteredUnits.length > INITIAL_RANKING_SIZE && (
          <button
            className="analysis-ranking-toggle"
            type="button"
            onClick={() => setShowAllRanking((current) => !current)}
          >
            {showAllRanking
              ? "Mostrar somente os 10 primeiros"
              : `Ver todos os ${formatInteger(model.filteredUnits.length)}`}
          </button>
        )}
      </section>

      <button
        className="analysis-export-button"
        type="button"
        onClick={handleExport}
        disabled={model.filteredUnits.length === 0}
      >
        <Download size={16} /> Baixar {unitLabel} em CSV
      </button>
      <button
        className="analysis-export-button"
        type="button"
        onClick={handleImageExport}
        disabled={!canExportImage}
        title={
          canExportImage
            ? "Gera um PNG com o índice agregado por município a partir dos locais"
            : "A imagem depende da malha municipal carregada e dos dados desta camada"
        }
      >
        <ImageDown size={16} /> Exportar imagem do mapa
      </button>
      <div className="sr-only" role="status" aria-live="polite">
        {exportMessage}
      </div>

      <section className="insight-section" aria-label="Limites desta leitura">
        <div className="section-heading-inline">
          <ShieldAlert size={14} />
          <strong>Limites desta leitura</strong>
        </div>
        <div className="insight-list">
          <div>
            <strong>
              Mede onde a pessoa VOTA, não onde ela MORA. O local de votação é o
              ponto de urna, não o domicílio do eleitorado.
            </strong>
          </div>
          <div>
            <strong>
              Escola grande atrai eleitorado de vários bairros, e local em divisa
              de bairro ou de município distorce a leitura territorial.
            </strong>
          </div>
          <div>
            <strong>
              O dado é agregado por seção e por local (centenas de eleitores em
              cada um): nunca é voto individual e não permite identificar
              ninguém.
            </strong>
          </div>
          <div>
            <strong>
              {formatInteger(model.placesWithoutCoordinateCount)} locais do
              recorte estão sem coordenada: ficam fora das bolhas do mapa, mas
              contam no bairro, no índice e no CSV —{" "}
              {formatInteger(model.electorateWithoutCoordinate)} eleitores.
            </strong>
          </div>
          {model.hiddenBubbleCount > 0 && (
            <div>
              <strong>
                O mapa desenha as {formatInteger(model.bubbles.length)} maiores
                bolhas por eleitorado;{" "}
                {formatInteger(model.hiddenBubbleCount)} ficaram fora do desenho
                para o mapa não travar. Elas continuam no ranking, no resumo e
                no CSV — filtre por município para vê-las no mapa.
              </strong>
            </div>
          )}
          <div>
            <strong>
              {formatInteger(model.missingIndexCount)}{" "}
              {model.viewMode === "neighborhoods" ? "bairros" : "locais"} do
              recorte não têm nenhum voto em partido com nota: ficam sem índice,
              fora do ranking e das faixas, nunca contados como zero.
            </strong>
          </div>
        </div>
      </section>

      <p className="comparison-note analysis-note">
        O índice descreve como os votos já apurados em cada local se
        distribuíram entre partidos com nota. Não é intenção de voto, projeção
        nem pesquisa eleitoral, e não mede a posição de eleitores individuais.
      </p>
    </div>
  );
}
