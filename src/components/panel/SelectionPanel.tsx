import {
  Accessibility,
  BookOpenCheck,
  Copy,
  Download,
  Fingerprint,
  MapPin,
  MousePointer2,
  ScanLine,
  Sparkles,
  Star,
  Trash2,
  UsersRound,
  UserRound,
  Vote,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { AnalysisModel, AnalysisState } from "../../types/analysis";
import type { MunicipalityProfile } from "../../types/electorate";
import {
  aggregateTerritorialSelection,
  createSharedWorkspaceUrl,
  createTerritorialSelectionCsv,
  getTerritorialSelectionCsvFilename,
  MAX_TERRITORIAL_SELECTION,
} from "../../utils/selection";
import { copyTextToClipboard, downloadTextFile } from "../../utils/browser";
import { formatDecimal, formatInteger, formatPercent } from "../../utils/electorate";

type SelectionPanelProps = {
  municipalityById: Record<string, MunicipalityProfile>;
  selectionIds: string[];
  favoriteIds: string[];
  stateElectorate: number;
  year: number;
  analysisModel: AnalysisModel;
  analysisState: AnalysisState;
  mapMode: boolean;
  onSetMapMode: (active: boolean) => void;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onAddIds: (ids: string[]) => void;
  onClear: () => void;
};

export function SelectionPanel({
  municipalityById,
  selectionIds,
  favoriteIds,
  stateElectorate,
  year,
  analysisModel,
  analysisState,
  mapMode,
  onSetMapMode,
  onSelect,
  onRemove,
  onAddIds,
  onClear,
}: SelectionPanelProps) {
  const [feedback, setFeedback] = useState("");
  const municipalities = useMemo(
    () =>
      selectionIds
        .map((id) => municipalityById[id])
        .filter((item): item is MunicipalityProfile => Boolean(item)),
    [municipalityById, selectionIds],
  );
  const sortedMunicipalities = useMemo(
    () =>
      municipalities
        .slice()
        .sort(
          (a, b) =>
            b.electorate - a.electorate ||
            a.name.localeCompare(b.name, "pt-BR"),
        ),
    [municipalities],
  );
  const summary = useMemo(
    () => aggregateTerritorialSelection(municipalities, stateElectorate),
    [municipalities, stateElectorate],
  );
  const selectedSet = new Set(selectionIds);
  const analysisCandidates = analysisModel.filteredItems
    .map((item) => item.municipality.ibgeCode)
    .filter((id) => !selectedSet.has(id))
    .slice(0, 10);
  const favoriteCandidates = favoriteIds.filter((id) => !selectedSet.has(id));
  const availableSlots = MAX_TERRITORIAL_SELECTION - selectionIds.length;

  const handleShare = async () => {
    if (selectionIds.length === 0 || typeof window === "undefined") return;
    const url = createSharedWorkspaceUrl(
      window.location.href,
      analysisState,
      selectionIds,
    );
    const copied = await copyTextToClipboard(url);
    setFeedback(
      copied
        ? "Link copiado com o recorte e a análise atual."
        : "Não foi possível copiar o link neste navegador.",
    );
  };

  const handleExport = () => {
    if (municipalities.length === 0) return;
    downloadTextFile(
      createTerritorialSelectionCsv(municipalities, year),
      getTerritorialSelectionCsvFilename(),
      "text/csv;charset=utf-8",
    );
    setFeedback(`${municipalities.length} municípios exportados em CSV.`);
  };

  return (
    <div className="sidebar-view" role="tabpanel" id="sidebar-selection-panel">
      <div className="workspace-view-header">
        <div>
          <span className="panel-eyebrow">Grupo personalizado</span>
          <h2>Recorte territorial</h2>
        </div>
        {selectionIds.length > 0 && (
          <button
            className="workspace-clear-button"
            type="button"
            onClick={onClear}
            aria-label="Limpar recorte territorial"
            title="Limpar recorte"
          >
            <Trash2 size={16} />
          </button>
        )}
      </div>

      <p className="workspace-description">
        Reúna até {MAX_TERRITORIAL_SELECTION} municípios e calcule um perfil
        agregado usando os totais oficiais.
      </p>

      <button
        className={`selection-map-mode ${mapMode ? "selection-map-mode--active" : ""}`}
        type="button"
        aria-pressed={mapMode}
        onClick={() => onSetMapMode(!mapMode)}
      >
        <span>
          <MousePointer2 size={18} />
          <span>
            <strong>Selecionar direto no mapa</strong>
            <small>
              {mapMode
                ? "Ativo: clique nos municípios para alternar"
                : "Ative e depois clique nos polígonos"}
            </small>
          </span>
        </span>
        <em>{mapMode ? "Ativo" : "Ativar"}</em>
      </button>

      <div className="selection-quick-actions">
        <button
          type="button"
          disabled={analysisCandidates.length === 0 || availableSlots === 0}
          onClick={() => onAddIds(analysisCandidates)}
        >
          <Sparkles size={15} />
          <span>
            <strong>10 primeiros da Análise</strong>
            <small>{analysisModel.metric.shortLabel}</small>
          </span>
        </button>
        <button
          type="button"
          disabled={favoriteCandidates.length === 0 || availableSlots === 0}
          onClick={() => onAddIds(favoriteCandidates)}
        >
          <Star size={15} />
          <span>
            <strong>Adicionar favoritos</strong>
            <small>{favoriteCandidates.length} disponíveis</small>
          </span>
        </button>
      </div>

      {municipalities.length === 0 ? (
        <div className="workspace-empty-state selection-empty-state">
          <ScanLine size={29} />
          <strong>Seu recorte está vazio</strong>
          <span>
            Ative a seleção pelo mapa ou abra um município e use “Adicionar”.
          </span>
          <button type="button" onClick={() => onSetMapMode(true)}>
            <MousePointer2 size={15} />
            Selecionar no mapa
          </button>
        </div>
      ) : (
        <>
          <section className="selection-summary" aria-label="Perfil agregado">
            <div className="selection-summary-primary">
              <span>Eleitorado reunido</span>
              <strong>{formatInteger(summary.electorate)}</strong>
              <small>{formatPercent(summary.stateSharePct)} de Goiás</small>
            </div>
            <div>
              <UsersRound size={15} />
              <span>População estimada · 2025</span>
              <strong>{formatInteger(summary.populationEstimate)}</strong>
            </div>
            <div>
              <Fingerprint size={15} />
              <span>Biometria</span>
              <strong>{formatPercent(summary.biometricsPct)}</strong>
            </div>
            <div>
              <Accessibility size={15} />
              <span>Deficiência</span>
              <strong>{formatPercent(summary.disabilityPct)}</strong>
            </div>
            <div>
              <UserRound size={15} />
              <span>Mulheres</span>
              <strong>{formatPercent(summary.femalePct)}</strong>
            </div>
            <div>
              <ScanLine size={15} />
              <span>Nome social</span>
              <strong>
                {formatDecimal(summary.socialNamePerTenThousand)} / 10 mil
              </strong>
            </div>
            <div>
              <UsersRound size={15} />
              <span>População 16+ · 2022</span>
              <strong>
                {summary.electoralPenetrationPct === null
                  ? "Sem dado"
                  : formatInteger(summary.population16Plus)}
              </strong>
            </div>
            <div>
              <Vote size={15} />
              <span>Penetração eleitoral</span>
              <strong>
                {summary.electoralPenetrationPct === null
                  ? "Sem dado"
                  : formatPercent(summary.electoralPenetrationPct)}
              </strong>
            </div>
            <div>
              <BookOpenCheck size={15} />
              <span>Alfabetização 15+ · 2022</span>
              <strong>
                {summary.literacyRatePct === null
                  ? "Sem dado"
                  : formatPercent(summary.literacyRatePct)}
              </strong>
            </div>
          </section>

          {summary.missingAgeCount > 0 && (
            <p className="comparison-note selection-note">
              {summary.missingAgeCount}{" "}
              {summary.missingAgeCount === 1
                ? "município do recorte não possui"
                : "municípios do recorte não possuem"}{" "}
              estrutura etária do Censo 2022 e ficam fora da população 16+ e da
              penetração eleitoral.
            </p>
          )}

          {summary.missingLiteracyCount > 0 && (
            <p className="comparison-note selection-note">
              {summary.missingLiteracyCount}{" "}
              {summary.missingLiteracyCount === 1
                ? "município do recorte não possui"
                : "municípios do recorte não possuem"}{" "}
              alfabetização do Censo 2022 e ficam fora da taxa agregada de
              alfabetização 15+.
            </p>
          )}

          {summary.largestMunicipality && (
            <div className="selection-highlight">
              <span>Maior eleitorado do grupo</span>
              <strong>{summary.largestMunicipality.name}</strong>
              <small>
                {formatInteger(summary.largestMunicipality.electorate)} eleitores
              </small>
            </div>
          )}

          <section className="selection-list-section">
            <div className="territory-list-heading">
              <ScanLine size={15} />
              <strong>Municípios do recorte</strong>
              <span>
                {selectionIds.length}/{MAX_TERRITORIAL_SELECTION}
              </span>
            </div>
            <div className="selection-list">
              {sortedMunicipalities.map((municipality) => (
                <div className="selection-row" key={municipality.ibgeCode}>
                  <button
                    className="selection-row-main"
                    type="button"
                    onClick={() => onSelect(municipality.ibgeCode)}
                  >
                    <MapPin size={14} />
                    <span>
                      <strong>{municipality.name}</strong>
                      <small>
                        {formatInteger(municipality.electorate)} eleitores · #
                        {municipality.stateRank} em Goiás
                      </small>
                    </span>
                  </button>
                  <button
                    className="selection-row-remove"
                    type="button"
                    onClick={() => onRemove(municipality.ibgeCode)}
                    aria-label={`Remover ${municipality.name} do recorte`}
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          </section>

          <div className="selection-output-actions">
            <button type="button" onClick={() => void handleShare()}>
              <Copy size={15} />
              Copiar link
            </button>
            <button type="button" onClick={handleExport}>
              <Download size={15} />
              Baixar CSV
            </button>
          </div>
        </>
      )}

      <div className="selection-feedback" role="status" aria-live="polite">
        {feedback}
      </div>
      <p className="comparison-note selection-note">
        Percentuais do grupo usam somas ponderadas. O link contém apenas códigos
        municipais e preferências da análise; não inclui buscas ou dados pessoais.
      </p>
    </div>
  );
}
