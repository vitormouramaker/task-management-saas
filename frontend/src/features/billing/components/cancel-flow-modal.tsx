import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import axios from "axios";
import { ArrowLeft, CheckCircle2, Gift, Loader2, X } from "lucide-react";
import { buildApiUrl } from "../../../lib/api";
import { cn } from "../../../lib/utils";
import { useAuthStore } from "../../../store/use-auth-store";
import { toast } from "../../../store/use-toast-store";
import { formatBrl } from "./plan-catalog";
import { useFecharComEsc } from "../../../lib/use-fechar-com-esc";

interface Offer {
  type: "desconto" | "mes_gratis" | "plano_menor" | "falar_com_equipe" | "suporte_prioritario" | "sem_proposta";
  alreadyUsed?: boolean;
  title: string;
  description: string;
  cta: string;
  percent?: number;
  months?: number;
  targetPlanName?: string;
  targetPriceCents?: number;
  interval?: "monthly" | "yearly";
}

interface ReasonOption {
  id: string;
  label: string;
  offer: Offer;
}

interface CancelFlowModalProps {
  onClose: () => void;
  /** Chamado quando a assinatura foi realmente cancelada ou a proposta aceita. */
  onFinished: () => void | Promise<void>;
}

/**
 * Cancelamento dentro do Pauta, em três passos: motivo, proposta para aquele
 * motivo e confirmação. Cancelar só acontece no fim.
 */
