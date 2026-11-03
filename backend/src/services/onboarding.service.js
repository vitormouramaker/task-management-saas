const crypto = require("crypto");
const { postgres } = require("../server/connect");

/**
 * Primeiros passos de quem acabou de chegar:
 * - projeto de exemplo criado junto com a conta;
 * - tour guiado no primeiro acesso (members.tour_completed_at);
 * - e-mails de dicas nos dias 1, 3 e 7, com descadastro em um clique.
 */

const WORKER_INTERVAL_MS = 6 * 60 * 60 * 1000;
const TIP_EMAILS = [
  { kind: "dica_dia_1", fromDay: 1, untilDay: 3 },
  { kind: "dica_dia_3", fromDay: 3, untilDay: 6 },
  { kind: "dica_dia_7", fromDay: 7, untilDay: 10 },
];

let schemaReady = null;

function ensureOnboardingSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      await postgres.query("ALTER TABLE members ADD COLUMN IF NOT EXISTS tour_completed_at TIMESTAMPTZ");
      await postgres.query(
        "ALTER TABLE members ADD COLUMN IF NOT EXISTS product_tips_opt_out BOOLEAN NOT NULL DEFAULT FALSE",
      );
      await postgres.query(`
        CREATE TABLE IF NOT EXISTS onboarding_emails (
          member_id VARCHAR(100) NOT NULL,
          kind VARCHAR(40) NOT NULL,
          sent_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (member_id, kind)
        )
      `);
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

// ---------------------------------------------------------------------------
// Projeto de exemplo
// ---------------------------------------------------------------------------
const DEFAULT_STATUSES = [
  { id: "st_backlog", name: "Lista de Espera", colorClass: "bg-slate-50/50", chipClass: "bg-slate-100 text-slate-700 ring-slate-200", dotClass: "bg-slate-400", order: 1 },
  { id: "st_todo", name: "A Fazer", colorClass: "bg-blue-50/50", chipClass: "bg-blue-100 text-blue-700 ring-blue-200", dotClass: "bg-blue-500", order: 2 },
  { id: "st_progress", name: "Em Andamento", colorClass: "bg-amber-50/50", chipClass: "bg-amber-100 text-amber-700 ring-amber-200", dotClass: "bg-amber-500", order: 3 },
  { id: "st_review", name: "Em Revisão", colorClass: "bg-violet-50/50", chipClass: "bg-violet-100 text-violet-700 ring-violet-200", dotClass: "bg-violet-500", order: 4 },
  { id: "st_done", name: "Concluído", colorClass: "bg-emerald-50/50", chipClass: "bg-emerald-100 text-emerald-700 ring-emerald-200", dotClass: "bg-emerald-500", order: 5 },
];

/** Colunas globais: usa as que existem; só cria as padrão num banco vazio. */
async function resolveStatusIds(client) {
  const existing = await client.query(
    "SELECT id, name, display_order FROM status_definitions WHERE list_id IS NULL ORDER BY display_order",
  );

  if (existing.rows.length === 0) {
    for (const status of DEFAULT_STATUSES) {
      await client.query(
        `INSERT INTO status_definitions (id, name, color_class, chip_class, dot_class, display_order)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`,
        [status.id, status.name, status.colorClass, status.chipClass, status.dotClass, status.order],
      );
    }
    return Object.fromEntries(DEFAULT_STATUSES.map((status) => [status.id, status.id]));
  }

  const ids = new Set(existing.rows.map((row) => row.id));
  const byName = (pattern) => existing.rows.find((row) => pattern.test(row.name))?.id;
  const first = existing.rows[0].id;
  const pick = (id, pattern) => (ids.has(id) ? id : byName(pattern) || first);

  return {
    st_backlog: pick("st_backlog", /espera|backlog/i),
    st_todo: pick("st_todo", /a fazer|to ?do/i),
    st_progress: pick("st_progress", /andamento|progress/i),
    st_review: pick("st_review", /revis|review/i),
    st_done: pick("st_done", /conclu|done/i),
  };
}

function isoDay(offset) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + offset);
  return date.toISOString();
}

