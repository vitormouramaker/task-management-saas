const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const { postgres } = require("../server/connect");
const { verifyToken } = require("../middlewares/auth.middleware");
const {
  isValidCnpj,
  lookupCnpj,
  normalizeCnpj,
} = require("../services/document.service");
const {
  AccountError,
  applyAccountType,
  applyPersonData,
  assertCpfAvailable,
  ensureAccountSchema,
  maskCpf,
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
  createId,
  createInitialWorkspace,
  createOrganizationForMember,
  getMemberOrganization,
} = require("../services/tenancy.service");
const {
  ensureStorageSchema,
  getOrganizationStorageUsageBytes,
  releaseStorageUrls,
  requestStorageReconcile,
  syncStorageFolderName,
} = require("../services/storage.service");
const { ensureInvitationSchema } = require("../services/invitation.service");
const { resolveOrganizationBilling } = require("../services/billing.service");
const { publishRealtimeEvent } = require("../services/realtime.service");
const { listAcceptances } = require("../services/legal.service");
const { listSessions, revokeAllSessions } = require("../services/session.service");
const { sendEmailVerification } = require("../services/email-verification.service");

const MB = 1024 * 1024;

async function loadAccountContext(db, req) {
  await ensureAccountSchema();
  const organizationId = req.user?.organizationId;
  if (!organizationId) {
    throw new AccountError(403, "Conta sem empresa ativa. Faça login novamente.");
  }

  const result = await db.query(
    `
      SELECT
        o.id,
        o.name,
        o.account_type AS "accountType",
        o.cnpj,
        o.legal_name AS "legalName",
        o.cnpj_registration_status AS "registrationStatus",
        o.cnpj_verification_status AS "verificationStatus",
        om.role AS "organizationRole",
        m.name AS "memberName",
        m.role AS "memberRole",
        m.cpf,
        m.phone,
        to_char(m.birth_date, 'YYYY-MM-DD') AS "birthDate"
      FROM organizations o
      INNER JOIN organization_members om
        ON om.organization_id = o.id
       AND om.member_id = $2
       AND om.status = 'active'
      INNER JOIN members m ON m.id = om.member_id
      WHERE o.id = $1
    `,
    [organizationId, req.user.id],
  );

  const row = result.rows[0];
  if (!row) {
    throw new AccountError(404, "Conta não encontrada.");
  }

  const isOwner = row.organizationRole === "owner";
  return {
    ...row,
    isOwner,
    canManageOrganization: isOwner || row.organizationRole === "admin",
  };
}

async function loadMember(db, memberId) {
  const result = await db.query("SELECT * FROM members WHERE id = $1", [memberId]);
  if (!result.rows[0]) {
    throw new AccountError(404, "Usuário não encontrado.");
  }
  return result.rows[0];
}

async function buildSessionUser(client, req) {
  const member = await loadMember(client, req.user.id);
  const organization = await getMemberOrganization(
    client,
    req.user.id,
    req.user.organizationId,
  );
  return buildAuthUser(client, member, organization);
}

// Nova sessão já apontando para a conta recém-criada ou selecionada.
async function buildSessionResponse(client, memberId, organizationId, message) {
  const member = await loadMember(client, memberId);
  const organization = await getMemberOrganization(client, memberId, organizationId);
  return {
    message,
    ...(await issueAuthTokens(member, organization)),
    user: await buildAuthUser(client, member, organization),
  };
}

/**
 * Pessoa que ainda não tem dados de titular (ex.: convidada para uma empresa)
 * informa CPF, celular e nascimento uma única vez. Validar antes do BEGIN.
 */
async function resolveHolderData(client, member, body) {
  if (member.cpf) {
    return null;
  }

  const person = validatePersonData(body?.person || {});
  await assertCpfAvailable(client, person.cpf, member.id);
  return person;
}

// Público (usado no cadastro): valida, confere se já existe conta e consulta a Receita.
router.get("/cnpj/:cnpj", async (req, res) => {
  try {
    const cnpj = normalizeCnpj(req.params.cnpj);
    if (!isValidCnpj(cnpj)) {
      throw new AccountError(400, "CNPJ inválido.", "cnpj");
    }
    await ensureAccountSchema();

    const existing = await postgres.query(
      "SELECT 1 FROM organizations WHERE cnpj = $1",
      [cnpj],
    );
    if (existing.rows.length > 0) {
      throw new AccountError(409, "Este CNPJ já possui uma conta no Pauta.", "cnpj");
    }

    res.json({ cnpj, ...(await lookupCnpj(cnpj)) });
  } catch (error) {
    sendAccountError(res, error, "Erro ao consultar CNPJ.");
  }
});

