import type {
  BairroComparisonRow,
  BairroRow,
  CandidateContest,
  CandidateDataset,
  CandidateRankingMetric,
  CandidateRankingMetricId,
  CandidateRankingRow,
  CandidateMunicipio,
  ElectorateIndex,
  ElectorateSource,
  TrajectoryPoint,
} from "../types/candidate";
import { createCsv, formatCsvDecimal, type CsvCell } from "./csv.ts";

/**
 * Motor da aba "Accorsi" (trajetória de uma candidatura em foco).
 *
 * Tudo aqui é puro e sem React, para os testes cobrirem a aritmética sem
 * montar componente. Disciplina de cálculo, herdada do resto do projeto:
 *
 * - nunca média de médias — percentuais sempre saem de somas ou vêm prontos
 *   do processamento por seção;
 * - percentual/taxa só existe com denominador > 0; sem denominador o valor é
 *   null e a linha fica FORA do ranking (não vira 0, que seria mentira);
 * - arredondamentos são declarados na função que os faz.
 */

/** Goiânia — único município com recorte de bairros relevante para a aba. */
export const GOIANIA_IBGE = "5208707";

export const CANDIDATE_RANKING_METRICS: CandidateRankingMetric[] = [
  {
    id: "votos",
    label: "Votos absolutos",
    shortLabel: "Votos",
    description: "Total de votos nominais da candidatura no município.",
    csvHeader: "Votos",
    requiresElectorate: false,
  },
  {
    id: "percentualValidos",
    label: "% dos votos válidos",
    shortLabel: "% válidos",
    description:
      "Fatia dos votos nominais válidos do cargo que foi para a candidatura.",
    csvHeader: "% dos válidos",
    requiresElectorate: false,
  },
  {
    id: "percentualPartido",
    label: "% do próprio partido",
    shortLabel: "% do partido",
    description:
      "Quanto do voto do partido no município é nominalmente da candidatura.",
    csvHeader: "% do partido",
    requiresElectorate: false,
  },
  {
    id: "votosPorMilEleitores",
    label: "Votos por 1.000 eleitores",
    shortLabel: "Por 1.000 eleitores",
    description:
      "Densidade da votação sobre o eleitorado apto do município — compara " +
      "cidades de tamanhos muito diferentes.",
    csvHeader: "Votos por 1.000 eleitores",
    requiresElectorate: true,
  },
];

export function getCandidateRankingMetric(
  id: CandidateRankingMetricId,
): CandidateRankingMetric {
  return (
    CANDIDATE_RANKING_METRICS.find((metric) => metric.id === id) ??
    CANDIDATE_RANKING_METRICS[0]
  );
}

/** true enquanto o JSON da candidata for o placeholder do repositório. */
export function isCandidatePendente(dataset: CandidateDataset): boolean {
  return dataset.metadata.status === "pendente" || dataset.contests.length === 0;
}

/**
 * ibge -> eleitorado. Devolve null quando o snapshot do eleitorado ainda é
 * placeholder: a métrica "por 1.000 eleitores" precisa saber a diferença entre
 * "sem arquivo" (desabilita a métrica inteira) e "município sem dado" (só a
 * linha fica de fora).
 */
export function buildElectorateIndex(source: ElectorateSource): ElectorateIndex {
  const entries = Object.entries(source.municipalities);
  if (source.metadata.status === "pendente" || entries.length === 0) return null;
  const index: Record<string, number> = {};
  for (const [ibge, municipio] of entries) {
    // Eleitorado zerado não vira denominador: taxa sobre 0 não existe.
    if (municipio.electorate > 0) index[ibge] = municipio.electorate;
  }
  return index;
}

/**
 * Votos por 1.000 eleitores, arredondado (declarado) a 2 casas.
 * Sem eleitorado positivo não há taxa — null, nunca 0.
 */
export function votosPorMilEleitores(
  votos: number,
  eleitorado: number | null | undefined,
): number | null {
  if (!eleitorado || eleitorado <= 0) return null;
  return Math.round((votos / eleitorado) * 1000 * 100) / 100;
}

