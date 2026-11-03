import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";

import { App } from "./App";
import { ErrorBoundary } from "./components/error-boundary";
import { ConfirmationHost } from "./components/ui/confirmation-host";
import { ToastRegion } from "./components/ui/toast-region";
import "./index.css";
import { AppLoadingScreen } from "./features/layout/components/app-loading-screen";
import { initializeApiOrigin } from "./lib/api";
import { iniciarMonitoramento, identificarUsuario } from "./lib/monitoring";
import { queryClient } from "./lib/query-client";
import { useAuthStore } from "./store/use-auth-store";
import {
  applyThemeMode,
  resolveInitialThemeMode,
} from "./store/use-theme-store";

iniciarMonitoramento();
// O erro registrado diz qual conta estava na tela, pelo id (sem nome nem e-mail).
useAuthStore.subscribe((estado) => identificarUsuario(estado.user?.id ?? null));
applyThemeMode(resolveInitialThemeMode());
const root = ReactDOM.createRoot(document.getElementById("app")!);

root.render(<AppLoadingScreen />);

// Falha aqui não pode deixar a tela em branco: o app sobe com o endereço
// padrão e as telas mostram o erro da requisição.
try {
  await initializeApiOrigin();
} catch (error) {
  console.error("[pauta] não foi possível descobrir o endereço da API:", error);
}

root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <App />
        <ToastRegion />
        <ConfirmationHost />
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
