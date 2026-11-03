import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, ExternalLink, Loader2, RefreshCw, Search } from "lucide-react";
import { cn } from "../../../lib/utils";
import { toast } from "../../../store/use-toast-store";
import {
  AdminListaCarregando,
  AdminPageHeader,
  adminErrorMessage,
  formatBrl,
  formatDate,
  useAdminApi,
  useAdminStyles,
  type AdminNavigate,
} from "../admin-shared";

type NfseStatus = "pendente" | "emitida" | "cancelada" | "nao_emitir";

interface NfseRecord {
  id: string;
  organizationId: string | null;
  organizationName: string | null;
  stripeInvoiceNumber: string | null;
  amountCents: number;
  paidAt: string | null;
  competence: string | null;
  customerName: string | null;
  customerDocument: string | null;
  customerDocumentType: "CPF" | "CNPJ" | null;
  customerEmail: string | null;
  customerAddress: {
    line1?: string | null;
    line2?: string | null;
    city?: string | null;
    state?: string | null;
    postal_code?: string | null;
    country?: string | null;
  } | null;
  serviceDescription: string | null;
  status: NfseStatus;
  nfseNumber: string | null;
  verificationCode: string | null;
  documentUrl: string | null;
  notes: string | null;
  issuedAt: string | null;
  issuedByName: string | null;
  emailSentAt: string | null;
  accessKey: string | null;
  lastError: string | null;
  autoAttempts: number;
}

const STATUS_LABELS: Record<NfseStatus, string> = {
  pendente: "Pendentes",
  emitida: "Emitidas",
  cancelada: "Canceladas",
  nao_emitir: "Sem nota",
};

function formatDocument(value: string | null, type: string | null) {
  const digits = String(value || "").replace(/\D/g, "");
  if (type === "CNPJ" && digits.length === 14) {
    return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  }
  if (type === "CPF" && digits.length === 11) {
    return digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  }
  return value || "";
}

function formatAddress(address: NfseRecord["customerAddress"]) {
  if (!address) return "";
  return [address.line1, address.line2, [address.city, address.state].filter(Boolean).join(" - "), address.postal_code]
    .filter(Boolean)
    .join(", ");
}

