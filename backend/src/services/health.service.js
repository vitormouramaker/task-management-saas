const { postgres } = require("../server/connect");
const { isStripeEnabled } = require("../config/stripe");

/**
 * Health check de verdade: diz se o serviço consegue trabalhar, não apenas se
 * o processo está no ar. É o que o monitor de disponibilidade consulta, então
 * responde rápido e nunca estoura em erro — devolve o que falhou.
 */

const TEMPO_LIMITE_MS = Number(process.env.HEALTH_TIMEOUT_MS || 3000);
const iniciadoEm = Date.now();

/** Executa a verificação com tempo limite, sempre devolvendo um resultado. */
async function medir(nome, tarefa) {
  const comecou = Date.now();
  let temporizador = null;

  try {
    const resultado = await Promise.race([
      tarefa(),
      new Promise((_resolve, reject) => {
        temporizador = setTimeout(
          () => reject(new Error(`sem resposta em ${TEMPO_LIMITE_MS}ms`)),
          TEMPO_LIMITE_MS,
        );
      }),
    ]);
    return { nome, ok: true, ms: Date.now() - comecou, ...(resultado || {}) };
  } catch (error) {
    return { nome, ok: false, ms: Date.now() - comecou, erro: error?.message || String(error) };
  } finally {
    if (temporizador) clearTimeout(temporizador);
  }
}

/** O banco responde e aceita leitura? */
function checarBanco() {
  return medir("banco", async () => {
    const { rows } = await postgres.query("SELECT 1 AS ok");
    if (rows[0]?.ok !== 1) throw new Error("resposta inesperada do banco");
    return {
      pool: { total: postgres.totalCount, livres: postgres.idleCount, naFila: postgres.waitingCount },
    };
  });
}

/** O armazenamento de anexos responde? (opcional: só se estiver configurado) */
function checarArmazenamento() {
  const zona = process.env.BUNNY_STORAGE_ZONE || "pauta";
  const chave = process.env.BUNNY_ACCESS_KEY;
  if (!chave) return Promise.resolve({ nome: "armazenamento", ok: true, pulado: true });

  return medir("armazenamento", async () => {
    const origem = (process.env.BUNNY_STORAGE_API_ORIGIN || "https://br.storage.bunnycdn.com").replace(/\/+$/, "");
    const resposta = await fetch(`${origem}/${zona}/`, {
      method: "GET",
      headers: { AccessKey: chave, Accept: "application/json" },
    });
    if (!resposta.ok) throw new Error(`a Bunny respondeu ${resposta.status}`);
    return {};
  });
}

/** A cobrança está configurada e a chave é aceita? */
function checarCobranca() {
  if (!isStripeEnabled()) return Promise.resolve({ nome: "cobranca", ok: true, pulado: true });

  return medir("cobranca", async () => {
    const { stripe } = require("../config/stripe");
    const conta = await stripe.accounts.retrieve();
    return { conta: conta?.id || null };
  });
}

/**
 * Verificação rasa, para o monitor de disponibilidade: o banco é o único item
 * que derruba o serviço inteiro, então é o único que decide o status.
 */
async function checarEssencial() {
  const banco = await checarBanco();
  return {
    status: banco.ok ? "ok" : "fora",
    service: "pauta-backend",
    version: process.env.APP_VERSION || process.env.GIT_COMMIT || null,
    uptimeSegundos: Math.round((Date.now() - iniciadoEm) / 1000),
    checagens: [banco],
  };
}

/** Verificação completa, para diagnóstico: inclui dependências externas. */
async function checarTudo() {
  const [banco, armazenamento, cobranca] = await Promise.all([
    checarBanco(),
    checarArmazenamento(),
    checarCobranca(),
  ]);
  const checagens = [banco, armazenamento, cobranca];

  return {
    status: banco.ok ? (checagens.every((item) => item.ok) ? "ok" : "degradado") : "fora",
    service: "pauta-backend",
    version: process.env.APP_VERSION || process.env.GIT_COMMIT || null,
    ambiente: process.env.NODE_ENV || "development",
    uptimeSegundos: Math.round((Date.now() - iniciadoEm) / 1000),
    memoriaMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    checagens,
  };
}

module.exports = { checarEssencial, checarTudo };
