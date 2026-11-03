const express = require("express");
const router = express.Router();
const { postgres } = require("../server/connect");
const { verifyToken } = require("../middlewares/auth.middleware");
const { requirePlatformAdmin } = require("../middlewares/platform-admin.middleware");
const { invalidatePlanCache } = require("../middlewares/plan-limit.middleware");
const {
  PAID_PLANS,
  PLAN_CATALOG,
  getOrganizationUsage,
  getPlan,
  getStoragePack,
  normalizePlanId,
  resolveOrganizationBilling,
} = require("../services/billing.service");
const {
  REQUEST_STATUSES,
  ensurePlatformAdminSchema,
  recordAdminAction,
} = require("../services/platform-admin.service");

router.use(verifyToken, requirePlatformAdmin);

const PAGE_SIZE = 20;
const EDITABLE_ENTITLEMENTS = [
  "includedUsers",
  "maxUsers",
  "maxWorkspaces",
  "maxProjects",
  "maxStorageMb",
  "maxFileSizeMb",
  "maxFilesPerUpload",
  "maxEmailAttachmentMb",
  "maxStoragePacks",
];

/** Receita mensal estimada de uma conta (anual dividido por 12). */
function estimateMonthlyCents(organization) {
  const billing = resolveOrganizationBilling(organization);
  const planId = normalizePlanId(organization.plan);

  if (
    billing.isExempt ||
    !PAID_PLANS.includes(planId) ||
    !["active", "trialing", "past_due"].includes(organization.subscription_status)
  ) {
    return 0;
  }

  const plan = getPlan(planId);
  const yearly = organization.billing_interval === "yearly";
  const interval = yearly ? "yearly" : "monthly";
  const base = plan.priceCents[interval] || 0;
  const seats = (plan.extraUserPriceCents[interval] || 0) * Number(organization.extra_seats || 0);
  const packs =
    (getStoragePack().priceCents[interval] || 0) * Number(organization.extra_storage_packs || 0);
  const total = base + seats + packs;

  return yearly ? Math.round(total / 12) : total;
}

// Visão geral da plataforma.
router.get("/overview", async (_req, res) => {
  try {
    await ensurePlatformAdminSchema();

    const { ensureNfseSchema } = require("../services/nfse.service");
    const { ensureSupportSchema } = require("../services/support.service");
    await Promise.all([ensureNfseSchema(), ensureSupportSchema()]);

    const [organizations, members, storage, requests, recent, nfse, support] = await Promise.all([
      postgres.query("SELECT * FROM organizations"),
      postgres.query(
        "SELECT COUNT(*)::int AS total FROM members WHERE email NOT LIKE 'removido+%'",
      ),
      postgres.query(
        "SELECT COALESCE(SUM(size_bytes), 0)::bigint AS total FROM storage_files WHERE deleted_at IS NULL",
      ),
      postgres.query(
        "SELECT COUNT(*)::int AS total FROM enterprise_requests WHERE status = 'nova'",
      ),
      postgres.query(
        "SELECT COUNT(*)::int AS total FROM organizations WHERE created_at > CURRENT_TIMESTAMP - INTERVAL '30 days'",
      ),
      postgres.query("SELECT COUNT(*)::int AS total FROM nfse_records WHERE status = 'pendente'"),
      postgres.query("SELECT COUNT(*)::int AS total FROM support_conversations WHERE status = 'aberta'"),
    ]);

    const byPlan = {};
    let paying = 0;
    let trials = 0;
    let exempt = 0;
    let pastDue = 0;
    let mrrCents = 0;

    for (const organization of organizations.rows) {
      const billing = resolveOrganizationBilling(organization);
      const planId = billing.isExempt ? "interna" : billing.contractedPlanId;
      byPlan[planId] = (byPlan[planId] || 0) + 1;

      if (billing.isExempt) exempt += 1;
      if (billing.isTrial) trials += 1;
      if (billing.payment.pastDue) pastDue += 1;

      const monthly = estimateMonthlyCents(organization);
      if (monthly > 0) {
        paying += 1;
        mrrCents += monthly;
      }
    }

    return res.json({
      organizations: organizations.rows.length,
      newOrganizationsLast30Days: recent.rows[0].total,
      members: members.rows[0].total,
      paying,
      trials,
      exempt,
      pastDue,
      mrrCents,
      byPlan,
      storageMb: Math.round(Number(storage.rows[0].total) / (1024 * 1024)),
      newEnterpriseRequests: requests.rows[0].total,
      pendingInvoices: nfse.rows[0].total,
      waitingSupport: support.rows[0].total,
    });
  } catch (error) {
    console.error("[super-admin] visão geral", error);
    return res.status(500).json({ message: "Não foi possível carregar a visão geral." });
  }
});

