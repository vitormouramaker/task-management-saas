// Move os arquivos antigos da Bunny (pastas "anexos" e "avatares") para a
// estrutura Pauta/<empresa>/<workspace>/<projeto> e atualiza os links no banco.
//
// Simulação (não altera nada):   node src/server/migrate_storage_structure.js
// Executar a cópia:              node src/server/migrate_storage_structure.js --apply
// Apagar os arquivos antigos:    node src/server/migrate_storage_structure.js --delete-old=<log.json> --apply
// Apagar sem o log:              node src/server/migrate_storage_structure.js --delete-legacy [--apply]
//
// Os arquivos antigos só são apagados no terceiro passo, depois de validar o app.
// --delete-legacy lista "anexos/" e "avatares/" direto na Bunny e só apaga o que não é
// mais referenciado no banco e já existe na estrutura nova (vale mesmo se as pastas
// foram renomeadas depois da migração).
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });

const fs = require("fs");
const path = require("path");
const { postgres } = require("./connect");
const {
  buildPublicUrl,
  deleteFromBunny,
  extractStoragePathFromUrl,
  listBunnyDirectory,
} = require("../services/bunny.service");
const {
  ROOT_FOLDER,
  ORGANIZATION_COMMON_FOLDERS,
  copyStorageObject,
  countUrlReferences,
  replaceUrlReferences,
  ensureStorageSchema,
  recordStorageFile,
  resolveOrganizationFolderPath,
  resolveTaskStorageContext,
  queueStorageReconcile,
} = require("../services/storage.service");

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const deleteOldArg = args.find((arg) => arg.startsWith("--delete-old="));

const MEMBER_ORGANIZATION_SQL = `
  COALESCE(
    m.active_organization_id,
    (
      SELECT om.organization_id
      FROM organization_members om
      WHERE om.member_id = m.id AND om.status = 'active'
      ORDER BY CASE om.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END
      LIMIT 1
    )
  )
`;

async function hasTable(tableName) {
  const result = await postgres.query(
    "SELECT to_regclass($1) IS NOT NULL AS exists",
    [`public.${tableName}`],
  );
  return Boolean(result.rows[0]?.exists);
}

async function collectReferences(hasSentEmails) {
  const references = [];

  const attachments = await postgres.query(`
    SELECT url, name, size, task_id AS "taskId", uploaded_by AS "uploadedBy"
    FROM task_attachments
    WHERE url IS NOT NULL AND url <> ''
  `);
  attachments.rows.forEach((row) =>
    references.push({ ...row, kind: "task_attachment" }),
  );

  const comments = await postgres.query(`
    SELECT
      attachment_url AS url,
      attachment_name AS name,
      attachment_size AS size,
      task_id AS "taskId",
      COALESCE(to_jsonb(tc)->>'author_id', to_jsonb(tc)->>'user_id') AS "uploadedBy"
    FROM task_comments tc
    WHERE attachment_url IS NOT NULL AND attachment_url <> ''
  `);
  comments.rows.forEach((row) =>
    references.push({ ...row, kind: "comment_attachment" }),
  );

  const avatars = await postgres.query(`
    SELECT m.avatar_url AS url, m.id AS "uploadedBy", ${MEMBER_ORGANIZATION_SQL} AS "organizationId"
    FROM members m
    WHERE m.avatar_url IS NOT NULL AND m.avatar_url <> ''
  `);
  avatars.rows.forEach((row) => references.push({ ...row, kind: "avatar" }));

  if (hasSentEmails) {
    const emails = await postgres.query(`
      SELECT DISTINCT
        attachment_url AS url,
        e.sender_id AS "uploadedBy",
        ${MEMBER_ORGANIZATION_SQL} AS "organizationId"
      FROM sent_emails e
      CROSS JOIN LATERAL unnest(e.attachments) AS attachment_url
      LEFT JOIN members m ON m.id = e.sender_id
      WHERE e.attachments IS NOT NULL
    `);
    emails.rows.forEach((row) =>
      references.push({ ...row, kind: "email_attachment" }),
    );
  }

  return references;
}

