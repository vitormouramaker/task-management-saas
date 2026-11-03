const crypto = require("crypto");
const { postgres } = require("../server/connect");

/**
 * Registro de erros da plataforma, para o painel de super-admin.
 *
 * Erros iguais viram um grupo só, com contador e primeira/última vez. Cada
 * grupo guarda as ocorrências mais recentes (quem estava na tela, em qual
 * endereço), e as antigas são descartadas para a tabela não crescer sem fim.
 */

const EVENTOS_POR_GRUPO = Number(process.env.ERROS_EVENTOS_POR_GRUPO || 20);
const DIAS_PARA_GUARDAR = Number(process.env.ERROS_DIAS_PARA_GUARDAR || 90);
const PAGE_SIZE = 20;

let schemaReady = null;

function ensureTelemetrySchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      await postgres.query(`
        CREATE TABLE IF NOT EXISTS app_error_groups (
          id VARCHAR(100) PRIMARY KEY,
          fingerprint VARCHAR(64) NOT NULL UNIQUE,
          origem VARCHAR(10) NOT NULL,
          tipo VARCHAR(120),
          mensagem TEXT NOT NULL,
          local TEXT,
          primeira_vez TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          ultima_vez TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          ocorrencias INTEGER NOT NULL DEFAULT 0,
          contas_afetadas INTEGER NOT NULL DEFAULT 0,
          resolvido_em TIMESTAMPTZ,
          resolvido_por VARCHAR(100)
        )
      `);
      await postgres.query(`
        CREATE TABLE IF NOT EXISTS app_error_events (
          id VARCHAR(100) PRIMARY KEY,
          group_id VARCHAR(100) NOT NULL REFERENCES app_error_groups(id) ON DELETE CASCADE,
          ocorrido_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          organization_id VARCHAR(100),
          member_id VARCHAR(100),
          url TEXT,
          user_agent TEXT,
          versao VARCHAR(60),
          pilha TEXT,
          extra JSONB
        )
      `);
      await postgres.query(
        "CREATE INDEX IF NOT EXISTS app_error_events_group_idx ON app_error_events (group_id, ocorrido_em DESC)",
      );
      await postgres.query(
        "CREATE INDEX IF NOT EXISTS app_error_groups_ultima_idx ON app_error_groups (ultima_vez DESC)",
      );
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

function criarId(prefixo) {
  return `${prefixo}_${crypto.randomBytes(8).toString("hex")}`;
}

function limitar(valor, tamanho) {
  const texto = valor === null || valor === undefined ? "" : String(valor);
  return texto.length > tamanho ? texto.slice(0, tamanho) : texto;
}

/**
 * Tira da mensagem o que muda de um caso para o outro (ids, números, aspas),
 * para que o mesmo defeito não vire dez grupos diferentes.
 */
