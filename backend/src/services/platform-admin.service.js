const { postgres } = require("../server/connect");

/**
 * Administração da plataforma (equipe do Pauta, não o dono de uma conta).
 * Quem tem members.is_platform_admin = TRUE acessa o painel de super-admin.
 */
// E-mails que viram super-administradores na inicialização (separados por vírgula).
const PLATFORM_ADMIN_EMAILS = String(process.env.PLATFORM_ADMIN_EMAILS || "")
  .split(",")
  .map((email) => email.trim())
  .filter(Boolean);
const REQUEST_STATUSES = ["nova", "em_contato", "proposta_enviada", "fechada", "recusada"];

let schemaReady = null;

function ensurePlatformAdminSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      await postgres.query(
        "ALTER TABLE members ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN NOT NULL DEFAULT FALSE",
      );
      // Limites negociados em contrato (Enterprise), por cima dos limites do plano.
      await postgres.query(
        "ALTER TABLE organizations ADD COLUMN IF NOT EXISTS custom_entitlements JSONB",
      );
      await postgres.query(
        "ALTER TABLE organizations ADD COLUMN IF NOT EXISTS admin_notes TEXT",
      );
      await postgres.query(`
        CREATE TABLE IF NOT EXISTS enterprise_requests (
          id VARCHAR(100) PRIMARY KEY,
          organization_id VARCHAR(100) REFERENCES organizations(id) ON DELETE SET NULL,
          member_id VARCHAR(100) REFERENCES members(id) ON DELETE SET NULL,
          contact_name VARCHAR(255),
          contact_email VARCHAR(255),
          contact_phone VARCHAR(40),
          company_name VARCHAR(255),
          team_size VARCHAR(40),
          seats_needed INTEGER,
          storage_needed_gb INTEGER,
          reason TEXT NOT NULL,
          status VARCHAR(30) NOT NULL DEFAULT 'nova',
          admin_notes TEXT,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await postgres.query(
        "CREATE INDEX IF NOT EXISTS enterprise_requests_status_idx ON enterprise_requests (status, created_at DESC)",
      );
      // Por que as pessoas cancelam: respondido na hora do cancelamento.
      await postgres.query(`
        CREATE TABLE IF NOT EXISTS cancellation_surveys (
          id VARCHAR(100) PRIMARY KEY,
          organization_id VARCHAR(100),
          member_id VARCHAR(100),
          plan VARCHAR(40),
          reason VARCHAR(60) NOT NULL,
          comment TEXT,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        )
      `);
      // Tudo que a equipe altera pelo painel fica registrado.
      await postgres.query(`
        CREATE TABLE IF NOT EXISTS admin_audit_log (
          id VARCHAR(100) PRIMARY KEY,
          admin_member_id VARCHAR(100),
          admin_email VARCHAR(255),
          organization_id VARCHAR(100),
          target_type VARCHAR(40) NOT NULL,
          target_id VARCHAR(100),
          changes JSONB NOT NULL DEFAULT '{}'::jsonb,
          ip VARCHAR(80),
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await postgres.query(
        "CREATE INDEX IF NOT EXISTS admin_audit_log_org_idx ON admin_audit_log (organization_id, created_at DESC)",
      );
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }

  return schemaReady;
}

const adminCache = new Map();
const ADMIN_CACHE_MS = 30 * 1000;

async function isPlatformAdmin(memberId) {
  if (!memberId) return false;

  const cached = adminCache.get(memberId);
  if (cached && Date.now() - cached.at < ADMIN_CACHE_MS) {
    return cached.value;
  }

  await ensurePlatformAdminSchema();
  const result = await postgres.query(
    "SELECT is_platform_admin FROM members WHERE id = $1",
    [memberId],
  );
  const value = Boolean(result.rows[0]?.is_platform_admin);
  adminCache.set(memberId, { value, at: Date.now() });
  return value;
}

/** Registra uma alteração feita pelo painel (quem, onde, o quê e de qual IP). */
async function recordAdminAction(req, { organizationId = null, targetType, targetId = null, changes = {} }) {
  try {
    await ensurePlatformAdminSchema();
    await postgres.query(
      `
        INSERT INTO admin_audit_log
          (id, admin_member_id, admin_email, organization_id, target_type, target_id, changes, ip)
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
      `,
      [
        `adm_${require("crypto").randomBytes(8).toString("hex")}`,
        req.user?.id || null,
        req.user?.email || null,
        organizationId,
        targetType,
        targetId,
        JSON.stringify(changes),
        String(req.ip || "").slice(0, 80) || null,
      ],
    );
  } catch (error) {
    console.error("[super-admin] falha ao registrar auditoria", error?.message || error);
  }
}

/** IPs liberados para o painel (vazio = qualquer IP). Ex.: "200.1.2.3,200.1.2.4". */
function getAllowedAdminIps() {
  return String(process.env.PLATFORM_ADMIN_ALLOWED_IPS || "")
    .split(",")
    .map((ip) => ip.trim())
    .filter(Boolean);
}

module.exports = {
  PLATFORM_ADMIN_EMAILS,
  getAllowedAdminIps,
  recordAdminAction,
  REQUEST_STATUSES,
  ensurePlatformAdminSchema,
  isPlatformAdmin,
};
