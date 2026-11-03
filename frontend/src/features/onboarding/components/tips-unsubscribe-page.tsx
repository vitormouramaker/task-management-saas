import { useEffect, useState } from "react";
import axios from "axios";
import { CheckCircle2, Loader2, MailX } from "lucide-react";
import { buildApiUrl } from "../../../lib/api";
import { cn } from "../../../lib/utils";

/** Página do link "não quero mais receber dicas" dos e-mails. */
export function TipsUnsubscribePage({ onDone }: { onDone: () => void }) {
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    axios
      .post(buildApiUrl("/api/onboarding/dicas/sair"), { m: params.get("m"), t: params.get("t") })
      .then((response) => {
        setMessage(response.data?.message || "Pronto.");
        setState("ok");
      })
      .catch((error) => {
        setMessage(
          (axios.isAxiosError(error) && (error.response?.data as { message?: string })?.message) ||
            "Não foi possível concluir. Tente abrir o link de novo.",
        );
        setState("error");
      });
  }, []);

  return (
    <div className={cn("grid min-h-dvh place-items-center p-6", "bg-(--ui-fundo-sutil)")}>
      <div
        className={cn(
          "w-full max-w-md rounded-2xl border p-8 text-center",
          "border-(--ui-borda) bg-(--ui-superficie) text-(--ui-texto-principal)",
        )}
      >
        {state === "loading" ? (
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-blue-600" />
        ) : state === "ok" ? (
          <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500" />
        ) : (
          <MailX className="mx-auto h-10 w-10 text-rose-500" />
        )}
        <h1 className="mt-4 text-lg font-black">E-mails de dicas</h1>
        <p className={cn("mt-2 text-sm font-medium", "text-(--ui-texto-secundario)")}>
          {state === "loading" ? "Processando…" : message}
        </p>
        <p className={cn("mt-2 text-xs font-medium", "text-(--ui-texto-secundario)")}>
          Avisos importantes da sua conta, como cobrança e segurança, continuam sendo enviados.
        </p>
        <button
          type="button"
          onClick={onDone}
          className="mt-6 inline-flex h-10 items-center rounded-xl bg-blue-600 px-5 text-sm font-black text-white hover:bg-blue-700 cursor-pointer"
        >
          Ir para o Pauta
        </button>
      </div>
    </div>
  );
}
