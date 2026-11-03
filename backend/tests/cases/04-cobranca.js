/**
 * Cobrança: catálogo de planos, boas-vindas (Grátis ou teste de 14 dias),
 * checkout, webhooks da Stripe, troca de plano, adicionais, cancelamento,
 * faturas, portal do cliente e o bloqueio de edição por fatura vencida.
 */
module.exports = async function casosDeCobranca(ctx) {
  const { api, db, check, fakes, signup } = ctx;

  const senha = "senha-forte-123";
  const GB = 1024;

  // ============================================================ catálogo
  let res = await api("GET", "/api/billing/plans");
  check("catálogo de planos exige estar logado = 401", res.status === 401, String(res.status));

  const dono = await signup({ email: "cobranca-dono@test.com", seed: 140 });
  const orgDono = dono.organizationId;

  res = await api("GET", "/api/billing/plans", { token: dono.token });
  const planos = res.data?.plans || [];
  const porId = Object.fromEntries(planos.map((plano) => [plano.id, plano]));
  check(
    "catálogo traz os cinco planos na ordem do mais simples ao Enterprise",
    res.status === 200 && planos.map((plano) => plano.id).join(",") === "free,essencial,profissional,empresarial,enterprise",
    `${res.status} ${planos.map((plano) => plano.id).join(",")}`,
  );
  check(
    "plano Grátis: 3 pessoas, 1 workspace, 3 projetos e só a visão de quadro",
    porId.free?.entitlements?.maxUsers === 3 &&
      porId.free.entitlements.maxWorkspaces === 1 &&
      porId.free.entitlements.maxProjects === 3 &&
      JSON.stringify(porId.free.entitlements.views) === '["board"]',
    JSON.stringify(porId.free?.entitlements),
  );
  check(
    "plano Profissional custa R$ 129/mês e dez vezes isso no ano",
    porId.profissional?.priceCents?.monthly === 12900 && porId.profissional.priceCents.yearly === 129000,
    JSON.stringify(porId.profissional?.priceCents),
  );
  check(
    "plano Enterprise é só por contato, sem preço de tabela",
    porId.enterprise?.contactOnly === true && porId.enterprise.priceCents.monthly === null,
    JSON.stringify(porId.enterprise?.priceCents),
  );
  check(
    "pacote extra de armazenamento é de 100 GB por R$ 29/mês",
    res.data?.storagePack?.storageMb === 100 * GB && res.data.storagePack.priceCents.monthly === 2900,
    JSON.stringify(res.data?.storagePack),
  );
  check(
    "catálogo informa 14 dias de teste e que o checkout está disponível",
    res.data?.trialDays === 14 && res.data?.checkoutEnabled === true,
    `${res.data?.trialDays} ${res.data?.checkoutEnabled}`,
  );

  // ================================================= situação da conta nova
  res = await api("GET", "/api/billing/subscription", { token: dono.token });
  let organizacao = res.data?.organization;
  check(
    "conta nova está no Grátis, com boas-vindas pendentes e teste disponível",
    res.status === 200 &&
      organizacao?.plan === "free" &&
      organizacao.onboardingPending === true &&
      organizacao.trialAvailable === true &&
      organizacao.trial.active === false,
    `${res.status} ${JSON.stringify({ plan: organizacao?.plan, onboardingPending: organizacao?.onboardingPending, trialAvailable: organizacao?.trialAvailable })}`,
  );
  check(
    "situação da conta mostra o uso atual (pessoas, workspaces, projetos e armazenamento)",
    organizacao?.usage?.users === 1 &&
      organizacao.usage.workspaces >= 1 &&
      organizacao.usage.projects >= 1 &&
      typeof organizacao.usage.storageMb === "number",
    JSON.stringify(organizacao?.usage),
  );
  check(
    "no Grátis os limites entregues são os do próprio plano Grátis",
    organizacao?.entitlements?.seats === 3 && organizacao.entitlements.maxStorageMb === 1024,
    JSON.stringify({ seats: organizacao?.entitlements?.seats, maxStorageMb: organizacao?.entitlements?.maxStorageMb }),
  );
  check(
    "conta nova não está em atraso nem em somente leitura",
    organizacao?.payment?.pastDue === false && organizacao.readOnly === false,
    JSON.stringify(organizacao?.payment),
  );

  // ================================================== boas-vindas: Grátis
  const gratis = await signup({ email: "cobranca-gratis@test.com", seed: 141 });

  res = await api("POST", "/api/billing/onboarding", { token: gratis.token, body: { choice: "free" } });
  check("escolher começar no Grátis = 200", res.status === 200, `${res.status} ${res.data?.message}`);

  res = await api("GET", "/api/billing/subscription", { token: gratis.token });
  check(
    "quem escolheu o Grátis continua no plano Grátis",
    res.status === 200 && res.data?.organization?.plan === "free" && res.data.organization.subscriptionStatus === "free",
    JSON.stringify({ plan: res.data?.organization?.plan, status: res.data?.organization?.subscriptionStatus }),
  );

  let { rows: boasVindas } = await db.query(
    "SELECT onboarding_completed_at, trial_started_at FROM organizations WHERE id = $1",
    [gratis.organizationId],
  );
  check(
    "escolher o Grátis marca as boas-vindas como concluídas, sem gastar o teste",
    Boolean(boasVindas[0]?.onboarding_completed_at) && boasVindas[0].trial_started_at === null,
    JSON.stringify(boasVindas[0]),
  );

  res = await api("GET", "/api/billing/subscription", { token: gratis.token });
  check(
    "a tela de assinatura para de pedir as boas-vindas depois da escolha",
    res.data?.organization?.onboardingPending === false && res.data.organization.trialAvailable === true,
    JSON.stringify({ onboardingPending: res.data?.organization?.onboardingPending, trialAvailable: res.data?.organization?.trialAvailable }),
  );

  res = await api("POST", "/api/billing/subscription/preview", { token: gratis.token, body: { extraSeats: 1 } });
  check(
    "prévia de cobrança em conta sem assinatura = 409",
    res.status === 409,
    `${res.status} ${res.data?.message}`,
  );

  // ========================================== boas-vindas: teste de 14 dias
  const cpfDoTeste = ctx.makeCpf(8142);
  const teste = await signup({ email: "cobranca-teste@test.com", seed: 142, cpf: cpfDoTeste });

  res = await api("POST", "/api/billing/onboarding", { token: teste.token, body: { choice: "trial" } });
  check(
    "ativar o teste de 14 dias = 200 e devolve a data de término",
    res.status === 200 && Boolean(res.data?.trialEndsAt),
    `${res.status} ${res.data?.message}`,
  );

  res = await api("GET", "/api/billing/subscription", { token: teste.token });
  organizacao = res.data?.organization;
  check(
    "durante o teste a conta usa o Profissional, com status de avaliação",
    organizacao?.plan === "profissional" && organizacao.subscriptionStatus === "trialing" && organizacao.contractedPlan === "free",
    JSON.stringify({ plan: organizacao?.plan, status: organizacao?.subscriptionStatus, contratado: organizacao?.contractedPlan }),
  );
  check(
    "o teste começa valendo, com 14 dias pela frente e data de término",
    organizacao?.trial?.active === true && organizacao.trial.daysLeft === 14 && organizacao.trial.expired === false && Boolean(organizacao.trial.endsAt),
    JSON.stringify(organizacao?.trial),
  );

  ({ rows: boasVindas } = await db.query(
    "SELECT onboarding_completed_at, trial_started_at FROM organizations WHERE id = $1",
    [teste.organizationId],
  ));
  check(
    "ativar o teste conclui as boas-vindas e marca o teste como já usado",
    Boolean(boasVindas[0]?.onboarding_completed_at) && Boolean(boasVindas[0].trial_started_at),
    JSON.stringify(boasVindas[0]),
  );
  check(
    "durante o teste valem os limites do Profissional (15 pessoas e 150 GB)",
    organizacao?.entitlements?.seats === 15 && organizacao.entitlements.maxStorageMb === 150 * GB,
    JSON.stringify({ seats: organizacao?.entitlements?.seats, maxStorageMb: organizacao?.entitlements?.maxStorageMb }),
  );

  res = await api("POST", "/api/billing/onboarding", { token: teste.token, body: { choice: "trial" } });
  check(
    "pedir o teste duas vezes na mesma conta = 409 TRIAL_UNAVAILABLE",
    res.status === 409 && res.data?.code === "TRIAL_UNAVAILABLE",
    `${res.status} ${res.data?.code}`,
  );

  const { rows: registros } = await db.query(
    "SELECT document_hash, email_hash FROM trial_grants WHERE organization_id = $1",
    [teste.organizationId],
  );
  check(
    "o teste concedido fica registrado só como resumo do documento e do e-mail",
    registros.length === 1 &&
      /^[0-9a-f]{64}$/.test(registros[0].document_hash || "") &&
      /^[0-9a-f]{64}$/.test(registros[0].email_hash || ""),
    JSON.stringify(registros),
  );

  // A pessoa "apaga a conta" e tenta de novo: libera CPF e e-mail no banco.
  await db.query(
    "UPDATE members SET cpf = NULL, email = 'cobranca-teste-antigo@test.com' WHERE email = 'cobranca-teste@test.com'",
  );

  // Mesmo CPF de quem já usou o teste grátis.
  const mesmoDocumento = await signup({ email: "cobranca-teste-doc@test.com", seed: 142, cpf: cpfDoTeste });
  res = await api("POST", "/api/billing/onboarding", { token: mesmoDocumento.token, body: { choice: "trial" } });
  check(
    "outra conta com o mesmo CPF não ganha o teste de novo = 409 TRIAL_UNAVAILABLE",
    res.status === 409 && res.data?.code === "TRIAL_UNAVAILABLE",
    `${res.status} ${res.data?.code} ${res.data?.message}`,
  );

  const mesmoEmail = await signup({ email: "cobranca-teste@test.com", seed: 143 });
  res = await api("POST", "/api/billing/onboarding", { token: mesmoEmail.token, body: { choice: "trial" } });
  check(
    "outra conta com o mesmo e-mail não ganha o teste de novo = 409 TRIAL_UNAVAILABLE",
    res.status === 409 && res.data?.code === "TRIAL_UNAVAILABLE",
    `${res.status} ${res.data?.code} ${res.data?.message}`,
  );

  res = await api("POST", "/api/billing/onboarding", { token: mesmoEmail.token, body: { choice: "free" } });
  check(
    "quem não pode testar ainda consegue seguir no Grátis",
    res.status === 200,
    `${res.status} ${res.data?.message}`,
  );

  // ===================================================== checkout: recusas
  res = await api("POST", "/api/billing/checkout", { token: dono.token, body: { plan: "free" } });
  check("contratar o plano Grátis pelo checkout = 400", res.status === 400, `${res.status} ${res.data?.message}`);

  res = await api("POST", "/api/billing/checkout", { token: dono.token, body: { plan: "enterprise" } });
  check("contratar o Enterprise pelo checkout = 400 (é por contato)", res.status === 400, `${res.status} ${res.data?.message}`);

  res = await api("POST", "/api/billing/checkout", { token: dono.token, body: { plan: "profissional", interval: "semanal" } });
  check("periodicidade que não existe = 400", res.status === 400, `${res.status} ${res.data?.message}`);

  res = await api("POST", "/api/billing/checkout", {
    token: dono.token,
    body: { plan: "profissional", interval: "monthly", extraSeats: 36 },
  });
  check(
    "pedir mais pessoas extras do que o plano aceita = 400",
    res.status === 400 && String(res.data?.message).includes("35"),
    `${res.status} ${res.data?.message}`,
  );

  res = await api("POST", "/api/billing/checkout", {
    token: dono.token,
    body: { plan: "profissional", interval: "monthly", storagePacks: 11 },
  });
  check(
    "pedir mais pacotes de armazenamento do que o plano aceita = 400",
    res.status === 400 && String(res.data?.message).includes("10"),
    `${res.status} ${res.data?.message}`,
  );

  // ================================================== checkout: sessão real
  res = await api("POST", "/api/billing/checkout", {
    token: dono.token,
    body: { plan: "profissional", interval: "monthly", extraSeats: 2, storagePacks: 1 },
  });
  check(
    "iniciar a assinatura devolve o link do checkout da Stripe",
    res.status === 200 && String(res.data?.checkoutUrl).startsWith("https://checkout.stripe.test/"),
    `${res.status} ${res.data?.checkoutUrl || res.data?.message}`,
  );

  const sessao = fakes.stripe.checkoutSessions[fakes.stripe.checkoutSessions.length - 1];
  const itensSessao = Object.values(sessao?.form?.line_items || {});
  check(
    "o checkout vai com três linhas: plano, pessoas extras e pacote de +100 GB",
    itensSessao.length === 3 &&
      itensSessao[0].price === "price_profissional_monthly" &&
      itensSessao[0].quantity === "1" &&
      itensSessao[1].price === "price_profissional_seat_monthly" &&
      itensSessao[1].quantity === "2" &&
      itensSessao[2].price === "price_storage_monthly" &&
      itensSessao[2].quantity === "1",
    JSON.stringify(itensSessao),
  );
  check(
    "o checkout identifica a empresa para o webhook reconhecer o pagamento",
    sessao?.form?.client_reference_id === orgDono && sessao.form.metadata?.organizationId === orgDono,
    `${sessao?.form?.client_reference_id} / ${sessao?.form?.metadata?.organizationId}`,
  );

  ({ rows: boasVindas } = await db.query(
    "SELECT onboarding_completed_at FROM organizations WHERE id = $1",
    [orgDono],
  ));
  check(
    "ir para o checkout já encerra as boas-vindas",
    Boolean(boasVindas[0]?.onboarding_completed_at),
    JSON.stringify(boasVindas[0]),
  );

  // ============================== webhook: pagamento do checkout confirmado
  const { rows: clientes } = await db.query("SELECT stripe_customer_id FROM organizations WHERE id = $1", [orgDono]);
  const cliente = clientes[0]?.stripe_customer_id;
  check("o checkout cria o cliente da conta na Stripe", Boolean(cliente), String(cliente));

  const assinaturaDono = "sub_cobranca_dono";
  fakes.stripe.upsertSubscription(assinaturaDono, { customer: cliente });
  fakes.stripe.setItems(assinaturaDono, [
    { price: "price_profissional_monthly", quantity: 1 },
    { price: "price_profissional_seat_monthly", quantity: 2 },
    { price: "price_storage_monthly", quantity: 1 },
  ]);

  res = await ctx.sendWebhook("checkout.session.completed", {
    id: sessao.id,
    object: "checkout.session",
    subscription: assinaturaDono,
    client_reference_id: orgDono,
    metadata: { organizationId: orgDono },
  });
  check(
    "webhook de checkout concluído liga a assinatura à conta",
    res.status === 200 && res.data?.applied === true && res.data.organizationId === orgDono,
    `${res.status} ${JSON.stringify(res.data)}`,
  );

  // A Stripe reenvia o evento quando a resposta demora: o segundo envio do
  // mesmo evento nao pode aplicar nada de novo.
  const eventoRepetido = "evt_repetido_de_teste";
  const primeira = await ctx.sendWebhook(
    "customer.subscription.updated",
    fakes.stripe.subscriptions.get(assinaturaDono),
    { id: eventoRepetido },
  );
  const segunda = await ctx.sendWebhook(
    "customer.subscription.updated",
    fakes.stripe.subscriptions.get(assinaturaDono),
    { id: eventoRepetido },
  );
  check(
    "o mesmo evento da Stripe só vale uma vez",
    primeira.status === 200 &&
      primeira.data?.applied === true &&
      segunda.status === 200 &&
      segunda.data?.applied === false &&
      segunda.data?.reason === "evento_repetido",
    `${JSON.stringify(primeira.data)} | ${JSON.stringify(segunda.data)}`,
  );

  res = await ctx.sendWebhook("checkout.session.completed", { id: "cs_sem_assinatura", object: "checkout.session" });
  check(
    "checkout concluído sem assinatura é ignorado sem erro",
    res.status === 200 && res.data?.applied === false && res.data.reason === "session_without_subscription",
    `${res.status} ${JSON.stringify(res.data)}`,
  );

  res = await api("GET", "/api/billing/subscription", { token: dono.token });
  organizacao = res.data?.organization;
  check(
    "depois do pagamento a conta fica no Profissional mensal e ativa",
    organizacao?.plan === "profissional" &&
      organizacao.subscriptionStatus === "active" &&
      organizacao.billingInterval === "monthly",
    JSON.stringify({ plan: organizacao?.plan, status: organizacao?.subscriptionStatus, intervalo: organizacao?.billingInterval }),
  );
  check(
    "as pessoas extras e o pacote contratados entram nos limites da conta",
    organizacao?.extraSeats === 2 &&
      organizacao.extraStoragePacks === 1 &&
      organizacao.entitlements.seats === 17 &&
      organizacao.entitlements.maxStorageMb === 150 * GB + 100 * GB,
    JSON.stringify({
      extraSeats: organizacao?.extraSeats,
      packs: organizacao?.extraStoragePacks,
      seats: organizacao?.entitlements?.seats,
      storage: organizacao?.entitlements?.maxStorageMb,
    }),
  );

  res = await api("POST", "/api/billing/checkout", {
    token: dono.token,
    body: { plan: "empresarial", interval: "monthly" },
  });
  check(
    "quem já assina não consegue abrir um segundo checkout = 409",
    res.status === 409,
    `${res.status} ${res.data?.message}`,
  );

  // ================================================ prévia da cobrança extra
  res = await api("POST", "/api/billing/subscription/preview", {
    token: dono.token,
    body: { extraSeats: 2, storagePacks: 1 },
  });
  check(
    "prévia sem mudar nada avisa que não há cobrança",
    res.status === 200 && res.data?.changed === false,
    `${res.status} ${JSON.stringify(res.data)}`,
  );

  res = await api("POST", "/api/billing/subscription/preview", {
    token: dono.token,
    body: { extraSeats: 5, storagePacks: 2 },
  });
  check(
    "prévia de aumento mostra o valor a pagar agora",
    res.status === 200 && res.data?.increase === true && res.data.amountDueCents === 4700,
    `${res.status} ${JSON.stringify(res.data)}`,
  );

  res = await api("POST", "/api/billing/subscription/preview", {
    token: dono.token,
    body: { extraSeats: 0, storagePacks: 0 },
  });
  check(
    "prévia de redução não cobra nada e vale a partir do fim do período",
    res.status === 200 && res.data?.increase === false && res.data.amountDueCents === 0 && Boolean(res.data.effectiveAt),
    `${res.status} ${JSON.stringify(res.data)}`,
  );

  // ============================================ adicionais: aumento e redução
  res = await api("POST", "/api/billing/subscription/quantities", {
    token: dono.token,
    body: { extraSeats: 36 },
  });
  check(
    "contratar mais pessoas extras do que o plano aceita = 400",
    res.status === 400 && String(res.data?.message).includes("35"),
    `${res.status} ${res.data?.message}`,
  );

  res = await api("POST", "/api/billing/subscription/quantities", {
    token: dono.token,
    body: { extraSeats: 2, storagePacks: 11 },
  });
  check(
    "contratar mais pacotes do que o plano aceita = 400",
    res.status === 400 && String(res.data?.message).includes("10"),
    `${res.status} ${res.data?.message}`,
  );

  res = await api("POST", "/api/billing/subscription/quantities", {
    token: dono.token,
    body: { extraSeats: 5, storagePacks: 2 },
  });
  check(
    "aumentar pessoas extras e pacotes entra na hora, com cobrança da diferença",
    res.status === 200 && res.data?.status === "applied",
    `${res.status} ${JSON.stringify(res.data)}`,
  );

  res = await api("GET", "/api/billing/subscription", { token: dono.token });
  organizacao = res.data?.organization;
  check(
    "depois do aumento os limites já contam 5 pessoas extras e 2 pacotes",
    organizacao?.extraSeats === 5 &&
      organizacao.extraStoragePacks === 2 &&
      organizacao.entitlements.seats === 20 &&
      organizacao.entitlements.maxStorageMb === 150 * GB + 200 * GB,
    JSON.stringify({ seats: organizacao?.entitlements?.seats, storage: organizacao?.entitlements?.maxStorageMb }),
  );

  res = await api("POST", "/api/billing/subscription/quantities", {
    token: dono.token,
    body: { extraSeats: 1, storagePacks: 1 },
  });
  check(
    "reduzir adicionais fica agendado para o fim do período já pago",
    res.status === 200 && res.data?.status === "scheduled" && Boolean(res.data.effectiveAt),
    `${res.status} ${JSON.stringify(res.data)}`,
  );

  res = await api("GET", "/api/billing/subscription", { token: dono.token });
  organizacao = res.data?.organization;
  check(
    "até lá continuam valendo os adicionais já pagos",
    organizacao?.extraSeats === 5 && organizacao.extraStoragePacks === 2,
    JSON.stringify({ seats: organizacao?.extraSeats, packs: organizacao?.extraStoragePacks }),
  );

  let { rows: agendado } = await db.query(
    "SELECT pending_plan, pending_extra_seats, pending_extra_storage_packs, pending_change_at FROM organizations WHERE id = $1",
    [orgDono],
  );
  check(
    "a redução dos adicionais fica guardada para o fim do período",
    agendado[0]?.pending_extra_seats === 1 &&
      agendado[0].pending_extra_storage_packs === 1 &&
      Boolean(agendado[0].pending_change_at),
    JSON.stringify(agendado[0]),
  );

  res = await api("GET", "/api/billing/subscription", { token: dono.token });
  check(
    "a tela de assinatura avisa que a redução está agendada",
    res.data?.organization?.pendingChange?.extraSeats === 1 &&
      res.data.organization.pendingChange.extraStoragePacks === 1 &&
      Boolean(res.data.organization.pendingChange.at),
    JSON.stringify(res.data?.organization?.pendingChange),
  );

  // ======================================================== troca de plano
  res = await api("POST", "/api/billing/subscription/plan", { token: dono.token, body: { plan: "free" } });
  check("trocar para um plano que não existe no checkout = 400", res.status === 400, `${res.status} ${res.data?.message}`);

  res = await api("POST", "/api/billing/subscription/plan", {
    token: dono.token,
    body: { plan: "empresarial", interval: "monthly" },
  });
  check(
    "subir de plano vale na hora e cobra a diferença",
    res.status === 200 && res.data?.status === "applied",
    `${res.status} ${JSON.stringify(res.data)}`,
  );

  res = await api("GET", "/api/billing/subscription", { token: dono.token });
  organizacao = res.data?.organization;
  check("depois de subir, a conta está no Empresarial", organizacao?.plan === "empresarial", String(organizacao?.plan));

  ({ rows: agendado } = await db.query(
    "SELECT pending_plan, pending_extra_seats, pending_change_at FROM organizations WHERE id = $1",
    [orgDono],
  ));
  check(
    "subir de plano limpa a redução que estava agendada",
    agendado[0]?.pending_plan === null && agendado[0].pending_extra_seats === null && agendado[0].pending_change_at === null,
    JSON.stringify(agendado[0]),
  );
  check(
    "os adicionais contratados seguem no plano novo",
    organizacao?.extraSeats === 5 && organizacao.extraStoragePacks === 2,
    JSON.stringify({ seats: organizacao?.extraSeats, packs: organizacao?.extraStoragePacks }),
  );

  // ================================================= cancelar e reativar
  res = await api("POST", "/api/billing/subscription/cancel", {
    token: dono.token,
    body: { reason: "pouco_uso", comment: "A equipe ficou menor." },
  });
  check(
    "cancelar a assinatura = 200, com acesso até o fim do período pago",
    res.status === 200 && Boolean(res.data?.effectiveAt) && String(res.data?.message).includes("até o fim do período"),
    `${res.status} ${JSON.stringify(res.data)}`,
  );

  res = await api("GET", "/api/billing/subscription", { token: dono.token });
  organizacao = res.data?.organization;
  check(
    "a conta cancelada continua no plano contratado até a data marcada",
    organizacao?.cancelAtPeriodEnd === true && organizacao.plan === "empresarial" && Boolean(organizacao.periodEnd),
    JSON.stringify({ cancelar: organizacao?.cancelAtPeriodEnd, plan: organizacao?.plan, fim: organizacao?.periodEnd }),
  );

  res = await api("POST", "/api/billing/subscription/cancel", { token: dono.token, body: { reason: "pouco_uso" } });
  check(
    "cancelar de novo apenas avisa que já estava cancelada",
    res.status === 200 && String(res.data?.message).includes("já estava cancelada"),
    `${res.status} ${res.data?.message}`,
  );

  res = await api("POST", "/api/billing/subscription/quantities", {
    token: dono.token,
    body: { extraSeats: 8, storagePacks: 2 },
  });
  check(
    "com a assinatura cancelada não dá para contratar adicionais = 409",
    res.status === 409 && String(res.data?.message).includes("Reative"),
    `${res.status} ${res.data?.message}`,
  );

  res = await api("POST", "/api/billing/subscription/plan", {
    token: dono.token,
    body: { plan: "profissional", interval: "monthly" },
  });
  check(
    "com a assinatura cancelada não dá para trocar de plano = 409",
    res.status === 409 && String(res.data?.message).includes("Reative"),
    `${res.status} ${res.data?.message}`,
  );

  res = await api("POST", "/api/billing/subscription/resume", { token: dono.token });
  check(
    "reativar a assinatura = 200",
    res.status === 200 && String(res.data?.message).includes("reativada"),
    `${res.status} ${res.data?.message}`,
  );

  res = await api("GET", "/api/billing/subscription", { token: dono.token });
  check(
    "depois de reativar, o cancelamento agendado some",
    res.data?.organization?.cancelAtPeriodEnd === false,
    String(res.data?.organization?.cancelAtPeriodEnd),
  );

  res = await api("POST", "/api/billing/subscription/resume", { token: dono.token });
  check(
    "reativar de novo apenas avisa que já estava ativa",
    res.status === 200 && String(res.data?.message).includes("já estava ativa"),
    `${res.status} ${res.data?.message}`,
  );

  // ======================================================== descer de plano
  res = await api("POST", "/api/billing/subscription/plan", {
    token: dono.token,
    body: { plan: "essencial", interval: "monthly" },
  });
  check(
    "descer de plano fica agendado para o fim do período já pago",
    res.status === 200 && res.data?.status === "scheduled" && Boolean(res.data.effectiveAt),
    `${res.status} ${JSON.stringify(res.data)}`,
  );

  res = await api("GET", "/api/billing/subscription", { token: dono.token });
  organizacao = res.data?.organization;
  check(
    "até o fim do período a conta segue no plano maior já pago",
    organizacao?.plan === "empresarial" && organizacao.entitlements.seats === 55,
    JSON.stringify({ plan: organizacao?.plan, seats: organizacao?.entitlements?.seats }),
  );

  ({ rows: agendado } = await db.query(
    "SELECT pending_plan, pending_change_at FROM organizations WHERE id = $1",
    [orgDono],
  ));
  check(
    "o plano menor escolhido fica guardado para entrar no fim do período",
    agendado[0]?.pending_plan === "essencial" && Boolean(agendado[0].pending_change_at),
    JSON.stringify(agendado[0]),
  );

  res = await api("GET", "/api/billing/subscription", { token: dono.token });
  check(
    "a tela de assinatura mostra o plano menor agendado",
    res.data?.organization?.pendingChange?.plan === "essencial",
    JSON.stringify(res.data?.organization?.pendingChange),
  );

  // ========================================= webhook perdido: conta se acerta
  {
    const atrasada = await signup({ email: "cobranca-webhook-perdido@test.com" });
    ctx.fakes.stripe.upsertSubscription("sub_perdida", { customer: "cus_perdida", status: "active" });
    ctx.fakes.stripe.setItems("sub_perdida", [{ price: "price_profissional_monthly", quantity: 1 }]);
    // Só o cliente foi gravado (é o que o checkout faz); o webhook não chegou.
    await db.query("UPDATE organizations SET stripe_customer_id = 'cus_perdida' WHERE id = $1", [
      atrasada.organizationId,
    ]);

    res = await api("GET", "/api/billing/subscription", { token: atrasada.token });
    check(
      "sem o webhook, a tela de assinatura acha a assinatura pelo cliente e aplica o plano",
      res.status === 200 && res.data?.organization?.plan === "profissional",
      `${res.status} ${res.data?.organization?.plan}`,
    );

    const { rows: gravada } = await db.query(
      "SELECT stripe_subscription_id, subscription_status FROM organizations WHERE id = $1",
      [atrasada.organizationId],
    );
    check(
      "a assinatura encontrada fica gravada na conta",
      gravada[0]?.stripe_subscription_id === "sub_perdida" && gravada[0]?.subscription_status === "active",
      JSON.stringify(gravada[0]),
    );
  }

  // ====================================================== retencao e cancelamento
  res = await api("GET", "/api/billing/retention/offers", { token: dono.token });
  const opcoes = res.data?.reasons || [];
  check(
    "a tela de cancelamento traz um motivo e uma proposta para cada caso",
    res.status === 200 && opcoes.length === 7 && opcoes.every((item) => item.offer?.type && item.offer?.title),
    JSON.stringify(opcoes.map((item) => [item.id, item.offer?.type])),
  );
  check(
    "quem acha caro recebe desconto por tempo limitado",
    opcoes.find((item) => item.id === "caro")?.offer?.percent === 15 &&
      opcoes.find((item) => item.id === "caro")?.offer?.months === 3,
    JSON.stringify(opcoes.find((item) => item.id === "caro")?.offer),
  );
  check(
    "quem usou pouco recebe a proposta de um plano menor com o preço",
    opcoes.find((item) => item.id === "pouco_uso")?.offer?.targetPlan &&
      opcoes.find((item) => item.id === "pouco_uso")?.offer?.targetPriceCents > 0,
    JSON.stringify(opcoes.find((item) => item.id === "pouco_uso")?.offer),
  );

  res = await api("POST", "/api/billing/subscription/cancel", { token: dono.token, body: {} });
  check(
    "não dá para cancelar sem responder a pesquisa = 400",
    res.status === 400 && /motivo/i.test(String(res.data?.message)),
    `${res.status} ${res.data?.message}`,
  );

  res = await api("POST", "/api/billing/retention/accept", { token: dono.token, body: { reason: "caro" } });
  check(
    "aceitar o desconto = 200 e a resposta já diz quanto fica a próxima fatura",
    res.status === 200 && /R\$/.test(String(res.data?.message)) && res.data?.discount?.percentOff === 15,
    `${res.status} ${res.data?.message}`,
  );

  const { rows: assinaturaDaConta } = await db.query(
    "SELECT stripe_subscription_id FROM organizations WHERE id = $1",
    [orgDono],
  );
  const assinaturaComDesconto = ctx.fakes.stripe.subscriptions.get(assinaturaDaConta[0]?.stripe_subscription_id);
  check(
    "o desconto é aplicado na assinatura da Stripe",
    Boolean(assinaturaComDesconto?.discounts?.[0]?.source?.coupon),
    `${assinaturaDaConta[0]?.stripe_subscription_id} ${JSON.stringify(assinaturaComDesconto?.discounts)} cupons=${ctx.fakes.stripe.coupons.size}`,
  );

  const { rows: retido } = await db.query(
    "SELECT reason, offer_type, outcome FROM cancellation_surveys WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 1",
    [orgDono],
  );
  check(
    "a conta retida fica registrada como quem aceitou a proposta",
    retido[0]?.outcome === "aceitou_oferta" && retido[0]?.offer_type === "desconto",
    JSON.stringify(retido[0]),
  );

  res = await api("GET", "/api/billing/subscription", { token: dono.token });
  check(
    "a tela mostra quando cai a próxima cobrança, com ou sem desconto",
    res.data?.organization?.nextInvoice?.amountCents > 0 && Boolean(res.data?.organization?.nextInvoice?.at),
    JSON.stringify(res.data?.organization?.nextInvoice),
  );

  const descontoNaTela = res.data?.organization?.discount;
  check(
    "a tela de assinatura mostra o desconto valendo, por quanto tempo e quanto vai pagar",
    descontoNaTela?.percentOff === 15 &&
      descontoNaTela?.months === 3 &&
      Boolean(descontoNaTela?.endsAt) &&
      descontoNaTela?.nextAmountCents === 3995,
    JSON.stringify(descontoNaTela),
  );

  check(
    "quem aceitou a proposta continua assinante",
    res.data?.organization?.cancelAtPeriodEnd === false,
    String(res.data?.organization?.cancelAtPeriodEnd),
  );

  res = await api("POST", "/api/billing/retention/accept", { token: dono.token, body: { reason: "caro" } });
  check(
    "a mesma conta não pega a proposta duas vezes = 409",
    res.status === 409 && /proposta/i.test(String(res.data?.message)),
    `${res.status} ${res.data?.message}`,
  );

  res = await api("GET", "/api/billing/retention/offers", { token: dono.token });
  check(
    "quem já usou a proposta vê o aviso em vez de uma nova oferta",
    res.data?.reasons?.every((item) => item.offer?.alreadyUsed === true && item.offer?.type === "sem_proposta"),
    JSON.stringify(res.data?.reasons?.map((item) => item.offer?.type)),
  );

  // ======================== pesquisa quando o cancelamento vem do portal
  await api("POST", "/api/billing/subscription/cancel", {
    token: dono.token,
    body: { reason: "outro", comment: "Vou parar por enquanto." },
  });

  // Cancelamento feito no portal da Stripe não passa pela nossa tela: ninguém
  // respondeu a pesquisa ainda.
  await db.query("DELETE FROM cancellation_surveys WHERE organization_id = $1", [orgDono]);

  res = await api("GET", "/api/billing/subscription", { token: dono.token });
  check(
    "cancelamento feito fora do Pauta faz a tela pedir a pesquisa",
    res.data?.organization?.cancelAtPeriodEnd === true && res.data?.organization?.cancellationSurveyPending === true,
    JSON.stringify({
      cancelAtPeriodEnd: res.data?.organization?.cancelAtPeriodEnd,
      pendente: res.data?.organization?.cancellationSurveyPending,
    }),
  );

  res = await api("POST", "/api/billing/cancellation-survey", { token: dono.token, body: { reason: "nao-existe" } });
  check("motivo fora da lista = 400", res.status === 400, `${res.status} ${res.data?.message}`);

  res = await api("POST", "/api/billing/cancellation-survey", {
    token: dono.token,
    body: { reason: "caro", comment: "Vou voltar quando a equipe crescer." },
  });
  check("responder a pesquisa de cancelamento = 200", res.status === 200, `${res.status} ${res.data?.message}`);

  const { rows: pesquisa } = await db.query(
    "SELECT reason, comment, plan FROM cancellation_surveys WHERE organization_id = $1",
    [orgDono],
  );
  res = await api("GET", "/api/billing/subscription", { token: dono.token });
  check(
    "depois de responder, a pesquisa não aparece de novo",
    res.data?.organization?.cancellationSurveyPending === false,
    String(res.data?.organization?.cancellationSurveyPending),
  );

  check(
    "a resposta fica guardada com motivo, comentário e plano",
    pesquisa.length === 1 && pesquisa[0].reason === "caro" && /equipe crescer/.test(pesquisa[0].comment || ""),
    JSON.stringify(pesquisa[0]),
  );

  // ============================================================== faturas
  res = await api("GET", "/api/billing/invoices", { token: dono.token });
  const faturas = res.data?.invoices || [];
  check(
    "histórico de cobranças lista as faturas geradas pelas mudanças",
    res.status === 200 && faturas.length >= 2,
    `${res.status} ${faturas.length}`,
  );
  check(
    "cada fatura traz número, valor, situação e link para o comprovante",
    Boolean(faturas[0]?.number) &&
      typeof faturas[0]?.amountDueCents === "number" &&
      faturas[0]?.status === "paid" &&
      String(faturas[0]?.hostedInvoiceUrl).startsWith("https://"),
    JSON.stringify(faturas[0] && { number: faturas[0].number, status: faturas[0].status, valor: faturas[0].amountDueCents }),
  );
  check(
    "a fatura detalha as linhas cobradas",
    Array.isArray(faturas[0]?.lines) && faturas[0].lines.length >= 1 && typeof faturas[0].lines[0].amountCents === "number",
    JSON.stringify(faturas[0]?.lines),
  );

  // ================================================== portal do cliente
  res = await api("POST", "/api/billing/portal", { token: dono.token });
  check(
    "portal de cobrança devolve o link da Stripe",
    res.status === 200 && String(res.data?.portalUrl).startsWith("https://portal.stripe.test/"),
    `${res.status} ${res.data?.portalUrl || res.data?.message}`,
  );

  const configuracoes = [...ctx.fakes.stripe.portalConfigurations.values()];
  check(
    "o portal da Stripe fica sem cancelamento: cancelar é só pelo Pauta",
    configuracoes.length === 1 &&
      configuracoes[0].features?.subscription_cancel?.enabled === "false" &&
      configuracoes[0].features?.invoice_history?.enabled === "true",
    JSON.stringify(configuracoes[0]?.features),
  );

  const ultimaSessao = ctx.fakes.stripe.portalSessions.at(-1);
  check(
    "a sessão do portal usa essa configuração",
    ultimaSessao?.form?.configuration === configuracoes[0]?.id,
    `${ultimaSessao?.form?.configuration} ${configuracoes[0]?.id}`,
  );

  const portal = fakes.stripe.portalSessions[fakes.stripe.portalSessions.length - 1];
  check(
    "o portal volta para a tela de planos do Pauta",
    String(portal?.form?.return_url || "").includes("billing=plans"),
    String(portal?.form?.return_url),
  );

  // =========================================== quem não é titular nem admin
  const colega = await signup({ email: "cobranca-colega@test.com", seed: 144 });
  await db.query(
    `
      INSERT INTO organization_members (organization_id, member_id, role, status)
      VALUES ($1, $2, 'member', 'active')
      ON CONFLICT (organization_id, member_id) DO NOTHING
    `,
    [orgDono, colega.memberId],
  );
  await db.query("UPDATE members SET active_organization_id = $1 WHERE id = $2", [orgDono, colega.memberId]);

  res = await api("POST", "/api/auth/login", { body: { email: "cobranca-colega@test.com", password: senha } });
  const tokenColega = res.data?.token;
  check(
    "quem entra como membro comum vê a empresa do titular",
    res.data?.user?.organization?.id === orgDono,
    String(res.data?.user?.organization?.id),
  );

  res = await api("GET", "/api/billing/subscription", { token: tokenColega });
  check("membro comum consegue ver a situação do plano", res.status === 200, String(res.status));

  res = await api("GET", "/api/billing/invoices", { token: tokenColega });
  check("membro comum não vê as cobranças = 403", res.status === 403, `${res.status} ${res.data?.message}`);

  res = await api("POST", "/api/billing/portal", { token: tokenColega });
  check("membro comum não abre o portal de cobrança = 403", res.status === 403, `${res.status} ${res.data?.message}`);

  res = await api("POST", "/api/billing/checkout", { token: tokenColega, body: { plan: "essencial" } });
  check("membro comum não contrata plano = 403", res.status === 403, `${res.status} ${res.data?.message}`);

  res = await api("POST", "/api/billing/subscription/cancel", { token: tokenColega, body: { reason: "outro" } });
  check("membro comum não cancela a assinatura = 403", res.status === 403, `${res.status} ${res.data?.message}`);

  // ============================================================== webhooks
  res = await api("POST", "/api/billing/webhook", {
    raw: JSON.stringify({ type: "invoice.paid", data: { object: {} } }),
    headers: { "Content-Type": "application/json", "stripe-signature": "t=1,v1=assinatura-falsificada" },
  });
  check(
    "webhook com assinatura inválida é recusado = 400",
    res.status === 400 && String(res.data?.message).includes("Assinatura Stripe inválida"),
    `${res.status} ${res.data?.message}`,
  );

  res = await api("POST", "/api/billing/webhook", {
    raw: JSON.stringify({ type: "invoice.paid", data: { object: {} } }),
    headers: { "Content-Type": "application/json" },
  });
  check("webhook sem assinatura nenhuma é recusado = 400", res.status === 400, `${res.status} ${res.data?.message}`);

  const web = await signup({ email: "cobranca-webhook@test.com", seed: 145 });
  const orgWeb = web.organizationId;

  res = await api("POST", "/api/tags", { token: web.token, body: { name: "Etiqueta de cobrança", color: "#ff5500" } });
  const etiquetaId = res.data?.tag?.id;
  check("conta em dia consegue criar uma etiqueta", res.status === 201 && Boolean(etiquetaId), `${res.status} ${res.data?.message}`);

  const assinaturaWeb = "sub_cobranca_webhook";
  fakes.stripe.upsertSubscription(assinaturaWeb, { customer: "cus_cobranca_webhook" });
  fakes.stripe.setItems(assinaturaWeb, [{ price: "price_essencial_monthly", quantity: 1 }]);
  await db.query(
    "UPDATE organizations SET stripe_customer_id = 'cus_cobranca_webhook', stripe_subscription_id = $2 WHERE id = $1",
    [orgWeb, assinaturaWeb],
  );

  res = await ctx.sendWebhook("customer.subscription.updated", fakes.stripe.subscriptions.get(assinaturaWeb));
  check(
    "assinatura atualizada na Stripe deixa a conta ativa no plano contratado",
    res.status === 200 && res.data?.reason === "subscription_active" && res.data.organizationId === orgWeb,
    `${res.status} ${JSON.stringify(res.data)}`,
  );

  let { rows: estado } = await db.query("SELECT plan, subscription_status FROM organizations WHERE id = $1", [orgWeb]);
  check(
    "o plano gravado é o que a assinatura da Stripe descreve",
    estado[0]?.plan === "essencial" && estado[0].subscription_status === "active",
    JSON.stringify(estado[0]),
  );

  const faturaPaga = fakes.buildInvoice(fakes.stripe.subscriptions.get(assinaturaWeb));
  faturaPaga.subscription = assinaturaWeb;
  fakes.stripe.invoices.unshift(faturaPaga);

  res = await ctx.sendWebhook("invoice.paid", faturaPaga);
  check(
    "fatura paga confirma a assinatura da conta",
    res.status === 200 && res.data?.applied === true && res.data.organizationId === orgWeb,
    `${res.status} ${JSON.stringify(res.data)}`,
  );

  res = await ctx.sendWebhook("invoice.paid", { id: "in_avulsa", object: "invoice", customer: "cus_cobranca_webhook" });
  check(
    "fatura paga sem assinatura vinculada é ignorada sem erro",
    res.status === 200 && res.data?.reason === "invoice_without_subscription",
    `${res.status} ${JSON.stringify(res.data)}`,
  );

  res = await ctx.sendWebhook("invoice.payment_failed", {
    id: "in_recusada",
    object: "invoice",
    customer: "cus_cobranca_webhook",
  });
  check(
    "pagamento recusado coloca a conta em atraso",
    res.status === 200 && res.data?.reason === "payment_failed" && res.data.organizationId === orgWeb,
    `${res.status} ${JSON.stringify(res.data)}`,
  );

  ({ rows: estado } = await db.query(
    "SELECT subscription_status, past_due_since FROM organizations WHERE id = $1",
    [orgWeb],
  ));
  check(
    "a conta em atraso guarda desde quando a fatura está aberta",
    estado[0]?.subscription_status === "past_due" && Boolean(estado[0].past_due_since),
    JSON.stringify(estado[0]),
  );

  res = await ctx.sendWebhook("invoice.payment_failed", { id: "in_sem_cliente", object: "invoice" });
  check(
    "pagamento recusado sem cliente é ignorado sem erro",
    res.status === 200 && res.data?.reason === "invoice_without_customer",
    `${res.status} ${JSON.stringify(res.data)}`,
  );

  res = await ctx.sendWebhook("customer.subscription.updated", { id: "sub_desconhecida", object: "subscription", status: "active", customer: "cus_que_nao_existe" });
  check(
    "evento de uma assinatura que não é de nenhuma conta é ignorado",
    res.status === 200 && res.data?.reason === "organization_not_found",
    `${res.status} ${JSON.stringify(res.data)}`,
  );

  res = await ctx.sendWebhook("customer.tax_id.created", { id: "txi_1", object: "tax_id" });
  check(
    "evento que não interessa à cobrança é ignorado",
    res.status === 200 && res.data?.reason === "event_ignored",
    `${res.status} ${JSON.stringify(res.data)}`,
  );

  // ============================== somente leitura por fatura muito atrasada
  fakes.stripe.upsertSubscription(assinaturaWeb, { status: "past_due" });
  res = await ctx.sendWebhook("customer.subscription.updated", fakes.stripe.subscriptions.get(assinaturaWeb));
  check(
    "assinatura em atraso na Stripe mantém a conta marcada como past_due",
    res.status === 200 && res.data?.reason === "subscription_past_due",
    `${res.status} ${JSON.stringify(res.data)}`,
  );

  await db.query(
    "UPDATE organizations SET past_due_since = CURRENT_TIMESTAMP - INTERVAL '20 days' WHERE id = $1",
    [orgWeb],
  );

  res = await api("GET", "/api/billing/subscription", { token: web.token });
  organizacao = res.data?.organization;
  check(
    "fatura aberta há 20 dias deixa a conta somente leitura, com aviso",
    organizacao?.payment?.pastDue === true &&
      organizacao.payment.days >= 15 &&
      organizacao.payment.warn === true &&
      organizacao.payment.readOnly === true &&
      organizacao.readOnly === true,
    JSON.stringify(organizacao?.payment),
  );

  res = await api("POST", "/api/tags", { token: web.token, body: { name: "Não deveria entrar", color: "#000000" } });
  check(
    "em somente leitura por falta de pagamento, criar coisas é bloqueado = 403",
    res.status === 403 && res.data?.code === "PLAN_PAYMENT_OVERDUE",
    `${res.status} ${res.data?.code}`,
  );

  res = await api("DELETE", `/api/tags/${etiquetaId}`, { token: web.token });
  check(
    "em somente leitura apagar continua liberado, para a conta se ajustar",
    res.status === 200,
    `${res.status} ${res.data?.message}`,
  );

  res = await api("GET", "/api/tags", { token: web.token });
  check("em somente leitura a consulta continua funcionando", res.status === 200, String(res.status));

  res = await api("GET", "/api/billing/plans", { token: web.token });
  check("em somente leitura a tela de planos continua acessível", res.status === 200, String(res.status));

  // ====================================================== fim da assinatura
  fakes.stripe.upsertSubscription(assinaturaWeb, { status: "canceled" });
  res = await ctx.sendWebhook("customer.subscription.deleted", fakes.stripe.subscriptions.get(assinaturaWeb));
  check(
    "assinatura encerrada na Stripe devolve a conta ao Grátis",
    res.status === 200 && res.data?.reason === "subscription_ended",
    `${res.status} ${JSON.stringify(res.data)}`,
  );

  ({ rows: estado } = await db.query(
    "SELECT plan, subscription_status, extra_seats, extra_storage_packs, past_due_since FROM organizations WHERE id = $1",
    [orgWeb],
  ));
  check(
    "ao encerrar, a conta volta ao Grátis, sem adicionais e sem atraso pendente",
    estado[0]?.plan === "free" &&
      estado[0].subscription_status === "canceled" &&
      estado[0].extra_seats === 0 &&
      estado[0].extra_storage_packs === 0 &&
      estado[0].past_due_since === null,
    JSON.stringify(estado[0]),
  );

  res = await api("POST", "/api/tags", { token: web.token, body: { name: "Depois do encerramento", color: "#0055ff" } });
  check(
    "sem a fatura em atraso a conta volta a poder editar",
    res.status === 201,
    `${res.status} ${res.data?.message || res.data?.code}`,
  );
};
