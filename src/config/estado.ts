/**
 * Configuração do estado atendido por esta instalação.
 *
 * Fonte única da verdade sobre "que estado é este": sigla, contagem de
 * municípios e limites do mapa saem daqui. Um valor divergente em outro arquivo
 * (um `246` esquecido num validador) não quebra a tela, apenas rejeita a base
 * inteira com mensagem confusa. Para trocar de estado, mude AQUI e rode os
 * scripts de dados; `scripts/estado.py` precisa concordar, e um teste cobre isso.
 */

export const ESTADO = {
  /** Sigla usada pelo TSE e pelo IBGE nas URLs e nos arquivos de dados. */
  uf: "GO",
  nome: "Goiás",
  /** Código numérico do IBGE. Todo código municipal do estado começa com ele. */
  codigoIbge: "52",
  /**
   * Municípios esperados. Validação DURA no ETL: com outro número o
   * processamento falha em vez de gerar um mapa incompleto.
   */
  municipios: 246,
  /** Centro aproximado para o enquadramento inicial do mapa. */
  centro: { lat: -15.93, lng: -49.6 },
  /** Retângulo que contém o estado, com folga; restringe a navegação do mapa. */
  limites: {
    north: -12.2,
    south: -19.7,
    west: -53.5,
    east: -45.7,
  },
  /** Capital: usada como exemplo em textos de interface e sugestões do agente. */
  capital: { nome: "Goiânia", codigoIbge: "5208707" },
} as const;

const parametrosMalha = new URLSearchParams({
  formato: "application/vnd.geo+json",
  qualidade: "minima",
  intrarregiao: "municipio",
});

/** Malha municipal oficial, buscada em runtime (não versionamos o GeoJSON). */
export const URL_MALHA_MUNICIPAL =
  `https://servicodados.ibge.gov.br/api/v3/malhas/estados/${ESTADO.uf}?${parametrosMalha.toString()}`;

export const URL_MUNICIPIOS =
  `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${ESTADO.uf}/municipios`;
