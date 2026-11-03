import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Loader2, Lock, MailOpen, User } from "lucide-react";
import { buildApiUrl } from "../../../lib/api";
import { cn } from "../../../lib/utils";
import { useAuthStore } from "../../../store/use-auth-store";
import { toast } from "../../../store/use-toast-store";
import { FormError, SubmitButton } from "../../auth/components/signup-page";
import { AuthField } from "./account-form-fields";
import { AuthCard, SecondaryButton } from "./auth-card";

/** Convite guardado enquanto a pessoa faz login para aceitá-lo. */
export const PENDING_INVITE_STORAGE_KEY = "pauta_pending_invite";

interface InvitationDetails {
  email: string;
  organizationName: string;
  accountType: "personal" | "business" | null;
  inviterName: string | null;
  accessRole: "admin" | "member";
  hasAccount: boolean;
}

interface InvitationPageProps {
  onDone: () => void;
  onGoToLogin: () => void;
}

function getErrorMessage(error: unknown, fallback: string) {
  return axios.isAxiosError(error)
    ? (error.response?.data as { message?: string })?.message || fallback
    : fallback;
}

export function InvitationPage({ onDone, onGoToLogin }: InvitationPageProps) {
  const token = useMemo(
    () => new URLSearchParams(window.location.search).get("token") || "",
    [],
  );
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const authUser = useAuthStore((state) => state.user);
  const sessionToken = useAuthStore((state) => state.token);
  const applySession = useAuthStore((state) => state.applySession);
  const logout = useAuthStore((state) => state.logout);

  const [invitation, setInvitation] = useState<InvitationDetails | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setLoadError("Link de convite incompleto. Abra novamente o link recebido por e-mail.");
      return;
    }
    axios
      .get<InvitationDetails>(buildApiUrl("/api/invitations/lookup"), { params: { token } })
      .then((response) => setInvitation(response.data))
      .catch((error) => setLoadError(getErrorMessage(error, "Não foi possível abrir o convite.")));
  }, [token]);

  const finish = (session: { token: string; refreshToken: string; user: never; message?: string }) => {
    sessionStorage.removeItem(PENDING_INVITE_STORAGE_KEY);
    applySession(session);
    toast.success("Convite aceito.", { message: session.message });
    onDone();
  };

  const acceptAsLoggedUser = async () => {
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const response = await axios.post(
        buildApiUrl("/api/invitations/accept"),
        { token },
        { headers: { Authorization: `Bearer ${sessionToken}` } },
      );
      finish(response.data);
    } catch (error) {
      setSubmitError(getErrorMessage(error, "Não foi possível aceitar o convite."));
    } finally {
      setIsSubmitting(false);
    }
  };

  const acceptAsNewUser = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const response = await axios.post(buildApiUrl("/api/invitations/accept-new"), {
        token,
        name: name.trim(),
        password,
      });
      finish(response.data);
    } catch (error) {
      setSubmitError(getErrorMessage(error, "Não foi possível criar sua conta."));
    } finally {
      setIsSubmitting(false);
    }
  };

  const goToLoginKeepingInvite = () => {
    sessionStorage.setItem(PENDING_INVITE_STORAGE_KEY, token);
    onGoToLogin();
  };

  if (loadError) {
    return (
      <AuthCard icon={MailOpen} title="Convite indisponível" subtitle={loadError}>
        <SecondaryButton onClick={onDone}>Ir para o Pauta</SecondaryButton>
      </AuthCard>
    );
  }

  if (!invitation) {
    return (
      <AuthCard icon={MailOpen} title="Abrindo convite...">
        <div className="flex justify-center py-4">
          <Loader2 className={cn("h-5 w-5 animate-spin", "text-(--ui-texto-secundario)")} />
        </div>
      </AuthCard>
    );
  }

  const roleLabel = invitation.accessRole === "admin" ? "administrador(a)" : "membro";
  const subtitle = (
    <>
      {invitation.inviterName ?? "Um administrador"} convidou <strong>{invitation.email}</strong> para
      participar de <strong>{invitation.organizationName}</strong> como {roleLabel}.
    </>
  );
  const isSameEmail =
    isAuthenticated && authUser?.email?.toLowerCase() === invitation.email.toLowerCase();

  return (
    <AuthCard icon={MailOpen} title="Você recebeu um convite" subtitle={subtitle}>
      <div className="space-y-4">
        {submitError && <FormError message={submitError} />}

        {isAuthenticated ? (
          isSameEmail ? (
            <SubmitButton
              type="button"
              onClick={acceptAsLoggedUser}
              disabled={isSubmitting}
            >
              {isSubmitting ? "Entrando..." : `Entrar em ${invitation.organizationName}`}
            </SubmitButton>
          ) : (
            <>
              <p className={cn("text-center text-[13px] font-medium", "text-(--ui-texto-secundario)")}>
                Você está conectado como <strong>{authUser?.email}</strong>. Saia e entre com{" "}
                <strong>{invitation.email}</strong> para aceitar.
              </p>
              <SubmitButton
                type="button"
                onClick={() => {
                  sessionStorage.setItem(PENDING_INVITE_STORAGE_KEY, token);
                  logout();
                }}
              >
                Sair e trocar de conta
              </SubmitButton>
            </>
          )
        ) : invitation.hasAccount ? (
          <>
            <p className={cn("text-center text-[13px] font-medium", "text-(--ui-texto-secundario)")}>
              Você já tem cadastro no Pauta. Entre com {invitation.email} para aceitar.
            </p>
            <SubmitButton type="button" onClick={goToLoginKeepingInvite}>
              Entrar para aceitar
            </SubmitButton>
          </>
        ) : (
          <form onSubmit={acceptAsNewUser} className="space-y-5">
            <AuthField
              icon={User}
              label="Seu nome"
              placeholder="Nome completo"
              value={name}
              onChange={setName}
              autoComplete="name"
            />
            <AuthField
              icon={Lock}
              label="Crie uma senha"
              placeholder="Mínimo de 8 caracteres"
              type="password"
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
            />
            <SubmitButton
              type="submit"
              disabled={isSubmitting || name.trim().length < 3 || password.length < 8}
            >
              {isSubmitting ? "Criando conta..." : "Aceitar e criar conta"}
            </SubmitButton>
          </form>
        )}
      </div>
    </AuthCard>
  );
}
