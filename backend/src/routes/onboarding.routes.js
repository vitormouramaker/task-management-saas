const express = require("express");
const router = express.Router();
const { verifyToken } = require("../middlewares/auth.middleware");
const { completeTour, unsubscribeTips } = require("../services/onboarding.service");

// Tour do primeiro acesso concluído ou pulado.
router.post("/tour/complete", verifyToken, async (req, res) => {
  try {
    await completeTour(req.user.id);
    return res.json({ ok: true });
  } catch (error) {
    console.error("[onboarding] concluir tour", error);
    return res.status(500).json({ message: "Não foi possível salvar." });
  }
});

// Link "não quero mais receber dicas" dos e-mails (sem login).
router.post("/dicas/sair", async (req, res) => {
  try {
    const ok = await unsubscribeTips(req.body?.m, req.body?.t);
    if (!ok) {
      return res.status(400).json({ message: "Link inválido ou incompleto." });
    }
    return res.json({ message: "Pronto: você não vai mais receber e-mails de dicas do Pauta." });
  } catch (error) {
    console.error("[onboarding] sair das dicas", error);
    return res.status(500).json({ message: "Não foi possível concluir agora. Tente de novo." });
  }
});

module.exports = router;
