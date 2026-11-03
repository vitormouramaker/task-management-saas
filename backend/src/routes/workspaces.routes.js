const express = require("express");
const axios = require("axios");
const archiver = require("archiver");
const fs = require("fs");
const path = require("path");
const router = express.Router();
const { postgres } = require("../server/connect");
const { verifyToken } = require("../middlewares/auth.middleware");
const { notificarConhecimento, registrarExclusoes } = require("../services/conhecimento-connector.service");
const {
  receiveUpload,
  releaseStorageUrls,
  resolveTaskStorageContext,
  sendStorageError,
  syncStorageFolderName,
} = require("../services/storage.service");
const { recordStatusChange } = require("../services/reports.service");
const { runForEvent: runAutomations } = require("../services/automations.service");
const {
  moveAttachmentToTrash,
  moveTaskToTrash,
  registerListInTrash,
  registerWorkspaceInTrash,
} = require("../services/trash.service");
const { publishRealtimeEvent } = require("../services/realtime.service");
const { signStorageUrl } = require("../services/storage-url.service");
const {
  storeNotifications,
  dispatchStoredNotifications,
} = require("../services/notification-dispatcher.service");
const { resolveOrganizationBilling } = require("../services/billing.service");

const { BUNNY_PULL_ZONE, BUNNY_PULL_ZONE_PROTOCOL } = require("../services/bunny.service");

function isAllowedAttachmentDownloadUrl(value) {
  try {
    const parsedUrl = new URL(value);
    return (
      // host (e não hostname): a pull zone pode vir com porta.
      parsedUrl.protocol === `${BUNNY_PULL_ZONE_PROTOCOL}:` && parsedUrl.host === BUNNY_PULL_ZONE
    );
  } catch {
    return false;
  }
}

// Os downloads recebem a URL do arquivo: só vale arquivo que a própria
// organização enviou (senão a rota assinava link de arquivo de outra conta).
async function caminhosDaOrganizacao(organizationId, urls) {
  const { extractStoragePathFromUrl } = require("../services/bunny.service");
  const caminhos = urls
    .map((url) => extractStoragePathFromUrl(String(url || "").split("?")[0]))
    .filter(Boolean);
  if (!organizationId || caminhos.length === 0) return new Set();
  const { rows } = await postgres.query(
    "SELECT storage_path FROM storage_files WHERE organization_id = $1 AND storage_path = ANY($2::text[])",
    [organizationId, caminhos],
  );
  return new Set(rows.map((row) => row.storage_path));
}

async function urlDaOrganizacao(organizationId, url) {
  const { extractStoragePathFromUrl } = require("../services/bunny.service");
  const caminho = extractStoragePathFromUrl(String(url || "").split("?")[0]);
  return Boolean(caminho) && (await caminhosDaOrganizacao(organizationId, [url])).has(caminho);
}

