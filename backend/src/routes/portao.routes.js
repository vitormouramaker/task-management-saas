const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const express = require("express");
const { rateLimit } = require("express-rate-limit");

/**
 * Portão do ambiente fechado (homologação): uma senha única para abrir a tela.
 *
 * Existe porque o Basic Auth do navegador não tem como ser desfeito: uma vez
 * digitada, a senha fica guardada até a janela fechar. Aqui o acesso vira um
 * cookie com prazo, que o botão de sair do Pauta apaga -- então, ao deslogar,
 * a senha é pedida de novo.
 *
 * Só entra no ar quando PORTAO_SENHA está definida.
 */

const router = express.Router();

const COOKIE = "pauta_portao";
const HORAS = Number(process.env.PORTAO_HORAS || 12);
const SEGREDO = process.env.PORTAO_SEGREDO || process.env.JWT_SECRET || "";
const SENHA = process.env.PORTAO_SENHA || "";
const NOME_DO_AMBIENTE = process.env.PORTAO_TITULO || "Pauta — ambiente de homologação";

function lerCookie(req, nome) {
  const bruto = req.headers.cookie || "";
  for (const parte of bruto.split(";")) {
    const [chave, ...resto] = parte.trim().split("=");
    if (chave === nome) return decodeURIComponent(resto.join("="));
  }
  return null;
}

function destinoSeguro(valor) {
  // Só caminhos do próprio site: nada de redirecionar para fora. Barra invertida
  // e caracteres de controle ficam de fora porque o navegador trata "/\x" como "//x".
  const bruto = String(valor || "/");
  if (!bruto.startsWith("/") || bruto.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(bruto)) {
    return "/";
  }
  return bruto;
}

function escaparHtml(valor) {
  return String(valor)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// A senha é única para o ambiente todo: sem limite próprio, dava para testar
// milhares por minuto.
const limiteDeTentativas = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  skipSuccessfulRequests: true,
});

