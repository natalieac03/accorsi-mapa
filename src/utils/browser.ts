/**
 * Dispara o download de um Blob já pronto. Usar para binários (.xlsx, .pdf):
 * passar os bytes por string corromperia o arquivo (sequência UTF-8 inválida
 * vira U+FFFD).
 */
export function downloadBlobFile(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoga no próximo tick: revogar antes de o clique ser processado cancela o
  // download em navegadores baseados no Chromium.
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function downloadTextFile(
  content: string,
  filename: string,
  mimeType = "text/plain;charset=utf-8",
) {
  downloadBlobFile(new Blob([content], { type: mimeType }), filename);
}

export async function copyTextToClipboard(value: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Continua para o fallback compatível com HTTP local.
    }
  }

  if (typeof document === "undefined") return false;

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();

  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}
