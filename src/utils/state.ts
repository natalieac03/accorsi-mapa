/**
 * A UF que esta instalação cobre, em um lugar só.
 *
 * Sigla de estado espalhada como texto solto pelo código falha em SILÊNCIO:
 * não dá erro, apenas não acha o dado (ou acha o do estado errado). Apontar a
 * plataforma para outro estado é trocar ESTE arquivo; o teste
 * `scripts/tests/estado.test.ts` falha se alguma sigla solta voltar ao código.
 */

/** Sigla em minúsculas, como aparece no nome dos arquivos de dados. */
export const STATE_UF = "go";

/** Sigla em maiúsculas, como o TSE grava em SG_UF. */
export const STATE_UF_UPPER = "GO";

/** Nome do estado já normalizado (sem acento, minúsculo), para comparação. */
export const STATE_NAME_NORMALIZED = "goias";

/** Nome do estado para a interface. */
export const STATE_LABEL = "Goiás";
