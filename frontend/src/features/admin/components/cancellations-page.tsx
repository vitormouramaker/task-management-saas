import { useQuery } from "@tanstack/react-query";
import { cn } from "../../../lib/utils";
import { AdminPageHeader, PLAN_LABELS, formatDate, useAdminApi, useAdminStyles , AdminListaCarregando} from "../admin-shared";

const REASON_LABELS: Record<string, string> = {
  caro: "Ficou caro",
  pouco_uso: "Equipe usou pouco",
  falta_recurso: "Faltou um recurso",
  outra_ferramenta: "Foi para outra ferramenta",
  problemas_tecnicos: "Problemas técnicos",
  era_teste: "Era só um teste",
  outro: "Outro motivo",
};

const OFFER_LABELS: Record<string, string> = {
  desconto: "desconto",
  mes_gratis: "mês grátis",
  plano_menor: "plano menor",
  falar_com_equipe: "conversa com a equipe",
  suporte_prioritario: "suporte prioritário",
};

interface CancellationAnswer {
  id: string;
  reason: string;
  offerType: string | null;
  outcome: string;
  comment: string | null;
  plan: string | null;
  createdAt: string;
  organizationName: string | null;
  memberName: string | null;
}

/** Por que as contas cancelaram, respondido na hora do cancelamento. */
export function CancellationsPage() {
  const api = useAdminApi();
  const styles = useAdminStyles();

  const { data, isPending } = useQuery({
    queryKey: ["admin", "cancellations"],
    queryFn: () =>
      api.get<{
        answers: CancellationAnswer[];
        byReason: Array<{ reason: string; total: number; retidos: number }>;
      }>("/cancellations"),
  });

  const total = (data?.byReason || []).reduce((soma, item) => soma + item.total, 0);

  return (
    <>
      <AdminPageHeader
        title="Cancelamentos"
        description="Motivos informados na tela de cancelamento, com o que aconteceu depois da proposta de retenção."
      />

      {isPending ? (
        <AdminListaCarregando />
      ) : total === 0 ? (
        <div className={cn(styles.card, "p-6")}>
          <p className={cn("text-sm font-bold", styles.title)}>Nenhuma resposta ainda.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className={cn(styles.card, "p-5")}>
            <h3 className={cn("mb-3 text-sm font-black", styles.title)}>Motivos ({total} resposta(s))</h3>
            <div className="space-y-2">
              {data?.byReason.map((item) => (
                <div key={item.reason} className="flex items-center gap-2">
                  <span className={cn("w-28 shrink-0 text-xs font-bold sm:w-48", styles.title)}>
                    {REASON_LABELS[item.reason] || item.reason}
                    {item.retidos > 0 && (
                      <span className="ml-1 font-black text-emerald-600">{item.retidos} ficou(aram)</span>
                    )}
                  </span>
                  <div className={cn("h-2 flex-1 overflow-hidden rounded-full", "bg-(--ui-fundo-neutro)")}>
                    <div className="h-full rounded-full bg-blue-500" style={{ width: `${(item.total / total) * 100}%` }} />
                  </div>
                  <span className={cn("w-8 text-right text-xs font-black", styles.title)}>{item.total}</span>
                </div>
              ))}
            </div>
          </div>

          <div className={cn(styles.card, "divide-y", "divide-(--ui-borda-suave)")}>
            {data?.answers.map((resposta) => (
              <div key={resposta.id} className="p-4">
                <p className={cn("text-sm font-bold", styles.title)}>
                  {REASON_LABELS[resposta.reason] || resposta.reason}
                  <span
                    className={cn(
                      "ml-2 rounded-full px-2 py-0.5 text-[10px] font-black",
                      resposta.outcome === "aceitou_oferta"
                        ? "bg-emerald-500/10 text-emerald-600"
                        : "bg-rose-500/10 text-rose-600",
                    )}
                  >
                    {resposta.outcome === "aceitou_oferta"
                      ? `ficou — aceitou ${OFFER_LABELS[resposta.offerType || ""] || "a proposta"}`
                      : "cancelou"}
                  </span>
                </p>
                <p className={cn("text-xs font-bold", styles.muted)}>
                  {resposta.organizationName || "conta removida"} · {resposta.memberName || "—"} ·{" "}
                  {PLAN_LABELS[resposta.plan || ""] || resposta.plan || "—"} · {formatDate(resposta.createdAt, true)}
                </p>
                {resposta.comment && (
                  <p className={cn("mt-2 whitespace-pre-line text-sm font-medium", styles.title)}>{resposta.comment}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
