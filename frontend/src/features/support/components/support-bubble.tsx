import { Headphones } from "lucide-react";
import { cn } from "../../../lib/utils";
import { useSupportPanel } from "../support-api";
import { useSupportUnread } from "./support-panel";

/**
 * Bolinha do suporte no canto da tela. Fica em qualquer tela do app e guarda
 * a conversa aberta: minimizar não perde o que estava sendo conversado.
 */
export function SupportBubble() {
  const isOpen = useSupportPanel((state) => state.isOpen);
  const open = useSupportPanel((state) => state.open);
  const conversationId = useSupportPanel((state) => state.conversationId);
  const naoLidas = useSupportUnread();

  if (isOpen) return null;

  return (
    <button
      type="button"
      onClick={() => open(conversationId)}
      aria-label={naoLidas > 0 ? `Suporte: ${naoLidas} resposta(s) nova(s)` : "Abrir o suporte"}
      className={cn(
        "pauta-safe-bottom fixed bottom-4 right-4 z-[60] grid h-13 w-13 place-items-center rounded-full shadow-xl transition-transform hover:-translate-y-0.5 cursor-pointer",
        "bg-blue-600 text-white",
      )}
      title="Suporte do Pauta"
    >
      <Headphones className="h-5 w-5" />
      {naoLidas > 0 && (
        <span className="absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-rose-600 px-1 text-[10px] font-black text-white ring-2 ring-white">
          {naoLidas}
        </span>
      )}
    </button>
  );
}
