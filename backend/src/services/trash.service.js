const crypto = require("crypto");
const { postgres } = require("../server/connect");

/**
 * Lixeira da conta.
 *
 * - Workspaces e projetos já são exclusões lógicas (deleted_at); a lixeira só
 *   guarda quem apagou e quando, e restaurar limpa o deleted_at.
 * - Cards e anexos são apagados do banco, mas antes guardamos uma cópia
 *   completa (o card, subtarefas, comentários, checklists, etiquetas...) para
 *   poder devolver tudo igual. Os arquivos continuam na Bunny e contando no
 *   armazenamento até a lixeira ser esvaziada ou o prazo do plano acabar.
 */

const TRASH_TYPES = ["task", "attachment", "list", "workspace"];
const PURGE_INTERVAL_MS = 6 * 60 * 60 * 1000;

let schemaReady = null;

function ensureTrashSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      await postgres.query(`
        CREATE TABLE IF NOT EXISTS trash_items (
          id VARCHAR(100) PRIMARY KEY,
          organization_id VARCHAR(100) NOT NULL,
          workspace_id VARCHAR(100),
          list_id VARCHAR(100),
          task_id VARCHAR(100),
          item_type VARCHAR(20) NOT NULL,
          item_id VARCHAR(100) NOT NULL,
          title TEXT,
          deleted_by VARCHAR(100),
          deleted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          snapshot JSONB,
          file_urls TEXT[] NOT NULL DEFAULT '{}',
          size_bytes BIGINT NOT NULL DEFAULT 0
        )
      `);
      await postgres.query(
        "CREATE INDEX IF NOT EXISTS trash_items_org_idx ON trash_items (organization_id, deleted_at DESC)",
      );
      await postgres.query(
        "CREATE INDEX IF NOT EXISTS trash_items_item_idx ON trash_items (item_type, item_id)",
      );
      await postgres.query(
        "CREATE INDEX IF NOT EXISTS trash_items_file_urls_idx ON trash_items USING GIN (file_urls)",
      );
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }

  return schemaReady;
}

function newTrashId() {
  return `lix_${crypto.randomBytes(8).toString("hex")}`;
}

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

// ---------------------------------------------------------------------------
// Mapa de chaves estrangeiras do banco: descobre sozinho tudo que "pertence"
// a um card (ON DELETE CASCADE), inclusive tabelas criadas no futuro.
// ---------------------------------------------------------------------------
let schemaMapPromise = null;

function loadSchemaMap() {
  if (!schemaMapPromise) {
    schemaMapPromise = (async () => {
      const foreignKeys = await postgres.query(`
        SELECT
          child.relname AS child_table,
          ca.attname AS child_column,
          parent.relname AS parent_table,
          pa.attname AS parent_column,
          con.confdeltype AS on_delete,
          NOT ca.attnotnull AS nullable
        FROM pg_constraint con
        INNER JOIN pg_class child ON child.oid = con.conrelid
        INNER JOIN pg_class parent ON parent.oid = con.confrelid
        INNER JOIN pg_namespace ns ON ns.oid = child.relnamespace
        INNER JOIN pg_attribute ca ON ca.attrelid = con.conrelid AND ca.attnum = con.conkey[1]
        INNER JOIN pg_attribute pa ON pa.attrelid = con.confrelid AND pa.attnum = con.confkey[1]
        WHERE con.contype = 'f'
          AND cardinality(con.conkey) = 1
          AND ns.nspname = 'public'
      `);

      const primaryKeys = await postgres.query(`
        SELECT c.relname AS table_name, a.attname AS column_name
        FROM pg_index i
        INNER JOIN pg_class c ON c.oid = i.indrelid
        INNER JOIN pg_namespace ns ON ns.oid = c.relnamespace
        INNER JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
        WHERE i.indisprimary AND ns.nspname = 'public'
      `);

      const pk = new Map();
      for (const row of primaryKeys.rows) {
        if (!pk.has(row.table_name)) pk.set(row.table_name, []);
        pk.get(row.table_name).push(row.column_name);
      }

      return { foreignKeys: foreignKeys.rows, primaryKeys: pk };
    })().catch((error) => {
      schemaMapPromise = null;
      throw error;
    });
  }

  return schemaMapPromise;
}

async function getTableColumns(db, table) {
  const result = await db.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1",
    [table],
  );
  return new Set(result.rows.map((row) => row.column_name));
}

