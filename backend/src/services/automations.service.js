const crypto = require("crypto");
const { postgres } = require("../server/connect");

/**
 * Automações do projeto.
 *
 * Uma automação é "quando acontecer X, faça Y" dentro de um projeto. Há dois
 * tipos de gatilho:
 *  - de ação: disparam na hora em que alguém mexe no card (criar, mudar de
 *    coluna, atribuir responsável, mudar prioridade);
 *  - de prazo: um worker passa de hora em hora e dispara o que depende de data
 *    (vence em N dias, venceu há N dias, parado na coluna há N dias).
 *
 * O que a automação faz não dispara outra automação: evita laço infinito.
 */

const TRIGGERS = {
  card_criado: { agendado: false, label: "Quando um card for criado" },
  card_mudou_coluna: { agendado: false, label: "Quando um card entrar numa coluna" },
  card_recebeu_responsavel: { agendado: false, label: "Quando alguém for colocado como responsável" },
  card_mudou_prioridade: { agendado: false, label: "Quando a prioridade mudar" },
  prazo_proximo: { agendado: true, label: "Quando o prazo estiver chegando" },
  prazo_vencido: { agendado: true, label: "Quando o prazo passar" },
  parado_na_coluna: { agendado: true, label: "Quando o card ficar parado na coluna" },
};

const ACTIONS = {
  mover_para_coluna: "Mover para outra coluna",
  definir_responsavel: "Colocar responsável",
  mudar_prioridade: "Mudar a prioridade",
  definir_prazo: "Definir o prazo",
  adicionar_etiqueta: "Adicionar etiqueta",
  comentar: "Escrever um comentário",
  notificar: "Avisar alguém",
};

const PRIORIDADES = ["urgent", "high", "medium", "low"];
const WORKER_INTERVAL_MS = 60 * 60 * 1000;
const MAX_POR_EXECUCAO = 200;

let schemaReady = null;

function ensureAutomationsSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      await postgres.query(`
        CREATE TABLE IF NOT EXISTS automations (
          id VARCHAR(100) PRIMARY KEY,
          organization_id VARCHAR(100) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          list_id VARCHAR(100) NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
          name VARCHAR(160) NOT NULL,
          enabled BOOLEAN NOT NULL DEFAULT TRUE,
          trigger_type VARCHAR(40) NOT NULL,
          trigger_config JSONB NOT NULL DEFAULT '{}'::jsonb,
          actions JSONB NOT NULL DEFAULT '[]'::jsonb,
          created_by VARCHAR(100),
          runs_count INTEGER NOT NULL DEFAULT 0,
          last_run_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await postgres.query(
        "CREATE INDEX IF NOT EXISTS automations_list_idx ON automations (list_id, enabled)",
      );
      // Cada automação roda uma vez por card e por ocasião (ex.: por dia).
      await postgres.query(`
        CREATE TABLE IF NOT EXISTS automation_runs (
          automation_id VARCHAR(100) NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
          task_id VARCHAR(100) NOT NULL,
          run_key VARCHAR(60) NOT NULL,
          ran_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (automation_id, task_id, run_key)
        )
      `);
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

class AutomationError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function novoId() {
  return `aut_${crypto.randomBytes(8).toString("hex")}`;
}

// ---------------------------------------------------------------------------
// Validação
// ---------------------------------------------------------------------------
function validarAutomacao({ name, triggerType, triggerConfig = {}, actions = [] }) {
  const nome = String(name || "").trim().slice(0, 160);
  if (nome.length < 3) {
    throw new AutomationError(400, "Dê um nome com pelo menos 3 letras para a automação.");
  }
  if (!TRIGGERS[triggerType]) {
    throw new AutomationError(400, "Escolha quando a automação deve acontecer.");
  }
  if (!Array.isArray(actions) || actions.length === 0) {
    throw new AutomationError(400, "Escolha pelo menos uma ação para a automação fazer.");
  }
  if (actions.length > 5) {
    throw new AutomationError(400, "Uma automação pode ter até 5 ações.");
  }

  const config = { ...triggerConfig };
  if (triggerType === "card_mudou_coluna" && !config.statusId) {
    throw new AutomationError(400, "Escolha a coluna que dispara a automação.");
  }
  if (triggerType === "card_mudou_prioridade" && !PRIORIDADES.includes(config.priority)) {
    throw new AutomationError(400, "Escolha a prioridade que dispara a automação.");
  }
  if (["prazo_proximo", "prazo_vencido", "parado_na_coluna"].includes(triggerType)) {
    const dias = Number(config.days);
    if (!Number.isFinite(dias) || dias < 0 || dias > 90) {
      throw new AutomationError(400, "Informe de quantos dias a automação deve olhar (de 0 a 90).");
    }
    config.days = Math.round(dias);
  }

  const acoes = actions.map((acao) => {
    const tipo = acao?.type;
    if (!ACTIONS[tipo]) {
      throw new AutomationError(400, "Escolha o que a automação deve fazer.");
    }

    if (tipo === "mover_para_coluna" && !acao.statusId) {
      throw new AutomationError(400, "Escolha a coluna para onde o card deve ir.");
    }
    if (tipo === "definir_responsavel" && !(acao.memberIds || []).length) {
      throw new AutomationError(400, "Escolha quem deve virar responsável.");
    }
    if (tipo === "mudar_prioridade" && !PRIORIDADES.includes(acao.priority)) {
      throw new AutomationError(400, "Escolha a prioridade que a automação vai aplicar.");
    }
    if (tipo === "definir_prazo") {
      const dias = Number(acao.days);
      if (!Number.isFinite(dias) || dias < 0 || dias > 365) {
        throw new AutomationError(400, "Informe em quantos dias cai o prazo (de 0 a 365).");
      }
      acao.days = Math.round(dias);
    }
    if (tipo === "adicionar_etiqueta" && !acao.tagId) {
      throw new AutomationError(400, "Escolha a etiqueta que será colocada no card.");
    }
    if (tipo === "comentar" && String(acao.text || "").trim().length < 2) {
      throw new AutomationError(400, "Escreva o comentário que a automação vai deixar.");
    }
    if (tipo === "notificar") {
      const alvo = acao.target || "responsaveis";
      if (!["responsaveis", "pessoas"].includes(alvo)) {
        throw new AutomationError(400, "Escolha quem deve ser avisado.");
      }
      if (alvo === "pessoas" && !(acao.memberIds || []).length) {
        throw new AutomationError(400, "Escolha quem deve ser avisado.");
      }
      acao.target = alvo;
    }

    return acao;
  });

  return { name: nome, triggerType, triggerConfig: config, actions: acoes };
}

// ---------------------------------------------------------------------------
// Cadastro
// ---------------------------------------------------------------------------
function serializar(row) {
  return {
    id: row.id,
    listId: row.list_id,
    listName: row.list_name,
    name: row.name,
    enabled: row.enabled,
    triggerType: row.trigger_type,
    triggerConfig: row.trigger_config || {},
    actions: row.actions || [],
    runsCount: row.runs_count,
    lastRunAt: row.last_run_at,
    createdAt: row.created_at,
  };
}

async function listAutomations(organizationId, { listId } = {}) {
  await ensureAutomationsSchema();
  const params = [organizationId];
  let filtro = "";
  if (listId) {
    params.push(listId);
    filtro = "AND a.list_id = $2";
  }

  const result = await postgres.query(
    `
      SELECT a.*, l.name AS list_name
      FROM automations a
      INNER JOIN lists l ON l.id = a.list_id
      WHERE a.organization_id = $1 AND l.deleted_at IS NULL ${filtro}
      ORDER BY l.name, a.created_at
    `,
    params,
  );
  return result.rows.map(serializar);
}

async function assertListDaConta(organizationId, listId) {
  const result = await postgres.query(
    `
      SELECT l.id
      FROM lists l
      INNER JOIN folders f ON f.id = l.folder_id
      INNER JOIN spaces s ON s.id = f.space_id
      INNER JOIN workspaces w ON w.id = s.workspace_id
      WHERE l.id = $1 AND w.organization_id = $2 AND l.deleted_at IS NULL AND w.deleted_at IS NULL
    `,
    [listId, organizationId],
  );
  if (!result.rows[0]) {
    throw new AutomationError(404, "Projeto não encontrado.");
  }
}

async function createAutomation(organizationId, memberId, body) {
  await ensureAutomationsSchema();
  if (!body?.listId) throw new AutomationError(400, "Escolha o projeto da automação.");
  await assertListDaConta(organizationId, body.listId);

  const quantas = await postgres.query(
    "SELECT COUNT(*)::int AS total FROM automations WHERE list_id = $1",
    [body.listId],
  );
  if (quantas.rows[0].total >= 20) {
    throw new AutomationError(409, "Este projeto já tem 20 automações. Apague uma para criar outra.");
  }

  const dados = validarAutomacao(body);
  const id = novoId();
  await postgres.query(
    `
      INSERT INTO automations (id, organization_id, list_id, name, enabled, trigger_type, trigger_config, actions, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9)
    `,
    [
      id,
      organizationId,
      body.listId,
      dados.name,
      body.enabled !== false,
      dados.triggerType,
      JSON.stringify(dados.triggerConfig),
      JSON.stringify(dados.actions),
      memberId,
    ],
  );

  const criada = await postgres.query(
    "SELECT a.*, l.name AS list_name FROM automations a INNER JOIN lists l ON l.id = a.list_id WHERE a.id = $1",
    [id],
  );
  return serializar(criada.rows[0]);
}

async function updateAutomation(organizationId, id, body) {
  await ensureAutomationsSchema();
  const atual = await postgres.query(
    "SELECT * FROM automations WHERE id = $1 AND organization_id = $2",
    [id, organizationId],
  );
  if (!atual.rows[0]) throw new AutomationError(404, "Automação não encontrada.");

  // Só ligar/desligar não precisa de todo o resto.
  if (Object.keys(body || {}).length === 1 && body.enabled !== undefined) {
    await postgres.query(
      "UPDATE automations SET enabled = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1",
      [id, Boolean(body.enabled)],
    );
  } else {
    const dados = validarAutomacao({
      name: body.name ?? atual.rows[0].name,
      triggerType: body.triggerType ?? atual.rows[0].trigger_type,
      triggerConfig: body.triggerConfig ?? atual.rows[0].trigger_config,
      actions: body.actions ?? atual.rows[0].actions,
    });
    await postgres.query(
      `
        UPDATE automations
        SET name = $2, enabled = $3, trigger_type = $4, trigger_config = $5::jsonb,
            actions = $6::jsonb, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `,
      [
        id,
        dados.name,
        body.enabled !== undefined ? Boolean(body.enabled) : atual.rows[0].enabled,
        dados.triggerType,
        JSON.stringify(dados.triggerConfig),
        JSON.stringify(dados.actions),
      ],
    );
  }

  const nova = await postgres.query(
    "SELECT a.*, l.name AS list_name FROM automations a INNER JOIN lists l ON l.id = a.list_id WHERE a.id = $1",
    [id],
  );
  return serializar(nova.rows[0]);
}

async function deleteAutomation(organizationId, id) {
  await ensureAutomationsSchema();
  const result = await postgres.query(
    "DELETE FROM automations WHERE id = $1 AND organization_id = $2 RETURNING id",
    [id, organizationId],
  );
  if (!result.rows[0]) throw new AutomationError(404, "Automação não encontrada.");
}

// ---------------------------------------------------------------------------
// Execução
// ---------------------------------------------------------------------------
async function registrarAtividade(db, taskId, description) {
  await db.query(
    "INSERT INTO task_activities (id, task_id, author_id, type, description, date) VALUES ($1, $2, NULL, 'system', $3, $4)",
    [`act_${crypto.randomBytes(8).toString("hex")}`, taskId, description, new Date().toISOString()],
  );
}

function proximoPrazo(dias) {
  const data = new Date();
  data.setHours(23, 59, 0, 0);
  data.setDate(data.getDate() + dias);
  return data.toISOString();
}

/**
 * Avisa quem está com o projeto aberto que a automação mexeu no card, para
 * o quadro se atualizar sem recarregar a página.
 */
async function avisarQuadro(task, automacao) {
  try {
    const { publishRealtimeEvent } = require("./realtime.service");
    const contexto = await postgres.query(
      `
        SELECT w.id AS workspace_id, w.organization_id
        FROM lists l
        INNER JOIN folders f ON f.id = l.folder_id
        INNER JOIN spaces s ON s.id = f.space_id
        INNER JOIN workspaces w ON w.id = s.workspace_id
        WHERE l.id = $1
      `,
      [task.list_id],
    );
    const dados = contexto.rows[0];
    if (!dados) return;

    publishRealtimeEvent({
      type: "seed.refetch",
      actorId: null,
      organizationId: dados.organization_id,
      workspaceId: dados.workspace_id,
      payload: { reason: `automacao:${automacao.name}` },
    });
  } catch (error) {
    console.error("[automacoes] falha ao avisar o quadro", error?.message || error);
  }
}

/** Executa as ações de uma automação sobre um card. */
async function aplicarAcoes(db, automacao, task) {
  const {
    dispatchStoredNotifications,
    storeNotifications,
  } = require("./notification-dispatcher.service");
  const feitas = [];
  const notificacoes = [];

  let savepoint = 0;
  for (const acao of automacao.actions || []) {
    // Cada ação em seu próprio savepoint: uma que falhe (etiqueta apagada,
    // coluna que não existe mais) não derruba as outras nem a transação.
    const marca = `aut_${(savepoint += 1)}`;
    await db.query(`SAVEPOINT ${marca}`);
    try {
      if (acao.type === "mover_para_coluna") {
        if (task.status_id === acao.statusId) continue;
        const { recordStatusChange } = require("./reports.service");
        await db.query("UPDATE tasks SET status_id = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1", [task.id, acao.statusId]);
        await recordStatusChange(db, {
          taskId: task.id,
          fromStatusId: task.status_id,
          toStatusId: acao.statusId,
          actorId: null,
        });
        feitas.push("moveu de coluna");
      } else if (acao.type === "definir_responsavel") {
        for (const memberId of acao.memberIds || []) {
          await db.query(
            "INSERT INTO task_assignees (task_id, member_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
            [task.id, memberId],
          );
        }
        feitas.push("definiu responsável");
      } else if (acao.type === "mudar_prioridade") {
        await db.query("UPDATE tasks SET priority = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1", [task.id, acao.priority]);
        feitas.push("mudou a prioridade");
      } else if (acao.type === "definir_prazo") {
        await db.query("UPDATE tasks SET due_date = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1", [task.id, proximoPrazo(acao.days)]);
        feitas.push("definiu o prazo");
      } else if (acao.type === "adicionar_etiqueta") {
        await db.query("INSERT INTO task_tags (task_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [task.id, acao.tagId]);
        feitas.push("colocou etiqueta");
      } else if (acao.type === "comentar") {
        await db.query(
          "INSERT INTO task_comments (id, task_id, author_id, content) VALUES ($1, $2, NULL, $3)",
          [`com_${crypto.randomBytes(8).toString("hex")}`, task.id, String(acao.text).slice(0, 2000)],
        );
        feitas.push("comentou");
      } else if (acao.type === "notificar") {
        const destinos =
          acao.target === "pessoas"
            ? acao.memberIds || []
            : (
                await db.query("SELECT member_id FROM task_assignees WHERE task_id = $1", [task.id])
              ).rows.map((row) => row.member_id);

        for (const memberId of [...new Set(destinos)].filter(Boolean)) {
          notificacoes.push({
            userId: memberId,
            title: "Automação do projeto",
            message: String(acao.message || `A automação "${automacao.name}" mexeu no card ${task.title}.`).slice(0, 400),
            type: "AUTOMATION",
            referenceId: task.id,
            createdBy: null,
            url: `/?taskId=${encodeURIComponent(task.id)}`,
          });
        }
        feitas.push("avisou a equipe");
      }
      await db.query(`RELEASE SAVEPOINT ${marca}`);
    } catch (error) {
      await db.query(`ROLLBACK TO SAVEPOINT ${marca}`).catch(() => undefined);
      console.error(`[automacoes] falha na ação ${acao.type} da automação ${automacao.id}:`, error?.message || error);
    }
  }

  if (notificacoes.length) {
    // Gravar não basta: sem despachar, o aviso só apareceria quando a pessoa
    // recarregasse a página.
    const guardadas = await storeNotifications(db, notificacoes).catch((error) => {
      console.error("[automacoes] falha ao avisar", error?.message || error);
      return [];
    });
    await dispatchStoredNotifications({
      actorId: null,
      notifications: guardadas,
      reason: "automation",
    }).catch((error) => console.error("[automacoes] falha ao despachar o aviso", error?.message || error));
  }

  if (feitas.length) {
    await registrarAtividade(db, task.id, `automação "${automacao.name}": ${feitas.join(", ")}.`);
    await avisarQuadro(task, automacao);
    await postgres.query(
      "UPDATE automations SET runs_count = runs_count + 1, last_run_at = CURRENT_TIMESTAMP WHERE id = $1",
      [automacao.id],
    );
  }

  return feitas;
}

function gatilhoCombina(automacao, evento, dados) {
  const config = automacao.trigger_config || {};

  if (automacao.trigger_type !== evento) return false;
  if (evento === "card_mudou_coluna") return config.statusId === dados.toStatusId;
  if (evento === "card_mudou_prioridade") return config.priority === dados.priority;
  if (evento === "card_recebeu_responsavel") {
    return !config.memberId || (dados.memberIds || []).includes(config.memberId);
  }
  return true;
}

/**
 * Chamado pelas rotas depois de uma mudança feita por uma pessoa.
 * Mudanças feitas por automação não entram aqui (evita laço).
 */
async function runForEvent(db, { event, taskId, listId, dados = {} }) {
  try {
    await ensureAutomationsSchema();

    const automacoes = await db.query(
      "SELECT * FROM automations WHERE list_id = $1 AND enabled = TRUE AND trigger_type = $2",
      [listId, event],
    );
    if (automacoes.rows.length === 0) return [];

    const task = (await db.query("SELECT * FROM tasks WHERE id = $1", [taskId])).rows[0];
    if (!task) return [];

    const executadas = [];
    for (const automacao of automacoes.rows) {
      if (!gatilhoCombina(automacao, event, dados)) continue;
      const feitas = await aplicarAcoes(db, automacao, task);
      if (feitas.length) executadas.push(automacao.name);
    }
    return executadas;
  } catch (error) {
    console.error("[automacoes] falha ao rodar no evento", event, error?.message || error);
    return [];
  }
}

/** Cards que o gatilho de prazo alcança hoje. */
function consultaDoGatilho(automacao) {
  const dias = Number(automacao.trigger_config?.days ?? 0);

  if (automacao.trigger_type === "prazo_proximo") {
    return {
      sql: `
        SELECT * FROM tasks
        WHERE list_id = $1 AND completed_at IS NULL AND due_date IS NOT NULL
          AND due_date::date = (CURRENT_DATE + ($2 || ' days')::interval)::date
      `,
      params: [automacao.list_id, String(dias)],
      chave: () => `prazo-${new Date().toISOString().slice(0, 10)}`,
    };
  }

  if (automacao.trigger_type === "prazo_vencido") {
    return {
      sql: `
        SELECT * FROM tasks
        WHERE list_id = $1 AND completed_at IS NULL AND due_date IS NOT NULL
          AND due_date::date = (CURRENT_DATE - ($2 || ' days')::interval)::date
      `,
      params: [automacao.list_id, String(dias)],
      chave: () => `vencido-${new Date().toISOString().slice(0, 10)}`,
    };
  }

  // parado_na_coluna
  const statusId = automacao.trigger_config?.statusId || null;
  return {
    sql: `
      SELECT t.* FROM tasks t
      WHERE t.list_id = $1 AND t.completed_at IS NULL
        AND ($3::text IS NULL OR t.status_id = $3::text)
        AND COALESCE(
          (SELECT MAX(tr.changed_at) FROM task_status_transitions tr WHERE tr.task_id = t.id),
          t.created_at
        ) < NOW() - ($2 || ' days')::interval
    `,
    params: [automacao.list_id, String(dias), statusId],
    chave: () => `parado-${new Date().toISOString().slice(0, 10)}`,
  };
}

async function runScheduledAutomations() {
  await ensureAutomationsSchema();

  const automacoes = await postgres.query(`
    SELECT a.* FROM automations a
    INNER JOIN lists l ON l.id = a.list_id
    INNER JOIN folders f ON f.id = l.folder_id
    INNER JOIN spaces s ON s.id = f.space_id
    INNER JOIN workspaces w ON w.id = s.workspace_id
    INNER JOIN organizations o ON o.id = a.organization_id
    WHERE a.enabled = TRUE
      AND a.trigger_type IN ('prazo_proximo', 'prazo_vencido', 'parado_na_coluna')
      AND l.deleted_at IS NULL AND w.deleted_at IS NULL
  `);

  const { resolveOrganizationBilling } = require("./billing.service");
  let total = 0;

  for (const automacao of automacoes.rows) {
    try {
      const conta = await postgres.query("SELECT * FROM organizations WHERE id = $1", [automacao.organization_id]);
      if (!resolveOrganizationBilling(conta.rows[0] || {}).entitlements?.automations) continue;

      const { sql, params, chave } = consultaDoGatilho(automacao);
      const cards = await postgres.query(`${sql} LIMIT ${MAX_POR_EXECUCAO}`, params);
      const runKey = chave();

      for (const task of cards.rows) {
        const marcou = await postgres.query(
          "INSERT INTO automation_runs (automation_id, task_id, run_key) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING task_id",
          [automacao.id, task.id, runKey],
        );
        if (!marcou.rows[0]) continue;

        // Uma transação por card: as ações usam savepoints lá dentro.
        const client = await postgres.connect();
        try {
          await client.query("BEGIN");
          const feitas = await aplicarAcoes(client, automacao, task);
          await client.query("COMMIT");
          if (feitas.length) total += 1;
        } catch (error) {
          await client.query("ROLLBACK").catch(() => undefined);
          console.error(`[automacoes] falha no card ${task.id}:`, error?.message || error);
        } finally {
          client.release();
        }
      }
    } catch (error) {
      console.error(`[automacoes] falha na automação ${automacao.id}:`, error?.message || error);
    }
  }

  if (total) console.log(`[automacoes] ${total} card(s) tratados por prazo.`);
  return total;
}

function startAutomationsWorker() {
  const run = () =>
    runScheduledAutomations().catch((error) =>
      console.error("[automacoes] falha geral", error?.message || error),
    );
  setTimeout(run, 2 * 60 * 1000).unref?.();
  setInterval(run, WORKER_INTERVAL_MS).unref?.();
}

module.exports = {
  ACTIONS,
  AutomationError,
  TRIGGERS,
  createAutomation,
  deleteAutomation,
  ensureAutomationsSchema,
  listAutomations,
  runForEvent,
  runScheduledAutomations,
  startAutomationsWorker,
  updateAutomation,
};
