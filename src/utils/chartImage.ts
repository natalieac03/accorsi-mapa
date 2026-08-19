import type { ReportImage } from "./reportModel.ts";

/**
 * Rasterização de gráficos e mapas para o PDF.
 *
 * jsPDF aceita imagem, não SVG, e a aparência dos gráficos vem de CLASSES CSS
 * (`.stats-chart-tick`, `.stats-traj-fill`): serializar o SVG cru rasterizaria
 * fora do documento, sem a folha de estilo, preto sobre branco. Por isso as
 * propriedades computadas são copiadas para atributos de apresentação no CLONE
 * antes de serializar. Depende de DOM e canvas, logo fora dos testes de modelo.
 * O relatório de um pleito não passa por aqui: seus gráficos são vetor
 * desenhado em `pdfDraw.ts`.
 */

/**
 * Propriedades que definem a aparência de uma marca ou rótulo. Lista curta de
 * propósito: copiar todo o `getComputedStyle` produziria centenas de atributos
 * por nó e travaria o navegador em gráficos densos.
 */
const PROPRIEDADES = [
  "fill",
  "fill-opacity",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-dasharray",
  "stroke-linecap",
  "opacity",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "text-anchor",
  "dominant-baseline",
  "letter-spacing",
] as const;

function copiarEstilos(origem: Element, destino: Element) {
  const computado = window.getComputedStyle(origem);
  const partes: string[] = [];
  for (const propriedade of PROPRIEDADES) {
    const valor = computado.getPropertyValue(propriedade);
    if (valor && valor !== "none" && valor !== "normal") {
      partes.push(`${propriedade}:${valor}`);
    } else if (propriedade === "fill" && valor === "none") {
      // `fill: none` é significativo (linha sem preenchimento) e precisa
      // sobreviver ao clone, ao contrário dos demais "none".
      partes.push("fill:none");
    }
  }
  if (partes.length > 0) destino.setAttribute("style", partes.join(";"));

  const filhosOrigem = Array.from(origem.children);
  const filhosDestino = Array.from(destino.children);
  filhosOrigem.forEach((filho, indice) => {
    const par = filhosDestino[indice];
    if (par) copiarEstilos(filho, par);
  });
}

/**
 * Converte um `<svg>` da tela em PNG (data URL) pronto para o PDF.
 *
 * `scale` multiplica a resolução: 2× mantém o texto nítido ao imprimir ou
 * ampliar. Devolve `null` se o navegador não decodificar a imagem; o relatório
 * sai sem o gráfico, nunca com um retângulo vazio no lugar.
 */
export async function svgToReportImage(
  svg: SVGSVGElement,
  input: { title: string; caption?: string; scale?: number },
): Promise<ReportImage | null> {
  if (typeof window === "undefined") return null;
  const viewBox = svg.viewBox.baseVal;
  const largura = viewBox.width || svg.clientWidth || 640;
  const altura = viewBox.height || svg.clientHeight || 360;
  const escala = input.scale ?? 2;

  const clone = svg.cloneNode(true) as SVGSVGElement;
  copiarEstilos(svg, clone);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(largura));
  clone.setAttribute("height", String(altura));
  if (!clone.getAttribute("viewBox")) {
    clone.setAttribute("viewBox", `0 0 ${largura} ${altura}`);
  }

  const markup = new XMLSerializer().serializeToString(clone);
  const url = URL.createObjectURL(
    new Blob([markup], { type: "image/svg+xml;charset=utf-8" }),
  );
  try {
    const imagem = await new Promise<HTMLImageElement | null>((resolve) => {
      const elemento = new Image();
      elemento.onload = () => resolve(elemento);
      elemento.onerror = () => resolve(null);
      elemento.src = url;
    });
    if (!imagem) return null;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(largura * escala);
    canvas.height = Math.round(altura * escala);
    const contexto = canvas.getContext("2d");
    if (!contexto) return null;
    // Fundo branco explícito: o PDF é impresso, e um PNG transparente vira
    // fundo preto em alguns leitores.
    contexto.fillStyle = "#ffffff";
    contexto.fillRect(0, 0, canvas.width, canvas.height);
    contexto.drawImage(imagem, 0, 0, canvas.width, canvas.height);
    return {
      title: input.title,
      caption: input.caption,
      dataUrl: canvas.toDataURL("image/png"),
      aspectRatio: largura / altura,
    };
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Envelopa um canvas já desenhado (o PNG do mapa) como imagem do relatório. */
export function canvasToReportImage(
  canvas: HTMLCanvasElement,
  input: { title: string; caption?: string },
): ReportImage | null {
  if (canvas.width === 0 || canvas.height === 0) return null;
  return {
    title: input.title,
    caption: input.caption,
    dataUrl: canvas.toDataURL("image/png"),
    aspectRatio: canvas.width / canvas.height,
  };
}
