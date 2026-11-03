const { publishRealtimeEvent } = require("./realtime.service");
const { sendPushNotifications } = require("./push.service");

let ensureNotificationsSchemaPromise = null;

function createNotificationId() {
  return `not_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

async function ensureNotificationsSchema(client) {
  if (!ensureNotificationsSchemaPromise) {
    ensureNotificationsSchemaPromise = (async () => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS notifications (
          id VARCHAR(100) PRIMARY KEY,
          user_id VARCHAR(100) REFERENCES members(id) ON DELETE CASCADE,
          title VARCHAR(255) NOT NULL,
          message TEXT,
          type VARCHAR(50) NOT NULL,
          reference_id VARCHAR(100) NOT NULL,
          read BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          created_by VARCHAR(100) REFERENCES members(id) ON DELETE SET NULL
        );
      `);

      await client.query(`
        ALTER TABLE notifications
        ADD COLUMN IF NOT EXISTS created_by VARCHAR(100) REFERENCES members(id) ON DELETE SET NULL
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_notifications_user_created_at
        ON notifications (user_id, created_at DESC)
      `);
    })().catch((error) => {
      ensureNotificationsSchemaPromise = null;
      throw error;
    });
  }

  return ensureNotificationsSchemaPromise;
}

function normalizeNotifications(notifications) {
  if (!Array.isArray(notifications)) {
    return [];
  }

  const deduped = new Map();

  for (const notification of notifications) {
    if (
      !notification ||
      typeof notification.userId !== "string" ||
      !notification.userId.trim() ||
      typeof notification.title !== "string" ||
      typeof notification.message !== "string" ||
      typeof notification.type !== "string" ||
      typeof notification.referenceId !== "string"
    ) {
      continue;
    }

    const normalized = {
      id: notification.id || createNotificationId(),
      userId: notification.userId.trim(),
      title: notification.title,
      message: notification.message,
      type: notification.type,
      referenceId: notification.referenceId,
      createdBy: notification.createdBy || null,
      pushTitle: notification.pushTitle || notification.title,
      pushBody: notification.pushBody || notification.message,
      url: notification.url || "/",
    };

    const dedupeKey = `${normalized.userId}:${normalized.type}:${normalized.referenceId}:${normalized.message}`;
    if (!deduped.has(dedupeKey)) {
      deduped.set(dedupeKey, normalized);
    }
  }

  return Array.from(deduped.values());
}

async function storeNotifications(client, notifications) {
  const normalizedNotifications = normalizeNotifications(notifications);
  if (normalizedNotifications.length === 0) {
    return [];
  }

  await ensureNotificationsSchema(client);

  for (const notification of normalizedNotifications) {
    await client.query(
      `INSERT INTO notifications (
        id,
        user_id,
        title,
        message,
        type,
        reference_id,
        created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        notification.id,
        notification.userId,
        notification.title,
        notification.message,
        notification.type,
        notification.referenceId,
        notification.createdBy,
      ],
    );
  }

  return normalizedNotifications;
}

async function dispatchStoredNotifications({
  actorId = null,
  notifications = [],
  reason = "notifications.updated",
}) {
  const normalizedNotifications = normalizeNotifications(notifications);
  if (normalizedNotifications.length === 0) {
    return { count: 0 };
  }

  const userIds = Array.from(
    new Set(normalizedNotifications.map((notification) => notification.userId)),
  );

  publishRealtimeEvent({
    type: "notification.refetch",
    actorId,
    userIds,
    payload: { reason },
  });

  try {
    await sendPushNotifications(normalizedNotifications);
  } catch (error) {
    console.error("[notifications] Falha ao despachar push:", error);
  }

  return { count: normalizedNotifications.length };
}

module.exports = {
  storeNotifications,
  dispatchStoredNotifications,
};
