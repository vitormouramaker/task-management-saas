import * as Sentry from "@sentry/react";

import { buildApiUrl } from "./api";

/**
 * Monitoramento de erros da interface.
 *
 * Todo erro vai para o Pauta e aparece na tela de Erros do painel de
 * super-admin. Quando VITE_SENTRY_DSN existe, o mesmo erro também vai para o
 * Sentry — os dois caminhos convivem.
 */

const DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined;
const VERSAO = import.meta.env.VITE_APP_VERSION as string | undefined;

let sentryLigado = false;
let iniciado = false;

/** Erros iguais em sequência não viram dezenas de chamadas à API. */
const enviadosAgora = new Map<string, number>();
const JANELA_MS = 60 * 1000;
const MAXIMO_POR_JANELA = 10;
let enviosNaJanela = 0;
let janelaComecou = Date.now();

function podeEnviar(chave: string) {
  const agora = Date.now();

  if (agora - janelaComecou > JANELA_MS) {
    janelaComecou = agora;
    enviosNaJanela = 0;
    enviadosAgora.clear();
  }
  if (enviosNaJanela >= MAXIMO_POR_JANELA) return false;

  const ultimo = enviadosAgora.get(chave);
  if (ultimo && agora - ultimo < JANELA_MS) return false;

  enviadosAgora.set(chave, agora);
  enviosNaJanela += 1;
  return true;
}

function detalhesDoErro(erro: unknown) {
  if (erro instanceof Error) {
    return { mensagem: erro.message || String(erro), tipo: erro.name, pilha: erro.stack };
  }
  if (typeof erro === "string") return { mensagem: erro, tipo: "Error", pilha: undefined };
  try {
    return { mensagem: JSON.stringify(erro).slice(0, 500), tipo: "Error", pilha: undefined };
  } catch {
    return { mensagem: String(erro), tipo: "Error", pilha: undefined };
  }
}

/** Manda o erro para o Pauta, sem travar nem atrapalhar a tela. */
function enviarParaOPauta(erro: unknown, contexto?: Record<string, unknown>) {
  const { mensagem, tipo, pilha } = detalhesDoErro(erro);
  if (!mensagem) return;
  if (!podeEnviar(`${tipo}:${mensagem}`)) return;

  const token = (() => {
    try {
      // O token fica no armazenamento do navegador; se não der para ler, o erro
      // é registrado do mesmo jeito, só sem dizer de qual conta veio.
      const bruto = localStorage.getItem("pauta_auth_storage");
      return bruto ? (JSON.parse(bruto)?.state?.token as string | undefined) : undefined;
    } catch {
      return undefined;
    }
  })();

  const corpo = JSON.stringify({
    mensagem,
    tipo,
    pilha,
    url: window.location.href,
    versao: VERSAO,
    extra: contexto,
  });

  void fetch(buildApiUrl("/api/telemetria/erro"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: corpo,
    keepalive: true,
  }).catch(() => undefined);
}

export function iniciarMonitoramento() {
  if (iniciado) return;
  iniciado = true;

  if (DSN) {
    Sentry.init({
      dsn: DSN,
      environment: import.meta.env.MODE,
      release: VERSAO,
      tracesSampleRate: 0,
      // Nada de preenchimento de formulário nem texto da tela: o quadro tem
      // dado de cliente. Só o erro e onde ele aconteceu.
      beforeSend(evento) {
        if (evento.request?.headers) delete evento.request.headers.Authorization;
        return evento;
      },
    });
    sentryLigado = true;
  }

  // Erros que ninguém tratou também precisam chegar ao painel.
  window.addEventListener("error", (evento) => {
    registrarErro(evento.error || evento.message, { origem: "window.onerror" });
  });
  window.addEventListener("unhandledrejection", (evento) => {
    registrarErro(evento.reason, { origem: "promessa sem tratamento" });
  });
}

/** Erro já tratado que ainda vale registrar (ex.: tela que caiu). */
export function registrarErro(erro: unknown, contexto?: Record<string, unknown>) {
  enviarParaOPauta(erro, contexto);

  if (!sentryLigado) return;
  Sentry.captureException(erro, contexto ? { extra: contexto } : undefined);
}

/** Identifica quem está usando, sem e-mail nem nome. */
export function identificarUsuario(id: string | null, organizationId?: string | null) {
  if (!sentryLigado) return;
  Sentry.setUser(id ? { id } : null);
  Sentry.setTag("organizacao", organizationId || "");
}

export function monitoramentoLigado() {
  return sentryLigado;
}
