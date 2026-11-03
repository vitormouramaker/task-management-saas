const crypto = require("crypto");
const { postgres } = require("../server/connect");

/**
 * Chat de suporte dentro do Pauta.
 *
 * Cada conversa é de uma pessoa (outros membros da conta não veem). A equipe do
 * Pauta responde pelo painel /admin/suporte. A prioridade e o prazo de
 * referência vêm do plano da conta (entitlements.supportChat/supportPriority).
 */

const CONVERSATION_STATUSES = ["aberta", "respondida", "resolvida"];
const MAX_MESSAGE_LENGTH = 5000;
const BUSINESS_HOURS = "dias úteis, das 9h às 18h (horário de Brasília)";

let schemaReady = null;

function ensureSupportSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      await postgres.query(`
        CREATE TABLE IF NOT EXISTS support_conversations (
          id VARCHAR(100) PRIMARY KEY,
          organization_id VARCHAR(100) REFERENCES organizations(id) ON DELETE CASCADE,
          member_id VARCHAR(100) REFERENCES members(id) ON DELETE SET NULL,
          subject VARCHAR(200) NOT NULL,
          status VARCHAR(20) NOT NULL DEFAULT 'aberta',
          priority INTEGER NOT NULL DEFAULT 0,
          plan_id VARCHAR(40),
          assigned_admin_id VARCHAR(100),
          waiting_since TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          last_message_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          customer_unread INTEGER NOT NULL DEFAULT 0,
          team_unread INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          closed_at TIMESTAMPTZ
        )
      `);
      await postgres.query(`
        CREATE TABLE IF NOT EXISTS support_messages (
          id VARCHAR(100) PRIMARY KEY,
          conversation_id VARCHAR(100) NOT NULL REFERENCES support_conversations(id) ON DELETE CASCADE,
          author_member_id VARCHAR(100) REFERENCES members(id) ON DELETE SET NULL,
          author_type VARCHAR(20) NOT NULL,
          body TEXT NOT NULL,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await postgres.query(`
        CREATE TABLE IF NOT EXISTS support_surveys (
          conversation_id VARCHAR(100) PRIMARY KEY REFERENCES support_conversations(id) ON DELETE CASCADE,
          organization_id VARCHAR(100),
          member_id VARCHAR(100),
          rating INTEGER NOT NULL,
          comment TEXT,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await postgres.query(
        "CREATE INDEX IF NOT EXISTS support_conversations_member_idx ON support_conversations (member_id, last_message_at DESC)",
      );
      await postgres.query(
        "CREATE INDEX IF NOT EXISTS support_conversations_status_idx ON support_conversations (status, priority DESC, waiting_since)",
      );
      await postgres.query(
        "CREATE INDEX IF NOT EXISTS support_messages_conversation_idx ON support_messages (conversation_id, created_at)",
      );
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }

  return schemaReady;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

class SupportError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** O que o plano da conta dá de suporte. */
async function getSupportPolicy(organizationId) {
  const { loadOrganizationBilling, getPlan } = require("./billing.service");
  const billing = await loadOrganizationBilling(organizationId);
  const entitlements = billing.entitlements || {};
  const plan = getPlan(billing.planId);

  return {
    planId: billing.planId,
    planName: plan?.name || billing.planId,
    chat: Boolean(billing.isExempt || entitlements.supportChat),
    priority: Number(entitlements.supportPriority || 0),
    responseTime: entitlements.supportResponseTime || null,
    businessHours: BUSINESS_HOURS,
  };
}

function cleanBody(value) {
  const body = String(value || "").trim();
  if (!body) {
    throw new SupportError(400, "Escreva uma mensagem.");
  }
  if (body.length > MAX_MESSAGE_LENGTH) {
    throw new SupportError(400, `A mensagem pode ter até ${MAX_MESSAGE_LENGTH} caracteres.`);
  }
  return body;
}

function serializeConversation(row) {
  return {
    id: row.id,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    memberId: row.member_id,
    memberName: row.member_name,
    memberEmail: row.member_email,
    subject: row.subject,
    status: row.status,
    priority: row.priority,
    planId: row.plan_id,
    waitingSince: row.status === "aberta" ? row.waiting_since : null,
    lastMessageAt: row.last_message_at,
    lastMessagePreview: row.last_message_preview || null,
    customerUnread: row.customer_unread,
    teamUnread: row.team_unread,
    createdAt: row.created_at,
    closedAt: row.closed_at,
    surveyRating: row.survey_rating ?? null,
    surveyAnswered: row.survey_rating !== null && row.survey_rating !== undefined,
  };
}

function serializeMessage(row) {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    authorType: row.author_type,
    authorName: row.author_type === "team" ? "Equipe Pauta" : row.author_name,
    teamMemberName: row.author_type === "team" ? row.author_name : undefined,
    body: row.body,
    createdAt: row.created_at,
  };
}

