/**
 * Conector do Hub de Conhecimento (contrato 1.1): link gerado por titular/admin, API só
 * com cards públicos da própria organização, paginação estável, exclusões,
 * webhook com eventos assinados, revogação e isolamento entre contas.
 */
const crypto = require("crypto");
const http = require("http");

module.exports = async function casosDoConhecimento(ctx) {
  const { api, db, check, signup, waitFor } = ctx;
  const detalhe = (res) => `${res.status} ${JSON.stringify(res.data)?.slice(0, 160)}`;
  const SENHA = "senha-forte-123";

  const dono = await signup({ email: "conhecimento-dono@test.com", seed: 1401 });
  const deFora = await signup({ email: "conhecimento-fora@test.com", seed: 1402 });

  const criada = await api("POST", "/api/users", {
    token: dono.token,
    body: { name: "Membro Comum", email: "conhecimento-membro@test.com", password: SENHA, accessRole: "member" },
  });
  const loginMembro = await api("POST", "/api/auth/login", {
    body: { email: "conhecimento-membro@test.com", password: SENHA },
  });
  const membro = { token: loginMembro.data?.token };
  check("membro de apoio criado", criada.status === 201 && Boolean(membro.token), detalhe(criada));

  // ---------- tela de Configurações ----------
  let res = await api("GET", "/api/integrations/conhecimento", { token: membro.token });
  check("membro comum não vê a integração = 403", res.status === 403, detalhe(res));
  res = await api("POST", "/api/integrations/conhecimento/link", { token: membro.token });
  check("membro comum não gera link = 403", res.status === 403, detalhe(res));

  res = await api("GET", "/api/integrations/conhecimento", { token: dono.token });
  check("sem link, a integração aparece desconectada", res.status === 200 && res.data?.conectado === false, detalhe(res));

  res = await api("POST", "/api/integrations/conhecimento/link", { token: dono.token });
  const link = res.data?.link || "";
  check(
    "titular gera o link com o token no fragmento",
    res.status === 201 && /\/api\/conhecimento\/v1#hck_[A-Za-z0-9_-]{40,}$/.test(link),
    detalhe(res),
  );
  const token = link.split("#")[1];
  const { rows: guardados } = await db.query("SELECT token_hash FROM conhecimento_integracoes");
  check(
    "só o hash do token fica guardado",
    guardados.length > 0 && guardados.every((r) => r.token_hash !== token && r.token_hash.length === 64),
    JSON.stringify(guardados.length),
  );

  const conhecimento = (method, rota, { token: outro, ...opts } = {}) =>
    api(method, `/api/conhecimento/v1${rota}`, { ...opts, headers: { Authorization: `Bearer ${outro ?? token}` } });

  // ---------- autenticação do contrato ----------
  res = await api("GET", "/api/conhecimento/v1/manifest");
  check("sem token = 401", res.status === 401, detalhe(res));
  res = await conhecimento("GET", "/manifest", { token: "hck_inexistente_inexistente_inexistente" });
  check("token desconhecido = 401", res.status === 401, detalhe(res));
  res = await conhecimento("GET", "/manifest", { token: dono.token });
  check("o JWT de login não abre a API do Hub de Conhecimento = 401", res.status === 401, detalhe(res));

  res = await conhecimento("GET", "/manifest");
  check(
    "manifest mostra a organização do token, a versão 1.2 e o escopo só público",
    res.status === 200 &&
      res.data?.org_id === dono.organizationId &&
      res.data?.contract_version === "1.2" &&
      res.data?.scope === "publico" &&
      res.data?.item_types.includes("visao_geral"),
    detalhe(res),
  );

  // ---------- dados sintéticos ----------
  const { rows: estrutura } = await db.query(
    `
      SELECT w.id AS workspace_id, s.id AS space_id, f.id AS folder_id
      FROM workspaces w
      INNER JOIN spaces s ON s.workspace_id = w.id
      INNER JOIN folders f ON f.space_id = s.id
      WHERE w.organization_id = $1 AND w.deleted_at IS NULL
      LIMIT 1
    `,
    [dono.organizationId],
  );
  const { workspace_id: workspaceId, space_id: spaceId, folder_id: folderId } = estrutura[0];
  await db.query("UPDATE workspaces SET visibility = 'public' WHERE id = $1", [workspaceId]);

  const criarLista = async (name, visibility) => {
    const r = await api("POST", "/api/workspaces/lists", { token: dono.token, body: { name, folderId, visibility } });
    return r.data?.id || r.data?.list?.id;
  };
  const listaPublica = await criarLista("Operação pública", "public");
  const listaPrivada = await criarLista("Diretoria privada", "private");

  const criarCard = async (title, listId, extras = {}) => {
    const r = await api("POST", "/api/workspaces/tasks", {
      token: dono.token,
      body: { title, listId, workspaceId, spaceId, folderId, statusId: "st_todo", priority: "high", ...extras },
    });
    return r.data?.task?.id || r.data?.id;
  };
  const cardPublico = await criarCard("Backup do servidor", listaPublica);
  const cardPrivado = await criarCard("Salário da diretoria", listaPublica, { visibility: "private" });
  const cardEmListaPrivada = await criarCard("Plano secreto", listaPrivada);
  check("cards de apoio criados", Boolean(cardPublico && cardPrivado && cardEmListaPrivada), "");
  await db.query("UPDATE tasks SET visibility = 'private' WHERE id = $1", [cardPrivado]);
  await db.query("UPDATE tasks SET description = $2 WHERE id = $1", [
    cardPublico,
    "<p>Toda <strong>sexta</strong> às 18h &amp; cópia externa.</p>",
  ]);

  await api("POST", `/api/workspaces/tasks/${cardPublico}/comments`, {
    token: dono.token,
    body: { content: "<p>Conferido com o fornecedor.</p>" },
  });
  await db.query("INSERT INTO checklists (id, task_id, name) VALUES ('chk_conhecimento', $1, 'Passos')", [cardPublico]);
  await db.query(
    "INSERT INTO checklist_items (id, checklist_id, label, done) VALUES ('chi_1', 'chk_conhecimento', 'Testar restauração', true)",
  );

  // ---------- itens: só públicos ----------
  const todos = async (rota, chave) => {
    const vistos = [];
    let cursor = null;
    for (let i = 0; i < 50; i++) {
      const r = await conhecimento("GET", `${rota}${rota.includes("?") ? "&" : "?"}${cursor ? `cursor=${cursor}` : ""}`);
      if (r.status !== 200) throw new Error(`${rota}: ${detalhe(r)}`);
      vistos.push(...r.data[chave]);
      cursor = r.data.next_cursor;
      if (!cursor) break;
    }
    return vistos;
  };

  let itens = await todos("/items", "items");
  const ids = itens.map((i) => i.id);
  check(
    "lista só os cards públicos de projeto e workspace públicos",
    ids.includes(cardPublico) && !ids.includes(cardPrivado) && !ids.includes(cardEmListaPrivada),
    JSON.stringify(ids).slice(0, 200),
  );
  const item = itens.find((i) => i.id === cardPublico);
  check(
    "conteúdo em texto, com descrição sem HTML, checklist e comentário",
    item?.content_md.includes("Toda sexta às 18h & cópia externa.") &&
      !item?.content_md.includes("<p>") &&
      item?.content_md.includes("- [x] Testar restauração") &&
      item?.content_md.includes("Conferido com o fornecedor.") &&
      item?.visibility === "org" &&
      item?.type === "tarefa",
    item?.content_md?.slice(0, 300),
  );
  check(
    "link do item abre o card no Pauta",
    item?.source_url === `http://localhost:5173/projeto/${listaPublica}?card=${cardPublico}`,
    item?.source_url,
  );

  // Paginação estável por chave (sem repetir nem pular).
  await db.query(
    `INSERT INTO tasks (id, workspace_id, space_id, folder_id, list_id, title, status_id, visibility, created_at, updated_at)
     SELECT 'tsk_conhecimento_' || g, $1, $2, $3, $4, 'Card em lote ' || g, 'st_todo', 'public', now(), now()
     FROM generate_series(1, 120) g`,
    [workspaceId, spaceId, folderId, listaPublica],
  );
  itens = await todos("/items", "items");
  const unicos = new Set(itens.map((i) => i.id));
  check(
    "paginação percorre todos os itens uma vez só",
    unicos.size === itens.length && [...Array(120)].every((_, g) => unicos.has(`tsk_conhecimento_${g + 1}`)),
    `${itens.length} itens, ${unicos.size} únicos`,
  );
  const idsVigentes = await todos("/ids", "ids");
  check(
    "ids lista os mesmos cards visíveis",
    idsVigentes.length === unicos.size && idsVigentes.every((id) => unicos.has(id)),
    `${idsVigentes.length} x ${unicos.size}`,
  );

  res = await conhecimento("GET", `/items?updated_since=${encodeURIComponent("2099-01-01T00:00:00Z")}`);
  check(
    "updated_since no futuro só traz a visão geral (lida a cada sincronização)",
    res.status === 200 && res.data?.items.length === 1 && res.data.items[0].id === "visao-geral",
    detalhe(res),
  );

  // ---------- visão geral ----------
  const visao = itens.find((i) => i.id === "visao-geral");
  check(
    "visão geral pública conta workspaces, projetos e cards e não cita nada privado",
    visao?.visibility === "org" &&
      visao?.type === "visao_geral" &&
      /Total: 1 workspace, 1 projeto e 121 cards\./.test(visao.content_md) &&
      visao.content_md.includes("### Projeto: Operação pública") &&
      !visao.content_md.includes("Salário da diretoria") &&
      !visao.content_md.includes("Plano secreto") &&
      !itens.some((i) => i.id === "visao-geral-completa"),
    visao?.content_md?.slice(0, 300),
  );
  res = await conhecimento("GET", "/items/visao-geral-completa");
  check("sem escopo \"tudo\" a visão completa não existe = 404", res.status === 404, detalhe(res));
  res = await conhecimento("GET", "/items?updated_since=ontem");
  check("data inválida = 400", res.status === 400, detalhe(res));

  res = await conhecimento("GET", `/items/${cardPrivado}`);
  check(
    "card privado lido direto vem como restrito e sem conteúdo",
    res.status === 200 && res.data?.visibility === "restricted" && res.data?.content_md === "" && res.data?.title === "",
    detalhe(res),
  );
  res = await conhecimento("GET", "/items/tsk_nao_existe");
  check("card inexistente = 404", res.status === 404, detalhe(res));

  // ---------- isolamento entre contas ----------
  res = await api("POST", "/api/integrations/conhecimento/link", { token: deFora.token });
  const tokenFora = (res.data?.link || "").split("#")[1];
  res = await conhecimento("GET", `/items/${cardPublico}`, { token: tokenFora });
  check("o token de outra conta não lê cards daqui = 404", res.status === 404, detalhe(res));
  const idsFora = [];
  let cursorFora = null;
  do {
    const r = await conhecimento("GET", `/ids${cursorFora ? `?cursor=${cursorFora}` : ""}`, { token: tokenFora });
    idsFora.push(...(r.data?.ids || []));
    cursorFora = r.data?.next_cursor;
  } while (cursorFora);
  check(
    "a outra conta não lista nenhum card daqui",
    !idsFora.some((id) => unicos.has(id) && !id.startsWith("visao-geral")),
    String(idsFora.length),
  );

  // ---------- webhook e eventos assinados ----------
  const recebidos = [];
  const receptor = http.createServer((req, resp) => {
    let corpo = "";
    req.on("data", (c) => {
      corpo += c;
    });
    req.on("end", () => {
      recebidos.push({ headers: req.headers, corpo });
      resp.writeHead(202);
      resp.end();
    });
  });
  await new Promise((resolve) => receptor.listen(ctx.constants.appPort + 3, "127.0.0.1", resolve));
  const urlReceptor = `http://127.0.0.1:${receptor.address().port}/api/connectors/abc/events`;
  const segredo = crypto.randomBytes(24).toString("base64url");

  try {
    res = await conhecimento("POST", "/webhook", { body: { url: urlReceptor, secret: "curto" } });
    check("segredo curto demais = 400", res.status === 400, detalhe(res));
    res = await conhecimento("POST", "/webhook", { body: { url: urlReceptor, secret: segredo } });
    check("Hub de Conhecimento registra o webhook = 204", res.status === 204, detalhe(res));
    res = await api("GET", "/api/integrations/conhecimento", { token: dono.token });
    check("tela mostra tempo real ligado", res.data?.conectado === true && res.data?.tempoReal === true, detalhe(res));

    const assinaturaValida = (evento) => {
      const esperado = crypto
        .createHmac("sha256", segredo)
        .update(`${evento.headers["x-conhecimento-timestamp"]}.${evento.corpo}`)
        .digest("hex");
      return evento.headers["x-conhecimento-signature"] === `v1=${esperado}`;
    };
    const eventoDe = (itemId, tipo) =>
      waitFor(
        () => recebidos.find((e) => {
          const corpo = JSON.parse(e.corpo);
          return corpo.item_id === itemId && corpo.type === tipo;
        }),
        8_000,
      );

    await api("PUT", `/api/workspaces/tasks/${cardPublico}`, { token: dono.token, body: { title: "Backup do servidor (revisado)" } });
    const evAtualizacao = await eventoDe(cardPublico, "upsert");
    const corpo = evAtualizacao ? JSON.parse(evAtualizacao.corpo) : {};
    check(
      "editar o card envia evento assinado, sem conteúdo, com a organização",
      Boolean(evAtualizacao) &&
        assinaturaValida(evAtualizacao) &&
        corpo.org_id === dono.organizationId &&
        !("title" in corpo) &&
        typeof corpo.event_id === "string",
      evAtualizacao?.corpo,
    );

    recebidos.length = 0;
    await api("POST", `/api/workspaces/tasks/${cardPublico}/comments`, {
      token: dono.token,
      body: { content: "Novo comentário" },
    });
    check("comentar também avisa o Hub de Conhecimento", Boolean(await eventoDe(cardPublico, "upsert")), "");

    res = await api("DELETE", `/api/workspaces/tasks/${cardPublico}`, { token: dono.token });
    check("card apagado", res.status === 200, detalhe(res));
    const evExclusao = await eventoDe(cardPublico, "delete");
    check("apagar envia evento de exclusão assinado", Boolean(evExclusao) && assinaturaValida(evExclusao), "");
    const exclusoes = await todos("/deleted", "deleted");
    check("a exclusão aparece em /deleted", exclusoes.some((d) => d.id === cardPublico), JSON.stringify(exclusoes).slice(0, 160));
    res = await conhecimento("GET", `/items/${cardPublico}`);
    check("card apagado = 404", res.status === 404, detalhe(res));
  } finally {
    receptor.close();
  }

  // ---------- escopo "tudo": privados e Privado ADM (contrato 1.2) ----------
  await db.query("UPDATE tasks SET visibility = 'admin_private' WHERE id = $1", [cardEmListaPrivada]);
  const cardAdm = cardEmListaPrivada;
  res = await api("POST", "/api/integrations/conhecimento/link", {
    token: membro.token,
    body: { incluirPrivados: true },
  });
  check("membro comum não gera link com privados = 403", res.status === 403, detalhe(res));
  res = await api("POST", "/api/integrations/conhecimento/link", { token: dono.token, body: { incluirPrivados: true } });
  const tokenTudo = (res.data?.link || "").split("#")[1];
  check("link com conteúdo não público gerado", res.status === 201 && res.data?.incluiPrivados === true, detalhe(res));
  res = await api("GET", "/api/integrations/conhecimento", { token: dono.token });
  check("tela mostra que o link inclui privados", res.data?.incluiPrivados === true, detalhe(res));
  res = await conhecimento("GET", "/manifest", { token: tokenTudo });
  check("manifest informa escopo \"tudo\"", res.data?.scope === "tudo", detalhe(res));

  const itensTudo = [];
  let cursorTudo = null;
  do {
    const r = await conhecimento("GET", `/items${cursorTudo ? `?cursor=${cursorTudo}` : ""}`, { token: tokenTudo });
    itensTudo.push(...(r.data?.items || []));
    cursorTudo = r.data?.next_cursor;
  } while (cursorTudo);
  const privado = itensTudo.find((i) => i.id === cardPrivado);
  const adm = itensTudo.find((i) => i.id === cardAdm);
  check(
    "com escopo \"tudo\", cards privados e Privado ADM vêm como \"private\" e com conteúdo",
    privado?.visibility === "private" &&
      privado?.content_md.includes("Salário da diretoria") &&
      adm?.visibility === "private" &&
      adm?.content_md.includes("Plano secreto"),
    JSON.stringify([privado?.visibility, adm?.visibility]),
  );
  const completa = itensTudo.find((i) => i.id === "visao-geral-completa");
  check(
    "visão geral completa vem como \"private\" e marca a visibilidade de cada item",
    completa?.visibility === "private" &&
      completa.content_md.includes("Plano secreto (Privado ADM)") &&
      completa.content_md.includes("Diretoria privada (privado)"),
    completa?.content_md?.slice(0, 300),
  );
  res = await conhecimento("GET", "/ids", { token: tokenTudo });
  check(
    "ids com escopo \"tudo\" incluem os privados e as duas visões gerais",
    res.data?.ids.includes(cardPrivado) && res.data?.ids.includes(cardAdm) && res.data?.ids.includes("visao-geral-completa"),
    detalhe(res),
  );

  // ---------- revogação ----------
  res = await api("POST", "/api/integrations/conhecimento/link", { token: dono.token });
  const tokenNovo = (res.data?.link || "").split("#")[1];
  res = await conhecimento("GET", "/manifest");
  check("gerar um link novo derruba o anterior = 401", res.status === 401, detalhe(res));
  res = await conhecimento("GET", "/manifest", { token: tokenNovo });
  check("o link novo funciona", res.status === 200, detalhe(res));

  res = await api("DELETE", "/api/integrations/conhecimento", { token: dono.token });
  check("titular desconecta = 204", res.status === 204, detalhe(res));
  res = await conhecimento("GET", "/manifest", { token: tokenNovo });
  check("depois de desconectar o token não vale mais = 401", res.status === 401, detalhe(res));
  res = await api("GET", "/api/integrations/conhecimento", { token: dono.token });
  check("tela volta a mostrar desconectado", res.data?.conectado === false, detalhe(res));
};
