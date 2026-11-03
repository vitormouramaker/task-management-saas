import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X, User, Briefcase, Loader2, Save, ChevronDown } from "lucide-react";
import { Input } from "../../../components/ui/input";
import { useAuthStore } from "../../../store/use-auth-store";
import { useTaskStore } from "../../../store/use-task-store";
import { useThemeStore } from "../../../store/use-theme-store";
import { cn } from "../../../lib/utils";
import axios from "axios";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "../../../store/use-toast-store";
import { useFecharComEsc } from "../../../lib/use-fechar-com-esc";

interface UserEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  memberId: string | null;
  initialName: string;
  initialRole: string;
  initialTagIds: string[];
  initialAccessRole?: "owner" | "admin" | "member";
}

export function UserEditModal({
  isOpen,
  onClose,
  memberId,
  initialName,
  initialRole,
  initialTagIds,
  initialAccessRole = "member",
}: UserEditModalProps) {
  // Esc fecha a janela, como em qualquer aplicativo.
  useFecharComEsc(isOpen, onClose);
  const [name, setName] = useState(initialName);
  const [role, setRole] = useState(initialRole);
  const [accessRole, setAccessRole] = useState(initialAccessRole);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>(initialTagIds);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [availableRoles, setAvailableRoles] = useState<string[]>([]);
  const [isRoleSelectOpen, setIsRoleSelectOpen] = useState(false);
  const roleSelectRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const isDarkMode = useThemeStore((state) => state.mode === "dark");
  const availableTags = Object.values(
    useTaskStore((state) => state.graph.tags),
  );

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        roleSelectRef.current &&
        !roleSelectRef.current.contains(e.target as Node)
      ) {
        setIsRoleSelectOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    setName(initialName);
    setRole(initialRole);
    setAccessRole(initialAccessRole);
    setSelectedTagIds(initialTagIds);
    setSuccess(false);
    setError(null);
  }, [initialName, initialRole, initialTagIds, initialAccessRole, isOpen]);

  useEffect(() => {
    if (isOpen) {
      axios
        .get("/api/users/roles", {
          headers: { Authorization: `Bearer ${useAuthStore.getState().token}` },
        })
        .then((res) => setAvailableRoles(res.data.roles))
        .catch((err) => console.error("Erro ao carregar cargos", err));
    }
  }, [isOpen]);

  const token = useAuthStore((state) => state.token);

  const handleClose = () => {
    onClose();
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !memberId) return;

    setIsLoading(true);
    setError(null);

    try {
      await axios.put(
        `/api/users/${memberId}`,
        {
          name,
          role,
          tagIds: selectedTagIds,
          accessRole: accessRole === "owner" ? undefined : accessRole,
        },
        { headers: { Authorization: `Bearer ${token}` } },
      );
      setSuccess(true);
      toast.success("Usuário atualizado.", {
        message: "Os novos dados já estão valendo.",
      });
      // Invalidate query to refresh data
      queryClient.invalidateQueries({ queryKey: ["workspace-seed"] });
      setTimeout(() => {
        handleClose();
      }, 1500);
    } catch (err: any) {
      console.error("Erro ao editar membro:", err);
      setError(
        err.response?.data?.message ||
          "Erro ao editar o usuário. Verifique as informações.",
      );
    } finally {
      setIsLoading(false);
    }
  };

  const toggleTag = (tagId: string) => {
    setSelectedTagIds((current) =>
      current.includes(tagId)
        ? current.filter((id) => id !== tagId)
        : [...current, tagId],
    );
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label="Editar pessoa">
      <div
        className="pauta-theme-overlay absolute inset-0 backdrop-blur-sm transition-opacity"
        onClick={handleClose}
      />

      <div
        className={cn(
          "relative z-10 w-full max-w-lg rounded-3xl border animate-in fade-in zoom-in-95 duration-200",
          isDarkMode
            ? "pauta-theme-surface"
            : "border-slate-200 bg-white shadow-2xl shadow-slate-900/10",
        )}
      >
        <div
          className={cn(
            "flex items-center justify-between rounded-t-3xl border-b px-6 py-4",
            "border-(--ui-borda-suave) bg-(--ui-fundo-sutil)",
          )}
        >
          <div>
            <h2
              className={cn(
                "text-lg font-black",
                "text-(--ui-texto-principal)",
              )}
            >
              Editar Perfil
            </h2>
            <p
              className={cn(
                "text-[13px] font-medium",
                "text-(--ui-texto-secundario)",
              )}
            >
              Altere os dados básicos e o cargo no sistema.
            </p>
          </div>
          <button
            onClick={handleClose}
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-full transition-colors cursor-pointer",
              "text-(--ui-texto-secundario) hover:bg-(--ui-hover-forte) hover:text-(--ui-texto-forte)",
            )}
          
            aria-label="Fechar"
            title="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {success ? (
          <div className="p-8 text-center animate-in fade-in slide-in-from-bottom-2">
            <div
              className={cn(
                "mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full",
                "bg-(--ui-verde-fundo) text-(--ui-verde-texto)",
              )}
            >
              <User className="h-8 w-8" />
            </div>
            <h3
              className={cn(
                "text-xl font-black",
                "text-(--ui-texto-principal)",
              )}
            >
              Salvo com Sucesso!
            </h3>
          </div>
        ) : (
          <form onSubmit={handleSave} className="p-6 space-y-5">
            {error && (
              <div
                className={cn(
                  "rounded-xl border p-3 text-center text-[13px] font-bold",
                  "border-(--ui-rose-borda) bg-(--ui-rose-fundo) text-(--ui-rose-texto)",
                )}
              >
                {error}
              </div>
            )}

            <div className="space-y-4">
              <div className="space-y-2">
                <label
                  className={cn(
                    "text-[12px] font-bold uppercase tracking-wider",
                    "text-(--ui-texto-secundario)",
                  )}
                >
                  Nome <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <User
                    className={cn(
                      "absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2",
                      "text-(--ui-texto-secundario)",
                    )}
                  />
                  <Input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Nome completo"
                    className={cn(
                      "h-11 pl-10",
                      "border-(--ui-borda) bg-(--ui-fundo-sutil)",
                    )}
                  />
                </div>
              </div>

              <div className="space-y-2" ref={roleSelectRef}>
                <label
                  className={cn(
                    "text-[12px] font-bold uppercase tracking-wider",
                    "text-(--ui-texto-secundario)",
                  )}
                >
                  Cargo / Função
                </label>
                <div className="relative">
                  <Briefcase
                    className={cn(
                      "absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 pointer-events-none",
                      "text-(--ui-texto-secundario)",
                    )}
                  />
                  <button
                    type="button"
                    onClick={() => setIsRoleSelectOpen(!isRoleSelectOpen)}
                    className={cn(
                      "flex h-11 w-full items-center justify-between rounded-md border pl-10 pr-4 text-left text-sm font-medium transition-colors",
                      "border-(--ui-borda) bg-(--ui-fundo-sutil) text-(--ui-texto-forte) hover:bg-(--ui-hover-forte)",
                    )}
                  >
                    {role || "Selecione o cargo"}
                    <ChevronDown
                      className={cn(
                        "h-4 w-4 transition-transform",
                        "text-(--ui-texto-secundario)",
                        isRoleSelectOpen && "rotate-180",
                      )}
                    />
                  </button>
                  {isRoleSelectOpen && (
                    <div
                      className={cn(
                        "absolute top-[calc(100%+4px)] left-0 z-50 max-h-45 w-full overflow-y-auto rounded-lg border p-1.5 animate-in fade-in zoom-in-95",
                        "pauta-theme-menu",
                      )}
                    >
                      {availableRoles.map((r) => (
                        <button
                          key={r}
                          type="button"
                          onClick={() => {
                            setRole(r);
                            setIsRoleSelectOpen(false);
                          }}
                          className={cn(
                            "w-full text-left px-3 py-2 text-sm rounded-md transition-colors",
                            role === r
                              ? "bg-(--ui-azul-fundo) text-(--ui-azul-texto) font-bold"
                              : "text-(--ui-texto-item) hover:bg-(--ui-hover) font-medium",
                          )}
                        >
                          {r}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {accessRole !== "owner" && (
                <div className="space-y-2">
                  <span
                    className={cn(
                      "text-[12px] font-bold uppercase tracking-wider",
                      "text-(--ui-texto-secundario)",
                    )}
                  >
                    Permissão na conta
                  </span>
                  <div className="grid grid-cols-2 gap-2" role="radiogroup">
                    {(
                      [
                        { value: "member", label: "Membro" },
                        { value: "admin", label: "Administrador" },
                      ] as const
                    ).map((option) => {
                      const selected = accessRole === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          onClick={() => setAccessRole(option.value)}
                          className={cn(
                            "h-11 rounded-xl border text-sm font-bold transition-all cursor-pointer",
                            selected
                              ? "border-blue-600 text-blue-600 ring-4 ring-blue-500/15"
                              : "border-(--ui-borda) text-(--ui-texto-secundario) hover:border-(--ui-borda-forte)",
                          )}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <label
                  className={cn(
                    "text-[12px] font-bold uppercase tracking-wider",
                    "text-(--ui-texto-secundario)",
                  )}
                >
                  Etiquetas do Membro
                </label>
                <div
                  className={cn(
                    "flex min-h-11 flex-wrap gap-2 rounded-2xl border p-3",
                    "border-(--ui-borda) bg-(--ui-fundo-sutil)",
                  )}
                >
                  {availableTags.map((tag) => {
                    const isSelected = selectedTagIds.includes(tag.id);
                    return (
                      <button
                        key={tag.id}
                        type="button"
                        onClick={() => toggleTag(tag.id)}
                        className={cn(
                          "rounded-full px-3 py-1 text-[11px] font-black transition-all cursor-pointer",
                          isSelected
                            ? "ring-2 ring-blue-500 ring-offset-2"
                            : "opacity-65 hover:opacity-100",
                          isDarkMode &&
                            isSelected &&
                            "ring-offset-(--bg-surface)",
                        )}
                        style={{ backgroundColor: tag.color, color: "white" }}
                      >
                        {tag.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div
              className={cn(
                "flex justify-end gap-3 pt-6 border-t",
                "border-(--ui-borda-suave)",
              )}
            >
              <button
                type="button"
                onClick={handleClose}
                className={cn(
                  "rounded-xl px-4 py-2.5 text-sm font-bold transition-colors cursor-pointer",
                  "text-(--ui-texto-secundario) hover:bg-(--ui-hover-forte) hover:text-(--ui-texto-forte)",
                )}
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isLoading || !name}
                className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-blue-600 text-sm font-bold text-white shadow-lg shadow-blue-500/20 hover:bg-blue-700 hover:shadow-blue-500/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Salvar Alterações
              </button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body,
  );
}

