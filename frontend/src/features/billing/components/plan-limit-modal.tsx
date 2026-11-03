import { createPortal } from "react-dom";
import { ArrowRight, X } from "lucide-react";
import { cn } from "../../../lib/utils";
import { useTaskStore } from "../../../store/use-task-store";
import type { PlanSubscriptionSummary } from "../use-plan-limits";
import { PlanCatalog } from "./plan-catalog";
import { useFecharComEsc } from "../../../lib/use-fechar-com-esc";

export type PlanLimitKind = "workspaces" | "projects" | "users" | "storage";

interface PlanLimitModalProps {
  kind: PlanLimitKind;
  subscription?: PlanSubscriptionSummary | null;
  onChanged?: () => void;
  onClose: () => void;
}

const TITLES: Record<PlanLimitKind, string> = {
  workspaces: "Você atingiu o limite de espaços de trabalho",
  projects: "Você atingiu o limite de projetos",
  users: "Você atingiu o limite de pessoas",
  storage: "Você atingiu o limite de armazenamento",
};

const UNITS: Record<PlanLimitKind, string> = {
  workspaces: "workspace(s)",
  projects: "projeto(s)",
  users: "pessoa(s)",
  storage: "MB",
};

/** Aviso de limite com a seção completa de planos e adicionais. */
export function PlanLimitModal({
  kind,
  subscription,
  onChanged,
  onClose,
}: PlanLimitModalProps) {
  const setActivePage = useTaskStore((state) => state.setActivePage);

  const organization = subscription?.organization;
  const limite =
    kind === "workspaces"
      ? organization?.entitlements.maxWorkspaces
      : kind === "projects"
        ? organization?.entitlements.maxProjects
        : kind === "users"
          ? organization?.entitlements.seats
          : organization?.entitlements.maxStorageMb;
  const uso =
    kind === "workspaces"
      ? organization?.usage.workspaces
      : kind === "projects"
        ? organization?.usage.projects
        : kind === "users"
          ? organization?.usage.users
          : organization?.usage.storageMb;

  const mutedClass = "text-(--ui-texto-secundario)";

  // Esc fecha a janela, como em qualquer aplicativo.

  useFecharComEsc(true, onClose);

  return createPortal(
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/70 p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Limite do plano">
      <div
        className={cn(
          "flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border shadow-2xl",
          "border-(--ui-borda) bg-(--ui-superficie)",
        )}
      >
        <div
          className={cn(
            "flex items-start justify-between gap-4 border-b px-6 py-5",
            "border-(--ui-borda) bg-(--ui-superficie)",
          )}
        >
          <div>
            <span className="inline-flex items-center rounded-full bg-amber-500/10 px-2.5 py-1 text-[11px] font-black text-amber-600">
              Limite do plano
            </span>
            <h2
              className={cn(
                "mt-2 text-lg font-black sm:text-xl",
                "text-(--ui-texto-principal)",
              )}
            >
              {TITLES[kind]}
            </h2>
            <p className={cn("mt-1 text-sm font-medium", mutedClass)}>
              {typeof uso === "number" && typeof limite === "number" && limite !== -1 ? (
                <>
                  Você está usando <strong>{uso}</strong> de <strong>{limite}</strong>{" "}
                  {UNITS[kind]} do plano{" "}
                  <strong>{organization?.planName || organization?.plan}</strong>.
                </>
              ) : (
                <>Seu plano atual não permite criar mais {UNITS[kind]}.</>
              )}{" "}
              Escolha um plano maior ou contrate adicionais — nada do que você já criou é
              perdido.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className={cn(
              "grid h-9 w-9 shrink-0 place-items-center rounded-xl transition-colors cursor-pointer",
              "hover:bg-(--ui-hover-forte)",
            )}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div
          className={cn(
            "flex-1 overflow-auto px-6 py-5",
            "bg-(--ui-fundo-sutil)",
          )}
        >
          <PlanCatalog subscription={subscription} compact onChanged={onChanged} />
        </div>

        <div
          className={cn(
            "flex flex-wrap items-center justify-between gap-2 border-t px-6 py-4",
            "border-(--ui-borda) bg-(--ui-superficie)",
          )}
        >
          <button
            type="button"
            onClick={() => {
              sessionStorage.setItem("pauta_open_billing_tab", "1");
              setActivePage("settings");
              window.dispatchEvent(new CustomEvent("pauta:open-billing-tab"));
              onClose();
            }}
            className="inline-flex items-center gap-1 text-sm font-bold text-blue-600 hover:underline cursor-pointer"
          >
            Abrir a tela de assinatura
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onClose}
            className={cn(
              "h-10 rounded-xl border px-4 text-sm font-bold transition-colors cursor-pointer",
              "border-(--ui-borda) text-(--ui-texto-item) hover:bg-(--ui-hover)",
            )}
          >
            Agora não
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
