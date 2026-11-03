import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import axios from "axios";
import { Briefcase, Loader2, Mail, Send, X } from "lucide-react";
import { Input } from "../../../components/ui/input";
import { buildApiUrl } from "../../../lib/api";
import { isValidEmail } from "../../../lib/documents";
import { cn } from "../../../lib/utils";
import { useAuthStore } from "../../../store/use-auth-store";
import { useTaskStore } from "../../../store/use-task-store";
import { useThemeStore } from "../../../store/use-theme-store";
import { toast } from "../../../store/use-toast-store";
import { useFecharComEsc } from "../../../lib/use-fechar-com-esc";

interface InviteMemberModalProps {
  isOpen: boolean;
  onClose: () => void;
  onInvited?: () => void;
}

const ACCESS_ROLE_OPTIONS = [
  {
    value: "member",
    label: "Membro",
    description: "Usa os espaços de trabalho e projetos que forem compartilhados com ele.",
  },
  {
    value: "admin",
    label: "Administrador",
    description: "Também convida pessoas, gerencia membros e configura a conta.",
  },
] as const;

export function InviteMemberModal({ isOpen, onClose, onInvited }: InviteMemberModalProps) {
  // Esc fecha a janela, como em qualquer aplicativo.
  useFecharComEsc(isOpen, onClose);
  const token = useAuthStore((state) => state.token);
  const organizationName = useAuthStore((state) => state.user?.organization?.name);
  const tags = Object.values(useTaskStore((state) => state.graph.tags));
  const isDarkMode = useThemeStore((state) => state.mode === "dark");

  const [email, setEmail] = useState("");
  const [accessRole, setAccessRole] = useState<"member" | "admin">("member");
  const [jobTitle, setJobTitle] = useState("");
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [jobTitleSuggestions, setJobTitleSuggestions] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setEmail("");
    setAccessRole("member");
    setJobTitle("");
    setSelectedTagIds([]);
    setError(null);

    axios
      .get(buildApiUrl("/api/users/roles"), {
        headers: { Authorization: `Bearer ${token}` },
      })
      .then((response) => setJobTitleSuggestions(response.data?.roles ?? []))
      .catch(() => setJobTitleSuggestions([]));
  }, [isOpen, token]);

  if (!isOpen) return null;

  const canSubmit = isValidEmail(email) && !isSaving;

  const toggleTag = (tagId: string) => {
    setSelectedTagIds((current) =>
      current.includes(tagId) ? current.filter((id) => id !== tagId) : [...current, tagId],
    );
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;

    setIsSaving(true);
    setError(null);
    try {
      const response = await axios.post(
        buildApiUrl("/api/invitations"),
        { email: email.trim(), accessRole, jobTitle: jobTitle.trim(), tagIds: selectedTagIds },
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (response.data?.emailSent) {
        toast.success("Convite enviado.", { message: response.data.message });
      } else {
        toast.warning("Convite criado.", { message: response.data?.message });
      }
      onInvited?.();
      onClose();
    } catch (requestError) {
      const message = axios.isAxiosError(requestError)
        ? (requestError.response?.data as { message?: string })?.message
        : null;
      setError(message || "Não foi possível enviar o convite. Tente novamente.");
    } finally {
      setIsSaving(false);
    }
  };

  const labelClass = cn(
    "text-[12px] font-bold uppercase tracking-wider",
    "text-(--ui-texto-secundario)",
  );
  const inputClass = cn(
    "h-11 pl-10",
    "border-(--ui-borda) bg-(--ui-fundo-sutil)",
  );

  return createPortal(
    <div className="fixed inset-0 z-9999 flex items-end justify-center sm:items-center sm:p-4">
      <div
        className="pauta-theme-overlay absolute inset-0 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          "relative z-10 flex max-h-dvh w-full flex-col rounded-t-3xl border animate-in fade-in zoom-in-95 duration-200 sm:max-h-[90dvh] sm:max-w-lg sm:rounded-3xl",
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
            <h2 className={cn("text-lg font-black", "text-(--ui-texto-principal)")}>
              Convidar membro
            </h2>
            <p className={cn("text-[13px] font-medium", "text-(--ui-texto-secundario)")}>
              A pessoa recebe um e-mail para entrar em {organizationName ?? "sua conta"}.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-full transition-colors cursor-pointer",
              "text-(--ui-texto-secundario) hover:bg-(--ui-hover-forte) hover:text-(--ui-texto-forte)",
            )}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 space-y-5 overflow-y-auto p-6">
          {error && (
            <div
              role="alert"
              className={cn(
                "rounded-xl border p-3 text-center text-[13px] font-bold",
                "border-(--ui-rose-borda) bg-(--ui-rose-fundo) text-(--ui-rose-texto)",
              )}
            >
              {error}
            </div>
          )}

          <div className="space-y-2">
            <label className={labelClass}>
              E-mail <span className="text-rose-500">*</span>
            </label>
            <div className="relative">
              <Mail
                className={cn(
                  "absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2",
                  "text-(--ui-texto-secundario)",
                )}
              />
              <Input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="pessoa@empresa.com"
                autoComplete="off"
                className={inputClass}
              />
            </div>
          </div>

          <div className="space-y-2">
            <span className={labelClass}>Permissão</span>
            <div className="grid gap-2 sm:grid-cols-2" role="radiogroup">
              {ACCESS_ROLE_OPTIONS.map((option) => {
                const selected = accessRole === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setAccessRole(option.value)}
                    className={cn(
                      "rounded-2xl border p-3 text-left transition-all cursor-pointer",
                      selected
                        ? "border-blue-600 ring-4 ring-blue-500/15"
                        : "border-(--ui-borda) hover:border-(--ui-borda-forte)",
                    )}
                  >
                    <span className={cn("block text-sm font-black", "text-(--ui-texto-principal)")}>
                      {option.label}
                    </span>
                    <span className={cn("mt-0.5 block text-[12px] font-medium leading-snug", "text-(--ui-texto-secundario)")}>
                      {option.description}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <label className={labelClass}>Cargo / função</label>
            <div className="relative">
              <Briefcase
                className={cn(
                  "pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2",
                  "text-(--ui-texto-secundario)",
                )}
              />
              <select
                value={jobTitle}
                onChange={(event) => setJobTitle(event.target.value)}
                className={cn(
                  "h-11 w-full cursor-pointer appearance-none rounded-xl border pl-10 pr-4 text-sm font-medium outline-none transition",
                  "border-(--ui-borda) bg-(--ui-fundo-sutil) text-(--ui-texto-forte)",
                )}
              >
                <option value="">Sem cargo definido</option>
                {jobTitleSuggestions.map((suggestion) => (
                  <option key={suggestion} value={suggestion}>
                    {suggestion}
                  </option>
                ))}
              </select>
            </div>
            <p className={cn("text-[12px] font-medium", "text-(--ui-texto-secundario)")}>
              Os cargos são gerenciados em Configurações &gt; Cargos.
            </p>
          </div>

          {tags.length > 0 && (
            <div className="space-y-2">
              <span className={labelClass}>Etiquetas</span>
              <div
                className={cn(
                  "flex flex-wrap gap-2 rounded-2xl border p-3",
                  "border-(--ui-borda) bg-(--ui-fundo-sutil)",
                )}
              >
                {tags.map((tag) => {
                  const isSelected = selectedTagIds.includes(tag.id);
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      onClick={() => toggleTag(tag.id)}
                      className={cn(
                        "rounded-full px-3 py-1 text-[11px] font-black transition-all cursor-pointer",
                        isSelected ? "ring-2 ring-blue-500 ring-offset-2" : "opacity-65 hover:opacity-100",
                        isDarkMode && isSelected && "ring-offset-(--bg-surface)",
                      )}
                      style={{ backgroundColor: tag.color, color: "white" }}
                    >
                      {tag.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div
            className={cn(
              "flex justify-end gap-3 border-t pt-5",
              "border-(--ui-borda-suave)",
            )}
          >
            <button
              type="button"
              onClick={onClose}
              className={cn(
                "rounded-xl px-4 py-2.5 text-sm font-bold transition-colors cursor-pointer",
                "text-(--ui-texto-secundario) hover:bg-(--ui-hover-forte) hover:text-(--ui-texto-forte)",
              )}
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="flex items-center gap-2 rounded-xl bg-blue-600 px-6 py-2.5 text-sm font-bold text-white shadow-lg shadow-blue-500/20 transition-all hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
            >
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Enviar convite
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
