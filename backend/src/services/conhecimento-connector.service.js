/**
 * Conector do Hub de Conhecimento (Protocolo de Conectores, contrato 1.1).
 *
 * - O titular ou um admin gera um link de conexão; o token vai no fragmento (#)
 *   e só o hash fica guardado. Um link novo revoga o anterior.
 * - O Hub de Conhecimento lê só cards PÚBLICOS de projetos e workspaces públicos da própria
 *   organização (nada de privado, "Privado ADM", dados de membros ou cobrança).
 * - Cards apagados deixam um registro de exclusão (o delete é físico).
 * - Mudanças viram eventos assinados (HMAC-SHA256) para o endereço que o
 *   Hub de Conhecimento registrou; o evento não leva conteúdo, o Hub de Conhecimento busca pela API.
 */
const crypto = require("crypto");
const dns = require("dns").promises;
const net = require("net");
const axios = require("axios");
const { postgres } = require("../server/connect");

const CONTRACT_VERSION = "1.2";
const TOKEN_PREFIX = "hck_";
const TOKEN_TTL_DAYS = 365;
const PAGE_SIZE = 50;
const MAX_CONTENT_CHARS = 1_900_000;
const ITEM_TYPE = "tarefa";
const OVERVIEW_TYPE = "visao_geral";
const OVERVIEW_ID = "visao-geral";
const OVERVIEW_FULL_ID = "visao-geral-completa";
const ESCOPOS = new Set(["publico", "tudo"]);

class ConhecimentoError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

let schemaPromise = null;

function ensureConhecimentoSchema() {
  if (!schemaPromise) {
    schemaPromise = postgres
      .query(`
        CREATE TABLE IF NOT EXISTS conhecimento_integracoes (
          id VARCHAR(100) PRIMARY KEY,
          organization_id VARCHAR(100) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          token_hash CHAR(64) NOT NULL UNIQUE,
          created_by VARCHAR(100) REFERENCES members(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          expires_at TIMESTAMPTZ NOT NULL,
          revoked_at TIMESTAMPTZ,
          last_used_at TIMESTAMPTZ,
          webhook_url TEXT,
          webhook_secret_enc TEXT,
          webhook_registered_at TIMESTAMPTZ
        );
        CREATE INDEX IF NOT EXISTS conhecimento_integracoes_ativas
          ON conhecimento_integracoes (organization_id) WHERE revoked_at IS NULL;
        CREATE TABLE IF NOT EXISTS conhecimento_exclusoes (
          organization_id VARCHAR(100) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          task_id VARCHAR(100) NOT NULL,
          deleted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (organization_id, task_id)
        );
        CREATE INDEX IF NOT EXISTS conhecimento_exclusoes_data
          ON conhecimento_exclusoes (organization_id, deleted_at, task_id);
        -- 'publico': só cards públicos; 'tudo': também privados e "Privado ADM" (contrato 1.2).
        ALTER TABLE conhecimento_integracoes ADD COLUMN IF NOT EXISTS escopo VARCHAR(20) NOT NULL DEFAULT 'publico';
      `)
      .catch((error) => {
        schemaPromise = null;
        throw error;
      });
  }
  return schemaPromise;
}

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

// ---------- segredo do webhook (cifrado; chave derivada do JWT_SECRET) ----------

function webhookKey() {
  const base = process.env.JWT_SECRET;
  if (!base) throw new Error("JWT_SECRET ausente");
  return Buffer.from(crypto.hkdfSync("sha256", base, "pauta", "conhecimento-webhook-v1", 32));
}

function seal(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", webhookKey(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
}