router.get("/", verifyToken, async (req, res) => {
  try {
    const account = await loadAccountContext(postgres, req);

    res.json({
      accountType: account.accountType,
      isOwner: account.isOwner,
      canManageOrganization: account.canManageOrganization,
      requiresAccountCompletion:
        account.isOwner && (!account.accountType || !account.cpf),
      organization: {
        id: account.id,
        name: account.name,
        cnpj: account.accountType === "business" ? account.cnpj : null,
        legalName: account.legalName,
        registrationStatus: account.registrationStatus,
        verificationStatus: account.verificationStatus,
      },
      // Dados pessoais do titular só para o próprio titular.
      holder: account.isOwner
        ? {
            name: account.memberName,
            cpf: maskCpf(account.cpf),
            phone: account.phone,
            birthDate: account.birthDate,
          }
        : null,
    });
  } catch (error) {
    sendAccountError(res, error, "Erro ao carregar dados da conta.");
  }
});

// Contas da pessoa logada (espaço pessoal, empresas próprias e empresas em que é membro).
router.get("/list", verifyToken, async (req, res) => {
  try {
    await ensureAccountSchema();
    const member = await loadMember(postgres, req.user.id);
    const result = await postgres.query(
      `
        SELECT
          o.id,
          o.name,
          o.account_type AS "accountType",
          o.plan,
          om.role
        FROM organization_members om
        INNER JOIN organizations o ON o.id = om.organization_id
        WHERE om.member_id = $1 AND om.status = 'active'
        ORDER BY
          CASE o.account_type WHEN 'personal' THEN 0 ELSE 1 END,
          o.name ASC
      `,
      [req.user.id],
    );

    const accounts = result.rows.map((row) => ({
      ...row,
      isActive: row.id === req.user.organizationId,
    }));

    res.json({
      accounts,
      person: { name: member.name, hasHolderData: Boolean(member.cpf) },
      canCreatePersonal: !accounts.some(
        (account) => account.accountType === "personal" && account.role === "owner",
      ),
    });
  } catch (error) {
    sendAccountError(res, error, "Erro ao listar as contas.");
  }
});

// Contas criadas antes do cadastro com CPF/CNPJ: o titular completa os dados.
router.post("/complete", verifyToken, async (req, res) => {
  const { accountType, company } = req.body || {};
  const client = await postgres.connect();
  let transactionOpen = false;

  try {
    const account = await loadAccountContext(client, req);
    if (!account.isOwner) {
      throw new AccountError(403, "Somente o titular da conta pode informar estes dados.");
    }
    if (account.accountType && account.cpf) {
      throw new AccountError(400, "Os dados desta conta já foram informados.");
    }
    if (!["personal", "business"].includes(accountType)) {
      throw new AccountError(
        400,
        "Escolha o tipo de conta: pessoal ou empresarial.",
        "accountType",
      );
    }

    const person = validatePersonData(req.body || {});
    if (account.cpf && account.cpf !== person.cpf) {
      throw new AccountError(400, "O CPF do titular já foi informado anteriormente.", "cpf");
    }
    await assertCpfAvailable(client, person.cpf, req.user.id);

    const companyData =
      accountType === "business"
        ? await resolveCompanyData(client, company, account.id)
        : null;

    await client.query("BEGIN");
    transactionOpen = true;
    await applyPersonData(client, req.user.id, person);
    // Conta pessoal mantém o nome atual: nada do que já existe é renomeado.
    await applyAccountType(client, account.id, {
      accountType,
      name: account.name,
      company: companyData,
    });
    await client.query("COMMIT");
    transactionOpen = false;

    syncStorageFolderName("organizations", account.id);
    res.json({
      message: "Dados da conta salvos.",
      user: await buildSessionUser(client, req),
    });
  } catch (error) {
    if (transactionOpen) {
      await client.query("ROLLBACK");
    }
    sendAccountError(res, error, "Erro ao salvar os dados da conta.");
  } finally {
    client.release();
  }
});

