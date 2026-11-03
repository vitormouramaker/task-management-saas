/**
 * Lixeira (apagar, restaurar, excluir de vez, esvaziar) e os limites de plano
 * que bloqueiam a criação ou deixam a conta somente leitura.
 */
const crypto = require("crypto");

/** Estrutura padrão que toda conta nova recebe: workspace, space, folder e o projeto de exemplo. */
async function estruturaInicial(db, organizationId) {
  const { rows } = await db.query(
    `
      SELECT w.id AS workspace_id, s.id AS space_id, f.id AS folder_id, l.id AS list_id, l.name AS list_name
      FROM workspaces w
      INNER JOIN spaces s ON s.workspace_id = w.id
      INNER JOIN folders f ON f.space_id = s.id
      INNER JOIN lists l ON l.folder_id = f.id
      WHERE w.organization_id = $1 AND w.deleted_at IS NULL AND l.deleted_at IS NULL
      ORDER BY l.created_at ASC
      LIMIT 1
    `,
    [organizationId],
  );
  return rows[0];
}

module.exports = async function casosDeLixeiraELimites(ctx) {
  const { api, db, check } = ctx;

  // =========================================================================
  // 1. LIXEIRA
  // =========================================================================
  const dono = await ctx.signup({ email: "lixeira-dono@test.com", seed: 51 });
  const base = await estruturaInicial(db, dono.organizationId);
  check(
    "conta nova já vem com o projeto de exemplo, que conta no limite do plano",
    base?.list_name === "Comece por aqui",
    JSON.stringify(base),
  );

  const { rows: statusRows } = await db.query(
    "SELECT id FROM status_definitions WHERE list_id IS NULL ORDER BY display_order ASC LIMIT 1",
  );
  const statusId = statusRows[0]?.id || null;

  // Um projeto novo só para os testes (o de exemplo fica intacto).
  let res = await api("POST", "/api/workspaces/lists", {
    token: dono.token,
    body: { name: "Projeto da lixeira", folderId: base.folder_id, visibility: "public" },
  });
  check("criar um projeto novo = 201", res.status === 201, `${res.status} ${res.data?.message}`);
  const projetoId = res.data?.list?.id;

  res = await api("POST", "/api/tags", {
    token: dono.token,
    body: { name: "Etiqueta da lixeira", color: "#ef4444" },
  });
  check("criar etiqueta = 201", res.status === 201, `${res.status} ${res.data?.message}`);
  const tagId = res.data?.tag?.id;

  /** Cria um card completo (etiqueta, responsável, subtarefa, comentário e checklist). */
  async function criarCardCompleto(titulo, token = dono.token) {
    const criado = await api("POST", "/api/workspaces/tasks", {
      token,
      body: {
        workspaceId: base.workspace_id,
        spaceId: base.space_id,
        folderId: base.folder_id,
        listId: projetoId,
        title: titulo,
        descriptionText: "<p>Card de teste da lixeira</p>",
        statusId,
        priority: "high",
        assigneeIds: [dono.memberId],
        tags: [{ id: tagId }],
      },
    });
    const id = criado.data?.task?.id || criado.data?.id;
    await api("POST", `/api/workspaces/tasks/${id}/subtasks`, { token, body: { title: `Subtarefa de ${titulo}` } });
    await api("POST", `/api/workspaces/tasks/${id}/comments`, { token, body: { content: `Comentário de ${titulo}` } });
    const checklist = await api("POST", `/api/workspaces/tasks/${id}/checklists`, { token, body: { name: "Checklist" } });
    const checklistId = checklist.data?.checklist?.id;
    await api("POST", `/api/workspaces/checklists/${checklistId}/items`, { token, body: { label: "Item 1" } });
    return { id, criado };
  }

  /** Foto do card do jeito que a tela mostra, para comparar antes e depois. */
  async function retratoDoCard(cardId, token = dono.token) {
    const detalhe = await api("GET", `/api/workspaces/tasks/${cardId}`, { token });
    if (detalhe.status !== 200) return { status: detalhe.status };
    const task = detalhe.data.task;
    return {
      status: detalhe.status,
      titulo: task.title,
      descricao: task.description?.value,
      prioridade: task.priority,
      responsaveis: [...task.assigneeIds].sort(),
      etiquetas: task.tags.map((t) => t.id).sort(),
      subtarefas: [...task.subtaskIds].sort(),
      checklists: task.checklists.map((c) => ({ nome: c.name, itens: c.items.map((i) => i.label) })),
      anexos: task.attachments.map((a) => a.name).sort(),
      comentarios: (detalhe.data.comments || []).map((c) => c.content),
    };
  }

  const card = await criarCardCompleto("Card completo");
  check("criar card com etiqueta e responsável = 201", card.criado.status === 201, `${card.criado.status} ${card.criado.data?.message}`);
  const antes = await retratoDoCard(card.id);
  check(
    "card nasce com subtarefa, comentário, checklist, responsável e etiqueta",
    antes.subtarefas.length === 1 &&
      antes.comentarios.length === 1 &&
      antes.checklists.length === 1 &&
      antes.checklists[0].itens.length === 1 &&
      antes.responsaveis.length === 1 &&
      antes.etiquetas.length === 1,
    JSON.stringify(antes),
  );

  // ---------- apagar card ----------
  res = await api("DELETE", `/api/workspaces/tasks/${card.id}`, { token: dono.token });
  check("apagar card = 200", res.status === 200, `${res.status} ${res.data?.message}`);

  res = await api("GET", `/api/workspaces/tasks/${card.id}`, { token: dono.token });
  check("card apagado some do projeto", res.status !== 200, String(res.status));

  res = await api("GET", "/api/trash", { token: dono.token });
  check("lixeira responde = 200", res.status === 200, `${res.status} ${res.data?.message}`);
  check("prazo da lixeira do plano Grátis é de 7 dias", res.data?.trashDays === 7, String(res.data?.trashDays));
  check("titular pode esvaziar a lixeira", res.data?.canEmpty === true, String(res.data?.canEmpty));

  let itemCard = res.data.items.find((item) => item.itemId === card.id);
  check(
    "card apagado aparece na lixeira com título, projeto e quem apagou",
    Boolean(itemCard) &&
      itemCard.type === "task" &&
      itemCard.title === "Card completo" &&
      itemCard.listName === "Projeto da lixeira" &&
      itemCard.deletedBy === dono.memberId,
    JSON.stringify(itemCard),
  );
  check(
    "item da lixeira mostra a data de vencimento calculada pelo plano",
    Boolean(itemCard?.expiresAt) &&
      Math.abs(new Date(itemCard.expiresAt) - new Date(itemCard.deletedAt) - 7 * 86400000) < 2000,
    `${itemCard?.deletedAt} -> ${itemCard?.expiresAt}`,
  );

  const { rows: guardadas } = await db.query(
    "SELECT snapshot FROM trash_items WHERE item_id = $1",
    [card.id],
  );
  const tabelas = guardadas[0]?.snapshot?.tables || {};
  check(
    "a lixeira guarda a cópia completa do card (subtarefa, comentário, checklist, responsável e etiqueta)",
    (tabelas.tasks || []).length === 2 &&
      (tabelas.task_comments || []).length === 1 &&
      (tabelas.checklists || []).length === 1 &&
      (tabelas.checklist_items || []).length === 1 &&
      (tabelas.task_assignees || []).length === 1 &&
      (tabelas.task_tags || []).length === 1,
    JSON.stringify(Object.fromEntries(Object.entries(tabelas).map(([t, l]) => [t, l.length]))),
  );

  // ---------- restaurar card ----------
  res = await api("POST", `/api/trash/${itemCard.id}/restore`, { token: dono.token });
  check("restaurar card = 200", res.status === 200, `${res.status} ${res.data?.message}`);

  const depois = await retratoDoCard(card.id);
  check(
    "card restaurado volta igualzinho (subtarefas, comentários, checklists, responsáveis e etiquetas)",
    JSON.stringify(antes) === JSON.stringify(depois),
    `antes=${JSON.stringify(antes)} depois=${JSON.stringify(depois)}`,
  );

  res = await api("GET", "/api/trash", { token: dono.token });
  check(
    "card restaurado sai da lixeira",
    !res.data.items.some((item) => item.itemId === card.id),
    JSON.stringify(res.data.items.map((i) => i.itemId)),
  );

  // ---------- anexo ----------
  res = await api("POST", `/api/workspaces/tasks/${card.id}/attachments`, {
    token: dono.token,
    body: { name: "contrato.pdf", type: "document", size: 1234 },
  });
  check("anexar arquivo ao card = 201", res.status === 201, `${res.status} ${res.data?.message}`);
  const anexoId = res.data?.attachment?.id;

  res = await api("DELETE", `/api/workspaces/attachments/${anexoId}`, { token: dono.token });
  check("apagar anexo do card = 200", res.status === 200, `${res.status} ${res.data?.message}`);

  res = await api("GET", "/api/trash", { token: dono.token });
  const itemAnexo = res.data.items.find((item) => item.itemId === anexoId);
  check(
    "anexo apagado aparece na lixeira com o nome do arquivo e o card de origem",
    Boolean(itemAnexo) && itemAnexo.type === "attachment" && itemAnexo.title === "contrato.pdf" && itemAnexo.taskTitle === "Card completo",
    JSON.stringify(itemAnexo),
  );

  const semAnexo = await retratoDoCard(card.id);
  check("card fica sem o anexo enquanto ele está na lixeira", semAnexo.anexos.length === 0, JSON.stringify(semAnexo.anexos));

  res = await api("POST", `/api/trash/${itemAnexo.id}/restore`, { token: dono.token });
  check("restaurar anexo = 200", res.status === 200, `${res.status} ${res.data?.message}`);
  const comAnexo = await retratoDoCard(card.id);
  check("anexo restaurado volta para o card", comAnexo.anexos.join() === "contrato.pdf", JSON.stringify(comAnexo.anexos));

  // ---------- projeto e a ordem de restauração ----------
  res = await api("DELETE", `/api/workspaces/tasks/${card.id}`, { token: dono.token });
  check("apagar de novo o card, agora junto com o projeto = 200", res.status === 200, String(res.status));

  res = await api("DELETE", `/api/workspaces/lists/${projetoId}`, { token: dono.token });
  check("apagar projeto = 200", res.status === 200, `${res.status} ${res.data?.message}`);

  res = await api("GET", "/api/trash", { token: dono.token });
  const itemProjeto = res.data.items.find((item) => item.itemId === projetoId);
  itemCard = res.data.items.find((item) => item.itemId === card.id);
  check(
    "projeto apagado aparece na lixeira com o nome do workspace",
    Boolean(itemProjeto) && itemProjeto.type === "list" && itemProjeto.title === "Projeto da lixeira" && Boolean(itemProjeto.workspaceName),
    JSON.stringify(itemProjeto),
  );

  res = await api("POST", `/api/trash/${itemCard.id}/restore`, { token: dono.token });
  check(
    "restaurar card de projeto apagado = 409 explicando que o projeto vem primeiro",
    res.status === 409 && /projeto/i.test(res.data?.message || ""),
    `${res.status} ${res.data?.message}`,
  );

  res = await api("POST", `/api/trash/${itemProjeto.id}/restore`, { token: dono.token });
  check("restaurar projeto = 200", res.status === 200, `${res.status} ${res.data?.message}`);

  res = await api("POST", `/api/trash/${itemCard.id}/restore`, { token: dono.token });
  check("com o projeto de volta, o card também restaura = 200", res.status === 200, `${res.status} ${res.data?.message}`);
  const voltou = await retratoDoCard(card.id);
  check("card restaurado depois do projeto volta inteiro", voltou.status === 200 && voltou.subtarefas.length === 1, JSON.stringify(voltou));

  // ---------- workspace ----------
  res = await api("DELETE", `/api/workspaces/${base.workspace_id}`, { token: dono.token });
  check("apagar workspace = 200", res.status === 200, `${res.status} ${res.data?.message}`);

  res = await api("GET", "/api/workspaces/seed", { token: dono.token });
  check(
    "workspace apagado some da tela",
    res.status === 200 && !Object.keys(res.data?.graph?.workspaces || {}).includes(base.workspace_id),
    JSON.stringify(Object.keys(res.data?.graph?.workspaces || {})),
  );

  res = await api("GET", "/api/trash", { token: dono.token });
  const itemWorkspace = res.data.items.find((item) => item.itemId === base.workspace_id);
  check(
    "workspace apagado aparece na lixeira",
    Boolean(itemWorkspace) && itemWorkspace.type === "workspace",
    JSON.stringify(itemWorkspace),
  );

  res = await api("POST", `/api/trash/${itemWorkspace.id}/restore`, { token: dono.token });
  check("restaurar workspace = 200", res.status === 200, `${res.status} ${res.data?.message}`);

  res = await api("GET", "/api/workspaces/seed", { token: dono.token });
  check(
    "workspace restaurado volta com os projetos",
    res.status === 200 &&
      Object.keys(res.data?.graph?.workspaces || {}).includes(base.workspace_id) &&
      Object.keys(res.data?.graph?.lists || {}).includes(projetoId),
    JSON.stringify(Object.keys(res.data?.graph?.workspaces || {})),
  );

  // ---------- excluir para sempre ----------
  const descartavel = await criarCardCompleto("Card para excluir de vez");
  res = await api("DELETE", `/api/workspaces/tasks/${descartavel.id}`, { token: dono.token });
  check("apagar card que será excluído de vez = 200", res.status === 200, String(res.status));

  res = await api("GET", "/api/trash", { token: dono.token });
  const itemDescartavel = res.data.items.find((item) => item.itemId === descartavel.id);

  res = await api("DELETE", `/api/trash/${itemDescartavel.id}`, { token: dono.token });
  check("excluir um item para sempre = 200", res.status === 200, `${res.status} ${res.data?.message}`);

  res = await api("GET", "/api/trash", { token: dono.token });
  check(
    "item excluído para sempre some da lixeira",
    !res.data.items.some((item) => item.itemId === descartavel.id),
    JSON.stringify(res.data.items.map((i) => i.itemId)),
  );

  res = await api("POST", `/api/trash/${itemDescartavel.id}/restore`, { token: dono.token });
  check("restaurar item já excluído para sempre = 404", res.status === 404, `${res.status} ${res.data?.message}`);

  // ---------- membro comum ----------
  res = await api("POST", "/api/invitations", {
    token: dono.token,
    body: { email: "lixeira-membro@test.com", accessRole: "member" },
  });
  check("convidar alguém para a conta = 201", res.status === 201, `${res.status} ${res.data?.message}`);

  const convite = "convite-da-lixeira-para-o-membro";
  await db.query("UPDATE organization_invitations SET token_hash = $1 WHERE email = $2", [
    crypto.createHash("sha256").update(convite).digest("hex"),
    "lixeira-membro@test.com",
  ]);

  res = await api("POST", "/api/invitations/accept-new", {
    body: { token: convite, name: "Membro Comum", password: "senha-forte-123" },
  });
  check("aceitar o convite criando o login = 201", res.status === 201, `${res.status} ${res.data?.message}`);
  const membro = { token: res.data?.token, memberId: res.data?.user?.id };
  check("quem aceita o convite entra como membro comum", res.data?.user?.organization?.role === "member", String(res.data?.user?.organization?.role));

  // O membro precisa poder editar o workspace para apagar os próprios cards.
  await db.query(
    "INSERT INTO workspace_members (workspace_id, member_id, permission_level) VALUES ($1, $2, 'Edição total') ON CONFLICT DO NOTHING",
    [base.workspace_id, membro.memberId],
  );

  res = await api("POST", "/api/workspaces/tasks", {
    token: membro.token,
    body: {
      workspaceId: base.workspace_id,
      spaceId: base.space_id,
      folderId: base.folder_id,
      listId: projetoId,
      title: "Card do membro",
      statusId,
    },
  });
  check("membro comum cria o próprio card = 201", res.status === 201, `${res.status} ${res.data?.message}`);
  const cardDoMembro = res.data?.task?.id || res.data?.id;

  res = await api("DELETE", `/api/workspaces/tasks/${cardDoMembro}`, { token: membro.token });
  check("membro comum apaga o próprio card = 200", res.status === 200, `${res.status} ${res.data?.message}`);

  // O titular apaga um card só dele, para conferir o que o membro enxerga.
  const cardDoDono = await criarCardCompleto("Card só do titular");
  await api("DELETE", `/api/workspaces/tasks/${cardDoDono.id}`, { token: dono.token });

  res = await api("GET", "/api/trash", { token: membro.token });
  const vistosPeloMembro = (res.data?.items || []).map((item) => item.itemId);
  check(
    "membro comum vê só o que ele mesmo apagou",
    vistosPeloMembro.includes(cardDoMembro) && !vistosPeloMembro.includes(cardDoDono.id),
    JSON.stringify(vistosPeloMembro),
  );
  check("membro comum não pode esvaziar a lixeira (botão escondido)", res.data?.canEmpty === false, String(res.data?.canEmpty));
  const itemDoMembro = res.data.items.find((item) => item.itemId === cardDoMembro);

  res = await api("POST", `/api/trash/${itemDoMembro.id}/restore`, { token: membro.token });
  check("quem apagou pode restaurar o próprio item = 200", res.status === 200, `${res.status} ${res.data?.message}`);

  const listaDoDono = await api("GET", "/api/trash", { token: dono.token });
  const itemDoDono = listaDoDono.data.items.find((item) => item.itemId === cardDoDono.id);
  check(
    "titular vê na lixeira o que os outros apagaram",
    Boolean(listaDoDono.data.items.find((item) => item.deletedBy === dono.memberId)),
    JSON.stringify(listaDoDono.data.items.map((i) => i.deletedBy)),
  );

  res = await api("POST", `/api/trash/${itemDoDono.id}/restore`, { token: membro.token });
  check("membro comum não restaura item de outra pessoa = 403", res.status === 403, `${res.status} ${res.data?.message}`);

  res = await api("DELETE", `/api/trash/${itemDoDono.id}`, { token: membro.token });
  check("membro comum não exclui de vez item de outra pessoa = 403", res.status === 403, `${res.status} ${res.data?.message}`);

  // ---------- esvaziar a lixeira ----------
  res = await api("DELETE", "/api/trash", { token: membro.token });
  check("membro comum não esvazia a lixeira = 403", res.status === 403, `${res.status} ${res.data?.message}`);

  res = await api("DELETE", "/api/trash", { token: dono.token });
  check("titular esvazia a lixeira = 200", res.status === 200, `${res.status} ${res.data?.message}`);

  res = await api("GET", "/api/trash", { token: dono.token });
  check("depois de esvaziar, a lixeira fica vazia", (res.data?.items || []).length === 0, JSON.stringify(res.data?.items));

  res = await api("GET", `/api/workspaces/tasks/${cardDoDono.id}`, { token: dono.token });
  check("card excluído no esvaziamento não volta mais", res.status !== 200, String(res.status));

  // =========================================================================
  // 2. LIMITES DE PLANO
  // =========================================================================

  // ---------- limite de workspaces ----------
  const limiteWs = await ctx.signup({ email: "lixeira-limite-ws@test.com", seed: 52 });
  res = await api("POST", "/api/workspaces", {
    token: limiteWs.token,
    body: { name: "Segundo workspace" },
  });
  check(
    "no plano Grátis (1 workspace), criar o segundo = 403 com código de limite",
    res.status === 403 && res.data?.code === "PLAN_LIMIT_WORKSPACES",
    `${res.status} ${res.data?.code} ${res.data?.message}`,
  );

  // ---------- limite de projetos ----------
  const limiteProj = await ctx.signup({ email: "lixeira-limite-projetos@test.com", seed: 53 });
  const baseProj = await estruturaInicial(db, limiteProj.organizationId);
  // A conta já tem o projeto de exemplo; o plano Grátis permite 3.
  const criados = [];
  for (const nome of ["Projeto 2", "Projeto 3"]) {
    const criacao = await api("POST", "/api/workspaces/lists", {
      token: limiteProj.token,
      body: { name: nome, folderId: baseProj.folder_id },
    });
    criados.push(criacao.status);
  }
  check("no plano Grátis dá para chegar aos 3 projetos", criados.every((s) => s === 201), JSON.stringify(criados));

  // Passar do limite deixa a conta acima do plano; a criação seguinte é barrada.
  // (o 4º projeto em si ainda passa: não há checagem na rota de criar projeto)
  await api("POST", "/api/workspaces/lists", {
    token: limiteProj.token,
    body: { name: "Projeto 4", folderId: baseProj.folder_id },
  });
  const { rows: contagem } = await db.query(
    `
      SELECT COUNT(*)::int AS total
      FROM lists l
      INNER JOIN folders f ON f.id = l.folder_id
      INNER JOIN spaces s ON s.id = f.space_id
      INNER JOIN workspaces w ON w.id = s.workspace_id
      WHERE w.organization_id = $1 AND w.deleted_at IS NULL AND l.deleted_at IS NULL
    `,
    [limiteProj.organizationId],
  );

  // Conta nova, já acima do limite de projetos, para medir o bloqueio sem o
  // cache de plano dos pedidos anteriores.
  const acimaProj = await ctx.signup({ email: "lixeira-projetos-estourado@test.com", seed: 54 });
  const baseAcima = await estruturaInicial(db, acimaProj.organizationId);
  for (let i = 0; i < 3; i += 1) {
    await db.query("INSERT INTO lists (id, folder_id, name, owner_id, visibility) VALUES ($1, $2, $3, $4, 'public')", [
      `list_lix_p${i}`,
      baseAcima.folder_id,
      `Projeto extra ${i}`,
      acimaProj.memberId,
    ]);
  }
  res = await api("POST", "/api/workspaces/lists", {
    token: acimaProj.token,
    body: { name: "Mais um projeto", folderId: baseAcima.folder_id },
  });
  check(
    "no plano Grátis, com o limite de projetos estourado, criar projeto = 403 com código de limite",
    res.status === 403 && res.data?.code === "PLAN_READ_ONLY" && (res.data?.limits || []).includes("projects"),
    `${res.status} ${res.data?.code} ${JSON.stringify(res.data?.limits)} (${contagem[0]?.total} projetos na outra conta)`,
  );

  // ---------- conta acima dos limites entra em somente leitura ----------
  const somenteLeitura = await ctx.signup({ email: "lixeira-somente-leitura@test.com", seed: 55 });
  const baseLeitura = await estruturaInicial(db, somenteLeitura.organizationId);
  await db.query(
    "INSERT INTO workspaces (id, organization_id, name, owner_id, visibility) VALUES ($1, $2, $3, $4, 'public')",
    ["ws_lix_extra", somenteLeitura.organizationId, "Workspace acima do plano", somenteLeitura.memberId],
  );

  res = await api("POST", "/api/workspaces/tasks", {
    token: somenteLeitura.token,
    body: {
      workspaceId: baseLeitura.workspace_id,
      spaceId: baseLeitura.space_id,
      folderId: baseLeitura.folder_id,
      listId: baseLeitura.list_id,
      title: "Não deveria entrar",
      statusId,
    },
  });
  check(
    "conta acima dos limites não cria mais nada = 403 somente leitura",
    res.status === 403 && res.data?.code === "PLAN_READ_ONLY" && (res.data?.limits || []).includes("workspaces"),
    `${res.status} ${res.data?.code} ${JSON.stringify(res.data?.limits)}`,
  );
  check(
    "a mensagem do somente leitura explica como voltar a editar",
    /plano|remova itens/i.test(res.data?.message || ""),
    String(res.data?.message),
  );

  res = await api("GET", "/api/workspaces/seed", { token: somenteLeitura.token });
  check("em somente leitura, continuar vendo tudo = 200", res.status === 200, String(res.status));

  const { rows: cardsExemplo } = await db.query(
    "SELECT id FROM tasks WHERE list_id = $1 AND parent_task_id IS NULL ORDER BY created_at ASC LIMIT 1",
    [baseLeitura.list_id],
  );
  res = await api("DELETE", `/api/workspaces/tasks/${cardsExemplo[0].id}`, { token: somenteLeitura.token });
  check(
    "em somente leitura, apagar continua liberado para caber no plano",
    res.status === 200,
    `${res.status} ${res.data?.message || res.data?.code}`,
  );

  res = await api("DELETE", "/api/workspaces/ws_lix_extra", { token: somenteLeitura.token });
  check("em somente leitura, apagar o workspace que estourou o plano = 200", res.status === 200, `${res.status} ${res.data?.message}`);

  // ---------- conta interna não tem bloqueio ----------
  const interna = await ctx.signup({ email: "lixeira-conta-interna@test.com", seed: 56 });
  await db.query("UPDATE organizations SET billing_exempt = true WHERE id = $1", [interna.organizationId]);
  await db.query(
    "INSERT INTO workspaces (id, organization_id, name, owner_id, visibility) VALUES ($1, $2, $3, $4, 'public')",
    ["ws_lix_interna", interna.organizationId, "Workspace extra da conta interna", interna.memberId],
  );

  res = await api("POST", "/api/workspaces", { token: interna.token, body: { name: "Mais um workspace" } });
  check(
    "conta interna cria workspace sem esbarrar no limite = 201",
    res.status === 201,
    `${res.status} ${res.data?.code || res.data?.message}`,
  );

  const baseInterna = await estruturaInicial(db, interna.organizationId);
  res = await api("POST", "/api/workspaces/lists", {
    token: interna.token,
    body: { name: "Projeto da conta interna", folderId: baseInterna.folder_id },
  });
  check("conta interna cria projeto sem bloqueio = 201", res.status === 201, `${res.status} ${res.data?.code || res.data?.message}`);

  res = await api("GET", "/api/trash", { token: interna.token });
  check("conta interna não tem prazo de lixeira (guarda para sempre)", res.data?.trashDays === -1, String(res.data?.trashDays));
};