function unseal(sealed) {
  const raw = Buffer.from(sealed, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", webhookKey(), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}

// ---------- link de conexão (tela de Configurações) ----------

function publicApiOrigin(req) {
  const configured = (process.env.PUBLIC_API_URL || "").trim().replace(/\/+$/, "");
  return configured || `${req.protocol}://${req.get("host")}`;
}

async function statusDaIntegracao(organizationId) {
  await ensureConhecimentoSchema();
  const { rows } = await postgres.query(
    `
      SELECT i.created_at, i.expires_at, i.last_used_at, i.webhook_registered_at, i.escopo, m.name AS created_by_name
      FROM conhecimento_integracoes i
      LEFT JOIN members m ON m.id = i.created_by
      WHERE i.organization_id = $1 AND i.revoked_at IS NULL AND i.expires_at > now()
      ORDER BY i.created_at DESC
      LIMIT 1
    `,
    [organizationId],
  );
  const row = rows[0];
  if (!row) return { conectado: false };
  return {
    conectado: true,
    criadoEm: row.created_at,
    expiraEm: row.expires_at,
    ultimoUso: row.last_used_at,
    tempoReal: Boolean(row.webhook_registered_at),
    incluiPrivados: row.escopo === "tudo",
    criadoPor: row.created_by_name || null,
  };
}

/** Gera um link novo (o anterior deixa de valer). O token só aparece aqui, uma vez. */
async function gerarLink({ organizationId, memberId, req, incluirPrivados = false }) {
  await ensureConhecimentoSchema();
  const escopo = incluirPrivados ? "tudo" : "publico";
  const token = `${TOKEN_PREFIX}${crypto.randomBytes(32).toString("base64url")}`;
  const client = await postgres.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "UPDATE conhecimento_integracoes SET revoked_at = now() WHERE organization_id = $1 AND revoked_at IS NULL",
      [organizationId],
    );
    const { rows } = await client.query(
      `
        INSERT INTO conhecimento_integracoes (id, organization_id, token_hash, created_by, expires_at, escopo)
        VALUES ($1, $2, $3, $4, now() + make_interval(days => $5), $6)
        RETURNING expires_at
      `,
      [`cbr_${crypto.randomBytes(8).toString("hex")}`, organizationId, sha256(token), memberId, TOKEN_TTL_DAYS, escopo],
    );
    await client.query("COMMIT");
    return {
      link: `${publicApiOrigin(req)}/api/conhecimento/v1#${token}`,
      expiraEm: rows[0].expires_at,
      incluiPrivados: escopo === "tudo",
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function revogar(organizationId) {
  await ensureConhecimentoSchema();
  const { rowCount } = await postgres.query(
    `UPDATE conhecimento_integracoes SET revoked_at = now(), webhook_url = NULL, webhook_secret_enc = NULL
     WHERE organization_id = $1 AND revoked_at IS NULL`,
    [organizationId],
  );
  return rowCount;
}

// ---------- autenticação do Hub de Conhecimento (token do link) ----------

async function autenticarIntegracao(req, res, next) {
  try {
    await ensureConhecimentoSchema();
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!token.startsWith(TOKEN_PREFIX) || token.length > 200) {
      return res.status(401).json({ message: "Token de integração inválido." });
    }
    const { rows } = await postgres.query(
      `
        SELECT i.id, i.organization_id, i.last_used_at, i.escopo, o.name AS organization_name
        FROM conhecimento_integracoes i
        INNER JOIN organizations o ON o.id = i.organization_id
        WHERE i.token_hash = $1 AND i.revoked_at IS NULL AND i.expires_at > now()
      `,
      [sha256(token)],
    );
    const row = rows[0];
    if (!row) return res.status(401).json({ message: "Token de integração inválido, expirado ou revogado." });
    // A organização vem SEMPRE do token, nunca de parâmetro.
    req.conhecimento = {
      integrationId: row.id,
      organizationId: row.organization_id,
      organizationName: row.organization_name,
      escopo: ESCOPOS.has(row.escopo) ? row.escopo : "publico",
    };
    if (!row.last_used_at || Date.now() - new Date(row.last_used_at).getTime() > 5 * 60_000) {
      postgres
        .query("UPDATE conhecimento_integracoes SET last_used_at = now() WHERE id = $1", [row.id])
        .catch(() => {});
    }
    return next();
  } catch (error) {
    console.error("[conhecimento] falha ao autenticar integração", error);
    return res.status(500).json({ message: "Erro interno." });
  }
}

// ---------- conteúdo dos cards ----------

const ENTIDADES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };

/** HTML da descrição/comentários → texto simples com quebras (sem tags). */
function htmlParaTexto(html) {
  if (!html) return "";
  return String(html)
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "\n- ")
    .replace(/<\s*\/\s*(p|div|h[1-6]|li|ul|ol|blockquote|pre|tr)\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTIDADES[m])
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const PRIORIDADES = { low: "baixa", medium: "média", high: "alta", urgent: "urgente" };
const dataBr = (value) => (value ? new Date(value).toLocaleDateString("pt-BR", { timeZone: "UTC" }) : null);

function sourceUrl(listId, taskId) {
  const origin = (process.env.FRONTEND_URL || "").trim().replace(/\/+$/, "");
  if (!origin || !listId) return null;
  return `${origin}/projeto/${encodeURIComponent(listId)}?card=${encodeURIComponent(taskId)}`;
}

// Card visível a toda a organização: card, projeto e workspace públicos e vivos.
// Datas sem fuso no Pauta estão em UTC; "atualizado" inclui comentários e
// checklists e é truncado em milissegundos para o cursor ser exato.
const BASE_SQL = `
  SELECT t.id, t.title, t.description, t.priority, t.due_date, t.completed_at, t.list_id,
         w.name AS workspace_name, l.name AS list_name, sd.name AS status_name,
         (COALESCE(t.visibility, 'public') = 'public' AND w.visibility = 'public' AND COALESCE(l.visibility, 'public') = 'public'
          AND l.deleted_at IS NULL) AS publico,
         date_trunc('milliseconds', GREATEST(
           t.updated_at, t.created_at,
           (SELECT max(GREATEST(c.created_at, c.updated_at)) FROM task_comments c WHERE c.task_id = t.id),
           (SELECT max(ch.created_at) FROM checklists ch WHERE ch.task_id = t.id),
           (SELECT max(ci.created_at) FROM checklist_items ci
              INNER JOIN checklists ch ON ch.id = ci.checklist_id WHERE ch.task_id = t.id)
         )) AT TIME ZONE 'UTC' AS atualizado
  FROM tasks t
  INNER JOIN workspaces w ON w.id = t.workspace_id
  LEFT JOIN lists l ON l.id = t.list_id
  LEFT JOIN status_definitions sd ON sd.id = t.status_id
  WHERE w.organization_id = $1 AND w.deleted_at IS NULL
`;

async function montarConteudo(rows) {
  if (!rows.length) return new Map();
  const ids = rows.map((r) => r.id);
  const [checklists, comentarios] = await Promise.all([
    postgres.query(
      `
        SELECT ch.task_id, ch.id, ch.name, ci.label, ci.done
        FROM checklists ch
        LEFT JOIN checklist_items ci ON ci.checklist_id = ch.id
        WHERE ch.task_id = ANY($1::varchar[])
        ORDER BY ch.created_at, ch.id, ci.created_at, ci.id
      `,
      [ids],
    ),
    postgres.query(
      `
        SELECT c.task_id, c.content, c.created_at, m.name AS autor
        FROM task_comments c
        LEFT JOIN members m ON m.id = c.author_id
        WHERE c.task_id = ANY($1::varchar[])
        ORDER BY c.created_at, c.id
      `,
      [ids],
    ),
  ]);
  const porCard = new Map(ids.map((id) => [id, { checklists: new Map(), comentarios: [] }]));
  for (const row of checklists.rows) {
    const lista = porCard.get(row.task_id).checklists;
    if (!lista.has(row.id)) lista.set(row.id, { nome: row.name, itens: [] });
    if (row.label) lista.get(row.id).itens.push(`- [${row.done ? "x" : " "}] ${row.label}`);
  }
  for (const row of comentarios.rows) {
    const texto = htmlParaTexto(row.content);
    if (texto) porCard.get(row.task_id).comentarios.push(`**${row.autor || "Alguém"}** (${dataBr(row.created_at)}): ${texto}`);
  }

  const out = new Map();
  for (const r of rows) {
    const extra = porCard.get(r.id);
    const meta = [
      r.status_name && `Status: ${r.status_name}`,
      r.priority && `Prioridade: ${PRIORIDADES[r.priority] || r.priority}`,
      r.due_date && `Prazo: ${dataBr(r.due_date)}`,
      r.completed_at && `Concluído em ${dataBr(r.completed_at)}`,
    ].filter(Boolean);
    const partes = [
      `# ${r.title}`,
      [`Workspace: ${r.workspace_name}`, r.list_name && `Projeto: ${r.list_name}`].filter(Boolean).join(" · "),
      meta.join(" · "),
      htmlParaTexto(r.description),
      ...[...extra.checklists.values()].map((c) => `## Checklist: ${c.nome}\n${c.itens.join("\n")}`),
      extra.comentarios.length ? `## Comentários\n${extra.comentarios.join("\n")}` : "",
    ].filter(Boolean);
    out.set(r.id, partes.join("\n\n").slice(0, MAX_CONTENT_CHARS));
  }
  return out;
}

function itemPublico(row, conteudo) {
  return {
    id: row.id,
    type: ITEM_TYPE,
    title: row.title,
    content_md: conteudo,
    source_url: sourceUrl(row.list_id, row.id),
    updated_at: new Date(row.atualizado).toISOString(),
    // "private": não público, entregue porque o link foi gerado com escopo "tudo".
    visibility: row.publico ? "org" : "private",
  };
}

// ---------- cursores (paginação estável por chave) ----------

const encodeCursor = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");

function decodeCursor(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(Buffer.from(String(raw), "base64url").toString("utf8"));
  } catch {
    throw new ConhecimentoError(400, "Cursor inválido.");
  }
}

