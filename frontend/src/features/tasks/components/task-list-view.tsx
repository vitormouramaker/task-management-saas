import { useState } from "react";
import { CalendarDays, ChevronDown, ListChecks, MessageSquare, Paperclip, Plus } from "lucide-react";
import { UserAvatar } from "../../../components/ui/user-avatar";
import { getTaskStatusLabel } from "../../../lib/task-status-label";
import { cn } from "../../../lib/utils";
import { useTaskStore } from "../../../store/use-task-store";
import { useThemeStore } from "../../../store/use-theme-store";
import type { Task } from "../../../types/tasks";
import { useListViewData } from "../hooks/use-list-view-data";
import { PRIORITY_CONFIG, formatShortDate, isOverdue } from "../lib/task-view-helpers";
import { TaskCreateModal } from "./task-create-modal";

/** Visão Lista: cards agrupados por coluna, uma linha por card. */
export function TaskListView() {
  const isDarkMode = useThemeStore((state) => state.mode === "dark");
  const openTaskDetails = useTaskStore((state) => state.openTaskDetails);
  const commentsByTaskId = useTaskStore((state) => state.commentsByTaskId);
  const { graph, tasks, statuses, doneStatusIds, canEditTasks } = useListViewData();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [createStatusId, setCreateStatusId] = useState<string | null>(null);

  const muted = "text-(--ui-texto-secundario)";
  const title = "text-(--ui-texto-principal)";
  const border = "border-(--ui-borda)";

  const renderRow = (task: Task) => {
    const priority = PRIORITY_CONFIG[task.priority] ?? PRIORITY_CONFIG.medium;
    const overdue = isOverdue(task, doneStatusIds);
    const checklistItems = (task.checklists || []).flatMap((checklist) => checklist.items || []);
    const checklistDone = checklistItems.filter((item) => item.done).length;
    const schedule = [formatShortDate(task.startDate), formatShortDate(task.dueDate)].filter(Boolean).join(" – ");

    return (
      <button
        key={task.id}
        type="button"
        onClick={() => openTaskDetails(task.id)}
        className={cn(
          "grid w-full grid-cols-[1fr_auto] items-center gap-3 border-t px-4 py-2.5 text-left transition-colors cursor-pointer md:grid-cols-[minmax(0,1fr)_120px_96px_130px_90px]",
          border,
          "hover:bg-(--ui-hover)",
        )}
      >
        <div className="min-w-0">
          <p className={cn("truncate text-sm font-bold", title)}>{task.title}</p>
          <div className={cn("mt-0.5 flex flex-wrap items-center gap-2 text-[11px] font-semibold", muted)}>
            {(task.subtaskIds?.length ?? 0) > 0 && <span>{task.subtaskIds!.length} subtarefa(s)</span>}
            {checklistItems.length > 0 && (
              <span className="inline-flex items-center gap-1">
                <ListChecks className="h-3 w-3" />
                {checklistDone}/{checklistItems.length}
              </span>
            )}
            {(task.attachments?.length ?? 0) > 0 && (
              <span className="inline-flex items-center gap-1">
                <Paperclip className="h-3 w-3" />
                {task.attachments!.length}
              </span>
            )}
            {(task.tags || []).slice(0, 3).map((tag) => (
              <span key={tag.id} className="rounded-full px-1.5 py-px text-[10px] font-bold text-white" style={{ backgroundColor: tag.color }}>
                {tag.name}
              </span>
            ))}
          </div>
        </div>

        <div className="hidden -space-x-2 md:flex">
          {task.assigneeIds.slice(0, 4).map((memberId) => (
            <UserAvatar key={memberId} member={graph.members[memberId]} size={26} className="ring-2 ring-(--bg-elevated)" />
          ))}
          {task.assigneeIds.length > 4 && <span className={cn("pl-3 text-[11px] font-bold", muted)}>+{task.assigneeIds.length - 4}</span>}
        </div>

        <span className={cn("hidden w-fit rounded-full px-2 py-0.5 text-[11px] font-bold md:inline-block", isDarkMode ? priority.dark : priority.light)}>
          {priority.label}
        </span>

        <span className={cn("inline-flex items-center gap-1 text-xs font-bold", overdue ? "text-rose-600" : muted)}>
          {schedule && <CalendarDays className="h-3.5 w-3.5" />}
          {schedule || <span className="hidden md:inline">—</span>}
        </span>

        <span className={cn("hidden items-center gap-1 text-xs font-bold md:inline-flex", muted)}>
          <MessageSquare className="h-3.5 w-3.5" />
          {commentsByTaskId[task.id]?.length ?? 0}
        </span>
      </button>
    );
  };

  return (
    <div className="pauta-scroll-safe h-full space-y-3 overflow-auto pb-6">
      {statuses.map((status) => {
        const groupTasks = tasks.filter((task) => task.statusId === status.id);
        const isCollapsed = collapsed[status.id];

        return (
          <section key={status.id} className={cn("overflow-hidden rounded-2xl border", border, "bg-(--ui-superficie)")}>
            <div className="flex items-center gap-2 px-4 py-3">
              <button
                type="button"
                onClick={() => setCollapsed((current) => ({ ...current, [status.id]: !isCollapsed }))}
                className="flex min-w-0 flex-1 items-center gap-2 text-left cursor-pointer"
              >
                <ChevronDown className={cn("h-4 w-4 transition-transform", muted, isCollapsed && "-rotate-90")} />
                <span className={cn("h-2.5 w-2.5 rounded-full", status.dotClass)} />
                <span className={cn("truncate text-sm font-black", title)}>{getTaskStatusLabel(status.name)}</span>
                <span className={cn("text-xs font-bold", muted)}>{groupTasks.length}</span>
              </button>
              {canEditTasks && (
                <button
                  type="button"
                  onClick={() => setCreateStatusId(status.id)}
                  className={cn("inline-flex h-7 items-center gap-1 rounded-lg px-2 text-xs font-bold cursor-pointer", muted, "hover:bg-(--ui-hover-forte)")}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Adicionar
                </button>
              )}
            </div>

            {!isCollapsed &&
              (groupTasks.length ? (
                <>
                  <div className={cn("hidden border-t px-4 py-1.5 text-[10px] font-black uppercase tracking-wide md:grid md:grid-cols-[minmax(0,1fr)_120px_96px_130px_90px]", border, muted)}>
                    <span>Card</span>
                    <span>Responsáveis</span>
                    <span>Prioridade</span>
                    <span>Datas</span>
                    <span>Comentários</span>
                  </div>
                  {groupTasks.map(renderRow)}
                </>
              ) : (
                <p className={cn("border-t px-4 py-3 text-xs font-medium", border, muted)}>Nenhum card nesta coluna.</p>
              ))}
          </section>
        );
      })}

      <TaskCreateModal
        isOpen={createStatusId !== null}
        onClose={() => setCreateStatusId(null)}
        defaultStatusId={createStatusId ?? undefined}
      />
    </div>
  );
}
