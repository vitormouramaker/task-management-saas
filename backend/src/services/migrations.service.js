const { postgres } = require("../server/connect");

/**
 * Executa uma migração de dados uma única vez (registrada em app_migrations).
 * Seguro com vários processos: a inserção do nome trava a execução concorrente.
 */
async function runOnce(name, migrate) {
  await postgres.query(`
    CREATE TABLE IF NOT EXISTS app_migrations (
      name VARCHAR(150) PRIMARY KEY,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const client = await postgres.connect();
  try {
    await client.query("BEGIN");
    const inserted = await client.query(
      "INSERT INTO app_migrations (name) VALUES ($1) ON CONFLICT DO NOTHING RETURNING name",
      [name],
    );
    if (inserted.rows.length === 0) {
      await client.query("ROLLBACK");
      return false;
    }

    await migrate(client);
    await client.query("COMMIT");
    console.log(`[migracao] ${name} aplicada`);
    return true;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

// Cria/atualiza tabelas na inicialização para que nenhuma alteração de estrutura
// (que trava a tabela) aconteça no meio de uma requisição com transação aberta.
async function warmUpSchemas() {
  const { ensureAccountSchema } = require("./account.service");
  const { ensureStorageSchema } = require("./storage.service");
  const { ensureInvitationSchema } = require("./invitation.service");
  const { ensureJobTitleSchema } = require("./job-titles.service");
  const { ensureSessionSchema } = require("./session.service");
  const { ensureBillingSchema } = require("./billing.service");
  const { ensureTrialSchema } = require("./trial.service");
  const { ensureBillingNoticeSchema } = require("./billing-emails.service");
  const { ensureLegalSchema } = require("./legal.service");
  const { ensurePlatformAdminSchema } = require("./platform-admin.service");
  const { ensureTrashSchema } = require("./trash.service");
  const { ensureSupportSchema } = require("./support.service");
  const { ensureNfseSchema } = require("./nfse.service");
  const { ensureOnboardingSchema } = require("./onboarding.service");
  const { ensureReportsSchema } = require("./reports.service");
  const { ensureAutomationsSchema } = require("./automations.service");
  const { ensureRetentionSchema } = require("./retention.service");
  const { ensureConhecimentoSchema } = require("./conhecimento-connector.service");

  await ensureAccountSchema();
  await ensureStorageSchema();
  await ensureInvitationSchema();
  await ensureJobTitleSchema();
  await ensureSessionSchema();
  await ensureBillingSchema();
  await ensureTrialSchema();
  await ensureBillingNoticeSchema();
  await ensureLegalSchema();
  await ensurePlatformAdminSchema();
  await ensureTrashSchema();
  await ensureSupportSchema();
  await ensureNfseSchema();
  await ensureOnboardingSchema();
  await ensureReportsSchema();
  await ensureAutomationsSchema();
  await ensureRetentionSchema();
  await ensureConhecimentoSchema();
  // Estruturas que vivem dentro das rotas de workspaces.
  await require("../routes/workspaces.routes").ensureWorkspaceSchemas();
  await require("../routes/emails.routes").ensureSentEmailsSchema();
}

async function runStartupMigrations() {
  try {
    await warmUpSchemas();
    // Antes, admin era quem tinha cargo "ADM - ...". Agora vale o papel na conta:
    // quem já tinha esse cargo vira administrador das contas em que era membro.
    // As colunas de sessão nasceram sem fuso em produção. Os valores estão em UTC
    // (TimeZone do banco = Etc/UTC), então a conversão não desloca horário nenhum.
    // Catálogo novo de planos: os nomes antigos viram os nomes comerciais.
    // Contas que já existiam não veem a tela de boas-vindas; quem já estava em
    // teste mantém o período e fica marcado como já tendo usado.
    // Equipe do Pauta com acesso ao painel de super-administrador.
    // Lixeira: workspaces e projetos que já estavam apagados entram com o prazo
    // contando a partir de hoje, para ninguém perder nada de surpresa.
    // Tour e e-mails de dicas são só para quem chegar depois desta versão.
    await runOnce("2026-09-onboarding-contas-existentes", async (client) => {
      await client.query("UPDATE members SET tour_completed_at = CURRENT_TIMESTAMP WHERE tour_completed_at IS NULL");
      await client.query(`
        INSERT INTO onboarding_emails (member_id, kind)
        SELECT m.id, k.kind
        FROM members m
        CROSS JOIN (VALUES ('dica_dia_1'), ('dica_dia_3'), ('dica_dia_7')) AS k(kind)
        ON CONFLICT DO NOTHING
      `);
    });
    // Relatórios: cards que já estão numa coluna de conclusão passam a ter data
    // de conclusão (usamos a última atualização do card como aproximação).
    await runOnce("2026-09-relatorios-conclusao", async (client) => {
      await client.query(`
        UPDATE tasks t
        SET completed_at = COALESCE(t.updated_at, t.created_at)
        FROM status_definitions sd
        WHERE sd.id = t.status_id
          AND t.completed_at IS NULL
          AND sd.name ~* 'conclu|finaliz|feito|done|entregue'
      `);
    });
    await runOnce("2026-09-lixeira", async (client) => {
      await client.query(`
        INSERT INTO trash_items (id, organization_id, workspace_id, item_type, item_id, title, deleted_at)
        SELECT 'lix_' || md5(random()::text || w.id), w.organization_id, w.id, 'workspace', w.id, w.name, CURRENT_TIMESTAMP
        FROM workspaces w
        WHERE w.deleted_at IS NOT NULL AND w.organization_id IS NOT NULL
      `);
      await client.query(`
        INSERT INTO trash_items (id, organization_id, workspace_id, list_id, item_type, item_id, title, deleted_at)
        SELECT 'lix_' || md5(random()::text || l.id), w.organization_id, w.id, l.id, 'list', l.id, l.name, CURRENT_TIMESTAMP
        FROM lists l
        INNER JOIN folders f ON f.id = l.folder_id
        INNER JOIN spaces s ON s.id = f.space_id
        INNER JOIN workspaces w ON w.id = s.workspace_id
        WHERE l.deleted_at IS NOT NULL AND w.organization_id IS NOT NULL
      `);
    });
    // Super-administradores vindos do ambiente (PLATFORM_ADMIN_EMAILS). Roda a
    // cada subida: incluir alguém na lista basta, sem migração nova.
    const { PLATFORM_ADMIN_EMAILS } = require("./platform-admin.service");
    if (PLATFORM_ADMIN_EMAILS.length > 0) {
      await postgres.query(
        "UPDATE members SET is_platform_admin = TRUE WHERE lower(email) = ANY($1::text[])",
        [PLATFORM_ADMIN_EMAILS.map((email) => email.toLowerCase())],
      );
    }
    await runOnce("2026-09-boas-vindas-e-teste-opcional", async (client) => {
      // Contas criadas hoje ganharam o teste automático (comportamento antigo):
      // voltam para o Grátis e passam pela tela de boas-vindas.
      await client.query(`
        UPDATE organizations
        SET trial_ends_at = NULL,
            trial_started_at = NULL,
            onboarding_completed_at = NULL
        WHERE onboarding_completed_at IS NULL
          AND plan = 'free'
          AND trial_ends_at IS NOT NULL
          AND created_at >= CURRENT_DATE
      `);
      await client.query(`
        UPDATE organizations
        SET onboarding_completed_at = COALESCE(onboarding_completed_at, CURRENT_TIMESTAMP)
        WHERE onboarding_completed_at IS NULL
          AND created_at < CURRENT_DATE
      `);
      await client.query(`
        UPDATE organizations
        SET trial_started_at = COALESCE(trial_started_at, CURRENT_TIMESTAMP)
        WHERE trial_ends_at IS NOT NULL AND trial_started_at IS NULL
      `);
    });
    await runOnce("2026-09-catalogo-de-planos", async (client) => {
      await client.query("UPDATE organizations SET plan = 'essencial' WHERE plan = 'basic'");
      await client.query("UPDATE organizations SET plan = 'profissional' WHERE plan = 'business'");
      await client.query("UPDATE organizations SET plan = 'empresarial' WHERE plan = 'enterprise'");
      // Contas internas, sem cobrança, são marcadas por scripts/isentar-conta.js.
    });
    await runOnce("2026-09-sessoes-data-com-fuso", async (client) => {
      await client.query("SET LOCAL lock_timeout = '10s'");
      for (const coluna of ["created_at", "last_used_at", "expires_at", "revoked_at"]) {
        await client.query(
          `ALTER TABLE auth_sessions ALTER COLUMN ${coluna} TYPE TIMESTAMPTZ USING ${coluna} AT TIME ZONE 'UTC'`,
        );
      }
      await client.query(
        "ALTER TABLE members ALTER COLUMN tokens_valid_from TYPE TIMESTAMPTZ USING tokens_valid_from AT TIME ZONE 'UTC'",
      );
    });
    await runOnce("2026-09-papel-admin-a-partir-do-cargo-adm", async (client) => {
      await client.query(`
        UPDATE organization_members om
        SET role = 'admin'
        FROM members m
        WHERE m.id = om.member_id
          AND m.role LIKE 'ADM%'
          AND om.role = 'member'
          AND om.status = 'active'
      `);
    });
  } catch (error) {
    console.error("[migracao] falha ao aplicar migrações de inicialização", error?.message || error);
  }
}

module.exports = { runOnce, runStartupMigrations };
