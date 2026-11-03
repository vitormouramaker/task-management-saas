import { Suspense, lazy, startTransition, useEffect, useRef, useState } from "react";
import {
  Bell,
  Search,
  Mail,
  Menu,
  ChevronDown,
  User,
  Settings,
  LogOut,
  Moon,
  Sun,
} from "lucide-react";

import { Input } from "../../../components/ui/input";
import { buildAssetUrl } from "../../../lib/api";
import { cn, getInitials } from "../../../lib/utils";
import { useTaskStore } from "../../../store/use-task-store";
import { useAuthStore } from "../../../store/use-auth-store";
import { useThemeStore } from "../../../store/use-theme-store";
import { NotificationModal } from "./notification-modal";
const EmailModal = lazy(() =>
  import("./email-modal").then((m) => ({ default: m.EmailModal })),
);
const ProfileModal = lazy(() =>
  import("../../profile/components/profile-modal").then((m) => ({ default: m.ProfileModal })),
);

interface AppHeaderProps {
  isMobile?: boolean;
  onOpenMobileNav?: () => void;
}

export function AppHeader({
  isMobile = false,
  onOpenMobileNav,
}: AppHeaderProps) {
  const selection = useTaskStore((state) => state.selection);
  const activePage = useTaskStore((state) => state.ui.activePage);
  const search = useTaskStore((state) => state.filters.search);
  const setSearch = useTaskStore((state) => state.setSearch);
  const notifications = useTaskStore((state) => state.notifications);
  const sentEmails = useTaskStore((state) => state.sentEmails);
  const unreadCount = notifications.filter((n) => !n.read).length;
  const unreadEmailCount = sentEmails.filter(
    (e) => e.type === "received" && !e.read,
  ).length;
  const user = useAuthStore((state) => state.user);
  const themeMode = useThemeStore((state) => state.mode);
  const toggleTheme = useThemeStore((state) => state.toggleMode);
  const isDarkMode = themeMode === "dark";

  const [draftSearch, setDraftSearch] = useState(search);
  const [isNotificationModalOpen, setIsNotificationModalOpen] = useState(false);
  const [isEmailModalOpen, setIsEmailModalOpen] = useState(false);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const notificationRef = useRef<HTMLDivElement>(null);
  const notifButtonRef = useRef<HTMLButtonElement>(null);
  const emailRef = useRef<HTMLDivElement>(null);
  const emailButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        profileMenuRef.current &&
        !profileMenuRef.current.contains(event.target as Node)
      ) {
        setIsProfileMenuOpen(false);
      }
      const isInsideNotifPanel = !!(event.target as Element)?.closest?.(
        "[data-task-notification-panel]",
      );
      if (
        !isInsideNotifPanel &&
        notificationRef.current &&
        !notificationRef.current.contains(event.target as Node)
      ) {
        setIsNotificationModalOpen(false);
      }
      const isInsideEmailPortal = !!(event.target as Element)?.closest?.(
        "[data-email-portal]",
      );
      if (
        !isInsideEmailPortal &&
        emailRef.current &&
        !emailRef.current.contains(event.target as Node)
      ) {
        setIsEmailModalOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    setDraftSearch(search);
  }, [search]);

  const shouldShowSearch = activePage === "tasks" && !!selection.listId;

  return (
    <header
      className={cn(
        "pauta-app-header sticky top-0 z-20 flex items-center justify-between gap-3 border-b",
        "pauta-safe-x h-16 pl-4 pr-4 backdrop-blur-md sm:pl-6 sm:pr-6 sm:h-16 lg:pr-8",
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3 lg:gap-4 px-3">
        {isMobile && onOpenMobileNav && (
          <button
            type="button"
            onClick={onOpenMobileNav}
            className={cn(
              "pauta-touch-target grid h-10 w-10 shrink-0 place-items-center rounded-2xl border transition-colors",
              "border-(--ui-borda) bg-(--ui-superficie) text-(--ui-texto-secundario) hover:text-(--ui-texto-forte)",
            )}
            aria-label="Abrir navegação"
          >
            <Menu className="h-5 w-5" />
          </button>
        )}

        {shouldShowSearch ? (
          <div className="pauta-app-header-search relative w-full max-w-lg animate-in fade-in slide-in-from-left-2 duration-300">
            <Search
              className={cn(
                "pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2",
                "text-(--ui-texto-secundario)",
              )}
            />
            <Input
              value={draftSearch}
              onChange={(event) => {
                const nextValue = event.target.value;
                setDraftSearch(nextValue);
                startTransition(() => {
                  setSearch(nextValue);
                });
              }}
              className={cn(
                "h-10 w-full rounded-xl pl-10 pr-3 text-sm",
                "border-(--ui-borda-suave) bg-(--ui-fundo-sutil) text-(--text-main) placeholder:text-(--text-soft) focus:bg-(--ui-superficie) focus:ring-(--ui-azul-foco)",
              )}
              placeholder={
                isMobile
                  ? "Buscar..."
                  : "Buscar por nome, etiqueta, card ou membro da equipe..."
              }
            />
          </div>
        ) : (
          <div className="flex-1" />
        )}
      </div>

      <div className="pauta-app-header-actions flex shrink-0 items-center gap-3 sm:gap-4 lg:gap-6 px-3">
        <div
          className={cn(
            "pauta-app-header-notifications flex items-center gap-2 border-r pr-3 sm:gap-3 sm:pr-4 lg:gap-4 lg:pr-6",
            "border-(--ui-borda-suave)",
          )}
        >
          <div ref={emailRef} className="relative">
            <button
              ref={emailButtonRef}
              onClick={() => setIsEmailModalOpen((v) => !v)}
              className={cn(
                "pauta-touch-target relative flex h-9 w-9 items-center justify-center rounded-xl transition cursor-pointer",
                "text-(--ui-texto-secundario) hover:bg-(--ui-hover) hover:text-(--ui-texto-forte)",
              )}
            >
              <Mail className="h-5 w-5" />
              {unreadEmailCount > 0 && (
                <span
                  className={cn(
                    "absolute -right-0.5 top-0.5 flex h-3 w-3 items-center justify-center rounded-full border bg-rose-500 text-[8px] font-black text-white",
                    "border-(--ui-superficie)",
                  )}
                >
                  {unreadEmailCount}
                </span>
              )}
            </button>
            <Suspense fallback={null}>{isEmailModalOpen && (
              <EmailModal
                isOpen={isEmailModalOpen}
                onClose={() => setIsEmailModalOpen(false)}
                anchorRef={emailButtonRef}
              />
            )}</Suspense>
          </div>
          <div ref={notificationRef} className="relative">
            <button
              ref={notifButtonRef}
              onClick={() => setIsNotificationModalOpen((v) => !v)}
              className={cn(
                "pauta-touch-target relative flex h-9 w-9 items-center justify-center rounded-xl transition cursor-pointer",
                "text-(--ui-texto-secundario) hover:bg-(--ui-hover) hover:text-(--ui-texto-forte)",
              )}
            >
              <Bell className="h-5 w-5" />
              {unreadCount > 0 && (
                <span
                  className={cn(
                    "absolute -right-0.5 top-0.5 flex h-3 w-3 items-center justify-center rounded-full border bg-rose-500 text-[8px] font-black text-white",
                    "border-(--ui-superficie)",
                  )}
                >
                  {unreadCount}
                </span>
              )}
            </button>
            <NotificationModal
              isOpen={isNotificationModalOpen}
              onClose={() => setIsNotificationModalOpen(false)}
              anchored
              anchorRef={notifButtonRef}
            />
          </div>
        </div>

        <div className="relative" ref={profileMenuRef}>
          <div
            onClick={() => setIsProfileMenuOpen(!isProfileMenuOpen)}
            className={cn(
              "pauta-app-header-user flex items-center gap-2 cursor-pointer rounded-xl p-1 pr-1.5 transition-colors sm:gap-3 sm:p-1.5 sm:pr-3",
              "hover:bg-(--ui-hover)",
            )}
          >
            <div className="pauta-app-header-user-text hidden min-w-0 flex-col items-end md:flex">
              <span
                className={cn(
                  "text-sm font-bold leading-none",
                  "text-(--ui-texto-principal)",
                )}
              >
                {user?.name || "Carregando..."}
              </span>
              <span
                className={cn(
                  "mt-0.5 text-[11px] font-medium",
                  "text-(--ui-texto-secundario)",
                )}
              >
                {user?.role || "Membro"}
              </span>
            </div>
            <div
              className={cn(
                "relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border",
                "border-(--ui-borda-suave) bg-(--ui-fundo-neutro) ring-2 ring-(--ui-borda-suave)",
              )}
            >
              {user?.avatarUrl ? (
                <img
                  src={buildAssetUrl(user.avatarUrl)}
                  onError={(event) => {
                    event.currentTarget.style.display = "none";
                  }}
                  alt="Avatar"
                  className="h-full w-full object-cover"
                />
              ) : (
                <div
                  className={cn(
                    "flex h-full w-full items-center justify-center text-[12px] font-black text-white",
                    user?.avatarColor || "bg-blue-600",
                  )}
                >
                  {getInitials(user?.name || "")}
                </div>
              )}
            </div>
            <ChevronDown
              className={cn(
                "hidden h-4 w-4 transition-transform md:block",
                "text-(--ui-texto-secundario)",
                isProfileMenuOpen && "rotate-180",
              )}
            />
          </div>

          {isProfileMenuOpen && (
            <div className="pauta-theme-surface absolute top-[calc(100%+8px)] right-0 z-50 w-[min(18rem,calc(100vw-1rem))] rounded-2xl border p-2 animate-in fade-in zoom-in-95 duration-200 sm:w-72">
              <div
                className={cn(
                  "mb-2 flex items-center gap-3 border-b p-2 pb-3",
                  "border-(--ui-borda-suave)",
                )}
              >
                <div
                  className={cn(
                    "h-10 w-10 shrink-0 rounded-full border overflow-hidden flex items-center justify-center",
                    "border-(--ui-borda-suave) bg-(--ui-fundo-neutro) ring-2 ring-(--ui-borda-suave)",
                  )}
                >
                  {user?.avatarUrl ? (
                    <img
                      src={buildAssetUrl(user.avatarUrl)}
                      onError={(event) => {
                        event.currentTarget.style.display = "none";
                      }}
                      alt="Avatar"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div
                      className={cn(
                        "flex h-full w-full items-center justify-center text-[13px] font-black text-white",
                        user?.avatarColor || "bg-blue-600",
                      )}
                    >
                      {getInitials(user?.name || "")}
                    </div>
                  )}
                </div>
                <div className="flex flex-col overflow-hidden">
                  <span
                    className={cn(
                      "truncate text-sm font-black",
                      "text-(--ui-texto-principal)",
                    )}
                  >
                    {user?.name}
                  </span>
                  <span
                    className={cn(
                      "truncate text-[11px] font-medium",
                      "text-(--ui-texto-secundario)",
                    )}
                  >
                    {user?.email}
                  </span>
                </div>
              </div>

              <div className="flex flex-col gap-0.5">
                <button
                  onClick={() => {
                    setIsProfileMenuOpen(false);
                    setIsProfileModalOpen(true);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-[12px] font-bold transition-colors cursor-pointer",
                    "text-(--ui-texto-secundario) hover:bg-(--ui-hover) hover:text-(--ui-azul-texto)",
                  )}
                >
                  <User
                    className={cn(
                      "h-4 w-4",
                      "text-(--ui-texto-secundario)",
                    )}
                  />
                  Visualizar perfil
                </button>
                <button
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-[12px] font-bold transition-colors cursor-pointer",
                    "text-(--ui-texto-secundario) hover:bg-(--ui-hover) hover:text-(--ui-azul-texto)",
                  )}
                >
                  <Settings
                    className={cn(
                      "h-4 w-4",
                      "text-(--ui-texto-secundario)",
                    )}
                  />
                  Configurações da conta
                </button>
                <button
                  onClick={toggleTheme}
                  className={cn(
                    "flex w-full items-center rounded-xl px-3 py-2 text-left transition-colors cursor-pointer",
                    "hover:bg-(--ui-hover)",
                  )}
                >
                  <div className="flex flex-1 items-center gap-2.5">
                    {isDarkMode ? (
                      <Moon className="h-4 w-4 text-(--primary-blue)" />
                    ) : (
                      <Sun className="h-4 w-4 text-amber-500" />
                    )}
                    <div className="flex flex-col">
                      <span
                        className={cn(
                          "text-[12px] font-bold",
                          "text-(--ui-texto-forte)",
                        )}
                      >
                        Tema escuro
                      </span>
                      <span
                        className={cn(
                          "text-[10px] font-medium",
                          "text-(--ui-texto-secundario)",
                        )}
                      >
                        Alternar entre claro e escuro
                      </span>
                    </div>
                  </div>
                  <div
                    className={cn(
                      "pauta-theme-toggle-track relative flex h-7 w-14 shrink-0 items-center rounded-full border px-1 transition-colors",
                      isDarkMode ? "justify-end" : "justify-start",
                    )}
                  >
                    <Sun
                      className={cn(
                        "h-3.5 w-3.5",
                        "text-(--ui-ambar-texto)",
                      )}
                    />
                    <Moon
                      className={cn(
                        "ml-auto h-3.5 w-3.5",
                        "text-(--ui-texto-apagado)",
                      )}
                    />
                    <span
                      className={cn(
                        "pauta-theme-toggle-knob absolute left-1 top-1 flex h-5 w-5 items-center justify-center rounded-full transition-transform",
                        isDarkMode && "translate-x-7",
                      )}
                    >
                      {isDarkMode ? (
                        <Moon className="h-3 w-3 text-(--primary-blue)" />
                      ) : (
                        <Sun className="h-3 w-3 text-amber-500" />
                      )}
                    </span>
                  </div>
                </button>
                <div
                  className={cn(
                    "my-1 border-t",
                    "border-(--ui-borda-suave)",
                  )}
                />
                <button
                  onClick={() => {
                    useAuthStore.getState().logout();
                  }}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-[12px] font-bold transition-colors cursor-pointer",
                    "text-(--ui-rose-texto) hover:bg-(--ui-rose-fundo)",
                  )}
                >
                  <LogOut className="h-4 w-4" />
                  Sair da conta
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <Suspense fallback={null}>{isProfileModalOpen && (
        <ProfileModal
          isOpen={isProfileModalOpen}
          onClose={() => setIsProfileModalOpen(false)}
        />
      )}</Suspense>
    </header>
  );
}