/** Cria o projeto "Comece por aqui" dentro do workspace inicial da conta. */
async function createSampleProject(client, { workspaceId, spaceId, ownerId }) {
  const statuses = await resolveStatusIds(client);
  const folderId = newId("fld");
  const listId = newId("list");

  await client.query("INSERT INTO folders (id, space_id, name) VALUES ($1, $2, 'Geral')", [folderId, spaceId]);
  await client.query(
    `INSERT INTO lists (id, folder_id, name, owner_id, visibility, color_class)
     VALUES ($1, $2, 'Comece por aqui', $3, 'private', '#3b82f6')`,
    [listId, folderId, ownerId],
  );

  const cards = [
    {
      title: "Bem-vindo ao Pauta! Abra este card",
      status: "st_todo",
      priority: "high",
      due: 2,
      assign: true,
      description:
        "Cada card é uma tarefa. Aqui dentro você escreve a descrição, define prazo e responsáveis, cria checklists, anexa arquivos e conversa com a equipe.\n\nComplete o checklist abaixo para conhecer o básico. Quando terminar, pode apagar este projeto: ele vai para a Lixeira.",
      checklist: {
        name: "Primeiros passos",
        items: [
          "Arrastar este card para a coluna Em Andamento",
          "Definir um prazo para um card",
          "Atribuir um responsável",
          "Escrever um comentário no card",
          "Abrir as visões Lista, Tabela, Timeline e Calendário",
        ],
      },
    },
    {
      title: "Arraste os cards entre as colunas",
      status: "st_todo",
      priority: "medium",
      description:
        "As colunas mostram em que etapa cada tarefa está. Arraste um card para mudar de etapa. Você também pode criar, renomear e reordenar colunas em cada projeto.",
    },
    {
      title: "Convide sua equipe",
      status: "st_backlog",
      priority: "medium",
      description:
        "Em Membros (menu lateral), convide as pessoas por e-mail. Depois, em cada espaço de trabalho, escolha quem vê e quem edita.",
    },
    {
      title: "Planeje com Timeline e Calendário",
      status: "st_progress",
      priority: "medium",
      start: 0,
      due: 6,
      description:
        "Cards com início e prazo aparecem como barras na Timeline e no Calendário. Arraste para mudar as datas. O Calendário do menu lateral junta os prazos de todos os projetos.",
    },
    {
      title: "Anexe arquivos e converse no card",
      status: "st_review",
      priority: "low",
      due: 4,
      description:
        "Anexe documentos, imagens e vídeos direto no card e use os comentários para decidir junto com a equipe, sem perder o histórico.",
    },
    {
      title: "Card concluído: é assim que fica",
      status: "st_done",
      priority: "low",
      description: "Quando uma tarefa termina, mova para Concluído. O histórico completo fica guardado no card.",
    },
  ];

  for (const card of cards) {
    const taskId = newId("task");
    await client.query(
      `
        INSERT INTO tasks (
          id, workspace_id, space_id, folder_id, list_id, owner_id, visibility,
          title, description, status_id, priority, start_date, due_date
        ) VALUES ($1, $2, $3, $4, $5, $6, 'public', $7, $8, $9, $10, $11, $12)
      `,
      [
        taskId,
        workspaceId,
        spaceId,
        folderId,
        listId,
        ownerId,
        card.title,
        card.description,
        statuses[card.status],
        card.priority,
        card.start !== undefined ? isoDay(card.start) : null,
        card.due !== undefined ? isoDay(card.due) : null,
      ],
    );

    if (card.assign) {
      await client.query(
        "INSERT INTO task_assignees (task_id, member_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        [taskId, ownerId],
      );
    }

    if (card.checklist) {
      const checklistId = newId("chk");
      await client.query("INSERT INTO checklists (id, task_id, name) VALUES ($1, $2, $3)", [
        checklistId,
        taskId,
        card.checklist.name,
      ]);
      for (const label of card.checklist.items) {
        await client.query(
          "INSERT INTO checklist_items (id, checklist_id, label, done) VALUES ($1, $2, $3, FALSE)",
          [newId("chki"), checklistId, label],
        );
      }
    }
  }

  return { listId };
}

// ---------------------------------------------------------------------------
// Tour
// ---------------------------------------------------------------------------
async function completeTour(memberId) {
  await ensureOnboardingSchema();
  await postgres.query(
    "UPDATE members SET tour_completed_at = COALESCE(tour_completed_at, CURRENT_TIMESTAMP) WHERE id = $1",
    [memberId],
  );
}

async function findSampleProjectId(memberId, organizationId) {
  const result = await postgres.query(
    `
      SELECT l.id
      FROM lists l
      INNER JOIN folders f ON f.id = l.folder_id
      INNER JOIN spaces s ON s.id = f.space_id
      INNER JOIN workspaces w ON w.id = s.workspace_id
      WHERE w.organization_id = $1 AND l.owner_id = $2 AND l.name = 'Comece por aqui'
        AND l.deleted_at IS NULL AND w.deleted_at IS NULL
      ORDER BY l.created_at ASC NULLS LAST
      LIMIT 1
    `,
    [organizationId, memberId],
  );
  return result.rows[0]?.id || null;
}

// ---------------------------------------------------------------------------
// E-mails de dicas
// ---------------------------------------------------------------------------
function tipsToken(memberId) {
  const { JWT_SECRET } = require("../config/jwt");
  return crypto.createHmac("sha256", `${JWT_SECRET}.dicas`).update(memberId).digest("hex").slice(0, 32);
}

function unsubscribeUrl(memberId) {
  const base = (process.env.FRONTEND_URL || "https://app.example.com").replace(/\/+$/, "");
  return `${base}/sair-das-dicas?m=${encodeURIComponent(memberId)}&t=${tipsToken(memberId)}`;
}

async function unsubscribeTips(memberId, token) {
  await ensureOnboardingSchema();
  const expected = tipsToken(String(memberId || ""));
  const given = String(token || "");
  if (!memberId || given.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
    return false;
  }
  await postgres.query("UPDATE members SET product_tips_opt_out = TRUE WHERE id = $1", [memberId]);
  return true;
}

