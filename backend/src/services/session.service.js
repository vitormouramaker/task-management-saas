const crypto = require("crypto");
const { postgres } = require("../server/connect");
const { createId } = require("./tenancy.service");

// Tempo que um refresh token recém-trocado continua valendo, para não derrubar
// duas abas que renovam a sessão ao mesmo tempo.
const ROTATION_GRACE_MS = 60 * 1000;
// Cache do "válido a partir de" para não consultar o banco a cada requisição.
const VALID_FROM_CACHE_MS = 30 * 1000;

const validFromCache = new Map();
let schemaReady = null;

function ensureSessionSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      await postgres.query(`
        CREATE TABLE IF NOT EXISTS auth_sessions (
          id VARCHAR(100) PRIMARY KEY,
          member_id VARCHAR(100) NOT NULL REFERENCES members(id) ON DELETE CASCADE,
          organization_id VARCHAR(100),
          token_hash VARCHAR(64) NOT NULL UNIQUE,
          user_agent VARCHAR(255),
          ip VARCHAR(64),
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          last_used_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          expires_at TIMESTAMPTZ NOT NULL,
          revoked_at TIMESTAMPTZ,
          rotated BOOLEAN NOT NULL DEFAULT FALSE
        )
      `);
      await postgres.query(
        "CREATE INDEX IF NOT EXISTS auth_sessions_member_idx ON auth_sessions (member_id)",
      );
      await postgres.query(
        "CREATE INDEX IF NOT EXISTS auth_sessions_expires_idx ON auth_sessions (expires_at)",
      );
      await postgres.query(
        "ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS rotated BOOLEAN NOT NULL DEFAULT FALSE",
      );
      await postgres.query(
        "ALTER TABLE members ADD COLUMN IF NOT EXISTS tokens_valid_from TIMESTAMPTZ",
      );
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }

  return schemaReady;
}

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function describeDevice(req) {
  const userAgent = String(req?.headers?.["user-agent"] || "").slice(0, 255) || null;
  const forwarded = String(req?.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
  const ip = (forwarded || req?.ip || "").slice(0, 64) || null;
  return { userAgent, ip };
}

async function registerSession({ sessionId, memberId, organizationId, refreshToken, expiresAt, req }) {
  await ensureSessionSchema();
  const { userAgent, ip } = describeDevice(req);

  await postgres.query(
    `
      INSERT INTO auth_sessions (id, member_id, organization_id, token_hash, user_agent, ip, expires_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `,
    [sessionId, memberId, organizationId || null, hashToken(refreshToken), userAgent, ip, expiresAt],
  );
}

/**
 * Sessão utilizável = existe, não expirou e não foi revogada (ou foi há poucos
 * segundos, no caso de duas abas renovando juntas).
 */
async function findUsableSession(refreshToken) {
  await ensureSessionSchema();
  // Os horários vêm do banco já em segundos (epoch): assim a checagem não
  // depende do fuso do banco nem do fuso do processo.
  const result = await postgres.query(
    `
      SELECT *,
        FLOOR(EXTRACT(EPOCH FROM expires_at))::bigint AS expires_epoch,
        FLOOR(EXTRACT(EPOCH FROM revoked_at))::bigint AS revoked_epoch
      FROM auth_sessions
      WHERE token_hash = $1
    `,
    [hashToken(refreshToken)],
  );

  const session = result.rows[0];
  if (!session) {
    return { session: null, reason: "not_found" };
  }

  const nowEpoch = Math.floor(Date.now() / 1000);
  if (session.expires_epoch && Number(session.expires_epoch) <= nowEpoch) {
    return { session: null, reason: "expired" };
  }

  // Sessão trocada (rotação) ainda vale por alguns segundos, para não derrubar
  // duas abas renovando juntas. Sessão encerrada de propósito morre na hora.
  if (session.revoked_epoch) {
    const withinGrace =
      session.rotated &&
      Number(session.revoked_epoch) * 1000 + ROTATION_GRACE_MS > Date.now();
    if (!withinGrace) {
      return { session: null, reason: "revoked" };
    }
  }

  return { session, reason: null };
}

async function revokeSessionByToken(refreshToken, { rotated = false } = {}) {
  await ensureSessionSchema();
  const result = await postgres.query(
    `
      UPDATE auth_sessions SET revoked_at = CURRENT_TIMESTAMP, rotated = $2
      WHERE token_hash = $1 AND revoked_at IS NULL
      RETURNING id, member_id
    `,
    [hashToken(refreshToken), rotated],
  );
  return result.rows[0] || null;
}

async function touchSession(sessionId) {
  await postgres.query(
    "UPDATE auth_sessions SET last_used_at = CURRENT_TIMESTAMP WHERE id = $1",
    [sessionId],
  );
}

/**
 * Encerra as sessões da pessoa. Também marca a hora a partir da qual os tokens
 * de acesso já emitidos deixam de valer (é o "sair de todos os dispositivos").
 */
async function revokeAllSessions(memberId, { exceptSessionId = null, invalidateAccessTokens = true } = {}) {
  await ensureSessionSchema();
  const result = await postgres.query(
    `
      UPDATE auth_sessions SET revoked_at = CURRENT_TIMESTAMP
      WHERE member_id = $1 AND revoked_at IS NULL AND ($2::text IS NULL OR id <> $2::text)
      RETURNING id
    `,
    [memberId, exceptSessionId],
  );

  if (invalidateAccessTokens) {
    const updated = await postgres.query(
      `
        UPDATE members SET tokens_valid_from = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING FLOOR(EXTRACT(EPOCH FROM tokens_valid_from))::bigint AS epoch
      `,
      [memberId],
    );
    rememberValidFrom(memberId, Number(updated.rows[0]?.epoch) || Math.floor(Date.now() / 1000));
  }

  return result.rowCount;
}

async function listSessions(memberId) {
  await ensureSessionSchema();
  const result = await postgres.query(
    `
      SELECT id, organization_id AS "organizationId", user_agent AS "userAgent", ip,
             created_at AS "createdAt", last_used_at AS "lastUsedAt", expires_at AS "expiresAt"
      FROM auth_sessions
      WHERE member_id = $1 AND revoked_at IS NULL AND expires_at > CURRENT_TIMESTAMP
      ORDER BY last_used_at DESC
    `,
    [memberId],
  );
  return result.rows;
}

function rememberValidFrom(memberId, value) {
  validFromCache.set(memberId, { value: value || null, fetchedAt: Date.now() });
}

/**
 * Momento (em segundos) a partir do qual os tokens de acesso valem.
 * Usado pelo middleware de autenticação; cacheado por 30s por pessoa.
 */
async function getTokensValidFrom(memberId) {
  const cached = validFromCache.get(memberId);
  if (cached && Date.now() - cached.fetchedAt < VALID_FROM_CACHE_MS) {
    return cached.value;
  }

  const result = await postgres.query(
    "SELECT FLOOR(EXTRACT(EPOCH FROM tokens_valid_from))::bigint AS epoch FROM members WHERE id = $1",
    [memberId],
  );
  const value = result.rows[0]?.epoch ? Number(result.rows[0].epoch) : null;
  rememberValidFrom(memberId, value);
  return value;
}

/** Remove sessões vencidas/revogadas antigas (roda com o worker de storage). */
async function purgeExpiredSessions() {
  await ensureSessionSchema();
  const result = await postgres.query(`
    DELETE FROM auth_sessions
    WHERE expires_at < CURRENT_TIMESTAMP - INTERVAL '7 days'
       OR (revoked_at IS NOT NULL AND revoked_at < CURRENT_TIMESTAMP - INTERVAL '7 days')
  `);
  return result.rowCount;
}

/** Limpeza periódica das sessões vencidas (a cada 6 horas). */
function startSessionCleanupWorker() {
  const run = () =>
    purgeExpiredSessions().catch((error) =>
      console.error("[sessoes] falha na limpeza", error?.message || error),
    );
  run();
  const timer = setInterval(run, 6 * 60 * 60 * 1000);
  timer.unref?.();
  return timer;
}

function createSessionId() {
  return createId("sess");
}

module.exports = {
  ensureSessionSchema,
  createSessionId,
  registerSession,
  findUsableSession,
  revokeSessionByToken,
  revokeAllSessions,
  touchSession,
  listSessions,
  getTokensValidFrom,
  purgeExpiredSessions,
  startSessionCleanupWorker,
};
