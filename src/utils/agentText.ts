/**
 * Formatação da resposta do agente para leitura na tela: o Markdown do modelo
 * vira ESTRUTURA (parágrafos, listas, negrito) que o componente renderiza como
 * elementos React. Nada de HTML injetado, que abriria XSS com texto vindo de um
 * modelo de linguagem. Escopo pequeno de propósito (negrito, listas, títulos
 * curtos); o que não for reconhecido perde a pontuação decorativa e volta como
 * texto limpo, nunca como asterisco órfão.
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
 * Quebra uma linha em trechos comuns e fortes. Só pares COMPLETOS de ** viram
 * negrito; asterisco sozinho é lixo de formatação e sai da string.
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
      // Trocar de tipo de lista no meio começa uma lista nova.
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
