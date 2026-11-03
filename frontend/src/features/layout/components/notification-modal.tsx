import { useThemeStore } from "../../../store/use-theme-store";
import {
  X,
  CheckCheck,
  BellRing,
  Briefcase,
  ListTodo,
  Building2,
  MessageSquare,
  CalendarClock,
  Paperclip,
  Link2,
  ChevronRight,
} from "lucide-react";
import { createPortal } from "react-dom";
import { useEffect, useLayoutEffect, useState, type RefObject } from "react";

import { useTaskStore } from "../../../store/use-task-store";
import type { TaskNotification } from "../../../store/use-task-store";
import { buildAssetUrl } from "../../../lib/api";
import { formatRelativeTimestamp } from "../../../lib/attachment-utils";
import { navigateFromNotificationUrl } from "../../../lib/notification-navigation";
import { cn, getInitials } from "../../../lib/utils";
import { useFecharComEsc } from "../../../lib/use-fechar-com-esc";

interface NotificationModalProps {
  isOpen: boolean;
  onClose: () => void;
  anchored?: boolean;
  className?: string;
  anchorRef?: RefObject<HTMLElement | null>;
}

const typeConfig = {
  TASK_ASSIGNED: {
    icon: ListTodo,
    bg: "bg-amber-100",
    text: "text-amber-600",
    label: "Tarefa",
    rail: "bg-amber-400",
    severity: "medium",
  },
  TASK_STATUS_CHANGED: {
    icon: CheckCheck,
    bg: "bg-emerald-100",
    text: "text-emerald-600",
    label: "Movimentação",
    rail: "bg-emerald-400",
    severity: "low",
  },
  TASK_DUE_DATE_CHANGED: {
    icon: CalendarClock,
    bg: "bg-rose-100",
    text: "text-rose-600",
    label: "Prazo",
    rail: "bg-rose-500",
    severity: "high",
  },
  TASK_ATTACHMENT_ADDED: {
    icon: Paperclip,
    bg: "bg-cyan-100",
    text: "text-cyan-700",
    label: "Anexo",
    rail: "bg-cyan-500",
    severity: "low",
  },
  TASK_LINKED: {
    icon: Link2,
    bg: "bg-slate-100",
    text: "text-slate-700",
    label: "Vínculo",
    rail: "bg-slate-400",
    severity: "low",
  },
  TASK_UNLINKED: {
    icon: Link2,
    bg: "bg-orange-100",
    text: "text-orange-700",
    label: "Vínculo",
    rail: "bg-orange-500",
    severity: "low",
  },
  CHECKLIST_ITEM_ASSIGNED: {
    icon: CheckCheck,
    bg: "bg-lime-100",
    text: "text-lime-700",
    label: "Checklist",
    rail: "bg-lime-500",
    severity: "medium",
  },
  SUBTASK_CREATED: {
    icon: ListTodo,
    bg: "bg-violet-100",
    text: "text-violet-600",
    label: "Subtarefa",
    rail: "bg-violet-500",
    severity: "low",
  },
  LIST_ASSIGNED: {
    icon: Briefcase,
    bg: "bg-indigo-100",
    text: "text-indigo-600",
    label: "Projeto",
    rail: "bg-indigo-500",
    severity: "medium",
  },
  WORKSPACE_ASSIGNED: {
    icon: Building2,
    bg: "bg-blue-100",
    text: "text-blue-600",
    label: "Workspace",
    rail: "bg-blue-500",
    severity: "medium",
  },
  comment: {
    icon: MessageSquare,
    bg: "bg-sky-100",
    text: "text-sky-600",
    label: "Comentário",
    rail: "bg-sky-500",
    severity: "medium",
  },
  mention: {
    icon: ListTodo,
    bg: "bg-amber-100",
    text: "text-amber-600",
    label: "Menção",
    rail: "bg-amber-500",
    severity: "high",
  },
  assign: {
    icon: ListTodo,
    bg: "bg-amber-100",
    text: "text-amber-600",
    label: "Atribuição",
    rail: "bg-amber-500",
    severity: "medium",
  },
} as const;

function getSeverityPresentation(severity: "high" | "medium" | "low") {
  switch (severity) {
    case "high":
      return {
        label: "Alta atenção",
        className: "bg-(--ui-rose-fundo) text-(--ui-rose-texto)",
      };
    case "medium":
      return {
        label: "Ação",
        className: "bg-(--ui-ambar-fundo) text-(--ui-ambar-texto)",
      };
    default:
      return {
        label: "Atualização",
        className: "bg-(--ui-fundo-neutro) text-(--ui-texto-forte)",
      };
  }
}