// Cria o espaço pessoal da pessoa logada (apenas um por pessoa).
router.post("/personal", verifyToken, async (req, res) => {
  const client = await postgres.connect();
  let transactionOpen = false;

  try {
    await ensureAccountSchema();
    const member = await loadMember(client, req.user.id);

    const existing = await client.query(
      `
        SELECT 1
        FROM organizations o
        INNER JOIN organization_members om
          ON om.organization_id = o.id
         AND om.member_id = $1
         AND om.role = 'owner'
        WHERE o.account_type = 'personal'
        LIMIT 1
      `,
      [member.id],
    );
    if (existing.rows.length > 0) {
      throw new AccountError(409, "Você já tem um espaço pessoal.");
    }

    const person = await resolveHolderData(client, member, req.body);
    const organizationName = person?.name || member.name;

    await client.query("BEGIN");
    transactionOpen = true;
    if (person) {
      await applyPersonData(client, member.id, person);
    }
    const organization = await createOrganizationForMember(
      client,
      { ...member, name: organizationName },
      organizationName,
    );
    await applyAccountType(client, organization.id, {
      accountType: "personal",
      name: organizationName,
    });
    await createInitialWorkspace(client, organization.id, member.id);
    await client.query("COMMIT");
    transactionOpen = false;

    res.status(201).json(
      await buildSessionResponse(client, member.id, organization.id, "Espaço pessoal criado."),
    );
  } catch (error) {
    if (transactionOpen) {
      await client.query("ROLLBACK");
    }
    sendAccountError(res, error, "Erro ao criar o espaço pessoal.");
  } finally {
    client.release();
  }
});

// Cria uma empresa para a pessoa logada, mantendo as contas que ela já tem.
router.post("/business", verifyToken, async (req, res) => {
  const client = await postgres.connect();
  let transactionOpen = false;

  try {
    await ensureAccountSchema();
    const member = await loadMember(client, req.user.id);
    const person = await resolveHolderData(client, member, req.body);
    const company = await resolveCompanyData(client, req.body?.company);

    await client.query("BEGIN");
    transactionOpen = true;
    if (person) {
      await applyPersonData(client, member.id, person);
    }
    const organization = await createOrganizationForMember(
      client,
      member,
      company.organizationName,
    );
    await applyAccountType(client, organization.id, {
      accountType: "business",
      name: company.organizationName,
      company,
    });
    await createInitialWorkspace(client, organization.id, member.id);
    await client.query("COMMIT");
    transactionOpen = false;

    res.status(201).json(
      await buildSessionResponse(client, member.id, organization.id, "Conta empresarial criada."),
    );
  } catch (error) {
    if (transactionOpen) {
      await client.query("ROLLBACK");
    }
    sendAccountError(res, error, "Erro ao criar a conta empresarial.");
  } finally {
    client.release();
  }
});

router.put("/organization", verifyToken, async (req, res) => {
  const client = await postgres.connect();

  try {
    const account = await loadAccountContext(client, req);
    if (!account.canManageOrganization) {
      throw new AccountError(403, "Apenas administradores podem alterar o nome da conta.");
    }

    const name = String(req.body?.name || "").trim().replace(/\s+/g, " ");
    if (name.length < 2 || name.length > 120) {
      throw new AccountError(400, "O nome deve ter entre 2 e 120 caracteres.", "name");
    }

    await client.query(
      "UPDATE organizations SET name = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1",
      [account.id, name],
    );

    syncStorageFolderName("organizations", account.id);
    res.json({
      message: "Nome atualizado.",
      user: await buildSessionUser(client, req),
    });
  } catch (error) {
    sendAccountError(res, error, "Erro ao atualizar o nome da conta.");
  } finally {
    client.release();
  }
});

