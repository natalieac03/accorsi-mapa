import { Bot, Loader2, Send, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useDataAgent } from "../hooks/useDataAgent";
import type { EntradaContextoAgente } from "../utils/agentTools";
import { formatarRespostaAgente, type TrechoAgente } from "../utils/agentText";

/**
 * Botão flutuante + painel de conversa do agente de dados.
 *
 * Regra que a interface precisa deixar visível: o agente responde SÓ com o que
 * está carregado na plataforma. A procedência do número (fonte, pleito e ano)
 * vem dentro do próprio texto da resposta — o system prompt obriga o modelo a
 * citá-la. O rodapé técnico com o nome das consultas saiu a pedido de quem usa:
 * "resultado_eleicao, espectro_submunicipal" é vocabulário do sistema, não de
 * quem lê. As ferramentas consultadas continuam registradas em
 * `mensagem.ferramentas`, para depuração; só não são mais desenhadas.
 *
 * Quando o servidor não tem chave configurada, nada disso aparece: o app inteiro
 * segue funcionando sem o agente.
 */

/*
 * Sugestões prontas: só perguntas de GOIÁS e só o que as ferramentas do
 * contrato (shared/agent-tools.json) sabem responder — votação da própria
 * candidata por bairro, retrato de município, espectro submunicipal por
 * bairro, comparação de até 3 municípios e ranking do índice ideológico
 * estadual.
 */
const SUGESTOES = [
  "Quais os três bairros que mais votam na Dra. Adriana em Goiânia?",
  "Em Goiânia, quais bairros votaram mais à esquerda no último pleito?",
  "Qual o retrato de Aparecida de Goiânia?",
  "Compare Goiânia, Anápolis e Rio Verde",
  "Onde o índice ideológico é mais à esquerda em Goiás?",
];

/** Trechos de uma linha: negrito vira <strong>, o resto é texto. */
function Trechos(props: { trechos: TrechoAgente[] }) {
  return (
    <>
      {props.trechos.map((trecho, indice) =>
        trecho.forte ? (
          <strong key={indice}>{trecho.texto}</strong>
        ) : (
          <span key={indice}>{trecho.texto}</span>
        ),
      )}
    </>
  );
}

/**
 * Resposta do agente em blocos legíveis.
 *
 * O modelo é instruído a responder em texto corrido com lista curta, mas ele
 * escorrega para Markdown de vez em quando. Em vez de exibir os asteriscos
 * crus na cara de quem lê, a resposta é convertida em elementos React — nunca
 * em HTML por string, porque o conteúdo vem de fora.
 */
function RespostaFormatada(props: { texto: string }) {
  const blocos = useMemo(() => formatarRespostaAgente(props.texto), [props.texto]);
  return (
    <>
      {blocos.map((bloco, indice) => {
        if (bloco.tipo === "titulo") {
          return (
            <p className="agent-message__titulo" key={indice}>
              <Trechos trechos={bloco.trechos} />
            </p>
          );
        }
        if (bloco.tipo === "lista") {
          const Lista = bloco.ordenada ? "ol" : "ul";
          return (
            <Lista className="agent-message__lista" key={indice}>
              {bloco.itens.map((item, posicao) => (
                <li key={posicao}>
                  <Trechos trechos={item} />
                </li>
              ))}
            </Lista>
          );
        }
        return (
          <p key={indice}>
            <Trechos trechos={bloco.trechos} />
          </p>
        );
      })}
    </>
  );
}

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
          {/* Sem título: quem abriu o painel sabe o que abriu, e o cabeçalho
              custava três linhas de altura numa janela que é toda conversa.
              Restam só as ações; o nome acessível fica no aria-label acima. */}
          <header className="agent-panel__header agent-panel__header--enxuto">
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
                  Pergunte sobre o eleitorado de Goiás: respondo só com os
                  dados públicos já carregados na plataforma (TSE e IBGE), e
                  cada número sai do mesmo cálculo que desenha o mapa.
                  Cadastros de apoiadores aparecem apenas agregados, em grupos
                  de cinco ou mais.
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
                <div className="agent-message__text">
                  <RespostaFormatada texto={mensagem.texto} />
                </div>
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
              placeholder="Ex.: em Goiânia, quais bairros votaram mais à esquerda?"
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
        </section>
      )}
    </>
  );
}