function parseDate(raw, campo) {
  if (!raw) return null;
  const date = new Date(String(raw));
  if (Number.isNaN(date.getTime())) throw new ConhecimentoError(400, `Data inválida em ${campo}.`);
  return date.toISOString();
}

// ---------- endpoints do contrato ----------

function manifest(conhecimento) {
  return {
    contract_version: CONTRACT_VERSION,
    org_id: conhecimento.organizationId,
    org_name: conhecimento.organizationName,
    item_types: [ITEM_TYPE, OVERVIEW_TYPE],
    scope: conhecimento.escopo,
  };
}

const ROTULO_VISIBILIDADE = { public: "público", private: "privado", admin_private: "Privado ADM" };

/**
 * "Visão geral" (contrato 1.2): workspaces, projetos e cards da
 * organização, para perguntas de contagem e listagem. Sem datas que mudam a cada
 * leitura, para o Hub de Conhecimento só reindexar quando algo mudou de fato. `completa`
 * inclui o conteúdo não público.
 */
async function montarVisaoGeral(organizationId, organizationName, completa) {
  const { rows } = await postgres.query(
    `
      SELECT w.id AS workspace_id, w.name AS workspace_name, COALESCE(w.visibility, 'private') AS workspace_vis,
             l.id AS list_id, l.name AS list_name, COALESCE(l.visibility, 'public') AS list_vis,
             t.id AS task_id, t.title, COALESCE(t.visibility, 'public') AS task_vis, t.priority, t.due_date,
             t.parent_task_id, sd.name AS status_name
      FROM workspaces w
      LEFT JOIN spaces sp ON sp.workspace_id = w.id
      LEFT JOIN folders f ON f.space_id = sp.id
      LEFT JOIN lists l ON l.folder_id = f.id AND l.deleted_at IS NULL
      LEFT JOIN tasks t ON t.list_id = l.id
      LEFT JOIN status_definitions sd ON sd.id = t.status_id
      WHERE w.organization_id = $1 AND w.deleted_at IS NULL
      ORDER BY w.name, w.id, l.name, l.id, t.created_at, t.id
    `,
    [organizationId],
  );
  const visivel = (vis) => completa || vis === "public";
  const workspaces = new Map();
  for (const r of rows) {
    if (!visivel(r.workspace_vis)) continue;
    if (!workspaces.has(r.workspace_id)) {
      workspaces.set(r.workspace_id, { nome: r.workspace_name, vis: r.workspace_vis, projetos: new Map() });
    }
    if (!r.list_id || !visivel(r.list_vis)) continue;
    const projetos = workspaces.get(r.workspace_id).projetos;
    if (!projetos.has(r.list_id)) {
      projetos.set(r.list_id, { nome: r.list_name, vis: r.list_vis, cards: [], subtarefas: 0 });
    }
    if (!r.task_id || !visivel(r.task_vis)) continue;
    const projeto = projetos.get(r.list_id);
    if (r.parent_task_id) {
      projeto.subtarefas += 1;
      continue;
    }
    projeto.cards.push(r);
  }

  const rotulo = (vis) => (completa ? ` (${ROTULO_VISIBILIDADE[vis] || vis})` : "");
  const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
  let totalProjetos = 0;
  let totalCards = 0;
  const secoes = [];
  for (const ws of workspaces.values()) {
    const linhas = [];
    let cardsDoWorkspace = 0;
    for (const projeto of ws.projetos.values()) {
      totalProjetos += 1;
      cardsDoWorkspace += projeto.cards.length;
      const porStatus = new Map();
      for (const c of projeto.cards) {
        const nome = c.status_name || "sem status";
        porStatus.set(nome, (porStatus.get(nome) || 0) + 1);
      }
      const resumo = [...porStatus.entries()].map(([nome, n]) => `${n} ${nome}`).join(", ");
      linhas.push(
        `### Projeto: ${projeto.nome}${rotulo(projeto.vis)} — ${plural(projeto.cards.length, "card", "cards")}` +
          `${resumo ? ` (${resumo})` : ""}${projeto.subtarefas ? `, ${plural(projeto.subtarefas, "subtarefa", "subtarefas")}` : ""}`,
      );
      for (const c of projeto.cards.slice(0, 300)) {
        const detalhes = [
          c.status_name,
          c.priority && `prioridade ${PRIORIDADES[c.priority] || c.priority}`,
          c.due_date && `prazo ${dataBr(c.due_date)}`,
        ].filter(Boolean);
        linhas.push(`- ${c.title}${rotulo(c.task_vis)}${detalhes.length ? ` — ${detalhes.join(" · ")}` : ""}`);
      }
      if (projeto.cards.length > 300) linhas.push(`- … e mais ${projeto.cards.length - 300} cards`);
    }
    totalCards += cardsDoWorkspace;
    secoes.push(
      [
        `## Workspace: ${ws.nome}${rotulo(ws.vis)} — ${plural(ws.projetos.size, "projeto", "projetos")}, ${plural(cardsDoWorkspace, "card", "cards")}`,
        ...linhas,
      ].join("\n"),
    );
  }
  const titulo = completa ? "Visão geral completa do Pauta" : "Visão geral do Pauta";
  const escopo = completa
    ? "Inclui itens públicos, privados e Privado ADM."
    : "Inclui só workspaces, projetos e cards públicos.";
  return [
    `# ${titulo} — ${organizationName}`,
    `${escopo} Total: ${plural(workspaces.size, "workspace", "workspaces")}, ${plural(totalProjetos, "projeto", "projetos")} e ${plural(totalCards, "card", "cards")}.`,
    ...secoes,
  ]
    .join("\n\n")
    .slice(0, MAX_CONTENT_CHARS);
}

