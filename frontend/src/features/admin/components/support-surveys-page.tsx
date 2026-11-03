import { useQuery } from "@tanstack/react-query";
import { Star } from "lucide-react";
import { cn } from "../../../lib/utils";
import { AdminPageHeader, formatDate, useAdminApi, useAdminStyles, type AdminNavigate , AdminListaCarregando} from "../admin-shared";

interface SupportSurvey {
  conversationId: string;
  rating: number;
  comment: string | null;
  createdAt: string;
  subject: string;
  organizationName: string | null;
  memberName: string | null;
  teamMemberName: string | null;
}

/** Pesquisas de satisfação respondidas pelos clientes ao fim do atendimento. */
export function SupportSurveysPage({ navigate }: { navigate: AdminNavigate }) {
  const api = useAdminApi();
  const styles = useAdminStyles();

  const { data, isPending } = useQuery({
    queryKey: ["admin", "support", "surveys"],
    queryFn: () =>
      api.get<{ surveys: SupportSurvey[]; average: number | null; total: number }>("/support/avaliacoes"),
  });

  const estrelas = (nota: number) => (
    <span className="inline-flex">
      {[1, 2, 3, 4, 5].map((valor) => (
        <Star key={valor} className={cn("h-4 w-4", valor <= nota ? "fill-amber-400 text-amber-400" : styles.muted)} />
      ))}
    </span>
  );

  const distribuicao = [5, 4, 3, 2, 1].map((nota) => ({
    nota,
    total: (data?.surveys || []).filter((item) => item.rating === nota).length,
  }));

  return (
    <>
      <AdminPageHeader
        title="Satisfação do suporte"
        description="Respostas da pesquisa que aparece quando a equipe encerra uma conversa."
      />

      {isPending ? (
        <AdminListaCarregando />
      ) : (data?.total ?? 0) === 0 ? (
        <div className={cn(styles.card, "p-6")}>
          <p className={cn("text-sm font-bold", styles.title)}>Nenhuma avaliação ainda.</p>
          <p className={cn("mt-1 text-sm font-medium", styles.muted)}>
            Encerre uma conversa em Suporte e o cliente verá a pesquisa.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className={cn(styles.card, "p-5 text-center")}>
              <p className={cn("text-4xl font-bold", styles.title)}>{data?.average?.toFixed(2).replace(".", ",")}</p>
              <div className="mt-1 flex justify-center">{estrelas(Math.round(data?.average || 0))}</div>
              <p className={cn("mt-1 text-xs font-bold", styles.muted)}>{data?.total} avaliação(ões)</p>
            </div>

            <div className={cn(styles.card, "p-5 lg:col-span-2")}>
              <h3 className={cn("mb-3 text-sm font-black", styles.title)}>Notas</h3>
              <div className="space-y-1.5">
                {distribuicao.map((linha) => (
                  <div key={linha.nota} className="flex items-center gap-2">
                    <span className={cn("w-4 text-xs font-black", styles.title)}>{linha.nota}</span>
                    <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                    <div className={cn("h-2 flex-1 overflow-hidden rounded-full", "bg-(--ui-fundo-neutro)")}>
                      <div
                        className="h-full rounded-full bg-amber-400"
                        style={{ width: `${((linha.total / Math.max(1, data?.surveys.length || 1)) * 100).toFixed(0)}%` }}
                      />
                    </div>
                    <span className={cn("w-8 text-right text-xs font-bold", styles.muted)}>{linha.total}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className={cn(styles.card, "divide-y", "divide-(--ui-borda-suave)")}>
            {data?.surveys.map((avaliacao) => (
              <div key={avaliacao.conversationId} className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => navigate(`/admin/suporte/${encodeURIComponent(avaliacao.conversationId)}`)}
                    className={cn("text-sm font-bold text-blue-600 hover:underline cursor-pointer")}
                  >
                    {avaliacao.subject}
                  </button>
                  {estrelas(avaliacao.rating)}
                </div>
                <p className={cn("text-xs font-bold", styles.muted)}>
                  {avaliacao.organizationName} · {avaliacao.memberName} · atendido por{" "}
                  {avaliacao.teamMemberName || "equipe"} · {formatDate(avaliacao.createdAt, true)}
                </p>
                {avaliacao.comment && (
                  <p className={cn("mt-2 whitespace-pre-line text-sm font-medium", styles.title)}>{avaliacao.comment}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
