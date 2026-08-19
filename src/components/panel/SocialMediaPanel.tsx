import { PlugZap, Share2, TriangleAlert } from "lucide-react";

/**
 * Aba "Redes": espaço reservado para o módulo de redes sociais (engajamento por
 * lugar). Como a aba de anúncios, ainda sem props: não há fonte de dado
 * conectada, e nenhum número ou gráfico de exemplo é inventado aqui.
 */
export function SocialMediaPanel() {
  return (
    <div className="sidebar-view" role="tabpanel" id="sidebar-social-panel">
      <div className="workspace-view-header">
        <div>
          <span className="panel-eyebrow">Operação de campanha</span>
          <h2>Redes</h2>
        </div>
      </div>

      <p className="workspace-description">
        Onde o público da campanha está mais ativo nas redes sociais — por
        município e, na capital, por bairro.
      </p>

      <div className="registration-mode" role="note">
        <TriangleAlert size={15} />
        <div>
          <strong>Ainda sem dado</strong>
          <span>
            Nenhum perfil de rede social foi conectado até agora. Sem métrica
            ligada o painel fica vazio: nada aqui é preenchido com número de
            exemplo.
          </span>
        </div>
      </div>

      <section className="insight-section" aria-label="O que este painel vai mostrar">
        <div className="section-heading-inline">
          <Share2 size={14} />
          <strong>O que vai aparecer aqui</strong>
        </div>
        <ul className="pending-module-list">
          <li>
            Seguidores e engajamento por município, para ver de onde vem a
            resposta às publicações.
          </li>
          <li>
            Quais lugares reagem mais a cada tipo de publicação, no mesmo mapa
            das outras abas.
          </li>
          <li>
            Onde o alcance está crescendo e onde está caindo, de um período para
            o outro.
          </li>
          <li>
            O cruzamento entre engajamento e voto: onde a campanha é forte na
            rede e ainda fraca na urna.
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
            <strong>As métricas de cada perfil com recorte de localidade</strong>{" "}
            (Instagram, Facebook, TikTok, YouTube), exportadas por período.
          </li>
          <li>
            <strong>O acesso às contas que publicam</strong> — o número por
            cidade só sai para quem administra o perfil; de fora não dá para
            coletar.
          </li>
          <li>
            <strong>A definição de quais perfis entram</strong>: o da candidata,
            o da campanha, os dos apoiadores. Cada um conta uma história
            diferente e eles não devem virar um número só.
          </li>
        </ul>
      </section>

      <p className="comparison-note analysis-note">
        Quando conectar, os números entram agregados por lugar. A plataforma não
        guarda perfil, nome nem mensagem de quem interage.
      </p>
    </div>
  );
}
