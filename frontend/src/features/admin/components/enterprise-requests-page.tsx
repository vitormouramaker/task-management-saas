import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "../../../lib/utils";
import { toast } from "../../../store/use-toast-store";
import {
  AdminListaCarregando,
  AdminPageHeader,
  PLAN_LABELS,
  REQUEST_STATUS_LABELS,
  adminErrorMessage,
  formatDate,
  useAdminApi,
  useAdminStyles,
  type AdminNavigate,
} from "../admin-shared";

interface EnterpriseRequest {
  id: string;
  organizationId: string | null;
  organizationName: string | null;
  organizationPlan: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  companyName: string | null;
  teamSize: string | null;
  seatsNeeded: number | null;
  storageNeededGb: number | null;
  reason: string;
  status: string;
  adminNotes: string | null;
  createdAt: string;
}

export function EnterpriseRequestsPage({ navigate }: { navigate: AdminNavigate }) {
  const api = useAdminApi();
  const queryClient = useQueryClient();
  const styles = useAdminStyles();
  const [status, setStatus] = useState("");

  const { data, isPending } = useQuery({
    queryKey: ["admin", "enterprise", status],
    queryFn: () =>
      api.get<{ requests: EnterpriseRequest[] }>("/enterprise-requests", { status }),
  });

  const atualizar = async (id: string, body: Record<string, unknown>) => {
    try {
      await api.patch(`/enterprise-requests/${id}`, body);
      toast.success("Solicitação atualizada.");
      await queryClient.invalidateQueries({ queryKey: ["admin"] });
    } catch (error) {
      toast.error(adminErrorMessage(error, "Não foi possível atualizar."));
    }
  };

  return (
    <>
      <AdminPageHeader
        title="Solicitações Enterprise"
        description='Pedidos feitos pelo botão "Falar com a gente" do plano Enterprise.'
        actions={
          <select value={status} onChange={(event) => setStatus(event.target.value)} className={styles.input}>
            <option value="">Todas as situações</option>
            {Object.entries(REQUEST_STATUS_LABELS).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        }
      />

      {isPending ? (
        <AdminListaCarregando />
      ) : (data?.requests || []).length === 0 ? (
        <div className={cn(styles.card, "p-6")}>
          <p className={cn("text-sm font-bold", styles.title)}>Nenhuma solicitação por aqui.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {data?.requests.map((pedido) => (
            <RequestCard key={pedido.id} pedido={pedido} onUpdate={atualizar} navigate={navigate} />
          ))}
        </div>
      )}
    </>
  );
}

function RequestCard({
  pedido,
  onUpdate,
  navigate,
}: {
  pedido: EnterpriseRequest;
  onUpdate: (id: string, body: Record<string, unknown>) => Promise<void>;
  navigate: AdminNavigate;
}) {
  const styles = useAdminStyles();
  const [notes, setNotes] = useState(pedido.adminNotes || "");

  return (
    <div className={cn(styles.card, "p-5")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className={cn("text-base font-bold", styles.title)}>
            {pedido.companyName || pedido.organizationName}
          </p>
          <p className={cn("text-xs font-bold", styles.muted)}>
            {pedido.contactName} · {pedido.contactEmail}
            {pedido.contactPhone ? ` · ${pedido.contactPhone}` : ""} · {formatDate(pedido.createdAt, true)}
          </p>
          {pedido.organizationId && (
            <button
              type="button"
              onClick={() => navigate(`/admin/contas/${encodeURIComponent(pedido.organizationId!)}`)}
              className="mt-1 text-xs font-bold text-blue-600 hover:underline cursor-pointer"
            >
              Abrir conta {pedido.organizationName}
              {pedido.organizationPlan ? ` (${PLAN_LABELS[pedido.organizationPlan] || pedido.organizationPlan})` : ""}
            </button>
          )}
        </div>
        <select
          value={pedido.status}
          onChange={(event) => void onUpdate(pedido.id, { status: event.target.value })}
          className={styles.input}
        >
          {Object.entries(REQUEST_STATUS_LABELS).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <div className={cn("mt-3 flex flex-wrap gap-3 text-[12px] font-bold", styles.muted)}>
        {pedido.teamSize && <span>Equipe: {pedido.teamSize} pessoas</span>}
        {pedido.seatsNeeded && <span>Vão usar: {pedido.seatsNeeded} pessoas</span>}
        {pedido.storageNeededGb && <span>Armazenamento: {pedido.storageNeededGb} GB</span>}
      </div>

      <p className={cn("mt-3 whitespace-pre-line text-sm font-medium", styles.title)}>{pedido.reason}</p>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          rows={2}
          placeholder="Anotações da equipe (proposta, reunião, valores...)"
          className={cn(styles.input, "h-auto flex-1 py-2")}
        />
        <button
          type="button"
          onClick={() => void onUpdate(pedido.id, { adminNotes: notes })}
          className={cn(styles.primary, "shrink-0")}
        >
          Salvar anotação
        </button>
      </div>
    </div>
  );
}
