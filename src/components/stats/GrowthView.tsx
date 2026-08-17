import { Download, Search, TrendingUp, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { GrowthArrow, GrowthModel, GrowthSeries } from "../../types/candidate";
import { formatCompactPt } from "../../utils/candidate";
import { formatInteger } from "../../utils/electorate";

/**
 * Visão "Geral" de um grupo: o crescimento da votação ao longo das eleições.
 *
 * Duas leituras da MESMA série, porque respondem a perguntas diferentes:
 * o gráfico de linhas mostra o formato da curva (subiu sempre? estagnou?), e
 * a régua de setas embaixo dá o número exato de cada passagem — que é o que
 * se leva para uma reunião.
 *
 * O que este componente se recusa a fazer: ligar a linha por cima de um pleito
 * sem apuração. Um bairro que não aparece num ano tem o segmento INTERROMPIDO,
 * não interpolado — a linha atravessando o buraco afirmaria uma votação que
 * ninguém apurou.
 */

/*
 * Cores das séries, em ordem fixa (nunca cicladas: acima de 6 recortes a
 * interface para de aceitar em vez de repetir cor). Validadas com o validador
 * da skill de dataviz sobre a superfície clara da janela:
 *   faixa de luminosidade  6/6 dentro de L 0,43–0,77
 *   piso de croma          6/6 >= 0,1
 *   separação CVD          pior par adjacente ΔE 11,0 (deuteranopia)
 *   visão normal           pior par adjacente ΔE 18,2
 *   contraste na superfície 6/6 >= 3:1
 * A identidade nunca é só cor: cada série é rotulada por extenso na sua régua
 * de setas e na legenda, e a primeira cor é o vermelho do total.
 */
const CORES_SERIE = [
  "#c1121f",
  "#2a78d6",
  "#1f8a70",
  "#b45309",
  "#7c3aed",
  "#0891b2",
];

/** Teto de recortes comparados ao mesmo tempo — acima disso a leitura embola. */
export const MAX_RECORTES = CORES_SERIE.length - 1;

const CHART_W = 720;
const CHART_H = 260;
const LEFT = 54;
const RIGHT = 132;
const TOP = 18;
const BOTTOM = 44;

function formatVariacao(pct: number): string {
  const sinal = pct > 0 ? "+" : pct < 0 ? "−" : "";
  const abs = Math.abs(pct).toLocaleString("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  });
  return `${sinal}${abs}%`;
}

/** ▲ subiu, ▼ caiu, ▬ ficou igual. O glifo dobra a informação do sinal. */
function glifo(pct: number): string {
  if (pct > 0) return "▲";
  if (pct < 0) return "▼";
  return "▬";
}

function Seta({ seta }: { seta: GrowthArrow }) {
  if (seta.variacaoPct === null) {
    return (
      <span className="growth-arrow growth-arrow--vazia">
        <span aria-hidden>→</span>
        <small>sem apuração dos dois lados</small>
      </span>
    );
  }
  return (
    <span
      className={
        seta.comparavel
          ? "growth-arrow"
          : "growth-arrow growth-arrow--incomparavel"
      }
      title={
        seta.comparavel
          ? undefined
          : "Cargos ou turnos diferentes: a variação está calculada, mas não são a mesma disputa."
      }
    >
      <span aria-hidden>→</span>
      <strong>
        {glifo(seta.variacaoPct)} {formatVariacao(seta.variacaoPct)}
      </strong>
      {!seta.comparavel && <small>cargos diferentes</small>}
    </span>
  );
}

function ReguaDeSetas({ serie, cor }: { serie: GrowthSeries; cor: string }) {
  const setaPorDestino = new Map(
    serie.arrows.map((seta) => [seta.paraContestId, seta]),
  );
  return (
    <div className="growth-track">
      <div className="growth-track__label">
        <span className="growth-swatch" style={{ background: cor }} aria-hidden />
        <strong>{serie.label}</strong>
        {serie.variacaoTotalPct !== null && (
          <small>
            {serie.points[0].electionYear} a{" "}
            {serie.points[serie.points.length - 1].electionYear}:{" "}
            {glifo(serie.variacaoTotalPct)}{" "}
            {formatVariacao(serie.variacaoTotalPct)}
            {serie.variacaoTotalComparavel ? "" : " (cargos diferentes)"}
          </small>
        )}
      </div>
      <div className="growth-track__steps">
        {serie.points.map((ponto, indice) => {
          const seta = setaPorDestino.get(ponto.contestId);
          return (
            <span className="growth-step" key={ponto.contestId}>
              {indice > 0 && seta && <Seta seta={seta} />}
              <span className="growth-node">
                <b>{ponto.electionYear}</b>
                <span>
                  {ponto.votos === null
                    ? "sem apuração"
                    : `${formatInteger(ponto.votos)} votos`}
                </span>
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Valor plotado de um ponto conforme o modo do eixo.
 *
 * No modo "base 100" cada série é dividida pela sua PRÓPRIA primeira medição.
 * É o jeito de comparar crescimento entre coisas de tamanho muito diferente
 * sem recorrer a dois eixos: um bairro de 4 mil votos e um total de 219 mil
 * passam a ser lidos pela mesma régua — o quanto cada um andou desde onde
 * começou. Com dois eixos as duas curvas ficariam bonitas e a comparação
 * seria falsa, porque a inclinação dependeria da escala escolhida.
 */
function valorNoEixo(
  serie: GrowthSeries,
  votos: number | null,
  modo: ModoEixo,
): number | null {
  if (votos === null) return null;
  if (modo === "votos") return votos;
  const base = serie.points.find((ponto) => (ponto.votos ?? 0) > 0)?.votos;
  if (!base) return null;
  return (votos / base) * 100;
}

type ModoEixo = "votos" | "indice";

export function GrowthView({
  model,
  selecionados,
  onToggle,
  onLimpar,
  onExport,
}: {
  model: GrowthModel;
  selecionados: string[];
  onToggle: (id: string) => void;
  onLimpar: () => void;
  onExport: () => void;
}) {
  const [busca, setBusca] = useState("");
  const [modo, setModo] = useState<ModoEixo>("votos");

  const valores = model.series.map((serie) =>
    serie.points.map((ponto) => valorNoEixo(serie, ponto.votos, modo)),
  );
  const maxVotos = Math.max(
    1,
    ...valores.flat().map((valor) => valor ?? 0),
  );

  /* Quando a maior série é ordens de grandeza acima da menor, as pequenas
     encostam na linha de base e o gráfico deixa de responder à pergunta.
     Em vez de esconder o problema com um segundo eixo, avisamos e apontamos
     o modo que resolve. */
  const positivos = valores
    .map((serie) => Math.max(...serie.map((valor) => valor ?? 0)))
    .filter((valor) => valor > 0);
  const achatado =
    modo === "votos" &&
    positivos.length > 1 &&
    Math.max(...positivos) / Math.min(...positivos) >= 8;
  const plotW = CHART_W - LEFT - RIGHT;
  const plotH = CHART_H - TOP - BOTTOM;
  const n = model.pleitos.length;
  const x = (indice: number) =>
    LEFT + (n === 1 ? plotW / 2 : (plotW * indice) / (n - 1));
  const y = (votos: number) => TOP + plotH - (votos / maxVotos) * plotH;

  const opcoesFiltradas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const lista = termo
      ? model.options.filter((opcao) =>
          opcao.label.toLowerCase().includes(termo),
        )
      : model.options;
    return lista.slice(0, 60);
  }, [busca, model.options]);

  const cheio = selecionados.length >= MAX_RECORTES;

  /* Rótulos de ponta afastados um do outro.
     Duas séries que terminam com valores próximos escrevem o nome em cima do
     nome da outra — foi exatamente o que apareceu no primeiro screenshot desta
     tela, com "setor central" e "setor sul" sobrepostos. Aqui os rótulos são
     empurrados para manter um vão mínimo, preservando a ordem vertical (o
     rótulo de cima continua sendo o da linha de cima). */
  const alturasRotulo = (() => {
    const alvos = model.series.map((serie, indice) => {
      const ultimo = [...serie.points]
        .map((_, i) => i)
        .reverse()
        .find((i) => valores[indice][i] !== null);
      return {
        indice,
        y: ultimo === undefined ? null : y(valores[indice][ultimo] as number),
      };
    });
    const ordenados = alvos
      .filter((item): item is { indice: number; y: number } => item.y !== null)
      .sort((a, b) => a.y - b.y);
    const VAO = 12;
    for (let i = 1; i < ordenados.length; i += 1) {
      const minimo = ordenados[i - 1].y + VAO;
      if (ordenados[i].y < minimo) ordenados[i].y = minimo;
    }
    const mapa = new Map(ordenados.map((item) => [item.indice, item.y]));
    return mapa;
  })();
  const alturaRotulo = (indice: number) => alturasRotulo.get(indice) ?? 0;

  return (
    <section aria-label="Crescimento ao longo das eleições">
      <p className="stats-lede">
        <strong>
          {model.grupo === "municipais"
            ? "Geral · eleições municipais"
            : "Geral · eleições federais e estaduais"}
        </strong>
      </p>

      <p className="stats-note stats-note--intro">
        Cada eleição é um ponto: o ano, quantos votos ela fez e, na seta, quanto
        isso mudou em relação à eleição anterior. Marque itens em{" "}
        <strong>{model.breakdownLabel}</strong>, ao lado, para ver quem cresceu
        mais e quem ficou para trás.
      </p>

      {model.temCargosDiferentes && (
        <p className="stats-note stats-note--warning">
          Este grupo tem cargos diferentes. A variação entre eles continua
          calculada, porque é o crescimento que interessa acompanhar, mas sai
          marcada como <em>cargos diferentes</em>: disputar uma cadeira na
          Câmara e disputar a Assembleia não são a mesma corrida, e a taxa entre
          as duas não mede a mesma coisa que a taxa entre duas eleições do mesmo
          cargo.
        </p>
      )}

      <div className="growth-layout">
        <div className="growth-main">
          <div className="stats-panel">
            <div className="stats-panel__heading">
              <span>
                <TrendingUp size={14} aria-hidden /> Votos por eleição
              </span>
              <div className="growth-heading-actions">
                <div
                  className="stats-toggle"
                  role="group"
                  aria-label="Escala do gráfico"
                >
                  <button
                    type="button"
                    className={modo === "votos" ? "stats-toggle--active" : ""}
                    aria-pressed={modo === "votos"}
                    onClick={() => setModo("votos")}
                  >
                    Votos
                  </button>
                  <button
                    type="button"
                    className={modo === "indice" ? "stats-toggle--active" : ""}
                    aria-pressed={modo === "indice"}
                    onClick={() => setModo("indice")}
                  >
                    Crescimento (base 100)
                  </button>
                </div>
                <button type="button" className="stats-export" onClick={onExport}>
                  <Download size={14} aria-hidden /> CSV
                </button>
              </div>
            </div>

            {model.series.some((serie) =>
              serie.points.some((ponto) => ponto.votos === null),
            ) && (
              <p className="stats-note">
                O trecho <strong>tracejado</strong> liga dois pontos com uma
                eleição sem apuração no meio. Ele mostra que é a mesma série —
                não é votação estimada, e por isso a seta correspondente fica
                sem número em vez de marcar queda.
              </p>
            )}

            {achatado && (
              <p className="stats-note">
                As linhas menores ficam coladas na base porque a maior é muitas
                vezes maior que elas — é a escala, não a votação. Para comparar
                o crescimento lado a lado, troque para{" "}
                <strong>Crescimento (base 100)</strong>: cada linha parte de 100
                na sua primeira eleição e mostra o quanto andou desde ali.
              </p>
            )}

            <svg
              className="stats-chart"
              viewBox={`0 0 ${CHART_W} ${CHART_H}`}
              role="img"
              aria-label={`Votos por eleição de ${model.pleitos[0].electionYear} a ${model.pleitos[n - 1].electionYear}, ${model.series.length} série(s) comparada(s)`}
            >
              {/* grade recuada: régua, não protagonista */}
              {[0, 0.25, 0.5, 0.75, 1].map((fracao) => (
                <g key={fracao}>
                  <line
                    x1={LEFT}
                    x2={CHART_W - RIGHT}
                    y1={y(maxVotos * fracao)}
                    y2={y(maxVotos * fracao)}
                    className={
                      fracao === 0 ? "stats-chart-baseline" : "stats-chart-grid"
                    }
                  />
                  <text
                    x={LEFT - 8}
                    y={y(maxVotos * fracao) + 3}
                    className="stats-chart-tick"
                    textAnchor="end"
                  >
                    {modo === "indice"
                      ? Math.round(maxVotos * fracao)
                      : formatCompactPt(Math.round(maxVotos * fracao))}
                  </text>
                </g>
              ))}

              {/* No modo base 100 o que importa é estar acima ou abaixo de
                  onde a série começou — a régua precisa estar desenhada. */}
              {modo === "indice" && maxVotos > 100 && (
                <g>
                  <line
                    x1={LEFT}
                    x2={CHART_W - RIGHT}
                    y1={y(100)}
                    y2={y(100)}
                    className="growth-base-line"
                  />
                  <text
                    x={CHART_W - RIGHT + 4}
                    y={y(100) - 4}
                    className="stats-chart-tick"
                  >
                    base 100
                  </text>
                </g>
              )}

              {model.pleitos.map((ponto, indice) => (
                <g key={ponto.contestId}>
                  <text
                    x={x(indice)}
                    y={TOP + plotH + 18}
                    className="stats-chart-year"
                    textAnchor="middle"
                  >
                    {ponto.electionYear}
                  </text>
                  <text
                    x={x(indice)}
                    y={TOP + plotH + 31}
                    className="stats-chart-office"
                    textAnchor="middle"
                  >
                    {ponto.officeShort}
                  </text>
                </g>
              ))}

              {model.series.map((serie, indiceSerie) => {
                const cor = CORES_SERIE[indiceSerie % CORES_SERIE.length];
                const valoresSerie = valores[indiceSerie];
                /* Segmentos quebram nos pleitos sem apuração: a linha nunca
                   atravessa um buraco fingindo que há dado ali. */
                const segmentos: Array<Array<{ cx: number; cy: number }>> = [];
                let atual: Array<{ cx: number; cy: number }> = [];
                serie.points.forEach((_, indice) => {
                  const valor = valoresSerie[indice];
                  if (valor === null) {
                    if (atual.length) segmentos.push(atual);
                    atual = [];
                    return;
                  }
                  atual.push({ cx: x(indice), cy: y(valor) });
                });
                if (atual.length) segmentos.push(atual);

                /* Ponte tracejada por cima do buraco.
                   Sem ela, uma série que falta num pleito vira dois pontos
                   soltos e ninguém percebe que são a mesma coisa. O tracejado
                   liga a IDENTIDADE, não a medição: fica visivelmente
                   diferente da linha cheia, que é onde há voto apurado. */
                const pontes = segmentos
                  .slice(0, -1)
                  .map((segmento, indice) => ({
                    de: segmento[segmento.length - 1],
                    para: segmentos[indice + 1][0],
                  }));

                const ultimo = [...serie.points]
                  .map((ponto, indice) => ({ ponto, indice }))
                  .reverse()
                  .find((item) => valoresSerie[item.indice] !== null);

                return (
                  <g key={serie.id}>
                    {pontes.map((ponte, indice) => (
                      <line
                        key={`ponte-${indice}`}
                        x1={ponte.de.cx}
                        y1={ponte.de.cy}
                        x2={ponte.para.cx}
                        y2={ponte.para.cy}
                        stroke={cor}
                        strokeWidth={1.5}
                        strokeDasharray="3 4"
                        opacity={0.45}
                      />
                    ))}
                    {segmentos.map((segmento, indice) => (
                      <polyline
                        key={indice}
                        points={segmento
                          .map((item) => `${item.cx},${item.cy}`)
                          .join(" ")}
                        fill="none"
                        stroke={cor}
                        strokeWidth={2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    ))}
                    {serie.points.map((ponto, indice) =>
                      valoresSerie[indice] === null ? null : (
                        <circle
                          key={ponto.contestId}
                          cx={x(indice)}
                          cy={y(valoresSerie[indice] as number)}
                          r={4}
                          fill={cor}
                          stroke="#ffffff"
                          strokeWidth={2}
                        >
                          <title>
                            {`${serie.label} · ${ponto.electionYear} · ${formatInteger(ponto.votos as number)} votos`}
                          </title>
                        </circle>
                      ),
                    )}
                    {/* rótulo direto na ponta: identidade sem depender da cor */}
                    {ultimo && (
                      <text
                        x={x(ultimo.indice) + 10}
                        y={alturaRotulo(indiceSerie) + 3}
                        className="growth-series-label"
                        fill={cor}
                      >
                        {serie.label.length > 22
                          ? `${serie.label.slice(0, 21)}…`
                          : serie.label}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>

          <div className="stats-panel">
            <div className="stats-panel__heading">
              <span>
                <TrendingUp size={14} aria-hidden /> Crescimento entre eleições
              </span>
            </div>
            {model.series.map((serie, indice) => (
              <ReguaDeSetas
                key={serie.id}
                serie={serie}
                cor={CORES_SERIE[indice % CORES_SERIE.length]}
              />
            ))}
          </div>
        </div>

        <aside className="growth-picker" aria-label={model.breakdownLabel}>
          <div className="growth-picker__head">
            <strong>{model.breakdownLabel}</strong>
            {selecionados.length > 0 && (
              <button type="button" onClick={onLimpar}>
                <X size={12} aria-hidden /> limpar
              </button>
            )}
          </div>

          <label className="growth-search">
            <Search size={14} aria-hidden />
            <input
              type="search"
              value={busca}
              placeholder="Buscar…"
              onChange={(evento) => setBusca(evento.target.value)}
            />
          </label>

          <p className="growth-picker__hint">
            {cheio
              ? `Máximo de ${MAX_RECORTES} comparações ao mesmo tempo. Tire uma para somar outra.`
              : `Escolha até ${MAX_RECORTES} para comparar com o total.`}
          </p>

          <ul className="growth-options">
            {opcoesFiltradas.map((opcao) => {
              const marcado = selecionados.includes(opcao.id);
              return (
                <li key={opcao.id}>
                  <label className={marcado ? "is-selected" : undefined}>
                    <input
                      type="checkbox"
                      checked={marcado}
                      disabled={!marcado && cheio}
                      onChange={() => onToggle(opcao.id)}
                    />
                    <span>{opcao.label}</span>
                    <small>{formatInteger(opcao.votosRecentes)}</small>
                  </label>
                </li>
              );
            })}
            {opcoesFiltradas.length === 0 && (
              <li className="growth-options__vazio">Nada com esse nome.</li>
            )}
          </ul>

          <p className="growth-picker__hint">
            O número ao lado é a votação no pleito mais recente em que o recorte
            aparece — votos de eleições diferentes não formam um total.
          </p>
        </aside>
      </div>
    </section>
  );
}