function idsVisaoGeral(conhecimento) {
  return conhecimento.escopo === "tudo" ? [OVERVIEW_ID, OVERVIEW_FULL_ID] : [OVERVIEW_ID];
}

async function itemVisaoGeral(conhecimento, id) {
  const completa = id === OVERVIEW_FULL_ID;
  if (completa && conhecimento.escopo !== "tudo") return null;
  const { rows } = await postgres.query("SELECT date_trunc('milliseconds', now()) AS agora");
  return {
    id,
    type: OVERVIEW_TYPE,
    title: completa ? "Visão geral completa do Pauta" : "Visão geral do Pauta",
    content_md: await montarVisaoGeral(conhecimento.organizationId, conhecimento.organizationName, completa),
    source_url: (process.env.FRONTEND_URL || "").trim().replace(/\/+$/, "") || null,
    // Lida a cada sincronização; o Hub de Conhecimento compara o conteúdo e só reindexa se mudou.
    updated_at: new Date(rows[0].agora).toISOString(),
    visibility: completa ? "private" : "org",
  };
}

async function listarItens(conhecimento, { type, updatedSince, cursor }) {
  const tudo = conhecimento.escopo === "tudo";
  const querCards = !type || type === ITEM_TYPE;
  const querVisao = !type || type === OVERVIEW_TYPE;
  const since = parseDate(updatedSince, "updated_since");
  const after = decodeCursor(cursor);
  const items = [];
  let nextCursor = null;
  if (querCards) {
    const { rows } = await postgres.query(
      `
        SELECT * FROM (${BASE_SQL}) base
        WHERE ($6 OR base.publico)
          AND ($2::timestamptz IS NULL OR base.atualizado >= $2::timestamptz)
          AND ($3::timestamptz IS NULL OR (base.atualizado, base.id) > ($3::timestamptz, $4::varchar))
        ORDER BY base.atualizado, base.id
        LIMIT $5
      `,
      [conhecimento.organizationId, since, after?.u || null, after?.id || "", PAGE_SIZE + 1, tudo],
    );
    const pagina = rows.slice(0, PAGE_SIZE);
    const conteudo = await montarConteudo(pagina);
    items.push(...pagina.map((r) => itemPublico(r, conteudo.get(r.id))));
    const ultimo = pagina[pagina.length - 1];
    if (rows.length > PAGE_SIZE) {
      nextCursor = encodeCursor({ u: new Date(ultimo.atualizado).toISOString(), id: ultimo.id });
    }
  }
  // A visão geral vem na última página (é lida de novo a cada sincronização).
  if (!nextCursor && querVisao) {
    for (const id of idsVisaoGeral(conhecimento)) items.push(await itemVisaoGeral(conhecimento, id));
  }
  return { items, next_cursor: nextCursor };
}

