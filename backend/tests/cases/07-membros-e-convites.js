/**
 * Pessoas da conta: convite por e-mail (criar, consultar, aceitar, cancelar,
 * expirar e limite de assentos), criação direta pelo titular, papel de acesso
 * separado do cargo, cargos da conta, notificações e o e-mail interno.
 */
const crypto = require("crypto");

module.exports = async function casosDeMembrosEConvites(ctx) {
  const { api, db, check, signup } = ctx;

  const hashDoToken = (token) => crypto.createHash("sha256").update(String(token)).digest("hex");

  /** O convite guarda só o hash do token; aqui trocamos o token como o app faria ao reenviar. */
  async function definirToken(invitationId, token) {
    await db.query("UPDATE organization_invitations SET token_hash = $2 WHERE id = $1", [
      invitationId,
      hashDoToken(token),
    ]);
    return token;
  }

  const papelNaConta = async (organizationId, memberId) => {
    const { rows } = await db.query(
      "SELECT role, status FROM organization_members WHERE organization_id = $1 AND member_id = $2",
      [organizationId, memberId],
    );
    return rows[0] || null;
  };

  // ---------------------------------------------------------------- contas
  const titular = await signup({
    email: "membros-titular@test.com",
    accountType: "business",
    seed: 71,
    company: { cnpj: ctx.makeCnpj(71), name: "Membros Teste Ltda" },
  });
  check("titular com conta empresarial criado", Boolean(titular.token && titular.organizationId));

  // Plano pago: assentos suficientes para o time deste arquivo.
  await db.query(
    "UPDATE organizations SET plan = 'profissional', subscription_status = 'manual' WHERE id = $1",
    [titular.organizationId],
  );

  const convidada = await signup({ email: "membros-convidada@test.com", seed: 72 });
  const outra = await signup({ email: "membros-outra@test.com", seed: 73 });

  // ------------------------------------------------------------- convites
  let res = await api("POST", "/api/invitations", {
    token: titular.token,
    body: { email: "MEMBROS-Convidada@test.com", accessRole: "member", jobTitle: "Analista" },
  });
  check(
    "titular convida por e-mail = 201 e guarda o endereço em minúsculas",
    res.status === 201 && res.data?.invitation?.email === "membros-convidada@test.com",
    `${res.status} ${JSON.stringify(res.data?.invitation)}`,
  );
  const conviteConvidada = res.data?.invitation?.id;

  res = await api("GET", "/api/invitations", { token: titular.token });
  check(
    "convite pendente aparece na lista da conta com cargo e quem convidou",
    res.status === 200 &&
      res.data?.invitations?.some(
        (convite) =>
          convite.id === conviteConvidada &&
          convite.jobTitle === "Analista" &&
          convite.invitedByName === titular.user?.name &&
          convite.expired === false,
      ),
    `${res.status} ${JSON.stringify(res.data?.invitations)}`,
  );

  res = await api("POST", "/api/invitations", {
    token: titular.token,
    body: { email: "sem-arroba", accessRole: "member" },
  });
  check("convite com e-mail inválido = 400", res.status === 400, `${res.status} ${res.data?.message}`);

  res = await api("POST", "/api/invitations", {
    token: titular.token,
    body: { email: "membros-titular@test.com", accessRole: "member" },
  });
  check(
    "convidar quem já está na conta = 409",
    res.status === 409,
    `${res.status} ${res.data?.message}`,
  );

  // ---------- consulta pelo token ----------
  const tokenConvidada = await definirToken(conviteConvidada, "token-convite-convidada");

  res = await api("GET", `/api/invitations/lookup?token=${tokenConvidada}`);
  check(
    "consultar o convite pelo token mostra a empresa, quem convidou e que já existe conta",
    res.status === 200 &&
      res.data?.email === "membros-convidada@test.com" &&
      res.data?.organizationName === titular.user?.organization?.name &&
      res.data?.inviterName === titular.user?.name &&
      res.data?.accessRole === "member" &&
      res.data?.hasAccount === true,
    `${res.status} ${JSON.stringify(res.data)}`,
  );

  res = await api("GET", "/api/invitations/lookup?token=nao-existe");
  check("consultar convite com token desconhecido = 404", res.status === 404, `${res.status} ${res.data?.message}`);

  // ---------- aceitar com conta existente ----------
  res = await api("POST", "/api/invitations/accept", {
    token: convidada.token,
    body: { token: tokenConvidada },
  });
  check(
    "quem já tem conta aceita o convite e passa a usar a empresa",
    res.status === 200 && res.data?.user?.organization?.id === titular.organizationId,
    `${res.status} ${res.data?.message}`,
  );
  // Depois de aceitar, a sessão dela passa a ser a da empresa: é com esse acesso
  // que ela vira "membro comum" (o acesso antigo ainda aponta para a conta dela).
  const membro = { token: res.data?.token, memberId: convidada.memberId };
  check(
    "quem aceitou entra como membro comum, como dizia o convite",
    (await papelNaConta(titular.organizationId, convidada.memberId))?.role === "member",
    JSON.stringify(await papelNaConta(titular.organizationId, convidada.memberId)),
  );

  res = await api("GET", `/api/invitations/lookup?token=${tokenConvidada}`);
  check("convite já aceito não vale de novo = 410", res.status === 410, `${res.status} ${res.data?.message}`);

  // ---------- aceitar criando conta nova ----------
  res = await api("POST", "/api/invitations", {
    token: titular.token,
    body: { email: "membros-nova@test.com", accessRole: "admin", jobTitle: "Gerente" },
  });
  check("convite para quem ainda não tem conta = 201", res.status === 201, `${res.status} ${res.data?.message}`);
  const tokenNova = await definirToken(res.data?.invitation?.id, "token-convite-nova");

  res = await api("GET", `/api/invitations/lookup?token=${tokenNova}`);
  check(
    "convite para endereço sem cadastro avisa que ainda não há conta",
    res.status === 200 && res.data?.hasAccount === false && res.data?.accessRole === "admin",
    `${res.status} ${JSON.stringify(res.data)}`,
  );

  res = await api("POST", "/api/invitations/accept-new", {
    body: { token: tokenNova, name: "Nova Pessoa", password: "curta" },
  });
  check("criar conta pelo convite com senha fraca = 400", res.status === 400, `${res.status} ${res.data?.message}`);

  res = await api("POST", "/api/invitations/accept-new", {
    body: { token: tokenNova, name: "Nova Pessoa", password: "senha-forte-123" },
  });
  check(
    "aceitar criando conta nova = 201, já dentro da empresa e sem confirmar e-mail",
    res.status === 201 &&
      res.data?.user?.organization?.id === titular.organizationId &&
      res.data?.user?.emailVerified === true,
    `${res.status} ${res.data?.message}`,
  );
  const nova = {
    token: res.data?.token,
    memberId: res.data?.user?.id,
    email: "membros-nova@test.com",
  };
  check(
    "quem entrou por convite de administrador recebe o cargo e o papel do convite",
    (await papelNaConta(titular.organizationId, nova.memberId))?.role === "admin" &&
      res.data?.user?.role === "Gerente",
    `${JSON.stringify(await papelNaConta(titular.organizationId, nova.memberId))} ${res.data?.user?.role}`,
  );

  // ---------- convite de outra pessoa ----------
  res = await api("POST", "/api/invitations", {
    token: titular.token,
    body: { email: outra.user?.email || "membros-outra@test.com", accessRole: "member" },
  });
  const tokenOutra = await definirToken(res.data?.invitation?.id, "token-convite-outra");

  res = await api("POST", "/api/invitations/accept", {
    token: convidada.token,
    body: { token: tokenOutra },
  });
  check(
    "aceitar um convite endereçado a outra pessoa = 403",
    res.status === 403,
    `${res.status} ${res.data?.message}`,
  );

  res = await api("POST", "/api/invitations/accept-new", {
    body: { token: tokenOutra, name: "Outra Pessoa", password: "senha-forte-123" },
  });
  check(
    "quem já tem cadastro não cria outra conta pelo convite = 409",
    res.status === 409,
    `${res.status} ${res.data?.message}`,
  );

  // ---------- convite cancelado ----------
  res = await api("POST", "/api/invitations", {
    token: titular.token,
    body: { email: "membros-cancelado@test.com", accessRole: "member" },
  });
  const conviteCancelado = res.data?.invitation?.id;
  const tokenCancelado = await definirToken(conviteCancelado, "token-convite-cancelado");

  res = await api("DELETE", `/api/invitations/${conviteCancelado}`, { token: titular.token });
  check("titular cancela o convite = 200", res.status === 200, `${res.status} ${res.data?.message}`);

  res = await api("GET", `/api/invitations/lookup?token=${tokenCancelado}`);
  check("convite cancelado = 410", res.status === 410, `${res.status} ${res.data?.message}`);

  res = await api("DELETE", `/api/invitations/${conviteCancelado}`, { token: titular.token });
  check("cancelar um convite já cancelado = 404", res.status === 404, `${res.status} ${res.data?.message}`);

  // ---------- convite expirado ----------
  res = await api("POST", "/api/invitations", {
    token: titular.token,
    body: { email: "membros-expirado@test.com", accessRole: "member" },
  });
  const conviteExpirado = res.data?.invitation?.id;
  const tokenExpirado = await definirToken(conviteExpirado, "token-convite-expirado");
  await db.query("UPDATE organization_invitations SET expires_at = NOW() - INTERVAL '1 day' WHERE id = $1", [
    conviteExpirado,
  ]);

  res = await api("GET", `/api/invitations/lookup?token=${tokenExpirado}`);
  check("convite expirado = 410", res.status === 410, `${res.status} ${res.data?.message}`);

  res = await api("POST", `/api/invitations/${conviteExpirado}/resend`, { token: titular.token });
  check("reenviar o convite renova o prazo = 200", res.status === 200, `${res.status} ${res.data?.message}`);

  const { rows: prazo } = await db.query(
    "SELECT expires_at > NOW() AS valido FROM organization_invitations WHERE id = $1",
    [conviteExpirado],
  );
  check("depois do reenvio o convite volta a valer", prazo[0]?.valido === true, JSON.stringify(prazo[0]));

  res = await api("POST", "/api/invitations", {
    token: membro.token,
    body: { email: "membros-por-membro@test.com", accessRole: "member" },
  });
  check("membro comum não convida ninguém = 403", res.status === 403, `${res.status} ${res.data?.message}`);

  // ------------------------------------------------- pessoa criada direto
  res = await api("POST", "/api/users", {
    token: titular.token,
    body: {
      name: "Pessoa Direta",
      email: "membros-direta@test.com",
      password: "senha-forte-123",
      role: "Analista",
      accessRole: "admin",
    },
  });
  check(
    "titular cria a pessoa direto, com o cargo escolhido = 201",
    res.status === 201 && res.data?.user?.role === "Analista",
    `${res.status} ${res.data?.message}`,
  );
  const direta = { memberId: res.data?.user?.id, email: "membros-direta@test.com" };

  check(
    "o papel de acesso fica separado do cargo: administradora com cargo de Analista",
    (await papelNaConta(titular.organizationId, direta.memberId))?.role === "admin",
    JSON.stringify(await papelNaConta(titular.organizationId, direta.memberId)),
  );

  res = await api("POST", "/api/auth/login", {
    body: { email: direta.email, password: "senha-forte-123" },
  });
  check(
    "quem foi criada pelo titular já entra sem confirmar e-mail",
    res.status === 200 && res.data?.user?.organization?.id === titular.organizationId,
    `${res.status} ${res.data?.message}`,
  );
  direta.token = res.data?.token;

  res = await api("POST", "/api/users", {
    token: titular.token,
    body: {
      name: "Cargo Inventado",
      email: "membros-cargo-invalido@test.com",
      password: "senha-forte-123",
      role: "Capitão do Mato",
    },
  });
  check(
    "criar pessoa com cargo fora da lista da conta = 400",
    res.status === 400 && res.data?.field === "role",
    `${res.status} ${res.data?.message}`,
  );

  res = await api("POST", "/api/users", {
    token: titular.token,
    body: { name: "Repetida", email: direta.email, password: "senha-forte-123" },
  });
  check("criar pessoa com e-mail já usado = 409", res.status === 409, `${res.status} ${res.data?.message}`);

  res = await api("POST", "/api/users", {
    token: titular.token,
    body: { name: "Sem Senha", email: "membros-sem-senha@test.com" },
  });
  check("criar pessoa sem senha = 400", res.status === 400, `${res.status} ${res.data?.message}`);

  // ---------- editar papel e remover ----------
  res = await api("PUT", `/api/users/${direta.memberId}`, {
    token: titular.token,
    body: { name: "Pessoa Direta", role: "Gerente", accessRole: "member" },
  });
  check(
    "titular troca o cargo e rebaixa para membro comum = 200",
    res.status === 200 && res.data?.user?.role === "Gerente",
    `${res.status} ${res.data?.message}`,
  );
  check(
    "o rebaixamento fica gravado no papel de acesso",
    (await papelNaConta(titular.organizationId, direta.memberId))?.role === "member",
    JSON.stringify(await papelNaConta(titular.organizationId, direta.memberId)),
  );

  res = await api("PUT", `/api/users/${nova.memberId}`, {
    token: direta.token,
    body: { name: "Tentativa", accessRole: "admin" },
  });
  check(
    "quem foi rebaixado perde o acesso de administração na hora = 403",
    res.status === 403,
    `${res.status} ${res.data?.message}`,
  );

  res = await api("DELETE", `/api/users/${direta.memberId}`, { token: membro.token });
  check("membro comum não remove ninguém = 403", res.status === 403, `${res.status} ${res.data?.message}`);

  res = await api("DELETE", `/api/users/${titular.memberId}`, { token: nova.token });
  check(
    "o titular da conta não pode ser removido = 403",
    res.status === 403,
    `${res.status} ${res.data?.message}`,
  );

  res = await api("DELETE", `/api/users/${nova.memberId}`, { token: nova.token });
  check("ninguém remove a si mesmo = 400", res.status === 400, `${res.status} ${res.data?.message}`);

  res = await api("PUT", `/api/users/${titular.memberId}`, {
    token: nova.token,
    body: { name: "Titular Renomeado" },
  });
  check(
    "administrador não edita a conta do titular = 403",
    res.status === 403,
    `${res.status} ${res.data?.message}`,
  );

  // ------------------------------------------------------------- cargos
  res = await api("GET", "/api/job-titles", { token: titular.token });
  check(
    "a conta começa com a lista de cargos padrão",
    res.status === 200 && res.data?.jobTitles?.some((cargo) => cargo.name === "Analista"),
    `${res.status} ${res.data?.jobTitles?.length}`,
  );

  res = await api("POST", "/api/job-titles", { token: titular.token, body: { name: "Estrategista" } });
  check("criar cargo = 201", res.status === 201 && res.data?.jobTitle?.name === "Estrategista", `${res.status} ${res.data?.message}`);
  const cargoNovo = res.data?.jobTitle?.id;

  res = await api("POST", "/api/job-titles", { token: titular.token, body: { name: "estrategista" } });
  check("cargo repetido = 409", res.status === 409, `${res.status} ${res.data?.message}`);

  res = await api("POST", "/api/job-titles", { token: titular.token, body: { name: "X" } });
  check("cargo com nome curto demais = 400", res.status === 400, `${res.status} ${res.data?.message}`);

  res = await api("POST", "/api/job-titles", { token: membro.token, body: { name: "Chefe" } });
  check("membro comum não cria cargo = 403", res.status === 403, `${res.status} ${res.data?.message}`);

  res = await api("GET", "/api/users/roles", { token: membro.token });
  check(
    "a lista de cargos aparece para qualquer pessoa da conta",
    res.status === 200 && res.data?.roles?.includes("Estrategista"),
    `${res.status} ${JSON.stringify(res.data?.roles?.slice(0, 3))}`,
  );

  res = await api("DELETE", `/api/job-titles/${cargoNovo}`, { token: titular.token });
  check("apagar cargo = 200", res.status === 200, `${res.status} ${res.data?.message}`);

  res = await api("GET", "/api/job-titles", { token: titular.token });
  check(
    "o cargo apagado some da lista",
    res.status === 200 && !res.data?.jobTitles?.some((cargo) => cargo.id === cargoNovo),
    `${res.status} ${res.data?.jobTitles?.length}`,
  );

  res = await api("DELETE", `/api/job-titles/${cargoNovo}`, { token: titular.token });
  check("apagar cargo que não existe = 404", res.status === 404, `${res.status} ${res.data?.message}`);

  // ------------------------------------------------------- notificações
  const { rows: estrutura } = await db.query(
    `
      SELECT w.id AS workspace_id, s.id AS space_id, f.id AS folder_id, l.id AS list_id
      FROM workspaces w
      INNER JOIN spaces s ON s.workspace_id = w.id
      INNER JOIN folders f ON f.space_id = s.id
      INNER JOIN lists l ON l.folder_id = f.id
      WHERE w.organization_id = $1 AND w.deleted_at IS NULL
      LIMIT 1
    `,
    [titular.organizationId],
  );

  res = await api("POST", "/api/workspaces/tasks", {
    token: titular.token,
    body: {
      title: "Card com responsável",
      listId: estrutura[0].list_id,
      folderId: estrutura[0].folder_id,
      spaceId: estrutura[0].space_id,
      workspaceId: estrutura[0].workspace_id,
      statusId: "st_todo",
      assigneeIds: [direta.memberId, titular.memberId],
    },
  });
  check("criar card com responsável = 201", res.status === 201, `${res.status} ${res.data?.message}`);
  const cardId = res.data?.task?.id || res.data?.id;

  res = await api("GET", "/api/notifications", { token: direta.token });
  const notificacaoDoCard = Array.isArray(res.data)
    ? res.data.find((item) => item.reference_id === cardId)
    : null;
  check(
    "ser atribuída a um card gera notificação com quem atribuiu",
    res.status === 200 && notificacaoDoCard?.type === "TASK_ASSIGNED" && notificacaoDoCard?.created_by === titular.memberId,
    `${res.status} ${JSON.stringify(res.data)}`,
  );
  check("a notificação nasce não lida", notificacaoDoCard?.read === false, JSON.stringify(notificacaoDoCard?.read));

  res = await api("GET", "/api/notifications", { token: titular.token });
  check(
    "quem atribuiu não recebe notificação de si mesmo",
    res.status === 200 && !res.data.some((item) => item.reference_id === cardId),
    `${res.status} ${JSON.stringify(res.data)}`,
  );

  res = await api("PATCH", `/api/notifications/${notificacaoDoCard?.id}/read`, { token: direta.token });
  check("marcar notificação como lida = 200", res.status === 200, `${res.status} ${res.data?.message}`);

  res = await api("GET", "/api/notifications", { token: direta.token });
  check(
    "a notificação lida aparece como lida",
    res.data.find((item) => item.id === notificacaoDoCard?.id)?.read === true,
    JSON.stringify(res.data.find((item) => item.id === notificacaoDoCard?.id)),
  );

  // Mais duas notificações para testar "marcar todas" e "apagar".
  const outroCard = await api("POST", "/api/workspaces/tasks", {
    token: titular.token,
    body: {
      title: "Segundo card com responsável",
      listId: estrutura[0].list_id,
      folderId: estrutura[0].folder_id,
      spaceId: estrutura[0].space_id,
      workspaceId: estrutura[0].workspace_id,
      statusId: "st_todo",
      assigneeIds: [direta.memberId],
    },
  });

  res = await api("PATCH", "/api/notifications/read-all", { token: direta.token });
  check("marcar todas como lidas = 200", res.status === 200, `${res.status} ${res.data?.message}`);

  res = await api("GET", "/api/notifications", { token: direta.token });
  check(
    "depois de marcar todas, nenhuma fica por ler",
    res.status === 200 && res.data.length >= 2 && res.data.every((item) => item.read === true),
    JSON.stringify(res.data.map((item) => item.read)),
  );
  const totalNotificacoes = res.data.length;
  const notificacaoDoOutroCard = res.data.find(
    (item) => item.reference_id === (outroCard.data?.task?.id || outroCard.data?.id),
  );

  res = await api("DELETE", `/api/notifications/${notificacaoDoOutroCard?.id}`, { token: membro.token });
  check(
    "ninguém apaga a notificação de outra pessoa",
    res.status === 404 &&
      (await db.query("SELECT 1 FROM notifications WHERE id = $1", [notificacaoDoOutroCard?.id])).rows.length === 1,
    `${res.status} ${res.data?.message}`,
  );

  res = await api("DELETE", `/api/notifications/${notificacaoDoOutroCard?.id}`, { token: direta.token });
  check("apagar a própria notificação = 200", res.status === 200, `${res.status} ${res.data?.message}`);

  res = await api("GET", "/api/notifications", { token: direta.token });
  check(
    "a notificação apagada some da lista",
    res.data.length === totalNotificacoes - 1 && !res.data.some((item) => item.id === notificacaoDoOutroCard?.id),
    `${res.data.length} de ${totalNotificacoes}`,
  );

  // ------------------------------------------------------- e-mail interno
  // A tabela do e-mail interno só nasce se alguém rodar src/server/migrate_sent_emails.js
  // à mão: nem o init-db.js nem as migrações de arranque a criam. Aqui fazemos
  // o que o operador faria na instalação, senão toda a caixa de entrada dá 500.
  await db.query(`
    CREATE TABLE IF NOT EXISTS sent_emails (
      id          VARCHAR(100) PRIMARY KEY,
      sender_id   VARCHAR(100) REFERENCES members(id) ON DELETE CASCADE,
      to_email    VARCHAR(255) NOT NULL,
      subject     VARCHAR(255) NOT NULL,
      subtitle    VARCHAR(255),
      body        TEXT NOT NULL,
      attachments TEXT[] DEFAULT '{}',
      read        BOOLEAN DEFAULT FALSE,
      sent_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.query(`
    ALTER TABLE sent_emails
      ADD COLUMN IF NOT EXISTS recipient_id VARCHAR(100) REFERENCES members(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS type VARCHAR(20) NOT NULL DEFAULT 'sent'
  `);

  res = await api("GET", "/api/emails", { token: titular.token });
  check(
    "a caixa de entrada começa vazia",
    res.status === 200 && Array.isArray(res.data) && res.data.length === 0,
    `${res.status} ${JSON.stringify(res.data)}`,
  );

  res = await api("POST", "/api/emails", {
    token: titular.token,
    body: {
      to: `${convidada.user?.email || "membros-convidada@test.com"}, ${direta.email}; cliente-de-fora@exemplo.com`,
      subject: "Reunião de quinta",
      subtitle: "Pauta",
      body: "Combinamos às 10h.",
    },
  });
  check(
    "enviar para vários destinatários = 201 e a cópia enviada guarda a lista toda",
    res.status === 201 &&
      res.data?.type === "sent" &&
      res.data?.to === "membros-convidada@test.com, membros-direta@test.com, cliente-de-fora@exemplo.com",
    `${res.status} ${JSON.stringify(res.data?.to)}`,
  );
  const assuntoEnviado = "Reunião de quinta";

  const { rows: copias } = await db.query(
    "SELECT type, COUNT(*)::int AS total FROM sent_emails WHERE subject = $1 GROUP BY type ORDER BY type",
    [assuntoEnviado],
  );
  check(
    "sai uma cópia enviada e uma recebida por pessoa de dentro da plataforma",
    JSON.stringify(copias) === JSON.stringify([{ type: "received", total: 2 }, { type: "sent", total: 1 }]),
    JSON.stringify(copias),
  );

  res = await api("GET", "/api/emails", { token: membro.token });
  const recebido = Array.isArray(res.data) ? res.data.find((email) => email.subject === assuntoEnviado) : null;
  check(
    "quem recebeu vê o e-mail como recebido, não lido e com o remetente",
    res.status === 200 &&
      recebido?.type === "received" &&
      recebido?.read === false &&
      recebido?.senderEmail === "membros-titular@test.com",
    `${res.status} ${JSON.stringify(recebido)}`,
  );

  res = await api("PATCH", `/api/emails/${recebido?.id}/read`, { token: membro.token });
  check("marcar e-mail como lido = 200", res.status === 200, `${res.status} ${res.data?.message}`);

  res = await api("GET", "/api/emails", { token: membro.token });
  check(
    "o e-mail marcado aparece como lido",
    res.data.find((email) => email.id === recebido?.id)?.read === true,
    JSON.stringify(res.data.find((email) => email.id === recebido?.id)?.read),
  );

  res = await api("POST", "/api/emails", {
    token: titular.token,
    body: {
      to: Array.from({ length: 21 }, (_, indice) => `pessoa${indice}@exemplo.com`).join(", "),
      subject: "Aviso geral",
      body: "Texto",
    },
  });
  check("enviar para mais de 20 pessoas = 400", res.status === 400, `${res.status} ${res.data?.message}`);

  res = await api("POST", "/api/emails", {
    token: titular.token,
    body: { to: "isto-nao-e-email", subject: "Aviso", body: "Texto" },
  });
  check("endereço inválido = 400", res.status === 400, `${res.status} ${res.data?.message}`);

  res = await api("POST", "/api/emails", {
    token: titular.token,
    body: { to: direta.email, subject: "", body: "Texto" },
  });
  check("e-mail sem assunto = 400", res.status === 400, `${res.status} ${res.data?.message}`);

  // ---------- anexo acima do limite do plano ----------
  const anexo = await signup({ email: "membros-anexo@test.com", seed: 74 });
  res = await api("POST", "/api/emails/attachments/upload", {
    token: anexo.token,
    raw: Buffer.from("conteudo do anexo de teste"),
    headers: { "X-File-Name": "anexo.txt", "X-File-Type": "text/plain" },
  });
  check("enviar o arquivo do anexo = 201", res.status === 201 && Boolean(res.data?.file?.url), `${res.status} ${res.data?.message}`);
  const urlDoAnexo = res.data?.file?.url;

  res = await api("POST", "/api/emails", {
    token: anexo.token,
    body: {
      to: "membros-anexo@test.com",
      subject: "Com anexo",
      body: "Segue em anexo.",
      attachments: [urlDoAnexo],
    },
  });
  check(
    "anexo acima do que o plano permite = 403",
    res.status === 403 && res.data?.code === "PLAN_LIMIT_EMAIL_ATTACHMENT",
    `${res.status} ${res.data?.code} ${res.data?.message}`,
  );

  // ------------------------------------------- limite de pessoas do plano
  const plano = await signup({ email: "membros-plano@test.com", seed: 75 });
  for (const indice of [1, 2]) {
    res = await api("POST", "/api/users", {
      token: plano.token,
      body: {
        name: `Pessoa Plano ${indice}`,
        email: `membros-plano-${indice}@test.com`,
        password: "senha-forte-123",
        role: "Analista",
      },
    });
    check(`plano Grátis aceita a ${indice + 1}ª pessoa da conta`, res.status === 201, `${res.status} ${res.data?.message}`);
  }

  res = await api("POST", "/api/users", {
    token: plano.token,
    body: {
      name: "Pessoa Plano 3",
      email: "membros-plano-3@test.com",
      password: "senha-forte-123",
    },
  });
  check(
    "passar do limite de pessoas do plano = 403",
    res.status === 403 && res.data?.code === "PLAN_LIMIT_USERS",
    `${res.status} ${res.data?.code} ${res.data?.message}`,
  );

  res = await api("POST", "/api/invitations", {
    token: plano.token,
    body: { email: "membros-plano-convite@test.com", accessRole: "member" },
  });
  check(
    "com os assentos do plano ocupados, o convite é barrado = 403",
    res.status === 403 && /usuários/.test(String(res.data?.message)),
    `${res.status} ${res.data?.message}`,
  );

  // ------------------------------------------------- remover da conta
  res = await api("DELETE", `/api/users/${nova.memberId}`, { token: titular.token });
  check("titular remove a pessoa da conta = 200", res.status === 200, `${res.status} ${res.data?.message}`);
  check(
    "quem foi removida deixa de constar na conta",
    (await papelNaConta(titular.organizationId, nova.memberId)) === null,
    JSON.stringify(await papelNaConta(titular.organizationId, nova.memberId)),
  );

  res = await api("PUT", `/api/users/${nova.memberId}`, {
    token: titular.token,
    body: { name: "Nova Pessoa" },
  });
  check("editar quem não está mais na conta = 404", res.status === 404, `${res.status} ${res.data?.message}`);

};
