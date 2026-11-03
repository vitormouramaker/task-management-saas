const crypto = require("crypto");
const { buildPlanEntitlements } = require("./billing.service");
const { ensureAccountSchema } = require("./account.service");

const ORGANIZATION_ACCOUNT_COLUMNS = `
  o.account_type as "accountType",
  o.cnpj_verification_status as "cnpjVerificationStatus",
  o.trial_ends_at as "trialEndsAt",
  o.trial_started_at as "trialStartedAt",
  o.onboarding_completed_at as "onboardingCompletedAt",
  o.extra_seats as "extraSeats",
  o.extra_storage_packs as "extraStoragePacks",
  o.billing_exempt as "billingExempt",
  o.custom_entitlements as "customEntitlements"
`;

function createId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function normalizeSlug(value) {
  const base = String(value || "empresa")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  return base || "empresa";
}

async function ensureTenancySchema(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS organizations (
      id VARCHAR(100) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      slug VARCHAR(100) UNIQUE,
      plan VARCHAR(50) NOT NULL DEFAULT 'free',
      subscription_status VARCHAR(50) NOT NULL DEFAULT 'free',
      stripe_customer_id VARCHAR(255),
      stripe_subscription_id VARCHAR(255),
      billing_interval VARCHAR(50),
      owner_member_id VARCHAR(100) REFERENCES members(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS organization_members (
      organization_id VARCHAR(100) REFERENCES organizations(id) ON DELETE CASCADE,
      member_id VARCHAR(100) REFERENCES members(id) ON DELETE CASCADE,
      role VARCHAR(50) NOT NULL DEFAULT 'member',
      status VARCHAR(50) NOT NULL DEFAULT 'active',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (organization_id, member_id)
    )
  `);

  await client.query(`
    ALTER TABLE members
    ADD COLUMN IF NOT EXISTS active_organization_id VARCHAR(100) REFERENCES organizations(id) ON DELETE SET NULL
  `);

  await client.query(`
    ALTER TABLE workspaces
    ADD COLUMN IF NOT EXISTS organization_id VARCHAR(100) REFERENCES organizations(id) ON DELETE CASCADE
  `);

  await client.query(`
    ALTER TABLE organizations
    ADD COLUMN IF NOT EXISTS billing_interval VARCHAR(50)
  `);

  await client.query(`
    ALTER TABLE tags
    ADD COLUMN IF NOT EXISTS organization_id VARCHAR(100) REFERENCES organizations(id) ON DELETE CASCADE
  `);
}

async function findOrganizationForMember(client, memberId) {
  const membershipResult = await client.query(
    `
      SELECT
        o.id,
        o.name,
        o.slug,
        o.plan,
        o.subscription_status as "subscriptionStatus",
        ${ORGANIZATION_ACCOUNT_COLUMNS},
        om.role as "organizationRole"
      FROM organization_members om
      INNER JOIN organizations o ON o.id = om.organization_id
      INNER JOIN members m ON m.id = om.member_id
      WHERE om.member_id = $1
        AND om.status = 'active'
      ORDER BY
        CASE WHEN o.id = m.active_organization_id THEN 0 ELSE 1 END,
        CASE om.role WHEN 'owner' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END,
        om.created_at ASC
      LIMIT 1
    `,
    [memberId],
  );

  if (membershipResult.rows[0]) {
    return membershipResult.rows[0];
  }

  const workspaceResult = await client.query(
    `
      SELECT DISTINCT
        o.id,
        o.name,
        o.slug,
        o.plan,
        o.subscription_status as "subscriptionStatus",
        ${ORGANIZATION_ACCOUNT_COLUMNS},
        -- Precisa estar na lista por causa do DISTINCT com ORDER BY.
        o.created_at
      FROM workspaces w
      INNER JOIN organizations o ON o.id = w.organization_id
      LEFT JOIN workspace_members wm ON wm.workspace_id = w.id
      WHERE w.organization_id IS NOT NULL
        AND (w.owner_id = $1 OR wm.member_id = $1)
      ORDER BY o.created_at ASC
      LIMIT 1
    `,
    [memberId],
  );

  if (!workspaceResult.rows[0]) {
    return null;
  }

  const organization = workspaceResult.rows[0];
  await client.query(
    `
      INSERT INTO organization_members (organization_id, member_id, role, status)
      VALUES ($1, $2, 'member', 'active')
      ON CONFLICT (organization_id, member_id) DO NOTHING
    `,
    [organization.id, memberId],
  );

  await client.query(
    "UPDATE members SET active_organization_id = $1 WHERE id = $2",
    [organization.id, memberId],
  );

  return { ...organization, organizationRole: "member" };
}

async function createOrganizationForMember(client, member, companyName) {
  const organizationId = createId("org");
  const organizationName = String(companyName || member.name || "Minha empresa")
    .trim()
    .slice(0, 255);
  const slug = `${normalizeSlug(organizationName)}-${crypto
    .randomBytes(3)
    .toString("hex")}`;

  const organizationResult = await client.query(
    `
      INSERT INTO organizations (
        id, name, slug, plan, subscription_status, owner_member_id
      )
      VALUES ($1, $2, $3, 'free', 'free', $4)
      RETURNING
        id,
        name,
        slug,
        plan,
        subscription_status as "subscriptionStatus",
        account_type as "accountType",
        cnpj_verification_status as "cnpjVerificationStatus",
        trial_ends_at as "trialEndsAt",
        onboarding_completed_at as "onboardingCompletedAt",
        extra_seats as "extraSeats",
        extra_storage_packs as "extraStoragePacks",
        billing_exempt as "billingExempt"
    `,
    [organizationId, organizationName, slug, member.id],
  );

  await client.query(
    `
      INSERT INTO organization_members (organization_id, member_id, role, status)
      VALUES ($1, $2, 'owner', 'active')
      ON CONFLICT (organization_id, member_id)
      DO UPDATE SET role = EXCLUDED.role, status = EXCLUDED.status
    `,
    [organizationId, member.id],
  );

  await client.query(
    "UPDATE members SET active_organization_id = $1 WHERE id = $2",
    [organizationId, member.id],
  );

  return {
    ...organizationResult.rows[0],
    organizationRole: "owner",
  };
}

async function getOrCreateOrganizationForMember(client, member) {
  await ensureTenancySchema(client);
  await ensureAccountSchema();

  const existingOrganization = await findOrganizationForMember(
    client,
    member.id,
  );

  if (existingOrganization) {
    return existingOrganization;
  }

  // Usuário sem nenhuma empresa (caso raro): recebe uma conta própria, que o
  // titular completa no próximo acesso. Não vincula dados sem empresa de
  // ninguém — veja src/server/audit_orphan_records.js.
  return createOrganizationForMember(client, member, member.name);
}

// Empresa específica do token (não a "principal" do membro).
async function getMemberOrganization(client, memberId, organizationId) {
  await ensureAccountSchema();
  const result = await client.query(
    `
      SELECT
        o.id,
        o.name,
        o.slug,
        o.plan,
        o.subscription_status as "subscriptionStatus",
        ${ORGANIZATION_ACCOUNT_COLUMNS},
        om.role as "organizationRole"
      FROM organization_members om
      INNER JOIN organizations o ON o.id = om.organization_id
      WHERE om.member_id = $1
        AND om.organization_id = $2
        AND om.status = 'active'
    `,
    [memberId, organizationId],
  );

  return result.rows[0] || null;
}

async function createInitialWorkspace(client, organizationId, ownerId) {
  const workspaceId = createId("ws");
  const spaceId = createId("space");

  await client.query(
    `
      INSERT INTO workspaces (
        id,
        organization_id,
        name,
        description,
        visibility,
        owner_id,
        default_permission_level,
        color
      )
      VALUES ($1, $2, 'Meu primeiro workspace', 'Workspace inicial da conta.', 'private', $3, 'Edição total', 'bg-blue-500')
    `,
    [workspaceId, organizationId, ownerId],
  );

  await client.query(
    "INSERT INTO spaces (id, workspace_id, name, icon) VALUES ($1, $2, 'Geral', $3)",
    [spaceId, workspaceId, "Home"],
  );

  await client.query(
    `
      INSERT INTO workspace_members (workspace_id, member_id, permission_level)
      VALUES ($1, $2, 'Edição total')
      ON CONFLICT (workspace_id, member_id) DO NOTHING
    `,
    [workspaceId, ownerId],
  );

  // Projeto de exemplo. Se falhar, a conta é criada do mesmo jeito.
  await client.query("SAVEPOINT projeto_exemplo");
  try {
    const { createSampleProject } = require("./onboarding.service");
    await createSampleProject(client, { workspaceId, spaceId, ownerId });
    await client.query("RELEASE SAVEPOINT projeto_exemplo");
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT projeto_exemplo");
    console.error("[onboarding] projeto de exemplo não criado", error?.message || error);
  }

  return { workspaceId, spaceId };
}

module.exports = {
  createId,
  ensureTenancySchema,
  getOrCreateOrganizationForMember,
  getMemberOrganization,
  createOrganizationForMember,
  createInitialWorkspace,
  buildPlanEntitlements,
};
