import { useEffect, useRef, useState } from "react";
import { Loader2, SendHorizontal } from "lucide-react";
import { cn } from "../../../lib/utils";
import { formatSupportTime, type SupportMessage } from "../support-api";

interface SupportThreadProps {
  messages: SupportMessage[];
  /** De que lado quem está vendo a conversa fica (as próprias mensagens à direita). */
  viewer: "customer" | "team";
  onSend?: (body: string) => Promise<boolean>;
  disabledReason?: string | null;
  placeholder?: string;
}

/** Mensagens da conversa + campo de resposta. Usado pelo cliente e pela equipe. */
export function SupportThread({ messages, viewer, onSend, disabledReason, placeholder }: SupportThreadProps) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  const send = async () => {
    const body = draft.trim();
    if (!body || !onSend) return;
    setSending(true);
    const ok = await onSend(body);
    setSending(false);
    if (ok) setDraft("");
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="pauta-scroll-safe min-h-0 flex-1 space-y-3 overflow-auto px-4 py-4">
        {messages.map((message) => {
          const mine = message.authorType === viewer;
          return (
            <div key={message.id} className={cn("flex flex-col", mine ? "items-end" : "items-start")}>
              <div
                className={cn(
                  "max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-sm font-medium",
                  mine
                    ? "rounded-br-md bg-blue-600 text-white"
                    : "rounded-bl-md bg-(--ui-fundo-neutro) text-(--ui-texto-principal)",
                )}
              >
                {message.body}
              </div>
              <span className={cn("mt-1 text-[10px] font-bold", "text-(--ui-texto-secundario)")}>
                {viewer === "team" && message.authorType === "team" && message.teamMemberName
                  ? `${message.teamMemberName} · `
                  : !mine
                    ? `${message.authorName || ""} · `
                    : ""}
                {formatSupportTime(message.createdAt)}
              </span>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      {onSend && (
        <div className={cn("border-t p-3", "border-(--ui-borda-suave)")}>
          {disabledReason ? (
            <p className={cn("text-xs font-bold", "text-(--ui-texto-secundario)")}>
              {disabledReason}
            </p>
          ) : (
            <div className="flex items-end gap-2">
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void send();
                  }
                }}
                rows={2}
                maxLength={5000}
                placeholder={placeholder || "Escreva sua mensagem (Enter envia, Shift+Enter quebra linha)"}
                className={cn(
                  "min-h-11 flex-1 resize-none rounded-xl border px-3 py-2 text-sm font-medium outline-none focus:border-blue-500",
                  "border-(--ui-borda) bg-(--ui-superficie-suave) text-(--ui-texto-principal)",
                )}
              />
              <button
                type="button"
                onClick={() => void send()}
                disabled={sending || !draft.trim()}
                aria-label="Enviar"
                className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-blue-600 text-white transition-colors hover:bg-blue-700 cursor-pointer disabled:opacity-50"
              >
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizontal className="h-4 w-4" />}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
