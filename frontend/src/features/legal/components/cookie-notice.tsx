import { useEffect, useState } from "react";
import { Cookie } from "lucide-react";
import { cn } from "../../../lib/utils";
import { COOKIES_NOTICE, LEGAL_VERSION } from "../legal-content";

const STORAGE_KEY = "pauta_cookie_notice";

/** Aviso de cookies: aparece uma vez por versão dos documentos. */
export function CookieNotice() {
  const [visivel, setVisivel] = useState(false);

  useEffect(() => {
    try {
      setVisivel(localStorage.getItem(STORAGE_KEY) !== LEGAL_VERSION);
    } catch {
      // Navegador sem armazenamento: não insiste no aviso.
      setVisivel(false);
    }
  }, []);

  if (!visivel) {
    return null;
  }

  const fechar = () => {
    try {
      localStorage.setItem(STORAGE_KEY, LEGAL_VERSION);
    } catch {
      // Sem armazenamento, o aviso volta na próxima visita.
    }
    setVisivel(false);
  };

  return (
    <div className="fixed inset-x-0 bottom-0 z-[60] p-3 sm:p-4">
      <div
        className={cn(
          "mx-auto flex w-full max-w-3xl flex-col gap-3 rounded-2xl border p-4 shadow-xl sm:flex-row sm:items-center",
          "border-(--ui-borda) bg-(--ui-superficie)",
        )}
      >
        {/* No celular o icone acompanha o texto, lado a lado. */}
        <div className="flex flex-1 items-start gap-3 sm:items-center">
        <Cookie
          className={cn("mt-0.5 h-5 w-5 shrink-0 sm:mt-0", "text-(--ui-azul-texto)")}
        />

        <div className="flex-1">
          <p
            className={cn(
              "text-sm font-bold",
              "text-(--ui-texto-principal)",
            )}
          >
            {COOKIES_NOTICE.title}
          </p>
          <p
            className={cn(
              "mt-0.5 text-[13px] font-medium",
              "text-(--ui-texto-secundario)",
            )}
          >
            {COOKIES_NOTICE.message}
          </p>
        </div>
        </div>

        <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
          <a
            href="/privacidade"
            className={cn(
              "inline-flex h-10 w-full items-center justify-center rounded-xl border px-4 text-sm font-bold transition-colors cursor-pointer sm:w-auto",
              "border-(--ui-borda) text-(--ui-texto-item) hover:bg-(--ui-hover)",
            )}
          >
            {COOKIES_NOTICE.detailsLabel}
          </a>
          <button
            type="button"
            onClick={fechar}
            className="inline-flex h-10 w-full items-center justify-center rounded-xl bg-blue-600 px-5 text-sm font-black text-white sm:w-auto transition-colors hover:bg-blue-700 cursor-pointer"
          >
            {COOKIES_NOTICE.acceptLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
