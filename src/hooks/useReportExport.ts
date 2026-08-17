import { useCallback, useState } from "react";
import { exportReportAsExcel } from "../utils/exportExcel";
import { exportReportAsPdf } from "../utils/exportPdf";
import type { ReportDocument } from "../utils/reportModel";

export type ReportFormat = "excel" | "pdf";

/**
 * Geração dos arquivos de entrega (.xlsx e .pdf) a partir de um documento
 * montado pelo painel.
 *
 * O que este hook resolve, e por isso não vive copiado em cada painel:
 *
 * - as duas bibliotecas entram por import dinâmico, então o PRIMEIRO clique
 *   espera por rede. Sem um estado de "gerando", o botão parece quebrado e a
 *   pessoa clica três vezes;
 * - clique duplo não pode disparar duas gerações concorrentes (duas abas de
 *   download e o dobro de memória em um recorte grande);
 * - qualquer falha (rede caída no meio do import, recorte gigante) precisa
 *   virar mensagem no aviso acessível do painel, nunca uma tela travada.
 *
 * `build` recebe o formato porque o PDF embute a imagem do mapa e o Excel não:
 * rasterizar o mapa para uma planilha custaria segundos por nada.
 */
export function useReportExport(
  build: (formato: ReportFormat) => ReportDocument | null,
  onMessage: (mensagem: string) => void,
) {
  const [exportando, setExportando] = useState<ReportFormat | null>(null);

  const exportar = useCallback(
    async (formato: ReportFormat) => {
      if (exportando) return;
      setExportando(formato);
      onMessage(
        formato === "excel"
          ? "Gerando a pasta de trabalho…"
          : "Gerando o relatório em PDF…",
      );
      try {
        const relatorio = build(formato);
        if (!relatorio) {
          onMessage("Não há dados neste recorte para exportar.");
          return;
        }
        const gerado =
          formato === "excel"
            ? await exportReportAsExcel(relatorio)
            : await exportReportAsPdf(relatorio);
        onMessage(
          gerado
            ? formato === "excel"
              ? "Pasta de trabalho .xlsx baixada."
              : "Relatório em PDF baixado."
            : "Este recorte não tem nenhuma linha para exportar.",
        );
      } catch {
        onMessage(
          "Não foi possível gerar o arquivo. Tente novamente em instantes.",
        );
      } finally {
        setExportando(null);
      }
    },
    [build, exportando, onMessage],
  );

  return { exportando, exportar };
}
