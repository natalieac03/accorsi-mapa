import {
  Accessibility,
  Bookmark,
  BookmarkCheck,
  BookOpenCheck,
  BriefcaseBusiness,
  Building2,
  CircleDollarSign,
  Fingerprint,
  GitCompareArrows,
  History,
  Lightbulb,
  LocateFixed,
  MapPinned,
  PersonStanding,
  RotateCcw,
  School,
  ScanLine,
  Trophy,
  UsersRound,
  Vote,
} from "lucide-react";
import type {
  ElectorateMetadata,
  MunicipalitySelection,
} from "../../types/electorate";
import type { SocioeconomicMetadata } from "../../types/socioeconomic";
import type { SelectedTerritorialLocation } from "../../types/search";
import {
  formatInteger,
  formatPercent,
  formatPercentagePoints,
  percentage,
} from "../../utils/electorate";
import {
  formatAnalysisMetricValue,
  getAnalysisMetricValue,
} from "../../utils/analysis";
import { formatSourceRetrievalDate } from "../../utils/socioeconomic";
import { getTopElectoratePercent } from "../../utils/workspace";

type OverviewPanelProps = {
  metadata: ElectorateMetadata;
  socioeconomicMetadata: SocioeconomicMetadata;
  selected: MunicipalitySelection | null;
  territorialLocation: SelectedTerritorialLocation | null;
  stateBiometricsPct: number;
  favoritesCount: number;
  historyCount: number;
  comparisonCount: number;
  selectionCount: number;
  isFavorite: boolean;
  isCompared: boolean;
  isInSelection: boolean;
  comparisonFull: boolean;
  selectionFull: boolean;
  onToggleFavorite: () => void;
  onAddToComparison: () => void;
  onOpenComparison: () => void;
  onOpenHistory: () => void;
  onToggleSelection: () => void;
  onOpenSelection: () => void;
  onReset: () => void;
};

