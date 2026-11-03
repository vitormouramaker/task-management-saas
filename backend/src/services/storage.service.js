const crypto = require("crypto");
const path = require("path");
const { Transform, pipeline } = require("stream");
const { postgres } = require("../server/connect");
const { resolveOrganizationBilling } = require("./billing.service");
const {
  buildPublicUrl,
  getBunnyObjectStream,
  uploadToBunny,
  uploadStreamToBunny,
  deleteFromBunny,
  extractStoragePathFromUrl,
} = require("./bunny.service");
const { publishRealtimeEvent } = require("./realtime.service");

// Estrutura na Bunny:
// Pauta/<empresa>-<cod>/<workspace>-<cod>/<projeto>-<cod>/<arquivo>
// Pauta/<empresa>-<cod>/_perfis | _emails
const ROOT_FOLDER = "Pauta";

// O prefixo "_" evita conflito com pastas de workspace, que sempre terminam em "-<cod>".
const ORGANIZATION_COMMON_FOLDERS = {
  profiles: "_perfis",
  emails: "_emails",
};

const MB = 1024 * 1024;
const MAX_AVATAR_BYTES = 2 * MB;
const BLOCKED_FILE_MESSAGE =
  "Este tipo de arquivo não é permitido por segurança.";
const BLOCKED_EXTENSIONS = new Set([
  "exe",
  "msi",
  "bat",
  "cmd",
  "scr",
  "sh",
  "ps1",
  "vbs",
  "apk",
  "jar",
]);

const FOLDER_ENTITIES = {
  organizations: "empresa",
  workspaces: "workspace",
  lists: "projeto",
};

class StorageError extends Error {
  constructor(status, message, { code = null } = {}) {
    super(message);
    this.name = "StorageError";
    this.status = status;
    // Código opcional para o front reagir (ex.: oferecer upgrade de plano).
    this.code = code;
  }
}

let schemaReady = null;

function ensureStorageSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      for (const table of Object.keys(FOLDER_ENTITIES)) {
        await postgres.query(
          `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS storage_folder VARCHAR(120)`,
        );
      }

      await postgres.query(`
        CREATE TABLE IF NOT EXISTS storage_files (
          id VARCHAR(100) PRIMARY KEY,
          organization_id VARCHAR(100),
          workspace_id VARCHAR(100),
          list_id VARCHAR(100),
          task_id VARCHAR(100),
          uploaded_by VARCHAR(100),
          kind VARCHAR(40) NOT NULL,
          storage_path TEXT NOT NULL UNIQUE,
          url TEXT NOT NULL,
          original_name VARCHAR(255),
          content_type VARCHAR(150),
          size_bytes BIGINT NOT NULL DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          deleted_at TIMESTAMP
        )
      `);
      // Trilha de auditoria: quem enviou, de onde, e a impressão digital do
      // arquivo. É o que responde a um pedido judicial — pasta não prova nada.
      for (const coluna of [
        "ALTER TABLE storage_files ADD COLUMN IF NOT EXISTS content_sha256 VARCHAR(64)",
        "ALTER TABLE storage_files ADD COLUMN IF NOT EXISTS uploader_ip VARCHAR(60)",
        "ALTER TABLE storage_files ADD COLUMN IF NOT EXISTS uploader_agent VARCHAR(300)",
      ]) {
        await postgres.query(coluna);
      }

      await postgres.query(`
        CREATE TABLE IF NOT EXISTS storage_access_log (
          id BIGSERIAL PRIMARY KEY,
          file_id VARCHAR(100),
          storage_path TEXT NOT NULL,
          organization_id VARCHAR(100),
          member_id VARCHAR(100),
          action VARCHAR(20) NOT NULL DEFAULT 'link',
          ip VARCHAR(60),
          user_agent VARCHAR(300),
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await postgres.query(
        "CREATE INDEX IF NOT EXISTS idx_storage_access_org ON storage_access_log (organization_id, created_at DESC)",
      );
      await postgres.query(
        "CREATE INDEX IF NOT EXISTS idx_storage_access_path ON storage_access_log (storage_path, created_at DESC)",
      );

      await postgres.query(`
        CREATE INDEX IF NOT EXISTS idx_storage_files_org_active
        ON storage_files (organization_id)
        WHERE deleted_at IS NULL
      `);
      await postgres.query(
        "CREATE INDEX IF NOT EXISTS idx_storage_files_url ON storage_files (url)",
      );
      // Empresas com pastas a reorganizar (renomeação de empresa/workspace/projeto).
      await postgres.query(`
        CREATE TABLE IF NOT EXISTS storage_reconcile_queue (
          organization_id VARCHAR(100) PRIMARY KEY,
          requested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      // Arquivos antigos de uma movimentação: apagados depois do prazo de carência.
      await postgres.query(`
        CREATE TABLE IF NOT EXISTS storage_pending_deletes (
          storage_path TEXT PRIMARY KEY,
          delete_after TIMESTAMP NOT NULL
        )
      `);
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }

  return schemaReady;
}