const CONVERSATION_SELECT = `
  SELECT
    c.*,
    o.name AS organization_name,
    m.name AS member_name,
    m.email AS member_email,
    (
      SELECT LEFT(sm.body, 140) FROM support_messages sm
      WHERE sm.conversation_id = c.id
      ORDER BY sm.created_at DESC LIMIT 1
    ) AS last_message_preview,
    (SELECT ss.rating FROM support_surveys ss WHERE ss.conversation_id = c.id) AS survey_rating
  FROM support_conversations c
  LEFT JOIN organizations o ON o.id = c.organization_id
  LEFT JOIN members m ON m.id = c.member_id
`;

async function loadConversation(db, id) {
  const result = await db.query(`${CONVERSATION_SELECT} WHERE c.id = $1`, [id]);
  return result.rows[0] || null;
}

async function listMessages(db, conversationId) {
  const result = await db.query(
    `
      SELECT sm.*, m.name AS author_name
      FROM support_messages sm
      LEFT JOIN members m ON m.id = sm.author_member_id
      WHERE sm.conversation_id = $1
      ORDER BY sm.created_at ASC
    `,
    [conversationId],
  );
  return result.rows.map(serializeMessage);
}

async function listPlatformAdminIds() {
  const result = await postgres.query("SELECT id FROM members WHERE is_platform_admin = TRUE");
  return result.rows.map((row) => row.id);
}

function publishSupportEvent(conversation, message, extraUserIds = []) {
  const { publishRealtimeEvent } = require("./realtime.service");
  const userIds = [conversation.member_id, ...extraUserIds].filter(Boolean);
  if (!userIds.length) return;
  publishRealtimeEvent({
    type: "support.updated",
    userIds,
    payload: {
      conversation: serializeConversation(conversation),
      message: message || null,
    },
  });
}

async function notifyTeam(conversation, { reopened = false } = {}) {
  try {
    const { sendSupportEmail } = require("../server/email");
    await sendSupportEmail({
      to: process.env.SUPPORT_EMAIL || "contato@example.com",
      subject: `${reopened ? "Conversa reaberta" : "Novo chamado"} [${conversation.plan_id || "—"}]: ${conversation.subject}`,
      title: reopened ? "Uma conversa de suporte foi reaberta" : "Nova conversa no chat de suporte",
      paragraphs: [
        `<strong>Conta:</strong> ${escapeHtml(conversation.organization_name || "—")} (plano ${escapeHtml(conversation.plan_id || "—")})`,
        `<strong>Pessoa:</strong> ${escapeHtml(conversation.member_name || "—")} &lt;${escapeHtml(conversation.member_email || "—")}&gt;`,
        `<strong>Assunto:</strong> ${escapeHtml(conversation.subject)}`,
        `<strong>Mensagem:</strong> ${escapeHtml(conversation.last_message_preview || "")}`,
      ],
      buttonLabel: "Responder no painel",
      path: `/admin/suporte/${conversation.id}`,
      footer: "Mensagem automática do Pauta.",
    });
  } catch (error) {
    console.error("[suporte] falha ao avisar a equipe", error?.message || error);
  }
}

