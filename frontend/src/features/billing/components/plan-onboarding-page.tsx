import { useEffect, useState } from "react";
import axios from "axios";
import { ArrowRight, Check, Clock3, Loader2, Sparkles } from "lucide-react";
import { buildApiUrl } from "../../../lib/api";
import { cn } from "../../../lib/utils";
import { useAuthStore } from "../../../store/use-auth-store";
import { toast } from "../../../store/use-toast-store";
import { EnterpriseRequestModal } from "./enterprise-request-modal";

interface OnboardingPlan {
  id: string;
  name: string;
  description: string;
  highlight?: string | null;
  contactOnly?: boolean;
  priceCents: Record<"monthly" | "yearly", number | null>;
  extraUserPriceCents: Record<"monthly" | "yearly", number | null>;
  features: string[];
}

function formatBrl(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  });
}

/**
 * Primeiro acesso: explica os planos e deixa a pessoa escolher entre começar no
 * Grátis, testar o Profissional por 14 dias ou assinar na hora.
 */
export function PlanOnboardingPage() {
  const token = useAuthStore((state) => state.token);
  const user = useAuthStore((state) => state.user);
  const refreshSession = useAuthStore((state) => state.refreshSession);

  const [plans, setPlans] = useState<OnboardingPlan[]>([]);
  const [trialDays, setTrialDays] = useState(14);
  const [checkoutEnabled, setCheckoutEnabled] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [enterpriseAberto, setEnterpriseAberto] = useState(false);
  // Nada é aplicado sem a pessoa confirmar.
  const [pending, setPending] = useState<
    { kind: "free" | "trial" } | { kind: "plan"; planId: string; planName: string } | null
  >(null);

  const headers = { Authorization: `Bearer ${token}` };
  const trialAvailable = user?.organization?.trialAvailable !== false;

  useEffect(() => {
    let active = true;

    axios
      .get(buildApiUrl("/api/billing/plans"), { headers })
      .then((response) => {
        if (!active) return;
        setPlans(response.data?.plans || []);
        setTrialDays(response.data?.trialDays || 14);
        setCheckoutEnabled(Boolean(response.data?.checkoutEnabled));
      })
      .catch(() => undefined)
      .finally(() => active && setIsLoading(false));

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const confirmPending = async () => {
    if (!pending) return;
    const current = pending;
    setPending(null);

    if (current.kind === "plan") {
      await subscribe(current.planId);
      return;
    }

    await choose(current.kind);
  };

  const choose = async (choice: "free" | "trial") => {
    setBusyAction(choice);
    try {
      const response = await axios.post(
        buildApiUrl("/api/billing/onboarding"),
        { choice },
        { headers },
      );
      toast.success(response.data?.message || "Tudo certo.");
      await refreshSession();
    } catch (error) {
      const message = axios.isAxiosError(error)
        ? (error.response?.data as { message?: string })?.message
        : null;
      toast.error(message || "Não foi possível salvar a escolha.");
    } finally {
      setBusyAction(null);
    }
  };

  const subscribe = async (planId: string) => {
    setBusyAction(planId);
    try {
      const response = await axios.post(
        buildApiUrl("/api/billing/checkout"),
        { plan: planId, interval: "monthly" },
        { headers },
      );

      if (typeof response.data?.checkoutUrl === "string") {
        window.location.href = response.data.checkoutUrl;
        return;
      }

      toast.error("Não foi possível abrir o pagamento.");
    } catch (error) {
      const message = axios.isAxiosError(error)
        ? (error.response?.data as { message?: string })?.message
        : null;
      toast.error(message || "Não foi possível abrir o pagamento.");
    } finally {
      setBusyAction(null);
    }
  };

  const cardClass = cn(
    "flex flex-col rounded-2xl border p-5",
    "border-(--ui-borda) bg-(--ui-superficie)",
  );
  const mutedClass = "text-(--ui-texto-secundario)";

  return (
    <div
      className={cn(
        "min-h-dvh w-full overflow-auto px-4 py-10 sm:px-8",
        "bg-(--ui-fundo-sutil)",
      )}
    >
      <div className="mx-auto w-full max-w-6xl">
        <div className="mb-8 text-center">
          <span className="inline-flex items-center gap-2 rounded-full bg-blue-600/10 px-3 py-1 text-xs font-black text-blue-600">
            <Sparkles className="h-3.5 w-3.5" />
            Bem-vindo ao Pauta
          </span>
          <h1
            className={cn(
              "mt-4 text-2xl font-black sm:text-3xl",
              "text-(--ui-texto-principal)",
            )}
          >
            Como você quer começar, {user?.name?.split(" ")[0] || "tudo bem"}?
          </h1>
          <p className={cn("mx-auto mt-2 max-w-2xl text-sm font-medium", mutedClass)}>
            Dá para usar o Pauta de graça para sempre, testar o plano Profissional por{" "}
            {trialDays} dias sem cartão, ou assinar agora. Você pode mudar de ideia
            quando quiser, e nada do que você criar é apagado ao trocar de plano.
          </p>
        </div>

        {isLoading ? (
          <p className={cn("text-center text-sm font-bold", mutedClass)}>Carregando planos…</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
            {plans.map((plan) => {
              const priceCents = plan.priceCents?.monthly ?? null;
              const extraUserCents = plan.extraUserPriceCents?.monthly ?? null;

              return (
                <div
                  key={plan.id}
                  className={cn(
                    cardClass,
                    plan.highlight && ("border-(--ui-azul-borda)"),
                  )}
                >
                  <div className="mb-3 flex items-start justify-between gap-2">
                    <h2
                      className={cn(
                        "text-base font-black",
                        "text-(--ui-texto-principal)",
                      )}
                    >
                      {plan.name}
                    </h2>
                    {plan.highlight && (
                      <span className="shrink-0 whitespace-nowrap rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-black uppercase text-white">
                        {plan.highlight}
                      </span>
                    )}
                  </div>

                  <div
                    className={cn(
                      "text-2xl font-black",
                      "text-(--ui-texto-principal)",
                    )}
                  >
                    {plan.contactOnly
                      ? "Sob consulta"
                      : priceCents === 0
                        ? "R$ 0"
                        : priceCents
                          ? formatBrl(priceCents)
                          : "—"}
                  </div>
                  <div className={cn("text-xs font-bold", mutedClass)}>
                    {plan.contactOnly
                      ? "contrato negociado"
                      : priceCents === 0
                        ? "sem mensalidade"
                        : "por mês"}
                  </div>
                  {extraUserCents ? (
                    <div className={cn("mt-1 text-[11px] font-bold", mutedClass)}>
                      + {formatBrl(extraUserCents)} por pessoa extra
                    </div>
                  ) : null}

                  <ul className="mt-4 mb-5 flex-1 space-y-2">
                    {plan.features.map((feature) => (
                      <li
                        key={feature}
                        className={cn("flex items-start gap-2 text-xs font-medium", mutedClass)}
                      >
                        <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-600" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>

                  {plan.id === "free" ? (
                    <button
                      type="button"
                      onClick={() => setPending({ kind: "free" })}
                      disabled={busyAction !== null}
                      className={cn(
                        "flex h-10 items-center justify-center rounded-xl border text-sm font-black transition-colors cursor-pointer disabled:opacity-60",
                        "border-(--ui-borda) text-(--ui-texto-item) hover:bg-(--ui-hover)",
                      )}
                    >
                      Usar o Grátis
                    </button>
                  ) : plan.contactOnly ? (
                    <a
                      href="#"
                      onClick={(event) => {
                        event.preventDefault();
                        setEnterpriseAberto(true);
                      }}
                      className={cn(
                        "flex h-10 items-center justify-center gap-1 rounded-xl border text-sm font-black transition-colors cursor-pointer",
                        "border-(--ui-borda) text-(--ui-texto-item) hover:bg-(--ui-hover)",
                      )}
                    >
                      Falar com a gente
                      <ArrowRight className="h-3.5 w-3.5" />
                    </a>
                  ) : (
                    <button
                      type="button"
                      onClick={() =>
                        setPending({ kind: "plan", planId: plan.id, planName: plan.name })
                      }
                      disabled={busyAction !== null || !checkoutEnabled}
                      title={
                        checkoutEnabled ? undefined : "Pagamento on-line em configuração."
                      }
                      className="flex h-10 items-center justify-center gap-2 rounded-xl bg-blue-600 text-sm font-black text-white transition-colors hover:bg-blue-700 cursor-pointer disabled:opacity-60"
                    >
                      {busyAction === plan.id && <Loader2 className="h-4 w-4 animate-spin" />}
                      Assinar
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <button
            type="button"
            onClick={() => setPending({ kind: "free" })}
            disabled={busyAction !== null}
            className={cn(
              "inline-flex h-12 items-center justify-center gap-2 rounded-2xl border px-6 text-sm font-black transition-colors cursor-pointer disabled:opacity-60",
              "border-(--ui-borda) text-(--ui-texto-principal) hover:bg-(--ui-hover-forte) bg-(--ui-superficie-suave)",
            )}
          >
            {busyAction === "free" && <Loader2 className="h-4 w-4 animate-spin" />}
            Começar no plano Grátis
          </button>

          <button
            type="button"
            onClick={() => setPending({ kind: "trial" })}
            disabled={busyAction !== null || !trialAvailable}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-blue-600 px-6 text-sm font-black text-white transition-colors hover:bg-blue-700 cursor-pointer disabled:opacity-60"
          >
            {busyAction === "trial" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Clock3 className="h-4 w-4" />
            )}
            {trialAvailable
              ? `Testar o Profissional por ${trialDays} dias`
              : "Teste grátis já utilizado"}
          </button>
        </div>

      </div>

      {enterpriseAberto && <EnterpriseRequestModal onClose={() => setEnterpriseAberto(false)} />}

      {pending && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
          <div
            className={cn(
              "w-full max-w-md rounded-2xl border p-6",
              "border-(--ui-borda) bg-(--ui-superficie)",
            )}
          >
            <h2
              className={cn(
                "text-base font-black",
                "text-(--ui-texto-principal)",
              )}
            >
              {pending.kind === "free"
                ? "Começar no plano Grátis?"
                : pending.kind === "trial"
                  ? `Ativar o teste de ${trialDays} dias?`
                  : `Assinar o plano ${pending.kind === "plan" ? pending.planName : ""}?`}
            </h2>
            <p className={cn("mt-2 text-sm font-medium", mutedClass)}>
              {pending.kind === "free"
                ? "Você fica no Grátis: 1 espaço de trabalho, 3 projetos, até 3 pessoas e 1 GB de arquivos. Dá para assinar ou testar o Profissional depois, em Configurações > Assinatura."
                : pending.kind === "trial"
                  ? `Você usa o plano Profissional por ${trialDays} dias, sem cartão e sem cobrança automática. O teste só pode ser ativado uma vez, e ao terminar a conta volta ao Grátis.`
                  : "Você vai para o pagamento da Stripe. A assinatura só começa depois que o pagamento for confirmado."}
            </p>

            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setPending(null)}
                className={cn(
                  "h-10 rounded-xl border px-4 text-sm font-bold transition-colors cursor-pointer",
                  "border-(--ui-borda) text-(--ui-texto-item) hover:bg-(--ui-hover)",
                )}
              >
                Voltar
              </button>
              <button
                type="button"
                onClick={() => void confirmPending()}
                className="h-10 rounded-xl bg-blue-600 px-4 text-sm font-black text-white transition-colors hover:bg-blue-700 cursor-pointer"
              >
                {pending.kind === "plan" ? "Ir para o pagamento" : "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
