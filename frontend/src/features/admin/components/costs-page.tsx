import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, HardDrive } from "lucide-react";
import { cn } from "../../../lib/utils";
import {
  AdminListaCarregando,
  AdminPageHeader,
  TabelaRolavel,
  useAdminApi,
  useAdminStyles,
} from "../admin-shared";

interface ContaDeCusto {
  id: string;
  nome: string | null;
  plano: string | null;
  situacao: string | null;
  isenta: boolean;
  arquivos: number;
  gb: number;
  limiteGb: number | null;
  fatiaUsada: number | null;
  custoArmazenamentoMes: number;
}

interface ResumoDeCustos {
  geradoEm: string;
  moeda: string;
  cambio: number;
  precos: { armazenamentoGb: number; trafegoGb: number };
  fatura: { disponivel: boolean; saldoUsd?: number; gastoDoMesUsd?: number; motivo?: string };
  totais: {
    contas: number;
    arquivos: number;
    armazenamentoGb: number;
    custoArmazenamentoMes: number;
    custoTrafegoMes: number;
    custoEstimadoMes: number;
    custoTotalMes: number;
    custoTotalMesBrl: number;
    fonte: string;
    tetoMensal: number;
  };
  trafego: { disponivel: boolean; gb?: number; custoMes?: number; motivo?: string };
  semAssinatura: { contas: number; gb: number; custoMes: number; fatiaDoTotal: number };
  contas: ContaDeCusto[];
}

/** A Bunny cobra em dólar: é nele que a conta tem que ser lida. */
function emDolar(valor: number) {
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "USD" });
}

