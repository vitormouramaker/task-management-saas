/**
 * Chat de suporte (política por plano, conversa, resposta da equipe do Pauta,
 * resolver/reabrir, privacidade e limite) e notas fiscais (fila gerada pela
 * fatura paga, registro da nota emitida e a nota na tela de Pagamentos).
 */
module.exports = async function casosDeSuporteENotas(ctx) {
  const { api, db, check, signup } = ctx;

  // ------------------------------------------------------------------ contas
  const gratis = await signup({ email: "suporte-gratis@test.com", seed: 71 });

  const pago = await signup({
    email: "suporte-pago@test.com",
    accountType: "business",
    seed: 72,
    company: { cnpj: ctx.makeCnpj(72), name: "Suporte Teste LTDA" },
  });

  const equipe = await signup({ email: "suporte-equipe@test.com", seed: 73 });
  // Precisa virar equipe ANTES da primeira chamada a /api/admin: a permissão
  // fica 30s em cache.
  await db.query("UPDATE members SET is_platform_admin = TRUE WHERE id = $1", [equipe.memberId]);

  const estranho = await signup({ email: "suporte-estranho@test.com", seed: 74 });

  // ------------------------------------------------------- política por plano
  ctx.setGroup("suporte");

  let res = await api("GET", "/api/support", { token: gratis.token });
  check(
    "no plano Grátis o suporte diz que o chat não está liberado",
    res.status === 200 && res.data?.policy?.chat === false,
    `${res.status} ${JSON.stringify(res.data?.policy)}`,
  );
  check(
    "a política mostra o plano da conta e o horário de atendimento",
    res.data?.policy?.planId === "free" &&
      res.data?.policy?.planName === "Grátis" &&
      String(res.data?.policy?.businessHours || "").includes("9h às 18h"),
    JSON.stringify(res.data?.policy),
  );

  res = await api("POST", "/api/support", {
    token: gratis.token,
    body: { subject: "Preciso de ajuda", message: "Não consigo criar projeto." },
  });
  check(
    "no plano Grátis não dá para abrir conversa = 403",
    res.status === 403 && res.data?.code === "SUPPORT_CHAT_UNAVAILABLE",
    `${res.status} ${res.data?.code} ${res.data?.message}`,
  );

  // Assinatura de teste para a conta paga (também usada nas notas fiscais).
  ctx.fakes.stripe.upsertSubscription("sub_suporte", { customer: "cus_suporte" });
  ctx.fakes.stripe.setItems("sub_suporte", [{ price: "price_profissional_monthly", quantity: 1 }]);
  await db.query(
    "UPDATE organizations SET stripe_customer_id = 'cus_suporte', stripe_subscription_id = 'sub_suporte' WHERE id = $1",
    [pago.organizationId],
  );
  await ctx.sendWebhook(
    "customer.subscription.updated",
    ctx.fakes.stripe.subscriptions.get("sub_suporte"),
  );

  res = await api("GET", "/api/support", { token: pago.token });
  check(
    "no plano pago o chat fica liberado",
    res.status === 200 && res.data?.policy?.chat === true && res.data?.policy?.planId === "profissional",
    `${res.status} ${JSON.stringify(res.data?.policy)}`,
  );
  check(
    "a política do plano pago informa o prazo de resposta",
    Boolean(res.data?.policy?.responseTime),
    String(res.data?.policy?.responseTime),
  );

  // --------------------------------------------------------- abrir a conversa
  res = await api("POST", "/api/support", {
    token: pago.token,
    body: { subject: "oi", message: "Mensagem qualquer." },
  });
  check("assunto curto demais = 400", res.status === 400, `${res.status} ${res.data?.message}`);

  res = await api("POST", "/api/support", {
    token: pago.token,
    body: { subject: "Erro ao subir arquivo", message: "   " },
  });
  check("mensagem vazia = 400", res.status === 400, `${res.status} ${res.data?.message}`);

  res = await api("POST", "/api/support", {
    token: pago.token,
    body: { subject: "Erro ao subir arquivo", message: "O anexo de 30 MB não sobe." },
  });
  check(
    "abrir conversa no plano pago = 201 e nasce aberta",
    res.status === 201 && res.data?.conversation?.status === "aberta",
    `${res.status} ${JSON.stringify(res.data?.conversation?.status)}`,
  );
  const conversaId = res.data?.conversation?.id;
  check(
    "a conversa já começa com a mensagem do cliente",
    res.data?.messages?.length === 1 && res.data.messages[0].authorType === "customer",
    JSON.stringify(res.data?.messages?.map((m) => m.authorType)),
  );
  check(
    "a conversa nova entra como não lida para a equipe",
    res.data?.conversation?.teamUnread === 1,
    String(res.data?.conversation?.teamUnread),
  );

  res = await api("GET", "/api/support", { token: pago.token });
  check(
    "a conversa aparece na lista do cliente",
    res.status === 200 && res.data?.conversations?.some((c) => c.id === conversaId),
    `${res.status} ${res.data?.conversations?.length}`,
  );

  res = await api("GET", `/api/support/${conversaId}`, { token: pago.token });
  check(
    "abrir a conversa mostra as mensagens e zera o não lido do cliente",
    res.status === 200 && res.data?.messages?.length === 1 && res.data?.conversation?.customerUnread === 0,
    `${res.status} ${JSON.stringify(res.data?.conversation?.customerUnread)}`,
  );

  // ---------------------------------------------------------- lado da equipe
  res = await api("GET", "/api/admin/support", { token: pago.token });
  check(
    "cliente não entra na caixa de suporte da equipe = 403",
    res.status === 403,
    `${res.status} ${res.data?.message}`,
  );

  res = await api("GET", "/api/admin/support", { token: equipe.token });
  const naFila = res.data?.conversations?.find((c) => c.id === conversaId);
  check(
    "a equipe vê a conversa na fila com a conta e o plano",
    res.status === 200 && Boolean(naFila) && naFila?.planId === "profissional",
    `${res.status} ${JSON.stringify(naFila && { plano: naFila.planId, conta: naFila.organizationName })}`,
  );
  check(
    "a fila marca a conversa como não lida pela equipe",
    naFila?.teamUnread === 1,
    String(naFila?.teamUnread),
  );
  check(
    "a fila traz o total por situação",
    Number(res.data?.counts?.aberta || 0) >= 1,
    JSON.stringify(res.data?.counts),
  );

  res = await api("GET", `/api/admin/support/${conversaId}`, { token: equipe.token });
  check(
    "a equipe abre a conversa e o não lido dela zera",
    res.status === 200 && res.data?.conversation?.teamUnread === 0,
    `${res.status} ${JSON.stringify(res.data?.conversation?.teamUnread)}`,
  );

  res = await api("POST", `/api/admin/support/${conversaId}/messages`, {
    token: equipe.token,
    body: { body: "Oi! Já aumentamos o limite do seu plano. Pode tentar de novo." },
  });
  check(
    "a equipe responde e a conversa passa para respondida",
    res.status === 201 && res.data?.conversation?.status === "respondida",
    `${res.status} ${res.data?.conversation?.status}`,
  );
  check(
    "a resposta da equipe deixa uma mensagem não lida para o cliente",
    res.data?.conversation?.customerUnread === 1,
    String(res.data?.conversation?.customerUnread),
  );

  res = await api("GET", `/api/support/${conversaId}`, { token: pago.token });
  const respostaDaEquipe = res.data?.messages?.find((m) => m.authorType === "team");
  check(
    "o cliente vê a resposta assinada pela Equipe Pauta",
    res.status === 200 && res.data?.messages?.length === 2 && respostaDaEquipe?.authorName === "Equipe Pauta",
    `${res.status} ${JSON.stringify(respostaDaEquipe?.authorName)}`,
  );

  // --------------------------------- encerramento pela equipe e satisfação
  res = await api("POST", `/api/support/${conversaId}/resolve`, { token: pago.token });
  check("cliente não encerra a conversa (rota não existe mais)", res.status === 404, String(res.status));

  res = await api("POST", `/api/support/${conversaId}/survey`, { token: pago.token, body: { rating: 5 } });
  check(
    "pesquisa só aparece depois que a equipe encerra = 409",
    res.status === 409,
    `${res.status} ${res.data?.message}`,
  );

  res = await api("PATCH", `/api/admin/support/${conversaId}`, { token: equipe.token, body: { status: "resolvida" } });
  check(
    "a equipe encerra o atendimento",
    res.status === 200 && res.data?.conversation?.status === "resolvida",
    `${res.status} ${res.data?.conversation?.status}`,
  );

  res = await api("POST", `/api/support/${conversaId}/messages`, {
    token: pago.token,
    body: { body: "Voltou a dar erro, podem olhar de novo?" },
  });
  check(
    "conversa encerrada não recebe mais mensagem do cliente = 409",
    res.status === 409 && res.data?.code === "SUPPORT_CONVERSATION_CLOSED",
    `${res.status} ${res.data?.message}`,
  );

  res = await api("POST", `/api/support/${conversaId}/survey`, { token: pago.token, body: { rating: 9 } });
  check("nota fora de 1 a 5 = 400", res.status === 400, `${res.status} ${res.data?.message}`);

  res = await api("POST", `/api/support/${conversaId}/survey`, {
    token: pago.token,
    body: { rating: 5, comment: "Resolveram rápido." },
  });
  check("cliente avalia o atendimento = 201", res.status === 201, `${res.status} ${res.data?.message}`);

  res = await api("POST", `/api/support/${conversaId}/survey`, { token: pago.token, body: { rating: 3 } });
  check("não dá para avaliar duas vezes = 409", res.status === 409, `${res.status} ${res.data?.message}`);

  res = await api("GET", "/api/support", { token: pago.token });
  check(
    "a conversa avaliada mostra a nota para o cliente",
    res.data?.conversations?.find((c) => c.id === conversaId)?.surveyRating === 5,
    JSON.stringify(res.data?.conversations?.map((c) => [c.id, c.surveyRating])),
  );

  res = await api("GET", "/api/admin/support/avaliacoes", { token: equipe.token });
  check(
    "painel mostra a avaliação com média e comentário",
    res.status === 200 &&
      res.data?.total >= 1 &&
      res.data?.average >= 1 &&
      res.data?.surveys?.some((item) => item.conversationId === conversaId && /rápido/.test(item.comment || "")),
    `${res.status} ${JSON.stringify(res.data)?.slice(0, 200)}`,
  );

  res = await api("GET", "/api/admin/support/avaliacoes", { token: pago.token });
  check("cliente não vê as avaliações do painel = 403", res.status === 403, String(res.status));

  // ------------------------------------------------------------ privacidade
  res = await api("GET", `/api/support/${conversaId}`, { token: estranho.token });
  check(
    "uma pessoa não abre a conversa de outra = 404",
    res.status === 404,
    `${res.status} ${res.data?.message}`,
  );

  res = await api("POST", `/api/support/${conversaId}/messages`, {
    token: estranho.token,
    body: { body: "deixa eu entrar" },
  });
  check(
    "uma pessoa não escreve na conversa de outra = 404",
    res.status === 404,
    `${res.status} ${res.data?.message}`,
  );

  // --------------------------------------------------- limite de conversas
  // A primeira conversa foi encerrada pela equipe, então começa do zero:
  // abrir 5 fecha o limite.
  for (let i = 0; i < 5; i += 1) {
    res = await api("POST", "/api/support", {
      token: pago.token,
      body: { subject: `Dúvida número ${i + 1}`, message: "Preciso de ajuda com isso." },
    });
    check(
      `abrir a conversa ${i + 1} de 5 ainda é permitido`,
      res.status === 201,
      `${res.status} ${res.data?.message}`,
    );
  }

  res = await api("POST", "/api/support", {
    token: pago.token,
    body: { subject: "Mais uma dúvida", message: "E essa aqui também." },
  });
  check(
    "com 5 conversas em andamento, a sexta é barrada",
    res.status === 429,
    `${res.status} ${res.data?.message}`,
  );

  res = await api("GET", "/api/support", { token: pago.token });
  check(
    "o cliente continua com 5 conversas em andamento",
    res.data?.conversations?.filter((c) => c.status !== "resolvida").length === 5,
    JSON.stringify(res.data?.conversations?.map((c) => c.status)),
  );

  // =========================================================== notas fiscais
  ctx.setGroup("notas fiscais");

  const { rows: contaRows } = await db.query(
    "SELECT name, legal_name, cnpj FROM organizations WHERE id = $1",
    [pago.organizationId],
  );
  const conta = contaRows[0];

  const assinatura = ctx.fakes.stripe.subscriptions.get("sub_suporte");
  const fatura = ctx.fakes.buildInvoice(assinatura, { amount: 12900 });
  ctx.fakes.stripe.invoices.unshift(fatura);

  res = await ctx.sendWebhook("invoice.paid", fatura);
  check("o webhook de fatura paga é aceito", res.status === 200, `${res.status} ${JSON.stringify(res.data)}`);

  res = await api("GET", "/api/admin/nfse", { token: equipe.token });
  const pedido = res.data?.records?.find((r) => r.stripeInvoiceId === fatura.id);
  check(
    "a fatura paga vira um pedido de nota pendente",
    res.status === 200 && Boolean(pedido) && pedido?.status === "pendente",
    `${res.status} ${JSON.stringify(pedido?.status)}`,
  );
  check(
    "o pedido traz o tomador com o CNPJ da conta",
    pedido?.customerDocument === conta.cnpj &&
      pedido?.customerDocumentType === "CNPJ" &&
      pedido?.customerName === (conta.legal_name || conta.name),
    JSON.stringify({
      doc: pedido?.customerDocument,
      tipo: pedido?.customerDocumentType,
      nome: pedido?.customerName,
      esperado: { cnpj: conta.cnpj, nome: conta.legal_name || conta.name },
    }),
  );
  check(
    "o pedido traz o valor pago e a competência do mês",
    pedido?.amountCents === 12900 && pedido?.competence === new Date().toISOString().slice(0, 7),
    JSON.stringify({ valor: pedido?.amountCents, competencia: pedido?.competence }),
  );
  check(
    "o pedido traz a discriminação do serviço com a fatura de referência",
    String(pedido?.serviceDescription || "").includes("Licença de uso do software Pauta") &&
      String(pedido?.serviceDescription || "").includes(fatura.number),
    JSON.stringify(pedido?.serviceDescription),
  );

  // O mesmo evento chegando de novo não pode duplicar a fila.
  await ctx.sendWebhook("invoice.paid", fatura);
  const { rows: duplicadas } = await db.query(
    "SELECT COUNT(*)::int AS total FROM nfse_records WHERE stripe_invoice_id = $1",
    [fatura.id],
  );
  check(
    "o mesmo evento repetido não duplica o pedido de nota",
    duplicadas[0].total === 1,
    String(duplicadas[0].total),
  );

  res = await api("GET", "/api/admin/nfse", { token: pago.token });
  check("cliente comum não vê a fila de notas = 403", res.status === 403, `${res.status} ${res.data?.message}`);

  // ------------------------------------------------------- registrar emitida
  res = await api("PATCH", `/api/admin/nfse/${pedido.id}`, {
    token: equipe.token,
    body: { status: "emitida" },
  });
  check("registrar nota emitida sem número = 400", res.status === 400, `${res.status} ${res.data?.message}`);

  res = await api("PATCH", `/api/admin/nfse/${pedido.id}`, {
    token: equipe.token,
    body: { status: "emitida", nfseNumber: "2026000123", documentUrl: "http://nota.insegura.test/123" },
  });
  check("link da nota que não começa com https = 400", res.status === 400, `${res.status} ${res.data?.message}`);

  res = await api("PATCH", `/api/admin/nfse/${pedido.id}`, {
    token: equipe.token,
    body: {
      status: "emitida",
      nfseNumber: "2026000123",
      verificationCode: "ABC-123",
      documentUrl: "https://nfse.example.gov.br/nota/2026000123",
    },
  });
  check(
    "registrar nota com número e link https = 200",
    res.status === 200 && res.data?.record?.status === "emitida" && res.data?.record?.nfseNumber === "2026000123",
    `${res.status} ${JSON.stringify(res.data?.record?.status)}`,
  );
  check(
    "a nota emitida guarda a data de emissão",
    Boolean(res.data?.record?.issuedAt),
    JSON.stringify(res.data?.record?.issuedAt),
  );

  res = await api("GET", "/api/admin/nfse", { token: equipe.token });
  const emitida = res.data?.records?.find((r) => r.id === pedido.id);
  check(
    "a fila mostra quem da equipe emitiu a nota",
    emitida?.issuedByName === equipe.user?.name,
    JSON.stringify({ por: emitida?.issuedByName, esperado: equipe.user?.name }),
  );

  // ---------------------------------------------------------- não emitir
  const outraFatura = ctx.fakes.buildInvoice(assinatura, { amount: 4700 });
  ctx.fakes.stripe.invoices.unshift(outraFatura);
  await ctx.sendWebhook("invoice.paid", outraFatura);

  res = await api("GET", "/api/admin/nfse", { token: equipe.token });
  const segundoPedido = res.data?.records?.find((r) => r.stripeInvoiceId === outraFatura.id);
  check("a segunda fatura paga também entra na fila", Boolean(segundoPedido), JSON.stringify(res.data?.counts));

  res = await api("PATCH", `/api/admin/nfse/${segundoPedido?.id}`, {
    token: equipe.token,
    body: { status: "nao_emitir" },
  });
  check("marcar 'não emitir' sem explicar o motivo = 400", res.status === 400, `${res.status} ${res.data?.message}`);

  res = await api("PATCH", `/api/admin/nfse/${segundoPedido?.id}`, {
    token: equipe.token,
    body: { status: "nao_emitir", notes: "Ajuste proporcional já incluído na nota do mês." },
  });
  check(
    "marcar 'não emitir' com motivo = 200",
    res.status === 200 && res.data?.record?.status === "nao_emitir",
    `${res.status} ${res.data?.record?.status}`,
  );

  // ------------------------------------------- a nota na tela de Pagamentos
  res = await api("GET", "/api/billing/invoices", { token: pago.token });
  const faturaNaTela = res.data?.invoices?.find((i) => i.id === fatura.id);
  check(
    "a fatura aparece no histórico de cobranças do cliente",
    res.status === 200 && Boolean(faturaNaTela),
    `${res.status} ${res.data?.invoices?.length}`,
  );
  check(
    "a nota emitida aparece junto da fatura, com número e link",
    faturaNaTela?.nfse?.status === "emitida" &&
      faturaNaTela?.nfse?.number === "2026000123" &&
      String(faturaNaTela?.nfse?.url || "").startsWith("https://"),
    JSON.stringify(faturaNaTela?.nfse),
  );

  const outraNaTela = res.data?.invoices?.find((i) => i.id === outraFatura.id);
  check(
    "a fatura sem nota não mostra número de nota para o cliente",
    outraNaTela?.nfse?.status === "nao_emitir" && !outraNaTela?.nfse?.number,
    JSON.stringify(outraNaTela?.nfse),
  );
};
