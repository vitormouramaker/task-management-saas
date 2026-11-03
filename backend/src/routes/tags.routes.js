const express = require("express");
const router = express.Router();
const { postgres } = require("../server/connect");
const { verifyToken } = require("../middlewares/auth.middleware");

function getOrganizationId(req, res) {
  const organizationId = req.user.organizationId;

  if (!organizationId) {
    res.status(403).json({
      message: "Conta sem empresa ativa. Faça login novamente.",
    });
    return null;
  }

  return organizationId;
}

router.get("/", verifyToken, async (req, res) => {
  const organizationId = getOrganizationId(req, res);
  if (!organizationId) return;

  const client = await postgres.connect();

  try {
    const result = await client.query(
      'SELECT id, name, color, organization_id as "organizationId" FROM tags WHERE organization_id = $1',
      [organizationId],
    );
    res.json({ tags: result.rows });
  } catch (error) {
    console.error("Erro ao buscar tags:", error);
    res.status(500).json({ message: "Erro ao buscar etiquetas." });
  } finally {
    client.release();
  }
});

router.post("/", verifyToken, async (req, res) => {
  const { name, color } = req.body;
  const organizationId = getOrganizationId(req, res);
  if (!organizationId) return;

  if (!name || !color) {
    return res.status(400).json({ message: "Nome e cor são obrigatórios." });
  }

  const id = "tag_" + Math.random().toString(36).slice(2, 10);
  const client = await postgres.connect();

  try {
    const result = await client.query(
      'INSERT INTO tags (id, name, color, organization_id) VALUES ($1, $2, $3, $4) RETURNING id, name, color, organization_id as "organizationId"',
      [id, name, color, organizationId],
    );

    res.status(201).json({ message: "Etiqueta criada.", tag: result.rows[0] });
  } catch (error) {
    console.error("Erro ao criar tag:", error);
    res.status(500).json({ message: "Erro ao criar etiqueta." });
  } finally {
    client.release();
  }
});

router.put("/:id", verifyToken, async (req, res) => {
  const { id } = req.params;
  const { name, color } = req.body;
  const organizationId = getOrganizationId(req, res);
  if (!organizationId) return;

  if (!name || !color) {
    return res.status(400).json({ message: "Nome e cor são obrigatórios." });
  }

  const client = await postgres.connect();

  try {
    const result = await client.query(
      'UPDATE tags SET name = $1, color = $2 WHERE id = $3 AND organization_id = $4 RETURNING id, name, color, organization_id as "organizationId"',
      [name, color, id, organizationId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Etiqueta não encontrada." });
    }

    res.json({ message: "Etiqueta atualizada.", tag: result.rows[0] });
  } catch (error) {
    console.error("Erro ao atualizar tag:", error);
    res.status(500).json({ message: "Erro ao atualizar etiqueta." });
  } finally {
    client.release();
  }
});

router.delete("/:id", verifyToken, async (req, res) => {
  const { id } = req.params;
  const organizationId = getOrganizationId(req, res);
  if (!organizationId) return;

  const client = await postgres.connect();

  try {
    await client.query(
      "DELETE FROM tags WHERE id = $1 AND organization_id = $2",
      [id, organizationId],
    );
    res.json({ message: "Etiqueta removida." });
  } catch (error) {
    console.error("Erro ao remover tag:", error);
    res.status(500).json({ message: "Erro ao remover etiqueta." });
  } finally {
    client.release();
  }
});

module.exports = router;
