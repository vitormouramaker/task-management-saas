import { cn } from "../../lib/utils";
import { Skeleton } from "./skeleton";

/**
 * Esqueleto de lista enquanto os dados chegam, no lugar de um "Carregando…"
 * solto: a tela já nasce com a forma do conteúdo e não dá um salto quando os
 * dados aparecem.
 */
export function ListaCarregando({
  linhas = 4,
  comAvatar = true,
  className,
}: {
  linhas?: number;
  comAvatar?: boolean;
  className?: string;
}) {

  return (
    <div
      className={cn(
        "divide-y rounded-2xl border",
        "divide-(--ui-borda-suave) border-(--ui-borda) bg-(--ui-superficie)",
        className,
      )}
      aria-busy="true"
      aria-label="Carregando"
    >
      {Array.from({ length: linhas }).map((_, indice) => (
        <div key={indice} className="flex items-center gap-3 p-4">
          {comAvatar && <Skeleton className="h-9 w-9 shrink-0 rounded-xl" />}
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/3 rounded-full" />
            <Skeleton className="h-3 w-2/3 rounded-full" />
          </div>
          <Skeleton className="h-6 w-16 shrink-0 rounded-full" />
        </div>
      ))}
    </div>
  );
}
