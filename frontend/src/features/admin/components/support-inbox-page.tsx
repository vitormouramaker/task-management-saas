import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, RotateCcw, Search } from "lucide-react";
import { realtimeClient } from "../../../lib/realtime";
import { cn } from "../../../lib/utils";
import { toast } from "../../../store/use-toast-store";
import {
  SUPPORT_STATUS_LABELS,
  formatSupportTime,
  supportErrorMessage,
  supportRequest,
  type SupportConversation,
  type SupportMessage,
  type SupportPolicy,
  type SupportStatus,
} from "../../support/support-api";
import { SupportThread } from "../../support/components/support-thread";
import {
  AdminListaCarregando,
  AdminPageHeader,
  PLAN_LABELS,
  useAdminStyles,
  type AdminNavigate,
} from "../admin-shared";

const PRIORITY_LABELS: Record<number, string> = {
  0: "Sem prioridade",
  1: "Essencial",
  2: "Profissional",
  3: "Empresarial",
  4: "Enterprise",
};

function waitingLabel(since: string | null) {
  if (!since) return null;
  const minutes = Math.max(0, Math.round((Date.now() - new Date(since).getTime()) / 60000));
  if (minutes < 60) return `esperando há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `esperando há ${hours} h`;
  return `esperando há ${Math.round(hours / 24)} dias`;
}

/** Caixa de entrada do chat de suporte (equipe do Pauta). */
export function SupportInboxPage({
  conversationId,
  navigate,
}: {
  conversationId?: string;
  navigate: AdminNavigate;
}) {
  const styles = useAdminStyles();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<SupportStatus | "">("aberta");
  const [search, setSearch] = useState("");

  const list = useQuery({
    queryKey: ["admin", "support", status, search],
    queryFn: () =>
      supportRequest().get<{ conversations: SupportConversation[]; counts: Record<string, number> }>(
        "/api/admin/support",
        { status, search },
      ),
  });

  useEffect(
    () =>
      realtimeClient.subscribe((event) => {
        if ((event as { type: string }).type !== "support.updated") return;
        void queryClient.invalidateQueries({ queryKey: ["admin", "support"] });
      }),
    [queryClient],
  );

  const lista = (
    <div className={cn(styles.card, "flex min-h-0 flex-col overflow-hidden")}>
      <div className={cn("space-y-3 border-b p-3", "border-(--ui-borda-suave)")}>
        <div className="flex flex-wrap gap-1.5">
          {([["aberta", "Aguardando"], ["respondida", "Respondidas"], ["resolvida", "Resolvidas"], ["", "Todas"]] as const).map(
            ([value, label]) => (
              <button
                key={value || "todas"}
                type="button"
                onClick={() => setStatus(value)}
                className={cn(
                  "h-8 rounded-full px-3 text-xs font-bold transition-colors cursor-pointer",
                  status === value
                    ? "bg-blue-600 text-white"
                    : "bg-(--ui-fundo-neutro) text-(--ui-texto-secundario) hover:bg-(--ui-hover-forte)",
                )}
              >
                {label}
                {value && list.data?.counts?.[value] ? ` (${list.data.counts[value]})` : ""}
              </button>
            ),
          )}
        </div>
        <div className="relative">
          <Search className={cn("absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2", styles.muted)} />
          <input aria-label="Assunto, conta ou e-mail"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Assunto, conta ou e-mail"
            className={cn(styles.input, "h-9 w-full pl-9")}
          />
        </div>
      </div>
      <div className="pauta-scroll-safe min-h-0 flex-1 overflow-auto">
        {list.isPending ? (
          <AdminListaCarregando />
        ) : (list.data?.conversations || []).length === 0 ? (
          <p className={cn("p-4 text-sm font-medium", styles.muted)}>Nenhuma conversa.</p>
        ) : (
          list.data?.conversations.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => navigate(`/admin/suporte/${item.id}`)}
              className={cn(
                "flex w-full flex-col gap-0.5 border-b px-4 py-3 text-left transition-colors cursor-pointer",
                "border-(--ui-borda-suave) hover:bg-(--ui-hover)",
                item.id === conversationId && ("bg-(--ui-azul-fundo)"),
              )}
            >
              <div className="flex items-center gap-2">
                <p className={cn("min-w-0 flex-1 truncate text-sm font-bold", styles.title)}>{item.subject}</p>
                {item.teamUnread > 0 && (
                  <span className="grid h-5 min-w-5 place-items-center rounded-full bg-rose-600 px-1 text-[10px] font-black text-white">
                    {item.teamUnread}
                  </span>
                )}
              </div>
              <p className={cn("truncate text-xs font-medium", styles.muted)}>
                {item.organizationName} · {item.memberName}
              </p>
              <p className={cn("text-[10px] font-bold", styles.muted)}>
                <span className="rounded-full bg-blue-600/10 px-1.5 py-0.5 text-blue-600">
                  {PLAN_LABELS[item.planId || ""] || PRIORITY_LABELS[item.priority] || "—"}
                </span>{" "}
                {item.status === "aberta" ? (
                  <span className="text-amber-600">{waitingLabel(item.waitingSince)}</span>
                ) : (
                  `${SUPPORT_STATUS_LABELS[item.status]} · ${formatSupportTime(item.lastMessageAt)}`
                )}
              </p>
            </button>
          ))
        )}
      </div>
    </div>
  );

  return (
    <>
      <AdminPageHeader
        title="Suporte"
        description="Conversas do chat de suporte, as que aguardam equipe primeiro. Encerrar fecha a conversa para o cliente e abre a pesquisa de satisfação."
      />
      <div className="grid h-[calc(100dvh-13rem)] min-h-[480px] grid-cols-1 gap-4 lg:grid-cols-[360px_1fr]">
        <div className={cn("min-h-0", conversationId ? "hidden lg:flex lg:flex-col" : "flex flex-col")}>{lista}</div>
        <div className={cn("min-h-0", conversationId ? "flex flex-col" : "hidden lg:flex lg:flex-col")}>
          {conversationId ? (
            <TeamConversation id={conversationId} navigate={navigate} />
          ) : (
            <div className={cn(styles.card, "grid flex-1 place-items-center p-6 text-center text-sm font-medium", styles.muted)}>
              Escolha uma conversa.
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function TeamConversation({ id, navigate }: { id: string; navigate: AdminNavigate }) {
  const styles = useAdminStyles();
  const queryClient = useQueryClient();

  const { data, isPending, isError } = useQuery({
    queryKey: ["admin", "support", "conversation", id],
    queryFn: () =>
      supportRequest().get<{ conversation: SupportConversation; policy: SupportPolicy | null; messages: SupportMessage[] }>(
        `/api/admin/support/${id}`,
      ),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin", "support"] });

  const send = async (body: string) => {
    try {
      await supportRequest().post(`/api/admin/support/${id}/messages`, { body });
      await refresh();
      return true;
    } catch (error) {
      toast.error(supportErrorMessage(error, "Não foi possível enviar."));
      return false;
    }
  };

  const changeStatus = async (status: SupportStatus) => {
    try {
      await supportRequest().patch(`/api/admin/support/${id}`, { status });
      await refresh();
    } catch (error) {
      toast.error(supportErrorMessage(error, "Não foi possível atualizar."));
    }
  };

  if (isPending) {
    return <div className={cn(styles.card, "flex-1 p-6 text-sm font-bold", styles.muted)}>Carregando…</div>;
  }
  if (isError || !data) {
    return <div className={cn(styles.card, "flex-1 p-6 text-sm font-bold text-rose-600")}>Conversa não encontrada.</div>;
  }

  const { conversation, policy } = data;

  return (
    <div className={cn(styles.card, "flex min-h-0 flex-1 flex-col overflow-hidden")}>
      <div className={cn("flex flex-wrap items-start gap-3 border-b p-4", "border-(--ui-borda-suave)")}>
        <button type="button" onClick={() => navigate("/admin/suporte")} className={cn(styles.outline, "lg:hidden")}>
          <ArrowLeft className="h-3.5 w-3.5" />
        </button>
        <div className="min-w-0 flex-1">
          <p className={cn("truncate text-base font-bold", styles.title)}>{conversation.subject}</p>
          <p className={cn("text-xs font-medium", styles.muted)}>
            {conversation.memberName} · {conversation.memberEmail} ·{" "}
            {conversation.organizationId ? (
              <button
                type="button"
                onClick={() => navigate(`/admin/contas/${encodeURIComponent(conversation.organizationId!)}`)}
                className="font-bold text-blue-600 hover:underline cursor-pointer"
              >
                {conversation.organizationName}
              </button>
            ) : (
              conversation.organizationName
            )}
          </p>
          <p className={cn("text-xs font-bold", styles.muted)}>
            Plano {policy?.planName || "—"} · meta de resposta: {policy?.responseTime || "—"} ·{" "}
            {SUPPORT_STATUS_LABELS[conversation.status]}
            {conversation.status === "aberta" && conversation.waitingSince ? ` · ${waitingLabel(conversation.waitingSince)}` : ""}
          </p>
        </div>
        {conversation.status === "resolvida" ? (
          <button type="button" onClick={() => void changeStatus("aberta")} className={styles.outline}>
            <RotateCcw className="h-3.5 w-3.5" />
            Reabrir
          </button>
        ) : (
          <button type="button" onClick={() => void changeStatus("resolvida")} className={cn(styles.outline, "text-emerald-600")}>
            <CheckCircle2 className="h-3.5 w-3.5" />
            Encerrar atendimento
          </button>
        )}
      </div>
      <SupportThread
        messages={data.messages}
        viewer="team"
        onSend={send}
        placeholder="Responder como Equipe Pauta (a pessoa recebe aviso por e-mail)"
      />
    </div>
  );
}