/** Um card: 404 se não existe na organização; sem conteúdo se o escopo do link não permite. */
async function buscarItem(conhecimento, taskId) {
  const id = String(taskId).slice(0, 100);
  if (id === OVERVIEW_ID || id === OVERVIEW_FULL_ID) return itemVisaoGeral(conhecimento, id);
  const { rows } = await postgres.query(`SELECT * FROM (${BASE_SQL}) base WHERE base.id = $2`, [
    conhecimento.organizationId,
    id,
  ]);
  const row = rows[0];
  if (!row) return null;
  if (!row.publico && conhecimento.escopo !== "tudo") {
    // Fora do escopo do link: o Hub de Conhecimento remove; nada do conteúdo sai daqui.
    return {
      id: row.id,
      type: ITEM_TYPE,
      title: "",
      content_md: "",
      source_url: null,
      updated_at: new Date(row.atualizado).toISOString(),
      visibility: "restricted",
    };
  }
  const conteudo = await montarConteudo([row]);
  return itemPublico(row, conteudo.get(row.id));
}

async function listarExclusoes(organizationId, { since, cursor }) {
  await ensureConhecimentoSchema();
  const desde = parseDate(since, "since");
  const after = decodeCursor(cursor);
  const { rows } = await postgres.query(
    `
      SELECT task_id, date_trunc('milliseconds', deleted_at) AS deleted_at
      FROM conhecimento_exclusoes
      WHERE organization_id = $1
        AND ($2::timestamptz IS NULL OR deleted_at >= $2::timestamptz)
        AND ($3::timestamptz IS NULL OR (date_trunc('milliseconds', deleted_at), task_id) > ($3::timestamptz, $4::varchar))
      ORDER BY date_trunc('milliseconds', deleted_at), task_id
      LIMIT $5
    `,
    [organizationId, desde, after?.u || null, after?.id || "", PAGE_SIZE + 1],
  );
  const pagina = rows.slice(0, PAGE_SIZE);
  const ultimo = pagina[pagina.length - 1];
  return {
    deleted: pagina.map((r) => ({ id: r.task_id, deleted_at: new Date(r.deleted_at).toISOString() })),
    next_cursor:
      rows.length > PAGE_SIZE ? encodeCursor({ u: new Date(ultimo.deleted_at).toISOString(), id: ultimo.task_id }) : null,
  };
}

