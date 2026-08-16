import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Database,
  Download,
  FileDown,
  LoaderCircle,
  MapPin,
  MapPinned,
  Plus,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Upload,
  Users,
} from "lucide-react";
import { useMemo, useRef, useState, type FormEvent } from "react";
import type { AnalysisBand, AnalysisSortDirection } from "../../types/analysis";
import type { MunicipalityProfile } from "../../types/electorate";
import type {
  RegistrationCreateInput,
  RegistrationDataMode,
  RegistrationFollowUpStatus,
  RegistrationMetricId,
  RegistrationModel,
  RegistrationSource,
  RegistrationState,
  RegistrationWindow,
} from "../../types/registrations";
import { lookupCep } from "../../services/cep";
import { ALL_ANALYSIS_BANDS } from "../../utils/analysis";
import { downloadTextFile } from "../../utils/browser";
import { ELECTORATE_COLORS, formatInteger } from "../../utils/electorate";
import {
  createRegistrationAggregateCsv,
  createRegistrationImportTemplateCsv,
  formatRegistrationMetricValue,
  getRegistrationRangeLabel,
  normalizeNeighborhoodKey,
  parseRegistrationImportCsv,
  REGISTRATION_METRICS,
  REGISTRATION_SOURCES,
  REGISTRATION_SOURCE_LABELS,
  REGISTRATION_STATUSES,
  REGISTRATION_STATUS_LABELS,
  REGISTRATION_WINDOW_LABELS,
} from "../../utils/registrations";

type Props = {
  model: RegistrationModel;
  state: RegistrationState;
  mode: RegistrationDataMode;
  loading: boolean;
  error: string | null;
  localRecordCount: number;
  municipalityById: Record<string, MunicipalityProfile>;
  selectedMunicipalityId: string | null;
  onMetricChange: (metric: RegistrationMetricId) => void;
  onWindowChange: (window: RegistrationWindow) => void;
  onGeographyChange: (
    municipalityId: string | null,
    neighborhood?: string | null,
    cepPrefix?: string | null,
  ) => void;
  onToggleSource: (source: RegistrationSource) => void;
  onToggleStatus: (status: RegistrationFollowUpStatus) => void;
  onToggleBand: (band: AnalysisBand) => void;
  onShowAllBands: () => void;
  onSortChange: (direction: AnalysisSortDirection) => void;
  onReset: () => void;
  onSelect: (id: string) => void;
  onAdd: (input: RegistrationCreateInput) => Promise<unknown>;
  onImport: (inputs: RegistrationCreateInput[]) => Promise<number>;
  onClearLocal: () => void;
  onReload: () => void;
};

type ResolvedCep = {
  cep: string;
  municipalityId: string;
  municipalityName: string;
  neighborhood: string;
  latitude: number | null;
  longitude: number | null;
};

const INITIAL_RANKING_SIZE = 10;

function oneYearFromToday() {
  const date = new Date();
  date.setFullYear(date.getFullYear() + 1);
  return date.toISOString().slice(0, 10);
}

async function geocodeCep(
  address: string,
): Promise<{ latitude: number; longitude: number } | null> {
  if (typeof google === "undefined" || !google.maps?.Geocoder) return null;
  try {
    const response = await new google.maps.Geocoder().geocode({ address });
    const location = response.results[0]?.geometry.location;
    return location
      ? {
          latitude: Number(location.lat().toFixed(3)),
          longitude: Number(location.lng().toFixed(3)),
        }
      : null;
  } catch {
    return null;
  }
}

function filterButtonClass(active: boolean) {
  return active ? "registration-filter--active" : "";
}

