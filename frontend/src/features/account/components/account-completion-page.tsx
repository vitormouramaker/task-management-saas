import { useEffect, useState } from "react";
import axios from "axios";
import { ArrowRightLeft, LogOut, ShieldCheck } from "lucide-react";
import type { AccountSummary } from "./account-switcher";
import { buildApiUrl } from "../../../lib/api";
import { cn } from "../../../lib/utils";
import { useAuthStore } from "../../../store/use-auth-store";
import { toast } from "../../../store/use-toast-store";
import { FormError, SubmitButton } from "../../auth/components/signup-page";
import {
  AccountTypeSelector,
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

/**
 * Tela obrigatória para o titular de contas criadas antes do cadastro com
 * CPF/CNPJ. Não altera workspaces, projetos, cards nem arquivos.
 */
export function AccountCompletionPage() {
  const authUser = useAuthStore((state) => state.user);
  const token = useAuthStore((state) => state.token);
  const logout = useAuthStore((state) => state.logout);

  const [accountType, setAccountType] = useState<AccountType | null>(null);
  const [person, setPerson] = useState({
    ...EMPTY_PERSON,
    name: authUser?.name ?? "",
  });
  const [company, setCompany] = useState({
    ...EMPTY_COMPANY,
    tradeName: authUser?.organization?.name ?? "",
  });
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [otherAccounts, setOtherAccounts] = useState<AccountSummary[]>([]);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const switchOrganization = useAuthStore((state) => state.switchOrganization);

  // Quem também participa de outras contas (ex.: aceitou um convite) pode seguir por elas.
  useEffect(() => {
    if (!token) return;
    axios
      .get<{ accounts: AccountSummary[] }>(buildApiUrl("/api/account/list"), {
        headers: { Authorization: `Bearer ${token}` },
      })
      .then((response) =>
        setOtherAccounts((response.data.accounts ?? []).filter((account) => !account.isActive)),
      )
      .catch(() => setOtherAccounts([]));
  }, [token]);

  const enterAccount = async (account: AccountSummary) => {
    setSwitchingId(account.id);
    try {
      await switchOrganization(account.id);
      toast.success("Conta alterada.", { message: `Você está em ${account.name}.` });
    } catch {
      toast.error("Não foi possível trocar de conta.", { message: "Tente novamente em instantes." });
    } finally {
      setSwitchingId(null);
    }
  };

  const isBusiness = accountType === "business";
  const hasHolderData = authUser?.personalDataComplete === true;
  const cnpjLookup = useCnpjLookup(isBusiness ? company.cnpj : "");
  const canSubmit =
    accountType !== null &&
    (hasHolderData || isPersonReady(person)) &&
    (!isBusiness || isCompanyReady(company, cnpjLookup));

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit || !accountType) return;

    setIsSaving(true);
    setError(null);
    try {
      const response = await axios.post(
        buildApiUrl("/api/account/complete"),
        {
          accountType,
          ...(hasHolderData ? {} : buildPersonPayload(person)),
          company: isBusiness ? buildCompanyPayload(company) : undefined,
        },
        { headers: { Authorization: `Bearer ${token}` } },
      );
      useAuthStore.setState({ user: response.data.user });
      toast.success("Dados salvos.", {
        message: "Tudo pronto para continuar usando o Pauta.",
      });
    } catch (requestError) {
      const message = axios.isAxiosError(requestError)
        ? (requestError.response?.data as { message?: string })?.message
        : null;
      setError(message || "Não foi possível salvar os dados. Tente novamente.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="pauta-auth-screen flex min-h-dvh items-center justify-center p-4 py-10">
      <div className="pauta-auth-card relative w-full max-w-140 rounded-2xl border p-5 sm:rounded-3xl sm:p-8 backdrop-blur-xl animate-in fade-in zoom-in-95 duration-500">
        <button
          type="button"
          onClick={logout}
          className={cn(
            "absolute right-6 top-6 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition-colors cursor-pointer",
            "text-(--ui-texto-secundario) hover:bg-(--ui-hover-forte) hover:text-(--ui-texto-forte)",
          )}
        >
          <LogOut className="h-3.5 w-3.5" />
          Sair
        </button>

        <div className="mb-8 mt-8 text-center">
          <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-linear-to-br from-blue-600 to-indigo-600 shadow-lg shadow-blue-500/30">
            <ShieldCheck className="h-7 w-7 text-white" />
          </div>
          <h1
            className={cn(
              "text-2xl font-black tracking-tight",
              "text-(--ui-texto-principal)",
            )}
          >
            Complete os dados da conta
          </h1>
          <p
            className={cn(
              "mt-2 text-sm font-medium",
              "text-(--ui-texto-secundario)",
            )}
          >
            Como titular de{" "}
            <strong>{authUser?.organization?.name ?? "sua conta"}</strong>,
            informe seus dados para continuar. Nada do que já existe na conta
            (espaços de trabalho, projetos, cards e arquivos) será alterado.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {error && <FormError message={error} />}

          {accountType === null ? (
            <>
              <FormSectionTitle>
                Tipo de conta
              </FormSectionTitle>
              <AccountTypeSelector
                value={accountType}
                onChange={setAccountType}
              />
            </>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <span
                className={cn(
                  "inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-black",
                  "bg-(--ui-fundo-neutro) text-(--ui-texto-forte)",
                )}
              >
                {isBusiness ? "Conta empresarial" : "Conta pessoal"}
              </span>
              <button
                type="button"
                onClick={() => setAccountType(null)}
                className="text-xs font-bold text-blue-600 hover:underline cursor-pointer"
              >
                Trocar tipo
              </button>
            </div>
          )}

          {accountType && (
            <>
              {isBusiness && (
                <>
                  <FormSectionTitle>
                    Empresa
                  </FormSectionTitle>
                  <CompanyFields
                    value={company}
                    onChange={setCompany}
                    lookup={cnpjLookup}
                  />
                </>
              )}

              <FormSectionTitle>
                {isBusiness ? "Responsável pela conta" : "Titular da conta"}
              </FormSectionTitle>
              {hasHolderData ? (
                <p
                  className={cn(
                    "rounded-xl border px-4 py-3 text-[13px] font-medium",
                    "border-(--ui-borda) bg-(--ui-fundo-sutil) text-(--ui-texto-secundario)",
                  )}
                >
                  Vamos usar os dados que você já cadastrou: <strong>{authUser?.name}</strong>,
                  com o CPF, o celular e a data de nascimento informados antes.
                </p>
              ) : (
                <PersonFields
                  value={person}
                  onChange={setPerson}
                />
              )}
            </>
          )}

          <SubmitButton
            type="submit"
            disabled={!canSubmit || isSaving}
          >
            {isSaving ? "Salvando..." : "Salvar e continuar"}
          </SubmitButton>
        </form>

        {otherAccounts.length > 0 && (
          <div
            className={cn(
              "mt-6 space-y-2 border-t pt-5",
              "border-(--ui-borda-suave)",
            )}
          >
            <p
              className={cn(
                "text-[13px] font-medium",
                "text-(--ui-texto-secundario)",
              )}
            >
              Não quer completar esta conta agora? Entre em outra conta sua:
            </p>
            {otherAccounts.map((account) => (
              <button
                key={account.id}
                type="button"
                onClick={() => enterAccount(account)}
                disabled={Boolean(switchingId)}
                className={cn(
                  "flex h-11 w-full items-center justify-between gap-2 rounded-xl border px-4 text-sm font-bold transition-colors cursor-pointer disabled:opacity-50",
                  "border-(--ui-borda) text-(--ui-texto-forte) hover:bg-(--ui-hover)",
                )}
              >
                <span className="truncate">{account.name}</span>
                <ArrowRightLeft className="h-4 w-4 shrink-0 text-blue-600" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
