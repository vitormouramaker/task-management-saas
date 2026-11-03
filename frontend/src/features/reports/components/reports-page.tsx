import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock,
  Download,
  Layers,
  Lock,
  UserX,
} from "lucide-react";
import { UserAvatar } from "../../../components/ui/user-avatar";
import { buildApiUrl } from "../../../lib/api";
import { cn } from "../../../lib/utils";
import { useAuthStore } from "../../../store/use-auth-store";
import { useTaskStore } from "../../../store/use-task-store";
import { useThemeStore } from "../../../store/use-theme-store";
import { PRIORITY_CONFIG } from "../../tasks/lib/task-view-helpers";
import type { TaskPriority } from "../../../types/tasks";
import { ListaCarregando } from "../../../components/ui/lista-carregando";

interface ReportResponse {
  range: { from: string; to: string };
  workspaces: Array<{ id: string; name: string }>;
  lists: Array<{ id: string; name: string; workspaceId: string; workspaceName: string }>;
  totals: {
    open: number;
    done: number;
    overdue: number;
    dueSoon: number;
    unassigned: number;
    noDate: number;
    createdInRange: number;
    completedInRange: number;
  };
  byStatus: Array<{ name: string; dotClass: string; total: number }>;
  byPriority: Array<{ priority: TaskPriority; total: number }>;
  byList: Array<{ id: string; name: string; workspaceName: string; open: number; completed: number; overdue: number }>;
  byMember: Array<{ id: string; name: string; avatarColor: string; avatarUrl: string | null; open: number; overdue: number; completed: number }>;
  completedPerWeek: Array<{ week: string; completed: number }>;
  leadTimeDays: { average: number; median: number; base: number } | null;
  oldestOpen: Array<{ id: string; title: string; listName: string; dueDate: string | null; createdAt: string }>;
}

const PERIODS = [
  { id: "7", label: "7 dias", days: 7 },
  { id: "30", label: "30 dias", days: 30 },
  { id: "90", label: "90 dias", days: 90 },
  { id: "365", label: "12 meses", days: 365 },
];

function isoDaysAgo(days: number) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - days + 1);
  return date.toISOString().slice(0, 10);
}