// Lista de contas, com busca por nome, e-mail do titular ou CNPJ.
router.get("/organizations", async (req, res) => {
  const search = String(req.query.search || "").trim();
  const plan = String(req.query.plan || "").trim();
  const page = Math.max(0, Number(req.query.page) || 0);

  try {
    await ensurePlatformAdminSchema();

    const filters = [];
    const params = [];

    if (search) {
      params.push(`%${search.toLowerCase()}%`);
      filters.push(
        `(lower(o.name) LIKE $${params.length} OR lower(m.email) LIKE $${params.length} OR o.cnpj LIKE $${params.length})`,
      );
    }

    if (plan === "interna") {
      filters.push("o.billing_exempt = TRUE");
    } else if (plan) {
      params.push(plan);
      filters.push(`o.plan = $${params.length}`);
    }

    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

    const total = await postgres.query(
      `SELECT COUNT(*)::int AS total FROM organizations o LEFT JOIN members m ON m.id = o.owner_member_id ${where}`,
      params,
    );

    params.push(PAGE_SIZE, page * PAGE_SIZE);
    const result = await postgres.query(
      `
        SELECT
          o.*,
          m.name AS owner_name,
          m.email AS owner_email,
          (SELECT COUNT(*)::int FROM organization_members om
             WHERE om.organization_id = o.id AND om.status = 'active') AS members_count,
          (SELECT COALESCE(SUM(size_bytes), 0)::bigint FROM storage_files sf
             WHERE sf.organization_id = o.id AND sf.deleted_at IS NULL) AS storage_bytes
        FROM organizations o
        LEFT JOIN members m ON m.id = o.owner_member_id
        ${where}
        ORDER BY o.created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}
      `,
      params,
    );

    return res.json({
      total: total.rows[0].total,
      page,
      pageSize: PAGE_SIZE,
      organizations: result.rows.map((row) => {
        const billing = resolveOrganizationBilling(row);
        return {
          id: row.id,
          name: row.name,
          accountType: row.account_type,
          cnpj: row.cnpj,
          ownerName: row.owner_name,
          ownerEmail: row.owner_email,
          plan: billing.contractedPlanId,
          effectivePlan: billing.planId,
          status: billing.status,
          billingExempt: billing.isExempt,
          trialEndsAt: billing.trialEndsAt,
          pastDue: billing.payment.pastDue,
          cancelAtPeriodEnd: billing.cancelAtPeriodEnd,
          membersCount: row.members_count,
          storageMb: Math.round(Number(row.storage_bytes) / (1024 * 1024)),
          monthlyCents: estimateMonthlyCents(row),
          createdAt: row.created_at,
        };
      }),
    });
  } catch (error) {
    console.error("[super-admin] contas", error);
    return res.status(500).json({ message: "Não foi possível carregar as contas." });
  }
});