function AssignerAvatar({
  name,
  color,
  avatarUrl,
}: {
  name?: string;
  color?: string;
  avatarUrl?: string | null;
}) {
  if (!name) return null;

  return avatarUrl ? (
    <img
      src={buildAssetUrl(avatarUrl)}
      onError={(event) => {
        event.currentTarget.style.display = "none";
      }}
      alt={name}
      className="h-4 w-4 shrink-0 rounded-full object-cover ring-1 ring-white"
    />
  ) : (
    <div
      className={cn(
        "flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[7px] font-black text-white ring-1 ring-white",
        color || "bg-slate-400",
      )}
    >
      {getInitials(name)}
    </div>
  );
}

function NotificationCard({
  notif,
  index,
  onClick,
}: {
  notif: TaskNotification;
  index: number;
  onClick: () => void;
}) {
  const isDarkMode = useThemeStore((state) => state.mode === "dark");
  const cfg = typeConfig[notif.type] ?? typeConfig.TASK_ASSIGNED;
  const Icon = cfg.icon;
  const severity = getSeverityPresentation(cfg.severity);

  const timeAgo = formatRelativeTimestamp(notif.createdAt);

  return (
    <button
      onClick={onClick}
      style={{
        animationDelay: `${index * 45}ms`,
        animationFillMode: "backwards",
      }}
      className={cn(
        "group relative flex w-full animate-in slide-in-from-top-2 fade-in items-start gap-3 overflow-hidden rounded-3xl border px-4 py-3.5 text-left transition-all duration-500 cursor-pointer hover:-translate-y-0.5",
        notif.read
          ? "border-transparent bg-(--ui-superficie-suave) hover:border-(--ui-borda) hover:bg-(--ui-hover)"
          : isDarkMode
            ? "border-blue-500/15 bg-[linear-gradient(135deg,rgba(59,130,246,0.14),rgba(14,165,233,0.04))] shadow-(--shadow-soft) hover:border-blue-400/30"
            : "border-sky-100 bg-[linear-gradient(135deg,#ffffff_0%,#f6fbff_100%)] shadow-[0_20px_50px_-30px_rgba(14,165,233,0.5)] hover:border-sky-200",
      )}
    >
      <div
        className={cn(
          "absolute bottom-3 left-0 top-3 w-1 rounded-r-full",
          cfg.rail,
        )}
      />
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 h-px opacity-70",
          isDarkMode
            ? "bg-linear-to-r from-transparent via-blue-400/50 to-transparent"
            : "bg-linear-to-r from-transparent via-sky-300 to-transparent",
        )}
      />
      <div
        className={cn(
          "mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl shadow-inner",
          cfg.bg,
        )}
      >
        <Icon className={cn("h-4 w-4", cfg.text)} strokeWidth={2.5} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="mb-1.5 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "inline-flex items-center rounded-full px-2 py-1 text-[9px] font-black uppercase tracking-[0.22em]",
                  cfg.bg,
                  cfg.text,
                )}
              >
                {cfg.label}
              </span>

              {!notif.read && (
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2 py-1 text-[9px] font-black uppercase tracking-[0.22em]",
                    "bg-(--ui-azul-fundo) text-(--ui-azul-texto)",
                  )}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
                  Nova
                </span>
              )}

              <span
                className={cn(
                  "inline-flex items-center rounded-full px-2 py-1 text-[9px] font-black uppercase tracking-[0.18em]",
                  severity.className,
                )}
              >
                {severity.label}
              </span>
            </div>

            <p
              className={cn(
                "mt-2 truncate text-[13px] font-bold",
                "text-(--ui-texto-principal)",
              )}
            >
              {notif.title}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {timeAgo && (
              <span
                className={cn(
                  "shrink-0 text-[9px] font-bold uppercase tracking-[0.2em]",
                  "text-(--ui-texto-secundario)",
                )}
              >
                {timeAgo}
              </span>
            )}
            <ChevronRight
              className={cn(
                "h-4 w-4 shrink-0 transition-transform group-hover:translate-x-0.5",
                "text-(--ui-texto-apagado)",
              )}
              strokeWidth={2.4}
            />
          </div>
        </div>

        <p
          className={cn(
            "text-[12px] leading-snug",
            "text-(--ui-texto-secundario)",
          )}
        >
          {notif.message}
        </p>

        {notif.assignerName && (
          <div className="mt-1.5 flex items-center gap-1.5">
            <AssignerAvatar
              name={notif.assignerName}
              color={notif.assignerAvatarColor}
              avatarUrl={notif.assignerAvatarUrl}
            />
            <span
              className={cn(
                "truncate text-[10px]",
                "text-(--ui-texto-secundario)",
              )}
            >
              <span
                className={cn(
                  "font-semibold",
                  "text-(--ui-texto-secundario)",
                )}
              >
                {notif.assignerName}
              </span>
              {" gerou esta notificação"}
            </span>
          </div>
        )}
      </div>
    </button>
  );
}

