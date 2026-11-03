import { useState, useRef, useEffect, useMemo } from "react";
import { X, Info, ChevronDown, Users, Plus, Check } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import axios from "axios";

import { WORKSPACE_ICONS } from "../../spaces/components/sidebar";
import { useTaskStore } from "../../../store/use-task-store";
import { cn } from "../../../lib/utils";
import { Button } from "../../../components/ui/button";
import { UserAvatar } from "../../../components/ui/user-avatar";
import { useAuthStore } from "../../../store/use-auth-store";
import { useThemeStore } from "../../../store/use-theme-store";
import { getVisibilityLabel } from "../../../lib/entity-visibility";
import { toast } from "../../../store/use-toast-store";
import {
  DEFAULT_ENTITY_COLOR,
  ENTITY_COLOR_OPTIONS,
  normalizeEntityColor,
  withAlpha,
} from "../../../lib/entity-colors";
import type {
  EntityVisibility,
  Workspace,
  WorkspacePermissionLevel,
} from "../../../types/tasks";

const WORKSPACE_PERMISSION_OPTIONS: Array<{
  name: WorkspacePermissionLevel;
  desc: string;
}> = [
  {
    name: "Edição total",
    desc: "Crie e edite entidades neste espaço. Proprietários e administradores gerenciam configurações.",
  },
  {
    name: "Editar",
    desc: "Crie e edite entidades. Não é possível gerenciar configurações ou excluir o espaço.",
  },
  {
    name: "Comentário",
    desc: "Comente sobre as entidades. Não é possível editar ou gerenciar configurações.",
  },
  {
    name: "Apenas exibição",
    desc: "Somente leitura. Não pode editar nem comentar fora do Chat.",
  },
];

interface WorkspaceEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  workspace: Workspace | null;
}

