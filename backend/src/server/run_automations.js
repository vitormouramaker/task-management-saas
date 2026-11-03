// Roda agora as automações que dependem de prazo (as de ação disparam
// sozinhas quando alguém mexe no card). Usado pela manutenção e pelos testes.
require("../config/env");
const { runScheduledAutomations } = require("../services/automations.service");
const { postgres } = require("./connect");

(async () => {
  try {
    const total = await runScheduledAutomations();
    console.log(`automações de prazo: ${total} card(s) tratados.`);
  } catch (error) {
    console.error("falha ao rodar as automações:", error?.message || error);
    process.exitCode = 1;
  } finally {
    await postgres.end();
  }
})();
