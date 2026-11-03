import { useEffect, useState } from "react";
import axios from "axios";
import { Check, Loader2 } from "lucide-react";
import { buildApiUrl } from "../../../lib/api";
import { cn } from "../../../lib/utils";
import { queryClient } from "../../../lib/query-client";
import { useAuthStore } from "../../../store/use-auth-store";
import { toast } from "../../../store/use-toast-store";
import { PLAN_SUBSCRIPTION_QUERY_KEY, type PlanSubscriptionSummary } from "../use-plan-limits";
import { EnterpriseRequestModal } from "./enterprise-request-modal";
import { CancellationSurveyModal } from "./cancellation-survey-modal";
import { CancelFlowModal } from "./cancel-flow-modal";

export interface CatalogPlan {
  id: string;
  name: string;
  description: string;
  highlight?: string | null;
  contactOnly?: boolean;
  priceCents: Record<"monthly" | "yearly", number | null>;
  extraUserPriceCents: Record<"monthly" | "yearly", number | null>;
  entitlements: {
    includedUsers: number;
    maxUsers: number;
    maxWorkspaces: number;
    maxProjects: number;
    maxStorageMb: number;
    maxFileSizeMb?: number;
    maxStoragePacks?: number;
  };
  features: string[];
}

interface PlanCatalogProps {
  subscription?: PlanSubscriptionSummary | null;
  /** Esconde o plano Grátis e encurta os textos (uso dentro de modal). */
  compact?: boolean;
  onChanged?: () => void;
}

type PendingAction =
  | { kind: "cancel" }
  | { kind: "plan"; planId: string; planName: string; increase: boolean; amountDueCents: number }
  | { kind: "quantities"; increase: boolean; amountDueCents: number; effectiveAt?: string | null };

function formatarData(valor: string | null | undefined) {
  if (!valor) return "—";
  const data = new Date(valor);
  return Number.isNaN(data.getTime()) ? "—" : data.toLocaleDateString("pt-BR");
}

export function formatBrl(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  });
}

function formatStorage(megabytes: number) {
  if (megabytes === -1) return "ilimitado";
  return megabytes >= 1024
    ? `${Math.round((megabytes / 1024) * 10) / 10} GB`
    : `${megabytes} MB`;
}

const PLAN_RANK: Record<string, number> = {
  free: 0,
  essencial: 1,
  profissional: 2,
  empresarial: 3,
  enterprise: 4,
};

