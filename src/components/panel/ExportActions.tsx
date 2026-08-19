import { Download, FileSpreadsheet, FileText, ImageDown } from "lucide-react";
import type { ReportFormat } from "../../hooks/useReportExport";

/**
 * Bloco de exportação dos painéis do mapa. Os quatro formatos atendem públicos
 * diferentes: Excel (pasta formatada, com capa de procedência e filtros), PDF
 * (documento de leitura, com capa, destaques e o mapa), CSV (todas as colunas
 * técnicas, para cruzar em outra ferramenta) e PNG (só o mapa).
 */
export function ExportActions({
  exportando,
  onExport,
  onCsv,
  onImage,
  csvLabel,
  csvDisabled = false,
  imageDisabled = false,
  imageTitle,
}: {
  exportando: ReportFormat | null;
  onExport: (formato: ReportFormat) => void;
  onCsv: () => void;
  onImage: () => void;
  /** Descrição do conteúdo do CSV, para o title do botão. */
  csvLabel: string;
  csvDisabled?: boolean;
  imageDisabled?: boolean;
  imageTitle: string;
}) {
  return (
    <section className="panel-export" aria-label="Exportar este recorte">
      <span className="panel-export__label">Exportar este recorte</span>
      <div className="panel-export__row">
        <button
          type="button"
          className="panel-export__button panel-export__button--primary"
          onClick={() => onExport("excel")}
          disabled={csvDisabled || exportando !== null}
          title="Pasta de trabalho .xlsx com capa de procedência, cabeçalho congelado e autofiltro"
        >
          <FileSpreadsheet size={15} />
          {exportando === "excel" ? "Gerando…" : "Excel"}
        </button>
        <button
          type="button"
          className="panel-export__button"
          onClick={() => onExport("pdf")}
          disabled={csvDisabled || exportando !== null}
          title="Relatório em PDF com capa, números de destaque, mapa e tabela paginada. O anexo municipal completo é opção da janela de Estatísticas e sai desligado."
        >
          <FileText size={15} />
          {exportando === "pdf" ? "Gerando…" : "PDF"}
        </button>
        <button
          type="button"
          className="panel-export__button"
          onClick={onCsv}
          disabled={csvDisabled}
          title={csvLabel}
        >
          <Download size={15} />
          CSV
        </button>
      </div>
      <button
        className="analysis-export-button"
        type="button"
        onClick={onImage}
        disabled={imageDisabled}
        title={imageTitle}
      >
        <ImageDown size={16} /> Exportar imagem do mapa
      </button>
    </section>
  );
}
