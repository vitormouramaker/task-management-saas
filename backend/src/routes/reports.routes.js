const express = require("express");
const router = express.Router();
const { verifyToken } = require("../middlewares/auth.middleware");
const { loadOrganizationBilling } = require("../services/billing.service");
const { buildReport } = require("../services/reports.service");

router.use(verifyToken);

// Relatórios da conta (plano Profissional ou maior).
router.get("/", async (req, res) => {
  if (!req.user.organizationId) {
    return res.status(403).json({ message: "Conta não identificada." });
  }

  try {
    const billing = await loadOrganizationBilling(req.user.organizationId);
    if (!billing.entitlements?.advancedReports) {
      return res.status(403).json({
        code: "PLAN_FEATURE_REPORTS",
        message: "Os relatórios estão disponíveis a partir do plano Profissional.",
      });
    }

    const report = await buildReport(req.user, {
      from: req.query.from,
      to: req.query.to,
      workspaceId: String(req.query.workspaceId || "") || null,
      listId: String(req.query.listId || "") || null,
    });

    return res.json(report);
  } catch (error) {
    console.error("[relatorios] falha ao montar", error);
    return res.status(500).json({ message: "Não foi possível montar o relatório." });
  }
});

module.exports = router;
