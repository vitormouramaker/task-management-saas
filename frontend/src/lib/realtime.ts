import axios from "axios";
import { getApiOrigin } from "./api";

export type RealtimeEvent =
  | {
      type: "connection.ready";
      payload?: { userId?: string | null };
      timestamp?: string;
    }
  | {
      type: "seed.refetch";
      payload?: { reason?: string | null };
      timestamp?: string;
    }
  | {
      type: "notification.refetch";
      payload?: { reason?: string | null };
      timestamp?: string;
    }
  | {
      type: "notification.read";
      payload: { id: string };
      timestamp?: string;
    }
  | {
      type: "notification.read_all";
      payload?: Record<string, never>;
      timestamp?: string;
    }
  | {
      type: "email.upsert";
      payload: { email: unknown };
      timestamp?: string;
    }
  | {
      type: "email.read";
      payload: { id: string };
      timestamp?: string;
    }
  | {
      type: "task.created";
      payload: { task: unknown; activities?: unknown[] };
      timestamp?: string;
    }
  | {
      type: "task.updated";
      payload: { task: unknown; activities?: unknown[] };
      timestamp?: string;
    }
  | {
      type: "comment.created";
      payload: { taskId: string; comment: unknown; activities?: unknown[] };
      timestamp?: string;
    }
  | {
      type: "comment.updated";
      payload: { taskId: string; comment: unknown; activities?: unknown[] };
      timestamp?: string;
    }
  | {
      type: "support.updated";
      payload: { conversation: unknown; message?: unknown };
      timestamp?: string;
    }
  | {
      type: "presence.updated";
      payload: { workspaceId: string; userIds: string[] };
      timestamp?: string;
    };

type RealtimeListener = (event: RealtimeEvent) => void;

// function maskToken(token: string | null | undefined) {
//   if (!token) {
//     return "no-token";
//   }

//   if (token.length <= 12) {
//     return `${token.slice(0, 4)}...${token.slice(-2)}`;
//   }

//   return `${token.slice(0, 8)}...${token.slice(-6)}`;
// }

/**
 * O token de login não vai mais no endereço (fica em log e histórico). A página
 * troca o token por um ticket de uso único, válido por 60 segundos.
 */
async function fetchRealtimeTicket(token: string) {
  try {
    const response = await axios.post(
      "/api/realtime/ticket",
      {},
      { headers: { Authorization: `Bearer ${token}` } },
    );
    return (response.data as { ticket?: string }).ticket || null;
  } catch (error) {
    console.error("[realtime/front] falha ao obter ticket", error);
    return null;
  }
}

function toRealtimeUrlWithSubscriptions(ticket: string, workspaceIds: string[]) {
  const apiOrigin = getApiOrigin();
  const realtimeUrl = new URL(`${apiOrigin}/realtime`);
  realtimeUrl.searchParams.set("ticket", ticket);

  for (const workspaceId of workspaceIds) {
    realtimeUrl.searchParams.append("workspaceIds", workspaceId);
  }

  return realtimeUrl.toString();
}

class RealtimeClient {
  private eventSource: EventSource | null = null;
  private reconnectTimer: number | null = null;
  private reconnectAttempt = 0;
  private token: string | null = null;
  private destroyed = false;
  private listeners = new Set<RealtimeListener>();
  private workspaceIds: string[] = [];
  private connectionGeneration = 0;

  connect(token: string) {
    if (!token) {
      console.warn("[realtime/front] connect skipped: missing token");
      return;
    }

    this.destroyed = false;
    this.token = token;

    if (
      this.eventSource &&
      (this.eventSource.readyState === EventSource.OPEN ||
        this.eventSource.readyState === EventSource.CONNECTING)
    ) {
      console.log("[realtime/front] connect skipped: sse already active", {
        readyState: this.eventSource.readyState,
      });
      return;
    }

    this.clearReconnectTimer();
    this.connectionGeneration += 1;
    void this.openConnection(token, this.connectionGeneration);
  }

  private async openConnection(token: string, generation: number) {
    const ticket = await fetchRealtimeTicket(token);

    // Outra conexão começou (ou o app saiu) enquanto o ticket era buscado.
    if (this.destroyed || generation !== this.connectionGeneration) {
      return;
    }

    if (!ticket) {
      this.scheduleReconnect();
      return;
    }

    const url = toRealtimeUrlWithSubscriptions(ticket, this.workspaceIds);
    console.log("[realtime/front] opening sse", {
      apiOrigin: getApiOrigin(),
      workspaceCount: this.workspaceIds.length,
    });
    const eventSource = new EventSource(url);
    this.eventSource = eventSource;

    eventSource.addEventListener("open", () => {
      console.log("[realtime/front] sse open");
      this.reconnectAttempt = 0;
    });

    eventSource.addEventListener("message", (message) => {
      try {
        const parsed = JSON.parse(message.data) as RealtimeEvent;
        console.log("[realtime/front] event received", {
          type: parsed.type,
          timestamp: parsed.timestamp,
        });
        this.listeners.forEach((listener) => listener(parsed));
      } catch (error) {
        console.error("Erro ao processar evento realtime:", error);
      }
    });

    eventSource.addEventListener("error", (event) => {
      console.error("[realtime/front] sse error", {
        readyState: eventSource.readyState,
        eventType: event.type,
        destroyed: this.destroyed,
        reconnectAttempt: this.reconnectAttempt,
      });

      if (eventSource.readyState !== EventSource.CLOSED) {
        return;
      }

      if (this.eventSource === eventSource) {
        this.eventSource = null;
      }

      if (!this.destroyed && this.token) {
        this.scheduleReconnect();
      }
    });
  }

  disconnect() {
    console.log("[realtime/front] disconnect requested");
    this.destroyed = true;
    this.connectionGeneration += 1;
    this.token = null;
    this.clearReconnectTimer();

    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }

  subscribe(listener: RealtimeListener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  setWorkspaceSubscriptions(workspaceIds: string[]) {
    const nextWorkspaceIds = [...new Set(workspaceIds.filter(Boolean))].sort();
    if (
      nextWorkspaceIds.length === this.workspaceIds.length &&
      nextWorkspaceIds.every((workspaceId, index) => workspaceId === this.workspaceIds[index])
    ) {
      console.log("[realtime/front] subscriptions unchanged", {
        workspaceIds: nextWorkspaceIds,
      });
      return;
    }
    this.workspaceIds = nextWorkspaceIds;
    console.log("[realtime/front] subscriptions updated", {
      workspaceIds: this.workspaceIds,
    });

    if (!this.token || this.destroyed) {
      return;
    }

    this.reconnect();
  }

  private scheduleReconnect() {
    this.clearReconnectTimer();
    const delay = Math.min(1000 * 2 ** this.reconnectAttempt, 10000);
    this.reconnectAttempt += 1;
    console.warn("[realtime/front] scheduling reconnect", {
      delay,
      reconnectAttempt: this.reconnectAttempt,
    });
    this.reconnectTimer = window.setTimeout(() => {
      if (this.token) {
        this.connect(this.token);
      }
    }, delay);
  }

  private reconnect() {
    if (!this.token) {
      return;
    }

    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    this.clearReconnectTimer();
    this.connect(this.token);
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}

export const realtimeClient = new RealtimeClient();