function sanitizeDownloadFileName(value, fallback = "anexo") {
  return (
    String(value || fallback)
      .replace(/[\\/:*?"<>|\r\n]+/g, "_")
      .trim() || fallback
  );
}

function ensureZipExtension(fileName) {
  return fileName.toLowerCase().endsWith(".zip") ? fileName : `${fileName}.zip`;
}

// O histórico chega ao front como HTML: nome e descrição (que carregam título
// do card e nome de anexo digitados pelo usuário) sempre escapados.
function escapeActivityText(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function activityHtml(authorName, description) {
  return `<span class="font-bold text-slate-700">${escapeActivityText(authorName)}</span> ${escapeActivityText(description)}`;
}

async function logTaskActivity(client, taskId, authorId, type, description) {
  try {
    const { v4: uuidv4 } = await import("uuid");
    const actId = uuidv4();
    const date = new Date().toISOString();
    await client.query(
      "INSERT INTO task_activities (id, task_id, author_id, type, description, date) VALUES ($1, $2, $3, $4, $5, $6)",
      [actId, taskId, authorId, type, description, date],
    );

    const authorRes = await client.query(
      "SELECT name FROM members WHERE id = $1",
      [authorId],
    );
    const authorName = authorRes.rows[0] ? authorRes.rows[0].name : "Alguém";

    let icon = "system";
    if (type === "status") icon = "status";
    if (type === "comment") icon = "comment";
    if (type === "date") icon = "calendar";
    if (type === "dependency" || type === "link") icon = "link";

    return {
      id: actId,
      type: icon,
      authorId,
      authorName,
      description,
      content: activityHtml(authorName, description),
      date,
    };
  } catch (err) {
    console.error("Erro ao registrar log de atividade:", err);
    return null;
  }
}

function extractMentionIds(rawMentionIds, actorId) {
  if (!Array.isArray(rawMentionIds)) {
    return [];
  }

  return Array.from(
    new Set(
      rawMentionIds
        .filter(
          (mentionId) => typeof mentionId === "string" && mentionId.trim(),
        )
        .map((mentionId) => mentionId.trim())
        .filter((mentionId) => mentionId !== actorId),
    ),
  );
}

function collectUniqueIds(...groups) {
  return Array.from(
    new Set(
      groups
        .flat()
        .filter((value) => typeof value === "string" && value.trim()),
    ),
  );
}

function buildWorkspaceNotificationUrl(workspaceId) {
  return `/?workspaceId=${encodeURIComponent(workspaceId)}`;
}

function buildListNotificationUrl(listId) {
  return `/?listId=${encodeURIComponent(listId)}`;
}

function buildTaskNotificationUrl(taskId) {
  return `/?taskId=${encodeURIComponent(taskId)}`;
}

async function getMemberName(client, memberId) {
  if (!memberId) {
    return "Alguém";
  }

  const memberRes = await client.query(
    "SELECT name FROM members WHERE id = $1",
    [memberId],
  );

  return memberRes.rows[0]?.name || "Alguém";
}

async function getTaskNotificationContext(client, taskId) {
  const taskRes = await client.query(
    'SELECT title, owner_id as "ownerId" FROM tasks WHERE id = $1',
    [taskId],
  );

  return {
    title: taskRes.rows[0]?.title || "uma tarefa",
    ownerId: taskRes.rows[0]?.ownerId || null,
  };
}

async function getTaskAssigneeIds(client, taskId) {
  const assigneesRes = await client.query(
    "SELECT DISTINCT member_id FROM task_assignees WHERE task_id = $1",
    [taskId],
  );

  return assigneesRes.rows
    .map((row) => row.member_id)
    .filter((memberId) => typeof memberId === "string" && memberId.trim());
}

async function ensureTaskWatchersSchema(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS task_watchers (
      task_id VARCHAR(100) REFERENCES tasks(id) ON DELETE CASCADE,
      member_id VARCHAR(100) REFERENCES members(id) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (task_id, member_id)
    )
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_task_watchers_member
    ON task_watchers (member_id)
  `);
}

async function getTaskWatcherIds(client, taskId) {
  try {
    const watchersRes = await client.query(
      "SELECT member_id FROM task_watchers WHERE task_id = $1",
      [taskId],
    );

    return watchersRes.rows
      .map((row) => row.member_id)
      .filter((memberId) => typeof memberId === "string" && memberId.trim());
  } catch (error) {
    // Tabela ainda nao criada neste ambiente: segue sem observadores.
    if (error.code === "42P01") {
      return [];
    }
    throw error;
  }
}

async function getTaskAudienceIds(client, taskId, excludeUserIds = []) {
  const taskContext = await getTaskNotificationContext(client, taskId);
  const audienceIds = new Set(await getTaskAssigneeIds(client, taskId));

  for (const watcherId of await getTaskWatcherIds(client, taskId)) {
    audienceIds.add(watcherId);
  }

  if (taskContext.ownerId) {
    audienceIds.add(taskContext.ownerId);
  }

  const excludedIds = new Set(
    excludeUserIds.filter(
      (memberId) => typeof memberId === "string" && memberId.trim(),
    ),
  );

  return Array.from(audienceIds).filter(
    (memberId) => !excludedIds.has(memberId),
  );
}

function formatNotificationDate(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

async function buildMentionNotifications(
  client,
  { taskId, actorId, mentionIds, source },
) {
  const cleanMentionIds = extractMentionIds(mentionIds, actorId);
  if (cleanMentionIds.length === 0) {
    return [];
  }

  const actorName = await getMemberName(client, actorId);
  const taskContext = await getTaskNotificationContext(client, taskId);

  const mentionedMembersRes = await client.query(
    "SELECT id FROM members WHERE id = ANY($1)",
    [cleanMentionIds],
  );

  return mentionedMembersRes.rows.map((member) => ({
    userId: member.id,
    title: "Você foi mencionado",
    message:
      source === "description"
        ? `${actorName} mencionou você na descrição de ${taskContext.title}`
        : `${actorName} mencionou você em um comentário de ${taskContext.title}`,
    type: "mention",
    referenceId: taskId,
    createdBy: actorId,
    url: buildTaskNotificationUrl(taskId),
  }));
}

async function buildTaskCommentNotifications(
  client,
  { taskId, actorId, mentionIds },
) {
  const excludedIds = new Set([
    actorId,
    ...extractMentionIds(mentionIds, actorId),
  ]);

  const actorName = await getMemberName(client, actorId);
  const taskContext = await getTaskNotificationContext(client, taskId);
  const recipientIds = new Set(await getTaskAssigneeIds(client, taskId));

  for (const watcherId of await getTaskWatcherIds(client, taskId)) {
    recipientIds.add(watcherId);
  }

  if (taskContext.ownerId) {
    recipientIds.add(taskContext.ownerId);
  }

  return Array.from(recipientIds)
    .filter((memberId) => !excludedIds.has(memberId))
    .map((memberId) => ({
      userId: memberId,
      title: "Novo comentário em tarefa",
      message: `${actorName} comentou na tarefa ${taskContext.title}`,
      type: "comment",
      referenceId: taskId,
      createdBy: actorId,
      url: buildTaskNotificationUrl(taskId),
    }));
}

async function buildTaskDueDateChangeNotifications(
  client,
  { taskId, actorId, dueDate, excludeUserIds = [] },
) {
  const actorName = await getMemberName(client, actorId);
  const taskContext = await getTaskNotificationContext(client, taskId);
  const dueDateLabel = formatNotificationDate(dueDate);

  return (
    await getTaskAudienceIds(client, taskId, [actorId, ...excludeUserIds])
  ).map((memberId) => ({
    userId: memberId,
    title: dueDateLabel ? "Prazo atualizado" : "Prazo removido",
    message: dueDateLabel
      ? `${actorName} alterou o prazo da tarefa ${taskContext.title} para ${dueDateLabel}`
      : `${actorName} removeu o prazo da tarefa ${taskContext.title}`,
    type: "TASK_DUE_DATE_CHANGED",
    referenceId: taskId,
    createdBy: actorId,
    url: buildTaskNotificationUrl(taskId),
  }));
}

async function buildTaskAttachmentAddedNotifications(
  client,
  { taskId, actorId, attachmentName },
) {
  const actorName = await getMemberName(client, actorId);
  const taskContext = await getTaskNotificationContext(client, taskId);

  return (await getTaskAudienceIds(client, taskId, [actorId])).map(
    (memberId) => ({
      userId: memberId,
      title: "Novo anexo na tarefa",
      message: `${actorName} anexou ${attachmentName} na tarefa ${taskContext.title}`,
      type: "TASK_ATTACHMENT_ADDED",
      referenceId: taskId,
      createdBy: actorId,
      url: buildTaskNotificationUrl(taskId),
    }),
  );
}

async function buildTaskLinkNotifications(
  client,
  { taskId, linkedTaskId, actorId, action },
) {
  const actorName = await getMemberName(client, actorId);
  const sourceTask = await getTaskNotificationContext(client, taskId);
  const linkedTask = await getTaskNotificationContext(client, linkedTaskId);
  const audienceIds = new Set([
    ...(await getTaskAudienceIds(client, taskId, [actorId])),
    ...(await getTaskAudienceIds(client, linkedTaskId, [actorId])),
  ]);

  const isLinkAction = action === "linked";

  return Array.from(audienceIds).map((memberId) => ({
    userId: memberId,
    title: isLinkAction ? "Tarefas vinculadas" : "Vínculo removido",
    message: isLinkAction
      ? `${actorName} vinculou ${sourceTask.title} com ${linkedTask.title}`
      : `${actorName} removeu o vínculo entre ${sourceTask.title} e ${linkedTask.title}`,
    type: isLinkAction ? "TASK_LINKED" : "TASK_UNLINKED",
    referenceId: taskId,
    createdBy: actorId,
    url: buildTaskNotificationUrl(taskId),
  }));
}

async function buildTaskStatusChangeNotifications(
  client,
  { taskId, actorId, statusId, excludeUserIds = [] },
) {
  const actorName = await getMemberName(client, actorId);
  const taskContext = await getTaskNotificationContext(client, taskId);
  const statusRes = await client.query(
    "SELECT name FROM status_definitions WHERE id = $1",
    [statusId],
  );
  const statusName = statusRes.rows[0]?.name || "novo status";
  const excluded = new Set([actorId, ...excludeUserIds]);
  const recipientIds = new Set([
    ...(await getTaskAssigneeIds(client, taskId)),
    ...(await getTaskWatcherIds(client, taskId)),
  ]);

  return Array.from(recipientIds)
    .filter((memberId) => !excluded.has(memberId))
    .map((memberId) => ({
      userId: memberId,
      title: "Card movido",
      message: `${actorName} moveu o card ${taskContext.title} para ${statusName}`,
      type: "TASK_STATUS_CHANGED",
      referenceId: taskId,
      createdBy: actorId,
      url: buildTaskNotificationUrl(taskId),
    }));
}

async function buildSubtaskCreatedNotifications(
  client,
  { parentTaskId, subtaskId, actorId, subtaskTitle },
) {
  const actorName = await getMemberName(client, actorId);

  return (await getTaskAssigneeIds(client, parentTaskId))
    .filter((memberId) => memberId !== actorId)
    .map((memberId) => ({
      userId: memberId,
      title: "Nova subtarefa",
      message: `${actorName} criou a subtarefa ${subtaskTitle} em uma tarefa atribuída a você`,
      type: "SUBTASK_CREATED",
      referenceId: subtaskId,
      createdBy: actorId,
      url: buildTaskNotificationUrl(subtaskId),
    }));
}

async function buildChecklistItemAssignmentNotification(
  client,
  { itemId, memberId, actorId },
) {
  if (!memberId || memberId === actorId) {
    return [];
  }

  const actorName = await getMemberName(client, actorId);
  const itemRes = await client.query(
    `SELECT
       i.label,
       c.task_id as "taskId",
       t.title as "taskTitle"
     FROM checklist_items i
     JOIN checklists c ON c.id = i.checklist_id
     JOIN tasks t ON t.id = c.task_id
     WHERE i.id = $1`,
    [itemId],
  );

  const item = itemRes.rows[0];
  if (!item?.taskId) {
    return [];
  }

  return [
    {
      userId: memberId,
      title: "Item de checklist atribuído",
      message: `${actorName} atribuiu a você o item ${item.label} em ${item.taskTitle}`,
      type: "CHECKLIST_ITEM_ASSIGNED",
      referenceId: item.taskId,
      createdBy: actorId,
      url: buildTaskNotificationUrl(item.taskId),
    },
  ];
}

async function buildTaskRealtimeSnapshot(client, taskId) {
  await ensureTaskCoverSchema(client);
  await ensureCustomFieldsSchema(client);
  await ensureTaskWatchersSchema(client);

  const taskRes = await client.query(
    `SELECT
      id,
      workspace_id as "workspaceId",
      space_id as "spaceId",
      folder_id as "folderId",
      list_id as "listId",
      parent_task_id as "parentTaskId",
      owner_id as "ownerId",
      COALESCE(visibility, 'public') as "visibility",
      title,
      description as "descriptionText",
      COALESCE(description_link_display_modes, '{}'::jsonb) as "descriptionLinkDisplayModes",
      status_id as "statusId",
      priority,
      start_date as "startDate",
      due_date as "dueDate",
      estimate,
      cover_attachment_id as "coverAttachmentId",
      created_at as "createdAt",
      updated_at as "updatedAt"
     FROM tasks
     WHERE id = $1`,
    [taskId],
  );

  if (taskRes.rows.length === 0) {
    return null;
  }

  const task = taskRes.rows[0];
  task.description = {
    format: "html",
    value: task.descriptionText || "",
  };
  delete task.descriptionText;

  const assigneesRes = await client.query(
    "SELECT member_id FROM task_assignees WHERE task_id = $1",
    [taskId],
  );
  task.assigneeIds = assigneesRes.rows.map((row) => row.member_id);
  task.watcherIds = await getTaskWatcherIds(client, taskId);

  const tagsRes = await client.query(
    "SELECT t.id, t.name, t.color FROM tags t JOIN task_tags tt ON t.id = tt.tag_id WHERE tt.task_id = $1",
    [taskId],
  );
  task.tags = tagsRes.rows;

  const subtasksRes = await client.query(
    "SELECT id FROM tasks WHERE parent_task_id = $1",
    [taskId],
  );
  task.subtaskIds = subtasksRes.rows.map((row) => row.id);

  const checklistsRes = await client.query(
    "SELECT id, name FROM checklists WHERE task_id = $1 ORDER BY created_at ASC",
    [taskId],
  );
  task.checklists = [];
  for (const checklist of checklistsRes.rows) {
    const itemsRes = await client.query(
      "SELECT id, label, done FROM checklist_items WHERE checklist_id = $1 ORDER BY created_at ASC",
      [checklist.id],
    );
    const items = [];
    for (const item of itemsRes.rows) {
      const itemAssigneesRes = await client.query(
        "SELECT member_id FROM checklist_item_assignees WHERE checklist_item_id = $1",
        [item.id],
      );
      items.push({
        ...item,
        assigneeIds: itemAssigneesRes.rows.map((row) => row.member_id),
      });
    }

    task.checklists.push({
      id: checklist.id,
      name: checklist.name,
      items,
    });
  }

  const attachmentsRes = await client.query(
    `SELECT
      a.id,
      a.name,
      a.url,
      a.type,
      a.size,
      a.created_at as "createdAt",
      a.uploaded_by as "uploadedById",
      m.name as "uploadedByName",
      m.avatar_color as "uploadedByAvatarColor",
      m.avatar_url as "uploadedByAvatarUrl"
     FROM task_attachments a
     LEFT JOIN members m ON m.id = a.uploaded_by
     WHERE a.task_id = $1
     ORDER BY a.created_at ASC`,
    [taskId],
  );
  task.attachments = attachmentsRes.rows.map((attachment) => ({
    ...attachment,
    size: Number(attachment.size),
  }));

  const linksRes = await client.query(
    "SELECT linked_task_id FROM task_links WHERE task_id = $1 UNION SELECT task_id FROM task_links WHERE linked_task_id = $1",
    [taskId],
  );
  task.linkedTaskIds = linksRes.rows.map(
    (row) => row.linked_task_id || row.task_id,
  );

  task.commentIds = [];
  task.activities = [];
  task.customFieldValues =
    (await loadTaskCustomFieldValues(client, [taskId]))[taskId] || {};

  return task;
}

async function notifyWikiConnector(taskId, event = "updated") {
  const url = process.env.WIKI_CONNECTOR_URL;
  if (!url) return;
  try {
    await axios.post(
      `${url}/ingest`,
      { taskId, event },
      {
        timeout: 3000,
        headers: {
          "X-Connector-Secret": process.env.WIKI_CONNECTOR_SECRET || "",
        },
      },
    );
  } catch {
    // fire-and-forget: erros do connector não afetam o app
  }
}

async function emitTaskUpdatedRealtime(
  client,
  { taskId, actorId, activities = [] },
) {
  const task = await buildTaskRealtimeSnapshot(client, taskId);
  if (!task) {
    return null;
  }

  publishRealtimeEvent({
    type: "task.updated",
    actorId,
    workspaceId: task.workspaceId,
    excludeUserIds: actorId ? [actorId] : [],
    payload: {
      task,
      activities: activities.filter(Boolean),
    },
  });

  notifyWikiConnector(taskId).catch(() => {});
  notificarConhecimento(taskId);

  return task;
}

function publishSeedRefetch({
  actorId = null,
  organizationId = null,
  workspaceId = null,
  workspaceIds = [],
  userIds = [],
  excludeUserIds = [],
  reason = null,
}) {
  publishRealtimeEvent({
    type: "seed.refetch",
    actorId,
    organizationId,
    workspaceId,
    workspaceIds,
    userIds,
    excludeUserIds,
    payload: {
      reason,
    },
  });
}

async function getTaskCommentsSchema(client) {
  await client.query(`
    ALTER TABLE task_comments
    ADD COLUMN IF NOT EXISTS link_display_modes JSONB DEFAULT '{}'::jsonb
  `);
  await client.query(`
    ALTER TABLE task_comments
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN IF NOT EXISTS attachment_name VARCHAR(255),
    ADD COLUMN IF NOT EXISTS attachment_url VARCHAR(500),
    ADD COLUMN IF NOT EXISTS attachment_type VARCHAR(50),
    ADD COLUMN IF NOT EXISTS attachment_size BIGINT,
    ADD COLUMN IF NOT EXISTS liked_user_ids TEXT[] DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN IF NOT EXISTS reaction VARCHAR(32)
  `);

  const colsRes = await client.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'task_comments'
  `);

  const cols = new Set(colsRes.rows.map((r) => r.column_name));
  return {
    hasAuthorId: cols.has("author_id"),
    hasUserId: cols.has("user_id"),
    hasUpdatedAt: cols.has("updated_at"),
    hasAttachmentName: cols.has("attachment_name"),
    hasAttachmentUrl: cols.has("attachment_url"),
    hasAttachmentType: cols.has("attachment_type"),
    hasAttachmentSize: cols.has("attachment_size"),
    hasLikedUserIds: cols.has("liked_user_ids"),
    hasReaction: cols.has("reaction"),
    hasLinkDisplayModes: cols.has("link_display_modes"),
  };
}

async function ensureWorkspacePermissionSchema(client) {
  await client.query(`
    ALTER TABLE workspaces
    ADD COLUMN IF NOT EXISTS default_permission_level VARCHAR(50) DEFAULT 'Edição total',
    ADD COLUMN IF NOT EXISTS color VARCHAR(20) DEFAULT '#3b82f6'
  `);
  await client.query(`
    ALTER TABLE tasks
    ADD COLUMN IF NOT EXISTS owner_id VARCHAR(100) REFERENCES members(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS visibility VARCHAR(50) DEFAULT 'public'
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS member_tags (
      member_id VARCHAR(100) REFERENCES members(id) ON DELETE CASCADE,
      tag_id VARCHAR(100) REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (member_id, tag_id)
    )
  `);
}

async function ensureTaskCoverSchema(client) {
  await client.query(`
    ALTER TABLE tasks
    ADD COLUMN IF NOT EXISTS cover_attachment_id VARCHAR(100),
    ADD COLUMN IF NOT EXISTS description_link_display_modes JSONB DEFAULT '{}'::jsonb
  `);
  await client.query(`
    ALTER TABLE task_attachments
    ADD COLUMN IF NOT EXISTS uploaded_by VARCHAR(100) REFERENCES members(id) ON DELETE SET NULL
  `);
  await client.query(`
    ALTER TABLE task_comments
    ADD COLUMN IF NOT EXISTS link_display_modes JSONB DEFAULT '{}'::jsonb
  `);
}

async function ensureCustomFieldsSchema(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS workspace_custom_fields (
      id VARCHAR(100) PRIMARY KEY,
      workspace_id VARCHAR(100) REFERENCES workspaces(id) ON DELETE CASCADE,
      name VARCHAR(150) NOT NULL,
      field_type VARCHAR(50) NOT NULL,
      is_required BOOLEAN DEFAULT false,
      options_json JSONB DEFAULT '[]'::jsonb,
      default_value_json JSONB DEFAULT 'null'::jsonb,
      display_order INTEGER DEFAULT 0,
      visible_on_dashboard BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      deleted_at TIMESTAMP NULL
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS task_custom_field_values (
      task_id VARCHAR(100) REFERENCES tasks(id) ON DELETE CASCADE,
      field_id VARCHAR(100) REFERENCES workspace_custom_fields(id) ON DELETE CASCADE,
      value_json JSONB DEFAULT 'null'::jsonb,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (task_id, field_id)
    )
  `);
}

async function loadTaskCustomFieldValues(client, taskIds) {
  if (!Array.isArray(taskIds) || taskIds.length === 0) {
    return {};
  }

  const valuesRes = await client.query(
    `
      SELECT
        task_id as "taskId",
        field_id as "fieldId",
        value_json as "value"
      FROM task_custom_field_values
      WHERE task_id = ANY($1)
    `,
    [taskIds],
  );

  return valuesRes.rows.reduce((accumulator, row) => {
    if (!accumulator[row.taskId]) {
      accumulator[row.taskId] = {};
    }

    accumulator[row.taskId][row.fieldId] = row.value;
    return accumulator;
  }, {});
}

const CUSTOM_FIELD_TYPES = new Set([
  "text",
  "number",
  "date",
  "checkbox",
  "single_select",
]);

function normalizeCustomFieldType(value) {
  return CUSTOM_FIELD_TYPES.has(value) ? value : null;
}

function normalizeCustomFieldOptions(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((option, index) => {
      if (typeof option === "string") {
        const label = option.trim();
        if (!label) {
          return null;
        }

        return {
          id: `cfo_${index}_${Math.random().toString(36).slice(2, 8)}`,
          label,
          color: null,
        };
      }

      if (!option || typeof option !== "object") {
        return null;
      }

      const label = String(option.label || "").trim();
      if (!label) {
        return null;
      }

      return {
        id:
          typeof option.id === "string" && option.id.trim()
            ? option.id.trim()
            : `cfo_${index}_${Math.random().toString(36).slice(2, 8)}`,
        label,
        color:
          typeof option.color === "string" && option.color.trim()
            ? option.color.trim()
            : null,
      };
    })
    .filter(Boolean);
}

function serializeCustomFieldDefinition(row) {
  return {
    id: row.id,
    workspaceId: row.workspaceId || row.workspace_id,
    name: row.name,
    type: row.type || row.field_type,
    required: Boolean(row.required ?? row.is_required),
    options: Array.isArray(row.options ?? row.options_json)
      ? (row.options ?? row.options_json)
      : [],
    defaultValue:
      row.defaultValue !== undefined
        ? row.defaultValue
        : row.default_value_json !== undefined
          ? row.default_value_json
          : null,
    displayOrder: Number(row.displayOrder ?? row.display_order ?? 0),
    visibleOnDashboard: Boolean(
      row.visibleOnDashboard ?? row.visible_on_dashboard,
    ),
    createdAt: row.createdAt || row.created_at,
    updatedAt: row.updatedAt || row.updated_at,
  };
}

async function loadWorkspaceCustomFieldDefinitions(client, workspaceId) {
  const fieldsRes = await client.query(
    `
      SELECT
        id,
        workspace_id as "workspaceId",
        name,
        field_type as "type",
        is_required as "required",
        options_json as "options",
        default_value_json as "defaultValue",
        display_order as "displayOrder",
        visible_on_dashboard as "visibleOnDashboard",
        created_at as "createdAt",
        updated_at as "updatedAt"
      FROM workspace_custom_fields
      WHERE workspace_id = $1
        AND deleted_at IS NULL
      ORDER BY display_order ASC, name ASC
    `,
    [workspaceId],
  );

  return fieldsRes.rows.map(serializeCustomFieldDefinition);
}

function normalizeTaskCustomFieldValue(field, rawValue) {
  if (rawValue === undefined || rawValue === null || rawValue === "") {
    return { value: null };
  }

  if (field.type === "text") {
    const value = String(rawValue).trim();
    return { value: value || null };
  }

  if (field.type === "number") {
    const value =
      typeof rawValue === "number"
        ? rawValue
        : Number(String(rawValue).trim().replace(",", "."));

    if (Number.isNaN(value)) {
      return { error: `O campo \"${field.name}\" precisa ser numérico.` };
    }

    return { value };
  }

  if (field.type === "date") {
    const value = String(rawValue).trim();
    if (!value) {
      return { value: null };
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return {
        error: `O campo \"${field.name}\" precisa ter uma data válida.`,
      };
    }

    return { value };
  }

  if (field.type === "checkbox") {
    if (typeof rawValue === "boolean") {
      return { value: rawValue };
    }

    if (rawValue === "true" || rawValue === "1" || rawValue === 1) {
      return { value: true };
    }

    if (rawValue === "false" || rawValue === "0" || rawValue === 0) {
      return { value: false };
    }

    return {
      error: `O campo \"${field.name}\" precisa ser verdadeiro ou falso.`,
    };
  }

  if (field.type === "single_select") {
    const optionValue = String(rawValue).trim();
    if (!optionValue) {
      return { value: null };
    }

    const option = (field.options || []).find(
      (item) => item.id === optionValue || item.label === optionValue,
    );

    if (!option) {
      return {
        error: `O campo \"${field.name}\" recebeu uma opção inválida.`,
      };
    }

    return { value: option.id };
  }

  return { value: null };
}

function areTaskCustomFieldMapsEqual(left, right) {
  const leftMap = left || {};
  const rightMap = right || {};
  const keys = Array.from(
    new Set([...Object.keys(leftMap), ...Object.keys(rightMap)]),
  ).sort();

  return keys.every(
    (key) => JSON.stringify(leftMap[key]) === JSON.stringify(rightMap[key]),
  );
}

async function persistTaskCustomFieldValues(
  client,
  taskId,
  workspaceId,
  rawValues,
) {
  await ensureCustomFieldsSchema(client);
  const definitions = await loadWorkspaceCustomFieldDefinitions(
    client,
    workspaceId,
  );
  const inputValues =
    rawValues && typeof rawValues === "object" && !Array.isArray(rawValues)
      ? rawValues
      : {};
  const normalizedValues = {};

  for (const field of definitions) {
    const { value, error } = normalizeTaskCustomFieldValue(
      field,
      inputValues[field.id],
    );

    if (error) {
      return { error };
    }

    if (field.required && value === null) {
      return {
        error: `O campo obrigatório \"${field.name}\" precisa ser preenchido.`,
      };
    }

    if (value !== null) {
      normalizedValues[field.id] = value;
    }
  }

  await client.query(
    "DELETE FROM task_custom_field_values WHERE task_id = $1",
    [taskId],
  );

  for (const [fieldId, value] of Object.entries(normalizedValues)) {
    await client.query(
      `
        INSERT INTO task_custom_field_values (task_id, field_id, value_json)
        VALUES ($1, $2, $3::jsonb)
      `,
      [taskId, fieldId, JSON.stringify(value)],
    );
  }

  return { values: normalizedValues };
}

async function backfillTaskOwnerIds(client) {
  await client.query(`
    UPDATE tasks t
    SET owner_id = COALESCE(
      (
        SELECT a.author_id
        FROM task_activities a
        WHERE a.task_id = t.id
          AND a.author_id IS NOT NULL
        ORDER BY a.date ASC
        LIMIT 1
      ),
      (
        SELECT COALESCE(to_jsonb(c)->>'author_id', to_jsonb(c)->>'user_id')
        FROM task_comments c
        WHERE c.task_id = t.id
        ORDER BY c.created_at ASC
        LIMIT 1
      ),
      (
        SELECT ta.member_id
        FROM task_assignees ta
        WHERE ta.task_id = t.id
        ORDER BY ta.member_id ASC
        LIMIT 1
      ),
      (
        SELECT l.owner_id
        FROM lists l
        WHERE l.id = t.list_id
        LIMIT 1
      ),
      (
        SELECT w.owner_id
        FROM workspaces w
        WHERE w.id = t.workspace_id
        LIMIT 1
      )
    )
    WHERE t.owner_id IS NULL
  `);
}

async function ensureDefaultStatusColors(client) {
  await client.query(`
    UPDATE status_definitions
    SET
      color_class = 'bg-violet-50/50',
      chip_class = 'bg-violet-100 text-violet-700 ring-violet-200',
      dot_class = 'bg-violet-500'
    WHERE id = 'st_review'
  `);

  await client.query(`
    UPDATE status_definitions
    SET
      color_class = 'bg-emerald-50/50',
      chip_class = 'bg-emerald-100 text-emerald-700 ring-emerald-200',
      dot_class = 'bg-emerald-500'
    WHERE id = 'st_done'
  `);
}

// Garante a coluna list_id em status_definitions (colunas por projeto/lista).
// NULL = status global (padrão, compartilhado por todas as listas).
async function ensureStatusListSchema(client) {
  await client.query(`
    ALTER TABLE status_definitions
    ADD COLUMN IF NOT EXISTS list_id VARCHAR(100) REFERENCES lists(id) ON DELETE CASCADE
  `);
  // Override por lista: esconde uma coluna global (list_id NULL) apenas em uma
  // lista/projeto específico, sem afetar as demais. Usado quando o admin edita
  // uma coluna padrão dentro de um projeto (fork da coluna global).
  await client.query(`
    CREATE TABLE IF NOT EXISTS status_list_hidden (
      status_id VARCHAR(100) NOT NULL,
      list_id VARCHAR(100) NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
      PRIMARY KEY (status_id, list_id)
    )
  `);
}

const WORKSPACE_PERMISSION_RANK = {
  "Apenas exibição": 0,
  Comentário: 1,
  Editar: 2,
  "Edição total": 3,
};

const WORKSPACE_VIEW_PERMISSION_LEVEL =
  Object.entries(WORKSPACE_PERMISSION_RANK).find(
    ([, rank]) => rank === 0,
  )?.[0] || "Apenas exibição";
const WORKSPACE_COMMENT_PERMISSION_LEVEL =
  Object.entries(WORKSPACE_PERMISSION_RANK).find(
    ([, rank]) => rank === 1,
  )?.[0] || "Comentário";
const WORKSPACE_EDIT_PERMISSION_LEVEL =
  Object.entries(WORKSPACE_PERMISSION_RANK).find(
    ([, rank]) => rank === 2,
  )?.[0] || "Editar";
const WORKSPACE_MANAGE_PERMISSION_LEVEL =
  Object.entries(WORKSPACE_PERMISSION_RANK).find(
    ([, rank]) => rank === 3,
  )?.[0] || "Edição total";

function isWorkspaceAdmin(user) {
  // Titular ou administrador da conta ativa (o cargo não dá permissão).
  return ["owner", "admin"].includes(user?.organizationRole);
}

function isPublicVisibility(visibility) {
  return visibility === "public";
}

function isAdminPrivateVisibility(visibility) {
  return visibility === "admin_private";
}

function normalizeWorkspacePermissionLevel(level) {
  return Object.prototype.hasOwnProperty.call(WORKSPACE_PERMISSION_RANK, level)
    ? level
    : "Apenas exibição";
}

function hasWorkspacePermission(level, requiredLevel) {
  const currentRank =
    WORKSPACE_PERMISSION_RANK[normalizeWorkspacePermissionLevel(level)];
  const requiredRank =
    WORKSPACE_PERMISSION_RANK[normalizeWorkspacePermissionLevel(requiredLevel)];
  return currentRank >= requiredRank;
}

function getWorkspaceTagPermissionLevel(row) {
  return row?.hasMatchingWorkspaceTag ? WORKSPACE_VIEW_PERMISSION_LEVEL : null;
}

function getHigherWorkspacePermissionLevel(...levels) {
  const normalizedLevels = levels
    .filter(Boolean)
    .map((level) => normalizeWorkspacePermissionLevel(level));

  if (normalizedLevels.length === 0) {
    return null;
  }

  return normalizedLevels.reduce((highest, current) =>
    WORKSPACE_PERMISSION_RANK[current] > WORKSPACE_PERMISSION_RANK[highest]
      ? current
      : highest,
  );
}

function resolveScopedAccessPermission({
  isAdmin,
  isOwner,
  visibility,
  memberPermissionLevel,
  isListAssignee,
  taskScopedPermissionLevel,
  workspaceTagPermissionLevel,
  isPublic,
}) {
  if (isOwner) return WORKSPACE_MANAGE_PERMISSION_LEVEL;
  if (isAdminPrivateVisibility(visibility)) return null;
  if (isAdmin) return WORKSPACE_MANAGE_PERMISSION_LEVEL;
  return getHigherWorkspacePermissionLevel(
    memberPermissionLevel,
    isListAssignee ? WORKSPACE_EDIT_PERMISSION_LEVEL : null,
    taskScopedPermissionLevel,
    workspaceTagPermissionLevel,
    isPublic ? WORKSPACE_VIEW_PERMISSION_LEVEL : null,
  );
}

function getScopedTaskPermissionLevel(row) {
  if (row?.isTaskAssignee || row?.hasMatchingTaskTag) {
    return WORKSPACE_COMMENT_PERMISSION_LEVEL;
  }

  if (row?.hasScopedTaskAccess) {
    return WORKSPACE_VIEW_PERMISSION_LEVEL;
  }

  return null;
}

function buildWorkspaceAccess(row, user) {
  if (!row) {
    return { found: false };
  }

  const isAdmin = isWorkspaceAdmin(user);
  const isOwner = row.ownerId === user.id;

  if (
    user.organizationId &&
    row.organizationId &&
    row.organizationId !== user.organizationId
  ) {
    return { found: false };
  }

  const effectivePermission = resolveScopedAccessPermission({
    isAdmin,
    isOwner,
    visibility: row.visibility,
    memberPermissionLevel: row.memberPermissionLevel,
    isListAssignee: Boolean(row.isListAssignee),
    taskScopedPermissionLevel: getScopedTaskPermissionLevel(row),
    workspaceTagPermissionLevel: getWorkspaceTagPermissionLevel(row),
    isPublic: Boolean(row.isPublic),
  });

  return {
    found: true,
    workspaceId: row.workspaceId || row.id,
    isAdmin,
    isOwner,
    visibility: row.visibility || null,
    effectivePermission,
    memberPermissionLevel: row.memberPermissionLevel || null,
    isListAssignee: Boolean(row.isListAssignee),
    isTaskAssignee: Boolean(row.isTaskAssignee),
    hasMatchingTaskTag: Boolean(row.hasMatchingTaskTag),
    hasScopedTaskAccess: Boolean(row.hasScopedTaskAccess),
    hasMatchingWorkspaceTag: Boolean(row.hasMatchingWorkspaceTag),
  };
}

async function getWorkspaceAccessByWorkspaceId(client, user, workspaceId) {
  const res = await client.query(
    `
      SELECT
        w.id,
        w.id as "workspaceId",
        w.organization_id as "organizationId",
        w.owner_id as "ownerId",
        w.visibility,
        w.visibility = 'public' as "isPublic",
        wm.permission_level as "memberPermissionLevel",
        false as "isListAssignee",
        false as "isTaskAssignee",
        false as "hasMatchingTaskTag",
        EXISTS (
          SELECT 1
          FROM tasks t
          LEFT JOIN task_assignees ta
            ON ta.task_id = t.id AND ta.member_id = $2
          LEFT JOIN task_tags tt
            ON tt.task_id = t.id
          LEFT JOIN member_tags mt
            ON mt.tag_id = tt.tag_id AND mt.member_id = $2
          WHERE t.workspace_id = w.id
            AND COALESCE(t.visibility, 'public') <> 'admin_private'
            AND (ta.member_id IS NOT NULL OR mt.member_id IS NOT NULL)
        ) as "hasScopedTaskAccess",
        EXISTS (
          SELECT 1
          FROM workspace_tags wt
          INNER JOIN member_tags mt
            ON mt.tag_id = wt.tag_id
           AND mt.member_id = $2
          WHERE wt.workspace_id = w.id
        ) as "hasMatchingWorkspaceTag"
      FROM workspaces w
      LEFT JOIN workspace_members wm
        ON wm.workspace_id = w.id AND wm.member_id = $2
      WHERE w.id = $1
        AND w.deleted_at IS NULL
    `,
    [workspaceId, user.id],
  );

  return buildWorkspaceAccess(res.rows[0], user);
}

async function getWorkspaceAccessByFolderId(client, user, folderId) {
  const res = await client.query(
    `
      SELECT
        w.id as "workspaceId",
        w.organization_id as "organizationId",
        w.owner_id as "ownerId",
        w.visibility,
        w.visibility = 'public' as "isPublic",
        wm.permission_level as "memberPermissionLevel",
        false as "isListAssignee",
        false as "isTaskAssignee",
        false as "hasMatchingTaskTag",
        EXISTS (
          SELECT 1
          FROM tasks t
          LEFT JOIN task_assignees ta
            ON ta.task_id = t.id AND ta.member_id = $2
          LEFT JOIN task_tags tt
            ON tt.task_id = t.id
          LEFT JOIN member_tags mt
            ON mt.tag_id = tt.tag_id AND mt.member_id = $2
          WHERE t.folder_id = f.id
            AND COALESCE(t.visibility, 'public') <> 'admin_private'
            AND (ta.member_id IS NOT NULL OR mt.member_id IS NOT NULL)
        ) as "hasScopedTaskAccess",
        EXISTS (
          SELECT 1
          FROM workspace_tags wt
          INNER JOIN member_tags mt
            ON mt.tag_id = wt.tag_id
           AND mt.member_id = $2
          WHERE wt.workspace_id = w.id
        ) as "hasMatchingWorkspaceTag"
      FROM folders f
      INNER JOIN spaces s ON s.id = f.space_id
      INNER JOIN workspaces w ON w.id = s.workspace_id
      LEFT JOIN workspace_members wm
        ON wm.workspace_id = w.id AND wm.member_id = $2
      WHERE f.id = $1
        AND w.deleted_at IS NULL
    `,
    [folderId, user.id],
  );

  return buildWorkspaceAccess(res.rows[0], user);
}

async function getWorkspaceAccessByListId(client, user, listId) {
  const res = await client.query(
    `
      SELECT
        w.id as "workspaceId",
        w.organization_id as "organizationId",
        l.owner_id as "ownerId",
        l.visibility,
        l.visibility = 'public' as "isPublic",
        CASE
          WHEN l.visibility = 'public' THEN wm.permission_level
          ELSE NULL
        END as "memberPermissionLevel",
        (la.member_id IS NOT NULL) as "isListAssignee",
        false as "isTaskAssignee",
        false as "hasMatchingTaskTag",
        EXISTS (
          SELECT 1
          FROM tasks t
          LEFT JOIN task_assignees ta
            ON ta.task_id = t.id AND ta.member_id = $2
          LEFT JOIN task_tags tt
            ON tt.task_id = t.id
          LEFT JOIN member_tags mt
            ON mt.tag_id = tt.tag_id AND mt.member_id = $2
          WHERE t.list_id = l.id
            AND COALESCE(t.visibility, 'public') <> 'admin_private'
            AND (ta.member_id IS NOT NULL OR mt.member_id IS NOT NULL)
        ) as "hasScopedTaskAccess",
        EXISTS (
          SELECT 1
          FROM list_tags lt
          INNER JOIN member_tags mt
            ON mt.tag_id = lt.tag_id
           AND mt.member_id = $2
          WHERE lt.list_id = l.id
        ) as "hasMatchingWorkspaceTag"
      FROM lists l
      INNER JOIN folders f ON f.id = l.folder_id
      INNER JOIN spaces s ON s.id = f.space_id
      INNER JOIN workspaces w ON w.id = s.workspace_id
      LEFT JOIN workspace_members wm
        ON wm.workspace_id = w.id AND wm.member_id = $2
      LEFT JOIN list_assignees la
        ON la.list_id = l.id AND la.member_id = $2
      WHERE l.id = $1
        AND l.deleted_at IS NULL
        AND w.deleted_at IS NULL
    `,
    [listId, user.id],
  );

  return buildWorkspaceAccess(res.rows[0], user);
}

async function getWorkspaceAccessByTaskId(client, user, taskId) {
  const res = await client.query(
    `
      SELECT
        w.id as "workspaceId",
        w.organization_id as "organizationId",
        COALESCE(t.owner_id, l.owner_id) as "ownerId",
        -- O card herda a restrição do projeto e do workspace: abrir pelo link
        -- direto não pode dar mais acesso do que o quadro daria.
        CASE
          WHEN 'admin_private' IN (
            COALESCE(t.visibility, 'public'),
            COALESCE(l.visibility, 'public'),
            COALESCE(w.visibility, 'public')
          ) THEN 'admin_private'
          WHEN 'private' IN (
            COALESCE(t.visibility, 'public'),
            COALESCE(l.visibility, 'public'),
            COALESCE(w.visibility, 'public')
          ) THEN 'private'
          ELSE 'public'
        END as "visibility",
        (
          COALESCE(t.visibility, 'public') = 'public'
          AND COALESCE(l.visibility, 'public') = 'public'
          AND COALESCE(w.visibility, 'public') = 'public'
        ) as "isPublic",
        CASE
          WHEN COALESCE(t.visibility, 'public') = 'public' AND l.visibility = 'public'
            THEN wm.permission_level
          ELSE NULL
        END as "memberPermissionLevel",
        (
          COALESCE(t.visibility, 'public') = 'public'
          AND la.member_id IS NOT NULL
        ) as "isListAssignee",
        (ta.member_id IS NOT NULL) as "isTaskAssignee",
        EXISTS (
          SELECT 1
          FROM task_tags tt
          INNER JOIN member_tags mt
            ON mt.tag_id = tt.tag_id
           AND mt.member_id = $2
          WHERE tt.task_id = t.id
        ) as "hasMatchingTaskTag",
        false as "hasScopedTaskAccess",
        CASE
          WHEN COALESCE(t.visibility, 'public') = 'public' THEN EXISTS (
            SELECT 1
            FROM list_tags lt
            INNER JOIN member_tags mt
              ON mt.tag_id = lt.tag_id
             AND mt.member_id = $2
            WHERE lt.list_id = l.id
          )
          ELSE false
        END as "hasMatchingWorkspaceTag"
      FROM tasks t
      INNER JOIN lists l ON l.id = t.list_id
      INNER JOIN folders f ON f.id = l.folder_id
      INNER JOIN spaces s ON s.id = f.space_id
      INNER JOIN workspaces w ON w.id = s.workspace_id
      LEFT JOIN workspace_members wm
        ON wm.workspace_id = w.id AND wm.member_id = $2
      LEFT JOIN list_assignees la
        ON la.list_id = l.id AND la.member_id = $2
      LEFT JOIN task_assignees ta
        ON ta.task_id = t.id AND ta.member_id = $2
      WHERE t.id = $1
        AND l.deleted_at IS NULL
        AND w.deleted_at IS NULL
    `,
    [taskId, user.id],
  );

  return buildWorkspaceAccess(res.rows[0], user);
}

async function getWorkspaceAccessByChecklistId(client, user, checklistId) {
  const res = await client.query(
    'SELECT task_id as "taskId" FROM checklists WHERE id = $1',
    [checklistId],
  );
  if (res.rows.length === 0) return { found: false };
  return getWorkspaceAccessByTaskId(client, user, res.rows[0].taskId);
}

async function getWorkspaceAccessByChecklistItemId(client, user, itemId) {
  const res = await client.query(
    `
      SELECT c.task_id as "taskId"
      FROM checklist_items ci
      INNER JOIN checklists c ON c.id = ci.checklist_id
      WHERE ci.id = $1
    `,
    [itemId],
  );
  if (res.rows.length === 0) return { found: false };
  return getWorkspaceAccessByTaskId(client, user, res.rows[0].taskId);
}

async function getWorkspaceAccessByAttachmentId(client, user, attachmentId) {
  const res = await client.query(
    'SELECT task_id as "taskId" FROM task_attachments WHERE id = $1',
    [attachmentId],
  );
  if (res.rows.length === 0) return { found: false };
  return getWorkspaceAccessByTaskId(client, user, res.rows[0].taskId);
}

async function getWorkspaceAccessByCommentId(client, user, commentId) {
  const res = await client.query(
    'SELECT task_id as "taskId" FROM task_comments WHERE id = $1',
    [commentId],
  );
  if (res.rows.length === 0) return { found: false };
  return getWorkspaceAccessByTaskId(client, user, res.rows[0].taskId);
}

function ensureWorkspacePermission(res, access, requiredLevel) {
  if (!access.found) {
    res.status(404).json({ message: "Entidade não encontrada." });
    return false;
  }

  if (
    !access.effectivePermission ||
    !hasWorkspacePermission(access.effectivePermission, requiredLevel)
  ) {
    res.status(403).json({
      message: `Você não tem permissão para ${requiredLevel === "Comentário" ? "comentar" : "editar"} neste espaço.`,
    });
    return false;
  }

  return true;
}

function canMoveTaskByAccess(access) {
  if (!access?.found) {
    return false;
  }

  return Boolean(
    access.isAdmin ||
    access.effectivePermission === "Edição total" ||
    access.isTaskAssignee,
  );
}

function isStatusOnlyTaskUpdate(body) {
  const definedKeys = Object.entries(body || {})
    .filter(([, value]) => value !== undefined)
    .map(([key]) => key);

  return definedKeys.length === 1 && definedKeys[0] === "statusId";
}

function ensureWorkspaceManagement(res, access) {
  if (!access.found) {
    res.status(404).json({ message: "Espaço não encontrado." });
    return false;
  }

  const canManage =
    access.isOwner || access.effectivePermission === "Edição total";

  if (!canManage) {
    res.status(403).json({
      message: "Você não tem permissão para gerenciar este espaço.",
    });
    return false;
  }

  return true;
}

router.get("/seed", verifyToken, async (req, res) => {
  const userId = req.user.id;
  const organizationId = req.user.organizationId;
  let client;

  if (!organizationId) {
    return res.status(403).json({
      message: "Conta sem empresa ativa. Faça login novamente.",
    });
  }

  try {
    client = await postgres.connect();
    await ensureWorkspacePermissionSchema(client);
    await ensureTaskCoverSchema(client);
    await ensureCustomFieldsSchema(client);
    await backfillTaskOwnerIds(client);
    await ensureDefaultStatusColors(client);
    await ensureStatusListSchema(client);
    await ensureTaskWatchersSchema(client);

    // Arrays para chaves resultantes
    const graph = {
      workspaces: {},
      spaces: {},
      folders: {},
      lists: {},
      tasks: {},
      comments: {},
      members: {},
      statusDefinitions: [],
      tags: {},
      customFieldDefinitions: {},
    };

    const commentsByTaskId = {};

    // 1. Members
    const membersRes = await client.query(
      `
        SELECT
          m.id,
          m.name,
          m.email,
          m.role,
          m.avatar_color as "avatarColor",
          m.avatar_url as "avatarUrl",
          om.role as "accessRole"
        FROM members m
        INNER JOIN organization_members om ON om.member_id = m.id
        WHERE om.organization_id = $1
          AND om.status = 'active'
      `,
      [organizationId],
    );
    membersRes.rows.forEach((row) => {
      row.tags = [];
      row.tagIds = [];
      graph.members[row.id] = row;
    });

    // 2. StatusDefs
    await ensureStatusListSchema(client);
    const statusRes = await client.query(
      'SELECT id, name, color_class as "colorClass", chip_class as "chipClass", dot_class as "dotClass", display_order as "order", list_id as "listId" FROM status_definitions ORDER BY display_order ASC',
    );
    const dbStatuses = statusRes.rows;
    // Overrides: colunas globais escondidas por lista (fork de coluna padrão).
    const hiddenRes = await client.query(
      "SELECT status_id, list_id FROM status_list_hidden",
    );
    const hiddenByStatusId = {};
    hiddenRes.rows.forEach((row) => {
      (hiddenByStatusId[row.status_id] ||= []).push(row.list_id);
    });
    dbStatuses.forEach((s) => {
      s.hiddenListIds = hiddenByStatusId[s.id] || [];
    });
    // Se não houver status inseridos, criar alguns dinâmicos (fallback)
    if (dbStatuses.length === 0) {
      // Insert initial statuses into database
      const initialStatuses = [
        {
          id: "st_backlog",
          name: "Lista de Espera",
          colorClass: "bg-slate-50",
          chipClass: "bg-slate-100 text-slate-700 ring-slate-200",
          dotClass: "bg-slate-500",
          order: 1,
        },
        {
          id: "st_todo",
          name: "A Fazer",
          colorClass: "bg-blue-50/50",
          chipClass: "bg-sky-100 text-sky-700 ring-sky-200",
          dotClass: "bg-blue-600",
          order: 2,
        },
        {
          id: "st_progress",
          name: "Em Andamento",
          colorClass: "bg-orange-50/50",
          chipClass: "bg-amber-100 text-amber-700 ring-amber-200",
          dotClass: "bg-orange-500",
          order: 3,
        },
        {
          id: "st_review",
          name: "Em Revisão",
          colorClass: "bg-violet-50/50",
          chipClass: "bg-violet-100 text-violet-700 ring-violet-200",
          dotClass: "bg-violet-500",
          order: 4,
        },
        {
          id: "st_done",
          name: "Concluído",
          colorClass: "bg-emerald-50/50",
          chipClass: "bg-emerald-100 text-emerald-700 ring-emerald-200",
          dotClass: "bg-emerald-500",
          order: 5,
        },
      ];

      for (const s of initialStatuses) {
        await client.query(
          `INSERT INTO status_definitions (id, name, color_class, chip_class, dot_class, display_order) 
                 VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`,
          [s.id, s.name, s.colorClass, s.chipClass, s.dotClass, s.order],
        );
      }
      graph.statusDefinitions = initialStatuses;
    } else {
      graph.statusDefinitions = dbStatuses;
    }

    // 3. Tags
    const tagsRes = await client.query(
      'SELECT id, name, color, organization_id as "organizationId" FROM tags WHERE organization_id = $1',
      [organizationId],
    );
    tagsRes.rows.forEach((row) => (graph.tags[row.id] = row));
    const memberTagsRes = await client.query(
      `
        SELECT mt.member_id as "memberId", mt.tag_id as "tagId"
        FROM member_tags mt
        INNER JOIN tags t ON t.id = mt.tag_id
        WHERE t.organization_id = $1
      `,
      [organizationId],
    );
    memberTagsRes.rows.forEach((row) => {
      if (graph.members[row.memberId] && graph.tags[row.tagId]) {
        graph.members[row.memberId].tags.push(graph.tags[row.tagId]);
        graph.members[row.memberId].tagIds.push(row.tagId);
      }
    });
    const currentUserTagIds = graph.members[userId]?.tagIds || [];
    const currentUserIsAdmin = isWorkspaceAdmin(req.user);
    const wsAccessFilter = `
          AND (
            w.owner_id = $1
            OR (
              w.visibility <> 'admin_private'
              AND (
                ${currentUserIsAdmin ? "true" : "false"}
                OR w.visibility = 'public'
                OR wm.member_id = $1
                OR EXISTS (
                  SELECT 1
                  FROM lists l
                  INNER JOIN folders f ON f.id = l.folder_id
                  INNER JOIN spaces s ON s.id = f.space_id
                  LEFT JOIN list_assignees la
                    ON la.list_id = l.id AND la.member_id = $1
                  LEFT JOIN list_tags lt
                    ON lt.list_id = l.id
                  LEFT JOIN member_tags mt
                    ON mt.tag_id = lt.tag_id AND mt.member_id = $1
                  WHERE s.workspace_id = w.id
                    AND l.deleted_at IS NULL
                    AND l.visibility <> 'admin_private'
                    AND (
                      l.visibility = 'public'
                      OR l.owner_id = $1
                      OR la.member_id IS NOT NULL
                      OR mt.member_id IS NOT NULL
                    )
                )
                OR EXISTS (
                  SELECT 1
                  FROM workspace_tags wt
                  INNER JOIN member_tags mt
                    ON mt.tag_id = wt.tag_id
                   AND mt.member_id = $1
                  WHERE wt.workspace_id = w.id
                )
                OR EXISTS (
                  SELECT 1
                  FROM tasks t
                  LEFT JOIN task_assignees ta
                    ON ta.task_id = t.id AND ta.member_id = $1
                  LEFT JOIN task_tags tt
                    ON tt.task_id = t.id
                  LEFT JOIN member_tags mt
                    ON mt.tag_id = tt.tag_id AND mt.member_id = $1
                  WHERE t.workspace_id = w.id
                    AND COALESCE(t.visibility, 'public') <> 'admin_private'
                    AND (ta.member_id IS NOT NULL OR mt.member_id IS NOT NULL)
                )
              )
            )
          )
        `;

    const wsRes = await client.query(
      `
        SELECT DISTINCT
          w.id,
          w.name,
          w.description,
          w.color,
          w.visibility,
          w.icon,
          w.created_at as "createdAt",
          w.owner_id as "ownerId",
          w.default_permission_level as "defaultPermissionLevel",
          w.visibility = 'public' as "isPublic",
          wm.permission_level as "memberPermissionLevel",
          false as "isListAssignee",
          false as "isTaskAssignee",
          false as "hasMatchingTaskTag",
          EXISTS (
            SELECT 1
            FROM lists l
            INNER JOIN folders f ON f.id = l.folder_id
            INNER JOIN spaces s ON s.id = f.space_id
            LEFT JOIN list_assignees la
              ON la.list_id = l.id AND la.member_id = $1
            LEFT JOIN list_tags lt
              ON lt.list_id = l.id
            LEFT JOIN member_tags mt
              ON mt.tag_id = lt.tag_id AND mt.member_id = $1
            WHERE s.workspace_id = w.id
              AND l.deleted_at IS NULL
              AND l.visibility <> 'admin_private'
              AND (
                l.visibility = 'public'
                OR l.owner_id = $1
                OR la.member_id IS NOT NULL
                OR mt.member_id IS NOT NULL
              )
          ) as "hasScopedListAccess",
          EXISTS (
            SELECT 1
            FROM tasks t
            LEFT JOIN task_assignees ta
              ON ta.task_id = t.id AND ta.member_id = $1
            LEFT JOIN task_tags tt
              ON tt.task_id = t.id
            LEFT JOIN member_tags mt
              ON mt.tag_id = tt.tag_id AND mt.member_id = $1
            WHERE t.workspace_id = w.id
              AND COALESCE(t.visibility, 'public') <> 'admin_private'
              AND (ta.member_id IS NOT NULL OR mt.member_id IS NOT NULL)
          ) as "hasScopedTaskAccess",
          EXISTS (
            SELECT 1
            FROM workspace_tags wt
            INNER JOIN member_tags mt
              ON mt.tag_id = wt.tag_id
             AND mt.member_id = $1
            WHERE wt.workspace_id = w.id
          ) as "hasMatchingWorkspaceTag"
        FROM workspaces w
        LEFT JOIN workspace_members wm
          ON w.id = wm.workspace_id AND wm.member_id = $1
        WHERE w.deleted_at IS NULL
          AND w.organization_id = $2
        ${wsAccessFilter}
        ORDER BY w.created_at ASC
      `,
      [userId, organizationId],
    );
    const workspaceIds = wsRes.rows.map((w) => w.id);
    wsRes.rows.forEach((row) => {
      row.spaceIds = [];
      row.sharedMemberIds = [];
      row.tags = [];
      row.customFieldIds = [];
      row.taskScopedOnly =
        row.ownerId !== userId &&
        !row.memberPermissionLevel &&
        !row.isPublic &&
        !row.hasMatchingWorkspaceTag &&
        (row.hasScopedListAccess || row.hasScopedTaskAccess);
      row.currentPermissionLevel = resolveScopedAccessPermission({
        isAdmin: currentUserIsAdmin,
        isOwner: row.ownerId === userId,
        visibility: row.visibility,
        memberPermissionLevel: row.memberPermissionLevel,
        isListAssignee: false,
        taskScopedPermissionLevel: row.taskScopedOnly
          ? WORKSPACE_VIEW_PERMISSION_LEVEL
          : null,
        workspaceTagPermissionLevel: getWorkspaceTagPermissionLevel(row),
        isPublic: Boolean(row.isPublic),
      });
      graph.workspaces[row.id] = row;
    });

    if (workspaceIds.length > 0) {
      await getTaskCommentsSchema(client);

      const workspaceMembersRes = await client.query(
        'SELECT workspace_id as "workspaceId", member_id as "memberId" FROM workspace_members WHERE workspace_id = ANY($1)',
        [workspaceIds],
      );
      workspaceMembersRes.rows.forEach((row) => {
        if (graph.workspaces[row.workspaceId]) {
          graph.workspaces[row.workspaceId].sharedMemberIds.push(row.memberId);
        }
      });

      const customFieldsRes = await client.query(
        `
          SELECT
            id,
            workspace_id as "workspaceId",
            name,
            field_type as "type",
            is_required as "required",
            options_json as "options",
            default_value_json as "defaultValue",
            display_order as "displayOrder",
            visible_on_dashboard as "visibleOnDashboard",
            created_at as "createdAt",
            updated_at as "updatedAt"
          FROM workspace_custom_fields
          WHERE workspace_id = ANY($1)
            AND deleted_at IS NULL
          ORDER BY workspace_id ASC, display_order ASC, created_at ASC
        `,
        [workspaceIds],
      );
      customFieldsRes.rows.forEach((row) => {
        row.options = Array.isArray(row.options) ? row.options : [];
        graph.customFieldDefinitions[row.id] = row;

        if (graph.workspaces[row.workspaceId]) {
          graph.workspaces[row.workspaceId].customFieldIds.push(row.id);
        }
      });

      // Spaces
      const spaceArgs = workspaceIds.map((_, i) => "$" + (i + 1)).join(",");
      const spaceQuery = `SELECT id, workspace_id as "workspaceId", name, icon, created_at as "createdAt" FROM spaces WHERE workspace_id IN (${spaceArgs}) ORDER BY created_at ASC`;
      const spaceRes = await client.query(spaceQuery, workspaceIds);
      const spaceIds = spaceRes.rows.map((s) => s.id);

      spaceRes.rows.forEach((row) => {
        row.folderIds = [];
        row.listIds = [];
        graph.spaces[row.id] = row;
        if (graph.workspaces[row.workspaceId]) {
          graph.workspaces[row.workspaceId].spaceIds.push(row.id);
        }
      });

      if (spaceIds.length > 0) {
        // Folders
        const folderArgs = spaceIds.map((_, i) => "$" + (i + 1)).join(",");
        const folderQuery = `SELECT id, space_id as "spaceId", name, created_at as "createdAt" FROM folders WHERE space_id IN (${folderArgs}) ORDER BY created_at ASC`;
        const folderRes = await client.query(folderQuery, spaceIds);
        const folderIds = folderRes.rows.map((f) => f.id);

        folderRes.rows.forEach((row) => {
          row.listIds = [];
          graph.folders[row.id] = row;
          if (graph.spaces[row.spaceId]) {
            graph.spaces[row.spaceId].folderIds.push(row.id);
          }
        });

        // Lists
        const allFolderIds = Object.keys(graph.folders);
        let listQuery = `
          SELECT
            l.id,
            l.folder_id as "folderId",
            l.name,
            l.color_class as "color",
            l.color_class as "colorClass",
            l.owner_id as "ownerId",
            l.visibility,
            l.start_date as "startDate",
            l.due_date as "dueDate",
            l.created_at as "createdAt",
            EXISTS (
              SELECT 1
              FROM list_assignees la
              WHERE la.list_id = l.id
                AND la.member_id = $1
            ) as "isListAssignee",
            EXISTS (
              SELECT 1
              FROM list_tags lt
              INNER JOIN member_tags mt
                ON mt.tag_id = lt.tag_id
               AND mt.member_id = $1
              WHERE lt.list_id = l.id
            ) as "hasMatchingListTag",
            EXISTS (
              SELECT 1
              FROM tasks t
              LEFT JOIN task_assignees ta
                ON ta.task_id = t.id AND ta.member_id = $1
              LEFT JOIN task_tags tt
                ON tt.task_id = t.id
              LEFT JOIN member_tags mt
                ON mt.tag_id = tt.tag_id AND mt.member_id = $1
              WHERE t.list_id = l.id
                AND COALESCE(t.visibility, 'public') <> 'admin_private'
                AND (ta.member_id IS NOT NULL OR mt.member_id IS NOT NULL)
            ) as "hasScopedTaskAccess"
          FROM lists l
          WHERE l.deleted_at IS NULL
        `;
        let listValues = [userId];

        listQuery += " AND l.folder_id = ANY($2)";
        listValues.push(allFolderIds);

        listQuery += " ORDER BY created_at ASC";
        const listRes = await client.query(listQuery, listValues);

        listRes.rows.forEach((row) => {
          row.taskIds = [];
          row.assigneeIds = [];
          row.tags = [];
          graph.lists[row.id] = row;
          if (row.folderId && graph.folders[row.folderId]) {
            graph.folders[row.folderId].listIds.push(row.id);
          }
        });
        // Buscar assignees de listas
        const listAssigneesRes = await client.query(
          "SELECT list_id, member_id FROM list_assignees",
        );
        listAssigneesRes.rows.forEach((row) => {
          if (graph.lists[row.list_id]) {
            graph.lists[row.list_id].assigneeIds.push(row.member_id);
          }
        });

        // Buscar tags de listas
        const listTagsRes = await client.query(
          "SELECT lt.list_id, lt.tag_id FROM list_tags lt INNER JOIN tags t ON t.id = lt.tag_id WHERE t.organization_id = $1",
          [organizationId],
        );
        listTagsRes.rows.forEach((row) => {
          if (graph.lists[row.list_id] && graph.tags[row.tag_id]) {
            graph.lists[row.list_id].tags.push(graph.tags[row.tag_id]);
          }
        });

        Object.values(graph.lists).forEach((list) => {
          const folder = graph.folders[list.folderId];
          const space = folder ? graph.spaces[folder.spaceId] : null;
          const workspace = space ? graph.workspaces[space.workspaceId] : null;
          const isListAssignee = (list.assigneeIds || []).includes(userId);
          const hasMatchingListTag = (list.tags || []).some((tag) =>
            currentUserTagIds.includes(tag.id),
          );
          const isListOwner = list.ownerId === userId;
          const isDirectWorkspaceAccess = workspace
            ? !workspace.taskScopedOnly
            : false;
          const hasDirectListAccess =
            isListOwner ||
            list.visibility === "public" ||
            isListAssignee ||
            hasMatchingListTag;
          const inheritedWorkspacePermission =
            list.visibility === "public" && isDirectWorkspaceAccess
              ? workspace?.currentPermissionLevel
              : null;

          list.taskScopedOnly =
            !hasDirectListAccess && Boolean(list.hasScopedTaskAccess);

          list.currentPermissionLevel = resolveScopedAccessPermission({
            isAdmin: currentUserIsAdmin,
            isOwner: isListOwner,
            visibility: list.visibility,
            memberPermissionLevel: inheritedWorkspacePermission,
            isListAssignee,
            taskScopedPermissionLevel: list.taskScopedOnly
              ? WORKSPACE_VIEW_PERMISSION_LEVEL
              : null,
            workspaceTagPermissionLevel: hasMatchingListTag
              ? WORKSPACE_VIEW_PERMISSION_LEVEL
              : null,
            isPublic: list.visibility === "public",
          });
        });

        Object.keys(graph.lists).forEach((listId) => {
          const list = graph.lists[listId];
          if (list.currentPermissionLevel || list.taskScopedOnly) {
            return;
          }

          delete graph.lists[listId];
          const folder = graph.folders[list.folderId];
          if (folder) {
            folder.listIds = folder.listIds.filter((id) => id !== listId);
          }
        });

        // 4. Workspace Tags
        const workspaceTagsRes = await client.query(
          "SELECT wt.workspace_id, wt.tag_id FROM workspace_tags wt INNER JOIN tags t ON t.id = wt.tag_id WHERE t.organization_id = $1",
          [organizationId],
        );
        workspaceTagsRes.rows.forEach((row) => {
          if (graph.workspaces[row.workspace_id] && graph.tags[row.tag_id]) {
            graph.workspaces[row.workspace_id].tags.push(
              graph.tags[row.tag_id],
            );
          }
        });

        // Tasks
        const listIds = Object.keys(graph.lists);
        let taskQuery = `SELECT
          id,
          workspace_id as "workspaceId",
          space_id as "spaceId",
          folder_id as "folderId",
          list_id as "listId",
          parent_task_id as "parentTaskId",
          owner_id as "ownerId",
          COALESCE(visibility, 'public') as "visibility",
          title,
          description as "descriptionText",
          COALESCE(description_link_display_modes, '{}'::jsonb) as "descriptionLinkDisplayModes",
          status_id as "statusId",
          priority,
          start_date as "startDate",
          due_date as "dueDate",
          estimate,
          cover_attachment_id as "coverAttachmentId",
          created_at as "createdAt",
          updated_at as "updatedAt"
        FROM tasks`;
        let taskValues = [];

        taskQuery += " WHERE list_id = ANY($1)";
        taskValues = [listIds];

        const taskRes = await client.query(taskQuery, taskValues);

        taskRes.rows.forEach((row) => {
          row.assigneeIds = [];
          row.watcherIds = [];
          row.tags = [];
          row.subtaskIds = [];
          row.commentIds = [];
          row.attachments = [];
          row.checklists = [];
          row.linkedTaskIds = [];
          row.customFieldValues = {};

          // Formata a descrição conforme o frontend espera
          row.description = {
            format: "html",
            value: row.descriptionText || "",
          };
          delete row.descriptionText;

          graph.tasks[row.id] = row;
          if (row.listId && graph.lists[row.listId]) {
            graph.lists[row.listId].taskIds.push(row.id);
          }
        });

        // Task assignees
        const assigneesRes = await client.query(
          "SELECT task_id, member_id FROM task_assignees",
        );
        assigneesRes.rows.forEach((row) => {
          if (graph.tasks[row.task_id]) {
            graph.tasks[row.task_id].assigneeIds.push(row.member_id);
          }
        });

        // Observadores (sino do card)
        const watchersRes = await client.query(
          "SELECT task_id, member_id FROM task_watchers",
        );
        watchersRes.rows.forEach((row) => {
          if (graph.tasks[row.task_id]) {
            graph.tasks[row.task_id].watcherIds.push(row.member_id);
          }
        });

        // 5. Task tags
        const taskTagsRes = await client.query(
          "SELECT tt.task_id, tt.tag_id FROM task_tags tt INNER JOIN tags t ON t.id = tt.tag_id WHERE t.organization_id = $1",
          [organizationId],
        );
        taskTagsRes.rows.forEach((row) => {
          if (graph.tasks[row.task_id] && graph.tags[row.tag_id]) {
            graph.tasks[row.task_id].tags.push(graph.tags[row.tag_id]);
          }
        });

        Object.keys(graph.tasks).forEach((taskId) => {
          const task = graph.tasks[taskId];
          const list = graph.lists[task.listId];
          if (!list) {
            delete graph.tasks[taskId];
            return;
          }

          const hasTaskAssignee = (task.assigneeIds || []).includes(userId);
          const hasMatchingTaskTag = (task.tags || []).some((tag) =>
            currentUserTagIds.includes(tag.id),
          );
          const isScopedTaskVisible = hasTaskAssignee || hasMatchingTaskTag;
          const isTaskOwner = task.ownerId === userId;

          if (list.taskScopedOnly && !isScopedTaskVisible) {
            delete graph.tasks[taskId];
            return;
          }

          task.currentPermissionLevel = resolveScopedAccessPermission({
            isAdmin: currentUserIsAdmin,
            isOwner: isTaskOwner,
            visibility: task.visibility,
            memberPermissionLevel:
              task.visibility === "public" ? list.currentPermissionLevel : null,
            isListAssignee: false,
            taskScopedPermissionLevel: isScopedTaskVisible
              ? WORKSPACE_COMMENT_PERMISSION_LEVEL
              : null,
            workspaceTagPermissionLevel: null,
            isPublic: isPublicVisibility(task.visibility),
          });

          if (!task.currentPermissionLevel) {
            delete graph.tasks[taskId];
          }
        });

        Object.values(graph.lists).forEach((list) => {
          list.taskIds = list.taskIds.filter((taskId) => graph.tasks[taskId]);
        });

        Object.keys(graph.lists).forEach((listId) => {
          const list = graph.lists[listId];
          if (list.taskScopedOnly && list.taskIds.length === 0) {
            delete graph.lists[listId];
            const folder = graph.folders[list.folderId];
            if (folder) {
              folder.listIds = folder.listIds.filter((id) => id !== listId);
            }
          }
        });

        Object.values(graph.folders).forEach((folder) => {
          folder.listIds = folder.listIds.filter(
            (listId) => graph.lists[listId],
          );
        });

        Object.keys(graph.folders).forEach((folderId) => {
          const folder = graph.folders[folderId];
          const space = graph.spaces[folder.spaceId];
          const workspace = space ? graph.workspaces[space.workspaceId] : null;
          if (workspace?.taskScopedOnly && folder.listIds.length === 0) {
            delete graph.folders[folderId];
            if (space) {
              space.folderIds = space.folderIds.filter((id) => id !== folderId);
            }
          }
        });

        Object.values(graph.spaces).forEach((space) => {
          space.folderIds = space.folderIds.filter(
            (folderId) => graph.folders[folderId],
          );
        });

        Object.keys(graph.spaces).forEach((spaceId) => {
          const space = graph.spaces[spaceId];
          const workspace = graph.workspaces[space.workspaceId];
          if (workspace?.taskScopedOnly && space.folderIds.length === 0) {
            delete graph.spaces[spaceId];
            workspace.spaceIds = workspace.spaceIds.filter(
              (id) => id !== spaceId,
            );
          }
        });

        Object.values(graph.workspaces).forEach((workspace) => {
          workspace.spaceIds = workspace.spaceIds.filter(
            (spaceId) => graph.spaces[spaceId],
          );
        });

        Object.keys(graph.workspaces).forEach((workspaceId) => {
          const workspace = graph.workspaces[workspaceId];
          if (workspace.taskScopedOnly && workspace.spaceIds.length === 0) {
            delete graph.workspaces[workspaceId];
          }
        });

        Object.keys(graph.customFieldDefinitions).forEach((fieldId) => {
          const field = graph.customFieldDefinitions[fieldId];
          if (!graph.workspaces[field.workspaceId]) {
            delete graph.customFieldDefinitions[fieldId];
          }
        });

        const taskCustomFieldValues = await loadTaskCustomFieldValues(
          client,
          Object.keys(graph.tasks),
        );
        Object.values(graph.tasks).forEach((task) => {
          task.customFieldValues = taskCustomFieldValues[task.id] || {};
        });

        // Montando as subtasks
        taskRes.rows.forEach((row) => {
          if (row.parentTaskId && graph.tasks[row.parentTaskId]) {
            graph.tasks[row.parentTaskId].subtaskIds.push(row.id);
          }
        });

        // Checklists
        const checklistsRes = await client.query(
          "SELECT id, task_id, name FROM checklists ORDER BY created_at ASC",
        );
        const checklistMap = {};
        checklistsRes.rows.forEach((cl) => {
          checklistMap[cl.id] = { id: cl.id, name: cl.name, items: [] };
          if (graph.tasks[cl.task_id]) {
            graph.tasks[cl.task_id].checklists.push(checklistMap[cl.id]);
          }
        });

        const checklistItemsRes = await client.query(
          "SELECT id, checklist_id, label, done FROM checklist_items ORDER BY created_at ASC",
        );
        checklistItemsRes.rows.forEach((item) => {
          if (checklistMap[item.checklist_id]) {
            checklistMap[item.checklist_id].items.push({
              id: item.id,
              label: item.label,
              done: item.done,
              assigneeIds: [],
            });
          }
        });

        const checklistItemAssigneesRes = await client.query(
          "SELECT checklist_item_id, member_id FROM checklist_item_assignees",
        );
        checklistItemAssigneesRes.rows.forEach((row) => {
          for (const cl of Object.values(checklistMap)) {
            const item = cl.items.find((i) => i.id === row.checklist_item_id);
            if (item) {
              item.assigneeIds.push(row.member_id);
              break;
            }
          }
        });

        // Attachments
        const attachmentsRes = await client.query(
          `
            SELECT
              a.id,
              a.task_id,
              a.name,
              a.url,
              a.type,
              a.size,
              a.created_at as "createdAt",
              a.uploaded_by as "uploadedById",
              m.name as "uploadedByName",
              m.avatar_color as "uploadedByAvatarColor",
              m.avatar_url as "uploadedByAvatarUrl"
            FROM task_attachments a
            LEFT JOIN members m ON m.id = a.uploaded_by
            ORDER BY a.created_at ASC
          `,
        );
        attachmentsRes.rows.forEach((att) => {
          if (graph.tasks[att.task_id]) {
            graph.tasks[att.task_id].attachments.push({
              id: att.id,
              name: att.name,
              url: att.url,
              type: att.type,
              size: Number(att.size),
              createdAt: att.createdAt,
              uploadedById: att.uploadedById || null,
              uploadedByName: att.uploadedByName || null,
              uploadedByAvatarColor: att.uploadedByAvatarColor || null,
              uploadedByAvatarUrl: att.uploadedByAvatarUrl || null,
            });
          }
        });
        // Task Links
        const linksRes = await client.query(
          "SELECT task_id, linked_task_id FROM task_links",
        );
        linksRes.rows.forEach((row) => {
          if (
            graph.tasks[row.task_id] &&
            !graph.tasks[row.task_id].linkedTaskIds.includes(row.linked_task_id)
          ) {
            graph.tasks[row.task_id].linkedTaskIds.push(row.linked_task_id);
          }
          if (
            graph.tasks[row.linked_task_id] &&
            !graph.tasks[row.linked_task_id].linkedTaskIds.includes(row.task_id)
          ) {
            graph.tasks[row.linked_task_id].linkedTaskIds.push(row.task_id);
          }
        });

        // Task Activities
        const activitiesRes = await client.query(
          "SELECT id, task_id, author_id, type, description, date FROM task_activities ORDER BY date ASC",
        );
        activitiesRes.rows.forEach((act) => {
          if (graph.tasks[act.task_id]) {
            if (!graph.tasks[act.task_id].activities) {
              graph.tasks[act.task_id].activities = [];
            }
            const author = graph.members[act.author_id];
            const authorName = author ? author.name : "Alguém";
            const logType = act.type || "system";
            let icon = "system";
            // Simple mapping from type to icon
            if (logType === "status") icon = "status";
            if (logType === "comment") icon = "comment";
            if (logType === "date") icon = "calendar";
            if (logType === "dependency" || logType === "link") icon = "link";

            graph.tasks[act.task_id].activities.push({
              id: act.id,
              type: icon,
              authorId: act.author_id,
              authorName,
              description: act.description,
              content: activityHtml(authorName, act.description),
              date: act.date,
            });
          }
        });

        // Task Comments
        const commentsRes = await client.query(`
          SELECT
            c.id,
            c.task_id,
            c.content,
            c.parent_id,
            c.created_at,
            COALESCE(NULLIF(to_jsonb(c)->>'updated_at', '')::timestamp, c.created_at) AS updated_at,
            c.attachment_name,
            c.attachment_url,
            c.attachment_type,
            c.attachment_size,
            COALESCE(c.liked_user_ids, ARRAY[]::TEXT[]) AS liked_user_ids,
            c.reaction,
            COALESCE(c.link_display_modes, '{}'::jsonb) AS link_display_modes,
            m.name AS author_name
          FROM task_comments c
          LEFT JOIN members m ON m.id = COALESCE(to_jsonb(c)->>'author_id', to_jsonb(c)->>'user_id')
          ORDER BY c.created_at ASC
        `);
        commentsRes.rows.forEach((c) => {
          if (!graph.tasks[c.task_id]) {
            return;
          }
          const createdAtMs = c.created_at
            ? new Date(c.created_at).getTime()
            : null;
          const updatedAtMs = c.updated_at
            ? new Date(c.updated_at).getTime()
            : null;
          const wasEdited =
            createdAtMs !== null &&
            updatedAtMs !== null &&
            updatedAtMs !== createdAtMs;

          if (!commentsByTaskId[c.task_id]) {
            commentsByTaskId[c.task_id] = [];
          }
          commentsByTaskId[c.task_id].push({
            id: c.id,
            taskId: c.task_id,
            authorName: c.author_name || "Desconhecido",
            content: c.content,
            parentId: c.parent_id,
            createdAt: c.created_at,
            editedAt: wasEdited ? c.updated_at : undefined,
            likedByMe: Array.isArray(c.liked_user_ids)
              ? c.liked_user_ids.includes(req.user.id)
              : false,
            reaction: c.reaction || null,
            linkDisplayModes: c.link_display_modes || {},
            attachment: c.attachment_url
              ? {
                  id: `comment_attachment_${c.id}`,
                  name: c.attachment_name,
                  url: c.attachment_url,
                  type: c.attachment_type || "document",
                  size: Number(c.attachment_size || 0),
                  createdAt: c.created_at,
                }
              : undefined,
          });
        });
      }
    }

    const accessibleWorkspaceIds = Object.keys(graph.workspaces);
    const accessibleListIds = Object.keys(graph.lists);
    const selectionFallback = {
      workspaceId:
        accessibleWorkspaceIds.length > 0 ? accessibleWorkspaceIds[0] : null,
      spaceId: null,
      folderId: null,
      listId: accessibleListIds.length > 0 ? accessibleListIds[0] : null,
    };

    res.json({
      graph,
      selection: selectionFallback,
      commentsByTaskId,
    });
  } catch (error) {
    console.error("Erro ao buscar seed dos workspaces:", error);
    res.status(500).json({ message: "Erro ao buscar dados." });
  } finally {
    if (client) client.release();
  }
});

router.post("/", verifyToken, async (req, res) => {
  const {
    name,
    description,
    visibility,
    sharedMemberIds,
    defaultPermissionLevel = "Edição total",
    color,
  } = req.body;
  const ownerId = req.user.id;
  const organizationId = req.user.organizationId;

  if (!name) {
    return res
      .status(400)
      .json({ message: "Nome do Workspace é obrigatório." });
  }

  if (!isWorkspaceAdmin(req.user)) {
    return res.status(403).json({
      message: "Você não tem permissão para criar espaços de trabalho.",
    });
  }

  if (!organizationId) {
    return res.status(403).json({
      message: "Conta sem empresa ativa. Faça login novamente.",
    });
  }

  const client = await postgres.connect();
  let storedWorkspaceNotifications = [];

  try {
    await client.query("BEGIN");
    await ensureWorkspacePermissionSchema(client);

    const orgPlanResult = await client.query(
      `
        SELECT plan, subscription_status, trial_ends_at, extra_seats,
               extra_storage_packs, billing_exempt, custom_entitlements
        FROM organizations WHERE id = $1
      `,
      [organizationId],
    );
    const entitlements = resolveOrganizationBilling(orgPlanResult.rows[0]).entitlements;

    if (entitlements.maxWorkspaces > -1) {
      const workspaceCountResult = await client.query(
        "SELECT COUNT(*)::int as count FROM workspaces WHERE organization_id = $1 AND deleted_at IS NULL",
        [organizationId],
      );

      if (
        (workspaceCountResult.rows[0]?.count || 0) >=
        entitlements.maxWorkspaces
      ) {
        await client.query("ROLLBACK");
        return res.status(403).json({
          code: "PLAN_LIMIT_WORKSPACES",
          message:
            `Seu plano permite ${entitlements.maxWorkspaces} workspace(s). Faça upgrade para criar mais workspaces.`,
        });
      }
    }

    // 1. Criar o Workspace
    const workspaceId = "ws_" + Math.random().toString(36).slice(2, 10);
    const { icon } = req.body;
    const wsQuery = `
      INSERT INTO workspaces (id, organization_id, name, description, visibility, icon, owner_id, default_permission_level, color)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *;
    `;
    await client.query(wsQuery, [
      workspaceId,
      organizationId,
      name,
      description || "",
      visibility || "private",
      icon || "Briefcase",
      ownerId,
      defaultPermissionLevel,
      color || "#3b82f6",
    ]);

    // 2. Criar um Space Geral por padrão
    const spaceId = "sp_" + Math.random().toString(36).slice(2, 10);
    const spQuery = `
      INSERT INTO spaces (id, workspace_id, name, icon)
      VALUES ($1, $2, $3, $4)
    `;
    await client.query(spQuery, [spaceId, workspaceId, "Geral", "ðŸ "]);

    // 3. Criar a Folder padrão do Space
    const folderId = "fld_" + Math.random().toString(36).slice(2, 10);
    const fldQuery = `
      INSERT INTO folders (id, space_id, name)
      VALUES ($1, $2, $3)
    `;
    await client.query(fldQuery, [folderId, spaceId, "Geral"]);

    // 4. Se for privado ou publico, o dono sempre precisa estar na tabela de permissões (workspace_members) pra query retornar pra ele dps
    await client.query(
      `
      INSERT INTO workspace_members (workspace_id, member_id, permission_level)
      VALUES ($1, $2, $3)
    `,
      [workspaceId, ownerId, "Edição total"],
    );

    // 5. Associar membros compartilhados opcionais
    if (
      sharedMemberIds &&
      Array.isArray(sharedMemberIds) &&
      sharedMemberIds.length > 0
    ) {
      for (const memberId of sharedMemberIds) {
        if (memberId !== ownerId) {
          await client.query(
            `
            INSERT INTO workspace_members (workspace_id, member_id, permission_level)
            VALUES ($1, $2, $3)
          `,
            [workspaceId, memberId, defaultPermissionLevel],
          );

          storedWorkspaceNotifications.push({
            userId: memberId,
            title: "Workspace compartilhado",
            message: `Você foi convidado para o workspace ${name}`,
            type: "WORKSPACE_ASSIGNED",
            referenceId: workspaceId,
            createdBy: ownerId,
            url: buildWorkspaceNotificationUrl(workspaceId),
          });
        }
      }
    }

    // 6. Associar Tags do Workspace
    const { tags } = req.body;
    if (tags && Array.isArray(tags)) {
      for (const tag of tags) {
        await client.query(
          "INSERT INTO workspace_tags (workspace_id, tag_id) VALUES ($1, $2)",
          [workspaceId, tag.id],
        );
      }
    }

    storedWorkspaceNotifications = await storeNotifications(
      client,
      storedWorkspaceNotifications,
    );

    await client.query("COMMIT");

    publishSeedRefetch({
      actorId: ownerId,
      userIds: collectUniqueIds(ownerId, sharedMemberIds || []),
      reason: "workspace.created",
    });

    if (storedWorkspaceNotifications.length > 0) {
      await dispatchStoredNotifications({
        actorId: ownerId,
        notifications: storedWorkspaceNotifications,
        reason: "workspace.created",
      });
    }

    res
      .status(201)
      .json({ message: "Workspace criado com sucesso!", id: workspaceId });
  } catch (error) {
    if (client) await client.query("ROLLBACK");
    console.error("Erro ao criar Workspace:", error);
    res.status(500).json({ message: "Erro interno ao criar Workspace." });
  } finally {
    if (client) client.release();
  }
});

// Atualizar Workspace
router.put("/:id", verifyToken, async (req, res) => {
  const workspaceId = req.params.id;
  const {
    name,
    description,
    visibility,
    icon,
    sharedMemberIds,
    tags,
    defaultPermissionLevel,
    color,
  } = req.body;
  const userId = req.user.id;

  const client = await postgres.connect();
  let storedWorkspaceNotifications = [];
  try {
    await client.query("BEGIN");
    await ensureWorkspacePermissionSchema(client);
    const workspaceAccess = await getWorkspaceAccessByWorkspaceId(
      client,
      req.user,
      workspaceId,
    );
    if (!ensureWorkspaceManagement(res, workspaceAccess)) {
      await client.query("ROLLBACK");
      return;
    }
    const currentWorkspaceRes = await client.query(
      "SELECT default_permission_level, color FROM workspaces WHERE id = $1",
      [workspaceId],
    );
    const effectiveDefaultPermissionLevel =
      defaultPermissionLevel ||
      currentWorkspaceRes.rows[0]?.default_permission_level ||
      "Edição total";
    const effectiveColor =
      color || currentWorkspaceRes.rows[0]?.color || "#3b82f6";
    const previousMemberIdsRes = await client.query(
      "SELECT member_id FROM workspace_members WHERE workspace_id = $1",
      [workspaceId],
    );
    const previousMemberIds = previousMemberIdsRes.rows.map(
      (row) => row.member_id,
    );
    const nextMemberIds = Array.isArray(sharedMemberIds)
      ? sharedMemberIds.filter((memberId) => memberId !== userId)
      : [];
    const newlyAddedMemberIds = nextMemberIds.filter(
      (memberId) => !previousMemberIds.includes(memberId),
    );

    // 1. Update basic info
    // O que não veio no corpo continua como está: edição parcial não apaga
    // nome, descrição, visibilidade nem ícone.
    const atual = currentWorkspaceRes.rows[0] || {};
    const updateWsQuery = `
      UPDATE workspaces
      SET name = $1, description = $2, visibility = $3, icon = $4, default_permission_level = $5, color = $6, updated_at = CURRENT_TIMESTAMP
      WHERE id = $7
    `;
    await client.query(updateWsQuery, [
      name !== undefined ? name : atual.name,
      description !== undefined ? description : atual.description,
      visibility !== undefined ? visibility : atual.visibility,
      icon || atual.icon || "Briefcase",
      effectiveDefaultPermissionLevel,
      effectiveColor,
      workspaceId,
    ]);

    // 2. Update Members (Simple approach: delete and re-insert)
    if (Array.isArray(sharedMemberIds)) {
      await client.query(
        "DELETE FROM workspace_members WHERE workspace_id = $1 AND member_id != $2",
        [workspaceId, userId],
      );
      for (const mId of sharedMemberIds) {
        if (mId !== userId) {
          await client.query(
            "INSERT INTO workspace_members (workspace_id, member_id, permission_level) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
            [workspaceId, mId, effectiveDefaultPermissionLevel],
          );

          if (newlyAddedMemberIds.includes(mId)) {
            storedWorkspaceNotifications.push({
              userId: mId,
              title: "Workspace compartilhado",
              message: `Você foi atribuído ao workspace ${name}`,
              type: "WORKSPACE_ASSIGNED",
              referenceId: workspaceId,
              createdBy: userId,
              url: buildWorkspaceNotificationUrl(workspaceId),
            });
          }
        }
      }
    }

    // 3. Update Tags
    await client.query("DELETE FROM workspace_tags WHERE workspace_id = $1", [
      workspaceId,
    ]);
    if (tags && Array.isArray(tags)) {
      for (const tag of tags) {
        await client.query(
          "INSERT INTO workspace_tags (workspace_id, tag_id) VALUES ($1, $2)",
          [workspaceId, tag.id],
        );
      }
    }

    storedWorkspaceNotifications = await storeNotifications(
      client,
      storedWorkspaceNotifications,
    );

    await client.query("COMMIT");

    publishSeedRefetch({
      actorId: userId,
      workspaceId,
      userIds: collectUniqueIds(userId, previousMemberIds, nextMemberIds),
      reason: "workspace.updated",
    });

    if (storedWorkspaceNotifications.length > 0) {
      await dispatchStoredNotifications({
        actorId: userId,
        notifications: storedWorkspaceNotifications,
        reason: "workspace.updated",
      });
    }

    res.json({ message: "Workspace atualizado com sucesso!" });
    syncStorageFolderName("workspaces", workspaceId);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Erro ao atualizar Workspace:", error);
    res.status(500).json({ message: "Erro ao atualizar Workspace." });
  } finally {
    client.release();
  }
});

router.get("/:workspaceId/custom-fields", verifyToken, async (req, res) => {
  const { workspaceId } = req.params;
  const client = await postgres.connect();

  try {
    await ensureCustomFieldsSchema(client);
    const workspaceAccess = await getWorkspaceAccessByWorkspaceId(
      client,
      req.user,
      workspaceId,
    );
    if (!ensureWorkspacePermission(res, workspaceAccess, "Apenas exibição")) {
      return;
    }

    const fieldsRes = await client.query(
      `
        SELECT
          id,
          workspace_id as "workspaceId",
          name,
          field_type as "type",
          is_required as "required",
          options_json as "options",
          default_value_json as "defaultValue",
          display_order as "displayOrder",
          visible_on_dashboard as "visibleOnDashboard",
          created_at as "createdAt",
          updated_at as "updatedAt"
        FROM workspace_custom_fields
        WHERE workspace_id = $1
          AND deleted_at IS NULL
        ORDER BY display_order ASC, created_at ASC
      `,
      [workspaceId],
    );

    return res.json({
      fields: fieldsRes.rows.map(serializeCustomFieldDefinition),
    });
  } catch (error) {
    console.error("Erro ao listar campos personalizados:", error);
    return res
      .status(500)
      .json({ message: "Erro ao listar campos personalizados." });
  } finally {
    client.release();
  }
});

router.post("/:workspaceId/custom-fields", verifyToken, async (req, res) => {
  const { workspaceId } = req.params;
  const {
    name,
    type,
    required = false,
    visibleOnDashboard = false,
    options = [],
  } = req.body || {};
  const normalizedType = normalizeCustomFieldType(type);

  if (!String(name || "").trim()) {
    return res.status(400).json({ message: "Nome do campo é obrigatório." });
  }

  if (!normalizedType) {
    return res.status(400).json({ message: "Tipo de campo inválido." });
  }

  const normalizedOptions =
    normalizedType === "single_select"
      ? normalizeCustomFieldOptions(options)
      : [];

  if (normalizedType === "single_select" && normalizedOptions.length === 0) {
    return res.status(400).json({
      message: "Campos de seleção precisam de pelo menos uma opção.",
    });
  }

  const client = await postgres.connect();

  try {
    await client.query("BEGIN");
    await ensureCustomFieldsSchema(client);
    const workspaceAccess = await getWorkspaceAccessByWorkspaceId(
      client,
      req.user,
      workspaceId,
    );
    if (!ensureWorkspaceManagement(res, workspaceAccess)) {
      await client.query("ROLLBACK");
      return;
    }

    const orderRes = await client.query(
      `
        SELECT COALESCE(MAX(display_order), 0) as "maxOrder"
        FROM workspace_custom_fields
        WHERE workspace_id = $1
          AND deleted_at IS NULL
      `,
      [workspaceId],
    );
    const nextDisplayOrder = Number(orderRes.rows[0]?.maxOrder || 0) + 1;
    const fieldId = `cf_${Math.random().toString(36).slice(2, 10)}`;

    const insertRes = await client.query(
      `
        INSERT INTO workspace_custom_fields (
          id,
          workspace_id,
          name,
          field_type,
          is_required,
          options_json,
          default_value_json,
          display_order,
          visible_on_dashboard
        )
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'null'::jsonb, $7, $8)
        RETURNING
          id,
          workspace_id as "workspaceId",
          name,
          field_type as "type",
          is_required as "required",
          options_json as "options",
          default_value_json as "defaultValue",
          display_order as "displayOrder",
          visible_on_dashboard as "visibleOnDashboard",
          created_at as "createdAt",
          updated_at as "updatedAt"
      `,
      [
        fieldId,
        workspaceId,
        String(name).trim(),
        normalizedType,
        Boolean(required),
        JSON.stringify(normalizedOptions),
        nextDisplayOrder,
        Boolean(visibleOnDashboard),
      ],
    );

    await client.query("COMMIT");

    publishSeedRefetch({
      actorId: req.user.id,
      workspaceId,
      reason: "custom-field.created",
    });

    return res.status(201).json({
      field: serializeCustomFieldDefinition(insertRes.rows[0]),
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Erro ao criar campo personalizado:", error);
    return res
      .status(500)
      .json({ message: "Erro ao criar campo personalizado." });
  } finally {
    client.release();
  }
});

router.put(
  "/:workspaceId/custom-fields/:fieldId",
  verifyToken,
  async (req, res) => {
    const { workspaceId, fieldId } = req.params;
    const {
      name,
      workspaceId: requestedWorkspaceId,
      type,
      required = false,
      visibleOnDashboard = false,
      options = [],
    } = req.body || {};
    const normalizedType = normalizeCustomFieldType(type);
    const targetWorkspaceId = String(
      requestedWorkspaceId || workspaceId,
    ).trim();

    if (!String(name || "").trim()) {
      return res.status(400).json({ message: "Nome do campo é obrigatório." });
    }

    if (!normalizedType) {
      return res.status(400).json({ message: "Tipo de campo inválido." });
    }

    if (!targetWorkspaceId) {
      return res
        .status(400)
        .json({ message: "Workspace de destino inválido." });
    }

    const normalizedOptions =
      normalizedType === "single_select"
        ? normalizeCustomFieldOptions(options)
        : [];

    if (normalizedType === "single_select" && normalizedOptions.length === 0) {
      return res.status(400).json({
        message: "Campos de seleção precisam de pelo menos uma opção.",
      });
    }

    const client = await postgres.connect();

    try {
      await client.query("BEGIN");
      await ensureCustomFieldsSchema(client);
      const sourceWorkspaceAccess = await getWorkspaceAccessByWorkspaceId(
        client,
        req.user,
        workspaceId,
      );
      if (!ensureWorkspaceManagement(res, sourceWorkspaceAccess)) {
        await client.query("ROLLBACK");
        return;
      }

      if (targetWorkspaceId !== workspaceId) {
        const targetWorkspaceAccess = await getWorkspaceAccessByWorkspaceId(
          client,
          req.user,
          targetWorkspaceId,
        );

        if (!ensureWorkspaceManagement(res, targetWorkspaceAccess)) {
          await client.query("ROLLBACK");
          return;
        }
      }

      const existingFieldRes = await client.query(
        `
          SELECT id, workspace_id as "workspaceId", display_order as "displayOrder"
          FROM workspace_custom_fields
          WHERE id = $1
            AND workspace_id = $2
            AND deleted_at IS NULL
        `,
        [fieldId, workspaceId],
      );

      if (existingFieldRes.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ message: "Campo não encontrado." });
      }

      const existingField = existingFieldRes.rows[0];
      let nextDisplayOrder = Number(existingField.displayOrder || 0);

      if (targetWorkspaceId !== workspaceId) {
        const orderRes = await client.query(
          `
            SELECT COALESCE(MAX(display_order), 0) as "maxOrder"
            FROM workspace_custom_fields
            WHERE workspace_id = $1
              AND deleted_at IS NULL
          `,
          [targetWorkspaceId],
        );
        nextDisplayOrder = Number(orderRes.rows[0]?.maxOrder || 0) + 1;
      }

      const updateRes = await client.query(
        `
          UPDATE workspace_custom_fields
          SET
            workspace_id = $1,
            name = $2,
            field_type = $3,
            is_required = $4,
            options_json = $5::jsonb,
            visible_on_dashboard = $6,
            display_order = $7,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = $8
            AND workspace_id = $9
            AND deleted_at IS NULL
          RETURNING
            id,
            workspace_id as "workspaceId",
            name,
            field_type as "type",
            is_required as "required",
            options_json as "options",
            default_value_json as "defaultValue",
            display_order as "displayOrder",
            visible_on_dashboard as "visibleOnDashboard",
            created_at as "createdAt",
            updated_at as "updatedAt"
        `,
        [
          targetWorkspaceId,
          String(name).trim(),
          normalizedType,
          Boolean(required),
          JSON.stringify(normalizedOptions),
          Boolean(visibleOnDashboard),
          nextDisplayOrder,
          fieldId,
          workspaceId,
        ],
      );

      if (updateRes.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ message: "Campo não encontrado." });
      }

      if (targetWorkspaceId !== workspaceId) {
        await client.query(
          `
            DELETE FROM task_custom_field_values field_values
            USING tasks
            WHERE field_values.task_id = tasks.id
              AND field_values.field_id = $1
              AND tasks.workspace_id <> $2
          `,
          [fieldId, targetWorkspaceId],
        );
      }

      await client.query("COMMIT");

      publishSeedRefetch({
        actorId: req.user.id,
        workspaceId,
        reason: "custom-field.updated",
      });

      if (targetWorkspaceId !== workspaceId) {
        publishSeedRefetch({
          actorId: req.user.id,
          workspaceId: targetWorkspaceId,
          reason: "custom-field.updated",
        });
      }

      return res.json({
        field: serializeCustomFieldDefinition(updateRes.rows[0]),
      });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Erro ao atualizar campo personalizado:", error);
      return res
        .status(500)
        .json({ message: "Erro ao atualizar campo personalizado." });
    } finally {
      client.release();
    }
  },
);