const RESULTADO_LABELS: Record<string, string> = {
  ELEITO: "Eleita",
  "ELEITO POR QP": "Eleita por QP",
  "ELEITO POR MEDIA": "Eleita por média",
  "ELEITO POR MÉDIA": "Eleita por média",
  "NAO ELEITO": "Não eleita",
  "NÃO ELEITO": "Não eleita",
  SUPLENTE: "Suplente",
  "2 TURNO": "Foi ao 2º turno",
  "2º TURNO": "Foi ao 2º turno",
};

/** Traduz o DS_SIT_TOT_TURNO do TSE para um rótulo curto de interface. */
export function formatResultado(resultado: string): string {
  const chave = resultado.trim().toUpperCase();
  if (!chave) return "Sem resultado informado";
  return RESULTADO_LABELS[chave] ?? chave.charAt(0) + chave.slice(1).toLowerCase();
}

/**
 * Rótulos ainda mais curtos para o pé das barras do gráfico: com 6–7 pleitos
 * a faixa de cada barra tem ~45px e um rótulo longo colidiria com o vizinho.
 * O rótulo completo continua no tooltip e no dropdown.
 */
const RESULTADO_SHORT: Record<string, string> = {
  "Eleita por QP": "Eleita QP",
  "Eleita por média": "Eleita",
  "Foi ao 2º turno": "2º turno",
  "Sem resultado informado": "—",
};

export function formatResultadoShort(resultado: string): string {
  const label = formatResultado(resultado);
  return RESULTADO_SHORT[label] ?? label;
}

/**
 * Resultados que a TELA não carimba. O dado continua inteiro no JSON, no CSV
 * exportado e no backend — some só da vitrine.
 *
 * Derrota não é rótulo de interface: a plataforma é ferramenta de campanha, e
 * escrever "não eleita" sob cada barra não acrescenta nada ao que o número de
 * votos já diz. Resultado que o voto sozinho NÃO conta continua aparecendo —
 * eleita, eleita por QP, suplente, foi ao 2º turno —, porque essa é
 * informação de verdade e não sobra de formulário do TSE.
 */
const RESULTADOS_FORA_DA_VITRINE = new Set([
  "",
  "NAO ELEITO",
  "NÃO ELEITO",
  "NAO ELEITA",
  "NÃO ELEITA",
  "#NULO#",
]);

function foraDaVitrine(resultado: string): boolean {
  return RESULTADOS_FORA_DA_VITRINE.has(resultado.trim().toUpperCase());
}

/** Rótulo de resultado para a tela; string vazia quando não se mostra. */
export function formatResultadoVitrine(resultado: string): string {
  return foraDaVitrine(resultado) ? "" : formatResultado(resultado);
}

/** Idem, na versão curta que cabe sob a barra do gráfico. */
export function formatResultadoVitrineShort(resultado: string): string {
  return foraDaVitrine(resultado) ? "" : formatResultadoShort(resultado);
}

/**
 * Cargos encurtados para caber sob as barras do gráfico de trajetória: com
 * 7 pleitos cada banda tem ~42px e "Dep. Estadual" (~54px) colidiria com o
 * vizinho. O nome completo do cargo fica no tooltip e no dropdown.
 */
const OFFICE_SHORT: Record<number, string> = {
  1: "Pres.",
  3: "Gov.",
  5: "Senadora",
  6: "Dep. Fed.",
  7: "Dep. Est.",
  8: "Dep. Dist.",
  11: "Prefeita",
  13: "Vereadora",
};

export function getOfficeShort(officeCode: number, officeName: string): string {
  return OFFICE_SHORT[officeCode] ?? officeName;
}

/**
 * Série do gráfico central: uma barra por pleito, em ordem cronológica.
 * A ordem visual é sempre ascendente por ano (2014 -> 2024), mesmo que o JSON
 * venha do mais recente para o mais antigo.
 */
