import {
  Bookmark,
  BookmarkCheck,
  Clock3,
  GitCompareArrows,
  History,
  MapPin,
  Trash2,
} from "lucide-react";
import type { MunicipalityElectorate } from "../../types/electorate";
import type { MunicipalityHistoryEntry } from "../../types/workspace";
import { formatInteger } from "../../utils/electorate";
import { getSelectionSourceLabel } from "../../utils/workspace";

type HistoryPanelProps = {
  municipalityById: Record<string, MunicipalityElectorate>;
  history: MunicipalityHistoryEntry[];
  favorites: string[];
  comparison: string[];
  comparisonFull: boolean;
  onSelect: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  onAddToComparison: (id: string) => void;
  onOpenComparison: () => void;
  onClearHistory: () => void;
};

type TerritoryRowProps = {
  municipality: MunicipalityElectorate;
  detail: string;
  favorite: boolean;
  compared: boolean;
  comparisonFull: boolean;
  onSelect: () => void;
  onToggleFavorite: () => void;
  onCompare: () => void;
};

function formatVisitTime(timestamp: number) {
  const visited = new Date(timestamp);
  const now = new Date();
  const sameDay = visited.toDateString() === now.toDateString();

  if (sameDay) {
    return `Hoje, ${visited.toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    })}`;
  }

  return visited.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function TerritoryRow({
  municipality,
  detail,
  favorite,
  compared,
  comparisonFull,
  onSelect,
  onToggleFavorite,
  onCompare,
}: TerritoryRowProps) {
  return (
    <div className="territory-row">
      <button className="territory-row-main" type="button" onClick={onSelect}>
        <span className="territory-row-pin">
          <MapPin size={15} />
        </span>
        <span className="territory-row-copy">
          <strong>{municipality.name}</strong>
          <small>{formatInteger(municipality.electorate)} eleitores</small>
          <span>{detail}</span>
        </span>
      </button>
      <div className="territory-row-actions">
        <button
          type="button"
          onClick={onToggleFavorite}
          className={favorite ? "territory-action--active" : ""}
          aria-pressed={favorite}
          aria-label={
            favorite
              ? `Remover ${municipality.name} dos favoritos`
              : `Salvar ${municipality.name} nos favoritos`
          }
          title={favorite ? "Remover dos salvos" : "Salvar município"}
        >
          {favorite ? <BookmarkCheck size={15} /> : <Bookmark size={15} />}
        </button>
        <button
          type="button"
          onClick={onCompare}
          className={compared ? "territory-action--active" : ""}
          disabled={!compared && comparisonFull}
          aria-label={
            compared
              ? `Abrir comparação com ${municipality.name}`
              : `Adicionar ${municipality.name} à comparação`
          }
          title={
            compared
              ? "Abrir comparação"
              : comparisonFull
                ? "Limite de três municípios"
                : "Adicionar à comparação"
          }
        >
          <GitCompareArrows size={15} />
        </button>
      </div>
    </div>
  );
}

export function HistoryPanel({
  municipalityById,
  history,
  favorites,
  comparison,
  comparisonFull,
  onSelect,
  onToggleFavorite,
  onAddToComparison,
  onOpenComparison,
  onClearHistory,
}: HistoryPanelProps) {
  const favoriteMunicipalities = favorites
    .map((id) => municipalityById[id])
    .filter((municipality): municipality is MunicipalityElectorate =>
      Boolean(municipality),
    );
  const historyItems = history
    .map((entry) => ({ entry, municipality: municipalityById[entry.id] }))
    .filter(
      (
        item,
      ): item is {
        entry: MunicipalityHistoryEntry;
        municipality: MunicipalityElectorate;
      } => Boolean(item.municipality),
    );

  const handleComparison = (id: string) => {
    if (comparison.includes(id)) {
      onOpenComparison();
      return;
    }

    onAddToComparison(id);
  };

  return (
    <div className="sidebar-view" role="tabpanel" id="sidebar-history-panel">
      <div className="workspace-view-header">
        <div>
          <span className="panel-eyebrow">Sua navegação</span>
          <h2>Histórico e salvos</h2>
        </div>
        {history.length > 0 && (
          <button
            className="workspace-clear-button"
            type="button"
            onClick={onClearHistory}
            aria-label="Limpar histórico de navegação"
            title="Limpar histórico"
          >
            <Trash2 size={16} />
          </button>
        )}
      </div>

      <p className="workspace-description">
        Informações salvas somente neste navegador. Isto não é uma série
        histórica de eleições.
      </p>

      <section className="territory-list-section">
        <div className="territory-list-heading">
          <BookmarkCheck size={15} />
          <strong>Municípios salvos</strong>
          <span>{favoriteMunicipalities.length}</span>
        </div>

        {favoriteMunicipalities.length === 0 ? (
          <div className="territory-list-empty">
            <Bookmark size={19} />
            Use o ícone de salvar no resumo de um município.
          </div>
        ) : (
          <div className="territory-list">
            {favoriteMunicipalities.map((municipality) => (
              <TerritoryRow
                key={municipality.ibgeCode}
                municipality={municipality}
                detail={`Salvo · #${municipality.stateRank} em Goiás`}
                favorite
                compared={comparison.includes(municipality.ibgeCode)}
                comparisonFull={comparisonFull}
                onSelect={() => onSelect(municipality.ibgeCode)}
                onToggleFavorite={() =>
                  onToggleFavorite(municipality.ibgeCode)
                }
                onCompare={() => handleComparison(municipality.ibgeCode)}
              />
            ))}
          </div>
        )}
      </section>

      <section className="territory-list-section">
        <div className="territory-list-heading">
          <History size={15} />
          <strong>Visitados recentemente</strong>
          <span>{historyItems.length}</span>
        </div>

        {historyItems.length === 0 ? (
          <div className="territory-list-empty">
            <Clock3 size={19} />
            Os municípios abertos no mapa aparecerão aqui.
          </div>
        ) : (
          <div className="territory-list">
            {historyItems.map(({ entry, municipality }) => (
              <TerritoryRow
                key={entry.id}
                municipality={municipality}
                detail={`${formatVisitTime(entry.visitedAt)} · ${getSelectionSourceLabel(entry.source)}`}
                favorite={favorites.includes(entry.id)}
                compared={comparison.includes(entry.id)}
                comparisonFull={comparisonFull}
                onSelect={() => onSelect(entry.id)}
                onToggleFavorite={() => onToggleFavorite(entry.id)}
                onCompare={() => handleComparison(entry.id)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
