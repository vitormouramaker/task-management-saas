import { firebaseConfig, getMessagingIfSupported, getToken, onMessage } from "./firebase";
import { toast } from "../store/use-toast-store";

const SERVICE_WORKER_READY_TIMEOUT_MS = 10000;

// Chave pública VAPID do projeto Firebase (Cloud Messaging > Web Push).
const VAPID_KEY = (import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined) || undefined;

function getMessagingServiceWorkerUrl() {
  const baseUrl = import.meta.env.BASE_URL || "/";
  const url = new URL("firebase-messaging-sw.js", window.location.origin + baseUrl);
  // O service worker não enxerga as variáveis do Vite: a configuração pública
  // do app web do Firebase vai na própria URL de registro.
  url.searchParams.set("config", JSON.stringify(firebaseConfig));
  return url.toString();
}

async function registerMessagingServiceWorker() {
  const serviceWorkerUrl = getMessagingServiceWorkerUrl();

  console.log("[Push] Registrando service worker do FCM em", serviceWorkerUrl);

  const registration = await navigator.serviceWorker.register(serviceWorkerUrl);

  console.log("[Push] Service worker registrado:", {
    scope: registration.scope,
    active: Boolean(registration.active),
    waiting: Boolean(registration.waiting),
    installing: Boolean(registration.installing),
  });

  return registration;
}

async function waitForMessagingServiceWorker() {
  const registration = await registerMessagingServiceWorker();

  if (registration.active) {
    console.log("[Push] Service worker já está ativo.");
    return registration;
  }

  console.log("[Push] Aguardando ativação do service worker...");

  const readyRegistration = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, reject) => {
      window.setTimeout(() => {
        reject(
          new Error(
            "Timeout ao aguardar ativação do service worker do Firebase.",
          ),
        );
      }, SERVICE_WORKER_READY_TIMEOUT_MS);
    }),
  ]);

  console.log("[Push] Service worker ativo:", {
    scope: readyRegistration.scope,
    scriptURL: readyRegistration.active?.scriptURL,
  });

  return readyRegistration;
}

export async function requestNotificationPermissionAndToken() {
  try {
    const messaging = await getMessagingIfSupported();
    if (!messaging) {
      // Sem alarde: o aviso aparecia em todo iPhone fora da tela de início.
      console.info("[Push] Navegador sem suporte a notificações push.");
      return null;
    }

    console.log(
      "[Push] Permissão atual do navegador:",
      Notification.permission,
    );

    const permission =
      Notification.permission === "granted"
        ? "granted"
        : await Notification.requestPermission();

    console.log("[Push] Permissão após solicitação:", permission);

    if (permission !== "granted") {
      toast.warning("Permissão de notificação negada.", {
        message: "Autorize as notificações no navegador para receber avisos.",
      });
      console.warn("[Push] Permissão de notificação negada pelo usuário.");
      return null;
    }

    try {
      const registration = await waitForMessagingServiceWorker();

      console.log("[Push] Solicitando token FCM ao Firebase...");

      const token = await getToken(messaging, {
        vapidKey: VAPID_KEY,
        serviceWorkerRegistration: registration,
      });

      if (!token) {
        console.warn("[Push] O Firebase não retornou um token FCM.");
        return null;
      }

      console.log("[Push] Token FCM retornado pelo Firebase.");
      return token;
    } catch (err) {
      console.error("[Push] Erro ao obter token FCM:", err);
      return null;
    }
  } catch (err) {
    console.error(
      "[Push] Erro inesperado ao solicitar permissão ou obter token:",
      err,
    );
    return null;
  }
}

/**
 * Avisos com o app aberto. Devolve sempre uma função de limpeza: se o
 * navegador não tiver suporte, simplesmente não escuta nada.
 */
export function listenForegroundNotifications(onNotify: (payload: any) => void) {
  let cancelar: (() => void) | null = null;
  let cancelado = false;

  void getMessagingIfSupported()
    .then((messaging) => {
      if (!messaging || cancelado) return;
      console.log("[Push] Registrando listener de notificações em foreground.");
      cancelar = onMessage(messaging, (payload) => onNotify(payload));
    })
    .catch((error) => console.warn("[Push] não foi possível escutar notificações:", error));

  return () => {
    cancelado = true;
    cancelar?.();
  };
}
