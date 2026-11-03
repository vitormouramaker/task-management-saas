import {
  CalendarDays,
  Check,
  FolderKanban,
  GanttChart,
  LayoutGrid,
  List as ListIcon,
  Lock,
  Table2,
  MoreVertical,
  Pencil,
  Plus,
  Share2,
  Star,
  Trash2,
  User,
} from "lucide-react";
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "../../../components/ui/skeleton";
import {
  SeedProjectHeaderSkeleton,
  SeedBoardSkeleton,
} from "./app-loading-screen";

import { AssigneeAvatars } from "../../../components/ui/assignee-avatars";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { FlightDatePicker } from "../../../components/ui/flight-date-picker";
import {
  getWorkspacePermissionForSelection,
  hasWorkspacePermission,
} from "../../../lib/workspace-permissions";
import { getVisibilityLabel } from "../../../lib/entity-visibility";
import { taskMatchesFilters } from "../../../lib/task-filters";
import { cn } from "../../../lib/utils";
import { useAuthStore } from "../../../store/use-auth-store";
import { useTaskStore } from "../../../store/use-task-store";
import { useThemeStore } from "../../../store/use-theme-store";
import type { EntityVisibility, TaskViewMode } from "../../../types/tasks";
import { HomeDashboard } from "../../home/components/home-dashboard";
const SettingsPage = lazy(() =>
  import("../../settings/components/settings-page").then((m) => ({ default: m.SettingsPage })),
);
const TrashPage = lazy(() =>
  import("../../trash/components/trash-page").then((m) => ({ default: m.TrashPage })),
);
import { SupportPanel } from "../../support/components/support-panel";
import { SupportBubble } from "../../support/components/support-bubble";
import { ProductTour, TOUR_MOBILE_NAV_EVENT } from "../../onboarding/components/product-tour";
import { Sidebar } from "../../spaces/components/sidebar";
const ProjectCreateModal = lazy(() =>
  import("../../tasks/components/project-create-modal").then((m) => ({ default: m.ProjectCreateModal })),
);
import { KanbanBoard } from "../../tasks/components/kanban-board";
const CalendarPage = lazy(() =>
  import("../../tasks/components/calendar-page").then((m) => ({ default: m.CalendarPage })),
);
const ReportsPage = lazy(() =>
  import("../../reports/components/reports-page").then((m) => ({ default: m.ReportsPage })),
);
const HelpPage = lazy(() =>
  import("../../help/components/help-page").then((m) => ({ default: m.HelpPage })),
);
import { TaskCalendarView } from "../../tasks/components/task-calendar-view";
import { TaskListView } from "../../tasks/components/task-list-view";
import { TaskTableView } from "../../tasks/components/task-table-view";
import { TaskTimelineView } from "../../tasks/components/task-timeline-view";
import { usePlanViews } from "../../tasks/hooks/use-plan-views";
const TaskCreateModal = lazy(() =>
  import("../../tasks/components/task-create-modal").then((m) => ({ default: m.TaskCreateModal })),
);
const TaskDetailsModal = lazy(() =>
  import("../../tasks/components/task-details-modal").then((m) => ({ default: m.TaskDetailsModal })),
);
import { TaskFilterBar } from "../../tasks/components/task-filter-bar";
import { UsersPage } from "../../users/components/users-page";
import { AppHeader } from "./app-header";
import { PlanStatusBanner } from "../../billing/components/plan-status-banner";
import { usePlanLimitGuard } from "../../billing/use-plan-limits";
import { useAppRouting } from "../hooks/use-app-routing";
import { buildPath } from "../../../lib/app-router";
import { toast } from "../../../store/use-toast-store";
import { confirmar } from "../../../store/use-confirm-store";

