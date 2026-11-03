const { postgres } = require("../server/connect");
const { stripe, isStripeEnabled } = require("../config/stripe");
const {
  describePrice,
  getPlan,
  planRank,
  ensureBillingSchema,
  getStoragePackPriceId,
  getStripePriceId,
  normalizePlanId,
} = require("./billing.service");

class StripeError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function assertEnabled() {
  if (!isStripeEnabled()) {
    throw new StripeError(
      503,
      "O pagamento on-line está indisponível no momento. Fale com o suporte.",
    );
  }
}

function toDate(seconds) {
  return seconds ? new Date(seconds * 1000) : null;
}

/** Cliente da Stripe da conta, criado uma vez e reaproveitado depois. */
async function ensureCustomer(organizationId, user) {
  assertEnabled();
  await ensureBillingSchema();

  const result = await postgres.query(
    "SELECT id, name, stripe_customer_id FROM organizations WHERE id = $1",
    [organizationId],
  );
  const organization = result.rows[0];

  if (!organization) {
    throw new StripeError(404, "Empresa não encontrada.");
  }

  if (organization.stripe_customer_id) {
    return organization.stripe_customer_id;
  }

  const customer = await stripe.customers.create({
    name: organization.name,
    email: user?.email || undefined,
    metadata: { organizationId, organizationName: organization.name },
  });

  await postgres.query(
    "UPDATE organizations SET stripe_customer_id = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1",
    [organizationId, customer.id],
  );

  return customer.id;
}

/**
 * Checkout com até três itens: o plano (quantidade 1), as pessoas extras e os
 * pacotes de +100 GB. Assim a fatura fica legível para o cliente.
 */
function buildLineItems({ planId, interval, extraSeats, storagePacks }) {
  const basePrice = getStripePriceId(planId, interval, "base");
  if (!basePrice) {
    throw new StripeError(
      501,
      "Este plano ainda não tem preço configurado na Stripe.",
    );
  }

  const items = [{ price: basePrice, quantity: 1 }];

  if (extraSeats > 0) {
    const seatPrice = getStripePriceId(planId, interval, "seat");
    if (!seatPrice) {
      throw new StripeError(501, "Preço de pessoa extra não configurado na Stripe.");
    }
    items.push({ price: seatPrice, quantity: extraSeats });
  }

  if (storagePacks > 0) {
    const packPrice = getStoragePackPriceId(interval);
    if (!packPrice) {
      throw new StripeError(501, "Preço do pacote de armazenamento não configurado.");
    }
    items.push({ price: packPrice, quantity: storagePacks });
  }

  return items;
}

const SUBSCRIPTION_IN_PROGRESS = ["active", "trialing", "past_due"];

/** Quantas pessoas extras o plano aceita além das incluídas. */
function maxExtraSeats(planId) {
  const { includedUsers, maxUsers } = getPlan(planId).entitlements;
  return maxUsers === -1 ? Number.MAX_SAFE_INTEGER : Math.max(0, maxUsers - includedUsers);
}

function assertStoragePacksWithinPlan(planId, storagePacks) {
  const plano = getPlan(planId);
  const limite = plano.entitlements.maxStoragePacks;

  if (limite !== -1 && storagePacks > limite) {
    throw new StripeError(
      400,
      `O plano ${plano.name} permite no máximo ${limite} pacote(s) de +100 GB. ` +
        "Para mais espaço, mude para um plano maior.",
    );
  }
}

function assertSeatsWithinPlan(planId, extraSeats) {
  const limite = maxExtraSeats(planId);
  if (extraSeats > limite) {
    const plano = getPlan(planId);
    throw new StripeError(
      400,
      `O plano ${plano.name} permite no máximo ${limite} pessoa(s) extra(s) — ` +
        `${plano.entitlements.maxUsers} pessoas no total. Para ir além disso, mude para um plano maior.`,
    );
  }
}

async function createCheckoutSession({
  organizationId,
  planId,
  interval,
  extraSeats = 0,
  storagePacks = 0,
  user,
  appUrl,
}) {
  assertEnabled();
  await ensureBillingSchema();

  // Assinar de novo criaria uma segunda cobrança para a mesma conta.
  const atual = await postgres.query(
    "SELECT subscription_status, stripe_subscription_id FROM organizations WHERE id = $1",
    [organizationId],
  );
  if (
    atual.rows[0]?.stripe_subscription_id &&
    SUBSCRIPTION_IN_PROGRESS.includes(atual.rows[0].subscription_status)
  ) {
    throw new StripeError(
      409,
      "Esta conta já tem uma assinatura. Use \"Mudar para este plano\" para trocar de plano.",
    );
  }

  assertSeatsWithinPlan(planId, extraSeats);
  assertStoragePacksWithinPlan(planId, storagePacks);

  const customerId = await ensureCustomer(organizationId, user);
  const lineItems = buildLineItems({ planId, interval, extraSeats, storagePacks });
  const metadata = {
    organizationId,
    planId,
    interval,
    extraSeats: String(extraSeats),
    storagePacks: String(storagePacks),
  };

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: lineItems,
    client_reference_id: organizationId,
    metadata,
    subscription_data: { metadata },
    // CPF/CNPJ na fatura, necessário para a nota fiscal. A Stripe exige
    // deixar nome e endereço em "auto" quando o cliente já existe.
    tax_id_collection: { enabled: true },
    customer_update: { name: "auto", address: "auto" },
    allow_promotion_codes: true,
    locale: "pt-BR",
    success_url: `${appUrl}/billing/success?plan=${encodeURIComponent(planId)}&interval=${encodeURIComponent(interval)}`,
    cancel_url: `${appUrl}/?billing=plans`,
  });

  return { checkoutUrl: session.url, sessionId: session.id };
}

