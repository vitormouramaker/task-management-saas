const express = require("express");
const router = express.Router();
const { verifyToken } = require("../middlewares/auth.middleware");
const {
  LEGAL_VERSION,
  hasAcceptedCurrent,
  listAcceptances,
  recordAcceptance,
} = require("../services/legal.service");

// Versão em vigor dos documentos (a tela usa para saber se precisa pedir aceite).
router.get("/", (_req, res) => {
  res.json({ version: LEGAL_VERSION });
});

// Aceite dos documentos pela pessoa logada.
router.post("/accept", verifyToken, async (req, res) => {
  try {
    await recordAcceptance(req.user.id, { req });
    return res.json({ message: "Aceite registrado.", version: LEGAL_VERSION });
  } catch (error) {
    console.error("Erro ao registrar aceite:", error);
    return res.status(500).json({ message: "Não foi possível registrar o aceite." });
  }
});

// Situação e histórico do aceite (usado também na exportação de dados).
router.get("/acceptances", verifyToken, async (req, res) => {
  try {
    const [accepted, history] = await Promise.all([
      hasAcceptedCurrent(req.user.id),
      listAcceptances(req.user.id),
    ]);

    return res.json({ version: LEGAL_VERSION, accepted, history });
  } catch (error) {
    console.error("Erro ao consultar aceites:", error);
    return res.status(500).json({ message: "Não foi possível consultar os aceites." });
  }
});

module.exports = router;
