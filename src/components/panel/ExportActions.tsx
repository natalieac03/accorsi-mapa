import { Download, FileSpreadsheet, FileText, ImageDown } from "lucide-react";
import type { ReportFormat } from "../../hooks/useReportExport";

/**
 * O bloco de exportação dos painéis do mapa.
 *
 * Os quatro formatos convivem porque atendem públicos diferentes, e nenhum
 * substitui o outro:
 *
 * - Excel: pasta de trabalho formatada, com capa de procedência e filtros —
 *   é o que vai para a coordenação de território trabalhar;
 * - PDF: documento de leitura, com capa, números de destaque e o mapa —
 *   é o que vai para a reunião e para a candidata;
 * - CSV: o formato de quem vai cruzar os números em outra ferramenta. Continua
 *   exatamente como estava, com todas as colunas técnicas;
 * - PNG: só o mapa, para colar numa apresentação ou mandar num grupo.
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
          title="Relatório em PDF com capa, números de destaque, mapa e tabela paginada"
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