export function buildTrajectory(dataset: CandidateDataset): TrajectoryPoint[] {
  return [...dataset.contests]
    .sort(
      (a, b) =>
        a.electionYear - b.electionYear ||
        a.round - b.round ||
        a.officeCode - b.officeCode,
    )
    .map((contest) => ({
      id: contest.id,
      electionYear: contest.electionYear,
      officeCode: contest.officeCode,
      officeName: contest.officeName,
      officeShort: getOfficeShort(contest.officeCode, contest.officeName),
      round: contest.round,
      resultado: contest.candidatura.resultado,
      // Rótulos de VITRINE: o campo cru fica logo acima, intacto, para o CSV
      // e para quem consultar o dado.
      resultadoLabel: formatResultadoVitrine(contest.candidatura.resultado),
      resultadoShort: formatResultadoVitrineShort(contest.candidatura.resultado),
      partido: contest.candidatura.partido,
      votos: contest.votosNoEstado,
    }));
}

/**
 * Valor da métrica para um município. Percentuais chegam prontos do
 * processamento por seção (calculados sobre somas, nunca média de médias);
 * aqui só se decide o que é null.
 */
export function getRankingMetricValue(
  municipio: CandidateMunicipio,
  metricId: CandidateRankingMetricId,
  eleitorado: number | null,
): number | null {
  switch (metricId) {
    case "votos":
      return municipio.votos;
    case "percentualValidos":
      return municipio.percentualValidos;
    case "percentualPartido":
      return municipio.percentualDoPartido;
    case "votosPorMilEleitores":
      return votosPorMilEleitores(municipio.votos, eleitorado);
  }
}

/**
 * Ranking municipal da eleição selecionada. Linhas sem valor (denominador
 * ausente) ficam fora — um município sem eleitorado apurado não pode ocupar
 * posição num ranking de taxa. Empates desempatam por votos e depois por nome,
 * para a ordem ser estável entre renderizações.
 */
export function buildMunicipioRanking(
  contest: CandidateContest,
  metricId: CandidateRankingMetricId,
  electorateIndex: ElectorateIndex,
  limit = 15,
): CandidateRankingRow[] {
  const rows: CandidateRankingRow[] = [];
  for (const [ibge, municipio] of Object.entries(contest.municipios)) {
    const eleitorado = electorateIndex ? (electorateIndex[ibge] ?? null) : null;
    const value = getRankingMetricValue(municipio, metricId, eleitorado);
    if (value === null) continue;
    rows.push({
      ibgeCode: ibge,
      nome: municipio.nome,
      votos: municipio.votos,
      value,
      posicaoNoMunicipio: municipio.posicaoNoMunicipio,
      eleitorado,
    });
  }
  rows.sort(
    (a, b) =>
      b.value - a.value ||
      b.votos - a.votos ||
      a.nome.localeCompare(b.nome, "pt-BR"),
  );
  return rows.slice(0, limit);
}

/** Bairros de um município no pleito, do mais votado para o menos. */
export function getBairros(
  contest: CandidateContest,
  ibge: string = GOIANIA_IBGE,
): BairroRow[] | null {
  const mapa = contest.bairros?.[ibge];
  if (!mapa) return null;
  const rows = Object.entries(mapa)
    .map(([bairro, votos]) => ({ bairro, votos }))
    .sort(
      (a, b) => b.votos - a.votos || a.bairro.localeCompare(b.bairro, "pt-BR"),
    );
  return rows.length > 0 ? rows : null;
}

/** Pleitos com recorte de bairros para o município, em ordem cronológica. */
export function listContestsComBairros(
  dataset: CandidateDataset,
  ibge: string = GOIANIA_IBGE,
): CandidateContest[] {
  return dataset.contests
    .filter((contest) => {
      const mapa = contest.bairros?.[ibge];
      return !!mapa && Object.keys(mapa).length > 0;
    })
    .sort((a, b) => a.electionYear - b.electionYear || a.round - b.round);
}

/**
 * Comparação bairro a bairro entre dois pleitos com recorte submunicipal —
 * a leitura mais valiosa da aba: onde a votação cresceu dentro da capital.
 *
 * Bairro ausente num pleito fica null (o cadastro daquele ano não apurou voto
 * ali — não é zero). A variação % (arredondada, declarado, a 1 casa) só existe
 * quando os dois lados têm valor e a base é positiva; "bairro novo" não tem
 * taxa de crescimento, tem estreia.
 */
