const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { postgres } = require("../server/connect");
const { sendResetPasswordEmail } = require("../server/email");
const { verifyToken } = require("../middlewares/auth.middleware");
const {
  createId,
  ensureTenancySchema,
  getOrCreateOrganizationForMember,
  getMemberOrganization,
  createOrganizationForMember,
  createInitialWorkspace,
} = require("../services/tenancy.service");
const {
  AccountError,
  applyAccountType,
  assertCpfAvailable,
  ensureAccountSchema,
  resolveCompanyData,
  sendAccountError,
  validateEmail,
  validatePassword,
  validatePersonData,
} = require("../services/account.service");
const {
  buildAuthUser,
  issueAuthTokens,
} = require("../services/auth-session.service");
const {
  findUsableSession,
  revokeSessionByToken,
  revokeAllSessions,
  getTokensValidFrom,
} = require("../services/session.service");
const {
  confirmEmailVerification,
  sendEmailVerification,
} = require("../services/email-verification.service");

const { recordAcceptance } = require("../services/legal.service");
const { JWT_SECRET, JWT_REFRESH_SECRET } = require("../config/jwt");

// O segredo do token de reset inclui o hash atual da senha: depois que a senha
// muda, qualquer link de redefinicao emitido antes deixa de funcionar.
function getResetTokenSecret(passwordHash) {
  return `${JWT_SECRET}.${passwordHash || ""}`;
}

