const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");

const { postgres } = require("../server/connect");

const INVALID_PUSH_TOKEN_CODES = new Set([
  "messaging/invalid-registration-token",
  "messaging/registration-token-not-registered",
  "messaging/invalid-argument",
]);

let ensurePushTokensSchemaPromise = null;
let firebaseApp = null;
let firebaseInitAttempted = false;
let firebaseConfigWarningShown = false;
let firebaseCredentialWarningShown = false;

async function ensurePushTokensSchema() {
  if (!ensurePushTokensSchemaPromise) {
    ensurePushTokensSchemaPromise = (async () => {
      const client = await postgres.connect();

      try {
        await client.query(`
          CREATE TABLE IF NOT EXISTS user_push_tokens (
            fcm_token TEXT PRIMARY KEY,
            user_id VARCHAR(100) REFERENCES members(id) ON DELETE CASCADE,
            app_origin TEXT,
            user_agent TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            last_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
        `);

        await client.query(`
          ALTER TABLE user_push_tokens
          ADD COLUMN IF NOT EXISTS user_id VARCHAR(100) REFERENCES members(id) ON DELETE CASCADE,
          ADD COLUMN IF NOT EXISTS app_origin TEXT,
          ADD COLUMN IF NOT EXISTS user_agent TEXT,
          ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        `);

        await client.query(`
          DO $$
          DECLARE
            pk_name TEXT;
            pk_definition TEXT;
          BEGIN
            SELECT con.conname, pg_get_constraintdef(con.oid)
            INTO pk_name, pk_definition
            FROM pg_constraint con
            JOIN pg_class rel ON rel.oid = con.conrelid
            WHERE rel.relname = 'user_push_tokens'
              AND con.contype = 'p';

            IF pk_name IS NOT NULL AND pk_definition ILIKE '%(user_id)%' THEN
              EXECUTE format('ALTER TABLE user_push_tokens DROP CONSTRAINT %I', pk_name);
            END IF;

            IF NOT EXISTS (
              SELECT 1
              FROM pg_constraint con
              JOIN pg_class rel ON rel.oid = con.conrelid
              WHERE rel.relname = 'user_push_tokens'
                AND con.contype = 'p'
            ) THEN
              ALTER TABLE user_push_tokens
              ADD CONSTRAINT user_push_tokens_pkey PRIMARY KEY (fcm_token);
            END IF;
          END $$;
        `);

        await client.query(`
          CREATE INDEX IF NOT EXISTS idx_user_push_tokens_user_id
          ON user_push_tokens (user_id)
        `);

        await client.query(`
          CREATE INDEX IF NOT EXISTS idx_user_push_tokens_app_origin
          ON user_push_tokens (app_origin)
        `);

        await client.query(`
          CREATE INDEX IF NOT EXISTS idx_user_push_tokens_updated_at
          ON user_push_tokens (updated_at DESC)
        `);
      } finally {
        client.release();
      }
    })().catch((error) => {
      ensurePushTokensSchemaPromise = null;
      throw error;
    });
  }

  return ensurePushTokensSchemaPromise;
}

function tryReadJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function resolveCredentialFileCandidates(rawPath) {
  if (!rawPath || typeof rawPath !== "string") {
    return [];
  }

  const trimmedPath = rawPath.trim();
  if (!trimmedPath) {
    return [];
  }

  const candidates = [trimmedPath];

  if (!path.isAbsolute(trimmedPath)) {
    candidates.push(path.resolve(process.cwd(), trimmedPath));
  }

  return Array.from(new Set(candidates));
}

function findFirstJsonFile(dirPath) {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const match = entries.find(
      (entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json"),
    );

    return match ? path.join(dirPath, match.name) : null;
  } catch {
    return null;
  }
}

