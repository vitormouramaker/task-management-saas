import { AlertTriangle, ArrowRight, Clock3, Gauge } from "lucide-react";
import { cn } from "../../../lib/utils";
import { useTaskStore } from "../../../store/use-task-store";
import { getUsageRatio, usePlanSubscription } from "../use-plan-limits";
import type { PlanLimitKind } from "./plan-limit-modal";

const LIMIT_LABELS: Record<string, string> = {
  users: "pessoas",
  workspaces: "workspaces",
  projects: "projetos",
  storage: "armazenamento",
};

const NEAR_LIMIT_RATIO = 0.8;
const WATCHED: PlanLimitKind[] = ["users", "workspaces", "projects", "storage"];

function formatDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString("pt-BR");
}

function daysUntil(value?: string | null) {
  if (!value) return 0;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 0;
  return Math.max(0, Math.ceil((date.getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
}

/** Faixa no topo: teste, cobrança, cancelamento e limites perto de acabar. */
export function PlanStatusBanner() {
  const { data } = usePlanSubscription();
  const setActivePage = useTaskStore((state) => state.setActivePage);

  const organization = data?.organization;
  if (!organization || organization.billingExempt) {
    return null;
  }

  const openPlans = () => {
    sessionStorage.setItem("pauta_open_billing_tab", "1");
    setActivePage("settings");
    // Se já estamos em Configurações, a tela não remonta: avisa por evento.
    window.dispatchEvent(new CustomEvent("pauta:open-billing-tab"));
  };

  const banner = (
    tone: "info" | "warn" | "danger",
    icon: React.ReactNode,
    text: React.ReactNode,
    action: string,
  ) => (
    <div
      className={cn(
        "px-4 py-2 text-xs font-bold",
        tone === "danger"
          ? "bg-(--ui-rose-fundo) text-(--ui-rose-texto)"
          : tone === "warn"
            ? "bg-(--ui-ambar-fundo) text-(--ui-ambar-texto)"
            : "bg-(--ui-azul-fundo) text-(--ui-azul-texto)",
      )}
    >
      {/* No celular o icone fica ao lado do texto e o botao vira o rodape do
          aviso, em largura total; no computador tudo fica em uma linha so. */}
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-center sm:gap-2">
        <div className="flex min-w-0 items-start gap-2 sm:items-center">
          {icon}
          <span className="min-w-0">{text}</span>
        </div>
        <button
          type="button"
          onClick={openPlans}
          className={cn(
            "inline-flex w-full items-center justify-center gap-1 rounded-lg px-3 py-2 text-[11px] font-black text-white transition-colors cursor-pointer sm:w-auto sm:py-1",
            tone === "danger"
              ? "bg-rose-600 hover:bg-rose-700"
              : tone === "warn"
                ? "bg-amber-600 hover:bg-amber-700"
                : "bg-blue-600 hover:bg-blue-700",
          )}
        >
          {action}
          <ArrowRight className="h-3 w-3" />
        </button>
      </div>
    </div>
  );

  // 1. Fatura em aberto (aviso no 8º dia, bloqueio no 15º).
  if (organization.payment?.pastDue && (organization.payment.warn || organization.payment.readOnly)) {
    return banner(
      "danger",
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 sm:mt-0" />,
      organization.payment.readOnly
        ? "Há uma fatura em aberto há mais de 15 dias. A conta está somente leitura até o pagamento ser regularizado."
        : `Não conseguimos cobrar sua assinatura há ${organization.payment.days} dias. Atualize o pagamento para não perder a edição.`,
      "Regularizar",
    );
  }

  // 2. Conta acima do limite: só leitura.
  if (organization.readOnly) {
    const limites = (organization.overLimits || [])
      .map((item) => LIMIT_LABELS[item] || item)
      .join(", ");

    return banner(
      "warn",
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 sm:mt-0" />,
      `Sua conta está acima do limite do plano (${limites}). Dá para ver e baixar tudo, mas não criar nem editar até escolher um plano ou remover itens.`,
      "Ver planos",
    );
  }

  // 3. Assinatura cancelada: continua valendo até o fim do período pago.
  if (organization.cancelAtPeriodEnd) {
    const dias = daysUntil(organization.periodEnd);
    const data = formatDate(organization.periodEnd);

    return banner(
      "warn",
      <Clock3 className="mt-0.5 h-4 w-4 shrink-0 sm:mt-0" />,
      `Assinatura cancelada. Você continua no plano ${organization.planName || ""} por mais ${dias} dia(s)${data ? `, até ${data}` : ""}. Depois a conta volta para o Grátis, sem perder nada.`,
      "Ver assinatura",
    );
  }

  // 4. Teste grátis em andamento.
  if (organization.trial?.active) {
    const dias = organization.trial.daysLeft;

    return banner(
      "info",
      <Clock3 className="mt-0.5 h-4 w-4 shrink-0 sm:mt-0" />,
      `Teste grátis do plano Profissional: ${dias === 1 ? "último dia" : `${dias} dias restantes`}. Sem cartão, sem cobrança automática.`,
      "Ver planos",
    );
  }

  // 5. Limite chegando perto (a partir de 80%).
  const perto = WATCHED.map((kind) => ({ kind, ratio: getUsageRatio(data, kind) }))
    .filter((item) => item.ratio >= NEAR_LIMIT_RATIO)
    .sort((left, right) => right.ratio - left.ratio)[0];

  if (perto) {
    const percentual = Math.min(99, Math.round(perto.ratio * 100));

    return banner(
      "warn",
      <Gauge className="mt-0.5 h-4 w-4 shrink-0 sm:mt-0" />,
      `Você já usou ${percentual}% do limite de ${LIMIT_LABELS[perto.kind]} do seu plano.`,
      "Ver planos",
    );
  }

  return null;
}
