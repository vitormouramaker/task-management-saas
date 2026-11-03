import { useState } from "react";
import {
  ArrowLeft,
  Building2,
  FileText,
  Bug,
  HeartCrack,
  Star,
  Headphones,
  Inbox,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  ShieldCheck,
  Sun,
  X,
  HardDrive,
} from "lucide-react";
import { cn } from "../../../lib/utils";
import { useAuthStore } from "../../../store/use-auth-store";
import { useThemeStore } from "../../../store/use-theme-store";
import type { AdminNavigate } from "../admin-shared";
import { EnterpriseRequestsPage } from "./enterprise-requests-page";
import { CostsPage } from "./costs-page";
import { ErrorsPage } from "./errors-page";
import { OrganizationDetailPage } from "./organization-detail-page";
import { OrganizationsPage } from "./organizations-page";
import { OverviewPage } from "./overview-page";
import { CancellationsPage } from "./cancellations-page";
import { InvoicesPage } from "./invoices-page";
import { SupportInboxPage } from "./support-inbox-page";
import { SupportSurveysPage } from "./support-surveys-page";

interface AdminAppProps {
  pathname: string;
  navigate: AdminNavigate;
  onExit: () => void;
}

const NAV_ITEMS = [
  { path: "/admin", label: "Visão geral", icon: LayoutDashboard },
  { path: "/admin/contas", label: "Contas", icon: Building2 },
  { path: "/admin/suporte", label: "Suporte", icon: Headphones },
  { path: "/admin/notas-fiscais", label: "Notas fiscais", icon: FileText },
  { path: "/admin/enterprise", label: "Solicitações Enterprise", icon: Inbox },
  { path: "/admin/satisfacao", label: "Satisfação do suporte", icon: Star },
  { path: "/admin/cancelamentos", label: "Cancelamentos", icon: HeartCrack },
  { path: "/admin/custos", label: "Custos", icon: HardDrive },
  { path: "/admin/erros", label: "Erros", icon: Bug },
];

/** Painel da equipe do Pauta, em endereço próprio e com layout próprio. */
export default function AdminApp({ pathname, navigate, onExit }: AdminAppProps) {
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const isDarkMode = useThemeStore((state) => state.mode === "dark");
  const toggleMode = useThemeStore((state) => state.toggleMode);
  const [menuAberto, setMenuAberto] = useState(false);

  const path = pathname.replace(/\/+$/, "") || "/admin";
  const contaId = path.match(/^\/admin\/contas\/([^/]+)$/)?.[1];
  const suporteId = path.match(/^\/admin\/suporte\/([^/]+)$/)?.[1];

  const isActive = (itemPath: string) =>
    itemPath === "/admin" ? path === "/admin" : path.startsWith(itemPath);

  const ir = (destino: string) => {
    navigate(destino);
    setMenuAberto(false);
  };

  let conteudo: React.ReactNode;
  if (contaId) {
    conteudo = <OrganizationDetailPage id={decodeURIComponent(contaId)} navigate={navigate} />;
  } else if (path === "/admin/suporte" || suporteId) {
    conteudo = (
      <SupportInboxPage
        conversationId={suporteId ? decodeURIComponent(suporteId) : undefined}
        navigate={navigate}
      />
    );
  } else if (path === "/admin/satisfacao") {
    conteudo = <SupportSurveysPage navigate={navigate} />;
  } else if (path === "/admin/cancelamentos") {
    conteudo = <CancellationsPage />;
  } else if (path === "/admin/custos") {
    conteudo = <CostsPage />;
  } else if (path === "/admin/erros") {
    conteudo = <ErrorsPage />;
  } else if (path === "/admin/notas-fiscais") {
    conteudo = <InvoicesPage navigate={navigate} />;
  } else if (path === "/admin/contas") {
    conteudo = <OrganizationsPage navigate={navigate} />;
  } else if (path === "/admin/enterprise") {
    conteudo = <EnterpriseRequestsPage navigate={navigate} />;
  } else {
    conteudo = <OverviewPage navigate={navigate} />;
  }

  const sidebar = (
    <aside
      className={cn(
        "flex h-full w-64 shrink-0 flex-col border-r",
        "border-(--ui-borda) bg-(--ui-superficie)",
      )}
    >
      <div className="flex h-20 items-center justify-between px-5">
        <div className="flex items-center gap-2">
          <img
            src={isDarkMode ? "/icone-pauta.svg" : "/icone-pauta-dark.svg"}
            alt="Pauta"
            className="h-7 w-auto"
          />
          <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-rose-600">
            <ShieldCheck className="h-3 w-3" />
            Admin
          </span>
        </div>
        <button
          type="button"
          onClick={() => setMenuAberto(false)}
          aria-label="Fechar menu"
          className="cursor-pointer lg:hidden"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <nav className="flex-1 space-y-1 px-3">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.path}
            type="button"
            onClick={() => ir(item.path)}
            className={cn(
              "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold transition-colors cursor-pointer",
              isActive(item.path)
                ? "bg-blue-600 text-white"
                : "text-(--ui-texto-secundario) hover:bg-(--ui-hover-forte)",
            )}
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </button>
        ))}
      </nav>

      <div
        className={cn(
          "space-y-1 border-t p-3",
          "border-(--ui-borda-suave)",
        )}
      >
        <p className={cn("truncate px-3 pb-2 text-xs font-bold", "text-(--ui-texto-secundario)")}>
          {user?.name}
          <span className="block truncate font-medium">{user?.email}</span>
        </p>
        {[
          { label: isDarkMode ? "Tema claro" : "Tema escuro", icon: isDarkMode ? Sun : Moon, onClick: toggleMode },
          { label: "Voltar para o Pauta", icon: ArrowLeft, onClick: onExit },
          { label: "Sair", icon: LogOut, onClick: logout },
        ].map((item) => (
          <button
            key={item.label}
            type="button"
            onClick={item.onClick}
            className={cn(
              "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-bold transition-colors cursor-pointer",
              "text-(--ui-texto-secundario) hover:bg-(--ui-hover-forte)",
            )}
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </button>
        ))}
      </div>
    </aside>
  );

  return (
    <div
      className={cn(
        "flex h-dvh w-full overflow-hidden",
        "bg-(--ui-fundo-sutil) text-(--ui-texto-principal)",
      )}
    >
      <div className="hidden lg:flex">{sidebar}</div>

      {menuAberto && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMenuAberto(false)} />
          <div className="relative">{sidebar}</div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <div
          className={cn(
            "flex h-14 items-center gap-3 border-b px-4 lg:hidden",
            "border-(--ui-borda) bg-(--ui-superficie)",
          )}
        >
          <button type="button" onClick={() => setMenuAberto(true)} aria-label="Abrir menu" className="cursor-pointer">
            <Menu className="h-5 w-5" />
          </button>
          <span className="text-sm font-black">Pauta · Super-admin</span>
        </div>
        <main className="flex-1 overflow-auto px-4 py-6 sm:px-8 sm:py-8">
          <div className="mx-auto w-full max-w-6xl">{conteudo}</div>
        </main>
      </div>
    </div>
  );
}
