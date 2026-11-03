import { useEffect, useRef, useState } from "react";
import axios from "axios";
import {
  BadgeCheck,
  Briefcase,
  Building2,
  CalendarDays,
  Clock3,
  Hash,
  Loader2,
  Phone,
  User,
  UserRound,
} from "lucide-react";
import { Input } from "../../../components/ui/input";
import { buildApiUrl } from "../../../lib/api";
import {
  formatCnpj,
  formatCpf,
  formatPhone,
  getAdultBirthDateLimit,
  isValidCnpj,
  isValidCpf,
  normalizeCnpj,
  onlyDigits,
} from "../../../lib/documents";
import { cn } from "../../../lib/utils";

export type AccountType = "personal" | "business";

export interface PersonFormValue {
  name: string;
  cpf: string;
  phone: string;
  birthDate: string;
}

export interface CompanyFormValue {
  cnpj: string;
  tradeName: string;
}

export const EMPTY_PERSON: PersonFormValue = {
  name: "",
  cpf: "",
  phone: "",
  birthDate: "",
};

export const EMPTY_COMPANY: CompanyFormValue = { cnpj: "", tradeName: "" };

export type CnpjLookupState =
  | { status: "idle" }
  | { status: "loading" }
  | {
      status: "active" | "pending";
      legalName: string | null;
      tradeName: string | null;
      registrationStatus: string | null;
    }
  | { status: "error"; message: string };

export function isPersonReady(person: PersonFormValue) {
  const phoneDigits = onlyDigits(person.phone);
  return (
    person.name.trim().length >= 3 &&
    isValidCpf(person.cpf) &&
    (phoneDigits.length === 10 || phoneDigits.length === 11) &&
    Boolean(person.birthDate)
  );
}

export function isCompanyReady(
  company: CompanyFormValue,
  lookup: CnpjLookupState,
) {
  return (
    isValidCnpj(company.cnpj) &&
    company.tradeName.trim().length >= 2 &&
    (lookup.status === "active" || lookup.status === "pending")
  );
}

export function buildPersonPayload(person: PersonFormValue) {
  return {
    name: person.name.trim(),
    cpf: onlyDigits(person.cpf),
    phone: onlyDigits(person.phone),
    birthDate: person.birthDate,
  };
}

export function buildCompanyPayload(company: CompanyFormValue) {
  return {
    cnpj: normalizeCnpj(company.cnpj),
    tradeName: company.tradeName.trim(),
  };
}

