/**
 * Armazenamento: envio de arquivos do card para a Bunny, limites do plano,
 * tipos bloqueados, anexos por URL, links assinados, downloads (um a um e em
 * ZIP) e a mudança de pasta quando empresa/workspace/projeto são renomeados.
 */
const https = require("https");

const MB = 1024 * 1024;

/** Baixa da CDN falsa (certificado próprio) como o navegador do usuário faria. */
function baixarDaCdn(url) {
  return new Promise((resolve) => {
    https
      .get(url, { rejectUnauthorized: false }, (response) => {
        const pedacos = [];
        response.on("data", (pedaco) => pedacos.push(pedaco));
        response.on("end", () => resolve({ status: response.statusCode, body: Buffer.concat(pedacos) }));
      })
      .on("error", () => resolve({ status: 0, body: Buffer.alloc(0) }));
  });
}

module.exports = async function casosDeArmazenamento(ctx) {
  const { api, db, check, fakes } = ctx;

  const dono = await ctx.signup({
    email: "storage-dono@test.com",
    accountType: "business",
    seed: 31,
    company: { cnpj: ctx.makeCnpj(31), name: "Armazena Teste" },
  });
  const token = dono.token;
  const organizationId = dono.organizationId;

  // Projeto de exemplo que toda conta nova recebe: já tem workspace, projeto e cards.
  const { rows: alvo } = await db.query(
    `
      SELECT t.id AS "taskId", l.id AS "listId", w.id AS "workspaceId"
      FROM tasks t
      INNER JOIN lists l ON l.id = t.list_id
      INNER JOIN folders f ON f.id = l.folder_id
      INNER JOIN spaces s ON s.id = f.space_id
      INNER JOIN workspaces w ON w.id = s.workspace_id
      WHERE w.organization_id = $1
      ORDER BY t.created_at ASC
      LIMIT 1
    `,
    [organizationId],
  );
  const { taskId, listId, workspaceId } = alvo[0] || {};
  check("conta nova já tem um card onde anexar arquivos", Boolean(taskId), JSON.stringify(alvo[0] || null));
  if (!taskId) return;

  // ---------- limites do plano ----------
  let res = await api("GET", "/api/storage/usage", { token });
  check(
    "consulta de armazenamento devolve o uso e os limites do plano",
    res.status === 200 &&
      res.data?.usedBytes === 0 &&
      Number.isFinite(res.data?.maxFileSizeMb) &&
      Number.isFinite(res.data?.maxFilesPerUpload),
    `${res.status} ${JSON.stringify(res.data)}`,
  );
  const limites = res.data || {};
  const maxFileSizeMb = Number(limites.maxFileSizeMb);
  const maxFilesPerUpload = Number(limites.maxFilesPerUpload);
  check("plano da conta nova limita o tamanho por arquivo", maxFileSizeMb > 0, String(maxFileSizeMb));
  check("plano da conta nova limita a quantidade de arquivos por envio", maxFilesPerUpload > 0, String(maxFilesPerUpload));

  // ---------- checagem prévia do envio ----------
  res = await api("POST", "/api/storage/upload-check", {
    token,
    body: { name: "relatorio.pdf", size: Math.round((maxFileSizeMb + 1) * MB), count: 1 },
  });
  check(
    "arquivo acima do limite do plano é recusado antes de enviar = 413",
    res.status === 413 && String(res.data?.message || "").includes("limite"),
    `${res.status} ${res.data?.message}`,
  );

  res = await api("POST", "/api/storage/upload-check", {
    token,
    body: { name: "relatorio.pdf", size: 2048, count: maxFilesPerUpload + 1 },
  });
  check(
    "enviar mais arquivos de uma vez do que o plano permite = 413 com código do limite",
    res.status === 413 && res.data?.code === "PLAN_LIMIT_FILES_PER_UPLOAD",
    `${res.status} ${res.data?.code} ${res.data?.message}`,
  );

  res = await api("POST", "/api/storage/upload-check", {
    token,
    body: { name: "relatorio.pdf", size: 2048, count: maxFilesPerUpload },
  });
  check(
    "arquivo dentro do limite passa na checagem prévia = 200",
    res.status === 200 && res.data?.ok === true,
    `${res.status} ${JSON.stringify(res.data)}`,
  );

  res = await api("POST", "/api/storage/upload-check", {
    token,
    body: { name: "instalador.exe", size: 2048, count: 1 },
  });
  check(
    "checagem prévia recusa executável pela extensão = 415",
    res.status === 415,
    `${res.status} ${res.data?.message}`,
  );

  // ---------- envio do arquivo para o card ----------
  const conteudo = Buffer.from("linha de teste do Pauta ".repeat(13000), "utf8");
  const enviarArquivo = (nome, corpo, tipo = "text/plain") =>
    api("POST", `/api/workspaces/tasks/${taskId}/uploads`, {
      token,
      raw: corpo,
      headers: { "X-File-Name": encodeURIComponent(nome), "X-File-Type": tipo },
    });

  res = await enviarArquivo("relatório de vendas.txt", conteudo);
  check(
    "enviar arquivo para o card = 201 com nome e tamanho originais",
    res.status === 201 && res.data?.file?.size === conteudo.length && res.data?.file?.name === "relatório de vendas.txt",
    `${res.status} ${JSON.stringify(res.data)}`,
  );
  const urlAssinada = res.data?.file?.url || "";

  const { rows: gravados } = await db.query(
    `SELECT id, storage_path AS "storagePath", url, size_bytes AS "sizeBytes", kind, task_id AS "taskId"
     FROM storage_files WHERE organization_id = $1 AND deleted_at IS NULL`,
    [organizationId],
  );
  check("o envio fica registrado como arquivo do card", gravados.length === 1 && gravados[0].kind === "task_file" && gravados[0].taskId === taskId, JSON.stringify(gravados));
  const arquivo = gravados[0] || {};

  // ---------- trilha de auditoria ----------
  const crypto = require("crypto");
  const { rows: auditoria } = await db.query(
    `SELECT content_sha256, uploader_ip, uploader_agent FROM storage_files WHERE id = $1`,
    [arquivo.id],
  );
  const hashEsperado = crypto.createHash("sha256").update(conteudo).digest("hex");
  check(
    "o envio guarda a impressão digital do arquivo e de onde veio",
    auditoria[0]?.content_sha256 === hashEsperado && Boolean(auditoria[0]?.uploader_ip),
    JSON.stringify({ sha: auditoria[0]?.content_sha256?.slice(0, 16), ip: auditoria[0]?.uploader_ip }),
  );

  // A entrega do link é gravada em segundo plano; dá um instante para ela cair no banco.
  await new Promise((resolver) => setTimeout(resolver, 400));
  const { rows: acessos } = await db.query(
    `SELECT storage_path, member_id, ip FROM storage_access_log WHERE organization_id = $1`,
    [organizationId],
  );
  check(
    "entregar o link do arquivo fica registrado na trilha de acesso",
    acessos.some((linha) => linha.storage_path === arquivo.storagePath && Boolean(linha.member_id)),
    `${acessos.length} registro(s)`,
  );

  const guardado = fakes.objects.get(arquivo.storagePath);
  check(
    "o arquivo chega inteiro na Bunny, byte a byte",
    Boolean(guardado) && guardado.length === conteudo.length && guardado.equals(conteudo),
    `${arquivo.storagePath} -> ${guardado ? guardado.length : "ausente"} de ${conteudo.length}`,
  );

  const { rows: pastas } = await db.query(
    `
      SELECT o.storage_folder AS empresa, w.storage_folder AS workspace, l.storage_folder AS projeto
      FROM organizations o, workspaces w, lists l
      WHERE o.id = $1 AND w.id = $2 AND l.id = $3
    `,
    [organizationId, workspaceId, listId],
  );
  const pastaEsperada = `Pauta/${pastas[0]?.empresa}/${pastas[0]?.workspace}/${pastas[0]?.projeto}`;
  check(
    "o arquivo vai para Pauta/empresa/workspace/projeto",
    String(arquivo.storagePath || "").startsWith(`${pastaEsperada}/`),
    `${arquivo.storagePath} (esperado em ${pastaEsperada})`,
  );
  check(
    "o nome guardado na Bunny não repete o nome original cru",
    /^\d+_[0-9a-f]{6}_relatorio_de_vendas\.txt$/.test(String(arquivo.storagePath || "").split("/").pop()),
    String(arquivo.storagePath || "").split("/").pop(),
  );

  // ---------- links assinados ----------
  check(
    "a API devolve o link do arquivo com token temporário",
    urlAssinada.includes("?token=") && urlAssinada.includes("&expires="),
    urlAssinada,
  );
  check(
    "no banco o link fica sem assinatura",
    typeof arquivo.url === "string" && !arquivo.url.includes("token=") && !arquivo.url.includes("?"),
    String(arquivo.url),
  );
  check(
    "o link assinado aponta para o mesmo arquivo do banco",
    urlAssinada.split("?")[0] === arquivo.url,
    `${urlAssinada.split("?")[0]} / ${arquivo.url}`,
  );

  // ---------- tipos bloqueados ----------
  res = await enviarArquivo("instalador.exe", Buffer.from("conteudo qualquer"), "application/octet-stream");
  check("enviar arquivo .exe para o card = 415", res.status === 415, `${res.status} ${res.data?.message}`);

  const executavel = Buffer.concat([Buffer.from([0x4d, 0x5a]), Buffer.alloc(4096, 0x41)]);
  res = await enviarArquivo("planilha.xlsx", executavel, "application/octet-stream");
  check(
    "arquivo com assinatura de executável é recusado mesmo com extensão inocente = 415",
    res.status === 415,
    `${res.status} ${res.data?.message}`,
  );

  const { rows: depoisDosBloqueios } = await db.query(
    "SELECT COUNT(*)::int AS total FROM storage_files WHERE organization_id = $1 AND deleted_at IS NULL",
    [organizationId],
  );
  check("arquivo bloqueado não é contabilizado no armazenamento", depoisDosBloqueios[0].total === 1, JSON.stringify(depoisDosBloqueios[0]));

  // ---------- anexar ao card ----------
  res = await api("POST", `/api/workspaces/tasks/${taskId}/attachments`, {
    token,
    body: { name: "externo.pdf", url: "https://arquivos-de-fora.test/externo.pdf", type: "document", size: 10 },
  });
  check(
    "anexar ao card um arquivo de fora da Bunny = 400",
    res.status === 400,
    `${res.status} ${res.data?.message}`,
  );

  res = await api("POST", `/api/workspaces/tasks/${taskId}/attachments`, {
    token,
    body: { name: "relatório de vendas.txt", url: urlAssinada, type: "document", size: conteudo.length },
  });
  const anexoId = res.data?.attachment?.id;
  check(
    "anexar ao card um arquivo da própria Bunny = 201",
    res.status === 201 && Boolean(anexoId),
    `${res.status} ${res.data?.message}`,
  );

  const { rows: anexos } = await db.query("SELECT id, url FROM task_attachments WHERE task_id = $1", [taskId]);
  check(
    "o anexo fica guardado com o link limpo, sem o token",
    anexos.length === 1 && anexos[0].url === arquivo.url,
    JSON.stringify(anexos),
  );

  res = await api("GET", `/api/workspaces/tasks/${taskId}`, { token });
  const anexoNaApi = (res.data?.task?.attachments || res.data?.attachments || []).find((item) => item.id === anexoId);
  check(
    "o card entrega o anexo com link assinado, guardando o link limpo no banco",
    Boolean(anexoNaApi) && anexoNaApi.url.startsWith(`${arquivo.url}?token=`),
    `${res.status} ${anexoNaApi ? anexoNaApi.url : JSON.stringify(res.data)?.slice(0, 200)}`,
  );

  // ---------- uso de armazenamento na cobrança ----------
  res = await api("GET", "/api/billing/subscription", { token });
  const usoMb = res.data?.organization?.usage?.storageMb;
  check(
    "o armazenamento usado aparece na tela de assinatura",
    res.status === 200 && Math.abs(Number(usoMb) - conteudo.length / MB) < 0.11,
    `${res.status} storageMb=${usoMb} (esperado ~${(conteudo.length / MB).toFixed(1)})`,
  );

  res = await api("GET", "/api/storage/usage", { token });
  check(
    "a consulta de armazenamento passa a somar o arquivo enviado",
    res.status === 200 && res.data?.usedBytes === conteudo.length,
    `${res.status} usedBytes=${res.data?.usedBytes}; esperado ${conteudo.length}`,
  );

  // ---------- downloads ----------
  res = await api("GET", `/api/workspaces/attachments/download?url=${encodeURIComponent("https://arquivos-de-fora.test/x.pdf")}`, { token });
  check("baixar anexo de fora da Bunny = 400", res.status === 400, `${res.status} ${res.data?.message}`);

  res = await api("GET", "/api/workspaces/attachments/download", { token });
  check("baixar anexo sem informar a URL = 400", res.status === 400, `${res.status} ${res.data?.message}`);

  res = await api(
    "GET",
    `/api/workspaces/attachments/download?url=${encodeURIComponent(urlAssinada)}&name=${encodeURIComponent("relatorio.txt")}`,
    { token },
  );
  check(
    "baixar um anexo da própria conta devolve o arquivo",
    res.status === 200,
    `${res.status} ${JSON.stringify(res.data)?.slice(0, 120)}`,
  );

  res = await api("POST", "/api/workspaces/attachments/download-batch", { token, body: { attachments: [{ url: "https://arquivos-de-fora.test/x.pdf" }] } });
  check("ZIP só com anexos de fora da Bunny = 400", res.status === 400, `${res.status} ${res.data?.message}`);

  res = await api("POST", "/api/workspaces/attachments/download-batch", {
    token,
    body: {
      archiveName: "anexos do card",
      attachments: [
        { url: urlAssinada, name: "relatorio.txt" },
        { url: urlAssinada, name: "relatorio.txt" },
      ],
    },
  });
  check(
    "ZIP em lote com os anexos da conta = 200",
    res.status === 200,
    `${res.status} ${JSON.stringify(res.data)?.slice(0, 120)}`,
  );

  // O caminho feliz do ZIP é exercitado direto na Bunny falsa, que é o que a
  // rota faria se a checagem de URL aceitasse a pull zone com porta.
  const baixadoDaBunny = await baixarDaCdn(urlAssinada);
  check(
    "o link assinado entregue pela API baixa o arquivo inteiro da CDN",
    baixadoDaBunny.status === 200 && baixadoDaBunny.body.equals(conteudo),
    `${baixadoDaBunny.status} ${baixadoDaBunny.body.length} de ${conteudo.length}`,
  );

  // ---------- renomear move os arquivos de pasta ----------
  /** Espera o worker de storage mover o arquivo e devolve o registro novo. */
  const esperarMudancaDePasta = async (caminhoAtual) =>
    ctx.waitFor(async () => {
      const { rows } = await db.query('SELECT storage_path AS "storagePath", url FROM storage_files WHERE id = $1', [arquivo.id]);
      return rows[0] && rows[0].storagePath !== caminhoAtual ? rows[0] : null;
    }, 30000);

  res = await api("PUT", `/api/workspaces/lists/${listId}`, { token, body: { name: "Projeto Renomeado" } });
  check("renomear o projeto = 200", res.status === 200, `${res.status} ${res.data?.message}`);

  let movido = await esperarMudancaDePasta(arquivo.storagePath);
  check(
    "renomear o projeto move o arquivo para a pasta nova",
    Boolean(movido) && movido.storagePath.includes("/projeto-renomeado-"),
    JSON.stringify(movido),
  );
  if (movido) {
    check(
      "o arquivo movido continua inteiro na Bunny",
      Boolean(fakes.objects.get(movido.storagePath)) && fakes.objects.get(movido.storagePath).equals(conteudo),
      movido.storagePath,
    );
    const { rows: anexoDepois } = await db.query("SELECT url FROM task_attachments WHERE id = $1", [anexoId]);
    check(
      "o link do anexo do card acompanha a mudança de pasta",
      anexoDepois[0]?.url === movido.url,
      `anexo=${anexoDepois[0]?.url}; arquivo=${movido.url}`,
    );
  }

  let caminhoAtual = movido?.storagePath || arquivo.storagePath;
  res = await api("PUT", `/api/workspaces/${workspaceId}`, {
    token,
    body: { name: "Workspace Renomeado", description: "teste", visibility: "private" },
  });
  check("renomear o workspace = 200", res.status === 200, `${res.status} ${res.data?.message}`);

  movido = await esperarMudancaDePasta(caminhoAtual);
  check(
    "renomear o workspace move o arquivo para a pasta nova",
    Boolean(movido) && movido.storagePath.includes("/workspace-renomeado-"),
    JSON.stringify(movido),
  );

  caminhoAtual = movido?.storagePath || caminhoAtual;
  res = await api("PUT", "/api/account/organization", { token, body: { name: "Empresa Renomeada" } });
  check("renomear a empresa = 200", res.status === 200, `${res.status} ${res.data?.message}`);

  movido = await esperarMudancaDePasta(caminhoAtual);
  check(
    "renomear a empresa move o arquivo para a pasta nova",
    Boolean(movido) && movido.storagePath.startsWith("Pauta/empresa-renomeada-"),
    JSON.stringify(movido),
  );

  if (movido) {
    check(
      "depois das renomeações o arquivo segue inteiro e no caminho do banco",
      Boolean(fakes.objects.get(movido.storagePath)) && fakes.objects.get(movido.storagePath).equals(conteudo),
      movido.storagePath,
    );
    check(
      "o link gravado no banco combina com o caminho novo",
      typeof movido.url === "string" && movido.url.endsWith(movido.storagePath.split("/").map(encodeURIComponent).join("/")),
      `${movido.url} / ${movido.storagePath}`,
    );

    const { rows: anexoFinal } = await db.query("SELECT url FROM task_attachments WHERE id = $1", [anexoId]);
    check("o anexo do card aponta para o link final", anexoFinal[0]?.url === movido.url, `anexo=${anexoFinal[0]?.url}; arquivo=${movido.url}`);

    const depoisDeMover = await baixarDaCdn(movido.url);
    check(
      "o arquivo continua podendo ser baixado pelo link novo depois das renomeações",
      depoisDeMover.status === 200 && depoisDeMover.body.equals(conteudo),
      `${depoisDeMover.status} ${depoisDeMover.body.length} de ${conteudo.length}`,
    );
  }

  // O arquivo mudou de pasta, mas o total armazenado é o mesmo.
  res = await api("GET", "/api/storage/usage", { token });
  check(
    "mover os arquivos não muda o total armazenado",
    res.status === 200 && res.data?.usedBytes === conteudo.length,
    `${res.status} ${res.data?.usedBytes}`,
  );
};