/** Portal onde a pessoa troca cartão, vê faturas e cancela sozinha. */
const PORTAL_CONFIG_TAG = "pauta-sem-cancelamento";
let portalConfigurationId = null;

/**
 * Configuração do portal da Stripe usada pelo Pauta: faturas e cartão sim,
 * cancelamento e troca de plano não. Cancelar é só pela tela do Pauta, que
 * ouve o motivo e oferece uma alternativa antes.
 */
async function ensurePortalConfiguration() {
  if (portalConfigurationId) return portalConfigurationId;

  const existentes = await stripe.billingPortal.configurations.list({ limit: 100 });
  const nossa = (existentes.data || []).find((item) => item.metadata?.tag === PORTAL_CONFIG_TAG);
  if (nossa) {
    portalConfigurationId = nossa.id;
    return portalConfigurationId;
  }

  const criada = await stripe.billingPortal.configurations.create({
    business_profile: {
      headline: "Pauta — faturas e forma de pagamento",
    },
    features: {
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      customer_update: { enabled: true, allowed_updates: ["email", "address", "tax_id", "name"] },
      subscription_cancel: { enabled: false },
      subscription_update: { enabled: false },
    },
    metadata: { tag: PORTAL_CONFIG_TAG },
  });

  portalConfigurationId = criada.id;
  return portalConfigurationId;
}

async function createPortalSession({ organizationId, user, returnUrl }) {
  assertEnabled();

  const customerId = await ensureCustomer(organizationId, user);
  let configuration = null;
  try {
    configuration = await ensurePortalConfiguration();
  } catch (error) {
    console.error("[stripe] não foi possível preparar o portal", error?.message || error);
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
    locale: "pt-BR",
    ...(configuration ? { configuration } : {}),
  });

  return { portalUrl: session.url };
}

/** Lê os itens da assinatura e descobre plano, periodicidade e extras. */
function describeSubscription(subscription) {
  const items = subscription?.items?.data || [];
  let planId = null;
  let interval = null;
  let extraSeats = 0;
  let storagePacks = 0;

  for (const item of items) {
    const description = describePrice(item.price?.id);
    if (!description) continue;

    if (description.kind === "base") {
      planId = description.planId;
      interval = description.interval;
    } else if (description.kind === "seat") {
      extraSeats = Number(item.quantity) || 0;
      interval = interval || description.interval;
    } else if (description.kind === "storage") {
      storagePacks = Number(item.quantity) || 0;
      interval = interval || description.interval;
    }
  }

  // Assinatura antiga ou preço fora do catálogo: cai para os metadados.
  if (!planId && subscription?.metadata?.planId) {
    planId = normalizePlanId(subscription.metadata.planId);
    interval = interval || subscription.metadata.interval || "monthly";
  }

  return { planId, interval: interval || "monthly", extraSeats, storagePacks };
}

const ACTIVE_STATUSES = ["active", "trialing"];
const LOST_STATUSES = ["canceled", "unpaid", "incomplete_expired"];

/**
 * Aplica no banco o que a Stripe diz sobre a assinatura.
 * Com allowDowngrade = false (mudança no meio do ciclo), o que já foi pago
 * continua valendo: o limite menor fica guardado para entrar no fim do período.
 */
