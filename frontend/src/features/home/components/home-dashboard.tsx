import { startTransition, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Briefcase,
  CheckCircle2,
  Eye,
  LayoutGrid,
  Plus,
  Search,
  Target,
  Users,
} from "lucide-react";

import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { UserAvatar } from "../../../components/ui/user-avatar";
import { getTaskStatusLabel } from "../../../lib/task-status-label";
import { cn } from "../../../lib/utils";
import {
  getWorkspacePermissionForList,
  getWorkspacePermissionForTask,
  hasWorkspacePermission,
} from "../../../lib/workspace-permissions";
import { useAuthStore } from "../../../store/use-auth-store";
import { useTaskStore } from "../../../store/use-task-store";
import { useThemeStore } from "../../../store/use-theme-store";
import type { EntityId, Member, Task } from "../../../types/tasks";
import type {
  CustomFieldDefinition,
  CustomFieldValue,
} from "../../../types/tasks";
import { TaskCreateModal } from "../../tasks/components/task-create-modal";
import { TaskCollectionKanban } from "../../tasks/components/task-collection-kanban";

type AdminScope = "all" | "mine";

type TaskContextMap = Record<
  string,
  {
    label: string;
    subLabel?: string;
  }
>;

type DashboardCustomFieldSummary = {
  field: CustomFieldDefinition;
  filledCount: number;
  totalTasks: number;
  topValues: Array<{ label: string; count: number }>;
};

type DashboardWorkspaceSummary = {
  workspaceId: EntityId;
  workspaceName: string;
  taskCount: number;
  fieldSummaries: DashboardCustomFieldSummary[];
};

const METRIC_CARD_PALETTES = [
  {
    light: "border-blue-200 bg-linear-to-br from-blue-50 via-white to-cyan-50",
    dark: "border-blue-500/20 bg-linear-to-br from-blue-500/14 via-(--bg-elevated) to-cyan-500/12",
    iconLight: "bg-blue-100 text-blue-700",
    iconDark: "bg-blue-500/16 text-blue-300",
  },
  {
    light:
      "border-emerald-200 bg-linear-to-br from-emerald-50 via-white to-teal-50",
    dark: "border-emerald-500/20 bg-linear-to-br from-emerald-500/14 via-(--bg-elevated) to-teal-500/12",
    iconLight: "bg-emerald-100 text-emerald-700",
    iconDark: "bg-emerald-500/16 text-emerald-300",
  },
  {
    light:
      "border-violet-200 bg-linear-to-br from-violet-50 via-white to-fuchsia-50",
    dark: "border-violet-500/20 bg-linear-to-br from-violet-500/14 via-(--bg-elevated) to-fuchsia-500/12",
    iconLight: "bg-violet-100 text-violet-700",
    iconDark: "bg-violet-500/16 text-violet-300",
  },
  {
    light:
      "border-amber-200 bg-linear-to-br from-amber-50 via-white to-orange-50",
    dark: "border-amber-500/20 bg-linear-to-br from-amber-500/14 via-(--bg-elevated) to-orange-500/12",
    iconLight: "bg-amber-100 text-amber-700",
    iconDark: "bg-amber-500/16 text-amber-300",
  },
] as const;

function normalizeSearchable(value?: string | null) {
  return value?.toLowerCase().trim() ?? "";
}

function getMemberTagIds(member?: Member | null) {
  if (!member) return [];
  return member.tagIds || member.tags?.map((tag) => tag.id) || [];
}

function taskMatchesDashboardSearch(
  task: Task,
  normalizedSearch: string,
  graph: ReturnType<typeof useTaskStore.getState>["graph"],
) {
  if (!normalizedSearch) return true;

  const list = graph.lists[task.listId];
  const workspace = graph.workspaces[task.workspaceId];
  const description = normalizeSearchable(
    task.description?.value?.replace(/<[^>]+>/g, ""),
  );
  const assignees = task.assigneeIds
    .map((memberId) => graph.members[memberId]?.name)
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const tags = (task.tags || [])
    .map((tag) => tag.name)
    .join(" ")
    .toLowerCase();

  return [
    task.title,
    description,
    list?.name,
    workspace?.name,
    assignees,
    tags,
  ].some((value) => normalizeSearchable(value).includes(normalizedSearch));
}

function buildTaskContextMap(
  tasks: Task[],
  graph: ReturnType<typeof useTaskStore.getState>["graph"],
): TaskContextMap {
  return Object.fromEntries(
    tasks.map((task) => {
      const list = graph.lists[task.listId];
      const workspace = graph.workspaces[task.workspaceId];

      return [
        task.id,
        {
          label: list?.name || "Projeto",
          subLabel: workspace?.name,
        },
      ];
    }),
  );
}

function countTasksForMember(tasks: Task[], memberId: EntityId) {
  return tasks.filter((task) => task.assigneeIds.includes(memberId)).length;
}

function findStatusIdByName(
  statuses: ReturnType<
    typeof useTaskStore.getState
  >["graph"]["statusDefinitions"],
  names: string | string[],
) {
  const normalizedNames = Array.isArray(names)
    ? names.map((name) => normalizeSearchable(name))
    : [normalizeSearchable(names)];

  return (
    statuses.find((status) =>
      normalizedNames.includes(normalizeSearchable(status.name)),
    )?.id ?? null
  );
}

