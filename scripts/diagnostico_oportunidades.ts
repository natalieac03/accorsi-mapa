/**
 * Diagnóstico da aba Oportunidades contra o dado gerado.
 *
 * Roda os mesmos motores puros que a janela usa, fora do navegador, e imprime
 * o que eles produzem com o snapshot atual: qual par de pleitos foi escolhido,
 * quantas âncoras sobraram, quantos territórios caem em cada tipo, e quanto
 * cada limiar está de fato separando.
 *
 * Existe porque a aba tem um modo de falhar silencioso: ela abre, mostra
 * cards, parece saudável — e por trás pode estar classificando um município
 * só, ou aprovando 245 de 246 territórios num limiar que não separa nada.
 * Nenhuma dessas duas coisas quebra a tela. Este script torna as duas
 * visíveis em uma execução, antes de alguém tomar decisão de campanha em
 * cima do resultado.
 *
 *   node --experimental-strip-types scripts/diagnostico_oportunidades.ts
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildContestMetrics } from "../src/utils/opportunity.ts";
import {
  avaliarInsumos,
  contarTiposDisponiveis,
  diagnosticarLimiares,
  selecionarPleitos,
} from "../src/utils/opportunityInputs.ts";
import {
  classifyTerritory,
  groupByType,
  LIMIARES,
  selectAnchors,
  TIPOS,
} from "../src/utils/opportunityTypes.ts";
import {
  buildFeatureMatrix,
  similarityToAnchors,
} from "../src/utils/territoryFeatures.ts";
import { ESTADO } from "../src/config/estado.ts";

function ler(caminho: string) {
  const url = new URL(`../${caminho}`, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), "utf-8"));
}

const candidato = ler("src/data/candidato/adriana-accorsi.json");
const electorate = ler("src/data/electorate-go.json");
const socioeconomic = ler("src/data/socioeconomic-go.json");
const ageStructure = ler("src/data/age-structure-go.json");
const literacy = ler("src/data/literacy-go.json");

const selecao = selecionarPleitos(candidato, ESTADO.municipios);
if (selecao === null) {
  console.log(
    "Nenhum pleito alcança a cobertura mínima. A aba não abre — e é isso " +
      "mesmo que ela deve fazer, em vez de analisar um município e chamar de " +
      "mapa do estado.",
  );
  process.exit(0);
}

console.log("== PLEITOS ==");
console.log(
  `referência : ${selecao.atual.officeName} ${selecao.atual.electionYear} ` +
    `(${selecao.atual.municipiosComVoto} municípios)`,
);
console.log(
  `comparação : ${
    selecao.anterior
      ? `${selecao.anterior.officeName} ${selecao.anterior.electionYear} (${selecao.anterior.municipiosComVoto} municípios)`
      : "nenhuma"
  }`,
);
if (selecao.descartados.length > 0) {
  console.log(
    `descartados: ${selecao.descartados
      .map((p) => `${p.officeName} ${p.electionYear} (${p.municipiosComVoto})`)
      .join(", ")}`,
  );
}
if (selecao.avisoDeComparacao) console.log(`\n! ${selecao.avisoDeComparacao}`);

const eleitoradoIndex = Object.fromEntries(
  Object.entries(electorate.municipalities).map(([ibge, dados]) => [
    ibge,
    (dados as { electorate: number }).electorate,
  ]),
);

const atual = buildContestMetrics(selecao.atual, eleitoradoIndex);
const anterior = selecao.anterior
  ? buildContestMetrics(selecao.anterior, eleitoradoIndex)
  : null;

console.log("\n== MÉTRICAS ==");
console.log(
  `taxa de referência : ${((atual.taxaReferencia ?? 0) * 100).toFixed(3)}%`,
);
console.log(
  `prior              : ${atual.prior.origin}, força ${atual.prior.strength.toFixed(1)}` +
    `${atual.prior.capped ? " (limitada pelo teto)" : ""}`,
);
console.log(
  `territórios        : ${atual.territorios.length} · sem denominador: ${atual.territoriosSemDenominador}`,
);

const ancoras = selectAnchors(atual);
console.log(
  `âncoras            : ${ancoras.length}` +
    (ancoras.length > 0
      ? ` → ${ancoras
          .slice(0, 5)
          .map((a) => `${a.nome} (${a.lift?.toFixed(2)})`)
          .join(", ")}`
      : " — sem âncora não há perfil de referência"),
);

const matriz = buildFeatureMatrix({
  socioeconomic,
  ageStructure,
  literacy,
  electorate,
});
const codigosAncora = ancoras.map((a) => a.ibgeCode);
const similaridades = new Map(
  atual.territorios.map((t) => [
    t.ibgeCode,
    similarityToAnchors(t.ibgeCode, codigosAncora, matriz).similaridade,
  ]),
);

const anterioresPorIbge = new Map(
  (anterior?.territorios ?? []).map((t) => [t.ibgeCode, t]),
);
const classificacoes = atual.territorios.map((t) =>
  classifyTerritory({
    ibgeCode: t.ibgeCode,
    nome: t.nome,
    atual: t,
    anterior: anterioresPorIbge.get(t.ibgeCode) ?? null,
    similaridade: similaridades.get(t.ibgeCode) ?? null,
    comparecimento: null,
    comparecimentoReferencia: null,
    avisoDeComparacao: selecao.avisoDeComparacao,
  }),
);

const insumos = avaliarInsumos({
  selecao,
  metricas: atual,
  ancoras,
  territoriosComSimilaridade: [...similaridades.values()].filter(
    (v) => v !== null,
  ).length,
  territoriosComComparecimento: 0,
});

console.log(`\n== TIPOS (${contarTiposDisponiveis(insumos)} de 7 com insumo) ==`);
const grupos = groupByType(classificacoes);
for (const [tipo, lista] of grupos) {
  const rotulo = TIPOS[tipo].label.padEnd(26);
  console.log(
    insumos[tipo].disponivel
      ? `${rotulo}${String(lista.length).padStart(4)} municípios`
      : `${rotulo}  sem insumo — ${insumos[tipo].motivo.split(".")[0]}.`,
  );
}
console.log(
  `\nsem tipo nenhum: ${classificacoes.filter((c) => c.tipoPrincipal === null).length}`,
);

console.log("\n== PODER DE SEPARAÇÃO DOS LIMIARES ==");
for (const item of diagnosticarLimiares(atual, similaridades, LIMIARES)) {
  console.log(
    `${item.rotulo.padEnd(20)} ${item.corte.padEnd(26)} ${String(item.passam).padStart(4)}/${item.total}` +
      (item.poucoSeletivo ? "   << não separa" : ""),
  );
}