async function listarIds(conhecimento, { type, cursor }) {
  const querCards = !type || type === ITEM_TYPE;
  const querVisao = !type || type === OVERVIEW_TYPE;
  const after = decodeCursor(cursor);
  const limite = PAGE_SIZE * 10;
  const ids = [];
  let nextCursor = null;
  if (querCards) {
    const { rows } = await postgres.query(
      `
        SELECT t.id
        FROM tasks t
        INNER JOIN workspaces w ON w.id = t.workspace_id
        LEFT JOIN lists l ON l.id = t.list_id
        WHERE w.organization_id = $1 AND w.deleted_at IS NULL AND l.deleted_at IS NULL
          AND ($4 OR (COALESCE(t.visibility, 'public') = 'public' AND w.visibility = 'public'
                      AND COALESCE(l.visibility, 'public') = 'public'))
          AND ($2::varchar IS NULL OR t.id > $2::varchar)
        ORDER BY t.id
        LIMIT $3
      `,
      [conhecimento.organizationId, after?.id || null, limite + 1, conhecimento.escopo === "tudo"],
    );
    const pagina = rows.slice(0, limite);
    ids.push(...pagina.map((r) => r.id));
    if (rows.length > limite) nextCursor = encodeCursor({ id: pagina[pagina.length - 1].id });
  }
  if (!nextCursor && querVisao) ids.push(...idsVisaoGeral(conhecimento));
  return { ids, next_cursor: nextCursor };
}

