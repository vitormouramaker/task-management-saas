const express = require("express");
const jwt = require("jsonwebtoken");
const { JWT_SECRET } = require("../config/jwt");
const { registrarErro } = require("../services/telemetry.service");

/**
 * Entrada dos erros de tela. A rota é pública de propósito: um erro que impede
 * o login também precisa chegar. O corpo é pequeno e o conteúdo é cortado no
 * serviço, então não dá para usar isso como depósito de texto.
 */

const router = express.Router();

/** Se vier um token válido, o erro fica ligado à conta de quem estava na tela. */
function identificar(req) {
  const cabecalho = req.headers.authorization || "";
  const token = cabecalho.startsWith("Bearer ") ? cabecalho.slice(7) : null;
  if (!token) return {};

  try {
    const dados = jwt.verify(token, JWT_SECRET);
    return { memberId: dados.id || null, organizationId: dados.organizationId || null };
  } catch {
    return {};
  }
}

router.post("/erro", express.json({ limit: "32kb" }), async (req, res) => {
  const corpo = req.body || {};
  const mensagem = String(corpo.mensagem || "").trim();

  if (!mensagem) {
    return res.status(400).json({ message: "Sem mensagem de erro." });
  }

  try {
    const { memberId, organizationId } = identificar(req);
    await registrarErro({
      origem: "front",
      mensagem,
      tipo: corpo.tipo,
      pilha: corpo.pilha,
      url: corpo.url,
      versao: corpo.versao,
      userAgent: req.headers["user-agent"],
      memberId,
      organizationId,
      extra: corpo.extra,
    });
  } catch (erro) {
    // Falhar aqui não pode atrapalhar quem está usando o sistema.
    console.error("[erros] não foi possível registrar o erro da tela:", erro?.message || erro);
  }

  // Sempre 204: a tela não precisa saber o que aconteceu com o registro.
  return res.status(204).end();
});

module.exports = router;
