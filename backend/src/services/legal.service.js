const { postgres } = require("../server/connect");

/**
 * Aceite dos documentos (Termos de Uso e Política de Privacidade).
 * Guardamos versão, data, IP e navegador: é o que comprova o aceite se um dia
 * for questionado, e é exigido pela LGPD para consentimento demonstrável.
 */
const LEGAL_VERSION = "2026-10-13";
const LEGAL_DOCUMENTS = ["terms", "privacy"];

let schemaReady = null;

function ensureLegalSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      await postgres.query(`
        CREATE TABLE IF NOT EXISTS legal_acceptances (
          id SERIAL PRIMARY KEY,
          member_id VARCHAR(100) NOT NULL REFERENCES members(id) ON DELETE CASCADE,
          document VARCHAR(30) NOT NULL,
          version VARCHAR(20) NOT NULL,
          accepted_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          ip VARCHAR(64),
          user_agent VARCHAR(255)
        )
      `);
      await postgres.query(
        "CREATE UNIQUE INDEX IF NOT EXISTS legal_acceptances_unique ON legal_acceptances (member_id, document, version)",
      );
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }

  return schemaReady;
}

function describeDevice(req) {
  const userAgent = String(req?.headers?.["user-agent"] || "").slice(0, 255) || null;
  const forwarded = String(req?.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
  const ip = (forwarded || req?.ip || "").slice(0, 64) || null;
  return { userAgent, ip };
}

/** Registra o aceite da versão atual dos documentos. */
async function recordAcceptance(memberId, { req = null, db = postgres } = {}) {
  await ensureLegalSchema();
  const { userAgent, ip } = describeDevice(req);

  for (const document of LEGAL_DOCUMENTS) {
    await db.query(
      `
        INSERT INTO legal_acceptances (member_id, document, version, ip, user_agent)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (member_id, document, version) DO NOTHING
      `,
      [memberId, document, LEGAL_VERSION, ip, userAgent],
    );
  }
}

/** A pessoa já aceitou a versão que está no ar? */
async function hasAcceptedCurrent(memberId, { db = postgres } = {}) {
  if (!memberId) {
    return false;
  }

  await ensureLegalSchema();
  const result = await db.query(
    `
      SELECT COUNT(DISTINCT document)::int AS total
      FROM legal_acceptances
      WHERE member_id = $1 AND version = $2 AND document = ANY($3::text[])
    `,
    [memberId, LEGAL_VERSION, LEGAL_DOCUMENTS],
  );

  return result.rows[0].total === LEGAL_DOCUMENTS.length;
}

/** Histórico de aceites da pessoa (entra na exportação de dados da LGPD). */
async function listAcceptances(memberId, { db = postgres } = {}) {
  await ensureLegalSchema();
  const result = await db.query(
    `
      SELECT document, version, accepted_at AS "acceptedAt", ip, user_agent AS "userAgent"
      FROM legal_acceptances
      WHERE member_id = $1
      ORDER BY accepted_at DESC
    `,
    [memberId],
  );

  return result.rows;
}

module.exports = {
  LEGAL_VERSION,
  LEGAL_DOCUMENTS,
  ensureLegalSchema,
  recordAcceptance,
  hasAcceptedCurrent,
  listAcceptances,
};