async function applyStripeSubscription(subscription, { db = postgres, allowDowngrade = true } = {}) {
  await ensureBillingSchema();

  const organizationId =
    subscription?.metadata?.organizationId ||
    (
      await db.query(
        "SELECT id FROM organizations WHERE stripe_subscription_id = $1 OR stripe_customer_id = $2",
        [subscription.id, subscription.customer || null],
      )
    ).rows[0]?.id;

  if (!organizationId) {
    return { applied: false, reason: "organization_not_found" };
  }

  const { planId, interval, extraSeats, storagePacks } = describeSubscription(subscription);
  const status = subscription.status || "unknown";
  // A Stripe marca o cancelamento agendado ora em cancel_at_period_end, ora em
  // cancel_at (data). Os dois significam: vale até o fim do período pago.
  const cancelScheduled = Boolean(subscription.cancel_at_period_end || subscription.cancel_at);
  const periodEnd = toDate(
    subscription.cancel_at ||
      subscription.current_period_end ||
      subscription.items?.data?.[0]?.current_period_end ||
      null,
  );

  if (ACTIVE_STATUSES.includes(status)) {
    let effectivePlanId = planId || "free";
    let effectiveSeats = extraSeats;
    let effectivePacks = storagePacks;
    let pendingPlan = null;
    let pendingSeats = null;
    let pendingPacks = null;

    if (!allowDowngrade) {
      const current = await db.query(
        "SELECT plan, extra_seats, extra_storage_packs FROM organizations WHERE id = $1",
        [organizationId],
      );
      const atual = current.rows[0];

      if (atual) {
        if (planRank(effectivePlanId) < planRank(atual.plan)) {
          pendingPlan = effectivePlanId;
          effectivePlanId = atual.plan;
        }
        if (effectiveSeats < Number(atual.extra_seats || 0)) {
          pendingSeats = effectiveSeats;
          effectiveSeats = Number(atual.extra_seats || 0);
        }
        if (effectivePacks < Number(atual.extra_storage_packs || 0)) {
          pendingPacks = effectivePacks;
          effectivePacks = Number(atual.extra_storage_packs || 0);
        }
      }
    }

    const hasPending = pendingPlan !== null || pendingSeats !== null || pendingPacks !== null;

    await db.query(
      `
        UPDATE organizations
        SET pending_plan = $2,
            pending_extra_seats = $3,
            pending_extra_storage_packs = $4,
            pending_change_at = $5
        WHERE id = $1
      `,
      [
        organizationId,
        pendingPlan,
        pendingSeats,
        pendingPacks,
        hasPending ? periodEnd : null,
      ],
    );

    await db.query(
      `
        UPDATE organizations
        SET plan = $2,
            subscription_status = $3,
            -- Voltou a assinar: a contagem da retenção zera.
            subscription_ended_at = NULL,
            files_purged_at = NULL,
            billing_interval = $4,
            extra_seats = $5,
            extra_storage_packs = $6,
            stripe_subscription_id = $7,
            stripe_customer_id = COALESCE($8, stripe_customer_id),
            subscription_period_end = $9,
            cancel_at_period_end = $10,
            past_due_since = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `,
      [
        organizationId,
        effectivePlanId,
        status,
        interval,
        effectiveSeats,
        effectivePacks,
        subscription.id,
        subscription.customer || null,
        periodEnd,
        cancelScheduled,
      ],
    );

    return {
      applied: true,
      reason: hasPending ? "subscription_downgrade_scheduled" : "subscription_active",
      organizationId,
    };
  }

  if (status === "past_due") {
    await db.query(
      `
        UPDATE organizations
        SET subscription_status = 'past_due',
            past_due_since = COALESCE(past_due_since, CURRENT_TIMESTAMP),
            stripe_subscription_id = $2,
            subscription_period_end = $3,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `,
      [organizationId, subscription.id, periodEnd],
    );

    return { applied: true, reason: "subscription_past_due", organizationId };
  }

  if (LOST_STATUSES.includes(status)) {
    // Assinatura encerrada: volta para o Grátis e marca a data, que é o que
    // faz a contagem da retenção começar (ver retencao.service).
    await db.query(
      `
        UPDATE organizations
        SET plan = 'free',
            subscription_status = $2,
            subscription_ended_at = COALESCE(subscription_ended_at, CURRENT_TIMESTAMP),
            billing_interval = NULL,
            extra_seats = 0,
            extra_storage_packs = 0,
            cancel_at_period_end = FALSE,
            past_due_since = NULL,
            pending_plan = NULL,
            pending_extra_seats = NULL,
            pending_extra_storage_packs = NULL,
            pending_change_at = NULL,
            subscription_period_end = $3,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `,
      [organizationId, status, periodEnd],
    );

    return { applied: true, reason: "subscription_ended", organizationId };
  }

  await db.query(
    "UPDATE organizations SET subscription_status = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1",
    [organizationId, status],
  );

  return { applied: true, reason: `status_${status}`, organizationId };
}

/**
 * Muda a quantidade de pessoas extras e de pacotes de armazenamento de quem já
 * assina, sem passar por um novo checkout. A Stripe cobra a diferença.
 */