function normalizarMensagem(mensagem) {
  return limitar(mensagem, 500)
    .replace(/["'`][^"'`]{8,}["'`]/g, "<valor>")
    .replace(/\b[0-9a-f]{8,}\b/gi, "<id>")
    .replace(/\b\d{2,}\b/g, "<n>")
    .trim()
    .toLowerCase();
}

/** Primeira linha útil da pilha: diz onde o erro aconteceu. */
function extrairLocal(pilha) {
  const linhas = String(pilha || "").split("\n");
  for (const linha of linhas.slice(1)) {
    const limpa = linha.trim();
    if (limpa.startsWith("at ")) return limitar(limpa.replace(/^at\s+/, ""), 300);
  }
  return null;
}

/** Guarda um erro novo, agrupando com os iguais. */
async function registrarErro(dados) {
  await ensureTelemetrySchema();

  const origem = dados.origem === "front" ? "front" : "back";
  const mensagem = limitar(dados.mensagem || "Erro sem mensagem", 1000);
  const tipo = limitar(dados.tipo || "", 120) || null;
  const pilha = limitar(dados.pilha || "", 8000) || null;
  const local = limitar(dados.local || extrairLocal(pilha) || "", 300) || null;

  const fingerprint = crypto
    .createHash("sha256")
    .update(`${origem}|${tipo || ""}|${normalizarMensagem(mensagem)}|${local || ""}`)
    .digest("hex")
    .slice(0, 64);

  const grupo = await postgres.query(
    `
      INSERT INTO app_error_groups (id, fingerprint, origem, tipo, mensagem, local, ocorrencias)
      VALUES ($1, $2, $3, $4, $5, $6, 1)
      ON CONFLICT (fingerprint) DO UPDATE
        SET ocorrencias = app_error_groups.ocorrencias + 1,
            ultima_vez = NOW(),
            -- Um erro que volta depois de resolvido precisa reaparecer na lista.
            resolvido_em = NULL,
            resolvido_por = NULL
      RETURNING id
    `,
    [criarId("errg"), fingerprint, origem, tipo, mensagem, local],
  );

  const groupId = grupo.rows[0].id;

  await postgres.query(
    `
      INSERT INTO app_error_events (
        id, group_id, organization_id, member_id, url, user_agent, versao, pilha, extra
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `,
    [
      criarId("erre"),
      groupId,
      limitar(dados.organizationId || "", 100) || null,
      limitar(dados.memberId || "", 100) || null,
      limitar(dados.url || "", 500) || null,
      limitar(dados.userAgent || "", 400) || null,
      limitar(dados.versao || "", 60) || null,
      pilha,
      dados.extra && typeof dados.extra === "object" ? JSON.stringify(dados.extra).slice(0, 4000) : null,
    ],
  );

  // Mantém só as ocorrências recentes de cada grupo.
  await postgres.query(
    `
      DELETE FROM app_error_events
      WHERE group_id = $1
        AND id NOT IN (
          SELECT id FROM app_error_events
          WHERE group_id = $1
          ORDER BY ocorrido_em DESC
          LIMIT $2
        )
    `,
    [groupId, EVENTOS_POR_GRUPO],
  );

  await postgres.query(
    `
      UPDATE app_error_groups
      SET contas_afetadas = (
        SELECT COUNT(DISTINCT organization_id) FROM app_error_events
        WHERE group_id = $1 AND organization_id IS NOT NULL
      )
      WHERE id = $1
    `,
    [groupId],
  );

  return { groupId };
}

/** Lista os grupos para a tela do painel. */
async function listarGrupos({ status = "abertos", origem = "", busca = "", page = 1 } = {}) {
  await ensureTelemetrySchema();

  const filtros = [];
  const valores = [];

  if (status === "abertos") filtros.push("resolvido_em IS NULL");
  if (status === "resolvidos") filtros.push("resolvido_em IS NOT NULL");
  if (origem === "front" || origem === "back") {
    valores.push(origem);
    filtros.push(`origem = $${valores.length}`);
  }
  if (busca) {
    valores.push(`%${busca.toLowerCase()}%`);
    filtros.push(`(lower(mensagem) LIKE $${valores.length} OR lower(COALESCE(local, '')) LIKE $${valores.length})`);
  }

  const onde = filtros.length ? `WHERE ${filtros.join(" AND ")}` : "";
  const pagina = Math.max(1, Number(page) || 1);

  const total = await postgres.query(`SELECT COUNT(*)::int AS total FROM app_error_groups ${onde}`, valores);
  const { rows } = await postgres.query(
    `
      SELECT id, origem, tipo, mensagem, local, primeira_vez, ultima_vez,
             ocorrencias, contas_afetadas, resolvido_em
      FROM app_error_groups
      ${onde}
      ORDER BY ultima_vez DESC
      LIMIT ${PAGE_SIZE} OFFSET ${(pagina - 1) * PAGE_SIZE}
    `,
    valores,
  );

  const resumo = await postgres.query(`
    SELECT
      COUNT(*) FILTER (WHERE resolvido_em IS NULL)::int AS abertos,
      COUNT(*) FILTER (WHERE resolvido_em IS NULL AND ultima_vez > NOW() - INTERVAL '24 hours')::int AS ultimas24h,
      COALESCE(SUM(ocorrencias) FILTER (WHERE resolvido_em IS NULL), 0)::int AS ocorrencias
    FROM app_error_groups
  `);

  return {
    errors: rows.map(serializarGrupo),
    page: pagina,
    pageSize: PAGE_SIZE,
    total: total.rows[0].total,
    summary: resumo.rows[0],
  };
}

function serializarGrupo(row) {
  return {
    id: row.id,
    origem: row.origem,
    tipo: row.tipo,
    mensagem: row.mensagem,
    local: row.local,
    primeiraVez: row.primeira_vez,
    ultimaVez: row.ultima_vez,
    ocorrencias: row.ocorrencias,
    contasAfetadas: row.contas_afetadas,
    resolvidoEm: row.resolvido_em || null,
  };
}

/** Um grupo com as últimas ocorrências, para a tela de detalhe. */
async function detalharGrupo(groupId) {
  await ensureTelemetrySchema();

  const grupo = await postgres.query(
    `
      SELECT id, origem, tipo, mensagem, local, primeira_vez, ultima_vez,
             ocorrencias, contas_afetadas, resolvido_em
      FROM app_error_groups WHERE id = $1
    `,
    [groupId],
  );
  if (grupo.rows.length === 0) return null;

  const eventos = await postgres.query(
    `
      SELECT e.id, e.ocorrido_em, e.url, e.user_agent, e.versao, e.pilha, e.extra,
             o.name AS organizacao, m.name AS pessoa
      FROM app_error_events e
      LEFT JOIN organizations o ON o.id = e.organization_id
      LEFT JOIN members m ON m.id = e.member_id
      WHERE e.group_id = $1
      ORDER BY e.ocorrido_em DESC
      LIMIT $2
    `,
    [groupId, EVENTOS_POR_GRUPO],
  );

  return {
    ...serializarGrupo(grupo.rows[0]),
    events: eventos.rows.map((row) => ({
      id: row.id,
      ocorridoEm: row.ocorrido_em,
      url: row.url,
      userAgent: row.user_agent,
      versao: row.versao,
      pilha: row.pilha,
      extra: row.extra,
      organizacao: row.organizacao,
      pessoa: row.pessoa,
    })),
  };
}

async function marcarResolvido(groupId, { resolvido, adminId }) {
  await ensureTelemetrySchema();
  const { rowCount } = await postgres.query(
    `
      UPDATE app_error_groups
      SET resolvido_em = CASE WHEN $2 THEN NOW() ELSE NULL END,
          resolvido_por = CASE WHEN $2 THEN $3 ELSE NULL END
      WHERE id = $1
    `,
    [groupId, Boolean(resolvido), adminId || null],
  );
  return rowCount > 0;
}

/** Limpeza diária: grupos velhos e já resolvidos saem da lista. */
async function limparErrosAntigos() {
  await ensureTelemetrySchema();
  const { rowCount } = await postgres.query(
    `DELETE FROM app_error_groups WHERE ultima_vez < NOW() - ($1::int * INTERVAL '1 day')`,
    [DIAS_PARA_GUARDAR],
  );
  if (rowCount > 0) console.log(`[erros] ${rowCount} grupo(s) antigo(s) removido(s)`);
  return rowCount;
}

function startTelemetryCleanupWorker() {
  const umDia = 24 * 60 * 60 * 1000;
  setTimeout(() => {
    limparErrosAntigos().catch((erro) => console.error("[erros] limpeza falhou", erro?.message));
    setInterval(
      () => limparErrosAntigos().catch((erro) => console.error("[erros] limpeza falhou", erro?.message)),
      umDia,
    );
  }, 60 * 1000).unref?.();
}

module.exports = {
  detalharGrupo,
  ensureTelemetrySchema,
  limparErrosAntigos,
  listarGrupos,
  marcarResolvido,
  registrarErro,
  startTelemetryCleanupWorker,
};