function formatDay(value: string) {
  return new Date(value).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function toCsv(report: ReportResponse) {
  const linhas: string[][] = [
    ["Relatório Pauta"],
    ["Período", `${formatDay(report.range.from)} a ${formatDay(report.range.to)}`],
    [],
    ["Resumo", "Quantidade"],
    ["Cards abertos", String(report.totals.open)],
    ["Concluídos no período", String(report.totals.completedInRange)],
    ["Criados no período", String(report.totals.createdInRange)],
    ["Atrasados", String(report.totals.overdue)],
    ["Vencem em 7 dias", String(report.totals.dueSoon)],
    ["Sem responsável", String(report.totals.unassigned)],
    ["Sem prazo", String(report.totals.noDate)],
    [],
    ["Projeto", "Workspace", "Abertos", "Concluídos no período", "Atrasados"],
    ...report.byList.map((item) => [item.name, item.workspaceName, String(item.open), String(item.completed), String(item.overdue)]),
    [],
    ["Pessoa", "Abertos", "Atrasados", "Concluídos no período"],
    ...report.byMember.map((item) => [item.name, String(item.open), String(item.overdue), String(item.completed)]),
  ];

  return linhas.map((linha) => linha.map((campo) => `"${String(campo).replace(/"/g, '""')}"`).join(";")).join("\n");
}

/** Relatórios da conta: retrato de hoje e entregas do período. */
export function ReportsPage() {
  const isDarkMode = useThemeStore((state) => state.mode === "dark");
  const token = useAuthStore((state) => state.token);
  const advancedReports = useAuthStore((state) => state.user?.organization?.entitlements?.advancedReports);
  const setActivePage = useTaskStore((state) => state.setActivePage);
  const [period, setPeriod] = useState("30");
  const [from, setFrom] = useState(() => isoDaysAgo(30));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [workspaceId, setWorkspaceId] = useState("");
  const [listId, setListId] = useState("");

  const { data, isPending, isError, error } = useQuery({
    queryKey: ["reports", from, to, workspaceId, listId],
    queryFn: async () =>
      (
        await axios.get(buildApiUrl("/api/reports"), {
          headers: { Authorization: `Bearer ${token}` },
          params: { from, to, workspaceId, listId },
        })
      ).data as ReportResponse,
    enabled: advancedReports !== false,
  });

  const muted = "text-(--ui-texto-secundario)";
  const titleColor = "text-(--ui-texto-principal)";
  const border = "border-(--ui-borda)";
  const card = cn("rounded-2xl border p-5", border, "bg-(--ui-superficie)");
  const input = cn(
    "h-9 rounded-lg border px-2 text-xs font-bold",
    "border-(--ui-borda) bg-(--ui-superficie-suave) text-(--ui-texto-forte)",
  );

  const listOptions = useMemo(
    () => (data?.lists || []).filter((list) => !workspaceId || list.workspaceId === workspaceId),
    [data?.lists, workspaceId],
  );

  const semPermissao =
    advancedReports === false ||
    (axios.isAxiosError(error) && (error.response?.data as { code?: string })?.code === "PLAN_FEATURE_REPORTS");

  const baixarCsv = () => {
    if (!data) return;
    const blob = new Blob([`﻿${toCsv(data)}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `relatorio-pauta-${from}-a-${to}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (semPermissao) {
    return (
      <div className="flex h-full w-full flex-col animate-in fade-in duration-300">
        <div className="grid flex-1 place-items-center p-8 text-center">
          <div>
            <Lock className="mx-auto h-10 w-10 text-blue-600" />
            <h1 className={cn("mt-4 text-xl font-black", titleColor)}>Relatórios</h1>
            <p className={cn("mx-auto mt-2 max-w-md text-sm font-medium", muted)}>
              Disponível a partir do plano Profissional: entregas por semana, tempo até concluir, atrasos, carga por
              pessoa e por projeto.
            </p>
            <button
              type="button"
              onClick={() => {
                sessionStorage.setItem("pauta_open_billing_tab", "1");
                setActivePage("settings");
                window.dispatchEvent(new CustomEvent("pauta:open-billing-tab"));
              }}
              className="mt-5 inline-flex h-10 items-center rounded-xl bg-blue-600 px-5 text-sm font-black text-white hover:bg-blue-700 cursor-pointer"
            >
              Ver planos
            </button>
          </div>
        </div>
      </div>
    );
  }

  const maxSemana = Math.max(1, ...(data?.completedPerWeek || []).map((item) => item.completed));
  const maxStatus = Math.max(1, ...(data?.byStatus || []).map((item) => item.total));

  return (
    <div className="flex h-full w-full flex-col animate-in fade-in duration-300">
      <div className="pauta-scroll-safe min-w-0 flex-1 overflow-auto px-4 py-4 sm:px-8 sm:py-6">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className={cn("text-2xl font-black tracking-tight", titleColor)}>Relatórios</h1>
            <p className={cn("mt-1 text-sm font-medium", muted)}>
              Números dos projetos que você acessa, de {formatDay(from)} a {formatDay(to)}.
            </p>
          </div>
          <button type="button" onClick={baixarCsv} disabled={!data} className={cn(input, "inline-flex items-center gap-1.5 px-3 cursor-pointer disabled:opacity-50")}>
            <Download className="h-3.5 w-3.5" />
            Baixar CSV
          </button>
        </div>

        <div className="mb-5 flex flex-wrap items-center gap-2">
          {PERIODS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setPeriod(item.id);
                setFrom(isoDaysAgo(item.days));
                setTo(new Date().toISOString().slice(0, 10));
              }}
              className={cn(
                "h-9 rounded-full px-4 text-xs font-bold cursor-pointer",
                period === item.id ? "bg-blue-600 text-white" : "bg-(--ui-fundo-neutro) text-(--ui-texto-secundario) hover:bg-(--ui-hover-forte)",
              )}
            >
              {item.label}
            </button>
          ))}
          <input aria-label="Data inicial"
            type="date"
            value={from}
            max={to}
            onChange={(event) => {
              setFrom(event.target.value);
              setPeriod("custom");
            }}
            className={input}
          />
          <input aria-label="Data final"
            type="date"
            value={to}
            min={from}
            onChange={(event) => {
              setTo(event.target.value);
              setPeriod("custom");
            }}
            className={input}
          />
          <select
            value={workspaceId}
            onChange={(event) => {
              setWorkspaceId(event.target.value);
              setListId("");
            }}
            className={input}
          >
            <option value="">Todos os espaços de trabalho</option>
            {(data?.workspaces || []).map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.name}
              </option>
            ))}
          </select>
          <select value={listId} onChange={(event) => setListId(event.target.value)} className={input}>
            <option value="">Todos os projetos</option>
            {listOptions.map((list) => (
              <option key={list.id} value={list.id}>
                {list.name}
              </option>
            ))}
          </select>
        </div>

        {isPending ? (
          <ListaCarregando />
        ) : isError || !data ? (
          <p className="text-sm font-bold text-rose-600">Não foi possível carregar o relatório.</p>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              {[
                { label: "Cards abertos", value: data.totals.open, icon: Layers, tone: "text-blue-600" },
                { label: "Concluídos no período", value: data.totals.completedInRange, icon: CheckCircle2, tone: "text-emerald-600" },
                { label: "Atrasados", value: data.totals.overdue, icon: AlertTriangle, tone: "text-rose-600" },
                { label: "Vencem em 7 dias", value: data.totals.dueSoon, icon: CalendarClock, tone: "text-amber-600" },
                { label: "Sem responsável", value: data.totals.unassigned, icon: UserX, tone: muted },
                { label: "Sem prazo", value: data.totals.noDate, icon: Clock, tone: muted },
              ].map((item) => (
                <div key={item.label} className={cn("rounded-2xl border p-4", border, "bg-(--ui-superficie)")}>
                  <item.icon className={cn("h-4 w-4", item.tone)} />
                  <p className={cn("mt-2 text-2xl font-bold", titleColor)}>{item.value}</p>
                  <p className={cn("text-[11px] font-bold", muted)}>{item.label}</p>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className={cn(card, "lg:col-span-2")}>
                <div className="mb-4 flex items-baseline justify-between gap-3">
                  <h2 className={cn("text-sm font-black", titleColor)}>Cards concluídos por semana</h2>
                  <span className={cn("text-xs font-bold", muted)}>
                    {data.totals.createdInRange} criados no período
                  </span>
                </div>
                {data.completedPerWeek.length === 0 ? (
                  <p className={cn("text-sm font-medium", muted)}>Nenhum card concluído no período.</p>
                ) : (
                  <div className="flex h-44 items-end gap-2">
                    {data.completedPerWeek.map((item) => (
                      <div key={item.week} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                        <span className={cn("text-[11px] font-black", titleColor)}>{item.completed}</span>
                        <div
                          className="w-full rounded-t-md bg-blue-500 transition-all"
                          style={{ height: `${Math.max(4, (item.completed / maxSemana) * 130)}px` }}
                          title={`Semana de ${formatDay(item.week)}: ${item.completed} concluído(s)`}
                        />
                        <span className={cn("truncate text-[10px] font-bold", muted)}>{formatDay(item.week)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className={card}>
                <h2 className={cn("mb-4 text-sm font-black", titleColor)}>Tempo até concluir</h2>
                {data.leadTimeDays ? (
                  <>
                    <p className={cn("text-3xl font-bold", titleColor)}>
                      {data.leadTimeDays.median.toLocaleString("pt-BR")}{" "}
                      <span className="text-base font-bold">dias</span>
                    </p>
                    <p className={cn("text-xs font-bold", muted)}>mediana de {data.leadTimeDays.base} card(s)</p>
                    <p className={cn("mt-3 text-xs font-medium", muted)}>
                      Média de {data.leadTimeDays.average.toLocaleString("pt-BR")} dias entre criar e concluir. Conta a
                      partir de quando o card entra numa coluna de conclusão.
                    </p>
                  </>
                ) : (
                  <p className={cn("text-sm font-medium", muted)}>
                    Ainda não há cards concluídos no período para calcular.
                  </p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className={card}>
                <h2 className={cn("mb-4 text-sm font-black", titleColor)}>Cards abertos por coluna</h2>
                {data.byStatus.length === 0 ? (
                  <p className={cn("text-sm font-medium", muted)}>Nenhum card aberto.</p>
                ) : (
                  <div className="space-y-2">
                    {data.byStatus.map((item) => (
                      <div key={item.name} className="flex items-center gap-2">
                        <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", item.dotClass)} />
                        <span className={cn("w-32 shrink-0 truncate text-xs font-bold", titleColor)}>{item.name}</span>
                        <div className={cn("h-2 flex-1 overflow-hidden rounded-full", "bg-(--ui-fundo-neutro)")}>
                          <div className={cn("h-full rounded-full", item.dotClass)} style={{ width: `${(item.total / maxStatus) * 100}%` }} />
                        </div>
                        <span className={cn("w-8 text-right text-xs font-black", titleColor)}>{item.total}</span>
                      </div>
                    ))}
                  </div>
                )}

                <h2 className={cn("mb-3 mt-6 text-sm font-black", titleColor)}>Por prioridade</h2>
                <div className="flex flex-wrap gap-2">
                  {(["urgent", "high", "medium", "low"] as TaskPriority[]).map((priority) => {
                    const total = data.byPriority.find((item) => item.priority === priority)?.total ?? 0;
                    const config = PRIORITY_CONFIG[priority];
                    return (
                      <span key={priority} className={cn("rounded-full px-3 py-1 text-xs font-black", isDarkMode ? config.dark : config.light)}>
                        {config.label}: {total}
                      </span>
                    );
                  })}
                </div>
              </div>

              <div className={cn(card, "overflow-hidden")}>
                <h2 className={cn("mb-4 text-sm font-black", titleColor)}>Carga por pessoa</h2>
                {data.byMember.length === 0 ? (
                  <p className={cn("text-sm font-medium", muted)}>Nenhum card atribuído.</p>
                ) : (
                  <div className="-mx-2 overflow-x-auto">
                    <table className="w-full min-w-md text-left">
                      <thead>
                        <tr className={cn("text-[10px] font-black uppercase", muted)}>
                          <th className="px-2 py-1">Pessoa</th>
                          <th className="px-2 py-1">Abertos</th>
                          <th className="px-2 py-1">Atrasados</th>
                          <th className="px-2 py-1">Concluídos</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.byMember.map((member) => (
                          <tr key={member.id} className={cn("border-t text-sm", border)}>
                            <td className="px-2 py-1.5">
                              <span className="flex items-center gap-2">
                                <UserAvatar member={{ id: member.id, name: member.name, role: "", avatarColor: member.avatarColor, avatarUrl: member.avatarUrl || undefined }} size={24} />
                                <span className={cn("truncate font-bold", titleColor)}>{member.name}</span>
                              </span>
                            </td>
                            <td className={cn("px-2 py-1.5 font-bold", titleColor)}>{member.open}</td>
                            <td className={cn("px-2 py-1.5 font-bold", member.overdue ? "text-rose-600" : muted)}>{member.overdue}</td>
                            <td className={cn("px-2 py-1.5 font-bold", muted)}>{member.completed}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className={cn(card, "overflow-hidden")}>
                <h2 className={cn("mb-4 text-sm font-black", titleColor)}>Por projeto</h2>
                <div className="-mx-2 overflow-x-auto">
                  <table className="w-full min-w-md text-left">
                    <thead>
                      <tr className={cn("text-[10px] font-black uppercase", muted)}>
                        <th className="px-2 py-1">Projeto</th>
                        <th className="px-2 py-1">Abertos</th>
                        <th className="px-2 py-1">Atrasados</th>
                        <th className="px-2 py-1">Concluídos</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.byList.map((item) => (
                        <tr key={item.id} className={cn("border-t text-sm", border)}>
                          <td className="px-2 py-1.5">
                            <span className={cn("block truncate font-bold", titleColor)}>{item.name}</span>
                            <span className={cn("block truncate text-[11px]", muted)}>{item.workspaceName}</span>
                          </td>
                          <td className={cn("px-2 py-1.5 font-bold", titleColor)}>{item.open}</td>
                          <td className={cn("px-2 py-1.5 font-bold", item.overdue ? "text-rose-600" : muted)}>{item.overdue}</td>
                          <td className={cn("px-2 py-1.5 font-bold", muted)}>{item.completed}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className={card}>
                <h2 className={cn("mb-4 text-sm font-black", titleColor)}>Abertos há mais tempo</h2>
                {data.oldestOpen.length === 0 ? (
                  <p className={cn("text-sm font-medium", muted)}>Nada parado por aqui.</p>
                ) : (
                  <ul className="space-y-2">
                    {data.oldestOpen.map((task) => (
                      <li key={task.id} className={cn("border-b pb-2 last:border-0", border)}>
                        <p className={cn("truncate text-sm font-bold", titleColor)}>{task.title}</p>
                        <p className={cn("text-[11px] font-bold", muted)}>
                          {task.listName} · criado em {formatDay(task.createdAt)}
                          {task.dueDate ? ` · prazo ${formatDay(task.dueDate)}` : " · sem prazo"}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
