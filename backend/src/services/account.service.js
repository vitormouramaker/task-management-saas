const { postgres } = require("../server/connect");
const {
  isValidCnpj,
  isValidCpf,
  lookupCnpj,
  normalizeCnpj,
  onlyDigits,
} = require("./document.service");

const MIN_HOLDER_AGE = 18;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CNPJ_RECHECK_INTERVAL_MS = 30 * 60 * 1000;

class AccountError extends Error {
  constructor(status, message, field = null) {
    super(message);
    this.name = "AccountError";
    this.status = status;
    this.field = field;
  }
}

let schemaReady = null;

// Titular (CPF, celular, nascimento) fica em members; tipo de conta e CNPJ em organizations.
function ensureAccountSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const statements = [
        "ALTER TABLE members ADD COLUMN IF NOT EXISTS cpf VARCHAR(11)",
        "ALTER TABLE members ADD COLUMN IF NOT EXISTS avatar_url TEXT",
        "ALTER TABLE members ADD COLUMN IF NOT EXISTS phone VARCHAR(20)",
        "ALTER TABLE members ADD COLUMN IF NOT EXISTS phone VARCHAR(20)",
        "ALTER TABLE members ADD COLUMN IF NOT EXISTS birth_date DATE",
        "CREATE UNIQUE INDEX IF NOT EXISTS members_cpf_unique ON members (cpf) WHERE cpf IS NOT NULL",
        "ALTER TABLE organizations ADD COLUMN IF NOT EXISTS account_type VARCHAR(20)",
        "ALTER TABLE organizations ADD COLUMN IF NOT EXISTS cnpj VARCHAR(14)",
        "ALTER TABLE organizations ADD COLUMN IF NOT EXISTS legal_name VARCHAR(255)",
        "ALTER TABLE organizations ADD COLUMN IF NOT EXISTS cnpj_registration_status VARCHAR(60)",
        "ALTER TABLE organizations ADD COLUMN IF NOT EXISTS cnpj_verification_status VARCHAR(20)",
        "ALTER TABLE organizations ADD COLUMN IF NOT EXISTS cnpj_checked_at TIMESTAMP",
        "CREATE UNIQUE INDEX IF NOT EXISTS organizations_cnpj_unique ON organizations (cnpj) WHERE cnpj IS NOT NULL",
        // Ao criar a coluna, contas existentes ficam verificadas (DEFAULT preenche as
        // linhas atuais uma única vez); cadastros novos começam com NULL.
        "ALTER TABLE members ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
        "ALTER TABLE members ALTER COLUMN email_verified_at DROP DEFAULT",
      ];

      for (const statement of statements) {
        await postgres.query(statement);
      }
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }

  return schemaReady;
}

function validateEmail(email) {
  // Minúsculas: "Ana@x.com" e "ana@x.com" são a mesma pessoa.
  const normalized = String(email || "").trim().toLowerCase();
  if (!EMAIL_PATTERN.test(normalized) || normalized.length > 255) {
    throw new AccountError(400, "Informe um e-mail válido.", "email");
  }
  return normalized;
}

function validatePassword(password) {
  if (typeof password !== "string" || password.length < 8) {
    throw new AccountError(400, "A senha deve ter pelo menos 8 caracteres.", "password");
  }
  return password;
}

function parseBirthDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match) {
    throw new AccountError(400, "Informe a data de nascimento.", "birthDate");
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new AccountError(400, "Data de nascimento inválida.", "birthDate");
  }

  const today = new Date();
  let age = today.getUTCFullYear() - year;
  const birthdayNotReached =
    today.getUTCMonth() + 1 < month ||
    (today.getUTCMonth() + 1 === month && today.getUTCDate() < day);
  if (birthdayNotReached) {
    age -= 1;
  }

  if (age < MIN_HOLDER_AGE) {
    throw new AccountError(
      400,
      `O titular da conta precisa ter pelo menos ${MIN_HOLDER_AGE} anos.`,
      "birthDate",
    );
  }
  if (age > 120) {
    throw new AccountError(400, "Data de nascimento inválida.", "birthDate");
  }

  return `${match[1]}-${match[2]}-${match[3]}`;
}

