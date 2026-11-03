import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import {
  FolderKanban,
  LayoutGrid,
  Loader2,
  Paperclip,
  RotateCcw,
  Search,
  SquareCheckBig,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { ConfirmationModal } from "../../../components/ui/confirmation-modal";
import { buildApiUrl } from "../../../lib/api";
import { cn } from "../../../lib/utils";
import { useAuthStore } from "../../../store/use-auth-store";
import { toast } from "../../../store/use-toast-store";
import { ListaCarregando } from "../../../components/ui/lista-carregando";

type TrashType = "workspace" | "list" | "task" | "attachment";

interface TrashItem {
  id: string;
  type: TrashType;
  title: string | null;
  workspaceName: string | null;
  listName: string | null;
  taskTitle: string | null;
  deletedByName: string | null;
  deletedAt: string;
  expiresAt: string | null;
  sizeBytes: number;
  filesCount: number;
}

interface TrashResponse {
  trashDays: number;
  canEmpty: boolean;
  items: TrashItem[];
}

const TYPE_INFO: Record<TrashType, { label: string; icon: LucideIcon }> = {
  workspace: { label: "Workspace", icon: LayoutGrid },
  list: { label: "Projeto", icon: FolderKanban },
  task: { label: "Card", icon: SquareCheckBig },
  attachment: { label: "Anexo", icon: Paperclip },
};

function formatBytes(bytes: number) {
  if (!bytes) return "—";
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function daysLeft(expiresAt: string | null) {
  if (!expiresAt) return null;
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86400000));
}

function errorMessage(error: unknown, fallback: string) {
  return axios.isAxiosError(error)
    ? (error.response?.data as { message?: string })?.message || fallback
    : fallback;
}

