import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import { buildApiUrl } from "../../lib/api";
import { useAuthStore } from "../../store/use-auth-store";
import { PlanLimitModal, type PlanLimitKind } from "./components/plan-limit-modal";

export interface PlanSubscriptionSummary {
  organization: {
    plan: string;
    extraSeats?: number;
    extraStoragePacks?: number;
    planName?: string;
    contractedPlan?: string;
    billingExempt?: boolean;
    readOnly?: boolean;
    overLimits?: string[];
    trial?: { active: boolean; daysLeft: number; expired?: boolean };
    payment?: { pastDue: boolean; days: number; warn: boolean; readOnly: boolean };
    periodEnd?: string | null;
    cancelAtPeriodEnd?: boolean;
    discount?: {
      percentOff: number | null;
      amountOffCents: number | null;
      months: number | null;
      endsAt: string | null;
      nextAmountCents: number | null;
      nextInvoiceAt: string | null;
    } | null;
    nextInvoice?: { amountCents: number; at: string | null } | null;
    pendingChange?: {
      at: string | null;
      plan: string | null;
      extraSeats: number | null;
      extraStoragePacks: number | null;
    } | null;
    entitlements: {
      seats: number;
      maxWorkspaces: number;
      maxProjects: number;
      maxStorageMb: number;
    };
    usage: {
      users: number;
      workspaces: number;
      projects?: number;
      storageMb?: number;
    };
  };
}

export const PLAN_SUBSCRIPTION_QUERY_KEY = ["billing", "subscription", "banner"];

/** Assinatura, uso e limites da conta — compartilhado por toda a interface. */
export function usePlanSubscription() {
  const token = useAuthStore((state) => state.token);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  return useQuery<PlanSubscriptionSummary>({
    queryKey: PLAN_SUBSCRIPTION_QUERY_KEY,
    enabled: isAuthenticated && Boolean(token),
    staleTime: 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    queryFn: async () => {
      const response = await axios.get(buildApiUrl("/api/billing/subscription"), {
        headers: { Authorization: `Bearer ${token}` },
      });
      return response.data as PlanSubscriptionSummary;
    },
  });
}

/** Quanto do limite já foi usado (0 a 1). -1 significa ilimitado. */
export function getUsageRatio(
  data: PlanSubscriptionSummary | undefined,
  kind: PlanLimitKind,
) {
  const organization = data?.organization;
  if (!organization || organization.billingExempt) return 0;

  const { entitlements, usage } = organization;
  const pairs: Record<PlanLimitKind, [number, number]> = {
    workspaces: [usage.workspaces ?? 0, entitlements.maxWorkspaces],
    projects: [usage.projects ?? 0, entitlements.maxProjects],
    users: [usage.users ?? 0, entitlements.seats],
    storage: [usage.storageMb ?? 0, entitlements.maxStorageMb],
  };

  const [used, max] = pairs[kind];
  if (max === -1 || max === 0) return 0;
  return used / max;
}

function isAtLimit(data: PlanSubscriptionSummary | undefined, kind: PlanLimitKind) {
  if (!data || data.organization.billingExempt) return false;
  return getUsageRatio(data, kind) >= 1;
}

/**
 * Avisa antes de abrir a tela de criação quando o limite do plano já acabou,
 * mostrando ali mesmo as opções de upgrade.
 */
export function usePlanLimitGuard() {
  const { data, refetch } = usePlanSubscription();
  const [blocked, setBlocked] = useState<PlanLimitKind | null>(null);

  const ensureCanCreate = (kind: PlanLimitKind) => {
    if (isAtLimit(data, kind)) {
      setBlocked(kind);
      return false;
    }
    return true;
  };

  const limitModal = blocked ? (
    <PlanLimitModal
      kind={blocked}
      subscription={data}
      onChanged={() => void refetch()}
      onClose={() => setBlocked(null)}
    />
  ) : null;

  return { ensureCanCreate, limitModal };
}
