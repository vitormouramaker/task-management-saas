/**
 * Monitoramento de erros (Sentry). Só liga quando SENTRY_DSN existe, então em
 * desenvolvimento e nos testes nada é enviado para fora.
 *
 * Precisa ser o primeiro require do app.js: o Sentry instrumenta as bibliotecas
 * (http, pg, express) no carregamento.
 */
require("./env");

const DSN = process.env.SENTRY_DSN;
let ligado = false;
let Sentry = null;

if (DSN) {
  Sentry = require("@sentry/node");
  Sentry.init({
    dsn: DSN,
    environment: process.env.NODE_ENV || "development",
    release: process.env.APP_VERSION || process.env.GIT_COMMIT || undefined,
    // Amostra de desempenho baixa de propósito: o que interessa é o erro.
    tracesSampleRate: Number(process.env.SENTRY_TRACES_RATE || 0.05),
    // Nada de corpo de requisição, cabeçalho de autorização ou IP: o cadastro
    // tem CPF/CNPJ e e-mail, e isso não precisa sair daqui.
    sendDefaultPii: false,
    beforeSend(evento) {
      if (evento.request) {
        delete evento.request.data;
        delete evento.request.cookies;
        if (evento.request.headers) {
          delete evento.request.headers.authorization;
          delete evento.request.headers.cookie;
        }
      }
      return evento;
    },
  });
  ligado = true;
  console.log("[monitoramento] Sentry ligado");
}

/**
 * Registra um erro que já foi tratado, sem derrubar o fluxo: vai para o
 * painel de super-admin e, quando o Sentry estiver ligado, também para lá.
 */
function registrarErro(erro, contexto = {}) {
  const falha = erro instanceof Error ? erro : new Error(String(erro));

  try {
    const { registrarErro: guardar } = require("../services/telemetry.service");
    void guardar({
      origem: "back",
      mensagem: falha.message,
      tipo: falha.name,
      pilha: falha.stack,
      extra: contexto,
    }).catch((problema) => {
      console.error("[monitoramento] não foi possível guardar o erro:", problema?.message);
    });
  } catch (problema) {
    console.error("[monitoramento] registro de erro indisponível:", problema?.message);
  }

  if (!ligado) return;
  try {
    Sentry.captureException(falha, { extra: contexto });
  } catch (problema) {
    console.error("[monitoramento] não foi possível enviar o erro", problema?.message);
  }
}

/** Liga o captador de erros do Express; precisa vir depois das rotas. */
function instalarNoExpress(app) {
  if (!ligado) return;
  Sentry.setupExpressErrorHandler(app);
}

module.exports = { estaLigado: () => ligado, instalarNoExpress, registrarErro };
