import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Bell,
  Calendar,
  Check,
  ChevronRight,
  Copy,
  FileText,
  Flag,
  Link2,
  MessageSquare,
  MoreHorizontal,
  MoveRight,
  Paperclip,
  Trash2,
} from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { ConfirmationModal } from "../../../components/ui/confirmation-modal";
import { UserAvatar } from "../../../components/ui/user-avatar";
import { buildAssetUrl } from "../../../lib/api";
import { getStatusesForList } from "../../../lib/status-columns";
import { cn } from "../../../lib/utils";
import {
  canMoveTask,
  getWorkspacePermissionForTask,
  hasWorkspacePermission,
} from "../../../lib/workspace-permissions";
import { useAuthStore } from "../../../store/use-auth-store";
import { useTaskStore } from "../../../store/use-task-store";
import { useThemeStore } from "../../../store/use-theme-store";
import type { Task, TaskPriority } from "../../../types/tasks";
import { toast } from "../../../store/use-toast-store";

const PRIORITY_OPTIONS: TaskPriority[] = ["urgent", "high", "medium", "low"];

interface TaskCardProps {
  task: Task;
  contextLabel?: string;
  contextSubLabel?: string;
}

const lightPriorityConfig: Record<
  TaskPriority,
  { label: string; bg: string; text: string; dot: string; headerBg: string }
> = {
  urgent: {
    label: "Urgente",
    bg: "bg-rose-100",
    text: "text-rose-700",
    dot: "bg-rose-600",
    headerBg: "bg-rose-50/50",
  },
  high: {
    label: "Alta",
    bg: "bg-amber-100",
    text: "text-amber-700",
    dot: "bg-amber-600",
    headerBg: "bg-amber-50/50",
  },
  medium: {
    label: "Média",
    bg: "bg-orange-100",
    text: "text-orange-700",
    dot: "bg-orange-600",
    headerBg: "bg-orange-50/50",
  },
  low: {
    label: "Baixa",
    bg: "bg-emerald-100",
    text: "text-emerald-700",
    dot: "bg-emerald-600",
    headerBg: "bg-emerald-50/50",
  },
};

const darkPriorityConfig: Record<
  TaskPriority,
  { label: string; bg: string; text: string; dot: string; headerBg: string }
> = {
  urgent: {
    label: "Urgente",
    bg: "bg-rose-500/12",
    text: "text-rose-200",
    dot: "bg-rose-300",
    headerBg: "bg-rose-500/10",
  },
  high: {
    label: "Alta",
    bg: "bg-amber-500/12",
    text: "text-amber-200",
    dot: "bg-amber-300",
    headerBg: "bg-amber-500/10",
  },
  medium: {
    label: "Média",
    bg: "bg-orange-500/12",
    text: "text-orange-200",
    dot: "bg-orange-300",
    headerBg: "bg-orange-500/10",
  },
  low: {
    label: "Baixa",
    bg: "bg-emerald-500/12",
    text: "text-emerald-200",
    dot: "bg-emerald-300",
    headerBg: "bg-emerald-500/10",
  },
};