function rowKey(schema, table, row) {
  const pkColumns = schema.primaryKeys.get(table);
  return pkColumns?.length
    ? pkColumns.map((column) => String(row[column])).join("|")
    : JSON.stringify(row);
}

/**
 * Copia uma linha e tudo que depende dela em cascata. Valores saem pelo
 * row_to_json do próprio Postgres, então datas, JSON e listas voltam iguais.
 */
async function captureSubtree(db, rootTable, rootIds) {
  const schema = await loadSchemaMap();
  const tables = {};
  const seen = new Map();
  const queue = [{ table: rootTable, column: "id", values: rootIds }];

  while (queue.length) {
    const { table, column, values } = queue.shift();
    if (!values.length) continue;

    const result = await db.query(
      `SELECT row_to_json(t) AS row FROM ${quoteIdent(table)} t WHERE t.${quoteIdent(column)}::text = ANY($1::text[])`,
      [values.map(String)],
    );

    if (!seen.has(table)) seen.set(table, new Set());
    const seenKeys = seen.get(table);
    const fresh = [];

    for (const { row } of result.rows) {
      const key = rowKey(schema, table, row);
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      fresh.push(row);
    }

    if (!fresh.length) continue;
    (tables[table] ||= []).push(...fresh);

    for (const fk of schema.foreignKeys) {
      if (fk.parent_table !== table || fk.on_delete !== "c") continue;
      const parentValues = [
        ...new Set(fresh.map((row) => row[fk.parent_column]).filter((value) => value != null)),
      ];
      if (parentValues.length) {
        queue.push({ table: fk.child_table, column: fk.child_column, values: parentValues });
      }
    }
  }

  return { rootTable, rootIds: rootIds.map(String), tables };
}

/** Ordena as tabelas para inserir primeiro quem é referenciado. */
function orderTables(schema, tableNames) {
  const names = new Set(tableNames);
  const ordered = [];
  const state = new Map();

  const visit = (table) => {
    if (state.get(table) === "done" || state.get(table) === "visiting") return;
    state.set(table, "visiting");
    for (const fk of schema.foreignKeys) {
      if (fk.child_table === table && fk.parent_table !== table && names.has(fk.parent_table)) {
        visit(fk.parent_table);
      }
    }
    state.set(table, "done");
    ordered.push(table);
  };

  tableNames.forEach(visit);
  return ordered;
}

class TrashRestoreError extends Error {
  constructor(message, status = 409) {
    super(message);
    this.status = status;
  }
}

/** Devolve ao banco o que captureSubtree guardou. */
async function restoreSubtree(db, snapshot) {
  const schema = await loadSchemaMap();
  const tableNames = Object.keys(snapshot.tables || {});
  const order = orderTables(schema, tableNames);
  const snapshotTables = new Set(tableNames);
  const deferredUpdates = [];
  let skipped = 0;
  let savepoint = 0;

  for (const table of order) {
    const columns = await getTableColumns(db, table);
    const pkColumns = schema.primaryKeys.get(table) || [];
    // Referências para a própria tabela (subtarefa → card, resposta → comentário)
    // entram vazias e são preenchidas depois que todas as linhas existem.
    const selfRefs = schema.foreignKeys.filter(
      (fk) => fk.child_table === table && fk.parent_table === table && fk.nullable,
    );
    const setNullRefs = schema.foreignKeys.filter(
      (fk) =>
        fk.child_table === table &&
        fk.nullable &&
        fk.on_delete === "n" &&
        !snapshotTables.has(fk.parent_table),
    );

    for (const original of snapshot.tables[table]) {
      const row = {};
      for (const [column, value] of Object.entries(original)) {
        if (columns.has(column)) row[column] = value;
      }

      if (pkColumns.length) {
        for (const fk of selfRefs) {
          if (row[fk.child_column] != null) {
            deferredUpdates.push({ table, fk, pkColumns, row: { ...row } });
            row[fk.child_column] = null;
          }
        }
      }

      const insert = async (values) => {
        const cols = Object.keys(values);
        const name = `lix_${(savepoint += 1)}`;
        await db.query(`SAVEPOINT ${name}`);
        try {
          await db.query(
            `
              INSERT INTO ${quoteIdent(table)} (${cols.map(quoteIdent).join(", ")})
              SELECT ${cols.map(quoteIdent).join(", ")}
              FROM json_populate_record(NULL::${quoteIdent(table)}, $1::json)
              ON CONFLICT DO NOTHING
            `,
            [JSON.stringify(values)],
          );
          await db.query(`RELEASE SAVEPOINT ${name}`);
          return true;
        } catch (error) {
          await db.query(`ROLLBACK TO SAVEPOINT ${name}`);
          if (error.code !== "23503") throw error;
          return false;
        }
      };

      let ok = await insert(row);
      if (!ok && setNullRefs.length) {
        // Igual ao ON DELETE SET NULL: status ou autor que não existe mais fica vazio.
        const retry = { ...row };
        for (const fk of setNullRefs) retry[fk.child_column] = null;
        ok = await insert(retry);
      }

      if (!ok) {
        const isRoot =
          table === snapshot.rootTable && snapshot.rootIds.includes(String(original.id));
        if (isRoot) {
          throw new TrashRestoreError(
            "Não foi possível restaurar: o lugar de origem deste item não existe mais.",
          );
        }
        skipped += 1;
      }
    }
  }

  for (const update of deferredUpdates) {
    const name = `lix_${(savepoint += 1)}`;
    await db.query(`SAVEPOINT ${name}`);
    try {
      const params = [update.row[update.fk.child_column], ...update.pkColumns.map((c) => update.row[c])];
      await db.query(
        `UPDATE ${quoteIdent(update.table)} SET ${quoteIdent(update.fk.child_column)} = $1 WHERE ${update.pkColumns
          .map((column, index) => `${quoteIdent(column)}::text = $${index + 2}::text`)
          .join(" AND ")}`,
        params,
      );
      await db.query(`RELEASE SAVEPOINT ${name}`);
    } catch (error) {
      await db.query(`ROLLBACK TO SAVEPOINT ${name}`);
    }
  }

  return { skipped };
}

