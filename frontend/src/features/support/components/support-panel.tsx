import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Headphones, Loader2, Mail, Minus, Plus, Star } from "lucide-react";
import { realtimeClient } from "../../../lib/realtime";
import { cn } from "../../../lib/utils";
import { toast } from "../../../store/use-toast-store";
import { COMPANY } from "../../legal/legal-content";
import {
  SUPPORT_STATUS_LABELS,
  formatSupportTime,
  supportErrorMessage,
  supportRequest,
  useSupportPanel,
  type SupportConversation,
  type SupportMessage,
  type SupportPolicy,
} from "../support-api";
import { START_TOUR_EVENT } from "../../onboarding/components/product-tour";
import { SupportThread } from "./support-thread";
import { useFecharComEsc } from "../../../lib/use-fechar-com-esc";

interface SupportOverview {
  policy: SupportPolicy;
  conversations: SupportConversation[];
}

/** Quantas respostas da equipe a pessoa ainda não leu. */
export function useSupportUnread() {
  const { data } = useSupportOverview();
  return (data?.conversations || []).reduce((sum, item) => sum + (item.customerUnread || 0), 0);
}

function useSupportOverview() {
  return useQuery({
    queryKey: ["support"],
    queryFn: () => supportRequest().get<SupportOverview>("/api/support"),
    staleTime: 60 * 1000,
  });
}

