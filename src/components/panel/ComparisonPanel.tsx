import {
  ArrowLeft,
  GitCompareArrows,
  MapPin,
  Trash2,
  X,
} from "lucide-react";
import type { MunicipalityProfile } from "../../types/electorate";
import { formatAnalysisMetricValue } from "../../utils/analysis";
import { MAX_COMPARISON_ITEMS } from "../../utils/workspace";
import {
  formatInteger,
  formatPercent,
  percentage,
} from "../../utils/electorate";

type ComparisonPanelProps = {
  municipalities: MunicipalityProfile[];
  /** Exibe o aviso de limite atingido (disparado ao tentar adicionar com a lista cheia). */
  limitNoticeVisible?: boolean;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  onBackToOverview: () => void;
};

type ComparisonMetricProps = {
  label: string;
  municipalities: MunicipalityProfile[];
  getValue: (municipality: MunicipalityProfile) => number | null;
  formatValue: (value: number | null) => string;
};

function ComparisonMetric({
  label,
  municipalities,
  getValue,
  formatValue,
}: ComparisonMetricProps) {
  const maximum = Math.max(
    ...municipalities
      .map((municipality) => getValue(municipality))
      .filter((value): value is number => value !== null),
    1,
  );

  return (
    <section className="comparison-metric">
      <h3>{label}</h3>
      <div className="comparison-bars">
        {municipalities.map((municipality, index) => {
          const value = getValue(municipality);

          return (
            <div className="comparison-bar-row" key={municipality.ibgeCode}>
              <span className="comparison-bar-name">{municipality.name}</span>
              <div className="comparison-bar-track" aria-hidden="true">
                <span
                  className={`comparison-bar-fill comparison-bar-fill--${index + 1}`}
                  style={{
                    width: value === null ? "0%" : `${Math.max(3, (value / maximum) * 100)}%`,
                  }}
                />
              </div>
              <strong>{formatValue(value)}</strong>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function ComparisonPanel({
  municipalities,
  limitNoticeVisible = false,
  onSelect,
  onRemove,
  onClear,
  onBackToOverview,
}: ComparisonPanelProps) {
  return (
    <div className="sidebar-view" role="tabpanel" id="sidebar-compare-panel">
      <div className="workspace-view-header">
        <div>
          <span className="panel-eyebrow">Análise lado a lado</span>
          <h2>Comparar municípios</h2>
        </div>
        {municipalities.length > 0 && (
          <button
            className="workspace-clear-button"
            type="button"
            onClick={onClear}
            aria-label="Limpar comparação"
            title="Limpar comparação"
          >
            <Trash2 size={16} />
          </button>
        )}
      </div>

      <p className="workspace-description">
        Compare até três municípios com indicadores oficiais do TSE e do IBGE,
        mantendo o ano de cada fonte visível.
      </p>

      {limitNoticeVisible && (
        /* role="status" anuncia o aviso a leitores de tela sem roubar o foco. */
        <p className="comparison-limit-notice" role="status">
          Limite de {MAX_COMPARISON_ITEMS} municípios — remova um para
          adicionar outro.
        </p>
      )}

      {municipalities.length === 0 ? (
        <div className="workspace-empty-state">
          <GitCompareArrows size={28} />
          <strong>Nenhum município adicionado</strong>
          <span>
            Abra um município no mapa e use o botão “Comparar” no resumo. Com
            esta aba aberta, você também pode clicar nos municípios direto no
            mapa (ou buscá-los) para adicioná-los.
          </span>
          <button type="button" onClick={onBackToOverview}>
            <ArrowLeft size={15} />
            Voltar ao resumo
          </button>
        </div>
      ) : (
        <>
          <div className="comparison-selection-list">
            {municipalities.map((municipality, index) => (
              <div
                className={`comparison-selection comparison-selection--${index + 1}`}
                key={municipality.ibgeCode}
              >
                <button
                  className="comparison-selection-main"
                  type="button"
                  onClick={() => onSelect(municipality.ibgeCode)}
                >
                  <MapPin size={15} />
                  <span>
                    <strong>{municipality.name}</strong>
                    <small>#{municipality.stateRank} em Goiás</small>
                  </span>
                </button>
                <button
                  className="comparison-remove"
                  type="button"
                  onClick={() => onRemove(municipality.ibgeCode)}
                  aria-label={`Remover ${municipality.name} da comparação`}
                >
                  <X size={15} />
                </button>
              </div>
            ))}
          </div>

          {municipalities.length === 1 ? (
            <div className="comparison-add-more">
              <GitCompareArrows size={18} />
              <span>Adicione pelo menos mais um município para comparar.</span>
            </div>
          ) : (
            <div className="comparison-metrics">
              <h3 className="comparison-group-title">TSE · Eleitorado 2026</h3>
              <ComparisonMetric
                label="Eleitorado total"
                municipalities={municipalities}
                getValue={(municipality) => municipality.electorate}
                formatValue={(value) =>
                  value === null ? "Sem dado" : formatInteger(value)
                }
              />
              <ComparisonMetric
                label="Participação no eleitorado de Goiás"
                municipalities={municipalities}
                getValue={(municipality) => municipality.stateSharePct}
                formatValue={(value) =>
                  value === null ? "Sem dado" : formatPercent(value)
                }
              />
              <ComparisonMetric
                label="Cadastro com biometria"
                municipalities={municipalities}
                getValue={(municipality) => municipality.biometricsPct}
                formatValue={(value) =>
                  value === null ? "Sem dado" : formatPercent(value)
                }
              />
              <ComparisonMetric
                label="Deficiência cadastrada"
                municipalities={municipalities}
                getValue={(municipality) =>
                  percentage(
                    municipality.registeredDisability,
                    municipality.electorate,
                  )
                }
                formatValue={(value) =>
                  value === null ? "Sem dado" : formatPercent(value)
                }
              />
              <ComparisonMetric
                label="Zonas eleitorais"
                municipalities={municipalities}
                getValue={(municipality) => municipality.zoneCount}
                formatValue={(value) =>
                  value === null ? "Sem dado" : formatInteger(value)
                }
              />
              <h3 className="comparison-group-title">IBGE · Perfil socioeconômico</h3>
              <ComparisonMetric
                label="População estimada · 2025"
                municipalities={municipalities}
                getValue={(municipality) =>
                  municipality.socioeconomic.populationEstimate
                }
                formatValue={(value) =>
                  formatAnalysisMetricValue("populationEstimate", value)
                }
              />
              <ComparisonMetric
                label="Densidade demográfica · 2022"
                municipalities={municipalities}
                getValue={(municipality) =>
                  municipality.socioeconomic.populationDensity
                }
                formatValue={(value) =>
                  formatAnalysisMetricValue("populationDensity", value)
                }
              />
              <ComparisonMetric
                label="PIB per capita · 2023"
                municipalities={municipalities}
                getValue={(municipality) => municipality.socioeconomic.gdpPerCapita}
                formatValue={(value) =>
                  formatAnalysisMetricValue("gdpPerCapita", value)
                }
              />
              <ComparisonMetric
                label="Escolarização de 6 a 14 anos · 2022"
                municipalities={municipalities}
                getValue={(municipality) =>
                  municipality.socioeconomic.schoolAttendance
                }
                formatValue={(value) =>
                  formatAnalysisMetricValue("schoolAttendance", value)
                }
              />
              <ComparisonMetric
                label="População ocupada · 2022"
                municipalities={municipalities}
                getValue={(municipality) =>
                  municipality.socioeconomic.occupiedPopulation
                }
                formatValue={(value) =>
                  formatAnalysisMetricValue("occupiedPopulation", value)
                }
              />
              <ComparisonMetric
                label="Salário formal médio · 2024"
                municipalities={municipalities}
                getValue={(municipality) =>
                  municipality.socioeconomic.formalAverageSalary
                }
                formatValue={(value) =>
                  formatAnalysisMetricValue("formalAverageSalary", value)
                }
              />
            </div>
          )}
        </>
      )}

      <p className="comparison-note">
        As barras são relativas somente aos municípios adicionados. Anos
        distintos refletem a publicação oficial de cada indicador; não são
        tratados como se pertencessem ao mesmo período.
      </p>
    </div>
  );
}
