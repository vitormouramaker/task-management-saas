import { Suspense, lazy, useEffect, useState } from "react";
import { useAuthStore } from "../../../store/use-auth-store";
import { AppLoadingScreen } from "../../layout/components/app-loading-screen";
import type { AdminNavigate } from "../admin-shared";

// Carregado à parte: o código do painel só é baixado por quem é da equipe.
const AdminApp = lazy(() => import("./admin-app"));

interface AdminGateProps {
  pathname: string;
  navigate: AdminNavigate;
  onExit: () => void;
}

/**
 * Entrada do painel em /admin. Quem não é da equipe volta para o app sem
 * aviso. A proteção de verdade é a API (/api/admin exige super-admin).
 */
export function AdminGate({ pathname, navigate, onExit }: AdminGateProps) {
  const isPlatformAdmin = useAuthStore((state) => state.user?.isPlatformAdmin);
  const refreshSession = useAuthStore((state) => state.refreshSession);
  const [conferido, setConferido] = useState(isPlatformAdmin !== undefined);

  // Sessão salva antes desta versão não traz a permissão: confirma no servidor.
  useEffect(() => {
    if (conferido) return;
    void Promise.resolve(refreshSession()).finally(() => setConferido(true));
  }, [conferido, refreshSession]);

  useEffect(() => {
    if (conferido && !useAuthStore.getState().user?.isPlatformAdmin) onExit();
  }, [conferido, isPlatformAdmin, onExit]);

  if (!conferido || !isPlatformAdmin) return <AppLoadingScreen />;

  return (
    <Suspense fallback={<AppLoadingScreen />}>
      <AdminApp pathname={pathname} navigate={navigate} onExit={onExit} />
    </Suspense>
  );
}
