// Monitoramento primeiro: o Sentry instrumenta as bibliotecas no carregamento.
const monitoramento = require("./config/monitoring");
require("./config/env");

const express = require("express");
const http = require("http");
const cors = require("cors");
const helmet = require("helmet");
const { rateLimit } = require("express-rate-limit");
const { initRealtimeServer } = require("./services/realtime.service");
const { startStorageWorker } = require("./services/storage.service");
const { startCnpjVerificationWorker } = require("./services/account.service");
const { runStartupMigrations } = require("./services/migrations.service");
const { startSessionCleanupWorker } = require("./services/session.service");
const { startBillingNoticesWorker } = require("./services/billing-emails.service");
const { startTrashPurgeWorker } = require("./services/trash.service");
const { startOnboardingEmailsWorker } = require("./services/onboarding.service");
const { startAutomationsWorker } = require("./services/automations.service");
const jwt = require("jsonwebtoken");
const { JWT_SECRET } = require("./config/jwt");
const billingWebhookRoutes = require("./routes/billing-webhook.routes");
const { enforcePlanReadOnly } = require("./middlewares/plan-limit.middleware");

const app = express();
const PORT = Number(process.env.PORT) || 4444;

// Origens liberadas por padrão. Para adicionar outras (ex.: novo domínio),
// use CORS_ORIGINS no .env separando por vírgula.
const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
];

function normalizeOrigin(value) {
  return String(value || "")
    .trim()
    .replace(/\/+$/, "");
}

const allowedOrigins = new Set(
  [
    ...DEFAULT_ALLOWED_ORIGINS,
    process.env.FRONTEND_URL,
    ...String(process.env.CORS_ORIGINS || "").split(","),
  ]
    .map(normalizeOrigin)
    .filter(Boolean),
);

// Só para os testes automatizados; em produção o limitador é sempre aplicado.
const RATE_LIMIT_DESLIGADO =
  process.env.DISABLE_RATE_LIMIT === "true" && process.env.NODE_ENV !== "production";

function createLimiter({ windowMinutes, limit, message, ...options }) {
  return rateLimit({
    skip: () => RATE_LIMIT_DESLIGADO,
    windowMs: windowMinutes * 60 * 1000,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { message },
    ...options,
  });
}

