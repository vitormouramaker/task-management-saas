import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  FileText,
  Info,
  Receipt,
} from "lucide-react";
import { buildApiUrl } from "../../../lib/api";
import { cn } from "../../../lib/utils";
import { useAuthStore } from "../../../store/use-auth-store";
import { formatBrl } from "./plan-catalog";
import { ListaCarregando } from "../../../components/ui/lista-carregando";

interface InvoiceLine {
  description: string | null;
  quantity: number;
  amountCents: number;
  proration: boolean;
}

interface Invoice {
  id: string;
  number: string | null;
  status: string;
  createdAt: string | null;
  paidAt: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  amountDueCents: number;
  amountPaidCents: number;
  hostedInvoiceUrl: string | null;
  invoicePdf: string | null;
  billingReason: string | null;
  lines: InvoiceLine[];
  nfse?: { status: string; number: string | null; url: string | null; issuedAt: string | null } | null;
}

const PAGE_SIZE = 20;

const STATUS: Record<string, { label: string; tone: "ok" | "warn" | "muted" }> = {
  paid: { label: "Pago", tone: "ok" },
  open: { label: "Aguardando pagamento", tone: "warn" },
  draft: { label: "Rascunho", tone: "muted" },
  uncollectible: { label: "Não recebida", tone: "warn" },
  void: { label: "Cancelada", tone: "muted" },
};

const REASONS: Record<string, string> = {
  subscription_create: "Início da assinatura",
  subscription_cycle: "Renovação do plano",
  subscription_update: "Ajuste no plano",
  subscription_threshold: "Ajuste de uso",
  manual: "Cobrança avulsa",
};

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("pt-BR");
}