function getDeterministicMetricTone(projectId: string, isDarkMode: boolean) {
  const hash = Array.from(projectId).reduce(
    (accumulator, character) => accumulator + character.charCodeAt(0),
    0,
  );
  const palette =
    METRIC_CARD_PALETTES[hash % METRIC_CARD_PALETTES.length] ??
    METRIC_CARD_PALETTES[0];

  return {
    surface: isDarkMode ? palette.dark : palette.light,
    icon: isDarkMode ? palette.iconDark : palette.iconLight,
  };
}

function formatCustomFieldDashboardValue(
  field: CustomFieldDefinition,
  value: CustomFieldValue | undefined,
) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (field.type === "single_select") {
    return (
      field.options.find((option) => option.id === value)?.label ||
      String(value)
    );
  }

  if (field.type === "checkbox") {
    return value ? "Marcado" : "Desmarcado";
  }

  return String(value);
}

function buildDashboardWorkspaceSummaries(
  tasks: Task[],
  graph: ReturnType<typeof useTaskStore.getState>["graph"],
) {
  const tasksByWorkspace = new Map<EntityId, Task[]>();

  tasks.forEach((task) => {
    if (!graph.workspaces[task.workspaceId]) {
      return;
    }

    const bucket = tasksByWorkspace.get(task.workspaceId) || [];
    bucket.push(task);
    tasksByWorkspace.set(task.workspaceId, bucket);
  });

  return Array.from(tasksByWorkspace.entries())
    .map(([workspaceId, workspaceTasks]) => {
      const workspace = graph.workspaces[workspaceId];
      const fieldIds = workspace?.customFieldIds || [];
      const fields = (
        fieldIds.length
          ? fieldIds
              .map((fieldId) => graph.customFieldDefinitions[fieldId])
              .filter(Boolean)
          : Object.values(graph.customFieldDefinitions).filter(
              (field) => field.workspaceId === workspaceId,
            )
      )
        .filter((field) => field.visibleOnDashboard)
        .sort((left, right) => {
          if (left.displayOrder !== right.displayOrder) {
            return left.displayOrder - right.displayOrder;
          }

          return left.name.localeCompare(right.name, "pt-BR");
        });

      if (fields.length === 0) {
        return null;
      }

      const fieldSummaries = fields.map((field) => {
        const valueCounts = new Map<string, number>();
        let filledCount = 0;

        workspaceTasks.forEach((task) => {
          const formattedValue = formatCustomFieldDashboardValue(
            field,
            task.customFieldValues?.[field.id],
          );

          if (!formattedValue) {
            return;
          }

          filledCount += 1;
          valueCounts.set(
            formattedValue,
            (valueCounts.get(formattedValue) || 0) + 1,
          );
        });

        return {
          field,
          filledCount,
          totalTasks: workspaceTasks.length,
          topValues: Array.from(valueCounts.entries())
            .sort((left, right) => {
              if (right[1] !== left[1]) {
                return right[1] - left[1];
              }

              return left[0].localeCompare(right[0], "pt-BR");
            })
            .slice(0, 4)
            .map(([label, count]) => ({ label, count })),
        };
      });

      return {
        workspaceId,
        workspaceName: workspace?.name || "Espaço de trabalho",
        taskCount: workspaceTasks.length,
        fieldSummaries,
      } satisfies DashboardWorkspaceSummary;
    })
    .filter((summary): summary is DashboardWorkspaceSummary => Boolean(summary))
    .sort((left, right) =>
      left.workspaceName.localeCompare(right.workspaceName, "pt-BR"),
    );
}

