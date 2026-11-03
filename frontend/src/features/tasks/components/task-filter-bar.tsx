import { useEffect, useMemo } from "react";
import { SlidersHorizontal } from "lucide-react";

import { Button } from "../../../components/ui/button";
import {
  getCustomFieldFilterOptions,
  getWorkspaceCustomFields,
  getWorkspaceIdFromList,
} from "../../../lib/task-filters";
import { getTaskStatusLabel } from "../../../lib/task-status-label";
import { getStatusesForList } from "../../../lib/status-columns";
import { cn } from "../../../lib/utils";
import { useTaskStore } from "../../../store/use-task-store";
import { useThemeStore } from "../../../store/use-theme-store";
import type { TaskPriority } from "../../../types/tasks";

interface TaskFilterBarProps {
  totalVisible: number;
}

const priorityLabels: Record<TaskPriority, string> = {
  urgent: "Urgente",
  high: "Alta",
  medium: "Media",
  low: "Baixa",
};

export function TaskFilterBar({ totalVisible }: TaskFilterBarProps) {
  const graph = useTaskStore((state) => state.graph);
  const selection = useTaskStore((state) => state.selection);
  const statusDefinitions = useTaskStore(
    (state) => state.graph.statusDefinitions,
  );
  const filters = useTaskStore((state) => state.filters);
  const setStatusFilter = useTaskStore((state) => state.setStatusFilter);
  const setPriorityFilter = useTaskStore((state) => state.setPriorityFilter);
  const setCustomFieldFilter = useTaskStore(
    (state) => state.setCustomFieldFilter,
  );
  const setCustomFieldValueFilter = useTaskStore(
    (state) => state.setCustomFieldValueFilter,
  );
  const clearFilters = useTaskStore((state) => state.clearFilters);
  const isDarkMode = useThemeStore((state) => state.mode === "dark");

  const priorities: TaskPriority[] = ["urgent", "high", "medium", "low"];
  const workspaceId = getWorkspaceIdFromList(graph, selection.listId);
  const customFields = useMemo(
    () => getWorkspaceCustomFields(graph, workspaceId),
    [graph, workspaceId],
  );
  const activeList = selection.listId
    ? graph.lists[selection.listId]
    : undefined;
  const listTasks = useMemo(
    () =>
      activeList
        ? activeList.taskIds
            .map((taskId) => graph.tasks[taskId])
            .filter(Boolean)
        : [],
    [activeList, graph.tasks],
  );
  const selectedCustomField =
    filters.customFieldId !== "all"
      ? customFields.find((field) => field.id === filters.customFieldId)
      : undefined;
  const customFieldValueOptions = useMemo(
    () => getCustomFieldFilterOptions(listTasks, selectedCustomField),
    [listTasks, selectedCustomField],
  );

  useEffect(() => {
    if (
      filters.customFieldId !== "all" &&
      !customFields.some((field) => field.id === filters.customFieldId)
    ) {
      setCustomFieldFilter("all");
    }
  }, [customFields, filters.customFieldId, setCustomFieldFilter]);

  useEffect(() => {
    if (
      filters.customFieldId !== "all" &&
      filters.customFieldValue !== "all" &&
      !customFieldValueOptions.some(
        (option) => option.value === filters.customFieldValue,
      )
    ) {
      setCustomFieldValueFilter("all");
    }
  }, [
    customFieldValueOptions,
    filters.customFieldId,
    filters.customFieldValue,
    setCustomFieldValueFilter,
  ]);

  return (
    <div
      className={cn(
        "pauta-task-filter-bar flex flex-col gap-3 rounded-2xl border p-3 sm:flex-row sm:items-center sm:justify-between",
        "border-(--ui-borda) bg-(--ui-superficie)",
      )}
    >
      <div
        className={cn(
          "pauta-task-filter-bar-summary flex items-center gap-2 text-sm font-semibold",
          "text-(--ui-texto-forte)",
        )}
      >
        <SlidersHorizontal
          className={cn(
            "h-4 w-4",
            "text-(--ui-texto-secundario)",
          )}
        />
        Filtros
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-xs font-bold",
            "bg-(--ui-fundo-neutro) text-(--ui-texto-secundario)",
          )}
        >
          {totalVisible} visiveis
        </span>
      </div>

      <div className="pauta-task-filter-bar-controls flex flex-col gap-2 sm:flex-row sm:items-center">
        <label className="sr-only" htmlFor="status-filter">
          Filtrar por status
        </label>
        <select
          id="status-filter"
          value={filters.statusId}
          onChange={(event) => setStatusFilter(event.target.value)}
          className={cn(
            "h-10 rounded-xl border px-3 text-sm outline-none",
            "border-(--ui-borda) bg-(--ui-superficie-suave) text-(--ui-texto-forte) focus:border-(--ui-azul-borda-foco) focus:ring-4 focus:ring-(--ui-azul-foco)",
          )}
        >
          <option value="all">Todos os status</option>
          {getStatusesForList(statusDefinitions, selection.listId)
            .map((status) => (
              <option key={status.id} value={status.id}>
                {getTaskStatusLabel(status.name)}
              </option>
            ))}
        </select>

        <label className="sr-only" htmlFor="priority-filter">
          Filtrar por prioridade
        </label>
        <select
          id="priority-filter"
          value={filters.priority}
          onChange={(event) =>
            setPriorityFilter(event.target.value as TaskPriority | "all")
          }
          className={cn(
            "h-10 rounded-xl border px-3 text-sm outline-none",
            "border-(--ui-borda) bg-(--ui-superficie-suave) text-(--ui-texto-forte) focus:border-(--ui-azul-borda-foco) focus:ring-4 focus:ring-(--ui-azul-foco)",
          )}
        >
          <option value="all">Todas as prioridades</option>
          {priorities.map((priority) => (
            <option key={priority} value={priority}>
              {priorityLabels[priority]}
            </option>
          ))}
        </select>

        {customFields.length > 0 && (
          <>
            <label className="sr-only" htmlFor="custom-field-filter">
              Filtrar por campo personalizado
            </label>
            <select
              id="custom-field-filter"
              value={filters.customFieldId}
              onChange={(event) =>
                setCustomFieldFilter(
                  event.target.value as typeof filters.customFieldId,
                )
              }
              className={cn(
                "h-10 rounded-xl border px-3 text-sm outline-none",
                "border-(--ui-borda) bg-(--ui-superficie-suave) text-(--ui-texto-forte) focus:border-(--ui-azul-borda-foco) focus:ring-4 focus:ring-(--ui-azul-foco)",
              )}
            >
              <option value="all">Todos os campos</option>
              {customFields.map((field) => (
                <option key={field.id} value={field.id}>
                  {field.name}
                </option>
              ))}
            </select>

            <label className="sr-only" htmlFor="custom-field-value-filter">
              Filtrar por valor do campo personalizado
            </label>
            <select
              id="custom-field-value-filter"
              value={filters.customFieldValue}
              disabled={filters.customFieldId === "all"}
              onChange={(event) =>
                setCustomFieldValueFilter(event.target.value as string | "all")
              }
              className={cn(
                "h-10 rounded-xl border px-3 text-sm outline-none disabled:cursor-not-allowed disabled:opacity-60",
                "border-(--ui-borda) bg-(--ui-superficie-suave) text-(--ui-texto-forte) focus:border-(--ui-azul-borda-foco) focus:ring-4 focus:ring-(--ui-azul-foco)",
              )}
            >
              <option value="all">
                {filters.customFieldId === "all"
                  ? "Selecione um campo"
                  : "Qualquer valor preenchido"}
              </option>
              {customFieldValueOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label} ({option.count})
                </option>
              ))}
            </select>
          </>
        )}

        <Button
          variant="secondary"
          size="sm"
          onClick={clearFilters}
          className={cn(
            "h-10 rounded-xl",
            isDarkMode &&
              "border-(--border-subtle) bg-(--bg-surface) text-(--text-main) hover:bg-(--bg-surface-muted)",
          )}
        >
          Limpar
        </Button>
      </div>
    </div>
  );
}
