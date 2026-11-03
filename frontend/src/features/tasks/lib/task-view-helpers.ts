import type { Task, TaskPriority, TaskViewMode } from "../../../types/tasks";

export const PRIORITY_RANK: Record<TaskPriority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export const PRIORITY_CONFIG: Record<
  TaskPriority,
  { label: string; light: string; dark: string; bar: string }
> = {
  urgent: { label: "Urgente", light: "bg-rose-50 text-rose-600", dark: "bg-rose-500/12 text-rose-300", bar: "bg-rose-500" },
  high: { label: "Alta", light: "bg-amber-50 text-amber-600", dark: "bg-amber-500/12 text-amber-300", bar: "bg-amber-500" },
  medium: { label: "Média", light: "bg-orange-50 text-orange-600", dark: "bg-orange-500/12 text-orange-300", bar: "bg-orange-400" },
  low: { label: "Baixa", light: "bg-emerald-50 text-emerald-600", dark: "bg-emerald-500/12 text-emerald-300", bar: "bg-emerald-500" },
};

export const VIEW_LABELS: Record<TaskViewMode, string> = {
  board: "Quadro",
  list: "Lista",
  table: "Tabela",
  timeline: "Timeline",
  calendar: "Calendário",
};

/** Plano mínimo de cada visão (mostrado no cadeado). */
export const VIEW_MIN_PLAN: Record<TaskViewMode, string> = {
  board: "Grátis",
  list: "Essencial",
  table: "Essencial",
  timeline: "Profissional",
  calendar: "Profissional",
};

export const SUBTASK_STATUS_ID = "status_subtasks";

export function sortTasks(tasks: Task[], sortOrders: Record<string, number> = {}) {
  return [...tasks].sort((a, b) => {
    const byPriority = (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9);
    if (byPriority !== 0) return byPriority;
    const orderA = sortOrders[a.id] ?? a.sortOrder ?? Number.MAX_SAFE_INTEGER;
    const orderB = sortOrders[b.id] ?? b.sortOrder ?? Number.MAX_SAFE_INTEGER;
    if (orderA !== orderB) return orderA - orderB;
    return a.title.localeCompare(b.title, "pt-BR");
  });
}

// ---------------------------------------------------------------- datas
/** Datas das tarefas são ISO da meia-noite local; trabalhamos sempre no dia local. */
export function toLocalDay(value?: string | Date | null) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function dayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function diffInDays(a: Date, b: Date) {
  return Math.round((a.getTime() - b.getTime()) / 86400000);
}

export function isSameDay(a: Date | null, b: Date | null) {
  return Boolean(a && b && dayKey(a) === dayKey(b));
}

export function today() {
  return toLocalDay(new Date())!;
}

export function isOverdue(task: Task, doneStatusIds: Set<string>) {
  const due = toLocalDay(task.dueDate);
  return Boolean(due && due < today() && !doneStatusIds.has(task.statusId));
}

export function formatShortDate(value?: string | null) {
  const date = toLocalDay(value);
  return date
    ? date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "")
    : null;
}

/** Colunas com nome de concluído (Concluído, Finalizado, Feito, Done). */
export function isDoneStatusName(name?: string | null) {
  return /conclu|finaliz|feito|done|entregue/i.test(String(name || ""));
}
