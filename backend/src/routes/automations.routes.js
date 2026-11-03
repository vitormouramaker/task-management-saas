const express = require("express");
const router = express.Router();
const { verifyToken } = require("../middlewares/auth.middleware");
const { loadOrganizationBilling } = require("../services/billing.service");
const {
  ACTIONS,
  AutomationError,
  TRIGGERS,
  createAutomation,
  deleteAutomation,
  listAutomations,
  updateAutomation,
} = require("../services/automations.service");

router.use(verifyToken);

/** Automações são do plano Profissional em diante, e só titular/admin mexe. */
async function assertPodeUsar(req) {
  if (!req.user.organizationId) {
    throw new AutomationError(403, "Conta não identificada.");
  }
  const billing = await loadOrganizationBilling(req.user.organizationId);
  if (!billing.entitlements?.automations) {
    throw new AutomationError(403, "As automações estão disponíveis a partir do plano Profissional.");
  }
}

function assertAdministra(req) {
  if (!["owner", "admin"].includes(req.user.organizationRole)) {
    throw new AutomationError(403, "Só o titular ou um administrador pode mexer nas automações.");
  }
}

function responder(res, error, fallback) {
  if (error instanceof AutomationError) {
    const code = error.status === 403 ? "PLAN_FEATURE_AUTOMATIONS" : undefined;
    return res.status(error.status).json({ message: error.message, code });
  }
  console.error(`[automacoes] ${fallback}`, error);
  return res.status(500).json({ message: fallback });
}

router.get("/", async (req, res) => {
  try {
    await assertPodeUsar(req);
    return res.json({
      triggers: TRIGGERS,
      actions: ACTIONS,
      automations: await listAutomations(req.user.organizationId, { listId: req.query.listId || null }),
    });
  } catch (error) {
    return responder(res, error, "Não foi possível carregar as automações.");
  }
});

router.post("/", async (req, res) => {
  try {
    await assertPodeUsar(req);
    assertAdministra(req);
    const automation = await createAutomation(req.user.organizationId, req.user.id, req.body || {});
    return res.status(201).json({ automation, message: "Automação criada." });
  } catch (error) {
    return responder(res, error, "Não foi possível criar a automação.");
  }
});

router.patch("/:id", async (req, res) => {
  try {
    await assertPodeUsar(req);
    assertAdministra(req);
    const automation = await updateAutomation(req.user.organizationId, req.params.id, req.body || {});
    return res.json({ automation, message: "Automação atualizada." });
  } catch (error) {
    return responder(res, error, "Não foi possível atualizar a automação.");
  }
});

router.delete("/:id", async (req, res) => {
  try {
    await assertPodeUsar(req);
    assertAdministra(req);
    await deleteAutomation(req.user.organizationId, req.params.id);
    return res.json({ message: "Automação apagada." });
  } catch (error) {
    return responder(res, error, "Não foi possível apagar a automação.");
  }
});

module.exports = router;
