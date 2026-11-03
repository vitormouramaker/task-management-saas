import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { BrainCircuit, Check, Copy, Link2, Loader2, Unplug, Zap } from "lucide-react";
import { buildApiUrl } from "../../../lib/api";
import { cn } from "../../../lib/utils";
import { useAuthStore } from "../../../store/use-auth-store";
import { toast } from "../../../store/use-toast-store";

interface StatusDoConhecimento {
  conectado: boolean;
  criadoEm?: string;
  expiraEm?: string;
  ultimoUso?: string | null;
  tempoReal?: boolean;
  criadoPor?: string | null;
  incluiPrivados?: boolean;
}

const muted = "text-(--ui-texto-secundario)";
const titulo = "text-(--ui-texto-principal)";
const cartao = cn("rounded-2xl border p-5", "border-(--ui-borda)", "bg-(--ui-superficie)");
const botao =
  "inline-flex cursor-pointer items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50";

const data = (iso?: string | null) =>
  iso
    ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : "—";

function mensagemDoErro(erro: unknown, padrao: string) {
  return axios.isAxiosError(erro) ? (erro.response?.data as { message?: string })?.message || padrao : padrao;
}

/** Integrações da conta: link de conexão com o Hub de Conhecimento (só titular/admin). */
export function IntegrationsSettings() {
  const token = useAuthStore((state) => state.token);
  const papel = useAuthStore((state) => state.user?.organization?.role);
  const queryClient = useQueryClient();
  const headers = { Authorization: `Bearer ${token}` };
  const podeAdministrar = papel === "owner" || papel === "admin";
  const [link, setLink] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [incluirPrivados, setIncluirPrivados] = useState(false);

  const { data: status, isPending } = useQuery({
    queryKey: ["integrations", "conhecimento"],
    queryFn: async () =>
      (await axios.get(buildApiUrl("/api/integrations/conhecimento"), { headers })).data as StatusDoConhecimento,
    enabled: podeAdministrar,
    retry: false,
  });

  const gerar = useMutation({
    mutationFn: async () =>
      (await axios.post(buildApiUrl("/api/integrations/conhecimento/link"), { incluirPrivados }, { headers })).data as {
        link: string;
      },
    onSuccess: async (resposta) => {
      // O endereço público da API é o que este navegador já usa (atrás do proxy o
      // back pode não saber o próprio domínio); do back vem só o token.
      const tokenDoLink = resposta.link.split("#")[1];
      setLink(tokenDoLink ? `${buildApiUrl("/api/conhecimento/v1")}#${tokenDoLink}` : resposta.link);
      setCopiado(false);
      await queryClient.invalidateQueries({ queryKey: ["integrations", "conhecimento"] });
    },
    onError: (erro) => toast.error(mensagemDoErro(erro, "Não foi possível gerar o link.")),
  });

  const desconectar = useMutation({
    mutationFn: async () => axios.delete(buildApiUrl("/api/integrations/conhecimento"), { headers }),
    onSuccess: async () => {
      setLink(null);
      setConfirmando(false);
      toast.success("Hub de Conhecimento desconectado.");
      await queryClient.invalidateQueries({ queryKey: ["integrations", "conhecimento"] });
    },
    onError: (erro) => toast.error(mensagemDoErro(erro, "Não foi possível desconectar.")),
  });

  if (!podeAdministrar) {
    return (
      <div className={cartao}>
        <p className={muted}>Só o titular ou um administrador da conta gerencia as integrações.</p>
      </div>
    );
  }

  async function copiar() {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  }

  return (
    <div className="space-y-4">
      <div className={cartao}>
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-teal-600/15 text-teal-600">
            <BrainCircuit size={20} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className={cn("text-base font-bold", titulo)}>Hub de Conhecimento</h3>
            <p className={cn("mt-1 text-sm", muted)}>
              Leva para o Hub de Conhecimento (plataforma parceira de busca e IA) os cards (título, descrição, checklists e comentários) e uma
              visão geral de workspaces e projetos. Por padrão, só o que é <strong>público</strong>. Dados de pessoas e
              de cobrança nunca saem daqui.
            </p>
          </div>
          {!isPending && (
            <span
              className={cn(
                "shrink-0 rounded-full px-3 py-1 text-xs font-bold",
                status?.conectado ? "bg-teal-600/15 text-teal-600" : "bg-(--ui-superficie-suave) text-(--ui-texto-secundario)",
              )}
            >
              {status?.conectado ? "Conectado" : "Não conectado"}
            </span>
          )}
        </div>

        {isPending && <Loader2 className={cn("mt-4 animate-spin", muted)} size={18} aria-label="Carregando" />}

        {status?.conectado && (
          <dl className={cn("mt-4 grid gap-2 text-sm sm:grid-cols-2", muted)}>
            <div>
              <dt className="font-bold">Link gerado em</dt>
              <dd>
                {data(status.criadoEm)}
                {status.criadoPor ? ` por ${status.criadoPor}` : ""}
              </dd>
            </div>
            <div>
              <dt className="font-bold">Vale até</dt>
              <dd>{data(status.expiraEm)}</dd>
            </div>
            <div>
              <dt className="font-bold">Último acesso do Hub de Conhecimento</dt>
              <dd>{status.ultimoUso ? data(status.ultimoUso) : "ainda não conectou"}</dd>
            </div>
            <div>
              <dt className="font-bold">Conteúdo liberado</dt>
              <dd>{status.incluiPrivados ? "públicos, privados e Privado ADM" : "só públicos"}</dd>
            </div>
            <div>
              <dt className="font-bold">Atualização</dt>
              <dd className="flex items-center gap-1">
                {status.tempoReal ? (
                  <>
                    <Zap size={14} aria-hidden="true" /> em tempo real
                  </>
                ) : (
                  "a cada 15 minutos"
                )}
              </dd>
            </div>
          </dl>
        )}

        {link && (
          <div className="mt-4 space-y-2 rounded-xl border border-teal-600/40 bg-teal-600/10 p-4">
            <p className={cn("text-sm font-bold", titulo)}>Link de conexão (aparece só agora)</p>
            <div className="flex flex-wrap gap-2">
              <input
                readOnly
                value={link}
                aria-label="Link de conexão"
                onFocus={(e) => e.currentTarget.select()}
                className="min-w-0 flex-1 basis-72 rounded-xl border border-(--ui-borda) bg-(--ui-superficie) px-3 py-2 text-sm text-(--ui-texto-principal)"
              />
              <button type="button" onClick={() => void copiar()} className={cn(botao, "bg-teal-600 text-white hover:bg-teal-700")}>
                {copiado ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
                {copiado ? "Copiado" : "Copiar"}
              </button>
            </div>
            <p className={cn("text-xs", muted)}>
              No Hub de Conhecimento, abra Integrações → Pauta e cole este link. Ele funciona como uma senha: não compartilhe.
              Se perder, gere outro (o anterior deixa de valer).
            </p>
          </div>
        )}

        <label className={cn("mt-5 flex cursor-pointer items-start gap-2 text-sm", titulo)}>
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 accent-blue-600"
            checked={incluirPrivados}
            onChange={(e) => setIncluirPrivados(e.target.checked)}
          />
          <span>
            Incluir conteúdo não público (cards privados e "Privado ADM")
            {incluirPrivados && (
              <span className={cn("mt-1 block text-xs", muted)}>
                O Hub de Conhecimento passa a poder ler tudo da conta. Quem administra o Hub de Conhecimento escolhe em que espaço esse conteúdo
                fica e quem o vê lá — pode ser gente que não vê esses cards aqui no Pauta.
              </span>
            )}
          </span>
        </label>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={gerar.isPending}
            onClick={() => gerar.mutate()}
            className={cn(botao, "bg-blue-600 text-white hover:bg-blue-700")}
          >
            {gerar.isPending ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Link2 size={16} aria-hidden="true" />}
            {status?.conectado ? "Gerar novo link" : "Gerar link de conexão"}
          </button>
          {status?.conectado &&
            (confirmando ? (
              <button
                type="button"
                disabled={desconectar.isPending}
                onClick={() => desconectar.mutate()}
                className={cn(botao, "bg-red-600 text-white hover:bg-red-700")}
              >
                Confirmar desconexão
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmando(true)}
                className={cn(botao, "border border-(--ui-borda) text-(--ui-texto-principal) hover:bg-(--ui-superficie-suave)")}
              >
                <Unplug size={16} aria-hidden="true" /> Desconectar
              </button>
            ))}
        </div>
        {status?.conectado && (
          <p className={cn("mt-2 text-xs", muted)}>
            Gerar um novo link ou desconectar corta o acesso do Hub de Conhecimento na hora. Para apagar o que já foi importado,
            desconecte também no Hub de Conhecimento.
          </p>
        )}
      </div>
    </div>
  );
}