// Etiquetas são por conta: as usadas no workspace são recriadas (ou reaproveitadas
// pelo nome) na conta de destino e os vínculos do workspace passam a apontar para elas.
async function remapWorkspaceTags(client, workspaceId, targetOrganizationId) {
  const usedTags = await client.query(
    `
      SELECT t.id, t.name, t.color, t.organization_id AS "organizationId"
      FROM tags t
      WHERE t.id IN (
        SELECT tt.tag_id
        FROM task_tags tt
        INNER JOIN tasks tk ON tk.id = tt.task_id
        WHERE tk.workspace_id = $1
        UNION
        SELECT lt.tag_id
        FROM list_tags lt
        INNER JOIN lists l ON l.id = lt.list_id
        INNER JOIN folders f ON f.id = l.folder_id
        INNER JOIN spaces s ON s.id = f.space_id
        WHERE s.workspace_id = $1
        UNION
        SELECT wt.tag_id FROM workspace_tags wt WHERE wt.workspace_id = $1
      )
    `,
    [workspaceId],
  );

  for (const tag of usedTags.rows) {
    if (tag.organizationId === targetOrganizationId) {
      continue;
    }

    const existing = await client.query(
      "SELECT id FROM tags WHERE organization_id = $1 AND lower(name) = lower($2) LIMIT 1",
      [targetOrganizationId, tag.name],
    );
    let targetTagId = existing.rows[0]?.id;
    if (!targetTagId) {
      targetTagId = createId("tag");
      await client.query(
        "INSERT INTO tags (id, name, color, organization_id) VALUES ($1, $2, $3, $4)",
        [targetTagId, tag.name, tag.color, targetOrganizationId],
      );
    }

    await client.query(
      `
        UPDATE task_tags SET tag_id = $2
        WHERE tag_id = $1 AND task_id IN (SELECT id FROM tasks WHERE workspace_id = $3)
      `,
      [tag.id, targetTagId, workspaceId],
    );
    await client.query(
      `
        UPDATE list_tags SET tag_id = $2
        WHERE tag_id = $1 AND list_id IN (
          SELECT l.id
          FROM lists l
          INNER JOIN folders f ON f.id = l.folder_id
          INNER JOIN spaces s ON s.id = f.space_id
          WHERE s.workspace_id = $3
        )
      `,
      [tag.id, targetTagId, workspaceId],
    );
    await client.query(
      "UPDATE workspace_tags SET tag_id = $2 WHERE tag_id = $1 AND workspace_id = $3",
      [tag.id, targetTagId, workspaceId],
    );
  }
}

