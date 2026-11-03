/**
 * Cadastro, confirmação de e-mail, login, sessão e o projeto de exemplo que
 * toda conta nova recebe.
 */
module.exports = async function casosDeContas(ctx) {
  const { api, db, check } = ctx;

  // ---------- cadastro ----------
  let res = await api("POST", "/api/auth/signup", {
    body: {
      accountType: "personal",
      email: "pessoal@test.com",
      name: "Pessoa Teste 1",
      cpf: ctx.makeCpf(1),
      phone: "11987654321",
      birthDate: "1990-05-10",
      password: "senha-forte-123",
      acceptedTerms: true,
    },
  });
  check("cadastro pessoal = 201", res.status === 201, `${res.status} ${res.data?.message}`);
  const tokenPessoal = res.data?.token;
  const orgPessoalId = res.data?.user?.organization?.id;
  ctx.shared = { ...(ctx.shared || {}), orgPessoalId };

  check("conta nova começa com e-mail não confirmado", res.data?.user?.emailVerified === false);
  check("conta nova começa com o tour pendente", res.data?.user?.tourPending === true);

  res = await api("POST", "/api/auth/signup", {
    body: {
      accountType: "personal",
      email: "semtermos@test.com",
      name: "Sem Termos",
      cpf: ctx.makeCpf(99),
      phone: "11987654321",
      birthDate: "1990-05-10",
      password: "senha-forte-123",
    },
  });
  check("cadastro sem aceitar os termos = 400", res.status === 400 && res.data?.field === "acceptedTerms", `${res.status} ${res.data?.message}`);

  // ---------- projeto de exemplo ----------
  const { rows: exemplo } = await db.query(
    `
      SELECT l.id,
             (SELECT COUNT(*)::int FROM tasks t WHERE t.list_id = l.id) AS cards,
             (SELECT COUNT(*)::int FROM tasks t WHERE t.list_id = l.id AND t.status_id IS NULL) AS sem_coluna,
             (SELECT COUNT(*)::int FROM checklist_items ci
                INNER JOIN checklists c ON c.id = ci.checklist_id
                INNER JOIN tasks t ON t.id = c.task_id WHERE t.list_id = l.id) AS itens
      FROM lists l
      INNER JOIN folders f ON f.id = l.folder_id
      INNER JOIN spaces s ON s.id = f.space_id
      INNER JOIN workspaces w ON w.id = s.workspace_id
      WHERE w.organization_id = $1 AND l.name = 'Comece por aqui'
    `,
    [orgPessoalId],
  );
  check(
    "conta nova ganha o projeto de exemplo com cards e checklist",
    exemplo.length === 1 && exemplo[0].cards === 6 && exemplo[0].itens === 5 && exemplo[0].sem_coluna === 0,
    JSON.stringify(exemplo[0]),
  );

  // ---------- gate de e-mail não confirmado ----------
  res = await api("GET", "/api/account/list", { token: tokenPessoal });
  check("API bloqueada até confirmar o e-mail = 403", res.status === 403 && res.data?.code === "EMAIL_NOT_VERIFIED", `${res.status} ${res.data?.code}`);

  res = await api("POST", "/api/auth/verify-email", { body: { token: await ctx.verificationTokenFor("pessoal@test.com") } });
  check("confirmar e-mail = 200", res.status === 200, `${res.status} ${res.data?.message}`);

  res = await api("POST", "/api/auth/verify-email", { body: { token: "token-invalido" } });
  check("confirmação com token inválido = 400", res.status === 400, String(res.status));

  // ---------- login ----------
  res = await api("POST", "/api/auth/login", { body: { email: "pessoal@test.com", password: "errada" } });
  check("login com senha errada = 401", res.status === 401, String(res.status));

  res = await api("POST", "/api/auth/login", { body: { email: "pessoal@test.com", password: "senha-forte-123" } });
  check("login = 200 com acesso e atualização", res.status === 200 && Boolean(res.data?.token) && Boolean(res.data?.refreshToken), String(res.status));
  const acesso = res.data;

  res = await api("GET", "/api/account/list", { token: acesso.token });
  check("depois de confirmar, a API responde", res.status === 200, String(res.status));

  // ---------- sessão ----------
  res = await api("POST", "/api/auth/refresh", { body: { refreshToken: acesso.refreshToken } });
  check("renovar sessão = 200 e troca o refresh", res.status === 200 && res.data?.refreshToken && res.data.refreshToken !== acesso.refreshToken, String(res.status));
  const renovado = res.data;

  // O refresh trocado ainda vale por poucos segundos, de propósito: duas abas
  // renovando ao mesmo tempo não podem derrubar a sessão.
  res = await api("POST", "/api/auth/refresh", { body: { refreshToken: acesso.refreshToken } });
  check("refresh recém-trocado ainda funciona (janela para abas)", res.status === 200, String(res.status));

  res = await api("POST", "/api/auth/logout", { token: renovado.token, body: { refreshToken: renovado.refreshToken } });
  check("sair = 200", res.status === 200, String(res.status));
  res = await api("POST", "/api/auth/refresh", { body: { refreshToken: renovado.refreshToken } });
  check("depois de sair, o refresh não vale = 401", res.status === 401, String(res.status));

  // ---------- conta empresarial ----------
  const empresa = await ctx.signup({
    email: "empresa@test.com",
    accountType: "business",
    seed: 2,
    company: { cnpj: ctx.makeCnpj(2), name: "Acme Teste" },
  });
  check("cadastro empresarial = 201", Boolean(empresa.token) && Boolean(empresa.organizationId), JSON.stringify(empresa.user?.organization?.name));
  check("conta empresarial guarda o CNPJ", Boolean(empresa.user?.organization?.accountType), String(empresa.user?.organization?.accountType));

  ctx.shared.empresa = empresa;
  ctx.shared.pessoal = { ...acesso, organizationId: orgPessoalId };

  // ---------- documentos jurídicos ----------
  res = await api("GET", "/api/legal");
  check("versão dos documentos é pública", res.status === 200 && Boolean(res.data?.version), `${res.status} ${JSON.stringify(res.data)}`);

  const { rows: aceites } = await db.query(
    "SELECT document FROM legal_acceptances WHERE member_id = $1 ORDER BY document",
    [empresa.memberId],
  );
  check(
    "cadastro registra o aceite dos termos e da privacidade",
    aceites.length === 2 && aceites[0].document === "privacy" && aceites[1].document === "terms",
    JSON.stringify(aceites),
  );
};