function toFolderSlug(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

function buildFolderName(name, id, fallback) {
  const code =
    String(id || "")
      .replace(/[^a-z0-9]/gi, "")
      .slice(-6)
      .toLowerCase() || crypto.randomBytes(3).toString("hex");

  return `${toFolderSlug(name) || fallback}-${code}`;
}

/**
 * Retorna o nome de pasta da entidade, gravando-o no banco na primeira chamada.
 * Quando a entidade é renomeada, syncStorageFolderName atualiza o nome e a
 * reconciliação move os arquivos para a pasta nova.
 */
async function ensureEntityFolder(db, table, id, name, { persist = true } = {}) {
  if (!FOLDER_ENTITIES[table]) {
    throw new Error(`Tabela sem pasta de armazenamento: ${table}`);
  }

  const current = await db.query(
    `SELECT storage_folder FROM ${table} WHERE id = $1`,
    [id],
  );
  if (current.rows[0]?.storage_folder) {
    return current.rows[0].storage_folder;
  }

  const candidate = buildFolderName(name, id, FOLDER_ENTITIES[table]);
  if (!persist) {
    return candidate;
  }

  await db.query(
    `UPDATE ${table} SET storage_folder = $2 WHERE id = $1 AND storage_folder IS NULL`,
    [id, candidate],
  );
  const saved = await db.query(
    `SELECT storage_folder FROM ${table} WHERE id = $1`,
    [id],
  );

  return saved.rows[0]?.storage_folder || candidate;
}

async function resolveOrganizationFolderPath(db, organizationId, options) {
  await ensureStorageSchema();
  const result = await db.query(
    "SELECT id, name FROM organizations WHERE id = $1",
    [organizationId],
  );

  if (!result.rows[0]) {
    throw new StorageError(404, "Empresa não encontrada.");
  }

  const folder = await ensureEntityFolder(
    db,
    "organizations",
    result.rows[0].id,
    result.rows[0].name,
    options,
  );

  return `${ROOT_FOLDER}/${folder}`;
}

async function resolveTaskStorageContext(
  db,
  taskId,
  fallbackOrganizationId,
  options,
) {
  await ensureStorageSchema();
  const result = await db.query(
    `
      SELECT
        t.id AS "taskId",
        l.id AS "listId",
        l.name AS "listName",
        w.id AS "workspaceId",
        w.name AS "workspaceName",
        COALESCE(w.organization_id, $2) AS "organizationId"
      FROM tasks t
      INNER JOIN lists l ON l.id = t.list_id
      INNER JOIN folders f ON f.id = l.folder_id
      INNER JOIN spaces s ON s.id = f.space_id
      INNER JOIN workspaces w ON w.id = s.workspace_id
      WHERE t.id = $1
    `,
    [taskId, fallbackOrganizationId || null],
  );

  const row = result.rows[0];
  if (!row) {
    throw new StorageError(404, "Tarefa não encontrada.");
  }
  if (!row.organizationId) {
    throw new StorageError(403, "Tarefa sem empresa vinculada.");
  }

  const organizationPath = await resolveOrganizationFolderPath(
    db,
    row.organizationId,
    options,
  );
  const workspaceFolder = await ensureEntityFolder(
    db,
    "workspaces",
    row.workspaceId,
    row.workspaceName,
    options,
  );
  const listFolder = await ensureEntityFolder(
    db,
    "lists",
    row.listId,
    row.listName,
    options,
  );

  return {
    organizationId: row.organizationId,
    workspaceId: row.workspaceId,
    listId: row.listId,
    taskId: row.taskId,
    folderPath: `${organizationPath}/${workspaceFolder}/${listFolder}`,
  };
}

function formatStorageLimit(megabytes) {
  if (megabytes >= 1024) {
    const gigabytes = Number((megabytes / 1024).toFixed(1));
    return `${gigabytes.toLocaleString("pt-BR")} GB`;
  }
  return `${megabytes} MB`;
}

async function getOrganizationUploadLimits(organizationId) {
  const result = await postgres.query(
    `
      SELECT plan, subscription_status, trial_ends_at, extra_seats,
             extra_storage_packs, billing_exempt, custom_entitlements
      FROM organizations WHERE id = $1
    `,
    [organizationId],
  );

  if (!result.rows[0]) {
    throw new StorageError(404, "Empresa não encontrada.");
  }

  const entitlements = resolveOrganizationBilling(result.rows[0]).entitlements;
  return {
    maxFileSizeMb: entitlements.maxFileSizeMb ?? -1,
    maxStorageMb: entitlements.maxStorageMb ?? -1,
    maxFilesPerUpload: entitlements.maxFilesPerUpload ?? -1,
    maxEmailAttachmentMb: entitlements.maxEmailAttachmentMb ?? -1,
  };
}

async function getOrganizationStorageUsageBytes(organizationId) {
  await ensureStorageSchema();
  const result = await postgres.query(
    `
      SELECT COALESCE(SUM(size_bytes), 0)::bigint AS "usedBytes"
      FROM storage_files
      WHERE organization_id = $1 AND deleted_at IS NULL
    `,
    [organizationId],
  );

  return Number(result.rows[0]?.usedBytes || 0);
}

async function assertUploadAllowed({ organizationId, sizeBytes }) {
  if (!organizationId) {
    throw new StorageError(403, "Conta sem empresa ativa. Faça login novamente.");
  }
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    throw new StorageError(400, "O arquivo está vazio.");
  }

  const limits = await getOrganizationUploadLimits(organizationId);

  if (limits.maxFileSizeMb > 0 && sizeBytes > limits.maxFileSizeMb * MB) {
    throw new StorageError(
      413,
      `O arquivo excede o limite de ${formatStorageLimit(limits.maxFileSizeMb)} por arquivo do seu plano.`,
    );
  }

  if (limits.maxStorageMb > 0) {
    const usedBytes = await getOrganizationStorageUsageBytes(organizationId);
    if (usedBytes + sizeBytes > limits.maxStorageMb * MB) {
      throw new StorageError(
        403,
        `O armazenamento do seu plano (${formatStorageLimit(limits.maxStorageMb)}) está cheio. Libere espaço ou faça upgrade.`,
      );
    }
  }

  return limits;
}