function DashboardMetricCard({
  title,
  value,
  helper,
  icon: Icon,
  toneSeed,
}: {
  title: string;
  value: string;
  helper: string;
  icon: typeof Briefcase;
  toneSeed: string;
}) {
  const isDarkMode = useThemeStore((state) => state.mode === "dark");
  const tone = getDeterministicMetricTone(toneSeed, isDarkMode);

  return (
    <div className={cn("rounded-3xl border p-5", tone.surface)}>
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <p
            className={cn(
              "text-xs font-bold uppercase tracking-[0.24em]",
              "text-(--ui-texto-secundario)",
            )}
          >
            {title}
          </p>
          <p
            className={cn(
              "text-3xl font-bold tracking-tight",
              "text-(--ui-texto-principal)",
            )}
          >
            {value}
          </p>
          <p
            className={cn(
              "text-sm font-medium",
              "text-(--ui-texto-secundario)",
            )}
          >
            {helper}
          </p>
        </div>
        <div
          className={cn(
            "flex h-11 w-11 items-center justify-center rounded-2xl",
            tone.icon,
          )}
        >
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}

function MemberOverviewCard({
  member,
  totalTasks,
  inProgressTasks,
  reviewTasks,
  completedTasks,
  onOpen,
}: {
  member: Member;
  totalTasks: number;
  inProgressTasks: number;
  reviewTasks: number;
  completedTasks: number;
  onOpen: () => void;
}) {
  const isDarkMode = useThemeStore((state) => state.mode === "dark");

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "group relative flex w-full cursor-pointer flex-col overflow-hidden rounded-2xl border p-4 text-left transition-all duration-200",
        isDarkMode
          ? "border-(--border-subtle) bg-(--bg-elevated) hover:border-blue-500/20 hover:bg-(--bg-surface)"
          : "border-slate-200 bg-white hover:border-blue-300 hover:shadow-lg hover:shadow-slate-200/40",
      )}
    >
      <div className="flex items-start gap-3 pt-1">
        <UserAvatar member={member} size={40} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h3
                className={cn(
                  "truncate text-sm font-black",
                  "text-(--ui-texto-principal)",
                )}
              >
                {member.name}
              </h3>
              <p
                className={cn(
                  "mt-0.5 truncate text-xs font-semibold",
                  "text-(--ui-texto-secundario)",
                )}
              >
                {member.role || "Membro"}
              </p>
            </div>
            <span
              className={cn(
                "rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em]",
                "bg-(--ui-azul-fundo) text-(--ui-azul-texto)",
              )}
            >
              {totalTasks} cards
            </span>
          </div>
          {!!member.tags?.length && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {member.tags.slice(0, 2).map((tag) => (
                <Badge
                  key={tag.id}
                  className="max-w-full truncate px-2 py-0.5 text-[10px]"
                  style={{
                    backgroundColor: `${tag.color}22`,
                    color: tag.color,
                    borderColor: `${tag.color}44`,
                  }}
                >
                  {tag.name}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </div>

      <div
        className={cn(
          "mt-4 grid grid-cols-4 gap-3 border-t pt-3",
          "border-(--ui-borda-suave)",
        )}
      >
        <div
          className={cn(
            "rounded-lg border px-2 py-2",
            "border-(--ui-borda) bg-(--ui-fundo-sutil)",
          )}
        >
          <p
            className={cn(
              "text-[8px] font-bold uppercase tracking-[0.12em]",
              "text-(--ui-texto-secundario)",
            )}
          >
            Total
          </p>
          <p
            className={cn(
              "mt-1 text-sm font-bold",
              "text-(--ui-texto-principal)",
            )}
          >
            {totalTasks}
          </p>
        </div>
        <div
          className={cn(
            "rounded-lg border px-2 py-2",
            "border-(--ui-borda) bg-(--ui-fundo-sutil)",
          )}
        >
          <p
            className={cn(
              "text-[8px] font-bold uppercase tracking-[0.08em]",
              "text-(--ui-texto-secundario)",
            )}
          >
            {getTaskStatusLabel("Em andamento")}
          </p>
          <p
            className={cn(
              "mt-1 text-sm font-bold",
              "text-(--ui-texto-principal)",
            )}
          >
            {inProgressTasks}
          </p>
        </div>
        <div
          className={cn(
            "rounded-lg border px-2 py-2",
            "border-(--ui-borda) bg-(--ui-fundo-sutil)",
          )}
        >
          <p
            className={cn(
              "text-[8px] font-bold uppercase tracking-[0.12em]",
              "text-(--ui-texto-secundario)",
            )}
          >
            Revisão
          </p>
          <p
            className={cn(
              "mt-1 text-sm font-bold",
              "text-(--ui-texto-principal)",
            )}
          >
            {reviewTasks}
          </p>
        </div>
        <div
          className={cn(
            "rounded-lg border px-2 py-2",
            "border-(--ui-borda) bg-(--ui-fundo-sutil)",
          )}
        >
          <p
            className={cn(
              "text-[8px] font-bold uppercase tracking-[0.12em]",
              "text-(--ui-texto-secundario)",
            )}
          >
            Concluído
          </p>
          <p
            className={cn(
              "mt-1 text-sm font-bold",
              "text-(--ui-texto-principal)",
            )}
          >
            {completedTasks}
          </p>
        </div>
      </div>
    </button>
  );
}

export function HomeDashboard() {
  const graph = useTaskStore((state) => state.graph);
  const search = useTaskStore((state) => state.filters.search);
  const setSearch = useTaskStore((state) => state.setSearch);
  const setActiveList = useTaskStore((state) => state.setActiveList);
  const authUser = useAuthStore((state) => state.user);

  const [draftSearch, setDraftSearch] = useState(search);
  const [adminScope, setAdminScope] = useState<AdminScope>("all");
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [selectedMemberProjectId, setSelectedMemberProjectId] = useState<
    string | "all"
  >("all");
  const [isCreateTaskModalOpen, setIsCreateTaskModalOpen] = useState(false);
  const [createTaskStatusId, setCreateTaskStatusId] = useState<
    string | undefined
  >(undefined);

  useEffect(() => {
    setDraftSearch(search);
  }, [search]);

  const allTasks = useMemo(() => Object.values(graph.tasks), [graph.tasks]);
  const currentMember = useMemo(
    () => (authUser?.id ? graph.members[authUser.id] : null) || null,
    [authUser?.id, graph.members],
  );
  const currentUserId = authUser?.id ?? currentMember?.id ?? "";
  const isAdm = authUser?.organization?.role === "owner" ||
    authUser?.organization?.role === "admin";
  const normalizedSearch = search.trim().toLowerCase();

  const myRelevantTasks = useMemo(
    () =>
      allTasks.filter(
        (task) =>
          task.assigneeIds.includes(currentUserId) ||
          task.ownerId === currentUserId,
      ),
    [allTasks, currentUserId],
  );

  const dashboardTasksBase =
    isAdm && adminScope === "all" ? allTasks : myRelevantTasks;
  const dashboardTasks = useMemo(
    () =>
      dashboardTasksBase.filter((task) =>
        taskMatchesDashboardSearch(task, normalizedSearch, graph),
      ),
    [dashboardTasksBase, graph, normalizedSearch],
  );
  const dashboardTaskContext = useMemo(
    () => buildTaskContextMap(dashboardTasks, graph),
    [dashboardTasks, graph],
  );
  const dashboardCanEdit = useMemo(
    () =>
      dashboardTasks.some((task) =>
        hasWorkspacePermission(
          getWorkspacePermissionForTask(graph, task.id),
          "edit",
        ),
      ),
    [dashboardTasks, graph],
  );
  const adminDashboardCustomFieldTasks = useMemo(
    () =>
      allTasks.filter((task) =>
        taskMatchesDashboardSearch(task, normalizedSearch, graph),
      ),
    [allTasks, graph, normalizedSearch],
  );
  const dashboardWorkspaceSummaries = useMemo(
    () =>
      isAdm
        ? buildDashboardWorkspaceSummaries(
            adminDashboardCustomFieldTasks,
            graph,
          )
        : [],
    [adminDashboardCustomFieldTasks, graph, isAdm],
  );

  const reviewStatusId = findStatusIdByName(
    graph.statusDefinitions,
    "em revisão",
  );
  const doneStatusId = findStatusIdByName(graph.statusDefinitions, "concluído");
  const progressStatusId = findStatusIdByName(
    graph.statusDefinitions,
    "em andamento",
  );
  const todoStatusId = findStatusIdByName(graph.statusDefinitions, "a fazer");

  const currentMemberTagIds = getMemberTagIds(currentMember).length
    ? getMemberTagIds(currentMember)
    : authUser?.tagIds || authUser?.tags?.map((tag) => tag.id) || [];

  const matchingMembers = useMemo(() => {
    if (!isAdm || currentMemberTagIds.length === 0) return [];

    return Object.values(graph.members)
      .filter((member) => member.id !== currentUserId)
      .filter((member) =>
        getMemberTagIds(member).some((tagId) =>
          currentMemberTagIds.includes(tagId),
        ),
      )
      .sort((memberA, memberB) => {
        const taskDiff =
          countTasksForMember(allTasks, memberB.id) -
          countTasksForMember(allTasks, memberA.id);
        if (taskDiff !== 0) return taskDiff;
        return memberA.name.localeCompare(memberB.name, "pt-BR");
      });
  }, [allTasks, currentMemberTagIds, currentUserId, graph.members, isAdm]);

  const selectedMember = selectedMemberId
    ? graph.members[selectedMemberId]
    : null;
  const selectedMemberTasksBase = useMemo(() => {
    if (!selectedMemberId) return [];
    return allTasks.filter((task) =>
      task.assigneeIds.includes(selectedMemberId),
    );
  }, [allTasks, selectedMemberId]);

  const selectedMemberProjects = useMemo(() => {
    const uniqueListIds = Array.from(
      new Set(selectedMemberTasksBase.map((task) => task.listId)),
    );

    return uniqueListIds
      .map((listId) => {
        const list = graph.lists[listId];
        if (!list) return null;

        const folder = graph.folders[list.folderId];
        const space = folder ? graph.spaces[folder.spaceId] : null;
        const workspace = space ? graph.workspaces[space.workspaceId] : null;

        return {
          id: list.id,
          name: list.name,
          workspaceName: workspace?.name || "EspaÃ§o de trabalho",
          taskCount: selectedMemberTasksBase.filter(
            (task) => task.listId === list.id,
          ).length,
        };
      })
      .filter(Boolean)
      .sort((projectA, projectB) =>
        projectA!.name.localeCompare(projectB!.name, "pt-BR"),
      );
  }, [
    graph.folders,
    graph.lists,
    graph.spaces,
    graph.workspaces,
    selectedMemberTasksBase,
  ]);

  useEffect(() => {
    if (!selectedMemberId) {
      setSelectedMemberProjectId("all");
      return;
    }

    if (
      selectedMemberProjectId !== "all" &&
      !selectedMemberProjects.some(
        (project) => project?.id === selectedMemberProjectId,
      )
    ) {
      setSelectedMemberProjectId("all");
    }
  }, [selectedMemberId, selectedMemberProjectId, selectedMemberProjects]);

  const selectedMemberTasks = useMemo(() => {
    return selectedMemberTasksBase.filter((task) => {
      const matchesProject =
        selectedMemberProjectId === "all" ||
        task.listId === selectedMemberProjectId;

      return (
        matchesProject &&
        taskMatchesDashboardSearch(task, normalizedSearch, graph)
      );
    });
  }, [
    graph,
    normalizedSearch,
    selectedMemberProjectId,
    selectedMemberTasksBase,
  ]);

  const selectedMemberTaskContext = useMemo(
    () => buildTaskContextMap(selectedMemberTasks, graph),
    [graph, selectedMemberTasks],
  );
  const selectedMemberCanEditBoard = useMemo(
    () =>
      selectedMemberTasks.some((task) =>
        hasWorkspacePermission(
          getWorkspacePermissionForTask(graph, task.id),
          "edit",
        ),
      ),
    [graph, selectedMemberTasks],
  );
  const selectedMemberCanCreate =
    selectedMemberProjectId !== "all" &&
    hasWorkspacePermission(
      getWorkspacePermissionForList(graph, selectedMemberProjectId),
      "edit",
    );

  const totalDashboardTasks = dashboardTasks.length;
  const metricToneSeeds = Array.from(
    new Set(dashboardTasks.map((task) => task.listId)),
  );
  const doneDashboardTasks = doneStatusId
    ? dashboardTasks.filter((task) => task.statusId === doneStatusId).length
    : 0;
  const reviewDashboardTasks = reviewStatusId
    ? dashboardTasks.filter((task) => task.statusId === reviewStatusId).length
    : 0;
  const inProgressDashboardTasks = progressStatusId
    ? dashboardTasks.filter((task) => task.statusId === progressStatusId).length
    : 0;
  const todoDashboardTasks = todoStatusId
    ? dashboardTasks.filter((task) => task.statusId === todoStatusId).length
    : 0;

  if (selectedMember) {
    const selectedMemberDoneTasks = doneStatusId
      ? selectedMemberTasksBase.filter((task) => task.statusId === doneStatusId)
          .length
      : 0;
    const selectedMemberTodoTasks = todoStatusId
      ? selectedMemberTasksBase.filter((task) => task.statusId === todoStatusId)
          .length
      : 0;
    const selectedMemberProgressTasks = progressStatusId
      ? selectedMemberTasksBase.filter(
          (task) => task.statusId === progressStatusId,
        ).length
      : 0;
    const selectedMemberReviewTasks = reviewStatusId
      ? selectedMemberTasksBase.filter(
          (task) => task.statusId === reviewStatusId,
        ).length
      : 0;

    return (
      <>
        <div className="flex min-h-full flex-col gap-6 pb-6">
          <section>
            <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
              <div className="min-w-0">
                <button
                  type="button"
                  onClick={() => setSelectedMemberId(null)}
                  className={cn(
                    "mb-4 inline-flex cursor-pointer items-center gap-2 text-xs font-black uppercase tracking-[0.18em] transition-colors",
                    "text-(--ui-texto-secundario) hover:text-(--ui-texto-forte)",
                  )}
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Voltar
                </button>

                <div className="flex items-start gap-4">
                  <UserAvatar member={selectedMember} size={56} />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-3">
                      <h1
                        className={cn(
                          "text-3xl font-black tracking-tight",
                          "text-(--ui-texto-principal)",
                        )}
                      >
                        {selectedMember.name}
                      </h1>
                      <Badge variant="blue">
                        {selectedMember.role || "Membro"}
                      </Badge>
                    </div>
                    <p
                      className={cn(
                        "mt-2 max-w-3xl text-sm font-medium",
                        "text-(--ui-texto-secundario)",
                      )}
                    >
                      Gestão centralizada de tudo que está atribuído a este
                      membro. Ao mover um card aqui, a alteração é refletida no
                      projeto original.
                    </p>
                    {!!selectedMember.tags?.length && (
                      <div className="mt-4 flex flex-wrap gap-2">
                        {selectedMember.tags.map((tag) => (
                          <Badge
                            key={tag.id}
                            className="max-w-full truncate"
                            style={{
                              backgroundColor: `${tag.color}22`,
                              color: tag.color,
                              borderColor: `${tag.color}44`,
                            }}
                          >
                            {tag.name}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
                <Button
                  variant="secondary"
                  onClick={() =>
                    selectedMemberProjectId !== "all" &&
                    setActiveList(selectedMemberProjectId)
                  }
                  disabled={selectedMemberProjectId === "all"}
                  className="cursor-pointer"
                >
                  <Eye className="h-4 w-4" />
                  Abrir projeto
                </Button>
                <Button
                  onClick={() => setIsCreateTaskModalOpen(true)}
                  disabled={!selectedMemberCanCreate}
                  className="cursor-pointer"
                >
                  <Plus className="h-4 w-4" />
                  Novo card
                </Button>
              </div>
            </div>
          </section>

          <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
            <DashboardMetricCard
              title="Cards atribuídos"
              value={String(selectedMemberTasksBase.length)}
              helper="Tudo deste membro hoje"
              icon={Briefcase}
              toneSeed={selectedMember.id}
            />
            <DashboardMetricCard
              title="A fazer"
              value={String(selectedMemberTodoTasks)}
              helper="Para entrar em execução"
              icon={LayoutGrid}
              toneSeed={`${selectedMember.id}-todo`}
            />
            <DashboardMetricCard
              title={getTaskStatusLabel("Em andamento")}
              value={String(selectedMemberProgressTasks)}
              helper="Demandas em execução hoje"
              icon={Target}
              toneSeed={`${selectedMember.id}-progress`}
            />
            <DashboardMetricCard
              title={getTaskStatusLabel("Em revisão")}
              value={String(selectedMemberReviewTasks)}
              helper="Cards aguardando validação"
              icon={Eye}
              toneSeed={`${selectedMember.id}-review`}
            />
            <DashboardMetricCard
              title="Concluídos"
              value={String(selectedMemberDoneTasks)}
              helper="Entrega finalizada nesta visão"
              icon={CheckCircle2}
              toneSeed={`${selectedMember.id}-done`}
            />
          </section>

          <section
            className={cn(
              "border-t pt-6",
              "border-(--ui-borda)",
            )}
          >
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <p
                  className={cn(
                    "text-xs font-bold uppercase tracking-[0.24em]",
                    "text-(--ui-texto-secundario)",
                  )}
                >
                  Projetos
                </p>
                <h2
                  className={cn(
                    "mt-1 text-lg font-black",
                    "text-(--ui-texto-principal)",
                  )}
                >
                  Filtre o kanban por projeto
                </h2>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedMemberProjectId("all")}
                  className={cn(
                    "cursor-pointer rounded-full px-4 py-2 text-sm font-bold transition-colors",
                    selectedMemberProjectId === "all"
                      ? "bg-(--ui-azul-fundo) text-(--ui-azul-texto) ring-1 ring-(--ui-azul-borda)"
                      : "bg-(--ui-fundo-neutro) text-(--ui-texto-secundario) hover:text-(--ui-texto-forte)",
                  )}
                >
                  Todos os projetos
                </button>
                {selectedMemberProjects.map((project) => (
                  <button
                    key={project!.id}
                    type="button"
                    onClick={() => setSelectedMemberProjectId(project!.id)}
                    className={cn(
                      "cursor-pointer rounded-full px-4 py-2 text-sm font-bold transition-colors",
                      selectedMemberProjectId === project!.id
                        ? "bg-(--ui-azul-fundo) text-(--ui-azul-texto) ring-1 ring-(--ui-azul-borda)"
                        : "bg-(--ui-fundo-neutro) text-(--ui-texto-secundario) hover:text-(--ui-texto-forte)",
                    )}
                  >
                    {project!.name}
                    <span className="ml-2 opacity-70">
                      ({project!.taskCount})
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section
            className={cn(
              "border-t pt-6",
              "border-(--ui-borda)",
            )}
          >
            <div className="h-[68vh] min-h-136 overflow-hidden pb-2">
              <div className="h-full min-w-0">
                <TaskCollectionKanban
                  tasks={selectedMemberTasks}
                  canEditTasks={selectedMemberCanEditBoard}
                  isAdm={isAdm}
                  onAddTask={
                    selectedMemberProjectId === "all"
                      ? undefined
                      : (statusId) => {
                          setCreateTaskStatusId(statusId);
                          setIsCreateTaskModalOpen(true);
                        }
                  }
                  taskCardContextById={selectedMemberTaskContext}
                  emptyColumnMessage="Nenhum card deste membro nesta etapa."
                />
              </div>
            </div>
          </section>
        </div>

        <TaskCreateModal
          isOpen={isCreateTaskModalOpen}
          onClose={() => setIsCreateTaskModalOpen(false)}
          defaultStatusId={createTaskStatusId}
          listIdOverride={
            selectedMemberProjectId === "all"
              ? undefined
              : selectedMemberProjectId
          }
        />
      </>
    );
  }

  return (
    <div className="flex min-h-full flex-col gap-6 pb-6">
      <section>
        <div className="flex flex-col gap-6">
          <div className="max-w-3xl">
            <p
              className={cn(
                "text-xs font-bold uppercase tracking-[0.24em]",
                "text-(--ui-texto-secundario)",
              )}
            >
              Início
            </p>
            <h1
              className={cn(
                "mt-2 text-3xl font-black tracking-tight",
                "text-(--ui-texto-principal)",
              )}
            >
              {isAdm
                ? "Dashboard operacional da plataforma"
                : "Seu dashboard de entregas"}
            </h1>
            <p
              className={cn(
                "mt-3 text-sm font-medium leading-relaxed",
                "text-(--ui-texto-secundario)",
              )}
            >
              {isAdm
                ? "Acompanhe a plataforma inteira, foque no que estão atribuído a você e entre na visão detalhada dos membros que compartilham as mesmas tags do seu perfil."
                : "Acompanhe tudo que está sob sua responsabilidade, com visão consolidada dos seus cards em todos os projetos que você pode acessar."}
            </p>
          </div>

          <div
            className={cn(
              "w-full rounded-3xl border p-3 sm:p-4",
              "border-(--ui-borda) bg-(--ui-superficie)",
            )}
          >
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div className="relative w-full flex-1">
                <Search
                  className={cn(
                    "pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2",
                    "text-(--ui-texto-secundario)",
                  )}
                />
                <Input
                  value={draftSearch}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    setDraftSearch(nextValue);
                    startTransition(() => {
                      setSearch(nextValue);
                    });
                  }}
                  className={cn(
                    "h-11 w-full rounded-2xl pl-10 pr-3 text-sm",
                    "border-(--ui-borda-suave) bg-(--ui-fundo-sutil) text-(--text-main) placeholder:text-(--text-soft) focus:bg-(--ui-superficie) focus:ring-(--ui-azul-foco)",
                  )}
                  placeholder="Buscar por card, etiqueta, membro, projeto ou espaço..."
                />
              </div>

              {isAdm && (
                <div
                  className={cn(
                    "grid grid-cols-1 gap-2 rounded-2xl p-1 sm:grid-cols-2 xl:shrink-0",
                    "bg-(--ui-fundo-neutro)",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => setAdminScope("all")}
                    className={cn(
                      "cursor-pointer rounded-xl px-4 py-2 text-sm font-bold transition-colors",
                      adminScope === "all"
                        ? "bg-blue-600 text-white"
                        : "text-(--ui-texto-secundario) hover:text-(--ui-texto-forte)",
                    )}
                  >
                    Tudo da plataforma
                  </button>
                  <button
                    type="button"
                    onClick={() => setAdminScope("mine")}
                    className={cn(
                      "cursor-pointer rounded-xl px-4 py-2 text-sm font-bold transition-colors",
                      adminScope === "mine"
                        ? "bg-blue-600 text-white"
                        : "text-(--ui-texto-secundario) hover:text-(--ui-texto-forte)",
                    )}
                  >
                    Atribuído a mim
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      <section
        className={cn(
          "grid grid-cols-1 gap-4 border-t pt-6 md:grid-cols-2 xl:grid-cols-5",
          "border-(--ui-borda)",
        )}
      >
        <DashboardMetricCard
          title={isAdm && adminScope === "all" ? "Da plataforma" : "Meus cards"}
          value={String(totalDashboardTasks)}
          helper={
            isAdm && adminScope === "all"
              ? "Ativo nos projetos acessíveis"
              : "Cards que exigem sua atenção"
          }
          icon={Briefcase}
          toneSeed={metricToneSeeds[0] || "metric-total"}
        />
        <DashboardMetricCard
          title={getTaskStatusLabel("Em andamento")}
          value={String(inProgressDashboardTasks)}
          helper="Volume de execução agora"
          icon={Target}
          toneSeed={metricToneSeeds[1] || "metric-progress"}
        />
        <DashboardMetricCard
          title={getTaskStatusLabel("Em revisão")}
          value={String(reviewDashboardTasks)}
          helper="Cards aguardando validação"
          icon={Eye}
          toneSeed={metricToneSeeds[2] || "metric-review"}
        />
        <DashboardMetricCard
          title="A fazer"
          value={String(todoDashboardTasks)}
          helper="Para entrar em execução"
          icon={LayoutGrid}
          toneSeed={metricToneSeeds[3] || "metric-todo"}
        />
        <DashboardMetricCard
          title="Concluídos"
          value={String(doneDashboardTasks)}
          helper="Entrega finalizada nesta visão"
          icon={CheckCircle2}
          toneSeed={metricToneSeeds[4] || "metric-done"}
        />
      </section>

      {isAdm && dashboardWorkspaceSummaries.length > 0 && (
        <section
          className={cn(
            "space-y-5 border-t pt-6",
            "border-(--ui-borda)",
          )}
        >
          <div className="mb-5 flex flex-col gap-2">
            <p
              className={cn(
                "text-xs font-bold uppercase tracking-[0.24em]",
                "text-(--ui-texto-secundario)",
              )}
            >
              Campos personalizados
            </p>
            <h2
              className={cn(
                "text-lg font-black",
                "text-(--ui-texto-principal)",
              )}
            >
              Painel por espaço de trabalho
            </h2>
            <p
              className={cn(
                "text-sm font-medium",
                "text-(--ui-texto-secundario)",
              )}
            >
              Resumo dos campos marcados para dashboard em cada espaço de trabalho com
              cards visíveis nesta visão.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {dashboardWorkspaceSummaries.map((workspaceSummary) => (
              <div
                key={workspaceSummary.workspaceId}
                className={cn(
                  "rounded-3xl border p-5",
                  "border-(--ui-borda) bg-(--ui-superficie)",
                )}
              >
                <div className="mb-4 flex items-start justify-between gap-4">
                  <div>
                    <p
                      className={cn(
                        "text-xs font-bold uppercase tracking-[0.18em]",
                        "text-(--ui-texto-secundario)",
                      )}
                    >
                      Espaço de trabalho
                    </p>
                    <h3
                      className={cn(
                        "mt-1 text-base font-black",
                        "text-(--ui-texto-principal)",
                      )}
                    >
                      {workspaceSummary.workspaceName}
                    </h3>
                  </div>

                  <Badge variant="blue">
                    {workspaceSummary.taskCount} cards
                  </Badge>
                </div>

                <div className="space-y-3">
                  {workspaceSummary.fieldSummaries.map((summary) => (
                    <div
                      key={summary.field.id}
                      className={cn(
                        "rounded-2xl border p-4",
                        "border-(--ui-borda-suave) bg-(--ui-fundo-sutil)",
                      )}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p
                            className={cn(
                              "text-sm font-bold",
                              "text-(--ui-texto-principal)",
                            )}
                          >
                            {summary.field.name}
                          </p>
                          <p
                            className={cn(
                              "mt-1 text-xs font-medium",
                              "text-(--ui-texto-secundario)",
                            )}
                          >
                            {summary.filledCount}/{summary.totalTasks} tarefas
                            com valor preenchido
                          </p>
                        </div>

                        <Badge variant="purple">{summary.field.type}</Badge>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        {summary.topValues.length > 0 ? (
                          summary.topValues.map((value) => (
                            <span
                              key={`${summary.field.id}-${value.label}`}
                              className={cn(
                                "rounded-full px-2.5 py-1 text-[11px] font-bold",
                                "bg-(--ui-azul-fundo) text-(--ui-azul-texto)",
                              )}
                            >
                              {value.label} · {value.count}
                            </span>
                          ))
                        ) : (
                          <span
                            className={cn(
                              "text-xs font-medium",
                              "text-(--ui-texto-secundario)",
                            )}
                          >
                            Nenhum valor preenchido ainda.
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {isAdm && (
        <section
          className={cn(
            "space-y-5 border-t pt-6",
            "border-(--ui-borda)",
          )}
        >
          <div className="mb-5 flex flex-col gap-2">
            <p
              className={cn(
                "text-xs font-bold uppercase tracking-[0.24em]",
                "text-(--ui-texto-secundario)",
              )}
            >
              Equipe por tag
            </p>
            <h2
              className={cn(
                "text-lg font-black",
                "text-(--ui-texto-principal)",
              )}
            >
              Membros com a mesma especialidade do seu perfil
            </h2>
            <p
              className={cn(
                "text-sm font-medium",
                "text-(--ui-texto-secundario)",
              )}
            >
              Clique em um membro para abrir uma visão operacional completa dos
              cards dele.
            </p>
          </div>

          {matchingMembers.length === 0 ? (
            <div
              className={cn(
                "rounded-3xl border border-dashed px-6 py-12 text-center",
                "border-(--ui-borda) bg-(--ui-fundo-sutil)",
              )}
            >
              <p
                className={cn(
                  "text-base font-bold",
                  "text-(--ui-texto-principal)",
                )}
              >
                Nenhum membro encontrado com as mesmas tags.
              </p>
              <p
                className={cn(
                  "mt-2 text-sm font-medium",
                  "text-(--ui-texto-secundario)",
                )}
              >
                Defina tags no seu perfil e nos perfis da equipe para ativar
                esta visão.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
              {matchingMembers.map((member) => {
                const memberTasks = allTasks.filter((task) =>
                  task.assigneeIds.includes(member.id),
                );
                const memberProgress = progressStatusId
                  ? memberTasks.filter(
                      (task) => task.statusId === progressStatusId,
                    ).length
                  : 0;
                const memberDone = doneStatusId
                  ? memberTasks.filter((task) => task.statusId === doneStatusId)
                      .length
                  : 0;

                return (
                  <MemberOverviewCard
                    key={member.id}
                    member={member}
                    totalTasks={memberTasks.length}
                    inProgressTasks={memberProgress}
                    reviewTasks={
                      reviewStatusId
                        ? memberTasks.filter(
                            (task) => task.statusId === reviewStatusId,
                          ).length
                        : 0
                    }
                    completedTasks={memberDone}
                    onOpen={() => {
                      setSelectedMemberId(member.id);
                      setSelectedMemberProjectId("all");
                    }}
                  />
                );
              })}
            </div>
          )}
        </section>
      )}

      <section
        className={cn(
          "space-y-5 border-t pt-6",
          "border-(--ui-borda)",
        )}
      >
        <div className="mb-5 flex flex-col gap-2 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p
              className={cn(
                "text-xs font-bold uppercase tracking-[0.24em]",
                "text-(--ui-texto-secundario)",
              )}
            >
              Kanban consolidado
            </p>
            <h2
              className={cn(
                "mt-1 text-lg font-black",
                "text-(--ui-texto-principal)",
              )}
            >
              {isAdm && adminScope === "all"
                ? "Tudo que está acontecendo agora"
                : "Tudo que depende de você"}
            </h2>
          </div>

          <div className="flex flex-wrap gap-2">
            <Badge variant="blue">
              <LayoutGrid className="mr-1.5 h-3.5 w-3.5" />
              {totalDashboardTasks} cards
            </Badge>
            <Badge variant="purple">
              <Users className="mr-1.5 h-3.5 w-3.5" />
              {dashboardTasks.length
                ? new Set(dashboardTasks.flatMap((task) => task.assigneeIds))
                    .size
                : 0}{" "}
              membros
            </Badge>
          </div>
        </div>

        <div className="h-[68vh] min-h-136 overflow-hidden pb-2">
          <div className="h-full min-w-0">
            <TaskCollectionKanban
              tasks={dashboardTasks}
              canEditTasks={dashboardCanEdit}
              isAdm={isAdm}
              taskCardContextById={dashboardTaskContext}
              emptyColumnMessage="Nenhum card desta visão nesta etapa."
            />
          </div>
        </div>
      </section>
    </div>
  );
}
