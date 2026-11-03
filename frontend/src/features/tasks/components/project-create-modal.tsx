import { useEffect, useMemo, useRef, useState } from "react";
import { X, Lock, Globe, Check, ChevronDown } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import axios from "axios";

import { useTaskStore } from "../../../store/use-task-store";
import { useAuthStore } from "../../../store/use-auth-store";
import { useThemeStore } from "../../../store/use-theme-store";
import { cn } from "../../../lib/utils";
import { getVisibilityLabel } from "../../../lib/entity-visibility";
import {
  DEFAULT_ENTITY_COLOR,
  ENTITY_COLOR_OPTIONS,
  normalizeEntityColor,
  withAlpha,
} from "../../../lib/entity-colors";
import { Button } from "../../../components/ui/button";
import { FlightDatePicker } from "../../../components/ui/flight-date-picker";
import { UserAvatar } from "../../../components/ui/user-avatar";
import {
  getWorkspacePermissionForSelection,
  hasWorkspacePermission,
} from "../../../lib/workspace-permissions";
import type { EntityVisibility, TaskList } from "../../../types/tasks";
import { toast } from "../../../store/use-toast-store";

interface ProjectCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  project?: TaskList | null;
}

export function ProjectCreateModal({
  isOpen,
  onClose,
  project = null,
}: ProjectCreateModalProps) {
  const graph = useTaskStore((state) => state.graph);
  const selection = useTaskStore((state) => state.selection);
  const token = useAuthStore((state) => state.token);
  const authUser = useAuthStore((state) => state.user);
  const isDarkMode = useThemeStore((state) => state.mode === "dark");
  const queryClient = useQueryClient();
  const isAdm = authUser?.organization?.role === "owner" ||
    authUser?.organization?.role === "admin";
  const isEditMode = Boolean(project);

  const permission = getWorkspacePermissionForSelection(
    graph,
    selection.workspaceId,
    selection.listId,
  );
  const canEditProjects = hasWorkspacePermission(permission, "edit");

  const [name, setName] = useState("");
  const [selectedColor, setSelectedColor] =
    useState<string>(DEFAULT_ENTITY_COLOR);
  const [visibility, setVisibility] = useState<EntityVisibility>("private");
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [startDate, setStartDate] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [selectedTags, setSelectedTags] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);

  const [isVisibilityMenuOpen, setIsVisibilityMenuOpen] = useState(false);
  const [isAssigneeMenuOpen, setIsAssigneeMenuOpen] = useState(false);
  const [isTagMenuOpen, setIsTagMenuOpen] = useState(false);
  const [assigneeSearch, setAssigneeSearch] = useState("");
  const [assigneeTagFilter, setAssigneeTagFilter] = useState<string | null>(
    null,
  );

  const visibilityMenuRef = useRef<HTMLDivElement>(null);
  const assigneeMenuRef = useRef<HTMLDivElement>(null);
  const tagMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 1023px)");
    const updateViewport = (event?: MediaQueryListEvent) => {
      setIsMobileViewport(event ? event.matches : mediaQuery.matches);
    };

    updateViewport();
    mediaQuery.addEventListener("change", updateViewport);
    return () => mediaQuery.removeEventListener("change", updateViewport);
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    setName(project?.name || "");
    setSelectedColor(
      normalizeEntityColor(project?.color ?? project?.colorClass),
    );
    setVisibility(project?.visibility || "private");
    setAssigneeIds(project?.assigneeIds || []);
    setStartDate(project?.startDate || null);
    setDueDate(project?.dueDate || null);
    setSelectedTags(project?.tags || []);
    setIsVisibilityMenuOpen(false);
    setIsAssigneeMenuOpen(false);
    setIsTagMenuOpen(false);
    setAssigneeSearch("");
    setAssigneeTagFilter(null);
  }, [isOpen, project]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        visibilityMenuRef.current &&
        !visibilityMenuRef.current.contains(event.target as Node)
      ) {
        setIsVisibilityMenuOpen(false);
      }
      if (
        assigneeMenuRef.current &&
        !assigneeMenuRef.current.contains(event.target as Node)
      ) {
        setIsAssigneeMenuOpen(false);
      }
      if (
        tagMenuRef.current &&
        !tagMenuRef.current.contains(event.target as Node)
      ) {
        setIsTagMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !canEditProjects) return;

    if (isEditMode && project) {
      setIsLoading(true);

      try {
        await axios.put(
          `/api/workspaces/lists/${project.id}`,
          {
            name,
            color: selectedColor,
            visibility,
            startDate,
            dueDate,
            tags: selectedTags,
          },
          {
            headers: { Authorization: `Bearer ${token}` },
          },
        );

        const previousAssigneeIds = new Set(project.assigneeIds || []);
        const nextAssigneeIds = new Set(assigneeIds);
        const assigneeIdsToToggle = Array.from(
          new Set([
            ...Array.from(previousAssigneeIds).filter(
              (memberId) => !nextAssigneeIds.has(memberId),
            ),
            ...Array.from(nextAssigneeIds).filter(
              (memberId) => !previousAssigneeIds.has(memberId),
            ),
          ]),
        );

        if (assigneeIdsToToggle.length > 0) {
          await Promise.all(
            assigneeIdsToToggle.map((memberId) =>
              axios.put(
                `/api/workspaces/lists/${project.id}/assignees`,
                { memberId },
                {
                  headers: { Authorization: `Bearer ${token}` },
                },
              ),
            ),
          );
        }

        await queryClient.invalidateQueries({ queryKey: ["workspace-seed"] });

        setName("");
        setSelectedColor(DEFAULT_ENTITY_COLOR);
        setVisibility("private");
        setAssigneeIds([]);
        setStartDate(null);
        setDueDate(null);
        setSelectedTags([]);
        setAssigneeSearch("");
        setAssigneeTagFilter(null);
        toast.success("Projeto atualizado.", { message: name.trim() });
        onClose();
      } catch (error) {
        console.error("Erro ao atualizar projeto:", error);
        toast.error("Não foi possível atualizar o projeto.", {
          message: "As alterações não foram salvas.",
        });
      } finally {
        setIsLoading(false);
      }

      return;
    }

    let targetFolderId = selection.folderId ?? null;
    if (!targetFolderId && selection.workspaceId) {
      const workspace = graph.workspaces[selection.workspaceId];
      const firstSpaceId = workspace?.spaceIds?.[0];
      targetFolderId = firstSpaceId
        ? (graph.spaces[firstSpaceId]?.folderIds?.[0] ?? null)
        : null;
    }

    if (!targetFolderId) {
      toast.error("Nenhuma pasta destino encontrada para o projeto.", {
        message: "Crie um espaço com pasta antes de criar o projeto.",
      });
      return;
    }

    setIsLoading(true);

    try {
      const response = await axios.post(
        "/api/workspaces/lists",
        {
          name,
          color: selectedColor,
          visibility,
          folderId: targetFolderId,
          startDate,
          dueDate,
          assigneeIds,
          tags: selectedTags,
        },
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      await queryClient.invalidateQueries({ queryKey: ["workspace-seed"] });

      if (response.data?.list?.id) {
        setTimeout(() => {
          useTaskStore.getState().setActiveList(response.data.list.id);
        }, 300);
      }

      setName("");
      setSelectedColor(DEFAULT_ENTITY_COLOR);
      setVisibility("private");
      setAssigneeIds([]);
      setStartDate(null);
      setDueDate(null);
      setSelectedTags([]);
      setAssigneeSearch("");
      setAssigneeTagFilter(null);
      toast.success("Projeto criado.", { message: name.trim() });
      onClose();
    } catch (error) {
      console.error("Erro ao criar projeto:", error);
      toast.error("Não foi possível criar o projeto.", {
        message: "Revise os dados e tente de novo.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const toggleAssignee = (id: string) => {
    setAssigneeIds((previous) =>
      previous.includes(id)
        ? previous.filter((assigneeId) => assigneeId !== id)
        : [...previous, id],
    );
  };

  const toggleTag = (tag: any) => {
    setSelectedTags((previous) =>
      previous.find((currentTag) => currentTag.id === tag.id)
        ? previous.filter((currentTag) => currentTag.id !== tag.id)
        : [...previous, tag],
    );
  };

  const members = Object.values(graph.members || {});
  const allTags = Object.values(graph.tags || {});
  const assigneeFilterTags = useMemo(
    () =>
      Array.from(
        new Map(
          members.flatMap((member) =>
            (member.tags || []).map((tag) => [tag.id, tag] as const),
          ),
        ).values(),
      ),
    [members],
  );
  const filteredMembers = useMemo(() => {
    const normalizedSearch = assigneeSearch.trim().toLowerCase();

    return members.filter((member) => {
      const matchesSearch =
        !normalizedSearch ||
        member.name.toLowerCase().includes(normalizedSearch) ||
        member.role.toLowerCase().includes(normalizedSearch) ||
        member.email?.toLowerCase().includes(normalizedSearch);
      const matchesTag =
        !assigneeTagFilter || (member.tagIds || []).includes(assigneeTagFilter);

      return matchesSearch && matchesTag;
    });
  }, [assigneeSearch, assigneeTagFilter, members]);
  const availableVisibilityOptions = [
    {
      value: "private" as EntityVisibility,
      title: "Privado",
      description:
        "Visivel so para voce. Atribuicoes e etiquetas podem ampliar esse acesso.",
      icon: Lock,
      iconClassName: "text-rose-500",
    },
    {
      value: "public" as EntityVisibility,
      title: "Publico",
      description: "Visivel para todos que acessam este espaço de trabalho.",
      icon: Globe,
      iconClassName: "text-blue-500",
    },
    ...(isAdm
      ? [
          {
            value: "admin_private" as EntityVisibility,
            title: "Privado ADM",
            description:
              "Somente o criador enxerga, inclusive contra outros administradores.",
            icon: Lock,
            iconClassName: "text-amber-500",
          },
        ]
      : []),
  ];

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-9999 flex items-end justify-center overflow-y-auto p-0 sm:items-center sm:px-4 sm:py-4">
      <div
        className="pauta-theme-overlay absolute inset-0 backdrop-blur-sm animate-in fade-in duration-300"
        onClick={onClose}
      />
      <div
        className={cn(
          "relative z-10 flex h-dvh w-full max-w-none flex-col overflow-hidden rounded-none border-0 animate-in zoom-in-95 duration-300 sm:h-auto sm:max-h-[calc(78vh-2rem)] sm:max-w-lg sm:rounded-3xl sm:border",
          "pauta-theme-surface text-(--ui-texto-principal) border-(--ui-borda-suave) bg-(--ui-superficie-suave) shadow-2xl",
        )}
      >
        <div
          className={cn(
            "sticky top-0 z-10 flex items-center justify-between gap-4 border-b px-4 py-4 sm:px-6 sm:py-5",
            "border-(--ui-borda-suave) bg-(--ui-superficie-suave) backdrop-blur-sm",
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
          <h2
            className={cn(
              "text-lg font-black tracking-tight sm:text-xl",
              "text-(--ui-texto-principal)",
            )}
          >
            {isEditMode ? "Editar Projeto" : "Criar Novo Projeto"}
          </h2>
          <button
            onClick={onClose}
            className={cn(
              "pauta-touch-target rounded-full p-2 transition-all cursor-pointer",
              "text-(--ui-texto-secundario) hover:bg-(--ui-hover) hover:text-(--ui-texto-forte)",
            )}
          
            aria-label="Fechar"
            title="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="pauta-scroll-safe min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
            <div className="space-y-5 sm:space-y-6">
              {!canEditProjects && (
                <div
                  className={cn(
                    "rounded-2xl border px-4 py-3 text-sm font-medium",
                    "border-(--ui-ambar-borda) bg-(--ui-ambar-fundo) text-(--ui-ambar-texto)",
                  )}
                >
                  {isEditMode
                    ? "Seu nível de acesso atual não permite editar projetos neste espaço."
                    : "Seu nível de acesso atual não permite criar projetos neste espaço."}
                </div>
              )}

              <div className="space-y-2">
                <label
                  className={cn(
                    "text-[11px] font-bold uppercase tracking-widest",
                    "text-(--ui-texto-secundario)",
                  )}
                >
                  Nome do Projeto
                </label>
                <input aria-label="Ex: Redesign do App Mobile"
                  autoFocus
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Ex: Redesign do App Mobile"
                  className={cn(
                    "w-full rounded-2xl border px-4 py-3.5 text-sm font-bold outline-none transition-all",
                    isDarkMode
                      ? "border-(--border-subtle) bg-(--bg-surface) text-(--text-main) placeholder:text-(--text-soft) focus:border-blue-500/40 focus:ring-4 focus:ring-blue-500/15"
                      : "border-slate-200 bg-slate-50/50 text-slate-900 placeholder:text-slate-500 focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10",
                  )}
                />
              </div>

              <div className="space-y-3">
                <label
                  className={cn(
                    "text-[11px] font-bold uppercase tracking-widest",
                    "text-(--ui-texto-secundario)",
                  )}
                >
                  Cor do Projeto
                </label>

                <div
                  className={cn(
                    "flex items-center gap-3 rounded-2xl border p-3",
                    "border-(--ui-borda) bg-(--ui-fundo-sutil)",
                  )}
                >
                  <div
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border"
                    style={{
                      backgroundColor: withAlpha(
                        selectedColor,
                        isDarkMode ? 0.18 : 0.12,
                      ),
                      borderColor: withAlpha(
                        selectedColor,
                        isDarkMode ? 0.4 : 0.24,
                      ),
                    }}
                  >
                    <span
                      className="h-3 w-3 rounded-full"
                      style={{ backgroundColor: selectedColor }}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        "text-sm font-bold",
                        "text-(--ui-texto-principal)",
                      )}
                    >
                      {name.trim() || "Projeto sem nome"}
                    </p>
                    <p
                      className={cn(
                        "text-[11px] font-medium",
                        "text-(--ui-texto-secundario)",
                      )}
                    >
                      Essa cor será exibida na sidebar.
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  {ENTITY_COLOR_OPTIONS.map((color) => {
                    const isSelected = selectedColor === color;

                    return (
                      <button
                        key={color}
                        type="button"
                        onClick={() => setSelectedColor(color)}
                        className={cn(
                          "flex h-8 w-8 items-center justify-center rounded-full border transition-transform cursor-pointer",
                          isSelected && "scale-110",
                          "border-(--ui-borda)",
                        )}
                        style={{
                          backgroundColor: color,
                          boxShadow: isSelected
                            ? `0 0 0 3px ${withAlpha(color, 0.25)}`
                            : undefined,
                        }}
                        aria-label={`Selecionar cor ${color}`}
                      >
                        {isSelected && (
                          <Check className="h-3.5 w-3.5 text-white" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 text-left sm:grid-cols-2">
                <div className="relative space-y-2" ref={visibilityMenuRef}>
                  <label
                    className={cn(
                      "text-[11px] font-bold uppercase tracking-widest",
                      "text-(--ui-texto-secundario)",
                    )}
                  >
                    Visibilidade
                  </label>
                  <button
                    type="button"
                    onClick={() => setIsVisibilityMenuOpen((value) => !value)}
                    className={cn(
                      "flex h-11.5 w-full items-center justify-between rounded-2xl border px-4 text-sm font-bold transition-all cursor-pointer",
                      "border-(--ui-borda) bg-(--bg-surface) text-(--ui-texto-forte) hover:bg-(--ui-hover)",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      {visibility === "public" ? (
                        <Globe className="h-4 w-4 text-blue-500" />
                      ) : visibility === "admin_private" ? (
                        <Lock className="h-4 w-4 text-amber-500" />
                      ) : (
                        <Lock className="h-4 w-4 text-rose-500" />
                      )}
                      {getVisibilityLabel(visibility)}
                    </div>
                    <ChevronDown
                      className={cn(
                        "h-4 w-4 transition-transform",
                        "text-(--ui-texto-apagado)",
                        isVisibilityMenuOpen && "rotate-180",
                      )}
                    />
                  </button>

                  {isVisibilityMenuOpen && (
                    <div
                      className={cn(
                        "absolute left-0 top-[calc(100%+4px)] z-60 w-full rounded-2xl border p-2 animate-in fade-in slide-in-from-top-2",
                        "pauta-theme-menu",
                      )}
                    >
                      {availableVisibilityOptions.map((option) => {
                        const Icon = option.icon;
                        return (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => {
                              setVisibility(option.value);
                              setIsVisibilityMenuOpen(false);
                            }}
                            className={cn(
                              "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors cursor-pointer",
                              "hover:bg-(--ui-hover)",
                            )}
                          >
                            <Icon
                              className={cn(
                                "h-4 w-4 shrink-0",
                                option.iconClassName,
                              )}
                            />
                            <div className="flex-1">
                              <p
                                className={cn(
                                  "text-xs font-bold",
                                  "text-(--ui-texto-principal)",
                                )}
                              >
                                {option.title}
                              </p>
                              <p
                                className={cn(
                                  "text-[10px] font-medium",
                                  "text-(--ui-texto-secundario)",
                                )}
                              >
                                {option.description}
                              </p>
                            </div>
                            {visibility === option.value && (
                              <Check className="h-3.5 w-3.5 shrink-0 text-blue-600" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="flex min-w-0 flex-col space-y-2">
                  <label
                    className={cn(
                      "text-[11px] font-bold uppercase tracking-widest",
                      "text-(--ui-texto-secundario)",
                    )}
                  >
                    Prazo
                  </label>
                  <FlightDatePicker
                    startDate={startDate}
                    endDate={dueDate}
                    onChange={(nextStart, nextEnd) => {
                      setStartDate(nextStart);
                      setDueDate(nextEnd);
                    }}
                    className="h-11.5 w-full"
                  />
                </div>
              </div>

              <div className="relative space-y-2" ref={assigneeMenuRef}>
                <label
                  className={cn(
                    "block text-left text-[11px] font-bold uppercase tracking-widest",
                    "text-(--ui-texto-secundario)",
                  )}
                >
                  Atribuído a
                </label>
                <p
                  className={cn(
                    "text-left text-[11px] font-medium",
                    "text-(--ui-texto-secundario)",
                  )}
                >
                  Em projeto privado, o criador e os membros atribuidos ganham
                  acesso.
                </p>
                <div
                  className={cn(
                    "flex min-h-11.5 flex-wrap gap-2 rounded-2xl border px-4 py-2 transition-all cursor-pointer",
                    "border-(--ui-borda) bg-(--bg-surface) hover:bg-(--ui-hover)",
                  )}
                  onClick={() => setIsAssigneeMenuOpen((value) => !value)}
                >
                  {assigneeIds.length === 0 ? (
                    <span
                      className={cn(
                        "self-center text-sm font-bold",
                        "text-(--ui-texto-secundario)",
                      )}
                    >
                      Ninguém atribuído
                    </span>
                  ) : (
                    <div className="flex items-center gap-1.5 self-center">
                      {assigneeIds.map((id) => (
                        <UserAvatar
                          key={id}
                          member={graph.members[id]}
                          size={28}
                        />
                      ))}
                    </div>
                  )}
                  <ChevronDown
                    className={cn(
                      "ml-auto h-4 w-4 self-center transition-transform",
                      "text-(--ui-texto-apagado)",
                      isAssigneeMenuOpen && "rotate-180",
                    )}
                  />
                </div>

                {isAssigneeMenuOpen && (
                  <div
                    className={cn(
                      "absolute left-0 top-[calc(100%+4px)] z-60 w-full rounded-2xl border p-3 animate-in fade-in slide-in-from-top-2",
                      "pauta-theme-menu",
                    )}
                  >
                    <p
                      className={cn(
                        "mb-1.5 px-2 text-left text-[10px] font-bold uppercase tracking-widest",
                        "text-(--ui-texto-secundario)",
                      )}
                    >
                      Membros do Time
                    </p>
                    <input aria-label="Buscar membro por nome, cargo ou e-mail"
                      value={assigneeSearch}
                      onChange={(event) =>
                        setAssigneeSearch(event.target.value)
                      }
                      placeholder="Buscar membro por nome, cargo ou e-mail"
                      className={cn(
                        "mb-3 w-full rounded-xl border px-3 py-2 text-sm outline-none transition-all",
                        "border-(--ui-borda) bg-(--ui-fundo-sutil) text-(--ui-texto-principal) placeholder:text-(--ui-texto-secundario) focus:border-(--ui-azul-borda-foco)",
                      )}
                    />
                    <div className="-mx-1 mb-3 overflow-x-auto pb-1">
                      <div className="flex w-max min-w-full gap-2 px-1">
                        <button
                          type="button"
                          onClick={() => setAssigneeTagFilter(null)}
                          className={cn(
                            "shrink-0 cursor-pointer whitespace-nowrap rounded-full border px-3 py-1 text-[11px] font-black transition-all hover:opacity-85",
                            assigneeTagFilter === null
                              ? "border-(--ui-azul-borda) bg-(--ui-azul-fundo) text-(--ui-azul-texto)"
                              : "border-(--ui-borda) text-(--ui-texto-secundario)",
                          )}
                        >
                          Todas
                        </button>
                        {assigneeFilterTags.map((tag) => (
                          <button
                            key={tag.id}
                            type="button"
                            onClick={() =>
                              setAssigneeTagFilter((current) =>
                                current === tag.id ? null : tag.id,
                              )
                            }
                            className={cn(
                              "shrink-0 cursor-pointer whitespace-nowrap rounded-full border px-3 py-1 text-[11px] font-black transition-all hover:opacity-85",
                              assigneeTagFilter === tag.id
                                ? "text-white"
                                : "border-(--ui-borda) text-(--ui-texto-secundario)",
                            )}
                            style={
                              assigneeTagFilter === tag.id
                                ? {
                                    backgroundColor: tag.color,
                                    borderColor: tag.color,
                                  }
                                : undefined
                            }
                          >
                            {tag.name}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="max-h-56 space-y-1.5 overflow-y-auto">
                      {filteredMembers.map((member) => (
                        <button
                          key={member.id}
                          type="button"
                          onClick={() => toggleAssignee(member.id)}
                          className={cn(
                            "flex w-full items-center gap-2 rounded-xl px-2 py-1.5 transition-colors cursor-pointer",
                            "hover:bg-(--ui-hover)",
                          )}
                        >
                          <UserAvatar member={member} size={24} />
                          <div className="min-w-0 flex-1 text-left">
                            <p
                              className={cn(
                                "truncate text-xs font-bold",
                                "text-(--ui-texto-forte)",
                              )}
                            >
                              {member.name}
                            </p>
                            <p
                              className={cn(
                                "text-[10px] font-medium",
                                "text-(--ui-texto-secundario)",
                              )}
                            >
                              {member.role}
                            </p>
                            {!!member.tags?.length && (
                              <div className="mt-1.5 flex flex-wrap gap-1">
                                {member.tags.slice(0, 3).map((tag) => (
                                  <span
                                    key={tag.id}
                                    className="rounded-full px-2 py-0.5 text-[9px] font-black text-white"
                                    style={{ backgroundColor: tag.color }}
                                  >
                                    {tag.name}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                          {assigneeIds.includes(member.id) && (
                            <Check className="h-3.5 w-3.5 shrink-0 text-blue-600" />
                          )}
                        </button>
                      ))}
                      {filteredMembers.length === 0 && (
                        <div
                          className={cn(
                            "rounded-xl border px-3 py-4 text-center text-xs font-bold",
                            "border-(--ui-borda) text-(--ui-texto-secundario)",
                          )}
                        >
                          Nenhum membro encontrado para esse filtro.
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="relative space-y-2" ref={tagMenuRef}>
                <label
                  className={cn(
                    "block text-left text-[11px] font-bold uppercase tracking-widest",
                    "text-(--ui-texto-secundario)",
                  )}
                >
                  Etiquetas
                </label>
                <p
                  className={cn(
                    "text-left text-[11px] font-medium",
                    "text-(--ui-texto-secundario)",
                  )}
                >
                  Em projeto privado, membros com etiquetas correspondentes
                  tambem poderao visualizar.
                </p>
                <div
                  className={cn(
                    "flex min-h-11.5 items-center gap-2 overflow-hidden rounded-2xl border px-4 py-2 transition-all cursor-pointer",
                    "border-(--ui-borda) bg-(--bg-surface) hover:bg-(--ui-hover)",
                  )}
                  onClick={() => setIsTagMenuOpen((value) => !value)}
                >
                  {selectedTags.length === 0 ? (
                    <span
                      className={cn(
                        "text-sm font-bold",
                        "text-(--ui-texto-secundario)",
                      )}
                    >
                      Adicionar etiquetas
                    </span>
                  ) : (
                    <div className="flex flex-1 flex-wrap gap-1.5 overflow-hidden">
                      {selectedTags.map((tag) => (
                        <span
                          key={tag.id}
                          className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-black leading-none text-white"
                          style={{ backgroundColor: tag.color }}
                        >
                          {tag.name}
                        </span>
                      ))}
                    </div>
                  )}
                  <ChevronDown
                    className={cn(
                      "ml-auto h-4 w-4 shrink-0 transition-transform",
                      "text-(--ui-texto-apagado)",
                      isTagMenuOpen && "rotate-180",
                    )}
                  />
                </div>

                {isTagMenuOpen && (
                  <div
                    className={cn(
                      "absolute left-0 top-[calc(100%+4px)] z-60 w-full rounded-2xl border p-3 animate-in fade-in slide-in-from-top-2",
                      "pauta-theme-menu",
                    )}
                  >
                    <p
                      className={cn(
                        "mb-2 px-1 text-left text-[10px] font-bold uppercase tracking-widest",
                        "text-(--ui-texto-secundario)",
                      )}
                    >
                      Etiquetas Disponíveis
                    </p>
                    <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto py-2">
                      {allTags.map((tag) => {
                        const isSelected = !!selectedTags.find(
                          (currentTag) => currentTag.id === tag.id,
                        );

                        return (
                          <button
                            key={tag.id}
                            type="button"
                            onClick={() => toggleTag(tag)}
                            className={cn(
                              "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[10px] font-black transition-all cursor-pointer",
                              isSelected
                                ? "opacity-100 outline-2 outline-offset-1 outline-white/60"
                                : "opacity-70 hover:opacity-100",
                            )}
                            style={{
                              backgroundColor: tag.color,
                              color: "white",
                            }}
                          >
                            {tag.name}
                            {isSelected && (
                              <Check className="h-3 w-3 shrink-0" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              <div
                className={cn(
                  "rounded-2xl border px-4 py-3 text-left text-sm font-medium",
                  "border-(--ui-borda) bg-(--ui-fundo-sutil) text-(--ui-texto-secundario)",
                )}
              >
                <p>
                  {visibility === "admin_private"
                    ? "Privado ADM: somente o criador visualiza este projeto, inclusive contra outros administradores."
                    : visibility === "private"
                      ? "Privado: so o criador enxerga por padrao. Atribuicoes adicionam acesso de edicao, e etiquetas adicionam acesso de visualizacao."
                      : "Publico: o projeto fica visivel para todos os usuarios com acesso ao espaço de trabalho."}
                </p>
              </div>
            </div>
          </div>

          <div
            className={cn(
              "flex shrink-0 flex-col-reverse gap-3 border-t px-4 py-4 sm:flex-row sm:justify-end sm:px-6",
              "border-(--ui-borda-suave) bg-(--ui-fundo-sutil)",
            )}
            style={
              isMobileViewport
                ? {
                    paddingBottom:
                      "calc(env(safe-area-inset-bottom, 0px) + 1rem)",
                    paddingLeft: "calc(env(safe-area-inset-left, 0px) + 1rem)",
                    paddingRight:
                      "calc(env(safe-area-inset-right, 0px) + 1rem)",
                  }
                : undefined
            }
          >
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              className="w-full rounded-2xl px-6 py-3 font-bold cursor-pointer sm:w-auto"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={!name.trim() || isLoading || !canEditProjects}
              className={cn(
                "w-full rounded-2xl px-8 py-3 font-bold transition-all cursor-pointer sm:w-auto",
                isDarkMode
                  ? "bg-blue-600 hover:bg-blue-500 shadow-lg shadow-blue-950/35"
                  : "bg-blue-600 hover:bg-blue-700 shadow-lg shadow-blue-200",
              )}
            >
              {isLoading
                ? isEditMode
                  ? "Salvando..."
                  : "Criando..."
                : isEditMode
                  ? "Salvar Alterações"
                  : "Criar Projeto"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
