import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { Loader2, Lock, Pencil, Plus, Trash2, Zap } from "lucide-react";
import { buildApiUrl } from "../../../lib/api";
import { getStatusesForList } from "../../../lib/status-columns";
import { getTaskStatusLabel } from "../../../lib/task-status-label";
import { cn } from "../../../lib/utils";
import { useAuthStore } from "../../../store/use-auth-store";
import { useTaskStore } from "../../../store/use-task-store";
import { toast } from "../../../store/use-toast-store";
import { TASK_PRIORITY_VALUES, type TaskPriority } from "../../../types/tasks";
import { PRIORITY_CONFIG } from "../../tasks/lib/task-view-helpers";
import { ListaCarregando } from "../../../components/ui/lista-carregando";

type TriggerType =
  | "card_criado"
  | "card_mudou_coluna"
  | "card_recebeu_responsavel"
  | "card_mudou_prioridade"
  | "prazo_proximo"
  | "prazo_vencido"
  | "parado_na_coluna";

type ActionType =
  | "mover_para_coluna"
  | "definir_responsavel"
  | "mudar_prioridade"
  | "definir_prazo"
  | "adicionar_etiqueta"
  | "comentar"
  | "notificar";

interface AutomationAction {
  type: ActionType;
  statusId?: string;
  memberIds?: string[];
  priority?: TaskPriority;
  days?: number;
  tagId?: string;
  text?: string;
  target?: "responsaveis" | "pessoas";
  message?: string;
}

interface Automation {
  id: string;
  listId: string;
  listName: string;
  name: string;
  enabled: boolean;
  triggerType: TriggerType;
  triggerConfig: { statusId?: string; priority?: TaskPriority; days?: number; memberId?: string };
  actions: AutomationAction[];
  runsCount: number;
  lastRunAt: string | null;
}

const TRIGGER_LABELS: Record<TriggerType, string> = {
  card_criado: "Quando um card for criado",
  card_mudou_coluna: "Quando um card entrar na coluna",
  card_recebeu_responsavel: "Quando alguém virar responsável",
  card_mudou_prioridade: "Quando a prioridade virar",
  prazo_proximo: "Quando faltarem X dias para o prazo",
  prazo_vencido: "Quando o prazo passar há X dias",
  parado_na_coluna: "Quando o card ficar parado X dias",
};

const ACTION_LABELS: Record<ActionType, string> = {
  mover_para_coluna: "Mover para a coluna",
  definir_responsavel: "Colocar como responsável",
  mudar_prioridade: "Mudar a prioridade para",
  definir_prazo: "Definir prazo em X dias",
  adicionar_etiqueta: "Colocar a etiqueta",
  comentar: "Escrever um comentário",
  notificar: "Avisar",
};

const TRIGGERS_COM_DIAS: TriggerType[] = ["prazo_proximo", "prazo_vencido", "parado_na_coluna"];

function automacaoVazia(listId: string): Omit<Automation, "id" | "listName" | "runsCount" | "lastRunAt"> {
  return {
    listId,
    name: "",
    enabled: true,
    triggerType: "card_mudou_coluna",
    triggerConfig: {},
    actions: [{ type: "notificar", target: "responsaveis", message: "" }],
  };
}