app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(
  helmet({
    // Arquivos em /public e downloads são consumidos pelo front em outro domínio.
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);
app.use(
  cors({
    origin(origin, callback) {
      // Requisições sem Origin (servidor-a-servidor, curl) não passam por CORS.
      callback(null, !origin || allowedOrigins.has(normalizeOrigin(origin)));
    },
  }),
);

app.use(
  "/api/auth/login",
  createLimiter({
    windowMinutes: 15,
    limit: 10,
    skipSuccessfulRequests: true,
    message: "Muitas tentativas de login. Tente novamente em alguns minutos.",
  }),
);
app.use(
  "/api/auth/signup",
  createLimiter({
    windowMinutes: 60,
    limit: 10,
    message: "Muitos cadastros a partir desta rede. Tente novamente mais tarde.",
  }),
);
app.use(
  "/api/account/cnpj",
  createLimiter({
    windowMinutes: 10,
    limit: 30,
    message: "Muitas consultas de CNPJ. Aguarde alguns minutos.",
  }),
);
app.use(
  ["/api/auth/forgot-password", "/api/auth/reset-password"],
  createLimiter({
    windowMinutes: 15,
    limit: 5,
    message: "Muitas solicitações de senha. Tente novamente em alguns minutos.",
  }),
);
app.use(
  [
    "/api/workspaces/tasks/:id/uploads",
    "/api/emails/attachments/upload",
    "/api/users/profile/avatar/upload",
  ],
  createLimiter({
    windowMinutes: 10,
    limit: 300,
    message: "Muitos envios de arquivo em pouco tempo. Aguarde alguns minutos.",
  }),
);
app.use(
  ["/api/invitations/accept", "/api/invitations/accept-new", "/api/invitations/lookup"],
  createLimiter({
    windowMinutes: 15,
    limit: 30,
    message: "Muitas tentativas com convites. Aguarde alguns minutos.",
  }),
);
app.use(
  ["/api/auth/resend-verification", "/api/auth/verify-email"],
  createLimiter({
    windowMinutes: 15,
    limit: 10,
    message: "Muitas solicitações de confirmação de e-mail. Aguarde alguns minutos.",
  }),
);
app.use(
  "/api/invitations",
  createLimiter({
    windowMinutes: 60,
    limit: 100,
    skip: (req) => req.method === "GET",
    message: "Muitos convites em pouco tempo. Aguarde e tente novamente.",
  }),
);
app.use(
  ["/api/account/password", "/api/account/email"],
  createLimiter({
    windowMinutes: 15,
    limit: 10,
    message: "Muitas alterações de acesso. Tente novamente em alguns minutos.",
  }),
);
app.use(
  "/api",
  createLimiter({
    windowMinutes: 1,
    limit: 1200,
    message: "Muitas requisições. Aguarde alguns instantes.",
  }),
);

// Quem ainda não confirmou o e-mail só acessa login/sessão, confirmação e convites.
const EMAIL_VERIFICATION_EXEMPT_PATHS = [
  /^\/api\/auth\//,
  /^\/api\/account\/cnpj\//,
  // Quem errou o endereço precisa poder corrigi-lo antes de confirmar.
  /^\/api\/account\/email$/,
  /^\/api\/invitations\/(lookup|accept|accept-new)$/,
  /^\/api\/legal/,
  /^\/api\/health(\/|$)/,
  /^\/api\/portao(\/|$)/,
  /^\/api\/telemetria(\/|$)/,
  /^\/api\/billing\/webhook/,
];

app.use("/api", (req, res, next) => {
  const authorization = req.headers.authorization || "";
  const path = req.originalUrl.split("?")[0];
  if (
    !authorization.startsWith("Bearer ") ||
    EMAIL_VERIFICATION_EXEMPT_PATHS.some((pattern) => pattern.test(path))
  ) {
    return next();
  }

  try {
    const payload = jwt.verify(authorization.slice("Bearer ".length), JWT_SECRET);
    if (payload.emailVerified === false) {
      return res.status(403).json({
        code: "EMAIL_NOT_VERIFIED",
        message: "Confirme seu e-mail para continuar.",
      });
    }
  } catch {
    // Token inválido segue para as rotas, que respondem com o erro de autenticação.
  }
  next();
});

// Conta acima dos limites do plano (ex.: fim do teste) entra em somente leitura.
app.use("/api", (req, res, next) => {
  const authorization = req.headers.authorization || "";
  if (!authorization.startsWith("Bearer ")) {
    return next();
  }

  try {
    req.user = jwt.verify(authorization.slice("Bearer ".length), JWT_SECRET);
  } catch {
    return next();
  }

  return enforcePlanReadOnly(req, res, next);
});

app.use("/api/billing/webhook", billingWebhookRoutes);
// Arquivos não passam mais por JSON (upload binário em streaming).
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));

// Entrega links temporários dos arquivos e limpa assinaturas do que chega.
app.use(require("./services/storage-url.service").storageUrlMiddleware);

app.use("/public", express.static("public"));

// Import rotas
const authRoutes = require("./routes/auth.routes");
const usersRoutes = require("./routes/users.routes");
const workspacesRoutes = require("./routes/workspaces.routes");
const tagsRoutes = require("./routes/tags.routes");
const notificationsRoutes = require("./routes/notifications.routes");
const emailsRoutes = require("./routes/emails.routes");
const billingRoutes = require("./routes/billing.routes");
const storageRoutes = require("./routes/storage.routes");
const accountRoutes = require("./routes/account.routes");
const invitationRoutes = require("./routes/invitation.routes");
const jobTitlesRoutes = require("./routes/job-titles.routes");
const legalRoutes = require("./routes/legal.routes");
const adminRoutes = require("./routes/admin.routes");
const trashRoutes = require("./routes/trash.routes");
const onboardingRoutes = require("./routes/onboarding.routes");
const reportsRoutes = require("./routes/reports.routes");
const automationsRoutes = require("./routes/automations.routes");
const { customerSupportRoutes, teamSupportRoutes } = require("./routes/support.routes");

const pushRoutes = require("./routes/push.routes");

