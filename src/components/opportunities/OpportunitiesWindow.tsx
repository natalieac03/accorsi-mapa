/**
 * Janela "Oportunidades": overlay de tela inteira, separado da fileira de
 * abas do painel lateral — mesmo padrão de `stats/StatsWindow.tsx`. Aberta
 * pelo menu do cabeçalho (canto superior esquerdo), não por uma aba.
 *
 * Motivo da separação: esta função responde "onde investir", uma pergunta de
 * outra natureza que "como está o mapa agora" — as abas do painel lateral
 * respondem a segunda.
 *
 * LAYOUT (segunda passada). A primeira versão herdou a forma de aba: uma
 * coluna de 980px centralizada, cards que sumiam ao abrir um tipo e um botão
 * "← Todos os tipos" para voltar. Isso é gesto de celular numa janela de
 * desktop, e desperdiçava exatamente o espaço que motivou virar janela.
 *
 * Agora são dois painéis, o idioma que o StatsWindow já estabeleceu na casa:
 * um rail à esquerda com os tipos SEMPRE visíveis (cada um com contagem e
 * barra proporcional, para a forma da carteira inteira ficar legível enquanto
 * se lê um tipo só) e o conteúdo à direita. Os filtros moram no pé do rail,
 * porque agem sobre todos os tipos, não sobre o que está aberto. O gate e a
 * metodologia viraram itens de navegação em vez de `<details>` competindo com
 * a lista.
 *
 * Toda a aritmética continua nos motores puros de utils/opportunity.ts,
 * utils/territoryFeatures.ts, utils/opportunityTypes.ts, utils/clustering.ts,
 * utils/expectedPerformance.ts e utils/opportunityGate.ts — testados isolados.
 * Aqui é só composição visual, como StatsWindow faz com utils/candidateStats.
 */