// ---------------------------------------------------------------------------
// Entrada na lixeira
// ---------------------------------------------------------------------------
async function sumFileSizes(db, urls) {
  if (!urls.length) return 0;
  const result = await db.query(
    "SELECT COALESCE(SUM(size_bytes), 0)::bigint AS total FROM storage_files WHERE url = ANY($1::text[]) AND deleted_at IS NULL",
    [urls],
  );
  return Number(result.rows[0]?.total || 0);
}

async function insertTrashItem(db, item) {
  await ensureTrashSchema();
  const id = newTrashId();
  await db.query(
    `
      INSERT INTO trash_items (
        id, organization_id, workspace_id, list_id, task_id, item_type, item_id,
        title, deleted_by, snapshot, file_urls, size_bytes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::text[], $12)
    `,
    [
      id,
      item.organizationId,
      item.workspaceId || null,
      item.listId || null,
      item.taskId || null,
      item.type,
      item.itemId,
      item.title || null,
      item.deletedBy || null,
      item.snapshot ? JSON.stringify(item.snapshot) : null,
      item.fileUrls || [],
      item.sizeBytes || 0,
    ],
  );
  return id;
}

/** Guarda o card (com subtarefas e tudo que pertence a eles) antes de apagar. */
async function moveTaskToTrash(db, { taskId, deletedBy }) {
  await ensureTrashSchema();
  const task = await db.query(
    `
      SELECT t.id, t.title, t.list_id, t.workspace_id, w.organization_id
      FROM tasks t
      INNER JOIN workspaces w ON w.id = t.workspace_id
      WHERE t.id = $1
    `,
    [taskId],
  );
  const row = task.rows[0];
  if (!row) return null;

  const snapshot = await captureSubtree(db, "tasks", [taskId]);
  const fileUrls = [
    ...new Set(
      [
        ...(snapshot.tables.task_attachments || []).map((item) => item.url),
        ...(snapshot.tables.task_comments || []).map((item) => item.attachment_url),
      ].filter(Boolean),
    ),
  ];

  await insertTrashItem(db, {
    organizationId: row.organization_id,
    workspaceId: row.workspace_id,
    listId: row.list_id,
    taskId,
    type: "task",
    itemId: taskId,
    title: row.title,
    deletedBy,
    snapshot,
    fileUrls,
    sizeBytes: await sumFileSizes(db, fileUrls),
  });

  return { fileUrls };
}