export function NotificationModal({
  isOpen,
  onClose,
  anchored = false,
  className,
  anchorRef,
}: NotificationModalProps) {
  const notifications = useTaskStore((state) => state.notifications);
  const graph = useTaskStore((state) => state.graph);
  const openTaskDetails = useTaskStore((state) => state.openTaskDetails);
  const setActiveList = useTaskStore((state) => state.setActiveList);
  const setActiveWorkspace = useTaskStore((state) => state.setActiveWorkspace);
  const markNotificationRead = useTaskStore(
    (state) => state.markNotificationRead,
  );
  const markAllNotificationsRead = useTaskStore(
    (state) => state.markAllNotificationsRead,
  );
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const unreadCount = notifications.filter(
    (notification) => !notification.read,
  ).length;

  const [activeTab, setActiveTab] = useState<"unread" | "all">("unread");
  const [anchoredStyle, setAnchoredStyle] = useState<{
    top: number;
    right: number;
  } | null>(null);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 1023px)");
    const updateViewport = (event?: MediaQueryListEvent) => {
      setIsMobileViewport(event ? event.matches : mediaQuery.matches);
    };

    updateViewport();
    mediaQuery.addEventListener("change", updateViewport);
    return () => mediaQuery.removeEventListener("change", updateViewport);
  }, []);

  useLayoutEffect(() => {
    if (!isOpen || !anchored || isMobileViewport || !anchorRef?.current) {
      return;
    }

    const updatePosition = () => {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (!rect) return;

      setAnchoredStyle({
        top: rect.bottom + 8,
        right: window.innerWidth - rect.right,
      });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [anchored, anchorRef, isMobileViewport, isOpen]);

  if (!isOpen) return null;

  const filteredNotifications =
    activeTab === "unread"
      ? notifications.filter((n) => !n.read)
      : notifications;

  const isTaskScopedNotification = (type: TaskNotification["type"]) =>
    type === "TASK_ASSIGNED" ||
    type === "TASK_STATUS_CHANGED" ||
    type === "TASK_DUE_DATE_CHANGED" ||
    type === "TASK_ATTACHMENT_ADDED" ||
    type === "TASK_LINKED" ||
    type === "TASK_UNLINKED" ||
    type === "CHECKLIST_ITEM_ASSIGNED" ||
    type === "SUBTASK_CREATED" ||
    type === "comment" ||
    type === "mention" ||
    type === "assign";

  const handleNotificationClick = async (notif: TaskNotification) => {
    if (!notif.read) await markNotificationRead(notif.id);

    const handledByUrl = navigateFromNotificationUrl(notif.url, {
      graph,
      setActiveWorkspace,
      setActiveList,
      openTaskDetails,
    });

    if (handledByUrl) {
      onClose();
      return;
    }

    if (isTaskScopedNotification(notif.type)) {
      const task = graph.tasks[notif.referenceId];
      if (task) {
        setActiveList(task.listId);
        setTimeout(() => openTaskDetails(notif.referenceId), 100);
      }
    } else if (notif.type === "LIST_ASSIGNED" && notif.referenceId) {
      const list = graph.lists[notif.referenceId];
      if (list) {
        setActiveList(notif.referenceId);
      } else {
        console.warn(
          "List NOT found in graph for notification:",
          notif.referenceId,
        );
      }
    } else if (notif.type === "WORKSPACE_ASSIGNED" && notif.referenceId) {
      if (graph.workspaces[notif.referenceId]) {
        setActiveWorkspace(notif.referenceId);
      } else {
        console.warn(
          "Workspace NOT found in graph for notification:",
          notif.referenceId,
        );
      }
    }

    onClose();
  };

  const panel = (
    <div
      data-task-notification-panel
      className={cn(
        "flex h-dvh w-full flex-col overflow-hidden rounded-none border-0 animate-in duration-200 sm:h-auto sm:w-100 sm:rounded-[28px] sm:border",
        anchored && !isMobileViewport ? "zoom-in-95" : "slide-in-from-top-2",
        "pauta-theme-menu",
        className,
      )}
      style={
        anchored && !isMobileViewport && anchoredStyle
          ? {
              pointerEvents: "auto",
              position: "fixed",
              zIndex: 200,
              top: anchoredStyle.top,
              right: anchoredStyle.right,
            }
          : { pointerEvents: "auto" }
      }
    >
      <div
        className={cn(
          "sticky top-0 z-10 border-b px-4 pb-3 pt-4",
          "border-(--ui-borda) bg-(--ui-superficie) backdrop-blur-xl",
        )}
        style={
          isMobileViewport
            ? {
                paddingTop: "calc(env(safe-area-inset-top, 0px) + 1rem)",
                paddingLeft: "calc(env(safe-area-inset-left, 0px) + 1rem)",
                paddingRight: "calc(env(safe-area-inset-right, 0px) + 1rem)",
              }
            : undefined
        }
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <div
                className={cn(
                  "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl",
                  "bg-(--ui-azul-fundo) text-(--ui-azul-texto)",
                )}
              >
                <BellRing className="h-5 w-5" strokeWidth={2.2} />
              </div>

              <div className="min-w-0">
                <h2
                  className={cn(
                    "text-sm font-black uppercase tracking-[0.08em]",
                    "text-(--ui-texto-principal)",
                  )}
                >
                  Central de alertas
                </h2>
                <p
                  className={cn(
                    "mt-1 text-[11px]",
                    "text-(--ui-texto-secundario)",
                  )}
                >
                  {unreadCount > 0
                    ? `${unreadCount} pendentes para revisar`
                    : "Tudo em dia por aqui"}
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => markAllNotificationsRead()}
              title="Marcar todas como lidas"
              className={cn(
                "pauta-touch-target rounded-xl p-2 transition-colors cursor-pointer",
                "text-(--ui-texto-secundario) hover:bg-(--ui-azul-fundo) hover:text-(--ui-azul-texto)",
              )}
            >
              <CheckCheck className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={onClose}
              className={cn(
                "pauta-touch-target rounded-xl p-2 transition-colors cursor-pointer",
                "text-(--ui-texto-apagado) hover:bg-(--ui-hover) hover:text-(--ui-texto-forte)",
              )}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <div
          className={cn(
            "inline-flex gap-1 rounded-2xl p-1",
            "bg-(--ui-fundo-neutro)",
          )}
        >
          {(["unread", "all"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                "pauta-touch-target rounded-[14px] px-3 py-2 text-[10px] font-black uppercase tracking-[0.18em] transition-all cursor-pointer",
                activeTab === tab
                  ? "bg-(--ui-azul-fundo) text-(--ui-azul-texto) shadow-sm"
                  : "text-(--ui-texto-secundario) hover:text-(--ui-texto-forte)",
              )}
            >
              {tab === "unread" ? "Não lidas" : "Todas"}
              {tab === "unread" && unreadCount > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-blue-100 px-1.5 py-0.5 text-[8px] font-black tabular-nums text-blue-600">
                  {unreadCount}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="pauta-scroll-safe min-h-0 flex-1 overflow-y-auto p-2.5 sm:max-h-136">
        {filteredNotifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
            <div
              className={cn(
                "mb-3 flex h-12 w-12 items-center justify-center rounded-[20px]",
                "bg-(--ui-fundo-neutro)",
              )}
            >
              <CheckCheck
                className={cn(
                  "h-5 w-5",
                  "text-(--ui-texto-apagado)",
                )}
              />
            </div>
            <p
              className={cn(
                "text-[11px] font-bold uppercase tracking-[0.2em]",
                "text-(--ui-texto-secundario)",
              )}
            >
              {activeTab === "unread"
                ? "Nenhuma notificação não lida"
                : "Sem notificações"}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {filteredNotifications.map((notif, index) => (
              <NotificationCard
                key={notif.id}
                notif={notif}
                index={index}
                onClick={() => handleNotificationClick(notif)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );

  if (anchored && !isMobileViewport) {
    // Esc fecha a janela, como em qualquer aplicativo.
    useFecharComEsc(true, onClose);
    return createPortal(panel, document.body);
  }

  if (isMobileViewport) {
    return createPortal(
      <div className="fixed inset-0 z-200"
      role="dialog"
      aria-modal="true"
      aria-label="Notificações">{panel}</div>,
      document.body,
    );
  }

  return (
    <div className="fixed inset-0 z-100" style={{ pointerEvents: "none" }}>
      <div
        className="absolute right-6 top-18"
        style={{ pointerEvents: "auto" }}
      >
        {panel}
      </div>
    </div>
  );
}
