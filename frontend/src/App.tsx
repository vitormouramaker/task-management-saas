import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { Button } from "./components/ui/button";
import { AppShell } from "./features/layout/components/app-shell";
import { AdminGate } from "./features/admin/components/admin-gate";
import { TipsUnsubscribePage } from "./features/onboarding/components/tips-unsubscribe-page";
import { useWorkspaceSeedQuery } from "./features/tasks/hooks/use-workspace-seed-query";
import { useTaskStore } from "./store/use-task-store";
import { toast } from "./store/use-toast-store";
import { useAuthStore } from "./store/use-auth-store";
import { LoginPage } from "./features/auth/components/login-page";
import { SignupPage } from "./features/auth/components/signup-page";
import { AccountCompletionPage } from "./features/account/components/account-completion-page";
import { EmailVerificationGate } from "./features/account/components/email-verification-gate";
import { PlanOnboardingPage } from "./features/billing/components/plan-onboarding-page";
import { CookieNotice } from "./features/legal/components/cookie-notice";
import { LegalAcceptanceGate } from "./features/legal/components/legal-acceptance-gate";
import { LegalDocumentPage } from "./features/legal/components/legal-document-page";
import { PRIVACY, TERMS } from "./features/legal/legal-content";
import {
  InvitationPage,
  PENDING_INVITE_STORAGE_KEY,
} from "./features/account/components/invitation-page";
import { VerifyEmailPage } from "./features/account/components/verify-email-page";
import { ForgotPasswordPage } from "./features/auth/components/forgot-password-page";
import { ResetPasswordPage } from "./features/auth/components/reset-password-page";
import { BillingSuccessPage } from "./features/billing/components/billing-success-page";
import { AppLoadingScreen } from "./features/layout/components/app-loading-screen";
import { getApiOrigin } from "./lib/api";
import {
  playPushNotificationSound,
  primePushNotificationSound,
} from "./lib/push-notification-sound";
import { cn } from "./lib/utils";
import { realtimeClient } from "./lib/realtime";
import { useShallow } from "zustand/react/shallow";

import {
  requestNotificationPermissionAndToken,
  listenForegroundNotifications,
} from "./lib/notifications";
import {
  navigateFromNotificationTarget,
  getNotificationActionLabel,
  parseNotificationNavigationUrl,
  stripNotificationNavigationParams,
} from "./lib/notification-navigation";

const PUSH_TOAST_DURATION_MS = 6500;