async function moveAttachmentToTrash(db, { attachmentId, deletedBy }) {
  await ensureTrashSchema();
  const attachment = await db.query(
    `
      SELECT ta.id, ta.name, ta.url, ta.task_id, t.list_id, t.workspace_id, w.organization_id
      FROM task_attachments ta
      INNER JOIN tasks t ON t.id = ta.task_id
      INNER JOIN workspaces w ON w.id = t.workspace_id
      WHERE ta.id = $1
    `,
    [attachmentId],
  );
  const row = attachment.rows[0];
  if (!row) return null;

  const snapshot = await captureSubtree(db, "task_attachments", [attachmentId]);
  await insertTrashItem(db, {
    organizationId: row.organization_id,
    workspaceId: row.workspace_id,
    listId: row.list_id,
    taskId: row.task_id,
    type: "attachment",
    itemId: attachmentId,
    title: row.name,
    deletedBy,
    snapshot,
    fileUrls: [row.url],
    sizeBytes: await sumFileSizes(db, [row.url]),
  });

  return row;
}

async function registerListInTrash(db, { listId, deletedBy }) {
  const list = await db.query(
    `
      SELECT l.id, l.name, w.id AS workspace_id, w.organization_id
      FROM lists l
      INNER JOIN folders f ON f.id = l.folder_id
      INNER JOIN spaces s ON s.id = f.space_id
      INNER JOIN workspaces w ON w.id = s.workspace_id
      WHERE l.id = $1
    `,
    [listId],
  );
  const row = list.rows[0];
  if (!row) return null;

  await db.query("DELETE FROM trash_items WHERE item_type = 'list' AND item_id = $1", [listId]);
  return insertTrashItem(db, {
    organizationId: row.organization_id,
    workspaceId: row.workspace_id,
    listId,
    type: "list",
    itemId: listId,
    title: row.name,
    deletedBy,
  });
}

async function registerWorkspaceInTrash(db, { workspaceId, deletedBy }) {
  const workspace = await db.query(
    "SELECT id, name, organization_id FROM workspaces WHERE id = $1",
    [workspaceId],
  );
  const row = workspace.rows[0];
  if (!row) return null;

  await db.query("DELETE FROM trash_items WHERE item_type = 'workspace' AND item_id = $1", [
    workspaceId,
  ]);
  return insertTrashItem(db, {
    organizationId: row.organization_id,
    workspaceId,
    type: "workspace",
    itemId: workspaceId,
    title: row.name,
    deletedBy,
  });
}

// ---------------------------------------------------------------------------
// Consulta, restauração e exclusão definitiva
// ---------------------------------------------------------------------------
function getTrashDays(billing) {
  if (billing?.isExempt) return -1;
  const days = Number(billing?.entitlements?.trashDays);
  return Number.isFinite(days) ? days : 30;
}

async function listTrash({ organizationId, memberId, canSeeAll }) {
  await ensureTrashSchema();
  const { loadOrganizationBilling } = require("./billing.service");
  const billing = await loadOrganizationBilling(organizationId);
  const trashDays = getTrashDays(billing);

  const result = await postgres.query(
    `
      SELECT
        ti.id, ti.item_type, ti.item_id, ti.title, ti.deleted_by, ti.deleted_at,
        ti.size_bytes, cardinality(ti.file_urls) AS files_count,
        ti.workspace_id, ti.list_id, ti.task_id,
        w.name AS workspace_name,
        l.name AS list_name,
        t.title AS task_title,
        m.name AS deleted_by_name
      FROM trash_items ti
      LEFT JOIN workspaces w ON w.id = ti.workspace_id
      LEFT JOIN lists l ON l.id = ti.list_id
      LEFT JOIN tasks t ON t.id = ti.task_id AND ti.item_type = 'attachment'
      LEFT JOIN members m ON m.id = ti.deleted_by
      WHERE ti.organization_id = $1
        AND ($2::boolean OR ti.deleted_by = $3)
      ORDER BY ti.deleted_at DESC
      LIMIT 500
    `,
    [organizationId, canSeeAll, memberId],
  );

  return {
    trashDays,
    items: result.rows.map((row) => {
      const deletedAt = new Date(row.deleted_at);
      return {
        id: row.id,
        type: row.item_type,
        itemId: row.item_id,
        title: row.title,
        workspaceName: row.item_type === "workspace" ? null : row.workspace_name,
        listName: ["task", "attachment"].includes(row.item_type) ? row.list_name : null,
        taskTitle: row.item_type === "attachment" ? row.task_title : null,
        deletedBy: row.deleted_by,
        deletedByName: row.deleted_by_name,
        deletedAt: row.deleted_at,
        expiresAt:
          trashDays > 0 ? new Date(deletedAt.getTime() + trashDays * 86400000).toISOString() : null,
        sizeBytes: Number(row.size_bytes || 0),
        filesCount: Number(row.files_count || 0),
      };
    }),
  };
}

