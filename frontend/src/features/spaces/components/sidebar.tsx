import {
  BarChart3,
  HelpCircle,
  BookOpen,
  Briefcase,
  Building2,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Code2,
  Database,
  Globe,
  GripVertical,
  Headphones,
  Heart,
  Home,
  Layers,
  Lightbulb,
  Megaphone,
  Monitor,
  MoreVertical,
  Package,
  Palette,
  Pencil,
  Plus,
  Rocket,
  Settings,
  Shield,
  ShoppingCart,
  Star,
  Target,
  Trash2,
  Truck,
  Users,
  Video,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import axios from "axios";
import { useQueryClient } from "@tanstack/react-query";

const WorkspaceEditModal = lazy(() =>
  import("../../tasks/components/workspace-edit-modal").then((m) => ({ default: m.WorkspaceEditModal })),
);
import { AccountSwitcher } from "../../account/components/account-switcher";
import { normalizeEntityColor, withAlpha } from "../../../lib/entity-colors";
import { cn } from "../../../lib/utils";
import { useTaskStore } from "../../../store/use-task-store";
import { useThemeStore } from "../../../store/use-theme-store";
import { ProjectCreateModal } from "../../tasks/components/project-create-modal";
const WorkspaceCreateModal = lazy(() =>
  import("../../tasks/components/workspace-create-modal").then((m) => ({ default: m.WorkspaceCreateModal })),
);
import { usePlanLimitGuard } from "../../billing/use-plan-limits";
import { InviteMemberModal } from "../../users/components/invite-member-modal";
import { useAuthStore } from "../../../store/use-auth-store";
import { useSupportUnread } from "../../support/components/support-panel";
import { useSupportPanel } from "../../support/support-api";
import { toast } from "../../../store/use-toast-store";
import { confirmar } from "../../../store/use-confirm-store";
import {
  getWorkspacePermissionForList,
  getWorkspacePermissionForWorkspace,
  hasWorkspacePermission,
} from "../../../lib/workspace-permissions";

export const WORKSPACE_ICONS: Record<string, LucideIcon> = {
  Briefcase,
  Building2,
  Code2,
  Database,
  Globe,
  Headphones,
  Heart,
  Home,
  Layers,
  Lightbulb,
  Megaphone,
  Monitor,
  Package,
  Palette,
  Rocket,
  Settings,
  ShoppingCart,
  Star,
  Target,
  Users,
  Zap,
  BookOpen,
  Shield,
  Truck,
  Video,
};

function compareByCreatedAt<T extends { createdAt?: string; name?: string }>(
  a: T,
  b: T,
) {
  const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
  const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;

  if (timeA !== timeB) {
    return timeA - timeB;
  }

  return (a.name ?? "").localeCompare(b.name ?? "", "pt-BR");
}

function mergeOrder(previousOrder: string[], defaultOrder: string[]) {
  const validIds = new Set(defaultOrder);
  const kept = previousOrder.filter((id) => validIds.has(id));
  const appended = defaultOrder.filter((id) => !kept.includes(id));
  return [...kept, ...appended];
}

function reorderIds(ids: string[], draggedId: string, targetId: string) {
  const fromIndex = ids.indexOf(draggedId);
  const toIndex = ids.indexOf(targetId);

  if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) {
    return ids;
  }

  const next = [...ids];
  const [dragged] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, dragged);
  return next;
}

interface SidebarProps {
  isMobile?: boolean;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

export function Sidebar({
  isMobile = false,
  mobileOpen = false,
  onMobileClose,
}: SidebarProps) {
  const graph = useTaskStore((state) => state.graph);
  const selection = useTaskStore((state) => state.selection);
  const collapsed = useTaskStore((state) => state.ui.sidebarCollapsed);
  const toggleSidebar = useTaskStore((state) => state.toggleSidebar);
  const setActiveList = useTaskStore((state) => state.setActiveList);
  const setActiveWorkspace = useTaskStore((state) => state.setActiveWorkspace);
  const setActivePage = useTaskStore((state) => state.setActivePage);
  const activePage = useTaskStore((state) => state.ui.activePage);
  const isDarkMode = useThemeStore((state) => state.mode === "dark");
  const isCondensed = !isMobile && collapsed;

  const user = useAuthStore((state) => state.user);
  const token = useAuthStore((state) => state.token);
  const isAdm =
    user?.organization?.role === "owner" ||
    user?.organization?.role === "admin";

  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);
  const [isWorkspaceModalOpen, setIsWorkspaceModalOpen] = useState(false);
  // Limite do plano é avisado antes de abrir a tela de criação.
  const { ensureCanCreate, limitModal } = usePlanLimitGuard();
  const openWorkspaceCreate = () => {
    if (ensureCanCreate("workspaces")) setIsWorkspaceModalOpen(true);
  };
  const openProjectCreate = () => {
    if (ensureCanCreate("projects")) setIsProjectModalOpen(true);
  };
  const [isUserCreateModalOpen, setIsUserCreateModalOpen] = useState(false);
  const [openWorkspaces, setOpenWorkspaces] = useState<Record<string, boolean>>(
    {},
  );
  const [workspaceOrder, setWorkspaceOrder] = useState<string[]>([]);
  const [projectOrderByWorkspace, setProjectOrderByWorkspace] = useState<
    Record<string, string[]>
  >({});
  const [hasLoadedWorkspaceOrder, setHasLoadedWorkspaceOrder] = useState(false);
  const [hasLoadedProjectOrder, setHasLoadedProjectOrder] = useState(false);
  const [draggingWorkspaceId, setDraggingWorkspaceId] = useState<string | null>(
    null,
  );
  const [dragOverWorkspaceId, setDragOverWorkspaceId] = useState<string | null>(
    null,
  );
  const [draggingProject, setDraggingProject] = useState<{
    workspaceId: string;
    projectId: string;
  } | null>(null);
  const [dragOverProjectId, setDragOverProjectId] = useState<string | null>(
    null,
  );

