import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Loader2,
  X,
  XCircle,
} from "lucide-react";

import { cn } from "../../lib/utils";
import { useThemeStore } from "../../store/use-theme-store";
import {
  useToastStore,
  type ToastItem,
  type ToastTone,
} from "../../store/use-toast-store";

const EXIT_DURATION_MS = 220;

const TONE_ICONS: Record<ToastTone, typeof CheckCircle2> = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
  loading: Loader2,
};

function getToneStyles(tone: ToastTone, isDarkMode: boolean) {
  switch (tone) {
    case "success":
      return {
        accent: isDarkMode
          ? "from-emerald-400 to-teal-300"
          : "from-emerald-500 to-teal-400",
        icon: "bg-(--ui-verde-fundo) text-(--ui-verde-texto)",
        progress: "bg-(--ui-verde-fundo)",
      };
    case "error":
      return {
        accent: isDarkMode
          ? "from-rose-400 to-red-300"
          : "from-rose-500 to-red-400",
        icon: "bg-(--ui-rose-fundo) text-(--ui-rose-texto)",
        progress: "bg-(--ui-rose-fundo)",
      };
    case "warning":
      return {
        accent: isDarkMode
          ? "from-amber-400 to-orange-300"
          : "from-amber-500 to-orange-400",
        icon: "bg-(--ui-ambar-fundo) text-(--ui-ambar-texto)",
        progress: "bg-(--ui-ambar-fundo)",
      };
    case "loading":
      return {
        accent: isDarkMode
          ? "from-slate-400 to-slate-300"
          : "from-slate-500 to-slate-400",
        icon: "bg-(--ui-fundo-neutro) text-(--ui-texto-secundario)",
        progress: isDarkMode ? "bg-slate-400/70" : "bg-slate-500/70",
      };
    default:
      return {
        accent: isDarkMode
          ? "from-blue-400 to-sky-300"
          : "from-blue-600 to-sky-400",
        icon: "bg-(--ui-azul-fundo) text-(--ui-azul-texto)",
        progress: "bg-(--ui-azul-fundo)",
      };
  }
}

function ToastCard({
  toast,
  isDarkMode,
  onDismiss,
}: {
  toast: ToastItem;
  isDarkMode: boolean;
  onDismiss: (toastId: string) => void;
}) {
  const [isLeaving, setIsLeaving] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const remainingRef = useRef(toast.duration);
  const startedAtRef = useRef(Date.now());
  const timeoutRef = useRef<number | null>(null);
  const exitTimeoutRef = useRef<number | null>(null);

  const tone = getToneStyles(toast.tone, isDarkMode);
  const ToneIcon = TONE_ICONS[toast.tone];

  function startExit() {
    if (isLeaving) return;
    setIsLeaving(true);
    exitTimeoutRef.current = window.setTimeout(
      () => onDismiss(toast.id),
      EXIT_DURATION_MS,
    );
  }

  // Reinicia a contagem quando o toast é atualizado (loading -> success, por exemplo).
  useEffect(() => {
    remainingRef.current = toast.duration;
    startedAtRef.current = Date.now();
    setIsLeaving(false);
  }, [toast.duration, toast.tone, toast.title, toast.message]);

  useEffect(() => {
    if (toast.duration <= 0 || isPaused || isLeaving) {
      return;
    }

    startedAtRef.current = Date.now();
    timeoutRef.current = window.setTimeout(startExit, remainingRef.current);

    return () => {
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      remainingRef.current = Math.max(
        0,
        remainingRef.current - (Date.now() - startedAtRef.current),
      );
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast.duration, toast.tone, toast.title, isPaused, isLeaving]);

  useEffect(() => {
    return () => {
      if (exitTimeoutRef.current) {
        window.clearTimeout(exitTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div
      role="status"
      aria-live={toast.tone === "error" ? "assertive" : "polite"}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      style={{
        animationDuration: isLeaving ? `${EXIT_DURATION_MS}ms` : "260ms",
      }}
      className={cn(
        "pointer-events-auto relative flex w-full overflow-hidden rounded-lg border shadow-[0_14px_32px_rgba(15,23,42,0.16)] backdrop-blur-xl",
        isLeaving ? "pauta-toast-out" : "pauta-toast-in",
        isDarkMode
          ? "border-(--border-subtle) bg-[color-mix(in_srgb,var(--bg-elevated)_92%,transparent)]"
          : "border-slate-200/80 bg-[color-mix(in_srgb,white_94%,transparent)]",
      )}
    >
      <div className={cn("w-1 shrink-0 bg-linear-to-b", tone.accent)} />

      <div className="flex min-w-0 flex-1 items-start gap-2.5 px-3 py-2">
        <div
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
            tone.icon,
          )}
        >
          <ToneIcon
            className={cn(
              "h-4 w-4",
              toast.tone === "loading" && "animate-spin",
            )}
            strokeWidth={2.2}
          />
        </div>

        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "text-[12px] font-bold leading-tight",
              "text-(--ui-texto-principal)",
            )}
          >
            {toast.title}
          </p>
          {toast.message && (
            <p
              className={cn(
                "mt-0.5 text-[11px] leading-snug",
                "text-(--ui-texto-secundario)",
              )}
            >
              {toast.message}
            </p>
          )}

          {toast.action && (
            <button
              type="button"
              onClick={() => {
                toast.action?.onClick();
                startExit();
              }}
              className={cn(
                "mt-1.5 cursor-pointer rounded-md px-2 py-0.5 text-[10.5px] font-bold transition-colors",
                "bg-(--ui-fundo-neutro) text-(--ui-texto-forte) hover:bg-(--ui-hover-forte)",
              )}
            >
              {toast.action.label}
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={startExit}
          title="Fechar"
          aria-label="Fechar aviso"
          className={cn(
            "grid h-5 w-5 shrink-0 cursor-pointer place-items-center rounded-md transition-colors",
            "text-(--ui-texto-secundario) hover:bg-(--ui-hover-forte) hover:text-(--ui-texto-forte)",
          )}
        >
          <X className="h-3 w-3" />
        </button>
      </div>

      {toast.duration > 0 && !isLeaving && (
        <div className="absolute bottom-0 left-1 right-0 h-0.5 bg-transparent">
          <div
            key={`${toast.id}-${toast.tone}-${toast.duration}`}
            className={cn("pauta-toast-progress h-full", tone.progress)}
            style={{
              animationDuration: `${toast.duration}ms`,
              animationPlayState: isPaused ? "paused" : "running",
            }}
          />
        </div>
      )}
    </div>
  );
}

export function ToastRegion() {
  const toasts = useToastStore((state) => state.toasts);
  const dismiss = useToastStore((state) => state.dismiss);
  const isDarkMode = useThemeStore((state) => state.mode === "dark");

  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      className="pointer-events-none fixed top-0 right-0 z-[10050] flex w-full max-w-[24rem] flex-col gap-2.5 p-3 sm:p-4"
      style={{
        paddingTop: "calc(var(--pauta-safe-top, 0px) + 0.75rem)",
        paddingRight: "calc(var(--pauta-safe-right, 0px) + 0.75rem)",
      }}
    >
      {toasts.map((item) => (
        <ToastCard
          isDarkMode={isDarkMode}
          key={item.id}
          toast={item}
          onDismiss={dismiss}
        />
      ))}
    </div>,
    document.body,
  );
}
