/**
 * Configuração do estado atendido por esta instalação.
 *
 * Este arquivo é a ÚNICA fonte da verdade sobre "que estado é este". Ele existe
 * porque a plataforma nasceu no Rio Grande do Sul e foi levada para Goiás: sem
 * um ponto único, a sigla, a contagem de municípios e os limites do mapa ficam
 * espalhados por dezenas de arquivos, e a troca vira caça a bug silencioso —
 * um `246` esquecido num validador não quebra a tela, só rejeita o dado inteiro
 * com uma mensagem confusa.
 *
 * Para levar esta base a outro estado, mude AQUI e rode os scripts de dados.
 * O equivalente em Python vive em `scripts/estado.py` e precisa concordar com
 * este arquivo — há um teste garantindo isso.
 */

export const ESTADO = {
  /** Sigla usada pelo TSE e pelo IBGE nas URLs e nos arquivos de dados. */
  uf: "GO",
  nome: "Goiás",
  /** Código numérico do IBGE. Todo código municipal do estado começa com ele. */
  codigoIbge: "52",
  /**
   * Municípios esperados. É validação DURA nos scripts de ETL: se a base vier
   * com outro número, o processamento falha em vez de gerar um mapa incompleto.
   */
  municipios: 246,
  /** Centro aproximado para o enquadramento inicial do mapa. */
  centro: { lat: -15.93, lng: -49.6 },
  /**
   * Retângulo que contém o estado, com folga. Restringe a navegação do mapa
   * para a pessoa não se perder fora do território analisado.
   */
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
