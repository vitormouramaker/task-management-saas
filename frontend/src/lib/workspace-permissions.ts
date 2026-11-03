import type {
  EntityId,
  Task,
  TaskList,
  Workspace,
  WorkspaceGraph,
} from "../types/tasks";

export type WorkspacePermissionCapability =
  | "manage"
  | "edit"
  | "comment"
  | "view"
  | "none";

const PERMISSION_RANK: Record<WorkspacePermissionCapability, number> = {
  none: -1,
  view: 0,
  comment: 1,
  edit: 2,
  manage: 3,
};

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeWorkspacePermissionLevel(
  value?: string | null,
): WorkspacePermissionCapability {
  if (!value) return "none";

  const normalized = normalizeText(value);

  if (
    normalized.includes("edicao total") ||
    (normalized.startsWith("edi") && normalized.includes("total")) ||
    normalized.includes("gerenciar")
  ) {
    return "manage";
  }

  if (normalized.startsWith("editar") || normalized === "edit") {
    return "edit";
  }

  if (normalized.includes("coment")) {
    return "comment";
  }

  if (normalized.includes("apenas exib") || normalized.includes("visualiz")) {
    return "view";
  }

  return "none";
}

export function getWorkspacePermissionLabel(
  capability: WorkspacePermissionCapability,
) {
  switch (capability) {
    case "manage":
      return "Edição total";
    case "edit":
      return "Editar";
    case "comment":
      return "Comentário";
    case "view":
      return "Apenas exibição";
    default:
      return "Sem acesso";
  }
}

export function hasWorkspacePermission(
  current: WorkspacePermissionCapability,
  required: Exclude<WorkspacePermissionCapability, "none">,
) {
  return PERMISSION_RANK[current] >= PERMISSION_RANK[required];
}

export function canMoveTask(
  task: Pick<Task, "assigneeIds"> | null | undefined,
  permission: WorkspacePermissionCapability,
  currentUserId?: EntityId | null,
  isAdmin = false,
) {
  if (!task) return false;
  if (isAdmin) return true;
  if (permission === "manage") return true;

  return Boolean(currentUserId && task.assigneeIds.includes(currentUserId));
}

export function resolveWorkspacePermission(
  workspace?: Workspace | null,
): WorkspacePermissionCapability {
  if (!workspace) return "none";

  // currentPermissionLevel é o nível explícito do usuário atual devolvido pela API.
  // Se não estiver presente (backend não preencheu), cai no defaultPermissionLevel
  // que representa o nível concedido a todos os membros compartilhados.
  const explicitPermission = normalizeWorkspacePermissionLevel(
    workspace.currentPermissionLevel ?? workspace.defaultPermissionLevel,
  );

  if (explicitPermission !== "none") {
    return explicitPermission;
  }

  if (workspace.visibility === "public") {
    return "view";
  }

  return "none";
}

function resolveListPermission(list?: TaskList | null) {
  if (!list) return "none";

  const explicitPermission = normalizeWorkspacePermissionLevel(
    list.currentPermissionLevel,
  );

  if (explicitPermission !== "none") {
    return explicitPermission;
  }

  if (list.visibility === "public") {
    return "view";
  }

  return "none";
}

function resolveTaskPermission(task?: Task | null) {
  if (!task) return "none";

  const explicitPermission = normalizeWorkspacePermissionLevel(
    task.currentPermissionLevel,
  );

  if (explicitPermission !== "none") {
    return explicitPermission;
  }

  return "none";
}

export function getWorkspaceByListId(
  graph: WorkspaceGraph,
  listId?: EntityId | null,
) {
  if (!listId) return null;

  const list = graph.lists[listId];
  if (!list) return null;

  const folder = graph.folders[list.folderId];
  if (!folder) return null;

  const space = graph.spaces[folder.spaceId];
  if (!space) return null;

  return graph.workspaces[space.workspaceId] ?? null;
}

export function getWorkspaceByTaskId(
  graph: WorkspaceGraph,
  taskId?: EntityId | null,
) {
  if (!taskId) return null;
  const task = graph.tasks[taskId];
  if (!task) return null;

  if (task.workspaceId && graph.workspaces[task.workspaceId]) {
    return graph.workspaces[task.workspaceId] ?? null;
  }

  return getWorkspaceByListId(graph, task.listId);
}

export function getWorkspacePermissionForWorkspace(
  graph: WorkspaceGraph,
  workspaceId?: EntityId | null,
) {
  return resolveWorkspacePermission(
    workspaceId ? graph.workspaces[workspaceId] : null,
  );
}

export function getWorkspacePermissionForList(
  graph: WorkspaceGraph,
  listId?: EntityId | null,
) {
  if (!listId) return "none";

  const list = graph.lists[listId];
  const listPermission = resolveListPermission(list);
  if (listPermission !== "none") {
    return listPermission;
  }

  return resolveWorkspacePermission(getWorkspaceByListId(graph, listId));
}

export function getWorkspacePermissionForTask(
  graph: WorkspaceGraph,
  taskId?: EntityId | null,
) {
  if (!taskId) return "none";

  const task = graph.tasks[taskId];
  const taskPermission = resolveTaskPermission(task);
  if (taskPermission !== "none") {
    return taskPermission;
  }

  const listPermission = getWorkspacePermissionForList(graph, task?.listId);
  if (listPermission !== "none") {
    return listPermission;
  }

  return resolveWorkspacePermission(getWorkspaceByTaskId(graph, taskId));
}

export function getWorkspacePermissionForSelection(
  graph: WorkspaceGraph,
  workspaceId?: EntityId | null,
  listId?: EntityId | null,
) {
  if (listId) {
    return getWorkspacePermissionForList(graph, listId);
  }

  return getWorkspacePermissionForWorkspace(graph, workspaceId);
}