function getFileExtension(fileName) {
  return path.extname(String(fileName || "")).slice(1).toLowerCase();
}

function isBlockedFileName(fileName) {
  return BLOCKED_EXTENSIONS.has(getFileExtension(fileName));
}

function hasExecutableSignature(bytes) {
  const isWindowsExecutable = bytes[0] === 0x4d && bytes[1] === 0x5a;
  const isLinuxExecutable =
    bytes.length >= 4 &&
    bytes[0] === 0x7f &&
    bytes[1] === 0x45 &&
    bytes[2] === 0x4c &&
    bytes[3] === 0x46;

  return isWindowsExecutable || isLinuxExecutable;
}

function sanitizeFileName(originalName) {
  const normalized = String(originalName || "arquivo")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  const rawExtension = path.extname(normalized);
  const extension = rawExtension
    .toLowerCase()
    .replace(/[^a-z0-9.]/g, "")
    .slice(0, 12);
  const baseName =
    path
      .basename(normalized, rawExtension)
      .replace(/[^a-zA-Z0-9._-]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^[_.]+|[_.]+$/g, "")
      .slice(0, 80) || "arquivo";

  return `${baseName}${extension}`;
}

function buildStoredFileName(originalName) {
  return `${Date.now()}_${crypto.randomBytes(3).toString("hex")}_${sanitizeFileName(originalName)}`;
}

function readUploadHeaders(req) {
  let originalName;
  try {
    originalName = decodeURIComponent(
      String(req.headers["x-file-name"] || ""),
    ).trim();
  } catch {
    throw new StorageError(400, "Nome de arquivo inválido.");
  }
  originalName = (originalName || "arquivo").slice(0, 255);

  if (isBlockedFileName(originalName)) {
    throw new StorageError(415, BLOCKED_FILE_MESSAGE);
  }

  const contentLength = Number(req.headers["content-length"]);
  if (!Number.isInteger(contentLength) || contentLength <= 0) {
    throw new StorageError(411, "Não foi possível identificar o tamanho do arquivo.");
  }

  const contentType =
    String(req.headers["x-file-type"] || "")
      .replace(/[^\w.+\-/]/g, "")
      .slice(0, 150) || "application/octet-stream";

  return { originalName, contentLength, contentType };
}

