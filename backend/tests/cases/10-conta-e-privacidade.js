/**
 * Conta da pessoa: trocar senha e e-mail, várias contas no mesmo cadastro,
 * sessões, tour do primeiro acesso, aceite dos documentos e LGPD
 * (exportar e excluir).
 */
module.exports = async function casosDeContaEPrivacidade(ctx) {
  const { api, db, check, signup } = ctx;

  const pessoa = await signup({ email: "conta-dono@test.com", seed: 71 });

  // ---------- dados da conta ----------
  let res = await api("GET", "/api/account", { token: pessoa.token });
  check("dados da conta respondem para quem está logado", res.status === 200, `${res.status} ${res.data?.message}`);

  res = await api("GET", "/api/account/list", { token: pessoa.token });
  check(
    "a pessoa vê a própria conta na lista",
    res.status === 200 && (res.data?.organizations || res.data?.accounts || []).length >= 1,
    JSON.stringify(res.data)?.slice(0, 160),
  );

  // ---------- tour do primeiro acesso ----------
  const { rows: tourAntes } = await db.query("SELECT tour_completed_at FROM members WHERE id = $1", [pessoa.memberId]);
  check("conta nova começa com o tour pendente", tourAntes[0]?.tour_completed_at === null, JSON.stringify(tourAntes[0]));

  res = await api("POST", "/api/onboarding/tour/complete", { token: pessoa.token });
  const { rows: tourDepois } = await db.query("SELECT tour_completed_at FROM members WHERE id = $1", [pessoa.memberId]);
  check(
    "concluir o tour = 200 e fica registrado",
    res.status === 200 && Boolean(tourDepois[0]?.tour_completed_at),
    `${res.status} ${JSON.stringify(tourDepois[0])}`,
  );

  res = await api("POST", "/api/onboarding/tour/complete");
  check("concluir o tour sem login = 401", res.status === 401, String(res.status));

  // ---------- e-mails de dicas ----------
  res = await api("POST", "/api/onboarding/dicas/sair", { body: { m: pessoa.memberId, t: "token-errado" } });
  check("sair das dicas com link inválido = 400", res.status === 400, `${res.status} ${res.data?.message}`);

  const crypto = require("crypto");
  const tokenDicas = crypto
    .createHmac("sha256", `${ctx.constants.JWT_SECRET}.dicas`)
    .update(pessoa.memberId)
    .digest("hex")
    .slice(0, 32);
  res = await api("POST", "/api/onboarding/dicas/sair", { body: { m: pessoa.memberId, t: tokenDicas } });
  const { rows: optOut } = await db.query("SELECT product_tips_opt_out FROM members WHERE id = $1", [pessoa.memberId]);
  check(
    "sair das dicas pelo link do e-mail funciona sem login",
    res.status === 200 && optOut[0]?.product_tips_opt_out === true,
    `${res.status} ${res.data?.message}`,
  );

  // ---------- documentos jurídicos ----------
  res = await api("GET", "/api/legal/acceptances", { token: pessoa.token });
  check(
    "a pessoa consegue ver o próprio aceite dos documentos",
    res.status === 200 && (res.data?.history || []).length >= 2 && res.data?.accepted === true,
    JSON.stringify(res.data)?.slice(0, 160),
  );

  await db.query("DELETE FROM legal_acceptances WHERE member_id = $1", [pessoa.memberId]);
  res = await api("POST", "/api/auth/login", { body: { email: "conta-dono@test.com", password: "senha-forte-123" } });
  check(
    "documento novo faz a plataforma pedir o aceite de novo",
    res.data?.user?.requiresLegalAcceptance === true,
    JSON.stringify(res.data?.user?.requiresLegalAcceptance),
  );
  const acessoAtual = res.data;

  res = await api("POST", "/api/legal/accept", { token: acessoAtual.token, body: { documents: ["terms", "privacy"] } });
  check("aceitar os documentos = 200", res.status === 200, `${res.status} ${res.data?.message}`);

  res = await api("POST", "/api/auth/login", { body: { email: "conta-dono@test.com", password: "senha-forte-123" } });
  check("depois de aceitar, a plataforma não pede mais", res.data?.user?.requiresLegalAcceptance === false, String(res.data?.user?.requiresLegalAcceptance));

  // ---------- senha ----------
  let token = res.data?.token;
  res = await api("PUT", "/api/account/password", {
    token,
    body: { currentPassword: "errada", newPassword: "nova-senha-123" },
  });
  check("trocar senha com a senha atual errada é recusado", [400, 401, 403].includes(res.status), String(res.status));

  res = await api("PUT", "/api/account/password", {
    token,
    body: { currentPassword: "senha-forte-123", newPassword: "curta" },
  });
  check("senha nova curta demais é recusada", res.status === 400, `${res.status} ${res.data?.message}`);

  res = await api("PUT", "/api/account/password", {
    token,
    body: { currentPassword: "senha-forte-123", newPassword: "nova-senha-123" },
  });
  check("trocar senha = 200", res.status === 200, `${res.status} ${res.data?.message}`);

  res = await api("POST", "/api/auth/login", { body: { email: "conta-dono@test.com", password: "senha-forte-123" } });
  check("senha antiga não entra mais = 401", res.status === 401, String(res.status));

  res = await api("POST", "/api/auth/login", { body: { email: "conta-dono@test.com", password: "nova-senha-123" } });
  check("senha nova entra = 200", res.status === 200, String(res.status));
  token = res.data?.token;

  // ---------- recuperar senha ----------
  res = await api("POST", "/api/auth/forgot-password", { body: { email: "nao-existe@test.com" } });
  check("recuperar senha de e-mail desconhecido não revela nada", res.status === 200, `${res.status} ${res.data?.message}`);

  res = await api("POST", "/api/auth/reset-password", { body: { token: "x", password: "1234567" } });
  check("redefinir senha com menos de 8 caracteres = 400", res.status === 400 && /8/.test(String(res.data?.message)), res.data?.message);

  // ---------- sessões ----------
  res = await api("GET", "/api/account/sessions", { token });
  check(
    "a pessoa vê as próprias sessões abertas",
    res.status === 200 && Array.isArray(res.data?.sessions || res.data),
    JSON.stringify(res.data)?.slice(0, 160),
  );

  const outroLogin = await api("POST", "/api/auth/login", { body: { email: "conta-dono@test.com", password: "nova-senha-123" } });
  res = await api("POST", "/api/auth/logout-all", { token });
  check("sair de todos os aparelhos = 200", res.status === 200, `${res.status} ${res.data?.message}`);

  res = await api("POST", "/api/auth/refresh", { body: { refreshToken: outroLogin.data?.refreshToken } });
  check("depois de sair de todos, o acesso antigo morre", res.status === 401, String(res.status));

  // ---------- troca de e-mail ----------
  const entrada = await api("POST", "/api/auth/login", { body: { email: "conta-dono@test.com", password: "nova-senha-123" } });
  token = entrada.data?.token;

  res = await api("PUT", "/api/account/email", { token, body: { email: "conta-novo@test.com", password: "nova-senha-123" } });
  check("trocar o e-mail = 200", res.status === 200, `${res.status} ${res.data?.message}`);

  const { rows: emailTrocado } = await db.query("SELECT email, email_verified_at FROM members WHERE id = $1", [pessoa.memberId]);
  check(
    "e-mail novo entra como não confirmado",
    emailTrocado[0]?.email === "conta-novo@test.com" && emailTrocado[0]?.email_verified_at === null,
    JSON.stringify(emailTrocado[0]),
  );

  res = await api("POST", "/api/auth/verify-email", { body: { token: await ctx.verificationTokenFor("conta-novo@test.com") } });
  check("confirmar o e-mail novo = 200", res.status === 200, `${res.status} ${res.data?.message}`);

  // ---------- várias contas no mesmo cadastro ----------
  const logado = await api("POST", "/api/auth/login", { body: { email: "conta-novo@test.com", password: "nova-senha-123" } });
  token = logado.data?.token;

  res = await api("POST", "/api/account/business", {
    token,
    body: { company: { cnpj: ctx.makeCnpj(9072), tradeName: "Segunda Empresa" } },
  });
  check("criar uma conta empresarial a partir do cadastro = 201", res.status === 201 || res.status === 200, `${res.status} ${res.data?.message}`);
  const segundaOrg = res.data?.organization?.id || res.data?.user?.organization?.id;

  res = await api("GET", "/api/account/list", { token });
  const contas = res.data?.organizations || res.data?.accounts || [];
  check("as duas contas aparecem na lista", contas.length >= 2, JSON.stringify(contas.map?.((item) => item.name)));

  if (segundaOrg) {
    res = await api("POST", "/api/auth/switch-organization", { token, body: { organizationId: segundaOrg } });
    check(
      "trocar de conta devolve a sessão da conta escolhida",
      res.status === 200 && res.data?.user?.organization?.id === segundaOrg,
      `${res.status} ${res.data?.user?.organization?.id}`,
    );
    token = res.data?.token || token;
  }

  // ---------- LGPD ----------
  res = await api("GET", "/api/account/export", { token });
  check(
    "exportar os dados devolve o conteúdo da conta",
    res.status === 200 && Boolean(res.data),
    `${res.status} ${JSON.stringify(res.data)?.slice(0, 120)}`,
  );

  const paraApagar = await signup({ email: "conta-apagar@test.com", seed: 73 });
  res = await api("DELETE", "/api/account/me", {
    token: paraApagar.token,
    body: { password: "errada", confirm: "EXCLUIR" },
  });
  check("excluir o cadastro com senha errada é recusado", [400, 401, 403].includes(res.status), String(res.status));

  res = await api("DELETE", "/api/account/me", {
    token: paraApagar.token,
    body: { password: "senha-forte-123", confirm: "EXCLUIR" },
  });
  check("excluir o próprio cadastro = 200", res.status === 200, `${res.status} ${res.data?.message}`);

  const { rows: apagado } = await db.query("SELECT email FROM members WHERE id = $1", [paraApagar.memberId]);
  check(
    "o cadastro excluído é anonimizado",
    apagado.length === 0 || String(apagado[0].email).startsWith("removido+"),
    JSON.stringify(apagado[0]),
  );

  res = await api("POST", "/api/auth/login", { body: { email: "conta-apagar@test.com", password: "senha-forte-123" } });
  check("cadastro excluído não entra mais", res.status === 401, String(res.status));
};
