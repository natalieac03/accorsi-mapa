import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  criarContextoAgente,
  executarFerramenta,
  type EntradaContextoAgente,
} from "../utils/agentTools";
import type { MensagemAgente, MensagemChat, StatusAgente } from "../types/agent";

/**
 * Laço de tool calling do agente de perguntas.
 *
 * A divisão de responsabilidades é o que garante que o chat nunca invente
 * número: o modelo (no servidor, via relé /agent/chat) só escolhe QUAL consulta
 * rodar; quem calcula é `executarFerramenta`, aqui no navegador, com os mesmos
 * motores que desenham o mapa. Nenhuma estatística atravessa a rede vinda do
 * modelo — ela sobe daqui como resultado de tool e volta apenas redigida.
 *
 * O servidor é um relé sem estado: a conversa inteira vai a cada requisição.
 * Por isso o histórico vive aqui, e é podado antes de subir (ver `podarHistorico`).
 */

const ROTA_STATUS = "/api/v1/agent/status";
const ROTA_CHAT = "/api/v1/agent/chat";

/**
 * Teto de idas ao modelo por pergunta. Sem isso, um modelo que insista em
 * chamar tools entraria em laço infinito consumindo cota e dinheiro.
 */
const MAXIMO_RODADAS = 6;

/**
 * O relé recusa conversas acima do limite de mensagens/caracteres dele. Podamos
 * antes de enviar, mantendo sempre os turnos mais recentes — e nunca cortando
 * no meio de um par assistant→tool, que deixaria um tool_call sem resposta e
 * faria o provedor recusar a requisição inteira.
 */
const MAXIMO_MENSAGENS_ENVIADAS = 24;

function podarHistorico(mensagens: MensagemAgente[]): MensagemAgente[] {
  if (mensagens.length <= MAXIMO_MENSAGENS_ENVIADAS) return mensagens;
  let inicio = mensagens.length - MAXIMO_MENSAGENS_ENVIADAS;
  // Anda para frente enquanto o primeiro item for uma resposta de tool órfã:
  // sem o assistant que a pediu, o provedor rejeita a conversa.
  while (inicio < mensagens.length && mensagens[inicio].role === "tool") {
    inicio += 1;
  }
  return mensagens.slice(inicio);
}

function textoDoErro(erro: unknown): string {
  if (erro instanceof Error) return erro.message;
  return "Falha inesperada ao falar com o agente.";
}

async function lerDetalhe(resposta: Response): Promise<string> {
  try {
    const corpo = (await resposta.json()) as { detail?: unknown };
    if (typeof corpo.detail === "string" && corpo.detail.trim()) {
      return corpo.detail;
    }
  } catch {
    // corpo não-JSON: cai na mensagem genérica por status abaixo
  }
  if (resposta.status === 429) {
    return "Você fez muitas perguntas em pouco tempo. Espere alguns minutos.";
  }
  if (resposta.status === 503) {
    return "O agente não está configurado neste servidor (falta a chave do OpenRouter).";
  }
  if (resposta.status === 401 || resposta.status === 403) {
    return "Sua sessão expirou. Entre novamente para usar o agente.";
  }
  return `O servidor respondeu ${resposta.status}.`;
}

