const { postgres } = require("../server/connect");
const { AccountError } = require("./account.service");
const { createId } = require("./tenancy.service");

// Lista inicial de toda conta; o titular/administrador ajusta em Configurações > Cargos.
const DEFAULT_JOB_TITLES = [
  "Sócio(a) / Diretor(a)",
  "Gerente",
  "Coordenador(a)",
  "Supervisor(a)",
  "Analista",
  "Assistente",
  "Designer",
  "Desenvolvedor(a)",
  "Marketing",
  "Comercial / Vendas",
  "Financeiro",
  "Recursos Humanos",
  "Atendimento / Suporte",
  "Estagiário(a)",
  "Freelancer / Terceirizado(a)",
];

let schemaReady = null;

function ensureJobTitleSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      await postgres.query(`
        CREATE TABLE IF NOT EXISTS organization_job_titles (
          id VARCHAR(100) PRIMARY KEY,
          organization_id VARCHAR(100) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          name VARCHAR(80) NOT NULL,
          position INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await postgres.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS organization_job_titles_name_unique
        ON organization_job_titles (organization_id, lower(name))
      `);
      await postgres.query(
        "ALTER TABLE organizations ADD COLUMN IF NOT EXISTS job_titles_seeded_at TIMESTAMP",
      );
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

/**
 * Na primeira vez, cria a lista da conta com os cargos que a equipe já usa
 * mais a lista padrão. Depois disso a lista é só do titular/administradores.
 */
async function ensureOrganizationJobTitles(organizationId) {
  await ensureJobTitleSchema();
  const client = await postgres.connect();
  try {
    await client.query("BEGIN");
    const claimed = await client.query(
      `
        UPDATE organizations SET job_titles_seeded_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND job_titles_seeded_at IS NULL
        RETURNING id
      `,
      [organizationId],
    );

    if (claimed.rows.length > 0) {
      const inUse = await client.query(
        `
          SELECT DISTINCT btrim(m.role) AS name
          FROM organization_members om
          INNER JOIN members m ON m.id = om.member_id
          WHERE om.organization_id = $1
            AND om.status = 'active'
            AND m.role IS NOT NULL
            AND btrim(m.role) <> ''
          ORDER BY 1
        `,
        [organizationId],
      );

      const seen = new Set();
      let position = 0;
      for (const name of [...inUse.rows.map((row) => row.name), ...DEFAULT_JOB_TITLES]) {
        const key = name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        await client.query(
          `
            INSERT INTO organization_job_titles (id, organization_id, name, position)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT DO NOTHING
          `,
          [createId("title"), organizationId, name.slice(0, 80), position],
        );
        position += 1;
      }
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function listJobTitles(organizationId) {
  await ensureOrganizationJobTitles(organizationId);
  const result = await postgres.query(
    `
      SELECT
        t.id,
        t.name,
        (
          SELECT COUNT(*)::int
          FROM organization_members om
          INNER JOIN members m ON m.id = om.member_id
          WHERE om.organization_id = t.organization_id
            AND om.status = 'active'
            AND m.role = t.name
        ) AS "memberCount"
      FROM organization_job_titles t
      WHERE t.organization_id = $1
      ORDER BY t.position ASC, lower(t.name) ASC
    `,
    [organizationId],
  );
  return result.rows;
}

function normalizeJobTitleName(value) {
  const name = String(value || "").trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 80) {
    throw new AccountError(400, "O cargo deve ter entre 2 e 80 caracteres.", "name");
  }
  return name;
}

function translateDuplicate(error) {
  if (error?.code === "23505") {
    return new AccountError(409, "Já existe um cargo com esse nome.", "name");
  }
  return error;
}

async function createJobTitle(organizationId, value) {
  await ensureOrganizationJobTitles(organizationId);
  const name = normalizeJobTitleName(value);
  try {
    const result = await postgres.query(
      `
        INSERT INTO organization_job_titles (id, organization_id, name, position)
        VALUES (
          $1, $2::text, $3,
          (SELECT COALESCE(MAX(position), -1) + 1 FROM organization_job_titles WHERE organization_id = $2::text)
        )
        RETURNING id, name
      `,
      [createId("title"), organizationId, name],
    );
    return { ...result.rows[0], memberCount: 0 };
  } catch (error) {
    throw translateDuplicate(error);
  }
}

/** Renomeia o cargo e atualiza quem já está com ele nesta conta. */
async function renameJobTitle(organizationId, jobTitleId, value) {
  const name = normalizeJobTitleName(value);
  const client = await postgres.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query(
      "SELECT name FROM organization_job_titles WHERE id = $1 AND organization_id = $2 FOR UPDATE",
      [jobTitleId, organizationId],
    );
    if (!current.rows[0]) {
      throw new AccountError(404, "Cargo não encontrado.");
    }

    await client.query("UPDATE organization_job_titles SET name = $2 WHERE id = $1", [
      jobTitleId,
      name,
    ]);
    const updatedMembers = await client.query(
      `
        UPDATE members m SET role = $2, updated_at = CURRENT_TIMESTAMP
        FROM organization_members om
        WHERE om.member_id = m.id
          AND om.organization_id = $3
          AND om.status = 'active'
          AND m.role = $1
      `,
      [current.rows[0].name, name, organizationId],
    );
    await client.query("COMMIT");
    return { id: jobTitleId, name, updatedMembers: updatedMembers.rowCount };
  } catch (error) {
    await client.query("ROLLBACK");
    throw translateDuplicate(error);
  } finally {
    client.release();
  }
}

async function deleteJobTitle(organizationId, jobTitleId) {
  const result = await postgres.query(
    "DELETE FROM organization_job_titles WHERE id = $1 AND organization_id = $2 RETURNING id",
    [jobTitleId, organizationId],
  );
  if (!result.rows[0]) {
    throw new AccountError(404, "Cargo não encontrado.");
  }
}

/**
 * Garante que o cargo informado está na lista da conta. Vazio = sem cargo.
 * O cargo atual da pessoa é aceito mesmo fora da lista (dados antigos).
 */
async function assertJobTitleAllowed(organizationId, value, { currentValue = null } = {}) {
  const name = String(value || "").trim();
  if (!name) {
    return null;
  }
  if (currentValue && name === currentValue) {
    return name;
  }

  await ensureOrganizationJobTitles(organizationId);
  const result = await postgres.query(
    "SELECT name FROM organization_job_titles WHERE organization_id = $1 AND name = $2",
    [organizationId, name],
  );
  if (!result.rows[0]) {
    throw new AccountError(400, "Escolha um cargo da lista de cargos da conta.", "role");
  }
  return result.rows[0].name;
}

module.exports = {
  DEFAULT_JOB_TITLES,
  ensureJobTitleSchema,
  listJobTitles,
  createJobTitle,
  renameJobTitle,
  deleteJobTitle,
  assertJobTitleAllowed,
};
