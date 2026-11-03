import { LoaderCircle } from "lucide-react";

import {
  formatUploadEta,
  type UploadProgressPhase,
} from "../../lib/file-upload";
import { cn } from "../../lib/utils";

interface AttachmentUploadProgressProps {
  progress: number;
  etaMs: number | null;
  phase: UploadProgressPhase;
  isDarkMode: boolean;
  errorMessage?: string | null;
}

function getPhaseLabel(phase: UploadProgressPhase) {
  switch (phase) {
    case "preparing":
      return "Preparando arquivo";
    case "uploading":
      return "Enviando arquivo";
    case "processing":
      return "Finalizando upload";
    case "complete":
      return "Upload concluído";
    case "error":
      return "Falha no upload";
    default:
      return "Aguardando envio";
  }
}

export function AttachmentUploadProgress({
  progress,
  etaMs,
  phase,
  isDarkMode,
  errorMessage,
}: AttachmentUploadProgressProps) {
  const isError = phase === "error";
  const isComplete = phase === "complete";

  return (
    <div
      className={cn(
        "space-y-2 rounded-2xl border px-3 py-2.5",
        isError
          ? "border-(--ui-rose-borda) bg-(--ui-rose-fundo)"
          : "border-(--ui-azul-borda) bg-(--ui-azul-fundo)",
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {!isComplete && !isError && (
            <LoaderCircle
              className={cn(
                "h-3.5 w-3.5 shrink-0 animate-spin",
                "text-(--ui-azul-texto)",
              )}
            />
          )}
          <span
            className={cn(
              "truncate text-[11px] font-semibold",
              isError
                ? "text-(--ui-rose-texto)"
                : "text-(--ui-texto-forte)",
            )}
          >
            {isError
              ? errorMessage || getPhaseLabel(phase)
              : getPhaseLabel(phase)}
          </span>
        </div>
        <span
          className={cn(
            "shrink-0 text-[10px] font-black tabular-nums",
            isError
              ? "text-(--ui-rose-texto)"
              : "text-(--ui-azul-texto)",
          )}
        >
          {Math.max(0, Math.min(100, Math.round(progress)))}%
        </span>
      </div>

      <div
        className={cn(
          "h-1.5 overflow-hidden rounded-full",
          isError
            ? "bg-(--ui-rose-fundo)"
            : "bg-(--ui-azul-fundo)",
        )}
      >
        <div
          className={cn(
            "h-full rounded-full transition-all duration-300 ease-out",
            isError
              ? "bg-(--ui-rose-fundo)"
              : isDarkMode
                ? "bg-linear-to-r from-blue-500 via-cyan-400 to-blue-300"
                : "bg-linear-to-r from-blue-500 via-sky-500 to-cyan-400",
          )}
          style={{ width: `${Math.max(6, Math.min(100, progress))}%` }}
        />
      </div>

      <div
        className={cn(
          "text-[10px] font-medium",
          isError
            ? "text-(--ui-rose-texto)"
            : "text-(--ui-texto-secundario)",
        )}
      >
        {isError
          ? "Você pode remover o anexo e tentar novamente."
          : isComplete
            ? "Anexo disponível."
            : formatUploadEta(etaMs)}
      </div>
    </div>
  );
}