/** Itens apagados da conta: restaurar ou excluir para sempre. */
export function TrashPage() {
  const token = useAuthStore((state) => state.token);
  const queryClient = useQueryClient();
  const headers = { Authorization: `Bearer ${token}` };

  const [filter, setFilter] = useState<TrashType | "all">("all");
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [purgeTarget, setPurgeTarget] = useState<TrashItem | "all" | null>(null);

  const { data, isPending, isError } = useQuery({
    queryKey: ["trash"],
    queryFn: async () =>
      (await axios.get(buildApiUrl("/api/trash"), { headers })).data as TrashResponse,
  });

  const items = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (data?.items || []).filter(
      (item) =>
        (filter === "all" || item.type === filter) &&
        (!term ||
          [item.title, item.listName, item.workspaceName, item.taskTitle]
            .filter(Boolean)
            .some((text) => text!.toLowerCase().includes(term))),
    );
  }, [data, filter, search]);

  const totalBytes = (data?.items || []).reduce((sum, item) => sum + item.sizeBytes, 0);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["trash"] }),
      queryClient.invalidateQueries({ queryKey: ["workspace-seed"] }),
    ]);
  };

  const restore = async (item: TrashItem) => {
    setBusyId(item.id);
    try {
      await axios.post(buildApiUrl(`/api/trash/${item.id}/restore`), {}, { headers });
      toast.success(`${TYPE_INFO[item.type].label} restaurado.`);
      await refresh();
    } catch (error) {
      toast.error(errorMessage(error, "Não foi possível restaurar."));
    } finally {
      setBusyId(null);
    }
  };

  const purge = async () => {
    if (!purgeTarget) return;
    try {
      const url = purgeTarget === "all" ? "/api/trash" : `/api/trash/${purgeTarget.id}`;
      const response = await axios.delete(buildApiUrl(url), { headers });
      toast.success(response.data?.message || "Excluído.");
      await refresh();
    } catch (error) {
      toast.error(errorMessage(error, "Não foi possível excluir."));
    } finally {
      setPurgeTarget(null);
    }
  };

  const muted = "text-(--ui-texto-secundario)";
  const titleColor = "text-(--ui-texto-principal)";
  const card = cn(
    "rounded-2xl border",
    "border-(--ui-borda) bg-(--ui-superficie)",
  );
  const outline = cn(
    "inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border px-3 text-xs font-bold transition-colors cursor-pointer disabled:opacity-50 disabled:pointer-events-none",
    "border-(--ui-borda) text-(--ui-texto-item) hover:bg-(--ui-hover)",
  );

  return (
    <div className="flex h-full w-full flex-col animate-in fade-in duration-300">
      <div className="pauta-scroll-safe min-w-0 flex-1 overflow-auto px-4 py-4 sm:px-8 sm:py-8">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className={cn("text-2xl font-black tracking-tight", titleColor)}>Lixeira</h1>
            <p className={cn("mt-1 max-w-2xl text-sm font-medium", muted)}>
              {data?.trashDays === -1
                ? "Itens apagados ficam aqui até você excluí-los para sempre."
                : `Itens apagados ficam aqui por ${data?.trashDays ?? "—"} dias, conforme o seu plano, e depois são excluídos para sempre.`}{" "}
              Arquivos na lixeira continuam contando no armazenamento
              {totalBytes ? ` (hoje: ${formatBytes(totalBytes)})` : ""}.
            </p>
          </div>
          {data?.canEmpty && (data.items.length ?? 0) > 0 && (
            <button
              type="button"
              onClick={() => setPurgeTarget("all")}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-rose-300 px-4 text-sm font-bold text-rose-600 transition-colors hover:bg-rose-50 cursor-pointer dark:hover:bg-rose-500/10"
            >
              <Trash2 className="h-4 w-4" />
              Esvaziar lixeira
            </button>
          )}
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          {(["all", "workspace", "list", "task", "attachment"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setFilter(option)}
              className={cn(
                "h-9 rounded-full px-4 text-xs font-bold transition-colors cursor-pointer",
                filter === option
                  ? "bg-blue-600 text-white"
                  : "bg-(--ui-fundo-neutro) text-(--ui-texto-secundario) hover:bg-(--ui-hover-forte)",
              )}
            >
              {option === "all" ? "Tudo" : `${TYPE_INFO[option].label}s`}
            </button>
          ))}
          <div className="relative ml-auto w-full sm:w-64">
            <Search className={cn("absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2", muted)} />
            <input aria-label="Buscar na lixeira"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar na lixeira"
              className={cn(
                "h-9 w-full rounded-xl border pl-9 pr-3 text-sm font-medium outline-none focus:border-blue-500",
                "border-(--ui-borda) bg-(--ui-superficie-suave) text-(--ui-texto-principal)",
              )}
            />
          </div>
        </div>

        {isPending ? (
          <ListaCarregando />
        ) : isError ? (
          <p className="text-sm font-bold text-rose-600">Não foi possível carregar a lixeira.</p>
        ) : items.length === 0 ? (
          <div className={cn(card, "grid place-items-center px-6 py-16 text-center")}>
            <Trash2 className={cn("h-10 w-10", muted)} />
            <p className={cn("mt-3 text-sm font-bold", titleColor)}>
              {data?.items.length ? "Nada encontrado com esse filtro." : "A lixeira está vazia."}
            </p>
          </div>
        ) : (
          <div className={cn(card, "divide-y", "divide-(--ui-borda-suave)")}>
            {items.map((item) => {
              const info = TYPE_INFO[item.type];
              const restantes = daysLeft(item.expiresAt);
              const origem = [item.workspaceName, item.listName, item.taskTitle].filter(Boolean).join(" › ");

              return (
                <div key={item.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                  <span
                    className={cn(
                      "grid h-10 w-10 shrink-0 place-items-center rounded-xl",
                      "bg-(--ui-fundo-neutro) text-(--ui-texto-secundario)",
                    )}
                  >
                    <info.icon className="h-5 w-5" />
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className={cn("truncate text-sm font-bold", titleColor)}>
                      {item.title || "Sem título"}
                    </p>
                    <p className={cn("truncate text-xs font-medium", muted)}>
                      {info.label}
                      {origem ? ` · em ${origem}` : ""}
                      {item.filesCount ? ` · ${item.filesCount} arquivo(s), ${formatBytes(item.sizeBytes)}` : ""}
                    </p>
                    <p className={cn("text-xs font-medium", muted)}>
                      Apagado por {item.deletedByName || "—"} em{" "}
                      {new Date(item.deletedAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                      {restantes !== null && (
                        <span className={cn("font-bold", restantes <= 3 ? "text-rose-600" : "")}>
                          {" "}
                          · {restantes === 0 ? "sai hoje" : `sai em ${restantes} dia(s)`}
                        </span>
                      )}
                    </p>
                  </div>

                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      onClick={() => void restore(item)}
                      disabled={busyId === item.id}
                      className={outline}
                    >
                      {busyId === item.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RotateCcw className="h-3.5 w-3.5" />
                      )}
                      Restaurar
                    </button>
                    <button
                      type="button"
                      onClick={() => setPurgeTarget(item)}
                      className={cn(outline, "text-rose-600 hover:text-rose-700")}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Excluir para sempre
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ConfirmationModal
        isOpen={purgeTarget !== null}
        onClose={() => setPurgeTarget(null)}
        onConfirm={purge}
        title={purgeTarget === "all" ? "Esvaziar lixeira" : "Excluir para sempre"}
        message={
          purgeTarget === "all"
            ? "Todos os itens da lixeira e os arquivos deles serão apagados para sempre. Não será possível recuperar."
            : `"${purgeTarget?.title || "Sem título"}" e os arquivos dele serão apagados para sempre. Não será possível recuperar.`
        }
        confirmLabel={purgeTarget === "all" ? "Esvaziar" : "Excluir para sempre"}
        pendingLabel="Excluindo..."
      />
    </div>
  );
}
