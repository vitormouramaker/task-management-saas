import { useState } from "react";
import { Mail, ArrowLeft, CheckCircle2 } from "lucide-react";
import { useAuthStore } from "../../../store/use-auth-store";
import { useThemeStore } from "../../../store/use-theme-store";
import { cn } from "../../../lib/utils";
import { Input } from "../../../components/ui/input";
import { Skeleton } from "../../../components/ui/skeleton";

interface ForgotPasswordPageProps {
  onGoBack: () => void;
}

export function ForgotPasswordPage({ onGoBack }: ForgotPasswordPageProps) {
  const [email, setEmail] = useState("");
  const [isSuccess, setIsSuccess] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");

  const forgotPassword = useAuthStore((state) => state.forgotPassword);
  const isLoading = useAuthStore((state) => state.isLoading);
  const error = useAuthStore((state) => state.error);
  const isDarkMode = useThemeStore((state) => state.mode === "dark");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    const result = await forgotPassword(email);
    if (result.success) {
      setSuccessMessage(result.message);
      setIsSuccess(true);
    }
  };

  return (
    <div className="pauta-auth-screen flex min-h-dvh items-center justify-center p-4">
      <div className="pauta-auth-card relative w-full max-w-105 rounded-2xl border p-5 sm:rounded-3xl sm:p-8 backdrop-blur-xl animate-in flip-in-y duration-700">
        {/* Botão de voltar */}
        <button
          onClick={onGoBack}
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
            <svg
              viewBox="0 0 24 24"
              fill="none"
              className="h-7 w-7"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0110 0v4" />
            </svg>
          </div>
          <h1
            className={cn(
              "text-2xl font-black tracking-tight",
              "text-(--ui-texto-principal)",
            )}
          >
            Recuperar Senha
          </h1>
          <p
            className={cn(
              "mt-2 text-sm font-medium",
              "text-(--ui-texto-secundario)",
            )}
          >
            Enviaremos instruções para o seu e-mail corporativo.
          </p>
        </div>

        {isLoading ? (
          <div className="space-y-6 animate-in fade-in duration-200">
            <div className="space-y-2">
              <Skeleton className="h-4 w-28 rounded-full" />
              <Skeleton className="h-11 w-full rounded-xl" />
            </div>
            <Skeleton className="h-11 w-full rounded-xl" />
          </div>
        ) : isSuccess ? (
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
                E-mail enviado!
              </h2>
              <p
                className={cn(
                  "text-[13px] font-medium",
                  "text-(--ui-texto-secundario)",
                )}
              >
                {successMessage ||
                  `Verifique a caixa de entrada de ${email} para redefinir sua senha de acesso.`}
              </p>
            </div>
            <button
              onClick={onGoBack}
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
            {error && (
              <div
                className={cn(
                  "rounded-xl border p-3 text-center text-[13px] font-bold animate-in slide-in-from-top-2",
                  "border-(--ui-rose-borda) bg-(--ui-rose-fundo) text-(--ui-rose-texto)",
                )}
              >
                {error}
              </div>
            )}

            <div className="space-y-2">
              <label
                className={cn(
                  "text-[13px] font-bold",
                  "text-(--ui-texto-item)",
                )}
              >
                E-mail Corporativo
              </label>
              <div className="relative">
                <Mail
                  className={cn(
                    "absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2",
                    "text-(--ui-texto-secundario)",
                  )}
                />
                <Input
                  type="email"
                  placeholder="voce@empresa.com.br"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
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
              disabled={!email}
              className={cn(
                "group relative flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-bold text-white transition-all cursor-pointer",
                "hover:bg-blue-700 focus:outline-none focus:ring-4 focus:ring-blue-600/20 shadow-lg shadow-blue-500/30",
                "disabled:pointer-events-none disabled:opacity-50",
              )}
            >
              <div className="absolute inset-0 -translate-x-full bg-linear-to-r from-transparent via-white/20 to-transparent group-hover:animate-shimmer" />
              Enviar instruções
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
