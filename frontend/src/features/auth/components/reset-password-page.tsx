import { useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, KeyRound, Lock } from "lucide-react";

import { Input } from "../../../components/ui/input";
import { Skeleton } from "../../../components/ui/skeleton";
import { cn } from "../../../lib/utils";
import { useAuthStore } from "../../../store/use-auth-store";
import { useThemeStore } from "../../../store/use-theme-store";

interface ResetPasswordPageProps {
  onGoBack: () => void;
}

export function ResetPasswordPage({ onGoBack }: ResetPasswordPageProps) {
  const resetPassword = useAuthStore((state) => state.resetPassword);
  const logout = useAuthStore((state) => state.logout);
  const isLoading = useAuthStore((state) => state.isLoading);
  const error = useAuthStore((state) => state.error);
  const isDarkMode = useThemeStore((state) => state.mode === "dark");

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const token = useMemo(
    () => new URLSearchParams(window.location.search).get("token") || "",
    [],
  );

  const handleBackToLogin = () => {
    logout();
    onGoBack();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!token) {
      setLocalError("O link de redefinição é inválido ou está incompleto.");
      return;
    }

    if (password.length < 8) {
      setLocalError("A nova senha deve ter pelo menos 8 caracteres.");
      return;
    }

    if (password !== confirmPassword) {
      setLocalError("A confirmação de senha não confere.");
      return;
    }

    setLocalError(null);
    const result = await resetPassword(token, password);
    if (result.success) {
      setSuccessMessage(result.message);
    }
  };

  const displayError = localError || error;

  return (
    <div className="pauta-auth-screen flex min-h-dvh items-center justify-center p-4">
      <div className="pauta-auth-card relative w-full max-w-105 rounded-2xl border p-5 sm:rounded-3xl sm:p-8 backdrop-blur-xl animate-in flip-in-y duration-700">
        <button
          onClick={handleBackToLogin}
          className={cn(
            "absolute left-6 top-6 flex h-8 w-8 items-center justify-center rounded-full transition-colors cursor-pointer",
            "text-(--ui-texto-secundario) hover:bg-(--ui-hover-forte) hover:text-(--ui-texto-forte)",
          )}
        
          aria-label="Voltar para o login"
          title="Voltar para o login"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>

        <div className="mb-10 mt-8 text-center">
          <div
            className={cn(
              "mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl shadow-inner",
              "bg-(--ui-fundo-neutro) text-(--ui-texto-principal)",
            )}
          >
            <KeyRound className="h-7 w-7" />
          </div>
          <h1
            className={cn(
              "text-2xl font-black tracking-tight",
              "text-(--ui-texto-principal)",
            )}
          >
            Nova senha
          </h1>
          <p
            className={cn(
              "mt-2 text-sm font-medium",
              "text-(--ui-texto-secundario)",
            )}
          >
            Defina uma nova senha para voltar a acessar a plataforma.
          </p>
        </div>

        {isLoading ? (
          <div className="space-y-6 animate-in fade-in duration-200">
            <div className="space-y-2">
              <Skeleton className="h-4 w-20 rounded-full" />
              <Skeleton className="h-11 w-full rounded-xl" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-4 w-36 rounded-full" />
              <Skeleton className="h-11 w-full rounded-xl" />
            </div>
            <Skeleton className="mt-6 h-11 w-full rounded-xl" />
          </div>
        ) : successMessage ? (
          <div className="space-y-6 text-center animate-in fade-in zoom-in slide-in-from-bottom-4 duration-500">
            <div
              className={cn(
                "mx-auto flex h-16 w-16 items-center justify-center rounded-full",
                "bg-(--ui-verde-fundo) text-(--ui-verde-texto)",
              )}
            >
              <CheckCircle2 className="h-8 w-8" />
            </div>
            <div className="space-y-2">
              <h2
                className={cn(
                  "text-lg font-black",
                  "text-(--ui-texto-principal)",
                )}
              >
                Senha atualizada
              </h2>
              <p
                className={cn(
                  "text-[13px] font-medium",
                  "text-(--ui-texto-secundario)",
                )}
              >
                {successMessage}
              </p>
            </div>
            <button
              onClick={handleBackToLogin}
              className={cn(
                "mt-6 flex h-11 w-full items-center justify-center rounded-xl px-4 text-sm font-bold text-white transition-all cursor-pointer",
                isDarkMode
                  ? "bg-(--bg-surface-muted) hover:bg-(--border-strong)"
                  : "bg-slate-900 hover:bg-slate-800",
              )}
            >
              Voltar ao Login
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-6">
            {displayError && (
              <div
                className={cn(
                  "rounded-xl border p-3 text-center text-[13px] font-bold animate-in slide-in-from-top-2",
                  "border-(--ui-rose-borda) bg-(--ui-rose-fundo) text-(--ui-rose-texto)",
                )}
              >
                {displayError}
              </div>
            )}

            <div className="space-y-2">
              <label
                className={cn(
                  "text-[13px] font-bold",
                  "text-(--ui-texto-item)",
                )}
              >
                Nova senha
              </label>
              <div className="relative">
                <Lock
                  className={cn(
                    "absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2",
                    "text-(--ui-texto-secundario)",
                  )}
                />
                <Input
                  type="password"
                  placeholder="Mínimo de 8 caracteres"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={cn(
                    "h-11 rounded-xl pl-10 text-[14px] font-medium transition-all",
                    "bg-(--ui-superficie-campo)",
                  )}
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <label
                className={cn(
                  "text-[13px] font-bold",
                  "text-(--ui-texto-item)",
                )}
              >
                Confirmar nova senha
              </label>
              <div className="relative">
                <Lock
                  className={cn(
                    "absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2",
                    "text-(--ui-texto-secundario)",
                  )}
                />
                <Input
                  type="password"
                  placeholder="Repita a nova senha"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className={cn(
                    "h-11 rounded-xl pl-10 text-[14px] font-medium transition-all",
                    "bg-(--ui-superficie-campo)",
                  )}
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={!password || !confirmPassword || !token}
              className={cn(
                "group relative mt-6 flex h-11 w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-blue-600 px-4 text-sm font-bold text-white transition-all cursor-pointer",
                "hover:bg-blue-700 focus:outline-none focus:ring-4 focus:ring-blue-600/20 shadow-lg shadow-blue-500/30",
                "disabled:pointer-events-none disabled:opacity-50",
              )}
            >
              <div className="absolute inset-0 -translate-x-full bg-linear-to-r from-transparent via-white/20 to-transparent group-hover:animate-shimmer" />
              Salvar nova senha
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
