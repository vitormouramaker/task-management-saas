import { useState } from "react";
import axios from "axios";
import { KeyRound, Loader2, LogOut, Mail, ShieldCheck } from "lucide-react";
import { Input } from "../../../components/ui/input";
import { buildApiUrl } from "../../../lib/api";
import { cn } from "../../../lib/utils";
import { useAuthStore } from "../../../store/use-auth-store";
import { toast } from "../../../store/use-toast-store";

type OpenForm = "password" | "email" | null;

function getErrorMessage(error: unknown, fallback: string) {
  return axios.isAxiosError(error)
    ? (error.response?.data as { message?: string })?.message || fallback
    : fallback;
}

/** Trocar senha, trocar e-mail e encerrar as sessões abertas. */
export function SecuritySettingsSection() {
  const token = useAuthStore((state) => state.token);
  const currentEmail = useAuthStore((state) => state.user?.email);
  const applySession = useAuthStore((state) => state.applySession);
  const logoutAllDevices = useAuthStore((state) => state.logoutAllDevices);

  const [openForm, setOpenForm] = useState<OpenForm>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [email, setEmail] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isLeavingAll, setIsLeavingAll] = useState(false);

  const headers = { Authorization: `Bearer ${token}` };

  const openSection = (form: Exclude<OpenForm, null>) => {
    setOpenForm((current) => (current === form ? null : form));
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setEmail("");
  };

  const changePassword = async () => {
    if (newPassword.length < 8) {
      toast.error("A nova senha deve ter pelo menos 8 caracteres.");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("A confirmação não confere com a nova senha.");
      return;
    }

    setIsSaving(true);
    try {
      const response = await axios.put(
        buildApiUrl("/api/account/password"),
        { currentPassword, newPassword },
        { headers },
      );
      applySession(response.data);
      setOpenForm(null);
      toast.success("Senha alterada.", {
        message: "As sessões abertas em outros aparelhos foram encerradas.",
      });
    } catch (error) {
      toast.error(getErrorMessage(error, "Não foi possível alterar a senha."));
    } finally {
      setIsSaving(false);
    }
  };

  const changeEmail = async () => {
    setIsSaving(true);
    try {
      const response = await axios.put(
        buildApiUrl("/api/account/email"),
        { password: currentPassword, email },
        { headers },
      );
      applySession(response.data);
      setOpenForm(null);
      toast.success("E-mail alterado.", {
        message: "Confirme o novo endereço pelo link que enviamos para ele.",
      });
    } catch (error) {
      toast.error(getErrorMessage(error, "Não foi possível alterar o e-mail."));
    } finally {
      setIsSaving(false);
    }
  };

  const leaveAllDevices = async () => {
    setIsLeavingAll(true);
    const success = await logoutAllDevices();
    setIsLeavingAll(false);
    if (!success) {
      toast.error("Não foi possível encerrar as sessões.", {
        message: "Tente novamente em instantes.",
      });
    }
  };

  const cardClass = cn(
    "rounded-2xl border p-6",
    "border-(--ui-borda) bg-(--ui-superficie)",
  );
  const mutedClass = "text-(--ui-texto-secundario)";
  const outlineButtonClass = cn(
    "inline-flex h-10 items-center justify-center gap-2 rounded-xl border px-4 text-sm font-bold transition-colors cursor-pointer disabled:opacity-50",
    "border-(--ui-borda) text-(--ui-texto-item) hover:bg-(--ui-hover)",
  );

  return (
    <section className={cardClass}>
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-blue-500/10 text-blue-600">
          <ShieldCheck className="h-4 w-4" />
        </span>
        <div>
          <h3
            className={cn(
              "text-sm font-black",
              "text-(--ui-texto-principal)",
            )}
          >
            Acesso e segurança
          </h3>
          <p className={cn("mt-1 text-sm font-medium", mutedClass)}>
            Seu acesso hoje é <strong>{currentEmail}</strong>. Trocar a senha ou o e-mail
            encerra as sessões abertas nos outros aparelhos.
          </p>
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <button type="button" onClick={() => openSection("password")} className={outlineButtonClass}>
          <KeyRound className="h-4 w-4" />
          Trocar senha
        </button>
        <button type="button" onClick={() => openSection("email")} className={outlineButtonClass}>
          <Mail className="h-4 w-4" />
          Trocar e-mail
        </button>
        <button
          type="button"
          onClick={leaveAllDevices}
          disabled={isLeavingAll}
          className={outlineButtonClass}
        >
          {isLeavingAll ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <LogOut className="h-4 w-4" />
          )}
          Sair de todos os aparelhos
        </button>
      </div>

      {openForm && (
        <div
          className={cn(
            "mt-5 space-y-4 rounded-2xl border p-4",
            "border-(--ui-borda) bg-(--ui-fundo-sutil)",
          )}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1.5">
              <span className={cn("text-[12px] font-bold", mutedClass)}>Senha atual</span>
              <Input
                type="password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                autoComplete="current-password"
              />
            </label>

            {openForm === "password" ? (
              <>
                <label className="space-y-1.5">
                  <span className={cn("text-[12px] font-bold", mutedClass)}>
                    Nova senha (mínimo 8 caracteres)
                  </span>
                  <Input
                    type="password"
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    autoComplete="new-password"
                  />
                </label>
                <label className="space-y-1.5">
                  <span className={cn("text-[12px] font-bold", mutedClass)}>
                    Repita a nova senha
                  </span>
                  <Input
                    type="password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    autoComplete="new-password"
                  />
                </label>
              </>
            ) : (
              <label className="space-y-1.5">
                <span className={cn("text-[12px] font-bold", mutedClass)}>Novo e-mail</span>
                <Input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                />
              </label>
            )}
          </div>

          {openForm === "email" && (
            <p className={cn("text-[12px] font-medium", mutedClass)}>
              Enviaremos um link de confirmação para o endereço novo. Até confirmar, o
              acesso fica limitado à tela de confirmação.
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={openForm === "password" ? changePassword : changeEmail}
              disabled={
                isSaving ||
                currentPassword.length === 0 ||
                (openForm === "password" ? newPassword.length === 0 : email.trim().length === 0)
              }
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-bold text-white transition-colors hover:bg-blue-700 cursor-pointer disabled:opacity-50"
            >
              {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
              Salvar
            </button>
            <button type="button" onClick={() => setOpenForm(null)} className={outlineButtonClass}>
              Cancelar
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