/** Consulta o CNPJ na Receita (via back-end) assim que os 14 caracteres forem digitados. */
export function useCnpjLookup(cnpj: string): CnpjLookupState {
  const normalized = normalizeCnpj(cnpj);
  const [state, setState] = useState<CnpjLookupState>({ status: "idle" });

  useEffect(() => {
    if (normalized.length < 14) {
      setState({ status: "idle" });
      return;
    }
    if (!isValidCnpj(normalized)) {
      setState({ status: "error", message: "CNPJ inválido." });
      return;
    }

    let cancelled = false;
    setState({ status: "loading" });

    axios
      .get(buildApiUrl(`/api/account/cnpj/${normalized}`))
      .then(({ data }) => {
        if (cancelled) return;

        if (data.status === "active" || data.status === "unavailable") {
          setState({
            status: data.status === "active" ? "active" : "pending",
            legalName: data.legalName ?? null,
            tradeName: data.tradeName ?? null,
            registrationStatus: data.registrationStatus ?? null,
          });
        } else if (data.status === "inactive") {
          setState({
            status: "error",
            message: `CNPJ com situação "${data.registrationStatus ?? "irregular"}" na Receita Federal. Só é possível usar CNPJ ativo.`,
          });
        } else {
          setState({
            status: "error",
            message: "CNPJ não encontrado na Receita Federal.",
          });
        }
      })
      .catch((error) => {
        if (cancelled) return;

        const response = axios.isAxiosError(error) ? error.response : undefined;
        if (response && response.status < 500) {
          setState({
            status: "error",
            message:
              (response.data as { message?: string })?.message ||
              "Não foi possível validar o CNPJ.",
          });
          return;
        }

        // Back-end ou Receita indisponível: segue com verificação pendente.
        setState({
          status: "pending",
          legalName: null,
          tradeName: null,
          registrationStatus: null,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [normalized]);

  return state;
}

interface AuthFieldProps
  extends Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    "onChange" | "value"
  > {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: React.ReactNode;
  invalid?: boolean;
}

export function AuthField({
  icon: Icon,
  label,
  value,
  onChange,
  hint,
  invalid = false,
  className,
  type = "text",
  required = true,
  ...inputProps
}: AuthFieldProps) {
  return (
    <div className="space-y-2">
      <label
        className={cn(
          "text-[13px] font-bold",
          "text-(--ui-texto-item)",
        )}
      >
        {label}
      </label>
      <div className="relative">
        <Icon
          className={cn(
            "absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2",
            "text-(--ui-texto-secundario)",
          )}
        />
        <Input
          type={type}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          required={required}
          aria-invalid={invalid || undefined}
          className={cn(
            "h-11 rounded-xl pl-10 text-[14px] font-medium transition-all",
            "bg-(--ui-superficie-campo)",
            invalid && "border-rose-400",
            className,
          )}
          {...inputProps}
        />
      </div>
      {hint && (
        <div
          className={cn(
            "text-[12px] font-medium",
            invalid
              ? "text-(--ui-rose-texto)"
              : "text-(--ui-texto-secundario)",
          )}
        >
          {hint}
        </div>
      )}
    </div>
  );
}

export function FormSectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p
      className={cn(
        "pt-2 text-[11px] font-bold uppercase tracking-wider",
        "text-(--ui-texto-secundario)",
      )}
    >
      {children}
    </p>
  );
}

const ACCOUNT_TYPE_OPTIONS = [
  {
    value: "personal",
    title: "Uso pessoal",
    description: "Para organizar seus próprios projetos. Pede só os seus dados.",
    icon: UserRound,
  },
  {
    value: "business",
    title: "Uso empresarial",
    description:
      "Para equipes de uma empresa. Pede os dados da empresa e do responsável.",
    icon: Building2,
  },
] as const;

export function AccountTypeSelector({
  value,
  onChange,
}: {
  value: AccountType | null;
  onChange: (value: AccountType) => void;
}) {
  return (
    <div
      className="grid gap-3 sm:grid-cols-2"
      role="radiogroup"
      aria-label="Tipo de conta"
    >
      {ACCOUNT_TYPE_OPTIONS.map((option) => {
        const selected = value === option.value;
        const Icon = option.icon;

        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              "flex cursor-pointer flex-col items-start gap-2 rounded-2xl border p-4 text-left transition-all",
              "bg-(--ui-superficie-campo)",
              selected
                ? "border-blue-600 ring-4 ring-blue-500/15"
                : "border-(--ui-borda) hover:border-(--ui-borda-forte)",
            )}
          >
            <span
              className={cn(
                "flex h-9 w-9 items-center justify-center rounded-xl",
                selected
                  ? "bg-blue-600 text-white"
                  : "bg-(--ui-fundo-neutro) text-(--ui-texto-secundario)",
              )}
            >
              <Icon className="h-4 w-4" />
            </span>
            <span
              className={cn(
                "text-sm font-black",
                "text-(--ui-texto-principal)",
              )}
            >
              {option.title}
            </span>
            <span
              className={cn(
                "text-[12px] font-medium leading-snug",
                "text-(--ui-texto-secundario)",
              )}
            >
              {option.description}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function PersonFields({
  value,
  onChange,
}: {
  value: PersonFormValue;
  onChange: (next: PersonFormValue) => void;
}) {
  const cpfDigits = onlyDigits(value.cpf);
  const cpfInvalid = cpfDigits.length === 11 && !isValidCpf(cpfDigits);
  const update = (field: keyof PersonFormValue) => (fieldValue: string) =>
    onChange({ ...value, [field]: fieldValue });

  return (
    <>
      <AuthField
        icon={User}
        label="Nome completo"
        placeholder="Como está no documento"
        value={value.name}
        onChange={update("name")}
        autoComplete="name"
        maxLength={255}
      />
      <div className="grid gap-5 sm:grid-cols-2">
        <AuthField
          icon={Hash}
          label="CPF"
          placeholder="000.000.000-00"
          value={formatCpf(value.cpf)}
          onChange={update("cpf")}
          inputMode="numeric"
          maxLength={14}
          invalid={cpfInvalid}
          hint={cpfInvalid ? "CPF inválido." : undefined}
        />
        <AuthField
          icon={CalendarDays}
          label="Data de nascimento"
          type="date"
          value={value.birthDate}
          onChange={update("birthDate")}
          max={getAdultBirthDateLimit()}
          autoComplete="bday"
        />
      </div>
      <AuthField
        icon={Phone}
        label="Celular (WhatsApp)"
        placeholder="(00) 00000-0000"
        type="tel"
        value={formatPhone(value.phone)}
        onChange={update("phone")}
        inputMode="tel"
        maxLength={15}
        autoComplete="tel-national"
      />
    </>
  );
}

function CnpjLookupHint({ lookup }: { lookup: CnpjLookupState }) {
  switch (lookup.status) {
    case "loading":
      return (
        <span className="inline-flex items-center gap-1.5">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Consultando a Receita Federal...
        </span>
      );
    case "active":
      return (
        <span className="inline-flex items-center gap-1.5 text-emerald-600">
          <BadgeCheck className="h-3.5 w-3.5 shrink-0" />
          CNPJ ativo{lookup.legalName ? ` · ${lookup.legalName}` : ""}
        </span>
      );
    case "pending":
      return (
        <span className="inline-flex items-center gap-1.5 text-amber-600">
          <Clock3 className="h-3.5 w-3.5 shrink-0" />
          Receita indisponível agora. O CNPJ será confirmado automaticamente
          depois.
        </span>
      );
    case "error":
      return <span>{lookup.message}</span>;
    default:
      return null;
  }
}

export function CompanyFields({
  value,
  onChange,
  lookup,
}: {
  value: CompanyFormValue;
  onChange: (next: CompanyFormValue) => void;
  lookup: CnpjLookupState;
}) {
  const normalizedCnpj = normalizeCnpj(value.cnpj);
  const suggestedForCnpjRef = useRef<string | null>(null);

  // Preenche o nome com o nome fantasia (ou razão social) se o campo estiver vazio.
  useEffect(() => {
    if (lookup.status !== "active" && lookup.status !== "pending") return;
    if (suggestedForCnpjRef.current === normalizedCnpj) return;
    if (value.tradeName.trim()) return;

    const suggestion = lookup.tradeName || lookup.legalName;
    if (suggestion) {
      suggestedForCnpjRef.current = normalizedCnpj;
      onChange({ ...value, tradeName: suggestion });
    }
  }, [lookup, normalizedCnpj, onChange, value]);

  return (
    <>
      <AuthField
        icon={Briefcase}
        label="CNPJ"
        placeholder="00.000.000/0000-00"
        value={formatCnpj(value.cnpj)}
        onChange={(cnpj) => onChange({ ...value, cnpj })}
        maxLength={18}
        autoCapitalize="characters"
        invalid={lookup.status === "error"}
        hint={<CnpjLookupHint lookup={lookup} />}
      />
      <AuthField
        icon={Building2}
        label="Nome da empresa no Pauta"
        placeholder="Nome fantasia"
        value={value.tradeName}
        onChange={(tradeName) => onChange({ ...value, tradeName })}
        maxLength={120}
        autoComplete="organization"
      />
    </>
  );
}
