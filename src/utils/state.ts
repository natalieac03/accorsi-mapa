/**
 * A UF que esta instalação cobre — em um lugar só.
 *
 * Este arquivo existe por causa de um problema real e repetido: a plataforma
 * nasceu para o Rio Grande do Sul e foi apontada para Goiás, e a sigla "rs"
 * tinha ficado espalhada como texto solto por vários módulos. Cada resquício
 * desses falha em SILÊNCIO — o código roda, não dá erro, e simplesmente não
 * acha o dado (ou acha o do estado errado):
 *
 *   - `loadPollingPlaces("rs")` procurava `places-rs.json`, que não existe:
 *     a camada de locais de votação dizia "dados ainda não gerados" com os
 *     2.566 locais de Goiás prontos no disco, ao lado;
 *   - a validação de endereço da busca só aceitava "rs"/"rio grande do sul",
 *     então endereço de Goiás era descartado;
 *   - o nome do CSV exportado saía com "rs" no lugar do recorte.
 *
 * Apontar a plataforma para outro estado é trocar ESTE arquivo — e o teste
 * `scripts/tests/estado.test.ts` falha se algum "rs" solto voltar ao código.
 */

/** Sigla em minúsculas, como aparece no nome dos arquivos de dados. */
export const STATE_UF = "go";

/** Sigla em maiúsculas, como o TSE grava em SG_UF. */
export const STATE_UF_UPPER = "GO";

/** Nome do estado já normalizado (sem acento, minúsculo), para comparação. */
export const STATE_NAME_NORMALIZED = "goias";

/** Nome do estado para a interface. */
export const STATE_LABEL = "Goiás";
