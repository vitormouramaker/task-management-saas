import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import axios from "axios";
import {
  Building2,
  Check,
  ChevronsUpDown,
  Loader2,
  Plus,
  UserRound,
} from "lucide-react";
import { buildApiUrl } from "../../../lib/api";
import { cn, getInitials } from "../../../lib/utils";
import { useAuthStore } from "../../../store/use-auth-store";
import { toast } from "../../../store/use-toast-store";
import { CreateAccountModal } from "./create-account-modal";
import type { AccountType } from "./account-form-fields";

export interface AccountSummary {
  id: string;
  name: string;
  accountType: AccountType | null;
  plan: string;
  role: "owner" | "admin" | "member";
  isActive: boolean;
}

export interface AccountListResponse {
  accounts: AccountSummary[];
  person: { name: string; hasHolderData: boolean };
  canCreatePersonal: boolean;
}

const ROLE_LABELS: Record<AccountSummary["role"], string> = {
  owner: "Titular",
  admin: "Administrador",
  member: "Membro",
};

// Largura minima so para o menu nao ficar ilegivel na sidebar recolhida:
// com a sidebar aberta ele acompanha a largura do botao.
const MENU_MIN_WIDTH = 220;

function getAccountTypeLabel(accountType: AccountType | null | undefined) {
  if (accountType === "business") return "Conta empresarial";
  if (accountType === "personal") return "Espaço pessoal";
  return "Conta";
}

function AccountBadge({
  accountType,
  name,
  size = "md",
}: {
  accountType: AccountType | null | undefined;
  name: string;
  size?: "sm" | "md";
}) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-xl font-black text-white",
        size === "sm" ? "h-8 w-8 text-[11px]" : "h-9 w-9 text-xs",
        accountType === "personal"
          ? "bg-linear-to-br from-emerald-500 to-teal-600"
          : "bg-linear-to-br from-blue-600 to-indigo-600",
      )}
      aria-hidden="true"
    >
      {getInitials(name || "?").slice(0, 2)}
    </span>
  );
}

interface AccountSwitcherProps {
  isCondensed: boolean;
}