async function buildQuantityChange(organizationId, { extraSeats = 0, storagePacks = 0 }) {
  assertEnabled();
  await ensureBillingSchema();

  const result = await postgres.query(
    `
      SELECT plan, billing_interval, stripe_subscription_id, stripe_customer_id
      FROM organizations WHERE id = $1
    `,
    [organizationId],
  );
  const organization = result.rows[0];

  if (!organization?.stripe_subscription_id) {
    throw new StripeError(409, "Esta conta ainda não tem uma assinatura ativa.");
  }

  const subscription = await retrieveSubscription(organization.stripe_subscription_id);
  const interval = organization.billing_interval || "monthly";
  const planId = normalizePlanId(organization.plan);
  assertSeatsWithinPlan(planId, extraSeats);
  assertStoragePacksWithinPlan(planId, storagePacks);
  const seatPrice = getStripePriceId(planId, interval, "seat");
  const packPrice = getStoragePackPriceId(interval);

  const items = [];
  const existing = subscription.items?.data || [];

  const quantidadeAtual = (priceId) =>
    Number(existing.find((item) => item.price?.id === priceId)?.quantity || 0);

  function upsert(priceId, quantity) {
    if (!priceId) return;
    const current = existing.find((item) => item.price?.id === priceId);

    if (current && quantity <= 0) {
      items.push({ id: current.id, deleted: true });
    } else if (current && current.quantity !== quantity) {
      items.push({ id: current.id, quantity });
    } else if (!current && quantity > 0) {
      items.push({ price: priceId, quantity });
    }
  }

  upsert(seatPrice, extraSeats);
  upsert(packPrice, storagePacks);

  const aumentou =
    extraSeats > quantidadeAtual(seatPrice) || storagePacks > quantidadeAtual(packPrice);

  return {
    subscription,
    items,
    aumentou,
    customerId: organization.stripe_customer_id,
    periodEnd: toDate(
      subscription.current_period_end ||
        subscription.items?.data?.[0]?.current_period_end ||
        null,
    ),
  };
}

async function updateSubscriptionQuantities(organizationId, { extraSeats = 0, storagePacks = 0 }) {
  const { subscription, items, aumentou } = await buildQuantityChange(organizationId, {
    extraSeats,
    storagePacks,
  });

  if (items.length === 0) {
    return { changed: false, status: "unchanged" };
  }

  if (aumentou && (subscription.cancel_at || subscription.cancel_at_period_end)) {
    throw new StripeError(
      409,
      "Sua assinatura está cancelada e vale até o fim do período pago. Reative a assinatura para contratar adicionais.",
    );
  }

  // Redução: o que já foi pago continua valendo até o fim do período. A Stripe
  // passa a cobrar menos no próximo ciclo e não devolve dinheiro.
  if (!aumentou) {
    const reduzida = await stripe.subscriptions.update(subscription.id, {
      items,
      proration_behavior: "none",
    });

    await applyStripeSubscription(
      { ...reduzida, metadata: { ...(reduzida.metadata || {}), organizationId } },
      { allowDowngrade: false },
    );

    return {
      changed: true,
      status: "scheduled",
      effectiveAt: toDate(
        reduzida.current_period_end || reduzida.items?.data?.[0]?.current_period_end || null,
      ),
    };
  }

  // Aumento: always_invoice cobra a diferença agora e pending_if_incomplete
  // segura a troca dos itens até o pagamento entrar.
  const updated = await stripe.subscriptions.update(subscription.id, {
    items,
    proration_behavior: "always_invoice",
    payment_behavior: "pending_if_incomplete",
    expand: ["latest_invoice"],
  });

  const invoice = updated.latest_invoice && typeof updated.latest_invoice === "object"
    ? updated.latest_invoice
    : null;
  const amountDue = Number(invoice?.amount_due || 0);
  const invoicePending = Boolean(invoice) && invoice.status !== "paid" && amountDue > 0;
  const pendingUpdate = Boolean(updated.pending_update);

  if (pendingUpdate || invoicePending) {
    // Nada muda no Pauta até o pagamento entrar (o webhook invoice.paid aplica).
    return {
      changed: false,
      status: "payment_required",
      invoiceUrl: invoice?.hosted_invoice_url || null,
      amountDueCents: amountDue,
    };
  }

  await applyStripeSubscription({
    ...updated,
    metadata: { ...(updated.metadata || {}), organizationId },
  });

  return {
    changed: true,
    status: "applied",
    amountChargedCents: Number(invoice?.amount_paid || invoice?.amount_due || 0),
  };
}

/**
 * Troca o plano de quem já assina. Subir de plano cobra a diferença na hora;
 * descer vale só no fim do período já pago.
 */
