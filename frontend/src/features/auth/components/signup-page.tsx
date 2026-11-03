import { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Lock,
  Mail,
  UserRound,
} from "lucide-react";
import { Skeleton } from "../../../components/ui/skeleton";
import { isValidEmail } from "../../../lib/documents";
import { cn } from "../../../lib/utils";
import { useAuthStore } from "../../../store/use-auth-store";
import {
  AccountTypeSelector,
  AuthField,
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
} from "../../account/components/account-form-fields";

interface SignupPageProps {
  onGoToLogin: () => void;
}

export function SignupPage({ onGoToLogin }: SignupPageProps) {
  const [step, setStep] = useState<"type" | "form">("type");
  const [accountType, setAccountType] = useState<AccountType | null>(null);
  const [person, setPerson] = useState(EMPTY_PERSON);
  const [company, setCompany] = useState(EMPTY_COMPANY);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // Aceite dos documentos é obrigatório para criar a conta.
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  const signup = useAuthStore((state) => state.signup);
  const isLoading = useAuthStore((state) => state.isLoading);
  const error = useAuthStore((state) => state.error);

  const isBusiness = accountType === "business";
  const cnpjLookup = useCnpjLookup(isBusiness ? company.cnpj : "");

  const canSubmit =
    accountType !== null &&
    isPersonReady(person) &&
    isValidEmail(email) &&
    password.length >= 8 &&
    acceptedTerms &&
    (!isBusiness || isCompanyReady(company, cnpjLookup));

  const handleBack = () => {
    if (step === "form") {
      setStep("type");
      return;
    }
    onGoToLogin();
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit || !accountType) return;

    await signup({
      accountType,
      ...buildPersonPayload(person),
      email: email.trim(),
      password,
      acceptedTerms,
      company: isBusiness ? buildCompanyPayload(company) : undefined,
    });
  };

  const HeaderIcon = step === "form" && !isBusiness ? UserRound : Building2;
  const title =
    step === "type"
      ? "Criar conta gratuita"
      : isBusiness
        ? "Conta empresarial"
        : "Conta pessoal";
  const subtitle =
    step === "type"
      ? "Como você vai usar o Pauta?"
      : isBusiness
        ? "Dados da empresa e do responsável pela conta."
        : "Seus dados como titular da conta.";

  return (
    <div className="pauta-auth-screen flex min-h-dvh items-center justify-center p-4 py-10">
      <div
        className={cn(
          "pauta-auth-card relative w-full rounded-2xl border p-5 sm:rounded-3xl sm:p-8 backdrop-blur-xl animate-in fade-in zoom-in-95 duration-500",
          step === "type" ? "max-w-115" : "max-w-140",
        )}
      >
        <button
          onClick={handleBack}
          className={cn(
            "absolute left-6 top-6 flex h-8 w-8 items-center justify-center rounded-full transition-colors cursor-pointer",
            "text-(--ui-texto-secundario) hover:bg-(--ui-hover-forte) hover:text-(--ui-texto-forte)",
          )}
          type="button"
          aria-label="Voltar"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>

        <div className="mb-8 mt-8 text-center">
          <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-linear-to-br from-blue-600 to-indigo-600 shadow-lg shadow-blue-500/30">
            <HeaderIcon className="h-7 w-7 text-white" />
          </div>
          <h1
            className={cn(
              "text-2xl font-black tracking-tight",
              "text-(--ui-texto-principal)",
            )}
          >
            {title}
          </h1>
          <p
            className={cn(
              "mt-2 text-sm font-medium",
              "text-(--ui-texto-secundario)",
            )}
          >
            {subtitle}
          </p>
        </div>

        {step === "type" ? (
          <div className="space-y-6">
            <AccountTypeSelector
              value={accountType}
              onChange={setAccountType}
            />
            <SubmitButton
              type="button"
              disabled={!accountType}
              onClick={() => setStep("form")}
            >
              Continuar
            </SubmitButton>
          </div>
        ) : isLoading ? (
          <div className="space-y-5 animate-in fade-in duration-200">
            {[0, 1, 2, 3, 4].map((item) => (
              <div className="space-y-2" key={item}>
                <Skeleton className="h-4 w-28 rounded-full" />
                <Skeleton className="h-11 w-full rounded-xl" />
              </div>
            ))}
            <Skeleton className="h-11 w-full rounded-xl" />
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            {error && <FormError message={error} />}

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
                <FormSectionTitle>
                  Responsável pela conta
                </FormSectionTitle>
              </>
            )}

            <PersonFields
              value={person}
              onChange={setPerson}
            />

            <FormSectionTitle>Acesso</FormSectionTitle>
            <AuthField
              icon={Mail}
              label="E-mail"
              placeholder={isBusiness ? "voce@empresa.com" : "voce@email.com"}
              type="email"
              value={email}
              onChange={setEmail}
              autoComplete="email"
            />
            <AuthField
              icon={Lock}
              label="Senha"
              placeholder="Mínimo de 8 caracteres"
              type="password"
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
            />

            <p
              className={cn(
                "text-[12px] font-medium leading-relaxed",
                "text-(--ui-texto-secundario)",
              )}
            >
              Cada CPF{isBusiness ? " e cada CNPJ" : ""} pode ter apenas uma
              conta no Pauta.
            </p>

            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={acceptedTerms}
                onChange={(event) => setAcceptedTerms(event.target.checked)}
                className="mt-0.5 h-4 w-4 cursor-pointer accent-blue-600"
              />
              <span
                className={cn(
                  "text-[12px] font-medium leading-snug",
                  "text-(--ui-texto-secundario)",
                )}
              >
                Li e concordo com os{" "}
                <a
                  href="/termos"
                  target="_blank"
                  rel="noreferrer"
                  className="font-bold text-blue-600 hover:underline"
                >
                  Termos de Uso
                </a>{" "}
                e com a{" "}
                <a
                  href="/privacidade"
                  target="_blank"
                  rel="noreferrer"
                  className="font-bold text-blue-600 hover:underline"
                >
                  Política de Privacidade
                </a>
                .
              </span>
            </label>

            <SubmitButton type="submit" disabled={!canSubmit}>
              Criar conta
            </SubmitButton>
          </form>
        )}
      </div>
    </div>
  );
}

export function FormError({
  message,
}: {
  message: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "rounded-xl border p-3 text-center text-[13px] font-bold animate-in slide-in-from-top-2",
        "border-(--ui-rose-borda) bg-(--ui-rose-fundo) text-(--ui-rose-texto)",
      )}
    >
      {message}
    </div>
  );
}

export function SubmitButton({
  children,
  className,
  ...buttonProps
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cn(
        "group relative flex h-11 w-full items-center justify-center gap-2 overflow-hidden rounded-xl px-4 text-sm font-bold text-white transition-all cursor-pointer",
        "bg-(--ui-botao-primario) hover:bg-(--ui-botao-primario-hover) focus:outline-none focus:ring-4 focus:ring-(--ui-botao-primario-foco) active:scale-[0.98]",
        "disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...buttonProps}
    >
      <div className="absolute inset-0 -translate-x-full bg-linear-to-r from-transparent via-white/10 to-transparent group-hover:animate-shimmer" />
      {children}
      <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
    </button>
  );
}
