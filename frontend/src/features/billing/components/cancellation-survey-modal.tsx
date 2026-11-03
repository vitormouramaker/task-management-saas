import { useState } from "react";
import { createPortal } from "react-dom";
import axios from "axios";
import { Loader2, X } from "lucide-react";
import { buildApiUrl } from "../../../lib/api";
import { cn } from "../../../lib/utils";
import { useAuthStore } from "../../../store/use-auth-store";
import { toast } from "../../../store/use-toast-store";
import { useFecharComEsc } from "../../../lib/use-fechar-com-esc";

const MOTIVOS = [
  { id: "caro", label: "Ficou caro para o momento" },
  { id: "pouco_uso", label: "A equipe não usou o suficiente" },
  { id: "falta_recurso", label: "Faltou um recurso de que eu precisava" },
  { id: "outra_ferramenta", label: "Mudamos para outra ferramenta" },
  { id: "problemas_tecnicos", label: "Tive problemas técnicos" },
  { id: "era_teste", label: "Era só um teste" },
  { id: "outro", label: "Outro motivo" },
];

/** Pergunta o motivo logo depois do cancelamento. Responder é opcional. */
export function CancellationSurveyModal({ onClose }: { onClose: () => void }) {
  const token = useAuthStore((state) => state.token);
  const [motivo, setMotivo] = useState("");
  const [comentario, setComentario] = useState("");
  const [enviando, setEnviando] = useState(false);

  const enviar = async () => {
    setEnviando(true);
    try {
      const resposta = await axios.post(
        buildApiUrl("/api/billing/cancellation-survey"),
        { reason: motivo, comment: comentario },
        { headers: { Authorization: `Bearer ${token}` } },
      );
      toast.success(resposta.data?.message || "Obrigado pela resposta.");
      onClose();
    } catch (error) {
      toast.error(
        axios.isAxiosError(error)
          ? (error.response?.data as { message?: string })?.message || "Não foi possível enviar."
          : "Não foi possível enviar.",
      );
    } finally {
      setEnviando(false);
    }
  };

  const muted = "text-(--ui-texto-secundario)";
  const titulo = "text-(--ui-texto-principal)";

  // Esc fecha a janela, como em qualquer aplicativo.

  useFecharComEsc(true, onClose);

  return createPortal(
    <div className="fixed inset-0 z-[85] grid place-items-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Por que você cancelou?">
      <div
        className={cn(
          "w-full max-w-md rounded-2xl border p-6 shadow-2xl",
          "border-(--ui-borda) bg-(--ui-superficie)",
        )}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className={cn("text-lg font-black", titulo)}>O que pesou na decisão?</h2>
            <p className={cn("mt-1 text-sm font-medium", muted)}>
              Sua assinatura já foi cancelada e o acesso continua até o fim do período pago. Responder leva 10 segundos
              e ajuda a melhorar o Pauta.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" className="cursor-pointer opacity-60 hover:opacity-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-1.5">
          {MOTIVOS.map((item) => (
            <label
              key={item.id}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm font-bold transition-colors",
                motivo === item.id
                  ? "border-blue-500 bg-blue-500/10 text-blue-600"
                  : "border-(--ui-borda) text-(--ui-texto-secundario) hover:bg-(--ui-hover)",
              )}
            >
              <input
                type="radio"
                name="motivo-cancelamento"
                checked={motivo === item.id}
                onChange={() => setMotivo(item.id)}
                className="h-4 w-4 accent-blue-600"
              />
              {item.label}
            </label>
          ))}
        </div>

        <textarea
          value={comentario}
          onChange={(event) => setComentario(event.target.value)}
          rows={3}
          placeholder="Quer contar mais? (opcional)"
          className={cn(
            "mt-3 w-full rounded-xl border px-3 py-2 text-sm font-medium outline-none focus:border-blue-500",
            "border-(--ui-borda) bg-(--ui-superficie-suave) text-(--ui-texto-principal)",
          )}
        />

        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className={cn(
              "h-10 rounded-xl border px-4 text-sm font-bold cursor-pointer",
              "border-(--ui-borda) text-(--ui-texto-secundario)",
            )}
          >
            Agora não
          </button>
          <button
            type="button"
            onClick={() => void enviar()}
            disabled={!motivo || enviando}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 text-sm font-black text-white hover:bg-blue-700 cursor-pointer disabled:opacity-60"
          >
            {enviando && <Loader2 className="h-4 w-4 animate-spin" />}
            Enviar resposta
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
