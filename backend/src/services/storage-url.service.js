const crypto = require("crypto");
const { BUNNY_PULL_ZONE, BUNNY_PULL_ZONE_PROTOCOL } = require("./bunny.service");

// Chave de "Token Authentication" da pull zone (painel da Bunny).
// Sem a chave nada muda: as URLs continuam saindo como estão hoje.
const TOKEN_KEY = String(process.env.BUNNY_TOKEN_AUTH_KEY || "").trim();
// 12 horas: cobre um dia de trabalho com a aba aberta sem precisar recarregar,
// e ainda faz o link parar de funcionar se for repassado para fora.
const DEFAULT_TTL_SECONDS = Number(process.env.BUNNY_SIGNED_URL_TTL_SECONDS) || 43200;
const URL_PREFIX = `${BUNNY_PULL_ZONE_PROTOCOL}://${BUNNY_PULL_ZONE}/`;
const MAX_DEPTH = 12;

function isStorageUrl(value) {
  return typeof value === "string" && value.startsWith(URL_PREFIX);
}

/** No banco a URL fica sempre limpa; assinatura só na hora de entregar. */
function normalizeStorageUrl(value) {
  if (!isStorageUrl(value) || !value.includes("?")) {
    return value;
  }

  try {
    const parsed = new URL(value);
    parsed.searchParams.delete("token");
    parsed.searchParams.delete("token_path");
    parsed.searchParams.delete("expires");
    parsed.search = parsed.searchParams.toString();
    return parsed.toString();
  } catch {
    return value;
  }
}

/**
 * Gera o link temporário da Bunny: md5(chave + caminho + validade) em base64 url-safe.
 * Assim o arquivo deixa de ser público para quem tiver só o endereço.
 */
function signStorageUrl(value, { ttlSeconds = DEFAULT_TTL_SECONDS } = {}) {
  if (!TOKEN_KEY || !isStorageUrl(value)) {
    return value;
  }

  try {
    const parsed = new URL(normalizeStorageUrl(value));
    const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
    const token = crypto
      .createHash("md5")
      .update(`${TOKEN_KEY}${parsed.pathname}${expires}`)
      .digest("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");

    return `${parsed.origin}${parsed.pathname}?token=${token}&expires=${expires}`;
  } catch {
    return value;
  }
}

/** Percorre a resposta/pedido trocando toda URL da nossa CDN. */
function mapStorageUrlsDeep(value, transform, depth = 0) {
  if (typeof value === "string") {
    return transform(value);
  }

  if (!value || typeof value !== "object" || depth >= MAX_DEPTH) {
    return value;
  }

  if (value instanceof Date || Buffer.isBuffer(value)) {
    return value;
  }

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      value[index] = mapStorageUrlsDeep(value[index], transform, depth + 1);
    }
    return value;
  }

  for (const key of Object.keys(value)) {
    value[key] = mapStorageUrlsDeep(value[key], transform, depth + 1);
  }

  return value;
}

function signStorageUrlsDeep(value) {
  return mapStorageUrlsDeep(value, (url) => signStorageUrl(url));
}

/**
 * Entrando: tira a assinatura para o banco guardar a URL limpa.
 * Saindo: assina toda URL de arquivo antes de entregar ao navegador.
 */
function storageUrlMiddleware(req, res, next) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    mapStorageUrlsDeep(req.body, normalizeStorageUrl);
  }

  const sendJson = res.json.bind(res);
  res.json = (body) => {
    const assinado = signStorageUrlsDeep(body);
    anotarEntrega(req, body);
    return sendJson(assinado);
  };

  next();
}

/** Guarda na trilha de auditoria quais arquivos foram entregues nesta resposta. */
function anotarEntrega(req, body) {
  const usuario = req.user;
  if (!usuario) return;

  const caminhos = new Set();
  mapStorageUrlsDeep(body, (url) => {
    const caminho = caminhoDaUrl(url);
    if (caminho) caminhos.add(caminho);
    return url;
  });
  if (caminhos.size === 0) return;

  const { registrarEntregaDeLink } = require("./storage-audit.service");
  const encaminhado = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  for (const storagePath of caminhos) {
    registrarEntregaDeLink({
      storagePath,
      organizationId: usuario.organizationId || null,
      memberId: usuario.id || usuario.memberId || null,
      ip: encaminhado || req.socket?.remoteAddress || null,
      userAgent: req.headers["user-agent"] || null,
    });
  }
}

/** Tira o caminho do arquivo de uma URL da pull zone. */
function caminhoDaUrl(url) {
  if (!isStorageUrl(url)) return null;
  try {
    const { pathname } = new URL(url);
    return decodeURIComponent(pathname.replace(/^\//, "")) || null;
  } catch {
    return null;
  }
}

module.exports = {
  isStorageUrl,
  isSignedUrlEnabled: () => Boolean(TOKEN_KEY),
  normalizeStorageUrl,
  signStorageUrl,
  signStorageUrlsDeep,
  mapStorageUrlsDeep,
  storageUrlMiddleware,
};
