import { useMemo, useState } from "react";
import { Lock, User } from "lucide-react";
import { getStatusesForList } from "../../../lib/status-columns";
import {
  getWorkspacePermissionForList,
  hasWorkspacePermission,
} from "../../../lib/workspace-permissions";
import { cn } from "../../../lib/utils";
import { useAuthStore } from "../../../store/use-auth-store";
import { useTaskStore } from "../../../store/use-task-store";
import { usePlanViews } from "../hooks/use-plan-views";
import { isDoneStatusName } from "../lib/task-view-helpers";
import { TaskCalendar } from "./task-calendar";

const FALLBACK_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16"];

/** Calendário geral: prazos de todos os projetos que a pessoa acessa. */
export function CalendarPage() {
  const graph = useTaskStore((state) => state.graph);
  const currentUser = useTaskStore((state) => state.currentUser);
  const authUserId = useAuthStore((state) => state.user?.id);
  const { isAllowed, showLocked, lockedModal } = usePlanViews();
  const [workspaceId, setWorkspaceId] = useState("");
  const [onlyMine, setOnlyMine] = useState(false);
  const userId = authUserId ?? currentUser;

  const listInfo = useMemo(() => {
    const info = new Map<string, { name: string; workspaceId: string; workspaceName: string; color: string; canEdit: boolean }>();
    Object.values(graph.lists).forEach((list, index) => {
      const folder = graph.folders[list.folderId];
      const space = folder ? graph.spaces[folder.spaceId] : undefined;
      const workspace = space ? graph.workspaces[space.workspaceId] : undefined;
      if (!workspace) return;
      info.set(list.id, {
        name: list.name,
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        color: list.color || FALLBACK_COLORS[index % FALLBACK_COLORS.length],
        canEdit: hasWorkspacePermission(getWorkspacePermissionForList(graph, list.id), "edit"),
      });
    });
    return info;
  }, [graph]);

  const tasks = useMemo(
    () =>
      Object.values(graph.tasks).filter((task) => {
        if (task.parentTaskId) return false;
        const info = listInfo.get(task.listId);
        if (!info) return false;
        if (workspaceId && info.workspaceId !== workspaceId) return false;
        if (onlyMine && !task.assigneeIds.includes(userId)) return false;
        return true;
      }),
    [graph.tasks, listInfo, workspaceId, onlyMine, userId],
  );

  const doneStatusIds = useMemo(() => {
    const ids = new Set<string>();
    graph.statusDefinitions.forEach((status) => {
      if (isDoneStatusName(status.name)) ids.add(status.id);
    });
    Object.values(graph.lists).forEach((list) =>
      getStatusesForList(graph.statusDefinitions, list.id).forEach((status) => {
        if (isDoneStatusName(status.name)) ids.add(status.id);
      }),
    );
    return ids;
  }, [graph.statusDefinitions, graph.lists]);

  const muted = "text-(--ui-texto-secundario)";
  const titleColor = "text-(--ui-texto-principal)";
  const border = "border-(--ui-borda)";
  const workspaces = Object.values(graph.workspaces).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  return (
    <div className="flex h-full w-full min-h-0 flex-col animate-in fade-in duration-300">
      <div className="flex min-h-0 flex-1 flex-col px-4 py-4 sm:px-8 sm:py-6">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className={cn("text-2xl font-black tracking-tight", titleColor)}>Calendário</h1>
            <p className={cn("mt-1 text-sm font-medium", muted)}>Prazos de todos os projetos que você acessa.</p>
          </div>
          {isAllowed("calendar") && (
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={workspaceId}
                onChange={(event) => setWorkspaceId(event.target.value)}
                className={cn(
                  "h-9 rounded-lg border px-2 text-xs font-bold",
                  "border-(--ui-borda) bg-(--ui-superficie-suave) text-(--ui-texto-forte)",
                )}
              >
                <option value="">Todos os espaços de trabalho</option>
                {workspaces.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>
                    {workspace.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setOnlyMine((value) => !value)}
                className={cn(
                  "inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-bold cursor-pointer",
                  onlyMine ? "border-blue-500 bg-blue-500/10 text-blue-600" : cn(border, muted),
                )}
              >
                <User className="h-3.5 w-3.5" />
                Meus cards
              </button>
            </div>
          )}
        </div>

        {isAllowed("calendar") ? (
          <div className="min-h-0 flex-1">
            <TaskCalendar
              tasks={tasks}
              doneStatusIds={doneStatusIds}
              canEditTask={(task) => Boolean(listInfo.get(task.listId)?.canEdit)}
              subtitle={(task) => {
                const info = listInfo.get(task.listId);
                return info ? `${info.workspaceName} › ${info.name}` : null;
              }}
              accent={(task) => listInfo.get(task.listId)?.color}
            />
          </div>
        ) : (
          <div className={cn("grid flex-1 place-items-center rounded-2xl border p-8 text-center", border)}>
            <div>
              <Lock className="mx-auto h-8 w-8 text-blue-600" />
              <p className={cn("mt-3 text-base font-bold", titleColor)}>Calendário disponível a partir do plano Profissional</p>
              <button
                type="button"
                onClick={() => showLocked("calendar")}
                className="mt-4 inline-flex h-10 items-center rounded-xl bg-blue-600 px-5 text-sm font-black text-white hover:bg-blue-700 cursor-pointer"
              >
                Saiba mais
              </button>
            </div>
          </div>
        )}
      </div>
      {lockedModal}
    </div>
  );
}
