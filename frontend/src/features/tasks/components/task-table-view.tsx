import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, MessageSquare, Paperclip } from "lucide-react";
import { UserAvatar } from "../../../components/ui/user-avatar";
import { getWorkspaceCustomFields, getWorkspaceIdFromList } from "../../../lib/task-filters";
import { getTaskStatusLabel } from "../../../lib/task-status-label";
import { cn } from "../../../lib/utils";
import { useTaskStore } from "../../../store/use-task-store";
import { useThemeStore } from "../../../store/use-theme-store";
import {
  TASK_PRIORITY_VALUES,
  type CustomFieldDefinition,
  type CustomFieldValue,
  type Task,
  type TaskPriority,
} from "../../../types/tasks";
import { useListViewData } from "../hooks/use-list-view-data";
import { PRIORITY_CONFIG, PRIORITY_RANK, formatShortDate, isOverdue, toLocalDay } from "../lib/task-view-helpers";

type SortKey = "title" | "status" | "priority" | "startDate" | "dueDate" | "assignees" | `field:${string}`;

function formatFieldValue(field: CustomFieldDefinition, value: CustomFieldValue | undefined) {
  if (value === null || value === undefined || value === "") return "—";
  if (field.type === "checkbox") return value ? "Sim" : "Não";
  if (field.type === "single_select") return field.options.find((option) => option.id === value)?.label ?? String(value);
  if (field.type === "date") return formatShortDate(String(value)) ?? String(value);
  if (field.type === "number") return Number(value).toLocaleString("pt-BR");
  return String(value);
}

