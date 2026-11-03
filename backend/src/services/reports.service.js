const crypto = require("crypto");
const { postgres } = require("../server/connect");

/**
 * Relatórios da conta.
 *
 * Guardamos cada mudança de coluna (task_status_transitions) e a data em que o
 * card entrou numa coluna de conclusão (tasks.completed_at). Com isso dá para
 * medir entregas por semana e tempo até concluir, além do retrato de hoje.
 */

const DONE_NAME_REGEX = /conclu|finaliz|feito|done|entregue/i;
const MAX_RANGE_DAYS = 370;

let schemaReady = null;

function ensureReportsSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      await postgres.query("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ");
      await postgres.query(`
        CREATE TABLE IF NOT EXISTS task_status_transitions (
          id VARCHAR(100) PRIMARY KEY,
          task_id VARCHAR(100) NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          organization_id VARCHAR(100),
          workspace_id VARCHAR(100),
          list_id VARCHAR(100),
          from_status_id VARCHAR(100),
          to_status_id VARCHAR(100),
          to_status_done BOOLEAN NOT NULL DEFAULT FALSE,
          changed_by VARCHAR(100),
          changed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await postgres.query(
        "CREATE INDEX IF NOT EXISTS task_status_transitions_org_idx ON task_status_transitions (organization_id, changed_at DESC)",
      );
      await postgres.query(
        "CREATE INDEX IF NOT EXISTS task_status_transitions_task_idx ON task_status_transitions (task_id, changed_at DESC)",
      );
      await postgres.query(
        "CREATE INDEX IF NOT EXISTS tasks_completed_at_idx ON tasks (completed_at) WHERE completed_at IS NOT NULL",
      );
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

function isDoneStatusName(name) {
  return DONE_NAME_REGEX.test(String(name || ""));
}

/**
 * Registra a mudança de coluna e mantém tasks.completed_at.
 * Chamar dentro da transação que grava o novo status.
 */
async function recordStatusChange(client, { taskId, fromStatusId, toStatusId, actorId }) {
  if (!taskId || fromStatusId === toStatusId) return;
  await ensureReportsSchema();

  const info = await client.query(
    `
      SELECT t.workspace_id, t.list_id, w.organization_id,
             (SELECT name FROM status_definitions WHERE id = $2) AS to_name
      FROM tasks t
      LEFT JOIN workspaces w ON w.id = t.workspace_id
      WHERE t.id = $1
    `,
    [taskId, toStatusId],
  );
  const row = info.rows[0];
  if (!row) return;

  const concluido = isDoneStatusName(row.to_name);

  await client.query(
    `
      INSERT INTO task_status_transitions
        (id, task_id, organization_id, workspace_id, list_id, from_status_id, to_status_id, to_status_done, changed_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `,
    [
      `trn_${crypto.randomBytes(8).toString("hex")}`,
      taskId,
      row.organization_id || null,
      row.workspace_id || null,
      row.list_id || null,
      fromStatusId || null,
      toStatusId || null,
      concluido,
      actorId || null,
    ],
  );

  // Entrou numa coluna de conclusão: marca a data. Saiu: volta a ficar aberto.
  await client.query(
    concluido
      ? "UPDATE tasks SET completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP) WHERE id = $1"
      : "UPDATE tasks SET completed_at = NULL WHERE id = $1",
    [taskId],
  );
}

/** Workspaces que a pessoa enxerga (mesma regra do /seed). */
function buildWorkspaceAccessFilter(isAdmin) {
  return `
    AND (
      w.owner_id = $1
      OR (
        w.visibility <> 'admin_private'
        AND (
          ${isAdmin ? "true" : "false"}
          OR w.visibility = 'public'
          OR EXISTS (SELECT 1 FROM workspace_members wm WHERE wm.workspace_id = w.id AND wm.member_id = $1)
          OR EXISTS (
            SELECT 1
            FROM lists l
            INNER JOIN folders f ON f.id = l.folder_id
            INNER JOIN spaces s ON s.id = f.space_id
            LEFT JOIN list_assignees la ON la.list_id = l.id AND la.member_id = $1
            LEFT JOIN list_tags lt ON lt.list_id = l.id
            LEFT JOIN member_tags mt ON mt.tag_id = lt.tag_id AND mt.member_id = $1
            WHERE s.workspace_id = w.id
              AND l.deleted_at IS NULL
              AND l.visibility <> 'admin_private'
              AND (l.visibility = 'public' OR l.owner_id = $1 OR la.member_id IS NOT NULL OR mt.member_id IS NOT NULL)
          )
          OR EXISTS (
            SELECT 1 FROM workspace_tags wt
            INNER JOIN member_tags mt ON mt.tag_id = wt.tag_id AND mt.member_id = $1
            WHERE wt.workspace_id = w.id
          )
          OR EXISTS (
            SELECT 1 FROM tasks t
            LEFT JOIN task_assignees ta ON ta.task_id = t.id AND ta.member_id = $1
            LEFT JOIN task_tags tt ON tt.task_id = t.id
            LEFT JOIN member_tags mt ON mt.tag_id = tt.tag_id AND mt.member_id = $1
            WHERE t.workspace_id = w.id
              AND COALESCE(t.visibility, 'public') <> 'admin_private'
              AND (ta.member_id IS NOT NULL OR mt.member_id IS NOT NULL)
          )
        )
      )
    )
  `;
}

async function listVisibleWorkspaces(user) {
  const isAdmin = ["owner", "admin"].includes(user.organizationRole);
  const result = await postgres.query(
    `
      SELECT w.id, w.name
      FROM workspaces w
      WHERE w.deleted_at IS NULL AND w.organization_id = $2
      ${buildWorkspaceAccessFilter(isAdmin)}
      ORDER BY w.name
    `,
    [user.id, user.organizationId],
  );
  return result.rows;
}

function parseDate(value, fallback) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : fallback;
}

/** Números do período escolhido, já limitados ao que a pessoa enxerga. */
async function buildReport(user, { from, to, workspaceId, listId } = {}) {
  await ensureReportsSchema();

  const hoje = new Date();
  const fim = parseDate(to, hoje);
  const inicioPadrao = new Date(fim);
  inicioPadrao.setDate(inicioPadrao.getDate() - 29);
  let inicio = parseDate(from, inicioPadrao);
  if (inicio > fim) inicio = inicioPadrao;
  if ((fim - inicio) / 86400000 > MAX_RANGE_DAYS) {
    inicio = new Date(fim.getTime() - MAX_RANGE_DAYS * 86400000);
  }
  const fimExclusivo = new Date(fim);
  fimExclusivo.setHours(23, 59, 59, 999);

  const workspaces = await listVisibleWorkspaces(user);
  const workspaceIds = workspaces
    .map((workspace) => workspace.id)
    .filter((id) => !workspaceId || id === workspaceId);

  const vazio = {
    range: { from: inicio, to: fimExclusivo },
    workspaces,
    lists: [],
    totals: { open: 0, done: 0, overdue: 0, dueSoon: 0, unassigned: 0, createdInRange: 0, completedInRange: 0, noDate: 0 },
    byStatus: [],
    byPriority: [],
    byList: [],
    byMember: [],
    completedPerWeek: [],
    leadTimeDays: null,
    oldestOpen: [],
  };

  if (workspaceIds.length === 0) return vazio;

  // $1 workspaces, $2 projeto (ou null); as consultas de período recebem $3 e $4.
  const escopoParams = [workspaceIds, listId || null];
  const periodoParams = [...escopoParams, inicio, fimExclusivo];
  // Cards visíveis: sem subtarefas e sem os privados de administrador de outra pessoa.
  const escopo = `
    FROM tasks t
    INNER JOIN lists l ON l.id = t.list_id AND l.deleted_at IS NULL
    INNER JOIN workspaces w ON w.id = t.workspace_id AND w.deleted_at IS NULL
    WHERE t.workspace_id = ANY($1::text[])
      AND t.parent_task_id IS NULL
      AND ($2::text IS NULL OR t.list_id = $2::text)
      AND COALESCE(t.visibility, 'public') <> 'admin_private'
      AND COALESCE(l.visibility, 'public') <> 'admin_private'
  `;

  const [totais, porStatus, porPrioridade, porProjeto, porPessoa, porSemana, leadTime, antigos, listas] =
    await Promise.all([
      postgres.query(
        `
          SELECT
            COUNT(*) FILTER (WHERE t.completed_at IS NULL)::int AS open,
            COUNT(*) FILTER (WHERE t.completed_at IS NOT NULL)::int AS done,
            COUNT(*) FILTER (WHERE t.completed_at IS NULL AND t.due_date IS NOT NULL AND t.due_date < CURRENT_DATE)::int AS overdue,
            COUNT(*) FILTER (WHERE t.completed_at IS NULL AND t.due_date >= CURRENT_DATE AND t.due_date < CURRENT_DATE + INTERVAL '7 days')::int AS due_soon,
            COUNT(*) FILTER (WHERE t.completed_at IS NULL AND NOT EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_id = t.id))::int AS unassigned,
            COUNT(*) FILTER (WHERE t.completed_at IS NULL AND t.due_date IS NULL)::int AS no_date,
            COUNT(*) FILTER (WHERE t.created_at BETWEEN $3 AND $4)::int AS created_in_range,
            COUNT(*) FILTER (WHERE t.completed_at BETWEEN $3 AND $4)::int AS completed_in_range
          ${escopo}
        `,
        periodoParams,
      ),
      postgres.query(
        `
          SELECT COALESCE(sd.name, 'Sem coluna') AS name, COALESCE(sd.dot_class, 'bg-slate-400') AS dot_class,
                 MIN(sd.display_order) AS display_order, COUNT(*)::int AS total
          ${escopo} AND t.completed_at IS NULL
          GROUP BY 1, 2
          ORDER BY display_order NULLS LAST, total DESC
        `.replace("FROM tasks t", "FROM tasks t LEFT JOIN status_definitions sd ON sd.id = t.status_id"),
        escopoParams,
      ),
      postgres.query(
        `
          SELECT COALESCE(t.priority, 'medium') AS priority, COUNT(*)::int AS total
          ${escopo} AND t.completed_at IS NULL
          GROUP BY 1
        `,
        escopoParams,
      ),
      postgres.query(
        `
          SELECT l.id, l.name, w.name AS workspace_name,
                 COUNT(*) FILTER (WHERE t.completed_at IS NULL)::int AS open,
                 COUNT(*) FILTER (WHERE t.completed_at BETWEEN $3 AND $4)::int AS completed,
                 COUNT(*) FILTER (WHERE t.completed_at IS NULL AND t.due_date IS NOT NULL AND t.due_date < CURRENT_DATE)::int AS overdue
          ${escopo}
          GROUP BY l.id, l.name, w.name
          ORDER BY open DESC, completed DESC
          LIMIT 30
        `,
        periodoParams,
      ),
      postgres.query(
        `
          SELECT m.id, m.name, m.avatar_color AS "avatarColor", m.avatar_url AS "avatarUrl",
                 COUNT(*) FILTER (WHERE t.completed_at IS NULL)::int AS open,
                 COUNT(*) FILTER (WHERE t.completed_at IS NULL AND t.due_date IS NOT NULL AND t.due_date < CURRENT_DATE)::int AS overdue,
                 COUNT(*) FILTER (WHERE t.completed_at BETWEEN $3 AND $4)::int AS completed
          ${escopo.replace("FROM tasks t", "FROM tasks t INNER JOIN task_assignees ta ON ta.task_id = t.id INNER JOIN members m ON m.id = ta.member_id")}
          GROUP BY m.id, m.name, m.avatar_color, m.avatar_url
          ORDER BY open DESC, completed DESC
          LIMIT 30
        `,
        periodoParams,
      ),
      postgres.query(
        `
          SELECT date_trunc('week', t.completed_at)::date AS week,
                 COUNT(*)::int AS completed
          ${escopo} AND t.completed_at BETWEEN $3 AND $4
          GROUP BY 1
          ORDER BY 1
        `,
        periodoParams,
      ),
      postgres.query(
        `
          SELECT ROUND(AVG(EXTRACT(EPOCH FROM (t.completed_at - t.created_at)) / 86400)::numeric, 1) AS media,
                 ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (t.completed_at - t.created_at)) / 86400))::numeric, 1) AS mediana,
                 COUNT(*)::int AS base
          ${escopo} AND t.completed_at BETWEEN $3 AND $4
        `,
        periodoParams,
      ),
      postgres.query(
        `
          SELECT t.id, t.title, l.name AS list_name, t.due_date AS "dueDate", t.created_at AS "createdAt"
          ${escopo} AND t.completed_at IS NULL
          ORDER BY t.created_at ASC
          LIMIT 5
        `,
        escopoParams,
      ),
      postgres.query(
        `
          SELECT l.id, l.name, w.name AS workspace_name, w.id AS workspace_id
          FROM lists l
          INNER JOIN folders f ON f.id = l.folder_id
          INNER JOIN spaces s ON s.id = f.space_id
          INNER JOIN workspaces w ON w.id = s.workspace_id
          WHERE w.id = ANY($1::text[]) AND l.deleted_at IS NULL AND w.deleted_at IS NULL
            AND COALESCE(l.visibility, 'public') <> 'admin_private'
          ORDER BY w.name, l.name
        `,
        [workspaceIds],
      ),
    ]);

  const totalsRow = totais.rows[0];

  return {
    range: { from: inicio, to: fimExclusivo },
    workspaces,
    lists: listas.rows.map((row) => ({
      id: row.id,
      name: row.name,
      workspaceId: row.workspace_id,
      workspaceName: row.workspace_name,
    })),
    totals: {
      open: totalsRow.open,
      done: totalsRow.done,
      overdue: totalsRow.overdue,
      dueSoon: totalsRow.due_soon,
      unassigned: totalsRow.unassigned,
      noDate: totalsRow.no_date,
      createdInRange: totalsRow.created_in_range,
      completedInRange: totalsRow.completed_in_range,
    },
    byStatus: porStatus.rows.map((row) => ({ name: row.name, dotClass: row.dot_class, total: row.total })),
    byPriority: porPrioridade.rows.map((row) => ({ priority: row.priority, total: row.total })),
    byList: porProjeto.rows.map((row) => ({
      id: row.id,
      name: row.name,
      workspaceName: row.workspace_name,
      open: row.open,
      completed: row.completed,
      overdue: row.overdue,
    })),
    byMember: porPessoa.rows,
    completedPerWeek: porSemana.rows.map((row) => ({ week: row.week, completed: row.completed })),
    leadTimeDays: leadTime.rows[0]?.base
      ? {
          average: Number(leadTime.rows[0].media),
          median: Number(leadTime.rows[0].mediana),
          base: leadTime.rows[0].base,
        }
      : null,
    oldestOpen: antigos.rows.map((row) => ({
      id: row.id,
      title: row.title,
      listName: row.list_name,
      dueDate: row.dueDate,
      createdAt: row.createdAt,
    })),
  };
}

module.exports = {
  buildReport,
  ensureReportsSchema,
  isDoneStatusName,
  listVisibleWorkspaces,
  recordStatusChange,
};
