/**
 * Armazenamento local para desenvolvimento: imita a Storage API e a pull zone
 * da Bunny gravando os arquivos numa pasta do disco. Assim anexos, avatares e
 * downloads funcionam sem conta na Bunny.
 *
 * Liga com LOCAL_STORAGE_DIR (pasta) e LOCAL_STORAGE_PORT (padrão 4631). O
 * resto da aplicação não sabe que é local: basta apontar
 *   BUNNY_STORAGE_API_ORIGIN=http://localhost:4631
 *   BUNNY_PULL_ZONE=localhost:4631
 *   BUNNY_PULL_ZONE_PROTOCOL=http
 *
 * Nunca liga com NODE_ENV=production.
 */
const fs = require("fs");
const http = require("http");
const path = require("path");

const ZONE = process.env.BUNNY_STORAGE_ZONE || "pauta";
const CONTENT_TYPES = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".mp4": "video/mp4",
  ".txt": "text/plain; charset=utf-8",
};

function resolveInside(root, storagePath) {
  const full = path.resolve(root, storagePath);
  // Impede ../ para fora da pasta de armazenamento.
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  return full;
}

function decodePath(pathname) {
  return pathname
    .split("/")
    .filter(Boolean)
    .map((parte) => decodeURIComponent(parte))
    .join("/");
}

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function startLocalStorageServer() {
  const dir = String(process.env.LOCAL_STORAGE_DIR || "").trim();
  if (!dir) return null;
  if (process.env.NODE_ENV === "production") {
    console.warn("[armazenamento-local] ignorado em produção.");
    return null;
  }

  const root = path.resolve(dir);
  fs.mkdirSync(root, { recursive: true });
  const port = Number(process.env.LOCAL_STORAGE_PORT) || 4631;
  const accessKey = String(process.env.BUNNY_ACCESS_KEY || "");

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    const isApi = Boolean(req.headers.accesskey) && url.pathname.startsWith(`/${ZONE}/`);

    if (isApi) {
      if (req.headers.accesskey !== accessKey) {
        return json(res, 401, { HttpCode: 401, Message: "Unauthorized" });
      }

      const storagePath = decodePath(url.pathname.slice(ZONE.length + 1));
      const full = resolveInside(root, storagePath);
      if (!full) return json(res, 400, { HttpCode: 400, Message: "Invalid path" });

      if (req.method === "PUT") {
        fs.mkdirSync(path.dirname(full), { recursive: true });
        const out = fs.createWriteStream(full);
        req.pipe(out);
        out.on("finish", () => json(res, 201, { HttpCode: 201, Message: "File uploaded." }));
        out.on("error", () => json(res, 500, { HttpCode: 500, Message: "Write failed" }));
        return undefined;
      }

      if (req.method === "DELETE") {
        if (!fs.existsSync(full)) return json(res, 404, { HttpCode: 404, Message: "Not found" });
        fs.rmSync(full, { recursive: true, force: true });
        return json(res, 200, { HttpCode: 200, Message: "File deleted." });
      }

      if (req.method === "GET" && url.pathname.endsWith("/")) {
        if (!fs.existsSync(full) || !fs.statSync(full).isDirectory()) return json(res, 200, []);
        const itens = fs.readdirSync(full, { withFileTypes: true }).map((entry) => {
          const stat = fs.statSync(path.join(full, entry.name));
          return {
            ObjectName: entry.name,
            IsDirectory: entry.isDirectory(),
            Length: entry.isDirectory() ? 0 : stat.size,
            LastChanged: stat.mtime.toISOString(),
          };
        });
        return json(res, 200, itens);
      }
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      return json(res, 405, { message: "Método não suportado." });
    }

    // Pull zone: entrega o arquivo publicamente (como a CDN faria).
    const storagePath = decodePath(isApi ? url.pathname.slice(ZONE.length + 1) : url.pathname);
    const full = resolveInside(root, storagePath);
    if (!full || !fs.existsSync(full) || !fs.statSync(full).isFile()) {
      res.writeHead(404, { "Access-Control-Allow-Origin": "*" });
      return res.end("not found");
    }

    res.writeHead(200, {
      "Content-Type": CONTENT_TYPES[path.extname(full).toLowerCase()] || "application/octet-stream",
      "Content-Length": fs.statSync(full).size,
      "Access-Control-Allow-Origin": "*",
    });
    if (req.method === "HEAD") return res.end();
    return fs.createReadStream(full).pipe(res);
  });

  // Só a própria máquina por padrão. No Docker o compose usa 0.0.0.0 para o
  // navegador do host alcançar a porta publicada.
  const host = process.env.LOCAL_STORAGE_HOST || "127.0.0.1";
  server.listen(port, host, () => {
    console.log(`[armazenamento-local] arquivos em ${root}, servidos em http://localhost:${port}`);
  });
  server.unref();
  return server;
}

module.exports = { startLocalStorageServer };