async function changeSubscriptionPlan(organizationId, { planId, interval }) {
  assertEnabled();
  await ensureBillingSchema();

  const result = await postgres.query(
    `
      SELECT plan, billing_interval, stripe_subscription_id,
             extra_seats, extra_storage_packs
      FROM organizations WHERE id = $1
    `,
    [organizationId],
  );
  const organization = result.rows[0];

  if (!organization?.stripe_subscription_id) {
    throw new StripeError(409, "Esta conta ainda não tem uma assinatura ativa.");
  }

  const novoBase = getStripePriceId(planId, interval, "base");
  if (!novoBase) {
    throw new StripeError(501, "Este plano ainda não tem preço configurado na Stripe.");
  }

  const subscription = await retrieveSubscription(organization.stripe_subscription_id);

  // Mudar de plano em uma assinatura que já está para encerrar confunde a
  // cobrança: primeiro a pessoa reativa, depois troca.
  if (subscription.cancel_at || subscription.cancel_at_period_end) {
    throw new StripeError(
      409,
      "Sua assinatura está cancelada e vale até o fim do período pago. Reative a assinatura para trocar de plano.",
    );
  }
  const existing = subscription.items?.data || [];
  const encontrar = (kind) =>
    existing.find((item) => describePrice(item.price?.id)?.kind === kind);

  const novoPlano = getPlan(planId);
  const assentosAtuais = Number(organization.extra_seats || 0);
  // O plano novo pode ter um teto menor de pessoas extras.
  const assentos = Math.max(
    0,
    Math.min(
      assentosAtuais,
      novoPlano.entitlements.maxUsers === -1
        ? assentosAtuais
        : novoPlano.entitlements.maxUsers - novoPlano.entitlements.includedUsers,
    ),
  );
  const limitePacotes = novoPlano.entitlements.maxStoragePacks;
  const pacotes =
    limitePacotes === -1
      ? Number(organization.extra_storage_packs || 0)
      : Math.min(Number(organization.extra_storage_packs || 0), limitePacotes);

  const items = [];
  const baseItem = encontrar("base");
  items.push(
    baseItem
      ? { id: baseItem.id, price: novoBase, quantity: 1 }
      : { price: novoBase, quantity: 1 },
  );

  const seatItem = encontrar("seat");
  const novoSeat = getStripePriceId(planId, interval, "seat");
  if (seatItem && assentos <= 0) {
    items.push({ id: seatItem.id, deleted: true });
  } else if (seatItem && novoSeat) {
    items.push({ id: seatItem.id, price: novoSeat, quantity: assentos });
  } else if (!seatItem && novoSeat && assentos > 0) {
    items.push({ price: novoSeat, quantity: assentos });
  }

  const packItem = encontrar("storage");
  const novoPack = getStoragePackPriceId(interval);
  if (packItem && novoPack && pacotes > 0) {
    items.push({ id: packItem.id, price: novoPack, quantity: pacotes });
  }

  const intervaloAtual = organization.billing_interval || "monthly";
  const subiu =
    planRank(planId) > planRank(organization.plan) ||
    (planRank(planId) === planRank(organization.plan) &&
      intervaloAtual === "monthly" &&
      interval === "yearly");

  if (!subiu) {
    const reduzida = await stripe.subscriptions.update(subscription.id, {
      items,
      proration_behavior: "none",
    });

    await applyStripeSubscription(
      { ...reduzida, metadata: { ...(reduzida.metadata || {}), organizationId } },
      { allowDowngrade: false },
    );

    return {
      status: "scheduled",
      effectiveAt: toDate(
        reduzida.cancel_at ||
          reduzida.current_period_end ||
          reduzida.items?.data?.[0]?.current_period_end ||
          null,
      ),
    };
  }

  const atualizada = await stripe.subscriptions.update(subscription.id, {
    items,
    proration_behavior: "always_invoice",
    payment_behavior: "pending_if_incomplete",
    expand: ["latest_invoice"],
  });

  const invoice =
    atualizada.latest_invoice && typeof atualizada.latest_invoice === "object"
      ? atualizada.latest_invoice
      : null;
  const amountDue = Number(invoice?.amount_due || 0);

  if (atualizada.pending_update || (invoice && invoice.status !== "paid" && amountDue > 0)) {
    return {
      status: "payment_required",
      invoiceUrl: invoice?.hosted_invoice_url || null,
      amountDueCents: amountDue,
    };
  }

  await applyStripeSubscription({
    ...atualizada,
    metadata: { ...(atualizada.metadata || {}), organizationId },
  });

  return {
    status: "applied",
    amountChargedCents: Number(invoice?.amount_paid || invoice?.amount_due || 0),
  };
}

/**
 * Desconto que está valendo na assinatura (por exemplo o de retenção), com o
 * valor da próxima fatura e até quando o bônus dura.
 */