/** Chat de suporte do cliente: janela no canto da tela. */
export function SupportPanel() {
  const isOpen = useSupportPanel((state) => state.isOpen);
  const conversationId = useSupportPanel((state) => state.conversationId);
  const open = useSupportPanel((state) => state.open);
  const close = useSupportPanel((state) => state.close);
  const setConversation = useSupportPanel((state) => state.setConversation);
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);

  const overview = useSupportOverview();

  // Link do e-mail: /?suporte=<id> abre a conversa.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("suporte");
    if (id === null) return;
    open(id || null);
    params.delete("suporte");
    const qs = params.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  }, [open]);

  useEffect(
    () =>
      realtimeClient.subscribe((event) => {
        if ((event as { type: string }).type !== "support.updated") return;
        const payload = (event as { payload?: { conversation?: SupportConversation } }).payload;
        void queryClient.invalidateQueries({ queryKey: ["support"] });
        if (payload?.conversation?.id) {
          void queryClient.invalidateQueries({ queryKey: ["support", payload.conversation.id] });
        }
      }),
    [queryClient],
  );

  if (!isOpen) return null;

  const policy = overview.data?.policy;
  const muted = "text-(--ui-texto-secundario)";
  const title = "text-(--ui-texto-principal)";

  const header = (label: string, onBack?: () => void) => (
    <div
      className={cn(
        "flex h-14 shrink-0 items-center gap-2 border-b px-3",
        "border-(--ui-borda-suave)",
      )}
    >
      {onBack ? (
        <button type="button" onClick={onBack} aria-label="Voltar" className="grid h-8 w-8 place-items-center rounded-lg cursor-pointer hover:bg-black/5">
          <ArrowLeft className="h-4 w-4" />
        </button>
      ) : (
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-blue-600/10 text-blue-600">
          <Headphones className="h-4 w-4" />
        </span>
      )}
      <p className={cn("min-w-0 flex-1 truncate text-sm font-bold", title)}>{label}</p>
      <button
        type="button"
        onClick={close}
        aria-label="Minimizar"
        title="Minimizar (a conversa continua aqui)"
        className="grid h-8 w-8 place-items-center rounded-lg cursor-pointer hover:bg-black/5"
      >
        <Minus className="h-4 w-4" />
      </button>
    </div>
  );

  let body: React.ReactNode;

  if (overview.isPending) {
    body = (
      <>
        {header("Suporte Pauta")}
        <div className="grid flex-1 place-items-center">
          <Loader2 className={cn("h-5 w-5 animate-spin", muted)} />
        </div>
      </>
    );
  } else if (!policy?.chat) {
    body = (
      <>
        {header("Suporte Pauta")}
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <Mail className="h-10 w-10 text-blue-600" />
          <p className={cn("text-sm font-bold", title)}>Fale com a gente por e-mail</p>
          <p className={cn("text-sm font-medium", muted)}>
            O chat de suporte está disponível a partir do plano Essencial. No plano {policy?.planName || "atual"}, o
            atendimento é por e-mail, em {policy?.businessHours || "dias úteis"}.
          </p>
          <a
            href={`mailto:${COMPANY.supportEmail}`}
            className="inline-flex h-10 items-center rounded-xl bg-blue-600 px-4 text-sm font-black text-white hover:bg-blue-700"
          >
            {COMPANY.supportEmail}
          </a>
          <button
            type="button"
            onClick={() => {
              close();
              window.dispatchEvent(new CustomEvent("pauta:open-billing-tab"));
            }}
            className="text-xs font-bold text-blue-600 hover:underline cursor-pointer"
          >
            Ver planos com chat
          </button>
        </div>
      </>
    );
  } else if (creating) {
    body = (
      <NewConversation
        header={header("Nova conversa", () => setCreating(false))}
        policy={policy}
        onCreated={(id) => {
          setCreating(false);
          setConversation(id);
        }}
      />
    );
  } else if (conversationId) {
    const summary = overview.data?.conversations.find((item) => item.id === conversationId);
    body = (
      <ConversationView
        id={conversationId}
        header={header(summary?.subject || "Conversa", () => setConversation(null))}
        policy={policy}
      />
    );
  } else {
    const conversations = overview.data?.conversations || [];
    body = (
      <>
        {header("Suporte Pauta")}
        <div className={cn("border-b px-4 py-3 text-xs font-medium", muted, "border-(--ui-borda-suave)")}>
          Plano {policy.planName}: resposta {policy.responseTime || "no menor prazo possível"}, em {policy.businessHours}.
        </div>
        <div className="pauta-scroll-safe min-h-0 flex-1 overflow-auto">
          {conversations.length === 0 ? (
            <p className={cn("p-6 text-center text-sm font-medium", muted)}>
              Nenhuma conversa ainda. Conte o que aconteceu e nossa equipe responde por aqui.
            </p>
          ) : (
            conversations.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setConversation(item.id)}
                className={cn(
                  "flex w-full items-start gap-3 border-b px-4 py-3 text-left transition-colors cursor-pointer",
                  "border-(--ui-borda-suave) hover:bg-(--ui-hover)",
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className={cn("truncate text-sm font-bold", title)}>{item.subject}</p>
                  <p className={cn("truncate text-xs font-medium", muted)}>{item.lastMessagePreview}</p>
                  <p className={cn("mt-0.5 text-[10px] font-bold", muted)}>
                    {SUPPORT_STATUS_LABELS[item.status]} · {formatSupportTime(item.lastMessageAt)}
                  </p>
                </div>
                {item.customerUnread > 0 && (
                  <span className="mt-1 grid h-5 min-w-5 place-items-center rounded-full bg-rose-600 px-1 text-[10px] font-black text-white">
                    {item.customerUnread}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
        <div className={cn("border-t p-3", "border-(--ui-borda-suave)")}>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 text-sm font-black text-white hover:bg-blue-700 cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            Nova conversa
          </button>
          <button
            type="button"
            onClick={() => {
              close();
              window.dispatchEvent(new CustomEvent(START_TOUR_EVENT));
            }}
            className={cn("mt-2 w-full text-center text-xs font-bold hover:underline cursor-pointer", muted)}
          >
            Ver o tour do Pauta de novo
          </button>
        </div>
      </>
    );
  }

  // Esc fecha a janela, como em qualquer aplicativo.

  useFecharComEsc(true, close);

  return createPortal(
    <div
      className={cn(
        "fixed inset-0 z-[70] flex flex-col overflow-hidden border shadow-2xl sm:inset-auto sm:bottom-4 sm:right-4 sm:h-[600px] sm:max-h-[calc(100dvh-2rem)] sm:w-[400px] sm:rounded-2xl",
        "border-(--ui-borda) bg-(--ui-superficie) text-(--ui-texto-principal)",
      )}
    >
      {body}
    </div>,
    document.body,
  );
}

function NewConversation({
  header,
  policy,
  onCreated,
}: {
  header: React.ReactNode;
  policy: SupportPolicy;
  onCreated: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  const input = cn(
    "rounded-xl border px-3 text-sm font-medium outline-none focus:border-blue-500",
    "border-(--ui-borda) bg-(--ui-superficie-suave) text-(--ui-texto-principal)",
  );
  const label = cn("text-[12px] font-bold", "text-(--ui-texto-secundario)");

  const submit = async () => {
    setSending(true);
    try {
      const result = await supportRequest().post<{ conversation: SupportConversation }>("/api/support", {
        subject,
        message,
      });
      await queryClient.invalidateQueries({ queryKey: ["support"] });
      onCreated(result.conversation.id);
    } catch (error) {
      toast.error(supportErrorMessage(error, "Não foi possível abrir a conversa."));
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      {header}
      <div className="pauta-scroll-safe flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4">
        <label className="flex flex-col gap-1">
          <span className={label}>Assunto</span>
          <input aria-label="Ex.: não consigo anexar arquivos"
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            maxLength={200}
            placeholder="Ex.: não consigo anexar arquivos"
            className={cn(input, "h-10")}
          />
        </label>
        <label className="flex flex-1 flex-col gap-1">
          <span className={label}>Mensagem</span>
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            maxLength={5000}
            placeholder="Conte o que aconteceu, onde (espaço de trabalho/projeto/card) e o que você esperava."
            className={cn(input, "min-h-40 flex-1 resize-none py-2")}
          />
        </label>
        <p className={label}>
          Resposta {policy.responseTime || "no menor prazo possível"}, em {policy.businessHours}. Avisamos por e-mail
          quando respondermos.
        </p>
        <p className={label}>
          Para pedir reembolso por arrependimento (até 7 dias do primeiro pagamento), use o assunto "Direito de
          arrependimento".
        </p>
      </div>
      <div className={cn("border-t p-3", "border-(--ui-borda-suave)")}>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={sending || subject.trim().length < 3 || !message.trim()}
          className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 text-sm font-black text-white hover:bg-blue-700 cursor-pointer disabled:opacity-50"
        >
          {sending && <Loader2 className="h-4 w-4 animate-spin" />}
          Enviar
        </button>
      </div>
    </>
  );
}

function SatisfactionSurvey({ conversationId }: { conversationId: string }) {
  const close = useSupportPanel((state) => state.close);
  const setConversation = useSupportPanel((state) => state.setConversation);
  const queryClient = useQueryClient();
  const [nota, setNota] = useState(0);
  const [comentario, setComentario] = useState("");
  const [enviando, setEnviando] = useState(false);

  const muted = "text-(--ui-texto-secundario)";
  const title = "text-(--ui-texto-principal)";

  const enviar = async () => {
    setEnviando(true);
    try {
      await supportRequest().post(`/api/support/${conversationId}/survey`, { rating: nota, comment: comentario });
      toast.success("Obrigado pela avaliação!");
      await queryClient.invalidateQueries({ queryKey: ["support"] });
      // Avaliou: a conversa encerra de vez e o chat fecha.
      setConversation(null);
      close();
    } catch (error) {
      toast.error(supportErrorMessage(error, "Não foi possível enviar a avaliação."));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className={cn("border-t p-4", "border-(--ui-borda-suave)")}>
      <p className={cn("text-sm font-bold", title)}>Como foi o atendimento?</p>
      <p className={cn("mt-0.5 text-xs font-medium", muted)}>
        A equipe encerrou esta conversa. Responder é opcional e leva alguns segundos.
      </p>

      <div className="mt-3 flex gap-1">
        {[1, 2, 3, 4, 5].map((valor) => (
          <button
            key={valor}
            type="button"
            onClick={() => setNota(valor)}
            aria-label={`Nota ${valor}`}
            className="cursor-pointer p-0.5"
          >
            <Star className={cn("h-6 w-6", valor <= nota ? "fill-amber-400 text-amber-400" : muted)} />
          </button>
        ))}
      </div>

      <textarea
        value={comentario}
        onChange={(event) => setComentario(event.target.value)}
        rows={2}
        placeholder="Quer contar mais? (opcional)"
        className={cn(
          "mt-3 w-full rounded-xl border px-3 py-2 text-sm font-medium outline-none focus:border-blue-500",
          "border-(--ui-borda) bg-(--ui-superficie-suave) text-(--ui-texto-principal)",
        )}
      />

      <div className="mt-3 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => {
            setConversation(null);
            close();
          }}
          className={cn("text-xs font-bold hover:underline cursor-pointer", muted)}
        >
          Agora não
        </button>
        <button
          type="button"
          onClick={() => void enviar()}
          disabled={!nota || enviando}
          className="inline-flex h-9 items-center gap-2 rounded-xl bg-blue-600 px-4 text-xs font-black text-white hover:bg-blue-700 cursor-pointer disabled:opacity-50"
        >
          {enviando && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Enviar avaliação
        </button>
      </div>
    </div>
  );
}

function ConversationView({ id, header, policy }: { id: string; header: React.ReactNode; policy: SupportPolicy }) {
  const queryClient = useQueryClient();

  const { data, isPending, isError } = useQuery({
    queryKey: ["support", id],
    queryFn: () =>
      supportRequest().get<{ conversation: SupportConversation; messages: SupportMessage[] }>(`/api/support/${id}`),
  });

  // Abrir a conversa zera o contador de não lidas.
  useEffect(() => {
    if (data) void queryClient.invalidateQueries({ queryKey: ["support"], exact: true });
  }, [data, queryClient]);

  const send = async (body: string) => {
    try {
      await supportRequest().post(`/api/support/${id}/messages`, { body });
      await queryClient.invalidateQueries({ queryKey: ["support"] });
      return true;
    } catch (error) {
      toast.error(supportErrorMessage(error, "Não foi possível enviar."));
      return false;
    }
  };


  const muted = "text-(--ui-texto-secundario)";

  return (
    <>
      {header}
      {isPending ? (
        <div className="grid flex-1 place-items-center">
          <Loader2 className={cn("h-5 w-5 animate-spin", muted)} />
        </div>
      ) : isError || !data ? (
        <p className="p-6 text-sm font-bold text-rose-600">Não foi possível abrir a conversa.</p>
      ) : (
        <>
          <div
            className={cn(
              "flex items-center justify-between gap-2 border-b px-4 py-2 text-[11px] font-bold",
              muted,
              "border-(--ui-borda-suave)",
            )}
          >
            <span>
              {SUPPORT_STATUS_LABELS[data.conversation.status]}
              {data.conversation.status === "aberta" && policy.responseTime ? ` · resposta ${policy.responseTime}` : ""}
            </span>
          </div>

          <SupportThread
            messages={data.messages}
            viewer="customer"
            onSend={data.conversation.status === "resolvida" ? undefined : send}
          />

          {data.conversation.status === "resolvida" &&
            (data.conversation.surveyAnswered ? (
              <div className={cn("border-t px-4 py-3 text-xs font-bold", muted, "border-(--ui-borda-suave)")}>
                Conversa encerrada pela equipe. Obrigado pela avaliação! Precisa de mais alguma coisa? Abra uma conversa
                nova.
              </div>
            ) : (
              <SatisfactionSurvey conversationId={id} />
            ))}
        </>
      )}
    </>
  );
}
