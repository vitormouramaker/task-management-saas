import { useDeferredValue, useMemo } from "react";
import { getStatusesForList } from "../../../lib/status-columns";
import { taskMatchesFilters } from "../../../lib/task-filters";
import {
  getWorkspacePermissionForList,
  hasWorkspacePermission,
} from "../../../lib/workspace-permissions";
import { useAuthStore } from "../../../store/use-auth-store";
import { useTaskStore } from "../../../store/use-task-store";
import { SUBTASK_STATUS_ID, isDoneStatusName, sortTasks } from "../lib/task-view-helpers";

/** Tarefas do projeto aberto já filtradas e ordenadas, para as visões. */
export function useListViewData({ includeSubtasks = false } = {}) {
  const graph = useTaskStore((state) => state.graph);
  const selection = useTaskStore((state) => state.selection);
  const filters = useTaskStore((state) => state.filters);
  const currentUser = useTaskStore((state) => state.currentUser);
  const taskSortOrders = useTaskStore((state) => state.taskSortOrders);
  const authUserId = useAuthStore((state) => state.user?.id);
  const permission = useTaskStore((state) =>
    getWorkspacePermissionForList(state.graph, state.selection.listId),
  );
  const deferredSearch = useDeferredValue(filters.search);

  const activeList = selection.listId ? graph.lists[selection.listId] : undefined;
  const userId = authUserId ?? currentUser;

  const tasks = useMemo(() => {
    if (!activeList) return [];
    const visible = activeList.taskIds
      .map((taskId) => graph.tasks[taskId])
      .filter(Boolean)
      .filter((task) => includeSubtasks || !task.parentTaskId)
      .filter((task) =>
        taskMatchesFilters(task, graph, { ...filters, search: deferredSearch }, userId),
      );
    return sortTasks(visible, taskSortOrders);
  }, [activeList, graph, filters, deferredSearch, userId, includeSubtasks, taskSortOrders]);

  const statuses = useMemo(
    () =>
      activeList
        ? getStatusesForList(graph.statusDefinitions, activeList.id).filter(
            (status) => status.id !== SUBTASK_STATUS_ID,
          )
        : [],
    [activeList, graph.statusDefinitions],
  );

  const doneStatusIds = useMemo(
    () => new Set(statuses.filter((status) => isDoneStatusName(status.name)).map((status) => status.id)),
    [statuses],
  );

  return {
    graph,
    activeList,
    tasks,
    statuses,
    doneStatusIds,
    canEditTasks: hasWorkspacePermission(permission, "edit"),
  };
}