function parseFirebaseServiceAccount() {
  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (rawJson) {
    try {
      return JSON.parse(rawJson);
    } catch (error) {
      console.error("[push] FIREBASE_SERVICE_ACCOUNT_JSON inválido:", error);
    }
  }

  const explicitPaths = [
    ...resolveCredentialFileCandidates(
      process.env.FIREBASE_SERVICE_ACCOUNT_PATH,
    ),
    ...resolveCredentialFileCandidates(
      process.env.GOOGLE_APPLICATION_CREDENTIALS,
    ),
  ];

  for (const candidate of explicitPaths) {
    const parsed = tryReadJsonFile(candidate);
    if (parsed) {
      return parsed;
    }
  }

  const fallbackDirs = [
    path.resolve(process.cwd(), "credencial-firebase"),
    path.resolve(process.cwd(), "chave-secreta-firebase"),
  ];

  for (const dirPath of fallbackDirs) {
    const filePath = findFirstJsonFile(dirPath);
    if (!filePath) {
      continue;
    }

    const parsed = tryReadJsonFile(filePath);
    if (parsed) {
      return parsed;
    }
  }

  return null;
}

function getFirebaseApp() {
  if (firebaseInitAttempted) {
    return firebaseApp;
  }

  firebaseInitAttempted = true;

  try {
    if (admin.apps.length > 0) {
      firebaseApp = admin.app();
      return firebaseApp;
    }

    const serviceAccount = parseFirebaseServiceAccount();

    if (serviceAccount) {
      firebaseApp = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: process.env.FIREBASE_PROJECT_ID || serviceAccount.project_id,
      });
      return firebaseApp;
    }

    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      try {
        firebaseApp = admin.initializeApp({
          credential: admin.credential.applicationDefault(),
          projectId: process.env.FIREBASE_PROJECT_ID,
        });
        return firebaseApp;
      } catch (error) {
        console.error(
          "[push] Falha ao inicializar Firebase com GOOGLE_APPLICATION_CREDENTIALS:",
          error,
        );
      }
    }

    if (!firebaseConfigWarningShown) {
      firebaseConfigWarningShown = true;
      console.warn(
        "[push] Firebase Admin não configurado. Defina FIREBASE_SERVICE_ACCOUNT_JSON, FIREBASE_SERVICE_ACCOUNT_PATH ou GOOGLE_APPLICATION_CREDENTIALS para habilitar FCM.",
      );
    }
  } catch (error) {
    console.error("[push] Falha ao inicializar Firebase Admin:", error);
  }

  if (!firebaseCredentialWarningShown) {
    firebaseCredentialWarningShown = true;
    console.warn(
      "[push] Nenhuma credencial Firebase válida foi carregada. Em produção, não use caminho local do Windows; prefira FIREBASE_SERVICE_ACCOUNT_JSON, GOOGLE_APPLICATION_CREDENTIALS ou FIREBASE_SERVICE_ACCOUNT_PATH relativo ao servidor/container.",
    );
  }

  firebaseApp = null;
  return firebaseApp;
}

function normalizeStringMapEntries(values) {
  return Object.entries(values).reduce((accumulator, [key, value]) => {
    accumulator[key] = value == null ? "" : String(value);
    return accumulator;
  }, {});
}

function normalizeOrigin(value) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  try {
    return new URL(value).origin.toLowerCase();
  } catch {
    return null;
  }
}

function isLocalDevOrigin(origin) {
  const normalizedOrigin = normalizeOrigin(origin);
  if (!normalizedOrigin) {
    return false;
  }

  try {
    const hostname = new URL(normalizedOrigin).hostname;
    return (
      hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
    );
  } catch {
    return false;
  }
}

function getPreferredPushOrigins() {
  return Array.from(
    new Set(
      [
        process.env.APP_BASE_URL,
        process.env.FRONTEND_URL,
        process.env.PUBLIC_APP_URL,
      ]
        .map(normalizeOrigin)
        .filter(Boolean),
    ),
  );
}

function selectTokensForDelivery(tokenRows) {
  const normalizedRows = tokenRows
    .map((row) => ({
      ...row,
      appOrigin: normalizeOrigin(row.appOrigin),
    }))
    .filter((row) => typeof row.fcmToken === "string" && row.fcmToken.trim());

  if (normalizedRows.length === 0) {
    return [];
  }

  const preferredOrigins = getPreferredPushOrigins();
  if (preferredOrigins.length > 0) {
    const preferredRows = normalizedRows.filter(
      (row) => row.appOrigin && preferredOrigins.includes(row.appOrigin),
    );

    if (preferredRows.length > 0) {
      return preferredRows;
    }
  }

  const nonLocalRows = normalizedRows.filter(
    (row) => row.appOrigin && !isLocalDevOrigin(row.appOrigin),
  );

  if (nonLocalRows.length > 0) {
    return nonLocalRows;
  }

  return normalizedRows;
}

