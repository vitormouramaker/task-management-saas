/**
 * Relatórios: liberação por plano, retrato de hoje, entregas por semana,
 * tempo até concluir e separação por projeto e por pessoa.
 */
module.exports = async function casosDeRelatorios(ctx) {
  const { api, db, check, signup } = ctx;

  const dono = await signup({ email: "relatorios-dono@test.com", seed: 61 });

  // ---------- liberação por plano ----------
  let res = await api("GET", "/api/reports", { token: dono.token });
  check(
    "no plano Grátis os relatórios ficam bloqueados",
    res.status === 403 && res.data?.code === "PLAN_FEATURE_REPORTS",
    `${res.status} ${res.data?.message}`,
  );

  await db.query("UPDATE organizations SET plan = 'profissional', subscription_status = 'manual' WHERE id = $1", [
    dono.organizationId,
  ]);

  res = await api("GET", "/api/reports", { token: dono.token });
  check("plano Profissional abre os relatórios", res.status === 200, `${res.status} ${res.data?.message}`);

  // ---------- estrutura para medir ----------
  const { rows: estrutura } = await db.query(
    `
      SELECT w.id AS workspace_id, s.id AS space_id
      FROM workspaces w INNER JOIN spaces s ON s.workspace_id = w.id
      WHERE w.organization_id = $1 AND w.deleted_at IS NULL
      LIMIT 1
    `,
    [dono.organizationId],
  );
  const { workspace_id: workspaceId, space_id: spaceId } = estrutura[0];

  const criarProjeto = async (nome) => {
    const { rows } = await db.query("SELECT id FROM folders WHERE space_id = $1 LIMIT 1", [spaceId]);
    const criado = await api("POST", "/api/workspaces/lists", {
      token: dono.token,
      body: { name: nome, folderId: rows[0].id, visibility: "public" },
    });
    return criado.data?.id || criado.data?.list?.id;
  };

  const criarCard = async (listId, titulo, extras = {}) => {
    const criado = await api("POST", "/api/workspaces/tasks", {
      token: dono.token,
      body: {
        title: titulo,
        listId,
        workspaceId,
        spaceId,
        folderId: (await db.query("SELECT folder_id FROM lists WHERE id = $1", [listId])).rows[0].folder_id,
        statusId: "st_todo",
        priority: "high",
        ...extras,
      },
    });
    return criado.data?.task?.id || criado.data?.id;
  };

  const projetoA = await criarProjeto("Projeto Relatório A");
  const projetoB = await criarProjeto("Projeto Relatório B");
  check("projetos de apoio criados", Boolean(projetoA && projetoB), `${projetoA} ${projetoB}`);

  const atrasado = await criarCard(projetoA, "Card atrasado", { dueDate: "2020-01-10T00:00:00.000Z" });
  const paraConcluir = await criarCard(projetoA, "Card que vai concluir");
  const semResponsavel = await criarCard(projetoB, "Card sem ninguém");
  check("cards de apoio criados", Boolean(atrasado && paraConcluir && semResponsavel));

  // ---------- retrato de hoje ----------
  res = await api("GET", "/api/reports", { token: dono.token });
  let relatorio = res.data;
  check(
    "relatório conta abertos, atrasados e sem responsável",
    relatorio.totals.open >= 3 && relatorio.totals.overdue >= 1 && relatorio.totals.unassigned >= 1,
    JSON.stringify(relatorio.totals),
  );
  check(
    "relatório separa por coluna e por prioridade",
    relatorio.byStatus.some((item) => item.total > 0) && relatorio.byPriority.some((item) => item.priority === "high"),
    JSON.stringify({ status: relatorio.byStatus, prioridade: relatorio.byPriority }),
  );
  check(
    "ainda não há tempo até concluir sem cards concluídos",
    relatorio.leadTimeDays === null && relatorio.totals.completedInRange === 0,
    JSON.stringify(relatorio.leadTimeDays),
  );

  // ---------- conclusão ----------
  res = await api("PUT", `/api/workspaces/tasks/${paraConcluir}`, { token: dono.token, body: { statusId: "st_done" } });
  check("mover o card para Concluído = 200", res.status === 200, `${res.status} ${res.data?.message}`);

  const { rows: conclusao } = await db.query(
    `
      SELECT t.completed_at,
             (SELECT COUNT(*)::int FROM task_status_transitions tr WHERE tr.task_id = t.id AND tr.to_status_done) AS transicoes
      FROM tasks t WHERE t.id = $1
    `,
    [paraConcluir],
  );
  check(
    "card concluído ganha data de conclusão e registro da mudança",
    Boolean(conclusao[0]?.completed_at) && conclusao[0]?.transicoes === 1,
    JSON.stringify(conclusao[0]),
  );

  res = await api("GET", "/api/reports", { token: dono.token });
  relatorio = res.data;
  check(
    "relatório mostra a entrega da semana e o tempo até concluir",
    relatorio.totals.completedInRange === 1 &&
      relatorio.completedPerWeek.length === 1 &&
      relatorio.completedPerWeek[0].completed === 1 &&
      relatorio.leadTimeDays?.base === 1,
    JSON.stringify({ totals: relatorio.totals, semana: relatorio.completedPerWeek, lead: relatorio.leadTimeDays }),
  );

  const linhaProjetoA = relatorio.byList.find((item) => item.id === projetoA);
  check(
    "relatório separa abertos, atrasados e concluídos por projeto",
    linhaProjetoA?.completed === 1 && linhaProjetoA?.overdue === 1 && linhaProjetoA?.open >= 1,
    JSON.stringify(linhaProjetoA),
  );

  check(
    "o card mais antigo em aberto aparece na lista",
    relatorio.oldestOpen.length > 0 && relatorio.oldestOpen.every((item) => item.id !== paraConcluir),
    JSON.stringify(relatorio.oldestOpen.map((item) => item.title)),
  );

  // ---------- carga por pessoa ----------
  await api("PUT", `/api/workspaces/tasks/${atrasado}`, { token: dono.token, body: { assigneeIds: [dono.memberId] } });
  res = await api("GET", "/api/reports", { token: dono.token });
  const linhaPessoa = res.data.byMember.find((item) => item.id === dono.memberId);
  check(
    "carga por pessoa conta o que está com ela",
    linhaPessoa?.open >= 1 && linhaPessoa?.overdue >= 1,
    JSON.stringify(linhaPessoa),
  );

  // ---------- filtros ----------
  res = await api("GET", `/api/reports?listId=${projetoB}`, { token: dono.token });
  check(
    "filtro por projeto só traz o projeto escolhido",
    res.status === 200 && res.data.byList.length === 1 && res.data.byList[0].id === projetoB,
    JSON.stringify(res.data.byList),
  );

  res = await api("GET", "/api/reports?from=2020-01-01&to=2020-01-31", { token: dono.token });
  check(
    "período antigo vem sem entregas",
    res.data.totals.completedInRange === 0 && res.data.leadTimeDays === null,
    JSON.stringify(res.data.totals),
  );

  // ---------- volta para aberto ----------
  await api("PUT", `/api/workspaces/tasks/${paraConcluir}`, { token: dono.token, body: { statusId: "st_progress" } });
  const { rows: reaberto } = await db.query("SELECT completed_at FROM tasks WHERE id = $1", [paraConcluir]);
  check("card que sai de Concluído volta a ficar aberto", reaberto[0]?.completed_at === null, JSON.stringify(reaberto[0]));

  // ---------- separação entre contas ----------
  const outra = await signup({ email: "relatorios-outra@test.com", seed: 62 });
  await db.query("UPDATE organizations SET plan = 'profissional', subscription_status = 'manual' WHERE id = $1", [
    outra.organizationId,
  ]);
  res = await api("GET", "/api/reports", { token: outra.token });
  check(
    "relatório de outra conta não enxerga os projetos vizinhos",
    res.status === 200 && res.data.byList.every((item) => item.id !== projetoA && item.id !== projetoB),
    JSON.stringify(res.data.byList),
  );
};
