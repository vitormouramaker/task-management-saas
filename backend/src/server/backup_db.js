/**
 * Backup do banco, com conferência da restauração.
 *
 * Uso:
 *   node src/server/backup_db.js                  gera o backup e aplica a retenção
 *   node src/server/backup_db.js --verificar      gera, restaura num banco temporário e compara
 *   node src/server/backup_db.js --listar         só mostra os backups que existem
 *
 * Variáveis: BACKUP_DIR (padrão ./backups), BACKUP_RETENTION_DAYS (padrão 14),
 * PG_BIN (pasta do pg_dump, quando não está no PATH) e, para a cópia fora do
 * servidor, BACKUP_BUNNY_ZONE + BACKUP_BUNNY_KEY — precisa ser uma zona separada da
 * dos anexos, senão a limpeza de arquivos órfãos apaga os backups.
 */
require("../config/env");

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const DB = {
  host: process.env.DB_HOST || "127.0.0.1",
  port: String(process.env.DB_PORT || 5432),
  name: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
};

const BACKUP_DIR = path.resolve(process.env.BACKUP_DIR || path.join(__dirname, "..", "..", "backups"));
const RETENCAO_DIAS = Number(process.env.BACKUP_RETENTION_DAYS || 14);
const PREFIXO = "pauta-";

/** Caminho do executável, respeitando PG_BIN quando o PATH não tem o Postgres. */
function binario(nome) {
  const exe = process.platform === "win32" ? `${nome}.exe` : nome;
  const pastas = [process.env.PG_BIN, ...(process.env.PG_BIN_FALLBACKS || "").split(path.delimiter)].filter(Boolean);
  for (const pasta of pastas) {
    const caminho = path.join(pasta, exe);
    if (fs.existsSync(caminho)) return caminho;
  }
  return nome;
}

function rodar(nome, args, opcoes = {}) {
  return spawnSync(binario(nome), args, {
    encoding: "utf8",
    timeout: Number(process.env.BACKUP_TIMEOUT_MS || 30 * 60 * 1000),
    ...opcoes,
    env: { ...process.env, PGPASSWORD: DB.password || "", ...(opcoes.env || {}) },
  });
}

function conexao(nomeDoBanco) {
  return ["-h", DB.host, "-p", DB.port, "-U", DB.user, "-d", nomeDoBanco];
}

function listarBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs
    .readdirSync(BACKUP_DIR)
    .filter((arquivo) => arquivo.startsWith(PREFIXO) && arquivo.endsWith(".dump"))
    .map((arquivo) => {
      const caminho = path.join(BACKUP_DIR, arquivo);
      const info = fs.statSync(caminho);
      return { arquivo, caminho, bytes: info.size, em: info.mtime };
    })
    .sort((a, b) => b.em - a.em);
}

function mb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Gera o dump no formato custom (já comprimido e restaurável por tabela). */
function gerarBackup() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const marca = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 16);
  const destino = path.join(BACKUP_DIR, `${PREFIXO}${marca}.dump`);

  const resultado = rodar("pg_dump", [...conexao(DB.name), "-Fc", "-Z", "6", "-f", destino]);
  if (resultado.error && resultado.error.code === "ENOENT") {
    throw new Error("pg_dump não encontrado. Instale o cliente do Postgres ou defina PG_BIN.");
  }
  if (resultado.status !== 0) {
    throw new Error(`pg_dump falhou: ${(resultado.stderr || resultado.stdout || "").trim()}`);
  }
  if (!fs.existsSync(destino) || fs.statSync(destino).size < 1000) {
    throw new Error("o arquivo de backup saiu vazio.");
  }

  console.log(`backup gerado (${mb(fs.statSync(destino).size)})`);
  console.log(`arquivo: ${destino}`);
  return destino;
}

/**
 * Restaura o dump num banco temporário e compara a contagem das tabelas
 * principais com o banco de origem. É a prova de que o backup presta.
 */