async function resolveTarget(reference) {
  const options = { persist: APPLY };

  if (reference.taskId) {
    return resolveTaskStorageContext(postgres, reference.taskId, null, options);
  }

  if (!reference.organizationId) {
    throw new Error("usuário sem empresa vinculada");
  }

  const organizationPath = await resolveOrganizationFolderPath(
    postgres,
    reference.organizationId,
    options,
  );
  const commonFolder =
    reference.kind === "avatar"
      ? ORGANIZATION_COMMON_FOLDERS.profiles
      : ORGANIZATION_COMMON_FOLDERS.emails;

  return {
    organizationId: reference.organizationId,
    folderPath: `${organizationPath}/${commonFolder}`,
  };
}

async function buildMigrationPlan(references) {
  const plan = new Map();
  const skipped = [];

  for (const reference of references) {
    const oldPath = extractStoragePathFromUrl(reference.url);
    if (!oldPath || oldPath.startsWith(`${ROOT_FOLDER}/`)) {
      continue;
    }

    const existing = plan.get(oldPath);
    if (existing) {
      existing.oldUrls.add(reference.url);
      continue;
    }

    try {
      const target = await resolveTarget(reference);
      plan.set(oldPath, {
        oldPath,
        newPath: `${target.folderPath}/${path.posix.basename(oldPath)}`,
        oldUrls: new Set([reference.url]),
        kind: reference.kind,
        name: reference.name || path.posix.basename(oldPath),
        uploadedBy: reference.uploadedBy || null,
        organizationId: target.organizationId,
        workspaceId: target.workspaceId || null,
        listId: target.listId || null,
        taskId: target.taskId || null,
      });
    } catch (error) {
      skipped.push({ url: reference.url, kind: reference.kind, reason: error.message });
    }
  }

  return { plan, skipped };
}