/** Histórico de cobranças, uma por bloco, com o que foi cobrado em cada uma. */
export function PaymentsPage() {
  const token = useAuthStore((state) => state.token);
  const [page, setPage] = useState(0);

  const { data, isPending, isError } = useQuery<{ invoices: Invoice[] }>({
    queryKey: ["billing", "invoices"],
    enabled: Boolean(token),
    staleTime: 60 * 1000,
    queryFn: async () => {
      const response = await axios.get(buildApiUrl("/api/billing/invoices"), {
        headers: { Authorization: `Bearer ${token}` },
      });
      return response.data as { invoices: Invoice[] };
    },
  });

  const invoices = useMemo(() => data?.invoices || [], [data]);
  const totalPages = Math.max(1, Math.ceil(invoices.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const visible = invoices.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE);

  const cardClass = cn(
    "rounded-2xl border",
    "border-(--ui-borda) bg-(--ui-superficie)",
  );
  const mutedClass = "text-(--ui-texto-secundario)";
  const titleClass = "text-(--ui-texto-principal)";
  const actionClass = cn(
    "inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-xs font-bold transition-colors cursor-pointer",
    "border-(--ui-borda) text-(--ui-texto-item) hover:bg-(--ui-hover) hover:text-(--ui-texto-forte)",
  );

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2">
      <div className={cn(cardClass, "mb-6 p-6")}>
        <div className="flex items-start gap-4">
          <div
            className={cn(
              "rounded-xl p-3",
              "bg-(--ui-azul-fundo) text-(--ui-azul-texto)",
            )}
          >
            <Receipt className="h-6 w-6" />
          </div>
          <div>
            <h2 className={cn("text-lg font-bold", titleClass)}>Pagamentos</h2>
            <p className={cn("text-sm font-medium", mutedClass)}>
              Cada cobrança da sua conta, com o que foi cobrado, a data e o recibo para
              baixar. Ajustes de plano no meio do mês aparecem como crédito do tempo não
              usado + cobrança do tempo restante.
            </p>
          </div>
        </div>
      </div>

      {isPending ? (
        <div className={cn(cardClass, "p-6")}>
          <ListaCarregando />
        </div>
      ) : isError ? (
        <div className={cn(cardClass, "p-6")}>
          <p className="text-sm font-bold text-rose-600">
            Não foi possível carregar as cobranças.
          </p>
        </div>
      ) : invoices.length === 0 ? (
        <div className={cn(cardClass, "p-6")}>
          <p className={cn("text-sm font-bold", titleClass)}>
            Nenhuma cobrança por aqui ainda.
          </p>
          <p className={cn("mt-1 text-sm font-medium", mutedClass)}>
            Quando você assinar um plano, todas as faturas aparecem nesta tela.
          </p>
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {visible.map((invoice) => {
              const status = STATUS[invoice.status] || {
                label: invoice.status,
                tone: "muted" as const,
              };
              const valor = invoice.amountPaidCents || invoice.amountDueCents;
              const linhas = invoice.lines.filter((line) => line.description);

              return (
                <div key={invoice.id} className={cn(cardClass, "p-5")}>
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={cn("text-sm font-black", titleClass)}>
                          {REASONS[invoice.billingReason || ""] || "Cobrança"}
                        </span>
                        <span
                          className={cn(
                            "rounded-full px-2.5 py-0.5 text-[11px] font-black",
                            status.tone === "ok"
                              ? "bg-emerald-500/10 text-emerald-600"
                              : status.tone === "warn"
                                ? "bg-amber-500/10 text-amber-600"
                                : "bg-(--ui-fundo-neutro) text-(--ui-texto-secundario)",
                          )}
                        >
                          {status.label}
                        </span>
                      </div>

                      <p className={cn("mt-1 text-xs font-bold", mutedClass)}>
                        {formatDate(invoice.paidAt || invoice.createdAt)}
                        {invoice.periodStart && invoice.periodEnd && (
                          <>
                            {" · período de "}
                            {formatDate(invoice.periodStart)} a {formatDate(invoice.periodEnd)}
                          </>
                        )}
                        {invoice.number && ` · nº ${invoice.number}`}
                      </p>
                    </div>

                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        {valor === 0 ? (
                          <div className="group relative flex items-center gap-1">
                            <span className={cn("text-sm font-black", titleClass)}>
                              Sem cobrança
                            </span>
                            <Info className={cn("h-3.5 w-3.5", mutedClass)} />
                            <span
                              className={cn(
                                "pointer-events-none absolute right-0 top-7 z-20 w-72 rounded-xl border p-3 text-left text-[11px] font-medium opacity-0 shadow-xl transition-opacity group-hover:opacity-100",
                                "border-(--ui-borda) bg-(--ui-superficie-suave) text-(--ui-texto-secundario)",
                              )}
                            >
                              Você mudou o plano no meio do período já pago. O valor que
                              sobrou do plano anterior (crédito, em verde) cobriu o valor do
                              plano novo, então nada foi cobrado agora. A diferença aparece
                              na próxima renovação.
                            </span>
                          </div>
                        ) : (
                          <div className={cn("text-lg font-black", titleClass)}>
                            {formatBrl(valor)}
                          </div>
                        )}
                      </div>

                      <div className="flex flex-wrap justify-end gap-2">
                        {invoice.hostedInvoiceUrl && (
                          <a
                            href={invoice.hostedInvoiceUrl}
                            target="_blank"
                            rel="noreferrer"
                            className={actionClass}
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                            Ver recibo
                          </a>
                        )}
                        {invoice.invoicePdf && (
                          <a
                            href={invoice.invoicePdf}
                            target="_blank"
                            rel="noreferrer"
                            className={actionClass}
                          >
                            <Download className="h-3.5 w-3.5" />
                            Baixar PDF
                          </a>
                        )}
                        {invoice.nfse?.url ? (
                          <a
                            href={invoice.nfse.url}
                            target="_blank"
                            rel="noreferrer"
                            className={actionClass}
                          >
                            <FileText className="h-3.5 w-3.5" />
                            Nota fiscal nº {invoice.nfse.number}
                          </a>
                        ) : (
                          invoice.status === "paid" &&
                          invoice.amountPaidCents > 0 &&
                          invoice.nfse?.status === "pendente" && (
                            <span className={cn("self-center text-[11px] font-bold", mutedClass)}>
                              Nota fiscal em emissão
                            </span>
                          )
                        )}
                      </div>
                    </div>
                  </div>

                  {linhas.length > 0 && (
                    <ul
                      className={cn(
                        "mt-4 divide-y rounded-xl border",
                        "divide-(--ui-borda-suave) border-(--ui-borda) bg-(--ui-fundo-sutil)",
                      )}
                    >
                      {linhas.map((line, index) => (
                        <li
                          key={`${invoice.id}-${index}`}
                          className="flex items-center justify-between gap-3 px-4 py-2"
                        >
                          <span className={cn("text-xs font-medium", mutedClass)}>
                            {line.description}
                            {line.quantity > 1 && (
                              <span className="ml-1 font-black">× {line.quantity}</span>
                            )}
                            {line.proration && (
                              <span
                                className={cn(
                                  "ml-2 rounded-full px-2 py-0.5 text-[10px] font-black",
                                  line.amountCents < 0
                                    ? "bg-emerald-500/10 text-emerald-600"
                                    : "bg-(--ui-fundo-neutro) text-(--ui-texto-secundario)",
                                )}
                              >
                                {line.amountCents < 0
                                  ? "crédito do tempo não usado"
                                  : "cobrança proporcional"}
                              </span>
                            )}
                          </span>
                          <span
                            className={cn(
                              "shrink-0 text-xs font-black",
                              line.amountCents < 0 ? "text-emerald-600" : titleClass,
                            )}
                          >
                            {formatBrl(line.amountCents)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>

          {totalPages > 1 && (
            <div className="mt-5 flex items-center justify-between gap-3">
              <span className={cn("text-xs font-bold", mutedClass)}>
                Página {currentPage + 1} de {totalPages} · {invoices.length} cobrança(s)
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPage((atual) => Math.max(0, atual - 1))}
                  disabled={currentPage === 0}
                  className={cn(actionClass, "disabled:opacity-40 disabled:cursor-not-allowed")}
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  Anterior
                </button>
                <button
                  type="button"
                  onClick={() => setPage((atual) => Math.min(totalPages - 1, atual + 1))}
                  disabled={currentPage >= totalPages - 1}
                  className={cn(actionClass, "disabled:opacity-40 disabled:cursor-not-allowed")}
                >
                  Próxima
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