/** Visão Tabela: uma linha por card, colunas ordenáveis e edição rápida de status e prioridade. */
export function TaskTableView() {
  const isDarkMode = useThemeStore((state) => state.mode === "dark");
  const openTaskDetails = useTaskStore((state) => state.openTaskDetails);
  const moveTaskToStatus = useTaskStore((state) => state.moveTaskToStatus);
  const updateTaskPriority = useTaskStore((state) => state.updateTaskPriority);
  const commentsByTaskId = useTaskStore((state) => state.commentsByTaskId);
  const { graph, activeList, tasks, statuses, doneStatusIds, canEditTasks } = useListViewData();
  const [sort, setSort] = useState<{ key: SortKey; direction: 1 | -1 } | null>(null);

  const fields = useMemo(
    () => (activeList ? getWorkspaceCustomFields(graph, getWorkspaceIdFromList(graph, activeList.id)) : []),
    [graph, activeList],
  );

  const statusOrder = useMemo(() => new Map(statuses.map((status, index) => [status.id, index])), [statuses]);

  const rows = useMemo(() => {
    if (!sort) return tasks;
    const value = (task: Task): string | number => {
      switch (sort.key) {
        case "title":
          return task.title.toLowerCase();
        case "status":
          return statusOrder.get(task.statusId) ?? 99;
        case "priority":
          return PRIORITY_RANK[task.priority] ?? 9;
        case "startDate":
          return toLocalDay(task.startDate)?.getTime() ?? Number.MAX_SAFE_INTEGER;
        case "dueDate":
          return toLocalDay(task.dueDate)?.getTime() ?? Number.MAX_SAFE_INTEGER;
        case "assignees":
          return graph.members[task.assigneeIds[0]]?.name?.toLowerCase() ?? "~";
        default: {
          const field = fields.find((item) => `field:${item.id}` === sort.key);
          const raw = field ? task.customFieldValues?.[field.id] : null;
          return field ? formatFieldValue(field, raw).toLowerCase() : "";
        }
      }
    };
    return [...tasks].sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      return (va < vb ? -1 : va > vb ? 1 : 0) * sort.direction;
    });
  }, [tasks, sort, statusOrder, graph.members, fields]);

  const muted = "text-(--ui-texto-secundario)";
  const title = "text-(--ui-texto-principal)";
  const border = "border-(--ui-borda)";
  const selectClass = cn(
    "h-7 max-w-40 rounded-lg border px-1.5 text-xs font-bold outline-none cursor-pointer disabled:cursor-default",
    "border-(--ui-borda) bg-(--ui-superficie-suave) text-(--ui-texto-forte)",
  );

  const header = (key: SortKey, label: string, className = "") => (
    <th className={cn("whitespace-nowrap px-3 py-2.5", className)}>
      <button
        type="button"
        onClick={() =>
          setSort((current) =>
            current?.key === key ? (current.direction === 1 ? { key, direction: -1 } : null) : { key, direction: 1 },
          )
        }
        className="inline-flex items-center gap-1 uppercase cursor-pointer"
      >
        {label}
        {sort?.key === key && (sort.direction === 1 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
      </button>
    </th>
  );

  return (
    <div className={cn("pauta-scroll-safe h-full overflow-auto rounded-2xl border", border, "bg-(--ui-superficie)")}>
      <table className="w-full min-w-225 border-collapse text-left">
        <thead className={cn("sticky top-0 z-10 text-[10px] font-black tracking-wide", muted, "bg-(--ui-fundo-sutil)")}>
          <tr>
            {header("title", "Tarefa", "min-w-64")}
            {header("status", "Status")}
            {header("assignees", "Responsáveis")}
            {header("priority", "Prioridade")}
            {header("startDate", "Início")}
            {header("dueDate", "Prazo")}
            {fields.map((field) => header(`field:${field.id}`, field.name))}
            <th className="px-3 py-2.5 uppercase">Atividade</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={7 + fields.length} className={cn("px-4 py-10 text-center text-sm font-medium", muted)}>
                Nenhum card encontrado.
              </td>
            </tr>
          )}
          {rows.map((task) => {
            const priority = PRIORITY_CONFIG[task.priority] ?? PRIORITY_CONFIG.medium;
            const overdue = isOverdue(task, doneStatusIds);
            return (
              <tr
                key={task.id}
                onClick={() => openTaskDetails(task.id)}
                className={cn("border-t text-sm cursor-pointer", border, "hover:bg-(--ui-hover)")}
              >
                <td className={cn("max-w-md px-3 py-2 font-bold", title)}>
                  <span className="line-clamp-2">{task.title}</span>
                </td>
                <td className="px-3 py-2" onClick={(event) => event.stopPropagation()}>
                  <select
                    value={task.statusId}
                    disabled={!canEditTasks}
                    onChange={(event) => void moveTaskToStatus(task.id, event.target.value)}
                    className={selectClass}
                  >
                    {statuses.map((status) => (
                      <option key={status.id} value={status.id}>
                        {getTaskStatusLabel(status.name)}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2">
                  <div className="flex -space-x-2">
                    {task.assigneeIds.slice(0, 4).map((memberId) => (
                      <UserAvatar key={memberId} member={graph.members[memberId]} size={24} className="ring-2 ring-(--bg-elevated)" />
                    ))}
                    {task.assigneeIds.length === 0 && <span className={muted}>—</span>}
                  </div>
                </td>
                <td className="px-3 py-2" onClick={(event) => event.stopPropagation()}>
                  <select
                    value={task.priority}
                    disabled={!canEditTasks}
                    onChange={(event) => void updateTaskPriority(task.id, event.target.value as TaskPriority)}
                    className={cn(selectClass, "border-transparent", isDarkMode ? priority.dark : priority.light)}
                  >
                    {TASK_PRIORITY_VALUES.map((value) => (
                      <option key={value} value={value}>
                        {PRIORITY_CONFIG[value].label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className={cn("whitespace-nowrap px-3 py-2 text-xs font-bold", muted)}>{formatShortDate(task.startDate) ?? "—"}</td>
                <td className={cn("whitespace-nowrap px-3 py-2 text-xs font-bold", overdue ? "text-rose-600" : muted)}>
                  {formatShortDate(task.dueDate) ?? "—"}
                </td>
                {fields.map((field) => (
                  <td key={field.id} className={cn("whitespace-nowrap px-3 py-2 text-xs font-semibold", muted)}>
                    {formatFieldValue(field, task.customFieldValues?.[field.id])}
                  </td>
                ))}
                <td className={cn("whitespace-nowrap px-3 py-2 text-xs font-bold", muted)}>
                  <span className="inline-flex items-center gap-3">
                    <span className="inline-flex items-center gap-1">
                      <MessageSquare className="h-3.5 w-3.5" />
                      {commentsByTaskId[task.id]?.length ?? 0}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Paperclip className="h-3.5 w-3.5" />
                      {task.attachments?.length ?? 0}
                    </span>
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
