const crypto = require("crypto");
const path = require("path");
const { spawn } = require("child_process");
const { Pool } = require("pg");
const jwt = require("jsonwebtoken");
const Stripe = require("stripe");

const BACK_DIR = path.join(__dirname, "..", "..");

const JWT_SECRET = "segredo-de-teste-do-pauta-com-32-ou-mais-caracteres";
const JWT_REFRESH_SECRET = "segredo-de-refresh-do-pauta-com-32-ou-mais-caracteres";
const WEBHOOK_SECRET = "whsec_teste";
const STORAGE_ZONE = "pauta";

/** Preços falsos, no mesmo formato que o catálogo espera. */
function stripePriceEnv() {
  const env = {};
  for (const plan of ["ESSENCIAL", "PROFISSIONAL", "EMPRESARIAL"]) {
    for (const interval of ["MONTHLY", "YEARLY"]) {
      env[`STRIPE_PRICE_${plan}_${interval}`] = `price_${plan.toLowerCase()}_${interval.toLowerCase()}`;
      env[`STRIPE_PRICE_${plan}_SEAT_${interval}`] = `price_${plan.toLowerCase()}_seat_${interval.toLowerCase()}`;
    }
  }
  env.STRIPE_PRICE_STORAGE_100GB_MONTHLY = "price_storage_monthly";
  env.STRIPE_PRICE_STORAGE_100GB_YEARLY = "price_storage_yearly";
  return env;
}

// Certificado de mentira, gerado uma vez por execução da suíte.
let certificadoDeTeste = null;
function obterCertificadoDeTeste() {
  if (!certificadoDeTeste) {
    certificadoDeTeste = require("./certificado").gerarCertificadoDeTeste();
  }
  return certificadoDeTeste;
}

function buildAppEnv({ pgPort, database, appPort, httpPort, httpsPort }) {
  return {
    ...process.env,
    NODE_ENV: "test",
    TZ: "Etc/UTC",
    PORT: String(appPort),
    DB_HOST: "127.0.0.1",
    DB_PORT: String(pgPort),
    DB_NAME: database,
    DB_USER: "postgres",
    DB_PASSWORD: "teste",
    JWT_SECRET,
    JWT_REFRESH_SECRET,
    FRONTEND_URL: "http://localhost:5173",
    DISABLE_RATE_LIMIT: "true",
    // Hub de Conhecimento: o receptor de eventos dos testes escuta em 127.0.0.1.
    CONHECIMENTO_ALLOW_PRIVATE_WEBHOOK: "true",
    HEALTH_TOKEN: "token-de-saude",
    PG_BIN: require("./cluster").PG_BIN,
    BACKUP_DIR: path.join(__dirname, "..", ".tmp", "backups"),
    // Bunny falsa
    BUNNY_STORAGE_ZONE: STORAGE_ZONE,
    BUNNY_ACCESS_KEY: "chave-falsa",
    BUNNY_PULL_ZONE: `127.0.0.1:${httpsPort}`,
    BUNNY_STORAGE_API_ORIGIN: `http://127.0.0.1:${httpPort}`,
    BUNNY_TOKEN_AUTH_KEY: "token-de-teste",
    NODE_TLS_REJECT_UNAUTHORIZED: "0",
    // Stripe falsa
    STRIPE_SECRET_KEY: "sk_test_falsa",
    STRIPE_MODE: "test",
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    STRIPE_API_HOST: "127.0.0.1",
    STRIPE_API_PORT: String(httpPort),
    STRIPE_API_PROTOCOL: "http",
    ...stripePriceEnv(),
    // Prefeitura falsa, com certificado A1 gerado na hora.
    NFSE_AMBIENTE: "homologacao",
    NFSE_URL_BASE: `http://127.0.0.1:${httpPort}`,
    NFSE_CNPJ: "12345678000199",
    NFSE_INSCRICAO_MUNICIPAL: "1234567",
    NFSE_RAZAO_SOCIAL: "EMPRESA DE TESTES LTDA",
    NFSE_SERIE: "1",
    NFSE_CODIGO_TRIB_NACIONAL: "010701",
    NFSE_SIMPLES_NACIONAL: "2",
    NFSE_CERT_PFX_BASE64: obterCertificadoDeTeste().base64,
    NFSE_CERT_SENHA: obterCertificadoDeTeste().senha,
        // Consulta de CNPJ falsa
    BRASIL_API_CNPJ_URL: `http://127.0.0.1:${httpPort}/api/cnpj/v1`,
    // E-mail: sem servidor; as falhas são registradas e ignoradas.
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: "2525",
    SMTP_SECURE: "false",
    SMTP_USER: "teste",
    SMTP_PASS: "teste",
    ENTERPRISE_REQUESTS_EMAIL: "contato@test.com",
    SUPPORT_EMAIL: "contato@test.com",
  };
}

