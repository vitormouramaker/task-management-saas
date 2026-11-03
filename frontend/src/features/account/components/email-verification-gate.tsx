import { useState } from "react";
import axios from "axios";
import { LogOut, MailWarning } from "lucide-react";
import { buildApiUrl } from "../../../lib/api";
import { cn } from "../../../lib/utils";
import { useAuthStore } from "../../../store/use-auth-store";
import { toast } from "../../../store/use-toast-store";
import { SubmitButton } from "../../auth/components/signup-page";
import { AuthCard, SecondaryButton } from "./auth-card";

/** Bloqueia o app até a pessoa confirmar o e-mail do cadastro. */
export function EmailVerificationGate() {
  const authUser = useAuthStore((state) => state.user);
  const token = useAuthStore((state) => state.token);
  const refreshSession = useAuthStore((state) => state.refreshSession);
  const logout = useAuthStore((state) => state.logout);

  const [isResending, setIsResending] = useState(false);
  const [isChecking, setIsChecking] = useState(false);

  const resend = async () => {
    setIsResending(true);
    try {
      const response = await axios.post(
        buildApiUrl("/api/auth/resend-verification"),
        {},
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (response.data?.alreadyVerified) {
        await refreshSession();
      }
      toast.success("E-mail enviado.", { message: response.data?.message });
    } catch (error) {
      toast.error("Não foi possível reenviar.", {
        message: axios.isAxiosError(error)
          ? (error.response?.data as { message?: string })?.message
          : undefined,
      });
    } finally {
      setIsResending(false);
    }
  };

  const checkAgain = async () => {
    setIsChecking(true);
    const refreshed = await refreshSession();
    setIsChecking(false);
    if (refreshed && useAuthStore.getState().user?.emailVerified === false) {
      toast.info("Ainda não confirmado.", {
        message: "Abra o link que enviamos por e-mail e tente de novo.",
      });
    }
  };

  return (
    <AuthCard
      icon={MailWarning}
      title="Confirme seu e-mail"
      subtitle={
        <>
          Enviamos um link de confirmação para <strong>{authUser?.email}</strong>. Abra o e-mail
          (confira também o spam) e clique no link para liberar sua conta.
        </>
      }
      topAction={
        <button
          type="button"
          onClick={logout}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition-colors cursor-pointer",
            "text-(--ui-texto-secundario) hover:bg-(--ui-hover-forte) hover:text-(--ui-texto-forte)",
          )}
        >
          <LogOut className="h-3.5 w-3.5" />
          Sair
        </button>
      }
    >
      <div className="space-y-3">
        <SubmitButton type="button" onClick={checkAgain} disabled={isChecking}>
          {isChecking ? "Verificando..." : "Já confirmei"}
        </SubmitButton>
        <SecondaryButton onClick={resend} disabled={isResending}>
          {isResending ? "Enviando..." : "Reenviar e-mail"}
        </SecondaryButton>
      </div>
    </AuthCard>
  );
}
