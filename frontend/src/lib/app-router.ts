import type { TaskViewMode } from "../types/tasks";
import { TASK_VIEW_VALUES } from "../types/tasks";

/**
 * Endereços das telas do app.
 *
 * Cada tela tem o seu endereço, então o botão voltar do navegador funciona e
 * dá para mandar o link de um projeto ou de um card para alguém.
 */

export type AppPage = "home" | "tasks" | "members" | "settings" | "trash" | "calendar" | "reports" | "help";

export interface AppRoute {
  page: AppPage;
  listId?: string | null;
  view?: TaskViewMode | null;
  taskId?: string | null;
}

const PAGE_PATHS: Record<Exclude<AppPage, "tasks">, string> = {
  home: "/",
  calendar: "/calendario",
  reports: "/relatorios",
  members: "/membros",
  trash: "/lixeira",
  settings: "/configuracoes",
  help: "/ajuda",
};

const VIEW_SLUGS: Record<TaskViewMode, string> = {
  board: "quadro",
  list: "lista",
  table: "tabela",
  timeline: "timeline",
  calendar: "calendario",
};

const SLUG_TO_VIEW = Object.fromEntries(
  Object.entries(VIEW_SLUGS).map(([view, slug]) => [slug, view as TaskViewMode]),
) as Record<string, TaskViewMode>;

/** Lê o endereço atual (ou o informado) e devolve a tela correspondente. */
export function parseRoute(href: string = window.location.href): AppRoute {
  const url = new URL(href, window.location.origin);
  const caminho = url.pathname.replace(/\/+$/, "") || "/";
  const card = url.searchParams.get("card") || url.searchParams.get("taskId");

  const projeto = caminho.match(/^\/projeto\/([^/]+)$/);
  if (projeto) {
    const slug = url.searchParams.get("visao") || "";
    return {
      page: "tasks",
      listId: decodeURIComponent(projeto[1]),
      view: SLUG_TO_VIEW[slug] || null,
      taskId: card,
    };
  }

  const entrada = Object.entries(PAGE_PATHS).find(([, path]) => path === caminho);
  const page = (entrada?.[0] as AppPage) || "home";

  // Links antigos (?listId=...&taskId=...) continuam valendo.
  const listIdAntigo = url.searchParams.get("listId");
  if (page === "home" && listIdAntigo) {
    return { page: "tasks", listId: listIdAntigo, view: null, taskId: card };
  }

  return { page, listId: null, view: null, taskId: card };
}

/** Monta o endereço de uma tela. */
export function buildPath(route: AppRoute): string {
  if (route.page === "tasks" && route.listId) {
    const params = new URLSearchParams();
    if (route.view && route.view !== "board" && TASK_VIEW_VALUES.includes(route.view)) {
      params.set("visao", VIEW_SLUGS[route.view]);
    }
    if (route.taskId) params.set("card", route.taskId);
    const query = params.toString();
    return `/projeto/${encodeURIComponent(route.listId)}${query ? `?${query}` : ""}`;
  }

  const base = PAGE_PATHS[(route.page === "tasks" ? "home" : route.page) as Exclude<AppPage, "tasks">];
  return route.taskId ? `${base}${base.includes("?") ? "&" : "?"}card=${encodeURIComponent(route.taskId)}` : base;
}

export function sameRoute(a: AppRoute, b: AppRoute) {
  return (
    a.page === b.page &&
    (a.listId || null) === (b.listId || null) &&
    (a.view || null) === (b.view || null) &&
    (a.taskId || null) === (b.taskId || null)
  );
}