// Detalhe de uma conta.
router.get("/organizations/:id", async (req, res) => {
  try {
    await ensurePlatformAdminSchema();

    const result = await postgres.query(
      `
        SELECT o.*, m.name AS owner_name, m.email AS owner_email, m.phone AS owner_phone
        FROM organizations o
        LEFT JOIN members m ON m.id = o.owner_member_id
        WHERE o.id = $1
      `,
      [req.params.id],
    );
    const organization = result.rows[0];

    if (!organization) {
      return res.status(404).json({ message: "Conta não encontrada." });
    }

    const [usage, members, requests, audit] = await Promise.all([
      getOrganizationUsage(organization.id),
      postgres.query(
        `
          SELECT m.name, m.email, om.role, om.created_at AS "joinedAt"
          FROM organization_members om
          INNER JOIN members m ON m.id = om.member_id
          WHERE om.organization_id = $1 AND om.status = 'active'
          ORDER BY om.created_at
        `,
        [organization.id],
      ),
      postgres.query(
        "SELECT id, status, created_at AS \"createdAt\" FROM enterprise_requests WHERE organization_id = $1 ORDER BY created_at DESC",
        [organization.id],
      ),
      postgres.query(
        `
          SELECT id, admin_email AS "adminEmail", target_type AS "targetType", changes, created_at AS "createdAt"
          FROM admin_audit_log
          WHERE organization_id = $1
          ORDER BY created_at DESC
          LIMIT 50
        `,
        [organization.id],
      ),
    ]);

    const billing = resolveOrganizationBilling(organization);

    return res.json({
      id: organization.id,
      name: organization.name,
      legalName: organization.legal_name,
      accountType: organization.account_type,
      cnpj: organization.cnpj,
      owner: {
        name: organization.owner_name,
        email: organization.owner_email,
        phone: organization.owner_phone,
      },
      plan: billing.contractedPlanId,
      effectivePlan: billing.planId,
      status: billing.status,
      billingInterval: organization.billing_interval,
      billingExempt: billing.isExempt,
      trialEndsAt: billing.trialEndsAt,
      periodEnd: billing.periodEnd,
      cancelAtPeriodEnd: billing.cancelAtPeriodEnd,
      extraSeats: billing.extraSeats,
      extraStoragePacks: billing.extraStoragePacks,
      hasStripeSubscription: Boolean(organization.stripe_subscription_id),
      customEntitlements: organization.custom_entitlements || null,
      entitlements: billing.entitlements,
      adminNotes: organization.admin_notes,
      usage,
      monthlyCents: estimateMonthlyCents(organization),
      members: members.rows,
      enterpriseRequests: requests.rows,
      auditLog: audit.rows.map((row) => ({
        id: row.id,
        adminEmail: row.adminEmail,
        targetType: row.targetType,
        changes: Object.keys(row.changes || {}),
        createdAt: row.createdAt,
      })),
      createdAt: organization.created_at,
    });
  } catch (error) {
    console.error("[super-admin] detalhe da conta", error);
    return res.status(500).json({ message: "Não foi possível carregar a conta." });
  }
});

