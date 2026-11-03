const express = require("express");
const router = express.Router();
const { postgres } = require("../server/connect");
const { verifyToken } = require("../middlewares/auth.middleware");
const { publishRealtimeEvent } = require("../services/realtime.service");
const { releaseStorageUrls } = require("../services/storage.service");
const {
  TrashRestoreError,
  listTrash,
  loadTrashItem,
  purgeTrashItem,
  restoreTrashItem,
} = require("../services/trash.service");

function isAccountAdmin(user) {
  return ["owner", "admin"].includes(user?.organizationRole);
}

/** Titular/admin mexem em tudo; os demais, só no que eles mesmos apagaram. */
function canManageItem(user, item) {
  return isAccountAdmin(user) || item.deleted_by === user.id;
}

function refreshEveryone(organizationId, actorId, reason) {
  publishRealtimeEvent({
    type: "seed.refetch",
    actorId,
    organizationId,
    payload: { reason },
  });
}

router.use(verifyToken);

router.get("/", async (req, res) => {
  try {
    const data = await listTrash({
      organizationId: req.user.organizationId,
      memberId: req.user.id,
      canSeeAll: isAccountAdmin(req.user),
    });
    return res.json({ ...data, canEmpty: isAccountAdmin(req.user) });
  } catch (error) {
    console.error("[lixeira] listar", error);
    return res.status(500).json({ message: "Não foi possível carregar a lixeira." });
  }
});

router.post("/:id/restore", async (req, res) => {
  const client = await postgres.connect();
  try {
    await client.query("BEGIN");
    const item = await loadTrashItem(client, {
      id: req.params.id,
      organizationId: req.user.organizationId,
    });

    if (!item) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Item não encontrado na lixeira." });
    }
    if (!canManageItem(req.user, item)) {
      await client.query("ROLLBACK");
      return res.status(403).json({ message: "Só quem apagou ou um administrador pode restaurar." });
    }

    await restoreTrashItem(client, item);
    await client.query("COMMIT");

    refreshEveryone(req.user.organizationId, req.user.id, "trash.restored");
    return res.json({ message: "Item restaurado." });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (error instanceof TrashRestoreError) {
      return res.status(error.status).json({ message: error.message });
    }
    console.error("[lixeira] restaurar", error);
    return res.status(500).json({ message: "Não foi possível restaurar." });
  } finally {
    client.release();
  }
});

async function purgeItems(req, res, items) {
  const client = await postgres.connect();
  const urls = [];
  try {
    await client.query("BEGIN");
    // Workspaces antes de projetos, projetos antes de cards.
    const order = { workspace: 0, list: 1, task: 2, attachment: 3 };
    for (const item of [...items].sort((a, b) => order[a.item_type] - order[b.item_type])) {
      const still = await client.query("SELECT * FROM trash_items WHERE id = $1 FOR UPDATE", [item.id]);
      if (still.rows[0]) urls.push(...(await purgeTrashItem(client, still.rows[0])));
    }
    await client.query("COMMIT");
    releaseStorageUrls(urls);
    refreshEveryone(req.user.organizationId, req.user.id, "trash.purged");
    return res.json({ message: items.length === 1 ? "Item excluído para sempre." : "Lixeira esvaziada." });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[lixeira] excluir de vez", error);
    return res.status(500).json({ message: "Não foi possível excluir." });
  } finally {
    client.release();
  }
}

router.delete("/:id", async (req, res) => {
  const item = await loadTrashItem(postgres, {
    id: req.params.id,
    organizationId: req.user.organizationId,
  }).catch(() => null);

  if (!item) {
    return res.status(404).json({ message: "Item não encontrado na lixeira." });
  }
  if (!canManageItem(req.user, item)) {
    return res.status(403).json({ message: "Só quem apagou ou um administrador pode excluir de vez." });
  }

  return purgeItems(req, res, [item]);
});

router.delete("/", async (req, res) => {
  if (!isAccountAdmin(req.user)) {
    return res.status(403).json({ message: "Só o titular ou um administrador pode esvaziar a lixeira." });
  }

  const items = await postgres
    .query("SELECT * FROM trash_items WHERE organization_id = $1", [req.user.organizationId])
    .then((result) => result.rows)
    .catch(() => []);

  if (!items.length) {
    return res.json({ message: "A lixeira já está vazia." });
  }

  return purgeItems(req, res, items);
});

module.exports = router;
