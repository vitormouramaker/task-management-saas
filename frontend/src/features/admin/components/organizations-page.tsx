import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { cn } from "../../../lib/utils";
import {
  TabelaRolavel,
  AdminListaCarregando,
  AdminPageHeader,
  PLAN_LABELS,
  formatBrl,
  formatDate,
  formatStorage,
  useAdminApi,
  useAdminStyles,
  type AdminNavigate,
} from "../admin-shared";

interface OrganizationRow {
  id: string;
  name: string;
  ownerName: string | null;
  ownerEmail: string | null;
  plan: string;
  effectivePlan: string;
  billingExempt: boolean;
  trialEndsAt: string | null;
  pastDue: boolean;
  cancelAtPeriodEnd: boolean;
  membersCount: number;
  storageMb: number;
  monthlyCents: number;
  createdAt: string;
}

export function OrganizationsPage({ navigate }: { navigate: AdminNavigate }) {
  const api = useAdminApi();
  const styles = useAdminStyles();
  const params = new URLSearchParams(window.location.search);
  const [search, setSearch] = useState(params.get("busca") || "");
  const [busca, setBusca] = useState(search);
  const [plan, setPlan] = useState(params.get("plano") || "");
  const [page, setPage] = useState(Number(params.get("pagina")) || 0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (search !== busca) {
        setBusca(search);
        setPage(0);
      }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [search, busca]);

  // Filtros ficam no endereço para o "voltar" do detalhe cair no mesmo lugar.
  useEffect(() => {
    const query = new URLSearchParams();
    if (busca) query.set("busca", busca);
    if (plan) query.set("plano", plan);
    if (page) query.set("pagina", String(page));
    const qs = query.toString();
    window.history.replaceState({}, "", `/admin/contas${qs ? `?${qs}` : ""}`);
  }, [busca, plan, page]);

  const { data, isPending } = useQuery({
    queryKey: ["admin", "organizations", busca, plan, page],
    queryFn: () =>
      api.get<{ total: number; pageSize: number; organizations: OrganizationRow[] }>(
        "/organizations",
        { search: busca, plan, page },
      ),
  });

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <>
      <AdminPageHeader title="Contas" description="Todas as contas da plataforma." />

      <div className="mb-4 flex flex-wrap gap-3">
        <div className="relative min-w-60 flex-1">
          <Search className={cn("absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2", styles.muted)} />
          <input aria-label="Buscar por nome, e-mail do titular ou CNPJ"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por nome, e-mail do titular ou CNPJ"
            className={cn(styles.input, "w-full pl-9")}
          />
        </div>
        <select
          value={plan}
          onChange={(event) => {
            setPlan(event.target.value);
            setPage(0);
          }}
          className={styles.input}
        >
          <option value="">Todos os planos</option>
          {Object.entries(PLAN_LABELS).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <div className={cn(styles.card, "overflow-hidden")}>
        {isPending ? (
          <AdminListaCarregando />
        ) : (
          <TabelaRolavel>
            <table className="w-full min-w-215 text-left">
              <thead>
                <tr className={styles.tableHead}>
                  <th className="px-4 py-3">Conta</th>
                  <th className="px-4 py-3">Titular</th>
                  <th className="px-4 py-3">Plano</th>
                  <th className="px-4 py-3">Pessoas</th>
                  <th className="px-4 py-3">Armazenamento</th>
                  <th className="px-4 py-3">Receita/mês</th>
                  <th className="px-4 py-3">Criada em</th>
                </tr>
              </thead>
              <tbody>
                {(data?.organizations || []).map((org) => (
                  <tr
                    key={org.id}
                    onClick={() => navigate(`/admin/contas/${encodeURIComponent(org.id)}`)}
                    className={cn(styles.tableRow, "cursor-pointer")}
                  >
                    <td className={cn("px-4 py-3 font-bold", styles.title)}>{org.name}</td>
                    <td className={cn("px-4 py-3 text-xs", styles.muted)}>
                      {org.ownerName}
                      <span className="block">{org.ownerEmail}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-blue-600/10 px-2 py-0.5 text-[11px] font-black text-blue-600">
                        {org.billingExempt ? "Interna" : PLAN_LABELS[org.plan] || org.plan}
                      </span>
                      {org.trialEndsAt && org.effectivePlan !== org.plan && (
                        <span className={cn("ml-1 text-[10px] font-bold", styles.muted)}>em teste</span>
                      )}
                      {org.pastDue && (
                        <span className="ml-1 text-[10px] font-bold text-rose-600">em atraso</span>
                      )}
                      {org.cancelAtPeriodEnd && (
                        <span className="ml-1 text-[10px] font-bold text-amber-600">cancelando</span>
                      )}
                    </td>
                    <td className={cn("px-4 py-3", styles.muted)}>{org.membersCount}</td>
                    <td className={cn("px-4 py-3", styles.muted)}>{formatStorage(org.storageMb)}</td>
                    <td className={cn("px-4 py-3 font-bold", styles.title)}>
                      {org.monthlyCents ? formatBrl(org.monthlyCents) : "—"}
                    </td>
                    <td className={cn("px-4 py-3 text-xs", styles.muted)}>{formatDate(org.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TabelaRolavel>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <span className={cn("text-xs font-bold", styles.muted)}>
          {data?.total ?? 0} conta(s) · página {page + 1} de {totalPages}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            className={styles.outline}
            disabled={page === 0}
            onClick={() => setPage((atual) => Math.max(0, atual - 1))}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Anterior
          </button>
          <button
            type="button"
            className={styles.outline}
            disabled={page >= totalPages - 1}
            onClick={() => setPage((atual) => atual + 1)}
          >
            Próxima
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </>
  );
}