// Ajustes manuais: plano, conta interna, teste, limites negociados e anotações.
router.patch("/organizations/:id", async (req, res) => {
  const body = req.body || {};

  try {
    await ensurePlatformAdminSchema();

    const current = await postgres.query("SELECT * FROM organizations WHERE id = $1", [
      req.params.id,
    ]);
    const organization = current.rows[0];

    if (!organization) {
      return res.status(404).json({ message: "Conta não encontrada." });
    }

    const updates = [];
    const params = [organization.id];
    const set = (column, value) => {
      params.push(value);
      updates.push(`${column} = $${params.length}`);
    };

    if (body.plan !== undefined) {
      // Sem normalizar antes: normalizePlanId devolve "free" para qualquer
      // valor desconhecido, e um erro de digitação rebaixaria a conta.
      const planId = String(body.plan || "").trim().toLowerCase();
      if (!PLAN_CATALOG[planId]) {
        return res.status(400).json({ message: "Plano inválido." });
      }

      // Plano pago pela Stripe se ajusta pela própria assinatura, não aqui.
      const assinaturaAtiva =
        organization.stripe_subscription_id &&
        ["active", "trialing", "past_due"].includes(organization.subscription_status);
      if (assinaturaAtiva) {
        return res.status(409).json({
          message:
            "Esta conta tem assinatura ativa na Stripe. Cancele a assinatura antes de definir o plano manualmente.",
        });
      }

      set("plan", planId);
      // Enterprise é contrato fora da Stripe; Grátis volta ao estado normal.
      set("subscription_status", planId === "free" ? "free" : "manual");
    }

    if (body.billingExempt !== undefined) {
      set("billing_exempt", Boolean(body.billingExempt));
    }

    if (body.trialEndsAt !== undefined) {
      const date = body.trialEndsAt ? new Date(body.trialEndsAt) : null;
      if (date && Number.isNaN(date.getTime())) {
        return res.status(400).json({ message: "Data de fim do teste inválida." });
      }
      set("trial_ends_at", date);
      if (date && !organization.trial_started_at) {
        set("trial_started_at", new Date());
      }
    }

    if (body.customEntitlements !== undefined) {
      if (body.customEntitlements === null) {
        set("custom_entitlements", null);
      } else {
        const limpo = {};
        for (const key of EDITABLE_ENTITLEMENTS) {
          const value = body.customEntitlements[key];
          if (value === undefined || value === null || value === "") continue;
          const numero = Number(value);
          if (!Number.isFinite(numero) || numero < -1) {
            return res.status(400).json({ message: `Valor inválido em ${key}.` });
          }
          limpo[key] = Math.round(numero);
        }
        set("custom_entitlements", Object.keys(limpo).length ? limpo : null);
      }
    }

    if (body.adminNotes !== undefined) {
      set("admin_notes", String(body.adminNotes || "").slice(0, 5000) || null);
    }

    if (updates.length === 0) {
      return res.json({ message: "Nada para alterar." });
    }

    await postgres.query(
      `UPDATE organizations SET ${updates.join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      params,
    );
    invalidatePlanCache(organization.id);

    const changes = {};
    for (const key of ["plan", "billingExempt", "trialEndsAt", "customEntitlements", "adminNotes"]) {
      if (body[key] === undefined) continue;
      const antes = {
        plan: organization.plan,
        billingExempt: organization.billing_exempt,
        trialEndsAt: organization.trial_ends_at,
        customEntitlements: organization.custom_entitlements,
        adminNotes: organization.admin_notes,
      }[key];
      if (JSON.stringify(antes ?? null) === JSON.stringify(body[key] ?? null)) continue;
      changes[key] = { antes: antes ?? null, depois: body[key] ?? null };
    }
    if (Object.keys(changes).length) {
      await recordAdminAction(req, {
        organizationId: organization.id,
        targetType: "organization",
        targetId: organization.id,
        changes,
      });
    }

    console.log(
      `[super-admin] ${req.user.email} alterou a conta ${organization.name}:`,
      Object.keys(changes).join(", ") || "nada",
    );

    return res.json({ message: "Conta atualizada." });
  } catch (error) {
    console.error("[super-admin] atualizar conta", error);
    return res.status(500).json({ message: "Não foi possível atualizar a conta." });
  }
});

// Por que as contas cancelaram (pesquisa respondida no cancelamento).
router.get("/cancellations", async (req, res) => {
  try {
    await ensurePlatformAdminSchema();
    const [respostas, porMotivo] = await Promise.all([
      postgres.query(
        `
          SELECT c.id, c.reason, c.comment, c.plan, c.offer_type AS "offerType",
                 c.outcome, c.created_at AS "createdAt",
                 o.name AS "organizationName", m.name AS "memberName"
          FROM cancellation_surveys c
          LEFT JOIN organizations o ON o.id = c.organization_id
          LEFT JOIN members m ON m.id = c.member_id
          ORDER BY c.created_at DESC
          LIMIT 100
        `,
      ),
      postgres.query(
        `
          SELECT reason,
                 COUNT(*)::int AS total,
                 COUNT(*) FILTER (WHERE outcome = 'aceitou_oferta')::int AS retidos
          FROM cancellation_surveys GROUP BY reason ORDER BY total DESC
        `,
      ),
    ]);

    return res.json({ answers: respostas.rows, byReason: porMotivo.rows });
  } catch (error) {
    console.error("[super-admin] cancelamentos", error);
    return res.status(500).json({ message: "Não foi possível carregar os cancelamentos." });
  }
});

// Solicitações de plano Enterprise.
router.get("/enterprise-requests", async (req, res) => {
  const status = String(req.query.status || "").trim();

  try {
    await ensurePlatformAdminSchema();

    const params = [];
    let where = "";
    if (status && REQUEST_STATUSES.includes(status)) {
      params.push(status);
      where = "WHERE r.status = $1";
    }

    const result = await postgres.query(
      `
        SELECT
          r.*,
          o.name AS organization_name,
          o.plan AS organization_plan
        FROM enterprise_requests r
        LEFT JOIN organizations o ON o.id = r.organization_id
        ${where}
        ORDER BY
          CASE r.status WHEN 'nova' THEN 0 WHEN 'em_contato' THEN 1 WHEN 'proposta_enviada' THEN 2 ELSE 3 END,
          r.created_at DESC
      `,
      params,
    );

    return res.json({
      statuses: REQUEST_STATUSES,
      requests: result.rows.map((row) => ({
        id: row.id,
        organizationId: row.organization_id,
        organizationName: row.organization_name,
        organizationPlan: row.organization_plan,
        contactName: row.contact_name,
        contactEmail: row.contact_email,
        contactPhone: row.contact_phone,
        companyName: row.company_name,
        teamSize: row.team_size,
        seatsNeeded: row.seats_needed,
        storageNeededGb: row.storage_needed_gb,
        reason: row.reason,
        status: row.status,
        adminNotes: row.admin_notes,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    });
  } catch (error) {
    console.error("[super-admin] solicitações enterprise", error);
    return res.status(500).json({ message: "Não foi possível carregar as solicitações." });
  }
});

// Notas fiscais: fila de emissão manual (site da prefeitura).
// ---------- erros da plataforma ----------
/** Quanto a Bunny está custando e quais contas estão perto do limite. */
router.get("/custos", async (req, res) => {
  try {
    const { resumoDeCustos } = require("../services/custos.service");
    return res.json(await resumoDeCustos());
  } catch (error) {
    console.error("[super-admin] falha ao resumir custos", error?.message || error);
    return res.status(500).json({ message: "Não consegui calcular os custos." });
  }
});

/** Trilha de auditoria de um arquivo ou de uma conta. */
router.get("/auditoria-arquivos", async (req, res) => {
  try {
    const conta = String(req.query.conta || "").trim();
    const caminho = String(req.query.caminho || "").trim();
    if (!conta && !caminho) {
      return res.status(400).json({ message: "Informe a conta ou o caminho do arquivo." });
    }

    const filtro = caminho ? "f.storage_path = $1" : "f.organization_id = $1";
    const valor = caminho || conta;
    const arquivos = await postgres.query(
      `
        SELECT f.storage_path, f.original_name, f.content_type, f.size_bytes,
               f.content_sha256, f.created_at, f.deleted_at, f.uploader_ip,
               f.uploader_agent, m.name AS uploader_name, m.email AS uploader_email
        FROM storage_files f
        LEFT JOIN members m ON m.id = f.uploaded_by
        WHERE ${filtro}
        ORDER BY f.created_at DESC
        LIMIT 500
      `,
      [valor],
    );

    const acessos = await postgres.query(
      `
        SELECT a.storage_path, a.created_at, a.action, a.ip, a.user_agent,
               m.name AS member_name, m.email AS member_email
        FROM storage_access_log a
        LEFT JOIN members m ON m.id = a.member_id
        WHERE ${caminho ? "a.storage_path = $1" : "a.organization_id = $1"}
        ORDER BY a.created_at DESC
        LIMIT 500
      `,
      [valor],
    );

    return res.json({ arquivos: arquivos.rows, acessos: acessos.rows });
  } catch (error) {
    console.error("[super-admin] falha na auditoria de arquivos", error?.message || error);
    return res.status(500).json({ message: "Não consegui montar a auditoria." });
  }
});

router.get("/erros", async (req, res) => {
  try {
    const { listarGrupos } = require("../services/telemetry.service");
    return res.json(
      await listarGrupos({
        status: String(req.query.status || "abertos"),
        origem: String(req.query.origem || ""),
        busca: String(req.query.busca || "").trim(),
        page: req.query.page,
      }),
    );
  } catch (error) {
    console.error("[super-admin] erros", error);
    return res.status(500).json({ message: "Não foi possível carregar os erros." });
  }
});

router.get("/erros/:id", async (req, res) => {
  try {
    const { detalharGrupo } = require("../services/telemetry.service");
    const grupo = await detalharGrupo(req.params.id);
    if (!grupo) return res.status(404).json({ message: "Erro não encontrado." });
    return res.json(grupo);
  } catch (error) {
    console.error("[super-admin] detalhe do erro", error);
    return res.status(500).json({ message: "Não foi possível carregar o erro." });
  }
});

router.post("/erros/:id/resolver", async (req, res) => {
  try {
    const { marcarResolvido } = require("../services/telemetry.service");
    const resolvido = req.body?.resolvido !== false;
    const ok = await marcarResolvido(req.params.id, { resolvido, adminId: req.user.id });
    if (!ok) return res.status(404).json({ message: "Erro não encontrado." });
    await recordAdminAction(req, {
      targetType: "app_error",
      targetId: req.params.id,
      changes: { resolvido },
    });
    return res.json({ message: resolvido ? "Erro marcado como resolvido." : "Erro reaberto." });
  } catch (error) {
    console.error("[super-admin] resolver erro", error);
    return res.status(500).json({ message: "Não foi possível atualizar o erro." });
  }
});

router.get("/nfse", async (req, res) => {
  try {
    const { listRecords } = require("../services/nfse.service");
    return res.json(
      await listRecords({
        status: String(req.query.status || ""),
        search: String(req.query.search || "").trim(),
        page: req.query.page,
      }),
    );
  } catch (error) {
    console.error("[super-admin] notas fiscais", error);
    return res.status(500).json({ message: "Não foi possível carregar as notas fiscais." });
  }
});

router.post("/nfse/sync", async (req, res) => {
  const { NfseError, syncPaidInvoicesFromStripe } = require("../services/nfse.service");
  try {
    const result = await syncPaidInvoicesFromStripe({ days: Number(req.body?.days) || 90 });
    await recordAdminAction(req, { targetType: "nfse_sync", changes: result });
    return res.json({
      ...result,
      message: result.created
        ? `${result.created} fatura(s) paga(s) adicionada(s) à fila.`
        : "Nenhuma fatura nova para emitir.",
    });
  } catch (error) {
    if (error instanceof NfseError) return res.status(error.status).json({ message: error.message });
    console.error("[super-admin] sincronizar notas", error);
    return res.status(500).json({ message: "Não foi possível buscar as faturas na Stripe." });
  }
});

router.patch("/nfse/:id", async (req, res) => {
  const { NfseError, updateRecord } = require("../services/nfse.service");
  try {
    const record = await updateRecord(req.params.id, req.body || {}, req.user.id);
    await recordAdminAction(req, {
      organizationId: record.organizationId,
      targetType: "nfse",
      targetId: record.id,
      changes: { status: record.status, nfseNumber: record.nfseNumber },
    });
    return res.json({ record, message: "Nota fiscal atualizada." });
  } catch (error) {
    if (error instanceof NfseError) return res.status(error.status).json({ message: error.message });
    console.error("[super-admin] atualizar nota", error);
    return res.status(500).json({ message: "Não foi possível atualizar a nota." });
  }
});

router.patch("/enterprise-requests/:id", async (req, res) => {
  const { status, adminNotes } = req.body || {};

  if (status !== undefined && !REQUEST_STATUSES.includes(status)) {
    return res.status(400).json({ message: "Situação inválida." });
  }

  try {
    await ensurePlatformAdminSchema();

    const result = await postgres.query(
      `
        UPDATE enterprise_requests
        SET status = COALESCE($2, status),
            admin_notes = CASE WHEN $3::boolean THEN $4 ELSE admin_notes END,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING id, organization_id
      `,
      [
        req.params.id,
        status ?? null,
        adminNotes !== undefined,
        adminNotes === undefined ? null : String(adminNotes || "").slice(0, 5000),
      ],
    );

    if (!result.rows[0]) {
      return res.status(404).json({ message: "Solicitação não encontrada." });
    }

    await recordAdminAction(req, {
      organizationId: result.rows[0].organization_id,
      targetType: "enterprise_request",
      targetId: req.params.id,
      changes: {
        ...(status !== undefined ? { status } : {}),
        ...(adminNotes !== undefined ? { adminNotes: true } : {}),
      },
    });

    return res.json({ message: "Solicitação atualizada." });
  } catch (error) {
    console.error("[super-admin] atualizar solicitação", error);
    return res.status(500).json({ message: "Não foi possível atualizar a solicitação." });
  }
});

module.exports = router;