async function loadTrashItem(db, { id, organizationId }) {
  await ensureTrashSchema();
  const result = await db.query(
    "SELECT * FROM trash_items WHERE id = $1 AND organization_id = $2",
    [id, organizationId],
  );
  return result.rows[0] || null;
}

async function assertWithinLimit(organizationId, kind) {
  const { getOrganizationUsage, loadOrganizationBilling } = require("./billing.service");
  const [billing, usage] = await Promise.all([
    loadOrganizationBilling(organizationId),
    getOrganizationUsage(organizationId),
  ]);
  const limit = kind === "workspace" ? billing.entitlements.maxWorkspaces : billing.entitlements.maxProjects;
  const used = kind === "workspace" ? usage.workspaces : usage.projects;

  if (limit !== -1 && used >= limit) {
    throw new TrashRestoreError(
      kind === "workspace"
        ? `Seu plano permite ${limit} workspace(s). Exclua outro ou faça upgrade para restaurar este.`
        : `Seu plano permite ${limit} projeto(s). Exclua outro ou faça upgrade para restaurar este.`,
      403,
    );
  }
}

async function restoreTrashItem(db, item) {
  if (item.item_type === "workspace") {
    await assertWithinLimit(item.organization_id, "workspace");
    await db.query(
      "UPDATE workspaces SET deleted_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1",
      [item.item_id],
    );
  } else if (item.item_type === "list") {
    const parent = await db.query(
      `
        SELECT w.deleted_at
        FROM lists l
        INNER JOIN folders f ON f.id = l.folder_id
        INNER JOIN spaces s ON s.id = f.space_id
        INNER JOIN workspaces w ON w.id = s.workspace_id
        WHERE l.id = $1
      `,
      [item.item_id],
    );
    if (!parent.rows[0]) {
      throw new TrashRestoreError("O workspace deste projeto não existe mais.");
    }
    if (parent.rows[0].deleted_at) {
      throw new TrashRestoreError("Restaure primeiro o workspace deste projeto.");
    }
    await assertWithinLimit(item.organization_id, "project");
    await db.query(
      "UPDATE lists SET deleted_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1",
      [item.item_id],
    );
  } else {
    const snapshot = item.snapshot || {};
    if (item.item_type === "task") {
      const root = (snapshot.tables?.tasks || []).find((row) => row.id === item.item_id);
      const place = await db.query(
        `
          SELECT l.deleted_at AS list_deleted, w.deleted_at AS workspace_deleted
          FROM lists l
          LEFT JOIN workspaces w ON w.id = $2
          WHERE l.id = $1
        `,
        [root?.list_id, root?.workspace_id],
      );
      if (!place.rows[0]) {
        throw new TrashRestoreError("O projeto deste card não existe mais.");
      }
      if (place.rows[0].workspace_deleted) {
        throw new TrashRestoreError("Restaure primeiro o workspace deste card.");
      }
      if (place.rows[0].list_deleted) {
        throw new TrashRestoreError("Restaure primeiro o projeto deste card.");
      }
      if (root?.parent_task_id) {
        const parentTask = await db.query("SELECT 1 FROM tasks WHERE id = $1", [root.parent_task_id]);
        if (!parentTask.rows[0]) {
          throw new TrashRestoreError("Restaure primeiro o card principal desta subtarefa.");
        }
      }
    } else if (item.item_type === "attachment") {
      const task = await db.query("SELECT 1 FROM tasks WHERE id = $1", [item.task_id]);
      if (!task.rows[0]) {
        throw new TrashRestoreError("Restaure primeiro o card deste anexo.");
      }
    }

    await restoreSubtree(db, snapshot);
  }

  await db.query("DELETE FROM trash_items WHERE id = $1", [item.id]);
}

async function collectTaskFileUrls(db, whereSql, params) {
  const result = await db.query(
    `
      SELECT ta.url FROM task_attachments ta INNER JOIN tasks t ON t.id = ta.task_id WHERE ${whereSql}
      UNION
      SELECT tc.attachment_url FROM task_comments tc INNER JOIN tasks t ON t.id = tc.task_id
      WHERE ${whereSql} AND tc.attachment_url IS NOT NULL
    `,
    params,
  );
  return result.rows.map((row) => row.url).filter(Boolean);
}