async function getActiveDiscount(organizationId) {
  if (!isStripeEnabled()) return null;

  const conta = await postgres.query(
    "SELECT stripe_subscription_id FROM organizations WHERE id = $1",
    [organizationId],
  );
  const subscriptionId = conta.rows[0]?.stripe_subscription_id;
  if (!subscriptionId) return null;

  try {
    const subscription = await retrieveSubscription(subscriptionId);
    const lista = [subscription.discount, ...(subscription.discounts || [])].filter(
      (item) => item && typeof item === "object",
    );
    const desconto = lista.find((item) => item.coupon || item.source?.coupon) || null;
    if (!desconto) return null;

    // A Stripe entrega o cupom de jeitos diferentes conforme a versão da API:
    // objeto em "coupon", id em "coupon" ou id em "source.coupon".
    const bruto = desconto.coupon || desconto.source?.coupon || null;
    const cupom = typeof bruto === "object" ? bruto : bruto ? await stripe.coupons.retrieve(bruto) : null;
    if (!cupom) return null;

    const inicio = toDate(desconto.start) || new Date();
    const meses = Number(cupom.duration_in_months) || null;
    let ate = toDate(desconto.end) || null;
    if (!ate && cupom.duration === "repeating" && meses) {
      ate = new Date(inicio);
      ate.setMonth(ate.getMonth() + meses);
    }

    // Valor da próxima cobrança já com o desconto aplicado.
    let nextAmountCents = null;
    let nextInvoiceAt = toDate(subscription.current_period_end) || null;
    try {
      const preview = await stripe.invoices.createPreview({ subscription: subscriptionId });
      nextAmountCents = Number(preview.amount_due ?? preview.amount_remaining ?? 0);
      nextInvoiceAt = toDate(preview.period_end) || nextInvoiceAt;
    } catch (error) {
      console.error("[stripe] prévia da próxima fatura", error?.message || error);
    }

    return {
      percentOff: cupom.percent_off ? Number(cupom.percent_off) : null,
      amountOffCents: cupom.amount_off ? Number(cupom.amount_off) : null,
      months: meses,
      duration: cupom.duration || null,
      startedAt: inicio,
      endsAt: ate,
      nextAmountCents,
      nextInvoiceAt,
    };
  } catch (error) {
    console.error("[stripe] desconto ativo", error?.message || error);
    return null;
  }
}

/** Período que a fatura cobre, preferindo o das linhas. */
function periodoDaFatura(invoice) {
  const linhas = invoice.lines?.data || [];
  const inicios = linhas.map((linha) => linha.period?.start).filter(Boolean);
  const fins = linhas.map((linha) => linha.period?.end).filter(Boolean);

  const start = inicios.length ? Math.min(...inicios) : invoice.period_start;
  const end = fins.length ? Math.max(...fins) : invoice.period_end;

  return { start, end: end && start && end > start ? end : invoice.period_end || end };
}

/** Próxima cobrança da assinatura: quanto e quando. */
async function getUpcomingInvoice(organizationId) {
  if (!isStripeEnabled()) return null;

  const conta = await postgres.query(
    "SELECT stripe_subscription_id FROM organizations WHERE id = $1",
    [organizationId],
  );
  const subscriptionId = conta.rows[0]?.stripe_subscription_id;
  if (!subscriptionId) return null;

  try {
    const subscription = await retrieveSubscription(subscriptionId);
    if (["canceled", "incomplete_expired"].includes(subscription.status)) return null;

    const preview = await stripe.invoices.createPreview({ subscription: subscriptionId });
    return {
      amountCents: Number(preview.amount_due ?? preview.amount_remaining ?? 0),
      at:
        toDate(preview.next_payment_attempt) ||
        toDate(periodoDaFatura(preview).end) ||
        toDate(subscription.current_period_end) ||
        null,
    };
  } catch (error) {
    console.error("[stripe] próxima cobrança", error?.message || error);
    return null;
  }
}

/** Cobranças da conta, para a tela de pagamentos. */
async function listInvoices(organizationId, { limit = 100 } = {}) {
  assertEnabled();
  await ensureBillingSchema();

  const result = await postgres.query(
    "SELECT stripe_customer_id FROM organizations WHERE id = $1",
    [organizationId],
  );
  const customerId = result.rows[0]?.stripe_customer_id;

  if (!customerId) {
    return { invoices: [] };
  }

  const invoices = await stripe.invoices.list({ customer: customerId, limit });

  return {
    invoices: invoices.data.map((invoice) => ({
      id: invoice.id,
      number: invoice.number,
      status: invoice.status,
      createdAt: toDate(invoice.created),
      paidAt: toDate(invoice.status_transitions?.paid_at || null),
      // O período de serviço vem nas linhas; o da fatura, na primeira cobrança,
      // começa e termina no mesmo instante e confundia quem lia.
      periodStart: toDate(periodoDaFatura(invoice).start),
      periodEnd: toDate(periodoDaFatura(invoice).end),
      amountDueCents: Number(invoice.amount_due || 0),
      amountPaidCents: Number(invoice.amount_paid || 0),
      currency: invoice.currency,
      hostedInvoiceUrl: invoice.hosted_invoice_url || null,
      invoicePdf: invoice.invoice_pdf || null,
      billingReason: invoice.billing_reason || null,
      // Cada linha da fatura (plano, pessoas extras, pacote, ajuste proporcional).
      lines: (invoice.lines?.data || []).map((line) => ({
        description: line.description || null,
        quantity: Number(line.quantity || 1),
        amountCents: Number(line.amount || 0),
        proration: Boolean(line.proration),
      })),
    })),
  };
}

