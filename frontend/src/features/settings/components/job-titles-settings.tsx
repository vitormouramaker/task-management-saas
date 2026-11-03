import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { Briefcase, Check, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { Input } from "../../../components/ui/input";
import { buildApiUrl } from "../../../lib/api";
import { queryClient } from "../../../lib/query-client";
import { cn } from "../../../lib/utils";
import { useAuthStore } from "../../../store/use-auth-store";
import { toast } from "../../../store/use-toast-store";
import { confirmar } from "../../../store/use-confirm-store";

interface JobTitle {
  id: string;
  name: string;
  memberCount: number;
}

function getErrorMessage(error: unknown, fallback: string) {
  return axios.isAxiosError(error)
    ? (error.response?.data as { message?: string })?.message || fallback
    : fallback;
}

/** Lista de cargos da conta ativa, usada nos selects de convite, membros e perfil. */
export function JobTitlesSettings() {
  const token = useAuthStore((state) => state.token);
  const organization = useAuthStore((state) => state.user?.organization);
  const canManage = organization?.role === "owner" || organization?.role === "admin";

  const [jobTitles, setJobTitles] = useState<JobTitle[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const headers = { Authorization: `Bearer ${token}` };

  const loadJobTitles = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    try {
      const response = await axios.get<{ jobTitles: JobTitle[] }>(buildApiUrl("/api/job-titles"), {
        headers: { Authorization: `Bearer ${token}` },
      });
      setJobTitles(response.data.jobTitles ?? []);
    } catch (error) {
      toast.error("Não foi possível carregar os cargos.", {
        message: getErrorMessage(error, "Tente novamente em instantes."),
      });
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadJobTitles();
  }, [loadJobTitles, organization?.id]);

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!newName.trim()) return;
    setIsCreating(true);
    try {
      await axios.post(buildApiUrl("/api/job-titles"), { name: newName.trim() }, { headers });
      setNewName("");
      toast.success("Cargo criado.", { message: "Já aparece nos convites e na edição de membros." });
      await loadJobTitles();
    } catch (error) {
      toast.error("Não foi possível criar o cargo.", {
        message: getErrorMessage(error, "Revise o nome e tente de novo."),
      });
    } finally {
      setIsCreating(false);
    }
  };

  const handleRename = async () => {
    if (!editing || !editing.name.trim()) return;
    setBusyId(editing.id);
    try {
      const response = await axios.put(
        buildApiUrl(`/api/job-titles/${editing.id}`),
        { name: editing.name.trim() },
        { headers },
      );
      const updatedMembers = Number(response.data?.jobTitle?.updatedMembers || 0);
      toast.success("Cargo atualizado.", {
        message:
          updatedMembers > 0
            ? `${updatedMembers} pessoa(s) com esse cargo foram atualizadas.`
            : "O novo nome já está valendo.",
      });
      setEditing(null);
      await loadJobTitles();
      if (updatedMembers > 0) {
        await queryClient.invalidateQueries({ queryKey: ["workspace-seed"] });
      }
    } catch (error) {
      toast.error("Não foi possível renomear o cargo.", {
        message: getErrorMessage(error, "Tente novamente em instantes."),
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (jobTitle: JobTitle) => {
    const warning =
      jobTitle.memberCount > 0
        ? `\n\n${jobTitle.memberCount} pessoa(s) continuam com esse cargo até alguém trocar.`
        : "";
    const confirmado = await confirmar({
      title: `Remover o cargo "${jobTitle.name}"?`,
      message: warning.trim() || "O cargo sai da lista de opções.",
      confirmLabel: "Remover",
    });
    if (!confirmado) return;

    setBusyId(jobTitle.id);
    try {
      await axios.delete(buildApiUrl(`/api/job-titles/${jobTitle.id}`), { headers });
      toast.success("Cargo removido.", { message: jobTitle.name });
      await loadJobTitles();
    } catch (error) {
      toast.error("Não foi possível remover o cargo.", {
        message: getErrorMessage(error, "Tente novamente em instantes."),
      });
    } finally {
      setBusyId(null);
    }
  };

  const cardClass = cn(
    "rounded-2xl border",
    "border-(--ui-borda) bg-(--ui-superficie)",
  );
  const mutedClass = "text-(--ui-texto-secundario)";

  return (
    <div className="space-y-6">
      <div className={cn(cardClass, "p-6")}>
        <div className="mb-6 flex items-start gap-4">
          <div className={cn("rounded-xl p-3", "bg-(--ui-azul-fundo) text-(--ui-azul-texto)")}>
            <Briefcase className="h-6 w-6" />
          </div>
          <div>
            <h2 className={cn("text-lg font-bold", "text-(--ui-texto-principal)")}>
              Cargos da conta
            </h2>
            <p className={cn("text-sm font-medium", mutedClass)}>
              Só os cargos desta lista podem ser escolhidos ao convidar ou editar membros. O cargo é
              apenas informativo: as permissões são definidas pelo papel (Titular, Administrador ou Membro).
            </p>
          </div>
        </div>

        {canManage ? (
          <form
            onSubmit={handleCreate}
            className={cn(
              "flex flex-col gap-3 rounded-xl border p-4 sm:flex-row",
              "border-(--ui-borda) bg-(--ui-fundo-sutil)",
            )}
          >
            <Input
              placeholder="Nome do cargo..."
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              maxLength={80}
              className={cn("h-11 flex-1", "bg-(--ui-superficie)")}
            />
            <button
              type="submit"
              disabled={isCreating || newName.trim().length < 2}
              className="flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-blue-600 px-6 font-bold text-white transition-colors hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
            >
              {isCreating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Adicionar
            </button>
          </form>
        ) : (
          <p className={cn("text-[13px] font-medium", mutedClass)}>
            Apenas o titular ou administradores podem alterar a lista.
          </p>
        )}
      </div>

      <div className={cn(cardClass, "overflow-hidden")}>
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-10">
            <Loader2 className={cn("h-4 w-4 animate-spin", mutedClass)} />
            <span className={cn("text-sm font-medium", mutedClass)}>Carregando cargos...</span>
          </div>
        ) : (
          <ul className={cn("divide-y", "divide-(--ui-borda-suave)")}>
            {jobTitles.map((jobTitle) => (
              <li key={jobTitle.id} className="flex flex-wrap items-center justify-between gap-3 px-6 py-3">
                {editing?.id === jobTitle.id ? (
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <Input
                      value={editing.name}
                      onChange={(event) => setEditing({ id: jobTitle.id, name: event.target.value })}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") handleRename();
                        if (event.key === "Escape") setEditing(null);
                      }}
                      maxLength={80}
                      autoFocus
                      className={cn("h-9 flex-1", "bg-(--ui-superficie-campo)")}
                    />
                    <button
                      type="button"
                      onClick={handleRename}
                      disabled={busyId === jobTitle.id}
                      aria-label="Salvar"
                      className="grid h-9 w-9 place-items-center rounded-lg bg-blue-600 text-white hover:bg-blue-700 cursor-pointer"
                    >
                      {busyId === jobTitle.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditing(null)}
                      aria-label="Cancelar"
                      className={cn(
                        "grid h-9 w-9 place-items-center rounded-lg cursor-pointer",
                        "text-(--ui-texto-secundario) hover:bg-(--ui-hover-forte)",
                      )}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="min-w-0">
                      <p className={cn("truncate text-sm font-bold", "text-(--ui-texto-principal)")}>
                        {jobTitle.name}
                      </p>
                      <p className={cn("text-[12px] font-medium", mutedClass)}>
                        {jobTitle.memberCount === 0
                          ? "Ninguém com este cargo"
                          : `${jobTitle.memberCount} pessoa(s)`}
                      </p>
                    </div>
                    {canManage && (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setEditing({ id: jobTitle.id, name: jobTitle.name })}
                          aria-label={`Renomear ${jobTitle.name}`}
                          className={cn(
                            "grid h-8 w-8 place-items-center rounded-lg transition-colors cursor-pointer",
                            "text-(--ui-texto-secundario) hover:bg-(--ui-azul-fundo) hover:text-(--ui-azul-texto)",
                          )}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(jobTitle)}
                          disabled={busyId === jobTitle.id}
                          aria-label={`Remover ${jobTitle.name}`}
                          className={cn(
                            "grid h-8 w-8 place-items-center rounded-lg transition-colors cursor-pointer",
                            "text-(--ui-texto-secundario) hover:bg-(--ui-rose-fundo) hover:text-(--ui-rose-texto)",
                          )}
                        >
                          {busyId === jobTitle.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
