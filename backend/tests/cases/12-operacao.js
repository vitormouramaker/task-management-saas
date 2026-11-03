/**
 * Operação: health check que realmente consulta o banco, diagnóstico completo
 * protegido por segredo e backup do banco com restauração conferida.
 */
module.exports = async function casosDeOperacao(ctx) {
  const { api, check } = ctx;

  // ---------- health check raso (monitor de disponibilidade) ----------
  let res = await api("GET", "/api/health");
  const banco = res.data?.checagens?.find((item) => item.nome === "banco");
  check(
    "health check responde 200 e diz que falou com o banco",
    res.status === 200 && res.data?.status === "ok" && banco?.ok === true,
    `${res.status} ${JSON.stringify(res.data)}`,
  );
  check(
    "health check não exige login nem token",
    res.status === 200,
    `${res.status}`,
  );
  check(
    "health check informa há quanto tempo o serviço está no ar",
    typeof res.data?.uptimeSegundos === "number",
    JSON.stringify(res.data?.uptimeSegundos),
  );

  // ---------- diagnóstico completo ----------
  res = await api("GET", "/api/health/detalhado");
  check(
    "diagnóstico completo não aparece sem o segredo",
    res.status === 404,
    `${res.status} ${JSON.stringify(res.data)}`,
  );

  res = await api("GET", "/api/health/detalhado", { headers: { "x-health-token": "token-errado" } });
  check("segredo errado também recebe 404", res.status === 404, `${res.status}`);

  res = await api("GET", "/api/health/detalhado", { headers: { "x-health-token": "token-de-saude" } });
  const nomes = (res.data?.checagens || []).map((item) => item.nome).sort();
  check(
    "com o segredo, o diagnóstico mostra banco, armazenamento e cobrança",
    res.status === 200 &&
      res.data?.status === "ok" &&
      nomes.join(",") === "armazenamento,banco,cobranca",
    `${res.status} ${JSON.stringify(res.data)}`,
  );

  // ---------- backup com restauração conferida ----------
  const backup = ctx.runScript("backup_db.js", ["--verificar"]);
  const saida = `${backup.stdout}\n${backup.stderr}`;
  check(
    "o backup roda, grava o arquivo e confere a restauração",
    backup.status === 0 && /restauracao conferida|restauração conferida/i.test(saida),
    saida.slice(-600),
  );

  const caminho = (saida.match(/arquivo: (.+)/) || [])[1]?.trim();
  const fs = require("fs");
  check(
    "o arquivo do backup existe e não está vazio",
    Boolean(caminho) && fs.existsSync(caminho) && fs.statSync(caminho).size > 1000,
    `${caminho} ${caminho && fs.existsSync(caminho) ? fs.statSync(caminho).size : "ausente"}`,
  );
  if (caminho && fs.existsSync(caminho)) fs.rmSync(caminho, { force: true });

  // ---------- vigilância de custos da Bunny ----------
  const custos = require("../../src/services/custos.service");
  await custos.garantirSchema(ctx.db);

  const resumo = await custos.resumoDeCustos(ctx.db);
  check(
    "o resumo de custos soma o que cada conta guarda",
    Array.isArray(resumo.contas) &&
      typeof resumo.totais.armazenamentoGb === "number" &&
      typeof resumo.totais.custoTotalMes === "number",
    JSON.stringify(resumo.totais),
  );

  check(
    "sem a chave da conta Bunny o tráfego vem marcado como indisponível, e não como zero",
    resumo.trafego.disponivel === false && Boolean(resumo.trafego.motivo),
    JSON.stringify(resumo.trafego),
  );

  // Teto baixo de propósito: o aviso tem que sair uma vez, e só uma, no mesmo dia.
  const tetoOriginal = process.env.CUSTOS_TETO_MENSAL;
  process.env.CUSTOS_TETO_MENSAL = "0";
  delete require.cache[require.resolve("../../src/services/custos.service")];
  const custosComTeto = require("../../src/services/custos.service");
  const primeira = await custosComTeto.verificarCustos({ db: ctx.db, enviarEmail: false });
  const segunda = await custosComTeto.verificarCustos({ db: ctx.db, enviarEmail: false });
  check(
    "passar do teto avisa uma vez por dia, sem repetir",
    primeira.avisos.some((aviso) => aviso.tipo === "teto-mensal") &&
      !segunda.avisos.some((aviso) => aviso.tipo === "teto-mensal"),
    `${primeira.avisos.length} depois ${segunda.avisos.length}`,
  );
  if (tetoOriginal === undefined) delete process.env.CUSTOS_TETO_MENSAL;
  else process.env.CUSTOS_TETO_MENSAL = tetoOriginal;

  // ---------- retenção da trilha de auditoria ----------
  const trilha = require("../../src/services/storage-audit.service");
  await ctx.db.query(
    `INSERT INTO storage_access_log (storage_path, organization_id, action, created_at)
     VALUES ('Pauta/antigo.txt', 'org_teste', 'link', CURRENT_TIMESTAMP - INTERVAL '800 days')`,
  );
  const limpeza = await trilha.limparRegistrosAntigos(ctx.db);
  const { rows: sobrou } = await ctx.db.query(
    "SELECT COUNT(*)::int AS total FROM storage_access_log WHERE storage_path = 'Pauta/antigo.txt'",
  );
  check(
    "registro de acesso mais velho que a retenção é apagado",
    limpeza.apagados >= 1 && sobrou[0].total === 0,
    JSON.stringify(limpeza),
  );

  // ---------- retenção de arquivos depois do cancelamento ----------
  const retencao = require("../../src/services/retencao.service");
  // As colunas vêm do banco da suíte, não do pool padrão: chamar os ensure*
  // aqui abriria conexão com o Postgres local, que no CI não existe.
  for (const coluna of [
    "ALTER TABLE organizations ADD COLUMN IF NOT EXISTS subscription_ended_at TIMESTAMPTZ",
    "ALTER TABLE organizations ADD COLUMN IF NOT EXISTS retention_warned_days INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE organizations ADD COLUMN IF NOT EXISTS files_purged_at TIMESTAMPTZ",
    "ALTER TABLE organizations ADD COLUMN IF NOT EXISTS billing_exempt BOOLEAN NOT NULL DEFAULT FALSE",
  ]) {
    await ctx.db.query(coluna);
  }

  // Duas contas próprias: uma que cancelou há pouco, outra fora do prazo.
  // Criar aqui, em vez de usar o que estiver no banco, faz o teste valer sempre.
  const contas = [
    { id: `org_ret_recente_${Date.now()}`, dias: 10, aviso: 0 },
    { id: `org_ret_vencida_${Date.now()}`, dias: 120, aviso: 83 },
  ];
  for (const conta of contas) {
    await ctx.db.query(
      `INSERT INTO organizations (id, name, plan, subscription_status, subscription_ended_at,
                                 retention_warned_days, files_purged_at, billing_exempt)
       VALUES ($1, $2, 'free', 'canceled',
               CURRENT_TIMESTAMP - ($3 || ' days')::interval, $4, NULL, FALSE)`,
      [conta.id, `Conta de retenção ${conta.dias}d`, String(conta.dias), conta.aviso],
    );
  }
  // A conta vencida precisa ter arquivo: sem arquivo não há o que remover.

  await ctx.db.query(
    `INSERT INTO storage_files (id, organization_id, kind, storage_path, url, size_bytes)
     VALUES ($1, $2, 'task_file', $3, $4, $5)`,
    [
      `file_ret_${Date.now()}`,
      contas[1].id,
      `Pauta/retencao/${contas[1].id}/arquivo.txt`,
      `https://exemplo.test/retencao/${contas[1].id}/arquivo.txt`,
      2048,
    ],
  );

  {
    const previsao = await retencao.simular(ctx.db);
    check(
      "quem cancelou há 10 dias entra na fila de aviso, não na de remoção",
      previsao.aAvisar.some((item) => item.id === contas[0].id) &&
        !previsao.aRemover.some((item) => item.id === contas[0].id),
      `avisar=${previsao.aAvisar.length} remover=${previsao.aRemover.length}`,
    );

    check(
      "quem passou dos 90 dias entra na fila de remoção",
      previsao.aRemover.some((item) => item.id === contas[1].id),
      JSON.stringify(previsao.aRemover.map((item) => item.dias)),
    );

    // A trava: sem RETENCAO_REMOVER_ARQUIVOS=1, pedir para aplicar não apaga nada.
    const tentativa = await retencao.removerArquivosVencidos({ db: ctx.db, aplicar: true });
    const { rows: depois } = await ctx.db.query(
      "SELECT files_purged_at FROM organizations WHERE id = $1",
      [contas[1].id],
    );
    check(
      "sem a variável de segurança, mandar aplicar não apaga arquivo nenhum",
      tentativa.aplicado === false && depois[0]?.files_purged_at === null,
      JSON.stringify({ aplicado: tentativa.aplicado, purgado: depois[0]?.files_purged_at }),
    );

    const enviados = await retencao.avisar({ db: ctx.db, enviarEmail: false });
    const repetido = await retencao.avisar({ db: ctx.db, enviarEmail: false });
    check(
      "o aviso de cada marco sai uma vez só",
      enviados.length >= 1 && repetido.length === 0,
      `${enviados.length} depois ${repetido.length}`,
    );
  }
};
