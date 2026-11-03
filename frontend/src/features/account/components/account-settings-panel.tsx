import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import {
  ArrowRightLeft,
  BadgeCheck,
  Building2,
  Clock3,
  Loader2,
  ShieldAlert,
  UserRound,
} from "lucide-react";
import { Input } from "../../../components/ui/input";
import { buildApiUrl } from "../../../lib/api";
import {
  formatCnpj,
  formatIsoDate,
  formatPhone,
} from "../../../lib/documents";
import { queryClient } from "../../../lib/query-client";
import { cn } from "../../../lib/utils";
import { useAuthStore } from "../../../store/use-auth-store";
import { useTaskStore } from "../../../store/use-task-store";
import { useThemeStore } from "../../../store/use-theme-store";
import { toast } from "../../../store/use-toast-store";
import type { AccountType } from "./account-form-fields";
import type { AccountListResponse } from "./account-switcher";
import { CreateAccountModal } from "./create-account-modal";
import { PrivacySettingsSection } from "./privacy-settings-section";
import { SecuritySettingsSection } from "./security-settings-section";
import { confirmar } from "../../../store/use-confirm-store";

interface AccountDetails {
  accountType: AccountType | null;
  isOwner: boolean;
  canManageOrganization: boolean;
  requiresAccountCompletion: boolean;
  organization: {
    id: string;
    name: string;
    cnpj: string | null;
    legalName: string | null;
    registrationStatus: string | null;
    verificationStatus: "verified" | "pending" | "invalid" | null;
  };
  holder: {
    name: string;
    cpf: string | null;
    phone: string | null;
    birthDate: string | null;
  } | null;
}

function getRequestErrorMessage(error: unknown, fallback: string) {
  if (axios.isAxiosError(error)) {
    const message = (error.response?.data as { message?: string })?.message;
    if (message) return message;
  }
  return fallback;
}

