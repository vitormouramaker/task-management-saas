import { useEffect, useState } from "react";
import axios from "axios";
import { Download, FileText, Loader2, ShieldCheck, Trash2, UserX } from "lucide-react";
import { Input } from "../../../components/ui/input";
import { buildApiUrl } from "../../../lib/api";
import { cn } from "../../../lib/utils";
import { useAuthStore } from "../../../store/use-auth-store";
import { toast } from "../../../store/use-toast-store";

interface PrivacySettingsSectionProps {
  accountName: string;
  isOwner: boolean;
}

function getErrorMessage(error: unknown, fallback: string) {
  return axios.isAxiosError(error)
    ? (error.response?.data as { message?: string })?.message || fallback
    : fallback;
}

/** LGPD: baixar os dados, excluir a conta ativa e excluir o próprio cadastro. */
export function PrivacySettingsSection({ accountName, isOwner }: PrivacySettingsSectionProps) {
  const token = useAuthStore((state) => state.token);
  const applySession = useAuthStore((state) => state.applySession);
  const logout = useAuthStore((state) => state.logout);

  const [isExporting, setIsExporting] = useState(false);
  const [openForm, setOpenForm] = useState<"organization" | "me" | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [password, setPassword] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  // Avisa quanto tempo de plano pago ainda resta antes de excluir.
  const [paidUntil, setPaidUntil] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    axios
      .get(buildApiUrl("/api/billing/subscription"), {
        headers: { Authorization: `Bearer ${token}` },
      })
      .then((response) => {
        const organization = response.data?.organization;
        const endsAt = organization?.periodEnd ? new Date(organization.periodEnd) : null;
        setPaidUntil(endsAt && endsAt.getTime() > Date.now() ? organization.periodEnd : null);
      })
      .catch(() => setPaidUntil(null));
  }, [token]);

  const diasPagosRestantes = paidUntil
    ? Math.max(
        1,
        Math.ceil((new Date(paidUntil).getTime() - Date.now()) / (24 * 60 * 60 * 1000)),
      )
    : 0;

  const headers = { Authorization: `Bearer ${token}` };

  const exportData = async () => {
    setIsExporting(true);
    try {
      const response = await axios.get(buildApiUrl("/api/account/export"), {
        headers,
        responseType: "blob",
      });
      const url = URL.createObjectURL(response.data);
      const link = document.createElement("a");
      link.href = url;
      link.download = `pauta-meus-dados-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Não foi possível exportar os dados.", {
        message: "Tente novamente em instantes.",
      });
    } finally {
      setIsExporting(false);
    }
  };

  const openDeleteForm = (form: "organization" | "me") => {
    setOpenForm(form);
    setConfirmation("");
    setPassword("");
  };

  const confirmDelete = async () => {
    if (!openForm) return;
    setIsDeleting(true);
    try {
      const response =
        openForm === "organization"
          ? await axios.delete(buildApiUrl("/api/account/organization"), {
              headers,
              data: { password, confirmName: confirmation },
            })
          : await axios.delete(buildApiUrl("/api/account/me"), {
              headers,
              data: { password, confirm: confirmation },
            });

      toast.success(openForm === "organization" ? "Conta excluída." : "Cadastro excluído.", {
        message: response.data?.message,
      });
      if (response.data?.loggedOut || !response.data?.token) {
        logout();
      } else {
        applySession(response.data);
      }
    } catch (error) {
      toast.error("Não foi possível excluir.", {
        message: getErrorMessage(error, "Tente novamente em instantes."),
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const cardClass = cn(
    "rounded-2xl border p-6",
    "border-(--ui-borda) bg-(--ui-superficie)",
  );
  const mutedClass = "text-(--ui-texto-secundario)";
  const expectedConfirmation = openForm === "organization" ? accountName : "EXCLUIR";
  const canConfirm = confirmation.trim() === expectedConfirmation && password.length > 0;

  return (
    <section className={cardClass}>
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-emerald-500/10 text-emerald-600">
          <ShieldCheck className="h-4 w-4" />
        </span>
        <div>
          <h3 className={cn("text-sm font-black", "text-(--ui-texto-principal)")}>
            Privacidade e dados (LGPD)
          </h3>
          <p className={cn("mt-1 text-sm font-medium", mutedClass)}>
            Baixe uma cópia dos seus dados ou exclua informações do Pauta. Leia os{" "}
            <a href="/termos" target="_blank" rel="noreferrer" className="font-bold text-blue-600 hover:underline">
              Termos de Uso
            </a>{" "}
            e a{" "}
            <a href="/privacidade" target="_blank" rel="noreferrer" className="font-bold text-blue-600 hover:underline">
              Política de Privacidade
            </a>
            .
          </p>
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <button
          type="button"
          onClick={exportData}
          disabled={isExporting}
          className={cn(
            "inline-flex h-10 items-center justify-center gap-2 rounded-xl border px-4 text-sm font-bold transition-colors cursor-pointer disabled:opacity-50",
            "border-(--ui-borda) text-(--ui-texto-item) hover:bg-(--ui-hover)",
          )}
        >
          {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          Baixar meus dados
        </button>
        {isOwner && (
          <button
            type="button"
            onClick={() => openDeleteForm("organization")}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-rose-300 px-4 text-sm font-bold text-rose-600 transition-colors hover:bg-rose-50 cursor-pointer dark:hover:bg-rose-500/10"
          >
            <Trash2 className="h-4 w-4" />
            Excluir este espaço de trabalho
          </button>
        )}
        <button
          type="button"
          onClick={() => openDeleteForm("me")}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-rose-300 px-4 text-sm font-bold text-rose-600 transition-colors hover:bg-rose-50 cursor-pointer dark:hover:bg-rose-500/10"
        >
          <UserX className="h-4 w-4" />
          Excluir meu cadastro
        </button>
      </div>

      <div
        className={cn(
          "mt-5 flex flex-col gap-2 border-t pt-4 sm:flex-row sm:items-center",
          "border-(--ui-borda-suave)",
        )}
      >
        <span className={cn("text-[12px] font-bold sm:mr-2", mutedClass)}>Documentos legais</span>
        {[
          { href: "/termos", label: "Termos de Uso" },
          { href: "/privacidade", label: "Política de Privacidade" },
        ].map((documento) => (
          <a
            key={documento.href}
            href={documento.href}
            target="_blank"
            rel="noreferrer"
            className={cn(
              "inline-flex h-9 items-center justify-center gap-2 rounded-xl border px-3 text-[13px] font-bold transition-colors",
              "border-(--ui-borda) text-(--ui-texto-item) hover:bg-(--ui-hover)",
            )}
          >
            <FileText className="h-4 w-4" />
            {documento.label}
          </a>
        ))}
      </div>

      {openForm && (
        <div
          className={cn(
            "mt-5 space-y-4 rounded-2xl border p-4",
            "border-(--ui-rose-borda) bg-(--ui-rose-fundo)",
          )}
        >
          {diasPagosRestantes > 0 && (
            <p
              className={cn(
                "rounded-xl px-3 py-2 text-[13px] font-bold",
                "bg-(--ui-ambar-fundo) text-(--ui-ambar-texto)",
              )}
            >
              Você ainda tem {diasPagosRestantes} dia(s) de plano já pago. Se excluir agora,
              esse tempo é perdido e não devolvemos o valor. Quer mesmo continuar?
            </p>
          )}

          <p className={cn("text-[13px] font-medium", "text-(--ui-rose-texto)")}>
            {openForm === "organization" ? (
              <>
                Isso apaga <strong>definitivamente</strong> o espaço{" "}
                <strong>{accountName}</strong>: espaços de trabalho, projetos, cards, comentários,
                arquivos e membros. Não é possível desfazer.
                <br />
                <br />
                Seu <strong>cadastro pessoal continua existindo</strong> (nome, e-mail e CPF).
                Para apagar também o cadastro e liberar o CPF, use "Excluir meu cadastro".
                <br />
                <br />
                Para confirmar, digite o nome do espaço e sua senha.
              </>
            ) : (
              <>
                Isso remove seu login e seus dados pessoais, e <strong>libera o seu CPF</strong>{" "}
                para um cadastro novo. Seus comentários e cards em espaços de outras pessoas
                continuam, sem identificação. Espaços dos quais você é o único membro também são
                apagados. Digite <strong>EXCLUIR</strong> e sua senha.
              </>
            )}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              placeholder={expectedConfirmation}
              className={cn("h-11 rounded-xl", "bg-(--ui-superficie-campo)")}
            />
            <Input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Sua senha"
              autoComplete="current-password"
              className={cn("h-11 rounded-xl", "bg-(--ui-superficie-campo)")}
            />
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => setOpenForm(null)}
              className={cn(
                "h-10 rounded-xl px-4 text-sm font-bold transition-colors cursor-pointer",
                "text-(--ui-texto-secundario) hover:bg-(--ui-hover)",
              )}
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={confirmDelete}
              disabled={!canConfirm || isDeleting}
              className="h-10 rounded-xl bg-rose-600 px-4 text-sm font-bold text-white transition-colors hover:bg-rose-700 disabled:opacity-50 disabled:pointer-events-none cursor-pointer"
            >
              {isDeleting ? "Excluindo..." : "Excluir definitivamente"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
