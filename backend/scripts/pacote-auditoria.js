/**
 * Monta o pacote de auditoria de uma conta: tudo o que foi enviado, por quem,
 * de onde, quando, com a impressão digital de cada arquivo, mais o registro de
 * quem recebeu link de acesso.
 *
 * É o que se entrega ao advogado diante de um ofício ou de uma denúncia de
 * conteúdo. Pasta na Bunny não prova nada sozinha; isto prova.
 *
 * Uso:
 *   node scripts/pacote-auditoria.js --conta <id-da-organizacao>
 *   node scripts/pacote-auditoria.js --cnpj 60512094000100
 *   node scripts/pacote-auditoria.js --arquivo <caminho/na/bunny>
 *
 * Opções:
 *   --desde 2026-01-01   recorta pelo período (data de envio)
 *   --ate   2026-12-31
 *   --saida pasta/       onde gravar (padrão: auditoria/)
 */
const fs = require("fs");
const path = require("path");

require("../src/config/env");
const { postgres } = require("../src/server/connect");

function argumento(nome) {
  const posicao = process.argv.indexOf(`--${nome}`);
  return posicao > -1 ? process.argv[posicao + 1] : "";
}

function somenteNumeros(valor) {
  return String(valor || "").replace(/\D/g, "");
}

function paraCsv(linhas) {
  if (linhas.length === 0) return "";
  const colunas = Object.keys(linhas[0]);
  const escapar = (valor) => {
    const texto = valor === null || valor === undefined ? "" : String(valor);
    return /[";\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
  };
  return [colunas.join(";"), ...linhas.map((linha) => colunas.map((c) => escapar(linha[c])).join(";"))].join("\n");
}

async function acharConta() {
  const contaId = argumento("conta");
  if (contaId) {
    const { rows } = await postgres.query(
      "SELECT id, name, legal_name, cnpj, account_type FROM organizations WHERE id = $1",
      [contaId],
    );
    return rows[0] || null;
  }

  const cnpj = somenteNumeros(argumento("cnpj"));
  if (cnpj) {
    const { rows } = await postgres.query(
      "SELECT id, name, legal_name, cnpj, account_type FROM organizations WHERE cnpj = $1",
      [cnpj],
    );
    return rows[0] || null;
  }
  return null;
}

async function principal() {
  const caminhoArquivo = argumento("arquivo");
  const conta = await acharConta();

  if (!conta && !caminhoArquivo) {
    console.error("Informe --conta <id>, --cnpj <numero> ou --arquivo <caminho na Bunny>.");
    process.exit(1);
  }

  const desde = argumento("desde") || "1970-01-01";
  const ate = argumento("ate") || "2999-12-31";
  const filtro = caminhoArquivo
    ? { clausula: "f.storage_path = $1", valores: [caminhoArquivo] }
    : { clausula: "f.organization_id = $1", valores: [conta.id] };

  const arquivos = await postgres.query(
    `
      SELECT f.storage_path AS caminho,
             f.original_name AS nome_original,
             f.content_type AS tipo,
             f.size_bytes AS tamanho_bytes,
             f.content_sha256 AS sha256,
             f.created_at AS enviado_em,
             f.deleted_at AS apagado_em,
             f.uploader_ip AS ip_de_envio,
             f.uploader_agent AS navegador_de_envio,
             m.id AS membro_id,
             m.name AS enviado_por,
             m.email AS email_de_quem_enviou,
             m.cpf AS cpf_de_quem_enviou,
             f.workspace_id,
             f.list_id AS projeto_id,
             f.task_id AS card_id
      FROM storage_files f
      LEFT JOIN members m ON m.id = f.uploaded_by
      WHERE ${filtro.clausula}
        AND f.created_at BETWEEN $2 AND $3
      ORDER BY f.created_at
    `,
    [...filtro.valores, desde, ate],
  );

  const acessos = await postgres.query(
    `
      SELECT a.storage_path AS caminho,
             a.created_at AS acessado_em,
             a.action AS acao,
             a.ip,
             a.user_agent AS navegador,
             m.id AS membro_id,
             m.name AS pessoa,
             m.email
      FROM storage_access_log a
      LEFT JOIN members m ON m.id = a.member_id
      WHERE ${caminhoArquivo ? "a.storage_path = $1" : "a.organization_id = $1"}
        AND a.created_at BETWEEN $2 AND $3
      ORDER BY a.created_at
    `,
    [...filtro.valores, desde, ate],
  );

  const destino = argumento("saida") || "auditoria";
  fs.mkdirSync(destino, { recursive: true });
  const marca = new Date().toISOString().replace(/[:.]/g, "-");
  const prefixo = path.join(destino, `auditoria-${conta ? conta.id : "arquivo"}-${marca}`);

  const resumo = {
    geradoEm: new Date().toISOString(),
    conta: conta
      ? {
          id: conta.id,
          nome: conta.name,
          razaoSocial: conta.legal_name,
          cnpj: conta.cnpj,
          tipo: conta.account_type,
        }
      : null,
    arquivoConsultado: caminhoArquivo || null,
    periodo: { desde, ate },
    totais: {
      arquivos: arquivos.rowCount,
      arquivosApagados: arquivos.rows.filter((linha) => linha.apagado_em).length,
      semImpressaoDigital: arquivos.rows.filter((linha) => !linha.sha256).length,
      acessosRegistrados: acessos.rowCount,
    },
  };

  fs.writeFileSync(`${prefixo}-resumo.json`, JSON.stringify(resumo, null, 2), "utf8");
  fs.writeFileSync(`${prefixo}-arquivos.csv`, paraCsv(arquivos.rows), "utf8");
  fs.writeFileSync(`${prefixo}-acessos.csv`, paraCsv(acessos.rows), "utf8");

  console.log("— Pacote de auditoria —");
  console.log(`  conta            ${conta ? `${conta.name} (${conta.id})` : "—"}`);
  console.log(`  período          ${desde} a ${ate}`);
  console.log(`  arquivos         ${arquivos.rowCount}`);
  console.log(`  acessos          ${acessos.rowCount}`);
  if (resumo.totais.semImpressaoDigital > 0) {
    console.log(
      `  atenção          ${resumo.totais.semImpressaoDigital} arquivo(s) sem SHA-256 (enviados antes da auditoria entrar)`,
    );
  }
  console.log(`\nGravado em ${prefixo}-{resumo.json,arquivos.csv,acessos.csv}`);
  await postgres.end();
}

principal().catch((erro) => {
  console.error("falhou:", erro.message);
  process.exit(1);
});