export function App() {
  const graph = useTaskStore((state) => state.graph);
  const seedInitialized = useTaskStore((state) => state.seedInitialized);
  const currentSeedUserId = useTaskStore((state) => state.currentUser);
  const hydrateFromSeed = useTaskStore((state) => state.hydrateFromSeed);
  const fetchNotifications = useTaskStore((state) => state.fetchNotifications);
  const fetchEmails = useTaskStore((state) => state.fetchEmails);
  const applyRealtimeEvent = useTaskStore((state) => state.applyRealtimeEvent);
  const setActiveList = useTaskStore((state) => state.setActiveList);
  const setActiveWorkspace = useTaskStore((state) => state.setActiveWorkspace);
  const openTaskDetails = useTaskStore((state) => state.openTaskDetails);
  const workspaceIds = useTaskStore(
    useShallow((state) => Object.keys(state.graph.workspaces).sort()),
  );
  const query = useWorkspaceSeedQuery();

  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const authUser = useAuthStore((state) => state.user);
  const token = useAuthStore((state) => state.token);
  const [showForgot, setShowForgot] = useState(false);
  const [showSignup, setShowSignup] = useState(false);
  const [pathname, setPathname] = useState(() => window.location.pathname);
  const handledPushNavigationRef = useRef<string | null>(null);
  const seedErrorMessage = axios.isAxiosError(query.error)
    ? `API ${getApiOrigin()} respondeu ${query.error.response?.status ?? "sem status"} para ${query.error.config?.url ?? "/api/workspaces/seed"}.`
    : query.error instanceof Error
      ? query.error.message
      : "Erro desconhecido ao carregar a API.";
  const isSeedReadyForCurrentUser =
    !!authUser && seedInitialized && currentSeedUserId === authUser.id;

  const showPushToast = (title: string, message: string, url?: string) => {
    toast.custom({
      tone: "info",
      title,
      message,
      duration: PUSH_TOAST_DURATION_MS,
      action: url
        ? {
            label: getNotificationActionLabel(url),
            onClick: () => handlePushNotificationNavigate(url),
          }
        : undefined,
    });
  };

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    const unlockPushSound = () => {
      void primePushNotificationSound();
    };

    void primePushNotificationSound();

    window.addEventListener("pointerdown", unlockPushSound, { once: true });
    window.addEventListener("keydown", unlockPushSound, { once: true });

    return () => {
      window.removeEventListener("pointerdown", unlockPushSound);
      window.removeEventListener("keydown", unlockPushSound);
    };
  }, [isAuthenticated]);

  // Notificações Push: Solicita permissão e obtém token ao autenticar
  useEffect(() => {
    let isMounted = true;
    let unsubscribeForeground: (() => void) | undefined;

    if (isAuthenticated && authUser) {
      console.log(
        "[Push] Usuário autenticado, iniciando fluxo de permissão e obtenção do token FCM...",
      );
      requestNotificationPermissionAndToken().then((fcmToken) => {
        console.log(
          "[Push] Resultado da solicitação de permissão/token:",
          fcmToken ? "token obtido" : "sem token",
        );
        if (fcmToken && isMounted && token) {
          fetch(`${getApiOrigin()}/api/push/register`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              fcmToken,
              appOrigin: window.location.origin,
            }),
          })
            .then((res) => {
              if (!res.ok) throw new Error("Falha ao registrar token FCM");
              return res.json();
            })
            .then((data) => {
              console.log("[Push] Token FCM registrado no backend:", data);
            })
            .catch((err) => {
              console.error("[Push] Erro ao registrar token FCM:", err);
            });
        } else {
          console.warn(
            "[Push] Token FCM não obtido ou usuário não autenticado.",
          );
        }
      });

      // Listener para notificações em foreground
      unsubscribeForeground = listenForegroundNotifications((payload) => {
        console.log("[Push] Notificação recebida em foreground:", payload);

        const toastTitle =
          payload?.notification?.title || "Nova notificação recebida";
        const toastMessage =
          payload?.notification?.body ||
          "Abra a central de notificações para ver mais detalhes.";
        const toastUrl =
          typeof payload?.data?.url === "string" ? payload.data.url : undefined;

        void playPushNotificationSound();
        showPushToast(toastTitle, toastMessage, toastUrl);
        void fetchNotifications();
      });
    } else {
      console.log(
        "[Push] Usuário não autenticado, fluxo de notificações não iniciado.",
      );
    }

    return () => {
      isMounted = false;
      unsubscribeForeground?.();
    };
  }, [isAuthenticated, authUser, token]);

  useEffect(() => {
    if (query.data && isAuthenticated) {
      hydrateFromSeed(query.data);

      // O endereço da foto é assinado e expira; o seed traz sempre o atual.
      const membros = (query.data as { graph?: { members?: Record<string, { id: string; avatarUrl?: string }> } })
        ?.graph?.members;
      const eu = membros ? Object.values(membros).find((m) => m.id === authUser?.id) : null;
      if (eu && eu.avatarUrl !== authUser?.avatarUrl) {
        useAuthStore.setState((state) => ({
          user: state.user ? { ...state.user, avatarUrl: eu.avatarUrl } : state.user,
        }));
      }
      fetchNotifications();
      fetchEmails();
    }
  }, [
    query.data,
    hydrateFromSeed,
    isAuthenticated,
    fetchNotifications,
    fetchEmails,
  ]);

  useEffect(() => {
    if (!isAuthenticated || !isSeedReadyForCurrentUser) {
      return;
    }

    const currentUrl = new URL(window.location.href);
    const target = parseNotificationNavigationUrl(currentUrl);

    if (!target) {
      handledPushNavigationRef.current = null;
      return;
    }

    if (handledPushNavigationRef.current === target.key) {
      return;
    }

    const handled = navigateFromNotificationTarget(target, {
      graph,
      setActiveWorkspace,
      setActiveList,
      openTaskDetails,
    });

    if (!handled) {
      return;
    }

    handledPushNavigationRef.current = target.key;
    window.history.replaceState(
      {},
      "",
      stripNotificationNavigationParams(currentUrl),
    );
  }, [
    graph,
    isAuthenticated,
    isSeedReadyForCurrentUser,
    openTaskDetails,
    setActiveList,
    setActiveWorkspace,
  ]);

  const handlePushNotificationNavigate = (url?: string) => {
    const target = parseNotificationNavigationUrl(url);

    if (!target) {
      return;
    }

    navigateFromNotificationTarget(target, {
      graph,
      setActiveWorkspace,
      setActiveList,
      openTaskDetails,
    });
  };

  useEffect(() => {
    if (!isAuthenticated) return;

    const interval = window.setInterval(() => {
      fetchNotifications();
      fetchEmails();
    }, 120000);

    return () => window.clearInterval(interval);
  }, [isAuthenticated, fetchNotifications, fetchEmails]);

  useEffect(() => {
    if (!isAuthenticated || !token) {
      realtimeClient.disconnect();
      return;
    }

    realtimeClient.connect(token);
    return () => {
      realtimeClient.disconnect();
    };
  }, [isAuthenticated, token]);

  useEffect(() => {
    const unsubscribe = realtimeClient.subscribe((event) => {
      if (event.type === "seed.refetch") {
        void query.refetch();
        return;
      }

      applyRealtimeEvent(event);
    });

    return unsubscribe;
  }, [applyRealtimeEvent, query.refetch]);

  useEffect(() => {
    if (!isAuthenticated || !isSeedReadyForCurrentUser) {
      realtimeClient.setWorkspaceSubscriptions([]);
      return;
    }

    realtimeClient.setWorkspaceSubscriptions(workspaceIds);
  }, [isAuthenticated, isSeedReadyForCurrentUser, workspaceIds]);

  useEffect(() => {
    const handlePopState = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  // Depois do login, volta para o convite que a pessoa estava aceitando.
  useEffect(() => {
    if (!isAuthenticated || window.location.pathname === "/convite") return;
    const pendingInviteToken = sessionStorage.getItem(PENDING_INVITE_STORAGE_KEY);
    if (!pendingInviteToken) return;
    window.history.replaceState(
      {},
      "",
      `/convite?token=${encodeURIComponent(pendingInviteToken)}`,
    );
    setPathname("/convite");
  }, [isAuthenticated]);

  const navigateTo = useCallback((to: string) => {
    window.history.pushState({}, "", to);
    setPathname(window.location.pathname);
  }, []);

  const exitAdmin = useCallback(() => {
    window.history.replaceState({}, "", "/");
    setPathname("/");
  }, []);

  const goToLogin = () => {
    setShowForgot(false);
    setShowSignup(false);
    if (window.location.pathname !== "/") {
      window.history.replaceState({}, "", "/");
      setPathname("/");
    }
  };

  // Documentos jurídicos abrem sem login (links em e-mails e no rodapé).
  if (pathname === "/termos" || pathname === "/privacidade") {
    return (
      <LegalDocumentPage
        document={pathname === "/termos" ? TERMS : PRIVACY}
        onBack={() => {
          window.history.replaceState({}, "", "/");
          setPathname("/");
        }}
      />
    );
  }

  if (pathname === "/sair-das-dicas") {
    return <TipsUnsubscribePage onDone={goToLogin} />;
  }

  if (pathname === "/convite") {
    return <InvitationPage onDone={goToLogin} onGoToLogin={goToLogin} />;
  }

  if (pathname === "/verificar-email") {
    return <VerifyEmailPage onDone={goToLogin} />;
  }

  if (pathname === "/reset-password") {
    return <ResetPasswordPage onGoBack={goToLogin} />;
  }

  if (pathname === "/billing/success") {
    return (
      <BillingSuccessPage
        onGoToApp={() => {
          window.history.replaceState({}, "", "/");
          setPathname("/");
        }}
      />
    );
  }

  // Se não estiver autenticado, mostrarmos o fluxo de Login/Esqueci a Senha
  if (!isAuthenticated) {
    if (showSignup) {
      return <SignupPage onGoToLogin={goToLogin} />;
    }
    if (showForgot) {
      return <ForgotPasswordPage onGoBack={goToLogin} />;
    }
    return (
      <LoginPage
        onGoToForgot={() => {
          setShowSignup(false);
          setShowForgot(true);
        }}
        onGoToSignup={() => {
          setShowForgot(false);
          setShowSignup(true);
        }}
      />
    );
  }

  // Painel da equipe do Pauta em endereço próprio, com layout próprio.
  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    return <AdminGate pathname={pathname} navigate={navigateTo} onExit={exitAdmin} />;
  }

  // Documentos atualizados: confirmação antes de seguir.
  if (isAuthenticated && authUser?.requiresLegalAcceptance) {
    return <LegalAcceptanceGate />;
  }

  // Cadastro novo precisa confirmar o e-mail antes de usar o app.
  if (authUser?.emailVerified === false) {
    return <EmailVerificationGate />;
  }

  // Titular de conta antiga precisa informar CPF/CNPJ antes de continuar.
  if (authUser?.requiresAccountCompletion) {
    return <AccountCompletionPage />;
  }

  // Primeiro acesso do titular: escolher entre Grátis, teste de 14 dias ou assinar.
  if (
    isAuthenticated &&
    authUser?.organization?.onboardingPending &&
    ["owner", "admin"].includes(authUser.organization.role)
  ) {
    return <PlanOnboardingPage />;
  }

  if (isAuthenticated && !isSeedReadyForCurrentUser && query.isPending) {
    return <AppLoadingScreen />;
  }

  if (isAuthenticated && !isSeedReadyForCurrentUser && query.isError) {
    return (
      <div className="pauta-app-error grid min-h-dvh place-items-center p-6">
        <div
          className={cn(
            "pauta-app-error-card w-full max-w-md rounded-2xl border p-6",
            "border-(--ui-rose-borda) bg-(--ui-superficie)",
          )}
        >
          <h1 className="text-lg font-bold text-rose-700">
            Falha ao carregar dados
          </h1>
          <p
            className={cn(
              "mt-2 text-sm",
              "text-(--ui-texto-secundario)",
            )}
          >
            Nao foi possivel inicializar o quadro. Tente novamente para
            recarregar os dados iniciais.
          </p>
          <p
            className={cn(
              "mt-3 rounded-lg px-3 py-2 text-xs",
              "bg-(--ui-fundo-sutil) text-(--ui-texto-secundario)",
            )}
          >
            {seedErrorMessage}
          </p>
          <Button className="mt-4" onClick={() => void query.refetch()}>
            Tentar novamente
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <AppShell />
      <CookieNotice />
    </>
  );
}
