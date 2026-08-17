import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  STATE_LABEL,
  STATE_NAME_NORMALIZED,
  STATE_UF,
  STATE_UF_UPPER,
} from "../../src/utils/state.ts";

/**
 * Guarda contra o resquício que já apareceu CINCO vezes neste projeto.
 *
 * A plataforma nasceu para o Rio Grande do Sul e foi apontada para Goiás. Cada
 * "rs" que sobrou falhou em silêncio, e cada um custou uma rodada inteira de
 * depuração com a usuária:
 *
 *   1. `candidate_members` lia `consulta_cand_AAAA_rs.csv` — carregava o
 *      cadastro do estado errado sem dar erro;
 *   2. `STATE_IBGE_CODE = "43"` comparava a soma municipal de Goiás com o
 *      total do Rio Grande do Sul;
 *   3. o histórico exigia 2º turno de governador, que houve no RS e não em
 *      Goiás;
 *   4. `loadPollingPlaces("rs")` procurava `places-rs.json`: a camada de
 *      locais dizia "não gerado" com 2.566 locais prontos no disco;
 *   5. a busca por endereço só aceitava "rs"/"rio grande do sul" e descartava
 *      endereço de Goiás.
 *
 * Nenhum deles quebrava o build, o tipo ou o lint — por isso este teste existe
 * e varre o código-fonte procurando a sigla solta. Se ele falhar, não relaxe a
 * regra: troque o valor por `STATE_UF` de `src/utils/state.ts`.
 */

const RAIZ = new URL("../../src", import.meta.url).pathname;

/** Onde é legítimo o texto "rs" aparecer, e por quê. */
const PERMITIDOS = new Set([
  // O próprio arquivo que documenta o problema.
  "utils/state.ts",
]);

function arquivosFonte(pasta: string, prefixo = ""): string[] {
  const encontrados: string[] = [];
  for (const nome of readdirSync(pasta)) {
    const caminho = join(pasta, nome);
    const relativo = prefixo ? `${prefixo}/${nome}` : nome;
    if (statSync(caminho).isDirectory()) {
      encontrados.push(...arquivosFonte(caminho, relativo));
    } else if (/\.tsx?$/.test(nome)) {
      encontrados.push(relativo);
    }
  }
  return encontrados;
}

/** Tira comentários: o texto explicativo pode (e deve) citar o problema. */
function semComentarios(codigo: string): string {
  return codigo
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

test("nenhuma sigla de estado solta no código-fonte", () => {
  const suspeitos: string[] = [];
  // Só sigla entre aspas: `_rs.csv` em texto de comentário já foi filtrado, e
  // palavras que contêm "rs" (como "errors") não podem dar falso positivo.
  const padrao = /["'`](rs|RS|rio grande do sul)["'`]/;

  for (const relativo of arquivosFonte(RAIZ)) {
    if (PERMITIDOS.has(relativo)) continue;
    const codigo = semComentarios(
      readFileSync(join(RAIZ, relativo), "utf8"),
    );
    for (const [numero, linha] of codigo.split("\n").entries()) {
      if (padrao.test(linha)) {
        suspeitos.push(`${relativo}:${numero + 1}: ${linha.trim()}`);
      }
    }
  }

  assert.deepEqual(
    suspeitos,
    [],
    `Sigla de estado fixa no código. Use STATE_UF de src/utils/state.ts:\n${suspeitos.join("\n")}`,
  );
});

test("as constantes de estado são coerentes entre si", () => {
  assert.equal(STATE_UF, "go");
  assert.equal(STATE_UF_UPPER, STATE_UF.toUpperCase());
  assert.equal(STATE_LABEL, "Goiás");
  // O nome normalizado é o que a busca compara: sem acento e minúsculo.
  assert.equal(
    STATE_NAME_NORMALIZED,
    STATE_LABEL.normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase(),
  );
});

test("o arquivo de locais que o app carrega é o do estado configurado", () => {
  // O nome do arquivo é montado a partir de STATE_UF; se alguém trocar a
  // constante sem regerar os dados, este teste aponta a inconsistência antes
  // de a camada dizer "ainda não gerado" com o arquivo certo do lado.
  const esperado = `places-${STATE_UF}.json`;
  const pasta = new URL("../../src/data/polling", import.meta.url).pathname;
  let existentes: string[] = [];
  try {
    existentes = readdirSync(pasta).filter((nome) =>
      nome.startsWith("places-"),
    );
  } catch {
    return; // sem a pasta de dados não há o que conferir
  }
  if (existentes.length === 0) return; // ETL ainda não rodou
  assert.ok(
    existentes.includes(esperado),
    `O app vai procurar ${esperado}, mas em src/data/polling existe: ${existentes.join(", ")}`,
  );
});
