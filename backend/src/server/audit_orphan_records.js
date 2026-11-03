// Lista workspaces e etiquetas sem empresa vinculada. Antes, o login vinculava
// esses registros automaticamente à organização da empresa; agora isso só é feito aqui,
// de forma explícita.
//
// Simulação:  node src/server/audit_orphan_records.js
// Vincular:   node src/server/audit_orphan_records.js --assign-to=<organizationId> --apply
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });

const { postgres } = require("./connect");

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const assignArg = args.find((arg) => arg.startsWith("--assign-to="));
const targetOrganizationId = assignArg ? assignArg.split("=").slice(1).join("=") : null;

async function audit() {
  const workspaces = await postgres.query(
    "SELECT id, name, owner_id AS \"ownerId\" FROM workspaces WHERE organization_id IS NULL ORDER BY created_at",
  );
  const tags = await postgres.query(
    "SELECT id, name FROM tags WHERE organization_id IS NULL ORDER BY name",
  );

  console.log(`Workspaces sem empresa: ${workspaces.rows.length}`);
  workspaces.rows.forEach((row) => console.log("  ", row.id, "-", row.name));
  console.log(`Etiquetas sem empresa: ${tags.rows.length}`);
  tags.rows.forEach((row) => console.log("  ", row.id, "-", row.name));

  if (!targetOrganizationId) {
    return;
  }

  const organization = await postgres.query(
    "SELECT id, name FROM organizations WHERE id = $1",
    [targetOrganizationId],
  );
  if (!organization.rows[0]) {
    throw new Error(`Empresa ${targetOrganizationId} não encontrada.`);
  }

  if (!APPLY) {
    console.log(
      `SIMULAÇÃO: os registros acima seriam vinculados a "${organization.rows[0].name}". Use --apply para executar.`,
    );
    return;
  }

  const client = await postgres.connect();
  try {
    await client.query("BEGIN");
    const updatedWorkspaces = await client.query(
      "UPDATE workspaces SET organization_id = $1 WHERE organization_id IS NULL",
      [targetOrganizationId],
    );
    const updatedTags = await client.query(
      "UPDATE tags SET organization_id = $1 WHERE organization_id IS NULL",
      [targetOrganizationId],
    );
    await client.query("COMMIT");
    console.log(
      `Vinculados a "${organization.rows[0].name}": ${updatedWorkspaces.rowCount} workspaces e ${updatedTags.rowCount} etiquetas.`,
    );
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

audit()
  .catch((error) => {
    console.error("Falha na auditoria de registros sem empresa:", error);
    process.exitCode = 1;
  })
  .finally(() => postgres.end());