export function useDataAgent(entrada: EntradaContextoAgente) {
  const [status, setStatus] = useState<StatusAgente>({ carregando: true });
  const [mensagens, setMensagens] = useState<MensagemChat[]>([]);
  const [pensando, setPensando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  /**
   * O histórico enviado ao modelo (com tool_calls e resultados) é diferente do
   * histórico exibido: a interface não mostra o vaivém de ferramentas. Fica em
   * ref para não disparar re-render a cada passo do laço.
   */
  const historico = useRef<MensagemAgente[]>([]);
  const emVoo = useRef<AbortController | null>(null);

  const contexto = useMemo(() => criarContextoAgente(entrada), [entrada]);

  useEffect(() => {
    const controlador = new AbortController();
    fetch(ROTA_STATUS, {
      credentials: "same-origin",
      signal: controlador.signal,
    })
      .then(async (resposta) => {
        if (!resposta.ok) throw new Error(await lerDetalhe(resposta));
        return (await resposta.json()) as { enabled: boolean; model?: string };
      })
      .then((corpo) => {
        setStatus({
          carregando: false,
          disponivel: corpo.enabled,
          modelo: corpo.model ?? null,
        });
      })
      .catch((causa: unknown) => {
        if (controlador.signal.aborted) return;
        // Indisponibilidade não é erro de conversa: o botão simplesmente não
        // aparece, e o app segue inteiro.
        setStatus({
          carregando: false,
          disponivel: false,
          modelo: null,
          motivo: textoDoErro(causa),
        });
      });
    return () => controlador.abort();
  }, []);

  useEffect(() => () => emVoo.current?.abort(), []);

  const limpar = useCallback(() => {
    emVoo.current?.abort();
    emVoo.current = null;
    historico.current = [];
    setMensagens([]);
    setErro(null);
    setPensando(false);
  }, []);

  const perguntar = useCallback(
    async (pergunta: string) => {
      const texto = pergunta.trim();
      if (!texto || pensando) return;

      setErro(null);
      setPensando(true);
      setMensagens((atuais) => [
        ...atuais,
        { autor: "usuario", texto, ferramentas: [] },
      ]);
      historico.current = [...historico.current, { role: "user", content: texto }];

      const controlador = new AbortController();
      emVoo.current = controlador;
      const ferramentasUsadas: string[] = [];

      try {
        for (let rodada = 0; rodada < MAXIMO_RODADAS; rodada += 1) {
          const resposta = await fetch(ROTA_CHAT, {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ messages: podarHistorico(historico.current) }),
            signal: controlador.signal,
          });
          if (!resposta.ok) throw new Error(await lerDetalhe(resposta));

          const corpo = (await resposta.json()) as {
            message: MensagemAgente;
            finish_reason?: string | null;
          };
          const mensagem = corpo.message;
          historico.current = [...historico.current, mensagem];

          const chamadas = mensagem.tool_calls ?? [];
          if (chamadas.length === 0) {
            const conteudo = (mensagem.content ?? "").trim();
            setMensagens((atuais) => [
              ...atuais,
              {
                autor: "agente",
                texto:
                  conteudo ||
                  "O modelo respondeu vazio. Tente reformular a pergunta.",
                ferramentas: ferramentasUsadas,
              },
            ]);
            return;
          }

          // Executa TODAS as ferramentas pedidas no turno. O resultado sobe como
          // mensagem "tool"; o modelo só redige em cima do que voltar daqui.
          for (const chamada of chamadas) {
            let argumentos: unknown = {};
            try {
              argumentos = chamada.function.arguments
                ? JSON.parse(chamada.function.arguments)
                : {};
            } catch {
              argumentos = { __invalido: true };
            }
            const resultado = await executarFerramenta(
              chamada.function.name,
              argumentos,
              contexto,
            );
            if (!ferramentasUsadas.includes(chamada.function.name)) {
              ferramentasUsadas.push(chamada.function.name);
            }
            historico.current = [
              ...historico.current,
              {
                role: "tool",
                tool_call_id: chamada.id,
                content: JSON.stringify(resultado),
              },
            ];
          }
        }

        // Estourou o teto de rodadas: melhor dizer do que fingir uma resposta.
        setMensagens((atuais) => [
          ...atuais,
          {
            autor: "agente",
            texto:
              "Consultei os dados várias vezes e não cheguei a uma resposta fechada. " +
              "Tente uma pergunta mais específica — por exemplo, citando o município e o pleito.",
            ferramentas: ferramentasUsadas,
          },
        ]);
      } catch (causa: unknown) {
        if (controlador.signal.aborted) return;
        setErro(textoDoErro(causa));
      } finally {
        if (emVoo.current === controlador) emVoo.current = null;
        setPensando(false);
      }
    },
    [contexto, pensando],
  );

  return { status, mensagens, pensando, erro, perguntar, limpar };
}
