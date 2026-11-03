const crypto = require("crypto");
const { postgres } = require("../server/connect");
const { JWT_SECRET } = require("../config/jwt");
const { AccountError } = require("./account.service");

/**
 * Registro de quem já usou o teste grátis. Guardamos só o resumo (hash) do
 * CPF/CNPJ e do e-mail: serve para impedir que a mesma pessoa apague a conta e
 * pegue o teste de novo, sem manter o documento em si.
 */
let schemaReady = null;

function ensureTrialSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      await postgres.query(`
        CREATE TABLE IF NOT EXISTS trial_grants (
          id SERIAL PRIMARY KEY,
          document_hash VARCHAR(64),
          email_hash VARCHAR(64),
          organization_id VARCHAR(100),
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await postgres.query(
        "CREATE INDEX IF NOT EXISTS trial_grants_document_idx ON trial_grants (document_hash)",
      );
      await postgres.query(
        "CREATE INDEX IF NOT EXISTS trial_grants_email_idx ON trial_grants (email_hash)",
      );
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }

  return schemaReady;
}

function hashValue(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  return crypto.createHmac("sha256", JWT_SECRET).update(normalized).digest("hex");
}

/** CPF do titular, CNPJ da empresa e e-mail do titular, em resumo. */
async function collectTrialIdentity(db, organizationId) {
  const result = await db.query(
    `
      SELECT o.cnpj, m.cpf, m.email
      FROM organizations o
      LEFT JOIN members m ON m.id = o.owner_member_id
      WHERE o.id = $1
    `,
    [organizationId],
  );

  const row = result.rows[0] || {};

  return {
    documentHashes: [hashValue(row.cnpj), hashValue(row.cpf)].filter(Boolean),
    emailHash: hashValue(row.email),
  };
}

/** Recusa o teste quando o mesmo CPF/CNPJ ou e-mail já usou antes. */
async function assertTrialAvailable(db, organizationId) {
  await ensureTrialSchema();
  const { documentHashes, emailHash } = await collectTrialIdentity(db, organizationId);

  if (documentHashes.length === 0 && !emailHash) {
    return;
  }

  const used = await db.query(
    `
      SELECT 1 FROM trial_grants
      WHERE (document_hash = ANY($1::text[]) AND document_hash IS NOT NULL)
         OR (email_hash = $2 AND email_hash IS NOT NULL)
      LIMIT 1
    `,
    [documentHashes, emailHash],
  );

  if (used.rows.length > 0) {
    const erro = new AccountError(
      409,
      "O teste grátis já foi usado com este CPF/CNPJ ou e-mail. Escolha um plano para continuar.",
      "trial",
    );
    erro.code = "TRIAL_UNAVAILABLE";
    throw erro;
  }
}

async function registerTrialGrant(db, organizationId) {
  await ensureTrialSchema();
  const { documentHashes, emailHash } = await collectTrialIdentity(db, organizationId);

  await db.query(
    `
      INSERT INTO trial_grants (document_hash, email_hash, organization_id)
      VALUES ($1, $2, $3)
    `,
    [documentHashes[0] || null, emailHash, organizationId],
  );
}

module.exports = {
  ensureTrialSchema,
  assertTrialAvailable,
  registerTrialGrant,
};