async function ensureMemberTagSchema(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS member_tags (
      member_id VARCHAR(100) REFERENCES members(id) ON DELETE CASCADE,
      tag_id VARCHAR(100) REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (member_id, tag_id)
    )
  `);
}

// Cadastro de conta pessoal (dados do titular) ou empresarial (empresa + titular).
// Body: { accountType, name, email, password, cpf, phone, birthDate, company?: { cnpj, tradeName } }
/**
 * Ambientes fechados (homologacao) definem SIGNUP_ALLOWLIST com e-mails ou
 * dominios separados por virgula. Sem a variavel, o cadastro e aberto, como
 * em producao.
 */
function cadastroPermitido(email) {
  const lista = String(process.env.SIGNUP_ALLOWLIST || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  if (lista.length === 0) return true;

  const alvo = String(email || "").toLowerCase();
  const dominio = alvo.split("@")[1] || "";
  return lista.some((item) => (item.startsWith("@") ? dominio === item.slice(1) : alvo === item));
}

router.post("/signup", async (req, res) => {
  const body = req.body || {};
  let client = null;
  let transactionOpen = false;

  try {
    if (!["personal", "business"].includes(body.accountType)) {
      throw new AccountError(
        400,
        "Escolha o tipo de conta: pessoal ou empresarial.",
        "accountType",
      );
    }

    if (body.acceptedTerms !== true) {
      throw new AccountError(
        400,
        "É preciso aceitar os Termos de Uso e a Política de Privacidade para criar a conta.",
        "acceptedTerms",
      );
    }

    const email = validateEmail(body.email);

    if (!cadastroPermitido(email)) {
      throw new AccountError(
        403,
        "Este ambiente é restrito: o cadastro está liberado apenas para a equipe.",
        "email",
      );
    }
    const password = validatePassword(body.password);
    const person = validatePersonData(body);
    const isBusiness = body.accountType === "business";

    await ensureAccountSchema();
    client = await postgres.connect();
    await ensureMemberTagSchema(client);
    await ensureTenancySchema(client);

    const existingUser = await client.query(
      "SELECT id FROM members WHERE lower(email) = lower($1)",
      [email],
    );
    if (existingUser.rows.length > 0) {
      throw new AccountError(409, "Já existe uma conta com esse e-mail.", "email");
    }
    await assertCpfAvailable(client, person.cpf);

    const company = isBusiness
      ? await resolveCompanyData(client, body.company)
      : null;

    await client.query("BEGIN");
    transactionOpen = true;

    const passwordHash = await bcrypt.hash(password, 10);
    const memberResult = await client.query(
      `
        INSERT INTO members (id, name, email, role, password_hash, avatar_color, cpf, phone, birth_date)
        VALUES ($1, $2, $3, NULL, $4, 'bg-slate-600', $5, $6, $7)
        RETURNING *
      `,
      [
        createId("user"),
        person.name,
        email,
        passwordHash,
        person.cpf,
        person.phone,
        person.birthDate,
      ],
    );

    const member = memberResult.rows[0];
    // Comprovação do aceite: versão, data, IP e navegador.
    await recordAcceptance(member.id, { req, db: client });
    const organizationName = company ? company.organizationName : person.name;
    const createdOrganization = await createOrganizationForMember(
      client,
      member,
      organizationName,
    );
    await applyAccountType(client, createdOrganization.id, {
      accountType: body.accountType,
      name: organizationName,
      company,
    });
    await createInitialWorkspace(client, createdOrganization.id, member.id);

    await client.query("COMMIT");
    transactionOpen = false;
    sendEmailVerification(member);

    const organization = {
      ...createdOrganization,
      name: organizationName,
      accountType: body.accountType,
      cnpjVerificationStatus: company?.verificationStatus || null,
    };
    const authUser = await buildAuthUser(client, member, organization);
    const { token, refreshToken } = await issueAuthTokens(member, organization, { req });

    return res.status(201).json({
      message: "Conta criada com sucesso.",
      token,
      refreshToken,
      user: authUser,
    });
  } catch (error) {
    if (transactionOpen) {
      await client.query("ROLLBACK");
    }
    return sendAccountError(res, error, "Erro interno ao criar conta.");
  } finally {
    client?.release();
  }
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: "Email e senha sao obrigatorios." });
  }

  const client = await postgres.connect();

  try {
    await ensureMemberTagSchema(client);
    await ensureTenancySchema(client);
    const result = await client.query(
      "SELECT * FROM members WHERE lower(email) = lower($1)",
      [email],
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ message: "Credenciais invalidas." });
    }

    const user = result.rows[0];
    // Cadastro excluído (LGPD) fica sem senha e não pode mais entrar.
    if (!user.password_hash) {
      return res.status(401).json({ message: "Credenciais invalidas." });
    }
    const passwordMatch = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatch) {
      return res.status(401).json({ message: "Credenciais invalidas." });
    }

    const organization = await getOrCreateOrganizationForMember(client, user);
    const authUser = await buildAuthUser(client, user, organization);
    const { token, refreshToken } = await issueAuthTokens(user, organization, { req });

    res.json({
      message: "Login realizado com sucesso",
      token,
      refreshToken,
      user: authUser,
    });
  } catch (error) {
    console.error("Erro no login:", error);
    res.status(500).json({ message: "Erro interno no servidor." });
  } finally {
    client.release();
  }
});

router.post("/refresh", async (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(401).json({ message: "Refresh token nao fornecido." });
  }

  let payload;

  try {
    payload = jwt.verify(refreshToken, JWT_REFRESH_SECRET);
  } catch (error) {
    return res
      .status(401)
      .json({ message: "Refresh token invalido ou expirado." });
  }

  if (!payload || payload.type !== "refresh" || !payload.id) {
    return res.status(401).json({ message: "Refresh token invalido." });
  }

  // Sessão encerrada (logout, troca de senha, "sair de todos os dispositivos")
  // não renova mais. Tokens antigos, de antes do controle de sessão, não têm
  // "sid" e valem enquanto não forem invalidados pela data em tokens_valid_from.
  if (payload.sid) {
    const { session } = await findUsableSession(refreshToken);
    if (!session) {
      return res
        .status(401)
        .json({ message: "Sessão encerrada. Faça login novamente.", code: "SESSION_REVOKED" });
    }
  }

  const validFromEpoch = await getTokensValidFrom(payload.id);
  if (validFromEpoch && payload.iat && payload.iat < validFromEpoch) {
    return res
      .status(401)
      .json({ message: "Sessão encerrada. Faça login novamente.", code: "SESSION_REVOKED" });
  }

  const client = await postgres.connect();

  try {
    await ensureMemberTagSchema(client);
    await ensureTenancySchema(client);
    const result = await client.query("SELECT * FROM members WHERE id = $1", [
      payload.id,
    ]);

    if (result.rows.length === 0) {
      return res
        .status(401)
        .json({ message: "Usuario da sessao nao encontrado." });
    }

    const user = result.rows[0];
    // Mantém a conta que estava selecionada na sessão, se o acesso ainda existir.
    const organization =
      (payload.organizationId &&
        (await getMemberOrganization(client, user.id, payload.organizationId))) ||
      (await getOrCreateOrganizationForMember(client, user));
    const authUser = await buildAuthUser(client, user, organization);
    const tokens = await issueAuthTokens(user, organization, { req });
    // Um refresh token só serve uma vez: o antigo é encerrado depois da troca.
    await revokeSessionByToken(refreshToken, { rotated: true });

    return res.json({
      message: "Sessao renovada com sucesso.",
      ...tokens,
      user: authUser,
    });
  } catch (error) {
    console.error("Erro ao renovar sessao:", error);
    return res.status(500).json({ message: "Erro interno no servidor." });
  } finally {
    client.release();
  }
});

// Troca a conta ativa (pessoal ou empresa) da mesma pessoa e emite nova sessão.
router.post("/switch-organization", verifyToken, async (req, res) => {
  const organizationId = String(req.body?.organizationId || "");
  const client = await postgres.connect();

  try {
    const organization = organizationId
      ? await getMemberOrganization(client, req.user.id, organizationId)
      : null;
    if (!organization) {
      return res
        .status(404)
        .json({ message: "Conta não encontrada ou você não tem mais acesso a ela." });
    }

    await client.query(
      "UPDATE members SET active_organization_id = $1 WHERE id = $2",
      [organization.id, req.user.id],
    );
    const memberResult = await client.query("SELECT * FROM members WHERE id = $1", [
      req.user.id,
    ]);
    const member = memberResult.rows[0];

    res.json({
      message: "Conta alterada.",
      ...(await issueAuthTokens(member, organization, { req })),
      user: await buildAuthUser(client, member, organization),
    });
  } catch (error) {
    console.error("Erro ao trocar de conta:", error);
    res.status(500).json({ message: "Erro ao trocar de conta." });
  } finally {
    client.release();
  }
});

// Público: confirma o e-mail pelo link recebido.
router.post("/verify-email", async (req, res) => {
  try {
    await ensureAccountSchema();
    const result = await confirmEmailVerification(req.body?.token);
    res.json({
      message: result.alreadyVerified ? "Este e-mail já estava confirmado." : "E-mail confirmado.",
      verified: true,
    });
  } catch (error) {
    sendAccountError(res, error, "Erro ao confirmar o e-mail.");
  }
});

router.post("/resend-verification", verifyToken, async (req, res) => {
  try {
    await ensureAccountSchema();
    const result = await postgres.query(
      "SELECT id, name, email, email_verified_at FROM members WHERE id = $1",
      [req.user.id],
    );
    const member = result.rows[0];
    if (!member) {
      throw new AccountError(404, "Usuário não encontrado.");
    }
    if (member.email_verified_at) {
      return res.json({ message: "Seu e-mail já está confirmado.", alreadyVerified: true });
    }

    const emailSent = await sendEmailVerification(member);
    if (!emailSent) {
      throw new AccountError(502, "Não foi possível enviar o e-mail agora. Tente novamente em instantes.");
    }
    res.json({ message: `Enviamos um novo link para ${member.email}.` });
  } catch (error) {
    sendAccountError(res, error, "Erro ao reenviar a confirmação.");
  }
});

router.post("/forgot-password", async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ message: "Email e obrigatorio." });
  }

  try {
    const result = await postgres.query(
      "SELECT * FROM members WHERE lower(email) = lower($1)",
      [email],
    );
    if (result.rows.length === 0) {
      return res.json({
        message:
          "Se o e-mail existir em nossa base, instrucoes de recuperacao serao enviadas.",
      });
    }

    const user = result.rows[0];
    const resetToken = jwt.sign(
      { id: user.id, reset: true },
      getResetTokenSecret(user.password_hash),
      { expiresIn: "1h" },
    );

    const emailSent = await sendResetPasswordEmail(user.email, resetToken);

    if (emailSent) {
      res.json({
        message:
          "Se o e-mail existir em nossa base, instrucoes de recuperacao serao enviadas.",
      });
    } else {
      res
        .status(500)
        .json({
          message:
            "Erro ao tentar conectar ao servico de e-mail. Verifique as credenciais do servidor SMTP no arquivo .env.",
        });
    }
  } catch (error) {
    console.error("Erro na recuperacao de senha:", error);
    res
      .status(500)
      .json({
        message: "Erro interno no servidor ao tentar recuperar a senha.",
      });
  }
});

router.post("/reset-password", async (req, res) => {
  const { token, password } = req.body;

  if (!token || !password) {
    return res
      .status(400)
      .json({ message: "Token e nova senha sao obrigatorios." });
  }

  if (password.length < 8) {
    return res
      .status(400)
      .json({ message: "A nova senha deve ter pelo menos 8 caracteres." });
  }

  try {
    const decoded = jwt.decode(token);
    if (!decoded?.reset || !decoded?.id) {
      return res
        .status(400)
        .json({ message: "Token de redefinicao invalido." });
    }

    const memberResult = await postgres.query(
      "SELECT id, password_hash FROM members WHERE id = $1",
      [decoded.id],
    );

    if (memberResult.rows.length === 0) {
      return res
        .status(400)
        .json({ message: "O link de redefinicao e invalido ou expirou." });
    }

    const member = memberResult.rows[0];
    jwt.verify(token, getResetTokenSecret(member.password_hash));

    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);
    const result = await postgres.query(
      `
        UPDATE members
        SET password_hash = $1, updated_at = CURRENT_TIMESTAMP
        WHERE id = $2 AND password_hash = $3
        RETURNING id
      `,
      [passwordHash, member.id, member.password_hash],
    );

    if (result.rows.length === 0) {
      return res
        .status(400)
        .json({ message: "O link de redefinicao e invalido ou expirou." });
    }

    // Quem tinha uma sessão roubada perde o acesso junto com a senha antiga.
    await revokeAllSessions(member.id);

    res.json({ message: "Senha redefinida com sucesso." });
  } catch (error) {
    if (
      error instanceof jwt.JsonWebTokenError ||
      error instanceof jwt.TokenExpiredError
    ) {
      return res
        .status(400)
        .json({ message: "O link de redefinicao e invalido ou expirou." });
    }

    console.error("Erro ao redefinir senha:", error);
    res
      .status(500)
      .json({ message: "Erro interno no servidor ao redefinir a senha." });
  }
});


// Sair deste dispositivo: encerra a sessão do refresh token enviado.
router.post("/logout", async (req, res) => {
  const { refreshToken } = req.body || {};

  try {
    if (refreshToken) {
      await revokeSessionByToken(refreshToken);
    }
    return res.json({ message: "Sessão encerrada." });
  } catch (error) {
    console.error("Erro ao encerrar a sessão:", error);
    return res.status(500).json({ message: "Erro interno no servidor." });
  }
});

// Sair de todos os dispositivos: encerra todas as sessões e derruba os acessos
// já abertos (tokens emitidos antes de agora deixam de valer).
router.post("/logout-all", verifyToken, async (req, res) => {
  try {
    const revoked = await revokeAllSessions(req.user.id);
    return res.json({ message: "Todas as sessões foram encerradas.", revoked });
  } catch (error) {
    console.error("Erro ao encerrar as sessões:", error);
    return res.status(500).json({ message: "Erro interno no servidor." });
  }
});

module.exports = router;
