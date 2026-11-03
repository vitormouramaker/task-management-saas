const crypto = require("crypto");
const { postgres } = require("../server/connect");
const { stripe, isStripeEnabled } = require("../config/stripe");

/**
 * Retenção: antes de cancelar, a pessoa conta o motivo e recebe uma proposta
 * feita para aquele motivo (desconto, plano menor, mês por nossa conta ou
 * conversa com a equipe). Só depois disso o cancelamento acontece.
 */

const REASONS = {
  caro: {
    label: "Ficou caro para o momento",
    offer: {
      type: "desconto",
      percent: 15,
      months: 3,
      title: "Que tal 15% de desconto nos próximos 3 meses?",
      description:
        "Aplicamos o desconto na hora, na mesma assinatura. Depois dos 3 meses o valor volta ao normal, e você pode cancelar quando quiser.",
      cta: "Quero o desconto",
    },
  },
  pouco_uso: {
    label: "A equipe não usou o suficiente",
    offer: {
      type: "plano_menor",
      title: "Que tal um plano menor em vez de cancelar?",
      description:
        "Você continua com o Pauta pagando menos. A troca vale no fim do período já pago e nada é apagado.",
      cta: "Mudar para o plano menor",
    },
  },
  falta_recurso: {
    label: "Faltou um recurso de que eu precisava",
    offer: {
      type: "falar_com_equipe",
      title: "Conte o que faltou — talvez já exista ou esteja perto",
      description:
        "Abrimos uma conversa com a nossa equipe com o que você escrever. Respondemos no prazo do seu plano e, se fizer sentido, entra no nosso roteiro.",
      cta: "Falar com a equipe",
    },
  },
  outra_ferramenta: {
    label: "Mudamos para outra ferramenta",
    offer: {
      type: "mes_gratis",
      percent: 100,
      months: 1,
      title: "Um mês por nossa conta antes de decidir",
      description:
        "Sem cobrança no próximo mês. Se ainda assim a outra ferramenta servir melhor, é só cancelar depois, sem multa.",
      cta: "Aceitar o mês grátis",
    },
  },
  problemas_tecnicos: {
    label: "Tive problemas técnicos",
    offer: {
      type: "suporte_prioritario",
      title: "Deixa a gente resolver isso com você",
      description:
        "Abrimos agora uma conversa marcada como prioritária com o nosso time, com o que você escrever aqui.",
      cta: "Quero ajuda com isso",
    },
  },
  era_teste: {
    label: "Era só um teste",
    offer: {
      type: "mes_gratis",
      percent: 100,
      months: 1,
      title: "Fique mais um mês por nossa conta",
      description:
        "Sem cobrança no próximo mês, para você decidir com calma e com a equipe toda usando.",
      cta: "Aceitar o mês grátis",
    },
  },
  outro: {
    label: "Outro motivo",
    offer: {
      type: "falar_com_equipe",
      title: "Quer contar o que aconteceu?",
      description:
        "Abrimos uma conversa com a nossa equipe com o que você escrever. Às vezes é algo que resolvemos rápido.",
      cta: "Falar com a equipe",
    },
  },
};

/** Proposta de retenção é uma por conta a cada 6 meses. */
const JANELA_DA_PROPOSTA_MESES = 6;