export function AccountSettingsPanel() {
  const token = useAuthStore((state) => state.token);
  const organizationId = useAuthStore((state) => state.user?.organization?.id);
  const workspacesById = useTaskStore((state) => state.graph.workspaces);
  const isDarkMode = useThemeStore((state) => state.mode === "dark");

  const [account, setAccount] = useState<AccountDetails | null>(null);
  const [accountList, setAccountList] = useState<AccountListResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [organizationName, setOrganizationName] = useState("");
  const [isSavingName, setIsSavingName] = useState(false);
  const [moveWorkspaceId, setMoveWorkspaceId] = useState("");
  const [moveTargetId, setMoveTargetId] = useState("");
  const [isMoving, setIsMoving] = useState(false);
  const [isCreateBusinessOpen, setIsCreateBusinessOpen] = useState(false);

  const loadAccount = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    setLoadError(null);
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const [detailsResponse, listResponse] = await Promise.all([
        axios.get<AccountDetails>(buildApiUrl("/api/account"), { headers }),
        axios.get<AccountListResponse>(buildApiUrl("/api/account/list"), { headers }),
      ]);
      setAccount(detailsResponse.data);
      setAccountList(listResponse.data);
      setOrganizationName(detailsResponse.data.organization.name);
    } catch (error) {
      setLoadError(
        getRequestErrorMessage(error, "Não foi possível carregar os dados da conta."),
      );
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  // Recarrega ao trocar de conta no seletor.
  useEffect(() => {
    loadAccount();
  }, [loadAccount, organizationId]);

  const handleSaveName = async () => {
    const trimmedName = organizationName.trim();
    if (!account || trimmedName === account.organization.name) return;

    setIsSavingName(true);
    try {
      const response = await axios.put(
        buildApiUrl("/api/account/organization"),
        { name: trimmedName },
        { headers: { Authorization: `Bearer ${token}` } },
      );
      useAuthStore.setState({ user: response.data.user });
      toast.success("Nome atualizado.", {
        message: "As pastas de arquivos serão renomeadas em segundo plano.",
      });
      await loadAccount();
    } catch (error) {
      toast.error("Não foi possível atualizar o nome.", {
        message: getRequestErrorMessage(error, "Tente novamente em instantes."),
      });
    } finally {
      setIsSavingName(false);
    }
  };

  const moveTargets = (accountList?.accounts ?? []).filter(
    (item) =>
      !item.isActive &&
      item.accountType === "business" &&
      (item.role === "owner" || item.role === "admin"),
  );
  const workspaces = Object.values(workspacesById).sort((left, right) =>
    left.name.localeCompare(right.name, "pt-BR"),
  );

  const handleMoveWorkspace = async () => {
    const workspace = workspacesById[moveWorkspaceId];
    const target = moveTargets.find((item) => item.id === moveTargetId);
    if (!workspace || !target) return;

    const confirmado = await confirmar({
      title: `Mover "${workspace.name}" para ${target.name}?`,
      message:
        "Projetos, cards, arquivos e etiquetas vão junto. Pessoas que não são membros do destino perdem o acesso.",
      confirmLabel: "Mover",
      variant: "warning",
    });
    if (!confirmado) return;

    setIsMoving(true);
    try {
      const response = await axios.post(
        buildApiUrl(`/api/account/workspaces/${workspace.id}/move`),
        { targetOrganizationId: target.id },
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const removedMembers = Number(response.data?.removedMembers || 0);
      toast.success(response.data?.message || "Espaço de trabalho movido.", {
        message:
          removedMembers > 0
            ? `${removedMembers} pessoa(s) sem conta em ${target.name} perderam o acesso.`
            : `Troque para ${target.name} no seletor de contas para ver o workspace.`,
      });
      setMoveWorkspaceId("");
      setMoveTargetId("");
      await queryClient.invalidateQueries({ queryKey: ["workspace-seed"] });
    } catch (error) {
      toast.error("Não foi possível mover o espaço de trabalho.", {
        message: getRequestErrorMessage(error, "Tente novamente em instantes."),
      });
    } finally {
      setIsMoving(false);
    }
  };

  const cardClass = cn(
    "rounded-2xl border p-6",
    "border-(--ui-borda) bg-(--ui-superficie)",
  );
  const titleClass = cn(
    "text-sm font-black",
    "text-(--ui-texto-principal)",
  );
  const mutedClass = "text-(--ui-texto-secundario)";
  const selectClass = cn(
    "h-11 w-full rounded-xl border px-3 text-[14px] font-medium outline-none transition cursor-pointer",
    "border-(--ui-borda) bg-(--ui-superficie-campo) text-(--ui-texto-forte)",
  );

  if (isLoading && !account) {
    return (
      <div className={cn(cardClass, "flex items-center justify-center gap-2 py-12")}>
        <Loader2 className={cn("h-4 w-4 animate-spin", mutedClass)} />
        <span className={cn("text-sm font-medium", mutedClass)}>
          Carregando dados da conta...
        </span>
      </div>
    );
  }

  if (loadError || !account) {
    return (
      <div className={cn(cardClass, "py-10 text-center")}>
        <p className="text-sm font-bold text-rose-600">{loadError}</p>
        <button
          type="button"
          onClick={loadAccount}
          className="mt-3 text-sm font-bold text-blue-600 hover:underline cursor-pointer"
        >
          Tentar novamente
        </button>
      </div>
    );
  }

  const isBusiness = account.accountType === "business";
  const nameChanged =
    organizationName.trim().length >= 2 &&
    organizationName.trim() !== account.organization.name;

  return (
    <div className="space-y-6">
      <section className={cardClass}>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <h3 className={titleClass}>Conta</h3>
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold",
              isBusiness
                ? "bg-blue-500/10 text-blue-600"
                : "bg-(--ui-fundo-neutro) text-(--ui-texto-secundario)",
            )}
          >
            {isBusiness ? (
              <Building2 className="h-3.5 w-3.5" />
            ) : (
              <UserRound className="h-3.5 w-3.5" />
            )}
            {account.accountType === null
              ? "Tipo não informado"
              : isBusiness
                ? "Empresarial"
                : "Espaço pessoal"}
          </span>
        </div>

        <label className={cn("text-[13px] font-bold", mutedClass)}>
          {isBusiness ? "Nome da empresa no Pauta" : "Nome do espaço"}
        </label>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <Input
            value={organizationName}
            onChange={(event) => setOrganizationName(event.target.value)}
            disabled={!account.canManageOrganization || isSavingName}
            maxLength={120}
            className={cn(
              "h-11 rounded-xl text-[14px] font-medium",
              "bg-(--ui-superficie-campo)",
            )}
          />
          {account.canManageOrganization && (
            <button
              type="button"
              onClick={handleSaveName}
              disabled={!nameChanged || isSavingName}
              className="h-11 shrink-0 rounded-xl bg-blue-600 px-5 text-sm font-bold text-white transition-colors hover:bg-blue-700 disabled:opacity-50 disabled:pointer-events-none cursor-pointer"
            >
              {isSavingName ? "Salvando..." : "Salvar"}
            </button>
          )}
        </div>
        <p className={cn("mt-2 text-[12px] font-medium", mutedClass)}>
          Ao renomear, as pastas de arquivos da conta também são renomeadas.
        </p>
      </section>

      {isBusiness && (
        <section className={cardClass}>
          <h3 className={cn(titleClass, "mb-5")}>Empresa</h3>
          <dl className="grid gap-4 sm:grid-cols-2">
            <InfoItem
              isDarkMode={isDarkMode}
              label="CNPJ"
              value={account.organization.cnpj ? formatCnpj(account.organization.cnpj) : "—"}
            />
            <InfoItem
              isDarkMode={isDarkMode}
              label="Razão social"
              value={account.organization.legalName || "—"}
            />
            <InfoItem
              isDarkMode={isDarkMode}
              label="Situação na Receita"
              value={account.organization.registrationStatus || "—"}
            />
          </dl>
          <VerificationNotice status={account.organization.verificationStatus} />
        </section>
      )}

      {account.holder && (
        <section className={cardClass}>
          <h3 className={cn(titleClass, "mb-5")}>
            {isBusiness ? "Responsável pela conta" : "Titular"}
          </h3>
          <dl className="grid gap-4 sm:grid-cols-2">
            <InfoItem label="Nome" value={account.holder.name} isDarkMode={isDarkMode} />
            <InfoItem label="CPF" value={account.holder.cpf || "—"} isDarkMode={isDarkMode} />
            <InfoItem
              isDarkMode={isDarkMode}
              label="Celular"
              value={account.holder.phone ? formatPhone(account.holder.phone) : "—"}
            />
            <InfoItem
              isDarkMode={isDarkMode}
              label="Data de nascimento"
              value={formatIsoDate(account.holder.birthDate) || "—"}
            />
          </dl>
          <p className={cn("mt-4 text-[12px] font-medium", mutedClass)}>
            Para alterar CPF ou data de nascimento, fale com o suporte.
          </p>
        </section>
      )}

      {account.isOwner && account.accountType === "personal" && (
        <section className={cardClass}>
          <div className="flex items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-blue-500/10 text-blue-600">
              <ArrowRightLeft className="h-4 w-4" />
            </span>
            <div>
              <h3 className={titleClass}>Mover espaço de trabalho para uma empresa</h3>
              <p className={cn("mt-1 text-sm font-medium", mutedClass)}>
                Leve um workspace deste espaço pessoal para uma conta empresarial sua.
                Projetos, cards, arquivos e etiquetas vão junto, e o espaço pessoal
                continua existindo.
              </p>
            </div>
          </div>

          {moveTargets.length === 0 ? (
            <div className="mt-5">
              <p className={cn("text-[13px] font-medium", mutedClass)}>
                Você ainda não é dono ou administrador de nenhuma conta empresarial.
              </p>
              <button
                type="button"
                onClick={() => setIsCreateBusinessOpen(true)}
                className="mt-3 inline-flex h-10 items-center gap-2 rounded-xl border border-blue-600 px-4 text-sm font-bold text-blue-600 transition-colors hover:bg-blue-600 hover:text-white cursor-pointer"
              >
                <Building2 className="h-4 w-4" />
                Criar conta empresarial
              </button>
            </div>
          ) : (
            <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <label className="space-y-2">
                <span className={cn("text-[13px] font-bold", mutedClass)}>Espaço de trabalho</span>
                <select
                  value={moveWorkspaceId}
                  onChange={(event) => setMoveWorkspaceId(event.target.value)}
                  className={selectClass}
                >
                  <option value="">Selecione</option>
                  {workspaces.map((workspace) => (
                    <option key={workspace.id} value={workspace.id}>
                      {workspace.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-2">
                <span className={cn("text-[13px] font-bold", mutedClass)}>Para a empresa</span>
                <select
                  value={moveTargetId}
                  onChange={(event) => setMoveTargetId(event.target.value)}
                  className={selectClass}
                >
                  <option value="">Selecione</option>
                  {moveTargets.map((target) => (
                    <option key={target.id} value={target.id}>
                      {target.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={handleMoveWorkspace}
                disabled={!moveWorkspaceId || !moveTargetId || isMoving}
                className="h-11 rounded-xl bg-blue-600 px-5 text-sm font-bold text-white transition-colors hover:bg-blue-700 disabled:opacity-50 disabled:pointer-events-none cursor-pointer"
              >
                {isMoving ? "Movendo..." : "Mover"}
              </button>
            </div>
          )}
        </section>
      )}

      <SecuritySettingsSection />

      <PrivacySettingsSection
        accountName={account.organization.name}
        isOwner={account.isOwner}
      />

      {isCreateBusinessOpen && (
        <CreateAccountModal
          mode="business"
          hasHolderData={accountList?.person.hasHolderData ?? true}
          onClose={() => setIsCreateBusinessOpen(false)}
        />
      )}
    </div>
  );
}

function InfoItem({
  label,
  value,
}: {
  label: string;
  value: string;
  isDarkMode: boolean;
}) {
  return (
    <div>
      <dt
        className={cn(
          "text-[12px] font-bold",
          "text-(--ui-texto-secundario)",
        )}
      >
        {label}
      </dt>
      <dd
        className={cn(
          "mt-0.5 text-sm font-semibold",
          "text-(--ui-texto-principal)",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function VerificationNotice({
  status,
}: {
  status: AccountDetails["organization"]["verificationStatus"];
}) {
  if (status === "verified") {
    return (
      <p className="mt-5 inline-flex items-center gap-1.5 text-[13px] font-bold text-emerald-600">
        <BadgeCheck className="h-4 w-4" />
        CNPJ verificado na Receita Federal.
      </p>
    );
  }

  if (status === "pending") {
    return (
      <p className="mt-5 inline-flex items-center gap-1.5 text-[13px] font-bold text-amber-600">
        <Clock3 className="h-4 w-4 shrink-0" />
        Verificação do CNPJ pendente. O sistema confirma automaticamente assim
        que a Receita responder.
      </p>
    );
  }

  if (status === "invalid") {
    return (
      <p className="mt-5 inline-flex items-center gap-1.5 text-[13px] font-bold text-rose-600">
        <ShieldAlert className="h-4 w-4 shrink-0" />
        Este CNPJ não está ativo na Receita Federal. Fale com o suporte para
        regularizar a conta.
      </p>
    );
  }

  return null;
}