import {
  BookOpen,
  ChevronDown,
  Compass,
  Info,
  MapPin,
  ShieldCheck,
  Target,
  TriangleAlert,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import ageStructureJson from "../../data/age-structure-go.json";
import candidatoJson from "../../data/candidato/adriana-accorsi.json";
import electorateJson from "../../data/electorate-go.json";
import literacyJson from "../../data/literacy-go.json";
import socioeconomicJson from "../../data/socioeconomic-go.json";
import { CANDIDATA } from "../../config/candidata.ts";
import { ESTADO } from "../../config/estado.ts";
import type { AgeStructureDataset } from "../../types/ageStructure";
import type { CandidateDataset } from "../../types/candidate";
import type { ElectorateDataset } from "../../types/electorate";
import type { LiteracyDataset } from "../../types/literacy";
import type { ContestMetrics } from "../../types/opportunity";
import type { SocioeconomicDataset } from "../../types/socioeconomic";
import {
  padronizar,
  testarValoresDeK,
  type ClusterPoint,
} from "../../utils/clustering.ts";
import { crossValidate, type ModelObservation } from "../../utils/expectedPerformance.ts";
import { buildContestMetrics } from "../../utils/opportunity.ts";
import { CRITERIOS, decidir } from "../../utils/opportunityGate.ts";
import {
  classifyTerritory,
  groupByType,
  LIMIARES,
  selectAnchors,
  TIPOS,
  type OpportunityClassification,
  type OpportunityTypeId,
} from "../../utils/opportunityTypes.ts";
import {
  avaliarInsumos,
  contarTiposDisponiveis,
  diagnosticarLimiares,
  selecionarPleitos,
  type InsumosPorTipo,
} from "../../utils/opportunityInputs.ts";
import {
  buildFeatureMatrix,
  findSimilarTerritories,
  similarityToAnchors,
} from "../../utils/territoryFeatures.ts";

const candidato = candidatoJson as unknown as CandidateDataset;
const socioeconomic = socioeconomicJson as unknown as SocioeconomicDataset;
const ageStructure = ageStructureJson as unknown as AgeStructureDataset;
const literacy = literacyJson as unknown as LiteracyDataset;
const electorate = electorateJson as unknown as ElectorateDataset;

function pendente(dataset: { metadata?: { status?: string } } | null): boolean {
  return !dataset || dataset.metadata?.status === "pendente";
}

const DADOS_PENDENTES =
  pendente(candidato) ||
  pendente(socioeconomic as never) ||
  pendente(electorate as never) ||
  (candidato.contests?.length ?? 0) === 0;

/** O que o painel da direita está mostrando. */
type Vista = { tipo: OpportunityTypeId } | "gate" | "metodo";

const TIPOS_ORDENADOS = Object.keys(TIPOS) as OpportunityTypeId[];

/** "—" em vez de "Dado indisponível" repetido quatro vezes por território. */
const SEM_DADO = "—";

/**
 * As razões saem do motor em minúscula, porque lá elas são fragmentos que se
 * juntam com ponto e vírgula dentro de uma frase maior. Aqui viram a frase
 * inteira do card, então começam com maiúscula. É ajuste de apresentação —
 * mudar o motor faria a frase longa da exportação ganhar maiúscula no meio.
 */
function comoFrase(texto: string): string {
  if (texto.length === 0) return texto;
  return texto[0].toUpperCase() + texto.slice(1);
}

function numero(valor: number | null | undefined, casas: number): string {
  if (valor === null || valor === undefined || !Number.isFinite(valor)) return SEM_DADO;
  return valor.toFixed(casas).replace(".", ",");
}

/**
 * Barra do lift, ancorada em 1,00.
 *
 * O lift é razão contra a taxa de referência estadual: 1,00 é "exatamente na
 * média do estado". Uma barra que cresce da esquerda esconderia justamente
 * isso — 0,90 e 1,10 pareceriam quase iguais. Esta cresce a partir do centro,
 * para cada lado, então acima e abaixo da média se leem de relance.
 */
function BarraDeLift({ lift }: { lift: number | null }) {
  if (lift === null || !Number.isFinite(lift)) {
    return <div className="lift-bar lift-bar--vazia" aria-hidden />;
  }
  // Escala 0–2 em torno do centro; acima disso satura, para um outlier não
  // achatar todos os outros.
  const desvio = Math.min(Math.abs(lift - 1), 1);
  const largura = desvio * 50;
  const acima = lift >= 1;
  return (
    <div className="lift-bar" aria-hidden>
      <span
        className={acima ? "lift-bar__fill is-acima" : "lift-bar__fill is-abaixo"}
        style={
          acima
            ? { left: "50%", width: `${largura}%` }
            : { right: "50%", width: `${largura}%` }
        }
      />
      <span className="lift-bar__centro" />
    </div>
  );
}

type Props = {
  onClose: () => void;
};

export function OpportunitiesWindow({ onClose }: Props) {
  const fecharRef = useRef<HTMLButtonElement | null>(null);

  // Esc fecha; o foco nasce no botão de fechar — mesmo contrato de
  // acessibilidade do StatsWindow, para o teclado ter porta de saída igual
  // em qualquer janela do app.
  useEffect(() => {
    fecharRef.current?.focus();
    const aoTeclar = (evento: KeyboardEvent) => {
      if (evento.key === "Escape") onClose();
    };
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [onClose]);

  const [vista, setVista] = useState<Vista>({ tipo: TIPOS_ORDENADOS[0] });
  const [similaridadeMinima, setSimilaridadeMinima] = useState(0);
  const [somenteComAviso, setSomenteComAviso] = useState(false);
  // Substitui o antigo onSelect/selectedMunicipalityId ligado ao mapa: esta
  // janela cobre a tela inteira e o mapa fica atrás dela, sem sentido em
  // "selecionar no mapa". O estado aqui só controla qual território mostra a
  // lista de "perfil parecido" expandida.
  const [territorioExpandido, setTerritorioExpandido] = useState<string | null>(null);

  const analise = useMemo(() => {
    if (DADOS_PENDENTES) return null;

    // A escolha do par de pleitos mora em `utils/opportunityInputs.ts`, não
    // aqui: a regra anterior ("o cargo com mais pleitos no snapshot") elegia,
    // nesta instalação, as três candidaturas a Prefeito — todas de um único
    // município. A aba analisaria uma cidade e chamaria o resultado de mapa
    // do estado. Cobertura territorial primeiro, recência depois.
    const selecao = selecionarPleitos(candidato, ESTADO.municipios);
    if (selecao === null) return null;

    const eleitoradoIndex = Object.fromEntries(
      Object.entries(electorate.municipalities ?? {}).map(([ibge, dados]) => [
        ibge,
        (dados as { electorate: number }).electorate,
      ]),
    );

    const atual: ContestMetrics = buildContestMetrics(
      selecao.atual,
      eleitoradoIndex,
    );
    const anterior = selecao.anterior
      ? buildContestMetrics(selecao.anterior, eleitoradoIndex)
      : null;

    const ancoras = selectAnchors(atual);
    const matriz = buildFeatureMatrix({
      socioeconomic,
      ageStructure,
      literacy,
      electorate,
    });

    const anterioresPorIbge = new Map(
      (anterior?.territorios ?? []).map((t) => [t.ibgeCode, t]),
    );
    const codigosAncora = ancoras.map((a) => a.ibgeCode);

    // Uma passada só: a versão anterior calculava a similaridade de cada
    // território duas vezes — uma para classificar, outra para o mapa de
    // similaridades logo abaixo. Com 246 territórios × 20 âncoras × 14
    // variáveis, era o dobro do trabalho para o mesmo número.
    const similaridadePorIbge = new Map<string, number | null>(
      atual.territorios.map((territorio) => [
        territorio.ibgeCode,
        similarityToAnchors(territorio.ibgeCode, codigosAncora, matriz)
          .similaridade,
      ]),
    );

    const classificacoes: OpportunityClassification[] = atual.territorios.map(
      (territorio) =>
        classifyTerritory({
          ibgeCode: territorio.ibgeCode,
          nome: territorio.nome,
          atual: territorio,
          anterior: anterioresPorIbge.get(territorio.ibgeCode) ?? null,
          similaridade: similaridadePorIbge.get(territorio.ibgeCode) ?? null,
          // Comparecimento não existe em nenhum snapshot deste projeto. Fica
          // null de propósito, e `avaliarInsumos` transforma essa ausência em
          // "incalculável" na tela, em vez de "nenhum município encontrado".
          comparecimento: null,
          comparecimentoReferencia: null,
          avisoDeComparacao: selecao.avisoDeComparacao,
        }),
    );

    const insumos: InsumosPorTipo = avaliarInsumos({
      selecao,
      metricas: atual,
      ancoras,
      territoriosComSimilaridade: [...similaridadePorIbge.values()].filter(
        (valor) => valor !== null,
      ).length,
      territoriosComComparecimento: 0,
    });

    const featureIds = matriz.definicoes.map((definicao) => definicao.id);
    const completos = matriz.territorios.filter((territorio) =>
      featureIds.every((id) => territorio.valores[id] !== null),
    );

    let melhorCluster = null;
    let pontos: ClusterPoint[] = [];
    if (completos.length > 5) {
      const { padronizadas } = padronizar(
        completos.map((t) => featureIds.map((id) => t.valores[id] as number)),
      );
      pontos = completos.map((territorio, indice) => ({
        id: territorio.ibgeCode,
        valores: padronizadas[indice],
      }));
      melhorCluster = testarValoresDeK(pontos, { semente: 42 })[0] ?? null;
    }

    const observacoes: ModelObservation[] = atual.territorios
      .filter((territorio) => territorio.taxaSuavizada !== null && territorio.validos > 0)
      .map((territorio) => {
        const features = matriz.territorios.find(
          (t) => t.ibgeCode === territorio.ibgeCode,
        );
        return {
          id: territorio.ibgeCode,
          features: featureIds.map((id) => features?.valores[id] ?? null),
          taxa: territorio.taxaSuavizada as number,
          peso: territorio.validos,
        };
      });

    const validacao = crossValidate(observacoes, featureIds);
    const gate = decidir(
      melhorCluster,
      completos.length,
      validacao,
      CRITERIOS,
      pontos.length > 0 ? pontos : undefined,
    );

    return {
      atual,
      selecao,
      insumos,
      diagnostico: diagnosticarLimiares(atual, similaridadePorIbge, LIMIARES),
      ancoras,
      matriz,
      gate,
      classificacoes,
      grupos: groupByType(classificacoes),
      similaridades: similaridadePorIbge,
    };
  }, []);

  return (
    <div
      className="stats-window"
      role="dialog"
      aria-modal="true"
      aria-labelledby="opportunities-window-title"
    >
      <header className="stats-window__header">
        <div className="stats-window__title">
          <Compass size={18} aria-hidden />
          <div>
            <h2 id="opportunities-window-title">Oportunidades</h2>
            <span>
              Descoberta territorial · {CANDIDATA.nomeCompleto} · {ESTADO.nome}
            </span>
          </div>
        </div>
        <button
          type="button"
          className="stats-window__close"
          onClick={onClose}
          ref={fecharRef}
        >
          <X size={16} aria-hidden />
          <span>Fechar</span>
        </button>
      </header>

      {DADOS_PENDENTES || analise === null ? (
        <div className="stats-window__body stats-window__body--empty">
          <div className="workspace-empty-state stats-empty-state">
            <Compass size={26} aria-hidden />
            <strong>Dados ainda não gerados</strong>
            <span>
              Esta janela cruza a votação apurada do candidato com os
              indicadores do IBGE. Rode <code>bash gerar_dados.sh</code> na
              raiz do projeto e volte aqui.
            </span>
          </div>
        </div>
      ) : (
        (() => {
          const {
            atual,
            selecao,
            insumos,
            diagnostico,
            ancoras,
            classificacoes,
            grupos,
            similaridades,
            gate,
            matriz,
          } = analise;

          const filtrar = (lista: OpportunityClassification[]) =>
            lista.filter((item) => {
              const similaridade = similaridades.get(item.ibgeCode) ?? null;
              if (similaridadeMinima > 0) {
                if (similaridade === null || similaridade < similaridadeMinima)
                  return false;
              }
              if (somenteComAviso && item.avisos.length === 0) return false;
              return true;
            });

          const contagens = new Map<OpportunityTypeId, number>(
            TIPOS_ORDENADOS.map((id) => [id, filtrar(grupos.get(id) ?? []).length]),
          );
          const maiorContagem = Math.max(1, ...contagens.values());
          const totalFiltrado = [...contagens.values()].reduce((a, b) => a + b, 0);
          const totalClassificado = classificacoes.filter(
            (c) => c.tipoPrincipal !== null,
          ).length;
          const filtrosAtivos = similaridadeMinima > 0 || somenteComAviso;

          const tipoAtivo = typeof vista === "object" ? vista.tipo : null;
          const detalhe = tipoAtivo ? filtrar(grupos.get(tipoAtivo) ?? []) : [];

          return (
            <div className="stats-window__body">
              {/* ---- rail: tipos sempre visíveis, filtros no pé ---- */}
              <nav
                className="stats-nav opportunities-nav"
                aria-label="Tipos de oportunidade"
              >
                <p className="stats-nav__group">
                  <Target size={12} aria-hidden />
                  Tipos de oportunidade
                </p>

                {TIPOS_ORDENADOS.map((tipoId) => {
                  const total = contagens.get(tipoId) ?? 0;
                  const ativo = tipoAtivo === tipoId;
                  const insumo = insumos[tipoId];
                  return (
                    <button
                      key={tipoId}
                      type="button"
                      className={
                        [
                          "stats-nav__item",
                          "opportunities-nav__item",
                          ativo ? "stats-nav__item--active" : "",
                          insumo.disponivel ? "" : "opportunities-nav__item--sem-insumo",
                        ]
                          .filter(Boolean)
                          .join(" ")
                      }
                      onClick={() => {
                        setVista({ tipo: tipoId });
                        setTerritorioExpandido(null);
                      }}
                      // Continua clicável mesmo sem insumo: o painel da direita
                      // explica O QUE falta. Desabilitar esconderia a única
                      // informação que o tipo ainda tem para dar.
                      aria-current={ativo ? "true" : undefined}
                    >
                      <span className="opportunities-nav__linha">
                        <span className="opportunities-nav__rotulo">
                          {TIPOS[tipoId].label}
                        </span>
                        {/* "0" afirma que a busca aconteceu e não achou nada.
                            Quando o insumo não existe, a busca não aconteceu —
                            e as duas coisas levam a decisões opostas. */}
                        <span className="opportunities-nav__total">
                          {insumo.disponivel ? total : "sem insumo"}
                        </span>
                      </span>
                      {/* A barra existe para a forma da carteira inteira ficar
                          legível enquanto se lê um tipo só: qual concentra
                          território e qual é resíduo de dois ou três. */}
                      <span className="opportunities-nav__barra" aria-hidden>
                        <span
                          style={{
                            width: insumo.disponivel
                              ? `${(total / maiorContagem) * 100}%`
                              : "0%",
                          }}
                        />
                      </span>
                    </button>
                  );
                })}

                <p className="stats-nav__group">
                  <Info size={12} aria-hidden />
                  Filtros
                </p>

                <div className="opportunities-filtros">
                  <label>
                    <span>
                      Similaridade mínima
                      <strong>{similaridadeMinima}%</strong>
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={95}
                      step={5}
                      value={similaridadeMinima}
                      onChange={(evento) =>
                        setSimilaridadeMinima(Number(evento.target.value))
                      }
                    />
                  </label>
                  <label className="opportunities-filtros__checkbox">
                    <input
                      type="checkbox"
                      checked={somenteComAviso}
                      onChange={(evento) => setSomenteComAviso(evento.target.checked)}
                    />
                    <span>Só com ressalva metodológica</span>
                  </label>
                  {filtrosAtivos && (
                    <button
                      type="button"
                      className="opportunities-filtros__limpar"
                      onClick={() => {
                        setSimilaridadeMinima(0);
                        setSomenteComAviso(false);
                      }}
                    >
                      Limpar filtros · {totalFiltrado} de {totalClassificado}
                    </button>
                  )}
                </div>

                <p className="stats-nav__group">
                  <ShieldCheck size={12} aria-hidden />
                  Método
                </p>

                <button
                  type="button"
                  className={
                    vista === "gate"
                      ? "stats-nav__item stats-nav__item--active"
                      : "stats-nav__item"
                  }
                  onClick={() => setVista("gate")}
                >
                  <span
                    className={
                      gate.aprovado
                        ? "opportunities-chip is-ok"
                        : "opportunities-chip is-fail"
                    }
                    aria-hidden
                  />
                  Perfis e modelo
                  <span>{gate.aprovado ? "aprovados" : "não exibidos"}</span>
                </button>

                <button
                  type="button"
                  className={
                    vista === "metodo"
                      ? "stats-nav__item stats-nav__item--active"
                      : "stats-nav__item"
                  }
                  onClick={() => setVista("metodo")}
                >
                  <BookOpen size={13} aria-hidden />
                  Limiares e fontes
                </button>
              </nav>

              {/* ---- conteúdo ---- */}
              <div className="stats-content">
                {vista === "gate" ? (
                  <section>
                    <h3 className="opportunities-titulo">
                      {gate.aprovado
                        ? "Perfis e modelo: aprovados nos critérios"
                        : "Perfis e modelo: não exibidos"}
                    </h3>
                    <p className="stats-lede">{gate.resumo}</p>
                    <ul className="panel-gate-checks">
                      {gate.verificacoes.map((verificacao) => (
                        <li
                          key={verificacao.nome}
                          className={verificacao.aprovado ? "is-ok" : "is-fail"}
                        >
                          <strong>{verificacao.nome}</strong>
                          <span>
                            medido {verificacao.medido} · exigido {verificacao.exigido}
                          </span>
                          <small>{verificacao.significado}</small>
                        </li>
                      ))}
                    </ul>
                    {!gate.aprovado && (
                      <p className="panel-gate-note">
                        A classificação por regra não depende de clusterização
                        nem de modelo — ela continua válida e é o que os tipos
                        ao lado mostram.
                      </p>
                    )}
                  </section>
                ) : vista === "metodo" ? (
                  <section className="opportunities-metodo">
                    <h3 className="opportunities-titulo">Limiares e fontes</h3>
                    <p>
                      Pleito de referência: {atual.electionYear}, {atual.officeName},
                      turno {atual.round}. Taxa de referência estadual:{" "}
                      {atual.taxaReferencia !== null
                        ? `${numero(atual.taxaReferencia * 100, 2)}%`
                        : SEM_DADO}
                      . Suavização: prior {atual.prior.origin}, força{" "}
                      {numero(atual.prior.strength, 0)}
                      {atual.prior.capped ? " (limitada pelo teto)" : ""}.
                    </p>
                    <p>
                      Pleito de comparação:{" "}
                      {selecao.anterior
                        ? `${selecao.anterior.electionYear}, ${selecao.anterior.officeName}`
                        : "nenhum"}
                      . Entraram na conta apenas pleitos com votação em ao menos{" "}
                      {selecao.minimoDeMunicipios} dos {ESTADO.municipios}{" "}
                      municípios
                      {selecao.descartados.length > 0
                        ? `; ficaram de fora ${selecao.descartados
                            .map(
                              (pleito) =>
                                `${pleito.officeName} ${pleito.electionYear} (${pleito.municipiosComVoto})`,
                            )
                            .join(", ")}`
                        : ""}
                      .{" "}
                      {contarTiposDisponiveis(insumos)} dos 7 tipos têm insumo
                      neste snapshot; os demais aparecem no painel com o motivo.
                    </p>
                    {selecao.avisoDeComparacao && (
                      <p className="opportunities-metodo__ressalva">
                        <TriangleAlert size={14} aria-hidden />
                        {selecao.avisoDeComparacao}
                      </p>
                    )}
                    <p>
                      Limiares em uso, e quantos territórios cada um deixa
                      passar neste snapshot. O limiar sozinho parece critério;
                      só com a contagem ao lado dá para ver se ele está
                      separando alguma coisa. São escolhas de configuração, não
                      resultados de estimação.
                    </p>
                    <ul className="opportunities-limiares">
                      {diagnostico.map((item) => (
                        <li
                          key={item.rotulo}
                          className={
                            item.poucoSeletivo ? "is-pouco-seletivo" : undefined
                          }
                        >
                          <strong>{item.rotulo}</strong>
                          <span>{item.corte}</span>
                          <span>
                            {item.passam} de {item.total}
                          </span>
                          {item.poucoSeletivo && (
                            <small>
                              não separa: quase todo território cai do mesmo
                              lado deste corte
                            </small>
                          )}
                        </li>
                      ))}
                    </ul>
                    <p>
                      Queda relevante ≥ {LIMIARES.quedaRelevante * 100}%,
                      estabilidade ≤ {LIMIARES.estabilidade * 100}%.
                    </p>
                    <p>
                      Fontes: TSE (votação por município, perfil do eleitorado) e
                      IBGE (Censo 2022, indicadores municipais). A similaridade
                      mede semelhança entre características territoriais
                      agregadas; não descreve pessoas nem prevê comportamento
                      eleitoral. Raça, deficiência e nome social existem no dado
                      do TSE e foram deliberadamente deixados fora do cálculo.
                    </p>
                    <p>
                      A comparação é entre MUNICÍPIOS: os indicadores do IBGE
                      existem nessa escala, e comparar município com seção seria
                      juntar universos diferentes.
                    </p>
                  </section>
                ) : (
                  <section>
                    <h3 className="opportunities-titulo">
                      {tipoAtivo ? TIPOS[tipoAtivo].label : ""}
                    </h3>
                    <p className="stats-lede">
                      {tipoAtivo ? TIPOS[tipoAtivo].pergunta : ""}{" "}
                      <strong>{detalhe.length}</strong> de{" "}
                      {atual.territorios.length} territórios analisados, a partir
                      de {ancoras.length} bases de referência ({atual.electionYear},{" "}
                      {atual.officeName}). A similaridade mede semelhança entre
                      características territoriais agregadas — não é previsão de
                      comportamento de eleitores.
                    </p>

                    {tipoAtivo && !insumos[tipoAtivo].disponivel ? (
                      <div className="opportunities-sem-insumo">
                        <p>
                          <TriangleAlert size={14} aria-hidden />
                          <strong>Este tipo não pôde ser calculado.</strong>
                        </p>
                        <p>{insumos[tipoAtivo].motivo}</p>
                        <p className="opportunities-sem-insumo__nota">
                          Isso não é o mesmo que “nenhum município se
                          enquadra”. Não há como avaliar, então nenhuma
                          conclusão sobre estes territórios sai daqui — nem
                          positiva, nem negativa.
                        </p>
                      </div>
                    ) : detalhe.length === 0 ? (
                      <p className="panel-empty">
                        {filtrosAtivos
                          ? "Nenhum território deste tipo passa nos filtros. Afrouxe a similaridade mínima no painel ao lado."
                          : "Nenhum território caiu neste tipo neste pleito."}
                      </p>
                    ) : (
                      <ul className="opportunity-list">
                        {detalhe.map((item) => {
                          const metricas = atual.territorios.find(
                            (t) => t.ibgeCode === item.ibgeCode,
                          );
                          const similaridade = similaridades.get(item.ibgeCode) ?? null;
                          const expandido = territorioExpandido === item.ibgeCode;
                          const lift = metricas?.lift ?? null;

                          return (
                            <li key={item.ibgeCode} className="opportunity-item">
                              {/* Calha numérica à esquerda: o lift é o número que
                                  decide, então ele alinha a lista inteira e fica
                                  escaneável de cima a baixo. */}
                              <div className="opportunity-item__lift">
                                <strong>{numero(lift, 2)}</strong>
                                <BarraDeLift lift={lift} />
                                <small>lift vs. estado</small>
                              </div>

                              <div className="opportunity-item__corpo">
                                <p className="opportunity-item__nome">
                                  <MapPin size={13} aria-hidden />
                                  {item.nome}
                                </p>
                                <p className="opportunity-explanation">
                                  {comoFrase(item.motivo || item.explicacao)}
                                </p>

                                <dl className="opportunity-metrics">
                                  <div>
                                    <dt>Votos</dt>
                                    <dd>
                                      {metricas?.votos.toLocaleString("pt-BR") ?? SEM_DADO}
                                    </dd>
                                  </div>
                                  <div>
                                    <dt>No bloco</dt>
                                    <dd>
                                      {metricas?.participacaoNoBloco != null
                                        ? `${numero(metricas.participacaoNoBloco * 100, 1)}%`
                                        : SEM_DADO}
                                    </dd>
                                  </div>
                                  <div>
                                    <dt>Similaridade</dt>
                                    <dd>
                                      {similaridade !== null
                                        ? `${numero(similaridade, 0)}%`
                                        : SEM_DADO}
                                    </dd>
                                  </div>
                                </dl>

                                {item.avisos.length > 0 && (
                                  <ul className="opportunity-warnings">
                                    {item.avisos.map((aviso) => (
                                      <li key={aviso}>
                                        <TriangleAlert size={12} aria-hidden /> {aviso}
                                      </li>
                                    ))}
                                  </ul>
                                )}

                                <button
                                  type="button"
                                  className="opportunity-item__toggle"
                                  onClick={() =>
                                    setTerritorioExpandido(
                                      expandido ? null : item.ibgeCode,
                                    )
                                  }
                                  aria-expanded={expandido}
                                >
                                  <ChevronDown
                                    size={13}
                                    aria-hidden
                                    className={expandido ? "is-aberto" : undefined}
                                  />
                                  {expandido
                                    ? "Ocultar territórios de perfil parecido"
                                    : "Ver territórios de perfil parecido"}
                                </button>

                                {expandido && (
                                  <div className="opportunity-similars">
                                    <ul>
                                      {findSimilarTerritories(item.ibgeCode, matriz, {
                                        limite: 5,
                                      }).map((similar) => (
                                        <li key={similar.ibgeCode}>
                                          <span className="opportunity-similars__topo">
                                            <span className="opportunity-similars__nome">
                                              {similar.nome}
                                            </span>
                                            <span>
                                              {numero(similar.similaridade, 0)}% ·{" "}
                                              {similar.featuresComparadas} variáveis
                                            </span>
                                          </span>
                                          <small>
                                            Aproxima:{" "}
                                            {similar.aproximam
                                              .map((d) => d.label)
                                              .join(", ")}
                                            . Afasta:{" "}
                                            {similar.afastam
                                              .map((d) => d.label)
                                              .join(", ")}
                                            .
                                          </small>
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </section>
                )}
              </div>
            </div>
          );
        })()
      )}
    </div>
  );
}

export default OpportunitiesWindow;