function normalizePhone(value) {
  let digits = onlyDigits(value);
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) {
    digits = digits.slice(2);
  }
  if (digits.length !== 10 && digits.length !== 11) {
    throw new AccountError(400, "Informe um celular válido com DDD.", "phone");
  }
  return digits;
}

function validatePersonData({ name, cpf, phone, birthDate }) {
  const normalizedName = String(name || "").trim().replace(/\s+/g, " ");
  if (normalizedName.length < 3 || normalizedName.length > 255) {
    throw new AccountError(400, "Informe o nome completo.", "name");
  }

  const normalizedCpf = onlyDigits(cpf);
  if (!isValidCpf(normalizedCpf)) {
    throw new AccountError(400, "CPF inválido.", "cpf");
  }

  return {
    name: normalizedName,
    cpf: normalizedCpf,
    phone: normalizePhone(phone),
    birthDate: parseBirthDate(birthDate),
  };
}

async function assertCpfAvailable(db, cpf, exceptMemberId = null) {
  const result = await db.query(
    "SELECT id FROM members WHERE cpf = $1 AND ($2::text IS NULL OR id <> $2::text)",
    [cpf, exceptMemberId],
  );
  if (result.rows.length > 0) {
    throw new AccountError(
      409,
      "Já existe um cadastro com este CPF. Entre com o e-mail desse cadastro (ou use a opção de recuperar senha). Para recomeçar do zero, exclua o cadastro antigo em Configurações > Privacidade.",
      "cpf",
    );
  }
}

async function assertCnpjAvailable(db, cnpj, exceptOrganizationId = null) {
  const result = await db.query(
    "SELECT id FROM organizations WHERE cnpj = $1 AND ($2::text IS NULL OR id <> $2::text)",
    [cnpj, exceptOrganizationId],
  );
  if (result.rows.length > 0) {
    throw new AccountError(409, "Este CNPJ já possui uma conta no Pauta.", "cnpj");
  }
}

/**
 * Valida o CNPJ (dígitos, unicidade e situação na Receita) e define o nome da
 * empresa. Se a consulta estiver fora do ar, o CNPJ fica com verificação pendente.
 */
async function resolveCompanyData(db, company, exceptOrganizationId = null) {
  const cnpj = normalizeCnpj(company?.cnpj);
  if (!isValidCnpj(cnpj)) {
    throw new AccountError(400, "CNPJ inválido.", "cnpj");
  }

  await assertCnpjAvailable(db, cnpj, exceptOrganizationId);
  const lookup = await lookupCnpj(cnpj);

  if (lookup.status === "not_found") {
    throw new AccountError(400, "CNPJ não encontrado na Receita Federal.", "cnpj");
  }
  if (lookup.status === "inactive") {
    throw new AccountError(
      400,
      `Este CNPJ está com situação "${lookup.registrationStatus || "irregular"}" na Receita Federal. Só é possível cadastrar CNPJ ativo.`,
      "cnpj",
    );
  }

  const organizationName =
    String(company?.tradeName || "").trim().replace(/\s+/g, " ") ||
    lookup.tradeName ||
    lookup.legalName ||
    "";
  if (organizationName.length < 2) {
    throw new AccountError(400, "Informe o nome da empresa.", "tradeName");
  }

  return {
    cnpj,
    organizationName: organizationName.slice(0, 255),
    legalName: lookup.legalName,
    registrationStatus: lookup.registrationStatus,
    verificationStatus: lookup.status === "active" ? "verified" : "pending",
  };
}

async function applyPersonData(db, memberId, person) {
  await db.query(
    `
      UPDATE members
      SET name = $2, cpf = $3, phone = $4, birth_date = $5, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `,
    [memberId, person.name, person.cpf, person.phone, person.birthDate],
  );
}