async function notifyCustomer(conversation, messageBody) {
  if (!conversation.member_email) return;
  try {
    const { sendSupportEmail } = require("../server/email");
    await sendSupportEmail({
      to: conversation.member_email,
      subject: `Resposta do suporte Pauta: ${conversation.subject}`,
      title: "Respondemos sua conversa no suporte",
      paragraphs: [
        `Olá, ${escapeHtml(String(conversation.member_name || "").split(" ")[0] || "tudo bem")}!`,
        `A equipe do Pauta respondeu a conversa <strong>${escapeHtml(conversation.subject)}</strong>:`,
        `<em>${escapeHtml(messageBody.slice(0, 600))}${messageBody.length > 600 ? "…" : ""}</em>`,
      ],
      buttonLabel: "Abrir a conversa",
      path: `/?suporte=${encodeURIComponent(conversation.id)}`,
      footer: "Você recebe este e-mail porque abriu uma conversa no suporte do Pauta.",
    });
  } catch (error) {
    console.error("[suporte] falha ao avisar o cliente", error?.message || error);
  }
}

// ---------------------------------------------------------------------------
// Lado do cliente
// ---------------------------------------------------------------------------
async function listCustomerConversations({ memberId, organizationId }) {
  await ensureSupportSchema();
  const result = await postgres.query(
    `${CONVERSATION_SELECT} WHERE c.member_id = $1 AND c.organization_id = $2 ORDER BY c.last_message_at DESC LIMIT 100`,
    [memberId, organizationId],
  );
  return result.rows.map(serializeConversation);
}

async function assertCustomerConversation(user, id) {
  await ensureSupportSchema();
  const conversation = await loadConversation(postgres, id);
  if (
    !conversation ||
    conversation.member_id !== user.id ||
    conversation.organization_id !== user.organizationId
  ) {
    throw new SupportError(404, "Conversa não encontrada.");
  }
  return conversation;
}

async function startConversation(user, { subject, message }) {
  await ensureSupportSchema();
  const policy = await getSupportPolicy(user.organizationId);
  if (!policy.chat) {
    throw new SupportError(
      403,
      "O chat de suporte está disponível a partir do plano Essencial. No plano Grátis, fale com a gente por e-mail.",
      "SUPPORT_CHAT_UNAVAILABLE",
    );
  }

  const cleanSubject = String(subject || "").trim().slice(0, 200);
  if (cleanSubject.length < 3) {
    throw new SupportError(400, "Informe o assunto da conversa.");
  }
  const body = cleanBody(message);

  const open = await postgres.query(
    "SELECT COUNT(*)::int AS total FROM support_conversations WHERE member_id = $1 AND status <> 'resolvida'",
    [user.id],
  );
  if (open.rows[0].total >= 5) {
    throw new SupportError(429, "Você já tem 5 conversas em andamento. Continue por uma delas.");
  }

  const id = newId("sup");
  const client = await postgres.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `
        INSERT INTO support_conversations
          (id, organization_id, member_id, subject, status, priority, plan_id, team_unread)
        VALUES ($1, $2, $3, $4, 'aberta', $5, $6, 1)
      `,
      [id, user.organizationId, user.id, cleanSubject, policy.priority, policy.planId],
    );
    await client.query(
      "INSERT INTO support_messages (id, conversation_id, author_member_id, author_type, body) VALUES ($1, $2, $3, 'customer', $4)",
      [newId("msg"), id, user.id, body],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  const conversation = await loadConversation(postgres, id);
  const messages = await listMessages(postgres, id);
  publishSupportEvent(conversation, messages[messages.length - 1], await listPlatformAdminIds());
  notifyTeam(conversation);

  return { conversation: serializeConversation(conversation), messages };
}

