import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronLeft, RotateCcw } from "lucide-react";
import { cn } from "../../../lib/utils";
import { toast } from "../../../store/use-toast-store";
import { AdminPageHeader, adminErrorMessage, formatDate, useAdminApi, useAdminStyles , AdminListaCarregando} from "../admin-shared";

interface ErrorGroup {
  id: string;
  origem: "front" | "back";
  tipo: string | null;
  mensagem: string;
  local: string | null;
  primeiraVez: string;
  ultimaVez: string;
  ocorrencias: number;
  contasAfetadas: number;
  resolvidoEm: string | null;
}

interface ErrorEvent {
  id: string;
  ocorridoEm: string;
  url: string | null;
  userAgent: string | null;
  versao: string | null;
  pilha: string | null;
  organizacao: string | null;
  pessoa: string | null;
}

const ORIGEM_LABEL: Record<string, string> = { front: "tela", back: "servidor" };

/** Erros da plataforma, agrupados: o mesmo defeito vira uma linha só. */
export function ErrorsPage() {
  const api = useAdminApi();
  const styles = useAdminStyles();
  const queryClient = useQueryClient();

  const [status, setStatus] = useState<"abertos" | "resolvidos" | "todos">("abertos");
  const [origem, setOrigem] = useState("");
  const [busca, setBusca] = useState("");
  const [aberto, setAberto] = useState<string | null>(null);

  const lista = useQuery({
    queryKey: ["admin", "erros", status, origem, busca],
    queryFn: () =>
      api.get<{
        errors: ErrorGroup[];
        total: number;
        summary: { abertos: number; ultimas24h: number; ocorrencias: number };
      }>("/erros", { status, origem, busca }),
    refetchInterval: 60_000,
  });

  const detalhe = useQuery({
    queryKey: ["admin", "erro", aberto],
    queryFn: () => api.get<ErrorGroup & { events: ErrorEvent[] }>(`/erros/${aberto}`),
    enabled: Boolean(aberto),
  });

  const resolver = useMutation({
    mutationFn: ({ id, resolvido }: { id: string; resolvido: boolean }) =>
      api.post<{ message: string }>(`/erros/${id}/resolver`, { resolvido }),
    onSuccess: (resposta) => {
      toast.success(resposta.message);
      void queryClient.invalidateQueries({ queryKey: ["admin", "erros"] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "erro"] });
    },
    onError: (erro) => toast.error(adminErrorMessage(erro, "Não foi possível atualizar o erro.")),
  });

  // ---------- detalhe ----------
  if (aberto) {
    const dados = detalhe.data;

    return (
      <>
        <button type="button" onClick={() => setAberto(null)} className={cn(styles.outline, "mb-4")}>
          <ChevronLeft className="h-4 w-4" />
          Voltar para a lista
        </button>

        {detalhe.isPending || !dados ? (
          <AdminListaCarregando />
        ) : (
          <div className="space-y-4">
            <div className={cn(styles.card, "p-5")}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className={cn("text-sm font-bold", styles.title)}>{dados.mensagem}</p>
                  <p className={cn("mt-1 text-xs font-bold", styles.muted)}>
                    {dados.tipo || "Error"} · {ORIGEM_LABEL[dados.origem]} · {dados.local || "local desconhecido"}
                  </p>
                  <p className={cn("mt-1 text-xs font-medium", styles.muted)}>
                    {dados.ocorrencias} ocorrência(s) · {dados.contasAfetadas} conta(s) · primeira em{" "}
                    {formatDate(dados.primeiraVez, true)} · última em {formatDate(dados.ultimaVez, true)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => resolver.mutate({ id: dados.id, resolvido: !dados.resolvidoEm })}
                  disabled={resolver.isPending}
                  className={dados.resolvidoEm ? styles.outline : styles.primary}
                >
                  {dados.resolvidoEm ? <RotateCcw className="h-4 w-4" /> : <Check className="h-4 w-4" />}
                  {dados.resolvidoEm ? "Reabrir" : "Marcar como resolvido"}
                </button>
              </div>
            </div>

            {dados.events.map((evento) => (
              <div key={evento.id} className={cn(styles.card, "p-4")}>
                <p className={cn("text-xs font-bold", styles.title)}>
                  {formatDate(evento.ocorridoEm, true)}
                  {evento.organizacao ? ` · ${evento.organizacao}` : ""}
                  {evento.pessoa ? ` · ${evento.pessoa}` : ""}
                  {evento.versao ? ` · versão ${evento.versao}` : ""}
                </p>
                {evento.url && (
                  <p className={cn("mt-1 break-all text-xs font-medium", styles.muted)}>{evento.url}</p>
                )}
                {evento.userAgent && (
                  <p className={cn("mt-1 break-all text-[11px] font-medium", styles.muted)}>{evento.userAgent}</p>
                )}
                {evento.pilha && (
                  <pre
                    className={cn(
                      "mt-2 max-h-60 overflow-auto rounded-xl p-3 text-[11px] leading-relaxed",
                      "bg-(--ui-fundo-sutil) text-(--ui-texto-secundario)",
                    )}
                  >
                    {evento.pilha}
                  </pre>
                )}
              </div>
            ))}
          </div>
        )}
      </>
    );
  }

  // ---------- lista ----------
  const resumo = lista.data?.summary;

  return (
    <>
      <AdminPageHeader
        title="Erros"
        description="Falhas da tela e do servidor, agrupadas por defeito. Cada linha é um problema; o contador diz quantas vezes aconteceu."
      />

      {resumo && (
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          {[
            { rotulo: "Erros abertos", valor: resumo.abertos },
            { rotulo: "Com ocorrência nas últimas 24h", valor: resumo.ultimas24h },
            { rotulo: "Ocorrências (abertos)", valor: resumo.ocorrencias },
          ].map((item) => (
            <div key={item.rotulo} className={cn(styles.card, "p-4")}>
              <p className={cn("text-2xl font-bold", styles.title)}>{item.valor}</p>
              <p className={cn("text-xs font-bold", styles.muted)}>{item.rotulo}</p>
            </div>
          ))}
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        {(["abertos", "resolvidos", "todos"] as const).map((opcao) => (
          <button
            key={opcao}
            type="button"
            onClick={() => setStatus(opcao)}
            className={cn(
              styles.outline,
              status === opcao && "border-blue-500 text-blue-600",
            )}
          >
            {opcao === "abertos" ? "Abertos" : opcao === "resolvidos" ? "Resolvidos" : "Todos"}
          </button>
        ))}

        <select value={origem} onChange={(evento) => setOrigem(evento.target.value)} className={styles.input}>
          <option value="">Tela e servidor</option>
          <option value="front">Só a tela</option>
          <option value="back">Só o servidor</option>
        </select>

        <input aria-label="Buscar na mensagem…"
          value={busca}
          onChange={(evento) => setBusca(evento.target.value)}
          placeholder="Buscar na mensagem…"
          className={cn(styles.input, "min-w-[220px] flex-1")}
        />
      </div>

      {lista.isPending ? (
        <AdminListaCarregando />
      ) : (lista.data?.errors.length || 0) === 0 ? (
        <div className={cn(styles.card, "p-6")}>
          <p className={cn("text-sm font-bold", styles.title)}>
            {status === "abertos" ? "Nenhum erro aberto. 🎉" : "Nada por aqui."}
          </p>
          <p className={cn("mt-1 text-sm font-medium", styles.muted)}>
            Os erros aparecem sozinhos quando alguma tela ou o servidor falha.
          </p>
        </div>
      ) : (
        <div className={cn(styles.card, "divide-y", "divide-(--ui-borda-suave)")}>
          {lista.data?.errors.map((grupo) => (
            <button
              key={grupo.id}
              type="button"
              onClick={() => setAberto(grupo.id)}
              className="flex w-full flex-col gap-1 p-4 text-left transition-colors hover:bg-black/[0.02] cursor-pointer"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-black uppercase",
                    grupo.origem === "front"
                      ? "bg-blue-500/10 text-blue-600"
                      : "bg-violet-500/10 text-violet-600",
                  )}
                >
                  {ORIGEM_LABEL[grupo.origem]}
                </span>
                {grupo.resolvidoEm && (
                  <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-black uppercase text-emerald-600">
                    resolvido
                  </span>
                )}
                <span className={cn("min-w-0 flex-1 truncate text-sm font-bold", styles.title)}>{grupo.mensagem}</span>
                <span className={cn("text-xs font-black", styles.title)}>{grupo.ocorrencias}×</span>
              </div>
              <p className={cn("text-xs font-medium", styles.muted)}>
                {grupo.local || "local desconhecido"} · {grupo.contasAfetadas} conta(s) · última em{" "}
                {formatDate(grupo.ultimaVez, true)}
              </p>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