  const [activeMenuWorkspaceId, setActiveMenuWorkspaceId] = useState<
    string | null
  >(null);
  const [workspaceMenuAnchor, setWorkspaceMenuAnchor] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [activeMenuProjectId, setActiveMenuProjectId] = useState<string | null>(
    null,
  );
  const [projectMenuAnchor, setProjectMenuAnchor] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [isEditWorkspaceModalOpen, setIsEditWorkspaceModalOpen] =
    useState(false);
  const [selectedWorkspaceForEdit, setSelectedWorkspaceForEdit] =
    useState<any>(null);
  const [isEditProjectModalOpen, setIsEditProjectModalOpen] = useState(false);
  const [selectedProjectForEdit, setSelectedProjectForEdit] =
    useState<any>(null);
  const [hoveredSidebarTooltip, setHoveredSidebarTooltip] = useState<{
    id: string;
    label: string;
    x: number;
    y: number;
  } | null>(null);
  const [activeCondensedWorkspaceId, setActiveCondensedWorkspaceId] = useState<
    string | null
  >(null);
  const [condensedWorkspaceFlyoutAnchor, setCondensedWorkspaceFlyoutAnchor] =
    useState<{
      x: number;
      y: number;
      maxHeight: number;
    } | null>(null);

  const queryClient = useQueryClient();
  const workspaceOrderStorageKey = user?.id
    ? `pauta-sidebar-workspace-order:${user.id}`
    : null;
  const projectOrderStorageKey = user?.id
    ? `pauta-sidebar-project-order:${user.id}`
    : null;

  const closeWorkspaceMenu = () => {
    setActiveMenuWorkspaceId(null);
    setWorkspaceMenuAnchor(null);
  };

  const closeProjectMenu = () => {
    setActiveMenuProjectId(null);
    setProjectMenuAnchor(null);
  };

  const closeCondensedWorkspaceFlyout = () => {
    setActiveCondensedWorkspaceId(null);
    setCondensedWorkspaceFlyoutAnchor(null);
  };

  const workspacesByCreation = useMemo(
    () => Object.values(graph.workspaces).sort(compareByCreatedAt),
    [graph.workspaces],
  );

  const listsByWorkspace = useMemo(() => {
    return Object.fromEntries(
      workspacesByCreation.map((workspace: any) => {
        const spaces = (workspace.spaceIds ?? [])
          .map((id: string) => graph.spaces[id])
          .filter(Boolean)
          .sort(compareByCreatedAt);

        const folders = spaces.flatMap((space: any) =>
          (space.folderIds ?? [])
            .map((id: string) => graph.folders[id])
            .filter(Boolean)
            .sort(compareByCreatedAt),
        );

        const lists = folders
          .flatMap((folder: any) =>
            (folder.listIds ?? [])
              .map((id: string) => graph.lists[id])
              .filter(Boolean),
          )
          .sort(compareByCreatedAt);

        return [workspace.id, lists];
      }),
    ) as Record<string, any[]>;
  }, [graph.folders, graph.lists, graph.spaces, workspacesByCreation]);

  useEffect(() => {
    if (typeof window === "undefined" || !workspaceOrderStorageKey) return;

    const storedOrder = window.localStorage.getItem(workspaceOrderStorageKey);
    if (!storedOrder) {
      setHasLoadedWorkspaceOrder(true);
      return;
    }

    try {
      const parsedOrder = JSON.parse(storedOrder);
      if (Array.isArray(parsedOrder)) {
        setWorkspaceOrder(parsedOrder);
      }
    } catch {
      window.localStorage.removeItem(workspaceOrderStorageKey);
    } finally {
      setHasLoadedWorkspaceOrder(true);
    }
  }, [workspaceOrderStorageKey]);

  useEffect(() => {
    setWorkspaceOrder((previousOrder) =>
      mergeOrder(
        previousOrder,
        workspacesByCreation.map((workspace: any) => workspace.id),
      ),
    );
  }, [workspacesByCreation]);

  useEffect(() => {
    if (typeof window === "undefined" || !projectOrderStorageKey) return;

    const storedOrder = window.localStorage.getItem(projectOrderStorageKey);
    if (!storedOrder) {
      setHasLoadedProjectOrder(true);
      return;
    }

    try {
      const parsedOrder = JSON.parse(storedOrder);
      if (parsedOrder && typeof parsedOrder === "object") {
        setProjectOrderByWorkspace(parsedOrder);
      }
    } catch {
      window.localStorage.removeItem(projectOrderStorageKey);
    } finally {
      setHasLoadedProjectOrder(true);
    }
  }, [projectOrderStorageKey]);

