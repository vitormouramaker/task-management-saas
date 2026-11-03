import { useState } from "react";
import { createPortal } from "react-dom";
import axios from "axios";
import { Building2, CheckCircle2, Loader2, X } from "lucide-react";
import { Input } from "../../../components/ui/input";
import { buildApiUrl } from "../../../lib/api";
import { cn } from "../../../lib/utils";
import { useAuthStore } from "../../../store/use-auth-store";
import { useFecharComEsc } from "../../../lib/use-fechar-com-esc";

interface EnterpriseRequestModalProps {
  onClose: () => void;
}

const TAMANHOS = ["até 50", "51 a 150", "151 a 300", "301 a 1.000", "mais de 1.000"];

/** Pedido do plano Enterprise: chega na tela de solicitações do super-admin. */
export function EnterpriseRequestModal({ onClose }: EnterpriseRequestModalProps) {
  const token = useAuthStore((state) => state.token);
  const user = useAuthStore((state) => state.user);

  const [companyName, setCompanyName] = useState(user?.organization?.name || "");
  const [teamSize, setTeamSize] = useState("");
  const [seatsNeeded, setSeatsNeeded] = useState("");
  const [storageNeededGb, setStorageNeededGb] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [reason, setReason] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [enviado, setEnviado] = useState<string | null>(null);

  const enviar = async () => {
    setEnviando(true);
    setErro(null);

    try {
      const response = await axios.post(
        buildApiUrl("/api/billing/enterprise-request"),
        {
          companyName,
          teamSize,
          seatsNeeded: seatsNeeded ? Number(seatsNeeded) : null,
          storageNeededGb: storageNeededGb ? Number(storageNeededGb) : null,
          contactPhone,
          reason,
        },
        { headers: { Authorization: `Bearer ${token}` } },
      );
      setEnviado(response.data?.message || "Recebemos sua solicitação.");
    } catch (error) {
      const message = axios.isAxiosError(error)
        ? (error.response?.data as { message?: string })?.message
        : null;
      setErro(message || "Não foi possível enviar a solicitação.");
    } finally {
      setEnviando(false);
    }
  };

  const labelClass = cn(
    "text-[12px] font-bold",
    "text-(--ui-texto-secundario)",
  );

  // Esc fecha a janela, como em qualquer aplicativo.

  useFecharComEsc(true, onClose);

  return createPortal(
    <div className="fixed inset-0 z-[90] grid place-items-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Falar com a equipe">
      <div
        className={cn(
          "max-h-[92vh] w-full max-w-lg overflow-auto rounded-2xl border p-6 shadow-2xl",
          "border-(--ui-borda) bg-(--ui-superficie)",
        )}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-blue-600/10 text-blue-600">
              <Building2 className="h-5 w-5" />
            </span>
            <div>
              <h2
                className={cn(
                  "text-lg font-black",
                  "text-(--ui-texto-principal)",
                )}
              >
                Plano Enterprise
              </h2>
              <p className={cn("text-sm font-medium", labelClass)}>
                Conte um pouco da sua operação. Nossa equipe monta uma proposta sob medida.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className={cn(
              "grid h-8 w-8 shrink-0 place-items-center rounded-lg transition-colors cursor-pointer",
              "hover:bg-(--ui-hover-forte)",
            )}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {enviado ? (
          <div className="py-6 text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500" />
            <p
              className={cn(
                "mt-3 text-sm font-bold",
                "text-(--ui-texto-principal)",
              )}
            >
              {enviado}
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-5 inline-flex h-10 items-center justify-center rounded-xl bg-blue-600 px-5 text-sm font-black text-white transition-colors hover:bg-blue-700 cursor-pointer"
            >
              Fechar
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <label className="flex flex-col gap-1">
              <span className={labelClass}>Empresa</span>
              <Input value={companyName} onChange={(event) => setCompanyName(event.target.value)} />
            </label>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className={labelClass}>Tamanho da equipe</span>
                <select
                  value={teamSize}
                  onChange={(event) => setTeamSize(event.target.value)}
                  className={cn(
                    "h-10 rounded-xl border px-3 text-sm font-medium",
                    "border-(--ui-borda) bg-(--ui-superficie-suave) text-(--ui-texto-principal)",
                  )}
                >
                  <option value="">Selecione</option>
                  {TAMANHOS.map((tamanho) => (
                    <option key={tamanho} value={tamanho}>
                      {tamanho} pessoas
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className={labelClass}>Telefone para contato</span>
                <Input
                  value={contactPhone}
                  onChange={(event) => setContactPhone(event.target.value)}
                  placeholder="(11) 99999-9999"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className={labelClass}>Pessoas que vão usar</span>
                <Input
                  type="number"
                  min={1}
                  value={seatsNeeded}
                  onChange={(event) => setSeatsNeeded(event.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className={labelClass}>Armazenamento estimado (GB)</span>
                <Input
                  type="number"
                  min={1}
                  value={storageNeededGb}
                  onChange={(event) => setStorageNeededGb(event.target.value)}
                />
              </label>
            </div>

            <label className="flex flex-col gap-1">
              <span className={labelClass}>Por que o plano Enterprise faz sentido para vocês?</span>
              <textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={4}
                placeholder="Ex.: somos 220 pessoas, precisamos de mais armazenamento para vídeos e de um contrato com nota fiscal anual."
                className={cn(
                  "rounded-xl border px-3 py-2 text-sm font-medium",
                  "border-(--ui-borda) bg-(--ui-superficie-suave) text-(--ui-texto-principal)",
                )}
              />
            </label>

            {erro && <p className="text-[13px] font-bold text-rose-600">{erro}</p>}

            <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={onClose}
                className={cn(
                  "h-10 rounded-xl border px-4 text-sm font-bold transition-colors cursor-pointer",
                  "border-(--ui-borda) text-(--ui-texto-item) hover:bg-(--ui-hover)",
                )}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void enviar()}
                disabled={enviando || reason.trim().length < 10}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 text-sm font-black text-white transition-colors hover:bg-blue-700 cursor-pointer disabled:opacity-60"
              >
                {enviando && <Loader2 className="h-4 w-4 animate-spin" />}
                Enviar solicitação
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
