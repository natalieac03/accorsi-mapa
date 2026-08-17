import assert from "node:assert/strict";
import test from "node:test";
import {
  dividirTrechos,
  formatarRespostaAgente,
} from "../../src/utils/agentText.ts";

/**
 * Payloads sintéticos inline: este teste NUNCA é pulado por falta de snapshot.
 *
 * O caso da primeira linha do primeiro teste é literal — foi o que apareceu na
 * tela do painel em produção, com os asteriscos crus no meio dos números.
 */

test("negrito do modelo vira trecho forte, não asterisco na tela", () => {
  // dividirTrechos cuida só do destaque dentro da linha; quem tira o "- " da
  // lista é formatarRespostaAgente (coberto no teste do formato completo).
  const trechos = dividirTrechos(
    "**Eleitorado total (TSE 2026)**: Goiânia — 1.016.153 (1º)",
  );
  assert.equal(trechos.length, 2);
  assert.deepEqual(trechos[0], {
    texto: "Eleitorado total (TSE 2026)",
    forte: true,
  });
  assert.equal(trechos[1].forte, false);
  assert.equal(trechos[1].texto, ": Goiânia — 1.016.153 (1º)");
  // O que importa de verdade: nenhum asterisco sobreviveu.
  assert.equal(
    trechos.some((trecho) => trecho.texto.includes("*")),
    false,
  );
});

test("asterisco sem par é removido em vez de virar lixo visível", () => {
  const trechos = dividirTrechos("PIB per capita * de Rio Verde ** R$ 98.850");
  const texto = trechos.map((trecho) => trecho.texto).join("");
  assert.equal(texto.includes("*"), false);
  assert.equal(texto, "PIB per capita  de Rio Verde  R$ 98.850");
  assert.equal(
    trechos.every((trecho) => trecho.forte === false),
    true,
  );
});

test("resposta no formato pedido vira frase + lista + fecho", () => {
  const resposta = [
    "Goiânia concentra o maior volume eleitoral do trio.",
    "",
    "- **Eleitorado total**: Goiânia — 1.016.153",
    "- **PIB per capita**: Rio Verde — R$ 98.850",
    "- **Índice ideológico**: Anápolis — 6,52",
    "",
    "O peso de Goiânia sugere concentrar esforço na capital.",
  ].join("\n");

  const blocos = formatarRespostaAgente(resposta);
  assert.equal(blocos.length, 3);

  assert.equal(blocos[0].tipo, "paragrafo");
  assert.equal(blocos[2].tipo, "paragrafo");

  const lista = blocos[1];
  assert.equal(lista.tipo, "lista");
  if (lista.tipo !== "lista") return;
  assert.equal(lista.ordenada, false);
  assert.equal(lista.itens.length, 3);
  assert.equal(lista.itens[0][0].texto, "Eleitorado total");
  assert.equal(lista.itens[0][0].forte, true);
});

test("lista numerada e lista com marcador não se misturam no mesmo bloco", () => {
  const blocos = formatarRespostaAgente(
    ["1. Primeiro", "2. Segundo", "- Terceiro"].join("\n"),
  );
  assert.equal(blocos.length, 2);
  assert.equal(blocos[0].tipo, "lista");
  assert.equal(blocos[1].tipo, "lista");
  if (blocos[0].tipo !== "lista" || blocos[1].tipo !== "lista") return;
  assert.equal(blocos[0].ordenada, true);
  assert.equal(blocos[0].itens.length, 2);
  assert.equal(blocos[1].ordenada, false);
  assert.equal(blocos[1].itens.length, 1);
});

test("título em Markdown vira bloco de título sem a cerquilha", () => {
  const blocos = formatarRespostaAgente("### Resumo do pleito\nTexto abaixo.");
  assert.equal(blocos[0].tipo, "titulo");
  if (blocos[0].tipo !== "titulo") return;
  assert.equal(blocos[0].trechos[0].texto, "Resumo do pleito");
  assert.equal(blocos[1].tipo, "paragrafo");
});

test("texto simples continua texto simples, sem inventar estrutura", () => {
  const blocos = formatarRespostaAgente(
    "Não há dado de alfabetização para esse município na base.",
  );
  assert.equal(blocos.length, 1);
  assert.equal(blocos[0].tipo, "paragrafo");
  if (blocos[0].tipo !== "paragrafo") return;
  assert.equal(blocos[0].trechos.length, 1);
  assert.equal(blocos[0].trechos[0].forte, false);
});

test("resposta vazia não produz bloco nenhum", () => {
  assert.deepEqual(formatarRespostaAgente(""), []);
  assert.deepEqual(formatarRespostaAgente("\n\n   \n"), []);
});

test("nenhum bloco carrega marcação crua para a tela", () => {
  const resposta = [
    "## Comparação",
    "- **Goiânia** — 1.016.153 eleitores",
    "- `Anápolis` — 287.888 eleitores",
    "Fim __do__ resumo.",
  ].join("\n");

  const textos = formatarRespostaAgente(resposta).flatMap((bloco) =>
    bloco.tipo === "lista"
      ? bloco.itens.flat().map((trecho) => trecho.texto)
      : bloco.trechos.map((trecho) => trecho.texto),
  );

  for (const texto of textos) {
    assert.equal(/[*_`#]/.test(texto), false, `sobrou marcação em: ${texto}`);
  }
});