async function propostaJaUsada(organizationId) {
  await ensureRetentionSchema();
  const resultado = await postgres.query(
    `
      SELECT created_at FROM cancellation_surveys
      WHERE organization_id = $1
        AND outcome = 'aceitou_oferta'
        AND created_at > NOW() - ($2::int * INTERVAL '1 month')
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [organizationId, JANELA_DA_PROPOSTA_MESES],
  );
  return resultado.rows[0]?.created_at || null;
}

class RetentionError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

let schemaReady = null;

function ensureRetentionSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const { ensurePlatformAdminSchema } = require("./platform-admin.service");
      await ensurePlatformAdminSchema();
      await postgres.query(
        "ALTER TABLE cancellation_surveys ADD COLUMN IF NOT EXISTS offer_type VARCHAR(40)",
      );
      await postgres.query(
        "ALTER TABLE cancellation_surveys ADD COLUMN IF NOT EXISTS outcome VARCHAR(20) NOT NULL DEFAULT 'cancelou'",
      );
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

function listReasons() {
  return Object.entries(REASONS).map(([id, item]) => ({ id, label: item.label }));
}

/** A proposta que combina com o motivo, já com os dados da conta. */
async function buildOffer(organizationId, reason) {
  const base = REASONS[reason];
  if (!base) throw new RetentionError(400, "Escolha um dos motivos da lista.");

  const usadaEm = await propostaJaUsada(organizationId);
  if (usadaEm) {
    // Já aproveitou uma proposta há pouco: segue direto para o cancelamento.
    return {
      type: "sem_proposta",
      reason,
      alreadyUsed: true,
      usedAt: usadaEm,
      title: "Você já aproveitou uma proposta recentemente",
      description:
        "Cada conta recebe uma proposta a cada 6 meses. Se quiser mesmo encerrar, é só seguir — o acesso continua até o fim do período já pago.",
      cta: "Continuar",
    };
  }

  const offer = { ...base.offer, reason };

  if (offer.type === "plano_menor") {
    const { PLAN_ORDER, PAID_PLANS, getPlan, normalizePlanId } = require("./billing.service");
    const conta = await postgres.query("SELECT plan, billing_interval FROM organizations WHERE id = $1", [
      organizationId,
    ]);
    const atual = normalizePlanId(conta.rows[0]?.plan);
    const abaixo = PLAN_ORDER.filter((id) => PAID_PLANS.includes(id) && PLAN_ORDER.indexOf(id) < PLAN_ORDER.indexOf(atual));
    const destino = abaixo[abaixo.length - 1] || null;

    if (!destino) {
      // Já está no menor plano pago: oferece o desconto no lugar.
      return { ...REASONS.caro.offer, reason, type: "desconto" };
    }

    const plano = getPlan(destino);
    const interval = conta.rows[0]?.billing_interval === "yearly" ? "yearly" : "monthly";
    return {
      ...offer,
      targetPlan: destino,
      targetPlanName: plano.name,
      targetPriceCents: plano.priceCents[interval],
      interval,
    };
  }

  return offer;
}

async function aplicarCupom(organizationId, { percent, months }) {
  if (!isStripeEnabled()) {
    throw new RetentionError(503, "O pagamento on-line está indisponível no momento. Fale com o suporte.");
  }

  const conta = await postgres.query(
    "SELECT stripe_subscription_id FROM organizations WHERE id = $1",
    [organizationId],
  );
  const subscriptionId = conta.rows[0]?.stripe_subscription_id;
  if (!subscriptionId) {
    throw new RetentionError(409, "Esta conta não tem assinatura ativa para receber o desconto.");
  }

  const coupon = await stripe.coupons.create({
    percent_off: percent,
    duration: "repeating",
    duration_in_months: months,
    name: `Retenção ${percent}% por ${months} mês(es)`,
    metadata: { organizationId, origem: "retencao" },
  });

  try {
    await stripe.subscriptions.update(subscriptionId, { discounts: [{ coupon: coupon.id }] });
  } catch (error) {
    // Contas antigas da Stripe ainda usam o campo "coupon".
    await stripe.subscriptions.update(subscriptionId, { coupon: coupon.id });
  }

  return { couponId: coupon.id };
}

async function abrirConversaDeSuporte(user, { assunto, mensagem }) {
  const { startConversation } = require("./support.service");
  try {
    const { conversation } = await startConversation(user, { subject: assunto, message: mensagem });
    return { conversationId: conversation.id };
  } catch (error) {
    // Plano sem chat ou limite de conversas: não trava a retenção.
    console.error("[retencao] não foi possível abrir a conversa", error?.message || error);
    return { conversationId: null };
  }
}

/** Registra a resposta da pesquisa e o que aconteceu depois dela. */
async function registrarResposta(organizationId, memberId, { reason, comment, offerType, outcome }) {
  await ensureRetentionSchema();
  const plano = await postgres.query("SELECT plan FROM organizations WHERE id = $1", [organizationId]);

  await postgres.query(
    `
      INSERT INTO cancellation_surveys (id, organization_id, member_id, plan, reason, comment, offer_type, outcome)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `,
    [
      `can_${crypto.randomBytes(8).toString("hex")}`,
      organizationId,
      memberId,
      plano.rows[0]?.plan || null,
      reason,
      String(comment || "").slice(0, 2000) || null,
      offerType || null,
      outcome,
    ],
  );
}

/** A pessoa aceitou a proposta: aplicamos e a assinatura continua. */
async function acceptOffer(user, { reason, comment }) {
  const organizationId = user.organizationId;
  const offer = await buildOffer(organizationId, reason);

  if (offer.alreadyUsed) {
    throw new RetentionError(
      409,
      "Esta conta já aproveitou uma proposta nos últimos 6 meses.",
    );
  }
  let resultado = {};

  if (offer.type === "desconto" || offer.type === "mes_gratis") {
    resultado = await aplicarCupom(organizationId, { percent: offer.percent, months: offer.months });
  } else if (offer.type === "plano_menor") {
    const { changeSubscriptionPlan } = require("./stripe.service");
    await changeSubscriptionPlan(organizationId, { planId: offer.targetPlan, interval: offer.interval });
    resultado = { plano: offer.targetPlan };
  } else {
    resultado = await abrirConversaDeSuporte(user, {
      assunto:
        offer.type === "suporte_prioritario"
          ? "Problema técnico antes de cancelar"
          : "Antes de cancelar: o que faltou",
      mensagem:
        String(comment || "").trim() ||
        "A pessoa pediu ajuda pela tela de cancelamento e não escreveu detalhes.",
    });
  }

  await registrarResposta(organizationId, user.id, {
    reason,
    comment,
    offerType: offer.type,
    outcome: "aceitou_oferta",
  });

  // Com desconto aplicado, já devolvemos quanto fica a próxima fatura.
  let discount = null;
  if (offer.type === "desconto" || offer.type === "mes_gratis") {
    const { getActiveDiscount } = require("./stripe.service");
    discount = await getActiveDiscount(organizationId).catch(() => null);
  }

  const emReais = (centavos) =>
    (Number(centavos || 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  return {
    offer,
    discount,
    ...resultado,
    message:
      offer.type === "desconto" || offer.type === "mes_gratis"
        ? discount?.nextAmountCents !== null && discount?.nextAmountCents !== undefined
          ? `Pronto! O desconto já está valendo: sua próxima fatura fica em ${emReais(discount.nextAmountCents)}${
              discount.months ? `, pelos próximos ${discount.months} mês(es)` : ""
            }.`
          : "Pronto! O desconto já está valendo na sua assinatura."
        : offer.type === "plano_menor"
          ? "Mudança registrada: o plano menor entra no fim do período já pago."
          : "Conversa aberta com a nossa equipe. Responderemos por aqui mesmo.",
  };
}

/** A pessoa recusou a proposta e quer mesmo cancelar. */
async function registerCancellation(user, { reason, comment, offerType }) {
  if (!REASONS[reason]) {
    throw new RetentionError(400, "Escolha um dos motivos da lista antes de cancelar.");
  }
  await registrarResposta(user.organizationId, user.id, {
    reason,
    comment,
    offerType: offerType || REASONS[reason].offer.type,
    outcome: "cancelou",
  });
}

module.exports = {
  REASONS,
  RetentionError,
  acceptOffer,
  buildOffer,
  ensureRetentionSchema,
  listReasons,
  registerCancellation,
};
