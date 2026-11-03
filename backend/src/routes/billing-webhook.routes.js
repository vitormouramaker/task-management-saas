const express = require("express");
const router = express.Router();
const { stripe, isStripeEnabled, WEBHOOK_SECRET } = require("../config/stripe");
const { handleStripeEvent } = require("../services/stripe.service");

// A Stripe assina cada evento; sem conferir a assinatura qualquer um poderia
// mandar "pagamento aprovado" para a nossa API.
router.post("/", express.raw({ type: "application/json" }), async (req, res) => {
  if (!isStripeEnabled() || !WEBHOOK_SECRET) {
    console.error("[webhook] Stripe não configurado (chave ou segredo ausente).");
    return res.status(500).json({ message: "Cobrança não configurada." });
  }

  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      req.headers["stripe-signature"],
      WEBHOOK_SECRET,
    );
  } catch (error) {
    console.error("[webhook] assinatura inválida:", error.message);
    return res.status(400).json({ message: "Assinatura Stripe inválida." });
  }

  try {
    const result = await handleStripeEvent(event);
    console.log("[webhook]", event.type, "->", result.reason, result.organizationId || "");
    return res.json({ received: true, ...result });
  } catch (error) {
    console.error("[webhook] falha ao processar", event.type, error?.message || error);
    // 500 faz a Stripe tentar de novo mais tarde.
    return res.status(500).json({ message: "Erro ao processar webhook." });
  }
});

module.exports = router;