function resolveNotificationClickUrl(notification) {
  const rawUrl =
    typeof notification.url === "string" ? notification.url.trim() : "";
  if (!rawUrl) {
    return null;
  }

  if (/^https?:\/\//i.test(rawUrl)) {
    return rawUrl;
  }

  const baseUrl =
    process.env.APP_BASE_URL ||
    process.env.FRONTEND_URL ||
    process.env.PUBLIC_APP_URL;

  if (!baseUrl) {
    return null;
  }

  try {
    return new URL(rawUrl, baseUrl).toString();
  } catch {
    return null;
  }
}

async function sendPushNotifications(notifications) {
  const validNotifications = Array.isArray(notifications)
    ? notifications.filter(
        (notification) =>
          notification &&
          typeof notification.userId === "string" &&
          notification.userId.trim() &&
          typeof notification.title === "string" &&
          typeof notification.message === "string",
      )
    : [];

  if (validNotifications.length === 0) {
    return { attempted: 0, delivered: 0, invalidatedTokens: 0 };
  }

  await ensurePushTokensSchema();

  const app = getFirebaseApp();
  if (!app) {
    return {
      attempted: validNotifications.length,
      delivered: 0,
      invalidatedTokens: 0,
      skipped: true,
    };
  }

  const userIds = Array.from(
    new Set(validNotifications.map((notification) => notification.userId)),
  );

  const tokensRes = await postgres.query(
    `SELECT user_id as "userId", fcm_token as "fcmToken", app_origin as "appOrigin"
     FROM user_push_tokens
     WHERE user_id = ANY($1)`,
    [userIds],
  );

  const tokensByUserId = new Map();
  for (const row of tokensRes.rows) {
    const currentTokens = tokensByUserId.get(row.userId) || [];
    currentTokens.push(row);
    tokensByUserId.set(row.userId, currentTokens);
  }

  const messaging = admin.messaging(app);
  const invalidTokens = new Set();
  let delivered = 0;

  for (const notification of validNotifications) {
    const tokens = Array.from(
      new Set(
        selectTokensForDelivery(
          tokensByUserId.get(notification.userId) || [],
        ).map((row) => row.fcmToken),
      ),
    );

    if (tokens.length === 0) {
      continue;
    }

    const clickUrl = resolveNotificationClickUrl(notification);
    const message = {
      tokens,
      notification: {
        title: notification.pushTitle || notification.title,
        body: notification.pushBody || notification.message,
      },
      data: normalizeStringMapEntries({
        notificationId: notification.id || "",
        notificationType: notification.type || "",
        referenceId: notification.referenceId || "",
        url: notification.url || "/",
      }),
      webpush: {
        notification: {
          icon: "/icon-192.png",
          badge: "/icon-192.png",
          tag: `pauta:${notification.type || "notification"}:${notification.referenceId || notification.id || notification.userId}`,
        },
        headers: {
          Urgency: "high",
        },
      },
    };

    if (clickUrl) {
      message.webpush.fcmOptions = {
        link: clickUrl,
      };
    }

    try {
      const response = await messaging.sendEachForMulticast(message);
      delivered += response.successCount;

      response.responses.forEach((item, index) => {
        if (item.success) {
          return;
        }

        const code = item.error?.code;
        if (INVALID_PUSH_TOKEN_CODES.has(code)) {
          invalidTokens.add(tokens[index]);
        }

        console.warn("[push] Falha ao enviar push:", {
          userId: notification.userId,
          token: tokens[index],
          code,
          message: item.error?.message || null,
        });
      });
    } catch (error) {
      console.error("[push] Erro ao enviar push multicast:", {
        userId: notification.userId,
        message: error?.message || String(error),
      });
    }
  }

  if (invalidTokens.size > 0) {
    await postgres.query(
      "DELETE FROM user_push_tokens WHERE fcm_token = ANY($1)",
      [Array.from(invalidTokens)],
    );
  }

  return {
    attempted: validNotifications.length,
    delivered,
    invalidatedTokens: invalidTokens.size,
  };
}

module.exports = {
  ensurePushTokensSchema,
  sendPushNotifications,
};
