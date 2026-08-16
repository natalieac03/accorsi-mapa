import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Detector de snapshot ainda não gerado.
 *
 * Esta instalação nasce SEM dados: os arquivos de `src/data` são placeholders
 * até alguém rodar `gerar_dados.sh`, que baixa do TSE e do IBGE. Sem isso, um
 * teste que afirma "246 municípios" falharia por falta de dado, não por defeito
 * de código — e 48 falhas vermelhas escondem a única que importaria.
 *
 * Então os testes que dependem do snapshot real se ANUNCIAM como pulados, com
 * a instrução do que rodar. Assim que os dados existem, eles voltam a valer
 * sozinhos, sem editar teste nenhum.
 */

export const INSTRUCAO_GERAR =
  "dados de Goiás ainda não gerados — rode `bash gerar_dados.sh` na raiz do projeto";

function lerJson(caminhoRelativo: string): Record<string, unknown> | null {
  try {
    const url = new URL(`../../${caminhoRelativo}`, import.meta.url);
    return JSON.parse(readFileSync(fileURLToPath(url), "utf-8"));
  } catch {
    return null;
  }
}

/** `true` quando o arquivo é placeholder (status "pendente" ou sem municípios). */
export function estaPendente(caminhoRelativo: string): boolean {
  const conteudo = lerJson(caminhoRelativo);
  if (!conteudo) return true;
  const metadata = (conteudo.metadata ?? {}) as Record<string, unknown>;
  if (metadata.status === "pendente") return true;
  const total = metadata.municipalityCount;
  return typeof total === "number" && total === 0;
}

/** Snapshots que praticamente todo teste de domínio precisa. */
export const BASE_PENDENTE =
  estaPendente("src/data/electorate-go.json") ||
  estaPendente("src/data/socioeconomic-go.json");

export const ELEICOES_PENDENTES = estaPendente("src/data/election-history-go.json");
