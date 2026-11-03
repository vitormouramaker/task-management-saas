import { useQuery } from "@tanstack/react-query";
import { cn } from "../../../lib/utils";
import {
  AdminPageHeader,
  PLAN_LABELS,
  formatBrl,
  formatStorage,
  useAdminApi,
  useAdminStyles,
  type AdminNavigate,
} from "../admin-shared";

interface Overview {
  organizations: number;
  newOrganizationsLast30Days: number;
  members: number;
  paying: number;
  trials: number;
  exempt: number;
  pastDue: number;
  mrrCents: number;
  byPlan: Record<string, number>;
  storageMb: number;
  newEnterpriseRequests: number;
  pendingInvoices?: number;
  waitingSupport?: number;
}

export function OverviewPage({ navigate }: { navigate: AdminNavigate }) {
  const api = useAdminApi();
  const { card, muted, title } = useAdminStyles();

  const { data, isPending, isError } = useQuery({
    queryKey: ["admin", "overview"],
    queryFn: () => api.get<Overview>("/overview"),
  });

  return (
    <>
      <AdminPageHeader
        title="Visão geral"
        description="Números da plataforma inteira. Valores oficiais de cobrança ficam na Stripe."
      />

      {isPending ? (
        <p className={cn("text-sm font-bold", muted)}>Carregando…</p>
      ) : isError || !data ? (
        <p className="text-sm font-bold text-rose-600">Não foi possível carregar.</p>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            {[
              { label: "Receita mensal estimada", value: formatBrl(data.mrrCents) },
              { label: "Contas pagantes", value: data.paying },
              { label: "Contas no total", value: data.organizations, to: "/admin/contas" },
              { label: "Novas contas (30 dias)", value: data.newOrganizationsLast30Days },
              { label: "Pessoas cadastradas", value: data.members },
              { label: "Testes grátis ativos", value: data.trials },
              { label: "Faturas em atraso", value: data.pastDue },
              {
                label: "Solicitações Enterprise novas",
                value: data.newEnterpriseRequests,
                to: "/admin/enterprise",
              },
              { label: "Suporte aguardando resposta", value: data.waitingSupport ?? 0, to: "/admin/suporte" },
              { label: "Notas fiscais a emitir", value: data.pendingInvoices ?? 0, to: "/admin/notas-fiscais" },
              { label: "Armazenamento usado", value: formatStorage(data.storageMb) },
              { label: "Contas internas", value: data.exempt },
            ].map((item) => (
              <button
                key={item.label}
                type="button"
                disabled={!item.to}
                onClick={() => item.to && navigate(item.to)}
                className={cn(card, "p-4 text-left enabled:cursor-pointer enabled:hover:border-blue-500")}
              >
                <p className={cn("text-[11px] font-bold", muted)}>{item.label}</p>
                <p className={cn("mt-1 text-xl font-bold", title)}>{item.value}</p>
              </button>
            ))}
          </div>

          <div className={cn(card, "p-5")}>
            <h3 className={cn("mb-3 text-sm font-black", title)}>Contas por plano</h3>
            <div className="flex flex-wrap gap-2">
              {Object.entries(data.byPlan).map(([plan, total]) => (
                <span
                  key={plan}
                  className="rounded-full bg-blue-600/10 px-3 py-1 text-xs font-black text-blue-600"
                >
                  {PLAN_LABELS[plan] || plan}: {total}
                </span>
              ))}
            </div>
            <p className={cn("mt-3 text-[11px] font-medium", muted)}>
              A receita mensal é estimada pelo catálogo (plano + adicionais, anual dividido por 12).
            </p>
          </div>
        </div>
      )}
    </>
  );
}
