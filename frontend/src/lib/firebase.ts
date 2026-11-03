// src/lib/firebase.ts
import { initializeApp, type FirebaseApp } from "firebase/app";
import { getMessaging, getToken, isSupported, onMessage, type Messaging } from "firebase/messaging";

// Configuração do app web do Firebase (push). Vem do .env.local do front
// (VITE_FIREBASE_*). Sem ela, as notificações push ficam desligadas e o resto
// da plataforma funciona normalmente (os avisos continuam no sininho).
export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
};

export const firebaseConfigurado = Boolean(
  firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.messagingSenderId && firebaseConfig.appId,
);


let app: FirebaseApp | null = null;
let messagingPromise: Promise<Messaging | null> | null = null;

function getApp() {
  if (!app) app = initializeApp(firebaseConfig);
  return app;
}

/**
 * Mensageria do Firebase só onde o navegador aguenta.
 *
 * Em iPhone fora da tela de início, em navegadores embutidos (Instagram,
 * WhatsApp) e em aba anônima, `getMessaging` lança erro. Antes isso acontecia
 * já na importação e derrubava o app inteiro (tela branca); agora devolve null
 * e o resto da plataforma continua funcionando.
 */
export function getMessagingIfSupported(): Promise<Messaging | null> {
  if (!messagingPromise) {
    messagingPromise = (async () => {
      try {
        if (typeof window === "undefined") return null;
        if (!firebaseConfigurado) return null;
        if (!("Notification" in window) || !("serviceWorker" in navigator)) return null;
        if (!(await isSupported())) return null;
        return getMessaging(getApp());
      } catch (error) {
        console.warn("[Push] mensageria indisponível neste navegador:", error);
        return null;
      }
    })();
  }

  return messagingPromise;
}

export { getApp, getToken, onMessage };