// Move um workspace do espaço pessoal para uma empresa em que a pessoa é dona ou admin.
router.post("/workspaces/:workspaceId/move", verifyToken, async (req, res) => {
  const workspaceId = req.params.workspaceId;
  const targetOrganizationId = String(req.body?.targetOrganizationId || "");
  const client = await postgres.connect();
  let transactionOpen = false;

  try {
    await ensureAccountSchema();
    await ensureStorageSchema();
    const sourceOrganizationId = req.user.organizationId;

    const workspaceResult = await client.query(
      `
        SELECT
          w.id,
          w.name,
          w.organization_id AS "organizationId",
          o.account_type AS "accountType",
          om.role
        FROM workspaces w
        INNER JOIN organizations o ON o.id = w.organization_id
        LEFT JOIN organization_members om
          ON om.organization_id = o.id
         AND om.member_id = $2
         AND om.status = 'active'
        WHERE w.id = $1 AND w.deleted_at IS NULL
      `,
      [workspaceId, req.user.id],
    );
    const workspace = workspaceResult.rows[0];

    if (!workspace || workspace.organizationId !== sourceOrganizationId) {
      throw new AccountError(404, "Workspace não encontrado nesta conta.");
    }
    if (workspace.role !== "owner") {
      throw new AccountError(403, "Somente o titular da conta pode mover workspaces.");
    }
    if (workspace.accountType !== "personal") {
      throw new AccountError(
        400,
        "Por enquanto só é possível mover workspaces do espaço pessoal para uma empresa.",
      );
    }
    if (!targetOrganizationId || targetOrganizationId === sourceOrganizationId) {
      throw new AccountError(400, "Escolha a conta de destino.", "targetOrganizationId");
    }

    const target = await getMemberOrganization(client, req.user.id, targetOrganizationId);
    if (!target || !["owner", "admin"].includes(target.organizationRole)) {
      throw new AccountError(403, "Você precisa ser dono ou administrador da conta de destino.");
    }

    const entitlements = resolveOrganizationBilling(target).entitlements;
    if (entitlements.maxWorkspaces > -1) {
      const workspaceCount = await client.query(
        "SELECT COUNT(*)::int AS total FROM workspaces WHERE organization_id = $1 AND deleted_at IS NULL",
        [target.id],
      );
      if (workspaceCount.rows[0].total >= entitlements.maxWorkspaces) {
        throw new AccountError(
          403,
          `O plano de ${target.name} permite até ${entitlements.maxWorkspaces} workspace(s). Faça upgrade para mover este workspace.`,
        );
      }
    }

    if (entitlements.maxStorageMb > 0) {
      const workspaceBytes = await client.query(
        `
          SELECT COALESCE(SUM(size_bytes), 0)::bigint AS total
          FROM storage_files
          WHERE deleted_at IS NULL
            AND (workspace_id = $1 OR task_id IN (SELECT id FROM tasks WHERE workspace_id = $1))
        `,
        [workspaceId],
      );
      const usedBytes = await getOrganizationStorageUsageBytes(target.id);
      if (usedBytes + Number(workspaceBytes.rows[0].total) > entitlements.maxStorageMb * MB) {
        throw new AccountError(
          403,
          `Não há espaço de armazenamento suficiente no plano de ${target.name} para os arquivos deste workspace.`,
        );
      }
    }

    await client.query("BEGIN");
    transactionOpen = true;

    await remapWorkspaceTags(client, workspaceId, target.id);

    // Quem não é membro da conta de destino perde o acesso ao workspace.
    const removedMembers = await client.query(
      `
        DELETE FROM workspace_members wm
        WHERE wm.workspace_id = $1
          AND NOT EXISTS (
            SELECT 1 FROM organization_members om
            WHERE om.organization_id = $2
              AND om.member_id = wm.member_id
              AND om.status = 'active'
          )
        RETURNING wm.member_id
      `,
      [workspaceId, target.id],
    );

    await client.query(
      "UPDATE workspaces SET organization_id = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1",
      [workspaceId, target.id],
    );
    // Arquivos passam a contar para a conta de destino e vão para a pasta dela na Bunny.
    await client.query(
      `
        UPDATE storage_files
        SET organization_id = $2, workspace_id = $1
        WHERE deleted_at IS NULL
          AND (workspace_id = $1 OR task_id IN (SELECT id FROM tasks WHERE workspace_id = $1))
      `,
      [workspaceId, target.id],
    );

    await client.query("COMMIT");
    transactionOpen = false;

    requestStorageReconcile(target.id).catch((error) =>
      console.error("[conta] falha ao agendar reorganização de arquivos", error?.message || error),
    );
    for (const organizationId of [sourceOrganizationId, target.id]) {
      publishRealtimeEvent({
        type: "seed.refetch",
        actorId: req.user.id,
        organizationId,
        payload: { reason: "workspace.moved" },
      });
    }

    res.json({
      message: `Workspace movido para ${target.name}.`,
      targetOrganizationId: target.id,
      removedMembers: removedMembers.rowCount,
    });
  } catch (error) {
    if (transactionOpen) {
      await client.query("ROLLBACK");
    }
    sendAccountError(res, error, "Erro ao mover o workspace.");
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------------------
// Segurança da conta: trocar senha, trocar e-mail e encerrar sessões.
// ---------------------------------------------------------------------------

// Troca de senha com a pessoa logada. Encerra as outras sessões e devolve
// tokens novos para quem está fazendo a troca continuar conectado.
router.put("/password", verifyToken, async (req, res) => {
  const client = await postgres.connect();

  try {
    await assertPassword(client, req.user.id, req.body?.currentPassword);
    const newPassword = validatePassword(req.body?.newPassword);

    if (newPassword === req.body?.currentPassword) {
      throw new AccountError(400, "A nova senha deve ser diferente da atual.", "newPassword");
    }

    await client.query(
      "UPDATE members SET password_hash = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1",
      [req.user.id, await bcrypt.hash(newPassword, 10)],
    );
    await revokeAllSessions(req.user.id);

    return res.json(
      await buildSessionResponse(
        client,
        req.user.id,
        req.user.organizationId,
        "Senha alterada. As outras sessões foram encerradas.",
      ),
    );
  } catch (error) {
    sendAccountError(res, error, "Erro ao alterar a senha.");
  } finally {
    client.release();
  }
});

// Troca de e-mail com a pessoa logada: pede a senha, marca o e-mail como não
// confirmado e manda a confirmação para o endereço novo.
router.put("/email", verifyToken, async (req, res) => {
  const client = await postgres.connect();

  try {
    await ensureAccountSchema();
    await assertPassword(client, req.user.id, req.body?.password);
    const email = validateEmail(req.body?.email);

    const current = await client.query("SELECT email FROM members WHERE id = $1", [req.user.id]);
    if (String(current.rows[0]?.email || "").toLowerCase() === email.toLowerCase()) {
      throw new AccountError(400, "Esse já é o seu e-mail atual.", "email");
    }

    const taken = await client.query(
      "SELECT id FROM members WHERE lower(email) = lower($1) AND id <> $2",
      [email, req.user.id],
    );
    if (taken.rows.length > 0) {
      throw new AccountError(409, "Já existe uma conta com esse e-mail.", "email");
    }

    const updated = await client.query(
      `
        UPDATE members
        SET email = $2, email_verified_at = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING id, name, email
      `,
      [req.user.id, email],
    );

    await sendEmailVerification(updated.rows[0]);
    await revokeAllSessions(req.user.id);

    return res.json(
      await buildSessionResponse(
        client,
        req.user.id,
        req.user.organizationId,
        "E-mail alterado. Confirme o novo endereço pelo link que enviamos.",
      ),
    );
  } catch (error) {
    sendAccountError(res, error, "Erro ao alterar o e-mail.");
  } finally {
    client.release();
  }
});

// Sessões abertas (aparelhos/navegadores conectados).
router.get("/sessions", verifyToken, async (req, res) => {
  try {
    const sessions = await listSessions(req.user.id);
    return res.json({
      sessions: sessions.map((session) => ({
        ...session,
        current: session.id === req.user.sid,
      })),
    });
  } catch (error) {
    sendAccountError(res, error, "Erro ao listar as sessões.");
  }
});

// ---------------------------------------------------------------------------
// LGPD: exportação de dados, exclusão de conta (empresa/espaço) e do cadastro.
// ---------------------------------------------------------------------------

const ACTIVE_SUBSCRIPTION_STATUSES = ["active", "trialing", "past_due"];

async function assertPassword(db, memberId, password) {
  const result = await db.query("SELECT password_hash FROM members WHERE id = $1", [memberId]);
  const passwordHash = result.rows[0]?.password_hash;
  if (!passwordHash || typeof password !== "string" || !(await bcrypt.compare(password, passwordHash))) {
    throw new AccountError(403, "Senha incorreta.", "password");
  }
}

async function collectOrganizationFileUrls(db, organizationId) {
  await ensureStorageSchema();
  const result = await db.query(
    "SELECT url FROM storage_files WHERE organization_id = $1 AND deleted_at IS NULL",
    [organizationId],
  );
  return result.rows.map((row) => row.url);
}

// A exclusão em cascata remove workspaces, projetos, cards, comentários,
// anexos, etiquetas, membros e convites da conta.
async function deleteOrganizationRecords(client, organizationId) {
  await client.query("DELETE FROM storage_reconcile_queue WHERE organization_id = $1", [
    organizationId,
  ]);
  await client.query("DELETE FROM organizations WHERE id = $1", [organizationId]);
}

async function buildNextSession(client, memberId, message) {
  const next = await client.query(
    `
      SELECT organization_id AS "organizationId"
      FROM organization_members
      WHERE member_id = $1 AND status = 'active'
      ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, created_at ASC
      LIMIT 1
    `,
    [memberId],
  );

  if (!next.rows[0]) {
    return { message, loggedOut: true };
  }
  return buildSessionResponse(client, memberId, next.rows[0].organizationId, message);
}

// Arquivo JSON com os dados pessoais, as contas e o conteúdo das contas de que é titular.
router.get("/export", verifyToken, async (req, res) => {
  try {
    await ensureAccountSchema();
    const query = (sql, params) => postgres.query(sql, params).then((result) => result.rows);

    const [person] = await query(
      `
        SELECT id, name, email, role AS "jobTitle", cpf, phone,
               to_char(birth_date, 'YYYY-MM-DD') AS "birthDate", avatar_url AS "avatarUrl",
               created_at AS "createdAt"
        FROM members WHERE id = $1
      `,
      [req.user.id],
    );
    const accounts = await query(
      `
        SELECT o.id, o.name, o.account_type AS "accountType", o.cnpj, o.legal_name AS "legalName",
               o.plan, om.role, om.created_at AS "joinedAt"
        FROM organization_members om
        INNER JOIN organizations o ON o.id = om.organization_id
        WHERE om.member_id = $1 AND om.status = 'active'
      `,
      [req.user.id],
    );

    const ownedAccounts = [];
    for (const account of accounts.filter((item) => item.role === "owner")) {
      const workspaces = await query(
        "SELECT id, name, description, visibility, created_at AS \"createdAt\" FROM workspaces WHERE organization_id = $1",
        [account.id],
      );
      const workspaceIds = workspaces.map((workspace) => workspace.id);

      ownedAccounts.push({
        accountId: account.id,
        accountName: account.name,
        workspaces,
        projects: await query(
          `
            SELECT l.id, l.name, s.workspace_id AS "workspaceId", l.created_at AS "createdAt"
            FROM lists l
            INNER JOIN folders f ON f.id = l.folder_id
            INNER JOIN spaces s ON s.id = f.space_id
            WHERE s.workspace_id = ANY($1::text[])
          `,
          [workspaceIds],
        ),
        tasks: await query(
          `
            SELECT id, list_id AS "projectId", parent_task_id AS "parentTaskId", title, description,
                   priority, start_date AS "startDate", due_date AS "dueDate", created_at AS "createdAt"
            FROM tasks WHERE workspace_id = ANY($1::text[])
          `,
          [workspaceIds],
        ),
        comments: await query(
          `
            SELECT c.id, c.task_id AS "taskId", c.author_id AS "authorId", c.content,
                   c.attachment_name AS "attachmentName", c.attachment_url AS "attachmentUrl",
                   c.created_at AS "createdAt"
            FROM task_comments c
            INNER JOIN tasks t ON t.id = c.task_id
            WHERE t.workspace_id = ANY($1::text[])
          `,
          [workspaceIds],
        ),
        attachments: await query(
          `
            SELECT a.id, a.task_id AS "taskId", a.name, a.url, a.size, a.created_at AS "createdAt"
            FROM task_attachments a
            INNER JOIN tasks t ON t.id = a.task_id
            WHERE t.workspace_id = ANY($1::text[])
          `,
          [workspaceIds],
        ),
        tags: await query("SELECT id, name, color FROM tags WHERE organization_id = $1", [account.id]),
      });
    }

    const participation = {
      assignedTasks: await query(
        `
          SELECT t.id, t.title, t.workspace_id AS "workspaceId"
          FROM task_assignees ta
          INNER JOIN tasks t ON t.id = ta.task_id
          WHERE ta.member_id = $1
        `,
        [req.user.id],
      ),
      comments: await query(
        "SELECT id, task_id AS \"taskId\", content, created_at AS \"createdAt\" FROM task_comments WHERE author_id = $1",
        [req.user.id],
      ),
    };

    const fileName = `pauta-meus-dados-${new Date().toISOString().slice(0, 10)}.json`;
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.json({
      exportedAt: new Date().toISOString(),
      person,
      accounts,
      ownedAccounts,
      participation,
      // Prova do aceite dos documentos (LGPD).
      legalAcceptances: await listAcceptances(req.user.id),
    });
  } catch (error) {
    sendAccountError(res, error, "Erro ao exportar os dados.");
  }
});

// Exclui a conta ativa (empresa ou espaço pessoal). Body: { password, confirmName }
router.delete("/organization", verifyToken, async (req, res) => {
  const client = await postgres.connect();
  let transactionOpen = false;

  try {
    const account = await loadAccountContext(client, req);
    if (!account.isOwner) {
      throw new AccountError(403, "Somente o titular pode excluir a conta.");
    }
    await assertPassword(client, req.user.id, req.body?.password);
    if (String(req.body?.confirmName || "").trim() !== account.name) {
      throw new AccountError(
        400,
        "Digite o nome da conta exatamente como aparece para confirmar.",
        "confirmName",
      );
    }

    const subscription = await client.query(
      "SELECT subscription_status AS status FROM organizations WHERE id = $1",
      [account.id],
    );
    if (ACTIVE_SUBSCRIPTION_STATUSES.includes(subscription.rows[0]?.status)) {
      throw new AccountError(409, "Cancele a assinatura desta conta antes de excluí-la.");
    }

    const fileUrls = await collectOrganizationFileUrls(client, account.id);

    await client.query("BEGIN");
    transactionOpen = true;
    await deleteOrganizationRecords(client, account.id);
    await client.query("COMMIT");
    transactionOpen = false;

    releaseStorageUrls(fileUrls);
    res.json(await buildNextSession(client, req.user.id, `O espaço ${account.name} foi excluído. Seu cadastro pessoal continua ativo.`));
  } catch (error) {
    if (transactionOpen) {
      await client.query("ROLLBACK");
    }
    sendAccountError(res, error, "Erro ao excluir a conta.");
  } finally {
    client.release();
  }
});

// Exclui o cadastro da pessoa. Dados pessoais são anonimizados para não apagar
// o histórico das outras pessoas (comentários e cards continuam, sem identificação).
// Body: { password, confirm: "EXCLUIR" }
router.delete("/me", verifyToken, async (req, res) => {
  const client = await postgres.connect();
  let transactionOpen = false;

  try {
    await ensureAccountSchema();
    await ensureInvitationSchema();
    await assertPassword(client, req.user.id, req.body?.password);
    if (req.body?.confirm !== "EXCLUIR") {
      throw new AccountError(400, "Digite EXCLUIR para confirmar.", "confirm");
    }

    const owned = await client.query(
      `
        SELECT
          o.id,
          o.name,
          o.subscription_status AS "subscriptionStatus",
          o.cancel_at_period_end AS "cancelAtPeriodEnd",
          o.subscription_period_end AS "periodEnd",
          (
            SELECT COUNT(*)::int FROM organization_members other
            WHERE other.organization_id = o.id
              AND other.status = 'active'
              AND other.member_id <> $1
          ) AS "otherMembers"
        FROM organizations o
        INNER JOIN organization_members om
          ON om.organization_id = o.id
         AND om.member_id = $1
         AND om.role = 'owner'
         AND om.status = 'active'
      `,
      [req.user.id],
    );

    const withMembers = owned.rows.filter((organization) => organization.otherMembers > 0);
    if (withMembers.length > 0) {
      throw new AccountError(
        409,
        `Você é titular de contas com outros membros: ${withMembers.map((item) => item.name).join(", ")}. Remova os membros ou exclua essas contas antes.`,
      );
    }
    // Antes de barrar, confere na Stripe: o cancelamento pode ter sido feito no
    // portal e o aviso ter se perdido no caminho.
    const { syncSubscriptionFromStripe } = require("../services/stripe.service");
    for (const organization of owned.rows) {
      if (ACTIVE_SUBSCRIPTION_STATUSES.includes(organization.subscriptionStatus)) {
        await syncSubscriptionFromStripe(organization.id, { force: true }).catch(() => undefined);
      }
    }

    const atualizadas = await client.query(
      `
        SELECT id, name, subscription_status AS "subscriptionStatus",
               cancel_at_period_end AS "cancelAtPeriodEnd"
        FROM organizations WHERE id = ANY($1::text[])
      `,
      [owned.rows.map((organization) => organization.id)],
    );

    // Assinatura já cancelada (valendo até o fim do período pago) não impede a
    // exclusão: a pessoa não fica presa por algo que ela já cancelou.
    const assinaturasAtivas = atualizadas.rows.filter(
      (organization) =>
        ACTIVE_SUBSCRIPTION_STATUSES.includes(organization.subscriptionStatus) &&
        !organization.cancelAtPeriodEnd,
    );

    if (assinaturasAtivas.length > 0) {
      throw new AccountError(
        409,
        `Cancele primeiro a assinatura de: ${assinaturasAtivas
          .map((item) => item.name)
          .join(", ")}. Depois de cancelar você pode excluir o cadastro, mesmo que ainda falte tempo do período já pago.`,
      );
    }

    const member = await loadMember(client, req.user.id);
    const fileUrls = member.avatar_url ? [member.avatar_url] : [];
    for (const organization of owned.rows) {
      fileUrls.push(...(await collectOrganizationFileUrls(client, organization.id)));
    }

    await client.query("BEGIN");
    transactionOpen = true;
    for (const organization of owned.rows) {
      await deleteOrganizationRecords(client, organization.id);
    }
    await client.query(
      "UPDATE organization_invitations SET status = 'revoked' WHERE email = lower($1) AND status = 'pending'",
      [member.email],
    );
    await client.query("DELETE FROM organization_members WHERE member_id = $1", [member.id]);
    await client.query("DELETE FROM member_tags WHERE member_id = $1", [member.id]);
    await client.query("DELETE FROM user_push_tokens WHERE user_id = $1", [member.id]);
    await client.query("DELETE FROM task_watchers WHERE member_id = $1", [member.id]);
    await client.query(
      `
        UPDATE members
        SET name = 'Usuário removido',
            email = $2,
            role = NULL,
            password_hash = NULL,
            avatar_url = NULL,
            avatar_color = 'bg-slate-400',
            cpf = NULL,
            phone = NULL,
            birth_date = NULL,
            active_organization_id = NULL,
            email_verified_at = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `,
      [member.id, `removido+${member.id}@excluido.pauta.invalid`],
    );
    await client.query("COMMIT");
    transactionOpen = false;

    releaseStorageUrls(fileUrls);
    res.json({ message: "Seu cadastro foi excluído.", loggedOut: true });
  } catch (error) {
    if (transactionOpen) {
      await client.query("ROLLBACK");
    }
    sendAccountError(res, error, "Erro ao excluir o cadastro.");
  } finally {
    client.release();
  }
});

module.exports = router;
