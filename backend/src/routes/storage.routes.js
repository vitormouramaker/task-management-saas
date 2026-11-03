const express = require("express");
const router = express.Router();
const { verifyToken } = require("../middlewares/auth.middleware");
const {
  BLOCKED_FILE_MESSAGE,
  StorageError,
  assertUploadAllowed,
  assertEmailAttachmentsAllowed,
  assertFileCountAllowed,
  getOrganizationStorageUsageBytes,
  getOrganizationUploadLimits,
  isBlockedFileName,
  sendStorageError,
} = require("../services/storage.service");

router.get("/usage", verifyToken, async (req, res) => {
  const organizationId = req.user.organizationId;

  try {
    if (!organizationId) {
      throw new StorageError(403, "Conta sem empresa ativa. Faça login novamente.");
    }

    const [usedBytes, limits] = await Promise.all([
      getOrganizationStorageUsageBytes(organizationId),
      getOrganizationUploadLimits(organizationId),
    ]);

    res.json({ usedBytes, ...limits });
  } catch (error) {
    sendStorageError(req, res, error, "Erro ao consultar armazenamento.");
  }
});

// Checagem prévia para o front mostrar o motivo antes de começar a enviar o arquivo.
router.post("/upload-check", verifyToken, async (req, res) => {
  const name = String(req.body?.name || "");
  const size = Number(req.body?.size);
  const count = Number(req.body?.count);

  try {
    if (isBlockedFileName(name)) {
      throw new StorageError(415, BLOCKED_FILE_MESSAGE);
    }

    await assertFileCountAllowed({
      organizationId: req.user.organizationId,
      count,
    });

    await assertUploadAllowed({
      organizationId: req.user.organizationId,
      sizeBytes: size,
    });

    res.json({ ok: true });
  } catch (error) {
    sendStorageError(req, res, error, "Erro ao validar arquivo.");
  }
});

module.exports = router;
