import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { getTaskStatusLabel } from "../../../lib/task-status-label";
import { cn } from "../../../lib/utils";
import { useTaskStore } from "../../../store/use-task-store";
import type { Task } from "../../../types/tasks";
import { useListViewData } from "../hooks/use-list-view-data";
import { PRIORITY_CONFIG, addDays, diffInDays, isOverdue, toLocalDay, today } from "../lib/task-view-helpers";

const DAY_WIDTH = 36;
const RANGE_DAYS = 63;
const ROW_HEIGHT = 40;
const LABEL_WIDTH = 260;

type DragMode = "move" | "start" | "end";

interface DragState {
  taskId: string;
  mode: DragMode;
  originX: number;
  start: Date;
  end: Date;
  delta: number;
}

/** Visão Timeline: barras de início a prazo, arrastar para mover e bordas para mudar a duração. */
export function TaskTimelineView() {
  const openTaskDetails = useTaskStore((state) => state.openTaskDetails);
  const updateTaskDates = useTaskStore((state) => state.updateTaskDates);
  const { tasks, statuses, doneStatusIds, canEditTasks } = useListViewData();
  const [rangeStart, setRangeStart] = useState(() => addDays(today(), -7));
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Soltar depois de arrastar não deve abrir o card.
  const suppressClickRef = useRef(false);

  const days = useMemo(() => Array.from({ length: RANGE_DAYS }, (_, index) => addDays(rangeStart, index)), [rangeStart]);
  const statusById = useMemo(() => new Map(statuses.map((status) => [status.id, status])), [statuses]);

  const { dated, undated } = useMemo(() => {
    const withDates: Array<{ task: Task; start: Date; end: Date }> = [];
    const without: Task[] = [];
    for (const task of tasks) {
      const start = toLocalDay(task.startDate) ?? toLocalDay(task.dueDate);
      const end = toLocalDay(task.dueDate) ?? toLocalDay(task.startDate);
      if (!start || !end) {
        without.push(task);
        continue;
      }
      withDates.push({ task, start: start <= end ? start : end, end: start <= end ? end : start });
    }
    withDates.sort((a, b) => a.start.getTime() - b.start.getTime() || a.end.getTime() - b.end.getTime());
    return { dated: withDates, undated: without };
  }, [tasks]);

  // Arrastar com o mouse/dedo: calcula quantos dias andou e salva ao soltar.
  useEffect(() => {
    if (!drag) return;

    const onMove = (event: PointerEvent) => {
      const current = dragRef.current;
      if (!current) return;
      const delta = Math.round((event.clientX - current.originX) / DAY_WIDTH);
      if (delta !== current.delta) {
        dragRef.current = { ...current, delta };
        setDrag(dragRef.current);
      }
    };

    const onUp = () => {
      const current = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (!current || current.delta === 0) return;
      suppressClickRef.current = true;
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
      const { start, end } = applyDrag(current);
      const task = tasks.find((item) => item.id === current.taskId);
      if (!task) return;
      void updateTaskDates(
        task.id,
        task.startDate || current.mode !== "end" ? start.toISOString() : null,
        end.toISOString(),
      );
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [drag !== null, tasks, updateTaskDates]); // eslint-disable-line react-hooks/exhaustive-deps

  const muted = "text-(--ui-texto-secundario)";
  const titleColor = "text-(--ui-texto-principal)";
  const border = "border-(--ui-borda)";
  const surface = "bg-(--ui-superficie)";
  const todayOffset = diffInDays(today(), rangeStart);

  const startDrag = (event: React.PointerEvent, taskId: string, mode: DragMode, start: Date, end: Date) => {
    if (!canEditTasks) return;
    event.preventDefault();
    event.stopPropagation();
    const state = { taskId, mode, originX: event.clientX, start, end, delta: 0 };
    dragRef.current = state;
    setDrag(state);
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setRangeStart((date) => addDays(date, -28))} aria-label="Voltar 4 semanas" className={cn("grid h-8 w-8 place-items-center rounded-lg border cursor-pointer", border)}>
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button type="button" onClick={() => setRangeStart((date) => addDays(date, 28))} aria-label="Avançar 4 semanas" className={cn("grid h-8 w-8 place-items-center rounded-lg border cursor-pointer", border)}>
          <ChevronRight className="h-4 w-4" />
        </button>
        <button type="button" onClick={() => setRangeStart(addDays(today(), -7))} className={cn("h-8 rounded-lg border px-3 text-xs font-bold cursor-pointer", border, muted)}>
          Hoje
        </button>
        <span className={cn("text-sm font-black capitalize", titleColor)}>
          {days[0].toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })} –{" "}
          {days[days.length - 1].toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" })}
        </span>
        {canEditTasks && (
          <span className={cn("ml-auto hidden text-[11px] font-medium md:inline", muted)}>
            Arraste a barra para mudar as datas; puxe as pontas para mudar a duração.
          </span>
        )}
      </div>

      <div ref={scrollRef} className={cn("pauta-scroll-safe relative min-h-0 flex-1 overflow-auto rounded-2xl border", border, surface)}>
        <div style={{ width: LABEL_WIDTH + RANGE_DAYS * DAY_WIDTH }} className="relative">
          {/* Cabeçalho de dias */}
          <div className={cn("sticky top-0 z-20 flex border-b", border, surface)}>
            <div style={{ width: LABEL_WIDTH }} className={cn("sticky left-0 z-10 shrink-0 border-r px-3 py-2 text-[10px] font-black uppercase tracking-wide", border, surface, muted)}>
              Card
            </div>
            {days.map((date) => {
              const weekend = date.getDay() === 0 || date.getDay() === 6;
              const firstOfMonth = date.getDate() === 1;
              return (
                <div
                  key={date.toISOString()}
                  style={{ width: DAY_WIDTH }}
                  className={cn("shrink-0 py-1 text-center text-[10px] font-bold", muted, weekend && ("bg-(--ui-fundo-sutil)"), firstOfMonth && "border-l border-blue-400")}
                >
                  <div className="uppercase opacity-70">{date.toLocaleDateString("pt-BR", { weekday: "narrow" })}</div>
                  <div className={cn(diffInDays(date, today()) === 0 && "mx-auto grid h-5 w-5 place-items-center rounded-full bg-blue-600 text-white")}>{date.getDate()}</div>
                </div>
              );
            })}
          </div>

          {/* Linha de hoje */}
          {todayOffset >= 0 && todayOffset < RANGE_DAYS && (
            <div className="pointer-events-none absolute bottom-0 top-0 z-10 w-px bg-blue-500" style={{ left: LABEL_WIDTH + todayOffset * DAY_WIDTH + DAY_WIDTH / 2 }} />
          )}

          {dated.length === 0 && (
            <p className={cn("px-4 py-8 text-sm font-medium", muted)}>Nenhum card com datas. Defina início ou prazo nos cards para vê-los aqui.</p>
          )}

          {dated.map(({ task, start, end }) => {
            const isDragging = drag?.taskId === task.id;
            const shown = isDragging ? applyDrag(drag) : { start, end };
            const left = diffInDays(shown.start, rangeStart);
            const length = diffInDays(shown.end, shown.start) + 1;
            const visibleLeft = Math.max(left, 0);
            const visibleRight = Math.min(left + length, RANGE_DAYS);
            const status = statusById.get(task.statusId);
            const overdue = isOverdue(task, doneStatusIds);

            return (
              <div key={task.id} className={cn("flex border-b", border)} style={{ height: ROW_HEIGHT }}>
                <button
                  type="button"
                  onClick={() => openTaskDetails(task.id)}
                  style={{ width: LABEL_WIDTH }}
                  className={cn("sticky left-0 z-10 flex shrink-0 items-center gap-2 border-r px-3 text-left cursor-pointer", border, surface)}
                >
                  <span className={cn("h-2 w-2 shrink-0 rounded-full", status?.dotClass)} title={getTaskStatusLabel(status?.name)} />
                  <span className={cn("truncate text-xs font-bold", overdue ? "text-rose-600" : titleColor)}>{task.title}</span>
                </button>
                <div className="relative flex-1">
                  {visibleRight > visibleLeft && (
                    <div
                      onPointerDown={(event) => startDrag(event, task.id, "move", start, end)}
                      onClick={() => !suppressClickRef.current && openTaskDetails(task.id)}
                      title={`${task.title} · ${shown.start.toLocaleDateString("pt-BR")} a ${shown.end.toLocaleDateString("pt-BR")}`}
                      className={cn(
                        "absolute top-2 flex h-6 items-center overflow-hidden rounded-md px-2 text-[11px] font-bold text-white shadow-sm select-none",
                        PRIORITY_CONFIG[task.priority]?.bar ?? "bg-blue-500",
                        canEditTasks ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
                        doneStatusIds.has(task.statusId) && "opacity-50",
                        isDragging && "ring-2 ring-blue-300",
                      )}
                      style={{ left: visibleLeft * DAY_WIDTH + 2, width: (visibleRight - visibleLeft) * DAY_WIDTH - 4 }}
                    >
                      {canEditTasks && left >= 0 && (
                        <span onPointerDown={(event) => startDrag(event, task.id, "start", start, end)} className="absolute inset-y-0 left-0 w-2 cursor-ew-resize" />
                      )}
                      <span className="truncate">{task.title}</span>
                      {canEditTasks && left + length <= RANGE_DAYS && (
                        <span onPointerDown={(event) => startDrag(event, task.id, "end", start, end)} className="absolute inset-y-0 right-0 w-2 cursor-ew-resize" />
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {undated.length > 0 && (
        <details className={cn("rounded-2xl border px-4 py-2", border, surface)}>
          <summary className={cn("cursor-pointer text-xs font-black", titleColor)}>Sem datas ({undated.length})</summary>
          <div className="mt-2 flex flex-wrap gap-2 pb-1">
            {undated.map((task) => (
              <button
                key={task.id}
                type="button"
                onClick={() => openTaskDetails(task.id)}
                className={cn("rounded-lg border px-2 py-1 text-xs font-bold cursor-pointer", border, muted)}
              >
                {task.title}
              </button>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function applyDrag(state: DragState) {
  const { mode, start, end, delta } = state;
  if (mode === "move") return { start: addDays(start, delta), end: addDays(end, delta) };
  if (mode === "start") {
    const next = addDays(start, delta);
    return { start: next > end ? end : next, end };
  }
  const next = addDays(end, delta);
  return { start, end: next < start ? start : next };
}
