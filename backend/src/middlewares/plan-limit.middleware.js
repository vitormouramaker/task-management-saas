const {
  getOrganizationUsage,
  isOverLimit,
  loadOrganizationBilling,
} = require("../services/billing.service");

// A conta fica somente leitura quando está acima dos limites do plano (por
// exemplo, depois que o teste de 14 dias termina). Nada é apagado: a pessoa
// continua vendo e baixando tudo, e pode remover itens para caber no plano.
const CACHE_TTL_MS = 60 * 1000;
const cache = new Map();

const EXEMPT_PATHS = [
  /^\/api\/auth\//,
  /^\/api\/account\//,
  /^\/api\/billing\//,
  /^\/api\/admin\//,
  /^\/api\/support(\/|$)/,
  /^\/api\/onboarding\//,
  /^\/api\/invitations\/(lookup|accept|accept-new)$/,
  /^\/api\/realtime\/ticket$/,
  /^\/api\/notifications\//,
  /^\/api\/push\//,
  /^\/api\/users\/profile/,
  /^\/api\/health(\/|$)/,
];

const LIMIT_LABELS = {
  users: "pessoas",
  workspaces: "workspaces",
  projects: "projetos",
  storage: "armazenamento",
};

function invalidatePlanCache(organizationId) {
  cache.delete(organizationId);
}

async function resolveReadOnly(organizationId) {
  const cached = cache.get(organizationId);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.value;
  }

  const billing = await loadOrganizationBilling(organizationId);
  let value = { readOnly: false, over: [], reason: null };

  if (!billing.isExempt) {
    // Pagamento em atraso há 15 dias ou mais também trava a edição.
    if (billing.payment?.readOnly) {
      value = { readOnly: true, over: [], reason: "payment" };
    } else {
      const usage = await getOrganizationUsage(organizationId);
      const over = isOverLimit(usage, billing.entitlements);
      value = { readOnly: over.length > 0, over, reason: over.length > 0 ? "limits" : null };
    }
  }

  cache.set(organizationId, { value, fetchedAt: Date.now() });
  return value;
}

function enforcePlanReadOnly(req, res, next) {
  const organizationId = req.user?.organizationId;
  const path = req.originalUrl.split("?")[0];

  // Leitura sempre liberada; apagar também, para a conta conseguir voltar
  // aos limites do plano sem precisar pagar.
  if (
    !organizationId ||
    ["GET", "HEAD", "OPTIONS", "DELETE"].includes(req.method) ||
    EXEMPT_PATHS.some((pattern) => pattern.test(path))
  ) {
    return next();
  }

  resolveReadOnly(organizationId)
    .then(({ readOnly, over, reason }) => {
      if (!readOnly) {
        return next();
      }

      if (reason === "payment") {
        return res.status(403).json({
          code: "PLAN_PAYMENT_OVERDUE",
          message:
            "Há uma fatura em aberto. Atualize o pagamento para voltar a editar; seus dados continuam disponíveis.",
        });
      }

      const limites = over.map((item) => LIMIT_LABELS[item] || item).join(", ");
      return res.status(403).json({
        code: "PLAN_READ_ONLY",
        limits: over,
        message: `Sua conta está acima do limite do plano (${limites}). Escolha um plano ou remova itens para voltar a editar.`,
      });
    })
    .catch((error) => {
      // Falha ao checar não pode travar o sistema inteiro.
      console.error("[planos] falha ao checar limites", error?.message || error);
      next();
    });
}

module.exports = { enforcePlanReadOnly, invalidatePlanCache };