/**
 * Apaga para sempre. Devolve os endereços de arquivo que podem sair da Bunny
 * (chamar releaseStorageUrls depois do COMMIT).
 */
async function purgeTrashItem(db, item) {
  let urls = [...(item.file_urls || [])];

  if (item.item_type === "list") {
    urls.push(...(await collectTaskFileUrls(db, "t.list_id = $1", [item.item_id])));
    const nested = await db.query(
      "SELECT file_urls FROM trash_items WHERE list_id = $1 AND id <> $2",
      [item.item_id, item.id],
    );
    nested.rows.forEach((row) => urls.push(...(row.file_urls || [])));
    await db.query("DELETE FROM trash_items WHERE list_id = $1", [item.item_id]);
    await db.query("DELETE FROM lists WHERE id = $1 AND deleted_at IS NOT NULL", [item.item_id]);
  } else if (item.item_type === "workspace") {
    urls.push(...(await collectTaskFileUrls(db, "t.workspace_id = $1", [item.item_id])));
    const nested = await db.query(
      "SELECT file_urls FROM trash_items WHERE workspace_id = $1 AND id <> $2",
      [item.item_id, item.id],
    );
    nested.rows.forEach((row) => urls.push(...(row.file_urls || [])));
    await db.query("DELETE FROM trash_items WHERE workspace_id = $1", [item.item_id]);
    await db.query("DELETE FROM workspaces WHERE id = $1 AND deleted_at IS NOT NULL", [
      item.item_id,
    ]);
  }

  await db.query("DELETE FROM trash_items WHERE id = $1", [item.id]);
  return [...new Set(urls.filter(Boolean))];
}

async function purgeExpiredTrash() {
  await ensureTrashSchema();
  const { releaseStorageUrls } = require("./storage.service");
  const { resolveOrganizationBilling } = require("./billing.service");

  const organizations = await postgres.query(`
    SELECT o.*
    FROM organizations o
    WHERE EXISTS (SELECT 1 FROM trash_items ti WHERE ti.organization_id = o.id)
  `);

  let purged = 0;
  for (const organization of organizations.rows) {
    const trashDays = getTrashDays(resolveOrganizationBilling(organization));
    if (trashDays < 0) continue;

    const expired = await postgres.query(
      `
        SELECT * FROM trash_items
        WHERE organization_id = $1
          AND deleted_at < NOW() - ($2::int * INTERVAL '1 day')
        ORDER BY CASE item_type WHEN 'workspace' THEN 0 WHEN 'list' THEN 1 ELSE 2 END
      `,
      [organization.id, trashDays],
    );

    for (const item of expired.rows) {
      const client = await postgres.connect();
      try {
        await client.query("BEGIN");
        const stillThere = await client.query("SELECT * FROM trash_items WHERE id = $1 FOR UPDATE", [
          item.id,
        ]);
        if (!stillThere.rows[0]) {
          await client.query("ROLLBACK");
          continue;
        }
        const urls = await purgeTrashItem(client, stillThere.rows[0]);
        await client.query("COMMIT");
        await releaseStorageUrls(urls);
        purged += 1;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        console.error("[lixeira] falha ao apagar item vencido", item.id, error?.message || error);
      } finally {
        client.release();
      }
    }
  }

  if (purged) console.log(`[lixeira] ${purged} item(ns) vencido(s) apagado(s) de vez.`);
  return purged;
}

function startTrashPurgeWorker() {
  const run = () =>
    purgeExpiredTrash().catch((error) =>
      console.error("[lixeira] falha na limpeza", error?.message || error),
    );
  setTimeout(run, 60 * 1000).unref?.();
  setInterval(run, PURGE_INTERVAL_MS).unref?.();
}

module.exports = {
  TRASH_TYPES,
  TrashRestoreError,
  ensureTrashSchema,
  captureSubtree,
  restoreSubtree,
  moveTaskToTrash,
  moveAttachmentToTrash,
  registerListInTrash,
  registerWorkspaceInTrash,
  listTrash,
  loadTrashItem,
  restoreTrashItem,
  purgeTrashItem,
  purgeExpiredTrash,
  startTrashPurgeWorker,
};