/** Planos, adicionais e ações de assinatura — usado na tela e nos avisos. */
export function PlanCatalog({ subscription, compact = false, onChanged }: PlanCatalogProps) {
  const token = useAuthStore((state) => state.token);
  const accountRole = useAuthStore((state) => state.user?.organization?.role);
  // Quem não é titular/administrador vê os planos, mas não contrata.
  const canManage = accountRole === "owner" || accountRole === "admin";

  const [plans, setPlans] = useState<CatalogPlan[]>([]);
  const [storagePackCents, setStoragePackCents] = useState<Record<"monthly" | "yearly", number>>({
    monthly: 2900,
    yearly: 29000,
  });
  const [checkoutEnabled, setCheckoutEnabled] = useState(false);
  const [interval, setInterval] = useState<"monthly" | "yearly">("monthly");
  const [extraSeats, setExtraSeats] = useState(0);
  const [storagePacks, setStoragePacks] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [enterpriseAberto, setEnterpriseAberto] = useState(false);

  const organization = subscription?.organization;
  const contractedPlan = organization?.contractedPlan || organization?.plan || "free";
  const hasSubscription = Boolean(
    organization && organization.contractedPlan && organization.contractedPlan !== "free",
  );
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    let active = true;

    axios
      .get(buildApiUrl("/api/billing/plans"), { headers })
      .then((response) => {
        if (!active) return;
        const lista: CatalogPlan[] = response.data?.plans || [];
        setPlans(compact ? lista.filter((plan) => plan.id !== "free") : lista);
        setCheckoutEnabled(Boolean(response.data?.checkoutEnabled));
        if (response.data?.storagePack?.priceCents) {
          setStoragePackCents(response.data.storagePack.priceCents);
        }
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, compact]);

  // Os campos começam com o que já está contratado.
  useEffect(() => {
    setExtraSeats(organization?.extraSeats ?? 0);
    setStoragePacks(organization?.extraStoragePacks ?? 0);
  }, [organization?.extraSeats, organization?.extraStoragePacks]);

  // Teto de pessoas extras do plano contratado (o servidor também valida).
  // No teste gratis a pessoa usa um plano que ainda nao contratou: o cartao
  // em uso e o do plano liberado, nao o Gratis.
  const emTeste = Boolean(organization?.trial?.active) && (organization?.plan || "free") !== contractedPlan;
  const planoEmUso = emTeste ? organization?.plan || contractedPlan : contractedPlan;

  const planoAtual = plans.find((plan) => plan.id === contractedPlan);
  const maxExtraSeats =
    planoAtual && planoAtual.entitlements.maxUsers !== -1
      ? Math.max(0, planoAtual.entitlements.maxUsers - planoAtual.entitlements.includedUsers)
      : 200;
  const maxStoragePacks =
    planoAtual && (planoAtual.entitlements.maxStoragePacks ?? -1) !== -1
      ? Math.max(0, planoAtual.entitlements.maxStoragePacks ?? 0)
      : 50;

  const quantityChanged =
    hasSubscription &&
    (extraSeats !== (organization?.extraSeats ?? 0) ||
      storagePacks !== (organization?.extraStoragePacks ?? 0));

  // Depois de mudar qualquer coisa, a tela inteira precisa refletir o novo estado.
  const refreshEverything = async () => {
    await Promise.allSettled([
      queryClient.invalidateQueries({ queryKey: PLAN_SUBSCRIPTION_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: ["billing", "invoices"] }),
      useAuthStore.getState().refreshPlan(),
    ]);
    onChanged?.();
  };

  const handleError = (error: unknown, fallback: string) => {
    const data = axios.isAxiosError(error)
      ? (error.response?.data as { code?: string; message?: string; invoiceUrl?: string })
      : null;

    if (data?.code === "PAYMENT_REQUIRED" && data.invoiceUrl) {
      window.location.href = data.invoiceUrl;
      return;
    }

    toast.error(data?.message || fallback);
  };

  const openQuantityConfirm = async () => {
    setBusy("preview");
    try {
      const response = await axios.post(
        buildApiUrl("/api/billing/subscription/preview"),
        { extraSeats, storagePacks },
        { headers },
      );
      setPending({
        kind: "quantities",
        increase: Boolean(response.data?.increase),
        amountDueCents: Number(response.data?.amountDueCents || 0),
        effectiveAt: response.data?.effectiveAt || null,
      });
    } catch (error) {
      handleError(error, "Não foi possível calcular a cobrança.");
    } finally {
      setBusy(null);
    }
  };

  const applyQuantities = async () => {
    setPending(null);
    setBusy("quantities");
    try {
      const response = await axios.post(
        buildApiUrl("/api/billing/subscription/quantities"),
        { extraSeats, storagePacks },
        { headers },
      );
      toast.success(response.data?.message || "Assinatura atualizada.");
      await refreshEverything();
    } catch (error) {
      handleError(error, "Não foi possível atualizar a assinatura.");
    } finally {
      setBusy(null);
    }
  };

  const [pesquisaAberta, setPesquisaAberta] = useState(false);
  const [fluxoCancelamento, setFluxoCancelamento] = useState(false);

  const cancelSubscription = async () => {
    setPending(null);
    setBusy("cancel");
    try {
      const response = await axios.post(
        buildApiUrl("/api/billing/subscription/cancel"),
        {},
        { headers },
      );
      toast.success(response.data?.message || "Assinatura cancelada.");
      await refreshEverything();
    } catch (error) {
      handleError(error, "Não foi possível cancelar a assinatura.");
    } finally {
      setBusy(null);
    }
  };

  const startPlanAction = (plan: CatalogPlan) => {
    if (plan.contactOnly) {
      setEnterpriseAberto(true);
      return;
    }

    // Voltar para o Grátis é cancelar a assinatura: passa pelo fluxo com a
    // pesquisa e a proposta antes de confirmar.
    if (plan.id === "free") {
      setFluxoCancelamento(true);
      return;
    }

    if (!hasSubscription) {
      void subscribe(plan);
      return;
    }

    setPending({
      kind: "plan",
      planId: plan.id,
      planName: plan.name,
      increase: (PLAN_RANK[plan.id] ?? 0) > (PLAN_RANK[contractedPlan] ?? 0),
      amountDueCents: 0,
    });
  };

  const subscribe = async (plan: CatalogPlan) => {
    setBusy(plan.id);
    try {
      const response = await axios.post(
        buildApiUrl("/api/billing/checkout"),
        { plan: plan.id, interval, extraSeats, storagePacks },
        { headers },
      );

      if (typeof response.data?.checkoutUrl === "string") {
        window.location.href = response.data.checkoutUrl;
        return;
      }

      toast.error("Não foi possível abrir o pagamento.");
    } catch (error) {
      handleError(error, "Não foi possível abrir o pagamento.");
    } finally {
      setBusy(null);
    }
  };

  const applyPlanChange = async (planId: string) => {
    setPending(null);
    setBusy(planId);
    try {
      const response = await axios.post(
        buildApiUrl("/api/billing/subscription/plan"),
        { plan: planId, interval },
        { headers },
      );
      toast.success(response.data?.message || "Plano alterado.");
      await refreshEverything();
    } catch (error) {
      handleError(error, "Não foi possível trocar de plano.");
    } finally {
      setBusy(null);
    }
  };

  const mutedClass = "text-(--ui-texto-secundario)";
  const inputClass = cn(
    "h-10 w-28 rounded-xl border px-3 text-sm font-bold",
    "border-(--ui-borda) bg-(--ui-superficie-suave) text-(--ui-texto-principal)",
  );

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div
          className={cn(
            "inline-flex rounded-xl border p-1",
            "border-(--ui-borda) bg-(--ui-fundo-sutil)",
          )}
        >
          {[
            { id: "monthly", label: "Mensal" },
            { id: "yearly", label: "Anual (10x)" },
          ].map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setInterval(option.id as "monthly" | "yearly")}
              className={cn(
                "h-9 rounded-lg px-4 text-xs font-black transition-colors cursor-pointer",
                interval === option.id
                  ? "bg-blue-600 text-white"
                  : "text-(--ui-texto-secundario) hover:text-(--ui-texto-principal)",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>

        {hasSubscription && canManage && (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-start gap-3">
            <label className="flex w-40 flex-col gap-1">
              <span className={cn("text-[11px] font-bold whitespace-nowrap", mutedClass)}>
                Pessoas extras
              </span>
              <input aria-label="Pessoas extras"
                type="number"
                min={0}
                max={maxExtraSeats}
                value={extraSeats}
                onChange={(event) =>
                  setExtraSeats(
                    Math.min(maxExtraSeats, Math.max(0, Number(event.target.value) || 0)),
                  )
                }
                className={cn(inputClass, "w-full")}
              />
              <span className={cn("text-[10px] font-bold whitespace-nowrap", mutedClass)}>
                hoje {organization?.extraSeats ?? 0} · máx. {maxExtraSeats}
              </span>
            </label>

            <label className="flex w-40 flex-col gap-1">
              <span className={cn("text-[11px] font-bold whitespace-nowrap", mutedClass)}>
                Pacotes de 100 GB
              </span>
              <input aria-label="Pacotes de armazenamento"
                type="number"
                min={0}
                max={maxStoragePacks}
                value={storagePacks}
                onChange={(event) =>
                  setStoragePacks(
                    Math.min(maxStoragePacks, Math.max(0, Number(event.target.value) || 0)),
                  )
                }
                className={cn(inputClass, "w-full")}
              />
              <span className={cn("text-[10px] font-bold whitespace-nowrap", mutedClass)}>
                hoje {organization?.extraStoragePacks ?? 0} · máx. {maxStoragePacks}
              </span>
            </label>

            {/* Espaçador invisível: alinha o botão com os campos, não com os rótulos. */}
            <div className="flex flex-col gap-1">
              <span
                aria-hidden
                className="text-[11px] font-bold opacity-0 select-none whitespace-nowrap"
              >
                .
              </span>
            <button
              type="button"
              onClick={() => void openQuantityConfirm()}
              disabled={!quantityChanged || busy !== null}
              className={cn(
                "inline-flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-black transition-colors",
                quantityChanged
                  ? "bg-blue-600 text-white hover:bg-blue-700 cursor-pointer"
                  : "cursor-not-allowed bg-(--ui-fundo-neutro) text-(--ui-texto-secundario)",
              )}
            >
              {(busy === "preview" || busy === "quantities") && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              Atualizar assinatura
            </button>
            </div>
            </div>

            <p
              className={cn(
                "max-w-md text-[11px] font-medium leading-snug",
                "text-(--ui-texto-secundario)",
              )}
            >
              Aumentar cobra a diferença na hora, no cartão cadastrado. Reduzir só passa a
              valer no fim do período que você já pagou.
            </p>
          </div>
        )}
      </div>

      {!canManage && (
        <p
          className={cn(
            "mt-4 rounded-xl px-4 py-3 text-[13px] font-bold",
            "bg-(--ui-fundo-neutro) text-(--ui-texto-secundario)",
          )}
        >
          Só o titular ou um administrador da conta pode contratar, trocar de plano ou
          mexer nos adicionais. Fale com quem administra a conta.
        </p>
      )}

      <div
        className={cn(
          "mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2",
          compact ? "xl:grid-cols-4" : "xl:grid-cols-5",
        )}
      >
        {plans.map((plan) => {
          const desconto = subscription?.organization?.discount || null;
          const proximaCobranca = subscription?.organization?.nextInvoice || null;
          const priceCents = plan.priceCents?.[interval] ?? null;
          const extraUserCents = plan.extraUserPriceCents?.[interval] ?? null;
          const isCurrent = plan.id === planoEmUso;
          const emTesteNesteCartao = emTeste && plan.id === planoEmUso;
          // Cada plano tem teto próprio: o total considera só o que cabe nele.
          const assentosNoPlano =
            plan.entitlements.maxUsers === -1
              ? extraSeats
              : Math.min(
                  extraSeats,
                  Math.max(0, plan.entitlements.maxUsers - plan.entitlements.includedUsers),
                );
          const pacotesNoPlano =
            (plan.entitlements.maxStoragePacks ?? -1) === -1
              ? storagePacks
              : Math.min(storagePacks, plan.entitlements.maxStoragePacks ?? 0);
          const limitadoPeloPlano =
            assentosNoPlano < extraSeats || pacotesNoPlano < storagePacks;
          const totalCents =
            priceCents && !plan.contactOnly
              ? priceCents +
                (extraUserCents || 0) * assentosNoPlano +
                storagePackCents[interval] * pacotesNoPlano
              : null;

          return (
            <div
              key={plan.id}
              className={cn(
                "flex flex-col rounded-2xl border p-4",
                plan.highlight
                  ? "border-(--ui-azul-borda) bg-(--ui-azul-fundo)"
                  : "border-(--ui-borda) bg-(--ui-superficie)",
              )}
            >
              <div className="mb-2 flex items-start justify-between gap-2">
                <h3
                  className={cn(
                    "text-sm font-black",
                    "text-(--ui-texto-principal)",
                  )}
                >
                  {plan.name}
                </h3>
                <div className="flex shrink-0 items-center gap-1.5">
                  {emTesteNesteCartao && (
                    <span className="shrink-0 whitespace-nowrap rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-black uppercase text-white">
                      Em uso · teste
                    </span>
                  )}
                  {plan.highlight && (
                    <span className="shrink-0 whitespace-nowrap rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-black uppercase text-white">
                      {plan.highlight}
                    </span>
                  )}
                </div>
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
              <div className={cn("text-[11px] font-bold", mutedClass)}>
                {plan.contactOnly
                  ? "contrato negociado"
                  : priceCents === 0
                    ? "sem mensalidade"
                    : interval === "monthly"
                      ? "por mês"
                      : "por ano"}
              </div>
              <div className={cn("mt-0.5 text-[11px] font-bold", mutedClass)}>
                {extraUserCents ? `+ ${formatBrl(extraUserCents)} por pessoa extra` : " "}
              </div>

              {/* Desconto valendo: preço cheio riscado e o valor com desconto. */}
              {isCurrent && desconto && desconto.nextAmountCents !== null && (
                <div className="mt-2 rounded-xl bg-emerald-500/10 px-3 py-2">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className={cn("text-[13px] font-bold line-through", mutedClass)}>
                      {formatBrl(totalCents ?? priceCents ?? 0)}
                    </span>
                    <span className="text-lg font-black text-emerald-600">
                      {formatBrl(desconto.nextAmountCents)}
                    </span>
                    <span className="text-[11px] font-black text-emerald-600">
                      {desconto.percentOff ? `-${desconto.percentOff}%` : "com desconto"}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11px] font-bold text-emerald-600">
                    {desconto.months
                      ? `Valor com desconto pelos próximos ${desconto.months} ${desconto.months === 1 ? "mês" : "meses"}`
                      : "Valor com desconto"}
                    {desconto.endsAt ? `, até ${formatarData(desconto.endsAt)}` : ""}. Depois volta para{" "}
                    {formatBrl(totalCents ?? priceCents ?? 0)}.
                  </p>
                </div>
              )}

              {/* Sem desconto, mostramos ao menos quando é a próxima cobrança. */}
              {emTesteNesteCartao && (
                <p className="mb-3 rounded-xl bg-emerald-500/10 px-3 py-2 text-[12px] font-bold text-emerald-700">
                  Você está usando este plano no teste grátis
                  {organization?.trial?.daysLeft ? `: ${organization.trial.daysLeft} dia(s) restantes` : ""}. Sem cartão, sem
                  cobrança automática.
                </p>
              )}

              {isCurrent && !desconto && proximaCobranca?.at && (
                <p className={cn("mt-2 text-[11px] font-bold", mutedClass)}>
                  Próxima cobrança: {formatBrl(proximaCobranca.amountCents)} em {formatarData(proximaCobranca.at)}
                </p>
              )}

              {/* O total com adicionais só faz sentido no plano que a conta tem. */}
              {totalCents !== null && isCurrent && (extraSeats > 0 || storagePacks > 0) && (
                <div className="mt-2">
                  <div className="text-[11px] font-black text-blue-600">
                    Com extras: {formatBrl(totalCents)}
                    {interval === "monthly" ? " /mês" : " /ano"}
                  </div>
                  <div className={cn("text-[10px] font-bold", mutedClass)}>
                    {limitadoPeloPlano
                      ? `no máximo deste plano: ${assentosNoPlano} pessoa(s) extra(s) e ${pacotesNoPlano} pacote(s)`
                      : `${assentosNoPlano} pessoa(s) extra(s) e ${pacotesNoPlano} pacote(s)`}
                  </div>
                </div>
              )}

              <ul className="mt-3 mb-4 flex-1 space-y-1.5">
                <li className={cn("flex items-start gap-1.5 text-[11px] font-bold", mutedClass)}>
                  <Check className="mt-0.5 h-3 w-3 shrink-0 text-blue-600" />
                  <span>
                    {plan.entitlements.includedUsers} pessoas incluídas no preço
                    {plan.entitlements.maxUsers !== -1 && extraUserCents ? (
                      <span className={cn("block font-medium", mutedClass)}>
                        + até {plan.entitlements.maxUsers - plan.entitlements.includedUsers}{" "}
                        pessoas extras por {formatBrl(extraUserCents)} cada
                      </span>
                    ) : null}
                  </span>
                </li>
                <li className={cn("flex items-start gap-1.5 text-[11px] font-bold", mutedClass)}>
                  <Check className="mt-0.5 h-3 w-3 shrink-0 text-blue-600" />
                  {plan.entitlements.maxWorkspaces === -1
                    ? "Espaços de trabalho ilimitados"
                    : `${plan.entitlements.maxWorkspaces} workspace(s)`}
                  {" · "}
                  {plan.entitlements.maxProjects === -1
                    ? "projetos ilimitados"
                    : `${plan.entitlements.maxProjects} projetos`}
                </li>
                <li className={cn("flex items-start gap-1.5 text-[11px] font-bold", mutedClass)}>
                  <Check className="mt-0.5 h-3 w-3 shrink-0 text-blue-600" />
                  <span>
                    {formatStorage(plan.entitlements.maxStorageMb)} de arquivos
                    {plan.entitlements.maxFileSizeMb
                      ? ` (até ${formatStorage(plan.entitlements.maxFileSizeMb)} cada)`
                      : ""}
                    {(plan.entitlements.maxStoragePacks ?? 0) > 0 && (
                      <span className={cn("block font-medium", mutedClass)}>
                        + até {plan.entitlements.maxStoragePacks} pacotes de 100 GB
                      </span>
                    )}
                  </span>
                </li>
                {!compact &&
                  plan.features.slice(0, 2).map((feature) => (
                    <li
                      key={feature}
                      className={cn("flex items-start gap-1.5 text-[11px] font-medium", mutedClass)}
                    >
                      <Check className="mt-0.5 h-3 w-3 shrink-0 text-blue-600" />
                      {feature}
                    </li>
                  ))}
              </ul>

              <button
                type="button"
                onClick={() => startPlanAction(plan)}
                disabled={
                  (isCurrent && !emTesteNesteCartao) ||
                  !canManage ||
                  busy !== null ||
                  (plan.id === "free" && !hasSubscription) ||
                  (!checkoutEnabled && !plan.contactOnly && plan.id !== "free")
                }
                className={cn(
                  "inline-flex h-10 items-center justify-center gap-2 rounded-xl text-sm font-black transition-colors",
                  isCurrent && !emTesteNesteCartao
                    ? "cursor-default bg-(--ui-fundo-neutro) text-(--ui-texto-secundario)"
                    : "bg-blue-600 text-white hover:bg-blue-700 cursor-pointer",
                  "disabled:pointer-events-none disabled:opacity-70",
                )}
              >
                {busy === plan.id && <Loader2 className="h-4 w-4 animate-spin" />}
                {emTesteNesteCartao
                  ? "Assinar agora"
                  : isCurrent
                  ? "Plano atual"
                  : plan.contactOnly
                    ? "Falar com a gente"
                    : plan.id === "free"
                      ? emTeste
                        ? "Volta ao Grátis no fim do teste"
                        : "Cancelar assinatura"
                      : hasSubscription
                        ? "Mudar para este plano"
                        : "Assinar"}
              </button>
            </div>
          );
        })}
      </div>

      {enterpriseAberto && <EnterpriseRequestModal onClose={() => setEnterpriseAberto(false)} />}
      {pesquisaAberta && <CancellationSurveyModal onClose={() => setPesquisaAberta(false)} />}
      {fluxoCancelamento && (
        <CancelFlowModal onClose={() => setFluxoCancelamento(false)} onFinished={refreshEverything} />
      )}

      {pending && (
        <div className="fixed inset-0 z-[80] grid place-items-center bg-black/60 p-4">
          <div
            className={cn(
              "w-full max-w-md rounded-2xl border p-6",
              "border-(--ui-borda) bg-(--ui-superficie)",
            )}
          >
            <h3
              className={cn(
                "text-base font-black",
                "text-(--ui-texto-principal)",
              )}
            >
              {pending.kind === "cancel"
                ? "Cancelar a assinatura?"
                : pending.kind === "plan"
                ? `Mudar para o plano ${pending.planName}?`
                : pending.increase
                  ? "Confirmar aumento e pagamento"
                  : "Confirmar redução"}
            </h3>
            <p className={cn("mt-2 text-sm font-medium", mutedClass)}>
              {pending.kind === "cancel"
                ? "Você continua com o plano atual até o fim do período já pago e depois a conta volta para o Grátis. Nada do que você criou é apagado, e dá para reativar antes dessa data."
                : pending.kind === "plan"
                ? pending.increase
                  ? "Vamos cobrar agora, no cartão cadastrado, a diferença proporcional ao tempo que falta do período atual. O plano novo entra assim que o pagamento for confirmado."
                  : "Você continua no plano atual até o fim do período já pago. A troca entra no próximo ciclo e não devolvemos valores do período atual."
                : pending.increase
                  ? `Vamos cobrar ${formatBrl(pending.amountDueCents)} agora, no cartão cadastrado, referente ao tempo que falta do período atual.`
                  : "Você continua com os limites atuais até o fim do período já pago. A redução vale a partir do próximo ciclo."}
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
                onClick={() => {
                  if (pending.kind === "cancel") {
                    void cancelSubscription();
                    return;
                  }
                  if (pending.kind === "plan") {
                    void applyPlanChange(pending.planId);
                    return;
                  }
                  void applyQuantities();
                }}
                className="h-10 rounded-xl bg-blue-600 px-4 text-sm font-black text-white transition-colors hover:bg-blue-700 cursor-pointer"
              >
                {pending.kind === "cancel"
                  ? "Cancelar assinatura"
                  : pending.increase
                    ? "Pagar e confirmar"
                    : "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
