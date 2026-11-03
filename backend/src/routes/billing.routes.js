const express = require("express");
const router = express.Router();
const { postgres } = require("../server/connect");
const { verifyToken } = require("../middlewares/auth.middleware");
const {
  TRIAL_DAYS,
  ensureBillingSchema,
  canUpgradeTo,
  getOrganizationUsage,
  getStoragePack,
  isOverLimit,
  isValidBillingInterval,
  listPlans,
  resolveOrganizationBilling,
} = require("../services/billing.service");
const { invalidatePlanCache } = require("../middlewares/plan-limit.middleware");
const {
  StripeError,
  createCheckoutSession,
  createPortalSession,
  changeSubscriptionPlan,
  resumeSubscription,
  cancelSubscription,
  listInvoices,
  updateSubscriptionQuantities,
  previewSubscriptionQuantities,
  syncSubscriptionFromStripe,
} = require("../services/stripe.service");
const { isStripeEnabled, STRIPE_MODE } = require("../config/stripe");
const {
  assertTrialAvailable,
  registerTrialGrant,
} = require("../services/trial.service");
const { sendAccountError } = require("../services/account.service");

function getAppUrl(req) {
  return (
    process.env.FRONTEND_URL ||
    process.env.APP_URL ||
    req.headers.origin ||
    "http://localhost:5173"
  ).replace(/\/+$/, "");
}

function sendStripeError(res, error, fallback) {
  if (error instanceof StripeError) {
    return res.status(error.status).json({ message: error.message });
  }

  // Erro devolvido pela própria Stripe (cartão, configuração, etc.).
  if (error?.type && String(error.type).startsWith("Stripe")) {
    console.error("[stripe] erro da API:", error.message);
    return res.status(502).json({ message: "A Stripe recusou a operação: " + error.message });
  }

  console.error(fallback, error);
  return res.status(500).json({ message: fallback });
}

function getOrganizationId(req, res) {
  const organizationId = req.user.organizationId;

  if (!organizationId) {
    res.status(403).json({
      message: "Conta sem empresa ativa. Faça login novamente.",
    });
    return null;
  }

  return organizationId;
}

router.get("/plans", verifyToken, async (_req, res) => {
  res.json({
    plans: listPlans(),
    storagePack: getStoragePack(),
    trialDays: TRIAL_DAYS,
    checkoutEnabled: isStripeEnabled(),
    stripeMode: STRIPE_MODE,
  });
});