export function OverviewPanel({
  metadata,
  socioeconomicMetadata,
  selected,
  territorialLocation,
  stateBiometricsPct,
  favoritesCount,
  historyCount,
  comparisonCount,
  selectionCount,
  isFavorite,
  isCompared,
  isInSelection,
  comparisonFull,
  selectionFull,
  onToggleFavorite,
  onAddToComparison,
  onOpenComparison,
  onOpenHistory,
  onToggleSelection,
  onOpenSelection,
  onReset,
}: OverviewPanelProps) {
  const metrics = selected?.metrics;

  if (!selected || !metrics) {
    return (
      <div className="sidebar-view" role="tabpanel" id="sidebar-overview-panel">
        <div className="panel-icon">
          <MapPinned size={22} />
        </div>
        <span className="panel-eyebrow">Goiás</span>
        <h2>{formatInteger(metadata.stateElectorate)}</h2>
        <p className="state-total-label">eleitores aptos em 2026</p>

        <div className="state-summary">
          <div>
            <strong>{metadata.municipalityCount}</strong>
            <span>municípios</span>
          </div>
          <div>
            <strong>{formatInteger(metadata.processedRows)}</strong>
            <span>registros processados</span>
          </div>
        </div>

        <p className="panel-help">
          Pesquise ou clique em um município para abrir seu perfil territorial.
          Os atalhos abaixo ficam salvos neste navegador.
        </p>

        <div className="workspace-shortcuts">
          <button type="button" onClick={onOpenHistory}>
            <History size={17} />
            <span>
              <strong>{historyCount}</strong>
              recentes
            </span>
          </button>
          <button type="button" onClick={onOpenHistory}>
            <Bookmark size={17} />
            <span>
              <strong>{favoritesCount}</strong>
              salvos
            </span>
          </button>
          <button type="button" onClick={onOpenComparison}>
            <GitCompareArrows size={17} />
            <span>
              <strong>{comparisonCount}</strong>
              comparando
            </span>
          </button>
          <button type="button" onClick={onOpenSelection}>
            <ScanLine size={17} />
            <span>
              <strong>{selectionCount}</strong>
              no recorte
            </span>
          </button>
        </div>

        <div className="panel-source panel-source--stacked">
          <span>Dados oficiais do TSE · extração de {metadata.profileGeneratedAt}</span>
          <a href={socioeconomicMetadata.sourceUrl} target="_blank" rel="noreferrer">
            IBGE · {socioeconomicMetadata.indicatorCount} indicadores oficiais
          </a>
        </div>
      </div>
    );
  }

  const femalePct = percentage(metrics.gender.female, metrics.electorate);
  const malePct = percentage(metrics.gender.male, metrics.electorate);
  const notInformedPct = percentage(
    metrics.gender.notInformed,
    metrics.electorate,
  );
  const topPercent = getTopElectoratePercent(
    metrics.stateRank,
    metadata.municipalityCount,
  );
  const biometricsDifference = metrics.biometricsPct - stateBiometricsPct;
  const biometricsDirection = biometricsDifference >= 0 ? "acima" : "abaixo";

  return (
    <div className="sidebar-view" role="tabpanel" id="sidebar-overview-panel">
      <span className="panel-eyebrow">Município selecionado</span>
      <div className="panel-title-row">
        <div>
          <h2>{selected.name}</h2>
          <p className="municipality-code">Código IBGE: {selected.id}</p>
        </div>
        <button
          className={`favorite-button ${isFavorite ? "favorite-button--active" : ""}`}
          type="button"
          onClick={onToggleFavorite}
          aria-pressed={isFavorite}
          aria-label={
            isFavorite
              ? `Remover ${selected.name} dos favoritos`
              : `Salvar ${selected.name} nos favoritos`
          }
          title={isFavorite ? "Remover dos salvos" : "Salvar município"}
        >
          {isFavorite ? <BookmarkCheck size={19} /> : <Bookmark size={19} />}
        </button>
      </div>

      {territorialLocation && (
        <section className="territorial-context" aria-label="Local pesquisado">
          <div className="territorial-context-heading">
            <LocateFixed size={16} />
            <div>
              <span>
                {territorialLocation.kind === "cep"
                  ? "CEP selecionado"
                  : territorialLocation.kind === "neighborhood"
                    ? "Bairro selecionado"
                    : territorialLocation.kind === "address"
                      ? "Endereço selecionado"
                      : "Lugar selecionado"}
              </span>
              <strong>{territorialLocation.title}</strong>
            </div>
          </div>
          <p>{territorialLocation.address}</p>
          <div className="territorial-context-tags">
            {territorialLocation.neighborhood && (
              <span>Bairro: {territorialLocation.neighborhood}</span>
            )}
            {territorialLocation.cep && (
              <span>CEP: {territorialLocation.cep}</span>
            )}
          </div>
          <small>
            O local foi preservado no mapa. Os números abaixo continuam
            agregados para {territorialLocation.municipalityName}.
          </small>
        </section>
      )}

      <div className="primary-stat">
        <span>Eleitorado total</span>
        <strong>{formatInteger(metrics.electorate)}</strong>
        <small>{formatPercent(metrics.stateSharePct)} do eleitorado de Goiás</small>
      </div>

      <div className="metric-grid">
        <div className="metric-card">
          <Trophy size={17} />
          <span>Ranking estadual</span>
          <strong>{metrics.stateRank}º</strong>
        </div>
        <div className="metric-card">
          <Fingerprint size={17} />
          <span>Com biometria</span>
          <strong>{formatPercent(metrics.biometricsPct)}</strong>
        </div>
        <div className="metric-card">
          <Accessibility size={17} />
          <span>Deficiência cadastrada</span>
          <strong>{formatInteger(metrics.registeredDisability)}</strong>
        </div>
        <div className="metric-card">
          <MapPinned size={17} />
          <span>Zonas eleitorais</span>
          <strong>{metrics.zoneCount}</strong>
        </div>
      </div>

      <section className="socioeconomic-section" aria-label="Perfil socioeconômico do IBGE">
        <div className="socioeconomic-heading">
          <div>
            <Building2 size={16} />
            <strong>Perfil socioeconômico</strong>
          </div>
          <span>IBGE</span>
        </div>

        <div className="socioeconomic-primary">
          <span>População estimada · 2025</span>
          <strong>
            {formatAnalysisMetricValue(
              "populationEstimate",
              metrics.socioeconomic.populationEstimate,
            )}
          </strong>
          <small>
            Censo 2022: {formatAnalysisMetricValue(
              "censusPopulation",
              metrics.socioeconomic.censusPopulation,
            )}
          </small>
        </div>

        <div className="socioeconomic-grid">
          <div>
            <UsersRound size={15} />
            <span>Densidade · 2022</span>
            <strong>
              {formatAnalysisMetricValue(
                "populationDensity",
                metrics.socioeconomic.populationDensity,
              )}
            </strong>
          </div>
          <div>
            <CircleDollarSign size={15} />
            <span>PIB per capita · 2023</span>
            <strong>
              {formatAnalysisMetricValue(
                "gdpPerCapita",
                metrics.socioeconomic.gdpPerCapita,
              )}
            </strong>
          </div>
          <div>
            <School size={15} />
            <span>Escolarização 6–14 · 2022</span>
            <strong>
              {formatAnalysisMetricValue(
                "schoolAttendance",
                metrics.socioeconomic.schoolAttendance,
              )}
            </strong>
          </div>
          <div>
            <BriefcaseBusiness size={15} />
            <span>População ocupada · 2022</span>
            <strong>
              {formatAnalysisMetricValue(
                "occupiedPopulation",
                metrics.socioeconomic.occupiedPopulation,
              )}
            </strong>
          </div>
          <div>
            <PersonStanding size={15} />
            <span>Salário formal · 2024</span>
            <strong>
              {formatAnalysisMetricValue(
                "formalAverageSalary",
                metrics.socioeconomic.formalAverageSalary,
              )}
            </strong>
          </div>
          <div>
            <Building2 size={15} />
            <span>Saneamento adequado · 2022</span>
            <strong>
              {formatAnalysisMetricValue(
                "adequateSanitation",
                metrics.socioeconomic.adequateSanitation,
              )}
            </strong>
          </div>
          {metrics.literacy && (
            <div>
              <BookOpenCheck size={15} />
              <span>Alfabetização 15+ · Censo 2022</span>
              <strong>
                {formatAnalysisMetricValue(
                  "literacyRate15Plus",
                  getAnalysisMetricValue(metrics, "literacyRate15Plus"),
                )}
              </strong>
            </div>
          )}
          {metrics.age && (
            <>
              <div>
                <UsersRound size={15} />
                <span>População 16+ (2022)</span>
                <strong>
                  {formatAnalysisMetricValue(
                    "population16Plus",
                    metrics.age.population16Plus,
                  )}
                </strong>
              </div>
              <div>
                <Vote size={15} />
                <span>Penetração eleitoral</span>
                <strong>
                  {formatAnalysisMetricValue(
                    "electoralPenetration",
                    getAnalysisMetricValue(metrics, "electoralPenetration"),
                  )}
                </strong>
              </div>
            </>
          )}
        </div>

        {metrics.age && (
          <p className="comparison-note">
            Penetração eleitoral compara o eleitorado de 2026 com a população
            16+ do Censo 2022; acima de 100% indica eleitores com título no
            município morando fora dele.
          </p>
        )}

        <div className="socioeconomic-historical">
          <span>Renda per capita até 1/2 salário mínimo · referência histórica 2010</span>
          <strong>
            {formatAnalysisMetricValue(
              "lowIncomePopulation",
              metrics.socioeconomic.lowIncomePopulation,
            )}
          </strong>
        </div>

        <a
          className="socioeconomic-source-link"
          href={socioeconomicMetadata.sourceUrl}
          target="_blank"
          rel="noreferrer"
        >
          Fonte: {socioeconomicMetadata.source} · consulta em{" "}
          {formatSourceRetrievalDate(socioeconomicMetadata.retrievedAtUtc)}
        </a>
      </section>

      <section className="insight-section" aria-label="Leitura rápida">
        <div className="section-heading-inline">
          <Lightbulb size={15} />
          <strong>Leitura rápida</strong>
        </div>
        <div className="insight-list">
          <div>
            <span>Posição relativa</span>
            <strong>Entre os {topPercent}% maiores eleitorados de Goiás</strong>
          </div>
          <div>
            <span>Biometria versus estado</span>
            <strong>
              {formatPercentagePoints(Math.abs(biometricsDifference))}{" "}
              {biometricsDirection}
            </strong>
          </div>
        </div>
      </section>

      <section className="demographic-section">
        <div className="demographic-heading">
          <span>Faixa etária mais numerosa</span>
          <strong>{metrics.topAgeGroup.label}</strong>
          <small>
            {formatInteger(metrics.topAgeGroup.electorate)} eleitores ·{" "}
            {formatPercent(metrics.topAgeGroup.percentage)}
          </small>
        </div>

        <div className="gender-summary">
          <div className="gender-header">
            <span>Distribuição por gênero</span>
            <small>cadastro eleitoral</small>
          </div>
          <div className="gender-bar" aria-hidden="true">
            <span
              className="gender-bar--female"
              style={{ width: `${femalePct}%` }}
            />
            <span
              className="gender-bar--male"
              style={{ width: `${malePct}%` }}
            />
            {notInformedPct > 0 && (
              <span
                className="gender-bar--unknown"
                style={{ width: `${notInformedPct}%` }}
              />
            )}
          </div>
          <div className="gender-labels">
            <span>Feminino {formatPercent(femalePct)}</span>
            <span>Masculino {formatPercent(malePct)}</span>
            {notInformedPct > 0 && (
              <span>Não informado {formatPercent(notInformedPct)}</span>
            )}
          </div>
        </div>
      </section>

      <div className="panel-action-row">
        <button
          className="panel-action-button"
          type="button"
          onClick={isCompared ? onOpenComparison : onAddToComparison}
          disabled={!isCompared && comparisonFull}
        >
          <GitCompareArrows size={16} />
          {isCompared
            ? "Ver comparação"
            : comparisonFull
              ? "Limite de 3"
              : "Comparar"}
        </button>
        <button
          className="panel-action-button"
          type="button"
          onClick={isInSelection ? onOpenSelection : onToggleSelection}
          disabled={!isInSelection && selectionFull}
        >
          <ScanLine size={16} />
          {isInSelection
            ? "No recorte"
            : selectionFull
              ? "Limite de 30"
              : "Adicionar"}
        </button>
        <button
          className="panel-action-button"
          type="button"
          onClick={onToggleFavorite}
        >
          {isFavorite ? <BookmarkCheck size={16} /> : <Bookmark size={16} />}
          {isFavorite ? "Salvo" : "Salvar"}
        </button>
      </div>

      <button className="reset-button" type="button" onClick={onReset}>
        <RotateCcw size={17} />
        Voltar para todo o estado
      </button>

      <div className="panel-source panel-source--stacked">
        <span>Fonte eleitoral: TSE · 2026 · {metadata.profileGeneratedAt}</span>
        <a href={socioeconomicMetadata.sourceUrl} target="_blank" rel="noreferrer">
          Fonte socioeconômica: IBGE · anos indicados em cada métrica
        </a>
      </div>
    </div>
  );
}