function conferirRestauracao(arquivo) {
  const temporario = `${DB.name}_restore_check`;
  const tabelas = ["organizations", "members", "workspaces", "tasks", "attachments"];

  const psql = (banco, consulta) => {
    const saida = rodar("psql", [...conexao(banco), "-At", "-F", "|", "-c", consulta]);
    if (saida.status !== 0) throw new Error(`psql falhou em ${banco}: ${(saida.stderr || "").trim()}`);
    return saida.stdout.trim().split(/\r?\n/).filter(Boolean);
  };

  // Só compara tabelas que existem na origem: o esquema muda entre versões.
  const existentes = psql(
    DB.name,
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN (${tabelas
      .map((tabela) => `'${tabela}'`)
      .join(", ")})`,
  );
  if (existentes.length === 0) throw new Error("nenhuma tabela conhecida no banco de origem: nada a comparar.");

  const contar = (banco) => {
    const consulta = existentes
      .map((tabela) => `SELECT '${tabela}' AS t, COUNT(*) AS total FROM "${tabela}"`)
      .join(" UNION ALL ");
    const mapa = {};
    for (const linha of psql(banco, consulta)) {
      const [tabela, total] = linha.split("|");
      mapa[tabela] = Number(total);
    }
    return mapa;
  };

  const origem = contar(DB.name);

  rodar("psql", [...conexao("postgres"), "-c", `DROP DATABASE IF EXISTS "${temporario}"`]);
  const criado = rodar("psql", [...conexao("postgres"), "-c", `CREATE DATABASE "${temporario}"`]);
  if (criado.status !== 0) {
    throw new Error(`não foi possível criar o banco de conferência: ${(criado.stderr || "").trim()}`);
  }

  try {
    const restaurado = rodar("pg_restore", [...conexao(temporario), "--no-owner", "--no-privileges", arquivo]);
    // pg_restore devolve 1 com avisos (ex.: extensões já existentes); o que
    // decide é a comparação das contagens.
    if (restaurado.status !== 0) {
      console.log(`aviso do pg_restore: ${(restaurado.stderr || "").trim().split(/\r?\n/).slice(-3).join(" | ")}`);
    }

    const copia = contar(temporario);
    const diferencas = Object.keys(origem).filter((tabela) => origem[tabela] !== copia[tabela]);
    if (diferencas.length > 0) {
      throw new Error(
        `o backup restaurado não bate com a origem em: ${diferencas
          .map((tabela) => `${tabela} (${origem[tabela]} x ${copia[tabela]})`)
          .join(", ")}`,
      );
    }

    const resumo = Object.entries(copia)
      .map(([tabela, total]) => `${tabela}=${total}`)
      .join(" ");
    console.log(`restauração conferida no banco ${temporario}: ${resumo}`);
  } finally {
    rodar("psql", [...conexao("postgres"), "-c", `DROP DATABASE IF EXISTS "${temporario}"`]);
  }
}

/** Apaga backups mais velhos que a retenção, sempre guardando o último. */
function aplicarRetencao() {
  const limite = Date.now() - RETENCAO_DIAS * 24 * 60 * 60 * 1000;
  const existentes = listarBackups();
  const apagar = existentes.slice(1).filter((item) => item.em.getTime() < limite);

  for (const item of apagar) {
    fs.rmSync(item.caminho, { force: true });
    console.log(`backup antigo removido: ${item.arquivo}`);
  }
  console.log(`backups guardados: ${existentes.length - apagar.length} (retenção de ${RETENCAO_DIAS} dias)`);
}

/** Cópia fora do servidor, só quando houver uma zona separada configurada. */
async function enviarParaFora(arquivo) {
  const zona = process.env.BACKUP_BUNNY_ZONE;
  const chave = process.env.BACKUP_BUNNY_KEY;
  if (!zona || !chave) {
    console.log("cópia externa não configurada (BACKUP_BUNNY_ZONE/BACKUP_BUNNY_KEY): o backup ficou só no servidor.");
    return;
  }

  const origem = (process.env.BACKUP_BUNNY_ORIGIN || "https://br.storage.bunnycdn.com").replace(/\/+$/, "");
  const destino = `${origem}/${zona}/banco/${path.basename(arquivo)}`;
  const resposta = await fetch(destino, {
    method: "PUT",
    headers: { AccessKey: chave, "Content-Type": "application/octet-stream" },
    body: fs.readFileSync(arquivo),
  });
  if (!resposta.ok) throw new Error(`a cópia externa falhou: ${resposta.status}`);
  console.log(`cópia externa enviada para ${zona}/banco/${path.basename(arquivo)}`);
}

(async () => {
  if (!DB.name || !DB.user) {
    console.error("faltam DB_NAME/DB_USER no ambiente.");
    process.exit(2);
  }

  const args = process.argv.slice(2);

  if (args.includes("--listar")) {
    const existentes = listarBackups();
    if (existentes.length === 0) console.log("nenhum backup em", BACKUP_DIR);
    for (const item of existentes) {
      console.log(`${item.em.toISOString()} ${mb(item.bytes).padStart(10)} ${item.arquivo}`);
    }
    return;
  }

  console.log(`banco ${DB.name} em ${DB.host}:${DB.port} -> ${BACKUP_DIR}`);
  const arquivo = gerarBackup();

  if (args.includes("--verificar")) conferirRestauracao(arquivo);
  await enviarParaFora(arquivo).catch((erro) => {
    console.error(`[backup] ${erro.message}`);
    process.exitCode = 1;
  });
  aplicarRetencao();
})().catch((erro) => {
  console.error(`[backup] ${erro.message}`);
  process.exit(1);
});
