import { zodResolver } from "@hookform/resolvers/zod";
import { Check, Globe, Lock, Plus, X } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { useEffect, useMemo, useRef, useState } from "react";

import { getVisibilityLabel } from "../../../lib/entity-visibility";
import { getTaskStatusLabel } from "../../../lib/task-status-label";
import { getStatusesForList } from "../../../lib/status-columns";
import { cn } from "../../../lib/utils";
import { Button } from "../../../components/ui/button";
import {
  CustomFieldEditor,
  sortCustomFieldDefinitions,
  validateCustomFieldValues,
} from "../../../components/ui/custom-field-editor";
import { Input } from "../../../components/ui/input";
import { UserAvatar } from "../../../components/ui/user-avatar";
import { useAuthStore } from "../../../store/use-auth-store";
import { useTaskStore } from "../../../store/use-task-store";
import { useThemeStore } from "../../../store/use-theme-store";
import {
  TASK_PRIORITY_VALUES,
  type CustomFieldDefinition,
  type CustomFieldValue,
  type EntityVisibility,
  type TaskPriority,
} from "../../../types/tasks";
import { FlightDatePicker } from "../../../components/ui/flight-date-picker";
import {
  getWorkspacePermissionForList,
  hasWorkspacePermission,
} from "../../../lib/workspace-permissions";
import { TimeEstimateDropdown } from "../../../components/ui/time-estimate-dropdown";
import { toast } from "../../../store/use-toast-store";

const createTaskSchema = z.object({
  title: z.string().min(3, "Informe um título com pelo menos 3 caracteres."),
  descriptionText: z.string().optional(),
  statusId: z.string().min(1, "Selecione um status."),
  priority: z.enum(TASK_PRIORITY_VALUES),
});

type CreateTaskFormValues = z.infer<typeof createTaskSchema>;
const priorityLabels: Record<TaskPriority, string> = {
  urgent: "Urgente",
  high: "Alta",
  medium: "Média",
  low: "Baixa",
};

function buildInitialCustomFieldValues(fields: CustomFieldDefinition[]) {
  return fields.reduce<Record<string, CustomFieldValue>>(
    (accumulator, field) => {
      if (field.defaultValue !== undefined) {
        accumulator[field.id] = field.defaultValue;
        return accumulator;
      }

      if (field.type === "checkbox") {
        accumulator[field.id] = false;
      }

      return accumulator;
    },
    {},
  );
}

interface TaskCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultStatusId?: string;
  listIdOverride?: string;
  /** Prazo já preenchido (ex.: dia clicado no calendário), em ISO. */
  defaultDueDate?: string | null;
}