router.delete(
  "/:workspaceId/custom-fields/:fieldId",
  verifyToken,
  async (req, res) => {
    const { workspaceId, fieldId } = req.params;
    const client = await postgres.connect();

    try {
      await client.query("BEGIN");
      await ensureCustomFieldsSchema(client);
      const workspaceAccess = await getWorkspaceAccessByWorkspaceId(
        client,
        req.user,
        workspaceId,
      );
      if (!ensureWorkspaceManagement(res, workspaceAccess)) {
        await client.query("ROLLBACK");
        return;
      }

      const deleteRes = await client.query(
        `
          UPDATE workspace_custom_fields
          SET deleted_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = $1
            AND workspace_id = $2
            AND deleted_at IS NULL
          RETURNING id
        `,
        [fieldId, workspaceId],
      );

      if (deleteRes.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ message: "Campo não encontrado." });
      }

      await client.query("COMMIT");

      publishSeedRefetch({
        actorId: req.user.id,
        workspaceId,
        reason: "custom-field.deleted",
      });

      return res.json({ message: "Campo personalizado removido." });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Erro ao excluir campo personalizado:", error);
      return res
        .status(500)
        .json({ message: "Erro ao excluir campo personalizado." });
    } finally {
      client.release();
    }
  },
);

// Soft Delete Workspace (Adicionando deleted_at Ã  tabela em breve, por enquanto sÃ³ DELETE ou marcar como inativo)
// Para manter padrão, vamos adicionar deleted_at na tabela workspaces se não houver
router.delete("/:id", verifyToken, async (req, res) => {
  const workspaceId = req.params.id;
  const client = await postgres.connect();
  try {
    const workspaceAccess = await getWorkspaceAccessByWorkspaceId(
      client,
      req.user,
      workspaceId,
    );
    if (!ensureWorkspaceManagement(res, workspaceAccess)) return;
    const memberIdsRes = await client.query(
      "SELECT member_id FROM workspace_members WHERE workspace_id = $1",
      [workspaceId],
    );
    const affectedUserIds = collectUniqueIds(
      req.user.id,
      memberIdsRes.rows.map((row) => row.member_id),
    );
    const updateQuery = `
      UPDATE workspaces 
      SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING id
    `;
    const result = await client.query(updateQuery, [workspaceId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Workspace não encontrado." });
    }
    await registerWorkspaceInTrash(client, { workspaceId, deletedBy: req.user.id });
    publishSeedRefetch({
      actorId: req.user.id,
      userIds: affectedUserIds,
      reason: "workspace.deleted",
    });
    res.json({ message: "Workspace movido para a lixeira." });
  } catch (error) {
    console.error("Erro ao excluir Workspace:", error);
    res.status(500).json({ message: "Erro ao excluir Workspace." });
  } finally {
    client.release();
  }
});

// Criar um novo Projeto (List)
router.post("/lists", verifyToken, async (req, res) => {
  const {
    name,
    visibility,
    folderId,
    startDate,
    dueDate,
    assigneeIds,
    tags,
    color,
  } = req.body;
  const ownerId = req.user.id;

  if (!name || !folderId) {
    return res
      .status(400)
      .json({ message: "Nome do Projeto e Folder ID são obrigatórios." });
  }

  const client = await postgres.connect();
  let storedListNotifications = [];
  try {
    await client.query("BEGIN");
    const folderAccess = await getWorkspaceAccessByFolderId(
      client,
      req.user,
      folderId,
    );
    if (!ensureWorkspacePermission(res, folderAccess, "Editar")) {
      await client.query("ROLLBACK");
      return;
    }

    // Limite de projetos do plano, checado na hora (o aviso de somente leitura
    // só chegaria depois, com mensagem genérica).
    const planoDaConta = await client.query(
      `
        SELECT plan, subscription_status, trial_ends_at, extra_seats,
               extra_storage_packs, billing_exempt, custom_entitlements
        FROM organizations WHERE id = $1
      `,
      [req.user.organizationId],
    );
    const limites = resolveOrganizationBilling(planoDaConta.rows[0] || {}).entitlements;

    if (limites.maxProjects > -1) {
      const projetos = await client.query(
        `
          SELECT COUNT(*)::int AS total
          FROM lists l
          INNER JOIN folders f ON f.id = l.folder_id
          INNER JOIN spaces s ON s.id = f.space_id
          INNER JOIN workspaces w ON w.id = s.workspace_id
          WHERE w.organization_id = $1 AND l.deleted_at IS NULL AND w.deleted_at IS NULL
        `,
        [req.user.organizationId],
      );

      if ((projetos.rows[0]?.total || 0) >= limites.maxProjects) {
        await client.query("ROLLBACK");
        return res.status(403).json({
          code: "PLAN_LIMIT_PROJECTS",
          message: `Seu plano permite ${limites.maxProjects} projeto(s). Faça upgrade ou apague um projeto para criar outro.`,
        });
      }
    }

    const listId = "list_" + Math.random().toString(36).slice(2, 10);
    const insertQuery = `
      INSERT INTO lists (id, folder_id, name, owner_id, visibility, start_date, due_date, color_class)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id, folder_id as "folderId", name, owner_id as "ownerId", visibility, start_date as "startDate", due_date as "dueDate", color_class as "color", color_class as "colorClass";
    `;

    // Convert null explicitly for dates if needed or pass undefined
    const listRes = await client.query(insertQuery, [
      listId,
      folderId,
      name,
      ownerId,
      visibility || "private",
      startDate || null,
      dueDate || null,
      color || "#3b82f6",
    ]);

    // Insert assignees if any
    if (assigneeIds && Array.isArray(assigneeIds)) {
      for (const aId of assigneeIds) {
        await client.query(
          "INSERT INTO list_assignees (list_id, member_id) VALUES ($1, $2)",
          [listId, aId],
        );

        if (aId !== ownerId) {
          storedListNotifications.push({
            userId: aId,
            title: "Projeto atribuído",
            message: `Você foi atribuído ao projeto ${name}`,
            type: "LIST_ASSIGNED",
            referenceId: listId,
            createdBy: ownerId,
            url: buildListNotificationUrl(listId),
          });
        }
      }
    }

    // Insert tags if any
    if (tags && Array.isArray(tags)) {
      for (const t of tags) {
        // tags is array of tag objects { id, name, ... } passed from frontend
        await client.query(
          "INSERT INTO list_tags (list_id, tag_id) VALUES ($1, $2)",
          [listId, t.id],
        );
      }
    }

    storedListNotifications = await storeNotifications(
      client,
      storedListNotifications,
    );

    await client.query("COMMIT");

    publishSeedRefetch({
      actorId: ownerId,
      workspaceId: folderAccess.workspaceId,
      reason: "list.created",
    });

    if (storedListNotifications.length > 0) {
      await dispatchStoredNotifications({
        actorId: ownerId,
        notifications: storedListNotifications,
        reason: "list.created",
      });
    }

    res.status(201).json({
      message: "Projeto/List criado com sucesso!",
      list: listRes.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Erro ao criar Projeto/List:", error);
    res.status(500).json({ message: "Erro interno ao criar Projeto." });
  } finally {
    client.release();
  }
});

// Buscar detalhes de uma Tarefa (Task)
router.get("/tasks/:id", verifyToken, async (req, res) => {
  const taskId = req.params.id;
  const client = await postgres.connect();
  try {
    await ensureTaskCoverSchema(client);
    await backfillTaskOwnerIds(client);
    const taskAccess = await getWorkspaceAccessByTaskId(
      client,
      req.user,
      taskId,
    );
    if (!ensureWorkspacePermission(res, taskAccess, "Visualizar")) return;
    await ensureCustomFieldsSchema(client);

    // Fetch task basic info
    const taskRes = await client.query(
      `SELECT id, workspace_id as "workspaceId", space_id as "spaceId", folder_id as "folderId", list_id as "listId", parent_task_id as "parentTaskId", owner_id as "ownerId", COALESCE(visibility, 'public') as "visibility", title, description as "descriptionText", COALESCE(description_link_display_modes, '{}'::jsonb) as "descriptionLinkDisplayModes", status_id as "statusId", priority, start_date as "startDate", due_date as "dueDate", estimate, cover_attachment_id as "coverAttachmentId", created_at as "createdAt", updated_at as "updatedAt" FROM tasks WHERE id = $1`,
      [taskId],
    );

    if (taskRes.rows.length === 0) {
      return res.status(404).json({ message: "Tarefa não encontrada." });
    }

    const task = taskRes.rows[0];
    task.assigneeIds = [];
    task.tags = [];
    task.subtaskIds = [];
    task.commentIds = [];
    task.attachments = [];
    task.checklists = [];
    task.linkedTaskIds = [];
    task.activities = [];
    task.customFieldValues = {};

    // Format description
    task.description = {
      format: "html",
      value: task.descriptionText || "",
    };
    delete task.descriptionText;
    task.currentPermissionLevel = taskAccess.effectivePermission;

    // Assignees
    const assigneesRes = await client.query(
      "SELECT member_id FROM task_assignees WHERE task_id = $1",
      [taskId],
    );
    task.assigneeIds = assigneesRes.rows.map((r) => r.member_id);

    // Tags
    const tagsRes = await client.query(
      "SELECT t.id, t.name, t.color FROM tags t JOIN task_tags tt ON t.id = tt.tag_id WHERE tt.task_id = $1",
      [taskId],
    );
    task.tags = tagsRes.rows;

    // Subtasks
    const subtasksRes = await client.query(
      "SELECT id FROM tasks WHERE parent_task_id = $1",
      [taskId],
    );
    task.subtaskIds = subtasksRes.rows.map((r) => r.id);

    // Checklists
    const checklistsRes = await client.query(
      "SELECT id, name FROM checklists WHERE task_id = $1 ORDER BY created_at ASC",
      [taskId],
    );
    for (const cl of checklistsRes.rows) {
      const itemsRes = await client.query(
        "SELECT id, label, done FROM checklist_items WHERE checklist_id = $1 ORDER BY created_at ASC",
        [cl.id],
      );
      const items = [];
      for (const item of itemsRes.rows) {
        const itemAssigneesRes = await client.query(
          "SELECT member_id FROM checklist_item_assignees WHERE checklist_item_id = $1",
          [item.id],
        );
        items.push({
          ...item,
          assigneeIds: itemAssigneesRes.rows.map((r) => r.member_id),
        });
      }
      task.checklists.push({ id: cl.id, name: cl.name, items });
    }

    // Attachments
    const attachmentsRes = await client.query(
      `
        SELECT
          a.id,
          a.name,
          a.url,
          a.type,
          a.size,
          a.created_at as "createdAt",
          a.uploaded_by as "uploadedById",
          m.name as "uploadedByName",
          m.avatar_color as "uploadedByAvatarColor",
          m.avatar_url as "uploadedByAvatarUrl"
        FROM task_attachments a
        LEFT JOIN members m ON m.id = a.uploaded_by
        WHERE a.task_id = $1
        ORDER BY a.created_at ASC
      `,
      [taskId],
    );
    task.attachments = attachmentsRes.rows.map((att) => ({
      ...att,
      size: Number(att.size),
    }));

    // Task Links
    const linksRes = await client.query(
      "SELECT linked_task_id FROM task_links WHERE task_id = $1 UNION SELECT task_id FROM task_links WHERE linked_task_id = $1",
      [taskId],
    );
    task.linkedTaskIds = linksRes.rows.map(
      (r) => r.linked_task_id || r.task_id,
    );

    task.customFieldValues =
      (await loadTaskCustomFieldValues(client, [taskId]))[taskId] || {};

    // Activities
    const activitiesRes = await client.query(
      `SELECT a.id, a.author_id, a.type, a.description, a.date, m.name as author_name 
       FROM task_activities a 
       LEFT JOIN members m ON a.author_id = m.id 
       WHERE a.task_id = $1 ORDER BY a.date ASC`,
      [taskId],
    );
    task.activities = activitiesRes.rows.map((act) => ({
      id: act.id,
      type:
        act.type === "dependency" || act.type === "link"
          ? "link"
          : act.type || "system",
      authorId: act.author_id,
      authorName: act.author_name || "Alguém",
      description: act.description,
      content: activityHtml(act.author_name || "Alguém", act.description),
      date: act.date,
    }));

    // Comments
    await getTaskCommentsSchema(client);
    const commentsRes = await client.query(
      `
      SELECT
        c.id, c.content, c.parent_id, c.created_at,
        COALESCE(NULLIF(to_jsonb(c)->>'updated_at', '')::timestamp, c.created_at) AS updated_at,
        c.attachment_name, c.attachment_url, c.attachment_type, c.attachment_size,
        COALESCE(c.liked_user_ids, ARRAY[]::TEXT[]) AS liked_user_ids,
        c.reaction,
        COALESCE(c.link_display_modes, '{}'::jsonb) AS link_display_modes,
        m.name AS author_name
      FROM task_comments c
      LEFT JOIN members m ON m.id = COALESCE(to_jsonb(c)->>'author_id', to_jsonb(c)->>'user_id')
      WHERE c.task_id = $1
      ORDER BY c.created_at ASC
    `,
      [taskId],
    );

    const comments = commentsRes.rows.map((c) => ({
      id: c.id,
      taskId: taskId,
      content: c.content,
      parentId: c.parent_id,
      createdAt: c.created_at,
      authorName: c.author_name,
      editedAt:
        c.updated_at && c.updated_at !== c.created_at
          ? c.updated_at
          : undefined,
      likedByMe: Array.isArray(c.liked_user_ids)
        ? c.liked_user_ids.includes(req.user.id)
        : false,
      reaction: c.reaction || null,
      linkDisplayModes: c.link_display_modes || {},
      attachment: c.attachment_url
        ? {
            id: `comment_attachment_${c.id}`,
            name: c.attachment_name,
            url: c.attachment_url,
            type: c.attachment_type,
            size: Number(c.attachment_size),
            createdAt: c.created_at,
          }
        : null,
    }));

    res.json({ task, comments });
  } catch (error) {
    console.error("Erro ao buscar detalhes da tarefa:", error);
    res
      .status(500)
      .json({ message: "Erro interno ao buscar detalhes da tarefa." });
  } finally {
    client.release();
  }
});

// Criar uma nova Tarefa (Task)
router.post("/tasks", verifyToken, async (req, res) => {
  const {
    workspaceId,
    spaceId,
    folderId,
    listId,
    title,
    descriptionText,
    statusId,
    priority,
    visibility,
    startDate,
    dueDate,
    estimate,
    assigneeIds,
    tags,
    customFieldValues,
  } = req.body;
  const ownerId = req.user.id;

  if (!title || !listId) {
    return res
      .status(400)
      .json({ message: "Título e ID da lista são obrigatórios." });
  }

  const client = await postgres.connect();
  let storedTaskNotifications = [];
  try {
    await client.query("BEGIN");
    await ensureCustomFieldsSchema(client);
    const listAccess = await getWorkspaceAccessByListId(
      client,
      req.user,
      listId,
    );
    if (!ensureWorkspacePermission(res, listAccess, "Editar")) {
      await client.query("ROLLBACK");
      return;
    }
    const taskId = "task_" + Math.random().toString(36).slice(2, 10);

    const insertQuery = `
      INSERT INTO tasks (id, workspace_id, space_id, folder_id, list_id, owner_id, visibility, title, description, status_id, priority, start_date, due_date, estimate)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *, created_at as "createdAt", updated_at as "updatedAt"
    `;

    const taskResult = await client.query(insertQuery, [
      taskId,
      workspaceId,
      spaceId,
      folderId,
      listId,
      ownerId,
      visibility || "public",
      title,
      descriptionText || "",
      statusId,
      priority || "medium",
      startDate || null,
      dueDate || null,
      estimate || null,
    ]);

    // Atribuir membros
    if (assigneeIds && Array.isArray(assigneeIds)) {
      for (const mId of assigneeIds) {
        await client.query(
          "INSERT INTO task_assignees (task_id, member_id) VALUES ($1, $2)",
          [taskId, mId],
        );

        if (mId !== ownerId) {
          storedTaskNotifications.push({
            userId: mId,
            title: "Tarefa atribuída",
            message: `Nova tarefa: ${title}`,
            type: "TASK_ASSIGNED",
            referenceId: taskId,
            createdBy: ownerId,
            url: buildTaskNotificationUrl(taskId),
          });
        }
      }
    }

    // Associar etiquetas
    if (tags && Array.isArray(tags)) {
      for (const t of tags) {
        // tags is usually array of tag objects { id, name, ... }
        const tagId = typeof t === "string" ? t : t.id;
        await client.query(
          "INSERT INTO task_tags (task_id, tag_id) VALUES ($1, $2)",
          [taskId, tagId],
        );
      }
    }

    const creationActivity = await logTaskActivity(
      client,
      taskId,
      ownerId,
      "system",
      "criou esta tarefa.",
    );

    // Card criado direto numa coluna de conclusão já nasce concluído.
    await recordStatusChange(client, {
      taskId,
      fromStatusId: null,
      toStatusId: statusId,
      actorId: ownerId,
    });

    await runAutomations(client, { event: "card_criado", taskId, listId });

    const persistedCustomFieldValues = await persistTaskCustomFieldValues(
      client,
      taskId,
      workspaceId,
      customFieldValues,
    );

    if (persistedCustomFieldValues.error) {
      await client.query("ROLLBACK");
      return res
        .status(400)
        .json({ message: persistedCustomFieldValues.error });
    }

    storedTaskNotifications = await storeNotifications(
      client,
      storedTaskNotifications,
    );

    await client.query("COMMIT");

    const row = taskResult.rows[0];
    const createdTask = {
      id: row.id,
      workspaceId: row.workspace_id,
      spaceId: row.space_id,
      folderId: row.folder_id,
      listId: row.list_id,
      parentTaskId: row.parent_task_id || null,
      ownerId: row.owner_id || ownerId,
      visibility: row.visibility || "public",
      statusId: row.status_id,
      priority: row.priority,
      title: row.title,
      startDate: row.start_date,
      dueDate: row.due_date,
      estimate: row.estimate,
      coverAttachmentId: row.cover_attachment_id || null,
      createdAt: row.createdAt || row.created_at || new Date().toISOString(),
      updatedAt: row.updatedAt || row.updated_at || new Date().toISOString(),
      assigneeIds: assigneeIds || [],
      tags: tags || [],
      subtaskIds: [],
      commentIds: [],
      attachments: [],
      checklists: [],
      linkedTaskIds: [],
      customFieldValues: persistedCustomFieldValues.values || {},
      currentPermissionLevel: WORKSPACE_MANAGE_PERMISSION_LEVEL,
      description: {
        format: "html",
        value: row.description || "",
      },
    };

    const nonOwnerAssigneeIds = Array.from(
      new Set(
        (assigneeIds || []).filter(
          (memberId) => memberId && memberId !== ownerId,
        ),
      ),
    );

    publishRealtimeEvent({
      type: "task.created",
      actorId: ownerId,
      workspaceId: createdTask.workspaceId,
      excludeUserIds: [ownerId],
      payload: {
        task: createdTask,
        activities: creationActivity ? [creationActivity] : [],
      },
    });

    if (storedTaskNotifications.length > 0) {
      await dispatchStoredNotifications({
        actorId: ownerId,
        notifications: storedTaskNotifications,
        reason: "task.created",
      });
    }

    notifyWikiConnector(taskId).catch(() => {});
    notificarConhecimento(taskId);

    res.status(201).json({
      message: "Tarefa criada com sucesso!",
      task: createdTask,
      activities: creationActivity ? [creationActivity] : [],
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Erro ao criar Tarefa:", error);
    res.status(500).json({ message: "Erro interno ao criar Tarefa." });
  } finally {
    client.release();
  }
});

// Observar/desobservar tarefa (sino do card)
router.post("/tasks/:id/watchers/toggle", verifyToken, async (req, res) => {
  const taskId = req.params.id;
  const memberId = req.user.id;
  const client = await postgres.connect();

  try {
    await ensureTaskWatchersSchema(client);

    const taskAccess = await getWorkspaceAccessByTaskId(client, req.user, taskId);
    if (!ensureWorkspacePermission(res, taskAccess, "Visualizar")) {
      return;
    }

    const existingRes = await client.query(
      "SELECT 1 FROM task_watchers WHERE task_id = $1 AND member_id = $2",
      [taskId, memberId],
    );
    const isWatching = existingRes.rows.length > 0;

    if (isWatching) {
      await client.query(
        "DELETE FROM task_watchers WHERE task_id = $1 AND member_id = $2",
        [taskId, memberId],
      );
    } else {
      await client.query(
        `INSERT INTO task_watchers (task_id, member_id)
         VALUES ($1, $2)
         ON CONFLICT (task_id, member_id) DO NOTHING`,
        [taskId, memberId],
      );
    }

    const watcherIds = await getTaskWatcherIds(client, taskId);

    res.json({
      taskId,
      watching: !isWatching,
      watcherIds,
    });
  } catch (error) {
    console.error("Erro ao alternar observador da tarefa:", error);
    res
      .status(500)
      .json({ message: "Erro interno ao atualizar observadores da tarefa." });
  } finally {
    client.release();
  }
});

// Duplicar Tarefa
router.post("/tasks/:id/duplicate", verifyToken, async (req, res) => {
  const sourceTaskId = req.params.id;
  const actorId = req.user.id;
  const client = await postgres.connect();

  try {
    await client.query("BEGIN");
    await ensureTaskCoverSchema(client);
    await ensureCustomFieldsSchema(client);

    const taskAccess = await getWorkspaceAccessByTaskId(
      client,
      req.user,
      sourceTaskId,
    );
    if (!ensureWorkspacePermission(res, taskAccess, "Editar")) {
      await client.query("ROLLBACK");
      return;
    }

    const sourceRes = await client.query(
      "SELECT * FROM tasks WHERE id = $1",
      [sourceTaskId],
    );
    const source = sourceRes.rows[0];

    if (!source) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Tarefa não encontrada." });
    }

    const newTaskId = "task_" + Math.random().toString(36).slice(2, 10);
    const newTitle = `${source.title} (cópia)`;

    const insertRes = await client.query(
      `INSERT INTO tasks (
        id, workspace_id, space_id, folder_id, list_id, parent_task_id, owner_id,
        visibility, title, description, description_link_display_modes, status_id,
        priority, start_date, due_date, estimate
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11, '{}'::jsonb),$12,$13,$14,$15,$16)
      RETURNING *, created_at as "createdAt", updated_at as "updatedAt"`,
      [
        newTaskId,
        source.workspace_id,
        source.space_id,
        source.folder_id,
        source.list_id,
        source.parent_task_id,
        actorId,
        source.visibility || "public",
        newTitle,
        source.description,
        source.description_link_display_modes,
        source.status_id,
        source.priority,
        source.start_date,
        source.due_date,
        source.estimate,
      ],
    );

    await client.query(
      `INSERT INTO task_assignees (task_id, member_id)
       SELECT $1, member_id FROM task_assignees WHERE task_id = $2
       ON CONFLICT DO NOTHING`,
      [newTaskId, sourceTaskId],
    );

    await client.query(
      `INSERT INTO task_tags (task_id, tag_id)
       SELECT $1, tag_id FROM task_tags WHERE task_id = $2
       ON CONFLICT DO NOTHING`,
      [newTaskId, sourceTaskId],
    );

    const checklistsRes = await client.query(
      "SELECT id, name FROM checklists WHERE task_id = $1 ORDER BY created_at ASC",
      [sourceTaskId],
    );

    for (const checklist of checklistsRes.rows) {
      const newChecklistId = "chk_" + Math.random().toString(36).slice(2, 10);
      await client.query(
        "INSERT INTO checklists (id, task_id, name) VALUES ($1, $2, $3)",
        [newChecklistId, newTaskId, checklist.name],
      );

      const itemsRes = await client.query(
        "SELECT label, done FROM checklist_items WHERE checklist_id = $1 ORDER BY created_at ASC",
        [checklist.id],
      );

      for (const item of itemsRes.rows) {
        await client.query(
          "INSERT INTO checklist_items (id, checklist_id, label, done) VALUES ($1, $2, $3, $4)",
          [
            "chki_" + Math.random().toString(36).slice(2, 10),
            newChecklistId,
            item.label,
            item.done,
          ],
        );
      }
    }

    const sourceCustomFieldValues =
      (await loadTaskCustomFieldValues(client, [sourceTaskId]))[sourceTaskId] ||
      {};
    const persistedCustomFieldValues = await persistTaskCustomFieldValues(
      client,
      newTaskId,
      source.workspace_id,
      sourceCustomFieldValues,
    );

    const creationActivity = await logTaskActivity(
      client,
      newTaskId,
      actorId,
      "system",
      `duplicou a tarefa "${source.title}".`,
    );

    await client.query("COMMIT");

    const duplicatedTask = await buildTaskRealtimeSnapshot(client, newTaskId);

    if (duplicatedTask) {
      duplicatedTask.currentPermissionLevel =
        taskAccess.effectivePermission || WORKSPACE_MANAGE_PERMISSION_LEVEL;
      duplicatedTask.customFieldValues =
        persistedCustomFieldValues.values || duplicatedTask.customFieldValues;

      publishRealtimeEvent({
        type: "task.created",
        actorId,
        workspaceId: duplicatedTask.workspaceId,
        excludeUserIds: [actorId],
        payload: {
          task: duplicatedTask,
          activities: creationActivity ? [creationActivity] : [],
        },
      });
    }

    const insertedRow = insertRes.rows[0];

    res.status(201).json({
      message: "Tarefa duplicada com sucesso!",
      task: duplicatedTask || {
        id: insertedRow.id,
        listId: insertedRow.list_id,
        statusId: insertedRow.status_id,
        title: insertedRow.title,
      },
      activities: creationActivity ? [creationActivity] : [],
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Erro ao duplicar Tarefa:", error);
    res.status(500).json({ message: "Erro interno ao duplicar Tarefa." });
  } finally {
    client.release();
  }
});

// Atualizar Tarefa
router.put("/tasks/:id", verifyToken, async (req, res) => {
  const taskId = req.params.id;

  const client = await postgres.connect();
  let storedTaskNotifications = [];
  try {
    await client.query("BEGIN");
    await ensureTaskCoverSchema(client);
    await ensureCustomFieldsSchema(client);
    const taskAccess = await getWorkspaceAccessByTaskId(
      client,
      req.user,
      taskId,
    );
    if (isStatusOnlyTaskUpdate(req.body)) {
      if (!canMoveTaskByAccess(taskAccess)) {
        await client.query("ROLLBACK");
        return res.status(403).json({
          message: "Você não tem permissão para mover esta tarefa.",
        });
      }
    } else if (!ensureWorkspacePermission(res, taskAccess, "Editar")) {
      await client.query("ROLLBACK");
      return;
    }

    // Carregar a tarefa antiga para checar mudanÃ§as
    const oldTaskRes = await client.query("SELECT * FROM tasks WHERE id = $1", [
      taskId,
    ]);
    const oldTask = oldTaskRes.rows[0];
    const currentAssigneesRes = await client.query(
      "SELECT member_id FROM task_assignees WHERE task_id = $1",
      [taskId],
    );
    const previousAssigneeIds = currentAssigneesRes.rows.map(
      (row) => row.member_id,
    );
    const previousCustomFieldValues =
      (await loadTaskCustomFieldValues(client, [taskId]))[taskId] || {};

    // 1. Montar a query dinamicamente baseada nos campos enviados
    const fields = [];
    const values = [];
    let idx = 1;

    const activities = [];
    const pendingNotifications = [];

    if (req.body.title !== undefined) {
      fields.push(`title = $${idx++}`);
      values.push(req.body.title);
      if (oldTask && oldTask.title !== req.body.title)
        activities.push(
          await logTaskActivity(
            client,
            taskId,
            req.user.id,
            "system",
            `alterou o título para "${req.body.title}"`,
          ),
        );
    }
    if (req.body.description !== undefined) {
      fields.push(`description = $${idx++}`);
      values.push(req.body.description);
      if (oldTask && oldTask.description !== req.body.description)
        activities.push(
          await logTaskActivity(
            client,
            taskId,
            req.user.id,
            "comment",
            `alterou a descrição da tarefa.`,
          ),
        );
    }
    if (req.body.descriptionLinkDisplayModes !== undefined) {
      fields.push(`description_link_display_modes = $${idx++}`);
      values.push(req.body.descriptionLinkDisplayModes || {});
    }
    if (req.body.statusId !== undefined) {
      fields.push(`status_id = $${idx++}`);
      values.push(req.body.statusId);
      if (oldTask && oldTask.status_id !== req.body.statusId)
        activities.push(
          await logTaskActivity(
            client,
            taskId,
            req.user.id,
            "status",
            `moveu a tarefa para outro status.`,
          ),
        );
    }
    if (req.body.priority !== undefined) {
      fields.push(`priority = $${idx++}`);
      values.push(req.body.priority);
      if (oldTask && oldTask.priority !== req.body.priority)
        activities.push(
          await logTaskActivity(
            client,
            taskId,
            req.user.id,
            "system",
            `alterou a prioridade para ${req.body.priority || "Nenhuma"}.`,
          ),
        );
    }
    if (req.body.startDate !== undefined) {
      fields.push(`start_date = $${idx++}`);
      values.push(req.body.startDate);
      if (oldTask && oldTask.start_date !== req.body.startDate)
        activities.push(
          await logTaskActivity(
            client,
            taskId,
            req.user.id,
            "date",
            `alterou a data de início.`,
          ),
        );
    }
    if (req.body.dueDate !== undefined) {
      fields.push(`due_date = $${idx++}`);
      values.push(req.body.dueDate);
      if (oldTask && oldTask.due_date !== req.body.dueDate)
        activities.push(
          await logTaskActivity(
            client,
            taskId,
            req.user.id,
            "date",
            `alterou o prazo.`,
          ),
        );
    }
    if (req.body.estimate !== undefined) {
      fields.push(`estimate = $${idx++}`);
      values.push(req.body.estimate);
      if (oldTask && oldTask.estimate !== req.body.estimate)
        activities.push(
          await logTaskActivity(
            client,
            taskId,
            req.user.id,
            "date",
            `alterou a estimativa de tempo.`,
          ),
        );
    }
    if (req.body.coverAttachmentId !== undefined) {
      const nextCoverAttachmentId = req.body.coverAttachmentId || null;

      if (nextCoverAttachmentId) {
        const coverAttachmentRes = await client.query(
          "SELECT id, type FROM task_attachments WHERE id = $1 AND task_id = $2",
          [nextCoverAttachmentId, taskId],
        );
        const coverAttachment = coverAttachmentRes.rows[0];

        if (!coverAttachment) {
          await client.query("ROLLBACK");
          return res.status(400).json({
            message: "O anexo informado nÃ£o pertence a esta tarefa.",
          });
        }

        if (coverAttachment.type !== "image") {
          await client.query("ROLLBACK");
          return res.status(400).json({
            message: "A capa do card precisa ser um anexo do tipo imagem.",
          });
        }
      }

      fields.push(`cover_attachment_id = $${idx++}`);
      values.push(nextCoverAttachmentId);
      if (oldTask && oldTask.cover_attachment_id !== nextCoverAttachmentId) {
        activities.push(
          await logTaskActivity(
            client,
            taskId,
            req.user.id,
            "system",
            nextCoverAttachmentId
              ? "definiu uma imagem como capa do card."
              : "removeu a capa do card.",
          ),
        );
      }
    }

    if (fields.length > 0) {
      fields.push(`updated_at = CURRENT_TIMESTAMP`);
      const updateTaskQuery = `
        UPDATE tasks 
        SET ${fields.join(", ")}
        WHERE id = $${idx}
        RETURNING id
      `;
      values.push(taskId);
      await client.query(updateTaskQuery, values);
    }

    if (
      req.body.description !== undefined &&
      oldTask &&
      oldTask.description !== req.body.description
    ) {
      pendingNotifications.push(
        ...(await buildMentionNotifications(client, {
          taskId,
          actorId: req.user.id,
          mentionIds: req.body.mentionIds,
          source: "description",
        })),
      );
    }

    // 2. Atualizar Etiquetas (Delete e Insert)
    const { tags, assigneeIds } = req.body;
    if (tags && Array.isArray(tags)) {
      activities.push(
        await logTaskActivity(
          client,
          taskId,
          req.user.id,
          "system",
          `atualizou as etiquetas da tarefa.`,
        ),
      );
      await client.query("DELETE FROM task_tags WHERE task_id = $1", [taskId]);
      for (const t of tags) {
        await client.query(
          "INSERT INTO task_tags (task_id, tag_id) VALUES ($1, $2)",
          [taskId, t.id],
        );
      }
    }

    // 3. Atualizar Atribuí­dos (Opcional, se enviado)
    if (assigneeIds && Array.isArray(assigneeIds)) {
      activities.push(
        await logTaskActivity(
          client,
          taskId,
          req.user.id,
          "system",
          `atualizou os responsáveis.`,
        ),
      );
      await client.query("DELETE FROM task_assignees WHERE task_id = $1", [
        taskId,
      ]);
      for (const mId of assigneeIds) {
        await client.query(
          "INSERT INTO task_assignees (task_id, member_id) VALUES ($1, $2)",
          [taskId, mId],
        );
      }
    }

    if (req.body.customFieldValues !== undefined) {
      const persistedCustomFieldValues = await persistTaskCustomFieldValues(
        client,
        taskId,
        taskAccess.workspaceId,
        req.body.customFieldValues,
      );

      if (persistedCustomFieldValues.error) {
        await client.query("ROLLBACK");
        return res
          .status(400)
          .json({ message: persistedCustomFieldValues.error });
      }

      if (
        !areTaskCustomFieldMapsEqual(
          previousCustomFieldValues,
          persistedCustomFieldValues.values,
        )
      ) {
        activities.push(
          await logTaskActivity(
            client,
            taskId,
            req.user.id,
            "system",
            "atualizou os campos personalizados.",
          ),
        );
      }
    }

    const newlyAssignedUserIds = Array.isArray(assigneeIds)
      ? Array.from(
          new Set(
            assigneeIds.filter(
              (memberId) =>
                memberId &&
                memberId !== req.user.id &&
                !previousAssigneeIds.includes(memberId),
            ),
          ),
        )
      : [];

    if (newlyAssignedUserIds.length > 0) {
      await runAutomations(client, {
        event: "card_recebeu_responsavel",
        taskId,
        listId: oldTask?.list_id,
        dados: { memberIds: newlyAssignedUserIds },
      });

      for (const memberId of newlyAssignedUserIds) {
        pendingNotifications.push({
          userId: memberId,
          title: "Tarefa atribuída",
          message: `Você foi atribuído à tarefa ${oldTask?.title || req.body.title || "sem título"}`,
          type: "TASK_ASSIGNED",
          referenceId: taskId,
          createdBy: req.user.id,
          url: buildTaskNotificationUrl(taskId),
        });
      }
    }

    if (
      req.body.dueDate !== undefined &&
      oldTask &&
      oldTask.due_date !== req.body.dueDate
    ) {
      pendingNotifications.push(
        ...(await buildTaskDueDateChangeNotifications(client, {
          taskId,
          actorId: req.user.id,
          dueDate: req.body.dueDate,
          excludeUserIds: newlyAssignedUserIds,
        })),
      );
    }

    if (
      req.body.statusId !== undefined &&
      oldTask &&
      oldTask.status_id !== req.body.statusId
    ) {
      // Histórico para os relatórios (entregas por semana, tempo até concluir).
      await recordStatusChange(client, {
        taskId,
        fromStatusId: oldTask.status_id,
        toStatusId: req.body.statusId,
        actorId: req.user.id,
      });
      await runAutomations(client, {
        event: "card_mudou_coluna",
        taskId,
        listId: oldTask.list_id,
        dados: { toStatusId: req.body.statusId },
      });
      pendingNotifications.push(
        ...(await buildTaskStatusChangeNotifications(client, {
          taskId,
          actorId: req.user.id,
          statusId: req.body.statusId,
          excludeUserIds: newlyAssignedUserIds,
        })),
      );
    }

    if (
      req.body.priority !== undefined &&
      oldTask &&
      oldTask.priority !== req.body.priority
    ) {
      await runAutomations(client, {
        event: "card_mudou_prioridade",
        taskId,
        listId: oldTask.list_id,
        dados: { priority: req.body.priority },
      });
    }

    storedTaskNotifications = await storeNotifications(
      client,
      pendingNotifications,
    );

    await client.query("COMMIT");

    await emitTaskUpdatedRealtime(client, {
      taskId,
      actorId: req.user.id,
      activities,
    });

    if (storedTaskNotifications.length > 0) {
      await dispatchStoredNotifications({
        actorId: req.user.id,
        notifications: storedTaskNotifications,
        reason: "task.updated",
      });
    }

    res.json({
      message: "Tarefa atualizada com sucesso!",
      activities: activities.filter(Boolean),
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Erro ao atualizar tarefa:", error);
    res.status(500).json({ message: "Erro ao atualizar tarefa." });
  } finally {
    client.release();
  }
});

// Deletar Tarefa: guarda uma cópia na lixeira e remove do quadro
router.delete("/tasks/:id", verifyToken, async (req, res) => {
  const taskId = req.params.id;

  const client = await postgres.connect();
  try {
    await client.query("BEGIN");
    const taskAccess = await getWorkspaceAccessByTaskId(
      client,
      req.user,
      taskId,
    );
    if (!ensureWorkspacePermission(res, taskAccess, "Editar")) {
      await client.query("ROLLBACK");
      return;
    }

    const { rows: orgDoCard } = await client.query(
      "SELECT w.organization_id FROM tasks t INNER JOIN workspaces w ON w.id = t.workspace_id WHERE t.id = $1",
      [taskId],
    );
    const organizacaoDoCard = orgDoCard[0]?.organization_id || null;

    // Os arquivos continuam na Bunny enquanto o card estiver na lixeira.
    await moveTaskToTrash(client, { taskId, deletedBy: req.user.id });

    // 1. Remover relações
    await client.query("DELETE FROM task_tags WHERE task_id = $1", [taskId]);
    await client.query("DELETE FROM task_assignees WHERE task_id = $1", [
      taskId,
    ]);

    // 2. Remover subtasks (se houver)
    const subtasksResult = await client.query(
      "DELETE FROM tasks WHERE parent_task_id = $1 RETURNING id",
      [taskId],
    );

    // 3. Remover a task
    const result = await client.query(
      "DELETE FROM tasks WHERE id = $1 RETURNING id",
      [taskId],
    );
    // O delete é físico: o Hub de Conhecimento precisa de um registro para remover também.
    await registrarExclusoes(client, organizacaoDoCard, [
      ...(result.rows.length ? [taskId] : []),
      ...subtasksResult.rows.map((row) => row.id),
    ]);

    if (result.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Tarefa não encontrada." });
    }

    await client.query("COMMIT");
    publishSeedRefetch({
      actorId: req.user.id,
      workspaceId: taskAccess.workspaceId,
      reason: "task.deleted",
    });

    // notifica connector wiki da deleção (task + subtasks) — fire-and-forget
    notifyWikiConnector(taskId, "deleted").catch(() => {});
    subtasksResult.rows.forEach((row) => {
      notifyWikiConnector(row.id, "deleted").catch(() => {});
    });
    notificarConhecimento(
      [taskId, ...subtasksResult.rows.map((row) => row.id)],
      "delete",
      organizacaoDoCard,
    );

    res.json({ message: "Tarefa deletada com sucesso." });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Erro ao deletar tarefa:", error);
    res.status(500).json({ message: "Erro interno ao deletar tarefa." });
  } finally {
    client.release();
  }
});

// Soft Delete de um Projeto (List)
router.put("/lists/:id", verifyToken, async (req, res) => {
  const listId = req.params.id;
  const { name, visibility, startDate, dueDate, tags, color } = req.body;

  const fields = [];
  const values = [];
  let idx = 1;
  const shouldUpdateTags = Array.isArray(tags);

  if (name !== undefined) {
    fields.push(`name = $${idx++}`);
    values.push(name);
  }

  if (visibility !== undefined) {
    fields.push(`visibility = $${idx++}`);
    values.push(visibility);
  }

  if (startDate !== undefined) {
    fields.push(`start_date = $${idx++}`);
    values.push(startDate);
  }

  if (dueDate !== undefined) {
    fields.push(`due_date = $${idx++}`);
    values.push(dueDate);
  }

  if (color !== undefined) {
    fields.push(`color_class = $${idx++}`);
    values.push(color);
  }

  if (fields.length === 0 && !shouldUpdateTags) {
    return res
      .status(400)
      .json({ message: "Nenhum campo válido para atualização." });
  }

  const client = await postgres.connect();
  try {
    await client.query("BEGIN");
    const listAccess = await getWorkspaceAccessByListId(
      client,
      req.user,
      listId,
    );
    if (!ensureWorkspacePermission(res, listAccess, "Editar")) {
      await client.query("ROLLBACK");
      return;
    }

    let list = null;

    if (fields.length > 0) {
      values.push(listId);
      const result = await client.query(
        `
          UPDATE lists
          SET ${fields.join(", ")}, updated_at = CURRENT_TIMESTAMP
          WHERE id = $${idx}
          RETURNING
            id,
            folder_id as "folderId",
            name,
            owner_id as "ownerId",
            visibility,
            start_date as "startDate",
            due_date as "dueDate",
            color_class as "color",
            color_class as "colorClass";
        `,
        values,
      );
      list = result.rows[0] || null;
    } else {
      const result = await client.query(
        `
          SELECT
            id,
            folder_id as "folderId",
            name,
            owner_id as "ownerId",
            visibility,
            start_date as "startDate",
            due_date as "dueDate",
            color_class as "color",
            color_class as "colorClass"
          FROM lists
          WHERE id = $1
        `,
        [listId],
      );
      list = result.rows[0] || null;
    }

    if (!list) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Projeto não encontrado." });
    }

    if (shouldUpdateTags) {
      await client.query("DELETE FROM list_tags WHERE list_id = $1", [listId]);

      for (const tag of tags) {
        const tagId = typeof tag === "string" ? tag : tag?.id;
        if (!tagId) continue;

        await client.query(
          "INSERT INTO list_tags (list_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
          [listId, tagId],
        );
      }
    }

    const tagsResult = await client.query(
      `
        SELECT t.id, t.name, t.color
        FROM tags t
        INNER JOIN list_tags lt ON lt.tag_id = t.id
        WHERE lt.list_id = $1
        ORDER BY t.name ASC
      `,
      [listId],
    );

    await client.query("COMMIT");

    publishSeedRefetch({
      actorId: req.user.id,
      workspaceId: listAccess.workspaceId,
      reason: "list.updated",
    });

    res.json({
      message: "Projeto atualizado com sucesso.",
      list: {
        ...list,
        tags: tagsResult.rows,
      },
    });
    syncStorageFolderName("lists", listId);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Erro ao atualizar projeto:", error);
    res.status(500).json({ message: "Erro interno ao atualizar projeto." });
  } finally {
    client.release();
  }
});

// Soft Delete de um Projeto (List)
router.delete("/lists/:id", verifyToken, async (req, res) => {
  const listId = req.params.id;
  const ownerId = req.user.id; // Podem haver verificações de permissões aqui posteriormente

  const client = await postgres.connect();
  try {
    const listAccess = await getWorkspaceAccessByListId(
      client,
      req.user,
      listId,
    );
    if (!ensureWorkspacePermission(res, listAccess, "Editar")) return;
    const updateQuery = `
      UPDATE lists 
      SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING id
    `;

    const result = await client.query(updateQuery, [listId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Projeto não encontrado." });
    }
    await registerListInTrash(client, { listId, deletedBy: req.user.id });

    publishSeedRefetch({
      actorId: req.user.id,
      workspaceId: listAccess.workspaceId,
      reason: "list.deleted",
    });
    res.json({ message: "Projeto movido para a lixeira." });
  } catch (error) {
    console.error("Erro ao deletar Projeto/List:", error);
    res.status(500).json({ message: "Erro interno ao deletar Projeto." });
  } finally {
    client.release();
  }
});

// Toggle assignee de um Projeto (List)
router.put("/lists/:id/assignees", verifyToken, async (req, res) => {
  const listId = req.params.id;
  const { memberId } = req.body;
  const ownerId = req.user.id;
  if (!memberId)
    return res.status(400).json({ message: "memberId obrigatório." });

  const client = await postgres.connect();
  try {
    const listAccess = await getWorkspaceAccessByListId(
      client,
      req.user,
      listId,
    );
    if (!ensureWorkspacePermission(res, listAccess, "Editar")) return;
    const existing = await client.query(
      "SELECT 1 FROM list_assignees WHERE list_id = $1 AND member_id = $2",
      [listId, memberId],
    );
    const assigneeWasPresent = existing.rows.length > 0;
    if (existing.rows.length > 0) {
      await client.query(
        "DELETE FROM list_assignees WHERE list_id = $1 AND member_id = $2",
        [listId, memberId],
      );
    } else {
      await client.query(
        "INSERT INTO list_assignees (list_id, member_id) VALUES ($1, $2)",
        [listId, memberId],
      );
    }
    const assigneesRes = await client.query(
      "SELECT member_id FROM list_assignees WHERE list_id = $1",
      [listId],
    );
    publishSeedRefetch({
      actorId: ownerId,
      workspaceId: listAccess.workspaceId,
      userIds: [memberId],
      reason: "list.assignees.updated",
    });
    if (!assigneeWasPresent) {
      const storedNotifications = await storeNotifications(client, [
        {
          userId: memberId,
          title: "Projeto atribuído",
          message: "Você foi atribuído a um projeto.",
          type: "LIST_ASSIGNED",
          referenceId: listId,
          createdBy: req.user.id,
          url: buildListNotificationUrl(listId),
        },
      ]);
      await dispatchStoredNotifications({
        actorId: req.user.id,
        notifications: storedNotifications,
        reason: "list.assignees.updated",
      });
    }
    res.json({ assigneeIds: assigneesRes.rows.map((r) => r.member_id) });
  } catch (error) {
    console.error("Erro ao atualizar assignee do projeto:", error);
    res.status(500).json({ message: "Erro interno ao atualizar assignee." });
  } finally {
    client.release();
  }
});

// === Colunas (status) por projeto/lista ===

// Criar coluna nova vinculada a uma lista (somente admin)
router.post("/lists/:listId/statuses", verifyToken, async (req, res) => {
  if (!isWorkspaceAdmin(req.user)) {
    return res
      .status(403)
      .json({ message: "Apenas administradores podem criar colunas." });
  }
  const { listId } = req.params;
  const { name, colorClass, chipClass, dotClass } = req.body || {};
  if (!name || !name.trim()) {
    return res.status(400).json({ message: "Nome da coluna é obrigatório." });
  }

  const client = await postgres.connect();
  try {
    await ensureStatusListSchema(client);
    const access = await getWorkspaceAccessByListId(client, req.user, listId);
    if (!access || !access.workspaceId) {
      return res.status(404).json({ message: "Projeto não encontrado." });
    }

    const id = "st_" + Math.random().toString(36).slice(2, 10);
    const orderRes = await client.query(
      "SELECT COALESCE(MAX(display_order), 0) + 1 as next_order FROM status_definitions",
    );
    const nextOrder = orderRes.rows[0].next_order;

    const created = {
      id,
      name: name.trim(),
      colorClass: colorClass || "bg-slate-50",
      chipClass: chipClass || "bg-slate-100 text-slate-700 ring-slate-200",
      dotClass: dotClass || "bg-slate-500",
      order: nextOrder,
      listId,
    };

    await client.query(
      `INSERT INTO status_definitions (id, name, color_class, chip_class, dot_class, display_order, list_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        created.id,
        created.name,
        created.colorClass,
        created.chipClass,
        created.dotClass,
        created.order,
        listId,
      ],
    );

    publishSeedRefetch({
      actorId: req.user.id,
      workspaceId: access.workspaceId,
      reason: "status.created",
    });

    return res.status(201).json({ status: created });
  } catch (e) {
    console.error("Erro ao criar coluna:", e);
    return res.status(500).json({ message: "Erro ao criar coluna." });
  } finally {
    client.release();
  }
});

// Reordenar colunas de um projeto. Colunas globais são compartilhadas por
// todas as contas, então só administradores da conta podem reordená-las.
router.put("/statuses/reorder", verifyToken, async (req, res) => {
  const { orders, listId } = req.body || {};
  if (!Array.isArray(orders) || orders.length === 0) {
    return res.status(400).json({ message: "Lista de ordens inválida." });
  }

  const client = await postgres.connect();
  try {
    if (listId) {
      const listAccess = await getWorkspaceAccessByListId(client, req.user, listId);
      if (!ensureWorkspacePermission(res, listAccess, "Editar")) {
        return;
      }
    } else if (!isWorkspaceAdmin(req.user)) {
      return res.status(403).json({
        message: "Só o titular ou um administrador da conta pode reordenar as colunas padrão.",
      });
    }

    await client.query("BEGIN");
    for (const item of orders) {
      if (!item || !item.id || typeof item.order !== "number") continue;
      // Com um projeto informado, a ordem só mexe nas colunas dele e nas globais.
      await client.query(
        listId
          ? `
              UPDATE status_definitions
              SET display_order = $1
              WHERE id = $2 AND (list_id IS NULL OR list_id = $3)
            `
          : "UPDATE status_definitions SET display_order = $1 WHERE id = $2",
        listId ? [item.order, item.id, listId] : [item.order, item.id],
      );
    }
    await client.query("COMMIT");

    publishSeedRefetch({
      actorId: req.user.id,
      organizationId: req.user.organizationId,
      reason: "status.reordered",
    });

    return res.json({ ok: true });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("Erro ao reordenar colunas:", e);
    return res.status(500).json({ message: "Erro ao reordenar colunas." });
  } finally {
    client.release();
  }
});

// Editar uma coluna (status) — específico por projeto/lista.
// - Se a coluna já pertence à lista (list_id = listId): atualiza direto.
// - Se a coluna é global (list_id NULL): faz "fork" — cria uma cópia específica
//   da lista com as edições, esconde a global apenas nessa lista e migra as
//   tarefas da lista para a nova coluna. Outros projetos não são afetados.
router.put("/statuses/:id", verifyToken, async (req, res) => {
  if (!isWorkspaceAdmin(req.user)) {
    return res
      .status(403)
      .json({ message: "Apenas administradores podem editar colunas." });
  }
  const { id } = req.params;
  const { name, colorClass, chipClass, dotClass, listId } = req.body || {};
  if (!name || !name.trim()) {
    return res.status(400).json({ message: "Nome da coluna é obrigatório." });
  }
  if (!listId) {
    return res.status(400).json({ message: "Projeto (listId) é obrigatório." });
  }

  const client = await postgres.connect();
  try {
    await ensureStatusListSchema(client);

    const access = await getWorkspaceAccessByListId(client, req.user, listId);
    if (!access || !access.workspaceId) {
      return res.status(404).json({ message: "Projeto não encontrado." });
    }

    const curRes = await client.query(
      "SELECT id, display_order, list_id FROM status_definitions WHERE id = $1",
      [id],
    );
    if (curRes.rows.length === 0) {
      return res.status(404).json({ message: "Coluna não encontrada." });
    }
    const current = curRes.rows[0];

    const nextName = name.trim();
    const nextColorClass = colorClass || "bg-slate-50";
    const nextChipClass =
      chipClass || "bg-slate-100 text-slate-700 ring-slate-200";
    const nextDotClass = dotClass || "bg-slate-500";

    // Caso 1: coluna já é específica desta lista → atualiza direto.
    if (current.list_id === listId) {
      await client.query(
        `UPDATE status_definitions
         SET name = $1, color_class = $2, chip_class = $3, dot_class = $4
         WHERE id = $5`,
        [nextName, nextColorClass, nextChipClass, nextDotClass, id],
      );

      publishSeedRefetch({
        actorId: req.user.id,
        workspaceId: access.workspaceId,
        reason: "status.updated",
      });

      return res.json({
        status: {
          id,
          name: nextName,
          colorClass: nextColorClass,
          chipClass: nextChipClass,
          dotClass: nextDotClass,
          order: current.display_order,
          listId,
        },
      });
    }

    // Coluna pertence a OUTRA lista → não permitido editar a partir deste projeto.
    if (current.list_id != null && current.list_id !== listId) {
      return res
        .status(403)
        .json({ message: "Coluna pertence a outro projeto." });
    }

    // Caso 2: coluna global (list_id NULL) → fork específico desta lista.
    await client.query("BEGIN");
    const newId = "st_" + Math.random().toString(36).slice(2, 10);
    await client.query(
      `INSERT INTO status_definitions (id, name, color_class, chip_class, dot_class, display_order, list_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        newId,
        nextName,
        nextColorClass,
        nextChipClass,
        nextDotClass,
        current.display_order,
        listId,
      ],
    );
    await client.query(
      `INSERT INTO status_list_hidden (status_id, list_id)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [id, listId],
    );
    // Migra as tarefas desta lista que usavam a coluna global para a nova coluna.
    await client.query(
      `UPDATE tasks SET status_id = $1 WHERE list_id = $2 AND status_id = $3`,
      [newId, listId, id],
    );
    await client.query("COMMIT");

    publishSeedRefetch({
      actorId: req.user.id,
      workspaceId: access.workspaceId,
      reason: "status.updated",
    });

    return res.json({
      status: {
        id: newId,
        name: nextName,
        colorClass: nextColorClass,
        chipClass: nextChipClass,
        dotClass: nextDotClass,
        order: current.display_order,
        listId,
      },
      forkedFrom: id,
    });
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    console.error("Erro ao editar coluna:", e);
    return res.status(500).json({ message: "Erro ao editar coluna." });
  } finally {
    client.release();
  }
});

router.post("/tasks/:id/subtasks", verifyToken, async (req, res) => {
  const parentTaskId = req.params.id;
  const { title } = req.body;
  if (!title) return res.status(400).json({ message: "Título obrigatório." });

  const client = await postgres.connect();
  try {
    const taskAccess = await getWorkspaceAccessByTaskId(
      client,
      req.user,
      parentTaskId,
    );
    if (!ensureWorkspacePermission(res, taskAccess, "Comentário")) return;
    const parentRes = await client.query(
      "SELECT workspace_id, space_id, folder_id, list_id FROM tasks WHERE id = $1",
      [parentTaskId],
    );
    if (parentRes.rows.length === 0)
      return res.status(404).json({ message: "Tarefa pai nao encontrada." });
    const parent = parentRes.rows[0];

    const taskId = "task_" + Math.random().toString(36).slice(2, 10);

    // Buscar ou criar status "Subtarefas"
    let statusRes = await client.query(
      "SELECT id FROM status_definitions WHERE id = 'status_subtasks'",
    );
    let statusId;
    if (statusRes.rows.length === 0) {
      // Obter o maior display_order atual
      const maxOrderRes = await client.query(
        "SELECT COALESCE(MAX(display_order), 0) + 1 as next_order FROM status_definitions",
      );
      const nextOrder = maxOrderRes.rows[0].next_order;
      await client.query(
        "INSERT INTO status_definitions (id, name, color_class, chip_class, dot_class, display_order) VALUES ($1,$2,$3,$4,$5,$6)",
        [
          "status_subtasks",
          "Subtarefas",
          "bg-slate-500",
          "bg-slate-100 text-slate-700",
          "bg-slate-400",
          nextOrder,
        ],
      );
      statusId = "status_subtasks";
    } else {
      statusId = statusRes.rows[0].id;
    }

    await client.query(
      `INSERT INTO tasks (id, workspace_id, space_id, folder_id, list_id, parent_task_id, title, status_id, priority)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        taskId,
        parent.workspace_id,
        parent.space_id,
        parent.folder_id,
        parent.list_id,
        parentTaskId,
        title.trim(),
        statusId,
        "medium",
      ],
    );

    // Registra log na tarefa pai e na subtarefa
    await logTaskActivity(
      client,
      parentTaskId,
      req.user.id,
      "system",
      `criou a subtarefa "${title.trim()}".`,
    );
    await logTaskActivity(
      client,
      taskId,
      req.user.id,
      "system",
      `criada como subtarefa.`,
    );
    const storedNotifications = await storeNotifications(
      client,
      await buildSubtaskCreatedNotifications(client, {
        parentTaskId,
        subtaskId: taskId,
        actorId: req.user.id,
        subtaskTitle: title.trim(),
      }),
    );

    // Buscar o status definition completo para retornar ao frontend
    const statusDefRes = await client.query(
      'SELECT id, name, color_class as "colorClass", chip_class as "chipClass", dot_class as "dotClass", display_order as "order" FROM status_definitions WHERE id = $1',
      [statusId],
    );

    publishSeedRefetch({
      actorId: req.user.id,
      workspaceId: parent.workspace_id,
      reason: "subtask.created",
    });

    if (storedNotifications.length > 0) {
      await dispatchStoredNotifications({
        actorId: req.user.id,
        notifications: storedNotifications,
        reason: "subtask.created",
      });
    }

    res.status(201).json({
      subtask: {
        id: taskId,
        workspaceId: parent.workspace_id,
        spaceId: parent.space_id,
        folderId: parent.folder_id,
        listId: parent.list_id,
        parentTaskId,
        title: title.trim(),
        description: { format: "html", value: "" },
        statusId,
        priority: "medium",
        dueDate: null,
        startDate: null,
        assigneeIds: [],
        tags: [],
        subtaskIds: [],
        attachments: [],
        checklists: [],
        linkedTaskIds: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      statusDefinition: statusDefRes.rows[0] || null,
    });
  } catch (error) {
    console.error("Erro ao criar subtask:", error);
    res.status(500).json({ message: "Erro interno." });
  } finally {
    client.release();
  }
});

router.post("/tasks/:id/checklists", verifyToken, async (req, res) => {
  const taskId = req.params.id;
  const { name } = req.body;
  const clId = "cl_" + Math.random().toString(36).slice(2, 10);

  const client = await postgres.connect();
  try {
    const taskAccess = await getWorkspaceAccessByTaskId(
      client,
      req.user,
      taskId,
    );
    if (!ensureWorkspacePermission(res, taskAccess, "Comentário")) return;
    await client.query(
      "INSERT INTO checklists (id, task_id, name) VALUES ($1,$2,$3)",
      [clId, taskId, name || "Nova Checklist"],
    );
    await emitTaskUpdatedRealtime(client, {
      taskId,
      actorId: req.user.id,
    });
    res.status(201).json({
      checklist: { id: clId, name: name || "Nova Checklist", items: [] },
    });
  } catch (error) {
    console.error("Erro ao criar checklist:", error);
    res.status(500).json({ message: "Erro interno." });
  } finally {
    client.release();
  }
});

router.delete("/checklists/:id", verifyToken, async (req, res) => {
  const clId = req.params.id;
  const client = await postgres.connect();
  try {
    const checklistAccess = await getWorkspaceAccessByChecklistId(
      client,
      req.user,
      clId,
    );
    if (!ensureWorkspacePermission(res, checklistAccess, "Comentário")) return;
    const checklistRes = await client.query(
      "SELECT task_id FROM checklists WHERE id = $1",
      [clId],
    );
    const taskId = checklistRes.rows[0]?.task_id || null;
    await client.query("DELETE FROM checklists WHERE id = $1", [clId]);
    if (taskId) {
      await emitTaskUpdatedRealtime(client, {
        taskId,
        actorId: req.user.id,
      });
    }
    res.json({ message: "Checklist removida." });
  } catch (error) {
    console.error("Erro ao deletar checklist:", error);
    res.status(500).json({ message: "Erro interno." });
  } finally {
    client.release();
  }
});

router.put("/checklists/:id", verifyToken, async (req, res) => {
  const clId = req.params.id;
  const { name } = req.body;
  const client = await postgres.connect();
  try {
    const checklistAccess = await getWorkspaceAccessByChecklistId(
      client,
      req.user,
      clId,
    );
    if (!ensureWorkspacePermission(res, checklistAccess, "Comentário")) return;
    const checklistRes = await client.query(
      "SELECT task_id FROM checklists WHERE id = $1",
      [clId],
    );
    const taskId = checklistRes.rows[0]?.task_id || null;
    await client.query("UPDATE checklists SET name = $1 WHERE id = $2", [
      name,
      clId,
    ]);
    if (taskId) {
      await emitTaskUpdatedRealtime(client, {
        taskId,
        actorId: req.user.id,
      });
    }
    res.json({ message: "Checklist renomeada." });
  } catch (error) {
    console.error("Erro ao renomear checklist:", error);
    res.status(500).json({ message: "Erro interno." });
  } finally {
    client.release();
  }
});

router.post("/checklists/:id/items", verifyToken, async (req, res) => {
  const checklistId = req.params.id;
  const { label } = req.body;
  const itemId = "cli_" + Math.random().toString(36).slice(2, 10);

  const client = await postgres.connect();
  try {
    const checklistAccess = await getWorkspaceAccessByChecklistId(
      client,
      req.user,
      checklistId,
    );
    if (!ensureWorkspacePermission(res, checklistAccess, "Comentário")) return;
    const checklistRes = await client.query(
      "SELECT task_id FROM checklists WHERE id = $1",
      [checklistId],
    );
    const taskId = checklistRes.rows[0]?.task_id || null;
    await client.query(
      "INSERT INTO checklist_items (id, checklist_id, label) VALUES ($1,$2,$3)",
      [itemId, checklistId, label],
    );
    if (taskId) {
      await emitTaskUpdatedRealtime(client, {
        taskId,
        actorId: req.user.id,
      });
    }
    res
      .status(201)
      .json({ item: { id: itemId, label, done: false, assigneeIds: [] } });
  } catch (error) {
    console.error("Erro ao criar item de checklist:", error);
    res.status(500).json({ message: "Erro interno." });
  } finally {
    client.release();
  }
});

router.put("/checklist-items/:id/toggle", verifyToken, async (req, res) => {
  const itemId = req.params.id;
  const client = await postgres.connect();
  try {
    const itemAccess = await getWorkspaceAccessByChecklistItemId(
      client,
      req.user,
      itemId,
    );
    if (!ensureWorkspacePermission(res, itemAccess, "Comentário")) return;
    const itemRes = await client.query(
      `SELECT c.task_id
       FROM checklist_items i
       JOIN checklists c ON c.id = i.checklist_id
       WHERE i.id = $1`,
      [itemId],
    );
    const taskId = itemRes.rows[0]?.task_id || null;
    await client.query(
      "UPDATE checklist_items SET done = NOT done WHERE id = $1",
      [itemId],
    );
    if (taskId) {
      await emitTaskUpdatedRealtime(client, {
        taskId,
        actorId: req.user.id,
      });
    }
    res.json({ message: "Toggled." });
  } catch (error) {
    console.error("Erro ao toggle item:", error);
    res.status(500).json({ message: "Erro interno." });
  } finally {
    client.release();
  }
});

router.put("/checklist-items/:id", verifyToken, async (req, res) => {
  const itemId = req.params.id;
  const { label } = req.body;
  const client = await postgres.connect();
  try {
    const itemAccess = await getWorkspaceAccessByChecklistItemId(
      client,
      req.user,
      itemId,
    );
    if (!ensureWorkspacePermission(res, itemAccess, "Comentário")) return;
    const itemRes = await client.query(
      `SELECT c.task_id
       FROM checklist_items i
       JOIN checklists c ON c.id = i.checklist_id
       WHERE i.id = $1`,
      [itemId],
    );
    const taskId = itemRes.rows[0]?.task_id || null;
    await client.query("UPDATE checklist_items SET label = $1 WHERE id = $2", [
      label,
      itemId,
    ]);
    if (taskId) {
      await emitTaskUpdatedRealtime(client, {
        taskId,
        actorId: req.user.id,
      });
    }
    res.json({ message: "Item atualizado." });
  } catch (error) {
    console.error("Erro ao atualizar item:", error);
    res.status(500).json({ message: "Erro interno." });
  } finally {
    client.release();
  }
});

router.delete("/checklist-items/:id", verifyToken, async (req, res) => {
  const itemId = req.params.id;
  const client = await postgres.connect();
  try {
    const itemAccess = await getWorkspaceAccessByChecklistItemId(
      client,
      req.user,
      itemId,
    );
    if (!ensureWorkspacePermission(res, itemAccess, "Comentário")) return;
    const itemRes = await client.query(
      `SELECT c.task_id
       FROM checklist_items i
       JOIN checklists c ON c.id = i.checklist_id
       WHERE i.id = $1`,
      [itemId],
    );
    const taskId = itemRes.rows[0]?.task_id || null;
    await client.query("DELETE FROM checklist_items WHERE id = $1", [itemId]);
    if (taskId) {
      await emitTaskUpdatedRealtime(client, {
        taskId,
        actorId: req.user.id,
      });
    }
    res.json({ message: "Item removido." });
  } catch (error) {
    console.error("Erro ao deletar item:", error);
    res.status(500).json({ message: "Erro interno." });
  } finally {
    client.release();
  }
});

router.put("/checklist-items/:id/assignees", verifyToken, async (req, res) => {
  const itemId = req.params.id;
  const { memberId } = req.body;
  const client = await postgres.connect();
  try {
    const itemAccess = await getWorkspaceAccessByChecklistItemId(
      client,
      req.user,
      itemId,
    );
    if (!ensureWorkspacePermission(res, itemAccess, "Editar")) return;
    const itemRes = await client.query(
      `SELECT c.task_id
       FROM checklist_items i
       JOIN checklists c ON c.id = i.checklist_id
       WHERE i.id = $1`,
      [itemId],
    );
    const taskId = itemRes.rows[0]?.task_id || null;
    const existing = await client.query(
      "SELECT 1 FROM checklist_item_assignees WHERE checklist_item_id = $1 AND member_id = $2",
      [itemId, memberId],
    );
    let storedNotifications = [];
    if (existing.rows.length > 0) {
      await client.query(
        "DELETE FROM checklist_item_assignees WHERE checklist_item_id = $1 AND member_id = $2",
        [itemId, memberId],
      );
    } else {
      await client.query(
        "INSERT INTO checklist_item_assignees (checklist_item_id, member_id) VALUES ($1,$2)",
        [itemId, memberId],
      );
      storedNotifications = await storeNotifications(
        client,
        await buildChecklistItemAssignmentNotification(client, {
          itemId,
          memberId,
          actorId: req.user.id,
        }),
      );
    }
    if (taskId) {
      await emitTaskUpdatedRealtime(client, {
        taskId,
        actorId: req.user.id,
      });
    }

    if (storedNotifications.length > 0) {
      await dispatchStoredNotifications({
        actorId: req.user.id,
        notifications: storedNotifications,
        reason: "checklist-item.assignee.updated",
      });
    }

    res.json({ message: "Assignee atualizado." });
  } catch (error) {
    console.error("Erro ao atribuir item:", error);
    res.status(500).json({ message: "Erro interno." });
  } finally {
    client.release();
  }
});

// Envio antigo em base64, substituído por POST /tasks/:id/uploads.
router.post("/uploads", verifyToken, (_req, res) => {
  res.status(410).json({
    message:
      "O envio de arquivos foi atualizado. Recarregue a página e tente novamente.",
  });
});

// Corpo binário do arquivo (application/octet-stream) + headers X-File-Name e X-File-Type.
// O arquivo vai para Pauta/<empresa>/<workspace>/<projeto> na Bunny.
router.post("/tasks/:id/uploads", verifyToken, async (req, res) => {
  const taskId = req.params.id;
  let storageContext;

  const client = await postgres.connect();
  try {
    const taskAccess = await getWorkspaceAccessByTaskId(
      client,
      req.user,
      taskId,
    );
    if (!ensureWorkspacePermission(res, taskAccess, "Comentário")) {
      req.resume();
      return;
    }
    storageContext = await resolveTaskStorageContext(
      client,
      taskId,
      req.user.organizationId,
    );
  } catch (error) {
    sendStorageError(req, res, error, "Erro ao preparar o envio do arquivo.");
    return;
  } finally {
    client.release();
  }

  try {
    const file = await receiveUpload(req, {
      ...storageContext,
      kind: "task_file",
      uploadedBy: req.user.id,
    });
    res.status(201).json({
      file: {
        url: file.url,
        name: file.name,
        size: file.size,
        contentType: file.contentType,
      },
    });
  } catch (error) {
    sendStorageError(req, res, error, "Erro ao enviar arquivo.");
  }
});

router.get("/attachments/download", verifyToken, async (req, res) => {
  const targetUrl = String(req.query.url || "").trim();
  const requestedName = String(req.query.name || "").trim();

  if (!targetUrl || !isAllowedAttachmentDownloadUrl(targetUrl)) {
    return res.status(400).json({ message: "URL de anexo inválida." });
  }

  try {
    if (!(await urlDaOrganizacao(req.user.organizationId, targetUrl))) {
      return res.status(404).json({ message: "Anexo não encontrado." });
    }

    const response = await axios.get(signStorageUrl(targetUrl), {
      responseType: "stream",
    });

    const safeFileName = (
      requestedName || path.basename(new URL(targetUrl).pathname)
    )
      .replace(/[\r\n"]/g, "_")
      .trim();

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${safeFileName || "anexo"}"`,
    );

    if (response.headers["content-type"]) {
      res.setHeader("Content-Type", response.headers["content-type"]);
    }

    if (response.headers["content-length"]) {
      res.setHeader("Content-Length", response.headers["content-length"]);
    }

    response.data.on("error", (streamError) => {
      console.error("Erro ao transmitir anexo:", streamError);
      if (!res.headersSent) {
        res.status(502).end();
      } else {
        res.end();
      }
    });

    response.data.pipe(res);
  } catch (error) {
    console.error("Erro ao baixar anexo remoto:", error?.message || error);
    return res
      .status(502)
      .json({ message: "Não foi possível baixar o anexo." });
  }
});

router.post("/attachments/download-batch", verifyToken, async (req, res) => {
  const attachments = Array.isArray(req.body?.attachments)
    ? req.body.attachments
    : [];
  const archiveBaseName = sanitizeDownloadFileName(
    req.body?.archiveName,
    "anexos",
  );

  const candidatos = attachments.filter((attachment) => {
    const url = String(attachment?.url || "").trim();
    return url && isAllowedAttachmentDownloadUrl(url);
  });
  const { extractStoragePathFromUrl } = require("../services/bunny.service");
  const permitidos = await caminhosDaOrganizacao(
    req.user.organizationId,
    candidatos.map((attachment) => attachment.url),
  ).catch(() => new Set());
  const validAttachments = candidatos.filter((attachment) =>
    permitidos.has(extractStoragePathFromUrl(String(attachment.url).trim().split("?")[0])),
  );

  if (validAttachments.length === 0) {
    return res.status(400).json({ message: "Nenhum anexo válido informado." });
  }

  const archiveFileName = ensureZipExtension(archiveBaseName);
  const usedNames = new Set();
  let adicionados = 0;

  res.setHeader("Content-Type", "application/zip");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${archiveFileName}"`,
  );

  const archive = archiver("zip", { zlib: { level: 9 } });

  archive.on("warning", (warning) => {
    console.warn("Aviso ao gerar ZIP de anexos:", warning);
  });

  archive.on("error", (archiveError) => {
    console.error("Erro ao gerar ZIP de anexos:", archiveError);
    if (!res.headersSent) {
      res.status(500).json({ message: "Erro ao compactar anexos." });
      return;
    }
    res.end();
  });

  archive.pipe(res);

  for (const attachment of validAttachments) {
    const targetUrl = String(attachment.url || "").trim();
    const requestedName = sanitizeDownloadFileName(
      attachment.name,
      path.basename(new URL(targetUrl).pathname) || "anexo",
    );

    let finalName = requestedName;
    let duplicateIndex = 1;

    while (usedNames.has(finalName.toLowerCase())) {
      const parsedName = path.parse(requestedName);
      finalName = `${parsedName.name}-${duplicateIndex}${parsedName.ext}`;
      duplicateIndex += 1;
    }

    usedNames.add(finalName.toLowerCase());

    try {
      const response = await axios.get(signStorageUrl(targetUrl), {
        responseType: "stream",
      });
      archive.append(response.data, { name: finalName });
      adicionados += 1;
    } catch (error) {
      console.error(
        `Erro ao adicionar anexo ${finalName} ao ZIP:`,
        error?.message || error,
      );
    }
  }

  // Sem isso o ZIP saía vazio e o Windows reclamava na hora de extrair.
  if (adicionados === 0) {
    archive.append(
      "Nenhum anexo pôde ser baixado. Tente novamente ou baixe os arquivos um a um.",
      { name: "leia-me.txt" },
    );
  }

  await archive.finalize();
});

router.post("/tasks/:id/attachments", verifyToken, async (req, res) => {
  const taskId = req.params.id;
  const { name, url, type, size } = req.body;
  const attId = "att_" + Math.random().toString(36).slice(2, 10);

  const client = await postgres.connect();
  try {
    await ensureTaskCoverSchema(client);
    const taskAccess = await getWorkspaceAccessByTaskId(
      client,
      req.user,
      taskId,
    );
    if (!ensureWorkspacePermission(res, taskAccess, "Comentário")) return;
    if (url && !isAllowedAttachmentDownloadUrl(url)) {
      return res.status(400).json({ message: "URL de anexo inválida." });
    }
    await client.query(
      "INSERT INTO task_attachments (id, task_id, name, url, type, size, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [
        attId,
        taskId,
        name,
        url || "",
        type || "document",
        size || 0,
        req.user.id,
      ],
    );
    const uploaderRes = await client.query(
      'SELECT name, avatar_color as "uploadedByAvatarColor", avatar_url as "uploadedByAvatarUrl" FROM members WHERE id = $1',
      [req.user.id],
    );
    const uploader = uploaderRes.rows[0] || null;
    const act = await logTaskActivity(
      client,
      taskId,
      req.user.id,
      "system",
      `anexou o arquivo "${name}".`,
    );
    const storedNotifications = await storeNotifications(
      client,
      await buildTaskAttachmentAddedNotifications(client, {
        taskId,
        actorId: req.user.id,
        attachmentName: name,
      }),
    );
    await emitTaskUpdatedRealtime(client, {
      taskId,
      actorId: req.user.id,
      activities: [act],
    });
    if (storedNotifications.length > 0) {
      await dispatchStoredNotifications({
        actorId: req.user.id,
        notifications: storedNotifications,
        reason: "task.attachment.created",
      });
    }
    res.status(201).json({
      attachment: {
        id: attId,
        name,
        url: url || "",
        type: type || "document",
        size: size || 0,
        createdAt: new Date().toISOString(),
        uploadedById: req.user.id,
        uploadedByName: uploader?.name || null,
        uploadedByAvatarColor: uploader?.uploadedByAvatarColor || null,
        uploadedByAvatarUrl: uploader?.uploadedByAvatarUrl || null,
      },
      activities: [act].filter(Boolean),
    });
  } catch (error) {
    console.error("Erro ao criar attachment:", error);
    res.status(500).json({ message: "Erro interno." });
  } finally {
    client.release();
  }
});

router.delete("/attachments/:id", verifyToken, async (req, res) => {
  const attId = req.params.id;
  const client = await postgres.connect();
  try {
    await ensureTaskCoverSchema(client);
    const attachmentAccess = await getWorkspaceAccessByAttachmentId(
      client,
      req.user,
      attId,
    );
    if (!ensureWorkspacePermission(res, attachmentAccess, "Editar")) return;
    const activities = [];
    const attRes = await client.query(
      "SELECT task_id, name, url FROM task_attachments WHERE id = $1",
      [attId],
    );
    if (attRes.rows.length > 0) {
      await client.query(
        "UPDATE tasks SET cover_attachment_id = NULL WHERE id = $1 AND cover_attachment_id = $2",
        [attRes.rows[0].task_id, attId],
      );
      activities.push(
        await logTaskActivity(
          client,
          attRes.rows[0].task_id,
          req.user.id,
          "system",
          `removeu o anexo "${attRes.rows[0].name}".`,
        ),
      );
    }
    await moveAttachmentToTrash(client, { attachmentId: attId, deletedBy: req.user.id });
    await client.query("DELETE FROM task_attachments WHERE id = $1", [attId]);
    if (attRes.rows[0]?.task_id) {
      await emitTaskUpdatedRealtime(client, {
        taskId: attRes.rows[0].task_id,
        actorId: req.user.id,
        activities,
      });
    }
    res.json({
      message: "Anexo removido.",
      activities: activities.filter(Boolean),
      taskId: attRes.rows[0]?.task_id,
    });
  } catch (error) {
    console.error("Erro ao deletar attachment:", error);
    res.status(500).json({ message: "Erro interno." });
  } finally {
    client.release();
  }
});

router.post("/tasks/:id/links", verifyToken, async (req, res) => {
  const taskId = req.params.id;
  const { linkedTaskId } = req.body;
  if (!linkedTaskId)
    return res.status(400).json({ message: "linkedTaskId obrigatorio." });

  const client = await postgres.connect();
  try {
    const taskAccess = await getWorkspaceAccessByTaskId(
      client,
      req.user,
      taskId,
    );
    if (!ensureWorkspacePermission(res, taskAccess, "Editar")) return;
    const linkedTaskAccess = await getWorkspaceAccessByTaskId(
      client,
      req.user,
      linkedTaskId,
    );
    if (!ensureWorkspacePermission(res, linkedTaskAccess, "Editar")) return;
    await client.query(
      "INSERT INTO task_links (task_id, linked_task_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
      [taskId, linkedTaskId],
    );
    const act1 = await logTaskActivity(
      client,
      taskId,
      req.user.id,
      "link",
      "vinculou uma tarefa.",
    );
    const act2 = await logTaskActivity(
      client,
      linkedTaskId,
      req.user.id,
      "link",
      "foi vinculada a uma tarefa.",
    );
    const storedNotifications = await storeNotifications(
      client,
      await buildTaskLinkNotifications(client, {
        taskId,
        linkedTaskId,
        actorId: req.user.id,
        action: "linked",
      }),
    );
    await emitTaskUpdatedRealtime(client, {
      taskId,
      actorId: req.user.id,
      activities: [act1],
    });
    await emitTaskUpdatedRealtime(client, {
      taskId: linkedTaskId,
      actorId: req.user.id,
      activities: [act2],
    });
    if (storedNotifications.length > 0) {
      await dispatchStoredNotifications({
        actorId: req.user.id,
        notifications: storedNotifications,
        reason: "task.linked",
      });
    }
    res.status(201).json({
      message: "Link criado.",
      activitiesTaskId: [act1].filter(Boolean),
      activitiesLinkedTask: [act2].filter(Boolean),
    });
  } catch (error) {
    console.error("Erro ao linkar tasks:", error);
    res.status(500).json({ message: "Erro interno." });
  } finally {
    client.release();
  }
});

router.delete("/tasks/:id/links/:linkedId", verifyToken, async (req, res) => {
  const { id, linkedId } = req.params;
  const client = await postgres.connect();
  try {
    const taskAccess = await getWorkspaceAccessByTaskId(client, req.user, id);
    if (!ensureWorkspacePermission(res, taskAccess, "Editar")) return;
    const linkedTaskAccess = await getWorkspaceAccessByTaskId(
      client,
      req.user,
      linkedId,
    );
    if (!ensureWorkspacePermission(res, linkedTaskAccess, "Editar")) return;
    await client.query(
      "DELETE FROM task_links WHERE (task_id = $1 AND linked_task_id = $2) OR (task_id = $2 AND linked_task_id = $1)",
      [id, linkedId],
    );
    const act1 = await logTaskActivity(
      client,
      id,
      req.user.id,
      "link",
      "desvinculou uma tarefa.",
    );
    const act2 = await logTaskActivity(
      client,
      linkedId,
      req.user.id,
      "link",
      "foi desvinculada de uma tarefa.",
    );
    const storedNotifications = await storeNotifications(
      client,
      await buildTaskLinkNotifications(client, {
        taskId: id,
        linkedTaskId: linkedId,
        actorId: req.user.id,
        action: "unlinked",
      }),
    );
    await emitTaskUpdatedRealtime(client, {
      taskId: id,
      actorId: req.user.id,
      activities: [act1],
    });
    await emitTaskUpdatedRealtime(client, {
      taskId: linkedId,
      actorId: req.user.id,
      activities: [act2],
    });
    if (storedNotifications.length > 0) {
      await dispatchStoredNotifications({
        actorId: req.user.id,
        notifications: storedNotifications,
        reason: "task.unlinked",
      });
    }
    res.json({
      message: "Link removido.",
      activitiesTaskId: [act1].filter(Boolean),
      activitiesLinkedTask: [act2].filter(Boolean),
    });
  } catch (error) {
    console.error("Erro ao remover link:", error);
    res.status(500).json({ message: "Erro interno." });
  } finally {
    client.release();
  }
});

router.post("/tasks/:id/comments", verifyToken, async (req, res) => {
  const taskId = req.params.id;
  const { content, parentId, attachment, mentionIds, linkDisplayModes } =
    req.body;
  const normalizedContent = typeof content === "string" ? content.trim() : "";

  if (!normalizedContent && !attachment?.url) {
    return res
      .status(400)
      .json({ message: "Comentário ou anexo obrigatório." });
  }

  const commentId = "comment_" + Math.random().toString(36).slice(2, 10);
  const client = await postgres.connect();
  try {
    const taskAccess = await getWorkspaceAccessByTaskId(
      client,
      req.user,
      taskId,
    );
    if (!ensureWorkspacePermission(res, taskAccess, "Comentário")) return;
    if (attachment?.url && !isAllowedAttachmentDownloadUrl(attachment.url)) {
      return res.status(400).json({ message: "URL de anexo inválida." });
    }

    const commentSchema = await getTaskCommentsSchema(client);
    const authorColumn = commentSchema.hasAuthorId
      ? "author_id"
      : commentSchema.hasUserId
        ? "user_id"
        : null;
    if (!authorColumn) {
      return res
        .status(500)
        .json({ message: "Schema de comentários inválido." });
    }

    const authorRes = await client.query(
      "SELECT name FROM members WHERE id = $1",
      [req.user.id],
    );
    const authorName = authorRes.rows[0]?.name || "Você";

    await client.query(
      `INSERT INTO task_comments (
        id,
        task_id,
        ${authorColumn},
        content,
        parent_id,
        attachment_name,
        attachment_url,
        attachment_type,
        attachment_size,
        link_display_modes
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        commentId,
        taskId,
        req.user.id,
        normalizedContent,
        parentId || null,
        attachment?.name || null,
        attachment?.url || null,
        attachment?.type || null,
        attachment?.size || null,
        linkDisplayModes || {},
      ],
    );

    const act = await logTaskActivity(
      client,
      taskId,
      req.user.id,
      "comment",
      "adicionou um comentário.",
    );

    const storedNotifications = await storeNotifications(client, [
      ...(await buildTaskCommentNotifications(client, {
        taskId,
        actorId: req.user.id,
        mentionIds,
      })),
      ...(await buildMentionNotifications(client, {
        taskId,
        actorId: req.user.id,
        mentionIds,
        source: "comment",
      })),
    ]);

    const createdAt = new Date().toISOString();
    const responseComment = {
      id: commentId,
      taskId,
      authorName,
      content: normalizedContent,
      parentId,
      mentionIds: extractMentionIds(mentionIds, req.user.id),
      linkDisplayModes: linkDisplayModes || {},
      createdAt,
      likedByMe: false,
      reaction: null,
      attachment: attachment?.url
        ? {
            id: `comment_attachment_${commentId}`,
            name: attachment.name,
            url: attachment.url,
            type: attachment.type || "document",
            size: Number(attachment.size || 0),
            createdAt,
          }
        : undefined,
    };

    publishRealtimeEvent({
      type: "comment.created",
      actorId: req.user.id,
      workspaceId: taskAccess.workspaceId,
      excludeUserIds: [req.user.id],
      payload: {
        taskId,
        comment: responseComment,
        activities: [act].filter(Boolean),
      },
    });

    if (storedNotifications.length > 0) {
      await dispatchStoredNotifications({
        actorId: req.user.id,
        notifications: storedNotifications,
        reason: "comment.created",
      });
    }

    notificarConhecimento(taskId);
    return res.status(201).json({
      comment: responseComment,
      activities: [act].filter(Boolean),
    });
  } catch (error) {
    console.error("Erro ao adicionar comentário com anexo:", error);
    return res.status(500).json({ message: "Erro interno." });
  } finally {
    client.release();
  }
});

router.put("/comments/:id", verifyToken, async (req, res) => {
  const commentId = req.params.id;
  const { content, linkDisplayModes } = req.body;
  const client = await postgres.connect();
  try {
    const commentAccess = await getWorkspaceAccessByCommentId(
      client,
      req.user,
      commentId,
    );
    if (!ensureWorkspacePermission(res, commentAccess, "Comentário")) return;
    const commentSchema = await getTaskCommentsSchema(client);
    const authorColumn = commentSchema.hasAuthorId
      ? "author_id"
      : commentSchema.hasUserId
        ? "user_id"
        : null;
    if (!authorColumn) {
      return res
        .status(500)
        .json({ message: "Schema de comentarios invalido." });
    }

    const authorMatchSql =
      "COALESCE(to_jsonb(task_comments)->>'author_id', to_jsonb(task_comments)->>'user_id') = $3";

    const updateAssignments = ["content = $1"];
    if (commentSchema.hasLinkDisplayModes && linkDisplayModes !== undefined) {
      updateAssignments.push("link_display_modes = $2");
    }
    if (commentSchema.hasUpdatedAt) {
      updateAssignments.push("updated_at = NOW()");
    }

    const commentIdParamIndex =
      commentSchema.hasLinkDisplayModes && linkDisplayModes !== undefined
        ? 3
        : 2;
    const actorParamIndex =
      commentSchema.hasLinkDisplayModes && linkDisplayModes !== undefined
        ? 4
        : 3;

    const updateSql = `UPDATE task_comments SET ${updateAssignments.join(", ")} WHERE id = $${commentIdParamIndex} AND ${authorMatchSql.replace("$3", `$${actorParamIndex}`)} RETURNING task_id, updated_at`;

    const updateValues =
      commentSchema.hasLinkDisplayModes && linkDisplayModes !== undefined
        ? [content, linkDisplayModes, commentId, req.user.id]
        : [content, commentId, req.user.id];

    const comRes = await client.query(updateSql, updateValues);
    if (comRes.rows.length > 0) {
      const act = await logTaskActivity(
        client,
        comRes.rows[0].task_id,
        req.user.id,
        "comment",
        "editou um comentário.",
      );
      publishRealtimeEvent({
        type: "comment.updated",
        actorId: req.user.id,
        workspaceId: commentAccess.workspaceId,
        excludeUserIds: [req.user.id],
        payload: {
          taskId: comRes.rows[0].task_id,
          comment: {
            id: commentId,
            content,
            linkDisplayModes:
              linkDisplayModes !== undefined ? linkDisplayModes : undefined,
            editedAt: comRes.rows[0].updated_at || new Date().toISOString(),
          },
          activities: [act].filter(Boolean),
        },
      });
      notificarConhecimento(comRes.rows[0].task_id);
      res.json({
        message: "Comentário atualizado.",
        comment: {
          id: commentId,
          content,
          linkDisplayModes:
            linkDisplayModes !== undefined ? linkDisplayModes : undefined,
          editedAt: comRes.rows[0].updated_at || new Date().toISOString(),
        },
        activities: [act].filter(Boolean),
      });
    } else {
      res.status(404).json({ message: "Não encontrado ou sem permissão." });
    }
  } catch (error) {
    console.error("Erro ao editar comentário:", error);
    res.status(500).json({ message: "Erro interno." });
  } finally {
    client.release();
  }
});

router.put("/comments/:id/like", verifyToken, async (req, res) => {
  const commentId = req.params.id;
  const { liked } = req.body;
  const shouldLike = Boolean(liked);
  const client = await postgres.connect();
  try {
    const commentAccess = await getWorkspaceAccessByCommentId(
      client,
      req.user,
      commentId,
    );
    if (!ensureWorkspacePermission(res, commentAccess, "Comentário")) return;

    await getTaskCommentsSchema(client);

    const updateRes = await client.query(
      `
        UPDATE task_comments
        SET liked_user_ids = CASE
          WHEN $1 THEN ARRAY(
            SELECT DISTINCT liker
            FROM unnest(COALESCE(liked_user_ids, ARRAY[]::TEXT[]) || ARRAY[$2]::TEXT[]) AS liker
          )
          ELSE array_remove(COALESCE(liked_user_ids, ARRAY[]::TEXT[]), $2)
        END
        WHERE id = $3
        RETURNING COALESCE(liked_user_ids, ARRAY[]::TEXT[]) AS liked_user_ids, reaction
      `,
      [shouldLike, req.user.id, commentId],
    );

    if (updateRes.rows.length === 0) {
      return res.status(404).json({ message: "Comentário não encontrado." });
    }

    const row = updateRes.rows[0];
    return res.json({
      comment: {
        id: commentId,
        likedByMe: Array.isArray(row.liked_user_ids)
          ? row.liked_user_ids.includes(req.user.id)
          : false,
        reaction: row.reaction || null,
      },
    });
  } catch (error) {
    console.error("Erro ao curtir comentário:", error);
    return res.status(500).json({ message: "Erro interno." });
  } finally {
    client.release();
  }
});

router.put("/comments/:id/reaction", verifyToken, async (req, res) => {
  const commentId = req.params.id;
  const rawEmoji = req.body?.emoji;
  const emoji =
    typeof rawEmoji === "string" && rawEmoji.trim() ? rawEmoji.trim() : null;
  const client = await postgres.connect();
  try {
    const commentAccess = await getWorkspaceAccessByCommentId(
      client,
      req.user,
      commentId,
    );
    if (!ensureWorkspacePermission(res, commentAccess, "Comentário")) return;

    await getTaskCommentsSchema(client);

    const updateRes = await client.query(
      `
        UPDATE task_comments
        SET reaction = $1
        WHERE id = $2
        RETURNING task_id, reaction, COALESCE(liked_user_ids, ARRAY[]::TEXT[]) AS liked_user_ids
      `,
      [emoji, commentId],
    );

    if (updateRes.rows.length === 0) {
      return res.status(404).json({ message: "Comentário não encontrado." });
    }

    const row = updateRes.rows[0];
    publishRealtimeEvent({
      type: "comment.updated",
      actorId: req.user.id,
      workspaceId: commentAccess.workspaceId,
      excludeUserIds: [req.user.id],
      payload: {
        taskId: row.task_id,
        comment: {
          id: commentId,
          reaction: row.reaction || null,
        },
      },
    });
    return res.json({
      comment: {
        id: commentId,
        likedByMe: Array.isArray(row.liked_user_ids)
          ? row.liked_user_ids.includes(req.user.id)
          : false,
        reaction: row.reaction || null,
      },
    });
  } catch (error) {
    console.error("Erro ao reagir ao comentário:", error);
    return res.status(500).json({ message: "Erro interno." });
  } finally {
    client.release();
  }
});

router.delete("/comments/:id", verifyToken, async (req, res) => {
  const commentId = req.params.id;
  const client = await postgres.connect();
  try {
    const commentAccess = await getWorkspaceAccessByCommentId(
      client,
      req.user,
      commentId,
    );
    if (!ensureWorkspacePermission(res, commentAccess, "Comentário")) return;
    const commentSchema = await getTaskCommentsSchema(client);
    const authorColumn = commentSchema.hasAuthorId
      ? "author_id"
      : commentSchema.hasUserId
        ? "user_id"
        : null;
    if (!authorColumn) {
      return res
        .status(500)
        .json({ message: "Schema de comentarios invalido." });
    }

    const authorMatchSql =
      "COALESCE(to_jsonb(task_comments)->>'author_id', to_jsonb(task_comments)->>'user_id') = $2";

    const comRes = await client.query(
      "SELECT task_id FROM task_comments WHERE id = $1",
      [commentId],
    );
    // Anexos do comentário e das respostas (removidas junto com ele).
    const threadAttachmentsRes = await client.query(
      `
        WITH RECURSIVE thread AS (
          SELECT id, attachment_url FROM task_comments WHERE id = $1
          UNION
          SELECT c.id, c.attachment_url
          FROM task_comments c
          INNER JOIN thread t ON c.parent_id = t.id
        )
        SELECT attachment_url AS url FROM thread WHERE attachment_url IS NOT NULL
      `,
      [commentId],
    );
    const deleteResult = await client.query(
      `DELETE FROM task_comments WHERE id = $1 AND ${authorMatchSql} RETURNING id`,
      [commentId, req.user.id],
    );

    let activities = [];
    if (comRes.rows.length > 0) {
      const act = await logTaskActivity(
        client,
        comRes.rows[0].task_id,
        req.user.id,
        "comment",
        "apagou um comentário.",
      );
      activities = [act].filter(Boolean);
    }

    if (deleteResult.rows.length > 0 && comRes.rows.length > 0) notificarConhecimento(comRes.rows[0].task_id);
    res.json({ message: "Comentário deletado.", activities });
    if (deleteResult.rows.length > 0) {
      releaseStorageUrls(threadAttachmentsRes.rows.map((row) => row.url));
    }
  } catch (error) {
    console.error("Erro ao deletar comentário:", error);
    res.status(500).json({ message: "Erro interno." });
  } finally {
    client.release();
  }
});

/**
 * Colunas e tabelas que nasceram dentro das rotas. Rodar no arranque deixa o
 * banco pronto antes da primeira requisição (e os testes partem do zero).
 */
async function ensureWorkspaceSchemas() {
  const client = await postgres.connect();
  try {
    // Exclusão lógica (lixeira) de workspaces e projetos.
    await client.query("ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP");
    await client.query("ALTER TABLE lists ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP");
    await client.query("ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS icon VARCHAR(50) DEFAULT 'Briefcase'");
    await client.query(`
      CREATE TABLE IF NOT EXISTS workspace_tags (
        workspace_id VARCHAR(100) REFERENCES workspaces(id) ON DELETE CASCADE,
        tag_id VARCHAR(100) REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY (workspace_id, tag_id)
      )
    `);
    await ensureWorkspacePermissionSchema(client);
    await ensureTaskCoverSchema(client);
    await ensureCustomFieldsSchema(client);
    await ensureTaskWatchersSchema(client);
    await ensureStatusListSchema(client);
    await ensureDefaultStatusColors(client);
  } finally {
    client.release();
  }
}

router.ensureWorkspaceSchemas = ensureWorkspaceSchemas;

module.exports = router;
