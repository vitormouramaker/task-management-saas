import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { Clock3, Loader2, MailPlus, RotateCw, X } from "lucide-react";
import { buildApiUrl } from "../../../lib/api";
import { cn } from "../../../lib/utils";
import { useAuthStore } from "../../../store/use-auth-store";
import { toast } from "../../../store/use-toast-store";

interface PendingInvitation {
  id: string;
  email: string;
  accessRole: "admin" | "member";
  jobTitle: string | null;
  expiresAt: string;
  expired: boolean;
  invitedByName: string | null;
}

function getErrorMessage(error: unknown, fallback: string) {
  return axios.isAxiosError(error)
    ? (error.response?.data as { message?: string })?.message || fallback
    : fallback;
}

/** Convites enviados e ainda não aceitos da conta ativa (visível para administradores). */
export function PendingInvitations({ refreshKey }: { refreshKey: number }) {
  const token = useAuthStore((state) => state.token);
  const organizationId = useAuthStore((state) => state.user?.organization?.id);

  const [invitations, setInvitations] = useState<PendingInvitation[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadInvitations = useCallback(async () => {
    if (!token) return;
    try {
      const response = await axios.get<{ invitations: PendingInvitation[] }>(
        buildApiUrl("/api/invitations"),
        { headers: { Authorization: `Bearer ${token}` } },
      );
      setInvitations(response.data.invitations ?? []);
    } catch {
      setInvitations([]);
    }
  }, [token]);

  useEffect(() => {
    loadInvitations();
  }, [loadInvitations, refreshKey, organizationId]);

  const runAction = async (invitation: PendingInvitation, action: "resend" | "cancel") => {
    setBusyId(invitation.id);
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const response =
        action === "resend"
          ? await axios.post(buildApiUrl(`/api/invitations/${invitation.id}/resend`), {}, { headers })
          : await axios.delete(buildApiUrl(`/api/invitations/${invitation.id}`), { headers });
      toast.success(action === "resend" ? "Convite reenviado." : "Convite cancelado.", {
        message: response.data?.message,
      });
      await loadInvitations();
    } catch (error) {
      toast.error("Não foi possível concluir a ação.", {
        message: getErrorMessage(error, "Tente novamente em instantes."),
      });
    } finally {
      setBusyId(null);
    }
  };

  if (invitations.length === 0) {
    return null;
  }

  return (
    <section
      className={cn(
        "mb-6 rounded-2xl border p-4",
        "border-(--ui-borda) bg-(--ui-superficie)",
      )}
    >
      <div className="mb-3 flex items-center gap-2">
        <MailPlus className="h-4 w-4 text-blue-600" />
        <h2 className={cn("text-sm font-black", "text-(--ui-texto-principal)")}>
          Convites pendentes ({invitations.length})
        </h2>
      </div>

      <ul className="divide-y divide-(--border-subtle)">
        {invitations.map((invitation) => (
          <li key={invitation.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
            <div className="min-w-0">
              <p className={cn("truncate text-[13px] font-bold", "text-(--ui-texto-principal)")}>
                {invitation.email}
              </p>
              <p className={cn("flex flex-wrap items-center gap-1.5 text-[11px] font-medium", "text-(--ui-texto-secundario)")}>
                {invitation.accessRole === "admin" ? "Administrador" : "Membro"}
                {invitation.jobTitle ? ` · ${invitation.jobTitle}` : ""}
                {invitation.invitedByName ? ` · convidado por ${invitation.invitedByName}` : ""}
                {invitation.expired && (
                  <span className="inline-flex items-center gap-1 text-amber-600">
                    <Clock3 className="h-3 w-3" />
                    expirado
                  </span>
                )}
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              {busyId === invitation.id ? (
                <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => runAction(invitation, "resend")}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-bold transition-colors cursor-pointer",
                      "text-(--ui-texto-secundario) hover:bg-(--ui-azul-fundo) hover:text-(--ui-azul-texto)",
                    )}
                  >
                    <RotateCw className="h-3 w-3" />
                    Reenviar
                  </button>
                  <button
                    type="button"
                    onClick={() => runAction(invitation, "cancel")}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-bold transition-colors cursor-pointer",
                      "text-(--ui-texto-secundario) hover:bg-(--ui-rose-fundo) hover:text-(--ui-rose-texto)",
                    )}
                  >
                    <X className="h-3 w-3" />
                    Cancelar
                  </button>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
