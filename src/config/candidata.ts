/**
 * Identidade da candidatura atendida por esta instalação.
 *
 * Existe porque a aba Oportunidades já foi escrita contra o contrato do
 * "coringa" (`config/candidata.ts` + `config/estado.ts`), e esta instalação
 * ainda carrega o nome da candidatura em texto fixo espalhado — `App.tsx`,
 * rótulos do menu, contrato do agente. Este arquivo é o começo da migração:
 * um lugar só para o que a tela precisa saber sobre "quem é a candidatura".
 *
 * ATENÇÃO ao mesclar com a versão coringa: lá este arquivo é GERADO por
 * `aplicar_campanha.sh` a partir de `campanha.conf`. Quando essa geração
 * chegar aqui, este arquivo deve ser substituído pelo gerado, não editado à
 * mão — e o campo `genero` passa a vir de `CANDIDATA_GENERO`.
 */

export const CANDIDATA = {
  /** Nome como aparece em texto corrido e em cabeçalho de janela. */
  nomeCompleto: "Dra. Adriana Accorsi",
  /** Forma curta, usada como marca no cabeçalho e na tela de carregamento. */
  nomeAba: "ACCORSI",
  partido: "PT",
  /** "F" | "M": flexiona rótulos de cargo e de resultado. */
  genero: "F",
} as const;