/** Cancela a assinatura mantendo o acesso até o fim do período já pago. */
async function cancelSubscription(organizationId) {
  assertEnabled();
  await ensureBillingSchema();

  const result = await postgres.query(
    "SELECT stripe_subscription_id FROM organizations WHERE id = $1",
    [organizationId],
  );
  const subscriptionId = result.rows[0]?.stripe_subscription_id;

  if (!subscriptionId) {
    throw new StripeError(409, "Esta conta não tem assinatura para cancelar.");
  }

  const subscription = await retrieveSubscription(subscriptionId);
  if (subscription.cancel_at || subscription.cancel_at_period_end) {
    return { changed: false, effectiveAt: toDate(subscription.cancel_at) };
  }

  const cancelada = await stripe.subscriptions.update(subscriptionId, {
    cancel_at_period_end: true,
  });

  // O que já foi pago continua valendo até o fim do período: um plano menor
  // agendado não pode entrar agora só porque a assinatura foi cancelada.
  await applyStripeSubscription(
    { ...cancelada, metadata: { ...(cancelada.metadata || {}), organizationId } },
    { allowDowngrade: false },
  );

  return {
    changed: true,
    effectiveAt: toDate(
      cancelada.cancel_at ||
        cancelada.current_period_end ||
        cancelada.items?.data?.[0]?.current_period_end ||
        null,
    ),
  };
}

/** Desfaz um cancelamento agendado, mantendo a mesma assinatura. */
async function resumeSubscription(organizationId) {
  assertEnabled();
  await ensureBillingSchema();

  const result = await postgres.query(
    "SELECT stripe_subscription_id FROM organizations WHERE id = $1",
    [organizationId],
  );
  const subscriptionId = result.rows[0]?.stripe_subscription_id;

  if (!subscriptionId) {
    throw new StripeError(409, "Esta conta não tem assinatura para reativar.");
  }

  const subscription = await retrieveSubscription(subscriptionId);
  if (!subscription.cancel_at && !subscription.cancel_at_period_end) {
    return { changed: false };
  }

  const reativada = await stripe.subscriptions.update(
    subscriptionId,
    // A Stripe recusa receber cancel_at e cancel_at_period_end juntos.
    subscription.cancel_at ? { cancel_at: "" } : { cancel_at_period_end: false },
  );

  await applyStripeSubscription(
    { ...reativada, metadata: { ...(reativada.metadata || {}), organizationId } },
    { allowDowngrade: false },
  );

  return { changed: true };
}

/** Quanto a Stripe vai cobrar agora por esse aumento (usado antes de confirmar). */
async function previewSubscriptionQuantities(organizationId, { extraSeats = 0, storagePacks = 0 }) {
  assertEnabled();
  await ensureBillingSchema();

  const { subscription, items, aumentou, customerId, periodEnd } = await buildQuantityChange(
    organizationId,
    { extraSeats, storagePacks },
  );

  if (items.length === 0) {
    return { changed: false };
  }

  if (!aumentou) {
    return { changed: true, increase: false, amountDueCents: 0, effectiveAt: periodEnd };
  }

  const preview = await stripe.invoices.createPreview({
    customer: customerId,
    subscription: subscription.id,
    subscription_details: { items, proration_behavior: "always_invoice" },
  });

  return {
    changed: true,
    increase: true,
    amountDueCents: Number(preview.amount_due || 0),
  };
}

async function retrieveSubscription(subscriptionId) {
  return stripe.subscriptions.retrieve(subscriptionId, {
    // "discounts" vem só como referência: sem expandir, não dá para ler o cupom.
    expand: ["items.data.price", "discounts", "discounts.coupon"],
  });
}

// Webhook pode se perder (rede caiu, CLI fechada). Antes de mostrar a
// assinatura ou de barrar uma exclusão, conferimos o estado real na Stripe.
const lastSyncByOrganization = new Map();
const SYNC_COOLDOWN_MS = 30 * 1000;

async function syncSubscriptionFromStripe(organizationId, { force = false } = {}) {
  if (!isStripeEnabled()) {
    return { synced: false, reason: "stripe_disabled" };
  }

  const lastSync = lastSyncByOrganization.get(organizationId) || 0;
  if (!force && Date.now() - lastSync < SYNC_COOLDOWN_MS) {
    return { synced: false, reason: "cooldown" };
  }

  await ensureBillingSchema();
  const result = await postgres.query(
    "SELECT stripe_customer_id, stripe_subscription_id FROM organizations WHERE id = $1",
    [organizationId],
  );
  const subscriptionId = result.rows[0]?.stripe_subscription_id;
  const customerId = result.rows[0]?.stripe_customer_id;

  if (!subscriptionId && !customerId) {
    return { synced: false, reason: "sem_assinatura" };
  }

  lastSyncByOrganization.set(organizationId, Date.now());

  try {
    // Sem assinatura gravada (webhook atrasado ou perdido), procuramos pelo
    // cliente: assim a conta se acerta sozinha depois do pagamento.
    const subscription = subscriptionId
      ? await retrieveSubscription(subscriptionId)
      : await buscarAssinaturaDoCliente(customerId);

    if (!subscription) {
      return { synced: false, reason: "sem_assinatura" };
    }
    await applyStripeSubscription(
      { ...subscription, metadata: { ...(subscription.metadata || {}), organizationId } },
      { allowDowngrade: subscription.status !== "active" && subscription.status !== "trialing" },
    );
    return { synced: true };
  } catch (error) {
    console.error("[stripe] falha ao sincronizar assinatura", error?.message || error);
    return { synced: false, reason: "erro" };
  }
}

