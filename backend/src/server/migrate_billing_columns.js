/**
 * Adiciona colunas de billing na tabela organizations caso não existam.
 * Execução: node src/server/migrate_billing_columns.js
 */
require("dotenv").config({
  path: require("path").resolve(__dirname, "../../.env"),
});
const { postgres } = require("./connect");

async function run() {
  const client = await postgres.connect();

  try {
    await client.query("BEGIN");

    await client.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(255)
    `);

    await client.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS stripe_subscription_id VARCHAR(255)
    `);

    await client.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS billing_interval VARCHAR(50)
    `);

    await client.query("COMMIT");
    console.log("✅ Colunas de billing verificadas/adicionadas com sucesso.");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Erro na migração:", err);
    throw err;
  } finally {
    client.release();
    process.exit(0);
  }
}

run();