function pagina({ destino, erro }) {
  const aviso = erro
    ? `<p class="erro">${erro}</p>`
    : `<p class="dica">Ambiente de testes. Nada aqui é a produção do Pauta.</p>`;

  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow" />
    <title>${NOME_DO_AMBIENTE}</title>
    <style>
      :root { color-scheme: light dark; }
      * { box-sizing: border-box; }
      html, body { height: 100%; }
      body {
        margin: 0; min-height: 100dvh; display: flex; align-items: center; justify-content: center;
        padding: 24px;
        font-family: system-ui, -apple-system, "Segoe UI", sans-serif; background: #f8fafc; color: #0f172a;
      }
      .cartao {
        width: 100%; max-width: 380px; background: #fff; border: 1px solid #e2e8f0;
        border-radius: 16px; padding: 24px; box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08);
      }
      h1 { font-size: 18px; margin: 0 0 4px; }
      .dica, .erro { font-size: 13px; margin: 0 0 16px; }
      .dica { color: #64748b; }
      .erro { color: #b91c1c; font-weight: 700; }
      label { display: block; font-size: 12px; font-weight: 700; color: #475569; margin-bottom: 6px; }
      .campo { position: relative; }
      input {
        width: 100%; height: 44px; padding: 0 44px 0 12px; font-size: 15px;
        border: 1px solid #cbd5e1; border-radius: 12px; background: #fff; color: inherit;
      }
      .olho {
        position: absolute; right: 6px; top: 50%; transform: translateY(-50%);
        width: 32px; height: 32px; display: grid; place-items: center;
        border: 0; background: transparent; color: #94a3b8; cursor: pointer; border-radius: 8px;
      }
      .olho:hover { background: #f1f5f9; color: #475569; }
      button {
        margin-top: 16px; width: 100%; height: 44px; border: 0; border-radius: 12px;
        background: #2563eb; color: #fff; font-size: 14px; font-weight: 800; cursor: pointer;
      }
      button:hover { background: #1d4ed8; }
      @media (prefers-color-scheme: dark) {
        body { background: #0b1120; color: #e2e8f0; }
        .cartao { background: #111827; border-color: #1f2937; }
        input { background: #0b1120; border-color: #334155; }
        .dica { color: #94a3b8; }
        .olho:hover { background: rgba(255, 255, 255, 0.06); color: #cbd5e1; }
      }
    </style>
  </head>
  <body>
    <main class="cartao">
      <h1>${NOME_DO_AMBIENTE}</h1>
      ${aviso}
      <form method="post" action="/__portao/entrar">
        <input type="hidden" name="destino" value="${escaparHtml(destinoSeguro(destino))}" />
        <label for="senha">Senha do ambiente</label>
        <div class="campo">
          <input id="senha" name="senha" type="password" autocomplete="current-password" autofocus required />
          <button type="button" class="olho" id="olho" aria-label="Mostrar senha" title="Mostrar senha">
            <svg id="icone-olho" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </button>
        </div>
        <button type="submit">Entrar</button>
      </form>
    </main>
    <script src="/__portao/portao.js"></script>
  </body>
</html>`;
}

/** O proxy reverso consulta esta rota antes de servir qualquer tela. */
router.get("/verificar", (req, res) => {
  const token = lerCookie(req, COOKIE);
  if (!token) return res.status(401).end();

  try {
    jwt.verify(token, SEGREDO, { subject: "portao" });
    return res.status(200).end();
  } catch {
    return res.status(401).end();
  }
});

/** O CSP nao deixa rodar script escrito no HTML: ele vem deste arquivo. */
router.get("/portao.js", (_req, res) => {
  res.type("application/javascript").send(`
(function () {
  var campo = document.getElementById("senha");
  var botao = document.getElementById("olho");
  var icone = document.getElementById("icone-olho");
  if (!campo || !botao || !icone) return;

  var olhoAberto = icone.innerHTML;
  var olhoFechado =
    '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-6.5 0-10-7-10-7a18.45 18.45 0 0 1 5.06-5.94" />' +
    '<path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c6.5 0 10 7 10 7a18.5 18.5 0 0 1-2.16 3.19" />' +
    '<path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />' +
    '<line x1="2" y1="2" x2="22" y2="22" />';

  botao.addEventListener("click", function () {
    var mostrando = campo.type === "text";
    campo.type = mostrando ? "password" : "text";
    icone.innerHTML = mostrando ? olhoAberto : olhoFechado;
    var rotulo = mostrando ? "Mostrar senha" : "Ocultar senha";
    botao.setAttribute("aria-label", rotulo);
    botao.setAttribute("title", rotulo);
    campo.focus();
  });
})();
  `);
});

router.get("/entrar", (req, res) => {
  res.type("html").send(pagina({ destino: req.query.destino }));
});

router.post("/entrar", limiteDeTentativas, express.urlencoded({ extended: false }), (req, res) => {
  const enviada = String(req.body?.senha || "");
  const destino = destinoSeguro(req.body?.destino);

  // Compara os hashes: mesmo tamanho sempre, em tempo constante.
  const hash = (texto) => crypto.createHash("sha256").update(texto).digest();
  const confere = crypto.timingSafeEqual(hash(enviada), hash(SENHA));

  if (!confere) {
    return res.status(401).type("html").send(pagina({ destino, erro: "Senha incorreta." }));
  }

  const token = jwt.sign({}, SEGREDO, { subject: "portao", expiresIn: `${HORAS}h` });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: HORAS * 60 * 60 * 1000,
  });
  return res.redirect(destino);
});

/** Chamada pelo Pauta quando a pessoa sai da conta. */
router.all("/sair", (req, res) => {
  res.clearCookie(COOKIE, { path: "/", httpOnly: true, secure: true, sameSite: "lax" });
  if (req.method === "GET") return res.redirect("/__portao/entrar");
  return res.status(204).end();
});

module.exports = router;
module.exports.portaoLigado = () => Boolean(SENHA && SEGREDO);
