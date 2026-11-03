const jwt = require("jsonwebtoken");
const {
  JWT_SECRET,
  JWT_REFRESH_SECRET,
  ACCESS_TOKEN_EXPIRES_IN,
  REFRESH_TOKEN_EXPIRES_IN,
} = require("../config/jwt");
const { resolveOrganizationBilling } = require("./billing.service");
const { createSessionId, registerSession } = require("./session.service");

async function getMemberTags(client, memberId) {
  const result = await client.query(
    `
      SELECT t.id, t.name, t.color
      FROM member_tags mt
      INNER JOIN tags t ON t.id = mt.tag_id
      WHERE mt.member_id = $1
      ORDER BY t.name ASC
    `,
    [memberId],
  );

  return result.rows;
}

/**
 * Cria os tokens da sessão e registra a sessão no banco, para que seja possível
 * encerrá-la depois ("sair" de verdade e "sair de todos os dispositivos").
 */
async function issueAuthTokens(user, organization, { req = null } = {}) {
  const sessionId = createSessionId();

  const token = jwt.sign(
    {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      organizationId: organization.id,
      organizationRole: organization.organizationRole,
      plan: organization.plan,
      emailVerified: isEmailVerified(user),
      sid: sessionId,
    },
    JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_EXPIRES_IN },
  );

  const refreshToken = jwt.sign(
    { id: user.id, organizationId: organization.id, type: "refresh", sid: sessionId },
    JWT_REFRESH_SECRET,
    { expiresIn: REFRESH_TOKEN_EXPIRES_IN },
  );

  const decoded = jwt.decode(refreshToken);
  await registerSession({
    sessionId,
    memberId: user.id,
    organizationId: organization.id,
    refreshToken,
    expiresAt: new Date(decoded.exp * 1000),
    req,
  });

  return { token, refreshToken, sessionId };
}

// Coluna ausente (undefined) conta como verificado; só NULL indica e-mail pendente.
function isEmailVerified(member) {
  return member?.email_verified_at !== null;
}

// Conta criada antes do cadastro com CPF/CNPJ: o titular precisa completar os dados.
function requiresAccountCompletion(member, organization) {
  return (
    organization?.organizationRole === "owner" &&
    (!organization.accountType || !member?.cpf)
  );
}

async function buildAuthUser(client, user, organization) {
  const { hasAcceptedCurrent } = require("./legal.service");
  const tags = await getMemberTags(client, user.id);
  const billing = resolveOrganizationBilling(organization);
  const aceitouDocumentos = await hasAcceptedCurrent(user.id, { db: client }).catch(() => true);

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    avatarColor: user.avatar_color,
    avatarUrl: user.avatar_url || null,
    tags,
    tagIds: tags.map((tag) => tag.id),
    emailVerified: isEmailVerified(user),
    // Já informou CPF, celular e nascimento: não precisa pedir de novo ao
    // criar uma conta empresarial.
    personalDataComplete: Boolean(user.cpf),
    isPlatformAdmin: Boolean(user.is_platform_admin),
    // Tour guiado do primeiro acesso ainda não visto.
    tourPending: user.tour_completed_at === null,
    // Documentos mudaram desde o último aceite: a tela pede confirmação.
    requiresLegalAcceptance: !aceitouDocumentos,
    requiresAccountCompletion: requiresAccountCompletion(user, organization),
    organization: {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      plan: billing.planId,
      contractedPlan: billing.contractedPlanId,
      subscriptionStatus: billing.status,
      onboardingPending: billing.onboardingPending,
      trialAvailable: billing.trialAvailable,
      trial: {
        active: billing.isTrial,
        daysLeft: billing.trialDaysLeft,
        endsAt: billing.trialEndsAt,
        expired: billing.trialExpired,
      },
      role: organization.organizationRole,
      accountType: organization.accountType || null,
      cnpjVerificationStatus: organization.cnpjVerificationStatus || null,
      entitlements: billing.entitlements,
    },
  };
}

// Nova sessão apontando para uma conta específica da pessoa.
async function buildSessionResponse(client, memberId, organizationId, message) {
  // Importado aqui para evitar dependência circular com tenancy/account.
  const { getMemberOrganization } = require("./tenancy.service");
  const memberResult = await client.query("SELECT * FROM members WHERE id = $1", [memberId]);
  const member = memberResult.rows[0];
  const organization = await getMemberOrganization(client, memberId, organizationId);

  return {
    message,
    ...(await issueAuthTokens(member, organization)),
    user: await buildAuthUser(client, member, organization),
  };
}

module.exports = {
  getMemberTags,
  issueAuthTokens,
  isEmailVerified,
  requiresAccountCompletion,
  buildAuthUser,
  buildSessionResponse,
};