export function CampaignRegistrationsPanel({
  model,
  state,
  mode,
  loading,
  error,
  localRecordCount,
  municipalityById,
  selectedMunicipalityId,
  onMetricChange,
  onWindowChange,
  onGeographyChange,
  onToggleSource,
  onToggleStatus,
  onToggleBand,
  onShowAllBands,
  onSortChange,
  onReset,
  onSelect,
  onAdd,
  onImport,
  onClearLocal,
  onReload,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showForm, setShowForm] = useState(false);
  const [showAllRanking, setShowAllRanking] = useState(false);
  const [cep, setCep] = useState("");
  const [externalReference, setExternalReference] = useState("");
  const [source, setSource] = useState<RegistrationSource>("field");
  const [followUpStatus, setFollowUpStatus] = useState<
    Exclude<RegistrationFollowUpStatus, "revoked">
  >("pending");
  const [consentChannel, setConsentChannel] = useState("formulario_web");
  const [consentVersion, setConsentVersion] = useState("v1");
  const [retentionUntil, setRetentionUntil] = useState(oneYearFromToday);
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [resolvedCep, setResolvedCep] = useState<ResolvedCep | null>(null);
  const [working, setWorking] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [feedbackError, setFeedbackError] = useState(false);
  const allBandsActive = state.activeBands.length === ALL_ANALYSIS_BANDS.length;
  const visibleRanking = showAllRanking
    ? model.filteredItems
    : model.filteredItems.slice(0, INITIAL_RANKING_SIZE);
  const detailMunicipalityId = state.municipalityId ?? selectedMunicipalityId;
  const selectedItem = model.allItems.find(
    (item) => item.municipality.ibgeCode === detailMunicipalityId,
  );
  const focusedMunicipalityId = state.municipalityId ?? selectedMunicipalityId;
  const selectedClusters = useMemo(
    () =>
      model.clusters
        .filter((cluster) =>
          focusedMunicipalityId
            ? cluster.municipalityId === focusedMunicipalityId
            : true,
        )
        .slice()
        .sort((a, b) => b.count - a.count)
        .slice(0, 8),
    [focusedMunicipalityId, model.clusters],
  );
  const geographyClusters = model.availableClusters.filter(
    (cluster) => cluster.municipalityId === state.municipalityId,
  );
  const stateNeighborhoodKey = state.neighborhood
    ? normalizeNeighborhoodKey(state.neighborhood)
    : null;
  const activeGeographyCluster = model.availableClusters.find(
    (cluster) =>
      cluster.municipalityId === state.municipalityId &&
      cluster.neighborhoodKey === stateNeighborhoodKey &&
      cluster.cepPrefix === state.cepPrefix,
  );
  const geographyFilterActive = Boolean(
    state.municipalityId && (state.neighborhood || state.cepPrefix),
  );
  const geographyFilterEmpty =
    geographyFilterActive && model.filteredRecordCount === 0;

  const showFeedback = (message: string, isError = false) => {
    setFeedback(message);
    setFeedbackError(isError);
  };

  const handleCepLookup = async () => {
    setWorking(true);
    showFeedback("");
    try {
      const result = await lookupCep(cep);
      const municipality = municipalityById[result.ibge];
      if (!municipality) throw new Error("O município do CEP não está na base de Goiás.");
      const coordinates = await geocodeCep(
        [result.cep, result.logradouro, result.bairro, result.localidade, "GO"]
          .filter(Boolean)
          .join(", "),
      );
      setResolvedCep({
        cep: result.cep.replace(/\D/g, ""),
        municipalityId: municipality.ibgeCode,
        municipalityName: municipality.name,
        neighborhood: result.bairro || "Bairro não informado",
        latitude: coordinates?.latitude ?? null,
        longitude: coordinates?.longitude ?? null,
      });
      showFeedback(
        coordinates
          ? "CEP localizado. A coordenada será arredondada antes de salvar."
          : "CEP localizado por bairro e município; coordenada individual não será salva.",
      );
    } catch (lookupError) {
      setResolvedCep(null);
      showFeedback(
        lookupError instanceof Error ? lookupError.message : "Não foi possível localizar o CEP.",
        true,
      );
    } finally {
      setWorking(false);
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!resolvedCep) {
      showFeedback("Localize e confirme o CEP antes de salvar.", true);
      return;
    }
    if (!consentConfirmed) {
      showFeedback("Confirme que o consentimento foi registrado.", true);
      return;
    }
    setWorking(true);
    showFeedback("");
    try {
      await onAdd({
        externalReference: externalReference || undefined,
        municipalityId: resolvedCep.municipalityId,
        municipalityName: resolvedCep.municipalityName,
        cep: resolvedCep.cep,
        neighborhood: resolvedCep.neighborhood,
        latitude: resolvedCep.latitude,
        longitude: resolvedCep.longitude,
        geocodePrecision:
          resolvedCep.latitude === null ? "municipality" : "cep_centroid",
        source,
        followUpStatus,
        consentAt: new Date().toISOString(),
        consentChannel,
        consentVersion,
        retentionUntil,
      });
      setCep("");
      setExternalReference("");
      setResolvedCep(null);
      setConsentConfirmed(false);
      showFeedback("Cadastro salvo sem CEP completo nem identificadores pessoais no mapa.");
    } catch (submitError) {
      showFeedback(
        submitError instanceof Error ? submitError.message : "Não foi possível salvar.",
        true,
      );
    } finally {
      setWorking(false);
    }
  };

  const handleImport = async (file: File | undefined) => {
    if (!file) return;
    setWorking(true);
    showFeedback("");
    try {
      const parsed = parseRegistrationImportCsv(await file.text()).map((item) => {
        const municipality = municipalityById[item.municipalityId];
        if (!municipality) {
          throw new Error(`Município IBGE ${item.municipalityId} não existe na base.`);
        }
        return { ...item, municipalityName: municipality.name };
      });
      const imported = await onImport(parsed);
      showFeedback(`${formatInteger(imported)} cadastros importados com sucesso.`);
    } catch (importError) {
      showFeedback(
        importError instanceof Error ? importError.message : "Não foi possível importar o CSV.",
        true,
      );
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
      setWorking(false);
    }
  };

  const handleExport = () => {
    downloadTextFile(
      createRegistrationAggregateCsv(model, state),
      `cadastros-agregados-rs-${model.referenceDate}.csv`,
      "text/csv;charset=utf-8",
    );
    showFeedback(`${model.filteredItems.length} municípios exportados; nenhuma pessoa foi exportada.`);
  };

  const handleTemplate = () => {
    downloadTextFile(
      createRegistrationImportTemplateCsv(),
      "modelo-importacao-cadastros-dia11.csv",
      "text/csv;charset=utf-8",
    );
    showFeedback("Modelo CSV baixado.");
  };

  return (
    <div className="sidebar-view" role="tabpanel" id="sidebar-registrations-panel">
      <div className="workspace-view-header">
        <div>
          <span className="panel-eyebrow">Operação de campanha</span>
          <h2>Cadastros</h2>
        </div>
        <button
          className="workspace-clear-button analysis-reset-button"
          type="button"
          onClick={onReset}
          title="Restaurar filtros"
          aria-label="Restaurar filtros"
        >
          <RotateCcw size={16} />
        </button>
      </div>

      <p className="workspace-description">
        Acompanhe cadastros consentidos por município, bairro e prefixo de CEP.
        O mapa mostra somente grupos, nunca pessoas.
      </p>

      <div className={`registration-mode ${mode === "api" ? "registration-mode--api" : ""}`}>
        {mode === "api" ? <Database size={15} /> : <AlertTriangle size={15} />}
        <div>
          <strong>{mode === "api" ? "Banco conectado" : "Demonstração sintética"}</strong>
          <span>
            {mode === "api"
              ? "Cadastros persistidos pela API protegida."
              : "306 registros fictícios; não representam pessoas reais."}
          </span>
        </div>
        {mode === "api" && error && (
          <button type="button" onClick={onReload}>Tentar novamente</button>
        )}
      </div>

      <div className="registration-privacy-note" role="note">
        <ShieldCheck size={16} />
        <span>
          CEP completo é descartado após a localização. Coordenadas são
          arredondadas e bolhas com menos de {model.privacyThreshold} cadastros
          ficam ocultas.
        </span>
      </div>

      <div className="registration-metric-tabs" role="group" aria-label="Métrica do mapa">
        {REGISTRATION_METRICS.map((metric) => (
          <button
            type="button"
            key={metric.id}
            className={state.metricId === metric.id ? "registration-metric--active" : ""}
            onClick={() => {
              onMetricChange(metric.id);
              setShowAllRanking(false);
            }}
            title={metric.description}
          >
            {metric.id === "rate" ? "10k" : metric.id === "recent" ? "30d" : <Users size={13} />}
            {metric.shortLabel}
          </button>
        ))}
      </div>
      <small className="registration-metric-help">{model.metricDescription}</small>

      <section className="analysis-summary registration-summary" aria-label="Resumo dos cadastros">
        <div><span>Cadastros válidos</span><strong>{formatInteger(model.validRecordCount)}</strong></div>
        <div><span>Municípios cobertos</span><strong>{model.coveredMunicipalityCount}</strong><small>de 246</small></div>
        <div><span>Últimos 30 dias</span><strong>{formatInteger(model.recentRecordCount)}</strong></div>
        <div><span>Pendentes</span><strong>{formatInteger(model.pendingRecordCount)}</strong></div>
      </section>

      {selectedItem && (
        <section className="registration-selected-card">
          <div><MapPin size={14} /><span>Município selecionado</span></div>
          <strong>{selectedItem.municipality.name}</strong>
          <dl>
            <div><dt>Cadastros</dt><dd>{selectedItem.total}</dd></div>
            <div><dt>Recentes</dt><dd>{selectedItem.recent}</dd></div>
            <div><dt>Por 10 mil</dt><dd>{selectedItem.rate.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}</dd></div>
            <div><dt>Pendentes</dt><dd>{selectedItem.pending}</dd></div>
          </dl>
        </section>
      )}

      <section className="analysis-filter-section">
        <div className="analysis-section-heading"><span><SlidersHorizontal size={14} /> Filtros</span></div>
        <div className="registration-geography-grid">
          <label className="registration-window-control">
            <span>Município</span>
            <select
              value={state.municipalityId ?? ""}
              onChange={(event) =>
                onGeographyChange(event.target.value || null)
              }
            >
              <option value="">Todo o Goiás</option>
              {model.availableMunicipalities.map((item) => (
                <option value={item.municipalityId} key={item.municipalityId}>
                  {item.municipalityName} ({item.count})
                </option>
              ))}
            </select>
          </label>
          <label className="registration-window-control">
            <span>Bairro / prefixo do CEP</span>
            <select
              value={
                activeGeographyCluster?.id ??
                (geographyFilterActive && (state.neighborhood || state.cepPrefix)
                  ? "__stale"
                  : "")
              }
              disabled={
                !state.municipalityId ||
                (geographyClusters.length === 0 && !geographyFilterActive)
              }
              onChange={(event) => {
                const cluster = model.availableClusters.find(
                  (item) => item.id === event.target.value,
                );
                onGeographyChange(
                  state.municipalityId,
                  cluster?.neighborhood ?? null,
                  cluster?.cepPrefix ?? null,
                );
              }}
            >
              <option value="">Todos os bairros/CEPs visíveis</option>
              {geographyFilterActive && !activeGeographyCluster && (
                <option value="__stale">
                  {state.neighborhood ?? "Sem bairro"}
                  {state.cepPrefix ? ` · ${state.cepPrefix}-xxx` : ""} (
                  {model.filteredRecordCount})
                </option>
              )}
              {geographyClusters.map((cluster) => (
                <option value={cluster.id} key={cluster.id}>
                  {cluster.neighborhood} · {cluster.cepPrefix}-xxx ({cluster.count})
                </option>
              ))}
            </select>
          </label>
        </div>
        <small className="registration-geography-help">
          Só aparecem bairros/CEPs com pelo menos {model.privacyThreshold} cadastros no filtro atual.
        </small>
        {geographyFilterEmpty && (
          <p className="registration-empty-cluster" role="status">
            Nenhum cadastro para este recorte de bairro/CEP. Escolha outro
            bairro ou volte para "Todos os bairros/CEPs visíveis".
          </p>
        )}
        <label className="registration-window-control">
          <span>Período do cadastro</span>
          <select value={state.window} onChange={(event) => onWindowChange(event.target.value as RegistrationWindow)}>
            {Object.entries(REGISTRATION_WINDOW_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
          </select>
        </label>
        <span className="registration-filter-label">Origem</span>
        <div className="registration-filter-grid">
          {REGISTRATION_SOURCES.map((item) => (
            <button type="button" key={item} className={filterButtonClass(state.sources.includes(item))} aria-pressed={state.sources.includes(item)} onClick={() => onToggleSource(item)}>{REGISTRATION_SOURCE_LABELS[item]}</button>
          ))}
        </div>
        <span className="registration-filter-label">Acompanhamento</span>
        <div className="registration-filter-grid">
          {REGISTRATION_STATUSES.map((item) => (
            <button type="button" key={item} className={filterButtonClass(state.statuses.includes(item))} aria-pressed={state.statuses.includes(item)} onClick={() => onToggleStatus(item)}>{REGISTRATION_STATUS_LABELS[item]}</button>
          ))}
        </div>
      </section>

      <section className="analysis-filter-section">
        <div className="analysis-section-heading">
          <span><MapPinned size={14} /> Faixas em foco</span>
          {!allBandsActive && <button type="button" onClick={onShowAllBands}>Mostrar todas</button>}
        </div>
        <div className="analysis-band-list">
          {ALL_ANALYSIS_BANDS.map((band) => {
            const active = state.activeBands.includes(band);
            return (
              <button type="button" key={band} className={active ? "analysis-band--active" : ""} aria-pressed={active} onClick={() => onToggleBand(band)}>
                <span className="analysis-band-swatch" style={{ backgroundColor: ELECTORATE_COLORS[band] }} />
                <span className="analysis-band-copy"><strong>Faixa {band + 1}</strong><small>{getRegistrationRangeLabel(state.metricId, model.thresholds, band)}</small></span>
                <em>{model.bandCounts[band]}</em>
              </button>
            );
          })}
        </div>
      </section>

      <section className="registration-clusters">
        <div className="analysis-section-heading">
          <span><MapPinned size={14} /> {focusedMunicipalityId ? "Bairros/CEPs do município" : "Maiores grupos visíveis"}</span>
        </div>
        {selectedClusters.length > 0 ? (
          <div className="registration-cluster-list">
            {selectedClusters.map((cluster) => (
              <button type="button" key={cluster.id} onClick={() => {
                onGeographyChange(cluster.municipalityId, cluster.neighborhood, cluster.cepPrefix);
                onSelect(cluster.municipalityId);
              }}>
                <span><strong>{cluster.neighborhood}</strong><small>{cluster.municipalityName} · CEP {cluster.cepPrefix}-xxx</small></span>
                <em>{cluster.count}</em>
              </button>
            ))}
          </div>
        ) : (
          <p className="registration-empty-cluster">Nenhum grupo atingiu o mínimo de privacidade neste recorte.</p>
        )}
        {model.suppressedClusterCount > 0 && <small>{model.suppressedClusterCount} grupos pequenos estão ocultos.</small>}
      </section>

      <section className="analysis-ranking-section">
        <div className="analysis-ranking-header">
          <div><span>Ranking municipal</span><small>{model.metricShortLabel}</small></div>
          <div className="analysis-sort">
            <button type="button" className={state.sortDirection === "desc" ? "analysis-sort--active" : ""} onClick={() => onSortChange("desc")}><ArrowDown size={14} /> Maiores</button>
            <button type="button" className={state.sortDirection === "asc" ? "analysis-sort--active" : ""} onClick={() => onSortChange("asc")}><ArrowUp size={14} /> Menores</button>
          </div>
        </div>
        <div className="analysis-ranking-list">
          {visibleRanking.map((item) => (
            <button type="button" key={item.municipality.ibgeCode} onClick={() => onSelect(item.municipality.ibgeCode)}>
              <span className="analysis-rank-number">#{item.rank}</span>
              <span className="analysis-rank-main">
                <span><strong>{item.municipality.name}</strong><em>{formatRegistrationMetricValue(state.metricId, item.value)}</em></span>
                <span className="analysis-rank-track"><span style={{ width: `${Math.max(7, (item.value / Math.max(1, model.filteredItems[0]?.value ?? 1)) * 100)}%`, backgroundColor: ELECTORATE_COLORS[item.band ?? 0] }} /></span>
              </span>
              <MapPin size={14} />
            </button>
          ))}
        </div>
        {model.filteredItems.length > INITIAL_RANKING_SIZE && <button className="analysis-ranking-toggle" type="button" onClick={() => setShowAllRanking((current) => !current)}>{showAllRanking ? "Mostrar somente os 10 primeiros" : `Ver todos os ${model.filteredItems.length}`}</button>}
      </section>

      <section className="registration-actions">
        <button type="button" onClick={() => setShowForm((current) => !current)}><Plus size={15} /> Novo cadastro</button>
        <button type="button" onClick={() => fileInputRef.current?.click()} disabled={working}><Upload size={15} /> Importar CSV</button>
        <button type="button" onClick={handleTemplate}><FileDown size={15} /> Modelo CSV</button>
        <button type="button" onClick={handleExport} disabled={model.filteredItems.length === 0}><Download size={15} /> Exportar agregado</button>
        <input ref={fileInputRef} className="sr-only" type="file" accept=".csv,text/csv" onChange={(event) => void handleImport(event.target.files?.[0])} />
      </section>

      {showForm && (
        <form className="registration-form" onSubmit={(event) => void handleSubmit(event)}>
          <div className="analysis-section-heading"><span><Plus size={14} /> Cadastro sem dados pessoais</span></div>
          <label><span>CEP</span><div className="registration-cep-row"><input value={cep} onChange={(event) => { setCep(event.target.value); setResolvedCep(null); }} inputMode="numeric" placeholder="00000-000" maxLength={9} /><button type="button" onClick={() => void handleCepLookup()} disabled={working}>{working ? <LoaderCircle className="spin" size={14} /> : <MapPin size={14} />} Localizar</button></div></label>
          {resolvedCep && <div className="registration-resolved"><CheckCircle2 size={15} /><span><strong>{resolvedCep.neighborhood}</strong><small>{resolvedCep.municipalityName} · CEP {resolvedCep.cep.slice(0, 5)}-xxx</small></span></div>}
          <label><span>Referência externa (opcional)</span><input value={externalReference} onChange={(event) => setExternalReference(event.target.value)} maxLength={200} placeholder="Ex.: CRM-0001; será guardado apenas como hash" /></label>
          <div className="registration-form-grid">
            <label><span>Origem</span><select value={source} onChange={(event) => setSource(event.target.value as RegistrationSource)}>{REGISTRATION_SOURCES.map((item) => <option value={item} key={item}>{REGISTRATION_SOURCE_LABELS[item]}</option>)}</select></label>
            <label><span>Acompanhamento</span><select value={followUpStatus} onChange={(event) => setFollowUpStatus(event.target.value as Exclude<RegistrationFollowUpStatus, "revoked">)}>{["pending", "contacted", "completed"].map((item) => <option value={item} key={item}>{REGISTRATION_STATUS_LABELS[item as RegistrationFollowUpStatus]}</option>)}</select></label>
            <label><span>Canal do consentimento</span><input value={consentChannel} onChange={(event) => setConsentChannel(event.target.value)} required /></label>
            <label><span>Versão do termo</span><input value={consentVersion} onChange={(event) => setConsentVersion(event.target.value)} required /></label>
          </div>
          <label><span>Reter até</span><input type="date" value={retentionUntil} min={new Date().toISOString().slice(0, 10)} onChange={(event) => setRetentionUntil(event.target.value)} required /></label>
          <label className="registration-consent"><input type="checkbox" checked={consentConfirmed} onChange={(event) => setConsentConfirmed(event.target.checked)} /><span>Confirmo que o consentimento e sua versão foram registrados na origem.</span></label>
          <button className="registration-submit" type="submit" disabled={working || !resolvedCep || !consentConfirmed}>{working ? <LoaderCircle className="spin" size={15} /> : <ShieldCheck size={15} />} Salvar cadastro minimizado</button>
        </form>
      )}

      {mode === "synthetic-demo" && localRecordCount > 0 && (
        <button className="registration-clear-local" type="button" onClick={() => { if (window.confirm("Remover somente os cadastros de teste adicionados neste navegador?")) { onClearLocal(); showFeedback("Cadastros locais de teste removidos."); } }}><Trash2 size={14} /> Limpar {localRecordCount} testes locais</button>
      )}

      {(feedback || error || loading) && (
        <div className={`registration-feedback ${feedbackError || error ? "registration-feedback--error" : ""}`} role="status" aria-live="polite">
          {loading ? <LoaderCircle className="spin" size={15} /> : feedbackError || error ? <AlertTriangle size={15} /> : <CheckCircle2 size={15} />}
          <span>{loading ? "Carregando cadastros…" : feedback || error}</span>
        </div>
      )}

      <p className="comparison-note analysis-note">
        Uso operacional e agregado. O módulo não coleta intenção de voto, perfil
        sensível, nome, telefone ou CPF e não produz pontuação individual.
      </p>
    </div>
  );
}
