const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { postgres } = require("../server/connect");
const { JWT_SECRET } = require("../config/jwt");
const { verifyToken } = require("../middlewares/auth.middleware");
const { signStorageUrlsDeep } = require("./storage-url.service");

const clients = new Set();
const KEEPALIVE_INTERVAL_MS = 30000;
const MAX_WORKSPACE_SUBSCRIPTIONS = 500;

function parseWorkspaceIds(value) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => parseWorkspaceIds(item));
  }

  if (typeof value !== "string") {
    return [];
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

// Só aceita inscrição em workspaces ativos da empresa do token. Sem isso o
// cliente poderia pedir ids de workspaces de outra empresa e receber os eventos.
async function resolveAllowedWorkspaceIds(user, requestedWorkspaceIds) {
  const uniqueIds = [...new Set(requestedWorkspaceIds)].slice(
    0,
    MAX_WORKSPACE_SUBSCRIPTIONS,
  );

  if (!user?.organizationId || uniqueIds.length === 0) {
    return new Set();
  }

  const result = await postgres.query(
    `
      SELECT id
      FROM workspaces
      WHERE id = ANY($1::text[])
        AND organization_id = $2
        AND deleted_at IS NULL
    `,
    [uniqueIds, user.organizationId],
  );

  return new Set(result.rows.map((row) => row.id));
}

function writeEvent(client, message) {
  if (!client?.res || client.res.writableEnded || client.res.destroyed) {
    return false;
  }

  try {
    client.res.write(`data: ${JSON.stringify(message)}\n\n`);
    return true;
  } catch (error) {
    console.error("[realtime/back] failed to send SSE event", {
      userId: client.userId || null,
      message: error?.message || String(error),
    });
    return false;
  }
}

function getExcludedUserIds(options) {
  return Array.from(
    new Set(
      [
        ...(Array.isArray(options.excludeUserIds)
          ? options.excludeUserIds
          : []),
        options.actorId,
      ].filter(Boolean),
    ),
  );
}

function getEventWorkspaceIds(options) {
  return [
    options.workspaceId,
    ...(Array.isArray(options.workspaceIds) ? options.workspaceIds : []),
  ].filter(Boolean);
}

function shouldReceiveEvent(client, options) {
  const userIds = Array.isArray(options.userIds)
    ? options.userIds.filter(Boolean)
    : [];

  if (!client.userId || getExcludedUserIds(options).includes(client.userId)) {
    return false;
  }

  if (userIds.length > 0) {
    return userIds.includes(client.userId);
  }

  const eventWorkspaceIds = getEventWorkspaceIds(options);
  if (eventWorkspaceIds.length > 0) {
    return eventWorkspaceIds.some((workspaceId) =>
      client.workspaceIds.has(workspaceId),
    );
  }

  if (options.organizationId) {
    return client.organizationId === options.organizationId;
  }

  // Evento sem destinatário, workspace ou empresa: não é enviado para ninguém.
  return false;
}

function cleanupClient(client) {
  if (!client || !clients.has(client)) {
    return;
  }

  const workspaceIds =
    client.workspaceIds instanceof Set ? Array.from(client.workspaceIds) : [];

  if (client.keepalive) {
    clearInterval(client.keepalive);
  }

  clients.delete(client);
  workspaceIds.forEach(publishPresenceForWorkspace);

  console.warn("[realtime/back] SSE connection closed", {
    userId: client.userId || null,
    workspaceIds,
    totalClients: clients.size,
  });
}

function clonePayload(payload) {
  try {
    return JSON.parse(JSON.stringify(payload || {}));
  } catch {
    return {};
  }
}

function publishRealtimeEvent(options) {
  const message = {
    type: options.type,
    payload: signStorageUrlsDeep(clonePayload(options.payload)),
    timestamp: new Date().toISOString(),
  };

  const hasScope =
    (Array.isArray(options.userIds) && options.userIds.some(Boolean)) ||
    getEventWorkspaceIds(options).length > 0 ||
    Boolean(options.organizationId);

  if (!hasScope) {
    console.warn("[realtime/back] event without scope was not delivered", {
      type: options.type,
    });
    return;
  }

  let recipientCount = 0;
  clients.forEach((client) => {
    if (!shouldReceiveEvent(client, options)) {
      return;
    }

    if (writeEvent(client, message)) {
      recipientCount += 1;
      return;
    }

    cleanupClient(client);
  });

  console.log("[realtime/back] publish", {
    type: options.type,
    actorId: options.actorId || null,
    organizationId: options.organizationId || null,
    workspaceId: options.workspaceId || null,
    workspaceIds: options.workspaceIds || [],
    userIds: options.userIds || [],
    excludeUserIds: getExcludedUserIds(options),
    recipientCount,
  });
}

function getWorkspaceOnlineUserIds(workspaceId) {
  const userIds = new Set();

  clients.forEach((client) => {
    if (
      client?.userId &&
      client.workspaceIds instanceof Set &&
      client.workspaceIds.has(workspaceId)
    ) {
      userIds.add(client.userId);
    }
  });

  return Array.from(userIds);
}

function publishPresenceForWorkspace(workspaceId) {
  if (!workspaceId) {
    return;
  }

  publishRealtimeEvent({
    type: "presence.updated",
    workspaceId,
    payload: {
      workspaceId,
      userIds: getWorkspaceOnlineUserIds(workspaceId),
    },
  });
}

// O navegador não manda cabeçalho na conexão de tempo real (EventSource), e
// token de login no endereço vaza em log/histórico. Então a página pede um
// ticket curto (60s, uso único) e usa só ele no endereço.
const TICKET_TTL_MS = 60 * 1000;
const tickets = new Map();

function purgeExpiredTickets() {
  const now = Date.now();
  tickets.forEach((value, key) => {
    if (value.expiresAt <= now) {
      tickets.delete(key);
    }
  });
}

function createRealtimeTicket(user) {
  purgeExpiredTickets();
  const ticket = crypto.randomBytes(32).toString("hex");
  tickets.set(ticket, { user, expiresAt: Date.now() + TICKET_TTL_MS });
  return { ticket, expiresInSeconds: TICKET_TTL_MS / 1000 };
}

function consumeRealtimeTicket(value) {
  const key = String(value || "").trim();
  const entry = key ? tickets.get(key) : null;
  if (!entry) {
    return null;
  }

  tickets.delete(key);
  return entry.expiresAt > Date.now() ? entry.user : null;
}

function extractToken(req) {
  const authHeader = req.headers.authorization || "";
  if (authHeader.startsWith("Bearer ")) {
    return authHeader.slice("Bearer ".length).trim();
  }

  return null;
}

function initRealtimeServer(app) {
  app.post("/api/realtime/ticket", verifyToken, (req, res) => {
    res.json(createRealtimeTicket(req.user));
  });

  app.get("/realtime", async (req, res) => {
    const token = extractToken(req);
    const ticketUser = token ? null : consumeRealtimeTicket(req.query.ticket);

    console.log("[realtime/back] SSE connection attempt", {
      path: req.path,
      origin: req.headers.origin || null,
      hasToken: Boolean(token),
      hasTicket: Boolean(ticketUser),
    });

    if (!token && !ticketUser) {
      res.status(401).json({ message: "missing ticket" });
      return;
    }

    let user = ticketUser;
    if (token) {
      try {
        user = jwt.verify(token, JWT_SECRET);
      } catch (error) {
        console.warn("[realtime/back] SSE connection rejected", {
          message: error?.message || String(error),
        });
        res.status(403).json({ message: "invalid token" });
        return;
      }
    }

    let workspaceIds;
    try {
      workspaceIds = await resolveAllowedWorkspaceIds(
        user,
        parseWorkspaceIds(req.query.workspaceIds),
      );
    } catch (error) {
      console.error("[realtime/back] failed to resolve subscriptions", {
        userId: user.id,
        message: error?.message || String(error),
      });
      res.status(500).json({ message: "realtime unavailable" });
      return;
    }

    if (req.destroyed) {
      return;
    }

    res.status(200);
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    const client = {
      res,
      userId: user.id,
      organizationId: user.organizationId || null,
      workspaceIds,
      keepalive: null,
    };

    client.keepalive = setInterval(() => {
      if (!res.writableEnded && !res.destroyed) {
        res.write(": keepalive\n\n");
        return;
      }

      cleanupClient(client);
    }, KEEPALIVE_INTERVAL_MS);

    clients.add(client);

    console.log("[realtime/back] SSE connection accepted", {
      userId: user.id,
      organizationId: client.organizationId,
      workspaceIds: Array.from(workspaceIds),
      totalClients: clients.size,
    });

    writeEvent(client, {
      type: "connection.ready",
      payload: {
        userId: user.id,
        workspaceIds: Array.from(workspaceIds),
        transport: "sse",
      },
      timestamp: new Date().toISOString(),
    });

    Array.from(workspaceIds).forEach(publishPresenceForWorkspace);

    req.on("close", () => {
      cleanupClient(client);
    });

    req.on("error", (error) => {
      console.error("[realtime/back] SSE request error", {
        userId: client.userId || null,
        message: error?.message || String(error),
      });
      cleanupClient(client);
    });
  });

  console.log("[realtime/back] SSE endpoint initialized", {
    path: "/realtime",
  });
}

module.exports = {
  initRealtimeServer,
  publishRealtimeEvent,
  publishPresenceForWorkspace,
};