export function WorkspaceEditModal({
  isOpen,
  onClose,
  workspace,
}: WorkspaceEditModalProps) {
  const currentUser = useTaskStore((state) => state.currentUser);
  const graph = useTaskStore((state) => state.graph);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedIcon, setSelectedIcon] = useState("Briefcase");
  const [selectedColor, setSelectedColor] =
    useState<string>(DEFAULT_ENTITY_COLOR);
  const [visibility, setVisibility] = useState<EntityVisibility>("private");
  const [permission, setPermission] =
    useState<WorkspacePermissionLevel>("Edição total");
  const [sharedMemberIds, setSharedMemberIds] = useState<string[]>([]);
  const [isPermissionMenuOpen, setIsPermissionMenuOpen] = useState(false);
  const [isShareMenuOpen, setIsShareMenuOpen] = useState(false);
  const [shareSearch, setShareSearch] = useState("");
  const [shareTagFilter, setShareTagFilter] = useState<string | null>(null);
  const [selectedTags, setSelectedTags] = useState<any[]>([]);
  const [isTagMenuOpen, setIsTagMenuOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);

  const queryClient = useQueryClient();
  const token = useAuthStore((state) => state.token);
  const authUser = useAuthStore((state) => state.user);
  const isDarkMode = useThemeStore((state) => state.mode === "dark");
  const isAdm = authUser?.organization?.role === "owner" ||
    authUser?.organization?.role === "admin";

  const permissionMenuRef = useRef<HTMLDivElement>(null);
  const shareMenuRef = useRef<HTMLDivElement>(null);
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
    if (isOpen && workspace) {
      setName(workspace.name);
      setDescription(workspace.description || "");
      setSelectedIcon(workspace.icon || "Briefcase");
      setSelectedColor(normalizeEntityColor(workspace.color));
      setVisibility(workspace.visibility || "private");
      setPermission(workspace.defaultPermissionLevel || "Edição total");
      setSharedMemberIds(
        (workspace.sharedMemberIds || []).filter((id) => id !== currentUser),
      );
      setSelectedTags(workspace.tags || []);
      setIsPermissionMenuOpen(false);
      setIsShareMenuOpen(false);
      setShareSearch("");
      setShareTagFilter(null);
      setIsTagMenuOpen(false);
    }
  }, [currentUser, isOpen, workspace]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        permissionMenuRef.current &&
        !permissionMenuRef.current.contains(event.target as Node)
      ) {
        setIsPermissionMenuOpen(false);
      }
      if (
        shareMenuRef.current &&
        !shareMenuRef.current.contains(event.target as Node)
      ) {
        setIsShareMenuOpen(false);
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

  const user = graph.members[currentUser];
  const allMembers = Object.values(graph.members).filter(
    (member) => member.id !== currentUser,
  );
  const allTags = Object.values(graph.tags || {});
  const shareFilterTags = useMemo(
    () =>
      Array.from(
        new Set(
          allMembers.flatMap((member) =>
            (member.tagIds || []).filter((tagId) => graph.tags[tagId]),
          ),
        ),
      )
        .map((tagId) => graph.tags[tagId])
        .filter(Boolean),
    [allMembers, graph.tags],
  );
  const filteredShareMembers = useMemo(() => {
    const normalizedSearch = shareSearch.trim().toLowerCase();

    return allMembers.filter((member) => {
      const matchesSearch =
        !normalizedSearch ||
        member.name.toLowerCase().includes(normalizedSearch) ||
        member.role.toLowerCase().includes(normalizedSearch) ||
        member.email?.toLowerCase().includes(normalizedSearch);
      const matchesTag =
        !shareTagFilter || (member.tagIds || []).includes(shareTagFilter);

      return matchesSearch && matchesTag;
    });
  }, [allMembers, shareSearch, shareTagFilter]);
  const selectedVisibilityOption = {
    title: getVisibilityLabel(visibility),
    description:
      visibility === "admin_private"
        ? "Nem outros administradores enxergam. Apenas o criador tera acesso."
        : visibility === "public"
          ? "Todos com acesso a plataforma podem visualizar esse espaco."
          : "Somente o criador enxerga por padrao. Convites e etiquetas podem ampliar esse acesso.",
  };
  const firstLetter = name.trim() ? name.trim()[0].toUpperCase() : "S";

  const toggleTag = (tag: any) => {
    setSelectedTags((prev) =>
      prev.find((t) => t.id === tag.id)
        ? prev.filter((t) => t.id !== tag.id)
        : [...prev, tag],
    );
  };

  const toggleSharedMember = (memberId: string) => {
    setSharedMemberIds((prev) =>
      prev.includes(memberId)
        ? prev.filter((id) => id !== memberId)
        : [...prev, memberId],
    );
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !workspace) return;

    setIsLoading(true);

    try {
      await axios.put(
        `/api/workspaces/${workspace.id}`,
        {
          name,
          description,
          visibility,
          icon: selectedIcon,
          color: selectedColor,
          sharedMemberIds,
          defaultPermissionLevel: permission,
          tags: selectedTags,
        },
        { headers: { Authorization: `Bearer ${token}` } },
      );

      await queryClient.invalidateQueries({ queryKey: ["workspace-seed"] });
      toast.success("Espaço de trabalho atualizado.", {
        message: "As mudanças já valem para o time.",
      });
      onClose();
    } catch (error) {
      console.error("Erro ao atualizar workspace", error);
      toast.error("Não foi possível atualizar o espaço de trabalho.", {
        message: "As alterações não foram salvas.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen || !workspace) return null;

  return (
    <div className="fixed inset-0 z-9999 flex items-end justify-center overflow-y-auto p-0 sm:items-center sm:px-4 sm:py-4">
      <div
        className="pauta-theme-overlay absolute inset-0 backdrop-blur-sm animate-in fade-in duration-300"
        onClick={onClose}
      />
      <div
        className={cn(
          "relative z-10 flex h-dvh w-full max-w-none flex-col overflow-hidden rounded-none border-0 animate-in zoom-in-95 duration-300 sm:h-auto sm:max-h-[calc(70vh-2rem)] sm:max-w-xl sm:rounded-3xl sm:border sm:min-w-xl",
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
            Editar espaço
          </h2>
          <button
            type="button"
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

        <div
          className={cn(
            "shrink-0 border-b px-4 py-3 sm:px-6 sm:py-4",
            "border-(--ui-borda-suave)",
          )}
        >
          <p
            className={cn(
              "text-sm font-medium leading-relaxed",
              "text-(--ui-texto-secundario)",
            )}
          >
            Atualize nome, descrição, permissões e visibilidade deste espaço de
            trabalho.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="pauta-scroll-safe min-h-0 flex-1 overflow-y-auto p-4 pt-3 sm:p-6 sm:pt-2">
            <div className="space-y-5 sm:space-y-6">
              <div className="space-y-2">
                <label
                  className={cn(
                    "text-[11px] font-bold uppercase tracking-widest",
                    "text-(--ui-texto-secundario)",
                  )}
                >
                  Ícone e nome
                </label>
                <div className="flex flex-col gap-3 sm:flex-row">
                  {(() => {
                    const Icon = WORKSPACE_ICONS[selectedIcon];
                    return (
                      <div
                        className={cn(
                          "flex h-11.5 w-11.5 shrink-0 items-center justify-center rounded-xl border",
                          "text-(--ui-texto-forte)",
                        )}
                        style={{
                          backgroundColor: withAlpha(
                            selectedColor,
                            isDarkMode ? 0.18 : 0.12,
                          ),
                          borderColor: withAlpha(
                            selectedColor,
                            isDarkMode ? 0.4 : 0.24,
                          ),
                          color: selectedColor,
                        }}
                      >
                        {Icon ? (
                          <Icon className="h-5 w-5" />
                        ) : (
                          <span
                            className={cn(
                              "text-lg font-black",
                              "text-(--ui-texto-forte)",
                            )}
                          >
                            {firstLetter}
                          </span>
                        )}
                      </div>
                    );
                  })()}
                  <input aria-label="por exemplo, marketing, engenharia, RH"
                    autoFocus
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="por exemplo, marketing, engenharia, RH"
                    className={cn(
                      "flex-1 rounded-2xl border px-4 py-3 text-sm font-bold outline-none transition-all",
                      "border-(--ui-borda) bg-(--ui-fundo-sutil) text-(--ui-texto-principal) placeholder:text-(--ui-texto-secundario) focus:border-(--ui-azul-borda-foco) focus:ring-4 focus:ring-(--ui-azul-foco) focus:bg-(--ui-superficie-suave)",
                    )}
                  />
                </div>
                <div
                  className={cn(
                    "grid grid-cols-[repeat(auto-fill,minmax(36px,1fr))] gap-1.5 rounded-2xl border p-3",
                    "border-(--ui-borda-suave) bg-(--ui-fundo-sutil)",
                  )}
                >
                  {Object.entries(WORKSPACE_ICONS).map(([iconName, Icon]) => (
                    <button
                      key={iconName}
                      type="button"
                      title={iconName}
                      onClick={() => setSelectedIcon(iconName)}
                      className={cn(
                        "flex h-9 w-9 items-center justify-center rounded-xl transition-all cursor-pointer",
                        selectedIcon === iconName
                          ? "text-white shadow-lg"
                          : "border border-(--ui-borda-suave) bg-(--ui-superficie) text-(--ui-texto-secundario) hover:bg-(--ui-hover-forte) hover:text-(--ui-texto-forte)",
                      )}
                      style={
                        selectedIcon === iconName
                          ? {
                              backgroundColor: selectedColor,
                              boxShadow: `0 10px 24px ${withAlpha(selectedColor, 0.32)}`,
                            }
                          : undefined
                      }
                    >
                      <Icon className="h-4 w-4" />
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <label
                  className={cn(
                    "text-[11px] font-bold uppercase tracking-widest",
                    "text-(--ui-texto-secundario)",
                  )}
                >
                  Cor do Espaço
                </label>
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

              <div className="space-y-2">
                <label
                  className={cn(
                    "text-[11px] font-bold uppercase tracking-widest",
                    "text-(--ui-texto-secundario)",
                  )}
                >
                  Descrição
                  <span
                    className={cn(
                      "ml-1 font-medium",
                      "text-(--ui-texto-apagado)",
                    )}
                  >
                    (opcional)
                  </span>
                </label>
                <input aria-label="Adicione uma breve descrição..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Adicione uma breve descrição..."
                  className={cn(
                    "w-full rounded-2xl border px-4 py-3 text-sm font-bold outline-none transition-all",
                    "border-(--ui-borda) bg-(--ui-fundo-sutil) text-(--ui-texto-principal) placeholder:text-(--ui-texto-secundario) focus:border-(--ui-azul-borda-foco) focus:ring-4 focus:ring-(--ui-azul-foco) focus:bg-(--ui-superficie-suave)",
                  )}
                />
              </div>

              <div className="relative space-y-3" ref={permissionMenuRef}>
                <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
                  <div className="flex items-center gap-2">
                    <Users
                      className={cn(
                        "h-4 w-4",
                        "text-(--ui-texto-secundario)",
                      )}
                    />
                    <span
                      className={cn(
                        "text-[13px] font-bold",
                        "text-(--ui-texto-forte)",
                      )}
                    >
                      Permissão padrão
                    </span>
                    <div className="group relative flex items-center">
                      <Info
                        className={cn(
                          "h-3.5 w-3.5 cursor-help",
                          "text-(--ui-texto-apagado)",
                        )}
                      />
                      <div className="invisible group-hover:visible absolute left-full ml-2 w-48 rounded-lg bg-slate-800 p-2 text-[10px] font-medium text-white z-50">
                        Pessoas adicionadas receberão este nível de permissão
                        por padrão
                        <div className="absolute top-1/2 -left-1 -translate-y-1/2 border-4 border-transparent border-r-slate-800" />
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsPermissionMenuOpen((value) => !value)}
                    className={cn(
                      "flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-bold transition-all cursor-pointer",
                      "border-(--ui-borda) bg-(--ui-superficie-suave) text-(--ui-texto-forte) hover:bg-(--ui-hover)",
                    )}
                  >
                    {permission}
                    <ChevronDown
                      className={cn(
                        "h-3.5 w-3.5 transition-transform",
                        "text-(--ui-texto-secundario)",
                        isPermissionMenuOpen && "rotate-180",
                      )}
                    />
                  </button>
                </div>

                {isPermissionMenuOpen && (
                  <div
                    className={cn(
                      "absolute top-[calc(100%+8px)] right-0 z-60 w-full max-w-[320px] rounded-2xl border p-2 animate-in fade-in slide-in-from-top-2",
                      "pauta-theme-menu",
                    )}
                  >
                    {WORKSPACE_PERMISSION_OPTIONS.map((option) => (
                      <button
                        key={option.name}
                        type="button"
                        onClick={() => {
                          setPermission(option.name);
                          setIsPermissionMenuOpen(false);
                        }}
                        className={cn(
                          "flex w-full flex-col gap-0.5 rounded-xl px-3 py-2.5 text-left transition-colors cursor-pointer",
                          "hover:bg-(--ui-hover)",
                        )}
                      >
                        <p
                          className={cn(
                            "text-xs font-bold",
                            "text-(--ui-texto-principal)",
                          )}
                        >
                          {option.name}
                        </p>
                        <p
                          className={cn(
                            "text-[10px] font-medium leading-normal",
                            "text-(--ui-texto-secundario)",
                          )}
                        >
                          {option.desc}
                        </p>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div
                className={cn(
                  "mt-2 flex flex-col items-start justify-between gap-3 border-t pt-2 sm:flex-row sm:items-center",
                  "border-(--ui-borda-suave)",
                )}
              >
                <div className="space-y-0.5">
                  <p
                    className={cn(
                      "text-[13px] font-bold",
                      "text-(--ui-texto-forte)",
                    )}
                  >
                    {getVisibilityLabel(visibility)}
                  </p>
                  <p
                    className={cn(
                      "text-[11px] font-medium",
                      "text-(--ui-texto-secundario)",
                    )}
                  >
                    {selectedVisibilityOption.description}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setVisibility((value) =>
                      value === "public" ? "private" : "public",
                    )
                  }
                  className={cn(
                    "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
                    visibility !== "public"
                      ? "bg-blue-600"
                      : "bg-(--ui-fundo-neutro)",
                  )}
                >
                  <span
                    className={cn(
                      "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out",
                      visibility !== "public"
                        ? "translate-x-5"
                        : "translate-x-0",
                    )}
                  />
                </button>
              </div>

              {isAdm && (
                <button
                  type="button"
                  onClick={() =>
                    setVisibility((value) =>
                      value === "admin_private" ? "private" : "admin_private",
                    )
                  }
                  className={cn(
                    "flex w-full items-start justify-between gap-3 rounded-2xl border px-4 py-3 text-left transition-all cursor-pointer",
                    visibility === "admin_private"
                      ? "border-(--ui-azul-borda) bg-(--ui-azul-fundo) text-(--ui-texto-principal)"
                      : "border-(--ui-borda) bg-(--ui-fundo-sutil) text-(--ui-texto-secundario) hover:bg-(--ui-hover)",
                  )}
                >
                  <div>
                    <p className="text-xs font-bold">Privado ADM</p>
                    <p className="mt-1 text-[10px] font-medium leading-normal opacity-80">
                      Nem outros administradores enxergam. Apenas o criador tera
                      acesso.
                    </p>
                  </div>
                  {visibility === "admin_private" && (
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
                  )}
                </button>
              )}

              {visibility === "private" && (
                <div className="flex flex-col items-start justify-between gap-3 animate-in fade-in slide-in-from-top-2 sm:flex-row sm:items-center">
                  <p
                    className={cn(
                      "text-[10px] font-bold uppercase tracking-widest",
                      "text-(--ui-texto-secundario)",
                    )}
                  >
                    Compartilhar apenas com:
                  </p>
                  <div className="flex items-center gap-1.5">
                    <div className="relative group/creator">
                      {user ? (
                        <UserAvatar
                          member={user}
                          size={30}
                          className={cn(
                            "h-7.5 w-7.5 border-2",
                            "border-(--ui-superficie-suave) ring-1 ring-(--ui-borda-suave)",
                          )}
                        />
                      ) : (
                        <div
                          className={cn(
                            "flex h-7.5 w-7.5 items-center justify-center rounded-full border-2 text-[10px] font-black text-white",
                            "border-(--ui-superficie-suave) ring-1 ring-(--ui-borda-suave)",
                            "bg-slate-400",
                          )}
                        >
                          ?
                        </div>
                      )}
                      <div className="invisible group-hover/creator:visible absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-800 px-2 py-1 text-[10px] font-medium text-white z-50">
                        {user?.name}
                        <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-800" />
                      </div>
                    </div>

                    {sharedMemberIds.map((memberId) => {
                      const member = graph.members[memberId];
                      if (!member) return null;

                      return (
                        <div
                          key={memberId}
                          className="relative group/member cursor-pointer"
                          onClick={() => toggleSharedMember(memberId)}
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
                      );
                    })}

                    <div className="relative" ref={shareMenuRef}>
                      <button
                        type="button"
                        onClick={() => setIsShareMenuOpen((value) => !value)}
                        className={cn(
                          "flex h-7.5 w-7.5 items-center justify-center rounded-full border-2 border-dashed transition-all cursor-pointer",
                          "border-(--ui-borda) text-(--ui-texto-secundario) hover:border-(--ui-azul-borda) hover:text-(--ui-azul-texto)",
                        )}
                      >
                        <Plus className="h-4 w-4" />
                      </button>

                      {isShareMenuOpen && allMembers.length > 0 && (
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
                            Adicionar ao espaço
                          </p>
                          <input aria-label="Buscar membro por nome, cargo ou e-mail"
                            value={shareSearch}
                            onChange={(event) =>
                              setShareSearch(event.target.value)
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
                                onClick={() => setShareTagFilter(null)}
                                className={cn(
                                  "shrink-0 cursor-pointer whitespace-nowrap rounded-full border px-3 py-1 text-[11px] font-black transition-all hover:opacity-85",
                                  shareTagFilter === null
                                    ? "border-(--ui-azul-borda) bg-(--ui-azul-fundo) text-(--ui-azul-texto)"
                                    : "border-(--ui-borda) text-(--ui-texto-secundario)",
                                )}
                              >
                                Todas
                              </button>
                              {shareFilterTags.map((tag) => (
                                <button
                                  key={tag.id}
                                  type="button"
                                  onClick={() =>
                                    setShareTagFilter((current) =>
                                      current === tag.id ? null : tag.id,
                                    )
                                  }
                                  className={cn(
                                    "shrink-0 cursor-pointer whitespace-nowrap rounded-full border px-3 py-1 text-[11px] font-black transition-all hover:opacity-85",
                                    shareTagFilter === tag.id
                                      ? "text-white"
                                      : "border-(--ui-borda) text-(--ui-texto-secundario)",
                                  )}
                                  style={
                                    shareTagFilter === tag.id
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
                            {filteredShareMembers.map((member) => {
                              const isSelected = sharedMemberIds.includes(
                                member.id,
                              );
                              return (
                                <button
                                  key={member.id}
                                  type="button"
                                  onClick={() => toggleSharedMember(member.id)}
                                  className={cn(
                                    "flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 transition-colors cursor-pointer",
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
                            {filteredShareMembers.length === 0 && (
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

                      {isShareMenuOpen && allMembers.length === 0 && (
                        <div
                          className={cn(
                            "absolute top-[calc(100%+8px)] right-0 z-60 w-52 rounded-2xl border p-4 text-center animate-in fade-in slide-in-from-top-2",
                            "pauta-theme-menu",
                          )}
                        >
                          <p
                            className={cn(
                              "text-xs font-bold",
                              "text-(--ui-texto-secundario)",
                            )}
                          >
                            Nenhum outro membro disponível
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Etiquetas */}
              <div className="relative space-y-2" ref={tagMenuRef}>
                <label
                  className={cn(
                    "text-[11px] font-bold uppercase tracking-widest",
                    "text-(--ui-texto-secundario)",
                  )}
                >
                  Etiquetas de acesso
                </label>
                <div
                  className={cn(
                    "flex min-h-11.5 items-center gap-2 overflow-hidden rounded-2xl border px-4 py-2 transition-all cursor-pointer",
                    "border-(--ui-borda) bg-(--bg-surface) hover:bg-(--ui-hover)",
                  )}
                  onClick={() => setIsTagMenuOpen((v) => !v)}
                >
                  {selectedTags.length === 0 ? (
                    <span
                      className={cn(
                        "text-sm font-bold",
                        "text-(--ui-texto-secundario)",
                      )}
                    >
                      Nenhuma etiqueta selecionada
                    </span>
                  ) : (
                    <div className="flex flex-1 flex-wrap gap-1.5">
                      {selectedTags.map((tag) => (
                        <span
                          key={tag.id}
                          className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-black text-white"
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
                {isTagMenuOpen && allTags.length > 0 && (
                  <div
                    className={cn(
                      "absolute left-0 top-[calc(100%+4px)] z-60 w-full rounded-2xl border p-3 animate-in fade-in slide-in-from-top-2",
                      "pauta-theme-menu",
                    )}
                  >
                    <p
                      className={cn(
                        "mb-2 px-1 text-[10px] font-bold uppercase tracking-widest",
                        "text-(--ui-texto-secundario)",
                      )}
                    >
                      Etiquetas disponíveis
                    </p>
                    <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto py-1">
                      {allTags.map((tag) => {
                        const isSelected = !!selectedTags.find(
                          (t) => t.id === tag.id,
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
            </div>
          </div>

          <div
            className={cn(
              "flex shrink-0 border-t px-4 py-4 sm:px-6",
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
            <div className="flex w-full items-center justify-end">
              <Button
                type="submit"
                disabled={isLoading || !name.trim()}
                className="w-full sm:w-auto rounded-2xl px-12 py-6 font-black bg-blue-600 hover:bg-blue-700 disabled:opacity-30 disabled:pointer-events-none transition-all text-sm uppercase tracking-widest shadow-lg shadow-blue-500/20 cursor-pointer"
              >
                {isLoading ? "Salvando..." : "Salvar alterações"}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
