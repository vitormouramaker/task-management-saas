const express = require("express");
const router = express.Router();
const { verifyToken } = require("../middlewares/auth.middleware");
const { requireOrganizationAdmin } = require("../middlewares/organization-admin.middleware");
const { AccountError, sendAccountError } = require("../services/account.service");
const {
  createJobTitle,
  deleteJobTitle,
  listJobTitles,
  renameJobTitle,
} = require("../services/job-titles.service");

function requireOrganization(req) {
  if (!req.user?.organizationId) {
    throw new AccountError(403, "Conta sem empresa ativa. Faça login novamente.");
  }
  return req.user.organizationId;
}

router.get("/", verifyToken, async (req, res) => {
  try {
    res.json({ jobTitles: await listJobTitles(requireOrganization(req)) });
  } catch (error) {
    sendAccountError(res, error, "Erro ao listar cargos.");
  }
});

router.post("/", verifyToken, requireOrganizationAdmin, async (req, res) => {
  try {
    const jobTitle = await createJobTitle(req.user.organizationId, req.body?.name);
    res.status(201).json({ message: "Cargo criado.", jobTitle });
  } catch (error) {
    sendAccountError(res, error, "Erro ao criar cargo.");
  }
});

router.put("/:id", verifyToken, requireOrganizationAdmin, async (req, res) => {
  try {
    const jobTitle = await renameJobTitle(req.user.organizationId, req.params.id, req.body?.name);
    res.json({ message: "Cargo atualizado.", jobTitle });
  } catch (error) {
    sendAccountError(res, error, "Erro ao atualizar cargo.");
  }
});

router.delete("/:id", verifyToken, requireOrganizationAdmin, async (req, res) => {
  try {
    await deleteJobTitle(req.user.organizationId, req.params.id);
    res.json({ message: "Cargo removido." });
  } catch (error) {
    sendAccountError(res, error, "Erro ao remover cargo.");
  }
});

module.exports = router;
