import { Bot, Loader2, Send, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useDataAgent } from "../hooks/useDataAgent";
import type { EntradaContextoAgente } from "../utils/agentTools";

/**
 * Botão flutuante + painel de conversa do agente de dados.
 *
 * Regra que a interface precisa deixar visível: o agente responde SÓ com o que
 * está carregado na plataforma, e cada resposta mostra quais consultas foram
 * usadas. Isso é procedência, não enfeite — quem lê precisa saber se o número
 * veio do TSE, do IBGE ou dos cadastros.
 *
 * Quando o servidor não tem chave configurada, nada disso aparece: o app inteiro
 * segue funcionando sem o agente.
 */

const SUGESTOES = [
  "Em Porto Alegre, quais bairros votaram mais à direita em 2022?",
  "Quais os 10 municípios com maior penetração eleitoral?",
  "Compare Porto Alegre, Caxias do Sul e Pelotas",
  "Onde o índice ideológico é mais à esquerda em Goiás?",
];

export function DataAgentChat(props: { dados: EntradaContextoAgente }) {
  const { status, mensagens, pensando, erro, perguntar, limpar } = useDataAgent(
    props.dados,
  );
  const [aberto, setAberto] = useState(false);
  const [rascunho, setRascunho] = useState("");
  const fimDaLista = useRef<HTMLDivElement | null>(null);
  const campo = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (aberto) campo.current?.focus();
  }, [aberto]);

  useEffect(() => {
    fimDaLista.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [mensagens, pensando]);

  useEffect(() => {
    if (!aberto) return;
    const aoTeclar = (evento: KeyboardEvent) => {
      if (evento.key === "Escape") setAberto(false);
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [aberto]);

  // Sem chave no servidor o recurso não existe para o usuário — melhor ausente
  // do que um botão que só sabe dar erro.
  if (status.carregando || !status.disponivel) return null;

  const enviar = () => {
    const texto = rascunho.trim();
    if (!texto || pensando) return;
    setRascunho("");
    void perguntar(texto);
  };

  return (
    <>
      <button
        type="button"
        className="agent-fab"
        onClick={() => setAberto((atual) => !atual)}
        aria-expanded={aberto}
        aria-controls="painel-agente"
        title="Perguntar sobre os dados"
      >
        {aberto ? <X size={22} aria-hidden /> : <Bot size={22} aria-hidden />}
        <span className="sr-only">
          {aberto ? "Fechar o agente de dados" : "Abrir o agente de dados"}
        </span>
      </button>

      {aberto && (
        <section
          id="painel-agente"
          className="agent-panel"
          role="dialog"
          aria-label="Agente de dados"
        >
          <header className="agent-panel__header">
            <div>
              <p className="agent-panel__eyebrow">Pergunte aos dados</p>
              <h2 className="agent-panel__title">Agente ACCORSI</h2>
            </div>
            <div className="agent-panel__actions">
              {mensagens.length > 0 && (
                <button
                  type="button"
                  onClick={limpar}
                  title="Limpar conversa"
                  className="agent-icon-button"
                >
                  <Trash2 size={16} aria-hidden />
                  <span className="sr-only">Limpar conversa</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setAberto(false)}
                title="Fechar"
                className="agent-icon-button"
              >
                <X size={16} aria-hidden />
                <span className="sr-only">Fechar</span>
              </button>
            </div>
          </header>

          <div className="agent-panel__body">
            {mensagens.length === 0 && (
              <div className="agent-empty">
                <p>
                  Respondo com base nos dados já carregados: TSE, IBGE, espectro
                  ideológico, locais de votação e cadastros agregados. Todo número
                  sai do mesmo cálculo que desenha o mapa — e cadastros aparecem
                  só em grupos de cinco ou mais.
                </p>
                <ul className="agent-suggestions">
                  {SUGESTOES.map((sugestao) => (
                    <li key={sugestao}>
                      <button
                        type="button"
                        onClick={() => void perguntar(sugestao)}
                        disabled={pensando}
                      >
                        {sugestao}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {mensagens.map((mensagem, indice) => (
              <article
                key={`${mensagem.autor}-${indice}`}
                className={`agent-message agent-message--${mensagem.autor}`}
              >
                <p className="agent-message__text">{mensagem.texto}</p>
                {mensagem.ferramentas.length > 0 && (
                  <p className="agent-message__tools">
                    Consultas usadas: {mensagem.ferramentas.join(", ")}
                  </p>
                )}
              </article>
            ))}

            {pensando && (
              <p className="agent-thinking">
                <Loader2 size={14} className="agent-spin" aria-hidden />
                Consultando os dados…
              </p>
            )}
            {erro && <p className="agent-error">{erro}</p>}
            <div ref={fimDaLista} />
          </div>

          <footer className="agent-panel__footer">
            <textarea
              ref={campo}
              value={rascunho}
              onChange={(evento) => setRascunho(evento.target.value)}
              onKeyDown={(evento) => {
                // Enter envia; Shift+Enter quebra linha.
                if (evento.key === "Enter" && !evento.shiftKey) {
                  evento.preventDefault();
                  enviar();
                }
              }}
              placeholder="Ex.: em Porto Alegre, quais bairros votaram mais à direita?"
              rows={2}
              disabled={pensando}
              aria-label="Sua pergunta"
            />
            <button
              type="button"
              onClick={enviar}
              disabled={pensando || !rascunho.trim()}
              className="agent-send"
              title="Enviar pergunta"
            >
              <Send size={16} aria-hidden />
              <span className="sr-only">Enviar</span>
            </button>
          </footer>
          {status.modelo && (
            <p className="agent-model-note">
              Modelo: {status.modelo}. O modelo escolhe a consulta; o cálculo é
              feito aqui, sobre os dados da plataforma.
            </p>
          )}
        </section>
      )}
    </>
  );
}