// ---------- registro do webhook (1.1) ----------

function enderecoPrivado(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224
    );
  }
  const v6 = ip.toLowerCase();
  const mapeado = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
  if (mapeado) return enderecoPrivado(mapeado[1]);
  // O parser de URL reescreve [::ffff:127.0.0.1] como ::ffff:7f00:1: converte de
  // volta para IPv4 antes de conferir.
  const mapeadoHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(v6);
  if (mapeadoHex) {
    const alto = parseInt(mapeadoHex[1], 16);
    const baixo = parseInt(mapeadoHex[2], 16);
    return enderecoPrivado(`${alto >> 8}.${alto & 255}.${baixo >> 8}.${baixo & 255}`);
  }
  return (
    v6 === "::" ||
    v6 === "::1" ||
    /^(fc|fd|fe[89ab]|ff)/.test(v6) ||
    // IPv4 embutido (NAT64, 6to4, compatível) também pode apontar para a rede interna.
    /^(64:ff9b:|2002:|::\d|::[0-9a-f]{1,4}:[0-9a-f]{1,4}$)/.test(v6)
  );
}

const permiteEnderecoLocal = () =>
  process.env.CONHECIMENTO_ALLOW_PRIVATE_WEBHOOK === "true" && process.env.NODE_ENV !== "production";

/** O Pauta só envia eventos para HTTPS público (SSRF), conferido a cada envio. */
async function conferirDestino(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ConhecimentoError(400, "Endereço do webhook inválido.");
  }
  if (url.username || url.password) throw new ConhecimentoError(400, "Endereço do webhook inválido.");
  if (permiteEnderecoLocal()) return url;
  if (url.protocol !== "https:") throw new ConhecimentoError(400, "O webhook precisa usar https://.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const enderecos = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true }).catch(() => []);
  if (!enderecos.length || enderecos.some((e) => enderecoPrivado(e.address))) {
    throw new ConhecimentoError(400, "Endereço do webhook não permitido.");
  }
  return url;
}

async function registrarWebhook(conhecimento, body) {
  const url = typeof body?.url === "string" ? body.url.trim() : "";
  const secret = typeof body?.secret === "string" ? body.secret : "";
  if (!url || url.length > 2000) throw new ConhecimentoError(400, "Informe o endereço do webhook.");
  if (secret.length < 16 || secret.length > 200) throw new ConhecimentoError(400, "Segredo do webhook inválido.");
  await conferirDestino(url);
  await postgres.query(
    `UPDATE conhecimento_integracoes SET webhook_url = $2, webhook_secret_enc = $3, webhook_registered_at = now()
     WHERE id = $1`,
    [conhecimento.integrationId, url, seal(secret)],
  );
}

