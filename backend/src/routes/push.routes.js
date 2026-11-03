const express = require("express");
const router = express.Router();
const { postgres } = require("../server/connect");
const { verifyToken } = require("../middlewares/auth.middleware");
const { ensurePushTokensSchema } = require("../services/push.service");

// Salva ou atualiza o token FCM do usuário logado
router.post("/register", verifyToken, async (req, res) => {
  const userId = req.user.id;
  const { fcmToken, appOrigin } = req.body;
  const userAgent = String(req.headers["user-agent"] || "").trim() || null;
  const normalizedAppOrigin =
    typeof appOrigin === "string" && appOrigin.trim() ? appOrigin.trim() : null;
  if (!fcmToken) {
    return res.status(400).json({ message: "Token FCM não fornecido." });
  }
  try {
    await ensurePushTokensSchema();
    await postgres.query(
      `INSERT INTO user_push_tokens (fcm_token, user_id, app_origin, user_agent, updated_at, last_seen_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())
       ON CONFLICT (fcm_token)
       DO UPDATE SET
         user_id = EXCLUDED.user_id,
         app_origin = EXCLUDED.app_origin,
         user_agent = EXCLUDED.user_agent,
         updated_at = NOW(),
         last_seen_at = NOW()`,
      [fcmToken, userId, normalizedAppOrigin, userAgent],
    );

    if (normalizedAppOrigin) {
      await postgres.query(
        `DELETE FROM user_push_tokens
         WHERE user_id = $1
           AND fcm_token <> $2
           AND user_agent IS NOT DISTINCT FROM $3
           AND app_origin IS NOT DISTINCT FROM $4`,
        [userId, fcmToken, userAgent, normalizedAppOrigin],
      );

      if (
        !/https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(
          normalizedAppOrigin,
        )
      ) {
        await postgres.query(
          `DELETE FROM user_push_tokens
           WHERE user_id = $1
             AND app_origin ~* '^https?://(localhost|127\\.0\\.0\\.1|\\[::1\\])(?::[0-9]+)?$'`,
          [userId],
        );
      }
    }

    res.json({ message: "Token FCM registrado com sucesso." });
  } catch (error) {
    console.error("Erro ao registrar token FCM:", error);
    res.status(500).json({ message: "Erro ao registrar token FCM." });
  }
});

module.exports = router;