/** Sobe o app contra o banco de teste e espera ele responder. */
async function startApp(env, { appPort, onLog }) {
  const child = spawn(process.execPath, ["src/app.js"], {
    cwd: BACK_DIR,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let log = "";
  let saiu = false;
  child.once("exit", (code) => {
    saiu = true;
    if (!log.includes("Rodando na porta")) log += `
[app] processo encerrou com código ${code}
`;
  });
  const capture = (chunk) => {
    log += chunk.toString();
    if (onLog) onLog(chunk.toString());
  };
  child.stdout.on("data", capture);
  child.stderr.on("data", capture);

  const limite = Date.now() + 40000;
  while (Date.now() < limite) {
    if (log.includes("Rodando na porta")) break;
    if (child.exitCode !== null) throw new Error(`o app morreu ao subir:\n${log.slice(-2000)}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (!log.includes("Rodando na porta")) {
    throw new Error(`o app não subiu em 40s:\n${log.slice(-2000)}`);
  }

  // Espera as migrações de arranque terminarem.
  await new Promise((resolve) => setTimeout(resolve, 1500));

  return {
    child,
    getLog: () => log,
    stop: () =>
      new Promise((resolve) => {
        if (child.exitCode !== null) return resolve();
        child.once("exit", resolve);
        child.kill();
      }),
  };
}

function createApi(baseUrl) {
  return async function api(method, route, { token, body, raw, headers = {} } = {}) {
    const options = { method, headers: { ...headers } };

    if (token) options.headers.Authorization = `Bearer ${token}`;
    if (raw) {
      options.body = raw;
      options.headers["Content-Type"] = options.headers["Content-Type"] || "application/octet-stream";
    } else if (body !== undefined) {
      options.body = JSON.stringify(body);
      options.headers["Content-Type"] = "application/json";
    }

    const response = await fetch(`${baseUrl}${route}`, options);
    const texto = await response.text();
    let data = null;
    try {
      data = texto ? JSON.parse(texto) : null;
    } catch {
      data = texto;
    }
    return { status: response.status, data, headers: response.headers };
  };
}

// ---------------------------------------------------------------- documentos
function makeCpf(seed) {
  const digits = String(123456000 + seed).slice(0, 9).split("").map(Number);
  const calc = (length) => {
    let sum = 0;
    for (let i = 0; i < length; i += 1) sum += digits[i] * (length + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  digits.push(calc(9));
  digits.push(calc(10));
  return digits.join("");
}

function makeCnpj(seed) {
  const base = String(10000000 + seed).slice(0, 8) + "0001";
  const digits = base.split("").map(Number);
  const calc = (pesos) => {
    const soma = pesos.reduce((total, peso, index) => total + digits[index] * peso, 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  digits.push(calc([5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]));
  digits.push(calc([6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]));
  return digits.join("");
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Repete a função até ela devolver algo diferente de null/false. */
async function waitFor(fn, timeoutMs = 15000, intervalMs = 250) {
  const limite = Date.now() + timeoutMs;
  while (Date.now() < limite) {
    const resultado = await fn();
    if (resultado) return resultado;
    await sleep(intervalMs);
  }
  return null;
}

function createContext({ appPort, pgPort, database, fakes, env }) {
  const resultados = [];
  let falhas = 0;
  let grupoAtual = "";

  const db = new Pool({
    host: "127.0.0.1",
    port: pgPort,
    user: "postgres",
    password: "teste",
    database,
  });

  const stripeClient = new Stripe("sk_test_falsa", { host: "127.0.0.1", port: appPort, protocol: "http" });

  function check(nome, ok, detalhe = "") {
    const linha = `${ok ? "PASS" : "FAIL"}  ${grupoAtual ? `[${grupoAtual}] ` : ""}${nome}${detalhe !== "" ? `  -> ${detalhe}` : ""}`;
    if (!ok) falhas += 1;
    resultados.push(linha);
    process.stderr.write(`${linha}\n`);
  }

  const api = createApi(`http://127.0.0.1:${appPort}`);

  /** Envia um evento assinado para o webhook da Stripe. */
  async function sendWebhook(type, object, { id } = {}) {
    const payload = JSON.stringify({ id: id || `evt_${crypto.randomBytes(6).toString("hex")}`, object: "event", type, data: { object } });
    const signature = stripeClient.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
    return api("POST", "/api/billing/webhook", {
      raw: payload,
      headers: { "Content-Type": "application/json", "stripe-signature": signature },
    });
  }

  /** Token de confirmação de e-mail, igual ao que o app manda por e-mail. */
  async function verificationTokenFor(email) {
    const { rows } = await db.query("SELECT id, email FROM members WHERE email = $1", [email]);
    if (!rows[0]) throw new Error(`membro ${email} não encontrado`);
    return jwt.sign({ id: rows[0].id, purpose: "verify-email" }, `${JWT_SECRET}.verify-email.${rows[0].email.toLowerCase()}`, {
      expiresIn: "3d",
    });
  }

  // Cada cadastro do teste recebe um CPF/CNPJ único: assim dois arquivos de
  // casos nunca brigam por documento repetido.
  let documentoSeq = 0;
  const proximoSeed = () => {
    documentoSeq += 1;
    return 1000 + documentoSeq;
  };

  /** Cadastro + confirmação de e-mail em um passo, devolvendo o acesso. */
  async function signup({ email, accountType = "personal", seed, cpf, company, extra = {} }) {
    const semente = seed ?? proximoSeed();
    const body = {
      accountType,
      email,
      name: `Pessoa Teste ${semente}`,
      cpf: cpf || makeCpf(proximoSeed()),
      phone: "11987654321",
      birthDate: "1990-05-10",
      password: "senha-forte-123",
      acceptedTerms: true,
      ...(company ? { company: { cnpj: makeCnpj(proximoSeed()), ...company } } : {}),
      ...extra,
    };
    const criado = await api("POST", "/api/auth/signup", { body });
    if (criado.status !== 201) {
      throw new Error(`cadastro de ${email} falhou: ${criado.status} ${JSON.stringify(criado.data)}`);
    }

    const token = await verificationTokenFor(email);
    await api("POST", "/api/auth/verify-email", { body: { token } });
    const login = await api("POST", "/api/auth/login", { body: { email, password: "senha-forte-123" } });

    return {
      token: login.data?.token,
      refreshToken: login.data?.refreshToken,
      user: login.data?.user,
      memberId: login.data?.user?.id,
      organizationId: login.data?.user?.organization?.id,
      signupResponse: criado,
    };
  }

  /** Roda um script de manutenção (src/server/*.js) contra o banco de teste. */
  /**
   * Abre uma conexão de tempo real (SSE) como o navegador faz, para conferir
   * que o servidor avisa na hora -- sem precisar recarregar nada.
   */
  async function escutarTempoReal(token, { workspaceIds = [] } = {}) {
    const parametros = workspaceIds.length ? `?workspaceIds=${workspaceIds.join(",")}` : "";
    const controlador = new AbortController();
    const resposta = await fetch(`http://127.0.0.1:${appPort}/realtime${parametros}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "text/event-stream" },
      signal: controlador.signal,
    });

    if (!resposta.ok) throw new Error(`tempo real recusou a conexão: ${resposta.status}`);

    const recebidos = [];
    const leitor = resposta.body.getReader();
    const decodificador = new TextDecoder();
    let sobra = "";

    const lendo = (async () => {
      try {
        while (true) {
          const { done, value } = await leitor.read();
          if (done) break;
          sobra += decodificador.decode(value, { stream: true });
          const blocos = sobra.split("\n\n");
          sobra = blocos.pop() || "";
          for (const bloco of blocos) {
            const linha = bloco.split("\n").find((item) => item.startsWith("data:"));
            if (!linha) continue;
            try {
              recebidos.push(JSON.parse(linha.slice(5).trim()));
            } catch {
              // linha de keep-alive: ignora
            }
          }
        }
      } catch {
        // conexão encerrada pelo teste
      }
    })();

    return {
      eventos: recebidos,
      /** Espera até ver os tipos pedidos (ou o tempo acabar). */
      async esperarEventos(tipos, limiteMs = 8000) {
        const fim = Date.now() + limiteMs;
        while (Date.now() < fim) {
          const vistos = new Set(recebidos.map((evento) => evento.type));
          if (tipos.every((tipo) => vistos.has(tipo))) break;
          await sleep(200);
        }
        return [...recebidos];
      },
      async fechar() {
        controlador.abort();
        await lendo;
      },
    };
  }

  function runScript(nome, args = []) {
    const { spawnSync } = require("child_process");
    // Um nome simples vem de src/server; com barra, é caminho a partir da raiz.
    const script = path.join(BACK_DIR, nome.includes("/") ? nome : `src/server/${nome}`);
    const resultado = spawnSync(process.execPath, [script, ...args], {
      cwd: BACK_DIR,
      env,
      encoding: "utf8",
      timeout: 120000,
    });
    return {
      status: resultado.status,
      stdout: resultado.stdout || "",
      stderr: resultado.stderr || String(resultado.error?.message || resultado.signal || ""),
    };
  }

  return {
    api,
    db,
    fakes,
    runScript,
    escutarTempoReal,
    check,
    sleep,
    waitFor,
    makeCpf,
    makeCnpj,
    signup,
    sendWebhook,
    verificationTokenFor,
    stripeClient,
    constants: { JWT_SECRET, JWT_REFRESH_SECRET, WEBHOOK_SECRET, STORAGE_ZONE, appPort, pgPort, database },
    setGroup: (nome) => {
      grupoAtual = nome;
    },
    get results() {
      return resultados;
    },
    get failures() {
      return falhas;
    },
    close: () => db.end(),
  };
}

module.exports = { buildAppEnv, createContext, startApp, makeCpf, makeCnpj, sleep, waitFor, JWT_SECRET, WEBHOOK_SECRET };
