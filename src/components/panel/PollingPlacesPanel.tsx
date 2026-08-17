import {
  ArrowDown,
  ArrowUp,
  Building2,
  LoaderCircle,
  MapPin,
  RotateCcw,
  School,
  ShieldAlert,
  SlidersHorizontal,
  TriangleAlert,
  Vote,
} from "lucide-react";
import { useState } from "react";
import type { AnalysisBand, AnalysisSortDirection } from "../../types/analysis";
import type {
  PollingDataStatus,
  PollingMetric,
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
  renderMapExportCanvas,
  type MapExportShape,
} from "../../utils/mapExport";
import { canvasToReportImage } from "../../utils/chartImage";
import { useReportExport, type ReportFormat } from "../../hooks/useReportExport";
import { buildPollingReport } from "../../utils/reportLayers";
import { ExportActions } from "./ExportActions";
import {
  createPollingCsv,
  describePollingLayer,
  describePollingScope,
  formatPollingValue,
  getPollingBandLabel,
  getPollingCsvFilename,
  getPollingMetricColors,
  getPollingMetricShortLabel,
  getPollingRangeLabel,
  getPollingUnitLabel,
  getPollingValueRatio,
  POLLING_METRICS,
  POLLING_VIEW_MODES,
} from "../../utils/pollingPlaces";
import {
  describeSpectrumIndex,
  getSpectrumContestLabel,
  SPECTRUM_BLOCK_LABELS,
  SPECTRUM_BLOCKS,
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
  onPartyChange: (partyCode: string) => void;
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
  onPartyChange,
  onMunicipalityChange,
  onToggleBand,
  onShowAllBands,
  onSortChange,
  onReset,
  onSelect,
}: PollingPlacesPanelProps) {
  const [showAllRanking, setShowAllRanking] = useState(false);
  const [exportMessage, setExportMessage] = useState("");
  // Última sigla olhada, para o alternador devolver a MESMA medida quando se
  // volta do índice. Se ela não tiver voto no pleito atual, o modelo cai
  // sozinho na mais votada — aqui não se inventa sigla nenhuma.
  const [lastPartyCode, setLastPartyCode] = useState("");

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
  // A medida é escolha de quem olha e vale para todo pleito: o índice
  // ideológico é o padrão, o percentual de uma sigla é a outra opção do
  // alternador. Escolher uma sigla É escolher a segunda medida.
  const isPartyShare = model.metric === "votoPartido";
  const metricShortLabel = getPollingMetricShortLabel(
    model.metric,
    model.partyCode,
  );
  const bandColors = getPollingMetricColors(model.metric);
  // Sem nenhuma sigla com voto apurado não há percentual possível: o botão
  // fica desabilitado em vez de levar a uma tela vazia.
  const canUsePartyShare = model.partyOptions.length > 0;

  const handleMetricChange = (metric: PollingMetric) => {
    if (metric === model.metric) return;
    if (metric === "indice") {
      if (model.partyCode) setLastPartyCode(model.partyCode);
      onPartyChange("");
    } else {
      const code = lastPartyCode || model.partyOptions[0]?.code || "";
      if (!code) return;
      onPartyChange(code);
    }
    setShowAllRanking(false);
  };

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

  /* O mesmo desenho do PNG do mapa, reaproveitado como figura do relatório —
     sem o mapa, o PDF perderia justamente o que se olha primeiro na reunião.
     Só o PDF embute imagem; a planilha é para trabalhar os números. */
  const imagensDoMapa = (formato: ReportFormat) => {
    if (formato !== "pdf" || !mapShapes || mapShapes.length === 0) return [];
    const exportData = buildPollingMapExport(model);
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
      buildPollingReport({
        model,
        generatedAt: new Date(),
        images: imagensDoMapa(formato),
      }),
    setExportMessage,
  );

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

      <p className="workspace-description">{describePollingLayer(model)}</p>

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
          {isPartyShare
            ? `${model.officeName || "Pleito"} · votos apurados local a local, sigla a sigla.`
            : `Onda ${model.waveYear} do survey · mesmas notas de partido da camada de espectro.`}
        </small>
      </label>

      <div
        className="registration-filter-grid"
        role="group"
        aria-label="Medida da camada"
      >
        {POLLING_METRICS.map((option) => (
          <button
            type="button"
            key={option.id}
            className={model.metric === option.id ? "registration-filter--active" : ""}
            aria-pressed={model.metric === option.id}
            disabled={
              placesMissing || (option.id === "votoPartido" && !canUsePartyShare)
            }
            onClick={() => handleMetricChange(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <small className="registration-metric-help">
        {POLLING_METRICS.find((option) => option.id === model.metric)?.description}{" "}
        As duas medidas valem para qualquer pleito desta lista; o índice é o
        padrão da camada.
        {!canUsePartyShare
          ? " Sem voto apurado neste pleito, o percentual por sigla fica indisponível."
          : ""}
      </small>

      {isPartyShare && (
        <label className="analysis-metric-control">
          <span>
            <Vote size={15} />
            Sigla no mapa
          </span>
          <select
            value={model.partyCode}
            disabled={placesMissing || model.partyOptions.length === 0}
            onChange={(event) => {
              setLastPartyCode(event.target.value);
              onPartyChange(event.target.value);
              setShowAllRanking(false);
            }}
          >
            {model.partyOptions.length === 0 ? (
              <option value="">Nenhuma sigla com voto apurado</option>
            ) : (
              model.partyOptions.map((option) => (
                <option value={option.code} key={option.code}>
                  {option.code} — {formatPercent(option.sharePct)} do estado
                </option>
              ))
            )}
          </select>
          <small>
            {model.partyOptions.length === 0
              ? "Sem votos apurados neste pleito, nenhuma sigla pode ser medida."
              : `Siglas com voto apurado neste pleito, da mais votada para a menos votada. Cada bolha mostra o percentual do ${model.partyCode} sobre os votos apurados naquele ${model.viewMode === "neighborhoods" ? "bairro" : "local"}.`}
          </small>
        </label>
      )}

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
        {isPartyShare ? (
          <>
            <div>
              <span>
                {model.partyCode ? `${model.partyCode} em` : "Sigla em"}{" "}
                {scopeName}
              </span>
              <strong>
                {formatPollingValue(model.metric, model.summary.partySharePct)}
              </strong>
              <small>sobre os votos apurados do recorte</small>
            </div>
            <div>
              <span>
                Votos {model.partyCode ? `do ${model.partyCode}` : "da sigla"}
              </span>
              <strong>{formatInteger(model.summary.partyVotes)}</strong>
              <small>
                de {formatInteger(model.summary.totalVotes)} votos apurados nos
                locais do recorte
              </small>
            </div>
          </>
        ) : (
          <>
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
                {formatInteger(model.summary.totalVotes)} votos em partidos com
                nota
              </small>
            </div>
          </>
        )}
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

      {/* Blocos são leitura do espectro: não aparecem na tela de percentual. */}
      {dataReady && !isPartyShare && model.summary.index !== null && (
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
                  style={{ backgroundColor: bandColors[band] }}
                />
                <span className="analysis-band-copy">
                  <strong>
                    {getPollingBandLabel(model.metric, model.thresholds, band)}
                  </strong>
                  <small>
                    {isPartyShare
                      ? "do voto apurado"
                      : getPollingRangeLabel(
                          model.metric,
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
            <span>
              Ranking de {model.viewMode === "neighborhoods" ? "bairros" : "locais"}
            </span>
            <small>
              {metricShortLabel} · {scopeName}
            </small>
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
                ? `Nenhum ${model.viewMode === "neighborhoods" ? "bairro" : "local"} com ${isPartyShare ? "voto apurado" : "índice"} no recorte atual.`
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
                    <em>{formatPollingValue(model.metric, unit.value)}</em>
                  </span>
                  <span className="analysis-rank-track" aria-hidden="true">
                    <span
                      style={{
                        width: `${Math.max(7, getPollingValueRatio(model.metric, unit.value) * 100)}%`,
                        backgroundColor: bandColors[unit.band],
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

      <ExportActions
        exportando={exportando}
        onExport={exportar}
        onCsv={handleExport}
        onImage={handleImageExport}
        csvLabel={`Arquivo .csv com todas as colunas de ${unitLabel}, para cruzar em outra ferramenta`}
        csvDisabled={model.filteredUnits.length === 0}
        imageDisabled={!canExportImage}
        imageTitle={
          canExportImage
            ? `Gera um PNG com ${isPartyShare ? `o percentual do ${model.partyCode || "partido"}` : "o índice"} agregado por município a partir dos locais`
            : "A imagem depende da malha municipal carregada e dos dados desta camada"
        }
      />
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
              contam no bairro, no cálculo e no CSV —{" "}
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
              {formatInteger(model.missingValueCount)}{" "}
              {model.viewMode === "neighborhoods" ? "bairros" : "locais"} do
              recorte{" "}
              {isPartyShare
                ? "não têm nenhum voto apurado: sem denominador não existe percentual, então ficam fora do ranking e das faixas, nunca como 0%."
                : "não têm nenhum voto em partido com nota: ficam sem índice, fora do ranking e das faixas, nunca contados como zero."}
            </strong>
          </div>
          {isPartyShare && (
            <div>
              <strong>
                Onde houve apuração e o {model.partyCode || "partido"} não teve
                voto, o valor é 0% de verdade — a unidade continua no ranking,
                no fim da fila. Ausência de apuração e zero voto são coisas
                diferentes e aparecem diferentes.
              </strong>
            </div>
          )}
        </div>
      </section>

      <p className="comparison-note analysis-note">
        {isPartyShare
          ? `O percentual descreve como os votos já apurados em cada local se distribuíram entre as siglas${model.partyCode ? `, com o recorte do ${model.partyCode}` : ""}. Não é intenção de voto, projeção nem pesquisa eleitoral.`
          : "O índice descreve como os votos já apurados em cada local se distribuíram entre partidos com nota. Não é intenção de voto, projeção nem pesquisa eleitoral, e não mede a posição de eleitores individuais."}
      </p>
    </div>
  );
}
