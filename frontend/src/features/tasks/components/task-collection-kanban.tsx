import { useRef, useState } from "react";
import {
  Calendar,
  GripVertical,
  MessageSquare,
  MoreHorizontal,
  MousePointer2,
  Paperclip,
  Plus,
} from "lucide-react";
import {
  DndContext,
  DragOverlay,
  closestCorners,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  pointerWithin,
  useDroppable,
  defaultDropAnimationSideEffects,
  type DropAnimation,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { UserAvatar } from "../../../components/ui/user-avatar";
import { getTaskStatusLabel } from "../../../lib/task-status-label";
import { getStatusesForList } from "../../../lib/status-columns";
import {
  canMoveTask,
  getWorkspacePermissionForTask,
} from "../../../lib/workspace-permissions";
import { cn } from "../../../lib/utils";
import { useAuthStore } from "../../../store/use-auth-store";
import { useTaskStore } from "../../../store/use-task-store";
import { useThemeStore } from "../../../store/use-theme-store";
import type {
  EntityId,
  Task,
  TaskStatusDefinition,
} from "../../../types/tasks";
import { TaskCard } from "./task-card";
import {
  ColumnCreatePopover,
  ColumnEditPopover,
  getPresetStyleByDotClass,
} from "./column-create-popover";

// Prefixo de id usado para distinguir o arraste de COLUNAS do arraste de cards.
const COLUMN_DRAG_PREFIX = "col:";

type TaskCardContext = {
  label: string;
  subLabel?: string;
};

const PRIORITY_RANK: Record<string, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

interface TaskCollectionKanbanProps {
  tasks: Task[];
  canEditTasks: boolean;
  isAdm?: boolean;
  onAddTask?: (statusId: string) => void;
  taskCardContextById?: Record<string, TaskCardContext>;
  emptyColumnMessage?: string;
}

const lightStatusStyleMap: Record<
  string,
  { dot: string; bg: string; text: string; headerBg: string }
> = {
  st_backlog: {
    dot: "bg-black",
    bg: "bg-slate-50",
    text: "text-slate-900",
    headerBg: "bg-slate-100 border-slate-200",
  },
  st_todo: {
    dot: "bg-blue-600",
    bg: "bg-blue-50/10",
    text: "text-blue-900",
    headerBg: "bg-blue-50 border-blue-100",
  },
  st_progress: {
    dot: "bg-orange-500",
    bg: "bg-orange-50/10",
    text: "text-orange-900",
    headerBg: "bg-orange-50 border-orange-100",
  },
  st_review: {
    dot: "bg-violet-500",
    bg: "bg-violet-50/10",
    text: "text-violet-900",
    headerBg: "bg-violet-50 border-violet-100",
  },
  st_done: {
    dot: "bg-emerald-500",
    bg: "bg-emerald-50/10",
    text: "text-emerald-900",
    headerBg: "bg-emerald-50 border-emerald-100",
  },
  status_subtasks: {
    dot: "bg-slate-500",
    bg: "bg-slate-50/10",
    text: "text-slate-900",
    headerBg: "bg-slate-200/50 border-slate-200",
  },
};

const darkStatusStyleMap: Record<
  string,
  { dot: string; bg: string; text: string; headerBg: string }
> = {
  st_backlog: {
    dot: "bg-zinc-200",
    bg: "bg-zinc-500/15",
    text: "text-zinc-100",
    headerBg: "bg-zinc-500/10 border-(--border-subtle)",
  },
  st_todo: {
    dot: "bg-blue-300",
    bg: "bg-blue-500/12",
    text: "text-blue-200",
    headerBg: "bg-blue-500/10 border-blue-500/20",
  },
  st_progress: {
    dot: "bg-amber-300",
    bg: "bg-amber-500/12",
    text: "text-amber-200",
    headerBg: "bg-amber-500/10 border-amber-500/20",
  },
  st_review: {
    dot: "bg-violet-300",
    bg: "bg-violet-500/12",
    text: "text-violet-200",
    headerBg: "bg-violet-500/10 border-violet-500/20",
  },
  st_done: {
    dot: "bg-emerald-300",
    bg: "bg-emerald-500/12",
    text: "text-emerald-200",
    headerBg: "bg-emerald-500/10 border-emerald-500/20",
  },
  status_subtasks: {
    dot: "bg-zinc-300",
    bg: "bg-zinc-500/12",
    text: "text-zinc-200",
    headerBg: "bg-zinc-500/12 border-(--border-subtle)",
  },
};

const dropAnimation: DropAnimation = {
  duration: 200,
  easing: "cubic-bezier(0.18, 0.67, 0.6, 1.22)",
  sideEffects: defaultDropAnimationSideEffects({
    styles: { active: { opacity: "0.4" } },
  }),
};

const collisionDetection: CollisionDetection = (args) => {
  // Separa os dois tipos de arraste: colunas só colidem com alvos de coluna
  // (ids com prefixo "col:"); cards só colidem com colunas/cards normais.
  const isColumnDrag = String(args.active.id).startsWith(COLUMN_DRAG_PREFIX);
  const droppableContainers = args.droppableContainers.filter((container) => {
    const isColumnTarget = String(container.id).startsWith(COLUMN_DRAG_PREFIX);
    return isColumnDrag ? isColumnTarget : !isColumnTarget;
  });
  const scopedArgs = { ...args, droppableContainers };

  const intersections = pointerWithin(scopedArgs);
  if (intersections.length > 0) {
    return intersections;
  }

  return closestCorners(scopedArgs);
};

function DragPreviewCard({
  task,
  context,
}: {
  task: Task;
  context?: TaskCardContext;
}) {
  const isDarkMode = useThemeStore((state) => state.mode === "dark");
  const members = useTaskStore((state) => state.graph.members);
  const commentsByTaskId = useTaskStore((state) => state.commentsByTaskId);
  const assignees = task.assigneeIds
    .map((memberId) => members[memberId])
    .filter(Boolean);
  const attachmentCount = task.attachments?.length || 0;
  const commentCount = commentsByTaskId[task.id]?.length || 0;
  const priorityLabelMap: Record<Task["priority"], string> = {
    urgent: "Urgente",
    high: "Alta",
    medium: "Média",
    low: "Baixa",
  };

  return (
    <div
      className={cn(
        "w-[min(88vw,23rem)] overflow-hidden rounded-2xl border sm:w-70",
        isDarkMode
          ? "border-blue-500/50 bg-(--bg-elevated) shadow-[0_20px_60px_-10px] shadow-blue-500/25"
          : "border-blue-300/80 bg-white shadow-[0_20px_60px_-10px] shadow-blue-400/30",
      )}
    >
      <div
        className={cn(
          "flex items-center justify-between border-b px-4 py-2.5",
          "border-(--ui-azul-borda) bg-(--ui-azul-fundo)",
        )}
      >
        <div
          className={cn(
            "flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-widest",
            "bg-(--ui-azul-fundo) text-(--ui-azul-texto)",
          )}
        >
          <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-400" />
          {priorityLabelMap[task.priority]}
        </div>
        <span
          className={cn(
            "text-[10px] font-black uppercase tracking-wider",
            "text-(--ui-azul-texto)",
          )}
        >
          Movendo...
        </span>
      </div>

      <div
        className={cn("p-4", "bg-(--ui-superficie)")}
      >
        {context?.label && (
          <div className="mb-2 flex items-center gap-2">
            <span
              className={cn(
                "inline-flex max-w-full items-center rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em]",
                "bg-(--ui-azul-fundo) text-(--ui-azul-texto) ring-1 ring-(--ui-azul-borda)",
              )}
            >
              <span className="truncate">{context.label}</span>
            </span>
            {context.subLabel && (
              <span
                className={cn(
                  "truncate text-[10px] font-semibold",
                  "text-(--ui-texto-secundario)",
                )}
              >
                {context.subLabel}
              </span>
            )}
          </div>
        )}
        <h3
          className={cn(
            "text-[14px] font-black leading-tight",
            "text-(--ui-texto-principal)",
          )}
        >
          {task.title}
        </h3>
        <p
          className={cn(
            "mt-2 line-clamp-2 text-[12px] font-bold leading-relaxed",
            "text-(--ui-texto-secundario)",
          )}
        >
          {task.description?.value?.replace(/<[^>]+>/g, "") ||
            "Sem descrição fornecida."}
        </p>
        <div className="mt-4 flex items-center justify-between">
          <div
            className={cn(
              "flex items-center gap-1.5 text-[9px] font-bold",
              "text-(--ui-texto-secundario)",
            )}
          >
            <Calendar className="h-3 w-3" />
            <span>
              Criada em{" "}
              {task.createdAt
                ? new Date(task.createdAt).toLocaleDateString("pt-BR", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                  })
                : "---"}
            </span>
          </div>
        </div>
      </div>

      <div
        className={cn(
          "flex items-center justify-between border-t px-4 py-3",
          "border-(--ui-borda-suave) bg-(--ui-fundo-sutil)",
        )}
      >
        <div className="flex -space-x-2">
          {assignees.map((member) => (
            <UserAvatar key={member.id} member={member} size={24} />
          ))}
        </div>

        <div
          className={cn(
            "flex items-center gap-1",
            "text-(--ui-texto-secundario)",
          )}
        >
          <div className="flex items-center gap-1.5 rounded-lg px-2 py-1">
            <Paperclip className="h-3.5 w-3.5" />
            <span className="text-[10px] font-black">{attachmentCount}</span>
          </div>
          <div className="flex items-center gap-1.5 rounded-lg px-2 py-1">
            <MessageSquare className="h-3.5 w-3.5" />
            <span className="text-[10px] font-black">{commentCount}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

interface ColumnProps {
  status: TaskStatusDefinition;
  tasks: Task[];
  canEditTasks: boolean;
  isAdm?: boolean;
  onAddTask?: (statusId: string) => void;
  onEditColumn?: (
    statusId: string,
    payload: {
      name: string;
      colorClass: string;
      chipClass: string;
      dotClass: string;
    },
  ) => void;
  taskCardContextById?: Record<string, TaskCardContext>;
  emptyColumnMessage?: string;
  onRegisterRef?: (node: HTMLDivElement | null) => void;
}

function KanbanColumn({
  status,
  tasks,
  canEditTasks,
  isAdm = false,
  onAddTask,
  onEditColumn,
  taskCardContextById,
  emptyColumnMessage,
  onRegisterRef,
}: ColumnProps) {
  const isDarkMode = useThemeStore((state) => state.mode === "dark");
  const [isEditOpen, setIsEditOpen] = useState(false);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const canEditColumn =
    isAdm && Boolean(onEditColumn) && status.id !== "status_subtasks";
  const { setNodeRef, isOver } = useDroppable({
    id: status.id,
  });

  // Sortable da COLUNA (id com prefixo "col:" para não conflitar com o drop de cards)
  const {
    setNodeRef: setSortableRef,
    setActivatorNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: COLUMN_DRAG_PREFIX + status.id });

  const sortableStyle = {
    transform: CSS.Translate.toString(transform),
    transition,
  };

  const style = (isDarkMode ? darkStatusStyleMap : lightStatusStyleMap)[
    status.id
  ] ||
    getPresetStyleByDotClass(status.dotClass, isDarkMode) || {
      dot: isDarkMode ? "bg-zinc-300" : "bg-slate-400",
      bg: isDarkMode ? "bg-zinc-500/12" : "bg-slate-50",
      text: isDarkMode ? "text-zinc-100" : "text-slate-900",
      headerBg: isDarkMode
        ? "bg-zinc-500/12 border-(--border-subtle)"
        : "bg-slate-100",
    };

  return (
    <div
      ref={(node) => {
        setSortableRef(node);
        onRegisterRef?.(node);
      }}
      style={sortableStyle}
      className={cn(
        "pauta-kanban-column flex h-full w-[min(88vw,23rem)] shrink-0 snap-start flex-col rounded-2xl transition-all duration-300 sm:w-[20rem] lg:w-70 lg:snap-none",
        isDragging && "z-20 opacity-60",
      )}
    >
      <div
        ref={setNodeRef}
        className={cn(
          "flex h-full flex-col rounded-2xl transition-all duration-300",
          isOver
            ? isDarkMode
              ? "bg-blue-500/8 ring-2 ring-blue-400/20"
              : "bg-slate-100/50 ring-2 ring-blue-500/20"
            : "bg-transparent",
        )}
      >
      <div
        className={cn(
          "pauta-kanban-column-header mb-3 flex shrink-0 items-center justify-between rounded-xl border p-3 transition-all duration-300",
          style.headerBg,
        )}
      >
        <div className="pauta-kanban-column-header-main flex items-center gap-2">
          <button
            type="button"
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            aria-label="Reordenar coluna"
            className={cn(
              "cursor-grab touch-none rounded-md transition-colors active:cursor-grabbing",
              "text-(--ui-texto-apagado) hover:text-(--ui-texto-forte)",
            )}
          >
            <GripVertical className="h-4 w-4" />
          </button>
          <span
            className={cn(
              "h-2.5 w-2.5 rounded-full ring-4 ring-white/80 transition-transform duration-300",
              isDarkMode && "ring-(--bg-surface)",
              style.dot,
            )}
          />
          <h3
            className={cn(
              "text-[13px] font-black tracking-tight",
              "text-(--ui-texto-principal)",
            )}
          >
            {getTaskStatusLabel(status.name)}
          </h3>
        </div>
        <div className="pauta-kanban-column-header-actions flex items-center gap-1.5">
          <span
            className={cn(
              "rounded-lg px-2 py-0.5 text-[10px] font-black ring-1",
              "bg-(--ui-superficie-suave) text-(--ui-texto-secundario) ring-(--ui-borda-suave)",
            )}
          >
            {tasks.length}
          </span>
          {canEditTasks && onAddTask && (
            <button
              type="button"
              onClick={() => onAddTask(status.id)}
              className={cn(
                "cursor-pointer transition-colors",
                "text-(--ui-texto-secundario) hover:text-(--ui-texto-forte)",
              )}
            >
              <Plus className="h-4 w-4" />
            </button>
          )}
          <button
            ref={editButtonRef}
            type="button"
            onClick={canEditColumn ? () => setIsEditOpen((v) => !v) : undefined}
            aria-label={canEditColumn ? "Editar coluna" : undefined}
            className={cn(
              "cursor-pointer transition-colors",
              "text-(--ui-texto-secundario) hover:text-(--ui-texto-forte)",
            )}
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
          {canEditColumn && (
            <ColumnEditPopover
              isOpen={isEditOpen}
              onClose={() => setIsEditOpen(false)}
              anchorRef={editButtonRef}
              initialName={status.name}
              initialDotClass={status.dotClass}
              onSave={(payload) => onEditColumn?.(status.id, payload)}
            />
          )}
        </div>
      </div>

      <SortableContext
        items={tasks.map((t) => t.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="pauta-kanban-column-body min-h-0 flex-1 space-y-2.5 overflow-y-auto overflow-x-hidden px-0.5 pb-2 pr-1 overscroll-contain">
          {tasks.length === 0 ? (
            <div
              className={cn(
                "pauta-kanban-column-empty-placeholder flex h-36 w-full animate-in zoom-in flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 text-center fade-in duration-500",
                isOver
                  ? "scale-[1.02] border-blue-400 bg-(--ui-azul-fundo) text-(--ui-azul-texto)"
                  : "border-(--ui-borda) bg-(--ui-superficie-suave)",
              )}
            >
              <span
                className={cn(
                  "text-[11px] font-black uppercase tracking-[0.2em]",
                  isOver
                    ? "text-blue-500"
                    : "text-(--ui-texto-apagado)",
                )}
              >
                {isOver ? "Solte aqui para mover" : "Coluna vazia"}
              </span>
              {!isOver && (
                <span
                  className={cn(
                    "mt-1.5 text-[10px]",
                    "text-(--ui-texto-secundario)",
                  )}
                >
                  {emptyColumnMessage ||
                    "Arraste um card para começar esta coluna."}
                </span>
              )}
            </div>
          ) : (
            tasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                contextLabel={taskCardContextById?.[task.id]?.label}
                contextSubLabel={taskCardContextById?.[task.id]?.subLabel}
              />
            ))
          )}
        </div>
      </SortableContext>
      </div>
    </div>
  );
}

export function TaskCollectionKanban({
  tasks,
  canEditTasks,
  isAdm = false,
  onAddTask,
  taskCardContextById,
  emptyColumnMessage,
}: TaskCollectionKanbanProps) {
  const graph = useTaskStore((state) => state.graph);
  const selection = useTaskStore((state) => state.selection);
  const currentUser = useTaskStore((state) => state.currentUser);
  const authUser = useAuthStore((state) => state.user);
  const moveTaskToStatus = useTaskStore((state) => state.moveTaskToStatus);
  const reorderTasksInColumn = useTaskStore(
    (state) => state.reorderTasksInColumn,
  );
  const createStatusColumn = useTaskStore((state) => state.createStatusColumn);
  const updateStatusColumn = useTaskStore((state) => state.updateStatusColumn);
  const reorderStatusColumns = useTaskStore(
    (state) => state.reorderStatusColumns,
  );
  const taskSortOrders = useTaskStore((state) => state.taskSortOrders);
  const isDarkMode = useThemeStore((state) => state.mode === "dark");
  const [activeTaskId, setActiveTaskId] = useState<EntityId | null>(null);
  const [activeColumnId, setActiveColumnId] = useState<EntityId | null>(null);
  const [dragPreview, setDragPreview] = useState<{
    taskId: EntityId;
    statusId: EntityId;
  } | null>(null);
  const columnRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const renderedTasks = tasks
    .map((task) =>
      dragPreview?.taskId === task.id
        ? { ...task, statusId: dragPreview.statusId }
        : task,
    )
    .slice()
    .sort((a, b) => {
      const pa = PRIORITY_RANK[a.priority] ?? 99;
      const pb = PRIORITY_RANK[b.priority] ?? 99;
      if (pa !== pb) return pa - pb;
      return (taskSortOrders[a.id] ?? 0) - (taskSortOrders[b.id] ?? 0);
    });
  const orderedStatuses = getStatusesForList(
    graph.statusDefinitions,
    selection.listId,
  );
  const columnSortableIds = orderedStatuses.map(
    (status) => COLUMN_DRAG_PREFIX + status.id,
  );
  const statusColumns = orderedStatuses
    .map((status) => ({
      status,
      tasks: renderedTasks.filter((task) => task.statusId === status.id),
    }))
    .filter(
      ({ status, tasks: columnTasks }) =>
        status.id !== "status_subtasks" || columnTasks.length > 0,
    );

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 180, tolerance: 8 },
    }),
  );

  function userCanMoveTask(task?: Task | null) {
    if (!task) return false;

    return canMoveTask(
      task,
      getWorkspacePermissionForTask(graph, task.id),
      authUser?.id ?? currentUser,
      isAdm,
    );
  }

  function resolveTargetStatusId(
    overId?: string | null,
    activeId?: string | null,
  ) {
    if (!overId) return null;

    if (activeId && overId === activeId) {
      return dragPreview?.taskId === activeId
        ? dragPreview.statusId
        : (graph.tasks[activeId]?.statusId ?? null);
    }

    const overStatus = orderedStatuses.find((status) => status.id === overId);
    if (overStatus) return overStatus.id;

    const overTask = graph.tasks[overId];
    return overTask?.statusId ?? null;
  }

  function handleDragStart(event: DragStartEvent) {
    const activeId = event.active.id as string;

    // Arraste de COLUNA
    if (activeId.startsWith(COLUMN_DRAG_PREFIX)) {
      setActiveColumnId(activeId.slice(COLUMN_DRAG_PREFIX.length));
      return;
    }

    const task = graph.tasks[activeId];
    if (!task || !userCanMoveTask(task)) return;

    setActiveTaskId(activeId);
    setDragPreview({
      taskId: activeId,
      statusId: task.statusId,
    });
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) return;

    const activeId = active.id as string;

    // Arraste de coluna não usa preview de card
    if (activeId.startsWith(COLUMN_DRAG_PREFIX)) return;
    const overId = over.id as string;
    const activeTask = graph.tasks[activeId];
    if (!activeTask || !userCanMoveTask(activeTask)) return;

    if (overId === activeId && dragPreview?.taskId === activeId) {
      return;
    }

    const targetStatusId =
      resolveTargetStatusId(overId, activeId) ?? activeTask.statusId;

    setDragPreview((currentPreview) => {
      if (
        currentPreview?.taskId === activeId &&
        currentPreview.statusId === targetStatusId
      ) {
        return currentPreview;
      }

      return {
        taskId: activeId,
        statusId: targetStatusId,
      };
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    const activeId = active.id as string;
    const overId = over?.id as string | undefined;

    // Arraste de COLUNA: reordena (qualquer usuário, ordem global)
    if (activeId.startsWith(COLUMN_DRAG_PREFIX)) {
      setActiveColumnId(null);
      if (overId && overId.startsWith(COLUMN_DRAG_PREFIX) && overId !== activeId) {
        const oldIndex = columnSortableIds.indexOf(activeId);
        const newIndex = columnSortableIds.indexOf(overId);
        if (oldIndex !== -1 && newIndex !== -1) {
          const reordered = arrayMove(
            orderedStatuses,
            oldIndex,
            newIndex,
          ).map((status) => status.id);
          reorderStatusColumns(reordered);
        }
      }
      return;
    }

    const activeTask = graph.tasks[activeId];

    if (!activeTask || !userCanMoveTask(activeTask)) {
      setActiveTaskId(null);
      setDragPreview(null);
      return;
    }

    const targetStatusId =
      dragPreview?.taskId === activeId
        ? dragPreview.statusId
        : resolveTargetStatusId(overId, activeId);

    if (
      activeTask &&
      targetStatusId &&
      activeTask.statusId !== targetStatusId
    ) {
      // Cross-column: muda o status
      moveTaskToStatus(activeId, targetStatusId);
    } else if (
      isAdm &&
      activeTask &&
      overId &&
      overId !== activeId &&
      graph.tasks[overId]
    ) {
      // Mesma coluna: reordena (apenas ADM, apenas mesma prioridade)
      reorderTasksInColumn(activeId, overId);
    }

    setActiveTaskId(null);
    setDragPreview(null);
  }

  function handleDragCancel() {
    setActiveTaskId(null);
    setActiveColumnId(null);
    setDragPreview(null);
  }

  const activeTask = activeTaskId
    ? dragPreview?.taskId === activeTaskId
      ? { ...graph.tasks[activeTaskId], statusId: dragPreview.statusId }
      : graph.tasks[activeTaskId]
    : null;

  const activeColumn = activeColumnId
    ? orderedStatuses.find((status) => status.id === activeColumnId)
    : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <section
        aria-label="Quadro Kanban"
        className={cn(
          "pauta-kanban-board flex h-full min-h-0 flex-col gap-3",
          isDarkMode && "text-(--text-main)",
        )}
      >
        <div className="shrink-0 space-y-2 lg:hidden">
          <div className="-mx-4 overflow-x-auto overflow-y-hidden px-4 pb-1 sm:mx-0 sm:px-0">
            <div className="flex min-w-max gap-2 pr-4 sm:pr-0">
              {statusColumns.map(({ status, tasks: columnTasks }) => {
                const style = (isDarkMode
                  ? darkStatusStyleMap
                  : lightStatusStyleMap)[status.id] || {
                  dot: isDarkMode ? "bg-zinc-300" : "bg-slate-400",
                };

                return (
                  <button
                    key={status.id}
                    type="button"
                    onClick={() =>
                      columnRefs.current[status.id]?.scrollIntoView({
                        behavior: "smooth",
                        inline: "start",
                        block: "nearest",
                      })
                    }
                    className={cn(
                      "inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-black tracking-tight",
                      "border-(--ui-borda) bg-(--ui-superficie) text-(--ui-texto-forte)",
                    )}
                  >
                    <span className={cn("h-2 w-2 rounded-full", style.dot)} />
                    <span>{getTaskStatusLabel(status.name)}</span>
                    <span
                      className={cn(
                        "rounded-full px-1.5 py-0.5 text-[10px]",
                        "bg-(--ui-fundo-neutro) text-(--ui-texto-secundario)",
                      )}
                    >
                      {columnTasks.length}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center gap-2 px-0 text-[11px] font-semibold">
            <MousePointer2
              className={cn(
                "h-3.5 w-3.5 shrink-0",
                "text-(--ui-texto-secundario)",
              )}
            />
            <span
              className={cn(
                "text-(--ui-texto-secundario)",
              )}
            >
              Deslize entre colunas. Pressione e segure um card para mover.
            </span>
          </div>
        </div>

        <div className="-mx-4 min-h-0 flex-1 overflow-x-auto overflow-y-hidden px-4 pb-2 sm:mx-0 sm:px-0">
          <div className="pauta-kanban-columns flex h-full min-w-max gap-3 scroll-px-4 lg:gap-4">
            <SortableContext
              items={columnSortableIds}
              strategy={horizontalListSortingStrategy}
            >
              {statusColumns.map(({ status, tasks: columnTasks }) => (
                <KanbanColumn
                  key={status.id}
                  status={status}
                  tasks={columnTasks}
                  canEditTasks={canEditTasks}
                  isAdm={isAdm}
                  onAddTask={onAddTask}
                  onEditColumn={updateStatusColumn}
                  taskCardContextById={taskCardContextById}
                  emptyColumnMessage={emptyColumnMessage}
                  onRegisterRef={(node) => {
                    columnRefs.current[status.id] = node;
                  }}
                />
              ))}
            </SortableContext>

            {isAdm && selection.listId && (
              <ColumnCreatePopover
                onCreate={(payload) =>
                  createStatusColumn(selection.listId as EntityId, payload)
                }
              />
            )}
          </div>
        </div>
      </section>

      <DragOverlay dropAnimation={dropAnimation}>
        {activeTask ? (
          <div className="scale-[1.02] drop-shadow-2xl">
            <DragPreviewCard
              task={activeTask}
              context={taskCardContextById?.[activeTask.id]}
            />
          </div>
        ) : activeColumn ? (
          <div
            className={cn(
              "flex items-center gap-2 rounded-xl border px-4 py-3 shadow-2xl",
              "border-(--ui-azul-borda) bg-(--ui-superficie) text-(--ui-texto-principal)",
            )}
          >
            <GripVertical className="h-4 w-4 opacity-60" />
            <span
              className={cn(
                "h-2.5 w-2.5 rounded-full",
                ((isDarkMode ? darkStatusStyleMap : lightStatusStyleMap)[
                  activeColumn.id
                ] ||
                  getPresetStyleByDotClass(activeColumn.dotClass, isDarkMode))
                  ?.dot || "bg-slate-400",
              )}
            />
            <span className="text-[13px] font-black tracking-tight">
              {getTaskStatusLabel(activeColumn.name)}
            </span>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