function MembersTransitionSkeleton() {
  return (
    <div className="flex h-full w-full flex-col animate-in fade-in duration-200">
      <div className="flex-1 overflow-auto p-8">
        <div className="mb-8 flex items-start justify-between">
          <div className="space-y-2">
            <Skeleton className="h-8 w-52 rounded-full" />
            <Skeleton className="h-4 w-96 rounded-full" />
          </div>
          <Skeleton className="h-10 w-40 rounded-xl" />
        </div>

        <div
          className={cn(
            "mb-6 flex items-center justify-between rounded-2xl border p-3",
            "border-(--ui-borda-suave) bg-(--ui-superficie)",
          )}
        >
          <Skeleton className="h-9 w-80 rounded-xl" />
          <Skeleton className="h-7 w-36 rounded-full" />
        </div>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <div
              key={i}
              className={cn(
                "flex flex-col rounded-2xl border p-5",
                "border-(--ui-borda) bg-(--ui-superficie)",
              )}
            >
              <div className="flex items-start gap-4">
                <Skeleton className="h-12 w-12 shrink-0 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-32 rounded-full" />
                  <Skeleton className="h-3 w-24 rounded-full" />
                  <Skeleton className="h-3 w-40 rounded-full" />
                </div>
              </div>
              <div
                className={cn(
                  "mt-5 grid grid-cols-2 gap-3 border-t pt-4",
                  "border-(--ui-borda-suave)",
                )}
              >
                <Skeleton className="h-8 w-full rounded-lg" />
                <Skeleton className="h-8 w-full rounded-lg" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Esqueleto genérico para as telas que chegam sob demanda. */
function PaginaCarregando() {
  return (
    <div className="flex h-full w-full flex-col animate-in fade-in duration-200">
      <div className="mx-auto w-full max-w-5xl flex-1 space-y-6 overflow-auto p-8">
        <Skeleton className="h-8 w-48 rounded-full" />
        <Skeleton className="h-4 w-80 rounded-full" />
        <div className="grid gap-4 sm:grid-cols-3">
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-24 rounded-2xl" />
        </div>
        <div
          className={cn(
            "space-y-3 rounded-2xl border p-6",
            "border-(--ui-borda)",
          )}
        >
          <Skeleton className="h-5 w-64 rounded-full" />
          <Skeleton className="h-4 w-full rounded-full" />
          <Skeleton className="h-4 w-5/6 rounded-full" />
          <Skeleton className="h-4 w-2/3 rounded-full" />
        </div>
      </div>
    </div>
  );
}

function SettingsTransitionSkeleton() {
  return (
    <div className="flex h-full w-full flex-col animate-in fade-in duration-200">
      <div className="mx-auto w-full max-w-5xl flex-1 overflow-auto p-8">
        <Skeleton className="mb-8 h-8 w-40 rounded-full" />

        <div
          className={cn(
            "mb-8 flex gap-1 border-b",
            "border-(--ui-borda)",
          )}
        >
          <Skeleton className="h-9 w-16 rounded-t-lg" />
          <Skeleton className="h-9 w-40 rounded-t-lg" />
        </div>

        <div
          className={cn(
            "mb-8 rounded-2xl border p-6",
            "border-(--ui-borda) bg-(--ui-superficie)",
          )}
        >
          <div className="mb-6 flex items-start gap-4">
            <Skeleton className="h-12 w-12 rounded-xl" />
            <div className="space-y-2">
              <Skeleton className="h-5 w-52 rounded-full" />
              <Skeleton className="h-4 w-80 rounded-full" />
            </div>
          </div>
          <div
            className={cn(
              "flex gap-4 rounded-xl border p-4",
              "border-(--ui-borda)",
            )}
          >
            <Skeleton className="h-11 flex-1 rounded-xl" />
            <Skeleton className="h-11 w-48 rounded-xl" />
            <Skeleton className="h-11 w-28 rounded-xl" />
          </div>
        </div>

        <div
          className={cn(
            "overflow-hidden rounded-2xl border",
            "border-(--ui-borda) bg-(--ui-superficie)",
          )}
        >
          <div
            className={cn(
              "flex items-center justify-between border-b px-6 py-4",
              "border-(--ui-borda-suave)",
            )}
          >
            <Skeleton className="h-4 w-36 rounded-full" />
            <Skeleton className="h-6 w-8 rounded-full" />
          </div>
          {[...Array(3)].map((_, i) => (
            <div
              key={i}
              className={cn(
                "flex items-center justify-between border-b p-4 last:border-b-0",
                "border-(--ui-borda-suave)",
              )}
            >
              <div className="flex items-center gap-3">
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="space-y-2">
                  <Skeleton className="h-4 w-28 rounded-full" />
                  <Skeleton className="h-5 w-14 rounded-full" />
                </div>
              </div>
              <Skeleton className="h-8 w-8 rounded-lg" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function AppShell() {
  const graph = useTaskStore((state) => state.graph);
  const selection = useTaskStore((state) => state.selection);
  const ui = useTaskStore((state) => state.ui);
  const updateListVisibility = useTaskStore(
    (state) => state.updateListVisibility,
  );
  const toggleListTag = useTaskStore((state) => state.toggleListTag);
  const toggleListAssignee = useTaskStore((state) => state.toggleListAssignee);
  const updateListDates = useTaskStore((state) => state.updateListDates);
  const setActiveView = useTaskStore((state) => state.setActiveView);
  const favoriteListIds = useTaskStore((state) => state.favoriteListIds);
  const toggleFavoriteList = useTaskStore((state) => state.toggleFavoriteList);
  const updateListName = useTaskStore((state) => state.updateListName);
  const deleteList = useTaskStore((state) => state.deleteList);
  const filters = useTaskStore((state) => state.filters);
  const currentUser = useTaskStore((state) => state.currentUser);
  const seedInitialized = useTaskStore((state) => state.seedInitialized);
  // Endereço do navegador acompanha a tela aberta (e o botão voltar funciona).
  useAppRouting(seedInitialized);
  const assignedToMeOnly = useTaskStore(
    (state) => state.filters.assignedToMeOnly,
  );
  const setAssignedToMeOnly = useTaskStore(
    (state) => state.setAssignedToMeOnly,
  );
  const isDarkMode = useThemeStore((state) => state.mode === "dark");

  const [isAddTaskModalOpen, setIsAddTaskModalOpen] = useState(false);
  const [isVisibilityMenuOpen, setIsVisibilityMenuOpen] = useState(false);
  const [isTagMenuOpen, setIsTagMenuOpen] = useState(false);
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);
  const { ensureCanCreate, limitModal } = usePlanLimitGuard();
  const [isProjectMenuOpen, setIsProjectMenuOpen] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [tempName, setTempName] = useState("");
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }
    return window.matchMedia("(max-width: 1023px)").matches;
  });
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);

  // O tour do primeiro acesso precisa do menu lateral aberto no celular para
  // destacar os atalhos.
  useEffect(() => {
    const alternar = (evento: Event) => {
      const abrir = Boolean((evento as CustomEvent<{ abrir?: boolean }>).detail?.abrir);
      setIsMobileNavOpen(abrir);
    };
    window.addEventListener(TOUR_MOBILE_NAV_EVENT, alternar);
    return () => window.removeEventListener(TOUR_MOBILE_NAV_EVENT, alternar);
  }, []);
  const prevNavKeyRef = useRef(`${ui.activePage}-${selection.listId ?? ""}`);

  const token = useAuthStore((state) => state.token);
  const authUser = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  const isAdm = authUser?.organization?.role === "owner" ||
    authUser?.organization?.role === "admin";

  const visibilityMenuRef = useRef<HTMLDivElement>(null);
  const tagMenuRef = useRef<HTMLDivElement>(null);
  const projectMenuRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (
        visibilityMenuRef.current &&
        !visibilityMenuRef.current.contains(e.target as Node)
      ) {
        setIsVisibilityMenuOpen(false);
      }
      if (
        tagMenuRef.current &&
        !tagMenuRef.current.contains(e.target as Node)
      ) {
        setIsTagMenuOpen(false);
      }
      if (
        projectMenuRef.current &&
        !projectMenuRef.current.contains(e.target as Node)
      ) {
        setIsProjectMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  useEffect(() => {
    if (isEditingName && nameInputRef.current) {
      nameInputRef.current.focus();
      nameInputRef.current.select();
    }
  }, [isEditingName]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const mediaQuery = window.matchMedia("(max-width: 1023px)");
    const handleChange = (event: MediaQueryListEvent) => {
      setIsMobileViewport(event.matches);
    };

    setIsMobileViewport(mediaQuery.matches);
    mediaQuery.addEventListener("change", handleChange);

    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    const key = `${ui.activePage}-${selection.listId ?? ""}`;
    if (prevNavKeyRef.current !== key) {
      prevNavKeyRef.current = key;
      setIsTransitioning(true);
      const timer = setTimeout(() => setIsTransitioning(false), 180);
      return () => clearTimeout(timer);
    }
  }, [ui.activePage, selection.listId]);

  useEffect(() => {
    if (!isMobileViewport) {
      setIsMobileNavOpen(false);
    }
  }, [isMobileViewport]);

  useEffect(() => {
    if (!isMobileViewport) {
      return;
    }
    setIsMobileNavOpen(false);
  }, [isMobileViewport, selection.listId, ui.activePage]);

  useEffect(() => {
    if (typeof document === "undefined" || !isMobileViewport) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    if (isMobileNavOpen) {
      document.body.style.overflow = "hidden";
    }

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isMobileNavOpen, isMobileViewport]);

  const activeList = selection.listId
    ? graph.lists[selection.listId]
    : undefined;
  const activeListTasks = useMemo(
    () =>
      activeList
        ? activeList.taskIds
            .map((taskId) => graph.tasks[taskId])
            .filter(Boolean)
        : [],
    [activeList, graph.tasks],
  );
  const currentUserId = authUser?.id ?? currentUser;
  const totalVisibleTasks = useMemo(
    () =>
      activeListTasks.filter((task) =>
        taskMatchesFilters(task, graph, filters, currentUserId),
      ).length,
    [activeListTasks, currentUserId, filters, graph],
  );
  const permission = getWorkspacePermissionForSelection(
    graph,
    selection.workspaceId,
    activeList?.id ?? selection.listId,
  );
  const canEditProject = hasWorkspacePermission(permission, "edit");

  async function handleCopyProjectLink() {
    if (!activeList) return;

    const shareUrl = new URL(
      buildPath({ page: "tasks", listId: activeList.id, view: ui.activeView }),
      window.location.origin,
    );

    try {
      await navigator.clipboard.writeText(shareUrl.toString());
      toast.success("Link do projeto copiado.", { message: activeList.name });
    } catch (error) {
      console.error("Erro ao copiar link do projeto", error);
      toast.error("Não foi possível copiar o link do projeto.", {
        message: "O navegador bloqueou a área de transferência.",
      });
    }
  }

  const handleStartEdit = () => {
    if (!activeList || !canEditProject) return;
    setTempName(activeList.name);
    setIsEditingName(true);
  };

  const handleSaveName = async () => {
    if (!canEditProject) {
      setIsEditingName(false);
      return;
    }

    if (activeList && tempName.trim() && tempName !== activeList.name) {
      updateListName(activeList.id, tempName);
      try {
        await axios.put(
          `/api/workspaces/lists/${activeList.id}`,
          { name: tempName },
          { headers: { Authorization: `Bearer ${token}` } },
        );
        queryClient.invalidateQueries({ queryKey: ["workspace-seed"] });
        toast.success("Projeto renomeado.", { message: tempName.trim() });
      } catch (error) {
        console.error("Erro ao renomear projeto", error);
        toast.error("Não foi possível renomear o projeto.", {
          message: "O nome anterior foi mantido.",
        });
      }
    }

    setIsEditingName(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSaveName();
    if (e.key === "Escape") setIsEditingName(false);
  };

  const handleDeleteProject = async (listId: string) => {
    if (!canEditProject) return;
    const confirmado = await confirmar({
      title: "Excluir este projeto?",
      message: "Os cards do projeto vão junto para a lixeira e podem ser restaurados dentro do prazo do seu plano.",
      confirmLabel: "Excluir projeto",
    });
    if (!confirmado) return;

    try {
      await axios.delete(`/api/workspaces/lists/${listId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      deleteList(listId);
      toast.success("Projeto excluído.", {
        message: "Os cards do projeto saíram junto.",
      });
      queryClient.invalidateQueries({ queryKey: ["workspace-seed"] });
    } catch (error) {
      console.error("Erro ao deletar projeto", error);
      toast.error("Não foi possível excluir o projeto.", {
        message: "O projeto continua na lista.",
      });
    }
  };

  const {
    isAllowed: isViewAllowed,
    showLocked: showLockedView,
    lockedModal: lockedViewModal,
  } = usePlanViews();
  // Plano mudou para um sem esta visão: volta para o Quadro.
  const currentView: TaskViewMode = isViewAllowed(ui.activeView) ? ui.activeView : "board";

  const viewTabs: Array<{
    id: TaskViewMode;
    label: string;
    icon: typeof LayoutGrid;
  }> = [
    { id: "board", label: "Quadro", icon: LayoutGrid },
    { id: "list", label: "Lista", icon: ListIcon },
    { id: "table", label: "Tabela", icon: Table2 },
    { id: "timeline", label: "Timeline", icon: GanttChart },
    { id: "calendar", label: "Calendário", icon: CalendarDays },
  ];

  const renderProjectHeader = () => {
    if (!activeList) return null;

    const visibilityTone =
      activeList.visibility === "admin_private"
        ? "border-(--ui-ambar-borda) bg-(--ui-ambar-fundo) text-(--ui-ambar-texto) hover:bg-(--ui-ambar-fundo)"
        : activeList.visibility === "private"
          ? "border-(--ui-rose-borda) bg-(--ui-rose-fundo) text-(--ui-rose-texto) hover:bg-(--ui-rose-fundo)"
          : "border-(--ui-azul-borda) bg-(--ui-azul-fundo) text-(--ui-azul-texto) hover:bg-(--ui-azul-fundo)";
    const visibilityDotTone =
      activeList.visibility === "admin_private"
        ? "bg-(--ui-ambar-fundo) ring-(--ui-ambar-borda)"
        : activeList.visibility === "private"
          ? "bg-(--ui-rose-fundo) ring-(--ui-rose-borda)"
          : "bg-(--ui-azul-fundo) ring-(--ui-azul-borda)";
    const visibilitySummary =
      activeList.visibility === "admin_private"
        ? "Quadro Privado ADM"
        : activeList.visibility === "private"
          ? "Quadro Privado"
          : `Quadro ${getVisibilityLabel(activeList.visibility)}`;
    const visibilityOptions: Array<{
      value: EntityVisibility;
      label: string;
      dotTone: string;
    }> = [
      {
        value: "private" as EntityVisibility,
        label: "Privado",
        dotTone: "bg-(--ui-rose-fundo)",
      },
      {
        value: "public" as EntityVisibility,
        label: "Publico",
        dotTone: "bg-(--ui-azul-fundo)",
      },
      ...(isAdm
        ? [
            {
              value: "admin_private" as EntityVisibility,
              label: "Privado ADM",
              dotTone: "bg-(--ui-ambar-fundo)",
            },
          ]
        : []),
    ];

    return (
      <section
        className={cn(
          "pauta-app-main-header z-10 shrink-0 px-4 pt-3 pb-0 backdrop-blur-sm sm:px-6 sm:pt-4",
          "border-b border-(--ui-borda-suave) bg-(--ui-superficie-suave)",
        )}
      >
        <div className="animate-in fade-in slide-in-from-top-2 duration-500">
          <div className="pauta-project-header mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="w-full sm:mr-4 sm:flex-1">
              {isEditingName ? (
                <input aria-label="Nome do projeto"
                  ref={nameInputRef}
                  value={tempName}
                  onChange={(e) => setTempName(e.target.value)}
                  onBlur={handleSaveName}
                  onKeyDown={handleKeyDown}
                  className={cn(
                    "w-full border-b-2 border-blue-500 bg-transparent pb-1 text-lg font-extrabold tracking-tight outline-none sm:text-xl",
                    "text-(--ui-texto-principal)",
                  )}
                />
              ) : (
                <h1
                  onClick={handleStartEdit}
                  className={cn(
                    canEditProject
                      ? "cursor-pointer text-lg font-extrabold tracking-tight transition-colors hover:text-blue-600 sm:text-xl"
                      : "text-lg font-extrabold tracking-tight sm:text-xl",
                    "text-(--ui-texto-principal)",
                  )}
                >
                  {activeList.name}
                </h1>
              )}
            </div>

            <div className="flex w-full items-center justify-end gap-2 sm:w-auto">
              <button
                onClick={() => toggleFavoriteList(activeList.id)}
                className={cn(
                  "grid h-8 w-8 place-items-center rounded-lg border transition-colors cursor-pointer",
                  "border-(--ui-borda-suave) bg-(--ui-superficie-suave) text-(--ui-texto-secundario) hover:border-(--ui-borda) hover:text-(--ui-texto-forte)",
                  favoriteListIds.includes(activeList.id) &&
                    ("border-(--ui-ambar-borda) bg-(--ui-ambar-fundo) text-(--ui-ambar-texto)"),
                )}
              >
                <Star
                  className={cn(
                    "h-3.5 w-3.5",
                    favoriteListIds.includes(activeList.id) && "fill-current",
                  )}
                />
              </button>

              <button
                onClick={() => void handleCopyProjectLink()}
                title="Copiar link do projeto"
                className={cn(
                  "grid h-8 w-8 place-items-center rounded-lg border transition-colors cursor-pointer",
                  "border-(--ui-borda-suave) bg-(--ui-superficie-suave) text-(--ui-texto-secundario) hover:border-(--ui-borda) hover:text-(--ui-texto-forte)",
                )}
              >
                <Share2 className="h-3.5 w-3.5" />
              </button>

              {canEditProject && (
                <div className="relative" ref={projectMenuRef}>
                  <button
                    onClick={() => setIsProjectMenuOpen((value) => !value)}
                    className={cn(
                      "grid h-8 w-8 place-items-center rounded-lg border transition-colors cursor-pointer",
                      "border-(--ui-borda-suave) bg-(--ui-superficie-suave) text-(--ui-texto-secundario) hover:border-(--ui-borda) hover:text-(--ui-texto-forte)",
                      isProjectMenuOpen &&
                        ("border-(--ui-borda) bg-(--ui-fundo-sutil) text-(--ui-texto-forte)"),
                    )}
                  >
                    <MoreVertical className="h-3.5 w-3.5" />
                  </button>

                  {isProjectMenuOpen && (
                    <div
                      className={cn(
                        "absolute right-0 top-full z-50 mt-2 w-48 rounded-2xl border p-2 animate-in fade-in zoom-in-95 duration-200",
                        "border-(--ui-borda) bg-(--ui-superficie) shadow-(--shadow-elevated)",
                      )}
                    >
                      <button
                        onClick={() => {
                          handleStartEdit();
                          setIsProjectMenuOpen(false);
                        }}
                        className={cn(
                          "flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-[13px] font-bold transition-colors",
                          "text-(--ui-texto-secundario) hover:bg-(--ui-hover) hover:text-(--ui-texto-forte)",
                        )}
                      >
                        <Pencil
                          className={cn(
                            "h-4 w-4",
                            "text-(--ui-texto-secundario)",
                          )}
                        />
                        Renomear Projeto
                      </button>
                      <div
                        className={cn(
                          "my-1 h-px",
                          "bg-(--ui-borda-suave)",
                        )}
                      />
                      <button
                        onClick={() => {
                          handleDeleteProject(activeList.id);
                          setIsProjectMenuOpen(false);
                        }}
                        className={cn(
                          "flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-[13px] font-bold transition-colors",
                          "text-(--ui-rose-texto) hover:bg-(--ui-rose-fundo)",
                        )}
                      >
                        <Trash2 className="h-4 w-4" />
                        Excluir Projeto
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="pauta-project-metadata-row mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 sm:gap-x-8">
            <div className="relative flex items-center gap-2">
              <span
                className={cn(
                  "text-[12px] font-bold tracking-tight",
                  "text-(--ui-texto-secundario)",
                )}
              >
                Visibilidade
              </span>
              <button
                onClick={() => setIsVisibilityMenuOpen((value) => !value)}
                disabled={!canEditProject}
                className={cn(
                  "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-extrabold transition-colors",
                  canEditProject
                    ? "cursor-pointer"
                    : "cursor-not-allowed opacity-60",
                  visibilityTone,
                )}
              >
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full ring-2",
                    visibilityDotTone,
                  )}
                />
                {visibilitySummary}
              </button>

              {canEditProject && isVisibilityMenuOpen && (
                <div
                  ref={visibilityMenuRef}
                  className={cn(
                    "absolute left-0 top-full z-50 mt-2 w-44 rounded-xl border p-2 animate-in fade-in zoom-in-95 duration-200",
                    "border-(--ui-borda) bg-(--ui-superficie) shadow-(--shadow-elevated)",
                  )}
                >
                  {visibilityOptions.map((option) => (
                    <button
                      key={option.value}
                      onClick={() => {
                        void updateListVisibility(activeList.id, option.value);
                        setIsVisibilityMenuOpen(false);
                      }}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[12px] font-medium transition-colors cursor-pointer",
                        "text-(--ui-texto-item) hover:bg-(--ui-hover) hover:text-(--ui-texto-forte)",
                      )}
                    >
                      <span
                        className={cn("h-2 w-2 rounded-full", option.dotTone)}
                      />
                      {option.label}
                      {activeList.visibility === option.value && (
                        <Check className="ml-auto h-3 w-3 text-blue-600" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "text-[12px] font-bold tracking-tight",
                  "text-(--ui-texto-secundario)",
                )}
              >
                Atribuído a
              </span>
              <AssigneeAvatars
                assigneeIds={activeList.assigneeIds || []}
                members={graph.members}
                onToggle={(memberId) =>
                  toggleListAssignee(activeList.id, memberId)
                }
                maxVisible={3}
                size={24}
                disabled={!canEditProject}
              />
            </div>

            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "text-[12px] font-bold tracking-tight",
                  "text-(--ui-texto-secundario)",
                )}
              >
                Prazo
              </span>
              <FlightDatePicker
                startDate={activeList.startDate ?? null}
                endDate={activeList.dueDate ?? null}
                onChange={(start, end) =>
                  updateListDates(activeList.id, start, end)
                }
                direction="down"
                disabled={!canEditProject}
              />
            </div>

            <div className="relative flex items-center gap-2">
              <span
                className={cn(
                  "text-[12px] font-bold tracking-tight",
                  "text-(--ui-texto-secundario)",
                )}
              >
                Etiquetas
              </span>
              <div className="flex flex-wrap gap-1.5">
                {(activeList.tags || []).map((tag) => (
                  <Badge
                    key={tag.id}
                    style={{
                      backgroundColor: `${tag.color}20`,
                      color: tag.color,
                      borderColor: `${tag.color}40`,
                    }}
                    className="rounded-full border px-2.5 py-1 text-[11px] font-extrabold transition-all hover:opacity-80"
                  >
                    {tag.name}
                  </Badge>
                ))}

                {canEditProject && (
                  <button
                    onClick={() => setIsTagMenuOpen((value) => !value)}
                    className={cn(
                      "flex h-6 w-6 items-center justify-center rounded-full border border-dashed transition-colors cursor-pointer",
                      "border-(--ui-borda-forte) bg-(--ui-superficie-suave) text-(--ui-texto-secundario) hover:border-blue-400 hover:text-(--ui-azul-texto)",
                    )}
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                )}
              </div>

              {canEditProject && isTagMenuOpen && (
                <div
                  ref={tagMenuRef}
                  className={cn(
                    "absolute left-0 top-full z-50 mt-2 w-48 rounded-xl border p-2 animate-in fade-in zoom-in-95 duration-200",
                    "border-(--ui-borda) bg-(--ui-superficie) shadow-(--shadow-elevated)",
                  )}
                >
                  <h4
                    className={cn(
                      "mb-2 px-2 text-[10px] font-bold uppercase tracking-widest",
                      "text-(--ui-texto-secundario)",
                    )}
                  >
                    Etiquetas do Projeto
                  </h4>
                  <div className="flex max-h-48 flex-col gap-1 overflow-y-auto">
                    {Object.values(graph.tags || {}).map((tag) => {
                      const isSelected = (activeList.tags || []).some(
                        (item) => item.id === tag.id,
                      );
                      return (
                        <button
                          key={tag.id}
                          onClick={() => toggleListTag(activeList.id, tag)}
                          className={cn(
                            "flex items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors cursor-pointer",
                            "hover:bg-(--ui-hover)",
                            isSelected &&
                              ("bg-(--ui-azul-fundo)"),
                          )}
                        >
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: tag.color }}
                          />
                          <span
                            className={cn(
                              "text-xs font-medium",
                              "text-(--ui-texto-item)",
                            )}
                          >
                            {tag.name}
                          </span>
                          {isSelected && (
                            <Check className="ml-auto h-3 w-3 text-blue-600" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="pauta-view-tabs-row flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="pauta-view-tabs flex flex-wrap gap-5 sm:gap-7" data-tour="view-tabs">
              {viewTabs.map((view) => {
                const Icon = view.icon;
                const isActive = currentView === view.id;
                const locked = !isViewAllowed(view.id);

                return (
                  <button
                    key={view.label}
                    onClick={() => (locked ? showLockedView(view.id) : setActiveView(view.id))}
                    title={locked ? "Disponível em planos superiores" : undefined}
                    className={cn(
                      "pauta-view-tab-button relative flex items-center gap-1.5 pb-3 text-[13px] font-extrabold transition-all duration-300 cursor-pointer",
                      isActive
                        ? "translate-y-px text-blue-600"
                        : "text-(--ui-texto-secundario) hover:text-(--ui-texto-forte)",
                    )}
                  >
                    <Icon
                      className={cn(
                        "h-3.5 w-3.5 transition-transform duration-300",
                        isActive && "scale-110",
                      )}
                    />
                    <span>{view.label}</span>
                    {locked && <Lock className="h-3 w-3 opacity-60" />}
                    {isActive && (
                      <div className="absolute -bottom-px left-0 h-[2.5px] w-full rounded-t-full bg-blue-600" />
                    )}
                  </button>
                );
              })}
            </div>

            <div className="flex w-full flex-wrap items-center gap-2 pb-3 sm:w-auto">
              <button
                type="button"
                onClick={() => setAssignedToMeOnly(!assignedToMeOnly)}
                className={cn(
                  "inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 text-[11px] font-extrabold transition-colors cursor-pointer sm:flex-none",
                  assignedToMeOnly
                    ? "border-(--ui-azul-borda) bg-(--ui-azul-fundo) text-(--ui-azul-texto)"
                    : "border-(--ui-borda) bg-(--ui-superficie-suave) text-(--ui-texto-secundario) hover:border-(--ui-borda-forte) hover:text-(--ui-texto-forte)",
                )}
              >
                <User className="h-3.5 w-3.5" />
                Meus cards
              </button>

              <Button
                data-tour="add-task"
                onClick={() => setIsAddTaskModalOpen(true)}
                className={cn(
                  "h-8 w-full cursor-pointer justify-center rounded-lg border border-blue-700 bg-blue-600 px-4 text-xs font-extrabold text-white sm:w-auto",
                  "hover:bg-blue-700 hover:-translate-y-0.5 active:scale-95 transition-all duration-300",
                  !canEditProject &&
                    "cursor-not-allowed opacity-60 hover:translate-y-0",
                )}
                disabled={!canEditProject}
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Adicionar card
              </Button>
            </div>
          </div>
        </div>
      </section>
    );
  };

  return (
    <div className="pauta-app-shell relative flex h-dvh min-h-dvh w-full overflow-hidden">
      <Sidebar
        isMobile={isMobileViewport}
        mobileOpen={isMobileNavOpen}
        onMobileClose={() => setIsMobileNavOpen(false)}
      />

      {isMobileViewport && isMobileNavOpen && (
        <button
          type="button"
          aria-label="Fechar navegação"
          className="fixed inset-0 z-40 bg-black/45 backdrop-blur-[1px] lg:hidden"
          onClick={() => setIsMobileNavOpen(false)}
        />
      )}

      <div className="pauta-app-shell-main pauta-safe-top flex min-w-0 flex-1 flex-col overflow-hidden">
        <AppHeader
          isMobile={isMobileViewport}
          onOpenMobileNav={() => setIsMobileNavOpen(true)}
        />

        <PlanStatusBanner />
        <SupportPanel />
        <SupportBubble />
        <ProductTour />

        {ui.activePage === "home" ? (
          <main className="pauta-app-main flex flex-1 flex-col overflow-hidden">
            <div className="pauta-main-content-scroll pauta-scroll-safe flex-1 overflow-auto px-4 py-3 sm:px-6 sm:py-4">
              <HomeDashboard />
            </div>
          </main>
        ) : ui.activePage === "members" ? (
          isTransitioning ? (
            <MembersTransitionSkeleton />
          ) : (
            <UsersPage />
          )
        ) : ui.activePage === "settings" ? (
          isTransitioning ? (
            <SettingsTransitionSkeleton />
          ) : (
            <Suspense fallback={<SettingsTransitionSkeleton />}>
              <SettingsPage />
            </Suspense>
          )
        ) : ui.activePage === "trash" ? (
          <Suspense fallback={<PaginaCarregando />}>
            <TrashPage />
          </Suspense>
        ) : ui.activePage === "calendar" ? (
          <Suspense fallback={<PaginaCarregando />}>
            <CalendarPage />
          </Suspense>
        ) : ui.activePage === "reports" ? (
          <Suspense fallback={<PaginaCarregando />}>
            <ReportsPage />
          </Suspense>
        ) : ui.activePage === "help" ? (
          <Suspense fallback={<PaginaCarregando />}>
            <HelpPage />
          </Suspense>
        ) : (
          <main className="pauta-app-main flex flex-1 flex-col overflow-hidden">
            {isTransitioning && activeList ? (
              <>
                <SeedProjectHeaderSkeleton />
                <SeedBoardSkeleton isDarkMode={isDarkMode} />
              </>
            ) : (
              <>
                {renderProjectHeader()}

                <div className="pauta-main-content-scroll pauta-scroll-safe flex-1 overflow-auto px-4 py-3 sm:px-6 sm:py-4">
                  {!activeList ? (
                    <div className="flex h-full flex-col items-center justify-center space-y-6 animate-in fade-in zoom-in duration-500">
                      <div
                        className={cn(
                          "flex h-24 w-24 items-center justify-center rounded-4xl border-2 border-dashed",
                          isDarkMode
                            ? "border-(--border-strong) bg-(--bg-surface) text-(--text-soft)"
                            : "border-slate-200 bg-slate-50 text-slate-200",
                        )}
                      >
                        <FolderKanban className="h-10 w-10" />
                      </div>

                      <div className="space-y-2 text-center">
                        <h3
                          className={cn(
                            "text-xl font-black",
                            "text-(--ui-texto-principal)",
                          )}
                        >
                          Nenhum projeto selecionado
                        </h3>
                        <p
                          className={cn(
                            "max-w-[320px] text-sm font-medium leading-relaxed",
                            "text-(--ui-texto-secundario)",
                          )}
                        >
                          Escolha um projeto existente na barra lateral ou crie
                          um novo para começar a organizar suas tarefas e
                          fluxos.
                        </p>
                      </div>

                      {canEditProject && (
                        <Button
                          onClick={() => {
                            if (ensureCanCreate("projects")) setIsProjectModalOpen(true);
                          }}
                          className="rounded-2xl bg-blue-600 px-8 py-4 font-bold transition-all hover:-translate-y-1"
                        >
                          <Plus className="mr-2 h-5 w-5" />
                          Crie um novo projeto
                        </Button>
                      )}
                    </div>
                  ) : (
                    // No celular a tela rola: o quadro ganha altura própria em
                    // vez de ser espremido pelo cabeçalho do projeto.
                    <div className="flex min-h-full flex-col gap-3">
                      <TaskFilterBar totalVisible={totalVisibleTasks} />
                      <div className="min-h-[70vh] flex-1 lg:min-h-0" data-tour="board">
                        {currentView === "board" && <KanbanBoard />}
                        {currentView === "list" && <TaskListView />}
                        {currentView === "table" && <TaskTableView />}
                        {currentView === "timeline" && <TaskTimelineView />}
                        {currentView === "calendar" && <TaskCalendarView />}
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </main>
        )}

        {limitModal}
        {lockedViewModal}
        {/* Telas e janelas pesadas só são baixadas quando alguém abre. */}
        <Suspense fallback={null}>
          {isProjectModalOpen && (
            <ProjectCreateModal
              isOpen={isProjectModalOpen}
              onClose={() => setIsProjectModalOpen(false)}
            />
          )}
          {isAddTaskModalOpen && (
            <TaskCreateModal
              isOpen={isAddTaskModalOpen}
              onClose={() => setIsAddTaskModalOpen(false)}
            />
          )}
          {ui.activeTaskIdForDetails && <TaskDetailsModal />}
        </Suspense>
      </div>
    </div>
  );
}
