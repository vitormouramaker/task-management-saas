import { useRef, useState, useEffect, useMemo } from "react";
import { Plus, Check, X } from "lucide-react";
import { buildAssetUrl } from "../../lib/api";
import { cn, getInitials } from "../../lib/utils";
import { useThemeStore } from "../../store/use-theme-store";

export interface MemberInfo {
  id: string;
  name: string;
  avatarColor?: string;
  avatarUrl?: string;
  role?: string;
  email?: string;
  tagIds?: string[];
  tags?: Array<{
    id: string;
    name: string;
    color: string;
  }>;
}

interface AssigneeAvatarsProps {
  /** IDs dos membros atualmente atribuídos */
  assigneeIds: string[];
  /** Mapa de todos os membros disponíveis */
  members: Record<string, MemberInfo>;
  /** Callback para selecionar/deselecionar um membro */
  onToggle: (memberId: string) => void;
  /** Quantos avatares mostrar antes de colapsar em "+N" (default: 3) */
  maxVisible?: number;
  /** Tamanho dos avatares em px (default: 24 = h-6 w-6) */
  size?: number;
  disabled?: boolean;
}

/**
 * Componente padronizado para exibir atribuídos.
 * Mostra avatares empilhados com tooltip, botão "+N" com popover da lista completa
 * e botão "+" para adicionar novos membros.
 */
