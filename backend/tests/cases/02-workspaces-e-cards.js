/**
 * Workspaces, projetos, cards e tudo que vive dentro de um card: subtarefas,
 * checklists, comentários, vínculos, capa, colunas de status, campos
 * personalizados e quem pode ver ou mexer em cada coisa.
 *
 * Os anexos (upload) ficam no arquivo de armazenamento; aqui só entram os
 * anexos gravados direto no banco, para poder testar a capa do card.
 */
module.exports = async function casosDeWorkspacesECards(ctx) {
  const { api, db, check } = ctx;

  const SENHA = "senha-forte-123";
  const grafo = async (token) => (await api("GET", "/api/workspaces/seed", { token })).data?.graph;
  const detalhe = (res) => `${res.status} ${res.data?.message || JSON.stringify(res.data)?.slice(0, 160)}`;

  // ---------------------------------------------------------------- contas
  const dono = await ctx.signup({
    email: "wcards-dono@test.com",
    accountType: "business",
    seed: 310,
    company: { cnpj: ctx.makeCnpj(310), name: "Cards Teste" },
  });

  // Conta isenta de cobrança: os limites de plano têm arquivo próprio.
  await db.query("UPDATE organizations SET billing_exempt = true WHERE id = $1", [dono.organizationId]);

  async function criaPessoa(email, nome, accessRole) {
    const criada = await api("POST", "/api/users", {
      token: dono.token,
      body: { name: nome, email, password: SENHA, accessRole },
    });
    if (criada.status !== 201) throw new Error(`não criou ${email}: ${detalhe(criada)}`);
    const login = await api("POST", "/api/auth/login", { body: { email, password: SENHA } });
    return { id: criada.data.user.id, nome, email, token: login.data?.token };
  }

  const membro = await criaPessoa("wcards-membro@test.com", "Membro Comum", "member");
  const outroAdmin = await criaPessoa("wcards-admin@test.com", "Outro Admin", "admin");
  const etiquetado = await criaPessoa("wcards-etiqueta@test.com", "Pessoa Etiquetada", "member");
  const deFora = await ctx.signup({ email: "wcards-fora@test.com", seed: 311 });

  // ---------------------------------------------------------------- etiquetas
  let res = await api("POST", "/api/tags", { token: dono.token, body: { name: "Urgente", color: "#ef4444" } });
  const tagUrgente = res.data?.tag;
  res = await api("POST", "/api/tags", { token: dono.token, body: { name: "Equipe Alfa", color: "#22c55e" } });
  const tagEquipe = res.data?.tag;
  check("criar etiqueta da conta = 201", res.status === 201 && Boolean(tagEquipe?.id), detalhe(res));

  // =========================================================== WORKSPACE ===
  res = await api("POST", "/api/workspaces", { token: dono.token, body: { description: "sem nome" } });
  check("criar workspace sem nome = 400", res.status === 400, detalhe(res));

  res = await api("POST", "/api/workspaces", {
    token: membro.token,
    body: { name: "Workspace do Membro" },
  });
  check("membro comum não pode criar workspace = 403", res.status === 403, detalhe(res));

  res = await api("POST", "/api/workspaces", {
    token: dono.token,
    body: {
      name: "Workspace Principal",
      description: "Onde o time trabalha",
      visibility: "private",
      icon: "Rocket",
      color: "#8b5cf6",
      defaultPermissionLevel: "Edição total",
    },
  });
  check("criar workspace = 201", res.status === 201 && Boolean(res.data?.id), detalhe(res));
  const w1 = res.data.id;

  let g = await grafo(dono.token);
  const wsCriado = g.workspaces[w1];
  const espacoGeralId = wsCriado?.spaceIds?.[0];
  const pastaGeralId = g.spaces[espacoGeralId]?.folderIds?.[0];
  check(
    "workspace novo já nasce com o espaço e a pasta Geral",
    g.spaces[espacoGeralId]?.name === "Geral" && g.folders[pastaGeralId]?.name === "Geral",
    JSON.stringify({ espaco: g.spaces[espacoGeralId]?.name, pasta: g.folders[pastaGeralId]?.name }),
  );
  check(
    "workspace novo guarda descrição, cor, ícone e visibilidade",
    wsCriado?.description === "Onde o time trabalha" &&
      wsCriado?.color === "#8b5cf6" &&
      wsCriado?.icon === "Rocket" &&
      wsCriado?.visibility === "private",
    JSON.stringify({ cor: wsCriado?.color, icone: wsCriado?.icon, visibilidade: wsCriado?.visibility }),
  );
  check("quem cria o workspace fica com edição total", wsCriado?.currentPermissionLevel === "Edição total", String(wsCriado?.currentPermissionLevel));

  res = await api("PUT", `/api/workspaces/${w1}`, {
    token: dono.token,
    body: {
      name: "Workspace Principal (renomeado)",
      description: "Onde o time trabalha",
      visibility: "private",
      icon: "Rocket",
      color: "#0ea5e9",
      defaultPermissionLevel: "Edição total",
      sharedMemberIds: [],
    },
  });
  check("renomear workspace = 200", res.status === 200, detalhe(res));
  g = await grafo(dono.token);
  check(
    "o novo nome e a nova cor aparecem no seed",
    g.workspaces[w1]?.name === "Workspace Principal (renomeado)" && g.workspaces[w1]?.color === "#0ea5e9",
    JSON.stringify({ nome: g.workspaces[w1]?.name, cor: g.workspaces[w1]?.color }),
  );

  res = await api("PUT", `/api/workspaces/${w1}`, {
    token: membro.token,
    body: { name: "invadido", visibility: "private", sharedMemberIds: [] },
  });
  check("membro sem acesso não renomeia o workspace = 403", res.status === 403, detalhe(res));

  res = await api("POST", "/api/workspaces", { token: dono.token, body: { name: "Workspace Descartável" } });
  const wDescartavel = res.data?.id;
  res = await api("DELETE", `/api/workspaces/${wDescartavel}`, { token: membro.token });
  check("membro sem acesso não apaga o workspace = 403", res.status === 403, detalhe(res));
  res = await api("DELETE", `/api/workspaces/${wDescartavel}`, { token: dono.token });
  check("apagar workspace = 200 e vai para a lixeira", res.status === 200, detalhe(res));
  g = await grafo(dono.token);
  check("workspace apagado some do seed", !g.workspaces[wDescartavel], String(Object.keys(g.workspaces).length));

  // ============================================================= PROJETOS ===
  res = await api("POST", "/api/workspaces/lists", { token: dono.token, body: { name: "Sem pasta" } });
  check("criar projeto sem pasta = 400", res.status === 400, detalhe(res));

  async function criaProjeto(nome, visibilidade, extra = {}) {
    const criado = await api("POST", "/api/workspaces/lists", {
      token: dono.token,
      body: { name: nome, folderId: pastaGeralId, visibility: visibilidade, ...extra },
    });
    if (criado.status !== 201) throw new Error(`não criou o projeto ${nome}: ${detalhe(criado)}`);
    return criado.data.list.id;
  }

  res = await api("POST", "/api/workspaces/lists", {
    token: dono.token,
    body: {
      name: "Projeto Aberto",
      folderId: pastaGeralId,
      visibility: "public",
      startDate: "2026-03-02",
      dueDate: "2026-04-30",
      color: "#f59e0b",
      tags: [tagUrgente],
    },
  });
  check("criar projeto = 201", res.status === 201 && Boolean(res.data?.list?.id), detalhe(res));
  const projetoAberto = res.data.list.id;
  check(
    "projeto novo guarda datas de início e prazo",
    String(res.data.list.startDate).startsWith("2026-03-02") && String(res.data.list.dueDate).startsWith("2026-04-30"),
    JSON.stringify({ inicio: res.data.list.startDate, prazo: res.data.list.dueDate }),
  );

  g = await grafo(dono.token);
  check(
    "projeto novo aparece dentro da pasta com a etiqueta",
    g.folders[pastaGeralId]?.listIds.includes(projetoAberto) &&
      (g.lists[projetoAberto]?.tags || []).some((t) => t.id === tagUrgente.id),
    JSON.stringify(g.lists[projetoAberto]?.tags),
  );

  res = await api("PUT", `/api/workspaces/lists/${projetoAberto}`, { token: dono.token, body: {} });
  check("editar projeto sem enviar campo algum = 400", res.status === 400, detalhe(res));

  res = await api("PUT", `/api/workspaces/lists/${projetoAberto}`, {
    token: dono.token,
    body: { name: "Projeto Aberto (2026)", color: "#10b981", dueDate: "2026-05-31", tags: [] },
  });
  check("editar projeto = 200", res.status === 200, detalhe(res));
  g = await grafo(dono.token);
  check(
    "o projeto editado mostra nome, cor, prazo e etiquetas novas",
    g.lists[projetoAberto]?.name === "Projeto Aberto (2026)" &&
      g.lists[projetoAberto]?.color === "#10b981" &&
      String(g.lists[projetoAberto]?.dueDate).startsWith("2026-05-31") &&
      (g.lists[projetoAberto]?.tags || []).length === 0,
    JSON.stringify({ nome: g.lists[projetoAberto]?.name, tags: g.lists[projetoAberto]?.tags }),
  );

  const projetoDescartavel = await criaProjeto("Projeto Descartável", "public");
  res = await api("DELETE", `/api/workspaces/lists/${projetoDescartavel}`, { token: dono.token });
  check("apagar projeto = 200", res.status === 200, detalhe(res));
  g = await grafo(dono.token);
  check("projeto apagado some do seed", !g.lists[projetoDescartavel], String(Object.keys(g.lists).length));

  res = await api("PUT", `/api/workspaces/lists/${projetoAberto}/assignees`, { token: dono.token, body: {} });
  check("atribuir projeto sem dizer quem = 400", res.status === 400, detalhe(res));

  // ================================================================ CARDS ===
  g = await grafo(dono.token);
  const colunaAFazer = g.statusDefinitions.find((s) => s.name === "A Fazer" && !s.listId);
  const colunaConcluido = g.statusDefinitions.find((s) => s.name === "Concluído" && !s.listId);
  check("as colunas padrão vêm no seed", Boolean(colunaAFazer?.id) && Boolean(colunaConcluido?.id), JSON.stringify(g.statusDefinitions.map((s) => s.name)));

  res = await api("POST", "/api/workspaces/tasks", {
    token: dono.token,
    body: { listId: projetoAberto, workspaceId: w1 },
  });
  check("criar card sem título = 400", res.status === 400, detalhe(res));

  async function criaCard(titulo, listId, extra = {}) {
    const criado = await api("POST", "/api/workspaces/tasks", {
      token: dono.token,
      body: {
        workspaceId: w1,
        spaceId: espacoGeralId,
        folderId: pastaGeralId,
        listId,
        title: titulo,
        statusId: colunaAFazer.id,
        ...extra,
      },
    });
    if (criado.status !== 201) throw new Error(`não criou o card ${titulo}: ${detalhe(criado)}`);
    return criado.data.task.id;
  }

  res = await api("POST", "/api/workspaces/tasks", {
    token: dono.token,
    body: {
      workspaceId: w1,
      spaceId: espacoGeralId,
      folderId: pastaGeralId,
      listId: projetoAberto,
      title: "Publicar a nova página",
      descriptionText: "<p>Revisar os textos antes</p>",
      statusId: colunaAFazer.id,
      priority: "high",
      visibility: "public",
      startDate: "2026-03-10",
      dueDate: "2026-03-20",
      estimate: "8h",
      assigneeIds: [dono.memberId],
      tags: [tagUrgente],
    },
  });
  check("criar card = 201", res.status === 201 && Boolean(res.data?.task?.id), detalhe(res));
  const cardPrincipal = res.data.task.id;

  res = await api("GET", `/api/workspaces/tasks/${cardPrincipal}`, { token: dono.token });
  const cardLido = res.data?.task;
  check(
    "o card guarda prioridade, datas, estimativa, responsável e etiqueta",
    cardLido?.priority === "high" &&
      String(cardLido?.startDate).startsWith("2026-03-10") &&
      String(cardLido?.dueDate).startsWith("2026-03-20") &&
      cardLido?.estimate === "8h" &&
      cardLido?.assigneeIds?.includes(dono.memberId) &&
      (cardLido?.tags || []).some((t) => t.id === tagUrgente.id),
    JSON.stringify({
      prioridade: cardLido?.priority,
      estimativa: cardLido?.estimate,
      responsaveis: cardLido?.assigneeIds,
      etiquetas: (cardLido?.tags || []).map((t) => t.name),
    }),
  );
  check("o card guarda a descrição em HTML", cardLido?.description?.value === "<p>Revisar os textos antes</p>", JSON.stringify(cardLido?.description));
  check("o card nasce com o registro de criação no histórico", (cardLido?.activities || []).some((a) => a.description === "criou esta tarefa."), JSON.stringify((cardLido?.activities || []).map((a) => a.description)));

  res = await api("PUT", `/api/workspaces/tasks/${cardPrincipal}`, {
    token: dono.token,
    body: {
      title: "Publicar a nova página (revisado)",
      priority: "urgent",
      dueDate: "2026-03-25",
      estimate: "12h",
      assigneeIds: [dono.memberId, membro.id],
      tags: [],
    },
  });
  check("editar o card = 200", res.status === 200, detalhe(res));

  res = await api("GET", `/api/workspaces/tasks/${cardPrincipal}`, { token: dono.token });
  const cardEditado = res.data?.task;
  check(
    "a edição troca título, prioridade, prazo, estimativa, responsáveis e etiquetas",
    cardEditado?.title === "Publicar a nova página (revisado)" &&
      cardEditado?.priority === "urgent" &&
      String(cardEditado?.dueDate).startsWith("2026-03-25") &&
      cardEditado?.estimate === "12h" &&
      cardEditado?.assigneeIds?.length === 2 &&
      (cardEditado?.tags || []).length === 0,
    JSON.stringify({ titulo: cardEditado?.title, responsaveis: cardEditado?.assigneeIds, etiquetas: cardEditado?.tags }),
  );
  check(
    "a edição fica registrada no histórico do card",
    (cardEditado?.activities || []).some((a) => a.description.includes("prioridade")) &&
      (cardEditado?.activities || []).some((a) => a.description.includes("responsáveis")),
    JSON.stringify((cardEditado?.activities || []).map((a) => a.description)),
  );

  res = await api("PUT", `/api/workspaces/tasks/${cardPrincipal}`, {
    token: dono.token,
    body: { statusId: colunaConcluido.id },
  });
  check("mover o card de coluna = 200", res.status === 200, detalhe(res));
  g = await grafo(dono.token);
  check("o card aparece na nova coluna", g.tasks[cardPrincipal]?.statusId === colunaConcluido.id, String(g.tasks[cardPrincipal]?.statusId));

  const cardDescartavel = await criaCard("Card Descartável", projetoAberto);
  res = await api("DELETE", `/api/workspaces/tasks/${cardDescartavel}`, { token: dono.token });
  check("apagar card = 200", res.status === 200, detalhe(res));
  res = await api("GET", `/api/workspaces/tasks/${cardDescartavel}`, { token: dono.token });
  check("card apagado não é mais encontrado = 404", res.status === 404, detalhe(res));

  // =========================================================== SUBTAREFAS ===
  res = await api("POST", `/api/workspaces/tasks/${cardPrincipal}/subtasks`, { token: dono.token, body: {} });
  check("criar subtarefa sem título = 400", res.status === 400, detalhe(res));

  res = await api("POST", `/api/workspaces/tasks/${cardPrincipal}/subtasks`, {
    token: dono.token,
    body: { title: "Revisar os textos" },
  });
  check("criar subtarefa = 201", res.status === 201 && Boolean(res.data?.subtask?.id), detalhe(res));
  const subtarefa = res.data.subtask.id;
  g = await grafo(dono.token);
  check("a subtarefa aparece pendurada no card pai", (g.tasks[cardPrincipal]?.subtaskIds || []).includes(subtarefa), JSON.stringify(g.tasks[cardPrincipal]?.subtaskIds));
  check("a subtarefa nasce na coluna Subtarefas", g.tasks[subtarefa]?.statusId === "status_subtasks", String(g.tasks[subtarefa]?.statusId));

  // ============================================================ CHECKLISTS ===
  res = await api("POST", `/api/workspaces/tasks/${cardPrincipal}/checklists`, {
    token: dono.token,
    body: { name: "Antes de publicar" },
  });
  check("criar checklist = 201", res.status === 201 && Boolean(res.data?.checklist?.id), detalhe(res));
  const checklist = res.data.checklist.id;

  res = await api("PUT", `/api/workspaces/checklists/${checklist}`, { token: dono.token, body: { name: "Checagem final" } });
  check("renomear checklist = 200", res.status === 200, detalhe(res));

  res = await api("POST", `/api/workspaces/checklists/${checklist}/items`, { token: dono.token, body: { label: "Conferir as imagens" } });
  check("criar item de checklist = 201", res.status === 201 && Boolean(res.data?.item?.id), detalhe(res));
  const item1 = res.data.item.id;
  res = await api("POST", `/api/workspaces/checklists/${checklist}/items`, { token: dono.token, body: { label: "Conferir os links" } });
  const item2 = res.data.item.id;

  res = await api("PUT", `/api/workspaces/checklist-items/${item1}/toggle`, { token: dono.token });
  check("marcar item da checklist = 200", res.status === 200, detalhe(res));

  res = await api("PUT", `/api/workspaces/checklist-items/${item2}`, { token: dono.token, body: { label: "Conferir os links externos" } });
  check("renomear item da checklist = 200", res.status === 200, detalhe(res));

  res = await api("PUT", `/api/workspaces/checklist-items/${item2}/assignees`, { token: dono.token, body: { memberId: membro.id } });
  check("atribuir item da checklist a alguém = 200", res.status === 200, detalhe(res));

  g = await grafo(dono.token);
  const checklistLida = (g.tasks[cardPrincipal]?.checklists || [])[0];
  check(
    "a checklist aparece no card com o nome novo e os dois itens",
    checklistLida?.name === "Checagem final" && checklistLida?.items?.length === 2,
    JSON.stringify(checklistLida),
  );
  check(
    "o item marcado fica concluído e o outro tem responsável",
    checklistLida?.items?.find((i) => i.id === item1)?.done === true &&
      checklistLida?.items?.find((i) => i.id === item2)?.assigneeIds?.includes(membro.id),
    JSON.stringify(checklistLida?.items),
  );

  res = await api("PUT", `/api/workspaces/checklist-items/${item2}/assignees`, { token: dono.token, body: { memberId: membro.id } });
  g = await grafo(dono.token);
  check(
    "atribuir de novo a mesma pessoa tira o responsável",
    ((g.tasks[cardPrincipal]?.checklists || [])[0]?.items?.find((i) => i.id === item2)?.assigneeIds || []).length === 0,
    JSON.stringify((g.tasks[cardPrincipal]?.checklists || [])[0]?.items),
  );

  res = await api("DELETE", `/api/workspaces/checklist-items/${item2}`, { token: dono.token });
  check("apagar item da checklist = 200", res.status === 200, detalhe(res));
  res = await api("DELETE", `/api/workspaces/checklists/${checklist}`, { token: dono.token });
  check("apagar checklist = 200", res.status === 200, detalhe(res));
  g = await grafo(dono.token);
  check("a checklist apagada some do card", (g.tasks[cardPrincipal]?.checklists || []).length === 0, JSON.stringify(g.tasks[cardPrincipal]?.checklists));

  // =========================================================== COMENTÁRIOS ===
  res = await api("POST", `/api/workspaces/tasks/${cardPrincipal}/comments`, { token: dono.token, body: { content: "   " } });
  check("comentário vazio e sem anexo = 400", res.status === 400, detalhe(res));

  res = await api("POST", `/api/workspaces/tasks/${cardPrincipal}/comments`, {
    token: dono.token,
    body: { content: "Vamos publicar na sexta?" },
  });
  check("comentar no card = 201", res.status === 201 && Boolean(res.data?.comment?.id), detalhe(res));
  const comentario = res.data.comment.id;

  res = await api("POST", `/api/workspaces/tasks/${cardPrincipal}/comments`, {
    token: dono.token,
    body: { content: "Por mim pode ser.", parentId: comentario },
  });
  check("responder a um comentário = 201", res.status === 201, detalhe(res));
  const resposta = res.data.comment.id;

  res = await api("PUT", `/api/workspaces/comments/${comentario}`, { token: dono.token, body: { content: "Vamos publicar na quinta?" } });
  check("editar o próprio comentário = 200", res.status === 200, detalhe(res));

  res = await api("GET", `/api/workspaces/tasks/${cardPrincipal}`, { token: dono.token });
  const comentarios = res.data?.comments || [];
  check(
    "o comentário editado mostra o texto novo e a marca de edição",
    comentarios.find((c) => c.id === comentario)?.content === "Vamos publicar na quinta?" &&
      Boolean(comentarios.find((c) => c.id === comentario)?.editedAt),
    JSON.stringify(comentarios.find((c) => c.id === comentario)),
  );
  check("a resposta fica ligada ao comentário de origem", comentarios.find((c) => c.id === resposta)?.parentId === comentario, JSON.stringify(comentarios.find((c) => c.id === resposta)));

  res = await api("PUT", `/api/workspaces/comments/${comentario}/like`, { token: dono.token, body: { liked: true } });
  check("curtir comentário = 200", res.status === 200 && res.data?.comment?.likedByMe === true, detalhe(res));
  res = await api("PUT", `/api/workspaces/comments/${comentario}/like`, { token: dono.token, body: { liked: false } });
  check("descurtir comentário = 200", res.status === 200 && res.data?.comment?.likedByMe === false, detalhe(res));

  res = await api("PUT", `/api/workspaces/comments/${comentario}/reaction`, { token: dono.token, body: { emoji: "🎉" } });
  check("reagir ao comentário com emoji = 200", res.status === 200 && res.data?.comment?.reaction === "🎉", detalhe(res));
  res = await api("PUT", `/api/workspaces/comments/${comentario}/reaction`, { token: dono.token, body: { emoji: "" } });
  check("tirar a reação do comentário = 200", res.status === 200 && res.data?.comment?.reaction === null, detalhe(res));

  res = await api("DELETE", `/api/workspaces/comments/${comentario}`, { token: dono.token });
  check("apagar o próprio comentário = 200", res.status === 200, detalhe(res));
  res = await api("GET", `/api/workspaces/tasks/${cardPrincipal}`, { token: dono.token });
  check(
    "apagar o comentário leva as respostas junto",
    !(res.data?.comments || []).some((c) => c.id === comentario || c.id === resposta),
    JSON.stringify((res.data?.comments || []).map((c) => c.id)),
  );

  // =============================================================== VÍNCULOS ===
  const cardVizinho = await criaCard("Ajustar o banner", projetoAberto);

  res = await api("POST", `/api/workspaces/tasks/${cardPrincipal}/links`, { token: dono.token, body: {} });
  check("vincular sem dizer o card = 400", res.status === 400, detalhe(res));

  res = await api("POST", `/api/workspaces/tasks/${cardPrincipal}/links`, { token: dono.token, body: { linkedTaskId: cardVizinho } });
  check("vincular dois cards = 201", res.status === 201, detalhe(res));
  g = await grafo(dono.token);
  check(
    "o vínculo aparece nos dois cards",
    (g.tasks[cardPrincipal]?.linkedTaskIds || []).includes(cardVizinho) &&
      (g.tasks[cardVizinho]?.linkedTaskIds || []).includes(cardPrincipal),
    JSON.stringify({ a: g.tasks[cardPrincipal]?.linkedTaskIds, b: g.tasks[cardVizinho]?.linkedTaskIds }),
  );

  res = await api("DELETE", `/api/workspaces/tasks/${cardPrincipal}/links/${cardVizinho}`, { token: dono.token });
  check("desvincular os cards = 200", res.status === 200, detalhe(res));
  g = await grafo(dono.token);
  check(
    "o vínculo some dos dois cards",
    (g.tasks[cardPrincipal]?.linkedTaskIds || []).length === 0 && (g.tasks[cardVizinho]?.linkedTaskIds || []).length === 0,
    JSON.stringify({ a: g.tasks[cardPrincipal]?.linkedTaskIds, b: g.tasks[cardVizinho]?.linkedTaskIds }),
  );

  // =================================================================== CAPA ===
  await db.query(
    "INSERT INTO task_attachments (id, task_id, name, url, type, size, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    ["att_wcards_img", cardPrincipal, "capa.png", "https://exemplo/capa.png", "image", 2048, dono.memberId],
  );
  await db.query(
    "INSERT INTO task_attachments (id, task_id, name, url, type, size, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    ["att_wcards_doc", cardPrincipal, "contrato.pdf", "https://exemplo/contrato.pdf", "document", 4096, dono.memberId],
  );
  await db.query(
    "INSERT INTO task_attachments (id, task_id, name, url, type, size, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    ["att_wcards_outro", cardVizinho, "outra.png", "https://exemplo/outra.png", "image", 2048, dono.memberId],
  );

  res = await api("PUT", `/api/workspaces/tasks/${cardPrincipal}`, { token: dono.token, body: { coverAttachmentId: "att_inexistente" } });
  check("capa com anexo inexistente = 400", res.status === 400, detalhe(res));

  res = await api("PUT", `/api/workspaces/tasks/${cardPrincipal}`, { token: dono.token, body: { coverAttachmentId: "att_wcards_outro" } });
  check("capa com anexo de outro card = 400", res.status === 400, detalhe(res));

  res = await api("PUT", `/api/workspaces/tasks/${cardPrincipal}`, { token: dono.token, body: { coverAttachmentId: "att_wcards_doc" } });
  check("capa precisa ser imagem, não documento = 400", res.status === 400, detalhe(res));

  res = await api("PUT", `/api/workspaces/tasks/${cardPrincipal}`, { token: dono.token, body: { coverAttachmentId: "att_wcards_img" } });
  check("definir a capa do card = 200", res.status === 200, detalhe(res));
  g = await grafo(dono.token);
  check("a capa aparece no card", g.tasks[cardPrincipal]?.coverAttachmentId === "att_wcards_img", String(g.tasks[cardPrincipal]?.coverAttachmentId));

  res = await api("PUT", `/api/workspaces/tasks/${cardPrincipal}`, { token: dono.token, body: { coverAttachmentId: null } });
  g = await grafo(dono.token);
  check("remover a capa do card = 200", res.status === 200 && !g.tasks[cardPrincipal]?.coverAttachmentId, detalhe(res));

  // ================================================== COLUNAS DE STATUS ===
  const projetoColunas = await criaProjeto("Projeto das Colunas", "public");

  res = await api("POST", `/api/workspaces/lists/${projetoColunas}/statuses`, { token: membro.token, body: { name: "Coluna do membro" } });
  check("só administrador cria coluna = 403", res.status === 403, detalhe(res));

  res = await api("POST", `/api/workspaces/lists/${projetoColunas}/statuses`, { token: dono.token, body: {} });
  check("criar coluna sem nome = 400", res.status === 400, detalhe(res));

  res = await api("POST", `/api/workspaces/lists/${projetoColunas}/statuses`, {
    token: dono.token,
    body: { name: "Aguardando cliente", colorClass: "bg-amber-50", chipClass: "bg-amber-100", dotClass: "bg-amber-500" },
  });
  check("criar coluna do projeto = 201", res.status === 201 && Boolean(res.data?.status?.id), detalhe(res));
  const colunaNova = res.data.status.id;

  g = await grafo(dono.token);
  check(
    "a coluna nova pertence só a esse projeto",
    g.statusDefinitions.find((s) => s.id === colunaNova)?.listId === projetoColunas,
    JSON.stringify(g.statusDefinitions.find((s) => s.id === colunaNova)),
  );

  res = await api("PUT", `/api/workspaces/statuses/${colunaNova}`, { token: dono.token, body: { listId: projetoColunas } });
  check("renomear coluna sem nome = 400", res.status === 400, detalhe(res));
  res = await api("PUT", `/api/workspaces/statuses/${colunaNova}`, { token: dono.token, body: { name: "Aguardando" } });
  check("renomear coluna sem dizer o projeto = 400", res.status === 400, detalhe(res));
  res = await api("PUT", `/api/workspaces/statuses/${colunaNova}`, { token: membro.token, body: { name: "Aguardando", listId: projetoColunas } });
  check("só administrador renomeia coluna = 403", res.status === 403, detalhe(res));

  res = await api("PUT", `/api/workspaces/statuses/${colunaNova}`, {
    token: dono.token,
    body: { name: "Aguardando retorno", listId: projetoColunas },
  });
  check("renomear coluna do projeto = 200", res.status === 200, detalhe(res));
  g = await grafo(dono.token);
  check("o nome novo da coluna aparece no seed", g.statusDefinitions.find((s) => s.id === colunaNova)?.name === "Aguardando retorno", JSON.stringify(g.statusDefinitions.find((s) => s.id === colunaNova)));

  res = await api("PUT", `/api/workspaces/statuses/${colunaNova}`, { token: dono.token, body: { name: "Invasão", listId: projetoAberto } });
  check("não dá para editar a coluna de outro projeto = 403", res.status === 403, detalhe(res));

  // Editar uma coluna global dentro de um projeto cria uma cópia só dele e
  // esconde a global ali, sem mexer nos outros projetos.
  const cardDaColuna = await criaCard("Card na coluna A Fazer", projetoColunas);
  res = await api("PUT", `/api/workspaces/statuses/${colunaAFazer.id}`, {
    token: dono.token,
    body: { name: "A Fazer (deste projeto)", listId: projetoColunas },
  });
  check("editar coluna global dentro de um projeto cria uma cópia dele = 200", res.status === 200 && res.data?.forkedFrom === colunaAFazer.id && res.data?.status?.id !== colunaAFazer.id, detalhe(res));
  const colunaCopiada = res.data?.status?.id;

  g = await grafo(dono.token);
  check(
    "a coluna global fica escondida só nesse projeto",
    (g.statusDefinitions.find((s) => s.id === colunaAFazer.id)?.hiddenListIds || []).includes(projetoColunas) &&
      !(g.statusDefinitions.find((s) => s.id === colunaAFazer.id)?.hiddenListIds || []).includes(projetoAberto),
    JSON.stringify(g.statusDefinitions.find((s) => s.id === colunaAFazer.id)?.hiddenListIds),
  );
  check("a coluna global continua com o nome original para os outros projetos", g.statusDefinitions.find((s) => s.id === colunaAFazer.id)?.name === "A Fazer", String(g.statusDefinitions.find((s) => s.id === colunaAFazer.id)?.name));
  check("os cards do projeto passam para a cópia da coluna", g.tasks[cardDaColuna]?.statusId === colunaCopiada, String(g.tasks[cardDaColuna]?.statusId));

  res = await api("PUT", "/api/workspaces/statuses/reorder", { token: dono.token, body: { orders: [] } });
  check("reordenar colunas sem lista = 400", res.status === 400, detalhe(res));

  res = await api("PUT", "/api/workspaces/statuses/reorder", {
    token: dono.token,
    body: { orders: [{ id: colunaNova, order: 1 }, { id: colunaAFazer.id, order: 9 }] },
  });
  check("reordenar colunas = 200", res.status === 200, detalhe(res));
  g = await grafo(dono.token);
  check(
    "a nova ordem das colunas aparece no seed",
    g.statusDefinitions.find((s) => s.id === colunaNova)?.order === 1 &&
      g.statusDefinitions.find((s) => s.id === colunaAFazer.id)?.order === 9,
    JSON.stringify(g.statusDefinitions.map((s) => [s.name, s.order])),
  );

  // ================================================= CAMPOS PERSONALIZADOS ===
  res = await api("POST", "/api/workspaces", { token: dono.token, body: { name: "Workspace dos Campos", visibility: "private" } });
  const wCampos = res.data.id;
  g = await grafo(dono.token);
  const pastaCampos = g.spaces[g.workspaces[wCampos].spaceIds[0]].folderIds[0];
  res = await api("POST", "/api/workspaces/lists", {
    token: dono.token,
    body: { name: "Projeto dos Campos", folderId: pastaCampos, visibility: "public" },
  });
  const projetoCampos = res.data.list.id;

  res = await api("POST", `/api/workspaces/${wCampos}/custom-fields`, { token: dono.token, body: { type: "text" } });
  check("criar campo personalizado sem nome = 400", res.status === 400, detalhe(res));
  res = await api("POST", `/api/workspaces/${wCampos}/custom-fields`, { token: dono.token, body: { name: "Qualquer", type: "arquivo" } });
  check("criar campo personalizado com tipo inválido = 400", res.status === 400, detalhe(res));
  res = await api("POST", `/api/workspaces/${wCampos}/custom-fields`, { token: dono.token, body: { name: "Setor", type: "single_select", options: [] } });
  check("campo de seleção precisa de opções = 400", res.status === 400, detalhe(res));
  res = await api("POST", `/api/workspaces/${wCampos}/custom-fields`, { token: membro.token, body: { name: "Invasor", type: "text" } });
  check("membro sem acesso não cria campo personalizado = 403", res.status === 403, detalhe(res));

  res = await api("POST", `/api/workspaces/${wCampos}/custom-fields`, { token: dono.token, body: { name: "Orçamento", type: "number" } });
  check("criar campo numérico = 201", res.status === 201, detalhe(res));
  const campoNumero = res.data.field.id;

  res = await api("POST", `/api/workspaces/${wCampos}/custom-fields`, {
    token: dono.token,
    body: { name: "Setor", type: "single_select", options: [{ label: "Marketing" }, { label: "Vendas" }] },
  });
  check("criar campo de seleção = 201", res.status === 201 && res.data?.field?.options?.length === 2, detalhe(res));
  const campoSelecao = res.data.field.id;
  const opcaoMarketing = res.data.field.options[0].id;

  res = await api("GET", `/api/workspaces/${wCampos}/custom-fields`, { token: dono.token });
  check("listar campos personalizados do workspace = 200 com os dois campos", res.status === 200 && res.data?.fields?.length === 2, detalhe(res));

  async function criaCardCampos(titulo, customFieldValues) {
    return api("POST", "/api/workspaces/tasks", {
      token: dono.token,
      body: {
        workspaceId: wCampos,
        listId: projetoCampos,
        title: titulo,
        statusId: colunaConcluido.id,
        customFieldValues,
      },
    });
  }

  res = await criaCardCampos("Card com número errado", { [campoNumero]: "muito caro" });
  check("valor não numérico num campo numérico = 400", res.status === 400, detalhe(res));

  res = await criaCardCampos("Card com opção inexistente", { [campoSelecao]: "Jurídico" });
  check("opção inexistente num campo de seleção = 400", res.status === 400, detalhe(res));

  res = await criaCardCampos("Card com campos preenchidos", { [campoNumero]: "1500,50", [campoSelecao]: opcaoMarketing });
  check("criar card com campos personalizados = 201", res.status === 201, detalhe(res));
  const cardCampos = res.data.task.id;
  check(
    "o campo numérico aceita vírgula e guarda o número",
    res.data.task.customFieldValues?.[campoNumero] === 1500.5 && res.data.task.customFieldValues?.[campoSelecao] === opcaoMarketing,
    JSON.stringify(res.data.task.customFieldValues),
  );

  g = await grafo(dono.token);
  check(
    "os valores dos campos personalizados aparecem no seed",
    g.tasks[cardCampos]?.customFieldValues?.[campoNumero] === 1500.5,
    JSON.stringify(g.tasks[cardCampos]?.customFieldValues),
  );
  check(
    "as definições dos campos vêm no seed ligadas ao workspace",
    (g.workspaces[wCampos]?.customFieldIds || []).length === 2 && Boolean(g.customFieldDefinitions[campoNumero]),
    JSON.stringify(g.workspaces[wCampos]?.customFieldIds),
  );

  res = await api("PUT", `/api/workspaces/${wCampos}/custom-fields/${campoNumero}`, {
    token: dono.token,
    body: { name: "Orçamento aprovado", type: "number", required: true },
  });
  check("editar campo personalizado = 200", res.status === 200 && res.data?.field?.name === "Orçamento aprovado", detalhe(res));

  res = await criaCardCampos("Card sem o obrigatório", { [campoSelecao]: opcaoMarketing });
  check("campo obrigatório vazio barra a criação do card = 400", res.status === 400 && String(res.data?.message).includes("obrigatório"), detalhe(res));

  res = await api("PUT", `/api/workspaces/tasks/${cardCampos}`, { token: dono.token, body: { customFieldValues: {} } });
  check("campo obrigatório vazio barra a edição do card = 400", res.status === 400, detalhe(res));

  res = await api("PUT", `/api/workspaces/tasks/${cardCampos}`, {
    token: dono.token,
    body: { customFieldValues: { [campoNumero]: 99, [campoSelecao]: opcaoMarketing } },
  });
  check("editar os valores dos campos personalizados = 200", res.status === 200, detalhe(res));
  g = await grafo(dono.token);
  check("o valor novo do campo aparece no card", g.tasks[cardCampos]?.customFieldValues?.[campoNumero] === 99, JSON.stringify(g.tasks[cardCampos]?.customFieldValues));

  res = await api("DELETE", `/api/workspaces/${wCampos}/custom-fields/${campoNumero}`, { token: dono.token });
  check("apagar campo personalizado = 200", res.status === 200, detalhe(res));
  res = await api("DELETE", `/api/workspaces/${wCampos}/custom-fields/${campoNumero}`, { token: dono.token });
  check("apagar campo já apagado = 404", res.status === 404, detalhe(res));
  g = await grafo(dono.token);
  check("o campo apagado some do seed", !g.customFieldDefinitions[campoNumero], JSON.stringify(Object.keys(g.customFieldDefinitions)));

  // =========================================================== PERMISSÕES ===
  // Workspace fechado: privado e sem nenhum projeto público dentro.
  res = await api("POST", "/api/workspaces", { token: dono.token, body: { name: "Workspace Fechado", visibility: "private" } });
  const wFechado = res.data.id;
  g = await grafo(dono.token);
  const pastaFechada = g.spaces[g.workspaces[wFechado].spaceIds[0]].folderIds[0];
  res = await api("POST", "/api/workspaces/lists", {
    token: dono.token,
    body: { name: "Projeto Fechado", folderId: pastaFechada, visibility: "private" },
  });
  const projetoFechado = res.data.list.id;
  const cardFechado = await criaCard("Tarefa do workspace fechado", projetoFechado, {
    workspaceId: wFechado,
    spaceId: g.workspaces[wFechado].spaceIds[0],
    folderId: pastaFechada,
    visibility: "private",
  });

  let gMembro = await grafo(membro.token);
  check("workspace privado sem projeto público não aparece para quem não é membro", !gMembro.workspaces[wFechado], JSON.stringify(Object.keys(gMembro.workspaces)));
  check("o seed não traz os cards do workspace fechado", !gMembro.tasks[cardFechado], JSON.stringify(Object.keys(gMembro.tasks)));

  res = await api("GET", `/api/workspaces/tasks/${cardFechado}`, { token: membro.token });
  check("card privado de workspace fechado não abre para quem não tem acesso = 403", res.status === 403, detalhe(res));
  const cardFechadoPublico = await criaCard("Tarefa comum do workspace fechado", projetoFechado, {
    workspaceId: wFechado,
    spaceId: g.workspaces[wFechado].spaceIds[0],
    folderId: pastaFechada,
  });
  res = await api("GET", `/api/workspaces/tasks/${cardFechadoPublico}`, { token: deFora.token });
  check("card desta conta não abre para quem é de outra empresa = 404", res.status === 404, detalhe(res));

  res = await api("POST", "/api/workspaces/lists", { token: membro.token, body: { name: "Projeto invasor", folderId: pastaFechada } });
  check("quem não tem acesso não cria projeto na pasta = 403", res.status === 403, detalhe(res));

  // Um projeto público abre o workspace privado para a conta inteira.
  check("workspace privado com projeto público fica visível para a conta toda", Boolean(gMembro.workspaces[w1]) && Boolean(gMembro.lists[projetoAberto]), JSON.stringify(Object.keys(gMembro.workspaces)));

  // Compartilhar só para exibição.
  const compartilhar = (nivel) =>
    api("PUT", `/api/workspaces/${w1}`, {
      token: dono.token,
      body: {
        name: "Workspace Principal (renomeado)",
        description: "Onde o time trabalha",
        visibility: "private",
        icon: "Rocket",
        color: "#0ea5e9",
        defaultPermissionLevel: nivel,
        sharedMemberIds: [membro.id],
      },
    });

  res = await compartilhar("Apenas exibição");
  check("compartilhar o workspace com alguém = 200", res.status === 200, detalhe(res));

  gMembro = await grafo(membro.token);
  check("quem recebeu o workspace passa a vê-lo no seed", Boolean(gMembro.workspaces[w1]), JSON.stringify(Object.keys(gMembro.workspaces)));
  check("o nível de acesso do workspace é apenas exibição", gMembro.workspaces[w1]?.currentPermissionLevel === "Apenas exibição", String(gMembro.workspaces[w1]?.currentPermissionLevel));
  check("com apenas exibição a pessoa vê o projeto público", Boolean(gMembro.lists[projetoAberto]), JSON.stringify(Object.keys(gMembro.lists)));

  // cardVizinho não tem responsáveis: vale só o nível do workspace.
  res = await api("PUT", `/api/workspaces/tasks/${cardVizinho}`, { token: membro.token, body: { title: "não pode" } });
  check("quem só pode exibir não edita o card = 403", res.status === 403, detalhe(res));
  res = await api("POST", `/api/workspaces/tasks/${cardVizinho}/comments`, { token: membro.token, body: { content: "posso?" } });
  check("quem só pode exibir não comenta = 403", res.status === 403, detalhe(res));
  res = await api("POST", `/api/workspaces/tasks/${cardPrincipal}/comments`, { token: membro.token, body: { content: "Sou responsável por esta." } });
  check("mesmo só podendo exibir, o responsável pelo card comenta nele = 201", res.status === 201, detalhe(res));

  res = await compartilhar("Comentário");
  gMembro = await grafo(membro.token);
  check("mudar o nível para comentário reflete no seed", gMembro.workspaces[w1]?.currentPermissionLevel === "Comentário", String(gMembro.workspaces[w1]?.currentPermissionLevel));
  res = await api("POST", `/api/workspaces/tasks/${cardVizinho}/comments`, { token: membro.token, body: { content: "Agora consigo comentar." } });
  check("com nível de comentário a pessoa comenta = 201", res.status === 201, detalhe(res));
  const comentarioDoMembro = res.data?.comment?.id;
  res = await api("PUT", `/api/workspaces/tasks/${cardVizinho}`, { token: membro.token, body: { title: "ainda não pode" } });
  check("com nível de comentário a pessoa ainda não edita o card = 403", res.status === 403, detalhe(res));

  res = await api("PUT", `/api/workspaces/comments/${comentarioDoMembro}`, { token: dono.token, body: { content: "editando o comentário alheio" } });
  check("ninguém edita o comentário de outra pessoa = 404", res.status === 404, detalhe(res));

  res = await compartilhar("Editar");
  res = await api("PUT", `/api/workspaces/tasks/${cardPrincipal}`, { token: membro.token, body: { title: "Publicar a nova página (pelo membro)" } });
  check("com nível de edição a pessoa edita o card = 200", res.status === 200, detalhe(res));
  res = await api("PUT", `/api/workspaces/${w1}`, {
    token: membro.token,
    body: { name: "tomando o workspace", visibility: "private", sharedMemberIds: [] },
  });
  check("nível de edição não dá poder de gerenciar o workspace = 403", res.status === 403, detalhe(res));

  // Projeto reservado: só quem é atribuído enxerga.
  const projetoReservado = await criaProjeto("Projeto Reservado", "private");
  const cardReservado = await criaCard("Tarefa reservada", projetoReservado);
  gMembro = await grafo(membro.token);
  check("projeto privado não aparece para os outros membros do workspace", !gMembro.lists[projetoReservado], JSON.stringify(Object.keys(gMembro.lists)));

  res = await api("PUT", `/api/workspaces/lists/${projetoReservado}/assignees`, { token: dono.token, body: { memberId: membro.id } });
  check("atribuir alguém ao projeto = 200", res.status === 200 && res.data?.assigneeIds?.includes(membro.id), detalhe(res));
  gMembro = await grafo(membro.token);
  check("quem é atribuído ao projeto privado passa a vê-lo", Boolean(gMembro.lists[projetoReservado]), JSON.stringify(Object.keys(gMembro.lists)));
  check("quem é atribuído ao projeto privado pode editar nele", gMembro.lists[projetoReservado]?.currentPermissionLevel === "Editar", String(gMembro.lists[projetoReservado]?.currentPermissionLevel));
  res = await api("PUT", `/api/workspaces/tasks/${cardReservado}`, { token: membro.token, body: { priority: "low" } });
  check("quem é atribuído ao projeto privado edita os cards dele = 200", res.status === 200, detalhe(res));

  res = await api("PUT", `/api/workspaces/lists/${projetoReservado}/assignees`, { token: dono.token, body: { memberId: membro.id } });
  check("atribuir de novo a mesma pessoa tira o projeto dela", !res.data?.assigneeIds?.includes(membro.id), detalhe(res));
  gMembro = await grafo(membro.token);
  check("depois de tirada a atribuição o projeto privado some de novo", !gMembro.lists[projetoReservado], JSON.stringify(Object.keys(gMembro.lists)));

  // Card atribuído dentro de projeto privado: vê só aquele card.
  res = await api("PUT", `/api/workspaces/tasks/${cardReservado}`, { token: dono.token, body: { assigneeIds: [membro.id] } });
  check("atribuir o card a alguém = 200", res.status === 200, detalhe(res));
  const outroCardReservado = await criaCard("Tarefa reservada sem responsável", projetoReservado);
  gMembro = await grafo(membro.token);
  check("quem é responsável por um card vê o projeto privado dele", Boolean(gMembro.lists[projetoReservado]), JSON.stringify(Object.keys(gMembro.lists)));
  check(
    "dentro do projeto privado a pessoa só vê o card que é dela",
    Boolean(gMembro.tasks[cardReservado]) && !gMembro.tasks[outroCardReservado],
    JSON.stringify(gMembro.lists[projetoReservado]?.taskIds),
  );
  check("no card atribuído a pessoa pode comentar", gMembro.tasks[cardReservado]?.currentPermissionLevel === "Comentário", String(gMembro.tasks[cardReservado]?.currentPermissionLevel));
  res = await api("POST", `/api/workspaces/tasks/${cardReservado}/comments`, { token: membro.token, body: { content: "Assumi essa." } });
  check("o responsável pelo card consegue comentar nele = 201", res.status === 201, detalhe(res));
  res = await api("PUT", `/api/workspaces/tasks/${cardReservado}`, { token: membro.token, body: { title: "não pode" } });
  check("o responsável pelo card não edita o resto dele = 403", res.status === 403, detalhe(res));
  res = await api("PUT", `/api/workspaces/tasks/${cardReservado}`, { token: membro.token, body: { statusId: colunaConcluido.id } });
  check("o responsável pelo card pode movê-lo de coluna = 200", res.status === 200, detalhe(res));

  // Projeto admin_private: só o dono do projeto.
  const projetoSecreto = await criaProjeto("Projeto Secreto", "admin_private");
  const cardSecreto = await criaCard("Tarefa secreta", projetoSecreto);
  gMembro = await grafo(membro.token);
  const gOutroAdmin = await grafo(outroAdmin.token);
  check("projeto admin_private não aparece para o membro comum", !gMembro.lists[projetoSecreto], JSON.stringify(Object.keys(gMembro.lists)));
  check("projeto admin_private não aparece nem para outro administrador", !gOutroAdmin.lists[projetoSecreto], JSON.stringify(Object.keys(gOutroAdmin.lists)));
  res = await api("GET", `/api/workspaces/tasks/${cardSecreto}`, { token: deFora.token });
  check("card de projeto admin_private não abre para quem é de outra empresa = 404", res.status === 404, detalhe(res));
  const gDono = await grafo(dono.token);
  check("quem criou o projeto admin_private continua vendo tudo nele", Boolean(gDono.lists[projetoSecreto]) && Boolean(gDono.tasks[cardSecreto]), JSON.stringify(Object.keys(gDono.lists)));

  // Card admin_private dentro de projeto público.
  const cardSoMeu = await criaCard("Anotação particular", projetoAberto, { visibility: "admin_private" });
  const gOutroAdmin2 = await grafo(outroAdmin.token);
  gMembro = await grafo(membro.token);
  check("card admin_private não aparece para o membro comum", !gMembro.tasks[cardSoMeu], JSON.stringify(Object.keys(gMembro.tasks)));
  check("card admin_private não aparece nem para outro administrador", !gOutroAdmin2.tasks[cardSoMeu], JSON.stringify(Object.keys(gOutroAdmin2.tasks)));

  // Card privado dentro de projeto público.
  const cardPrivado = await criaCard("Rascunho do orçamento", projetoAberto, { visibility: "private" });
  gMembro = await grafo(membro.token);
  check("card privado não aparece para os outros membros", !gMembro.tasks[cardPrivado], JSON.stringify(Object.keys(gMembro.tasks)));
  const gOutroAdmin3 = await grafo(outroAdmin.token);
  check("card privado ainda aparece para os administradores", Boolean(gOutroAdmin3.tasks[cardPrivado]), JSON.stringify(Object.keys(gOutroAdmin3.tasks)));

  // Acesso por etiqueta: workspace.
  res = await api("POST", "/api/workspaces", {
    token: dono.token,
    body: { name: "Workspace da Equipe Alfa", visibility: "private", tags: [tagEquipe] },
  });
  const wEtiqueta = res.data.id;
  let gEtiquetado = await grafo(etiquetado.token);
  check("sem a etiqueta a pessoa não vê o workspace etiquetado", !gEtiquetado.workspaces[wEtiqueta], JSON.stringify(Object.keys(gEtiquetado.workspaces)));

  res = await api("PUT", `/api/users/${etiquetado.id}`, {
    token: dono.token,
    body: { name: etiquetado.nome, tagIds: [tagEquipe.id] },
  });
  check("dar uma etiqueta a uma pessoa = 200", res.status === 200 && res.data?.user?.tagIds?.includes(tagEquipe.id), detalhe(res));

  gEtiquetado = await grafo(etiquetado.token);
  check("com a etiqueta a pessoa passa a ver o workspace etiquetado", Boolean(gEtiquetado.workspaces[wEtiqueta]), JSON.stringify(Object.keys(gEtiquetado.workspaces)));
  check("o acesso por etiqueta é apenas de exibição", gEtiquetado.workspaces[wEtiqueta]?.currentPermissionLevel === "Apenas exibição", String(gEtiquetado.workspaces[wEtiqueta]?.currentPermissionLevel));

  // Acesso por etiqueta: card dentro de projeto privado.
  const cardEtiquetado = await criaCard("Tarefa da Equipe Alfa", projetoReservado, { tags: [tagEquipe] });
  gEtiquetado = await grafo(etiquetado.token);
  check("a etiqueta do card dá acesso só àquele card", Boolean(gEtiquetado.tasks[cardEtiquetado]) && !gEtiquetado.tasks[outroCardReservado], JSON.stringify(gEtiquetado.lists[projetoReservado]?.taskIds));
  check("pelo acesso por etiqueta a pessoa pode comentar no card", gEtiquetado.tasks[cardEtiquetado]?.currentPermissionLevel === "Comentário", String(gEtiquetado.tasks[cardEtiquetado]?.currentPermissionLevel));
  res = await api("PUT", `/api/workspaces/tasks/${cardEtiquetado}`, { token: etiquetado.token, body: { title: "não pode" } });
  check("o acesso por etiqueta não deixa editar o card = 403", res.status === 403, detalhe(res));

  // O seed não vaza nada de outra conta.
  const gDeFora = await grafo(deFora.token);
  check(
    "o seed de outra conta não traz nenhum workspace desta",
    !gDeFora.workspaces[w1] && !gDeFora.workspaces[wCampos] && !gDeFora.workspaces[wEtiqueta],
    JSON.stringify(Object.keys(gDeFora.workspaces)),
  );
  check("o seed de outra conta não traz os cards desta", !gDeFora.tasks[cardPrincipal], JSON.stringify(Object.keys(gDeFora.tasks)));
};
