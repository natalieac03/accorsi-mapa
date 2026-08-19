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
  getPollingMaximumValue,
  getPollingMetricColors,
  getPollingMetricShortLabel,
  getPollingRangeLabel,
  getPollingUnitLabel,
  getPollingValueRatio,
  POLLING_METRICS,
  POLLING_VIEW_MODES,
} from "../../utils/pollingPlaces";
import { STATE_LABEL } from "../../utils/state";
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
  onCandidateContestChange: (contestId: string | null) => void;
  onCandidateRateChange: (rate: boolean) => void;
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
  onCandidateContestChange,
  onCandidateRateChange,
  onMunicipalityChange,
  onToggleBand,
  onShowAllBands,
  onSortChange,
  onReset,
  onSelect,
}: PollingPlacesPanelProps) {
  const [showAllRanking, setShowAllRanking] = useState(false);
  const [exportMessage, setExportMessage] = useState("");
  // Última sigla olhada, para o alternador devolver a MESMA medida ao voltar do
  // índice. Sem voto no pleito atual, o modelo cai na mais votada.
  const [lastPartyCode, setLastPartyCode] = useState("");
  // Último pleito DELA olhado: voltar à medida da candidata devolve o pleito
  // que estava aberto, não o mais recente.
  const [lastCandidateContestId, setLastCandidateContestId] = useState("");

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
  const scopeName = model.municipalityName ?? STATE_LABEL;
  // Índice ideológico é a medida padrão; escolher uma sigla É escolher a
  // segunda medida (percentual dela).
  const isPartyShare = model.metric === "votoPartido";
  // A terceira medida: os votos nominais DELA, com lista de pleitos própria.
  const isCandidate = model.metric === "votosCandidata";
  const candidateName = model.candidate?.nomeUrna ?? "";
  const labelOptions = {
    rate: model.candidateRate,
    nome: candidateName || undefined,
  };
  const metricShortLabel = getPollingMetricShortLabel(
    model.metric,
    model.partyCode,
    labelOptions,
  );
  const bandColors = getPollingMetricColors(model.metric);
  // Sem sigla com voto apurado não há percentual: o botão fica desabilitado.
  const canUsePartyShare = model.partyOptions.length > 0;
  // Sem trajetória gerada ou sem pleito dela com cadastro de locais, a medida
  // não é oferecida e a tela diz por quê. Nada de dado sintético.
  const canUseCandidate = model.candidateOptions.length > 0;
  const candidateUnavailableReason =
    model.candidateAvailability === "pendente"
      ? " A trajetória da candidata ainda não foi gerada (rode bash gerar_dados.sh): a medida de votos dela fica indisponível."
      : model.candidateAvailability === "sem-recorte"
        ? " Nenhum pleito da candidata tem cadastro de locais de votação publicado pelo TSE: a medida de votos dela fica indisponível."
        : "";
  // Voto absoluto não tem teto fixo: a barra do ranking é relativa ao maior
  // valor do recorte.
  const rankingMaximum = getPollingMaximumValue(model);

  const handleMetricChange = (metric: PollingMetric) => {
    if (metric === model.metric) return;
    // Sair da medida da candidata apaga o pleito dela; entrar apaga a sigla. As
    // três medidas nunca ficam ligadas juntas, e cada saída guarda a escolha.
    if (model.candidate) setLastCandidateContestId(model.candidate.contestId);
    if (model.partyCode) setLastPartyCode(model.partyCode);
    if (metric === "votosCandidata") {
      const contestId =
        lastCandidateContestId || model.candidateOptions[0]?.id || "";
      if (!contestId) return;
      onPartyChange("");
      onCandidateContestChange(contestId);
    } else {
      onCandidateContestChange(null);
      if (metric === "indice") {
        onPartyChange("");
      } else {
        const code = lastPartyCode || model.partyOptions[0]?.code || "";
        if (!code) return;
        onPartyChange(code);
      }
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

  /* O desenho do PNG do mapa, reaproveitado como figura do relatório. Só o PDF
     embute imagem; a planilha é para trabalhar os números. */
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
            Locais carregados, mas o arquivo de votos por sigla deste pleito do
            espectro ainda não existe. Escolha outro pleito ou rode
            scripts/process_tse_sections.py.
            {isCandidate
              ? " A medida de votos da candidata não depende desse arquivo e continua valendo; o índice e o percentual por sigla é que ficam sem dado."
              : ""}
          </span>
        </div>
      )}

      {/* CADA MEDIDA TEM SUA LISTA DE PLEITOS: as duas primeiras leem os votos
          por local do espectro, a da candidata lê a trajetória dela (2016-11-1,
          2018-7-1, 2020-11-1, 2022-6-1, 2024-11-1). Misturar mostraria "sem
          dado" em eleição que ela nem disputou. */}
      {isCandidate ? (
        <label className="analysis-metric-control">
          <span>
            <School size={15} />
            Eleição da candidata
          </span>
          <select
            value={model.candidate?.contestId ?? ""}
            disabled={placesMissing || model.candidateOptions.length === 0}
            onChange={(event) => {
              setLastCandidateContestId(event.target.value);
              onCandidateContestChange(event.target.value);
              setShowAllRanking(false);
            }}
          >
            {model.candidateOptions.map((option) => (
              <option value={option.id} key={option.id}>
                {option.label} — {formatInteger(option.votes)} votos
              </option>
            ))}
          </select>
          <small>
            Só as eleições em que {candidateName || "a candidata"} teve voto
            com cadastro de locais publicado pelo TSE —{" "}
            {formatInteger(model.candidateOptions.length)}{" "}
            {model.candidateOptions.length === 1 ? "pleito" : "pleitos"}. É uma
            lista diferente da dos pleitos do espectro, porque é outra fonte.
          </small>
        </label>
      ) : (
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
      )}

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
              placesMissing ||
              (option.id === "votoPartido" && !canUsePartyShare) ||
              (option.id === "votosCandidata" && !canUseCandidate)
            }
            onClick={() => handleMetricChange(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <small className="registration-metric-help">
        {POLLING_METRICS.find((option) => option.id === model.metric)?.description}{" "}
        O índice e o percentual por sigla valem para qualquer pleito da lista do
        espectro; o índice é o padrão da camada. Os votos da candidata têm lista
        de eleições própria.
        {!canUsePartyShare
          ? " Sem voto apurado neste pleito, o percentual por sigla fica indisponível."
          : ""}
        {candidateUnavailableReason}
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

      {isCandidate && (
        <>
          <div
            className="registration-filter-grid"
            role="group"
            aria-label="Escala do voto da candidata"
          >
            {/* A MESMA medida em duas escalas: a densidade permite comparar
                colégio grande com pequeno. Como muda o valor da medida, cor,
                faixa, ranking e CSV mudam juntos. */}
            <button
              type="button"
              className={!model.candidateRate ? "registration-filter--active" : ""}
              aria-pressed={!model.candidateRate}
              disabled={placesMissing}
              onClick={() => {
                onCandidateRateChange(false);
                setShowAllRanking(false);
              }}
            >
              Votos no local
            </button>
            <button
              type="button"
              className={model.candidateRate ? "registration-filter--active" : ""}
              aria-pressed={model.candidateRate}
              disabled={placesMissing}
              onClick={() => {
                onCandidateRateChange(true);
                setShowAllRanking(false);
              }}
            >
              Por 1.000 eleitores
            </button>
          </div>
          <small className="registration-metric-help">
            {model.candidateRate
              ? "Votos dela dividídos pelo eleitorado do local, ×1.000: compara colégio grande com colégio pequeno. Local sem eleitorado cadastrado fica sem taxa — nunca com 0."
              : "Votos nominais dela naquele local, como saíram da urna. Para comparar locais de tamanhos diferentes, troque para a taxa por 1.000 eleitores."}
          </small>
        </>
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
        {isCandidate ? (
          <>
            <div>
              {/* Em pleito municipal sem filtro de cidade, o total é todo da
                  cidade disputada; rotular com o estado enganaria. */}
              <span>
                {candidateName || "Candidata"} em{" "}
                {model.candidate?.municipal && !model.municipalityId
                  ? model.candidate.scopeLabel
                  : scopeName}
              </span>
              <strong>
                {model.summary.candidateVotes === null
                  ? "Fora da disputa"
                  : formatInteger(model.summary.candidateVotes)}
              </strong>
              <small>
                {model.summary.candidateVotes === null
                  ? `ela disputou apenas em ${model.candidate?.scopeLabel ?? "outra cidade"}`
                  : `votos nominais dela nos locais do recorte · ${model.contestLabel}`}
              </small>
            </div>
            <div>
              <span>Por 1.000 eleitores</span>
              <strong>
                {model.summary.candidateVotesPerThousand === null
                  ? "Sem eleitorado"
                  : formatDecimal(model.summary.candidateVotesPerThousand)}
              </strong>
              <small>
                voto dela por 1.000 eleitores do recorte ·{" "}
                {formatInteger(model.summary.candidateUnitsWithVotes)}{" "}
                {model.viewMode === "neighborhoods" ? "bairros" : "locais"} com
                voto dela
              </small>
            </div>
          </>
        ) : isPartyShare ? (
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

      {/* A medida da candidata não depende do arquivo de votos por sigla. */}
      {(dataReady || (isCandidate && placesStatus === "ready")) && (
        <p className="analysis-note">{describePollingScope(model)}</p>
      )}

      {/* Blocos são leitura do espectro: fora do percentual e do voto dela. */}
      {dataReady && !isPartyShare && !isCandidate && model.summary.index !== null && (
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
                    {getPollingBandLabel(
                      model.metric,
                      model.thresholds,
                      band,
                      labelOptions,
                    )}
                  </strong>
                  <small>
                    {isCandidate
                      ? model.candidateRate
                        ? "votos dela por 1.000 eleitores"
                        : "votos dela no local"
                      : isPartyShare
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
                ? `Nenhum ${model.viewMode === "neighborhoods" ? "bairro" : "local"} com ${isCandidate ? `voto de ${candidateName || "a candidata"} nem presença dela na urna` : isPartyShare ? "voto apurado" : "índice"} no recorte atual.`
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
                    <em>
                      {formatPollingValue(model.metric, unit.value, {
                        ...labelOptions,
                        inScope: unit.candidateInScope,
                      })}
                    </em>
                  </span>
                  <span className="analysis-rank-track" aria-hidden="true">
                    <span
                      style={{
                        width: `${Math.max(7, getPollingValueRatio(model.metric, unit.value, rankingMaximum) * 100)}%`,
                        backgroundColor: bandColors[unit.band],
                      }}
                    />
                  </span>
                  <small>
                    {unit.kind === "place"
                      ? `${unit.neighborhood} · ${unit.municipalityName} · ${formatInteger(unit.electorate)} eleitores`
                      : `${unit.municipalityName} · ${formatInteger(unit.placeCount)} locais · ${formatInteger(unit.electorate)} eleitores`}
                    {/* As duas escalas andam juntas: voto absoluto esconde o
                        colégio pequeno que votou muito nela, densidade esconde
                        o tamanho. */}
                    {isCandidate
                      ? model.candidateRate
                        ? ` · ${unit.candidateVotes === null ? "fora da disputa" : `${formatInteger(unit.candidateVotes)} votos`}`
                        : ` · ${unit.candidateVotesPerThousand === null ? "sem taxa (sem eleitorado)" : `${formatDecimal(unit.candidateVotesPerThousand)} por mil eleitores`}`
                      : ""}
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
            ? `Gera um PNG com ${isCandidate ? `os votos de ${candidateName || "a candidata"}` : isPartyShare ? `o percentual do ${model.partyCode || "partido"}` : "o índice"} agregado por município a partir dos locais`
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
              {isCandidate
                ? `estão fora desta medida: ${candidateName || "a candidata"} não era candidata ali${model.candidate?.municipal ? ` (ela disputou só em ${model.candidate.scopeLabel})` : ""}. Ficam com valor ausente, fora do ranking e das faixas — nunca com 0 voto, que diria outra coisa.`
                : isPartyShare
                  ? "não têm nenhum voto apurado: sem denominador não existe percentual, então ficam fora do ranking e das faixas, nunca como 0%."
                  : "não têm nenhum voto em partido com nota: ficam sem índice, fora do ranking e das faixas, nunca contados como zero."}
            </strong>
          </div>
          {isCandidate && model.candidate && (
            <>
              <div>
                <strong>
                  Onde {candidateName || "a candidata"} estava na urna e não
                  teve voto, o valor é 0 de verdade — a unidade continua no
                  ranking, no fim da fila. "Não teve voto aqui" e "não era
                  candidata aqui" são coisas diferentes e aparecem diferentes.
                </strong>
              </div>
              {/* Confiança do recorte: places-go.json vem dos cadastros de 2022
                  e 2024 e o TSE renumera locais entre eleições. Quando nada se
                  perde, a tela também diz. */}
              <div>
                {model.candidate.unmatchedPlaceCount > 0 ? (
                  <strong>
                    {formatInteger(model.candidate.unmatchedPlaceCount)} dos{" "}
                    {formatInteger(model.candidate.placesInContest)} locais com
                    voto dela neste pleito não existem no cadastro de locais de
                    votação e ficaram fora do mapa, do ranking e do CSV —{" "}
                    {formatInteger(model.candidate.unmatchedVotes)} de{" "}
                    {formatInteger(model.candidate.votesInContest)} votos dela. O
                    cadastro foi montado com os anos mais recentes e o TSE
                    renumera locais entre eleições; quanto mais antigo o pleito,
                    maior essa perda.
                  </strong>
                ) : (
                  <strong>
                    Todos os{" "}
                    {formatInteger(model.candidate.placesInContest)} locais com
                    voto dela neste pleito casaram com o cadastro de locais de
                    votação: nenhum voto ficou fora do mapa por local
                    desconhecido.
                  </strong>
                )}
              </div>
              {model.candidate.votesWithoutPlace > 0 && (
                <div>
                  <strong>
                    Outros{" "}
                    {formatInteger(model.candidate.votesWithoutPlace)} votos
                    dela não têm local de votação identificado na própria base
                    do TSE (voto em trânsito, seção sem local no cadastro
                    daquele ano): entram no total dela, nunca em nenhuma bolha.
                  </strong>
                </div>
              )}
            </>
          )}
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
        {isCandidate
          ? `Os votos de ${candidateName || "a candidata"} são apuração publicada do pleito de ${model.candidate?.electionYear ?? ""}, local a local. Descrevem uma eleição que já aconteceu: não são intenção de voto, projeção nem pesquisa eleitoral, e voto de eleições diferentes não se soma.`
          : isPartyShare
            ? `O percentual descreve como os votos já apurados em cada local se distribuíram entre as siglas${model.partyCode ? `, com o recorte do ${model.partyCode}` : ""}. Não é intenção de voto, projeção nem pesquisa eleitoral.`
            : "O índice descreve como os votos já apurados em cada local se distribuíram entre partidos com nota. Não é intenção de voto, projeção nem pesquisa eleitoral, e não mede a posição de eleitores individuais."}
      </p>
    </div>
  );
}