function stripRichText(value?: string | null) {
  return (value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatCardDate(value?: string | null) {
  if (!value) return "---";
  return new Date(value).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatCardShortDate(value?: string | null) {
  if (!value) return null;
  return new Date(value).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
  });
}

function formatScheduleLabel(
  startDate?: string | null,
  dueDate?: string | null,
) {
  const start = formatCardShortDate(startDate);
  const due = formatCardShortDate(dueDate);

  if (start && due) return `${start} - ${due}`;
  return due || start;
}

function formatEstimateLabel(estimate?: string | null) {
  if (!estimate) return null;
  return estimate.replace(/(\d+)m/g, "$1 min");
}

export function TaskCard({
  task,
  contextLabel,
  contextSubLabel,
}: TaskCardProps) {
  const authUser = useAuthStore((state) => state.user);
  const currentUser = useTaskStore((state) => state.currentUser);
  const members = useTaskStore((state) => state.graph.members);
  const list = useTaskStore((state) => state.graph.lists[task.listId]);
  const workspace = useTaskStore(
    (state) => state.graph.workspaces[task.workspaceId],
  );
  const openTaskDetails = useTaskStore((state) => state.openTaskDetails);
  const deleteTask = useTaskStore((state) => state.deleteTask);
  const duplicateTask = useTaskStore((state) => state.duplicateTask);
  const toggleTaskWatcher = useTaskStore((state) => state.toggleTaskWatcher);
  const moveTaskToStatus = useTaskStore((state) => state.moveTaskToStatus);
  const updateTaskPriority = useTaskStore((state) => state.updateTaskPriority);
  const statusDefinitions = useTaskStore(
    (state) => state.graph.statusDefinitions,
  );
  const commentsByTaskId = useTaskStore((state) => state.commentsByTaskId);
  const isDarkMode = useThemeStore((state) => state.mode === "dark");
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [openSubmenu, setOpenSubmenu] = useState<"move" | "priority" | null>(
    null,
  );
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [isDuplicating, setIsDuplicating] = useState(false);
  const [isTogglingWatcher, setIsTogglingWatcher] = useState(false);
  const [submenuSide, setSubmenuSide] = useState<"right" | "left">("right");
  const [menuPosition, setMenuPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuPanelRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const permission = useTaskStore((state) =>
    getWorkspacePermissionForTask(state.graph, task.id),
  );
  const canEditTask = hasWorkspacePermission(permission, "edit");
  const canMoveTaskStatus = canMoveTask(
    task,
    permission,
    authUser?.id ?? currentUser,
    authUser?.organization?.role === "owner" ||
      authUser?.organization?.role === "admin",
  );

  const menuItemClass = cn(
    "mx-1 flex w-[calc(100%-0.5rem)] cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] font-medium transition-colors",
    "hover:bg-(--ui-hover-forte)",
  );
  const menuItemActiveClass = "bg-(--ui-fundo-neutro)";

  const currentUserId = authUser?.id ?? currentUser;
  const isWatchingTask = Boolean(
    currentUserId && (task.watcherIds || []).includes(currentUserId),
  );
  const listStatuses = getStatusesForList(statusDefinitions, task.listId);

  useEffect(() => {
    if (!isMenuOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        !menuRef.current?.contains(target) &&
        !menuPanelRef.current?.contains(target)
      ) {
        setIsMenuOpen(false);
        setOpenSubmenu(null);
      }
    };

    // O card tem overflow-hidden, entao o menu vive em portal com posicao fixa:
    // fechar em scroll/resize evita que ele fique solto longe do botao.
    const handleViewportChange = () => {
      setIsMenuOpen(false);
      setOpenSubmenu(null);
    };

    document.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("scroll", handleViewportChange, true);
    window.addEventListener("resize", handleViewportChange);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("scroll", handleViewportChange, true);
      window.removeEventListener("resize", handleViewportChange);
    };
  }, [isMenuOpen]);

  async function handleToggleWatcher() {
    if (isTogglingWatcher) return;

    setIsTogglingWatcher(true);
    try {
      await toggleTaskWatcher(task.id);
    } finally {
      setIsTogglingWatcher(false);
    }
  }

  function closeCardMenu() {
    setIsMenuOpen(false);
    setOpenSubmenu(null);
  }

  const MENU_WIDTH = 208;
  const SUBMENU_WIDTH = 208;

  function openCardMenu() {
    const rect = menuButtonRef.current?.getBoundingClientRect();
    if (!rect) return;

    const left = Math.min(
      Math.max(8, rect.right - MENU_WIDTH),
      window.innerWidth - MENU_WIDTH - 8,
    );
    const spaceOnRight = window.innerWidth - (left + MENU_WIDTH);

    setMenuPosition({ top: rect.bottom + 4, left });
    setSubmenuSide(spaceOnRight >= SUBMENU_WIDTH + 12 ? "right" : "left");
    setOpenSubmenu(null);
    setIsMenuOpen(true);
  }

  function buildTaskShareUrl() {
    const url = new URL(window.location.origin);
    url.searchParams.set("workspaceId", task.workspaceId);
    url.searchParams.set("listId", task.listId);
    url.searchParams.set("taskId", task.id);
    return url.toString();
  }

  async function handleCopyTaskLink() {
    const shareUrl = buildTaskShareUrl();

    try {
      await navigator.clipboard.writeText(shareUrl);
    } catch {
      const helper = document.createElement("textarea");
      helper.value = shareUrl;
      helper.style.position = "fixed";
      helper.style.opacity = "0";
      document.body.appendChild(helper);
      helper.select();
      document.execCommand("copy");
      document.body.removeChild(helper);
    }

    setCopyFeedback(true);
    toast.success("Link do card copiado.", { message: task.title });
    window.setTimeout(() => setCopyFeedback(false), 1600);
  }

  async function handleDuplicateTask() {
    if (isDuplicating) return;
    setIsDuplicating(true);
    try {
      await duplicateTask(task.id);
    } finally {
      setIsDuplicating(false);
      closeCardMenu();
    }
  }

  const assignees = task.assigneeIds
    .map((memberId) => members[memberId])
    .filter(Boolean);
  const priority = (isDarkMode ? darkPriorityConfig : lightPriorityConfig)[
    task.priority
  ];

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id, disabled: !canMoveTaskStatus });

  const dndStyle = {
    transform: CSS.Transform.toString(transform),
    transition: transition ?? "transform 200ms ease",
    touchAction: canMoveTaskStatus
      ? ("manipulation" as const)
      : ("auto" as const),
  };

  const attachmentCount = task.attachments?.length || 0;
  const commentCount = commentsByTaskId[task.id]?.length || 0;
  const coverAttachment =
    task.coverAttachmentId && task.attachments?.length
      ? (task.attachments.find(
          (attachment) =>
            attachment.id === task.coverAttachmentId &&
            attachment.type === "image" &&
            Boolean(attachment.url),
        ) ?? null)
      : null;

  const descriptionText = stripRichText(task.description?.value);
  const hasCardContext = Boolean(
    contextLabel || contextSubLabel || task.parentTaskId,
  );
  const cardSizeClass = coverAttachment
    ? hasCardContext
      ? "min-h-[20rem] sm:min-h-[22.75rem]"
      : "min-h-[18.75rem] sm:min-h-[21.25rem]"
    : hasCardContext
      ? "min-h-[13.75rem] sm:min-h-[15.75rem]"
      : "min-h-[12.75rem] sm:min-h-[14.75rem]";
  const coverHeightClass = hasCardContext
    ? "h-32 sm:h-[9.75rem]"
    : "h-28 sm:h-[9.25rem]";
  const createdAtLabel = formatCardDate(task.createdAt);
  const scheduleLabel = formatScheduleLabel(task.startDate, task.dueDate);
  const estimateLabel = formatEstimateLabel(task.estimate);
  const projectLabel = contextLabel || list?.name;
  const workspaceLabel = contextSubLabel || workspace?.name;

  if (isDragging) {
    return (
      <div
        ref={setNodeRef}
        style={dndStyle}
        className={cn(
          cardSizeClass,
          "w-full shrink-0 rounded-2xl border-2 border-dashed select-none transition-colors",
          "border-(--ui-azul-borda) bg-(--ui-azul-fundo)",
        )}
      />
    );
  }

  return (
    <article
      ref={setNodeRef}
      // O tour do primeiro acesso destaca o card de boas-vindas no passo final.
      data-tour={task.title?.startsWith("Bem-vindo ao Pauta") ? "welcome-card" : undefined}
      style={dndStyle}
      {...(canMoveTaskStatus ? attributes : {})}
      {...(canMoveTaskStatus ? listeners : {})}
      onClick={() => {
        if (!isDragging) {
          openTaskDetails(task.id);
        }
      }}
      className={cn(
        "pauta-task-card group relative flex flex-col overflow-hidden rounded-2xl border transition-all duration-200 select-none",
        cardSizeClass,
        isDarkMode
          ? "border-(--border-subtle) bg-(--bg-elevated) hover:border-blue-500/40 hover:shadow-(--shadow-soft)"
          : "border-slate-200 bg-white hover:border-blue-400",
        "cursor-pointer active:scale-[0.99] lg:active:scale-100",
        canMoveTaskStatus && "cursor-grab active:cursor-grabbing",
      )}
    >
      {coverAttachment && (
        <div
          className={cn(
            "relative w-full shrink-0 overflow-hidden border-b",
            coverHeightClass,
            "border-(--ui-borda-suave)",
          )}
        >
          <img
            src={buildAssetUrl(coverAttachment.url)}
            alt={`Capa de ${task.title}`}
            className="h-full w-full object-cover object-center"
            loading="lazy"
          />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/5 via-black/0 to-black/20" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-black/20 to-transparent" />
        </div>
      )}

      <div
        className={cn(
          "pauta-task-card-header flex shrink-0 items-center justify-between border-b px-3 py-2 sm:px-4 sm:py-2.5",
          "border-(--ui-borda-suave)",
          priority.headerBg,
        )}
      >
        <div className="flex min-w-0 items-center gap-1.5">
          <div
            className={cn(
              "pauta-task-card-priority-pill flex items-center gap-1.5 rounded-full border border-current/10 px-2 py-0.5 text-[8px] font-black uppercase tracking-[0.16em] sm:px-2.5 sm:py-1 sm:text-[9px]",
              priority.bg,
              priority.text,
            )}
          >
            <Flag className="h-3 w-3 shrink-0" />
            {priority.label}
          </div>
        </div>

        <div
          className={cn(
            "flex items-center gap-1 transition-opacity",
            isWatchingTask || isMenuOpen
              ? "opacity-100"
              : "opacity-0 group-hover:opacity-100",
          )}
        >
          <button
            type="button"
            disabled={isTogglingWatcher}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              void handleToggleWatcher();
            }}
            title={
              isWatchingTask
                ? "Deixar de seguir este card"
                : "Seguir este card e receber notificações"
            }
            className={cn(
              "cursor-pointer p-1 transition-colors disabled:cursor-wait",
              isWatchingTask
                ? "text-(--ui-azul-texto)"
                : "text-(--ui-texto-secundario) hover:text-(--ui-azul-texto)",
            )}
          >
            <Bell
              className="h-3.5 w-3.5"
              fill={isWatchingTask ? "currentColor" : "none"}
            />
          </button>

          <div className="relative" ref={menuRef}>
            <button
              ref={menuButtonRef}
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                if (isMenuOpen) {
                  closeCardMenu();
                  return;
                }
                openCardMenu();
              }}
              title="Mais ações"
              className={cn(
                "cursor-pointer p-1 transition-colors",
                isMenuOpen
                  ? "text-(--ui-texto-forte)"
                  : "text-(--ui-texto-secundario) hover:text-(--ui-texto-forte)",
              )}
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>

            {isMenuOpen &&
              menuPosition &&
              createPortal(
                <div
                  ref={menuPanelRef}
                  style={{ top: menuPosition.top, left: menuPosition.left }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                  className={cn(
                    "fixed z-200 w-52 rounded-xl border py-1 text-left shadow-xl",
                    "border-(--ui-borda) bg-(--ui-superficie)",
                  )}
                >
                  {canMoveTaskStatus && listStatuses.length > 0 && (
                    <div
                      className="relative"
                      onMouseEnter={() => setOpenSubmenu("move")}
                      onMouseLeave={() => setOpenSubmenu(null)}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setOpenSubmenu((current) =>
                            current === "move" ? null : "move",
                          )
                        }
                        className={cn(
                          menuItemClass,
                          "justify-between",
                          openSubmenu === "move" && menuItemActiveClass,
                        )}
                      >
                        <span className="flex items-center gap-2">
                          <MoveRight className="h-3.5 w-3.5" />
                          Mover
                        </span>
                        <ChevronRight className="h-3.5 w-3.5 opacity-70" />
                      </button>

                      {openSubmenu === "move" && (
                        <div
                          className={cn(
                            "absolute top-0 z-201",
                            submenuSide === "right"
                              ? "left-full pl-1"
                              : "right-full pr-1",
                          )}
                        >
                          <div
                            className={cn(
                              "max-h-64 w-52 overflow-y-auto rounded-xl border py-1 shadow-xl",
                              "border-(--ui-borda) bg-(--ui-superficie)",
                            )}
                          >
                            {listStatuses.map((status) => {
                              const isCurrentStatus =
                                status.id === task.statusId;

                              return (
                                <button
                                  key={status.id}
                                  type="button"
                                  disabled={isCurrentStatus}
                                  onClick={() => {
                                    void moveTaskToStatus(task.id, status.id);
                                    closeCardMenu();
                                  }}
                                  className={cn(
                                    menuItemClass,
                                    "justify-between disabled:cursor-default disabled:opacity-60",
                                  )}
                                >
                                  <span className="flex min-w-0 items-center gap-2">
                                    <span
                                      className={cn(
                                        "h-2 w-2 shrink-0 rounded-full",
                                        status.dotClass || "bg-slate-400",
                                      )}
                                    />
                                    <span className="truncate">
                                      {status.name}
                                    </span>
                                  </span>
                                  {isCurrentStatus && (
                                    <Check className="h-3.5 w-3.5 shrink-0 opacity-70" />
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {canEditTask && (
                    <div
                      className="relative"
                      onMouseEnter={() => setOpenSubmenu("priority")}
                      onMouseLeave={() => setOpenSubmenu(null)}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setOpenSubmenu((current) =>
                            current === "priority" ? null : "priority",
                          )
                        }
                        className={cn(
                          menuItemClass,
                          "justify-between",
                          openSubmenu === "priority" && menuItemActiveClass,
                        )}
                      >
                        <span className="flex items-center gap-2">
                          <Flag className="h-3.5 w-3.5" />
                          Prioridade
                        </span>
                        <ChevronRight className="h-3.5 w-3.5 opacity-70" />
                      </button>

                      {openSubmenu === "priority" && (
                        <div
                          className={cn(
                            "absolute top-0 z-201",
                            submenuSide === "right"
                              ? "left-full pl-1"
                              : "right-full pr-1",
                          )}
                        >
                          <div
                            className={cn(
                              "w-44 rounded-xl border py-1 shadow-xl",
                              "border-(--ui-borda) bg-(--ui-superficie)",
                            )}
                          >
                            {PRIORITY_OPTIONS.map((option) => {
                              const optionConfig = (
                                isDarkMode
                                  ? darkPriorityConfig
                                  : lightPriorityConfig
                              )[option];
                              const isCurrentPriority =
                                option === task.priority;

                              return (
                                <button
                                  key={option}
                                  type="button"
                                  disabled={isCurrentPriority}
                                  onClick={() => {
                                    void updateTaskPriority(task.id, option);
                                    closeCardMenu();
                                  }}
                                  className={cn(
                                    menuItemClass,
                                    "justify-between disabled:cursor-default disabled:opacity-60",
                                  )}
                                >
                                  <span className="flex items-center gap-2">
                                    <span
                                      className={cn(
                                        "h-2 w-2 rounded-full",
                                        optionConfig.dot,
                                      )}
                                    />
                                    {optionConfig.label}
                                  </span>
                                  {isCurrentPriority && (
                                    <Check className="h-3.5 w-3.5 opacity-70" />
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  <button
                    type="button"
                    onMouseEnter={() => setOpenSubmenu(null)}
                    onClick={() => void handleCopyTaskLink()}
                    className={menuItemClass}
                  >
                    <Link2 className="h-3.5 w-3.5" />
                    {copyFeedback ? "Link copiado!" : "Copiar link"}
                  </button>

                  {canEditTask && (
                    <button
                      type="button"
                      disabled={isDuplicating}
                      onMouseEnter={() => setOpenSubmenu(null)}
                      onClick={() => void handleDuplicateTask()}
                      className={cn(
                        menuItemClass,
                        "disabled:cursor-default disabled:opacity-60",
                      )}
                    >
                      <Copy className="h-3.5 w-3.5" />
                      {isDuplicating ? "Duplicando..." : "Duplicar card"}
                    </button>
                  )}

                  {canEditTask && (
                    <button
                      type="button"
                      onMouseEnter={() => setOpenSubmenu(null)}
                      onClick={() => {
                        closeCardMenu();
                        setIsConfirmOpen(true);
                      }}
                      className={cn(
                        menuItemClass,
                        "text-(--ui-rose-texto) hover:bg-(--ui-rose-fundo)",
                      )}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Excluir card
                    </button>
                  )}
                </div>,
                document.body,
              )}
          </div>
        </div>
      </div>

      <div
        className={cn(
          "pauta-task-card-body flex min-h-0 flex-1 flex-col gap-2 p-3 sm:gap-2.5 sm:p-3.5",
          "bg-(--ui-superficie)",
        )}
      >
        <h3
          className={cn(
            "pauta-task-card-title line-clamp-2 text-[14px] font-black leading-[1.18] sm:text-[15px]",
            "text-(--ui-texto-principal) transition-colors group-hover:text-(--ui-azul-texto)",
          )}
        >
          {task.title}
        </h3>

        {(workspaceLabel || projectLabel || task.parentTaskId) && (
          <div className="flex flex-wrap gap-1.5">
            {workspaceLabel && (
              <span
                className={cn(
                  "inline-flex max-w-full items-center rounded-full border px-2 py-1 text-[9px] font-semibold leading-none sm:px-2.5 sm:text-[10px]",
                  "border-(--ui-verde-borda) bg-(--ui-verde-fundo) text-(--ui-verde-texto)",
                )}
              >
                <span className="truncate">{workspaceLabel}</span>
              </span>
            )}

            {projectLabel && (
              <span
                className={cn(
                  "inline-flex max-w-full items-center rounded-full border px-2 py-1 text-[9px] font-semibold leading-none sm:px-2.5 sm:text-[10px]",
                  "border-(--ui-azul-borda) bg-(--ui-azul-fundo) text-(--ui-azul-texto)",
                )}
              >
                <span className="truncate">{projectLabel}</span>
              </span>
            )}

            {task.parentTaskId && (
              <span
                className={cn(
                  "inline-flex max-w-full items-center rounded-full border px-2 py-1 text-[9px] font-semibold leading-none sm:px-2.5 sm:text-[10px]",
                  isDarkMode
                    ? "border-violet-500/20 bg-violet-500/12 text-violet-200"
                    : "border-violet-100 bg-violet-50 text-violet-700",
                )}
              >
                <span className="truncate">Subtarefa</span>
              </span>
            )}
          </div>
        )}

        {(scheduleLabel || estimateLabel) && (
          <div className="flex flex-wrap gap-1.5">
            {scheduleLabel && (
              <span
                className={cn(
                  "inline-flex max-w-full items-center rounded-full border px-2 py-1 text-[9px] font-semibold leading-none sm:px-2.5 sm:text-[10px]",
                  "border-(--ui-ambar-borda) bg-(--ui-ambar-fundo) text-(--ui-ambar-texto)",
                )}
              >
                <span className="truncate">{scheduleLabel}</span>
              </span>
            )}

            {estimateLabel && (
              <span
                className={cn(
                  "inline-flex max-w-full items-center rounded-full border px-2 py-1 text-[9px] font-semibold leading-none sm:px-2.5 sm:text-[10px]",
                  isDarkMode
                    ? "border-cyan-500/20 bg-cyan-500/12 text-cyan-200"
                    : "border-cyan-100 bg-cyan-50 text-cyan-700",
                )}
              >
                <span className="truncate">{estimateLabel}</span>
              </span>
            )}
          </div>
        )}

        <div className="mt-auto flex items-center gap-2 pt-1">
          {descriptionText ? (
            <FileText
              className={cn(
                "h-4 w-4 shrink-0",
                "text-(--ui-texto-secundario)",
              )}
            />
          ) : null}

          <div
            className={cn(
              "flex items-center gap-1.5 text-[10px] font-semibold",
              "text-(--ui-texto-secundario)",
            )}
          >
            <Calendar className="h-3.5 w-3.5 shrink-0" />
            <span>{createdAtLabel}</span>
          </div>
        </div>
      </div>

      <div
        className={cn(
          "pauta-task-card-footer flex shrink-0 flex-wrap items-center justify-between gap-2 border-t px-3 py-2.5 sm:px-4 sm:py-3",
          "border-(--ui-borda-suave) bg-(--ui-fundo-sutil)",
        )}
      >
        <div className="pauta-task-card-assignees flex -space-x-2">
          {assignees.map((member) => (
            <UserAvatar key={member.id} member={member} size={24} />
          ))}
        </div>

        <div
          className={cn(
            "pauta-task-card-metadata flex items-center gap-1.5",
            "text-(--ui-texto-secundario)",
          )}
        >
          <div
            className={cn(
              "pauta-task-card-attachments flex cursor-pointer items-center gap-1.5 rounded-full border px-2 py-1 transition-colors sm:px-2.5",
              "border-(--ui-borda) bg-(--ui-superficie) hover:text-(--ui-texto-forte)",
            )}
          >
            <Paperclip className="h-3.5 w-3.5" />
            <span className="text-[10px] font-black">{attachmentCount}</span>
          </div>

          <div
            className={cn(
              "pauta-task-card-comments flex cursor-pointer items-center gap-1.5 rounded-full border px-2 py-1 transition-colors sm:px-2.5",
              "border-(--ui-borda) bg-(--ui-superficie) hover:text-(--ui-texto-forte)",
            )}
          >
            <MessageSquare className="h-3.5 w-3.5" />
            <span className="text-[10px] font-black">{commentCount}</span>
          </div>
        </div>
      </div>

      <ConfirmationModal
        isOpen={isConfirmOpen}
        onClose={() => setIsConfirmOpen(false)}
        onConfirm={() => deleteTask(task.id)}
        title="Excluir card"
        message="Deseja excluir este card? Ele vai para a lixeira e pode ser restaurado dentro do prazo do seu plano."
        confirmLabel="Excluir"
        pendingLabel="Excluindo..."
      />
    </article>
  );
}