function buildTipEmail(kind, { firstName, trial }) {
  const nome = String(firstName || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[c]);
  const ola = `Olá, ${nome || "tudo bem"}!`;

  if (kind === "dica_dia_1") {
    return {
      subject: "Comece no Pauta em 3 passos",
      title: "Seu primeiro projeto em poucos minutos",
      paragraphs: [
        ola,
        "Deixamos um projeto de exemplo chamado <strong>Comece por aqui</strong> na sua conta. Três passos para começar:",
        "1. Crie um projeto para algo real da sua equipe (um cliente, uma campanha, uma entrega).<br>2. Adicione os cards com prazo e responsável.<br>3. Arraste os cards entre as colunas conforme o trabalho anda.",
      ],
      buttonLabel: "Abrir o Pauta",
    };
  }

  if (kind === "dica_dia_3") {
    return {
      subject: "O Pauta fica melhor com a sua equipe",
      title: "Traga quem trabalha com você",
      paragraphs: [
        ola,
        "Em <strong>Membros</strong>, convide as pessoas por e-mail. Cada uma recebe as tarefas atribuídas, é avisada quando é mencionada e vê tudo em tempo real.",
        "Dica: use as visões <strong>Lista</strong> e <strong>Tabela</strong> para revisar tudo de uma vez, e o <strong>Calendário</strong> para não perder prazos.",
      ],
      buttonLabel: "Convidar minha equipe",
    };
  }

  const fimTeste =
    trial?.active && trial.daysLeft !== null
      ? `Seu teste do plano Profissional termina em ${trial.daysLeft} dia(s). Depois disso, a conta volta ao plano Grátis sem perder nada, ou você escolhe um plano em Configurações &gt; Assinatura.`
      : "Quando precisar de mais pessoas, armazenamento ou das visões avançadas, veja os planos em Configurações &gt; Assinatura.";

  return {
    subject: "Dicas para organizar melhor o trabalho no Pauta",
    title: "Uma semana de Pauta",
    paragraphs: [
      ola,
      "Algumas dicas de quem usa todo dia: use <strong>checklists</strong> para etapas de uma tarefa, <strong>campos personalizados</strong> para informações do seu negócio e a <strong>Timeline</strong> para ver o que se sobrepõe.",
      "Ficou com dúvida? Fale com a gente pelo menu <strong>Suporte</strong>.",
      fimTeste,
    ],
    buttonLabel: "Abrir o Pauta",
  };
}

async function runOnboardingEmails() {
  await ensureOnboardingSchema();
  const { resolveOrganizationBilling } = require("./billing.service");
  const { sendSupportEmail } = require("../server/email");

  // Titulares de contas criadas nos últimos 10 dias.
  const result = await postgres.query(`
    SELECT o.*, m.id AS member_id, m.name AS member_name, m.email AS member_email,
           FLOOR(EXTRACT(EPOCH FROM (NOW() - o.created_at)) / 86400)::int AS dias
    FROM organizations o
    INNER JOIN members m ON m.id = o.owner_member_id
    WHERE o.created_at > NOW() - INTERVAL '10 days'
      AND m.email_verified_at IS NOT NULL
      AND m.product_tips_opt_out = FALSE
      AND m.email NOT LIKE 'removido+%'
  `);

  let sent = 0;
  for (const row of result.rows) {
    const step = TIP_EMAILS.find((item) => row.dias >= item.fromDay && row.dias < item.untilDay);
    if (!step) continue;

    const claim = await postgres.query(
      "INSERT INTO onboarding_emails (member_id, kind) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING kind",
      [row.member_id, step.kind],
    );
    if (!claim.rows[0]) continue;

    try {
      const billing = resolveOrganizationBilling(row);
      const email = buildTipEmail(step.kind, {
        firstName: String(row.member_name || "").split(" ")[0],
        trial: { active: billing.isTrial, daysLeft: billing.trialDaysLeft },
      });
      await sendSupportEmail({
        to: row.member_email,
        subject: email.subject,
        title: email.title,
        paragraphs: email.paragraphs,
        buttonLabel: email.buttonLabel,
        path: "/",
        footer: `Você recebe estas dicas porque criou uma conta no Pauta. <a href="${unsubscribeUrl(row.member_id)}">Não quero mais receber dicas</a>.`,
      });
      sent += 1;
    } catch (error) {
      console.error("[onboarding] falha ao enviar dica", step.kind, error?.message || error);
    }
  }

  if (sent) console.log(`[onboarding] ${sent} e-mail(s) de dicas enviado(s).`);
  return sent;
}

function startOnboardingEmailsWorker() {
  const run = () =>
    runOnboardingEmails().catch((error) => console.error("[onboarding] falha geral", error?.message || error));
  setTimeout(run, 90 * 1000).unref?.();
  setInterval(run, WORKER_INTERVAL_MS).unref?.();
}

module.exports = {
  TIP_EMAILS,
  buildTipEmail,
  completeTour,
  createSampleProject,
  ensureOnboardingSchema,
  findSampleProjectId,
  runOnboardingEmails,
  startOnboardingEmailsWorker,
  unsubscribeTips,
};