// Situação da conta: plano em vigor, teste, uso e limites.
router.get("/subscription", verifyToken, async (req, res) => {
  const organizationId = getOrganizationId(req, res);
  if (!organizationId) return;

  try {
    // Confere o estado real na Stripe antes de responder (caso algum webhook
    // tenha se perdido, por exemplo um cancelamento feito no portal).
    await syncSubscriptionFromStripe(organizationId).catch(() => undefined);

    const result = await postgres.query(
      `
        SELECT
          id, name, slug, plan,
          subscription_status AS "subscriptionStatus",
          billing_interval AS "billingInterval",
          trial_ends_at, trial_started_at, onboarding_completed_at,
          extra_seats, extra_storage_packs, billing_exempt,
          past_due_since, subscription_period_end, cancel_at_period_end, custom_entitlements,
          pending_plan, pending_extra_seats, pending_extra_storage_packs, pending_change_at,
          stripe_customer_id AS "stripeCustomerId",
          stripe_subscription_id AS "stripeSubscriptionId"
        FROM organizations
        WHERE id = $1
      `,
      [organizationId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Empresa não encontrada." });
    }

    const organization = result.rows[0];
    const billing = resolveOrganizationBilling(organization);
    const usage = await getOrganizationUsage(organizationId);
    const overLimits = isOverLimit(usage, billing.entitlements);

    // Cancelou (aqui ou no portal da Stripe) e ainda não contou o motivo:
    // a tela de Assinatura abre a pesquisa.
    // Desconto valendo (retenção): mostramos o valor da próxima fatura.
    const { getActiveDiscount, getUpcomingInvoice } = require("../services/stripe.service");
    const [discount, nextInvoice] = organization.stripeSubscriptionId
      ? await Promise.all([
          getActiveDiscount(organizationId).catch(() => null),
          getUpcomingInvoice(organizationId).catch(() => null),
        ])
      : [null, null];

    let cancellationSurveyPending = false;
    if (billing.cancelAtPeriodEnd || organization.subscriptionStatus === "canceled") {
      try {
        const { ensurePlatformAdminSchema } = require("../services/platform-admin.service");
        await ensurePlatformAdminSchema();
        const respondida = await postgres.query(
          `
            SELECT 1 FROM cancellation_surveys
            WHERE organization_id = $1 AND created_at > NOW() - INTERVAL '90 days'
            LIMIT 1
          `,
          [organizationId],
        );
        cancellationSurveyPending = respondida.rows.length === 0;
      } catch (error) {
        console.error("[cobranca] checar pesquisa de cancelamento", error?.message || error);
      }
    }
    // Quem acabou de ver a tela de planos deve ter a checagem de limites
    // recalculada na próxima ação, sem esperar o cache expirar.
    invalidatePlanCache(organizationId);

    return res.json({
      organization: {
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        plan: billing.planId,
        planName: billing.planName,
        contractedPlan: billing.contractedPlanId,
        subscriptionStatus: billing.status,
        billingInterval: organization.billingInterval,
        trial: {
          active: billing.isTrial,
          daysLeft: billing.trialDaysLeft,
          endsAt: billing.trialEndsAt,
          expired: billing.trialExpired,
        },
        onboardingPending: billing.onboardingPending,
        trialAvailable: billing.trialAvailable,
        payment: {
          pastDue: billing.payment.pastDue,
          days: billing.payment.days,
          warn: billing.payment.warn,
          readOnly: billing.payment.readOnly,
          since: billing.payment.since,
        },
        periodEnd: billing.periodEnd,
        cancelAtPeriodEnd: billing.cancelAtPeriodEnd,
        cancellationSurveyPending,
        discount,
        nextInvoice,
        pendingChange: billing.pendingChange,
        extraSeats: billing.extraSeats,
        extraStoragePacks: billing.extraStoragePacks,
        billingExempt: billing.isExempt,
        entitlements: billing.entitlements,
        usage,
        overLimits,
        // Acima dos limites (ou fatura vencida há 15 dias): só leitura.
        readOnly: !billing.isExempt && (overLimits.length > 0 || billing.payment.readOnly),
        stripeCustomerId: organization.stripeCustomerId,
        stripeSubscriptionId: organization.stripeSubscriptionId,
      },
      plans: listPlans(),
      storagePack: getStoragePack(),
      trialDays: TRIAL_DAYS,
      checkoutEnabled: isStripeEnabled(),
    });
  } catch (error) {
    console.error("Erro ao buscar assinatura:", error);
    return res.status(500).json({ message: "Erro ao buscar assinatura." });
  }
});

// Início da assinatura: leva para o checkout da Stripe.
router.post("/checkout", verifyToken, async (req, res) => {
  const organizationId = getOrganizationId(req, res);
  if (!organizationId) return;

  const { plan, interval = "monthly", extraSeats = 0, storagePacks = 0 } = req.body || {};

  if (!canUpgradeTo(plan)) {
    return res.status(400).json({ message: "Plano inválido para assinatura." });
  }

  if (!isValidBillingInterval(interval)) {
    return res.status(400).json({ message: "Periodicidade inválida." });
  }

  if (!["owner", "admin"].includes(req.user.organizationRole)) {
    return res.status(403).json({
      message: "Só o titular ou um administrador da conta pode contratar um plano.",
    });
  }

  const seats = Math.max(0, Math.min(Number(extraSeats) || 0, 500));
  const packs = Math.max(0, Math.min(Number(storagePacks) || 0, 50));

  try {
    const { checkoutUrl } = await createCheckoutSession({
      organizationId,
      planId: plan,
      interval,
      extraSeats: seats,
      storagePacks: packs,
      user: req.user,
      appUrl: getAppUrl(req),
    });

    await postgres.query(
      `
        UPDATE organizations
        SET onboarding_completed_at = COALESCE(onboarding_completed_at, CURRENT_TIMESTAMP)
        WHERE id = $1
      `,
      [organizationId],
    );

    return res.json({ checkoutUrl });
  } catch (error) {
    return sendStripeError(res, error, "Não foi possível iniciar a assinatura.");
  }
});

// Boas-vindas: a pessoa escolhe começar no Grátis ou ativar o teste de 14 dias.
router.post("/onboarding", verifyToken, async (req, res) => {
  const organizationId = getOrganizationId(req, res);
  if (!organizationId) return;

  const choice = req.body?.choice === "trial" ? "trial" : "free";

  if (!["owner", "admin"].includes(req.user.organizationRole)) {
    return res.status(403).json({
      message: "Só o titular ou um administrador da conta pode escolher o plano.",
    });
  }

  try {
    await ensureBillingSchema();

    if (choice === "trial") {
      // Uma vez por CPF/CNPJ e por e-mail: apagar a conta e criar outra não
      // devolve o teste.
      await assertTrialAvailable(postgres, organizationId);

      // O teste vale uma vez por conta.
      const started = await postgres.query(
        `
          UPDATE organizations
          SET trial_started_at = CURRENT_TIMESTAMP,
              trial_ends_at = CURRENT_TIMESTAMP + ($2 || ' days')::interval,
              onboarding_completed_at = COALESCE(onboarding_completed_at, CURRENT_TIMESTAMP),
              updated_at = CURRENT_TIMESTAMP
          WHERE id = $1 AND trial_started_at IS NULL AND plan = 'free'
          RETURNING trial_ends_at
        `,
        [organizationId, String(TRIAL_DAYS)],
      );

      if (started.rows.length === 0) {
        return res.status(409).json({
          code: "TRIAL_UNAVAILABLE",
          message: "Esta conta já usou o teste grátis.",
        });
      }

      await registerTrialGrant(postgres, organizationId);
      invalidatePlanCache(organizationId);
      return res.json({
        message: `Teste grátis de ${TRIAL_DAYS} dias ativado.`,
        trialEndsAt: started.rows[0].trial_ends_at,
      });
    }

    await postgres.query(
      `
        UPDATE organizations
        SET onboarding_completed_at = COALESCE(onboarding_completed_at, CURRENT_TIMESTAMP),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `,
      [organizationId],
    );

    return res.json({ message: "Tudo certo. Você está no plano Grátis." });
  } catch (error) {
    return sendAccountError(res, error, "Não foi possível salvar a escolha.");
  }
});

// Cancelar a assinatura sem perder o que já foi pago.
// Motivos e propostas da tela de cancelamento.
router.get("/retention/offers", verifyToken, async (req, res) => {
  const organizationId = getOrganizationId(req, res);
  if (!organizationId) return;

  const { listReasons, buildOffer } = require("../services/retention.service");
  try {
    const motivos = listReasons();
    const comPropostas = [];
    for (const motivo of motivos) {
      comPropostas.push({ ...motivo, offer: await buildOffer(organizationId, motivo.id) });
    }
    return res.json({ reasons: comPropostas });
  } catch (error) {
    console.error("[retencao] propostas", error);
    return res.status(500).json({ message: "Não foi possível carregar as opções." });
  }
});

// A pessoa aceitou a proposta e segue assinante.
router.post("/retention/accept", verifyToken, async (req, res) => {
  const organizationId = getOrganizationId(req, res);
  if (!organizationId) return;

  if (!["owner", "admin"].includes(req.user.organizationRole)) {
    return res.status(403).json({ message: "Só o titular ou um administrador pode mexer na assinatura." });
  }

  const { RetentionError, acceptOffer } = require("../services/retention.service");
  try {
    const resultado = await acceptOffer(req.user, req.body || {});
    invalidatePlanCache(organizationId);
    return res.json(resultado);
  } catch (error) {
    if (error instanceof RetentionError) {
      return res.status(error.status).json({ message: error.message });
    }
    return sendStripeError(res, error, "Não foi possível aplicar a proposta.");
  }
});

// Por que cancelou: opcional, respondido logo depois do cancelamento.
router.post("/cancellation-survey", verifyToken, async (req, res) => {
  const organizationId = getOrganizationId(req, res);
  if (!organizationId) return;

  const { REASONS } = require("../services/retention.service");
  const reason = String(req.body?.reason || "").trim();
  if (!REASONS[reason]) {
    return res.status(400).json({ message: "Escolha um dos motivos da lista." });
  }

  try {
    const { ensurePlatformAdminSchema } = require("../services/platform-admin.service");
    await ensurePlatformAdminSchema();
    const plano = await postgres.query("SELECT plan FROM organizations WHERE id = $1", [organizationId]);

    await postgres.query(
      `
        INSERT INTO cancellation_surveys (id, organization_id, member_id, plan, reason, comment)
        VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [
        `can_${require("crypto").randomBytes(8).toString("hex")}`,
        organizationId,
        req.user.id,
        plano.rows[0]?.plan || null,
        reason,
        String(req.body?.comment || "").slice(0, 2000) || null,
      ],
    );

    return res.json({ message: "Obrigado! Sua resposta ajuda a melhorar o Pauta." });
  } catch (error) {
    console.error("[cobranca] pesquisa de cancelamento", error);
    return res.status(500).json({ message: "Não foi possível registrar sua resposta." });
  }
});

router.post("/subscription/cancel", verifyToken, async (req, res) => {
  const organizationId = getOrganizationId(req, res);
  if (!organizationId) return;

  if (!["owner", "admin"].includes(req.user.organizationRole)) {
    return res.status(403).json({
      message: "Só o titular ou um administrador da conta pode cancelar a assinatura.",
    });
  }

  const { RetentionError, registerCancellation } = require("../services/retention.service");

  try {
    // A pesquisa vem junto: o cancelamento só acontece depois dela.
    await registerCancellation(req.user, {
      reason: req.body?.reason,
      comment: req.body?.comment,
      offerType: req.body?.offerType,
    });

    const { changed, effectiveAt } = await cancelSubscription(organizationId);
    invalidatePlanCache(organizationId);
    return res.json({
      effectiveAt,
      message: changed
        ? "Assinatura cancelada. Você continua com o plano até o fim do período já pago."
        : "Sua assinatura já estava cancelada.",
    });
  } catch (error) {
    if (error instanceof RetentionError) {
      return res.status(error.status).json({ message: error.message });
    }
    return sendStripeError(res, error, "Não foi possível cancelar a assinatura.");
  }
});

// Histórico de cobranças da conta.
router.get("/invoices", verifyToken, async (req, res) => {
  const organizationId = getOrganizationId(req, res);
  if (!organizationId) return;

  if (!["owner", "admin"].includes(req.user.organizationRole)) {
    return res.status(403).json({
      message: "Só o titular ou um administrador da conta pode ver as cobranças.",
    });
  }

  if (!isStripeEnabled()) {
    return res.json({ invoices: [] });
  }

  try {
    const limit = Math.max(1, Math.min(Number(req.query.limit) || 100, 100));
    const result = await listInvoices(organizationId, { limit });
    const { mapIssuedByInvoice } = require("../services/nfse.service");
    const notas = await mapIssuedByInvoice(organizationId).catch(() => new Map());
    return res.json({
      ...result,
      invoices: result.invoices.map((invoice) => ({ ...invoice, nfse: notas.get(invoice.id) || null })),
    });
  } catch (error) {
    return sendStripeError(res, error, "Não foi possível carregar as cobranças.");
  }
});

// Desfaz o cancelamento antes de o período terminar.
router.post("/subscription/resume", verifyToken, async (req, res) => {
  const organizationId = getOrganizationId(req, res);
  if (!organizationId) return;

  if (!["owner", "admin"].includes(req.user.organizationRole)) {
    return res.status(403).json({
      message: "Só o titular ou um administrador da conta pode reativar a assinatura.",
    });
  }

  try {
    const { changed } = await resumeSubscription(organizationId);
    invalidatePlanCache(organizationId);
    return res.json({
      message: changed
        ? "Assinatura reativada. A cobrança volta ao normal no próximo ciclo."
        : "Sua assinatura já estava ativa.",
    });
  } catch (error) {
    return sendStripeError(res, error, "Não foi possível reativar a assinatura.");
  }
});

// Troca de plano de quem já assina (sem criar uma segunda assinatura).
router.post("/subscription/plan", verifyToken, async (req, res) => {
  const organizationId = getOrganizationId(req, res);
  if (!organizationId) return;

  const { plan, interval = "monthly" } = req.body || {};

  if (!canUpgradeTo(plan)) {
    return res.status(400).json({ message: "Plano inválido." });
  }

  if (!isValidBillingInterval(interval)) {
    return res.status(400).json({ message: "Periodicidade inválida." });
  }

  if (!["owner", "admin"].includes(req.user.organizationRole)) {
    return res.status(403).json({
      message: "Só o titular ou um administrador da conta pode trocar de plano.",
    });
  }

  try {
    const result = await changeSubscriptionPlan(organizationId, { planId: plan, interval });
    invalidatePlanCache(organizationId);

    if (result.status === "payment_required") {
      return res.status(402).json({
        code: "PAYMENT_REQUIRED",
        invoiceUrl: result.invoiceUrl,
        amountDueCents: result.amountDueCents,
        message:
          "Falta pagar a diferença. Abrimos a cobrança: o plano novo entra assim que o pagamento for confirmado.",
      });
    }

    if (result.status === "scheduled") {
      return res.json({
        status: "scheduled",
        effectiveAt: result.effectiveAt,
        message:
          "Troca registrada. Você continua no plano atual até o fim do período já pago.",
      });
    }

    return res.json({
      status: "applied",
      amountChargedCents: result.amountChargedCents || 0,
      message: "Plano alterado e diferença cobrada no cartão cadastrado.",
    });
  } catch (error) {
    return sendStripeError(res, error, "Não foi possível trocar de plano.");
  }
});

// Quanto vai ser cobrado agora se a pessoa confirmar o aumento.
router.post("/subscription/preview", verifyToken, async (req, res) => {
  const organizationId = getOrganizationId(req, res);
  if (!organizationId) return;

  const seats = Math.max(0, Math.min(Number(req.body?.extraSeats) || 0, 500));
  const packs = Math.max(0, Math.min(Number(req.body?.storagePacks) || 0, 50));

  try {
    const preview = await previewSubscriptionQuantities(organizationId, {
      extraSeats: seats,
      storagePacks: packs,
    });
    return res.json(preview);
  } catch (error) {
    return sendStripeError(res, error, "Não foi possível calcular a cobrança.");
  }
});

// Quem já assina muda a quantidade de pessoas extras e de pacotes por aqui.
router.post("/subscription/quantities", verifyToken, async (req, res) => {
  const organizationId = getOrganizationId(req, res);
  if (!organizationId) return;

  if (!["owner", "admin"].includes(req.user.organizationRole)) {
    return res.status(403).json({
      message: "Só o titular ou um administrador da conta pode alterar a assinatura.",
    });
  }

  const seats = Math.max(0, Math.min(Number(req.body?.extraSeats) || 0, 500));
  const packs = Math.max(0, Math.min(Number(req.body?.storagePacks) || 0, 50));

  try {
    const result = await updateSubscriptionQuantities(organizationId, {
      extraSeats: seats,
      storagePacks: packs,
    });

    invalidatePlanCache(organizationId);

    // Aumento de limite só passa a valer depois que a cobrança for paga.
    if (result.status === "payment_required") {
      return res.status(402).json({
        code: "PAYMENT_REQUIRED",
        invoiceUrl: result.invoiceUrl,
        amountDueCents: result.amountDueCents,
        message:
          "Falta pagar a diferença. Abrimos a cobrança: os limites novos entram assim que o pagamento for confirmado.",
      });
    }

    if (result.status === "scheduled") {
      return res.json({
        status: "scheduled",
        effectiveAt: result.effectiveAt,
        message:
          "Redução registrada. Você continua com os limites atuais até o fim do período já pago.",
      });
    }

    return res.json({
      status: result.status,
      amountChargedCents: result.amountChargedCents || 0,
      message:
        result.status === "applied"
          ? "Assinatura atualizada e diferença cobrada no cartão cadastrado."
          : "Nada mudou na assinatura.",
    });
  } catch (error) {
    return sendStripeError(res, error, "Não foi possível atualizar a assinatura.");
  }
});

// Pedido de plano Enterprise (cai no painel de super-admin).
router.post("/enterprise-request", verifyToken, async (req, res) => {
  const organizationId = getOrganizationId(req, res);
  if (!organizationId) return;

  const body = req.body || {};
  const reason = String(body.reason || "").trim();
  const contactPhone = String(body.contactPhone || "").trim().slice(0, 40);
  const companyName = String(body.companyName || "").trim().slice(0, 255);
  const teamSize = String(body.teamSize || "").trim().slice(0, 40);
  const seatsNeeded = Number(body.seatsNeeded) || null;
  const storageNeededGb = Number(body.storageNeededGb) || null;

  // Permissão antes do conteúdo: quem não pode pedir recebe 403, não 400.
  if (!["owner", "admin"].includes(req.user.organizationRole)) {
    return res.status(403).json({
      message: "Só o titular ou um administrador da conta pode solicitar o plano Enterprise.",
    });
  }

  if (reason.length < 10) {
    return res.status(400).json({
      message: "Conte em pelo menos 10 caracteres por que o plano Enterprise faz sentido para vocês.",
      field: "reason",
    });
  }

  try {
    const { ensurePlatformAdminSchema } = require("../services/platform-admin.service");
    const { sendEnterpriseRequestEmail } = require("../server/email");
    await ensurePlatformAdminSchema();

    const aberta = await postgres.query(
      `
        SELECT id FROM enterprise_requests
        WHERE organization_id = $1 AND status IN ('nova', 'em_contato', 'proposta_enviada')
        LIMIT 1
      `,
      [organizationId],
    );
    if (aberta.rows.length > 0) {
      return res.status(409).json({
        message: "Já existe uma solicitação em andamento para esta conta. Nossa equipe vai entrar em contato.",
      });
    }

    const pessoa = await postgres.query(
      "SELECT m.name, m.email, o.name AS organization_name FROM members m, organizations o WHERE m.id = $1 AND o.id = $2",
      [req.user.id, organizationId],
    );
    const dados = pessoa.rows[0] || {};
    const id = `ent_${require("crypto").randomBytes(8).toString("hex")}`;

    await postgres.query(
      `
        INSERT INTO enterprise_requests (
          id, organization_id, member_id, contact_name, contact_email, contact_phone,
          company_name, team_size, seats_needed, storage_needed_gb, reason
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `,
      [
        id,
        organizationId,
        req.user.id,
        dados.name || null,
        dados.email || null,
        contactPhone || null,
        companyName || dados.organization_name || null,
        teamSize || null,
        seatsNeeded,
        storageNeededGb,
        reason.slice(0, 5000),
      ],
    );

    sendEnterpriseRequestEmail({
      organizationName: dados.organization_name,
      companyName: companyName || dados.organization_name,
      contactName: dados.name,
      contactEmail: dados.email,
      contactPhone,
      teamSize,
      seatsNeeded,
      storageNeededGb,
      reason,
    }).catch(() => undefined);

    return res.status(201).json({
      id,
      message: "Recebemos sua solicitação. Nossa equipe entra em contato em até 2 dias úteis.",
    });
  } catch (error) {
    console.error("Erro ao registrar solicitação Enterprise:", error);
    return res.status(500).json({ message: "Não foi possível enviar a solicitação." });
  }
});

// Portal da Stripe: trocar cartão, ver faturas e cancelar sem falar com ninguém.
router.post("/portal", verifyToken, async (req, res) => {
  const organizationId = getOrganizationId(req, res);
  if (!organizationId) return;

  if (!["owner", "admin"].includes(req.user.organizationRole)) {
    return res.status(403).json({
      message: "Só o titular ou um administrador da conta pode gerenciar a assinatura.",
    });
  }

  try {
    const { portalUrl } = await createPortalSession({
      organizationId,
      user: req.user,
      returnUrl: `${getAppUrl(req)}/?billing=plans`,
    });

    return res.json({ portalUrl });
  } catch (error) {
    return sendStripeError(res, error, "Não foi possível abrir o portal de cobrança.");
  }
});

module.exports = router;
