require("../config/env");
const { postgres } = require("./connect");
const { runBillingNotices } = require("../services/billing-emails.service");

/**
 * Dispara os avisos de plano (fim do teste, limite chegando, fatura em aberto).
 * O servidor já roda isso sozinho a cada 6 horas; este script serve para rodar
 * na mão ou por agendamento no servidor.
 */
(async () => {
  try {
    const total = await runBillingNotices();
    console.log(`Avisos enviados: ${total}`);
  } catch (error) {
    console.error("Falha ao enviar os avisos:", error?.message || error);
    process.exitCode = 1;
  } finally {
    await postgres.end().catch(() => undefined);
  }
})();
