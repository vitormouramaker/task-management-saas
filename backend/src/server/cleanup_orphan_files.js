// Remove da Bunny arquivos enviados há mais de 24h que nunca foram vinculados
// a nenhum card, comentário, e-mail ou perfil (ex.: anexo descartado antes de publicar).
//
// Simulação:  node src/server/cleanup_orphan_files.js
// Executar:   node src/server/cleanup_orphan_files.js --apply
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });

const { postgres } = require("./connect");
const {
  countUrlReferences,
  ensureStorageSchema,
  releaseStorageUrls,
} = require("../services/storage.service");

const APPLY = process.argv.includes("--apply");
const MIN_AGE_HOURS = 24;

async function cleanup() {
  await ensureStorageSchema();
  const result = await postgres.query(
    `
      SELECT url, storage_path AS "storagePath", size_bytes AS "sizeBytes"
      FROM storage_files
      WHERE deleted_at IS NULL
        AND created_at < NOW() - ($1 || ' hours')::interval
    `,
    [String(MIN_AGE_HOURS)],
  );

  const orphans = [];
  for (const file of result.rows) {
    if ((await countUrlReferences(postgres, file.url)) === 0) {
      orphans.push(file);
    }
  }

  const totalBytes = orphans.reduce((sum, file) => sum + Number(file.sizeBytes || 0), 0);
  console.log(
    `${APPLY ? "Removendo" : "SIMULAÇÃO:"} ${orphans.length} arquivos órfãos (${(totalBytes / 1024 / 1024).toFixed(1)} MB).`,
  );
  orphans.slice(0, 30).forEach((file) => console.log("  ", file.storagePath));

  if (APPLY) {
    await releaseStorageUrls(orphans.map((file) => file.url));
  }
}

cleanup()
  .catch((error) => {
    console.error("Falha na limpeza de arquivos órfãos:", error);
    process.exitCode = 1;
  })
  .finally(() => postgres.end());
