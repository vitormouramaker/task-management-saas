require("../config/env");
const { postgres } = require("../server/connect");

// Catálogo de planos (valores fictícios desta versão de demonstração).
// Valores em centavos. Anual = 10x o mensal.
const TRIAL_DAYS = 14;
const TRIAL_PLAN_ID = "profissional";
// Pacote extra de armazenamento: +100 GB por R$ 29/mês.
const STORAGE_PACK_MB = 100 * 1024;
const STORAGE_PACK_PRICE_CENTS = { monthly: 2900, yearly: 29000 };

const PLAN_CATALOG = {
  free: {
    id: "free",
    name: "Grátis",
    description: "Para conhecer o Pauta com uma equipe pequena.",
    priceCents: { monthly: 0, yearly: 0 },
    extraUserPriceCents: { monthly: 0, yearly: 0 },
    entitlements: {
      includedUsers: 3,
      maxUsers: 3,
      maxWorkspaces: 1,
      maxProjects: 3,
      maxStorageMb: 1024,
      maxFileSizeMb: 10,
      maxFilesPerUpload: 5,
      maxEmailAttachmentMb: 0,
      trashDays: 7,
      supportChat: false,
      supportPriority: 0,
      supportResponseTime: null,
      views: ["board"],
      storagePacks: false,
      maxStoragePacks: 0,
      customFields: false,
      advancedReports: false,
      automations: false,
    },
    features: [
      "Quadros, cards, comentários e etiquetas",
      "Notificações e histórico de atividades",
      "Suporte por e-mail",
    ],
  },
  essencial: {
    id: "essencial",
    name: "Essencial",
    description: "Para equipes pequenas que já organizam vários projetos.",
    priceCents: { monthly: 4900, yearly: 49000 },
    extraUserPriceCents: { monthly: 1500, yearly: 15000 },
    entitlements: {
      includedUsers: 5,
      maxUsers: 15,
      maxWorkspaces: 3,
      maxProjects: -1,
      maxStorageMb: 30 * 1024,
      maxFileSizeMb: 50,
      maxFilesPerUpload: 10,
      maxEmailAttachmentMb: 25,
      trashDays: 30,
      supportChat: true,
      supportPriority: 1,
      supportResponseTime: "até 1 dia útil",
      views: ["board", "list", "table"],
      storagePacks: true,
      maxStoragePacks: 3,
      customFields: false,
      advancedReports: false,
      automations: false,
    },
    features: [
      "Visões Lista e Tabela",
      "E-mail interno com anexos de 25 MB",
      "Chat de suporte na plataforma (resposta em até 1 dia útil)",
    ],
  },
  profissional: {
    id: "profissional",
    name: "Profissional",
    description: "Para empresas em crescimento, com vários times e fluxos.",
    highlight: "Mais popular",
    priceCents: { monthly: 12900, yearly: 129000 },
    extraUserPriceCents: { monthly: 1200, yearly: 12000 },
    entitlements: {
      includedUsers: 15,
      maxUsers: 50,
      maxWorkspaces: -1,
      maxProjects: -1,
      maxStorageMb: 150 * 1024,
      maxFileSizeMb: 250,
      maxFilesPerUpload: 20,
      maxEmailAttachmentMb: 50,
      trashDays: 30,
      supportChat: true,
      supportPriority: 2,
      supportResponseTime: "até 8 horas úteis",
      views: ["board", "list", "table", "timeline", "calendar"],
      storagePacks: true,
      maxStoragePacks: 10,
      customFields: true,
      advancedReports: true,
      automations: true,
    },
    features: [
      "Visões Timeline e Calendário",
      "Campos personalizados, relatórios e automações",
      "E-mail interno com anexos de 50 MB",
      "Chat de suporte com resposta em até 8 horas úteis",
    ],
  },
  empresarial: {
    id: "empresarial",
    name: "Empresarial",
    description: "Para empresas com muitos times e volume alto de arquivos.",
    priceCents: { monthly: 34900, yearly: 349000 },
    extraUserPriceCents: { monthly: 900, yearly: 9000 },
    entitlements: {
      includedUsers: 50,
      maxUsers: 150,
      maxWorkspaces: -1,
      maxProjects: -1,
      maxStorageMb: 600 * 1024,
      maxFileSizeMb: 1024,
      maxFilesPerUpload: 30,
      maxEmailAttachmentMb: 100,
      trashDays: 60,
      supportChat: true,
      supportPriority: 3,
      supportResponseTime: "até 4 horas úteis",
      views: ["board", "list", "table", "timeline", "calendar"],
      storagePacks: true,
      maxStoragePacks: 20,
      customFields: true,
      advancedReports: true,
      automations: true,
    },
    features: [
      "Campos personalizados, relatórios e automações",
      "E-mail interno com anexos de 100 MB",
      "Chat de suporte prioritário (resposta em até 4 horas úteis)",
    ],
  },
  enterprise: {
    id: "enterprise",
    name: "Enterprise",
    description: "Contrato sob medida, com limites e suporte negociados.",
    contactOnly: true,
    priceCents: { monthly: null, yearly: null },
    extraUserPriceCents: { monthly: null, yearly: null },
    entitlements: {
      includedUsers: 150,
      maxUsers: -1,
      maxWorkspaces: -1,
      maxProjects: -1,
      maxStorageMb: 2048 * 1024,
      maxFileSizeMb: 2048,
      maxFilesPerUpload: 50,
      maxEmailAttachmentMb: 200,
      trashDays: 90,
      supportChat: true,
      supportPriority: 4,
      supportResponseTime: "até 2 horas úteis",
      views: ["board", "list", "table", "timeline", "calendar"],
      storagePacks: true,
      maxStoragePacks: -1,
      customFields: true,
      advancedReports: true,
      automations: true,
    },
    features: [
      "SLA e onboarding assistido",
      "Chat de suporte com resposta em até 2 horas úteis",
      "Limites, faturamento e contrato negociados",
    ],
  },
};

