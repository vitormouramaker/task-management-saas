/**
 * Marca uma conta como isenta de cobranca: ela fica no plano escolhido sem
 * assinatura e sem nenhum aviso de fatura.
 *
 *   node scripts/isentar-conta.js \
 *     --contas="Empresa Interna,Outra Conta" --plano=empresarial --aplicar
 *
 * Sem --aplicar, so mostra o que faria.
 */
require("../src/config/env");

const { postgres } = require("../src/server/connect");

const APLICAR = process.argv.includes("--aplicar");
const valorDe = (nome) =>
  (process.argv.find((arg) => arg.startsWith(`--${nome}=`)) || "").replace(`--${nome}=`, "");

const CONTAS = valorDe("contas")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const PLANO = valorDe("plano") || "empresarial";

(async () => {
  if (CONTAS.length === 0) {
    console.error('informe --contas="Nome 1,Nome 2"');
    process.exit(2);
  }

  const { rows } = await postgres.query(
    `
      SELECT id, name, plan, subscription_status, billing_exempt
      FROM organizations
      WHERE lower(name) = ANY($1::text[])
    `,
    [CONTAS.map((nome) => nome.toLowerCase())],
  );

  const achadas = rows.map((item) => item.name.toLowerCase());
  for (const pedida of CONTAS) {
    if (!achadas.includes(pedida.toLowerCase())) console.log(`AVISO: conta "${pedida}" nao encontrada.`);
  }

  for (const conta of rows) {
    console.log(
      `${conta.name}: plano ${conta.plan} (${conta.subscription_status}), isenta=${conta.billing_exempt === true}`,
    );
  }

  if (!APLICAR) {
    console.log("");
    console.log(`simulacao: com --aplicar, essas contas ficam no plano ${PLANO} e isentas de cobranca.`);
    await postgres.end();
    return;
  }

  for (const conta of rows) {
    await postgres.query(
      `
        UPDATE organizations
        SET plan = $2,
            subscription_status = 'internal',
            billing_exempt = TRUE,
            cancel_at_period_end = FALSE,
            stripe_subscription_id = NULL
        WHERE id = $1
      `,
      [conta.id, PLANO],
    );
    console.log(
      `${conta.name}: plano ${PLANO} gravado e isenta de cobranca ` +
        "(conta isenta usa os limites do Enterprise, que sao os maiores).",
    );
  }

  await postgres.end();
})().catch(async (erro) => {
  console.error("falhou:", erro?.message || erro);
  try {
    await postgres.end();
  } catch {}
  process.exit(1);
});