// ---------- eventos ----------

const espera = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ATRASOS_MS = [0, 2_000, 10_000];

async function enviarEvento(destino, evento) {
  const body = JSON.stringify(evento);
  for (const atraso of ATRASOS_MS) {
    if (atraso) await espera(atraso);
    try {
      await conferirDestino(destino.url);
      const timestamp = Math.floor(Date.now() / 1000);
      const assinatura = crypto.createHmac("sha256", destino.secret).update(`${timestamp}.${body}`).digest("hex");
      const res = await axios.post(destino.url, body, {
        timeout: 5_000,
        maxRedirects: 0,
        validateStatus: () => true,
        headers: {
          "content-type": "application/json",
          "x-conhecimento-timestamp": String(timestamp),
          "x-conhecimento-signature": `v1=${assinatura}`,
        },
      });
      if (res.status >= 200 && res.status < 300) return true;
      if (res.status >= 400 && res.status < 500 && res.status !== 429) return false; // recusado de vez
    } catch {
      // rede: tenta de novo
    }
  }
  return false;
}

async function destinosDaOrganizacao(organizationId) {
  await ensureConhecimentoSchema();
  const { rows } = await postgres.query(
    `SELECT webhook_url, webhook_secret_enc FROM conhecimento_integracoes
     WHERE organization_id = $1 AND revoked_at IS NULL AND expires_at > now() AND webhook_url IS NOT NULL`,
    [organizationId],
  );
  return rows.map((r) => ({ url: r.webhook_url, secret: unseal(r.webhook_secret_enc) }));
}

async function organizacaoDoCard(taskId) {
  const { rows } = await postgres.query(
    "SELECT w.organization_id FROM tasks t INNER JOIN workspaces w ON w.id = t.workspace_id WHERE t.id = $1",
    [taskId],
  );
  return rows[0]?.organization_id || null;
}

/**
 * Avisa o Hub de Conhecimento que um card mudou (ou saiu). Não bloqueia quem chamou e
 * nunca derruba a operação do usuário. `organizationId` é obrigatório na
 * exclusão (o card já não existe para descobrir a organização).
 */
function notificarConhecimento(taskIds, tipo = "upsert", organizationId = null) {
  const ids = (Array.isArray(taskIds) ? taskIds : [taskIds]).filter(Boolean);
  if (!ids.length) return Promise.resolve();
  return (async () => {
    const org = organizationId || (await organizacaoDoCard(ids[0]));
    if (!org) return;
    const destinos = await destinosDaOrganizacao(org);
    for (const destino of destinos) {
      for (const id of ids) {
        enviarEvento(destino, {
          event_id: crypto.randomUUID(),
          type: tipo,
          item_id: id,
          org_id: org,
          occurred_at: new Date().toISOString(),
        }).catch(() => {});
      }
    }
  })().catch((error) => console.error("[conhecimento] falha ao notificar", error.message));
}

/** Dentro da transação da exclusão: guarda o registro só se há integração ativa. */
async function registrarExclusoes(client, organizationId, taskIds) {
  const ids = taskIds.filter(Boolean);
  if (!organizationId || !ids.length) return;
  await ensureConhecimentoSchema();
  await client.query(
    `
      INSERT INTO conhecimento_exclusoes (organization_id, task_id)
      SELECT $1::varchar, unnest($2::varchar[])
      WHERE EXISTS (SELECT 1 FROM conhecimento_integracoes WHERE organization_id = $1::varchar AND revoked_at IS NULL)
      ON CONFLICT (organization_id, task_id) DO UPDATE SET deleted_at = now()
    `,
    [organizationId, ids],
  );
}

module.exports = {
  ConhecimentoError,
  autenticarIntegracao,
  buscarItem,
  ensureConhecimentoSchema,
  gerarLink,
  htmlParaTexto,
  listarExclusoes,
  listarIds,
  listarItens,
  manifest,
  notificarConhecimento,
  registrarExclusoes,
  registrarWebhook,
  revogar,
  statusDaIntegracao,
};