  useEffect(() => {
    setProjectOrderByWorkspace((previousState) => {
      const nextState: Record<string, string[]> = {};

      for (const workspace of workspacesByCreation as any[]) {
        const defaultIds = (listsByWorkspace[workspace.id] ?? []).map(
          (list: any) => list.id,
        );
        nextState[workspace.id] = mergeOrder(
          previousState[workspace.id] ?? [],
          defaultIds,
        );
      }

      return nextState;
    });
  }, [listsByWorkspace, workspacesByCreation]);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      !workspaceOrderStorageKey ||
      !hasLoadedWorkspaceOrder
    ) {
      return;
    }
    window.localStorage.setItem(
      workspaceOrderStorageKey,
      JSON.stringify(workspaceOrder),
    );
  }, [hasLoadedWorkspaceOrder, workspaceOrder, workspaceOrderStorageKey]);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      !projectOrderStorageKey ||
      !hasLoadedProjectOrder
    ) {
      return;
    }
    window.localStorage.setItem(
      projectOrderStorageKey,
      JSON.stringify(projectOrderByWorkspace),
    );
  }, [hasLoadedProjectOrder, projectOrderByWorkspace, projectOrderStorageKey]);

  const orderedWorkspaces = useMemo(
    () =>
      mergeOrder(
        workspaceOrder,
        workspacesByCreation.map((workspace: any) => workspace.id),
      )
        .map((workspaceId) => graph.workspaces[workspaceId])
        .filter(Boolean),
    [graph.workspaces, workspaceOrder, workspacesByCreation],
  );

  const handleDeleteWorkspace = async (workspaceId: string) => {
    const confirmado = await confirmar({
      title: "Excluir este espaço de trabalho?",
      message:
        "Ele vai para a lixeira com todos os projetos e cards, e pode ser restaurado dentro do prazo do seu plano.",
      confirmLabel: "Excluir espaço",
    });
    if (!confirmado) return;

    try {
      await axios.delete(`/api/workspaces/${workspaceId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      await queryClient.invalidateQueries({ queryKey: ["workspace-seed"] });
      toast.success("Espaço de trabalho excluído.", {
        message: "Projetos e cards dele saíram da lista.",
      });
      closeWorkspaceMenu();
    } catch (error) {
      console.error("Erro ao deletar workspace", error);
      toast.error("Não foi possível excluir o espaço de trabalho.", {
        message: "O espaço continua disponível.",
      });
    }
  };

  const handleDeleteProject = async (projectId: string) => {
    const confirmado = await confirmar({
      title: "Excluir este projeto?",
      message:
        "Ele vai para a lixeira com todos os cards e pode ser restaurado dentro do prazo do seu plano.",
      confirmLabel: "Excluir projeto",
    });
    if (!confirmado) return;

    try {
      await axios.delete(`/api/workspaces/lists/${projectId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      await queryClient.invalidateQueries({ queryKey: ["workspace-seed"] });
      toast.success("Projeto excluído.", {
        message: "Os cards do projeto saíram junto.",
      });
      closeProjectMenu();
    } catch (error) {
      console.error("Erro ao deletar projeto", error);
      toast.error("Não foi possível excluir o projeto.", {
        message: "O projeto continua na lista.",
      });
    }
  };

  const toggleWorkspace = (id: string) => {
    closeWorkspaceMenu();
    closeProjectMenu();
    setOpenWorkspaces((previousState) => ({
      ...previousState,
      [id]: !(previousState[id] ?? true),
    }));
  };

  const handleWorkspaceDragStart = (
    event: React.DragEvent<HTMLElement>,
    workspaceId: string,
  ) => {
    event.stopPropagation();
    const dragPreview = event.currentTarget.closest(
      '[data-dnd-preview="workspace"]',
    ) as HTMLElement | null;
    if (dragPreview) {
      event.dataTransfer.setDragImage(dragPreview, 24, 16);
    }
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", workspaceId);
    setDraggingWorkspaceId(workspaceId);
    setDragOverWorkspaceId(null);
    closeWorkspaceMenu();
    closeProjectMenu();
  };

  const handleWorkspaceDrop = () => {
    setDraggingWorkspaceId(null);
    setDragOverWorkspaceId(null);
  };

  const handleProjectDragStart = (
    event: React.DragEvent<HTMLElement>,
    workspaceId: string,
    projectId: string,
  ) => {
    event.stopPropagation();
    const dragPreview = event.currentTarget.closest(
      '[data-dnd-preview="project"]',
    ) as HTMLElement | null;
    if (dragPreview) {
      event.dataTransfer.setDragImage(dragPreview, 24, 16);
    }
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", projectId);
    setDraggingProject({ workspaceId, projectId });
    setDragOverProjectId(null);
    closeWorkspaceMenu();
    closeProjectMenu();
  };

  const handleProjectDrop = () => {
    setDraggingProject(null);
    setDragOverProjectId(null);
  };

  const showSidebarTooltip = (
    event: React.MouseEvent<HTMLElement>,
    id: string,
    label: string,
  ) => {
    if (isMobile) return;

    const rect = event.currentTarget.getBoundingClientRect();
    setHoveredSidebarTooltip({
      id,
      label,
      x: rect.right + 14,
      y: rect.top + rect.height / 2,
    });
  };

  const hideSidebarTooltip = () => {
    setHoveredSidebarTooltip(null);
  };

  const handleCondensedWorkspaceClick = (
    event: React.MouseEvent<HTMLButtonElement>,
    workspaceId: string,
  ) => {
    if (!isCondensed) return;

    event.preventDefault();
    event.stopPropagation();
    closeWorkspaceMenu();
    closeProjectMenu();
    hideSidebarTooltip();

    if (activeCondensedWorkspaceId === workspaceId) {
      closeCondensedWorkspaceFlyout();
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    setActiveCondensedWorkspaceId(workspaceId);
    setCondensedWorkspaceFlyoutAnchor({
      x: Math.min(rect.right + 12, window.innerWidth - 320),
      y: Math.max(12, rect.top),
      maxHeight: Math.max(240, window.innerHeight - rect.top - 16),
    });
  };

  useEffect(() => {
    if (!isCondensed) {
      closeCondensedWorkspaceFlyout();
    }
  }, [isCondensed]);

  const supportUnread = useSupportUnread();
  const openSupport = useSupportPanel((state) => state.open);

  const navItems: Array<{
    label: string;
    icon: LucideIcon;
    active: boolean;
    onClick?: () => void;
    show: boolean;
    badge?: number;
  }> = [
    {
      label: "Início",
      icon: Home,
      active: activePage === "home",
      onClick: () => {
        setActivePage("home");
        onMobileClose?.();
      },
      show: true,
    },
    {
      label: "Calendário",
      icon: CalendarDays,
      active: activePage === "calendar",
      onClick: () => {
        setActivePage("calendar");
        onMobileClose?.();
      },
      show: true,
    },
    {
      label: "Membros",
      icon: Users,
      active: activePage === "members",
      onClick: () => {
        setActivePage("members");
        onMobileClose?.();
      },
      show: isAdm,
    },
    {
      label: "Relatórios",
      icon: BarChart3,
      active: activePage === "reports",
      onClick: () => {
        setActivePage("reports");
        onMobileClose?.();
      },
      show: true,
    },
    {
      label: "Ajuda",
      icon: HelpCircle,
      active: activePage === "help",
      onClick: () => {
        setActivePage("help");
        onMobileClose?.();
      },
      show: true,
    },
    {
      label: "Suporte",
      icon: Headphones,
      active: false,
      onClick: () => {
        openSupport();
        onMobileClose?.();
      },
      show: true,
      badge: supportUnread,
    },
    {
      label: "Lixeira",
      icon: Trash2,
      active: activePage === "trash",
      onClick: () => {
        setActivePage("trash");
        onMobileClose?.();
      },
      show: true,
    },
    {
      label: "Configurações",
      icon: Settings,
      active: activePage === "settings",
      onClick: () => {
        setActivePage("settings");
        onMobileClose?.();
      },
      show: isAdm,
    },
  ].filter((item) => item.show);

  const activeWorkspace = orderedWorkspaces.find(
    (workspace: any) => workspace.id === activeMenuWorkspaceId,
  );
  const activeProjectList = activeMenuProjectId
    ? graph.lists[activeMenuProjectId]
    : null;
  const activeCondensedWorkspace = activeCondensedWorkspaceId
    ? graph.workspaces[activeCondensedWorkspaceId]
    : null;
  const condensedWorkspaceProjects = activeCondensedWorkspaceId
    ? mergeOrder(
        projectOrderByWorkspace[activeCondensedWorkspaceId] ?? [],
        (listsByWorkspace[activeCondensedWorkspaceId] ?? []).map(
          (list: any) => list.id,
        ),
      )
        .map((listId) => graph.lists[listId])
        .filter(Boolean)
    : [];

  return (
    <aside
      className={cn(
        "pauta-sidebar relative z-50 flex h-full shrink-0 flex-col",
        "transition-[width]",
        "duration-500 ease-in-out",
        isMobile
          ? cn(
              "fixed inset-y-0 left-0 h-dvh w-[min(86vw,20rem)] max-w-sm border-r transition-transform duration-300 ease-out",
              mobileOpen
                ? "translate-x-0 opacity-100 pointer-events-auto"
                : "-translate-x-full opacity-0 pointer-events-none",
            )
          : isCondensed
            ? "w-20"
            : "w-72",
      )}
    >
      <div className="pauta-sidebar-inner pauta-safe-top pauta-safe-bottom flex h-full w-full flex-col">
        <div
          className={cn(
            "pauta-sidebar-brand-row shrink-0",
            isCondensed
              ? "flex h-28 flex-col items-center justify-center gap-3 px-4 py-4"
              : "flex h-20 items-center justify-between px-5 sm:px-6",
          )}
        >
          <div className="pauta-sidebar-logo flex items-center">
            <img
              src={isDarkMode ? "/icone-pauta.svg" : "/icone-pauta-dark.svg"}
              alt="Pauta"
              className={cn(
                "pauta-sidebar-logo-mark shrink-0 object-cover object-left",
                isCondensed
                  ? "h-7 w-8 rounded-lg"
                  : "h-7 w-auto max-w-100px rounded-none",
              )}
            />
          </div>
          <div
            className={cn(
              "flex items-center gap-2",
              isCondensed && !isMobile && "flex-col",
            )}
          >
            {!isMobile && (
              <button
                type="button"
                id="sidebar-toggle"
                onClick={toggleSidebar}
                className={cn(
                  "pauta-sidebar-toggle grid h-8 w-8 place-items-center rounded-xl border transition-colors active:scale-95",
                  "border-(--ui-borda) bg-(--ui-superficie) text-(--ui-texto-secundario) hover:bg-(--ui-fundo-sutil) hover:text-(--ui-azul-texto)",
                )}
                aria-label={
                  isCondensed
                    ? "Expandir barra lateral"
                    : "Recolher barra lateral"
                }
              >
                {isCondensed ? (
                  <ChevronRight className="h-4 w-4" />
                ) : (
                  <ChevronLeft className="h-4 w-4" />
                )}
              </button>
            )}

            {isMobile && (
              <button
                type="button"
                onClick={onMobileClose}
                className={cn(
                  "pauta-touch-target grid h-10 w-10 place-items-center rounded-2xl border transition-colors",
                  "border-(--ui-borda) bg-(--ui-superficie) text-(--ui-texto-secundario) hover:text-(--ui-texto-forte)",
                )}
                aria-label="Fechar navegação"
              >
                <X className="h-5 w-5" />
              </button>
            )}
          </div>
        </div>

        <AccountSwitcher isCondensed={isCondensed} />

        <div className="pauta-sidebar-content pauta-scroll-safe flex-1 overflow-y-auto px-4 py-2 scrollbar-thin">
          <nav
            className="pauta-sidebar-nav mb-5"
            aria-label="Navegação principal"
          >
            <ul className="pauta-sidebar-nav-list space-y-0.5" data-tour="nav">
              {navItems.map((item) => {
                const Icon = item.icon;

                return (
                  <li key={item.label}>
                    <button
                      type="button"
                      onClick={item.onClick}
                      className={cn(
                        "pauta-sidebar-nav-item group flex w-full cursor-pointer items-center gap-3",
                        "rounded-xl border border-transparent px-3 py-2 text-[13.5px] font-bold outline-none transition-colors duration-200",
                        "focus:outline-none focus-visible:border-blue-200 focus-visible:ring-2 focus-visible:ring-blue-100",
                        !item.active &&
                          ("text-(--ui-texto-secundario) hover:bg-(--ui-hover) hover:text-(--ui-texto-forte)"),
                        isCondensed &&
                          "justify-center px-0 border-transparent cursor-pointer",
                      )}
                      style={
                        item.active
                          ? {
                              color: "var(--primary-blue)",
                              backgroundColor:
                                "color-mix(in srgb, var(--primary-blue) 10%, transparent)",
                              borderColor:
                                "color-mix(in srgb, var(--primary-blue) 18%, transparent)",
                            }
                          : undefined
                      }
                    >
                      <Icon
                        className={cn(
                          "h-5 w-5 shrink-0 transition-transform duration-300 group-hover:scale-110",
                          !item.active &&
                            ("text-(--ui-texto-apagado) group-hover:text-(--ui-texto-secundario)"),
                        )}
                        style={
                          item.active
                            ? { color: "var(--primary-blue)" }
                            : undefined
                        }
                      />
                      {!isCondensed && (
                        <span className="flex-1 text-left">{item.label}</span>
                      )}
                      {Boolean(item.badge) && (
                        <span className="grid h-5 min-w-5 place-items-center rounded-full bg-rose-600 px-1 text-[10px] font-black text-white">
                          {item.badge}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div
            data-tour="workspaces"
            className={cn(
              "pauta-sidebar-workspaces",
              isCondensed ? "space-y-2" : "space-y-4",
            )}
          >
            {!isCondensed && (
              <div className="mb-2 flex items-center justify-between px-2">
                <span
                  className={cn(
                    "text-[10px] font-black uppercase tracking-widest",
                    "text-(--ui-texto-secundario)",
                  )}
                >
                  Espaços de trabalho
                </span>
                {isAdm && (
                  <button
                    onClick={openWorkspaceCreate}
                    className={cn(
                      "rounded-lg p-1 transition-colors cursor-pointer",
                      "text-(--ui-texto-secundario) hover:bg-(--ui-hover-forte) hover:text-(--ui-azul-texto)",
                    )}
                  
                    aria-label="Novo espaço de trabalho"
                    title="Novo espaço de trabalho"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                )}
              </div>
            )}

            <ul className={cn(isCondensed ? "space-y-0.5" : "space-y-2")}>
              {orderedWorkspaces.map((workspace: any) => {
                const isOpen = openWorkspaces[workspace.id] ?? true;
                const workspaceLists = mergeOrder(
                  projectOrderByWorkspace[workspace.id] ?? [],
                  (listsByWorkspace[workspace.id] ?? []).map(
                    (list: any) => list.id,
                  ),
                )
                  .map((listId) => graph.lists[listId])
                  .filter(Boolean);
                const WorkspaceIcon = workspace.icon
                  ? WORKSPACE_ICONS[workspace.icon]
                  : null;
                const workspacePermission = getWorkspacePermissionForWorkspace(
                  graph,
                  workspace.id,
                );
                const workspaceColor = normalizeEntityColor(workspace.color);
                const canManageWorkspace = hasWorkspacePermission(
                  workspacePermission,
                  "manage",
                );
                const canEditWorkspaceContent = hasWorkspacePermission(
                  workspacePermission,
                  "edit",
                );
                const workspaceProjectCount = workspaceLists.length;
                const isWorkspaceDragOver =
                  dragOverWorkspaceId === workspace.id;

                return (
                  <li
                    key={workspace.id}
                    className={cn(isCondensed ? "space-y-0" : "space-y-1")}
                    onDragOver={(event) => {
                      if (
                        !draggingWorkspaceId ||
                        draggingWorkspaceId === workspace.id
                      )
                        return;
                      event.preventDefault();
                      setDragOverWorkspaceId(workspace.id);
                      setWorkspaceOrder((previousOrder) =>
                        reorderIds(
                          previousOrder,
                          draggingWorkspaceId,
                          workspace.id,
                        ),
                      );
                    }}
                    onDragLeave={() => {
                      if (dragOverWorkspaceId === workspace.id) {
                        setDragOverWorkspaceId(null);
                      }
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      handleWorkspaceDrop();
                    }}
                  >
                    <div
                      data-dnd-preview="workspace"
                      draggable={!isCondensed && canManageWorkspace}
                      onDragStart={(event) =>
                        canManageWorkspace &&
                        !isCondensed &&
                        handleWorkspaceDragStart(event, workspace.id)
                      }
                      onDragEnd={() => {
                        setDraggingWorkspaceId(null);
                        setDragOverWorkspaceId(null);
                        hideSidebarTooltip();
                      }}
                      onMouseEnter={(event) =>
                        showSidebarTooltip(
                          event,
                          `workspace:${workspace.id}`,
                          workspace.name,
                        )
                      }
                      onMouseMove={(event) =>
                        showSidebarTooltip(
                          event,
                          `workspace:${workspace.id}`,
                          workspace.name,
                        )
                      }
                      onMouseLeave={hideSidebarTooltip}
                      className={cn(
                        "group flex items-center gap-1 rounded-2xl transition-all",
                        !isCondensed &&
                          canManageWorkspace &&
                          "cursor-grab active:cursor-grabbing",
                        draggingWorkspaceId === workspace.id &&
                          "scale-[0.98] opacity-55 shadow-lg",
                        isWorkspaceDragOver &&
                          ("bg-(--ui-azul-fundo) ring-1 ring-(--ui-azul-borda)"),
                      )}
                    >
                      {!isCondensed && canManageWorkspace && (
                        <div
                          aria-hidden="true"
                          className={cn(
                            "ml-1 p-1",
                            "text-(--ui-texto-secundario)",
                          )}
                        >
                          <GripVertical className="h-3.5 w-3.5" />
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={(event) => {
                          if (isCondensed) {
                            handleCondensedWorkspaceClick(event, workspace.id);
                            return;
                          }

                          toggleWorkspace(workspace.id);
                        }}
                        className={cn(
                          "flex flex-1 min-w-0 items-center gap-2.5 rounded-xl px-3 py-1.5 text-left transition-colors",
                          "cursor-pointer",
                          isCondensed
                            ? "justify-center px-0 py-1.5 hover:bg-(--ui-fundo-neutro)"
                            : "hover:bg-(--ui-hover)",
                          isCondensed &&
                            activeCondensedWorkspaceId === workspace.id &&
                            ("bg-(--ui-fundo-neutro)"),
                        )}
                      >
                        <div
                          className={cn(
                            "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border font-bold",
                            isCondensed && "shadow-sm",
                          )}
                          style={{
                            backgroundColor: withAlpha(
                              workspaceColor,
                              isDarkMode ? 0.18 : 0.12,
                            ),
                            borderColor: withAlpha(
                              workspaceColor,
                              isDarkMode ? 0.38 : 0.22,
                            ),
                            color: workspaceColor,
                          }}
                        >
                          {WorkspaceIcon ? (
                            <WorkspaceIcon className="h-4 w-4" />
                          ) : (
                            workspace.name[0].toUpperCase()
                          )}
                        </div>
                        {!isCondensed && (
                          <div className="flex min-w-0 flex-1 items-center gap-2">
                            <span
                              className={cn(
                                "flex-1 truncate text-[13px] font-bold",
                                "text-(--ui-texto-forte)",
                              )}
                            >
                              {workspace.name}
                            </span>
                            <span
                              className={cn(
                                "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black",
                                "bg-(--ui-fundo-neutro) text-(--ui-texto-secundario)",
                              )}
                            >
                              {workspaceProjectCount}
                            </span>
                          </div>
                        )}
                      </button>

                      {!isCondensed && canManageWorkspace && (
                        <button
                          type="button"
                          draggable={false}
                          onClick={(event) => {
                            event.stopPropagation();
                            if (activeMenuWorkspaceId === workspace.id) {
                              closeWorkspaceMenu();
                            } else {
                              const rect =
                                event.currentTarget.getBoundingClientRect();
                              setWorkspaceMenuAnchor({
                                x: rect.right + 8,
                                y: rect.top,
                              });
                              setActiveMenuWorkspaceId(workspace.id);
                            }
                          }}
                          className={cn(
                            "rounded-lg p-1 transition-colors cursor-pointer",
                            "text-(--ui-texto-secundario) hover:bg-(--ui-hover-forte) hover:text-(--ui-texto-forte)",
                          )}
                        >
                          <MoreVertical className="h-3.5 w-3.5" />
                        </button>
                      )}

                      {!isCondensed && (
                        <button
                          type="button"
                          draggable={false}
                          onClick={() => toggleWorkspace(workspace.id)}
                          className={cn(
                            "rounded-lg p-1 transition-colors cursor-pointer",
                            "text-(--ui-texto-apagado) hover:bg-(--ui-hover-forte) hover:text-(--ui-texto-forte)",
                          )}
                        >
                          <ChevronDown
                            className={cn(
                              "h-4 w-4 transition-transform duration-300",
                              isOpen && "rotate-180",
                            )}
                          />
                        </button>
                      )}
                    </div>

                    {!isCondensed && isOpen && (
                      <div className="relative ml-6 mt-0.5 animate-in fade-in slide-in-from-top-2 duration-300">
                        <div
                          className={cn(
                            "absolute left-1.75 top-0 h-[calc(100%-12px)] w-[1.5px] rounded-full",
                            "bg-(--ui-borda-suave)",
                          )}
                        />
                        <ul className="space-y-0.5 pl-3">
                          {workspaceLists.map((list: any) => {
                            const isActive =
                              activePage === "tasks" &&
                              selection.listId === list.id;
                            const projectTaskCount = Array.isArray(list.taskIds)
                              ? list.taskIds.length
                              : 0;
                            const projectColor = normalizeEntityColor(
                              list.color ?? list.colorClass,
                            );
                            const projectPermission =
                              getWorkspacePermissionForList(graph, list.id);
                            const canEditProject = hasWorkspacePermission(
                              projectPermission,
                              "edit",
                            );
                            const isProjectDragOver =
                              dragOverProjectId === list.id &&
                              draggingProject?.workspaceId === workspace.id;

                            return (
                              <li
                                key={list.id}
                                className="relative"
                                onDragOver={(event) => {
                                  if (
                                    !draggingProject ||
                                    draggingProject.workspaceId !==
                                      workspace.id ||
                                    draggingProject.projectId === list.id
                                  ) {
                                    return;
                                  }
                                  event.preventDefault();
                                  setDragOverProjectId(list.id);
                                  setProjectOrderByWorkspace(
                                    (previousState) => ({
                                      ...previousState,
                                      [workspace.id]: reorderIds(
                                        previousState[workspace.id] ?? [],
                                        draggingProject.projectId,
                                        list.id,
                                      ),
                                    }),
                                  );
                                }}
                                onDragLeave={() => {
                                  if (dragOverProjectId === list.id) {
                                    setDragOverProjectId(null);
                                  }
                                }}
                                onDrop={(event) => {
                                  event.preventDefault();
                                  handleProjectDrop();
                                }}
                              >
                                <div
                                  className={cn(
                                    "absolute -left-2.75 top-3.5 h-[1.5px] w-2.5 rounded-full",
                                    "bg-(--ui-borda-suave)",
                                  )}
                                />
                                <div
                                  data-dnd-preview="project"
                                  draggable={canEditProject}
                                  onDragStart={(event) =>
                                    canEditProject &&
                                    handleProjectDragStart(
                                      event,
                                      workspace.id,
                                      list.id,
                                    )
                                  }
                                  onDragEnd={() => {
                                    setDraggingProject(null);
                                    setDragOverProjectId(null);
                                    hideSidebarTooltip();
                                  }}
                                  onMouseEnter={(event) =>
                                    showSidebarTooltip(
                                      event,
                                      `project:${list.id}`,
                                      list.name,
                                    )
                                  }
                                  onMouseMove={(event) =>
                                    showSidebarTooltip(
                                      event,
                                      `project:${list.id}`,
                                      list.name,
                                    )
                                  }
                                  onMouseLeave={hideSidebarTooltip}
                                  className={cn(
                                    "group/project flex items-center gap-1.5 rounded-xl transition-all",
                                    canEditProject &&
                                      "cursor-grab active:cursor-grabbing",
                                    draggingProject?.projectId === list.id &&
                                      "scale-[0.98] opacity-55 shadow-md",
                                    isProjectDragOver &&
                                      ("bg-(--ui-azul-fundo) ring-1 ring-(--ui-azul-borda)"),
                                  )}
                                >
                                  {canEditProject && (
                                    <div
                                      aria-hidden="true"
                                      className={cn(
                                        "p-1",
                                        "text-(--ui-texto-secundario)",
                                      )}
                                    >
                                      <GripVertical className="h-3 w-3" />
                                    </div>
                                  )}

                                  <button
                                    type="button"
                                    draggable={false}
                                    onClick={() => {
                                      setActiveList(list.id);
                                      onMobileClose?.();
                                    }}
                                    className={cn(
                                      "flex flex-1 min-w-0 items-center gap-2.5 rounded-xl border border-transparent px-3 py-1.5 text-[13px] font-bold cursor-pointer outline-none transition-colors duration-200",
                                      "focus:outline-none focus-visible:border-blue-200 focus-visible:ring-2 focus-visible:ring-blue-100",
                                      isActive
                                        ? ""
                                        : "text-(--ui-texto-secundario) hover:bg-(--ui-hover) hover:text-(--ui-texto-forte)",
                                    )}
                                    style={
                                      isActive
                                        ? {
                                            backgroundColor: withAlpha(
                                              projectColor,
                                              isDarkMode ? 0.16 : 0.1,
                                            ),
                                            borderColor: withAlpha(
                                              projectColor,
                                              isDarkMode ? 0.3 : 0.2,
                                            ),
                                            color: projectColor,
                                          }
                                        : undefined
                                    }
                                  >
                                    <span
                                      className="h-2 w-2 shrink-0 rounded-full"
                                      style={{ backgroundColor: projectColor }}
                                    />
                                    <span className="flex min-w-0 flex-1 items-center gap-2">
                                      <span className="truncate">
                                        {list.name}
                                      </span>
                                      <span
                                        className={cn(
                                          "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black",
                                          isActive
                                            ? "bg-black/10 text-current"
                                            : "bg-(--ui-fundo-neutro) text-(--ui-texto-secundario)",
                                        )}
                                      >
                                        {projectTaskCount}
                                      </span>
                                    </span>
                                  </button>

                                  {canEditProject && (
                                    <button
                                      type="button"
                                      draggable={false}
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        if (activeMenuProjectId === list.id) {
                                          closeProjectMenu();
                                        } else {
                                          const rect =
                                            event.currentTarget.getBoundingClientRect();
                                          setProjectMenuAnchor({
                                            x: rect.right + 8,
                                            y: rect.top,
                                          });
                                          setActiveMenuProjectId(list.id);
                                        }
                                      }}
                                      className={cn(
                                        "rounded-lg p-1 transition-colors cursor-pointer",
                                        "text-(--ui-texto-secundario) hover:bg-(--ui-hover-forte) hover:text-(--ui-texto-forte)",
                                      )}
                                    >
                                      <MoreVertical className="h-3 w-3" />
                                    </button>
                                  )}
                                </div>
                              </li>
                            );
                          })}

                          {canEditWorkspaceContent && (
                            <li className="relative">
                              <div
                                className={cn(
                                  "absolute -left-2.75 top-3.5 h-[1.5px] w-2.5 rounded-full",
                                  "bg-(--ui-borda-suave)",
                                )}
                              />
                              <button
                                onClick={() => {
                                  setActiveWorkspace(workspace.id);
                                  onMobileClose?.();
                                  openProjectCreate();
                                }}
                                className={cn(
                                  "flex w-full items-center gap-2.5 rounded-xl px-3 py-1.5 text-[13px] font-bold transition-colors cursor-pointer",
                                  "text-(--ui-texto-secundario) hover:bg-(--ui-hover) hover:text-(--ui-azul-texto)",
                                )}
                              >
                                <Plus className="h-3.5 w-3.5" />
                                <span>Novo Projeto</span>
                              </button>
                            </li>
                          )}
                        </ul>
                      </div>
                    )}
                  </li>
                );
              })}

              {isCondensed && isAdm && (
                <li className="flex justify-center">
                  <button
                    type="button"
                    onClick={openWorkspaceCreate}
                    className={cn(
                      "flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl border border-dashed transition-colors",
                      isDarkMode
                        ? "border-(--border-subtle) bg-(--bg-surface) text-(--text-soft) hover:border-blue-500/20 hover:bg-blue-500/10 hover:text-blue-300"
                        : "border-slate-200 bg-slate-50 text-slate-500 hover:bg-blue-50 hover:text-blue-600",
                    )}
                  
                    aria-label="Novo espaço de trabalho"
                    title="Novo espaço de trabalho"
                  >
                    <Plus className="h-5 w-5" />
                  </button>
                </li>
              )}
            </ul>
          </div>
        </div>
      </div>

      <ProjectCreateModal
        isOpen={isProjectModalOpen}
        onClose={() => setIsProjectModalOpen(false)}
      />
      <ProjectCreateModal
        isOpen={isEditProjectModalOpen}
        onClose={() => {
          setIsEditProjectModalOpen(false);
          setSelectedProjectForEdit(null);
        }}
        project={selectedProjectForEdit}
      />
      <Suspense fallback={null}>{isWorkspaceModalOpen && (
        <WorkspaceCreateModal
          isOpen={isWorkspaceModalOpen}
          onClose={() => setIsWorkspaceModalOpen(false)}
        />
      )}</Suspense>
      {limitModal}
      <InviteMemberModal
        isOpen={isUserCreateModalOpen}
        onClose={() => setIsUserCreateModalOpen(false)}
      />
      <Suspense fallback={null}>{isEditWorkspaceModalOpen && (
        <WorkspaceEditModal
          isOpen={isEditWorkspaceModalOpen}
          onClose={() => setIsEditWorkspaceModalOpen(false)}
          workspace={selectedWorkspaceForEdit}
        />
      )}</Suspense>

      {activeMenuWorkspaceId &&
        workspaceMenuAnchor &&
        activeWorkspace &&
        createPortal(
          <>
            <div
              className="fixed inset-0"
              style={{ zIndex: 9998 }}
              onClick={closeWorkspaceMenu}
            />
            <div
              style={{
                position: "fixed",
                left: workspaceMenuAnchor.x,
                top: workspaceMenuAnchor.y,
                zIndex: 9999,
              }}
              className={cn(
                "w-36 rounded-xl border p-1.5 animate-in fade-in zoom-in-95 duration-200",
                "border-(--ui-borda) bg-(--ui-superficie) shadow-(--shadow-elevated) shadow-xl",
              )}
            >
              <button
                onClick={() => {
                  setSelectedWorkspaceForEdit(activeWorkspace);
                  setIsEditWorkspaceModalOpen(true);
                  closeWorkspaceMenu();
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-2 py-2 text-xs font-bold transition-colors cursor-pointer",
                  "text-(--ui-texto-secundario) hover:bg-(--ui-hover) hover:text-(--ui-texto-forte)",
                )}
              >
                <Pencil
                  className={cn(
                    "h-3.5 w-3.5",
                    "text-(--ui-texto-secundario)",
                  )}
                />
                Editar
              </button>
              <button
                onClick={() => handleDeleteWorkspace(activeWorkspace.id)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-2 py-2 text-xs font-bold transition-colors cursor-pointer",
                  "text-(--ui-rose-texto) hover:bg-(--ui-rose-fundo) hover:text-(--ui-rose-texto)",
                )}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Excluir
              </button>
            </div>
          </>,
          document.body,
        )}

      {activeMenuProjectId &&
        projectMenuAnchor &&
        activeProjectList &&
        createPortal(
          <>
            <div
              className="fixed inset-0"
              style={{ zIndex: 9998 }}
              onClick={closeProjectMenu}
            />
            <div
              style={{
                position: "fixed",
                left: projectMenuAnchor.x,
                top: projectMenuAnchor.y,
                zIndex: 9999,
              }}
              className={cn(
                "w-36 rounded-xl border p-1.5 animate-in fade-in zoom-in-95 duration-200",
                "border-(--ui-borda) bg-(--ui-superficie) shadow-(--shadow-elevated) shadow-xl",
              )}
            >
              <button
                onClick={() => {
                  setSelectedProjectForEdit(activeProjectList);
                  setIsEditProjectModalOpen(true);
                  closeProjectMenu();
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-2 py-2 text-xs font-bold transition-colors cursor-pointer",
                  "text-(--ui-texto-secundario) hover:bg-(--ui-hover) hover:text-(--ui-texto-forte)",
                )}
              >
                <Pencil
                  className={cn(
                    "h-3 w-3",
                    "text-(--ui-texto-secundario)",
                  )}
                />
                Editar
              </button>
              <button
                onClick={() => handleDeleteProject(activeProjectList.id)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-2 py-2 text-xs font-bold transition-colors cursor-pointer",
                  "text-(--ui-rose-texto) hover:bg-(--ui-rose-fundo) hover:text-(--ui-rose-texto)",
                )}
              >
                <Trash2 className="h-3 w-3" />
                Excluir
              </button>
            </div>
          </>,
          document.body,
        )}

      {activeCondensedWorkspace &&
        condensedWorkspaceFlyoutAnchor &&
        typeof document !== "undefined" &&
        createPortal(
          <>
            <div
              className="fixed inset-0"
              style={{ zIndex: 9998 }}
              onClick={closeCondensedWorkspaceFlyout}
            />
            <div
              style={{
                position: "fixed",
                left: condensedWorkspaceFlyoutAnchor.x,
                top: condensedWorkspaceFlyoutAnchor.y,
                maxHeight: condensedWorkspaceFlyoutAnchor.maxHeight,
                zIndex: 9999,
              }}
              className={cn(
                "w-[min(19rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border animate-in fade-in slide-in-from-left-2 duration-200",
                "border-(--ui-borda) bg-(--ui-superficie) shadow-(--shadow-elevated) shadow-xl",
              )}
            >
              <div
                className={cn(
                  "flex items-start gap-3 border-b px-4 py-3",
                  "border-(--ui-borda-suave)",
                )}
              >
                <div
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border"
                  style={{
                    backgroundColor: withAlpha(
                      normalizeEntityColor(activeCondensedWorkspace.color),
                      isDarkMode ? 0.18 : 0.12,
                    ),
                    borderColor: withAlpha(
                      normalizeEntityColor(activeCondensedWorkspace.color),
                      isDarkMode ? 0.38 : 0.22,
                    ),
                    color: normalizeEntityColor(activeCondensedWorkspace.color),
                  }}
                >
                  {activeCondensedWorkspace.icon &&
                  WORKSPACE_ICONS[activeCondensedWorkspace.icon]
                    ? (() => {
                        const WorkspaceIcon =
                          WORKSPACE_ICONS[activeCondensedWorkspace.icon];
                        return <WorkspaceIcon className="h-4.5 w-4.5" />;
                      })()
                    : activeCondensedWorkspace.name[0]?.toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      "truncate text-sm font-bold",
                      "text-(--ui-texto-principal)",
                    )}
                  >
                    {activeCondensedWorkspace.name}
                  </p>
                  <p
                    className={cn(
                      "mt-0.5 text-[11px] font-medium",
                      "text-(--ui-texto-secundario)",
                    )}
                  >
                    {condensedWorkspaceProjects.length} projeto
                    {condensedWorkspaceProjects.length === 1 ? "" : "s"}
                  </p>
                </div>
              </div>

              <div className="max-h-[min(26rem,70vh)] overflow-y-auto p-2">
                {condensedWorkspaceProjects.length ? (
                  <div className="space-y-1.5">
                    {condensedWorkspaceProjects.map((list: any) => {
                      const projectColor = normalizeEntityColor(
                        list.color ?? list.colorClass,
                      );
                      const isActive =
                        activePage === "tasks" && selection.listId === list.id;

                      return (
                        <button
                          key={list.id}
                          type="button"
                          onClick={() => {
                            setActiveList(list.id);
                            closeCondensedWorkspaceFlyout();
                          }}
                          className={cn(
                            "flex w-full items-center gap-2.5 rounded-lg border border-transparent px-3 py-1.5 text-left text-[13px] font-bold transition-colors cursor-pointer",
                            isActive
                              ? ""
                              : "text-(--ui-texto-secundario) hover:bg-(--ui-hover) hover:text-(--ui-texto-forte)",
                          )}
                          style={
                            isActive
                              ? {
                                  backgroundColor: withAlpha(
                                    projectColor,
                                    isDarkMode ? 0.16 : 0.1,
                                  ),
                                  borderColor: withAlpha(
                                    projectColor,
                                    isDarkMode ? 0.3 : 0.2,
                                  ),
                                  color: projectColor,
                                }
                              : undefined
                          }
                        >
                          <span
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ backgroundColor: projectColor }}
                          />
                          <span className="min-w-0 flex-1 truncate">
                            {list.name}
                          </span>
                          <span
                            className={cn(
                              "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black",
                              isActive
                                ? "bg-black/10 text-current"
                                : "bg-(--ui-fundo-neutro) text-(--ui-texto-secundario)",
                            )}
                          >
                            {Array.isArray(list.taskIds)
                              ? list.taskIds.length
                              : 0}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div
                    className={cn(
                      "rounded-xl border border-dashed px-4 py-5 text-center text-xs font-bold",
                      "border-(--ui-borda) text-(--ui-texto-secundario)",
                    )}
                  >
                    Nenhum projeto neste espaço.
                  </div>
                )}

                {hasWorkspacePermission(
                  getWorkspacePermissionForWorkspace(
                    graph,
                    activeCondensedWorkspace.id,
                  ),
                  "edit",
                ) && (
                  <button
                    type="button"
                    onClick={() => {
                      setActiveWorkspace(activeCondensedWorkspace.id);
                      setIsProjectModalOpen(true);
                      closeCondensedWorkspaceFlyout();
                    }}
                    className={cn(
                      "mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed px-3 py-2 text-[12px] font-black transition-colors cursor-pointer",
                      "border-(--ui-borda) bg-(--ui-fundo-sutil) text-(--ui-texto-secundario) hover:border-(--ui-azul-borda) hover:bg-(--ui-azul-fundo) hover:text-(--ui-azul-texto)",
                    )}
                  >
                    <Plus className="h-4 w-4" />
                    Novo projeto
                  </button>
                )}
              </div>
            </div>
          </>,
          document.body,
        )}

      {hoveredSidebarTooltip &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="pointer-events-none fixed z-10000"
            style={{
              left: hoveredSidebarTooltip.x,
              top: hoveredSidebarTooltip.y,
              transform: "translateY(-50%)",
            }}
          >
            <div className="relative">
              <span
                className={cn(
                  "absolute left-0 top-1/2 h-2.5 w-2.5 -translate-x-[35%] -translate-y-1/2 rotate-45 z-0",
                  "bg-(--ui-superficie)",
                )}
              />
              <div
                className={cn(
                  "relative z-10 rounded-xl px-3 py-2 text-xs font-bold shadow-lg",
                  "bg-(--ui-superficie) text-(--ui-texto-forte)",
                )}
              >
                <span className="whitespace-nowrap">
                  {hoveredSidebarTooltip.label}
                </span>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </aside>
  );
}
