const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

/**
 * Cluster Postgres temporário só para os testes, criado na primeira execução
 * em tests/.tmp/pgdata. Não encosta no banco de desenvolvimento nem no de
 * produção: porta, pasta e senha são exclusivas daqui.
 */

const TMP_DIR = path.join(__dirname, "..", ".tmp");
const DATA_DIR = path.join(TMP_DIR, "pgdata");
const PASSWORD = "teste";

function findPgBin() {
  if (process.env.PG_BIN) return process.env.PG_BIN;

  const candidates = [];
  for (const base of ["C:/Program Files/PostgreSQL", "C:/Program Files (x86)/PostgreSQL"]) {
    if (!fs.existsSync(base)) continue;
    for (const version of fs.readdirSync(base).sort().reverse()) {
      candidates.push(path.join(base, version, "bin"));
    }
  }
  candidates.push("/usr/lib/postgresql/16/bin", "/usr/local/bin", "/usr/bin");

  const found = candidates.find((dir) => fs.existsSync(path.join(dir, `pg_ctl${process.platform === "win32" ? ".exe" : ""}`)));
  if (!found) {
    throw new Error("Postgres não encontrado. Defina PG_BIN com a pasta bin do Postgres.");
  }
  return found;
}

const PG_BIN = findPgBin();
const exe = (name) => path.join(PG_BIN, process.platform === "win32" ? `${name}.exe` : name);

function run(name, args, options = {}) {
  return spawnSync(exe(name), args, { encoding: "utf8", ...options });
}

function isReady(port) {
  return run("pg_isready", ["-h", "127.0.0.1", "-p", String(port)]).status === 0;
}

/** Sobe o cluster (criando na primeira vez) e devolve a porta. */
function ensureCluster(port) {
  if (isReady(port)) return port;

  fs.mkdirSync(TMP_DIR, { recursive: true });

  if (!fs.existsSync(path.join(DATA_DIR, "PG_VERSION"))) {
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
    const passwordFile = path.join(TMP_DIR, "senha.txt");
    fs.writeFileSync(passwordFile, PASSWORD, "utf8");
    const init = run("initdb", [
      "-D", DATA_DIR,
      "-U", "postgres",
      "--pwfile", passwordFile,
      "--auth=md5",
      "--encoding=UTF8",
      "--locale=C",
    ]);
    fs.rmSync(passwordFile, { force: true });
    if (init.status !== 0) {
      throw new Error(`initdb falhou: ${init.stderr || init.stdout}`);
    }
    // Produção roda em UTC; o teste precisa do mesmo fuso para bater datas.
    fs.appendFileSync(path.join(DATA_DIR, "postgresql.conf"), "\ntimezone = 'Etc/UTC'\nlog_timezone = 'Etc/UTC'\n");
  }

  const logFile = path.join(TMP_DIR, "postgres.log");
  const opcoes = [`-p ${port}`, "-c listen_addresses=127.0.0.1"];
  if (process.platform !== "win32") {
    // O diretório padrão do socket (/var/run/postgresql) não é gravável fora
    // do usuário postgres — no CI isso impedia o cluster de subir.
    opcoes.push(`-c unix_socket_directories=${TMP_DIR}`);
  }

  const start = run("pg_ctl", [
    "-D", DATA_DIR,
    "-o", opcoes.join(" "),
    "-l", logFile,
    "-w",
    "start",
  ]);
  if (!isReady(port)) {
    const log = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8").trim().split(/\r?\n/).slice(-10).join(" | ") : "";
    throw new Error(
      `não foi possível subir o Postgres de teste: ${start.stderr || start.stdout}${log ? ` | log: ${log}` : ""}`,
    );
  }

  return port;
}

/** Recria o banco do teste, derrubando conexões antigas. */
function recreateDatabase(port, database) {
  const env = { ...process.env, PGPASSWORD: PASSWORD };
  const psql = (sql) =>
    run("psql", ["-h", "127.0.0.1", "-p", String(port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", sql], { env });

  psql(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${database}' AND pid <> pg_backend_pid()`,
  );
  const drop = psql(`DROP DATABASE IF EXISTS ${database}`);
  if (drop.status !== 0) throw new Error(`DROP DATABASE falhou: ${drop.stderr}`);
  const create = psql(`CREATE DATABASE ${database}`);
  if (create.status !== 0) throw new Error(`CREATE DATABASE falhou: ${create.stderr}`);
}

function stopCluster() {
  run("pg_ctl", ["-D", DATA_DIR, "-m", "fast", "stop"]);
}

module.exports = { DATA_DIR, PASSWORD, PG_BIN, TMP_DIR, ensureCluster, recreateDatabase, stopCluster };