async function addMessage({ conversation, authorId, authorType, body }) {
  const text = cleanBody(body);
  const policy =
    authorType === "customer" ? await getSupportPolicy(conversation.organization_id) : null;

  if (authorType === "customer" && !policy.chat) {
    throw new SupportError(
      403,
      "O chat de suporte não está disponível no plano atual da conta.",
      "SUPPORT_CHAT_UNAVAILABLE",
    );
  }

  // Conversa encerrada pela equipe não recebe mais mensagem: a pessoa abre
  // uma conversa nova (e, se quiser, responde a pesquisa de satisfação).
  if (authorType === "customer" && conversation.status === "resolvida") {
    throw new SupportError(
      409,
      "Esta conversa foi encerrada pela nossa equipe. Abra uma conversa nova para continuar.",
      "SUPPORT_CONVERSATION_CLOSED",
    );
  }
  const client = await postgres.connect();
  let messageId;
  try {
    await client.query("BEGIN");
    messageId = newId("msg");
    await client.query(
      "INSERT INTO support_messages (id, conversation_id, author_member_id, author_type, body) VALUES ($1, $2, $3, $4, $5)",
      [messageId, conversation.id, authorId, authorType, text],
    );

    if (authorType === "customer") {
      await client.query(
        `
          UPDATE support_conversations
          SET status = 'aberta',
              priority = $2,
              plan_id = $3,
              waiting_since = CASE WHEN status = 'aberta' THEN waiting_since ELSE CURRENT_TIMESTAMP END,
              last_message_at = CURRENT_TIMESTAMP,
              team_unread = team_unread + 1,
              closed_at = NULL
          WHERE id = $1
        `,
        [conversation.id, policy.priority, policy.planId],
      );
    } else {
      await client.query(
        `
          UPDATE support_conversations
          SET status = 'respondida',
              last_message_at = CURRENT_TIMESTAMP,
              customer_unread = customer_unread + 1,
              team_unread = 0,
              assigned_admin_id = COALESCE(assigned_admin_id, $2)
          WHERE id = $1
        `,
        [conversation.id, authorId],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  const updated = await loadConversation(postgres, conversation.id);
  const messages = await listMessages(postgres, conversation.id);
  const message = messages.find((item) => item.id === messageId);
  publishSupportEvent(updated, message, await listPlatformAdminIds());

  if (authorType === "team") {
    notifyCustomer(updated, text);
  }

  return { conversation: serializeConversation(updated), message };
}

async function markRead(conversation, side) {
  const column = side === "team" ? "team_unread" : "customer_unread";
  await postgres.query(`UPDATE support_conversations SET ${column} = 0 WHERE id = $1`, [
    conversation.id,
  ]);
}

async function setStatus(conversation, status, actorIds = []) {
  if (!CONVERSATION_STATUSES.includes(status)) {
    throw new SupportError(400, "Situação inválida.");
  }
  await postgres.query(
    `
      UPDATE support_conversations
      SET status = $2::varchar,
          closed_at = CASE WHEN $2::varchar = 'resolvida' THEN CURRENT_TIMESTAMP ELSE NULL END,
          waiting_since = CASE WHEN $2::varchar = 'aberta' THEN CURRENT_TIMESTAMP ELSE waiting_since END
      WHERE id = $1
    `,
    [conversation.id, status],
  );
  const updated = await loadConversation(postgres, conversation.id);
  publishSupportEvent(updated, null, [...(await listPlatformAdminIds()), ...actorIds]);
  return serializeConversation(updated);
}

// ---------------------------------------------------------------------------
// Lado da equipe
// ---------------------------------------------------------------------------
async function listTeamConversations({ status, search, page = 0 }) {
  await ensureSupportSchema();
  const filters = [];
  const params = [];

  if (status && CONVERSATION_STATUSES.includes(status)) {
    params.push(status);
    filters.push(`c.status = $${params.length}`);
  }
  if (search) {
    params.push(`%${String(search).toLowerCase()}%`);
    filters.push(
      `(lower(c.subject) LIKE $${params.length} OR lower(o.name) LIKE $${params.length} OR lower(m.email) LIKE $${params.length})`,
    );
  }

  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  params.push(50, Math.max(0, Number(page) || 0) * 50);

  const result = await postgres.query(
    `
      ${CONVERSATION_SELECT}
      ${where}
      ORDER BY
        CASE c.status WHEN 'aberta' THEN 0 WHEN 'respondida' THEN 1 ELSE 2 END,
        CASE WHEN c.status = 'aberta' THEN c.priority ELSE 0 END DESC,
        CASE WHEN c.status = 'aberta' THEN c.waiting_since END ASC,
        c.last_message_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `,
    params,
  );

  const counts = await postgres.query(
    "SELECT status, COUNT(*)::int AS total FROM support_conversations GROUP BY status",
  );

  return {
    conversations: result.rows.map(serializeConversation),
    counts: Object.fromEntries(counts.rows.map((row) => [row.status, row.total])),
  };
}

async function loadTeamConversation(id) {
  await ensureSupportSchema();
  const conversation = await loadConversation(postgres, id);
  if (!conversation) {
    throw new SupportError(404, "Conversa não encontrada.");
  }
  return conversation;
}

/** Resposta da pesquisa de satisfação, uma por conversa e só do cliente. */
async function saveSurvey(conversation, memberId, { rating, comment }) {
  const nota = Number(rating);
  if (!Number.isInteger(nota) || nota < 1 || nota > 5) {
    throw new SupportError(400, "Dê uma nota de 1 a 5 para o atendimento.");
  }
  if (conversation.status !== "resolvida") {
    throw new SupportError(409, "A pesquisa aparece quando a equipe encerra a conversa.");
  }

  const gravada = await postgres.query(
    `
      INSERT INTO support_surveys (conversation_id, organization_id, member_id, rating, comment)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (conversation_id) DO NOTHING
      RETURNING conversation_id
    `,
    [
      conversation.id,
      conversation.organization_id,
      memberId,
      nota,
      String(comment || "").slice(0, 2000) || null,
    ],
  );

  if (!gravada.rows[0]) {
    throw new SupportError(409, "Esta conversa já tem uma avaliação.");
  }

  return { rating: nota };
}

/** Avaliações para o painel da equipe. */
async function listSurveys() {
  await ensureSupportSchema();
  const [respostas, media] = await Promise.all([
    postgres.query(`
      SELECT s.conversation_id AS "conversationId", s.rating, s.comment, s.created_at AS "createdAt",
             c.subject, o.name AS "organizationName", m.name AS "memberName",
             a.name AS "teamMemberName"
      FROM support_surveys s
      INNER JOIN support_conversations c ON c.id = s.conversation_id
      LEFT JOIN organizations o ON o.id = s.organization_id
      LEFT JOIN members m ON m.id = s.member_id
      LEFT JOIN members a ON a.id = c.assigned_admin_id
      ORDER BY s.created_at DESC
      LIMIT 100
    `),
    postgres.query(
      "SELECT ROUND(AVG(rating)::numeric, 2) AS media, COUNT(*)::int AS total FROM support_surveys",
    ),
  ]);

  return {
    surveys: respostas.rows,
    average: media.rows[0]?.media ? Number(media.rows[0].media) : null,
    total: media.rows[0]?.total || 0,
  };
}

module.exports = {
  BUSINESS_HOURS,
  CONVERSATION_STATUSES,
  SupportError,
  addMessage,
  assertCustomerConversation,
  ensureSupportSchema,
  getSupportPolicy,
  listCustomerConversations,
  listMessages,
  listTeamConversations,
  loadTeamConversation,
  listSurveys,
  markRead,
  saveSurvey,
  serializeConversation,
  setStatus,
  startConversation,
};
