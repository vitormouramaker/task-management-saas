import type { TaskSeedData, WorkspaceGraph } from "../../../types/tasks";

const graph: WorkspaceGraph = {
  workspaces: {
    ws_1: {
      id: "ws_1",
      name: "Estúdio Pauta",
      spaceIds: ["sp_design", "sp_growth"],
    },
  },
  spaces: {
    sp_design: {
      id: "sp_design",
      workspaceId: "ws_1",
      name: "Design",
      icon: "Sparkles",
      folderIds: ["fd_app", "fd_site"],
    },
    sp_growth: {
      id: "sp_growth",
      workspaceId: "ws_1",
      name: "Crescimento",
      icon: "TrendingUp",
      folderIds: ["fd_campaigns"],
    },
  },
  folders: {
    fd_app: {
      id: "fd_app",
      spaceId: "sp_design",
      name: "App Mindlax",
      listIds: [],
    },
    fd_site: {
      id: "fd_site",
      spaceId: "sp_design",
      name: "Site de Marketing",
      listIds: [],
    },
    fd_campaigns: {
      id: "fd_campaigns",
      spaceId: "sp_growth",
      name: "Campanhas",
      listIds: [],
    },
  },
  lists: {},
  tasks: {},
  members: {
    m_brandon: {
      id: "m_brandon",
      name: "Brandon Workman",
      role: "Gerente de Projeto",
      avatarColor: "bg-sky-500",
    },
    m_talia: {
      id: "m_talia",
      name: "Talia Aminoff",
      role: "Designer de Produto",
      avatarColor: "bg-rose-500",
    },
    m_lydia: {
      id: "m_lydia",
      name: "Lydia Workman",
      role: "Pesquisadora de UX",
      avatarColor: "bg-violet-500",
    },
    m_jordyn: {
      id: "m_jordyn",
      name: "Jordyn Kenter",
      role: "Designer de UI",
      avatarColor: "bg-emerald-500",
    },
  },
  statusDefinitions: [
    {
      id: "st_backlog",
      name: "Lista de Espera",
      colorClass: "bg-slate-50",
      chipClass: "bg-slate-100 text-slate-700 ring-slate-200",
      dotClass: "bg-slate-500",
      order: 1,
    },
    {
      id: "st_todo",
      name: "A Fazer",
      colorClass: "bg-blue-50/50",
      chipClass: "bg-sky-100 text-sky-700 ring-sky-200",
      dotClass: "bg-blue-600",
      order: 2,
    },
    {
      id: "st_progress",
      name: "Andamento",
      colorClass: "bg-orange-50/50",
      chipClass: "bg-amber-100 text-amber-700 ring-amber-200",
      dotClass: "bg-orange-500",
      order: 3,
    },
    {
      id: "st_review",
      name: "Revisão",
      colorClass: "bg-violet-50/50",
      chipClass: "bg-violet-100 text-violet-700 ring-violet-200",
      dotClass: "bg-violet-500",
      order: 4,
    },
    {
      id: "st_done",
      name: "Concluído",
      colorClass: "bg-emerald-50/50",
      chipClass: "bg-emerald-100 text-emerald-700 ring-emerald-200",
      dotClass: "bg-emerald-500",
      order: 5,
    },
  ],
  customFieldDefinitions: {},
  tags: {
    tag_marketing: { id: "tag_marketing", name: "Marketing", color: "#3b82f6" },
    tag_design: { id: "tag_design", name: "Design", color: "#8b5cf6" },
    tag_important: {
      id: "tag_important",
      name: "Importante",
      color: "#ef4444",
    },
    tag_new: { id: "tag_new", name: "Novo", color: "#10b981" },
    tag_copy: { id: "tag_copy", name: "Copywriting", color: "#f97316" },
    tag_dev: { id: "tag_dev", name: "Desenvolvimento", color: "#6366f1" },
    tag_bug: { id: "tag_bug", name: "Bug", color: "#dc2626" },
  },
};

export const mockWorkspaceSeed: TaskSeedData = {
  graph,
  selection: {
    workspaceId: "ws_1",
    spaceId: "sp_design",
    folderId: "fd_app",
    listId: null,
  },
};
