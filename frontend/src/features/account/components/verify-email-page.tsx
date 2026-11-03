import { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { CheckCircle2, Loader2, MailCheck, MailX } from "lucide-react";
import { buildApiUrl } from "../../../lib/api";
import { useAuthStore } from "../../../store/use-auth-store";
import { SubmitButton } from "../../auth/components/signup-page";
import { AuthCard } from "./auth-card";

/** Página aberta pelo link de confirmação enviado por e-mail. */
export function VerifyEmailPage({ onDone }: { onDone: () => void }) {
  const token = useMemo(
    () => new URLSearchParams(window.location.search).get("token") || "",
    [],
  );
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const refreshSession = useAuthStore((state) => state.refreshSession);

  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("");
  const requestedRef = useRef(false);

  useEffect(() => {
    // StrictMode executa efeitos duas vezes em desenvolvimento.
    if (requestedRef.current) return;
    requestedRef.current = true;

    if (!token) {
      setStatus("error");
      setMessage("Link de confirmação incompleto. Abra novamente o link recebido por e-mail.");
      return;
    }

    axios
      .post(buildApiUrl("/api/auth/verify-email"), { token })
      .then(async (response) => {
        if (isAuthenticated) {
          await refreshSession();
        }
        setStatus("success");
        setMessage(response.data?.message || "E-mail confirmado.");
      })
      .catch((error) => {
        setStatus("error");
        setMessage(
          axios.isAxiosError(error)
            ? (error.response?.data as { message?: string })?.message || "Não foi possível confirmar o e-mail."
            : "Não foi possível confirmar o e-mail.",
        );
      });
  }, [isAuthenticated, refreshSession, token]);

  if (status === "loading") {
    return (
      <AuthCard icon={MailCheck} title="Confirmando seu e-mail...">
        <div className="flex justify-center py-4">
          <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      icon={status === "success" ? CheckCircle2 : MailX}
      title={status === "success" ? "Tudo certo!" : "Não foi possível confirmar"}
      subtitle={message}
    >
      <SubmitButton type="button" onClick={onDone}>
        {isAuthenticated || status === "error" ? "Ir para o Pauta" : "Entrar no Pauta"}
      </SubmitButton>
    </AuthCard>
  );
}
