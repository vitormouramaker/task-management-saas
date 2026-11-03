import { useDeferredValue, useState } from "react";

import { taskMatchesFilters } from "../../../lib/task-filters";
import { useAuthStore } from "../../../store/use-auth-store";
import { useTaskStore } from "../../../store/use-task-store";
import {
  getWorkspacePermissionForList,
  hasWorkspacePermission,
} from "../../../lib/workspace-permissions";
import { TaskCreateModal } from "./task-create-modal";
import { TaskCollectionKanban } from "./task-collection-kanban";

export function KanbanBoard() {
  const graph = useTaskStore((state) => state.graph);
  const selection = useTaskStore((state) => state.selection);
  const filters = useTaskStore((state) => state.filters);
  const currentUser = useTaskStore((state) => state.currentUser);
  const authUser = useAuthStore((state) => state.user);
  const authUserId = authUser?.id;
  const isAdm = authUser?.organization?.role === "owner" ||
    authUser?.organization?.role === "admin";
  const permission = useTaskStore((state) =>
    getWorkspacePermissionForList(state.graph, state.selection.listId),
  );
  const canEditTasks = hasWorkspacePermission(permission, "edit");

  const deferredSearch = useDeferredValue(filters.search);
  const [isTaskCreateModalOpen, setIsTaskCreateModalOpen] = useState(false);
  const [createTaskStatusId, setCreateTaskStatusId] = useState<
    string | undefined
  >(undefined);

  const activeList = selection.listId
    ? graph.lists[selection.listId]
    : undefined;
  const tasks = activeList
    ? activeList.taskIds.map((taskId) => graph.tasks[taskId]).filter(Boolean)
    : [];
  const currentUserId = authUserId ?? currentUser;
  const visibleTasks = tasks.filter((task) =>
    taskMatchesFilters(
      task,
      graph,
      { ...filters, search: deferredSearch },
      currentUserId,
    ),
  );

  return (
    <>
      <TaskCollectionKanban
        tasks={visibleTasks}
        canEditTasks={canEditTasks}
        isAdm={isAdm}
        onAddTask={(statusId) => {
          setCreateTaskStatusId(statusId);
          setIsTaskCreateModalOpen(true);
        }}
      />

      <TaskCreateModal
        isOpen={isTaskCreateModalOpen}
        onClose={() => setIsTaskCreateModalOpen(false)}
        defaultStatusId={createTaskStatusId}
      />
    </>
  );
}