/** Seletor de conta (espaço pessoal e empresas) no topo da barra lateral. */
export function AccountSwitcher({ isCondensed }: AccountSwitcherProps) {
  const user = useAuthStore((state) => state.user);
  const token = useAuthStore((state) => state.token);
  const switchOrganization = useAuthStore((state) => state.switchOrganization);

  const buttonRef = useRef<HTMLButtonElement>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number; width: number } | null>(
    null,
  );
  const [data, setData] = useState<AccountListResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [createMode, setCreateMode] = useState<AccountType | null>(null);

  const organization = user?.organization;
  const isOpen = menuPosition !== null;

  const loadAccounts = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    try {
      const response = await axios.get<AccountListResponse>(
        buildApiUrl("/api/account/list"),
        { headers: { Authorization: `Bearer ${token}` } },
      );
      setData(response.data);
    } catch {
      toast.error("Não foi possível carregar suas contas.", {
        message: "Tente novamente em instantes.",
      });
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  const closeMenu = () => setMenuPosition(null);

  const openMenu = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    // O menu nasce com a largura do proprio botao, alinhado por baixo dele.
    const largura = Math.max(rect.width, MENU_MIN_WIDTH);
    setMenuPosition({
      top: rect.bottom + 8,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - largura - 8)),
      width: largura,
    });
    loadAccounts();
  };

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  const handleSelect = async (account: AccountSummary) => {
    if (account.isActive || switchingId) {
      closeMenu();
      return;
    }

    setSwitchingId(account.id);
    try {
      await switchOrganization(account.id);
      closeMenu();
      toast.success("Conta alterada.", { message: `Você está em ${account.name}.` });
    } catch (error) {
      const message = axios.isAxiosError(error)
        ? (error.response?.data as { message?: string })?.message
        : null;
      toast.error("Não foi possível trocar de conta.", {
        message: message || "Tente novamente em instantes.",
      });
    } finally {
      setSwitchingId(null);
    }
  };

  const openCreate = (mode: AccountType) => {
    closeMenu();
    setCreateMode(mode);
  };

  if (!organization) {
    return null;
  }

  const itemClass = cn(
    "flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors cursor-pointer disabled:cursor-wait",
    "hover:bg-(--ui-hover)",
  );

  return (
    <>
      <div className={cn("pauta-account-switcher shrink-0", isCondensed ? "px-4 pb-2" : "px-4 pb-3")}>
        <button
          ref={buttonRef}
          type="button"
          onClick={isOpen ? closeMenu : openMenu}
          aria-haspopup="menu"
          aria-expanded={isOpen}
          title={isCondensed ? `${organization.name} · ${getAccountTypeLabel(organization.accountType)}` : undefined}
          className={cn(
            "flex w-full items-center gap-2.5 rounded-2xl border text-left transition-colors cursor-pointer",
            isCondensed ? "justify-center p-1.5" : "px-2.5 py-2",
            "border-(--ui-borda) bg-(--ui-superficie) hover:bg-(--ui-fundo-sutil)",
          )}
        >
          <AccountBadge accountType={organization.accountType} name={organization.name} />
          {!isCondensed && (
            <>
              <span className="min-w-0 flex-1 text-left">
                <span
                  className={cn(
                    "block truncate text-[13px] font-black",
                    "text-(--ui-texto-principal)",
                  )}
                >
                  {organization.name}
                </span>
                <span
                  className={cn(
                    "block truncate text-[11px] font-semibold",
                    "text-(--ui-texto-secundario)",
                  )}
                >
                  {getAccountTypeLabel(organization.accountType)}
                </span>
              </span>
              <ChevronsUpDown
                className={cn(
                  "h-4 w-4 shrink-0",
                  "text-(--ui-texto-secundario)",
                )}
              />
            </>
          )}
        </button>
      </div>

      {isOpen &&
        createPortal(
          <>
            <div className="fixed inset-0 z-9998" onClick={closeMenu} aria-hidden="true" />
            <div
              role="menu"
              style={{ top: menuPosition.top, left: menuPosition.left, width: menuPosition.width }}
              className={cn(
                "fixed z-9999 max-h-[70dvh] overflow-y-auto rounded-2xl border p-2 animate-in fade-in zoom-in-95 duration-150",
                "pauta-theme-menu",
              )}
            >
              <p
                className={cn(
                  "px-2.5 pb-1.5 pt-1 text-[10px] font-bold uppercase tracking-wider",
                  "text-(--ui-texto-secundario)",
                )}
              >
                Suas contas
              </p>

              {isLoading && !data ? (
                <div className="flex items-center justify-center py-5">
                  <Loader2
                    className={cn(
                      "h-4 w-4 animate-spin",
                      "text-(--ui-texto-secundario)",
                    )}
                  />
                </div>
              ) : (
                (data?.accounts ?? []).map((account) => (
                  <button
                    key={account.id}
                    type="button"
                    role="menuitem"
                    onClick={() => handleSelect(account)}
                    disabled={Boolean(switchingId)}
                    className={itemClass}
                  >
                    <AccountBadge accountType={account.accountType} name={account.name} size="sm" />
                    <span className="min-w-0 flex-1 text-left">
                      <span
                        className={cn(
                          "block truncate text-[13px] font-bold",
                          "text-(--ui-texto-principal)",
                        )}
                      >
                        {account.name}
                      </span>
                      <span
                        className={cn(
                          "block truncate text-[11px] font-medium",
                          "text-(--ui-texto-secundario)",
                        )}
                      >
                        {getAccountTypeLabel(account.accountType)} · {ROLE_LABELS[account.role]}
                      </span>
                    </span>
                    {switchingId === account.id ? (
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-blue-600" />
                    ) : account.isActive ? (
                      <Check className="h-4 w-4 shrink-0 text-blue-600" />
                    ) : null}
                  </button>
                ))
              )}

              <div
                className={cn(
                  "my-1.5 h-px",
                  "bg-(--ui-borda-suave)",
                )}
              />

              {data?.canCreatePersonal && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => openCreate("personal")}
                  className={cn(
                    itemClass,
                    "text-[13px] font-bold",
                    "text-(--ui-texto-secundario)",
                  )}
                >
                  <span className="grid h-8 w-8 place-items-center">
                    <UserRound className="h-4 w-4" />
                  </span>
                  Criar espaço pessoal
                </button>
              )}
              <button
                type="button"
                role="menuitem"
                onClick={() => openCreate("business")}
                className={cn(
                  itemClass,
                  "text-[13px] font-bold",
                  "text-(--ui-texto-secundario)",
                )}
              >
                <span className="grid h-8 w-8 place-items-center">
                  <span className="relative">
                    <Building2 className="h-4 w-4" />
                    <Plus className="absolute -right-1.5 -top-1.5 h-2.5 w-2.5" />
                  </span>
                </span>
                Criar conta empresarial
              </button>
            </div>
          </>,
          document.body,
        )}

      {createMode && (
        <CreateAccountModal
          mode={createMode}
          hasHolderData={data?.person.hasHolderData ?? true}
          onClose={() => setCreateMode(null)}
        />
      )}
    </>
  );
}
