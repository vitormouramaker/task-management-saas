import { useState } from "react";
import { createPortal } from "react-dom";
import { Lock, X } from "lucide-react";
import { cn } from "../../../lib/utils";
import { useAuthStore } from "../../../store/use-auth-store";
import { useTaskStore } from "../../../store/use-task-store";
import { TASK_VIEW_VALUES, type TaskViewMode } from "../../../types/tasks";
import { VIEW_LABELS, VIEW_MIN_PLAN } from "../lib/task-view-helpers";
import { useFecharComEsc } from "../../../lib/use-fechar-com-esc";

/** Visões liberadas pelo plano da conta, e o aviso para as bloqueadas. */
export function usePlanViews() {
  const views = useAuthStore((state) => state.user?.organization?.entitlements?.views);
  const setActivePage = useTaskStore((state) => state.setActivePage);
  const [locked, setLocked] = useState<TaskViewMode | null>(null);

  // Esc fecha o aviso, como em qualquer aplicativo.
  useFecharComEsc(locked !== null, () => setLocked(null));

  // Sessão antiga, sem a lista de visões: não bloqueia até atualizar.
  const allowed = new Set<TaskViewMode>((views as TaskViewMode[] | undefined) ?? TASK_VIEW_VALUES);
  const isAllowed = (view: TaskViewMode) => allowed.has(view);

  const openPlans = () => {
    setLocked(null);
    sessionStorage.setItem("pauta_open_billing_tab", "1");
    setActivePage("settings");
    window.dispatchEvent(new CustomEvent("pauta:open-billing-tab"));
  };

  const lockedModal =
    locked &&
    createPortal(
      <div className="fixed inset-0 z-[80] grid place-items-center bg-black/60 p-4"
        role="dialog"
        aria-modal="true"
        aria-label="Recurso do plano" onClick={() => setLocked(null)}>
        <div
          onClick={(event) => event.stopPropagation()}
          className={cn(
            "w-full max-w-sm rounded-2xl border p-6 text-center shadow-2xl",
            "border-(--ui-borda) bg-(--ui-superficie)",
          )}
        >
          <div className="flex justify-end">
            <button type="button" onClick={() => setLocked(null)} aria-label="Fechar" className="cursor-pointer">
              <X className="h-4 w-4" />
            </button>
          </div>
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-blue-600/10 text-blue-600">
            <Lock className="h-5 w-5" />
          </span>
          <h3 className={cn("mt-3 text-lg font-black", "text-(--ui-texto-principal)")}>
            Visão {VIEW_LABELS[locked]}
          </h3>
          <p className={cn("mt-1 text-sm font-medium", "text-(--ui-texto-secundario)")}>
            Disponível a partir do plano {VIEW_MIN_PLAN[locked]}. Seus cards continuam no Quadro normalmente.
          </p>
          <button
            type="button"
            onClick={openPlans}
            className="mt-5 inline-flex h-10 w-full items-center justify-center rounded-xl bg-blue-600 text-sm font-black text-white hover:bg-blue-700 cursor-pointer"
          >
            Ver planos
          </button>
        </div>
      </div>,
      document.body,
    );

  return { isAllowed, showLocked: setLocked, lockedModal };
}