const PAYMENT_WARNING_DAYS = 8;
const PAYMENT_READ_ONLY_DAYS = 15;

const PLAN_ORDER = ["free", "essencial", "profissional", "empresarial", "enterprise"];
// Posição do plano na escada, para saber o que é upgrade e o que é downgrade.
const PLAN_RANK = Object.fromEntries(PLAN_ORDER.map((planId, index) => [planId, index]));
const PAID_PLANS = ["essencial", "profissional", "empresarial"];
const BILLING_INTERVALS = ["monthly", "yearly"];
// Nomes antigos do catálogo, ainda presentes em sessões e links salvos.
const LEGACY_PLAN_IDS = { basic: "essencial", business: "profissional" };

let schemaReady = null;

function ensureBillingSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      // Eventos ja processados da Stripe: a Stripe reenvia o mesmo evento
      // quando a resposta demora ou falha, e sem isso ele seria aplicado duas
      // vezes.
      await postgres.query(`
        CREATE TABLE IF NOT EXISTS stripe_webhook_events (
          event_id VARCHAR(120) PRIMARY KEY,
          type VARCHAR(120),
          processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await postgres.query(
        "ALTER TABLE organizations ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ",
      );
      await postgres.query(
        "ALTER TABLE organizations ADD COLUMN IF NOT EXISTS extra_seats INTEGER NOT NULL DEFAULT 0",
      );
      await postgres.query(
        "ALTER TABLE organizations ADD COLUMN IF NOT EXISTS extra_storage_packs INTEGER NOT NULL DEFAULT 0",
      );
      await postgres.query(
        "ALTER TABLE organizations ADD COLUMN IF NOT EXISTS past_due_since TIMESTAMPTZ",
      );
      // Retenção pós-cancelamento: quando a assinatura acabou, quais avisos já
      // foram enviados e quando os arquivos foram removidos.
      await postgres.query(
        "ALTER TABLE organizations ADD COLUMN IF NOT EXISTS subscription_ended_at TIMESTAMPTZ",
      );
      await postgres.query(
        "ALTER TABLE organizations ADD COLUMN IF NOT EXISTS retention_warned_days INTEGER NOT NULL DEFAULT 0",
      );
      await postgres.query(
        "ALTER TABLE organizations ADD COLUMN IF NOT EXISTS files_purged_at TIMESTAMPTZ",
      );
      await postgres.query(
        "ALTER TABLE organizations ADD COLUMN IF NOT EXISTS subscription_period_end TIMESTAMPTZ",
      );
      await postgres.query(
        "ALTER TABLE organizations ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE",
      );
      // Redução contratada que só vale quando o período pago terminar.
      await postgres.query(
        "ALTER TABLE organizations ADD COLUMN IF NOT EXISTS pending_extra_seats INTEGER",
      );
      await postgres.query(
        "ALTER TABLE organizations ADD COLUMN IF NOT EXISTS pending_extra_storage_packs INTEGER",
      );
      await postgres.query(
        "ALTER TABLE organizations ADD COLUMN IF NOT EXISTS pending_plan VARCHAR(50)",
      );
      await postgres.query(
        "ALTER TABLE organizations ADD COLUMN IF NOT EXISTS pending_change_at TIMESTAMPTZ",
      );
      // Boas-vindas concluídas e teste grátis já usado (só pode uma vez).
      await postgres.query(
        "ALTER TABLE organizations ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ",
      );
      await postgres.query(
        "ALTER TABLE organizations ADD COLUMN IF NOT EXISTS trial_started_at TIMESTAMPTZ",
      );
      // Conta interna da própria empresa: acesso completo, sem cobrança.
      await postgres.query(
        "ALTER TABLE organizations ADD COLUMN IF NOT EXISTS billing_exempt BOOLEAN NOT NULL DEFAULT FALSE",
      );
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }

  return schemaReady;
}

function planRank(planId) {
  return PLAN_RANK[normalizePlanId(planId)] ?? 0;
}

function normalizePlanId(planId) {
  const id = String(planId || "").trim();
  return LEGACY_PLAN_IDS[id] || (PLAN_CATALOG[id] ? id : "free");
}

function getPlan(planId) {
  return PLAN_CATALOG[normalizePlanId(planId)];
}

/** Limites do plano, sem os extras contratados pela conta. */
function buildPlanEntitlements(planId) {
  return getPlan(planId).entitlements;
}

function isValidBillingInterval(interval) {
  return BILLING_INTERVALS.includes(interval);
}

function canUpgradeTo(planId) {
  return PAID_PLANS.includes(normalizePlanId(planId));
}

function getStripePriceId(planId, interval, kind = "base") {
  const plan = getPlan(planId);
  if (!plan || plan.contactOnly || plan.id === "free" || !isValidBillingInterval(interval)) {
    return null;
  }

  const suffix = kind === "seat" ? "_SEAT" : "";
  const name = `STRIPE_PRICE_${plan.id.toUpperCase()}${suffix}_${interval.toUpperCase()}`;
  return process.env[name] || null;
}

function getStoragePackPriceId(interval) {
  if (!isValidBillingInterval(interval)) {
    return null;
  }
  return process.env[`STRIPE_PRICE_STORAGE_100GB_${interval.toUpperCase()}`] || null;
}

let priceIndex = null;

function buildPriceIndex() {
  const index = new Map();

  for (const planId of PAID_PLANS) {
    for (const interval of BILLING_INTERVALS) {
      const base = getStripePriceId(planId, interval, "base");
      if (base) index.set(base, { planId, interval, kind: "base" });
      const seat = getStripePriceId(planId, interval, "seat");
      if (seat) index.set(seat, { planId, interval, kind: "seat" });
    }
  }

  for (const interval of BILLING_INTERVALS) {
    const pack = getStoragePackPriceId(interval);
    if (pack) index.set(pack, { planId: null, interval, kind: "storage" });
  }

  return index;
}

/** Descobre o que um preço da Stripe representa no catálogo. */
function describePrice(priceId) {
  if (!priceIndex) {
    priceIndex = buildPriceIndex();
  }
  return priceIndex.get(String(priceId || "")) || null;
}

function serializePlan(planId) {
  const plan = getPlan(planId);

  return {
    id: plan.id,
    name: plan.name,
    description: plan.description,
    highlight: plan.highlight || null,
    contactOnly: Boolean(plan.contactOnly),
    priceCents: plan.priceCents,
    extraUserPriceCents: plan.extraUserPriceCents,
    entitlements: plan.entitlements,
    features: plan.features,
  };
}

function listPlans() {
  return PLAN_ORDER.map(serializePlan);
}

function getStoragePack() {
  return { storageMb: STORAGE_PACK_MB, priceCents: STORAGE_PACK_PRICE_CENTS };
}

function parseDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function daysSince(date) {
  if (!date) return 0;
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / (24 * 60 * 60 * 1000)));
}

function daysUntil(date) {
  if (!date) return 0;
  return Math.max(0, Math.ceil((date.getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
}

/**
 * Situação de cobrança da conta: plano que vale agora (durante o teste a conta
 * usa o Profissional), dias restantes e limites já com os extras contratados.
 */
function resolveOrganizationBilling(organization) {
  const contractedPlanId = normalizePlanId(organization?.plan);
  const trialEndsAt = parseDate(organization?.trial_ends_at ?? organization?.trialEndsAt);
  const status = organization?.subscription_status || organization?.subscriptionStatus || "free";
  const isExempt = Boolean(organization?.billing_exempt ?? organization?.billingExempt);
  const extraSeats = Number(organization?.extra_seats ?? organization?.extraSeats ?? 0) || 0;
  const extraStoragePacks =
    Number(organization?.extra_storage_packs ?? organization?.extraStoragePacks ?? 0) || 0;

  // O teste só vale enquanto a conta não assinou nada.
  const isTrial =
    !isExempt &&
    contractedPlanId === "free" &&
    Boolean(trialEndsAt) &&
    trialEndsAt.getTime() > Date.now();

  const effectivePlanId = isExempt ? "enterprise" : isTrial ? TRIAL_PLAN_ID : contractedPlanId;
  const plan = getPlan(effectivePlanId);
  // Contrato Enterprise pode ter limites próprios, definidos no painel de super-admin.
  const custom = organization?.custom_entitlements ?? organization?.customEntitlements ?? null;
  const base = custom && typeof custom === "object" ? { ...plan.entitlements, ...custom } : plan.entitlements;
  const pastDueSince = parseDate(organization?.past_due_since ?? organization?.pastDueSince);
  const pastDueDays = status === "past_due" ? daysSince(pastDueSince) : 0;
  const payment = {
    pastDue: !isExempt && status === "past_due",
    days: pastDueDays,
    warn: !isExempt && status === "past_due" && pastDueDays >= PAYMENT_WARNING_DAYS,
    readOnly: !isExempt && status === "past_due" && pastDueDays >= PAYMENT_READ_ONLY_DAYS,
    since: pastDueSince,
  };
  const seats =
    base.maxUsers === -1
      ? -1
      : Math.min(base.maxUsers, base.includedUsers + (isTrial || isExempt ? 0 : extraSeats));

  const trialStartedAt = parseDate(organization?.trial_started_at ?? organization?.trialStartedAt);
  // O que já foi pago continua valendo até o fim do período; a redução entra depois.
  const pendingChangeAt = parseDate(
    organization?.pending_change_at ?? organization?.pendingChangeAt,
  );
  const pendingChange = pendingChangeAt
    ? {
        at: pendingChangeAt,
        plan: organization?.pending_plan ?? organization?.pendingPlan ?? null,
        extraSeats: organization?.pending_extra_seats ?? organization?.pendingExtraSeats ?? null,
        extraStoragePacks:
          organization?.pending_extra_storage_packs ??
          organization?.pendingExtraStoragePacks ??
          null,
      }
    : null;

  return {
    planId: effectivePlanId,
    planName: plan.name,
    onboardingPending: !isExempt && !(organization?.onboarding_completed_at ?? organization?.onboardingCompletedAt),
    trialAvailable: !isExempt && contractedPlanId === "free" && !trialStartedAt,
    contractedPlanId,
    status: isExempt ? "internal" : isTrial ? "trialing" : status,
    isTrial,
    isExempt,
    trialEndsAt,
    trialDaysLeft: isTrial ? daysUntil(trialEndsAt) : 0,
    trialExpired: !isExempt && contractedPlanId === "free" && Boolean(trialEndsAt) && !isTrial,
    extraSeats,
    extraStoragePacks,
    pendingChange,
    payment,
    periodEnd: parseDate(organization?.subscription_period_end ?? organization?.subscriptionPeriodEnd),
    cancelAtPeriodEnd: Boolean(
      organization?.cancel_at_period_end ?? organization?.cancelAtPeriodEnd,
    ),
    entitlements: {
      ...base,
      seats,
      maxStorageMb:
        base.maxStorageMb === -1
          ? -1
          : base.maxStorageMb + extraStoragePacks * STORAGE_PACK_MB,
    },
  };
}

/** Uso atual da conta, para comparar com os limites do plano. */
async function getOrganizationUsage(organizationId) {
  const { getOrganizationStorageUsageBytes } = require("./storage.service");

  const result = await postgres.query(
    `
      SELECT
        (SELECT COUNT(*)::int FROM workspaces WHERE organization_id = $1 AND deleted_at IS NULL) AS workspaces,
        (SELECT COUNT(*)::int FROM organization_members WHERE organization_id = $1 AND status = 'active') AS users,
        (
          SELECT COUNT(*)::int
          FROM lists l
          INNER JOIN folders f ON f.id = l.folder_id
          INNER JOIN spaces s ON s.id = f.space_id
          INNER JOIN workspaces w ON w.id = s.workspace_id
          WHERE w.organization_id = $1
            AND w.deleted_at IS NULL
            AND l.deleted_at IS NULL
        ) AS projects
    `,
    [organizationId],
  );

  const storageBytes = await getOrganizationStorageUsageBytes(organizationId);

  return {
    ...(result.rows[0] || { workspaces: 0, users: 0, projects: 0 }),
    storageMb: Math.round((storageBytes / (1024 * 1024)) * 10) / 10,
  };
}

/** Quais limites a conta já estourou (ex.: depois que o teste terminou). */
function isOverLimit(usage, entitlements) {
  const over = [];

  if (entitlements.seats !== -1 && usage.users > entitlements.seats) {
    over.push("users");
  }
  if (entitlements.maxWorkspaces !== -1 && usage.workspaces > entitlements.maxWorkspaces) {
    over.push("workspaces");
  }
  if (entitlements.maxProjects !== -1 && usage.projects > entitlements.maxProjects) {
    over.push("projects");
  }
  if (entitlements.maxStorageMb !== -1 && usage.storageMb > entitlements.maxStorageMb) {
    over.push("storage");
  }

  return over;
}

/** Carrega a conta e devolve a situação de cobrança já resolvida. */
async function loadOrganizationBilling(organizationId, db = postgres) {
  await ensureBillingSchema();
  const result = await db.query(
    `
      SELECT plan, subscription_status, trial_ends_at, extra_seats,
             extra_storage_packs, billing_exempt, past_due_since,
             subscription_period_end, cancel_at_period_end,
             onboarding_completed_at, trial_started_at, custom_entitlements,
             pending_extra_seats, pending_extra_storage_packs,
             pending_plan, pending_change_at
      FROM organizations
      WHERE id = $1
    `,
    [organizationId],
  );
  return resolveOrganizationBilling(result.rows[0] || {});
}

// Identificador que vai no checkout e volta no webhook.
function buildClientReferenceId(organizationId, planId, interval) {
  return `${organizationId}__${normalizePlanId(planId)}__${interval}`;
}

function parseClientReferenceId(clientReferenceId) {
  const parts = String(clientReferenceId || "").split("__");
  if (parts.length !== 3) {
    return null;
  }

  const [organizationId, planId, interval] = parts;
  if (!organizationId || !canUpgradeTo(planId) || !isValidBillingInterval(interval)) {
    return null;
  }

  return { organizationId, planId: normalizePlanId(planId), interval };
}

module.exports = {
  PLAN_CATALOG,
  PLAN_ORDER,
  PAID_PLANS,
  BILLING_INTERVALS,
  TRIAL_DAYS,
  TRIAL_PLAN_ID,
  STORAGE_PACK_MB,
  ensureBillingSchema,
  normalizePlanId,
  getPlan,
  listPlans,
  serializePlan,
  buildPlanEntitlements,
  resolveOrganizationBilling,
  getOrganizationUsage,
  isOverLimit,
  loadOrganizationBilling,
  buildClientReferenceId,
  parseClientReferenceId,
  getStoragePack,
  getStripePriceId,
  getStoragePackPriceId,
  describePrice,
  planRank,
  PAYMENT_WARNING_DAYS,
  PAYMENT_READ_ONLY_DAYS,
  canUpgradeTo,
  isValidBillingInterval,
};
