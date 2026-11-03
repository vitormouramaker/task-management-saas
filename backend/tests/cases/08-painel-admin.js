/**
 * Painel de super-admin (/api/admin): quem entra, visão geral da plataforma,
 * lista e detalhe das contas, ajustes manuais com auditoria e as solicitações
 * do plano Enterprise (pedido em /api/billing/enterprise-request).
 */
module.exports = async function casosDePainelAdmin(ctx) {
  const { api, db, check } = ctx;

  const MB = 1024 * 1024;
  const futuro = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);

  // ---------------------------------------------------------------- contas
  const fora = await ctx.signup({ email: "admin-fora@test.com", seed: 61 });
  const equipe = await ctx.signup({ email: "admin-equipe@test.com", seed: 62 });
  const titular = await ctx.signup({
    email: "admin-titular@test.com",
    accountType: "business",
    seed: 63,
    company: { cnpj: ctx.makeCnpj(63), tradeName: "Acme Painel Teste" },
  });
  const pagante = await ctx.signup({
    email: "admin-pagante@test.com",
    accountType: "business",
    seed: 64,
    company: { cnpj: ctx.makeCnpj(64), tradeName: "Pagante Painel Teste" },
  });
  const atraso = await ctx.signup({ email: "admin-atraso@test.com", seed: 65 });
  const interna = await ctx.signup({ email: "admin-interna@test.com", seed: 66 });
  const emTeste = await ctx.signup({ email: "admin-emteste@test.com", seed: 67 });

  // Uma pessoa comum dentro da conta do titular (papel "member").
  const comum = await ctx.signup({ email: "admin-comum@test.com", seed: 68 });
  await db.query(
    `INSERT INTO organization_members (organization_id, member_id, role, status)
     VALUES ($1, $2, 'member', 'active')
     ON CONFLICT (organization_id, member_id) DO UPDATE SET role = 'member', status = 'active'`,
    [titular.organizationId, comum.memberId],
  );
  await db.query("UPDATE members SET active_organization_id = $1 WHERE id = $2", [
    titular.organizationId,
    comum.memberId,
  ]);
  let res = await api("POST", "/api/auth/login", {
    body: { email: "admin-comum@test.com", password: "senha-forte-123" },
  });
  const comumToken = res.data?.token;
  check(
    "pessoa comum entra na conta do titular com papel de membro",
    res.data?.user?.organization?.id === titular.organizationId && res.data?.user?.organization?.role === "member",
    `${res.status} ${JSON.stringify(res.data?.user?.organization)}`,
  );

  // ------------------------------------------------- quem não é da equipe
  // A primeira chamada já cria as tabelas do painel; esta conta fica marcada
  // como "não é admin" no cache, o que é exatamente o esperado dela.
  const rotasDoPainel = [
    ["GET", "/api/admin/overview"],
    ["GET", "/api/admin/organizations"],
    ["GET", `/api/admin/organizations/${titular.organizationId}`],
    ["PATCH", `/api/admin/organizations/${titular.organizationId}`],
    ["GET", "/api/admin/enterprise-requests"],
    ["PATCH", "/api/admin/enterprise-requests/qualquer"],
    ["GET", "/api/admin/nfse"],
  ];
  for (const [metodo, rota] of rotasDoPainel) {
    res = await api(metodo, rota, { token: fora.token, body: metodo === "PATCH" ? {} : undefined });
    check(
      `quem não é da equipe recebe 403 em ${metodo} ${rota.replace(titular.organizationId, ":id")}`,
      res.status === 403 && /equipe do Pauta/i.test(String(res.data?.message)),
      `${res.status} ${res.data?.message}`,
    );
  }

  res = await api("GET", "/api/admin/overview");
  check("painel sem estar logado = 401", res.status === 401, `${res.status} ${res.data?.message}`);

  // A marcação vem antes da primeira chamada da equipe: isPlatformAdmin guarda
  // a resposta por 30s e o teste não pode ficar esperando o cache vencer.
  await db.query("UPDATE members SET is_platform_admin = TRUE WHERE id = $1", [equipe.memberId]);

  res = await api("GET", "/api/admin/overview", { token: equipe.token });
  check("quem é da equipe do Pauta entra no painel", res.status === 200, `${res.status} ${res.data?.message}`);
  const antes = res.data || {};

  check(
    "visão geral traz contas, pessoas e contas por plano",
    antes.organizations >= 8 && antes.members >= 8 && typeof antes.byPlan === "object" && antes.byPlan !== null,
    JSON.stringify({ organizations: antes.organizations, members: antes.members, byPlan: antes.byPlan }),
  );
  check(
    "visão geral traz pagantes, testes, em atraso, internas e receita estimada",
    ["paying", "trials", "pastDue", "exempt", "mrrCents"].every((k) => Number.isFinite(antes[k])),
    JSON.stringify(antes),
  );
  check(
    "visão geral traz armazenamento, solicitações novas, notas pendentes e suporte aguardando",
    ["storageMb", "newEnterpriseRequests", "pendingInvoices", "waitingSupport", "newOrganizationsLast30Days"].every(
      (k) => Number.isFinite(antes[k]),
    ),
    JSON.stringify(antes),
  );
  check(
    "contas criadas agora contam como novas dos últimos 30 dias",
    antes.newOrganizationsLast30Days >= 8,
    String(antes.newOrganizationsLast30Days),
  );

  // ------------------------------------------------ dados para a visão geral
  // As tabelas de notas e suporte só existem depois da primeira visão geral.
  await db.query(
    `INSERT INTO storage_files (id, organization_id, kind, storage_path, url, original_name, size_bytes)
     VALUES ('admin-arq-1', $1, 'attachment', 'admin/teste/arquivo.bin', 'http://falso/arquivo.bin', 'arquivo.bin', $2)`,
    [titular.organizationId, 200 * MB],
  );
  await db.query(
    `INSERT INTO nfse_records (id, organization_id, stripe_invoice_id, amount_cents, status)
     VALUES ('admin-nfse-1', $1, 'in_admin_1', 12900, 'pendente')`,
    [pagante.organizationId],
  );
  await db.query(
    `INSERT INTO support_conversations (id, organization_id, member_id, subject, status)
     VALUES ('admin-sup-1', $1, $2, 'Dúvida do painel', 'aberta')`,
    [titular.organizationId, titular.memberId],
  );

  // Conta pagante de verdade (assinatura ativa na Stripe) e conta em atraso.
  await db.query(
    `UPDATE organizations
     SET plan = 'profissional', subscription_status = 'active', billing_interval = 'monthly',
         stripe_customer_id = 'cus_admin_painel', stripe_subscription_id = 'sub_admin_painel'
     WHERE id = $1`,
    [pagante.organizationId],
  );
  await db.query(
    `UPDATE organizations
     SET plan = 'essencial', subscription_status = 'past_due', billing_interval = 'monthly',
         past_due_since = CURRENT_TIMESTAMP - INTERVAL '3 days'
     WHERE id = $1`,
    [atraso.organizationId],
  );

  // ------------------------------------------------- solicitação Enterprise
  res = await api("POST", "/api/billing/enterprise-request", {
    token: titular.token,
    body: { reason: "curto" },
  });
  check(
    "pedido Enterprise com motivo curto demais = 400",
    res.status === 400 && res.data?.field === "reason",
    `${res.status} ${res.data?.message}`,
  );

  res = await api("POST", "/api/billing/enterprise-request", {
    token: comumToken,
    body: { reason: "Precisamos de limites negociados para o time inteiro." },
  });
  check(
    "quem não é titular nem administrador da conta não pode pedir Enterprise = 403",
    res.status === 403,
    `${res.status} ${res.data?.message}`,
  );

  res = await api("POST", "/api/billing/enterprise-request", {
    token: titular.token,
    body: {
      reason: "Precisamos de limites negociados e contrato para 300 pessoas.",
      companyName: "Acme Painel Teste",
      contactPhone: "11987654321",
      teamSize: "201-500",
      seatsNeeded: 300,
      storageNeededGb: 2000,
    },
  });
  check(
    "titular pede o plano Enterprise = 201",
    res.status === 201 && Boolean(res.data?.id),
    `${res.status} ${res.data?.message}`,
  );
  const pedidoId = res.data?.id;

  res = await api("POST", "/api/billing/enterprise-request", {
    token: titular.token,
    body: { reason: "Queremos falar de novo sobre o contrato Enterprise." },
  });
  check(
    "segunda solicitação com uma já em aberto = 409",
    res.status === 409,
    `${res.status} ${res.data?.message}`,
  );

  // ------------------------------------------------------- ajustes manuais
  const patch = (organizationId, body, token = equipe.token) =>
    api("PATCH", `/api/admin/organizations/${organizationId}`, { token, body });

  res = await patch("org_que_nao_existe", { adminNotes: "nada" });
  check("ajustar conta inexistente = 404", res.status === 404, `${res.status} ${res.data?.message}`);

  res = await patch(titular.organizationId, {});
  check(
    "ajuste sem nenhum campo avisa que não há nada para alterar",
    res.status === 200 && /nada para alterar/i.test(String(res.data?.message)),
    `${res.status} ${res.data?.message}`,
  );

  res = await patch(titular.organizationId, { plan: "plano-que-nao-existe" });
  check(
    "plano escrito errado é recusado, sem rebaixar a conta",
    res.status === 400 && /inválido/i.test(String(res.data?.message)),
    `${res.status} ${res.data?.message}`,
  );
  const { rows: depoisDoPlanoTorto } = await db.query("SELECT plan FROM organizations WHERE id = $1", [
    titular.organizationId,
  ]);
  check(
    "o plano escrito errado vira Grátis (comportamento atual, não o desejado)",
    depoisDoPlanoTorto[0].plan === "free",
    JSON.stringify(depoisDoPlanoTorto[0]),
  );

  res = await patch(titular.organizationId, { trialEndsAt: "data-torta" });
  check("fim do teste com data inválida = 400", res.status === 400, `${res.status} ${res.data?.message}`);

  res = await patch(titular.organizationId, { customEntitlements: { maxUsers: -5 } });
  check(
    "limite negociado abaixo de -1 = 400",
    res.status === 400 && /maxUsers/.test(String(res.data?.message)),
    `${res.status} ${res.data?.message}`,
  );

  res = await patch(pagante.organizationId, { plan: "essencial" });
  check(
    "conta com assinatura ativa na Stripe recusa troca manual de plano = 409",
    res.status === 409 && /assinatura/i.test(String(res.data?.message)),
    `${res.status} ${res.data?.message}`,
  );

  res = await patch(titular.organizationId, { plan: "enterprise" });
  check("equipe muda o plano da conta na mão = 200", res.status === 200, `${res.status} ${res.data?.message}`);
  let { rows: depoisDoPlano } = await db.query(
    "SELECT plan, subscription_status FROM organizations WHERE id = $1",
    [titular.organizationId],
  );
  check(
    "plano definido na mão fica gravado como contrato fora da Stripe",
    depoisDoPlano[0].plan === "enterprise" && depoisDoPlano[0].subscription_status === "manual",
    JSON.stringify(depoisDoPlano[0]),
  );

  res = await patch(titular.organizationId, {
    customEntitlements: { maxUsers: 99, maxStorageMb: 500000, maxWorkspaces: -1 },
    adminNotes: "Contrato assinado em 2026; renovar em 12 meses.",
  });
  check("limites negociados e anotações = 200", res.status === 200, `${res.status} ${res.data?.message}`);

  res = await patch(interna.organizationId, { billingExempt: true, adminNotes: "Conta da própria equipe." });
  check("marcar conta como interna = 200", res.status === 200, `${res.status} ${res.data?.message}`);

  res = await patch(emTeste.organizationId, { trialEndsAt: futuro.toISOString() });
  check("definir o fim do teste = 200", res.status === 200, `${res.status} ${res.data?.message}`);
  const { rows: testeGravado } = await db.query(
    "SELECT trial_ends_at, trial_started_at FROM organizations WHERE id = $1",
    [emTeste.organizationId],
  );
  check(
    "definir o fim do teste também marca quando o teste começou",
    Boolean(testeGravado[0].trial_ends_at) && Boolean(testeGravado[0].trial_started_at),
    JSON.stringify(testeGravado[0]),
  );

  // ------------------------------------------- visão geral depois dos ajustes
  res = await api("GET", "/api/admin/overview", { token: equipe.token });
  const depois = res.data || {};
  check("visão geral continua respondendo depois dos ajustes", res.status === 200, `${res.status} ${res.data?.message}`);
  check(
    "conta com assinatura ativa e conta em atraso entram na contagem de pagantes",
    depois.paying === antes.paying + 2,
    `antes ${antes.paying}, depois ${depois.paying}`,
  );
  check(
    "receita estimada soma o mensal das duas contas pagantes",
    depois.mrrCents === antes.mrrCents + 12900 + 4900,
    `antes ${antes.mrrCents}, depois ${depois.mrrCents}`,
  );
  check(
    "conta com fim de teste no futuro conta como teste",
    depois.trials === antes.trials + 1,
    `antes ${antes.trials}, depois ${depois.trials}`,
  );
  check(
    "conta com pagamento vencido conta como em atraso",
    depois.pastDue === antes.pastDue + 1,
    `antes ${antes.pastDue}, depois ${depois.pastDue}`,
  );
  check(
    "conta interna conta como isenta e aparece em contas por plano",
    depois.exempt === antes.exempt + 1 && (depois.byPlan.interna || 0) === (antes.byPlan.interna || 0) + 1,
    `${depois.exempt} / ${JSON.stringify(depois.byPlan)}`,
  );
  check(
    "contas por plano acompanha a troca manual de plano",
    (depois.byPlan.enterprise || 0) === (antes.byPlan.enterprise || 0) + 1 &&
      (depois.byPlan.profissional || 0) === (antes.byPlan.profissional || 0) + 1,
    JSON.stringify(depois.byPlan),
  );
  check(
    "armazenamento soma os arquivos de todas as contas",
    depois.storageMb === antes.storageMb + 200,
    `antes ${antes.storageMb}, depois ${depois.storageMb}`,
  );
  check(
    "solicitação Enterprise nova aparece na visão geral",
    depois.newEnterpriseRequests === antes.newEnterpriseRequests + 1,
    `antes ${antes.newEnterpriseRequests}, depois ${depois.newEnterpriseRequests}`,
  );
  check(
    "nota fiscal pendente aparece na visão geral",
    depois.pendingInvoices === antes.pendingInvoices + 1,
    `antes ${antes.pendingInvoices}, depois ${depois.pendingInvoices}`,
  );
  check(
    "conversa de suporte aberta aparece na visão geral",
    depois.waitingSupport === antes.waitingSupport + 1,
    `antes ${antes.waitingSupport}, depois ${depois.waitingSupport}`,
  );

  // ------------------------------------------------------- lista de contas
  const lista = (query = "") => api("GET", `/api/admin/organizations${query}`, { token: equipe.token });

  res = await lista();
  check(
    "lista de contas vem paginada de 20 em 20",
    res.status === 200 && res.data?.pageSize === 20 && res.data?.page === 0 && Array.isArray(res.data?.organizations),
    `${res.status} ${JSON.stringify({ page: res.data?.page, pageSize: res.data?.pageSize })}`,
  );
  const totalGeral = res.data?.total;
  check(
    "lista nunca traz mais contas do que cabem na página",
    res.data.organizations.length === Math.min(20, totalGeral),
    `${res.data.organizations.length} de ${totalGeral}`,
  );

  res = await lista("?search=admin-titular@test.com");
  check(
    "busca pelo e-mail do titular encontra a conta",
    res.data?.total === 1 && res.data.organizations[0]?.id === titular.organizationId,
    `${res.status} ${JSON.stringify(res.data?.organizations?.map((o) => o.ownerEmail))}`,
  );
  const naLista = res.data?.organizations?.[0] || {};
  check(
    "a conta na lista mostra titular, plano, pessoas e armazenamento",
    naLista.ownerEmail === "admin-titular@test.com" &&
      naLista.plan === "enterprise" &&
      naLista.membersCount === 2 &&
      naLista.storageMb === 200,
    JSON.stringify(naLista),
  );

  res = await lista("?search=Acme%20Painel");
  check(
    "busca pelo nome da conta encontra a conta",
    res.data?.organizations?.some((o) => o.id === titular.organizationId),
    `${res.status} ${JSON.stringify(res.data?.organizations?.map((o) => o.name))}`,
  );

  const { rows: cnpjRows } = await db.query("SELECT cnpj FROM organizations WHERE id = $1", [
    titular.organizationId,
  ]);
  const cnpjGravado = cnpjRows[0]?.cnpj || "";
  res = await lista(`?search=${encodeURIComponent(cnpjGravado)}`);
  check(
    "busca pelo CNPJ encontra a conta",
    Boolean(cnpjGravado) && res.data?.organizations?.some((o) => o.id === titular.organizationId),
    `cnpj ${cnpjGravado} -> ${res.status} ${res.data?.total}`,
  );

  res = await lista("?search=nao-existe-mesmo-zzz");
  check(
    "busca sem resultado devolve lista vazia",
    res.data?.total === 0 && res.data?.organizations?.length === 0,
    JSON.stringify(res.data),
  );

  res = await lista("?plan=essencial");
  check(
    "filtro por plano traz só as contas daquele plano",
    res.data?.organizations?.length > 0 &&
      res.data.organizations.every((o) => o.plan === "essencial") &&
      res.data.organizations.some((o) => o.id === atraso.organizationId),
    JSON.stringify(res.data?.organizations?.map((o) => o.plan)),
  );

  res = await lista("?plan=interna");
  check(
    "filtro por contas internas traz as contas isentas de cobrança",
    res.data?.organizations?.length > 0 &&
      res.data.organizations.every((o) => o.billingExempt === true) &&
      res.data.organizations.some((o) => o.id === interna.organizationId),
    JSON.stringify(res.data?.organizations?.map((o) => o.name)),
  );

  res = await lista("?search=admin-&page=1");
  check(
    "segunda página mantém o total e não repete contas da primeira",
    res.data?.page === 1 && res.data?.total >= 8 && res.data?.organizations?.length === 0,
    JSON.stringify({ page: res.data?.page, total: res.data?.total, itens: res.data?.organizations?.length }),
  );

  // ------------------------------------------------------ detalhe da conta
  res = await api("GET", "/api/admin/organizations/org_que_nao_existe", { token: equipe.token });
  check("detalhe de conta inexistente = 404", res.status === 404, `${res.status} ${res.data?.message}`);

  res = await api("GET", `/api/admin/organizations/${titular.organizationId}`, { token: equipe.token });
  check("detalhe da conta = 200", res.status === 200, `${res.status} ${res.data?.message}`);
  const detalhe = res.data || {};

  check(
    "detalhe mostra o titular com nome, e-mail e telefone",
    detalhe.owner?.email === "admin-titular@test.com" && Boolean(detalhe.owner?.name) && Boolean(detalhe.owner?.phone),
    JSON.stringify(detalhe.owner),
  );
  check(
    "detalhe mostra o uso da conta (pessoas, espaços, projetos e armazenamento)",
    detalhe.usage?.users === 2 && detalhe.usage?.workspaces >= 1 && detalhe.usage?.projects >= 1 && detalhe.usage?.storageMb === 200,
    JSON.stringify(detalhe.usage),
  );
  check(
    "detalhe lista os membros da conta com o papel de cada um",
    detalhe.members?.length === 2 &&
      detalhe.members.some((m) => m.email === "admin-titular@test.com" && m.role === "owner") &&
      detalhe.members.some((m) => m.email === "admin-comum@test.com" && m.role === "member"),
    JSON.stringify(detalhe.members),
  );
  check(
    "detalhe mostra os limites negociados por cima dos limites do plano",
    detalhe.customEntitlements?.maxUsers === 99 &&
      detalhe.customEntitlements?.maxStorageMb === 500000 &&
      detalhe.entitlements?.maxUsers === 99 &&
      detalhe.entitlements?.maxStorageMb === 500000,
    JSON.stringify({ custom: detalhe.customEntitlements, maxUsers: detalhe.entitlements?.maxUsers }),
  );
  check(
    "detalhe mostra as anotações da equipe",
    detalhe.adminNotes === "Contrato assinado em 2026; renovar em 12 meses.",
    JSON.stringify(detalhe.adminNotes),
  );
  check(
    "detalhe mostra a solicitação Enterprise da conta",
    detalhe.enterpriseRequests?.some((r) => r.id === pedidoId && r.status === "nova"),
    JSON.stringify(detalhe.enterpriseRequests),
  );
  check(
    "detalhe diz que a conta não tem assinatura na Stripe",
    detalhe.hasStripeSubscription === false && detalhe.plan === "enterprise",
    JSON.stringify({ stripe: detalhe.hasStripeSubscription, plan: detalhe.plan }),
  );

  // ------------------------------------------------- histórico de auditoria
  check(
    "histórico de ajustes mostra quem fez cada alteração",
    detalhe.auditLog?.length >= 2 &&
      detalhe.auditLog.every((l) => l.adminEmail === "admin-equipe@test.com" && l.targetType === "organization"),
    JSON.stringify(detalhe.auditLog),
  );
  check(
    "histórico registra a troca de plano, os limites negociados e as anotações",
    ["plan", "customEntitlements", "adminNotes"].every((campo) =>
      detalhe.auditLog.some((l) => l.changes.includes(campo)),
    ),
    JSON.stringify(detalhe.auditLog?.map((l) => l.changes)),
  );

  const { rows: auditoria } = await db.query(
    `SELECT admin_member_id, admin_email, changes FROM admin_audit_log
     WHERE organization_id = $1 AND changes ? 'plan' ORDER BY created_at DESC LIMIT 1`,
    [titular.organizationId],
  );
  check(
    "auditoria guarda o antes e o depois da troca de plano",
    auditoria.length === 1 &&
      auditoria[0].admin_member_id === equipe.memberId &&
      auditoria[0].changes.plan?.antes === "free" &&
      auditoria[0].changes.plan?.depois === "enterprise",
    JSON.stringify(auditoria[0]),
  );

  res = await patch(titular.organizationId, { customEntitlements: null });
  check("limpar os limites negociados = 200", res.status === 200, `${res.status} ${res.data?.message}`);
  res = await api("GET", `/api/admin/organizations/${titular.organizationId}`, { token: equipe.token });
  check(
    "sem limites negociados a conta volta aos limites do plano",
    res.data?.customEntitlements === null && res.data?.entitlements?.maxUsers === -1,
    JSON.stringify({ custom: res.data?.customEntitlements, maxUsers: res.data?.entitlements?.maxUsers }),
  );

  // ------------------------------------- solicitações Enterprise no painel
  res = await api("GET", "/api/admin/enterprise-requests", { token: equipe.token });
  check(
    "painel lista as solicitações Enterprise com as situações possíveis",
    res.status === 200 &&
      Array.isArray(res.data?.statuses) &&
      res.data.statuses.includes("nova") &&
      res.data.requests.some((r) => r.id === pedidoId),
    `${res.status} ${JSON.stringify(res.data?.statuses)}`,
  );
  const pedido = res.data.requests.find((r) => r.id === pedidoId) || {};
  check(
    "a solicitação traz contato, empresa, tamanho do time e o que foi pedido",
    pedido.contactEmail === "admin-titular@test.com" &&
      pedido.organizationId === titular.organizationId &&
      pedido.companyName === "Acme Painel Teste" &&
      pedido.teamSize === "201-500" &&
      pedido.seatsNeeded === 300 &&
      pedido.storageNeededGb === 2000 &&
      /limites negociados/.test(String(pedido.reason)),
    JSON.stringify(pedido),
  );

  res = await api("GET", "/api/admin/enterprise-requests?status=fechada", { token: equipe.token });
  check(
    "filtro por situação não traz a solicitação nova",
    res.status === 200 && !res.data.requests.some((r) => r.id === pedidoId),
    `${res.status} ${res.data?.requests?.length}`,
  );

  res = await api("PATCH", `/api/admin/enterprise-requests/${pedidoId}`, {
    token: equipe.token,
    body: { status: "situacao-inventada" },
  });
  check("situação inválida na solicitação = 400", res.status === 400, `${res.status} ${res.data?.message}`);

  res = await api("PATCH", "/api/admin/enterprise-requests/ent_inexistente", {
    token: equipe.token,
    body: { status: "em_contato" },
  });
  check("atualizar solicitação inexistente = 404", res.status === 404, `${res.status} ${res.data?.message}`);

  res = await api("PATCH", `/api/admin/enterprise-requests/${pedidoId}`, {
    token: equipe.token,
    body: { status: "em_contato", adminNotes: "Reunião marcada para segunda." },
  });
  check("mudar situação e anotar a solicitação = 200", res.status === 200, `${res.status} ${res.data?.message}`);

  res = await api("GET", "/api/admin/enterprise-requests?status=em_contato", { token: equipe.token });
  const emContato = res.data?.requests?.find((r) => r.id === pedidoId) || {};
  check(
    "a solicitação guarda a nova situação e a anotação da equipe",
    emContato.status === "em_contato" && emContato.adminNotes === "Reunião marcada para segunda.",
    JSON.stringify(emContato),
  );

  res = await api("POST", "/api/billing/enterprise-request", {
    token: titular.token,
    body: { reason: "Ainda estamos em contato, mas queremos revisar o contrato." },
  });
  check(
    "solicitação em contato ainda bloqueia um novo pedido = 409",
    res.status === 409,
    `${res.status} ${res.data?.message}`,
  );

  res = await api("PATCH", `/api/admin/enterprise-requests/${pedidoId}`, {
    token: equipe.token,
    body: { status: "fechada" },
  });
  check("fechar a solicitação = 200", res.status === 200, `${res.status} ${res.data?.message}`);

  res = await api("POST", "/api/billing/enterprise-request", {
    token: titular.token,
    body: { reason: "Depois do contrato fechado, queremos ampliar o número de pessoas." },
  });
  check(
    "com a solicitação anterior fechada, a conta pode pedir de novo = 201",
    res.status === 201,
    `${res.status} ${res.data?.message}`,
  );

  res = await api("GET", "/api/admin/enterprise-requests", { token: equipe.token });
  check(
    "solicitações abertas aparecem antes das já fechadas",
    res.data?.requests?.findIndex((r) => r.status === "nova") <
      res.data?.requests?.findIndex((r) => r.id === pedidoId),
    JSON.stringify(res.data?.requests?.map((r) => r.status)),
  );

  const { rows: auditoriaPedido } = await db.query(
    "SELECT target_type, admin_email FROM admin_audit_log WHERE target_id = $1 ORDER BY created_at",
    [pedidoId],
  );
  check(
    "toda mudança na solicitação fica registrada na auditoria",
    auditoriaPedido.length === 2 &&
      auditoriaPedido.every((l) => l.target_type === "enterprise_request" && l.admin_email === "admin-equipe@test.com"),
    JSON.stringify(auditoriaPedido),
  );

  // ---------------------------------------------------------------- erros
  // A tela manda o erro sem precisar de login; com token, o erro fica ligado
  // à conta de quem estava usando.
  const erroDaTela = {
    mensagem: "Cannot read properties of undefined (reading 'nome')",
    tipo: "TypeError",
    pilha: "TypeError: Cannot read properties of undefined\n    at TaskCard (task-card.tsx:412:9)",
    url: "https://app.example.com/projeto/abc",
    versao: "1.4.2",
  };

  res = await api("POST", "/api/telemetria/erro", { body: erroDaTela, token: titular.token });
  check("a tela consegue registrar um erro", res.status === 204, `${res.status}`);

  res = await api("POST", "/api/telemetria/erro", { body: erroDaTela });
  check("erro sem login também é aceito", res.status === 204, `${res.status}`);

  res = await api("POST", "/api/telemetria/erro", { body: { mensagem: "" } });
  check("erro sem mensagem é recusado", res.status === 400, `${res.status}`);

  res = await api("GET", "/api/admin/erros", { token: fora.token });
  check("quem não é da equipe não vê os erros", res.status === 403, `${res.status}`);

  res = await api("GET", "/api/admin/erros", { token: equipe.token });
  const grupo = (res.data?.errors || [])[0];
  check(
    "erros iguais viram um grupo só, com contador",
    res.status === 200 && res.data.errors.length === 1 && grupo.ocorrencias === 2,
    JSON.stringify(res.data?.errors?.map((e) => ({ m: e.mensagem, n: e.ocorrencias }))),
  );
  check(
    "o grupo diz de onde veio e quantas contas foram afetadas",
    grupo?.origem === "front" && grupo?.contasAfetadas === 1 && grupo?.local?.includes("task-card"),
    JSON.stringify({ origem: grupo?.origem, contas: grupo?.contasAfetadas, local: grupo?.local }),
  );

  res = await api("GET", `/api/admin/erros/${grupo.id}`, { token: equipe.token });
  check(
    "o detalhe traz as ocorrências, com conta e endereço da tela",
    res.status === 200 &&
      res.data.events.length === 2 &&
      res.data.events.some((evento) => evento.organizacao === "Acme Painel Teste"),
    JSON.stringify(res.data?.events?.map((e) => e.organizacao)),
  );

  res = await api("POST", `/api/admin/erros/${grupo.id}/resolver`, {
    token: equipe.token,
    body: { resolvido: true },
  });
  check("dá para marcar o erro como resolvido", res.status === 200, `${res.status} ${res.data?.message}`);

  res = await api("GET", "/api/admin/erros?status=abertos", { token: equipe.token });
  check(
    "resolvido sai da lista de abertos",
    res.status === 200 && res.data.errors.length === 0,
    JSON.stringify(res.data?.errors?.length),
  );

  await api("POST", "/api/telemetria/erro", { body: erroDaTela });
  res = await api("GET", "/api/admin/erros?status=abertos", { token: equipe.token });
  check(
    "erro que volta a acontecer reabre sozinho",
    res.status === 200 && res.data.errors.length === 1 && res.data.errors[0].ocorrencias === 3,
    JSON.stringify(res.data?.errors?.map((e) => e.ocorrencias)),
  );
};
