const express = require("express");
const router = express.Router();
const { postgres } = require("../server/connect");
const { verifyToken } = require("../middlewares/auth.middleware");
const { publishRealtimeEvent } = require("../services/realtime.service");

// Buscar notificações do usuário logado
router.get("/", verifyToken, async (req, res) => {
  const userId = req.user.id;

  try {
    const result = await postgres.query(
      `SELECT n.*,
                    m.name AS assigner_name,
                    m.avatar_color AS assigner_avatar_color,
                    m.avatar_url AS assigner_avatar_url
             FROM notifications n
             LEFT JOIN members m ON n.created_by = m.id
             WHERE n.user_id = $1 ORDER BY n.created_at DESC LIMIT 50`,
      [userId],
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Erro ao buscar notificações:", error);
    res.status(500).json({ message: "Erro ao buscar notificações." });
  }
});

// Marcar notificação como lida
router.patch("/:id/read", verifyToken, async (req, res) => {
  const userId = req.user.id;
  const notificationId = req.params.id;

  try {
    const result = await postgres.query(
      "UPDATE notifications SET read = TRUE WHERE id = $1 AND user_id = $2 RETURNING id",
      [notificationId, userId],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Notificação não encontrada." });
    }
    if (result.rows.length > 0) {
      publishRealtimeEvent({
        type: "notification.read",
        actorId: userId,
        userIds: [userId],
        payload: { id: notificationId },
      });
    }
    res.json({ message: "Notificação marcada como lida." });
  } catch (error) {
    console.error("Erro ao atualizar notificação:", error);
    res.status(500).json({ message: "Erro ao atualizar notificação." });
  }
});

// Marcar todas como lidas
router.patch("/read-all", verifyToken, async (req, res) => {
  const userId = req.user.id;

  try {
    await postgres.query(
      "UPDATE notifications SET read = TRUE WHERE user_id = $1",
      [userId],
    );
    publishRealtimeEvent({
      type: "notification.read_all",
      actorId: userId,
      userIds: [userId],
      payload: {},
    });
    res.json({ message: "Todas as notificações marcadas como lidas." });
  } catch (error) {
    console.error("Erro ao atualizar notificações:", error);
    res.status(500).json({ message: "Erro ao atualizar notificações." });
  }
});

// Deletar notificação
router.delete("/:id", verifyToken, async (req, res) => {
  const userId = req.user.id;
  const notificationId = req.params.id;

  try {
    const apagada = await postgres.query(
      "DELETE FROM notifications WHERE id = $1 AND user_id = $2 RETURNING id",
      [notificationId, userId],
    );
    if (apagada.rowCount === 0) {
      return res.status(404).json({ message: "Notificação não encontrada." });
    }
    res.json({ message: "Notificação deletada." });
  } catch (error) {
    console.error("Erro ao deletar notificação:", error);
    res.status(500).json({ message: "Erro ao deletar notificação." });
  }
});

module.exports = router;