app.use("/api/auth", authRoutes);
app.use("/api/users", usersRoutes);
app.use("/api/workspaces", workspacesRoutes);
app.use("/api/tags", tagsRoutes);
app.use("/api/notifications", notificationsRoutes);
app.use("/api/emails", emailsRoutes);
app.use("/api/billing", billingRoutes);
app.use("/api/storage", storageRoutes);
app.use("/api/account", accountRoutes);
app.use("/api/invitations", invitationRoutes);
app.use("/api/job-titles", jobTitlesRoutes);
app.use("/api/legal", legalRoutes);
app.use("/api/admin/support", teamSupportRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/support", customerSupportRoutes);
app.use("/api/trash", trashRoutes);
app.use("/api/onboarding", onboardingRoutes);
app.use("/api/reports", reportsRoutes);
app.use("/api/automations", automationsRoutes);
// Hub de Conhecimento: API do contrato (token do link) e tela de Configurações.
const conhecimentoRoutes = require("./routes/conhecimento.routes");
app.use("/api/conhecimento/v1", conhecimentoRoutes.contrato);
app.use("/api/integrations/conhecimento", conhecimentoRoutes.configuracao);

app.use("/api/push", pushRoutes);

// Erros de tela chegam aqui e aparecem no painel de super-admin.
app.use("/api/telemetria", require("./routes/telemetry.routes"));

// Portao do ambiente fechado (homologacao): so existe quando ha senha.
const portaoRoutes = require("./routes/portao.routes");
if (portaoRoutes.portaoLigado()) {
  app.use("/api/portao", portaoRoutes);
  console.log("[portao] ambiente fechado por senha");
}

// Monitor de disponibilidade: 200 só enquanto o serviço consegue falar com o
// banco. Se o banco cair, responde 503 e o alerta dispara.
app.get("/api/health", async (_req, res) => {
  const { checarEssencial } = require("./services/health.service");
  const resultado = await checarEssencial();
  res.status(resultado.status === "ok" ? 200 : 503).json({ ...resultado, port: PORT });
});

// Diagnóstico completo (banco, armazenamento e cobrança). Fica atrás de um
// segredo porque mostra o estado das integrações.
app.get("/api/health/detalhado", async (req, res) => {
  // Só pelo cabeçalho (query string vai parar em log) e comparado em tempo constante.
  const segredo = Buffer.from(String(process.env.HEALTH_TOKEN || ""));
  const enviado = Buffer.from(String(req.headers["x-health-token"] || ""));
  if (
    segredo.length === 0 ||
    enviado.length !== segredo.length ||
    !require("crypto").timingSafeEqual(enviado, segredo)
  ) {
    return res.status(404).json({ message: "Não encontrado." });
  }

  const { checarTudo } = require("./services/health.service");
  const resultado = await checarTudo();
  res.status(resultado.status === "fora" ? 503 : 200).json(resultado);
});

// Captador de erros do Express: precisa vir depois das rotas.
monitoramento.instalarNoExpress(app);

// Resposta padrão para erro não tratado, sem vazar detalhe interno.
app.use((erro, req, res, _next) => {
  console.error("[erro não tratado]", erro?.stack || erro?.message || erro);
  monitoramento.registrarErro(erro, { rota: req?.originalUrl, metodo: req?.method });
  if (res.headersSent) return;
  res.status(erro?.status || 500).json({ message: "Erro inesperado. Tente novamente." });
});

process.on("unhandledRejection", (motivo) => {
  console.error("[promessa sem tratamento]", motivo);
  monitoramento.registrarErro(motivo instanceof Error ? motivo : new Error(String(motivo)), {
    origem: "unhandledRejection",
  });
});

process.on("uncaughtException", (erro) => {
  console.error("[exceção não capturada]", erro);
  monitoramento.registrarErro(erro, { origem: "uncaughtException" });
});

const server = http.createServer(app);
initRealtimeServer(app);

// Desenvolvimento sem Bunny: arquivos numa pasta local (LOCAL_STORAGE_DIR).
require("./services/local-storage.service").startLocalStorageServer();

server.listen(PORT, () => {
  console.log(`Rodando na porta ${PORT}`);
  // Tarefas em segundo plano: reorganização de pastas na Bunny e reverificação de CNPJ.
  runStartupMigrations();
  startStorageWorker();
  startCnpjVerificationWorker();
  startSessionCleanupWorker();
  startBillingNoticesWorker();
  startTrashPurgeWorker();
  startOnboardingEmailsWorker();
  startAutomationsWorker();
  require("./services/telemetry.service").startTelemetryCleanupWorker();
require("./services/storage-audit.service").iniciarLimpezaDaTrilha();
require("./services/custos.service").iniciarVigilanciaDeCustos();
require("./services/retencao.service").iniciarRetencao();
});