export function compareBairros(
  anterior: CandidateContest,
  recente: CandidateContest,
  ibge: string = GOIANIA_IBGE,
): BairroComparisonRow[] {
  const antes = anterior.bairros?.[ibge] ?? {};
  const depois = recente.bairros?.[ibge] ?? {};
  const nomes = new Set([...Object.keys(antes), ...Object.keys(depois)]);
  const rows: BairroComparisonRow[] = [];
  for (const bairro of nomes) {
    const votosAnterior = Object.hasOwn(antes, bairro) ? antes[bairro] : null;
    const votosRecente = Object.hasOwn(depois, bairro) ? depois[bairro] : null;
    const variacaoPct =
      votosAnterior !== null && votosAnterior > 0 && votosRecente !== null
        ? Math.round(((votosRecente - votosAnterior) / votosAnterior) * 1000) / 10
        : null;
    rows.push({ bairro, votosAnterior, votosRecente, variacaoPct });
  }
  // Ordena pela força no pleito recente; bairros que sumiram vão para o fim.
  rows.sort(
    (a, b) =>
      (b.votosRecente ?? -1) - (a.votosRecente ?? -1) ||
      (b.votosAnterior ?? -1) - (a.votosAnterior ?? -1) ||
      a.bairro.localeCompare(b.bairro, "pt-BR"),
  );
  return rows;
}

/**
 * Ticks "limpos" do eixo Y do gráfico de trajetória (0, 50 mil, 100 mil…).
 * O topo do eixo pode ficar abaixo do máximo da série — o rótulo direto no
 * topo da barra carrega o valor exato, então o eixo só dá a régua.
 */
export function buildAxisTicks(maxValue: number, tickCount = 3): number[] {
  if (maxValue <= 0) return [0];
  const rawStep = maxValue / tickCount;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const step =
    [1, 2, 2.5, 5, 10]
      .map((candidate) => candidate * magnitude)
      .find((candidate) => candidate >= rawStep) ?? 10 * magnitude;
  const ticks: number[] = [];
  for (let value = 0; value <= maxValue + 1e-9; value += step) {
    ticks.push(Math.round(value));
  }
  return ticks;
}

const integerPt = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const decimalPt = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

/**
 * Número compacto pt-BR para rótulos de gráfico ("127,5 mil", "1,2 mi").
 * Arredondamento declarado: 1 casa nos compactos; o valor exato continua no
 * tooltip e no CSV.
 */
export function formatCompactPt(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${decimalPt.format(value / 1_000_000)} mi`;
  if (abs >= 1_000) return `${decimalPt.format(value / 1_000)} mil`;
  return integerPt.format(value);
}

/** Valor da métrica formatado para a interface (pt-BR). */
export function formatRankingValue(
  metricId: CandidateRankingMetricId,
  value: number,
): string {
  if (metricId === "votos") return integerPt.format(value);
  if (metricId === "votosPorMilEleitores") return decimalPt.format(value);
  return `${decimalPt.format(value)}%`;
}

/** Rótulo do pleito para o dropdown e para títulos de seção. */
export function getContestLabel(contest: CandidateContest): string {
  const turno = contest.round > 1 ? ` · ${contest.round}º turno` : "";
  return `${contest.electionYear} · ${contest.officeName}${turno}`;
}

/**
 * CSV do ranking exibido, no dialeto do projeto (createCsv já põe BOM e
 * ponto e vírgula). Decimais com vírgula via formatCsvDecimal, para abrir
 * direto no Excel/LibreOffice em pt-BR.
 */
export function createCandidateRankingCsv(
  metricId: CandidateRankingMetricId,
  rows: CandidateRankingRow[],
): string {
  const metric = getCandidateRankingMetric(metricId);
  const headers = ["Posição", "Município", "Votos", metric.csvHeader];
  const body: CsvCell[][] = rows.map((row, index) => [
    index + 1,
    row.nome,
    row.votos,
    metricId === "votos" ? row.value : formatCsvDecimal(row.value),
  ]);
  return createCsv(headers, body);
}

export function getCandidateCsvFilename(
  contest: CandidateContest,
  metricId: CandidateRankingMetricId,
): string {
  const slug = metricId.toLowerCase();
  return `trajetoria-${contest.id}-${slug}.csv`;
}