export function CancelFlowModal({ onClose, onFinished }: CancelFlowModalProps) {
  const token = useAuthStore((state) => state.token);
  const headers = { Authorization: `Bearer ${token}` };

  const [passo, setPasso] = useState<"motivo" | "proposta" | "confirmar" | "aceita">("motivo");
  const [opcoes, setOpcoes] = useState<ReasonOption[]>([]);
  const [motivo, setMotivo] = useState("");
  const [comentario, setComentario] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const [mensagemFinal, setMensagemFinal] = useState("");

  useEffect(() => {
    axios
      .get(buildApiUrl("/api/billing/retention/offers"), { headers })
      .then((resposta) => setOpcoes(resposta.data?.reasons || []))
      .catch(() => toast.error("Não foi possível carregar as opções de cancelamento."))
      .finally(() => setCarregando(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const escolhida = opcoes.find((item) => item.id === motivo);
  const oferta = escolhida?.offer;
  const precisaEscrever = oferta?.type === "falar_com_equipe" || oferta?.type === "suporte_prioritario";

  const muted = "text-(--ui-texto-secundario)";
  const titulo = "text-(--ui-texto-principal)";
  const borda = "border-(--ui-borda)";

  const aceitarProposta = async () => {
    setOcupado(true);
    try {
      const resposta = await axios.post(
        buildApiUrl("/api/billing/retention/accept"),
        { reason: motivo, comment: comentario },
        { headers },
      );
      setMensagemFinal(resposta.data?.message || "Pronto!");
      setPasso("aceita");
      await onFinished();
    } catch (error) {
      toast.error(mensagemDoErro(error, "Não foi possível aplicar a proposta."));
    } finally {
      setOcupado(false);
    }
  };

  const cancelarDeVez = async () => {
    setOcupado(true);
    try {
      const resposta = await axios.post(
        buildApiUrl("/api/billing/subscription/cancel"),
        { reason: motivo, comment: comentario, offerType: oferta?.type },
        { headers },
      );
      toast.success(resposta.data?.message || "Assinatura cancelada.");
      await onFinished();
      onClose();
    } catch (error) {
      toast.error(mensagemDoErro(error, "Não foi possível cancelar a assinatura."));
    } finally {
      setOcupado(false);
    }
  };

  const botaoPrimario =
    "inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 text-sm font-black text-white transition-colors hover:bg-blue-700 cursor-pointer disabled:opacity-60";
  const botaoSecundario = cn(
    "inline-flex h-10 items-center justify-center rounded-xl border px-4 text-sm font-bold transition-colors cursor-pointer disabled:opacity-60",
    "border-(--ui-borda) text-(--ui-texto-secundario) hover:bg-(--ui-hover)",
  );

  // Esc fecha a janela, como em qualquer aplicativo.

  useFecharComEsc(true, onClose);

  return createPortal(
    <div className="fixed inset-0 z-[85] grid place-items-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Cancelar assinatura">
      <div
        className={cn(
          "max-h-[92vh] w-full max-w-lg overflow-auto rounded-2xl border p-6 shadow-2xl",
          borda,
          "bg-(--ui-superficie)",
        )}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            {passo === "proposta" && (
              <button type="button" onClick={() => setPasso("motivo")} aria-label="Voltar" className="cursor-pointer">
                <ArrowLeft className={cn("h-4 w-4", muted)} />
              </button>
            )}
            {passo === "confirmar" && (
              <button type="button" onClick={() => setPasso("proposta")} aria-label="Voltar" className="cursor-pointer">
                <ArrowLeft className={cn("h-4 w-4", muted)} />
              </button>
            )}
            <h2 className={cn("text-lg font-black", titulo)}>
              {passo === "motivo" && "Antes de cancelar, o que aconteceu?"}
              {passo === "proposta" && "Temos uma proposta"}
              {passo === "confirmar" && "Confirmar cancelamento"}
              {passo === "aceita" && "Tudo certo!"}
            </h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" className="cursor-pointer opacity-60 hover:opacity-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        {passo === "motivo" && (
          <>
            <p className={cn("mb-3 text-sm font-medium", muted)}>
              Escolha o motivo mais próximo. Em cada caso temos uma alternativa ao cancelamento.
            </p>

            {carregando ? (
              <p className={cn("text-sm font-bold", muted)}>Carregando…</p>
            ) : (
              <div className="space-y-1.5">
                {opcoes.map((opcao) => (
                  <label
                    key={opcao.id}
                    className={cn(
                      "flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm font-bold transition-colors",
                      motivo === opcao.id
                        ? "border-blue-500 bg-blue-500/10 text-blue-600"
                        : cn(borda, "text-(--ui-texto-secundario) hover:bg-(--ui-hover)"),
                    )}
                  >
                    <input
                      type="radio"
                      name="motivo-cancelamento"
                      checked={motivo === opcao.id}
                      onChange={() => setMotivo(opcao.id)}
                      className="h-4 w-4 accent-blue-600"
                    />
                    {opcao.label}
                  </label>
                ))}
              </div>
            )}

            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={onClose} className={botaoSecundario}>
                Voltar
              </button>
              <button type="button" onClick={() => setPasso("proposta")} disabled={!motivo} className={botaoPrimario}>
                Prosseguir
              </button>
            </div>
          </>
        )}

        {passo === "proposta" && oferta && (
          <>
            <div className={cn("rounded-2xl border p-4", borda, "bg-(--ui-azul-fundo)")}>
              <div className="flex items-start gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-blue-600/10 text-blue-600">
                  <Gift className="h-5 w-5" />
                </span>
                <div>
                  <p className={cn("text-base font-bold", titulo)}>{oferta.title}</p>
                  <p className={cn("mt-1 text-sm font-medium", muted)}>{oferta.description}</p>
                  {oferta.type === "plano_menor" && oferta.targetPlanName && (
                    <p className={cn("mt-2 text-sm font-bold", titulo)}>
                      {oferta.targetPlanName} por {formatBrl(oferta.targetPriceCents || 0)}
                      {oferta.interval === "yearly" ? "/ano" : "/mês"}
                    </p>
                  )}
                </div>
              </div>
            </div>

            <label className="mt-4 flex flex-col gap-1">
              <span className={cn("text-[12px] font-bold", muted)}>
                {precisaEscrever ? "Conte o que aconteceu (vai direto para a equipe)" : "Quer contar mais? (opcional)"}
              </span>
              <textarea
                value={comentario}
                onChange={(event) => setComentario(event.target.value)}
                rows={3}
                className={cn(
                  "rounded-xl border px-3 py-2 text-sm font-medium outline-none focus:border-blue-500",
                  "border-(--ui-borda) bg-(--ui-superficie-suave) text-(--ui-texto-principal)",
                )}
              />
            </label>

            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-between">
              {oferta.alreadyUsed ? (
                <>
                  <button type="button" onClick={onClose} className={botaoSecundario}>
                    Voltar
                  </button>
                  <button type="button" onClick={() => setPasso("confirmar")} className={botaoPrimario}>
                    Continuar
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setPasso("confirmar")}
                    disabled={ocupado}
                    className={cn(botaoSecundario, "text-rose-600")}
                  >
                    Quero cancelar mesmo assim
                  </button>
                  <button
                    type="button"
                    onClick={() => void aceitarProposta()}
                    disabled={ocupado || (precisaEscrever && comentario.trim().length < 5)}
                    className={botaoPrimario}
                  >
                    {ocupado && <Loader2 className="h-4 w-4 animate-spin" />}
                    {oferta.cta}
                  </button>
                </>
              )}
            </div>
          </>
        )}

        {passo === "confirmar" && (
          <>
            <p className={cn("text-sm font-medium", muted)}>
              Cancelando, você continua com o plano atual até o fim do período já pago. Depois a conta volta para o
              Grátis, dentro dos limites desse plano. <strong>Nada é apagado</strong> e dá para voltar quando quiser.
            </p>
            <p className={cn("mt-3 text-sm font-medium", muted)}>
              Motivo informado: <strong className={titulo}>{escolhida?.label}</strong>
            </p>

            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setPasso("proposta")} className={botaoSecundario}>
                Rever a proposta
              </button>
              <button
                type="button"
                onClick={() => void cancelarDeVez()}
                disabled={ocupado}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-rose-600 px-5 text-sm font-black text-white transition-colors hover:bg-rose-700 cursor-pointer disabled:opacity-60"
              >
                {ocupado && <Loader2 className="h-4 w-4 animate-spin" />}
                Cancelar assinatura
              </button>
            </div>
          </>
        )}

        {passo === "aceita" && (
          <div className="py-4 text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500" />
            <p className={cn("mt-3 text-sm font-bold", titulo)}>{mensagemFinal}</p>
            <button type="button" onClick={onClose} className={cn(botaoPrimario, "mt-5 w-full")}>
              Fechar
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

function mensagemDoErro(erro: unknown, padrao: string) {
  return axios.isAxiosError(erro) ? (erro.response?.data as { message?: string })?.message || padrao : padrao;
}