/** Automações da conta, dentro de Configurações. */
export function AutomationsSettings() {
  const token = useAuthStore((state) => state.token);
  const automationsLiberadas = useAuthStore((state) => state.user?.organization?.entitlements?.automations);
  const papel = useAuthStore((state) => state.user?.organization?.role);
  const graph = useTaskStore((state) => state.graph);
  const setActivePage = useTaskStore((state) => state.setActivePage);
  const queryClient = useQueryClient();
  const [emEdicao, setEmEdicao] = useState<null | (Partial<Automation> & { listId: string })>(null);

  const podeAdministrar = papel === "owner" || papel === "admin";
  const headers = { Authorization: `Bearer ${token}` };

  const { data, isPending, error } = useQuery({
    queryKey: ["automations"],
    queryFn: async () =>
      (await axios.get(buildApiUrl("/api/automations"), { headers })).data as { automations: Automation[] },
    enabled: automationsLiberadas !== false,
    retry: false,
  });

  const salvar = useMutation({
    mutationFn: async (automacao: Partial<Automation> & { listId: string }) => {
      const corpo = {
        listId: automacao.listId,
        name: automacao.name,
        enabled: automacao.enabled,
        triggerType: automacao.triggerType,
        triggerConfig: automacao.triggerConfig,
        actions: automacao.actions,
      };
      return automacao.id
        ? (await axios.patch(buildApiUrl(`/api/automations/${automacao.id}`), corpo, { headers })).data
        : (await axios.post(buildApiUrl("/api/automations"), corpo, { headers })).data;
    },
    onSuccess: async (resposta) => {
      toast.success(resposta?.message || "Automação salva.");
      setEmEdicao(null);
      await queryClient.invalidateQueries({ queryKey: ["automations"] });
    },
    onError: (erro) => toast.error(mensagemDoErro(erro, "Não foi possível salvar a automação.")),
  });

  const alternar = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) =>
      (await axios.patch(buildApiUrl(`/api/automations/${id}`), { enabled }, { headers })).data,
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["automations"] }),
    onError: (erro) => toast.error(mensagemDoErro(erro, "Não foi possível mudar a automação.")),
  });

  const apagar = useMutation({
    mutationFn: async (id: string) => (await axios.delete(buildApiUrl(`/api/automations/${id}`), { headers })).data,
    onSuccess: async () => {
      toast.success("Automação apagada.");
      await queryClient.invalidateQueries({ queryKey: ["automations"] });
    },
    onError: (erro) => toast.error(mensagemDoErro(erro, "Não foi possível apagar a automação.")),
  });

  const projetos = useMemo(
    () =>
      Object.values(graph.lists)
        .map((list) => {
          const folder = graph.folders[list.folderId];
          const space = folder ? graph.spaces[folder.spaceId] : undefined;
          const workspace = space ? graph.workspaces[space.workspaceId] : undefined;
          return workspace ? { id: list.id, name: list.name, workspaceName: workspace.name } : null;
        })
        .filter(Boolean) as Array<{ id: string; name: string; workspaceName: string }>,
    [graph],
  );

  const muted = "text-(--ui-texto-secundario)";
  const titulo = "text-(--ui-texto-principal)";
  const borda = "border-(--ui-borda)";
  const cartao = cn("rounded-2xl border p-5", borda, "bg-(--ui-superficie)");
  const campo = cn(
    "h-9 rounded-lg border px-2 text-xs font-bold outline-none focus:border-blue-500",
    "border-(--ui-borda) bg-(--ui-superficie-suave) text-(--ui-texto-forte)",
  );

  const bloqueado =
    automationsLiberadas === false ||
    (axios.isAxiosError(error) && (error.response?.data as { code?: string })?.code === "PLAN_FEATURE_AUTOMATIONS");

  if (bloqueado) {
    return (
      <div className={cn(cartao, "text-center")}>
        <Lock className="mx-auto h-8 w-8 text-blue-600" />
        <h3 className={cn("mt-3 text-base font-black", titulo)}>Automações</h3>
        <p className={cn("mx-auto mt-1 max-w-md text-sm font-medium", muted)}>
          Disponível a partir do plano Profissional: o Pauta move cards, define responsáveis, ajusta prazos e avisa a
          equipe sozinho, inclusive quando o prazo está chegando.
        </p>
        <button
          type="button"
          onClick={() => {
            sessionStorage.setItem("pauta_open_billing_tab", "1");
            setActivePage("settings");
            window.dispatchEvent(new CustomEvent("pauta:open-billing-tab"));
          }}
          className="mt-4 inline-flex h-10 items-center rounded-xl bg-blue-600 px-5 text-sm font-black text-white hover:bg-blue-700 cursor-pointer"
        >
          Ver planos
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className={cn("text-base font-black", titulo)}>Automações</h3>
          <p className={cn("mt-1 max-w-2xl text-sm font-medium", muted)}>
            Regras do tipo "quando acontecer isso, faça aquilo" dentro de um projeto. As de prazo são conferidas de hora
            em hora.
          </p>
        </div>
        {podeAdministrar && projetos.length > 0 && (
          <button
            type="button"
            onClick={() => setEmEdicao(automacaoVazia(projetos[0].id))}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-black text-white hover:bg-blue-700 cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            Nova automação
          </button>
        )}
      </div>

      {isPending ? (
        <ListaCarregando />
      ) : (data?.automations || []).length === 0 ? (
        <div className={cn(cartao, "text-center")}>
          <Zap className={cn("mx-auto h-8 w-8", muted)} />
          <p className={cn("mt-2 text-sm font-bold", titulo)}>Nenhuma automação ainda.</p>
          <p className={cn("mt-1 text-sm font-medium", muted)}>
            Exemplo: quando um card entrar em "Em revisão", avisar o responsável. Ou: quando faltar 1 dia para o prazo,
            comentar no card.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {data?.automations.map((automacao) => (
            <div key={automacao.id} className={cartao}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className={cn("text-sm font-bold", titulo)}>{automacao.name}</p>
                  <p className={cn("text-xs font-bold", muted)}>
                    {automacao.listName} · {descreverGatilho(automacao, graph)}
                  </p>
                  <ul className={cn("mt-2 space-y-0.5 text-xs font-medium", muted)}>
                    {automacao.actions.map((acao, index) => (
                      <li key={index}>→ {descreverAcao(acao, graph, automacao.listId)}</li>
                    ))}
                  </ul>
                  <p className={cn("mt-2 text-[11px] font-bold", muted)}>
                    Rodou {automacao.runsCount} vez(es)
                    {automacao.lastRunAt ? ` · última em ${new Date(automacao.lastRunAt).toLocaleString("pt-BR")}` : ""}
                  </p>
                </div>

                {podeAdministrar && (
                  <div className="flex items-center gap-2">
                    <label className="flex cursor-pointer items-center gap-1.5 text-xs font-bold">
                      <input
                        type="checkbox"
                        checked={automacao.enabled}
                        onChange={(event) => alternar.mutate({ id: automacao.id, enabled: event.target.checked })}
                        className="h-4 w-4 accent-blue-600"
                      />
                      <span className={muted}>{automacao.enabled ? "Ligada" : "Desligada"}</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => setEmEdicao(automacao)}
                      aria-label="Editar"
                      className={cn("grid h-8 w-8 place-items-center rounded-lg border cursor-pointer", borda, muted)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => apagar.mutate(automacao.id)}
                      aria-label="Apagar"
                      className="grid h-8 w-8 place-items-center rounded-lg border border-rose-200 text-rose-600 cursor-pointer hover:bg-rose-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {emEdicao && (
        <AutomationForm
          valor={emEdicao}
          projetos={projetos}
          campo={campo}
          onChange={setEmEdicao}
          onClose={() => setEmEdicao(null)}
          onSave={() => salvar.mutate(emEdicao)}
          salvando={salvar.isPending}
        />
      )}
    </div>
  );
}

function mensagemDoErro(erro: unknown, padrao: string) {
  return axios.isAxiosError(erro) ? (erro.response?.data as { message?: string })?.message || padrao : padrao;
}

function nomeDaColuna(graph: ReturnType<typeof useTaskStore.getState>["graph"], listId: string, statusId?: string) {
  const status = getStatusesForList(graph.statusDefinitions, listId).find((item) => item.id === statusId);
  return status ? getTaskStatusLabel(status.name) : "—";
}

function nomesDosMembros(graph: ReturnType<typeof useTaskStore.getState>["graph"], ids?: string[]) {
  return (ids || []).map((id) => graph.members[id]?.name || "alguém").join(", ") || "—";
}

function descreverGatilho(automacao: Automation, graph: ReturnType<typeof useTaskStore.getState>["graph"]) {
  const config = automacao.triggerConfig || {};
  switch (automacao.triggerType) {
    case "card_mudou_coluna":
      return `quando um card entrar em "${nomeDaColuna(graph, automacao.listId, config.statusId)}"`;
    case "card_mudou_prioridade":
      return `quando a prioridade virar ${PRIORITY_CONFIG[config.priority as TaskPriority]?.label || "—"}`;
    case "prazo_proximo":
      return `quando faltar(em) ${config.days} dia(s) para o prazo`;
    case "prazo_vencido":
      return `quando o prazo passar há ${config.days} dia(s)`;
    case "parado_na_coluna":
      return `quando o card ficar ${config.days} dia(s) parado${config.statusId ? ` em "${nomeDaColuna(graph, automacao.listId, config.statusId)}"` : ""}`;
    default:
      return TRIGGER_LABELS[automacao.triggerType].toLowerCase();
  }
}

function descreverAcao(
  acao: AutomationAction,
  graph: ReturnType<typeof useTaskStore.getState>["graph"],
  listId: string,
) {
  switch (acao.type) {
    case "mover_para_coluna":
      return `mover para "${nomeDaColuna(graph, listId, acao.statusId)}"`;
    case "definir_responsavel":
      return `colocar ${nomesDosMembros(graph, acao.memberIds)} como responsável`;
    case "mudar_prioridade":
      return `mudar a prioridade para ${PRIORITY_CONFIG[acao.priority as TaskPriority]?.label || "—"}`;
    case "definir_prazo":
      return `definir o prazo para daqui a ${acao.days} dia(s)`;
    case "adicionar_etiqueta":
      return `colocar a etiqueta ${graph.tags[acao.tagId || ""]?.name || "—"}`;
    case "comentar":
      return `comentar: "${acao.text}"`;
    case "notificar":
      return acao.target === "pessoas"
        ? `avisar ${nomesDosMembros(graph, acao.memberIds)}`
        : "avisar os responsáveis do card";
    default:
      return acao.type;
  }
}

interface FormProps {
  valor: Partial<Automation> & { listId: string };
  projetos: Array<{ id: string; name: string; workspaceName: string }>;
  campo: string;
  onChange: (valor: Partial<Automation> & { listId: string }) => void;
  onClose: () => void;
  onSave: () => void;
  salvando: boolean;
}

function AutomationForm({ valor, projetos, campo, onChange, onClose, onSave, salvando }: FormProps) {
  const graph = useTaskStore((state) => state.graph);
  const colunas = getStatusesForList(graph.statusDefinitions, valor.listId).filter((item) => item.id !== "status_subtasks");
  const membros = Object.values(graph.members);
  const etiquetas = Object.values(graph.tags);

  const muted = "text-(--ui-texto-secundario)";
  const titulo = "text-(--ui-texto-principal)";
  const borda = "border-(--ui-borda)";

  const trocarAcao = (index: number, acao: AutomationAction) => {
    const acoes = [...(valor.actions || [])];
    acoes[index] = acao;
    onChange({ ...valor, actions: acoes });
  };

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div
        onClick={(event) => event.stopPropagation()}
        className={cn(
          "max-h-[92vh] w-full max-w-2xl overflow-auto rounded-2xl border p-6 shadow-2xl",
          borda,
          "bg-(--ui-superficie)",
        )}
      >
        <h3 className={cn("text-lg font-black", titulo)}>{valor.id ? "Editar automação" : "Nova automação"}</h3>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className={cn("text-[12px] font-bold", muted)}>Nome</span>
            <input aria-label="Ex.: avisar quando entrar em revisão"
              value={valor.name || ""}
              onChange={(event) => onChange({ ...valor, name: event.target.value })}
              placeholder="Ex.: avisar quando entrar em revisão"
              className={campo}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={cn("text-[12px] font-bold", muted)}>Projeto</span>
            <select
              value={valor.listId}
              onChange={(event) => onChange({ ...valor, listId: event.target.value })}
              className={campo}
              disabled={Boolean(valor.id)}
            >
              {projetos.map((projeto) => (
                <option key={projeto.id} value={projeto.id}>
                  {projeto.workspaceName} › {projeto.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-4">
          <p className={cn("mb-2 text-[12px] font-bold", muted)}>Quando acontecer</p>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={valor.triggerType}
              onChange={(event) => onChange({ ...valor, triggerType: event.target.value as TriggerType, triggerConfig: {} })}
              className={campo}
            >
              {Object.entries(TRIGGER_LABELS).map(([tipo, label]) => (
                <option key={tipo} value={tipo}>
                  {label}
                </option>
              ))}
            </select>

            {valor.triggerType === "card_mudou_coluna" && (
              <select
                value={valor.triggerConfig?.statusId || ""}
                onChange={(event) => onChange({ ...valor, triggerConfig: { ...valor.triggerConfig, statusId: event.target.value } })}
                className={campo}
              >
                <option value="">Escolha a coluna</option>
                {colunas.map((coluna) => (
                  <option key={coluna.id} value={coluna.id}>
                    {getTaskStatusLabel(coluna.name)}
                  </option>
                ))}
              </select>
            )}

            {valor.triggerType === "card_mudou_prioridade" && (
              <select
                value={valor.triggerConfig?.priority || ""}
                onChange={(event) =>
                  onChange({ ...valor, triggerConfig: { ...valor.triggerConfig, priority: event.target.value as TaskPriority } })
                }
                className={campo}
              >
                <option value="">Escolha a prioridade</option>
                {TASK_PRIORITY_VALUES.map((prioridade) => (
                  <option key={prioridade} value={prioridade}>
                    {PRIORITY_CONFIG[prioridade].label}
                  </option>
                ))}
              </select>
            )}

            {TRIGGERS_COM_DIAS.includes(valor.triggerType as TriggerType) && (
              <>
                <input aria-label="dias"
                  type="number"
                  min={0}
                  max={90}
                  value={valor.triggerConfig?.days ?? ""}
                  onChange={(event) =>
                    onChange({ ...valor, triggerConfig: { ...valor.triggerConfig, days: Number(event.target.value) } })
                  }
                  placeholder="dias"
                  className={cn(campo, "w-20")}
                />
                {valor.triggerType === "parado_na_coluna" && (
                  <select
                    value={valor.triggerConfig?.statusId || ""}
                    onChange={(event) =>
                      onChange({ ...valor, triggerConfig: { ...valor.triggerConfig, statusId: event.target.value || undefined } })
                    }
                    className={campo}
                  >
                    <option value="">em qualquer coluna</option>
                    {colunas.map((coluna) => (
                      <option key={coluna.id} value={coluna.id}>
                        em {getTaskStatusLabel(coluna.name)}
                      </option>
                    ))}
                  </select>
                )}
              </>
            )}
          </div>
        </div>

        <div className="mt-5">
          <p className={cn("mb-2 text-[12px] font-bold", muted)}>Fazer</p>
          <div className="space-y-2">
            {(valor.actions || []).map((acao, index) => (
              <div key={index} className={cn("flex flex-wrap items-center gap-2 rounded-xl border p-2", borda)}>
                <select
                  value={acao.type}
                  onChange={(event) => trocarAcao(index, { type: event.target.value as ActionType, target: "responsaveis" })}
                  className={campo}
                >
                  {Object.entries(ACTION_LABELS).map(([tipo, label]) => (
                    <option key={tipo} value={tipo}>
                      {label}
                    </option>
                  ))}
                </select>

                {acao.type === "mover_para_coluna" && (
                  <select value={acao.statusId || ""} onChange={(event) => trocarAcao(index, { ...acao, statusId: event.target.value })} className={campo}>
                    <option value="">Escolha a coluna</option>
                    {colunas.map((coluna) => (
                      <option key={coluna.id} value={coluna.id}>
                        {getTaskStatusLabel(coluna.name)}
                      </option>
                    ))}
                  </select>
                )}

                {(acao.type === "definir_responsavel" || (acao.type === "notificar" && acao.target === "pessoas")) && (
                  <select
                    value={acao.memberIds?.[0] || ""}
                    onChange={(event) => trocarAcao(index, { ...acao, memberIds: event.target.value ? [event.target.value] : [] })}
                    className={campo}
                  >
                    <option value="">Escolha a pessoa</option>
                    {membros.map((membro) => (
                      <option key={membro.id} value={membro.id}>
                        {membro.name}
                      </option>
                    ))}
                  </select>
                )}

                {acao.type === "notificar" && (
                  <>
                    <select
                      value={acao.target || "responsaveis"}
                      onChange={(event) => trocarAcao(index, { ...acao, target: event.target.value as "responsaveis" | "pessoas" })}
                      className={campo}
                    >
                      <option value="responsaveis">os responsáveis do card</option>
                      <option value="pessoas">uma pessoa</option>
                    </select>
                    <input aria-label="mensagem do aviso (opcional)"
                      value={acao.message || ""}
                      onChange={(event) => trocarAcao(index, { ...acao, message: event.target.value })}
                      placeholder="mensagem do aviso (opcional)"
                      className={cn(campo, "min-w-50 flex-1")}
                    />
                  </>
                )}

                {acao.type === "mudar_prioridade" && (
                  <select value={acao.priority || ""} onChange={(event) => trocarAcao(index, { ...acao, priority: event.target.value as TaskPriority })} className={campo}>
                    <option value="">Escolha</option>
                    {TASK_PRIORITY_VALUES.map((prioridade) => (
                      <option key={prioridade} value={prioridade}>
                        {PRIORITY_CONFIG[prioridade].label}
                      </option>
                    ))}
                  </select>
                )}

                {acao.type === "definir_prazo" && (
                  <input aria-label="dias"
                    type="number"
                    min={0}
                    max={365}
                    value={acao.days ?? ""}
                    onChange={(event) => trocarAcao(index, { ...acao, days: Number(event.target.value) })}
                    placeholder="dias"
                    className={cn(campo, "w-20")}
                  />
                )}

                {acao.type === "adicionar_etiqueta" && (
                  <select value={acao.tagId || ""} onChange={(event) => trocarAcao(index, { ...acao, tagId: event.target.value })} className={campo}>
                    <option value="">Escolha a etiqueta</option>
                    {etiquetas.map((etiqueta) => (
                      <option key={etiqueta.id} value={etiqueta.id}>
                        {etiqueta.name}
                      </option>
                    ))}
                  </select>
                )}

                {acao.type === "comentar" && (
                  <input aria-label="texto do comentário"
                    value={acao.text || ""}
                    onChange={(event) => trocarAcao(index, { ...acao, text: event.target.value })}
                    placeholder="texto do comentário"
                    className={cn(campo, "min-w-50 flex-1")}
                  />
                )}

                {(valor.actions || []).length > 1 && (
                  <button
                    type="button"
                    onClick={() => onChange({ ...valor, actions: (valor.actions || []).filter((_, i) => i !== index) })}
                    aria-label="Remover ação"
                    className="grid h-8 w-8 place-items-center rounded-lg text-rose-600 cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>

          {(valor.actions || []).length < 5 && (
            <button
              type="button"
              onClick={() => onChange({ ...valor, actions: [...(valor.actions || []), { type: "comentar", text: "" }] })}
              className={cn("mt-2 inline-flex h-8 items-center gap-1 rounded-lg border px-3 text-xs font-bold cursor-pointer", borda, muted)}
            >
              <Plus className="h-3.5 w-3.5" />
              Outra ação
            </button>
          )}
        </div>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} className={cn("h-10 rounded-xl border px-4 text-sm font-bold cursor-pointer", borda, muted)}>
            Cancelar
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={salvando}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 text-sm font-black text-white hover:bg-blue-700 cursor-pointer disabled:opacity-60"
          >
            {salvando && <Loader2 className="h-4 w-4 animate-spin" />}
            Salvar automação
          </button>
        </div>
      </div>
    </div>
  );
}
