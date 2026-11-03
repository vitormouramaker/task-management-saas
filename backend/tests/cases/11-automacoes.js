/**
 * Automações do projeto: liberação por plano, cadastro, gatilhos de ação
 * (criar card, mudar de coluna, responsável, prioridade) e os de prazo,
 * que rodam pelo worker.
 */
module.exports = async function casosDeAutomacoes(ctx) {
  const { api, db, check, signup } = ctx;

  const dono = await signup({ email: "automacoes-dono@test.com" });

  // ---------- liberação por plano ----------
  let res = await api("GET", "/api/automations", { token: dono.token });
  check(
    "no plano Grátis as automações ficam bloqueadas",
    res.status === 403 && res.data?.code === "PLAN_FEATURE_AUTOMATIONS",
    `${res.status} ${res.data?.message}`,
  );

  await db.query("UPDATE organizations SET plan = 'profissional', subscription_status = 'manual' WHERE id = $1", [
    dono.organizationId,
  ]);

  res = await api("GET", "/api/automations", { token: dono.token });
  check(
    "plano Profissional libera as automações, com os gatilhos disponíveis",
    res.status === 200 && Boolean(res.data?.triggers?.card_mudou_coluna) && Boolean(res.data?.actions?.comentar),
    `${res.status} ${JSON.stringify(res.data)?.slice(0, 120)}`,
  );

  // ---------- projeto e card de apoio ----------
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

  res = await api("POST", "/api/workspaces/lists", {
    token: dono.token,
    body: { name: "Projeto com automações", folderId, visibility: "public" },
  });
  const listId = res.data?.id || res.data?.list?.id;
  check("projeto de apoio criado", Boolean(listId), `${res.status} ${JSON.stringify(res.data)?.slice(0, 120)}`);

  const criarCard = async (titulo, extras = {}) => {
    const criado = await api("POST", "/api/workspaces/tasks", {
      token: dono.token,
      body: { title: titulo, listId, workspaceId, spaceId, folderId, statusId: "st_todo", priority: "medium", ...extras },
    });
    return criado.data?.task?.id || criado.data?.id;
  };

  // ---------- cadastro ----------
  res = await api("POST", "/api/automations", {
    token: dono.token,
    body: { listId, name: "ab", triggerType: "card_criado", actions: [{ type: "comentar", text: "oi" }] },
  });
  check("automação sem nome de verdade = 400", res.status === 400, `${res.status} ${res.data?.message}`);

  res = await api("POST", "/api/automations", {
    token: dono.token,
    body: { listId, name: "Sem ações", triggerType: "card_criado", actions: [] },
  });
  check("automação sem ação = 400", res.status === 400, `${res.status} ${res.data?.message}`);

  res = await api("POST", "/api/automations", {
    token: dono.token,
    body: { listId, name: "Coluna sem escolha", triggerType: "card_mudou_coluna", actions: [{ type: "comentar", text: "oi" }] },
  });
  check("gatilho de coluna exige escolher a coluna = 400", res.status === 400, `${res.status} ${res.data?.message}`);

  // ---------- gatilho: card criado ----------
  res = await api("POST", "/api/automations", {
    token: dono.token,
    body: {
      listId,
      name: "Boas-vindas do card",
      triggerType: "card_criado",
      actions: [
        { type: "comentar", text: "Card criado pela automação de boas-vindas." },
        { type: "mudar_prioridade", priority: "high" },
      ],
    },
  });
  check("criar automação = 201", res.status === 201 && Boolean(res.data?.automation?.id), `${res.status} ${res.data?.message}`);
  const automacaoCriacao = res.data?.automation?.id;

  const cardNovo = await criarCard("Card que nasce com automação");
  const { rows: depoisDeCriar } = await db.query(
    `
      SELECT t.priority,
             (SELECT COUNT(*)::int FROM task_comments c WHERE c.task_id = t.id) AS comentarios,
             (SELECT COUNT(*)::int FROM task_activities a WHERE a.task_id = t.id AND a.description LIKE 'automação%') AS registros
      FROM tasks t WHERE t.id = $1
    `,
    [cardNovo],
  );
  check(
    "card criado recebe comentário e prioridade da automação, com registro no histórico",
    depoisDeCriar[0]?.priority === "high" && depoisDeCriar[0]?.comentarios === 1 && depoisDeCriar[0]?.registros === 1,
    JSON.stringify(depoisDeCriar[0]),
  );

  res = await api("GET", "/api/automations", { token: dono.token });
  check(
    "a automação mostra quantas vezes já rodou",
    res.data?.automations?.find((item) => item.id === automacaoCriacao)?.runsCount === 1,
    JSON.stringify(res.data?.automations?.map((item) => [item.name, item.runsCount])),
  );

  // Desligada não roda.
  await api("PATCH", `/api/automations/${automacaoCriacao}`, { token: dono.token, body: { enabled: false } });
  const cardSemAutomacao = await criarCard("Card com a automação desligada");
  const { rows: desligada } = await db.query(
    "SELECT priority, (SELECT COUNT(*)::int FROM task_comments c WHERE c.task_id = $1) AS comentarios FROM tasks WHERE id = $1",
    [cardSemAutomacao],
  );
  check(
    "automação desligada não mexe no card",
    desligada[0]?.priority === "medium" && desligada[0]?.comentarios === 0,
    JSON.stringify(desligada[0]),
  );

  // ---------- gatilho: mudou de coluna ----------
  res = await api("POST", "/api/automations", {
    token: dono.token,
    body: {
      listId,
      name: "Entrou em revisão",
      triggerType: "card_mudou_coluna",
      triggerConfig: { statusId: "st_review" },
      actions: [
        { type: "definir_responsavel", memberIds: [dono.memberId] },
        { type: "notificar", target: "responsaveis", message: "Card entrou em revisão." },
      ],
    },
  });
  check("automação de coluna criada = 201", res.status === 201, `${res.status} ${res.data?.message}`);

  await api("PUT", `/api/workspaces/tasks/${cardSemAutomacao}`, { token: dono.token, body: { statusId: "st_progress" } });
  let { rows: aposColunaErrada } = await db.query("SELECT COUNT(*)::int AS total FROM task_assignees WHERE task_id = $1", [
    cardSemAutomacao,
  ]);
  check("entrar em outra coluna não dispara a automação", aposColunaErrada[0]?.total === 0, JSON.stringify(aposColunaErrada[0]));

  await api("PUT", `/api/workspaces/tasks/${cardSemAutomacao}`, { token: dono.token, body: { statusId: "st_review" } });
  const { rows: aposRevisao } = await db.query(
    `
      SELECT (SELECT COUNT(*)::int FROM task_assignees WHERE task_id = $1) AS responsaveis,
             (SELECT COUNT(*)::int FROM notifications WHERE reference_id = $1 AND type = 'AUTOMATION') AS avisos
    `,
    [cardSemAutomacao],
  );
  check(
    "entrar na coluna escolhida coloca responsável e avisa",
    aposRevisao[0]?.responsaveis === 1 && aposRevisao[0]?.avisos === 1,
    JSON.stringify(aposRevisao[0]),
  );

  // ---------- gatilho: prioridade ----------
  res = await api("POST", "/api/automations", {
    token: dono.token,
    body: {
      listId,
      name: "Virou urgente",
      triggerType: "card_mudou_prioridade",
      triggerConfig: { priority: "urgent" },
      actions: [{ type: "adicionar_etiqueta", tagId: "tag_inexistente" }, { type: "comentar", text: "Marcado como urgente." }],
    },
  });
  check("automação de prioridade criada = 201", res.status === 201, `${res.status} ${res.data?.message}`);

  const cardUrgente = await criarCard("Card que vira urgente");
  await api("PUT", `/api/workspaces/tasks/${cardUrgente}`, { token: dono.token, body: { priority: "urgent" } });
  const { rows: aposUrgente } = await db.query(
    "SELECT COUNT(*)::int AS comentarios FROM task_comments WHERE task_id = $1",
    [cardUrgente],
  );
  check(
    "mudar para urgente dispara a automação mesmo com uma ação falhando",
    aposUrgente[0]?.comentarios === 1,
    JSON.stringify(aposUrgente[0]),
  );

  // ---------- gatilhos de prazo ----------
  res = await api("POST", "/api/automations", {
    token: dono.token,
    body: {
      listId,
      name: "Prazo vence amanhã",
      triggerType: "prazo_proximo",
      triggerConfig: { days: 1 },
      actions: [{ type: "comentar", text: "Este card vence amanhã." }],
    },
  });
  check("automação de prazo criada = 201", res.status === 201, `${res.status} ${res.data?.message}`);

  const cardComPrazo = await criarCard("Card que vence amanhã");
  const cardSemPrazo = await criarCard("Card sem prazo");
  await db.query("UPDATE tasks SET due_date = (CURRENT_DATE + INTERVAL '1 day') WHERE id = $1", [cardComPrazo]);

  // O worker roda como script, com o banco de teste (nunca o de produção).
  let execucao = ctx.runScript("run_automations.js");
  check(
    "o worker de prazos trata ao menos um card",
    execucao.status === 0 && /([1-9]\d*) card/.test(execucao.stdout),
    `${execucao.status} ${execucao.stdout.trim()} ${execucao.stderr.slice(0, 200)}`,
  );

  const { rows: aposPrazo } = await db.query(
    `
      SELECT (SELECT COUNT(*)::int FROM task_comments WHERE task_id = $1) AS com_prazo,
             (SELECT COUNT(*)::int FROM task_comments WHERE task_id = $2) AS sem_prazo
    `,
    [cardComPrazo, cardSemPrazo],
  );
  check(
    "só o card que vence amanhã recebe o comentário",
    aposPrazo[0]?.com_prazo === 1 && aposPrazo[0]?.sem_prazo === 0,
    JSON.stringify(aposPrazo[0]),
  );

  execucao = ctx.runScript("run_automations.js");
  const { rows: semRepetir } = await db.query("SELECT COUNT(*)::int AS total FROM task_comments WHERE task_id = $1", [
    cardComPrazo,
  ]);
  check(
    "o worker não repete a automação no mesmo dia",
    semRepetir[0]?.total === 1,
    `${execucao.stdout.trim()}; ${semRepetir[0]?.total} comentário(s)`,
  );

  // Card concluído sai do alcance dos gatilhos de prazo.
  await api("PUT", `/api/workspaces/tasks/${cardComPrazo}`, { token: dono.token, body: { statusId: "st_done" } });
  await db.query("DELETE FROM automation_runs");
  ctx.runScript("run_automations.js");
  const { rows: concluido } = await db.query("SELECT COUNT(*)::int AS total FROM task_comments WHERE task_id = $1", [
    cardComPrazo,
  ]);
  check("card concluído não entra mais nas automações de prazo", concluido[0]?.total === 1, JSON.stringify(concluido[0]));

  // ---------- aviso em tempo real ----------
  // A automação precisa avisar quem está com a tela aberta; antes o aviso só
  // aparecia depois de recarregar a página.
  res = await api("POST", "/api/automations", {
    token: dono.token,
    body: {
      listId,
      name: "Avisa na hora",
      triggerType: "card_criado",
      actions: [{ type: "notificar", target: "pessoas", memberIds: [dono.memberId], message: "Card novo no projeto." }],
    },
  });
  check("automação que avisa a equipe criada", res.status === 201, `${res.status} ${res.data?.message}`);

  const ouvinte = await ctx.escutarTempoReal(dono.token, { workspaceIds: [workspaceId] });
  await criarCard("Card que avisa em tempo real");
  const eventos = await ouvinte.esperarEventos(["notification.refetch", "seed.refetch"], 8000);
  await ouvinte.fechar();

  check(
    "a automação avisa a notificação em tempo real",
    eventos.some((evento) => evento.type === "notification.refetch"),
    JSON.stringify(eventos.map((evento) => evento.type)),
  );
  check(
    "a automação manda o quadro se atualizar sozinho",
    eventos.some(
      (evento) => evento.type === "seed.refetch" && String(evento.payload?.reason || "").startsWith("automacao:"),
    ),
    JSON.stringify(eventos.map((evento) => `${evento.type}:${evento.payload?.reason || ""}`)),
  );

  // ---------- permissões ----------
  const outra = await signup({ email: "automacoes-outra@test.com" });
  await db.query("UPDATE organizations SET plan = 'profissional', subscription_status = 'manual' WHERE id = $1", [
    outra.organizationId,
  ]);

  res = await api("GET", "/api/automations", { token: outra.token });
  check(
    "outra conta não vê as automações daqui",
    res.status === 200 && (res.data?.automations || []).length === 0,
    JSON.stringify(res.data?.automations),
  );

  res = await api("POST", "/api/automations", {
    token: outra.token,
    body: { listId, name: "Invasora", triggerType: "card_criado", actions: [{ type: "comentar", text: "oi" }] },
  });
  check("não dá para criar automação no projeto de outra conta = 404", res.status === 404, `${res.status} ${res.data?.message}`);

  res = await api("DELETE", `/api/automations/${automacaoCriacao}`, { token: outra.token });
  check("não dá para apagar automação de outra conta = 404", res.status === 404, String(res.status));

  res = await api("DELETE", `/api/automations/${automacaoCriacao}`, { token: dono.token });
  check("apagar a própria automação = 200", res.status === 200, `${res.status} ${res.data?.message}`);
};
