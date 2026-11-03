import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Input } from "../../../components/ui/input";
import { cn } from "../../../lib/utils";
import { toast } from "../../../store/use-toast-store";
import {
  TabelaRolavel,
  AdminListaCarregando,
  PLAN_LABELS,
  REQUEST_STATUS_LABELS,
  adminErrorMessage,
  formatBrl,
  formatDate,
  formatStorage,
  useAdminApi,
  useAdminStyles,
  type AdminNavigate,
} from "../admin-shared";

interface OrganizationDetail {
  id: string;
  name: string;
  legalName: string | null;
  accountType: string | null;
  cnpj: string | null;
  owner: { name: string | null; email: string | null; phone: string | null };
  plan: string;
  effectivePlan: string;
  status: string;
  billingInterval: string | null;
  billingExempt: boolean;
  trialEndsAt: string | null;
  periodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  extraSeats: number;
  extraStoragePacks: number;
  hasStripeSubscription: boolean;
  customEntitlements: Record<string, number> | null;
  entitlements: Record<string, number | boolean>;
  adminNotes: string | null;
  usage: { users: number; workspaces: number; projects: number; storageMb: number };
  monthlyCents: number;
  members: Array<{ name: string; email: string; role: string; joinedAt: string }>;
  enterpriseRequests: Array<{ id: string; status: string; createdAt: string }>;
  auditLog?: Array<{ id: string; adminEmail: string; changes: string[]; createdAt: string }>;
  createdAt: string;
}

const LIMITES_EDITAVEIS: Array<{ key: string; label: string }> = [
  { key: "includedUsers", label: "Pessoas incluídas" },
  { key: "maxUsers", label: "Máximo de pessoas" },
  { key: "maxWorkspaces", label: "Workspaces" },
  { key: "maxProjects", label: "Projetos" },
  { key: "maxStorageMb", label: "Armazenamento (MB)" },
  { key: "maxFileSizeMb", label: "Tamanho por arquivo (MB)" },
  { key: "maxFilesPerUpload", label: "Arquivos por envio" },
  { key: "maxEmailAttachmentMb", label: "Anexo por e-mail (MB)" },
  { key: "maxStoragePacks", label: "Pacotes de 100 GB" },
];

const CHANGE_LABELS: Record<string, string> = {
  plan: "plano",
  billingExempt: "conta interna",
  trialEndsAt: "fim do teste",
  customEntitlements: "limites negociados",
  adminNotes: "anotações",
  status: "situação da solicitação Enterprise",
};

const ROLE_LABELS: Record<string, string> = {
  owner: "Titular",
  admin: "Administrador",
  member: "Membro",
  guest: "Convidado",
};

function formatLimit(value: number | boolean | undefined) {
  if (value === undefined) return "—";
  if (value === -1) return "ilimitado";
  return String(value);
}

