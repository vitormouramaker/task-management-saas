import { useState } from "react";
import { createPortal } from "react-dom";
import axios from "axios";
import { Building2, UserRound, X } from "lucide-react";
import { buildApiUrl } from "../../../lib/api";
import { cn } from "../../../lib/utils";
import { useAuthStore } from "../../../store/use-auth-store";
import { toast } from "../../../store/use-toast-store";
import { FormError, SubmitButton } from "../../auth/components/signup-page";
import { useFecharComEsc } from "../../../lib/use-fechar-com-esc";
import {
  CompanyFields,
  EMPTY_COMPANY,
  EMPTY_PERSON,
  FormSectionTitle,
  PersonFields,
  buildCompanyPayload,
  buildPersonPayload,
  isCompanyReady,
  isPersonReady,
  useCnpjLookup,
  type AccountType,
} from "./account-form-fields";

interface CreateAccountModalProps {
  mode: AccountType;
  /** A pessoa já informou CPF, celular e nascimento em outra conta. */
  hasHolderData: boolean;
  onClose: () => void;
}

export function CreateAccountModal({
  mode,
  hasHolderData,
  onClose,
}: CreateAccountModalProps) {
  const authUser = useAuthStore((state) => state.user);
  const token = useAuthStore((state) => state.token);
  const applySession = useAuthStore((state) => state.applySession);

  const [person, setPerson] = useState({
    ...EMPTY_PERSON,
    name: authUser?.name ?? "",
  });
  const [company, setCompany] = useState(EMPTY_COMPANY);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isBusiness = mode === "business";
  const cnpjLookup = useCnpjLookup(isBusiness ? company.cnpj : "");
  const canSubmit =
    (hasHolderData || isPersonReady(person)) &&
    (!isBusiness || isCompanyReady(company, cnpjLookup));

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;

    setIsSaving(true);
    setError(null);
    try {
      const response = await axios.post(
        buildApiUrl(isBusiness ? "/api/account/business" : "/api/account/personal"),
        {
          person: hasHolderData ? undefined : buildPersonPayload(person),
          company: isBusiness ? buildCompanyPayload(company) : undefined,
        },
        { headers: { Authorization: `Bearer ${token}` } },
      );
      applySession(response.data);
      toast.success(isBusiness ? "Conta empresarial criada." : "Espaço pessoal criado.", {
        message: `Você está em ${response.data.user?.organization?.name ?? "sua nova conta"}.`,
      });
      onClose();
    } catch (requestError) {
      const message = axios.isAxiosError(requestError)
        ? (requestError.response?.data as { message?: string })?.message
        : null;
      setError(message || "Não foi possível criar a conta. Tente novamente.");
    } finally {
      setIsSaving(false);
    }
  };

  const Icon = isBusiness ? Building2 : UserRound;

  // Esc fecha a janela, como em qualquer aplicativo.

  useFecharComEsc(true, onClose);

  return createPortal(
    <div className="fixed inset-0 z-9999 flex items-end justify-center sm:items-center sm:p-4">
      <button
        type="button"
        aria-label="Fechar"
        onClick={onClose}
        className="pauta-theme-overlay absolute inset-0 backdrop-blur-sm"
      />
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          "relative flex max-h-dvh w-full flex-col overflow-hidden border shadow-2xl animate-in fade-in zoom-in-95 duration-200 sm:max-h-[90dvh] sm:max-w-xl sm:rounded-3xl",
          "border-(--ui-borda) bg-(--ui-superficie)",
        )}
      >
        <div
          className={cn(
            "flex items-start justify-between gap-4 border-b px-6 py-5",
            "border-(--ui-borda-suave)",
          )}
        >
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-linear-to-br from-blue-600 to-indigo-600 text-white">
              <Icon className="h-5 w-5" />
            </span>
            <div>
              <h2
                className={cn(
                  "text-lg font-black",
                  "text-(--ui-texto-principal)",
                )}
              >
                {isBusiness ? "Criar conta empresarial" : "Criar espaço pessoal"}
              </h2>
              <p
                className={cn(
                  "text-[13px] font-medium",
                  "text-(--ui-texto-secundario)",
                )}
              >
                {isBusiness
                  ? "Suas outras contas continuam existindo. Você alterna entre elas no topo da barra lateral."
                  : "Um espaço só seu para organizar projetos pessoais."}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className={cn(
              "grid h-8 w-8 shrink-0 place-items-center rounded-full transition-colors cursor-pointer",
              "text-(--ui-texto-secundario) hover:bg-(--ui-hover-forte) hover:text-(--ui-texto-forte)",
            )}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {error && <FormError message={error} />}

          {isBusiness && (
            <>
              <FormSectionTitle>Empresa</FormSectionTitle>
              <CompanyFields
                value={company}
                onChange={setCompany}
                lookup={cnpjLookup}
              />
            </>
          )}

          {hasHolderData ? (
            <p
              className={cn(
                "rounded-xl border px-4 py-3 text-[13px] font-medium",
                "border-(--ui-borda) bg-(--ui-fundo-sutil) text-(--ui-texto-secundario)",
              )}
            >
              {isBusiness
                ? "Você será o responsável pela conta com os dados pessoais que já informou."
                : "O espaço usa os dados pessoais que você já informou."}
            </p>
          ) : (
            <>
              <FormSectionTitle>
                {isBusiness ? "Responsável pela conta" : "Seus dados"}
              </FormSectionTitle>
              <PersonFields value={person} onChange={setPerson} />
            </>
          )}

          <SubmitButton
            type="submit"
            disabled={!canSubmit || isSaving}
          >
            {isSaving ? "Criando..." : isBusiness ? "Criar conta empresarial" : "Criar espaço pessoal"}
          </SubmitButton>
        </form>
      </div>
    </div>,
    document.body,
  );
}
