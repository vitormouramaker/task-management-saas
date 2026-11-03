import { useEffect, useRef, useState } from "react";
import { X, AlertTriangle, LoaderCircle } from "lucide-react";
import { createPortal } from "react-dom";
import { cn } from "../../lib/utils";

interface ConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<unknown>;
  title: string;
  message: string;
  confirmLabel?: string;
  pendingLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "warning" | "info";
}

export function ConfirmationModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = "Confirmar",
  pendingLabel = "Processando...",
  cancelLabel = "Cancelar",
  variant = "danger",
}: ConfirmationModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const botaoConfirmar = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) {
      setIsSubmitting(false);
    }
  }, [isOpen]);

  // Esc fecha, como em qualquer janela; e o foco começa no botão de ação,
  // para quem usa teclado não precisar tabular até ele.
  useEffect(() => {
    if (!isOpen) return;

    const aoTeclar = (evento: KeyboardEvent) => {
      if (evento.key === "Escape") {
        evento.stopPropagation();
        if (!isSubmitting) onClose();
      }
    };

    window.addEventListener("keydown", aoTeclar);
    botaoConfirmar.current?.focus();
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [isOpen, isSubmitting, onClose]);

  if (!isOpen) return null;

  const handleClose = () => {
    if (isSubmitting) return;
    onClose();
  };

  const handleConfirm = async () => {
    if (isSubmitting) return;

    setIsSubmitting(true);

    try {
      await Promise.resolve(onConfirm());
      onClose();
    } catch (error) {
      console.error("Erro ao confirmar ação:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-110 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      {/* Overlay */}
      <div
        className="pauta-theme-overlay absolute inset-0 animate-in fade-in duration-200 backdrop-blur-sm"
        onClick={(event) => {
          event.stopPropagation();
          handleClose();
        }}
      />

      {/* Content */}
      <div
        onClick={(event) => event.stopPropagation()}
        className={cn(
          "relative w-full max-w-md scale-in-center animate-in zoom-in-95 duration-200 overflow-hidden rounded-2xl border",
          "pauta-theme-surface border-(--ui-borda) bg-(--ui-superficie-suave)",
        )}
      >
        <div
          className={cn(
            "flex items-center justify-between border-b px-6 py-4",
            "border-(--ui-borda-suave)",
          )}
        >
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-lg",
                variant === "danger" && "bg-rose-50 text-rose-600",
                variant === "warning" && "bg-amber-50 text-amber-600",
                variant === "info" && "bg-blue-50 text-blue-600",
              )}
            >
              <AlertTriangle className="h-5 w-5" />
            </div>
            <h3
              className={cn(
                "font-semibold",
                "text-(--ui-texto-principal)",
              )}
            >
              {title}
            </h3>
          </div>
          <button
            onClick={(event) => {
              event.stopPropagation();
              handleClose();
            }}
            disabled={isSubmitting}
            aria-label="Fechar"
            title="Fechar"
            className={cn(
              "rounded-lg p-1 transition-colors cursor-pointer",
              isSubmitting && "cursor-not-allowed opacity-60",
              "text-(--ui-texto-secundario) hover:bg-(--ui-hover) hover:text-(--ui-texto-forte)",
            )}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-6 py-6">
          <p
            className={cn(
              "text-sm leading-relaxed",
              "text-(--ui-texto-secundario)",
            )}
          >
            {message}
          </p>
        </div>

        <div
          className={cn(
            "flex items-center justify-end gap-3 border-t px-6 py-4",
            "border-(--ui-borda-suave) bg-(--ui-fundo-sutil)",
          )}
        >
          <button
            onClick={(event) => {
              event.stopPropagation();
              handleClose();
            }}
            disabled={isSubmitting}
            className={cn(
              "rounded-xl px-4 py-2 text-sm font-medium transition-colors cursor-pointer",
              isSubmitting && "cursor-not-allowed opacity-60",
              "text-(--ui-texto-secundario) hover:bg-(--ui-hover-forte) hover:text-(--ui-texto-forte)",
            )}
          >
            {cancelLabel}
          </button>
          <button
            ref={botaoConfirmar}
            onClick={(event) => {
              event.stopPropagation();
              void handleConfirm();
            }}
            disabled={isSubmitting}
            aria-busy={isSubmitting}
            className={cn(
              "inline-flex min-w-28 items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium text-white transition-all active:scale-95 cursor-pointer",
              isSubmitting && "cursor-not-allowed",
              variant === "danger" && "bg-rose-600 hover:bg-rose-700",
              variant === "warning" && "bg-amber-600 hover:bg-amber-700",
              variant === "info" && "bg-blue-600 hover:bg-blue-700",
            )}
          >
            {isSubmitting && <LoaderCircle className="h-4 w-4 animate-spin" />}
            {isSubmitting ? pendingLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
