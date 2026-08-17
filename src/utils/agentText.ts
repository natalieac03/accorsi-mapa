/**
 * Formatação da resposta do agente para leitura na tela.
 *
 * O modelo escreve em Markdown por hábito, e o painel renderizava o texto cru
 * dentro de um <p>: o resultado eram asteriscos soltos no meio dos números
 * ("**Eleitorado total** — 1.016.153"), que poluem exatamente o que a pessoa
 * precisa ler rápido.
 *
 * Aqui o texto vira ESTRUTURA (parágrafos, listas, trechos em negrito) que o
 * componente renderiza como elementos React de verdade. Nada de HTML injetado:
 * o conteúdo vem de um modelo de linguagem, e transformar isso em markup por
 * string seria abrir uma porta de XSS por conveniência de formatação.
 *
 * O escopo é deliberadamente pequeno — negrito, listas e títulos curtos. Não é
 * um renderizador de Markdown, é uma faxina: o que não for reconhecido perde a
 * pontuação decorativa e volta como texto limpo, nunca como asterisco órfão.
 */

/** Um pedaço de linha: texto comum ou destacado. */
export type TrechoAgente = {
  texto: string;
  forte: boolean;
};

export type BlocoAgente =
  | { tipo: "paragrafo"; trechos: TrechoAgente[] }
  | { tipo: "titulo"; trechos: TrechoAgente[] }
  | { tipo: "lista"; ordenada: boolean; itens: TrechoAgente[][] };

const MARCADOR_LISTA = /^\s{0,4}[-*•–]\s+/;
const MARCADOR_ORDENADA = /^\s{0,4}(\d{1,2})[.)]\s+/;
const MARCADOR_TITULO = /^\s{0,3}#{1,6}\s+/;

/**
 * Quebra uma linha em trechos comuns e fortes.
 *
 * Só pares COMPLETOS de ** viram negrito. Um asterisco sozinho é lixo de
 * formatação e sai da string — deixá-lo passar seria repetir o defeito que
 * esta função existe para corrigir.
 */
export function dividirTrechos(linha: string): TrechoAgente[] {
  const trechos: TrechoAgente[] = [];
  const padrao = /\*\*(.+?)\*\*|__(.+?)__/g;
  let ultimo = 0;
  let achado: RegExpExecArray | null;

  while ((achado = padrao.exec(linha)) !== null) {
    if (achado.index > ultimo) {
      trechos.push({ texto: linha.slice(ultimo, achado.index), forte: false });
    }
    trechos.push({ texto: achado[1] ?? achado[2] ?? "", forte: true });
    ultimo = achado.index + achado[0].length;
  }
  if (ultimo < linha.length) {
    trechos.push({ texto: linha.slice(ultimo), forte: false });
  }

  return trechos
    .map((trecho) => ({
      ...trecho,
      // Asteriscos e crases remanescentes não fecharam par: viram texto limpo.
      texto: trecho.texto.replace(/[*_`]/g, ""),
    }))
    .filter((trecho) => trecho.texto.length > 0);
}

/** Converte a resposta do agente em blocos prontos para render. */
export function formatarRespostaAgente(texto: string): BlocoAgente[] {
  const blocos: BlocoAgente[] = [];
  const linhas = texto.replace(/\r\n/g, "\n").split("\n");

  let listaAtual: { ordenada: boolean; itens: TrechoAgente[][] } | null = null;

  const fecharLista = () => {
    if (listaAtual && listaAtual.itens.length > 0) {
      blocos.push({
        tipo: "lista",
        ordenada: listaAtual.ordenada,
        itens: listaAtual.itens,
      });
    }
    listaAtual = null;
  };

  for (const linhaBruta of linhas) {
    const linha = linhaBruta.trimEnd();
    if (!linha.trim()) {
      fecharLista();
      continue;
    }

    if (MARCADOR_TITULO.test(linha)) {
      fecharLista();
      const trechos = dividirTrechos(linha.replace(MARCADOR_TITULO, ""));
      if (trechos.length > 0) blocos.push({ tipo: "titulo", trechos });
      continue;
    }

    const ehOrdenada = MARCADOR_ORDENADA.test(linha);
    const ehLista = MARCADOR_LISTA.test(linha);
    if (ehLista || ehOrdenada) {
      const conteudo = linha.replace(ehOrdenada ? MARCADOR_ORDENADA : MARCADOR_LISTA, "");
      const trechos = dividirTrechos(conteudo);
      if (trechos.length === 0) continue;
      // Trocar de tipo de lista no meio começa uma lista nova, em vez de
      // misturar numeração com marcador no mesmo bloco.
      if (!listaAtual || listaAtual.ordenada !== ehOrdenada) {
        fecharLista();
        listaAtual = { ordenada: ehOrdenada, itens: [] };
      }
      listaAtual.itens.push(trechos);
      continue;
    }

    fecharLista();
    const trechos = dividirTrechos(linha);
    if (trechos.length > 0) blocos.push({ tipo: "paragrafo", trechos });
  }

  fecharLista();
  return blocos;
}