/** Assinatura mais recente que vale para a conta, procurada pelo cliente. */
async function buscarAssinaturaDoCliente(customerId) {
  const lista = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 10 });
  const ordem = ["active", "trialing", "past_due", "unpaid", "incomplete"];
  const validas = (lista.data || [])
    .filter((item) => ordem.includes(item.status))
    .sort((a, b) => ordem.indexOf(a.status) - ordem.indexOf(b.status) || (b.created || 0) - (a.created || 0));

  return validas[0] || null;
}

/** Ponto único de entrada dos eventos da Stripe. */
async function handleStripeEvent(event) {
  const { invalidatePlanCache } = require("../middlewares/plan-limit.middleware");

  // A Stripe reenvia o evento quando nao recebe 200 a tempo. Registrar o id
  // antes de agir garante que cada evento vale uma vez so.
  if (event?.id) {
    await ensureBillingSchema();
    const registro = await postgres.query(
      `
        INSERT INTO stripe_webhook_events (event_id, type)
        VALUES ($1, $2)
        ON CONFLICT (event_id) DO NOTHING
        RETURNING event_id
      `,
      [event.id, event.type || null],
    );
    if (registro.rowCount === 0) {
      return { applied: false, reason: "evento_repetido" };
    }
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      if (!session.subscription) {
        return { applied: false, reason: "session_without_subscription" };
      }

      const subscription = await retrieveSubscription(session.subscription);
      // O checkout guarda a empresa; a assinatura pode não ter os metadados.
      subscription.metadata = {
        ...(subscription.metadata || {}),
        organizationId:
          subscription.metadata?.organizationId ||
          session.metadata?.organizationId ||
          session.client_reference_id,
      };

      const result = await applyStripeSubscription(subscription);
      if (result.organizationId) invalidatePlanCache(result.organizationId);
      return result;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const result = await applyStripeSubscription(event.data.object, {
        allowDowngrade: event.type === "customer.subscription.deleted",
      });
      if (result.organizationId) invalidatePlanCache(result.organizationId);
      return result;
    }

    case "invoice.paid": {
      const invoice = event.data.object;
      // Toda fatura paga vira pedido de nota fiscal no painel.
      try {
        const { recordPaidInvoice } = require("./nfse.service");
        await recordPaidInvoice(invoice);
      } catch (error) {
        console.error("[nfse] falha ao registrar fatura paga", invoice?.id, error?.message || error);
      }
      const subscriptionId =
        invoice.subscription || invoice.parent?.subscription_details?.subscription;
      if (!subscriptionId) {
        return { applied: false, reason: "invoice_without_subscription" };
      }

      const result = await applyStripeSubscription(await retrieveSubscription(subscriptionId));
      if (result.organizationId) invalidatePlanCache(result.organizationId);
      return result;
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object;
      const customerId = invoice.customer;
      if (!customerId) {
        return { applied: false, reason: "invoice_without_customer" };
      }

      // Marca o início da régua de cobrança (banner, somente leitura, cancelamento).
      const updated = await postgres.query(
        `
          UPDATE organizations
          SET subscription_status = 'past_due',
              past_due_since = COALESCE(past_due_since, CURRENT_TIMESTAMP),
              updated_at = CURRENT_TIMESTAMP
          WHERE stripe_customer_id = $1
          RETURNING id
        `,
        [customerId],
      );

      const organizationId = updated.rows[0]?.id;
      if (organizationId) invalidatePlanCache(organizationId);
      return { applied: Boolean(organizationId), reason: "payment_failed", organizationId };
    }

    default:
      return { applied: false, reason: "event_ignored" };
  }
}

module.exports = {
  StripeError,
  ensurePortalConfiguration,
  ensureCustomer,
  createCheckoutSession,
  createPortalSession,
  changeSubscriptionPlan,
  resumeSubscription,
  cancelSubscription,
  getActiveDiscount,
  getUpcomingInvoice,
  listInvoices,
  updateSubscriptionQuantities,
  previewSubscriptionQuantities,
  describeSubscription,
  applyStripeSubscription,
  syncSubscriptionFromStripe,
  handleStripeEvent,
};
