import { BadgeDollarSign, PlugZap, TriangleAlert } from "lucide-react";

/**
 * Aba "Anúncios": espaço reservado para o módulo de mídia paga (Meta Ads e
 * outros impulsionamentos). Sem props porque não há fonte de dado conectada;
 * ela recebe modelo e estado como os painéis irmãos quando a exportação do
 * gerenciador entrar. Regra da base: nada de número ou gráfico de exemplo.
 */
export function PaidMediaPanel() {
  return (
    <div className="sidebar-view" role="tabpanel" id="sidebar-ads-panel">
      <div className="workspace-view-header">
        <div>
          <span className="panel-eyebrow">Operação de campanha</span>
          <h2>Anúncios</h2>
        </div>
      </div>

      <p className="workspace-description">
        Onde o dinheiro de anúncio foi parar: investimento, alcance e custo por
        município e por bairro, no mesmo mapa em que a campanha já lê o voto.
      </p>

      <div className="registration-mode" role="note">
        <TriangleAlert size={15} />
        <div>
          <strong>Ainda sem dado</strong>
          <span>
            Nenhuma campanha de anúncio foi conectada até agora. Enquanto a
            exportação não chegar, este painel fica vazio de propósito: não há
            número de exemplo nem estimativa.
          </span>
        </div>
      </div>

      <section className="insight-section" aria-label="O que este painel vai mostrar">
        <div className="section-heading-inline">
          <BadgeDollarSign size={14} />
          <strong>O que vai aparecer aqui</strong>
        </div>
        <ul className="pending-module-list">
          <li>
            Quanto foi investido em cada município e em cada bairro, no período
            que você escolher.
          </li>
          <li>
            Quantas pessoas cada anúncio alcançou, no mesmo recorte territorial
            das outras abas.
          </li>
          <li>
            Quanto custou alcançar mil pessoas em cada lugar, para separar
            território caro de território barato.
          </li>
          <li>
            O gasto em anúncio lado a lado com o voto já apurado, município por
            município.
          </li>
        </ul>
      </section>

      <section className="analysis-filter-section" aria-label="O que precisa chegar">
        <div className="analysis-section-heading">
          <span>
            <PlugZap size={14} /> O que precisa chegar
          </span>
        </div>
        <ul className="pending-module-list">
          <li>
            <strong>A exportação do gerenciador de anúncios da Meta</strong>{" "}
            (Facebook e Instagram), com valor gasto, alcance e a localidade de
            cada conjunto de anúncios.
          </li>
          <li>
            <strong>A ligação entre a localidade do anúncio e o município</strong>{" "}
            — o gerenciador entrega nome de cidade, e o mapa trabalha com código
            do IBGE.
          </li>
          <li>
            <strong>O relatório da mídia fora da Meta</strong>, se houver
            (Google, rádio, impulsionamento avulso), no mesmo formato: valor,
            período e lugar.
          </li>
        </ul>
      </section>

      <p className="comparison-note analysis-note">
        Quando o dado chegar, ele entra agregado por território, como no resto
        da plataforma: gasto e alcance por lugar, nunca por pessoa.
      </p>
    </div>
  );
}