export function OrganizationDetailPage({ id, navigate }: { id: string; navigate: AdminNavigate }) {
  const api = useAdminApi();
  const queryClient = useQueryClient();
  const styles = useAdminStyles();

  const { data, isPending, isError } = useQuery({
    queryKey: ["admin", "organization", id],
    queryFn: () => api.get<OrganizationDetail>(`/organizations/${encodeURIComponent(id)}`),
  });

  const [plan, setPlan] = useState("");
  const [exempt, setExempt] = useState(false);
  const [trialEndsAt, setTrialEndsAt] = useState("");
  const [notes, setNotes] = useState("");
  const [limites, setLimites] = useState<Record<string, string>>({});
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!data) return;
    setPlan(data.plan);
    setExempt(data.billingExempt);
    setTrialEndsAt(data.trialEndsAt ? data.trialEndsAt.slice(0, 10) : "");
    setNotes(data.adminNotes || "");
    setLimites(
      Object.fromEntries(
        LIMITES_EDITAVEIS.map((item) => [
          item.key,
          data.customEntitlements?.[item.key] !== undefined
            ? String(data.customEntitlements[item.key])
            : "",
        ]),
      ),
    );
  }, [data]);

  const voltar = () => navigate("/admin/contas");

  const salvar = async () => {
    if (!data) return;
    setSalvando(true);

    const body: Record<string, unknown> = {
      billingExempt: exempt,
      adminNotes: notes,
      trialEndsAt: trialEndsAt ? `${trialEndsAt}T23:59:59` : null,
      customEntitlements: Object.values(limites).some((valor) => valor !== "")
        ? Object.fromEntries(Object.entries(limites).filter(([, valor]) => valor !== ""))
        : null,
    };
    if (plan !== data.plan) body.plan = plan;

    try {
      const response = await api.patch<{ message?: string }>(
        `/organizations/${encodeURIComponent(id)}`,
        body,
      );
      toast.success(response.message || "Conta atualizada.");
      await queryClient.invalidateQueries({ queryKey: ["admin"] });
    } catch (error) {
      toast.error(adminErrorMessage(error, "Não foi possível salvar."));
    } finally {
      setSalvando(false);
    }
  };

  const backButton = (
    <button type="button" onClick={voltar} className={cn(styles.outline, "mb-4")}>
      <ArrowLeft className="h-3.5 w-3.5" />
      Voltar para contas
    </button>
  );

  if (isPending) {
    return (
      <>
        {backButton}
        <AdminListaCarregando />
      </>
    );
  }

  if (isError || !data) {
    return (
      <>
        {backButton}
        <p className="text-sm font-bold text-rose-600">Conta não encontrada.</p>
      </>
    );
  }

  const section = cn(styles.card, "p-5");
  const sectionTitle = cn("mb-4 text-sm font-bold", styles.title);
  const label = cn("text-[12px] font-bold", styles.muted);

  const usoLinhas = [
    { label: "Pessoas", used: data.usage.users, limit: data.entitlements.seats ?? data.entitlements.maxUsers },
    { label: "Workspaces", used: data.usage.workspaces, limit: data.entitlements.maxWorkspaces },
    { label: "Projetos", used: data.usage.projects, limit: data.entitlements.maxProjects },
    {
      label: "Armazenamento",
      used: formatStorage(data.usage.storageMb),
      limit:
        typeof data.entitlements.maxStorageMb === "number" && data.entitlements.maxStorageMb >= 0
          ? formatStorage(data.entitlements.maxStorageMb)
          : data.entitlements.maxStorageMb,
    },
  ];

  return (
    <>
      {backButton}

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className={cn("text-2xl font-black tracking-tight", styles.title)}>{data.name}</h1>
        <span className="rounded-full bg-blue-600/10 px-3 py-1 text-xs font-black text-blue-600">
          {data.billingExempt ? "Interna" : PLAN_LABELS[data.plan] || data.plan}
        </span>
        {data.effectivePlan !== data.plan && (
          <span className="rounded-full bg-amber-500/10 px-3 py-1 text-xs font-black text-amber-600">
            usando {PLAN_LABELS[data.effectivePlan] || data.effectivePlan}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className={section}>
          <h3 className={sectionTitle}>Titular</h3>
          <dl className="space-y-2 text-sm">
            <InfoRow label="Nome" value={data.owner.name} />
            <InfoRow label="E-mail" value={data.owner.email} />
            <InfoRow label="Telefone" value={data.owner.phone} />
            <InfoRow label={data.accountType === "person" ? "Tipo" : "CNPJ"} value={data.accountType === "person" ? "Pessoa física" : data.cnpj} />
            {data.legalName && <InfoRow label="Razão social" value={data.legalName} />}
            <InfoRow label="Criada em" value={formatDate(data.createdAt)} />
          </dl>
        </div>

        <div className={section}>
          <h3 className={sectionTitle}>Assinatura</h3>
          <dl className="space-y-2 text-sm">
            <InfoRow label="Situação" value={data.status} />
            <InfoRow label="Cobrança" value={data.hasStripeSubscription ? "Stripe" : "Sem assinatura na Stripe"} />
            <InfoRow label="Intervalo" value={data.billingInterval === "yearly" ? "Anual" : data.billingInterval === "monthly" ? "Mensal" : "—"} />
            <InfoRow label="Período atual até" value={formatDate(data.periodEnd)} />
            <InfoRow label="Fim do teste" value={formatDate(data.trialEndsAt)} />
            <InfoRow label="Adicionais" value={`${data.extraSeats} pessoas · ${data.extraStoragePacks} pacotes`} />
            <InfoRow label="Receita estimada" value={data.monthlyCents ? `${formatBrl(data.monthlyCents)}/mês` : "—"} />
            {data.cancelAtPeriodEnd && (
              <p className="text-xs font-bold text-amber-600">Cancelamento agendado para o fim do período.</p>
            )}
          </dl>
        </div>

        <div className={section}>
          <h3 className={sectionTitle}>Uso</h3>
          <dl className="space-y-2 text-sm">
            {usoLinhas.map((linha) => (
              <InfoRow
                key={linha.label}
                label={linha.label}
                value={`${linha.used} de ${formatLimit(linha.limit as number)}`}
              />
            ))}
          </dl>
        </div>
      </div>

      <div className={cn(section, "mt-4")}>
        <h3 className={sectionTitle}>Ajustes manuais</h3>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <label className="flex flex-col gap-1">
            <span className={label}>Plano</span>
            <select
              value={plan}
              onChange={(event) => setPlan(event.target.value)}
              disabled={data.hasStripeSubscription}
              className={styles.input}
            >
              {Object.entries(PLAN_LABELS)
                .filter(([planId]) => planId !== "interna")
                .map(([planId, planLabel]) => (
                  <option key={planId} value={planId}>
                    {planLabel}
                  </option>
                ))}
            </select>
            {data.hasStripeSubscription && (
              <span className={cn("text-[11px] font-medium", styles.muted)}>
                Conta paga pela Stripe: o plano muda pela própria assinatura.
              </span>
            )}
          </label>

          <label className="flex flex-col gap-1">
            <span className={label}>Fim do teste grátis</span>
            <input aria-label="Fim do teste grátis"
              type="date"
              value={trialEndsAt}
              onChange={(event) => setTrialEndsAt(event.target.value)}
              className={styles.input}
            />
          </label>

          <label className="flex cursor-pointer items-center gap-2 md:pt-6">
            <input
              type="checkbox"
              checked={exempt}
              onChange={(event) => setExempt(event.target.checked)}
              className="h-4 w-4 accent-blue-600"
            />
            <span className={cn("text-sm font-bold", styles.title)}>
              Conta interna (sem cobrança e sem limites)
            </span>
          </label>
        </div>

        <p className={cn("mb-3 mt-6", label)}>
          Limites negociados — em branco usa o limite do plano; -1 = ilimitado
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {LIMITES_EDITAVEIS.map((item) => (
            <label key={item.key} className="flex flex-col gap-1">
              <span className={cn("text-[11px] font-bold", styles.muted)}>
                {item.label}{" "}
                <span className="font-medium">(atual: {formatLimit(data.entitlements[item.key])})</span>
              </span>
              <Input
                type="number"
                value={limites[item.key] ?? ""}
                onChange={(event) =>
                  setLimites((atual) => ({ ...atual, [item.key]: event.target.value }))
                }
              />
            </label>
          ))}
        </div>

        <label className="mt-6 flex flex-col gap-1">
          <span className={label}>Anotações internas</span>
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={3}
            className={cn(styles.input, "h-auto py-2")}
          />
        </label>

        <div className="mt-5 flex justify-end">
          <button type="button" onClick={() => void salvar()} disabled={salvando} className={styles.primary}>
            {salvando && <Loader2 className="h-4 w-4 animate-spin" />}
            Salvar alterações
          </button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className={cn(styles.card, "overflow-hidden")}>
          <h3 className={cn(sectionTitle, "mb-0 p-5")}>Membros ({data.members.length})</h3>
          <TabelaRolavel>
            <table className="w-full text-left">
              <thead>
                <tr className={styles.tableHead}>
                  <th className="px-5 py-2">Nome</th>
                  <th className="px-5 py-2">Papel</th>
                  <th className="px-5 py-2">Desde</th>
                </tr>
              </thead>
              <tbody>
                {data.members.map((membro) => (
                  <tr key={membro.email} className={styles.tableRow}>
                    <td className={cn("px-5 py-2", styles.title)}>
                      <span className="font-bold">{membro.name}</span>
                      <span className={cn("block text-xs", styles.muted)}>{membro.email}</span>
                    </td>
                    <td className={cn("px-5 py-2 text-xs", styles.muted)}>{ROLE_LABELS[membro.role] || membro.role}</td>
                    <td className={cn("px-5 py-2 text-xs", styles.muted)}>{formatDate(membro.joinedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TabelaRolavel>
        </div>

        <div className="space-y-4">
          <div className={section}>
            <h3 className={sectionTitle}>Solicitações Enterprise</h3>
            {data.enterpriseRequests.length === 0 ? (
              <p className={cn("text-sm", styles.muted)}>Nenhuma.</p>
            ) : (
              <ul className="space-y-2">
                {data.enterpriseRequests.map((pedido) => (
                  <li key={pedido.id}>
                    <button
                      type="button"
                      onClick={() => navigate("/admin/enterprise")}
                      className="text-sm font-bold text-blue-600 hover:underline cursor-pointer"
                    >
                      {formatDate(pedido.createdAt)} · {REQUEST_STATUS_LABELS[pedido.status] || pedido.status}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className={section}>
            <h3 className={sectionTitle}>Histórico de ajustes da equipe</h3>
            {!data.auditLog?.length ? (
              <p className={cn("text-sm", styles.muted)}>Nenhum ajuste manual.</p>
            ) : (
              <ul className="space-y-2">
                {data.auditLog.map((registro) => (
                  <li key={registro.id} className={cn("text-xs", styles.muted)}>
                    <span className={cn("font-bold", styles.title)}>{formatDate(registro.createdAt, true)}</span> ·{" "}
                    {registro.adminEmail} · {registro.changes.map((campo) => CHANGE_LABELS[campo] || campo).join(", ")}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  const styles = useAdminStyles();
  return (
    <div className="flex justify-between gap-3">
      <dt className={cn("shrink-0 font-medium", styles.muted)}>{label}</dt>
      <dd className={cn("truncate text-right font-bold", styles.title)}>{value || "—"}</dd>
    </div>
  );
}