async function applyAccountType(db, organizationId, { accountType, name, company }) {
  if (accountType === "business") {
    await db.query(
      `
        UPDATE organizations
        SET
          account_type = 'business',
          name = $2,
          cnpj = $3,
          legal_name = $4,
          cnpj_registration_status = $5,
          cnpj_verification_status = $6,
          cnpj_checked_at = CASE WHEN $7::boolean THEN CURRENT_TIMESTAMP ELSE NULL END,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `,
      [
        organizationId,
        company.organizationName,
        company.cnpj,
        company.legalName,
        company.registrationStatus,
        company.verificationStatus,
        company.verificationStatus === "verified",
      ],
    );
    return;
  }

  await db.query(
    `
      UPDATE organizations
      SET account_type = 'personal', name = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `,
    [organizationId, name],
  );
}

function translateAccountDbError(error) {
  if (error?.code !== "23505") {
    return error;
  }

  const constraint = String(error.constraint || "");
  if (constraint.includes("cpf")) {
    return new AccountError(
      409,
      "Já existe um cadastro com este CPF. Entre com o e-mail desse cadastro (ou use a opção de recuperar senha). Para recomeçar do zero, exclua o cadastro antigo em Configurações > Privacidade.",
      "cpf",
    );
  }
  if (constraint.includes("cnpj")) {
    return new AccountError(409, "Este CNPJ já possui uma conta no Pauta.", "cnpj");
  }
  if (constraint.includes("email")) {
    return new AccountError(409, "Já existe uma conta com esse e-mail.", "email");
  }
  return error;
}

function sendAccountError(res, error, fallbackMessage) {
  const translated = translateAccountDbError(error);
  if (translated instanceof AccountError) {
    return res.status(translated.status).json({
      message: translated.message,
      field: translated.field,
      ...(translated.code ? { code: translated.code } : {}),
    });
  }

  console.error(`[conta] ${fallbackMessage}`, error);
  return res.status(500).json({ message: fallbackMessage });
}

function maskCpf(cpf) {
  const digits = onlyDigits(cpf);
  if (digits.length !== 11) {
    return null;
  }
  return `***.${digits.slice(3, 6)}.${digits.slice(6, 9)}-**`;
}

async function verifyPendingCnpjs() {
  await ensureAccountSchema();
  const pending = await postgres.query(`
    SELECT id, cnpj
    FROM organizations
    WHERE cnpj IS NOT NULL
      AND cnpj_verification_status = 'pending'
      AND (cnpj_checked_at IS NULL OR cnpj_checked_at < NOW() - INTERVAL '30 minutes')
    ORDER BY cnpj_checked_at ASC NULLS FIRST
    LIMIT 20
  `);

  for (const organization of pending.rows) {
    const lookup = await lookupCnpj(organization.cnpj);

    if (lookup.status === "unavailable") {
      await postgres.query(
        "UPDATE organizations SET cnpj_checked_at = NOW() WHERE id = $1",
        [organization.id],
      );
      continue;
    }

    await postgres.query(
      `
        UPDATE organizations
        SET
          cnpj_verification_status = $2,
          cnpj_registration_status = $3,
          legal_name = COALESCE($4, legal_name),
          cnpj_checked_at = NOW()
        WHERE id = $1
      `,
      [
        organization.id,
        lookup.status === "active" ? "verified" : "invalid",
        lookup.registrationStatus,
        lookup.legalName,
      ],
    );
  }
}

let verificationTimer = null;

function startCnpjVerificationWorker() {
  if (verificationTimer) {
    return;
  }

  const run = () =>
    verifyPendingCnpjs().catch((error) =>
      console.error("[conta] falha ao reverificar CNPJs pendentes", error?.message || error),
    );

  run();
  verificationTimer = setInterval(run, CNPJ_RECHECK_INTERVAL_MS);
  verificationTimer.unref?.();
}

module.exports = {
  AccountError,
  ensureAccountSchema,
  validateEmail,
  validatePassword,
  validatePersonData,
  assertCpfAvailable,
  resolveCompanyData,
  applyPersonData,
  applyAccountType,
  sendAccountError,
  maskCpf,
  verifyPendingCnpjs,
  startCnpjVerificationWorker,
};