/** Fila de notas fiscais: dados prontos para emitir no site da prefeitura. */
export function InvoicesPage({ navigate }: { navigate: AdminNavigate }) {
  const api = useAdminApi();
  const styles = useAdminStyles();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<NfseStatus | "">("pendente");
  const [search, setSearch] = useState("");
  const [syncing, setSyncing] = useState(false);

  const { data, isPending } = useQuery({
    queryKey: ["admin", "nfse", status, search],
    queryFn: () =>
      api.get<{ records: NfseRecord[]; counts: Record<string, number>; serviceCode: string | null }>("/nfse", {
        status,
        search,
      }),
  });

  const sync = async () => {
    setSyncing(true);
    try {
      const result = await api.post<{ message: string }>("/nfse/sync", {});
      toast.success(result.message);
      await queryClient.invalidateQueries({ queryKey: ["admin"] });
    } catch (error) {
      toast.error(adminErrorMessage(error, "Não foi possível buscar na Stripe."));
    } finally {
      setSyncing(false);
    }
  };

  return (
    <>
      <AdminPageHeader
        title="Notas fiscais"
        description="Cada fatura paga vira um pedido aqui. Emita no site da prefeitura com os dados abaixo e registre o número: o cliente recebe a nota por e-mail e na tela de Pagamentos."
        actions={
          <button type="button" onClick={() => void sync()} disabled={syncing} className={styles.outline}>
            {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Buscar faturas pagas na Stripe
          </button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(["pendente", "emitida", "nao_emitir", "cancelada", ""] as const).map((value) => (
          <button
            key={value || "todas"}
            type="button"
            onClick={() => setStatus(value)}
            className={cn(
              "h-9 rounded-full px-4 text-xs font-bold transition-colors cursor-pointer",
              status === value
                ? "bg-blue-600 text-white"
                : "bg-(--ui-fundo-neutro) text-(--ui-texto-secundario) hover:bg-(--ui-hover-forte)",
            )}
          >
            {value ? STATUS_LABELS[value] : "Todas"}
            {value && data?.counts?.[value] ? ` (${data.counts[value]})` : ""}
          </button>
        ))}
        <div className="relative ml-auto w-full sm:w-72">
          <Search className={cn("absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2", styles.muted)} />
          <input aria-label="Tomador, CPF/CNPJ, conta ou fatura"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Tomador, CPF/CNPJ, conta ou fatura"
            className={cn(styles.input, "h-9 w-full pl-9")}
          />
        </div>
      </div>

      <p className={cn("mb-4 text-xs font-medium", styles.muted)}>
        Código do serviço:{" "}
        <strong>{data?.serviceCode || "defina NFSE_SERVICE_CODE com a contabilidade (ex.: item 1.05 da LC 116 – licenciamento de software)"}</strong>
        . Empresa no Simples Nacional: o ISS é recolhido no DAS.
      </p>

      {isPending ? (
        <AdminListaCarregando />
      ) : (data?.records || []).length === 0 ? (
        <div className={cn(styles.card, "p-6 text-sm font-bold", styles.title)}>Nada por aqui.</div>
      ) : (
        <div className="space-y-3">
          {data?.records.map((record) => (
            <NfseCard key={record.id} record={record} navigate={navigate} />
          ))}
        </div>
      )}
    </>
  );
}

function CopyField({ label, value, multiline = false }: { label: string; value: string; multiline?: boolean }) {
  const styles = useAdminStyles();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Não foi possível copiar.");
    }
  };

  return (
    <div className="min-w-0">
      <p className={cn("text-[11px] font-bold", styles.muted)}>{label}</p>
      <div className="flex items-start gap-1.5">
        <p className={cn("min-w-0 flex-1 text-sm font-bold", styles.title, multiline ? "whitespace-pre-line" : "truncate")}>
          {value || "—"}
        </p>
        {value && (
          <button type="button" onClick={() => void copy()} aria-label={`Copiar ${label}`} className="shrink-0 cursor-pointer p-0.5">
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className={cn("h-3.5 w-3.5", styles.muted)} />}
          </button>
        )}
      </div>
    </div>
  );
}

