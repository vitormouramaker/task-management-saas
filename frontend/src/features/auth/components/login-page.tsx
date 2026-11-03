import { useState } from "react";
import { Mail, Lock, ArrowRight, Eye, EyeOff } from "lucide-react";
import { useAuthStore } from "../../../store/use-auth-store";
import { useThemeStore } from "../../../store/use-theme-store";
import { cn } from "../../../lib/utils";
import { Input } from "../../../components/ui/input";
import { Skeleton } from "../../../components/ui/skeleton";

interface LoginPageProps {
  onGoToForgot: () => void;
  onGoToSignup: () => void;
}

const REMEMBERED_EMAIL_KEY = "pauta_remembered_email";

export function LoginPage({ onGoToForgot, onGoToSignup }: LoginPageProps) {
  const [email, setEmail] = useState(
    () => localStorage.getItem(REMEMBERED_EMAIL_KEY) || "",
  );
  const [password, setPassword] = useState("");
  const [senhaVisivel, setSenhaVisivel] = useState(false);
  const [rememberEmail, setRememberEmail] = useState(
    () => !!localStorage.getItem(REMEMBERED_EMAIL_KEY),
  );

  const login = useAuthStore((state) => state.login);
  const isLoading = useAuthStore((state) => state.isLoading);
  const error = useAuthStore((state) => state.error);
  const isDarkMode = useThemeStore((state) => state.mode === "dark");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    const success = await login(email, password);
    if (!success) return;

    if (rememberEmail) {
      localStorage.setItem(REMEMBERED_EMAIL_KEY, email);
    } else {
      localStorage.removeItem(REMEMBERED_EMAIL_KEY);
    }
  };

  return (
    <div className="pauta-auth-screen flex min-h-dvh items-center justify-center p-4">
      {/* Container Principal */}
      <div className="pauta-auth-card w-full max-w-105 rounded-2xl border p-5 sm:rounded-3xl sm:p-8 backdrop-blur-xl animate-in fade-in zoom-in-95 duration-500">
        {/* Header da Tela de Login */}
        <div className="mb-10 text-center">
          <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-linear-to-br from-blue-600 to-indigo-600 shadow-lg shadow-blue-500/30">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              className="h-7 w-7 text-white"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
          </div>
          <h1
            className={cn(
              "text-2xl font-black tracking-tight",
              "text-(--ui-texto-principal)",
            )}
          >
            Bem-vindo ao Pauta
          </h1>
          <p
            className={cn(
              "mt-2 text-sm font-medium",
              "text-(--ui-texto-secundario)",
            )}
          >
            Faça login para gerenciar seus projetos e equipes.
          </p>
        </div>

        {/* Formulário */}
        {isLoading ? (
          <div className="space-y-5 animate-in fade-in duration-200">
            <div className="space-y-4">
              <div className="space-y-2">
                <Skeleton className="h-4 w-28 rounded-full" />
                <Skeleton className="h-11 w-full rounded-xl" />
              </div>
              <div className="space-y-2">
                <Skeleton className="h-4 w-16 rounded-full" />
                <Skeleton className="h-11 w-full rounded-xl" />
                <div className="flex items-center justify-between pt-1">
                  <Skeleton className="h-4 w-28 rounded-full" />
                  <Skeleton className="h-4 w-24 rounded-full" />
                </div>
              </div>
            </div>
            <Skeleton className="mt-6 h-11 w-full rounded-xl" />
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
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

            <div className="space-y-4">
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

              <div className="space-y-2">
                <label
                  className={cn(
                    "text-[13px] font-bold",
                    "text-(--ui-texto-item)",
                  )}
                >
                  Senha
                </label>
                <div className="relative">
                  <Lock
                    className={cn(
                      "absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2",
                      "text-(--ui-texto-secundario)",
                    )}
                  />
                  <Input
                    type={senhaVisivel ? "text" : "password"}
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={cn(
                      "h-11 rounded-xl pl-10 pr-11 text-[14px] font-medium transition-all",
                      "bg-(--ui-superficie-campo)",
                    )}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setSenhaVisivel((atual) => !atual)}
                    aria-label={senhaVisivel ? "Ocultar senha" : "Mostrar senha"}
                    title={senhaVisivel ? "Ocultar senha" : "Mostrar senha"}
                    className={cn(
                      "absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg transition-colors cursor-pointer",
                      "text-(--ui-texto-secundario) hover:bg-(--ui-hover-forte) hover:text-(--ui-texto-forte)",
                    )}
                  >
                    {senhaVisivel ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <div className="flex items-center justify-between pt-1">
                  <label
                    className={cn(
                      "flex cursor-pointer select-none items-center gap-2 text-[12px] font-medium",
                      "text-(--ui-texto-secundario)",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={rememberEmail}
                      onChange={(e) => setRememberEmail(e.target.checked)}
                      className={cn(
                        "h-4 w-4 rounded border text-blue-600",
                        isDarkMode
                          ? "border-(--border-strong) bg-(--bg-surface) focus:ring-blue-400/20"
                          : "border-slate-300 focus:ring-blue-500/20",
                      )}
                    />
                    Lembrar e-mail
                  </label>
                  <button
                    type="button"
                    onClick={onGoToForgot}
                    className="text-[12px] font-bold text-blue-600 hover:text-blue-700 transition-colors cursor-pointer"
                  >
                    Esqueceu a senha?
                  </button>
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={!email || !password}
              className={cn(
                "group relative mt-6 flex h-11 w-full items-center justify-center gap-2 rounded-xl px-4 text-sm font-bold text-white transition-all overflow-hidden cursor-pointer",
                "bg-(--ui-botao-primario) hover:bg-(--ui-botao-primario-hover) focus:outline-none focus:ring-4 focus:ring-(--ui-botao-primario-foco) active:scale-[0.98]",
                "disabled:pointer-events-none disabled:opacity-50",
              )}
            >
              <div className="absolute inset-0 -translate-x-full bg-linear-to-r from-transparent via-white/10 to-transparent group-hover:animate-shimmer" />
              Entrar na plataforma
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </button>
          </form>
        )}

        <div className="mt-8 text-center">
          <p
            className={cn(
              "text-[11px] font-bold",
              "text-(--ui-texto-secundario)",
            )}
          >
            Acesse sua conta ou comece gratuitamente.
          </p>
          <button
            type="button"
            onClick={onGoToSignup}
            className="mt-3 text-[12px] font-bold text-blue-600 transition-colors hover:text-blue-700 cursor-pointer"
          >
            Criar conta gratuita
          </button>

          <p
            className={cn(
              "mt-4 text-[11px] font-medium",
              "text-(--ui-texto-secundario)",
            )}
          >
            <a href="/termos" target="_blank" rel="noreferrer" className="hover:underline">
              Termos de Uso
            </a>
            {" · "}
            <a href="/privacidade" target="_blank" rel="noreferrer" className="hover:underline">
              Política de Privacidade
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
