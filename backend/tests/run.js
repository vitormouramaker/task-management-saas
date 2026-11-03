/**
 * Suíte de testes de integração do Pauta.
 *
 * Sobe um Postgres próprio (tests/.tmp/pgdata), servidores falsos de Stripe,
 * Bunny e consulta de CNPJ, e o app de verdade contra tudo isso. Nada toca em
 * produção nem no banco de desenvolvimento.
 *
 * Uso:
 *   node tests/run.js                 roda tudo
 *   node tests/run.js contas cobranca roda só esses arquivos de casos
 *   node tests/run.js --list          lista os casos disponíveis
 *
 * Variáveis úteis: TEST_PG_PORT, TEST_PORT_BASE, TEST_DB (para rodar duas
 * suítes ao mesmo tempo sem uma atrapalhar a outra).
 */
const fs = require("fs");
const path = require("path");
const { ensureCluster, recreateDatabase } = require("./lib/cluster");
const { startFakes } = require("./lib/fakes");
const { spawnSync } = require("child_process");
const { buildAppEnv, createContext, startApp } = require("./lib/harness");

const CASES_DIR = path.join(__dirname, "cases");
const PG_PORT = Number(process.env.TEST_PG_PORT) || 55432;
const PORT_BASE = Number(process.env.TEST_PORT_BASE) || 45100;
const DATABASE = process.env.TEST_DB || "pauta_test";

function listCaseFiles() {
  return fs
    .readdirSync(CASES_DIR)
    .filter((file) => file.endsWith(".js") && !file.endsWith(".runner.js"))
    .sort();
}

function selectCases(args) {
  const filtros = args.filter((arg) => !arg.startsWith("--"));
  const arquivos = listCaseFiles();
  if (filtros.length === 0) return arquivos;
  return arquivos.filter((file) => filtros.some((filtro) => file.includes(filtro)));
}

(async () => {
  const args = process.argv.slice(2);

  if (args.includes("--list")) {
    console.log(listCaseFiles().join("\n"));
    return;
  }

  const arquivos = selectCases(args);
  if (arquivos.length === 0) {
    console.error("nenhum arquivo de casos encontrado para", args.join(" "));
    process.exit(2);
  }

  const appPort = PORT_BASE;
  const httpPort = PORT_BASE + 1;
  const httpsPort = PORT_BASE + 2;

  console.log(`[suite] banco ${DATABASE} na porta ${PG_PORT}; app na porta ${appPort}`);
  ensureCluster(PG_PORT);
  recreateDatabase(PG_PORT, DATABASE);

  const env = buildAppEnv({ pgPort: PG_PORT, database: DATABASE, appPort, httpPort, httpsPort });
  const fakes = await startFakes({ httpPort, httpsPort });

  // Estrutura das tabelas, igual ao primeiro arranque em produção.
  const estrutura = spawnSync(process.execPath, ["src/server/init-db.js"], {
    cwd: path.join(__dirname, ".."),
    env,
    encoding: "utf8",
  });
  if (!String(estrutura.stdout).includes("sucesso")) {
    console.error(estrutura.stdout, estrutura.stderr);
    throw new Error("não foi possível criar as tabelas do banco de teste");
  }

  let app;
  let ctx;
  let erroFatal = null;

  try {
    app = await startApp(env, { appPort, onLog: args.includes("--log") ? (t) => process.stdout.write(t) : undefined });
    ctx = createContext({ appPort, pgPort: PG_PORT, database: DATABASE, fakes, env });
    ctx.restartApp = async () => {
      await app.stop();
      app = await startApp(env, { appPort });
    };
    ctx.appLog = () => app.getLog();

    for (const arquivo of arquivos) {
      const nome = arquivo.replace(/\.js$/, "").replace(/^\d+-/, "");
      ctx.setGroup(nome);
      const caso = require(path.join(CASES_DIR, arquivo));
      try {
        await caso(ctx);
      } catch (error) {
        ctx.check(`${nome}: o arquivo de casos parou no meio`, false, error?.message || String(error));
        console.error(error);
      }
    }
    ctx.setGroup("");
  } catch (error) {
    erroFatal = error;
  }

  console.log("\n==================== RESULTADO ====================");
  if (ctx) {
    console.log(ctx.results.join("\n"));
    console.log(`\n${ctx.results.length} verificação(ões)`);
    console.log(ctx.failures === 0 && !erroFatal ? "TUDO OK" : `${ctx.failures} FALHA(S)`);
  }
  if (ctx && ctx.failures > 0 && app) {
    console.log(String.fromCharCode(10) + "--- últimas linhas do app ---");
    console.log(app.getLog().slice(-4000));
  }
  if (erroFatal) {
    console.error("\nfalha fatal:", erroFatal.message);
    if (app) console.error(app.getLog().slice(-3000));
  }

  await ctx?.close();
  await app?.stop();
  await fakes.stop();

  process.exit(erroFatal || (ctx?.failures ?? 1) > 0 ? 1 : 0);
})();
