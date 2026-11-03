import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, X } from "lucide-react";
import { cn } from "../../../lib/utils";
import { useTaskStore } from "../../../store/use-task-store";
import type { Task } from "../../../types/tasks";
import {
  PRIORITY_CONFIG,
  addDays,
  dayKey,
  diffInDays,
  isOverdue,
  isSameDay,
  toLocalDay,
  today,
} from "../lib/task-view-helpers";

const WEEK_DAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const MAX_PER_DAY = 3;

interface TaskCalendarProps {
  tasks: Task[];
  doneStatusIds: Set<string>;
  canEditTask: (task: Task) => boolean;
  /** Clicar no "+" de um dia (só no calendário do projeto). */
  onCreate?: (date: Date) => void;
  /** Texto extra na linha do card (ex.: nome do projeto no calendário geral). */
  subtitle?: (task: Task) => string | null;
  /** Cor da faixa lateral do card. */
  accent?: (task: Task) => string | undefined;
}

/** Calendário mensal por prazo, com arrastar para outro dia. */
export function TaskCalendar({ tasks, doneStatusIds, canEditTask, onCreate, subtitle, accent }: TaskCalendarProps) {
  const openTaskDetails = useTaskStore((state) => state.openTaskDetails);
  const updateTaskDates = useTaskStore((state) => state.updateTaskDates);
  const [month, setMonth] = useState(() => {
    const now = today();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const [dragOverDay, setDragOverDay] = useState<string | null>(null);
  const [showUndated, setShowUndated] = useState(false);

  const days = useMemo(() => {
    const first = addDays(month, -month.getDay());
    return Array.from({ length: 42 }, (_, index) => addDays(first, index));
  }, [month]);

  const { byDay, undated } = useMemo(() => {
    const map = new Map<string, Task[]>();
    const semData: Task[] = [];
    for (const task of tasks) {
      const date = toLocalDay(task.dueDate) ?? toLocalDay(task.startDate);
      if (!date) {
        semData.push(task);
        continue;
      }
      const key = dayKey(date);
      map.set(key, [...(map.get(key) || []), task]);
    }
    return { byDay: map, undated: semData };
  }, [tasks]);

  const moveTask = (taskId: string, target: Date) => {
    const task = tasks.find((item) => item.id === taskId);
    if (!task || !canEditTask(task)) return;
    const due = toLocalDay(task.dueDate);
    const start = toLocalDay(task.startDate);
    const anchor = due ?? start;

    if (!anchor) {
      void updateTaskDates(task.id, task.startDate ?? null, target.toISOString());
      return;
    }
    const delta = diffInDays(target, anchor);
    if (delta === 0) return;
    void updateTaskDates(
      task.id,
      start ? addDays(start, delta).toISOString() : null,
      due ? addDays(due, delta).toISOString() : target.toISOString(),
    );
  };

  const muted = "text-(--ui-texto-secundario)";
  const titleColor = "text-(--ui-texto-principal)";
  const border = "border-(--ui-borda)";
  const now = today();

  const renderChip = (task: Task, compact = true) => {
    const overdue = isOverdue(task, doneStatusIds);
    const done = doneStatusIds.has(task.statusId);
    const editable = canEditTask(task);
    const extra = subtitle?.(task);
    return (
      <button
        key={task.id}
        type="button"
        draggable={editable}
        onDragStart={(event) => {
          event.dataTransfer.setData("text/pauta-task", task.id);
          event.dataTransfer.effectAllowed = "move";
        }}
        onClick={(event) => {
          event.stopPropagation();
          openTaskDetails(task.id);
        }}
        title={task.title}
        className={cn(
          "flex w-full items-center gap-1.5 overflow-hidden rounded-md border-l-[3px] px-1.5 py-1 text-left text-[11px] font-bold transition-colors",
          editable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
          "bg-(--ui-fundo-neutro) hover:bg-(--ui-hover-forte)",
          overdue && "text-rose-600",
          done && "line-through opacity-60",
          !overdue && titleColor,
        )}
        style={{ borderLeftColor: accent?.(task) }}
      >
        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", PRIORITY_CONFIG[task.priority]?.bar)} />
        <span className="min-w-0 flex-1 truncate">
          {task.title}
          {!compact && extra ? <span className={cn("block truncate text-[10px] font-semibold", muted)}>{extra}</span> : null}
        </span>
      </button>
    );
  };

  const monthLabel = month.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
          aria-label="Mês anterior"
          className={cn("grid h-8 w-8 place-items-center rounded-lg border cursor-pointer", border)}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
          aria-label="Próximo mês"
          className={cn("grid h-8 w-8 place-items-center rounded-lg border cursor-pointer", border)}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        <h3 className={cn("text-base font-black capitalize", titleColor)}>{monthLabel}</h3>
        <button
          type="button"
          onClick={() => setMonth(new Date(now.getFullYear(), now.getMonth(), 1))}
          className={cn("h-8 rounded-lg border px-3 text-xs font-bold cursor-pointer", border, muted)}
        >
          Hoje
        </button>
        <button
          type="button"
          onClick={() => setShowUndated((value) => !value)}
          className={cn(
            "ml-auto h-8 rounded-lg border px-3 text-xs font-bold cursor-pointer",
            border,
            showUndated ? "border-blue-500 text-blue-600" : muted,
          )}
        >
          Sem prazo ({undated.length})
        </button>
      </div>

      <div className="flex min-h-0 flex-1 gap-3">
        <div className={cn("flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border", border, "bg-(--ui-superficie)")}>
          <div className={cn("grid grid-cols-7 border-b text-center text-[10px] font-black uppercase tracking-wide", border, muted)}>
            {WEEK_DAYS.map((label) => (
              <div key={label} className="py-2">
                {label}
              </div>
            ))}
          </div>
          <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6">
            {days.map((date) => {
              const key = dayKey(date);
              const dayTasks = byDay.get(key) || [];
              const outside = date.getMonth() !== month.getMonth();
              const isToday = isSameDay(date, now);
              const expanded = expandedDay === key;
              const visible = expanded ? dayTasks : dayTasks.slice(0, MAX_PER_DAY);

              return (
                <div
                  key={key}
                  onDragOver={(event) => {
                    if (!event.dataTransfer.types.includes("text/pauta-task")) return;
                    event.preventDefault();
                    setDragOverDay(key);
                  }}
                  onDragLeave={() => setDragOverDay((current) => (current === key ? null : current))}
                  onDrop={(event) => {
                    event.preventDefault();
                    setDragOverDay(null);
                    const taskId = event.dataTransfer.getData("text/pauta-task");
                    if (taskId) moveTask(taskId, date);
                  }}
                  className={cn(
                    "group relative flex min-h-24 flex-col gap-1 overflow-hidden border-b border-r p-1.5",
                    border,
                    outside && ("bg-(--ui-fundo-sutil)"),
                    dragOverDay === key && "bg-blue-500/10 ring-2 ring-inset ring-blue-500",
                    expanded && "z-10 overflow-visible",
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={cn(
                        "grid h-6 min-w-6 place-items-center rounded-full px-1 text-xs font-black",
                        isToday ? "bg-blue-600 text-white" : outside ? "opacity-40" : titleColor,
                      )}
                    >
                      {date.getDate()}
                    </span>
                    {onCreate && (
                      <button
                        type="button"
                        onClick={() => onCreate(date)}
                        aria-label="Novo card neste dia"
                        className={cn("grid h-6 w-6 place-items-center rounded-md opacity-0 transition-opacity group-hover:opacity-100 cursor-pointer", muted, "hover:bg-(--ui-hover-forte)")}
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  <div
                    className={cn(
                      "flex flex-col gap-1",
                      expanded &&
                        cn(
                          "absolute inset-x-0 top-8 max-h-72 overflow-auto rounded-b-xl border p-1.5 shadow-xl",
                          border,
                          "bg-(--ui-superficie)",
                        ),
                    )}
                  >
                    {visible.map((task) => renderChip(task, !subtitle))}
                    {dayTasks.length > MAX_PER_DAY && (
                      <button
                        type="button"
                        onClick={() => setExpandedDay(expanded ? null : key)}
                        className={cn("px-1 text-left text-[10px] font-black cursor-pointer", muted)}
                      >
                        {expanded ? "mostrar menos" : `+${dayTasks.length - MAX_PER_DAY} mais`}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {showUndated && (
          <aside className={cn("hidden w-64 shrink-0 flex-col overflow-hidden rounded-2xl border md:flex", border, "bg-(--ui-superficie)")}>
            <div className={cn("flex items-center justify-between border-b px-3 py-2.5", border)}>
              <p className={cn("text-xs font-bold", titleColor)}>Sem prazo</p>
              <button type="button" onClick={() => setShowUndated(false)} aria-label="Fechar" className="cursor-pointer">
                <X className={cn("h-4 w-4", muted)} />
              </button>
            </div>
            <p className={cn("px-3 pt-2 text-[11px] font-medium", muted)}>Arraste um card para um dia para definir o prazo.</p>
            <div className="pauta-scroll-safe flex min-h-0 flex-1 flex-col gap-1 overflow-auto p-2">
              {undated.length === 0 ? (
                <p className={cn("p-2 text-xs", muted)}>Todos os cards têm prazo.</p>
              ) : (
                undated.map((task) => renderChip(task, false))
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
