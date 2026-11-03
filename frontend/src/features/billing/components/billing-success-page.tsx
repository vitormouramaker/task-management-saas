import { useEffect, useRef } from "react";
import { CheckCircle2, ArrowRight, CreditCard } from "lucide-react";
import { cn } from "../../../lib/utils";
import { useAuthStore } from "../../../store/use-auth-store";

interface BillingSuccessPageProps {
  onGoToApp: () => void;
}

const PLAN_LABELS: Record<string, string> = {
  essencial: "Essencial",
  profissional: "Profissional",
  empresarial: "Empresarial",
  enterprise: "Enterprise",
};

export function BillingSuccessPage({ onGoToApp }: BillingSuccessPageProps) {
  const refreshPlan = useAuthStore((state) => state.refreshPlan);
  const params = new URLSearchParams(window.location.search);
  const plan = params.get("plan") || "";
  const planLabel = PLAN_LABELS[plan] || "";
  const interval = params.get("interval") === "yearly" ? "anual" : "mensal";

  const retriesRef = useRef(0);

  useEffect(() => {
    // Webhook may take 1-3s to fire. Retry up to 5 times with increasing delay.
    const delays = [1500, 2500, 3500, 5000, 8000];

    let timeoutId: ReturnType<typeof setTimeout>;

    const attempt = () => {
      refreshPlan().then(() => {
        if (retriesRef.current < delays.length - 1) {
          retriesRef.current += 1;
          timeoutId = setTimeout(attempt, delays[retriesRef.current]);
        }
      });
    };

    timeoutId = setTimeout(attempt, delays[0]);

    return () => clearTimeout(timeoutId);
  }, [refreshPlan]);

  return (
    <div className="pauta-auth-screen flex min-h-dvh items-center justify-center p-4">
      <div className="pauta-auth-card w-full max-w-130 rounded-2xl border p-5 sm:rounded-3xl sm:p-8 text-center backdrop-blur-xl animate-in fade-in zoom-in-95 duration-500">
        <div
          className={cn(
            "mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl",
            "bg-(--ui-verde-fundo) text-(--ui-verde-texto)",
          )}
        >
          <CheckCircle2 className="h-9 w-9" />
        </div>

        <h1
          className={cn(
            "text-2xl font-black tracking-tight",
            "text-(--ui-texto-principal)",
          )}
        >
          Pagamento confirmado!
        </h1>
        <p
          className={cn(
            "mx-auto mt-3 max-w-md text-sm font-medium leading-relaxed",
            "text-(--ui-texto-secundario)",
          )}
        >
          {planLabel
            ? `Sua assinatura do plano ${planLabel} (${interval}) está ativa.`
            : "Sua assinatura está ativa."}{" "}
          Os limites novos já valem para toda a sua equipe.
        </p>

        <div
          className={cn(
            "my-8 rounded-2xl border p-4 text-left",
            "border-(--ui-borda) bg-(--ui-fundo-sutil)",
          )}
        >
          <div className="flex items-start gap-3">
            <CreditCard
              className={cn(
                "mt-0.5 h-5 w-5 shrink-0",
                "text-(--ui-azul-texto)",
              )}
            />
            <div>
              <p
                className={cn(
                  "text-sm font-bold",
                  "text-(--ui-texto-principal)",
                )}
              >
                O que acontece agora
              </p>
              <ul
                className={cn(
                  "mt-2 space-y-1.5 text-xs font-medium",
                  "text-(--ui-texto-secundario)",
                )}
              >
                <li>• O recibo chega por e-mail e fica em Configurações &gt; Pagamentos.</li>
                <li>
                  • A renovação é automática, {interval === "anual" ? "todo ano" : "todo mês"}
                  , no mesmo cartão.
                </li>
                <li>
                  • Dá para trocar de plano, contratar adicionais ou cancelar quando quiser,
                  em Configurações &gt; Assinatura.
                </li>
              </ul>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            sessionStorage.setItem("pauta_open_billing_tab", "1");
            onGoToApp();
          }}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-6 text-sm font-black text-white transition-colors hover:bg-blue-700 cursor-pointer"
        >
          Ver minha assinatura
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