function emReais(valor: number) {
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Quanto o armazenamento está custando e quem está consumindo. */
export function CostsPage() {
  const api = useAdminApi();
  const styles = useAdminStyles();

  const consulta = useQuery({
    queryKey: ["admin", "custos"],
    queryFn: () => api.get<ResumoDeCustos>("/custos"),
  });

  const dados = consulta.data;
  const passouDoTeto = Boolean(dados && dados.totais.custoTotalMes >= dados.totais.tetoMensal);

  return (
    <div>
      <AdminPageHeader
        title="Custos de armazenamento"
        description="O que a Bunny está cobrando e quais contas estão perto do limite do plano."
      />

      {consulta.isPending ? (
        <AdminListaCarregando />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { rotulo: "Guardado", valor: `${dados?.totais.armazenamentoGb ?? 0} GB` },
              { rotulo: "Armazenamento no mês", valor: emDolar(dados?.totais.custoArmazenamentoMes ?? 0) },
              {
                rotulo: "Tráfego no mês",
                valor: dados?.trafego.disponivel
                  ? emDolar(dados.totais.custoTrafegoMes)
                  : "não medido",
              },
              {
                rotulo: dados?.fatura.disponivel ? "Cobrado no mês" : "Total estimado",
                valor: emDolar(dados?.totais.custoTotalMes ?? 0),
                nota: `${emReais(dados?.totais.custoTotalMesBrl ?? 0)} · ${dados?.totais.fonte ?? ""}`,
              },
            ].map((item) => (
              <div key={item.rotulo} className={cn(styles.card, "p-5")}>
                <p className={cn("text-[11px] font-black uppercase tracking-wider", styles.muted)}>
                  {item.rotulo}
                </p>
                <p className={cn("mt-1 text-2xl font-black", styles.title)}>{item.valor}</p>
                {"nota" in item && item.nota && (
                  <p className={cn("mt-1 text-[11px] font-bold", styles.muted)}>{item.nota}</p>
                )}
              </div>
            ))}
          </div>

          {!dados?.trafego.disponivel && (
            <p
              className={cn(
                "mt-4 flex items-start gap-2 rounded-xl border px-4 py-3 text-xs font-bold",
                "border-(--ui-ambar-borda) bg-(--ui-ambar-fundo) text-(--ui-ambar-texto)",
              )}
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                O tráfego não entra na conta porque falta a chave da API da Bunny
                ({dados?.trafego.motivo}). O total acima é só o armazenamento.
              </span>
            </p>
          )}

          {passouDoTeto && (
            <p
              className={cn(
                "mt-4 flex items-start gap-2 rounded-xl border px-4 py-3 text-xs font-bold",
                "border-(--ui-rose-borda) bg-(--ui-rose-fundo) text-(--ui-rose-texto)",
              )}
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                O custo do mês passou do teto de {emDolar(dados!.totais.tetoMensal)}.
              </span>
            </p>
          )}

          {Boolean(dados?.semAssinatura.contas) && (
            <div className={cn(styles.card, "mt-4 p-5")}>
              <p className={cn("text-[11px] font-black uppercase tracking-wider", styles.muted)}>
                Espaço de quem não paga mais
              </p>
              <p className={cn("mt-1 text-lg font-black", styles.title)}>
                {dados!.semAssinatura.gb} GB em {dados!.semAssinatura.contas} conta
                {dados!.semAssinatura.contas === 1 ? "" : "s"} ·{" "}
                {emDolar(dados!.semAssinatura.custoMes)} por mês
              </p>
              <p className={cn("mt-1 text-xs font-bold", styles.muted)}>
                {Math.round(dados!.semAssinatura.fatiaDoTotal * 100)}% de tudo o que está guardado.
                Contas canceladas ou inadimplentes mantêm os arquivos, e eles continuam
                custando todo mês.
              </p>
            </div>
          )}

          <div className={cn(styles.card, "mt-6 overflow-hidden")}>
            <h3 className={cn("flex items-center gap-2 p-5 pb-0 text-sm font-black", styles.title)}>
              <HardDrive className="h-4 w-4" />
              Por conta ({dados?.totais.contas ?? 0})
            </h3>
            <TabelaRolavel>
              <table className="mt-3 w-full min-w-160 text-left">
                <thead>
                  <tr className={styles.tableHead}>
                    <th className="px-5 py-2">Conta</th>
                    <th className="px-5 py-2">Plano</th>
                    <th className="px-5 py-2">Arquivos</th>
                    <th className="px-5 py-2">Uso</th>
                    <th className="px-5 py-2">Custo no mês</th>
                  </tr>
                </thead>
                <tbody>
                  {dados?.contas.map((conta) => {
                    const perto = conta.fatiaUsada !== null && conta.fatiaUsada >= 0.9;
                    return (
                      <tr key={conta.id} className="border-t border-(--ui-borda-suave)">
                        <td className={cn("px-5 py-3 text-sm font-bold", styles.title)}>
                          {conta.nome || conta.id}
                          {conta.isenta && (
                            <span className={cn("ml-2 text-[11px] font-black", styles.muted)}>
                              isenta
                            </span>
                          )}
                        </td>
                        <td className={cn("px-5 py-3 text-xs font-bold", styles.muted)}>
                          {conta.plano || "—"}
                        </td>
                        <td className={cn("px-5 py-3 text-xs font-bold", styles.muted)}>
                          {conta.arquivos}
                        </td>
                        <td className="px-5 py-3 text-xs font-black">
                          <span className={perto ? "text-(--ui-rose-texto)" : styles.title}>
                            {conta.gb} GB
                            {conta.limiteGb ? ` de ${conta.limiteGb} GB` : ""}
                            {conta.fatiaUsada !== null
                              ? ` (${Math.round(conta.fatiaUsada * 100)}%)`
                              : ""}
                          </span>
                        </td>
                        <td className={cn("px-5 py-3 text-xs font-bold", styles.muted)}>
                          {emDolar(conta.custoArmazenamentoMes)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TabelaRolavel>
          </div>

          <p className={cn("mt-4 text-[11px] font-bold", styles.muted)}>
            A Bunny cobra em dólar. Preços usados na estimativa por conta:{" "}
            {emDolar(dados?.precos.armazenamentoGb ?? 0)} por GB guardado e{" "}
            {emDolar(dados?.precos.trafegoGb ?? 0)} por GB trafegado, com câmbio de{" "}
            {emReais(dados?.cambio ?? 0)} só para leitura. Ajuste em
            BUNNY_PRECO_ARMAZENAMENTO_GB, BUNNY_PRECO_TRAFEGO_GB e BUNNY_CAMBIO_USD.
          </p>
        </>
      )}
    </div>
  );
}