export function TaskCreateModal({
  isOpen,
  onClose,
  defaultStatusId,
  listIdOverride,
  defaultDueDate,
}: TaskCreateModalProps) {
  const graph = useTaskStore((state) => state.graph);
  const selection = useTaskStore((state) => state.selection);
  const addTask = useTaskStore((state) => state.addTask);
  const resolvedListId = listIdOverride ?? selection.listId;
  const activeList = resolvedListId ? graph.lists[resolvedListId] : undefined;
  const activeFolder = activeList
    ? graph.folders[activeList.folderId]
    : undefined;
  const activeSpace = activeFolder
    ? graph.spaces[activeFolder.spaceId]
    : undefined;
  const activeWorkspace = activeSpace
    ? graph.workspaces[activeSpace.workspaceId]
    : undefined;
  const [isLoading, setIsLoading] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const isDarkMode = useThemeStore((state) => state.mode === "dark");
  const permission = useTaskStore((state) =>
    getWorkspacePermissionForList(
      state.graph,
      listIdOverride ?? state.selection.listId,
    ),
  );
  const canEditTasks = hasWorkspacePermission(permission, "edit");

  const memberOptions = Object.values(graph.members);
  const tagOptions = Object.values(graph.tags);
  const [selectedAssignees, setSelectedAssignees] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [visibility, setVisibility] = useState<EntityVisibility>("public");
  const [isAssigneePickerOpen, setIsAssigneePickerOpen] = useState(false);
  const [assigneeSearch, setAssigneeSearch] = useState("");
  const [assigneeTagFilter, setAssigneeTagFilter] = useState<string | null>(
    null,
  );
  const assigneePickerRef = useRef<HTMLDivElement>(null);

  // Date State
  const [startDate, setStartDate] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<string | null>(null);
  const [customFieldValues, setCustomFieldValues] = useState<
    Record<string, CustomFieldValue>
  >({});
  const [customFieldErrors, setCustomFieldErrors] = useState<
    Partial<Record<string, string>>
  >({});
  const authUser = useAuthStore((state) => state.user);
  const isAdm = authUser?.organization?.role === "owner" ||
    authUser?.organization?.role === "admin";
  const activeWorkspaceCustomFields = useMemo(() => {
    if (!activeWorkspace) {
      return [] as CustomFieldDefinition[];
    }

    const fieldIds = activeWorkspace.customFieldIds || [];
    const fields = fieldIds.length
      ? fieldIds
          .map((fieldId) => graph.customFieldDefinitions[fieldId])
          .filter(Boolean)
      : Object.values(graph.customFieldDefinitions).filter(
          (field) => field.workspaceId === activeWorkspace.id,
        );

    return sortCustomFieldDefinitions(fields);
  }, [activeWorkspace, graph.customFieldDefinitions]);
  const assigneeFilterTags = useMemo(
    () =>
      Array.from(
        new Set(
          memberOptions.flatMap((member) =>
            (member.tagIds || []).filter((tagId) => graph.tags[tagId]),
          ),
        ),
      )
        .map((tagId) => graph.tags[tagId])
        .filter(Boolean),
    [graph.tags, memberOptions],
  );
  const filteredMemberOptions = useMemo(() => {
    const normalizedSearch = assigneeSearch.trim().toLowerCase();

    return memberOptions.filter((member) => {
      const matchesSearch =
        !normalizedSearch ||
        member.name.toLowerCase().includes(normalizedSearch) ||
        member.role.toLowerCase().includes(normalizedSearch) ||
        member.email?.toLowerCase().includes(normalizedSearch);
      const matchesTag =
        !assigneeTagFilter || (member.tagIds || []).includes(assigneeTagFilter);

      return matchesSearch && matchesTag;
    });
  }, [assigneeSearch, assigneeTagFilter, memberOptions]);
  const selectedAssigneeMembers = useMemo(
    () =>
      selectedAssignees
        .map((memberId) => graph.members[memberId])
        .filter(Boolean),
    [graph.members, selectedAssignees],
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 1023px)");
    const updateViewport = (event?: MediaQueryListEvent) => {
      setIsMobileViewport(event ? event.matches : mediaQuery.matches);
    };

    updateViewport();
    mediaQuery.addEventListener("change", updateViewport);
    return () => mediaQuery.removeEventListener("change", updateViewport);
  }, []);
  const availableVisibilityOptions = useMemo(() => {
    const options: EntityVisibility[] = ["public", "private"];

    if (isAdm) {
      options.push("admin_private");
    }

    if (activeList?.visibility === "admin_private") {
      return options.filter((option) => option === "admin_private");
    }

    if (activeList?.visibility === "private") {
      return options.filter((option) => option !== "public");
    }

    return options;
  }, [activeList?.visibility, isAdm]);

  const form = useForm<CreateTaskFormValues>({
    resolver: zodResolver(createTaskSchema),
    defaultValues: {
      title: "",
      descriptionText: "",
      statusId: defaultStatusId || (graph.statusDefinitions[0]?.id ?? ""),
      priority: "medium",
    },
  });
  // Hook para fechar o modal ao pressionar ESC
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (isOpen) {
      document.addEventListener("keydown", handleKeyDown);
    }
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isAssigneePickerOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (
        assigneePickerRef.current &&
        !assigneePickerRef.current.contains(event.target as Node)
      ) {
        setIsAssigneePickerOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isAssigneePickerOpen]);

  // Atualiza defaultValues se defaultStatusId mudar e modal abrir
  useEffect(() => {
    if (isOpen) {
      form.reset({
        title: "",
        descriptionText: "",
        statusId: defaultStatusId || (graph.statusDefinitions[0]?.id ?? ""),
        priority: "medium",
      });
      setSelectedAssignees([]);
      setStartDate(null);
      setDueDate(defaultDueDate ?? null);
      setEstimate(null);
      setIsAssigneePickerOpen(false);
      setAssigneeSearch("");
      setAssigneeTagFilter(null);
      setCustomFieldErrors({});
      setVisibility(
        activeList?.visibility === "admin_private"
          ? "admin_private"
          : activeList?.visibility === "private"
            ? "private"
            : "public",
      );

      // Inherit tags from active project (list)
      if (activeList?.tags) {
        setSelectedTags(activeList.tags.map((t) => t.id));
      } else {
        setSelectedTags([]);
      }

      setCustomFieldValues(
        buildInitialCustomFieldValues(activeWorkspaceCustomFields),
      );
    }
  }, [
    isOpen,
    defaultStatusId,
    defaultDueDate,
    graph.statusDefinitions,
    form,
    activeList,
    activeWorkspaceCustomFields,
  ]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-9999 flex items-end justify-center overflow-y-auto p-0 sm:items-center sm:p-4">
      <div
        className="pauta-theme-overlay absolute inset-0 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />
      <div
        className={cn(
          "relative z-10 flex h-dvh w-full max-w-none flex-col overflow-hidden rounded-none border-0 shadow-2xl sm:h-auto sm:max-h-[calc(70vh-2rem)] sm:max-w-xl sm:rounded-3xl sm:border sm:min-w-xl",
          "pauta-theme-surface bg-(--ui-superficie-suave) border-(--ui-borda)",
          "animate-in fade-in zoom-in-95 duration-200",
        )}
      >
        <div
          className={cn(
            "sticky top-0 z-10 flex items-start justify-between gap-4 border-b px-4 py-4 sm:rounded-t-3xl sm:px-8 sm:py-6",
            "bg-(--ui-superficie-suave) border-(--ui-borda-suave) backdrop-blur-sm",
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
          <div className="min-w-0">
            <h2
              className={cn(
                "text-lg font-bold sm:text-xl",
                "text-(--ui-texto-principal)",
              )}
            >
              Novo card no Kanban
            </h2>
            <p
              className={cn(
                "text-xs font-medium sm:text-sm",
                "text-(--ui-texto-secundario)",
              )}
            >
              {activeList
                ? `Adicionando na lista ${activeList.name}`
                : "Nenhuma lista ativa"}
            </p>
          </div>
          <button
            onClick={onClose}
            className={cn(
              "pauta-touch-target shrink-0 rounded-full p-2 transition-colors cursor-pointer",
              "text-(--ui-texto-secundario) hover:bg-(--ui-hover-forte) hover:text-(--ui-texto-forte)",
            )}
          
            aria-label="Fechar"
            title="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={form.handleSubmit(async (values) => {
            if (!activeList || !resolvedListId || !canEditTasks) return;

            const nextCustomFieldErrors = validateCustomFieldValues(
              activeWorkspaceCustomFields,
              customFieldValues,
            );
            if (Object.keys(nextCustomFieldErrors).length > 0) {
              setCustomFieldErrors(nextCustomFieldErrors);
              return;
            }

            setIsLoading(true);
            try {
              await addTask({
                listId: resolvedListId,
                title: values.title,
                descriptionText: values.descriptionText || "",
                statusId: values.statusId,
                priority: values.priority,
                visibility,
                startDate: startDate,
                dueDate: dueDate,
                assigneeIds: selectedAssignees,
                tags: selectedTags.map((id) => graph.tags[id]).filter(Boolean),
                estimate: estimate,
                customFieldValues,
              });

              onClose();
            } catch (error) {
              console.error("Erro ao criar tarefa:", error);
              toast.error("Não foi possível criar o card.", {
                message: "Revise os dados e tente de novo.",
              });
            } finally {
              setIsLoading(false);
            }
          })}
        >
          <div className="pauta-scroll-safe min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-8 sm:py-8">
            <div className="space-y-5 sm:space-y-6">
              {!canEditTasks && (
                <div
                  className={cn(
                    "mb-4 rounded-2xl border px-4 py-3 text-sm font-medium",
                    "border-(--ui-ambar-borda) bg-(--ui-ambar-fundo) text-(--ui-ambar-texto)",
                  )}
                >
                  Seu nível de acesso neste projeto não permite criar cards.
                </div>
              )}
              <div>
                <label
                  htmlFor="modal-task-title"
                  className={cn(
                    "mb-1.5 block text-xs font-bold uppercase tracking-widest",
                    "text-(--ui-texto-secundario)",
                  )}
                >
                  Título do card
                </label>
                <Input
                  id="modal-task-title"
                  placeholder="Ex: Aprovar campanha de marketing"
                  disabled={!canEditTasks}
                  className={cn(
                    "h-11 rounded-xl border px-3 text-sm font-semibold",
                    "border-(--ui-borda) bg-(--ui-superficie-suave) text-(--ui-texto-principal) placeholder:text-(--ui-texto-secundario)",
                  )}
                  {...form.register("title")}
                />
                {form.formState.errors.title && (
                  <p className="mt-1 text-xs font-medium text-rose-500">
                    {form.formState.errors.title.message}
                  </p>
                )}
              </div>

              <div>
                <label
                  htmlFor="modal-task-description"
                  className={cn(
                    "mb-1.5 block text-xs font-bold uppercase tracking-widest",
                    "text-(--ui-texto-secundario)",
                  )}
                >
                  Descricao
                  <span className="ml-1 font-medium normal-case tracking-normal">
                    (opcional)
                  </span>
                </label>
                <textarea
                  id="modal-task-description"
                  rows={4}
                  disabled={!canEditTasks}
                  placeholder="Contexto, objetivo e detalhes deste card."
                  className={cn(
                    "w-full rounded-2xl border px-3 py-3 text-sm outline-none transition-all",
                    "border-(--ui-borda) bg-(--ui-superficie-suave) text-(--ui-texto-principal) placeholder:text-(--ui-texto-secundario)",
                  )}
                  {...form.register("descriptionText")}
                />
              </div>

              {activeWorkspaceCustomFields.length > 0 && (
                <div>
                  <label
                    className={cn(
                      "mb-1.5 block text-xs font-bold uppercase tracking-widest",
                      "text-(--ui-texto-secundario)",
                    )}
                  >
                    Campos personalizados
                  </label>
                  <div
                    className={cn(
                      "rounded-2xl border p-4",
                      "border-(--ui-borda) bg-(--ui-fundo-sutil)",
                    )}
                  >
                    <CustomFieldEditor
                      fields={activeWorkspaceCustomFields}
                      values={customFieldValues}
                      errors={customFieldErrors}
                      disabled={!canEditTasks}
                      onValueChange={(fieldId, value) => {
                        setCustomFieldValues((current) => ({
                          ...current,
                          [fieldId]: value,
                        }));
                        setCustomFieldErrors((current) => {
                          if (!current[fieldId]) {
                            return current;
                          }

                          const nextErrors = { ...current };
                          delete nextErrors[fieldId];
                          return nextErrors;
                        });
                      }}
                    />
                  </div>
                </div>
              )}

              <div>
                <label
                  htmlFor="modal-task-visibility"
                  className={cn(
                    "mb-1.5 block text-xs font-bold uppercase tracking-widest",
                    "text-(--ui-texto-secundario)",
                  )}
                >
                  Visibilidade
                </label>
                <div className="space-y-2">
                  <div className="relative">
                    <select
                      id="modal-task-visibility"
                      value={visibility}
                      disabled={
                        !canEditTasks || availableVisibilityOptions.length === 1
                      }
                      onChange={(event) =>
                        setVisibility(event.target.value as EntityVisibility)
                      }
                      className={cn(
                        "h-11 w-full appearance-none rounded-xl border px-3 pr-10 text-sm font-semibold outline-none transition-all",
                        "border-(--ui-borda) bg-(--ui-superficie-suave) text-(--ui-texto-principal)",
                      )}
                    >
                      {availableVisibilityOptions.map((option) => (
                        <option key={option} value={option}>
                          {getVisibilityLabel(option)}
                        </option>
                      ))}
                    </select>
                    <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
                      {visibility === "public" ? (
                        <Globe className="h-4 w-4 text-blue-500" />
                      ) : (
                        <Lock
                          className={cn(
                            "h-4 w-4",
                            visibility === "admin_private"
                              ? "text-amber-500"
                              : "text-rose-500",
                          )}
                        />
                      )}
                    </span>
                  </div>
                  <p
                    className={cn(
                      "text-xs font-medium",
                      "text-(--ui-texto-secundario)",
                    )}
                  >
                    {visibility === "admin_private"
                      ? "Somente o criador visualiza este card, inclusive contra outros administradores."
                      : visibility === "private"
                        ? "O card fica privado por padrao. Responsaveis e etiquetas podem ampliar o acesso."
                        : "O card fica visivel para todos com acesso a este projeto."}
                  </p>
                </div>
              </div>

              <div ref={assigneePickerRef}>
                <label
                  className={cn(
                    "mb-1.5 block text-xs font-bold uppercase tracking-widest",
                    "text-(--ui-texto-secundario)",
                  )}
                >
                  Responsaveis
                </label>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p
                    className={cn(
                      "text-[10px] font-bold uppercase tracking-widest",
                      "text-(--ui-texto-secundario)",
                    )}
                  >
                    Adicionar responsaveis:
                  </p>
                  <div className="flex items-center gap-1.5">
                    {selectedAssigneeMembers.map((member) => (
                      <div
                        key={member.id}
                        className="relative group/member cursor-pointer"
                        onClick={() =>
                          canEditTasks &&
                          setSelectedAssignees((prev) =>
                            prev.filter((id) => id !== member.id),
                          )
                        }
                      >
                        <UserAvatar
                          member={member}
                          size={30}
                          className={cn(
                            "h-7.5 w-7.5 border-2 transition-all",
                            "border-(--ui-superficie-suave) ring-1 ring-(--ui-borda-suave) group-hover/member:ring-(--ui-rose-borda) group-hover/member:ring-2",
                          )}
                        />
                        <div className="invisible group-hover/member:visible absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-800 px-2 py-1 text-[10px] font-medium text-white z-50">
                          Remover {member.name.split(" ")[0]}
                          <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-800" />
                        </div>
                      </div>
                    ))}

                    <div className="relative">
                      <button
                        type="button"
                        disabled={!canEditTasks}
                        onClick={() =>
                          canEditTasks &&
                          setIsAssigneePickerOpen((current) => !current)
                        }
                        className={cn(
                          "flex h-7.5 w-7.5 items-center justify-center rounded-full border-2 border-dashed transition-all",
                          canEditTasks
                            ? "cursor-pointer"
                            : "cursor-not-allowed opacity-60",
                          "border-(--ui-borda) text-(--ui-texto-secundario) hover:border-(--ui-azul-borda) hover:text-(--ui-azul-texto)",
                        )}
                      >
                        <Plus className="h-4 w-4" />
                      </button>

                      {isAssigneePickerOpen && (
                        <div
                          className={cn(
                            "absolute top-[calc(100%+8px)] right-0 z-60 w-[min(20rem,calc(100vw-2rem))] rounded-2xl border p-3 animate-in fade-in slide-in-from-top-2 sm:w-80",
                            "pauta-theme-menu",
                          )}
                        >
                          <p
                            className={cn(
                              "mb-1.5 px-2 text-[10px] font-bold uppercase tracking-widest",
                              "text-(--ui-texto-secundario)",
                            )}
                          >
                            Adicionar o card
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
                          <div className="max-h-56 overflow-y-auto space-y-1.5">
                            {filteredMemberOptions.map((member) => {
                              const isSelected = selectedAssignees.includes(
                                member.id,
                              );
                              return (
                                <button
                                  type="button"
                                  key={member.id}
                                  disabled={!canEditTasks}
                                  onClick={() => {
                                    setSelectedAssignees((prev) =>
                                      prev.includes(member.id)
                                        ? prev.filter((id) => id !== member.id)
                                        : [...prev, member.id],
                                    );
                                  }}
                                  className={cn(
                                    "flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 transition-colors",
                                    canEditTasks
                                      ? "cursor-pointer"
                                      : "cursor-not-allowed opacity-60",
                                    "hover:bg-(--ui-hover)",
                                  )}
                                >
                                  <UserAvatar
                                    member={member}
                                    size={28}
                                    className="h-7 w-7 shrink-0 border-0 ring-0"
                                  />
                                  <div className="min-w-0 flex-1 text-left">
                                    <p
                                      className={cn(
                                        "truncate text-xs font-bold leading-tight",
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
                                            style={{
                                              backgroundColor: tag.color,
                                            }}
                                          >
                                            {tag.name}
                                          </span>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                  {isSelected && (
                                    <Check className="h-3.5 w-3.5 shrink-0 text-blue-600" />
                                  )}
                                </button>
                              );
                            })}

                            {filteredMemberOptions.length === 0 && (
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
                  </div>
                </div>
              </div>

              <div>
                <label
                  className={cn(
                    "mb-1.5 block text-xs font-bold uppercase tracking-widest",
                    "text-(--ui-texto-secundario)",
                  )}
                >
                  Etiquetas
                </label>
                <p
                  className={cn(
                    "mb-2 text-xs font-medium",
                    "text-(--ui-texto-secundario)",
                  )}
                >
                  Em card privado, membros com etiquetas correspondentes
                  tambem podem visualizar.
                </p>
                <div className="flex flex-wrap gap-2">
                  {tagOptions.map((tag) => {
                    const isSelected = selectedTags.includes(tag.id);
                    return (
                      <button
                        type="button"
                        key={tag.id}
                        disabled={!canEditTasks}
                        onClick={() => {
                          setSelectedTags((prev) =>
                            prev.includes(tag.id)
                              ? prev.filter((id) => id !== tag.id)
                              : [...prev, tag.id],
                          );
                        }}
                        className={cn(
                          "group relative flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-black transition-all",
                          canEditTasks
                            ? "cursor-pointer"
                            : "cursor-not-allowed opacity-60",
                          isSelected
                            ? "opacity-100 ring-2 ring-blue-400 ring-offset-2"
                            : isDarkMode
                              ? "border border-(--border-subtle) bg-(--bg-surface) text-(--text-muted) opacity-70 hover:opacity-100"
                              : "border border-slate-200 bg-slate-100 text-slate-600 opacity-60 hover:opacity-100",
                        )}
                        style={
                          isSelected
                            ? { backgroundColor: tag.color, color: "white" }
                            : undefined
                        }
                      >
                        {!isSelected && (
                          <div
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: tag.color }}
                          />
                        )}
                        {tag.name}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="modal-task-status"
                    className={cn(
                      "mb-1.5 block text-xs font-bold uppercase tracking-widest",
                      "text-(--ui-texto-secundario)",
                    )}
                  >
                    Status
                  </label>
                  <select
                    id="modal-task-status"
                    className={cn(
                      "h-11 w-full rounded-xl border px-3 text-sm outline-none transition-all",
                      isDarkMode
                        ? "border-(--border-subtle) bg-(--bg-surface) text-(--text-main) focus:border-blue-400 focus:ring-4 focus:ring-blue-400/15"
                        : "border-slate-200 bg-white focus:border-blue-300 focus:ring-4 focus:ring-blue-100/50",
                    )}
                    {...form.register("statusId")}
                    disabled={!canEditTasks}
                  >
                    {getStatusesForList(
                      graph.statusDefinitions,
                      resolvedListId,
                    ).map((status) => (
                      <option key={status.id} value={status.id}>
                        {getTaskStatusLabel(status.name)}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="modal-task-priority"
                    className={cn(
                      "mb-1.5 block text-xs font-bold uppercase tracking-widest",
                      "text-(--ui-texto-secundario)",
                    )}
                  >
                    Prioridade
                  </label>
                  <select
                    id="modal-task-priority"
                    className={cn(
                      "h-11 w-full rounded-xl border px-3 text-sm outline-none transition-all",
                      isDarkMode
                        ? "border-(--border-subtle) bg-(--bg-surface) text-(--text-main) focus:border-blue-400 focus:ring-4 focus:ring-blue-400/15"
                        : "border-slate-200 bg-white focus:border-blue-300 focus:ring-4 focus:ring-blue-100/50",
                    )}
                    {...form.register("priority")}
                    disabled={!canEditTasks}
                  >
                    {TASK_PRIORITY_VALUES.map((priority) => (
                      <option key={priority} value={priority}>
                        {priorityLabels[priority]}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    className={cn(
                      "mb-1.5 block text-xs font-bold uppercase tracking-widest",
                      "text-(--ui-texto-secundario)",
                    )}
                  >
                    Tempo Estimado
                  </label>
                  <TimeEstimateDropdown
                    value={estimate}
                    onChange={setEstimate}
                    disabled={!canEditTasks}
                  />
                </div>
              </div>

              <div>
                <label
                  className={cn(
                    "mb-1.5 block text-xs font-bold uppercase tracking-widest",
                    "text-(--ui-texto-secundario)",
                  )}
                >
                  Prazo (opcional)
                </label>
                <FlightDatePicker
                  startDate={startDate}
                  endDate={dueDate}
                  onChange={(s, e) => {
                    setStartDate(s);
                    setDueDate(e);
                  }}
                  direction="up"
                  className="h-11 rounded-xl"
                  disabled={!canEditTasks}
                />
              </div>
            </div>
          </div>

          <div
            className={cn(
              "flex shrink-0 flex-col-reverse gap-3 border-t px-4 py-4 sm:flex-row sm:justify-end sm:px-8",
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
              className="w-full rounded-xl px-5 cursor-pointer sm:w-auto"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              className="w-full rounded-xl bg-blue-600 px-6 font-bold hover:bg-blue-700 cursor-pointer sm:w-auto"
              disabled={!activeList || isLoading || !canEditTasks}
            >
              {isLoading ? (
                "Criando..."
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-1.5" />
                  Criar Card
                </>
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