// Confere a assinatura dos primeiros bytes e garante que o corpo tem
// exatamente o tamanho declarado no Content-Length.
function createUploadGuard(expectedBytes) {
  let receivedBytes = 0;
  let signature = Buffer.alloc(0);
  const digest = crypto.createHash("sha256");

  const guard = new Transform({
    transform(chunk, _encoding, callback) {
      digest.update(chunk);
      if (signature.length < 4) {
        signature = Buffer.concat([
          signature,
          chunk.subarray(0, 4 - signature.length),
        ]);
        if (signature.length >= 2 && hasExecutableSignature(signature)) {
          callback(new StorageError(415, BLOCKED_FILE_MESSAGE));
          return;
        }
      }

      receivedBytes += chunk.length;
      if (receivedBytes > expectedBytes) {
        callback(
          new StorageError(413, "O arquivo enviado é maior que o tamanho informado."),
        );
        return;
      }

      callback(null, chunk);
    },
    flush(callback) {
      if (receivedBytes !== expectedBytes) {
        callback(new StorageError(400, "Envio do arquivo incompleto."));
        return;
      }
      guard.contentSha256 = digest.digest("hex");
      callback();
    },
  });

  return guard;
}

async function recordStorageFile(db, file) {
  await ensureStorageSchema();
  await db.query(
    `
      INSERT INTO storage_files (
        id, organization_id, workspace_id, list_id, task_id, uploaded_by,
        kind, storage_path, url, original_name, content_type, size_bytes,
        content_sha256, uploader_ip, uploader_agent
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      ON CONFLICT (storage_path) DO NOTHING
    `,
    [
      `file_${crypto.randomBytes(8).toString("hex")}`,
      file.organizationId || null,
      file.workspaceId || null,
      file.listId || null,
      file.taskId || null,
      file.uploadedBy || null,
      file.kind,
      file.storagePath,
      file.url,
      file.originalName ? String(file.originalName).slice(0, 255) : null,
      file.contentType ? String(file.contentType).slice(0, 150) : null,
      Number(file.sizeBytes) || 0,
      file.contentSha256 || null,
      file.uploaderIp ? String(file.uploaderIp).slice(0, 60) : null,
      file.uploaderAgent ? String(file.uploaderAgent).slice(0, 300) : null,
    ],
  );
}

