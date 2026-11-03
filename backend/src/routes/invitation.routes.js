const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const { postgres } = require("../server/connect");
const { verifyToken } = require("../middlewares/auth.middleware");
const { requireOrganizationAdmin } = require("../middlewares/organization-admin.middleware");
const { sendInvitationEmail } = require("../server/email");
const {
  AccountError,
  ensureAccountSchema,
  sendAccountError,
  validatePassword,
} = require("../services/account.service");
const { buildSessionResponse } = require("../services/auth-session.service");
const { createId } = require("../services/tenancy.service");
const {
  acceptInvitation,
  assertInvitationUsable,
  createOrRefreshInvitation,
  ensureInvitationSchema,
  listPendingInvitations,
  loadInvitationByToken,
  resendInvitation,
  revokeInvitation,
} = require("../services/invitation.service");

async function sendInvitation(req, invitation) {
  return sendInvitationEmail({
    to: invitation.email,
    organizationName: req.organizationAdmin.organizationName,
    inviterName: req.user.name,
    accessRole: invitation.accessRole,
    token: invitation.token,
  });
}

// ---------- administração (titular/administradores da conta ativa) ----------

router.get("/", verifyToken, requireOrganizationAdmin, async (req, res) => {
  try {
    res.json({ invitations: await listPendingInvitations(postgres, req.user.organizationId) });
  } catch (error) {
    sendAccountError(res, error, "Erro ao listar convites.");
  }
});

// Body: { email, accessRole: 'admin' | 'member', jobTitle?, tagIds? }
router.post("/", verifyToken, requireOrganizationAdmin, async (req, res) => {
  try {
    await ensureAccountSchema();
    const invitation = await createOrRefreshInvitation(postgres, {
      organizationId: req.user.organizationId,
      email: req.body?.email,
      accessRole: req.body?.accessRole,
      jobTitle: req.body?.jobTitle,
      tagIds: req.body?.tagIds,
      invitedBy: req.user.id,
    });
    const emailSent = await sendInvitation(req, invitation);

    res.status(201).json({
      message: emailSent
        ? `Convite enviado para ${invitation.email}.`
        : `Convite criado, mas o e-mail para ${invitation.email} não pôde ser enviado agora. Tente reenviar.`,
      emailSent,
      invitation: { id: invitation.id, email: invitation.email, accessRole: invitation.accessRole },
    });
  } catch (error) {
    sendAccountError(res, error, "Erro ao criar convite.");
  }
});

router.post("/:id/resend", verifyToken, requireOrganizationAdmin, async (req, res) => {
  try {
    const invitation = await resendInvitation(postgres, {
      organizationId: req.user.organizationId,
      invitationId: req.params.id,
      invitedBy: req.user.id,
    });
    const emailSent = await sendInvitation(req, invitation);
    res.json({
      message: emailSent
        ? `Convite reenviado para ${invitation.email}.`
        : "Não foi possível enviar o e-mail agora. Tente novamente em instantes.",
      emailSent,
    });
  } catch (error) {
    sendAccountError(res, error, "Erro ao reenviar convite.");
  }
});

router.delete("/:id", verifyToken, requireOrganizationAdmin, async (req, res) => {
  try {
    await revokeInvitation(postgres, {
      organizationId: req.user.organizationId,
      invitationId: req.params.id,
    });
    res.json({ message: "Convite cancelado." });
  } catch (error) {
    sendAccountError(res, error, "Erro ao cancelar convite.");
  }
});

// ---------- quem recebeu o convite ----------

// Público: dados para a página do convite.
router.get("/lookup", async (req, res) => {
  try {
    const invitation = await loadInvitationByToken(postgres, req.query.token);
    assertInvitationUsable(invitation);
    res.json({
      email: invitation.email,
      organizationName: invitation.organizationName,
      accountType: invitation.accountType,
      inviterName: invitation.inviterName,
      accessRole: invitation.accessRole,
      hasAccount: invitation.hasAccount,
    });
  } catch (error) {
    sendAccountError(res, error, "Erro ao consultar convite.");
  }
});

// Pessoa já cadastrada (logada com o e-mail do convite).
router.post("/accept", verifyToken, async (req, res) => {
  const client = await postgres.connect();
  let transactionOpen = false;

  try {
    await ensureAccountSchema();
    const invitation = await loadInvitationByToken(client, req.body?.token);
    assertInvitationUsable(invitation);

    const memberResult = await client.query("SELECT * FROM members WHERE id = $1", [req.user.id]);
    if (!memberResult.rows[0]) {
      throw new AccountError(404, "Usuário não encontrado.");
    }

    await client.query("BEGIN");
    transactionOpen = true;
    await acceptInvitation(client, invitation, memberResult.rows[0]);
    await client.query("COMMIT");
    transactionOpen = false;

    res.json(
      await buildSessionResponse(
        client,
        req.user.id,
        invitation.organizationId,
        `Você entrou em ${invitation.organizationName}.`,
      ),
    );
  } catch (error) {
    if (transactionOpen) {
      await client.query("ROLLBACK");
    }
    sendAccountError(res, error, "Erro ao aceitar convite.");
  } finally {
    client.release();
  }
});

// Público: pessoa sem cadastro cria o login ao aceitar. O e-mail já fica confirmado.
router.post("/accept-new", async (req, res) => {
  const client = await postgres.connect();
  let transactionOpen = false;

  try {
    await ensureAccountSchema();
    await ensureInvitationSchema();
    const invitation = await loadInvitationByToken(client, req.body?.token);
    assertInvitationUsable(invitation);
    if (invitation.hasAccount) {
      throw new AccountError(
        409,
        "Já existe uma conta com este e-mail. Entre com sua senha para aceitar o convite.",
      );
    }

    const name = String(req.body?.name || "").trim().replace(/\s+/g, " ");
    if (name.length < 3 || name.length > 255) {
      throw new AccountError(400, "Informe seu nome completo.", "name");
    }
    const password = validatePassword(req.body?.password);
    const passwordHash = await bcrypt.hash(password, 10);

    await client.query("BEGIN");
    transactionOpen = true;
    const memberResult = await client.query(
      `
        INSERT INTO members (id, name, email, role, password_hash, avatar_color, email_verified_at)
        VALUES ($1, $2, $3, $4, $5, 'bg-slate-600', CURRENT_TIMESTAMP)
        RETURNING *
      `,
      [createId("user"), name, invitation.email, invitation.jobTitle, passwordHash],
    );
    await acceptInvitation(client, invitation, memberResult.rows[0]);
    await client.query("COMMIT");
    transactionOpen = false;

    res.status(201).json(
      await buildSessionResponse(
        client,
        memberResult.rows[0].id,
        invitation.organizationId,
        `Bem-vindo(a) a ${invitation.organizationName}!`,
      ),
    );
  } catch (error) {
    if (transactionOpen) {
      await client.query("ROLLBACK");
    }
    sendAccountError(res, error, "Erro ao aceitar convite.");
  } finally {
    client.release();
  }
});

module.exports = router;
