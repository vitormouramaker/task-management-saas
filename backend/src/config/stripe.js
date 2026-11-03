require("./env");
const Stripe = require("stripe");

// Uma chave só, decidida pelo ambiente: o .env de produção traz a chave ao vivo
// e o .env.local (fora do git) traz a de teste. Sem chave, a cobrança fica
// desligada e as rotas respondem que o pagamento está indisponível.
const SECRET_KEY = String(
  process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY_TEST || "",
).trim();

const STRIPE_MODE =
  process.env.STRIPE_MODE || (SECRET_KEY.startsWith("sk_live") ? "live" : "test");

const WEBHOOK_SECRET = String(process.env.STRIPE_WEBHOOK_SECRET || "").trim();

// Usado só nos testes automatizados, para falar com uma Stripe falsa local.
const apiHost = process.env.STRIPE_API_HOST || null;

const stripe = SECRET_KEY
  ? new Stripe(SECRET_KEY, {
      maxNetworkRetries: 2,
      timeout: 20000,
      ...(apiHost
        ? {
            host: apiHost,
            port: Number(process.env.STRIPE_API_PORT) || 443,
            protocol: process.env.STRIPE_API_PROTOCOL || "https",
          }
        : {}),
    })
  : null;

if (!stripe) {
  console.warn("[stripe] STRIPE_SECRET_KEY não definido: assinaturas desligadas.");
}

function isStripeEnabled() {
  return Boolean(stripe);
}

module.exports = { stripe, isStripeEnabled, STRIPE_MODE, WEBHOOK_SECRET };
