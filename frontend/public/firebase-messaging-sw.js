// Service Worker do Firebase Cloud Messaging
importScripts(
  "https://www.gstatic.com/firebasejs/10.11.0/firebase-app-compat.js",
);
importScripts(
  "https://www.gstatic.com/firebasejs/10.11.0/firebase-messaging-compat.js",
);

// A configuração pública do app web do Firebase chega pela URL de registro
// (veja src/lib/notifications.ts), lida das variáveis VITE_FIREBASE_*.
let firebaseConfig = null;
try {
  firebaseConfig = JSON.parse(new URL(self.location.href).searchParams.get("config") || "null");
} catch {
  firebaseConfig = null;
}

if (firebaseConfig && firebaseConfig.apiKey && firebaseConfig.projectId) {
  firebase.initializeApp(firebaseConfig);
  const messaging = firebase.messaging();

  messaging.onBackgroundMessage(function (payload) {
    // Exibe a notificação mesmo com o app fechado
    self.registration.showNotification(payload.notification.title, {
      body: payload.notification.body,
      icon: payload.notification.icon || "/favicon.svg",
      data: payload.data || {},
    });
  });
}

self.addEventListener("notificationclick", function (event) {
  event.notification.close();

  const rawUrl = event.notification?.data?.url || "/";
  const targetUrl = new URL(rawUrl, self.location.origin).href;

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windowClients) => {
        for (const client of windowClients) {
          if (client.url === targetUrl && "focus" in client) {
            return client.focus();
          }

          if (
            client.url.startsWith(self.location.origin) &&
            "focus" in client
          ) {
            client.navigate?.(targetUrl);
            return client.focus();
          }
        }

        if (clients.openWindow) {
          return clients.openWindow(targetUrl);
        }

        return undefined;
      }),
  );
});