/** De onde veio a requisição, para a trilha de auditoria. */
function origemDaRequisicao(req) {
  const encaminhado = String(req?.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
  return {
    ip: encaminhado || req?.socket?.remoteAddress || null,
    agent: req?.headers?.["user-agent"] || null,
  };
}

/**
 * Recebe o corpo binário da requisição e envia em streaming para a Bunny.
 * Headers esperados: Content-Length, X-File-Name (encodeURIComponent), X-File-Type.
 */
async function receiveUpload(req, target) {
  const { originalName, contentLength, contentType } = readUploadHeaders(req);
  await assertUploadAllowed({
    organizationId: target.organizationId,
    sizeBytes: contentLength,
  });

  const storagePath = `${target.folderPath}/${buildStoredFileName(originalName)}`;
  const guard = createUploadGuard(contentLength);
  let streamError = null;

  // Registrado antes do axios para capturar o motivo real quando o stream falha.
  guard.on("error", (error) => {
    streamError = streamError || error;
  });
  pipeline(req, guard, (error) => {
    if (error) {
      streamError = streamError || error;
    }
  });

  let url;
  try {
    url = await uploadStreamToBunny({ stream: guard, storagePath, contentLength });
  } catch (error) {
    const failure = streamError || error;
    if (failure instanceof StorageError) {
      throw failure;
    }
    console.error("[storage] falha no envio para a Bunny", {
      storagePath,
      message: failure?.response?.data || failure?.message || String(failure),
    });
    throw new StorageError(
      502,
      "Falha ao enviar o arquivo para o armazenamento. Tente novamente.",
    );
  }

  if (streamError) {
    await deleteFromBunny(storagePath);
    throw streamError instanceof StorageError
      ? streamError
      : new StorageError(400, "Envio do arquivo incompleto.");
  }

  const origem = origemDaRequisicao(req);
  await recordStorageFile(postgres, {
    ...target,
    storagePath,
    url,
    originalName,
    contentType,
    sizeBytes: contentLength,
    contentSha256: guard.contentSha256 || null,
    uploaderIp: origem.ip,
    uploaderAgent: origem.agent,
  });
  await requestReconcileIfBusy(target.organizationId);

  return { url, name: originalName, size: contentLength, contentType, storagePath };
}

async function uploadBufferToStorage({ buffer, folderPath, fileName, ...file }) {
  const url = await uploadToBunny(buffer, fileName, folderPath);
  const storagePath = `${folderPath}/${fileName}`;

  await recordStorageFile(postgres, {
    ...file,
    storagePath,
    url,
    sizeBytes: buffer.length,
    contentSha256: crypto.createHash("sha256").update(buffer).digest("hex"),
  });
  await requestReconcileIfBusy(file.organizationId);

  return { url, storagePath };
}

async function countUrlReferences(db, url) {
  const result = await db.query(
    `
      SELECT (
        (SELECT COUNT(*) FROM task_attachments WHERE url = $1::text)
        + (SELECT COUNT(*) FROM task_comments WHERE attachment_url = $1::text)
        + (SELECT COUNT(*) FROM members WHERE avatar_url = $1::text)
        + (
          CASE WHEN to_regclass('public.trash_items') IS NULL THEN 0
          ELSE (SELECT COUNT(*) FROM trash_items WHERE $1::text = ANY(file_urls))
          END
        )
        + (
          CASE WHEN to_regclass('public.sent_emails') IS NULL THEN 0
          ELSE (SELECT COUNT(*) FROM sent_emails WHERE $1::text = ANY(attachments))
          END
        )
      )::int AS total
    `,
    [url],
  );

  return result.rows[0]?.total || 0;
}

/**
 * Apaga da Bunny os arquivos que não são mais referenciados por nenhum registro.
 * Chamar depois que a exclusão no banco já foi confirmada. Nunca lança erro.
 */
async function releaseStorageUrls(urls) {
  const uniqueUrls = [...new Set((urls || []).filter(Boolean))];

  for (const url of uniqueUrls) {
    const storagePath = extractStoragePathFromUrl(url);
    if (!storagePath) {
      continue;
    }

    try {
      if ((await countUrlReferences(postgres, url)) > 0) {
        continue;
      }

      const deleted = await deleteFromBunny(storagePath);
      if (deleted) {
        await ensureStorageSchema();
        await postgres.query(
          `
            UPDATE storage_files
            SET deleted_at = CURRENT_TIMESTAMP
            WHERE storage_path = $1 AND deleted_at IS NULL
          `,
          [storagePath],
        );
      }
    } catch (error) {
      console.error("[storage] falha ao liberar arquivo", {
        storagePath,
        message: error?.message || String(error),
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Renomeação de pastas: a Bunny não renomeia, então cada arquivo é copiado para
// o caminho novo, os links são atualizados no banco e o original é apagado
// depois de OLD_OBJECT_GRACE_MINUTES (links já abertos continuam funcionando).
// ---------------------------------------------------------------------------

const STORAGE_WORKER_INTERVAL_MS = 10 * 60 * 1000;
const OLD_OBJECT_GRACE_MINUTES = 60;

let storageWorkerRunning = false;
let storageWorkerRequested = false;
let activeReconcileOrganizationId = null;

/** Copia um objeto dentro da storage zone. Retorna null se a origem não existe. */
async function copyStorageObject(fromPath, toPath) {
  const source = await getBunnyObjectStream(fromPath);
  if (!source) {
    return null;
  }

  if (source.contentLength) {
    await uploadStreamToBunny({
      stream: source.stream,
      storagePath: toPath,
      contentLength: source.contentLength,
    });
    return { sizeBytes: source.contentLength, contentType: source.contentType };
  }

  const chunks = [];
  for await (const chunk of source.stream) {
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks);
  await uploadToBunny(buffer, path.posix.basename(toPath), path.posix.dirname(toPath));
  return { sizeBytes: buffer.length, contentType: source.contentType };
}

async function replaceUrlReferences(db, oldUrl, newUrl) {
  await db.query("UPDATE task_attachments SET url = $2 WHERE url = $1", [oldUrl, newUrl]);
  await db.query(
    "UPDATE task_comments SET attachment_url = $2 WHERE attachment_url = $1",
    [oldUrl, newUrl],
  );
  await db.query("UPDATE members SET avatar_url = $2 WHERE avatar_url = $1", [oldUrl, newUrl]);

  // Arquivos de itens na lixeira também mudam de pasta junto com o projeto.
  const trash = await db.query("SELECT to_regclass('public.trash_items') IS NOT NULL AS exists");
  if (trash.rows[0]?.exists) {
    await db.query(
      `
        UPDATE trash_items
        SET file_urls = array_replace(file_urls, $1::text, $2::text),
            snapshot = CASE
              WHEN snapshot IS NULL THEN NULL
              ELSE replace(snapshot::text, to_json($1::text)::text, to_json($2::text)::text)::jsonb
            END
        WHERE $1::text = ANY(file_urls)
      `,
      [oldUrl, newUrl],
    );
  }

  const sentEmails = await db.query(
    "SELECT to_regclass('public.sent_emails') IS NOT NULL AS exists",
  );
  if (sentEmails.rows[0]?.exists) {
    await db.query(
      `
        UPDATE sent_emails
        SET attachments = array_replace(attachments, $1::text, $2::text)
        WHERE $1::text = ANY(attachments)
      `,
      [oldUrl, newUrl],
    );
  }
}

async function loadFolderEntity(table, id) {
  const queries = {
    organizations: `
      SELECT name, storage_folder AS "storageFolder", id AS "organizationId"
      FROM organizations WHERE id = $1
    `,
    workspaces: `
      SELECT name, storage_folder AS "storageFolder", organization_id AS "organizationId"
      FROM workspaces WHERE id = $1
    `,
    lists: `
      SELECT l.name, l.storage_folder AS "storageFolder", w.organization_id AS "organizationId"
      FROM lists l
      INNER JOIN folders f ON f.id = l.folder_id
      INNER JOIN spaces s ON s.id = f.space_id
      INNER JOIN workspaces w ON w.id = s.workspace_id
      WHERE l.id = $1
    `,
  };

  const result = await postgres.query(queries[table], [id]);
  return result.rows[0] || null;
}

/** Agenda a reorganização sem processar agora (usado por scripts fora do servidor). */
async function queueStorageReconcile(organizationId) {
  if (!organizationId) {
    return;
  }

  await ensureStorageSchema();
  await postgres.query(
    `
      INSERT INTO storage_reconcile_queue (organization_id, requested_at)
      VALUES ($1, clock_timestamp())
      ON CONFLICT (organization_id) DO UPDATE SET requested_at = clock_timestamp()
    `,
    [organizationId],
  );
}

async function requestStorageReconcile(organizationId) {
  if (!organizationId) {
    return;
  }

  await queueStorageReconcile(organizationId);
  kickStorageWorker();
}

// Upload que terminou durante uma reorganização pode ter caído na pasta antiga.
async function requestReconcileIfBusy(organizationId) {
  if (!organizationId) {
    return;
  }

  try {
    const queued = await postgres.query(
      "SELECT 1 FROM storage_reconcile_queue WHERE organization_id = $1",
      [organizationId],
    );
    if (activeReconcileOrganizationId === organizationId || queued.rows.length > 0) {
      await requestStorageReconcile(organizationId);
    }
  } catch (error) {
    console.error("[storage] falha ao reagendar reorganização", error?.message || error);
  }
}

/**
 * Chamar depois de renomear empresa, workspace ou projeto. Atualiza o nome da
 * pasta e agenda a movimentação dos arquivos. Nunca lança erro.
 */
async function syncStorageFolderName(table, id) {
  if (!FOLDER_ENTITIES[table] || !id) {
    return false;
  }

  try {
    await ensureStorageSchema();
    const entity = await loadFolderEntity(table, id);
    if (!entity?.storageFolder) {
      // Pasta ainda não criada: nascerá com o nome atual no primeiro upload.
      return false;
    }

    const desiredFolder = buildFolderName(entity.name, id, FOLDER_ENTITIES[table]);
    if (desiredFolder === entity.storageFolder) {
      return false;
    }

    await postgres.query(`UPDATE ${table} SET storage_folder = $2 WHERE id = $1`, [
      id,
      desiredFolder,
    ]);
    await requestStorageReconcile(entity.organizationId);
    console.log("[storage] pasta renomeada", {
      table,
      id,
      from: entity.storageFolder,
      to: desiredFolder,
    });
    return true;
  } catch (error) {
    console.error("[storage] falha ao sincronizar nome de pasta", {
      table,
      id,
      message: error?.message || String(error),
    });
    return false;
  }
}

async function moveStorageFile(file, newPath) {
  const copied = await copyStorageObject(file.storagePath, newPath);
  if (!copied) {
    console.warn("[storage] arquivo não encontrado na Bunny ao mover", file.storagePath);
    return false;
  }

  const newUrl = buildPublicUrl(newPath);
  const client = await postgres.connect();
  try {
    await client.query("BEGIN");
    await replaceUrlReferences(client, file.url, newUrl);
    await client.query(
      "UPDATE storage_files SET storage_path = $2, url = $3 WHERE id = $1",
      [file.id, newPath, newUrl],
    );
    await client.query(
      `
        INSERT INTO storage_pending_deletes (storage_path, delete_after)
        VALUES ($1, NOW() + ($2 || ' minutes')::interval)
        ON CONFLICT (storage_path) DO UPDATE SET delete_after = EXCLUDED.delete_after
      `,
      [file.storagePath, String(OLD_OBJECT_GRACE_MINUTES)],
    );
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK");
    await deleteFromBunny(newPath);
    throw error;
  } finally {
    client.release();
  }
}

async function reconcileOrganizationStorage(organizationId) {
  const files = await postgres.query(
    `
      SELECT
        sf.id,
        sf.storage_path AS "storagePath",
        sf.url,
        sf.kind,
        o.name AS "organizationName",
        w.id AS "workspaceId",
        w.name AS "workspaceName",
        l.id AS "listId",
        l.name AS "listName"
      FROM storage_files sf
      INNER JOIN organizations o ON o.id = sf.organization_id
      LEFT JOIN tasks t ON t.id = sf.task_id
      LEFT JOIN lists l ON l.id = COALESCE(t.list_id, sf.list_id)
      LEFT JOIN folders f ON f.id = l.folder_id
      LEFT JOIN spaces s ON s.id = f.space_id
      LEFT JOIN workspaces w ON w.id = s.workspace_id
      WHERE sf.organization_id = $1 AND sf.deleted_at IS NULL
      ORDER BY sf.created_at ASC
    `,
    [organizationId],
  );

  const folderCache = new Map();
  const folderFor = async (table, id, name) => {
    const key = `${table}:${id}`;
    if (!folderCache.has(key)) {
      folderCache.set(key, await ensureEntityFolder(postgres, table, id, name));
    }
    return folderCache.get(key);
  };

  let movedCount = 0;
  for (const file of files.rows) {
    const organizationPath = `${ROOT_FOLDER}/${await folderFor(
      "organizations",
      organizationId,
      file.organizationName,
    )}`;

    let expectedFolder = null;
    if (file.kind === "avatar") {
      expectedFolder = `${organizationPath}/${ORGANIZATION_COMMON_FOLDERS.profiles}`;
    } else if (file.kind === "email_attachment") {
      expectedFolder = `${organizationPath}/${ORGANIZATION_COMMON_FOLDERS.emails}`;
    } else if (file.workspaceId && file.listId) {
      const workspaceFolder = await folderFor("workspaces", file.workspaceId, file.workspaceName);
      const listFolder = await folderFor("lists", file.listId, file.listName);
      expectedFolder = `${organizationPath}/${workspaceFolder}/${listFolder}`;
    }

    if (!expectedFolder || path.posix.dirname(file.storagePath) === expectedFolder) {
      continue;
    }

    const newPath = `${expectedFolder}/${path.posix.basename(file.storagePath)}`;
    if (await moveStorageFile(file, newPath)) {
      movedCount += 1;
    }
  }

  if (movedCount > 0) {
    console.log("[storage] arquivos reorganizados", { organizationId, movedCount });
    publishRealtimeEvent({
      type: "seed.refetch",
      organizationId,
      payload: { reason: "storage.moved" },
    });
  }
}

async function processReconcileQueue() {
  for (;;) {
    // requested_at::text preserva os microssegundos para a comparação do DELETE.
    const next = await postgres.query(`
      SELECT organization_id AS "organizationId", requested_at::text AS "requestedAt"
      FROM storage_reconcile_queue
      WHERE requested_at <= clock_timestamp()
      ORDER BY requested_at ASC
      LIMIT 1
    `);
    const job = next.rows[0];
    if (!job) {
      return;
    }

    activeReconcileOrganizationId = job.organizationId;
    try {
      await reconcileOrganizationStorage(job.organizationId);
      // Se houve novo pedido durante a execução, requested_at mudou e a linha fica.
      await postgres.query(
        "DELETE FROM storage_reconcile_queue WHERE organization_id = $1 AND requested_at::text = $2",
        [job.organizationId, job.requestedAt],
      );
    } catch (error) {
      console.error("[storage] falha ao reorganizar arquivos, nova tentativa em 10 min", {
        organizationId: job.organizationId,
        message: error?.message || String(error),
      });
      await postgres.query(
        `
          UPDATE storage_reconcile_queue
          SET requested_at = clock_timestamp() + INTERVAL '10 minutes'
          WHERE organization_id = $1
        `,
        [job.organizationId],
      );
    } finally {
      activeReconcileOrganizationId = null;
    }
  }
}

async function processPendingDeletes() {
  const due = await postgres.query(`
    SELECT storage_path AS "storagePath"
    FROM storage_pending_deletes
    WHERE delete_after <= NOW()
    ORDER BY delete_after ASC
    LIMIT 200
  `);

  for (const { storagePath } of due.rows) {
    const inUse = await postgres.query(
      "SELECT 1 FROM storage_files WHERE storage_path = $1 AND deleted_at IS NULL",
      [storagePath],
    );
    const referenced =
      inUse.rows.length > 0 ||
      (await countUrlReferences(postgres, buildPublicUrl(storagePath))) > 0;

    if (referenced || (await deleteFromBunny(storagePath))) {
      await postgres.query("DELETE FROM storage_pending_deletes WHERE storage_path = $1", [
        storagePath,
      ]);
    }
  }
}

function kickStorageWorker() {
  if (storageWorkerRunning) {
    storageWorkerRequested = true;
    return;
  }

  storageWorkerRunning = true;
  (async () => {
    try {
      do {
        storageWorkerRequested = false;
        await ensureStorageSchema();
        await processReconcileQueue();
        await processPendingDeletes();
      } while (storageWorkerRequested);
    } catch (error) {
      console.error("[storage] falha no processamento em segundo plano", error?.message || error);
    } finally {
      storageWorkerRunning = false;
    }
  })();
}

function startStorageWorker() {
  kickStorageWorker();
  const timer = setInterval(kickStorageWorker, STORAGE_WORKER_INTERVAL_MS);
  timer.unref?.();
}

function sendStorageError(req, res, error, fallbackMessage) {
  const isKnownError = error instanceof StorageError;
  if (!isKnownError) {
    console.error(`[storage] ${fallbackMessage}`, error);
  }

  // Descarta o restante do corpo para o navegador conseguir ler a resposta.
  if (!req.complete) {
    req.resume();
  }

  if (res.headersSent) {
    return;
  }

  if (!req.complete) {
    res.setHeader("Connection", "close");
  }

  res.status(isKnownError ? error.status : 500).json({
    message: isKnownError ? error.message : fallbackMessage,
    ...(isKnownError && error.code ? { code: error.code } : {}),
  });
}

/** Quantos arquivos o plano aceita em um envio só. */
async function assertFileCountAllowed({ organizationId, count }) {
  if (!organizationId || !Number.isFinite(count) || count <= 1) {
    return;
  }

  const { maxFilesPerUpload } = await getOrganizationUploadLimits(organizationId);

  if (maxFilesPerUpload !== -1 && count > maxFilesPerUpload) {
    throw new StorageError(
      413,
      `Seu plano permite enviar ${maxFilesPerUpload} arquivo(s) por vez. Envie em partes ou faça upgrade.`,
      { code: "PLAN_LIMIT_FILES_PER_UPLOAD" },
    );
  }
}

/** Tamanho somado dos anexos de uma mensagem do e-mail interno. */
async function assertEmailAttachmentsAllowed({ organizationId, urls }) {
  if (!organizationId || !Array.isArray(urls) || urls.length === 0) {
    return;
  }

  const { maxEmailAttachmentMb } = await getOrganizationUploadLimits(organizationId);

  if (maxEmailAttachmentMb === -1) {
    return;
  }

  if (maxEmailAttachmentMb === 0) {
    throw new StorageError(
      403,
      "O plano Grátis não envia anexos no e-mail interno. Faça upgrade para anexar arquivos.",
      { code: "PLAN_LIMIT_EMAIL_ATTACHMENT" },
    );
  }

  await ensureStorageSchema();
  const result = await postgres.query(
    `
      SELECT COALESCE(SUM(size_bytes), 0)::bigint AS total
      FROM storage_files
      WHERE organization_id = $1 AND url = ANY($2::text[]) AND deleted_at IS NULL
    `,
    [organizationId, urls],
  );

  const totalMb = Number(result.rows[0].total) / MB;

  if (totalMb > maxEmailAttachmentMb) {
    throw new StorageError(
      413,
      `Seu plano permite até ${maxEmailAttachmentMb} MB de anexos por mensagem. Envie menos arquivos ou faça upgrade.`,
      { code: "PLAN_LIMIT_EMAIL_ATTACHMENT" },
    );
  }
}

module.exports = {
  ROOT_FOLDER,
  ORGANIZATION_COMMON_FOLDERS,
  MAX_AVATAR_BYTES,
  BLOCKED_FILE_MESSAGE,
  StorageError,
  ensureStorageSchema,
  buildFolderName,
  sanitizeFileName,
  buildStoredFileName,
  createUploadGuard,
  isBlockedFileName,
  resolveOrganizationFolderPath,
  resolveTaskStorageContext,
  getOrganizationUploadLimits,
  getOrganizationStorageUsageBytes,
  assertUploadAllowed,
  assertFileCountAllowed,
  assertEmailAttachmentsAllowed,
  recordStorageFile,
  receiveUpload,
  uploadBufferToStorage,
  countUrlReferences,
  releaseStorageUrls,
  sendStorageError,
  copyStorageObject,
  replaceUrlReferences,
  syncStorageFolderName,
  queueStorageReconcile,
  requestStorageReconcile,
  startStorageWorker,
};
