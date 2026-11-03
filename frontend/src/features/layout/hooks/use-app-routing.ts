import { useEffect, useRef } from "react";
import { buildPath, parseRoute, sameRoute, type AppRoute } from "../../../lib/app-router";
import { useTaskStore } from "../../../store/use-task-store";

/**
 * Liga a tela aberta ao endereço do navegador nos dois sentidos: navegar pelo
 * app troca o endereço, e voltar/avançar no navegador troca a tela.
 */
export function useAppRouting(seedPronto: boolean) {
  const aplicando = useRef(false);
  const ultimaRota = useRef<AppRoute | null>(null);

  // Endereço → tela (primeira carga e botão voltar).
  useEffect(() => {
    if (!seedPronto) return;

    const aplicar = (rota: AppRoute) => {
      const store = useTaskStore.getState();
      aplicando.current = true;

      if (rota.page === "tasks" && rota.listId) {
        if (store.graph.lists[rota.listId]) {
          if (store.selection.listId !== rota.listId) store.setActiveList(rota.listId);
          if (rota.view && store.ui.activeView !== rota.view) store.setActiveView(rota.view);
        } else {
          // Projeto que a pessoa não acessa (ou foi apagado): volta para o início.
          store.setActivePage("home");
        }
      } else if (store.ui.activePage !== rota.page) {
        store.setActivePage(rota.page);
      }

      if (rota.taskId && store.graph.tasks[rota.taskId]) {
        if (store.ui.activeTaskIdForDetails !== rota.taskId) store.openTaskDetails(rota.taskId);
      } else if (!rota.taskId && store.ui.activeTaskIdForDetails) {
        store.closeTaskDetails();
      }

      ultimaRota.current = rota;
      aplicando.current = false;

      // Endereço desconhecido vira o endereço certo da tela que abriu.
      const caminhoCerto = buildPath(rota);
      const atual = `${window.location.pathname}${window.location.search}`;
      if (caminhoCerto !== atual && !atual.startsWith("/projeto/")) {
        window.history.replaceState({}, "", caminhoCerto);
      }
    };

    aplicar(parseRoute());

    const aoVoltar = () => aplicar(parseRoute());
    window.addEventListener("popstate", aoVoltar);
    return () => window.removeEventListener("popstate", aoVoltar);
  }, [seedPronto]);

  // Tela → endereço.
  useEffect(() => {
    if (!seedPronto) return;

    return useTaskStore.subscribe((state) => {
      if (aplicando.current) return;

      const rota: AppRoute = {
        page: (state.ui.activePage || "home") as AppRoute["page"],
        listId: state.ui.activePage === "tasks" ? state.selection.listId : null,
        view: state.ui.activePage === "tasks" ? state.ui.activeView : null,
        taskId: state.ui.activeTaskIdForDetails || null,
      };

      if (ultimaRota.current && sameRoute(ultimaRota.current, rota)) return;
      if (rota.page === "tasks" && !rota.listId) return;

      const anterior = ultimaRota.current;
      ultimaRota.current = rota;
      const caminho = buildPath(rota);
      if (caminho === `${window.location.pathname}${window.location.search}`) return;

      // Abrir e fechar card não enche o histórico: só troca o endereço.
      const trocaDeTela = !anterior || anterior.page !== rota.page || (anterior.listId || null) !== (rota.listId || null);
      if (trocaDeTela) {
        window.history.pushState({}, "", caminho);
      } else {
        window.history.replaceState({}, "", caminho);
      }
    });
  }, [seedPronto]);
}