export function AssigneeAvatars({
  assigneeIds,
  members,
  onToggle,
  maxVisible = 3,
  size = 24,
  disabled = false,
}: AssigneeAvatarsProps) {
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const [isOverflowMenuOpen, setIsOverflowMenuOpen] = useState(false);
  const [memberSearch, setMemberSearch] = useState("");
  const [memberTagFilter, setMemberTagFilter] = useState<string | null>(null);
  const isDarkMode = useThemeStore((state) => state.mode === "dark");
  const addMenuRef = useRef<HTMLDivElement>(null);
  const overflowMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        addMenuRef.current &&
        !addMenuRef.current.contains(event.target as Node)
      ) {
        setIsAddMenuOpen(false);
      }
      if (
        overflowMenuRef.current &&
        !overflowMenuRef.current.contains(event.target as Node)
      ) {
        setIsOverflowMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const assignees = assigneeIds.map((id) => members[id]).filter(Boolean);
  const visibleAssignees = assignees.slice(0, maxVisible);
  const overflowCount = assignees.length - maxVisible;
  const allMembersList = Object.values(members);
  const memberFilterTags = useMemo(
    () =>
      Array.from(
        new Map(
          allMembersList.flatMap((member) =>
            (member.tags || []).map((tag) => [tag.id, tag] as const),
          ),
        ).values(),
      ),
    [allMembersList],
  );
  const filteredMembers = useMemo(() => {
    const normalizedSearch = memberSearch.trim().toLowerCase();

    return allMembersList.filter((member) => {
      const matchesSearch =
        !normalizedSearch ||
        member.name.toLowerCase().includes(normalizedSearch) ||
        member.role?.toLowerCase().includes(normalizedSearch) ||
        member.email?.toLowerCase().includes(normalizedSearch);
      const matchesTag =
        !memberTagFilter || (member.tagIds || []).includes(memberTagFilter);

      return matchesSearch && matchesTag;
    });
  }, [allMembersList, memberSearch, memberTagFilter]);

  const fontSize = size <= 24 ? "text-[9px]" : "text-[11px]";

  useEffect(() => {
    if (!isAddMenuOpen) {
      setMemberSearch("");
      setMemberTagFilter(null);
    }
  }, [isAddMenuOpen]);

  return (
    <div className="flex items-center -space-x-1.5">
      {/* Avatares visíveis */}
      {visibleAssignees.map((member) => (
        <div
          key={member.id}
          title={member.name}
          className={cn(
            "group/avatar relative flex shrink-0 items-center justify-center rounded-full border-2 transition-all hover:z-10 hover:ring-2 hover:ring-blue-300",
            "border-(--ui-superficie-suave) bg-(--ui-fundo-neutro) ring-1 ring-(--ui-borda-suave)",
          )}
          style={{ width: size, height: size }}
          >
            {/* Tooltip de nome */}
          <div
            className={cn(
              "invisible group-hover/avatar:visible absolute z-50",
              "whitespace-nowrap rounded-md bg-slate-800",
              "px-2 py-1 text-[11px] font-medium text-white shadow-lg",
              "-top-8 left-1/2 -translate-x-1/2",
            )}
          >
            {member.name}
            <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-800" />
          </div>
          {!disabled && (
            <button
              type="button"
              aria-label={`Remover ${member.name}`}
              onClick={(event) => {
                event.stopPropagation();
                onToggle(member.id);
              }}
              className="absolute -top-1 -right-1 z-10 hidden h-4 w-4 items-center justify-center rounded-full bg-slate-800 text-white group-hover/avatar:flex cursor-pointer"
            >
              <X className="h-3 w-3" />
            </button>
          )}
          {/* Avatar */}
          <div className="h-full w-full overflow-hidden rounded-full">
            {member.avatarUrl ? (
              <img
                src={buildAssetUrl(member.avatarUrl)}
                onError={(event) => {
                  event.currentTarget.style.display = "none";
                }}
                alt={member.name}
                className="flex h-full w-full object-cover rounded-full pointer-events-none"
              />
            ) : (
              <div
                className={cn(
                  "flex h-full w-full items-center justify-center rounded-full",
                  fontSize,
                  "font-black text-white",
                  member.avatarColor || "bg-slate-400",
                )}
              >
                {getInitials(member.name)}
              </div>
            )}
          </div>
        </div>
      ))}

      {/* Botão +N com popover ao hover */}
      {overflowCount > 0 && (
        <div
          ref={overflowMenuRef}
          className="relative"
          onMouseEnter={() => setIsOverflowMenuOpen(true)}
          onMouseLeave={() => setIsOverflowMenuOpen(false)}
        >
          <button
            type="button"
            className={cn(
              "relative flex shrink-0 items-center justify-center overflow-hidden rounded-full border-2 cursor-pointer transition-all",
              isDarkMode
                ? "border-(--bg-surface) bg-(--bg-surface) text-(--text-soft) ring-1 ring-(--border-subtle) hover:bg-white/5 hover:ring-(--border-strong)"
                : "border-white bg-slate-50 text-[9px] font-black text-slate-500 ring-1 ring-slate-100 hover:bg-slate-100 hover:ring-2 hover:ring-slate-200",
            )}
            style={{ width: size, height: size }}
          >
            +{overflowCount}
          </button>

          {/* Popover com todos os membros ao hover */}
          {isOverflowMenuOpen && (
            <div
              className={cn(
                "absolute top-[calc(100%+8px)] left-1/2 z-50 w-44 -translate-x-1/2 rounded-2xl border p-2 animate-in fade-in zoom-in-95 duration-150",
                "pauta-theme-menu",
              )}
            >
              <p
                className={cn(
                  "mb-1.5 px-2 text-[9px] font-bold uppercase tracking-widest",
                  "text-(--ui-texto-secundario)",
                )}
              >
                Todos os membros
              </p>
              <div className="space-y-0.5">
                {assignees.map((member) => (
                  <div
                    key={member.id}
                    className="flex items-center gap-2 rounded-xl px-2 py-1.5"
                  >
                    {member.avatarUrl ? (
                      <img
                        src={buildAssetUrl(member.avatarUrl)}
                        onError={(event) => {
                          event.currentTarget.style.display = "none";
                        }}
                        alt={member.name}
                        className="flex h-6 w-6 shrink-0 object-cover rounded-full"
                      />
                    ) : (
                      <div
                        className={cn(
                          "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[9px] font-black text-white",
                          member.avatarColor || "bg-slate-400",
                        )}
                      >
                        {member.name
                          .split(" ")
                          .map((n) => n[0])
                          .join("")}
                      </div>
                    )}
                    <span
                      className={cn(
                        "text-[11px] font-bold leading-tight",
                        "text-(--ui-texto-forte)",
                      )}
                    >
                      {member.name}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Botão + para adicionar */}
      <div
        className="relative shrink-0 flex items-center justify-center"
        ref={addMenuRef}
        style={{ width: size, height: size }}
      >
        <button
          type="button"
          onClick={() => {
            if (disabled) return;
            setIsAddMenuOpen(!isAddMenuOpen);
          }}
          className={cn(
            "relative flex h-full w-full items-center justify-center rounded-full border-2 border-dashed transition-all cursor-pointer overflow-hidden",
            "border-(--ui-azul-borda) bg-(--ui-superficie-suave) text-(--ui-azul-texto) hover:border-blue-400 hover:bg-(--ui-azul-fundo)",
            disabled &&
              "cursor-not-allowed opacity-60 hover:border-blue-500/30 hover:bg-(--bg-surface)",
          )}
        >
          <Plus className="h-4 w-4" />
        </button>

        {/* Dropdown para adicionar */}
        {isAddMenuOpen && !disabled && (
          <div
            className={cn(
              "absolute top-[calc(100%+8px)] left-0 z-50 w-72 rounded-2xl border p-3 animate-in fade-in zoom-in-95 duration-200",
              "pauta-theme-menu",
            )}
          >
            <p
              className={cn(
                "mb-1.5 px-2 text-[10px] font-bold uppercase tracking-widest",
                "text-(--ui-texto-secundario)",
              )}
            >
              Atribuir a
            </p>
            <input aria-label="Buscar membro por nome, cargo ou e-mail"
              value={memberSearch}
              onChange={(event) => setMemberSearch(event.target.value)}
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
                  onClick={() => setMemberTagFilter(null)}
                  className={cn(
                    "shrink-0 cursor-pointer whitespace-nowrap rounded-full border px-3 py-1 text-[11px] font-black transition-all hover:opacity-85",
                    memberTagFilter === null
                      ? "border-(--ui-azul-borda) bg-(--ui-azul-fundo) text-(--ui-azul-texto)"
                      : "border-(--ui-borda) text-(--ui-texto-secundario)",
                  )}
                >
                  Todas
                </button>
                {memberFilterTags.map((tag) => (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() =>
                      setMemberTagFilter((current) =>
                        current === tag.id ? null : tag.id,
                      )
                    }
                    className={cn(
                      "shrink-0 cursor-pointer whitespace-nowrap rounded-full border px-3 py-1 text-[11px] font-black transition-all hover:opacity-85",
                      memberTagFilter === tag.id
                        ? "text-white"
                        : "border-(--ui-borda) text-(--ui-texto-secundario)",
                    )}
                    style={
                      memberTagFilter === tag.id
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
              {filteredMembers.map((member) => {
                const isSelected = assigneeIds.includes(member.id);
                return (
                  <button
                    key={member.id}
                    type="button"
                    onClick={() => onToggle(member.id)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left transition-colors cursor-pointer",
                      isSelected
                        ? "bg-(--ui-azul-fundo)"
                        : "hover:bg-(--ui-hover)",
                    )}
                  >
                    {member.avatarUrl ? (
                      <img
                        src={buildAssetUrl(member.avatarUrl)}
                        onError={(event) => {
                          event.currentTarget.style.display = "none";
                        }}
                        alt={member.name}
                        className="flex h-6 w-6 shrink-0 object-cover rounded-full"
                      />
                    ) : (
                      <div
                        className={cn(
                          "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[9px] font-black text-white",
                          member.avatarColor || "bg-slate-400",
                        )}
                      >
                        {getInitials(member.name)}
                      </div>
                    )}
                      <div className="flex-1 min-w-0">
                        <p
                          className={cn(
                          "text-[12px] font-bold truncate",
                          "text-(--ui-texto-forte)",
                        )}
                        >
                          {member.name}
                        </p>
                        {member.role && (
                        <p
                          className={cn(
                            "text-[10px] truncate",
                            "text-(--ui-texto-secundario)",
                          )}
                        >
                            {member.role}
                          </p>
                        )}
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
                      {isSelected && (
                        <Check className="h-3.5 w-3.5 shrink-0 text-blue-600" />
                    )}
                  </button>
                );
              })}
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
    </div>
  );
}