async function updateReferences(entry, newUrl, copied) {
  const client = await postgres.connect();
  try {
    await client.query("BEGIN");
    for (const oldUrl of entry.oldUrls) {
      await replaceUrlReferences(client, oldUrl, newUrl);
    }

    await recordStorageFile(client, {
      organizationId: entry.organizationId,
      workspaceId: entry.workspaceId,
      listId: entry.listId,
      taskId: entry.taskId,
      uploadedBy: entry.uploadedBy,
      kind: entry.kind,
      storagePath: entry.newPath,
      url: newUrl,
      originalName: entry.name,
      contentType: copied.contentType,
      sizeBytes: copied.sizeBytes,
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function serializeEntry(entry) {
  return {
    oldPath: entry.oldPath,
    newPath: entry.newPath,
    oldUrls: Array.from(entry.oldUrls),
    kind: entry.kind,
  };
}

async function migrate() {
  console.log(
    APPLY
      ? "MODO APLICAR: arquivos serão copiados e os links atualizados."
      : "SIMULAÇÃO: nada será alterado (exceto preparar colunas/tabela de armazenamento). Use --apply para executar.",
  );

  await ensureStorageSchema();
  const hasSentEmails = await hasTable("sent_emails");
  const references = await collectReferences(hasSentEmails);
  const { plan, skipped } = await buildMigrationPlan(references);

  const countByKind = {};
  plan.forEach((entry) => {
    countByKind[entry.kind] = (countByKind[entry.kind] || 0) + 1;
  });

  console.log(`Referências encontradas: ${references.length}`);
  console.log(`Arquivos a migrar: ${plan.size}`, countByKind);
  console.log(`Ignorados: ${skipped.length}`);
  skipped.slice(0, 20).forEach((item) => console.log("  ignorado:", item));
  Array.from(plan.values())
    .slice(0, 20)
    .forEach((entry) => console.log(`  ${entry.oldPath}  ->  ${entry.newPath}`));

  if (!APPLY || plan.size === 0) {
    return;
  }

  const logFile = path.resolve(
    process.cwd(),
    `storage-migration-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
  );
  const results = [];

  for (const entry of plan.values()) {
    try {
      const copied = await copyStorageObject(entry.oldPath, entry.newPath);
      if (!copied) {
        results.push({ ...serializeEntry(entry), status: "missing" });
      } else {
        const newUrl = buildPublicUrl(entry.newPath);
        await updateReferences(entry, newUrl, copied);
        results.push({
          ...serializeEntry(entry),
          newUrl,
          sizeBytes: copied.sizeBytes,
          status: "migrated",
        });
      }
    } catch (error) {
      results.push({ ...serializeEntry(entry), status: "error", error: error.message });
    }

    fs.writeFileSync(logFile, JSON.stringify(results, null, 2));
  }

  // Renomeações feitas durante a migração não enxergam as linhas gravadas depois:
  // o servidor reorganiza as empresas afetadas na próxima rodada em segundo plano.
  const organizationIds = new Set(
    Array.from(plan.values())
      .map((entry) => entry.organizationId)
      .filter(Boolean),
  );
  for (const organizationId of organizationIds) {
    await queueStorageReconcile(organizationId);
  }

  const summary = results.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {});
  console.log("Resultado:", summary);
  console.log(`Log salvo em ${logFile}`);
  console.log(
    `Os arquivos antigos foram mantidos. Depois de validar o app, rode:\n  node src/server/migrate_storage_structure.js --delete-old=${logFile} --apply`,
  );
}

async function deleteOldFiles(logFile) {
  const entries = JSON.parse(fs.readFileSync(logFile, "utf8")).filter(
    (entry) => entry.status === "migrated",
  );
  console.log(
    APPLY
      ? `Apagando arquivos antigos de ${entries.length} migrações.`
      : `SIMULAÇÃO: ${entries.length} arquivos antigos seriam avaliados. Use --apply para apagar.`,
  );

  let deleted = 0;
  let kept = 0;
  for (const entry of entries) {
    const newStillReferenced = (await countUrlReferences(postgres, entry.newUrl)) > 0;
    let oldStillReferenced = false;
    for (const oldUrl of entry.oldUrls) {
      if ((await countUrlReferences(postgres, oldUrl)) > 0) {
        oldStillReferenced = true;
      }
    }

    if (!newStillReferenced || oldStillReferenced) {
      kept += 1;
      console.log("  mantido (referências não conferem):", entry.oldPath);
      continue;
    }

    if (APPLY && (await deleteFromBunny(entry.oldPath))) {
      deleted += 1;
    }
  }

  console.log(`Apagados: ${deleted} | Mantidos: ${kept}`);
}

const LEGACY_FOLDERS = ["anexos", "avatares"];

function escapeLike(value) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

async function deleteLegacyFiles() {
  await ensureStorageSchema();
  console.log(
    APPLY
      ? "Apagando arquivos das pastas antigas que já foram migrados."
      : "SIMULAÇÃO: nada será apagado. Use --apply para executar.",
  );

  const totals = { apagados: 0, seriamApagados: 0, aindaReferenciados: 0, semCopiaNova: 0, falhas: 0 };

  for (const folder of LEGACY_FOLDERS) {
    const entries = (await listBunnyDirectory(folder)).filter((entry) => !entry.IsDirectory);
    console.log(`Pasta ${folder}/: ${entries.length} arquivos`);

    for (const entry of entries) {
      const oldPath = `${folder}/${entry.ObjectName}`;

      if ((await countUrlReferences(postgres, buildPublicUrl(oldPath))) > 0) {
        totals.aindaReferenciados += 1;
        continue;
      }

      const migrated = await postgres.query(
        `
          SELECT 1 FROM storage_files
          WHERE deleted_at IS NULL AND storage_path LIKE $1 ESCAPE '\\'
          LIMIT 1
        `,
        [`${ROOT_FOLDER}/%/${escapeLike(entry.ObjectName)}`],
      );
      if (migrated.rows.length === 0) {
        totals.semCopiaNova += 1;
        continue;
      }

      if (!APPLY) {
        totals.seriamApagados += 1;
      } else if (await deleteFromBunny(oldPath)) {
        totals.apagados += 1;
      } else {
        totals.falhas += 1;
      }
    }
  }

  console.log("Resultado:", totals);
  if (totals.semCopiaNova > 0) {
    console.log(
      "Arquivos sem cópia na estrutura nova foram mantidos (nunca estiveram vinculados a nada no banco).",
    );
  }
}

const run = process.argv.includes("--delete-legacy")
  ? deleteLegacyFiles()
  : deleteOldArg
    ? deleteOldFiles(deleteOldArg.split("=").slice(1).join("="))
    : migrate();

run
  .catch((error) => {
    console.error("Falha na migração de armazenamento:", error);
    process.exitCode = 1;
  })
  .finally(() => postgres.end());
