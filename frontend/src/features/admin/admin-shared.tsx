import axios from "axios";
import { buildApiUrl } from "../../lib/api";
import { cn } from "../../lib/utils";
import { useAuthStore } from "../../store/use-auth-store";
import { useThemeStore } from "../../store/use-theme-store";
import { Skeleton } from "../../components/ui/skeleton";

export const PLAN_LABELS: Record<string, string> = {
  free: "Grátis",
  essencial: "Essencial",
  profissional: "Profissional",
  empresarial: "Empresarial",
  enterprise: "Enterprise",
  interna: "Interna",
};

export const REQUEST_STATUS_LABELS: Record<string, string> = {
  nova: "Nova",
  em_contato: "Em contato",
  proposta_enviada: "Proposta enviada",
  fechada: "Fechada",
  recusada: "Recusada",
};

export type AdminNavigate = (path: string) => void;

export function formatBrl(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function formatDate(value?: string | null, withTime = false) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return withTime
    ? date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })
    : date.toLocaleDateString("pt-BR");
}

export function formatStorage(mb: number) {
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`;
}

export function adminErrorMessage(error: unknown, fallback: string) {
  return axios.isAxiosError(error)
    ? (error.response?.data as { message?: string })?.message || fallback
    : fallback;
}

/** Chamadas à API do painel com o token da sessão. */
export function useAdminApi() {
  const token = useAuthStore((state) => state.token);
  const headers = { Authorization: `Bearer ${token}` };

  return {
    get: async <T,>(path: string, params?: Record<string, unknown>) =>
      (await axios.get(buildApiUrl(`/api/admin${path}`), { headers, params })).data as T,
    patch: async <T,>(path: string, body: unknown) =>
      (await axios.patch(buildApiUrl(`/api/admin${path}`), body, { headers })).data as T,
    post: async <T,>(path: string, body: unknown) =>
      (await axios.post(buildApiUrl(`/api/admin${path}`), body, { headers })).data as T,
  };
}

export function useAdminStyles() {
  const isDarkMode = useThemeStore((state) => state.mode === "dark");
  return {
    isDarkMode,
    card: cn(
      "rounded-2xl border",
      "border-(--ui-borda) bg-(--ui-superficie)",
    ),
    muted: "text-(--ui-texto-secundario)",
    title: "text-(--ui-texto-principal)",
    input: cn(
      "h-10 rounded-xl border px-3 text-sm font-medium outline-none focus:border-blue-500",
      "border-(--ui-borda) bg-(--ui-superficie-suave) text-(--ui-texto-principal)",
    ),
    outline: cn(
      "inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border px-3 text-xs font-bold transition-colors cursor-pointer disabled:opacity-50 disabled:pointer-events-none",
      "border-(--ui-borda) text-(--ui-texto-item) hover:bg-(--ui-hover)",
    ),
    primary:
      "inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-black text-white transition-colors hover:bg-blue-700 cursor-pointer disabled:opacity-60 disabled:pointer-events-none",
    tableHead: cn(
      "text-[11px] font-black uppercase tracking-wide",
      "bg-(--ui-fundo-sutil) text-(--ui-texto-secundario)",
    ),
    tableRow: cn(
      "border-t text-sm transition-colors",
      "border-(--ui-borda-suave) hover:bg-(--ui-hover)",
    ),
  };
}

/**
 * Tabela larga dentro de uma área que rola de lado. No celular mostra um
 * aviso curto, porque a rolagem horizontal passa despercebida em tela pequena.
 */
export function TabelaRolavel({ children }: { children: React.ReactNode }) {
  const styles = useAdminStyles();
  return (
    <div>
      <p className={cn("px-4 pt-3 text-[11px] font-bold sm:hidden", styles.muted)}>
        Arraste a tabela para o lado para ver todas as colunas.
      </p>
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}

/**
 * Esqueleto da lista enquanto os dados chegam. Usa a mesma forma do
 * conteúdo final, para a tela não dar um salto quando carregar.
 */
export function AdminListaCarregando({ linhas = 5 }: { linhas?: number }) {
  const styles = useAdminStyles();
  return (
    <div className={cn(styles.card, "divide-y", "divide-(--ui-borda-suave)")}>
      {Array.from({ length: linhas }).map((_, indice) => (
        <div key={indice} className="flex items-center gap-3 p-4">
          <Skeleton className="h-9 w-9 shrink-0 rounded-xl" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/3 rounded-full" />
            <Skeleton className="h-3 w-2/3 rounded-full" />
          </div>
          <Skeleton className="h-6 w-16 shrink-0 rounded-full" />
        </div>
      ))}
    </div>
  );
}

/** Esqueleto para os cartões de números do topo das telas. */
export function AdminCartoesCarregando({ quantos = 3 }: { quantos?: number }) {
  const styles = useAdminStyles();
  return (
    <div className="mb-4 grid gap-3 sm:grid-cols-3">
      {Array.from({ length: quantos }).map((_, indice) => (
        <div key={indice} className={cn(styles.card, "space-y-2 p-4")}>
          <Skeleton className="h-7 w-16 rounded-full" />
          <Skeleton className="h-3 w-28 rounded-full" />
        </div>
      ))}
    </div>
  );
}

export function AdminPageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  const styles = useAdminStyles();
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className={cn("text-2xl font-black tracking-tight", styles.title)}>{title}</h1>
        {description && (
          <p className={cn("mt-1 text-sm font-medium", styles.muted)}>{description}</p>
        )}
      </div>
      {actions}
    </div>
  );
}
