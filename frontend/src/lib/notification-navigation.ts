import type { WorkspaceGraph } from "../types/tasks";

export interface NotificationNavigationTarget {
  workspaceId: string | null;
  listId: string | null;
  taskId: string | null;
  key: string;
}

interface NotificationNavigationHandlers {
  graph: WorkspaceGraph;
  setActiveWorkspace: (workspaceId: string) => void;
  setActiveList: (listId: string) => void;
  openTaskDetails: (taskId: string) => void;
}

function getNavigationBaseUrl() {
  if (typeof window !== "undefined") {
    return window.location.origin;
  }

  return "http://localhost";
}

export function getNotificationActionLabel(url?: string | null) {
  const target = parseNotificationNavigationUrl(url);

  if (target?.taskId) {
    return "Abrir card";
  }

  if (target?.listId) {
    return "Abrir projeto";
  }

  if (target?.workspaceId) {
    return "Abrir workspace";
  }

  return "Ver detalhes";
}

export function parseNotificationNavigationUrl(
  value: string | URL | null | undefined,
): NotificationNavigationTarget | null {
  if (!value) {
    return null;
  }

  const url =
    value instanceof URL ? value : new URL(value, getNavigationBaseUrl());

  const workspaceId = url.searchParams.get("workspaceId");
  const listId = url.searchParams.get("listId");
  const taskId = url.searchParams.get("taskId");

  if (!workspaceId && !listId && !taskId) {
    return null;
  }

  return {
    workspaceId,
    listId,
    taskId,
    key: `${workspaceId ?? ""}|${listId ?? ""}|${taskId ?? ""}`,
  };
}

export function stripNotificationNavigationParams(url: URL) {
  url.searchParams.delete("workspaceId");
  url.searchParams.delete("listId");
  url.searchParams.delete("taskId");

  const nextSearch = url.searchParams.toString();
  return `${url.pathname}${nextSearch ? `?${nextSearch}` : ""}${url.hash}`;
}

export function navigateFromNotificationTarget(
  target: NotificationNavigationTarget,
  handlers: NotificationNavigationHandlers,
) {
  const { graph, setActiveWorkspace, setActiveList, openTaskDetails } =
    handlers;

  if (target.taskId) {
    const task = graph.tasks[target.taskId];
    if (task) {
      setActiveList(task.listId);
      window.setTimeout(() => {
        openTaskDetails(target.taskId!);
      }, 100);
      return true;
    }
  }

  if (target.listId && graph.lists[target.listId]) {
    setActiveList(target.listId);
    return true;
  }

  if (target.workspaceId && graph.workspaces[target.workspaceId]) {
    setActiveWorkspace(target.workspaceId);
    return true;
  }

  return false;
}

export function navigateFromNotificationUrl(
  value: string | null | undefined,
  handlers: NotificationNavigationHandlers,
) {
  const target = parseNotificationNavigationUrl(value);
  if (!target) {
    return false;
  }

  return navigateFromNotificationTarget(target, handlers);
}
