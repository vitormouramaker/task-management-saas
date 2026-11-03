const crypto = require("crypto");
const { postgres } = require("../server/connect");
const { resolveOrganizationBilling } = require("./billing.service");
const { AccountError, validateEmail } = require("./account.service");
const { createId } = require("./tenancy.service");
const { assertJobTitleAllowed } = require("./job-titles.service");

let schemaReady = null;

function ensureInvitationSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      await postgres.query(`
        CREATE TABLE IF NOT EXISTS organization_invitations (
          id VARCHAR(100) PRIMARY KEY,
          organization_id VARCHAR(100) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          email VARCHAR(255) NOT NULL,
          access_role VARCHAR(20) NOT NULL DEFAULT 'member',
          job_title VARCHAR(255),
          tag_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
          token_hash VARCHAR(64) NOT NULL UNIQUE,
          invited_by VARCHAR(100) REFERENCES members(id) ON DELETE SET NULL,
          status VARCHAR(20) NOT NULL DEFAULT 'pending',
          expires_at TIMESTAMP NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          accepted_at TIMESTAMP,
          accepted_member_id VARCHAR(100) REFERENCES members(id) ON DELETE SET NULL
        )
      `);
      await postgres.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS organization_invitations_pending_unique
        ON organization_invitations (organization_id, email)
        WHERE status = 'pending'
      `);
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

function normalizeAccessRole(value) {
  return value === "admin" ? "admin" : "member";
}

/** Membros ativos + convites pendentes contam para o limite de usuários do plano. */
async function assertSeatAvailable(db, organizationId, { excludeEmail = null } = {}) {
  const organization = await db.query(
    `
      SELECT plan, subscription_status, trial_ends_at, extra_seats,
             extra_storage_packs, billing_exempt, custom_entitlements
      FROM organizations WHERE id = $1
    `,
    [organizationId],
  );
  const { seats: maxUsers } = resolveOrganizationBilling(organization.rows[0]).entitlements;
  if (maxUsers === undefined || maxUsers === -1) {
    return;
  }

  const count = await db.query(
    `
      SELECT (
        (SELECT COUNT(*) FROM organization_members
         WHERE organization_id = $1 AND status = 'active')
        +
        (SELECT COUNT(*) FROM organization_invitations
         WHERE organization_id = $1
           AND status = 'pending'
           AND expires_at > NOW()
           AND ($2::text IS NULL OR email <> $2::text))
      )::int AS total
    `,
    [organizationId, excludeEmail],
  );

  if (count.rows[0].total >= maxUsers) {
    throw new AccountError(
      403,
      `Seu plano permite até ${maxUsers} usuários, contando convites pendentes. Faça upgrade para convidar mais pessoas.`,
    );
  }
}

async function createOrRefreshInvitation(
  db,
  { organizationId, email, accessRole, jobTitle, tagIds, invitedBy },
) {
  await ensureInvitationSchema();
  const normalizedEmail = validateEmail(email).toLowerCase();

  const existingMember = await db.query(
    `
      SELECT 1
      FROM organization_members om
      INNER JOIN members m ON m.id = om.member_id
      WHERE om.organization_id = $1 AND om.status = 'active' AND lower(m.email) = $2
    `,
    [organizationId, normalizedEmail],
  );
  if (existingMember.rows.length > 0) {
    throw new AccountError(409, "Esta pessoa já faz parte da conta.", "email");
  }

  await assertSeatAvailable(db, organizationId, { excludeEmail: normalizedEmail });

  const requestedTagIds = Array.isArray(tagIds) ? tagIds.map(String) : [];
  const validTagIds =
    requestedTagIds.length > 0
      ? (
          await db.query(
            "SELECT id FROM tags WHERE organization_id = $1 AND id = ANY($2::text[])",
            [organizationId, requestedTagIds],
          )
        ).rows.map((row) => row.id)
      : [];

  const token = crypto.randomBytes(32).toString("base64url");
  const normalizedRole = normalizeAccessRole(accessRole);
  const normalizedJobTitle = await assertJobTitleAllowed(organizationId, jobTitle);

  const pending = await db.query(
    "SELECT id FROM organization_invitations WHERE organization_id = $1 AND email = $2 AND status = 'pending'",
    [organizationId, normalizedEmail],
  );

  let invitationId = pending.rows[0]?.id;
  if (invitationId) {
    await db.query(
      `
        UPDATE organization_invitations
        SET access_role = $2, job_title = $3, tag_ids = $4::jsonb, token_hash = $5,
            invited_by = $6, expires_at = NOW() + INTERVAL '7 days', created_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `,
      [
        invitationId,
        normalizedRole,
        normalizedJobTitle,
        JSON.stringify(validTagIds),
        hashToken(token),
        invitedBy,
      ],
    );
  } else {
    invitationId = createId("invite");
    await db.query(
      `
        INSERT INTO organization_invitations
          (id, organization_id, email, access_role, job_title, tag_ids, token_hash, invited_by, expires_at)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, NOW() + INTERVAL '7 days')
      `,
      [
        invitationId,
        organizationId,
        normalizedEmail,
        normalizedRole,
        normalizedJobTitle,
        JSON.stringify(validTagIds),
        hashToken(token),
        invitedBy,
      ],
    );
  }

  return { id: invitationId, email: normalizedEmail, accessRole: normalizedRole, token };
}

async function resendInvitation(db, { organizationId, invitationId, invitedBy }) {
  await ensureInvitationSchema();
  const token = crypto.randomBytes(32).toString("base64url");
  const result = await db.query(
    `
      UPDATE organization_invitations
      SET token_hash = $3, invited_by = $4, expires_at = NOW() + INTERVAL '7 days'
      WHERE id = $1 AND organization_id = $2 AND status = 'pending'
      RETURNING email, access_role AS "accessRole"
    `,
    [invitationId, organizationId, hashToken(token), invitedBy],
  );

  if (!result.rows[0]) {
    throw new AccountError(404, "Convite não encontrado ou já utilizado.");
  }
  return { ...result.rows[0], token };
}

async function revokeInvitation(db, { organizationId, invitationId }) {
  await ensureInvitationSchema();
  const result = await db.query(
    `
      UPDATE organization_invitations SET status = 'revoked'
      WHERE id = $1 AND organization_id = $2 AND status = 'pending'
      RETURNING id
    `,
    [invitationId, organizationId],
  );
  if (!result.rows[0]) {
    throw new AccountError(404, "Convite não encontrado ou já utilizado.");
  }
}

async function listPendingInvitations(db, organizationId) {
  await ensureInvitationSchema();
  const result = await db.query(
    `
      SELECT
        i.id,
        i.email,
        i.access_role AS "accessRole",
        i.job_title AS "jobTitle",
        i.created_at AS "createdAt",
        i.expires_at AS "expiresAt",
        i.expires_at < NOW() AS expired,
        inviter.name AS "invitedByName"
      FROM organization_invitations i
      LEFT JOIN members inviter ON inviter.id = i.invited_by
      WHERE i.organization_id = $1 AND i.status = 'pending'
      ORDER BY i.created_at DESC
    `,
    [organizationId],
  );
  return result.rows;
}

async function loadInvitationByToken(db, token) {
  await ensureInvitationSchema();
  const result = await db.query(
    `
      SELECT
        i.id,
        i.organization_id AS "organizationId",
        i.email,
        i.access_role AS "accessRole",
        i.job_title AS "jobTitle",
        i.tag_ids AS "tagIds",
        i.status,
        i.expires_at < NOW() AS expired,
        o.name AS "organizationName",
        o.account_type AS "accountType",
        inviter.name AS "inviterName",
        EXISTS (SELECT 1 FROM members m WHERE lower(m.email) = i.email) AS "hasAccount"
      FROM organization_invitations i
      INNER JOIN organizations o ON o.id = i.organization_id
      LEFT JOIN members inviter ON inviter.id = i.invited_by
      WHERE i.token_hash = $1
    `,
    [hashToken(token)],
  );
  return result.rows[0] || null;
}

function assertInvitationUsable(invitation) {
  if (!invitation) {
    throw new AccountError(404, "Convite não encontrado. Confira o link recebido por e-mail.");
  }
  if (invitation.status === "accepted") {
    throw new AccountError(410, "Este convite já foi aceito.");
  }
  if (invitation.status !== "pending") {
    throw new AccountError(410, "Este convite foi cancelado. Peça um novo convite.");
  }
  if (invitation.expired) {
    throw new AccountError(410, "Este convite expirou. Peça um novo convite.");
  }
}

/** Adiciona a pessoa à conta do convite. Chamar dentro de transação. */
async function acceptInvitation(client, invitation, member) {
  if (String(member.email || "").toLowerCase() !== invitation.email) {
    throw new AccountError(
      403,
      `Este convite foi enviado para ${invitation.email}. Entre com esse e-mail para aceitar.`,
    );
  }

  const membership = await client.query(
    "SELECT status FROM organization_members WHERE organization_id = $1 AND member_id = $2",
    [invitation.organizationId, member.id],
  );
  if (membership.rows[0]?.status !== "active") {
    await assertSeatAvailable(client, invitation.organizationId, {
      excludeEmail: invitation.email,
    });
    await client.query(
      `
        INSERT INTO organization_members (organization_id, member_id, role, status)
        VALUES ($1, $2, $3, 'active')
        ON CONFLICT (organization_id, member_id)
        DO UPDATE SET role = EXCLUDED.role, status = 'active'
      `,
      [invitation.organizationId, member.id, invitation.accessRole],
    );
  }

  for (const tagId of Array.isArray(invitation.tagIds) ? invitation.tagIds : []) {
    await client.query(
      "INSERT INTO member_tags (member_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [member.id, tagId],
    );
  }

  if (invitation.jobTitle && !member.role) {
    await client.query("UPDATE members SET role = $2 WHERE id = $1", [
      member.id,
      invitation.jobTitle,
    ]);
  }

  await client.query(
    `
      UPDATE organization_invitations
      SET status = 'accepted', accepted_at = CURRENT_TIMESTAMP, accepted_member_id = $2
      WHERE id = $1
    `,
    [invitation.id, member.id],
  );
  await client.query("UPDATE members SET active_organization_id = $1 WHERE id = $2", [
    invitation.organizationId,
    member.id,
  ]);
}

module.exports = {
  ensureInvitationSchema,
  createOrRefreshInvitation,
  resendInvitation,
  revokeInvitation,
  listPendingInvitations,
  loadInvitationByToken,
  assertInvitationUsable,
  acceptInvitation,
};
