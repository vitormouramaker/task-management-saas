/**
 * Confere, um a um, se os precos cadastrados na Stripe batem com o catalogo do
 * Pauta: valor, moeda, periodicidade e se o preco ainda esta ativo.
 *
 *   node scripts/auditar-catalogo-stripe.js
 *   STRIPE_SECRET_KEY=... node scripts/auditar-catalogo-stripe.js
 *
 * Serve para o ambiente de teste e, com a chave de producao, para conferir o
 * catalogo publicado antes de vender.
 */
require("../src/config/env");

const Stripe = require("stripe");
const { PLAN_CATALOG, getStoragePack } = require("../src/services/billing.service");

const CHAVE = process.env.STRIPE_AUDIT_KEY || process.env.STRIPE_SECRET_KEY;

/** O que o catalogo do Pauta espera de cada variavel de ambiente. */
function esperado() {
  const itens = [];

  for (const plano of Object.values(PLAN_CATALOG)) {
    if (!plano.priceCents) continue;
    for (const ciclo of ["monthly", "yearly"]) {
      const valorPlano = plano.priceCents[ciclo];
      if (valorPlano) {
        itens.push({
          variavel: `STRIPE_PRICE_${plano.id.toUpperCase()}_${ciclo.toUpperCase()}`,
          centavos: valorPlano,
          intervalo: ciclo === "monthly" ? "month" : "year",
          descricao: `${plano.name} (${ciclo === "monthly" ? "mensal" : "anual"})`,
        });
      }

      const valorAssento = plano.extraUserPriceCents?.[ciclo];
      if (valorAssento) {
        itens.push({
          variavel: `STRIPE_PRICE_${plano.id.toUpperCase()}_SEAT_${ciclo.toUpperCase()}`,
          centavos: valorAssento,
          intervalo: ciclo === "monthly" ? "month" : "year",
          descricao: `${plano.name} - usuario adicional (${ciclo === "monthly" ? "mensal" : "anual"})`,
        });
      }
    }
  }

  const pacote = getStoragePack();
  for (const ciclo of ["monthly", "yearly"]) {
    itens.push({
      variavel: `STRIPE_PRICE_STORAGE_100GB_${ciclo.toUpperCase()}`,
      centavos: pacote.priceCents[ciclo],
      intervalo: ciclo === "monthly" ? "month" : "year",
      descricao: `Pacote de 100 GB (${ciclo === "monthly" ? "mensal" : "anual"})`,
    });
  }

  return itens;
}

const emReais = (centavos) =>
  (Number(centavos || 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

(async () => {
  if (!CHAVE) {
    console.error("sem chave da Stripe no ambiente.");
    process.exit(2);
  }

  const stripe = new Stripe(CHAVE);
  const modo = CHAVE.includes("_live") ? "PRODUCAO" : "TESTE";
  console.log(`conferindo o catalogo em ${modo}`);
  console.log("");

  const problemas = [];

  for (const item of esperado()) {
    const id = process.env[item.variavel];
    if (!id) {
      problemas.push(`${item.variavel}: nao configurada (${item.descricao})`);
      console.log(`FALTA   ${item.variavel} -- ${item.descricao}`);
      continue;
    }

    let preco = null;
    try {
      preco = await stripe.prices.retrieve(id, { expand: ["product"] });
    } catch (erro) {
      problemas.push(`${item.variavel}: preco ${id} nao existe nesta conta (${erro.message})`);
      console.log(`ERRO    ${item.variavel} -- ${erro.message}`);
      continue;
    }

    const falhas = [];
    if (preco.unit_amount !== item.centavos) {
      falhas.push(`valor ${emReais(preco.unit_amount)} (esperado ${emReais(item.centavos)})`);
    }
    if ((preco.recurring?.interval || null) !== item.intervalo) {
      falhas.push(`periodicidade ${preco.recurring?.interval || "sem recorrencia"} (esperado ${item.intervalo})`);
    }
    if ((preco.recurring?.interval_count || 1) !== 1) {
      falhas.push(`cobra a cada ${preco.recurring.interval_count} periodos`);
    }
    if (preco.currency !== "brl") {
      falhas.push(`moeda ${preco.currency}`);
    }
    if (!preco.active) {
      falhas.push("preco desativado na Stripe");
    }
    if (preco.product && preco.product.active === false) {
      falhas.push("produto arquivado na Stripe");
    }

    if (falhas.length === 0) {
      console.log(
        `OK      ${item.variavel} -- ${emReais(preco.unit_amount)} / ${preco.recurring.interval} (${preco.product?.name || ""})`,
      );
    } else {
      problemas.push(`${item.variavel}: ${falhas.join("; ")}`);
      console.log(`DIVERGE ${item.variavel} -- ${falhas.join("; ")}`);
    }
  }

  console.log("");
  if (problemas.length === 0) {
    console.log("catalogo da Stripe bate com o catalogo do Pauta.");
    return;
  }
  console.log(`${problemas.length} divergencia(s):`);
  for (const problema of problemas) console.log(`  - ${problema}`);
  process.exit(1);
})().catch((erro) => {
  console.error("falhou:", erro?.message || erro);
  process.exit(1);
});