function NfseCard({ record, navigate }: { record: NfseRecord; navigate: AdminNavigate }) {
  const api = useAdminApi();
  const styles = useAdminStyles();
  const queryClient = useQueryClient();
  const [number, setNumber] = useState(record.nfseNumber || "");
  const [code, setCode] = useState(record.verificationCode || "");
  const [url, setUrl] = useState(record.documentUrl || "");
  const [notes, setNotes] = useState(record.notes || "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setNumber(record.nfseNumber || "");
    setCode(record.verificationCode || "");
    setUrl(record.documentUrl || "");
    setNotes(record.notes || "");
  }, [record]);

  const save = async (status: NfseStatus) => {
    setSaving(true);
    try {
      const result = await api.patch<{ message: string }>(`/nfse/${record.id}`, {
        status,
        nfseNumber: number,
        verificationCode: code,
        documentUrl: url,
        notes,
      });
      toast.success(result.message);
      await queryClient.invalidateQueries({ queryKey: ["admin"] });
    } catch (error) {
      toast.error(adminErrorMessage(error, "Não foi possível salvar."));
    } finally {
      setSaving(false);
    }
  };

  const valor = (record.amountCents / 100).toFixed(2).replace(".", ",");

  return (
    <div className={cn(styles.card, "p-5")}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className={cn("text-base font-bold", styles.title)}>
            {formatBrl(record.amountCents)} · {record.customerName || record.organizationName}
          </p>
          <p className={cn("text-xs font-medium", styles.muted)}>
            Pago em {formatDate(record.paidAt, true)} · fatura {record.stripeInvoiceNumber || "—"} ·{" "}
            {record.organizationId ? (
              <button
                type="button"
                onClick={() => navigate(`/admin/contas/${encodeURIComponent(record.organizationId!)}`)}
                className="font-bold text-blue-600 hover:underline cursor-pointer"
              >
                {record.organizationName}
              </button>
            ) : (
              record.organizationName || "conta removida"
            )}
          </p>
        </div>
        {record.status === "emitida" && (
          <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-black text-emerald-600">
            Nota nº {record.nfseNumber} · {formatDate(record.issuedAt)}
            {record.emailSentAt ? " · enviada por e-mail" : ""}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <CopyField label="Tomador" value={record.customerName || ""} />
        <CopyField
          label={record.customerDocumentType || "CPF/CNPJ"}
          value={formatDocument(record.customerDocument, record.customerDocumentType)}
        />
        <CopyField label="E-mail do tomador" value={record.customerEmail || ""} />
        <CopyField label="Valor do serviço" value={valor} />
        <CopyField label="Competência" value={record.competence ? record.competence.split("-").reverse().join("/") : ""} />
        <div className="sm:col-span-2 lg:col-span-3">
          <CopyField label="Endereço (da Stripe)" value={formatAddress(record.customerAddress)} />
        </div>
        <div className="sm:col-span-2 lg:col-span-4">
          <CopyField label="Discriminação do serviço" value={record.serviceDescription || ""} multiline />
        </div>
      </div>

      {!record.customerDocument && (
        <p className="mt-3 text-xs font-bold text-amber-600">
          Sem CPF/CNPJ na conta nem na Stripe. Confirme com o cliente antes de emitir.
        </p>
      )}

      {record.status === "pendente" && record.lastError && (
        <p
          className={cn(
            "mt-3 rounded-xl border px-3 py-2 text-xs font-bold",
            "border-(--ui-ambar-borda) bg-(--ui-ambar-fundo) text-(--ui-ambar-texto)",
          )}
        >
          A emissão automática não saiu ({record.autoAttempts} tentativa
          {record.autoAttempts === 1 ? "" : "s"}): {record.lastError}
        </p>
      )}

      <div className={cn("mt-4 grid grid-cols-1 gap-3 border-t pt-4 md:grid-cols-3", "border-(--ui-borda-suave)")}>
        <input aria-label="Número da NFS-e" value={number} onChange={(event) => setNumber(event.target.value)} placeholder="Número da NFS-e" className={styles.input} />
        <input aria-label="Código de verificação" value={code} onChange={(event) => setCode(event.target.value)} placeholder="Código de verificação" className={styles.input} />
        <input aria-label="Link da nota (https://...)" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="Link da nota (https://...)" className={styles.input} />
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          rows={2}
          placeholder="Observações (obrigatório para marcar como sem nota)"
          className={cn(styles.input, "h-auto py-2 md:col-span-3")}
        />
      </div>

      <div className="mt-3 flex flex-wrap justify-end gap-2">
        {record.documentUrl && (
          <a href={record.documentUrl} target="_blank" rel="noreferrer" className={styles.outline}>
            <ExternalLink className="h-3.5 w-3.5" />
            Abrir nota
          </a>
        )}
        {record.status !== "nao_emitir" && record.status !== "emitida" && (
          <button type="button" onClick={() => void save("nao_emitir")} disabled={saving} className={styles.outline}>
            Não emitir
          </button>
        )}
        {record.status === "emitida" && (
          <button type="button" onClick={() => void save("cancelada")} disabled={saving} className={cn(styles.outline, "text-rose-600")}>
            Marcar como cancelada
          </button>
        )}
        <button type="button" onClick={() => void save("emitida")} disabled={saving || !number.trim()} className={styles.primary}>
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          {record.status === "emitida" ? "Salvar dados da nota" : "Registrar nota emitida"}
        </button>
      </div>
    </div>
  );
}
