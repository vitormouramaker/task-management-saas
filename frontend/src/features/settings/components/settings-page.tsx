import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTaskStore } from "../../../store/use-task-store";
import {
  Plus,
  Tag as TagIcon,
  Trash2,
  Loader2,
  Info,
  MoreHorizontal,
  Pencil,
  Check,
  ChevronDown,
  CreditCard,
} from "lucide-react";
import { ConfirmationModal } from "../../../components/ui/confirmation-modal";
import { Input } from "../../../components/ui/input";
import { Skeleton } from "../../../components/ui/skeleton";
import { formatIsoDate } from "../../../lib/documents";
import { PlanCatalog, formatBrl } from "../../billing/components/plan-catalog";
import { PaymentsPage } from "../../billing/components/payments-page";
import type { PlanSubscriptionSummary } from "../../billing/use-plan-limits";
import { cn } from "../../../lib/utils";
import { useAuthStore } from "../../../store/use-auth-store";
import { useThemeStore } from "../../../store/use-theme-store";
import { ENTITY_COLOR_OPTIONS } from "../../../lib/entity-colors";
import {
  getWorkspacePermissionForWorkspace,
  hasWorkspacePermission,
} from "../../../lib/workspace-permissions";
import axios from "axios";
import { toast } from "../../../store/use-toast-store";
import { AccountSettingsPanel } from "../../account/components/account-settings-panel";
import { AutomationsSettings } from "../../automations/components/automations-settings";
import { IntegrationsSettings } from "../../integrations/components/integrations-settings";
import { CancellationSurveyModal } from "../../billing/components/cancellation-survey-modal";
import { CancelFlowModal } from "../../billing/components/cancel-flow-modal";
import { JobTitlesSettings } from "./job-titles-settings";
import type {
  CustomFieldDefinition,
  CustomFieldOption,
  CustomFieldType,
  EntityId,
  TaskTag,
} from "../../../types/tasks";

const CUSTOM_FIELD_TYPE_OPTIONS: Array<{
  value: CustomFieldType;
  label: string;
}> = [
  { value: "text", label: "Texto curto" },
  { value: "number", label: "Número" },
  { value: "date", label: "Data" },
  { value: "checkbox", label: "Checkbox" },
  { value: "single_select", label: "Seleção única" },
];

function getCustomFieldTypeLabel(type: CustomFieldType) {
  return (
    CUSTOM_FIELD_TYPE_OPTIONS.find((item) => item.value === type)?.label || type
  );
}

function parseCustomFieldOptionsInput(value: string): CustomFieldOption[] {
  return value
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((label, index) => ({
      id: `cfo_local_${index}_${label.toLowerCase().replace(/\s+/g, "_")}`,
      label,
    }));
}

function stringifyCustomFieldOptions(options?: CustomFieldOption[]) {
  return (options || []).map((option) => option.label).join("\n");
}

function compareCustomFields(
  left?: CustomFieldDefinition,
  right?: CustomFieldDefinition,
) {
  if (!left || !right) return 0;
  if (left.displayOrder !== right.displayOrder) {
    return left.displayOrder - right.displayOrder;
  }

  return left.name.localeCompare(right.name, "pt-BR");
}

interface BillingPlan {
  id: "free" | "essencial" | "profissional" | "empresarial" | "enterprise";
  name: string;
  description: string;
  priceCents: Record<"monthly" | "yearly", number | null>;
  extraUserPriceCents: Record<"monthly" | "yearly", number | null>;
  highlight?: string | null;
  contactOnly?: boolean;
  features: string[];
  entitlements: {
    includedUsers: number;
    maxUsers: number;
    seats?: number;
    maxWorkspaces: number;
    maxProjects: number;
    maxStorageMb: number;
    maxFileSizeMb?: number;
    customFields: boolean;
    advancedReports: boolean;
    automations: boolean;
  };
}


function formatStorageMb(megabytes: number) {
  if (megabytes >= 1024) {
    return `${(megabytes / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} GB`;
  }
  return `${megabytes.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
}

interface BillingSubscriptionResponse {
  organization: {
    id: string;
    name: string;
    plan: BillingPlan["id"];
    planName?: string;
    contractedPlan?: string;
    subscriptionStatus: string;
    billingInterval?: "monthly" | "yearly" | null;
    trial?: { active: boolean; daysLeft: number; endsAt?: string | null; expired?: boolean };
    payment?: { pastDue: boolean; days: number; warn: boolean; readOnly: boolean };
    periodEnd?: string | null;
    cancelAtPeriodEnd?: boolean;
    cancellationSurveyPending?: boolean;
    discount?: {
      percentOff: number | null;
      amountOffCents: number | null;
      months: number | null;
      duration: string | null;
      startedAt: string | null;
      endsAt: string | null;
      nextAmountCents: number | null;
      nextInvoiceAt: string | null;
    } | null;
    pendingChange?: {
      at: string | null;
      plan: string | null;
      extraSeats: number | null;
      extraStoragePacks: number | null;
    } | null;
    stripeCustomerId?: string | null;
    stripeSubscriptionId?: string | null;
    extraSeats?: number;
    extraStoragePacks?: number;
    billingExempt?: boolean;
    readOnly?: boolean;
    overLimits?: string[];
    entitlements: BillingPlan["entitlements"] & { seats: number };
    usage: {
      workspaces: number;
      users: number;
      projects?: number;
      storageMb?: number;
    };
  };
  plans: BillingPlan[];
  storagePack?: { storageMb: number; priceCents: Record<"monthly" | "yearly", number> };
  trialDays?: number;
  checkoutEnabled?: boolean;
}

function SettingsSelect({
  value,
  onChange,
  options,
  disabled = false,
  placeholder = "Selecione uma opção",
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{
    value: string;
    label: string;
    description?: string;
  }>;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selectedOption =
    options.find((option) => option.value === value) || null;

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen]);

  useEffect(() => {
    if (disabled && isOpen) {
      setIsOpen(false);
    }
  }, [disabled, isOpen]);

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        disabled={disabled}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        className={cn(
          "flex min-h-11 w-full items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left text-sm font-semibold outline-none transition cursor-pointer disabled:cursor-not-allowed disabled:opacity-60",
          "border-(--ui-borda) bg-(--ui-superficie-suave) text-(--ui-texto-forte) hover:border-(--ui-azul-borda) hover:bg-(--ui-hover)",
          isOpen &&
            ("border-(--ui-azul-borda) ring-4 ring-(--ui-azul-borda)"),
        )}
      >
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              "block truncate text-sm font-semibold",
              selectedOption
                ? "text-(--ui-texto-principal)"
                : "text-(--ui-texto-secundario)",
            )}
          >
            {selectedOption?.label || placeholder}
          </span>
          {selectedOption?.description ? (
            <span
              className={cn(
                "mt-0.5 block truncate text-[11px] font-medium",
                "text-(--ui-texto-secundario)",
              )}
            >
              {selectedOption.description}
            </span>
          ) : null}
        </span>
      </button>
      <ChevronDown
        className={cn(
          "pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 transition-transform",
          "text-(--ui-texto-secundario)",
          isOpen && "rotate-180",
        )}
      />

      {isOpen ? (
        <div
          className={cn(
            "absolute left-0 right-0 top-[calc(100%+10px)] z-40 overflow-hidden rounded-2xl border p-2 backdrop-blur-xl",
            "border-(--ui-borda) bg-(--ui-superficie-suave)",
          )}
        >
          <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
            {options.map((option) => {
              const isSelected = option.value === value;

              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    onChange(option.value);
                    setIsOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition-colors cursor-pointer",
                    isSelected
                      ? "bg-(--ui-azul-fundo) text-(--ui-azul-texto)"
                      : "text-(--ui-texto-forte) hover:bg-(--ui-fundo-sutil)",
                  )}
                  role="option"
                  aria-selected={isSelected}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">
                      {option.label}
                    </span>
                    {option.description ? (
                      <span
                        className={cn(
                          "mt-0.5 block truncate text-[11px] font-medium",
                          isSelected
                            ? "text-(--ui-azul-texto)"
                            : "text-(--ui-texto-secundario)",
                        )}
                      >
                        {option.description}
                      </span>
                    ) : null}
                  </span>
                  <span
                    className={cn(
                      "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors",
                      isSelected
                        ? "border-(--ui-azul-borda) bg-(--ui-azul-fundo) text-(--ui-azul-texto)"
                        : "border-(--ui-borda) bg-(--ui-fundo-neutro) text-transparent",
                    )}
                  >
                    <Check className="h-3.5 w-3.5" />
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SettingsCheckbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <label
      className={cn(
        "group inline-flex items-center gap-3 rounded-2xl border px-3 py-2 text-sm font-semibold cursor-pointer transition-colors",
        "border-(--ui-borda) bg-(--ui-superficie) text-(--ui-texto-forte) hover:border-(--ui-azul-borda)",
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="peer sr-only"
      />
      <span
        className={cn(
          "flex h-5 w-5 items-center justify-center rounded-md border transition-all",
          checked
            ? "border-blue-600 bg-blue-600 text-white shadow-sm shadow-blue-500/30"
            : "border-(--ui-borda-forte) bg-(--ui-fundo-sutil) text-transparent",
        )}
      >
        <Check className="h-3.5 w-3.5" />
      </span>
      <span>{label}</span>
    </label>
  );
}

type AbaDasConfiguracoes =
  | "billing"
  | "payments"
  | "tags"
  | "general"
  | "customFields"
  | "jobTitles"
  | "automations"
  | "integrations";

/** Nome de cada aba no endereço do navegador. */
const ABAS_POR_ENDERECO: Record<string, AbaDasConfiguracoes> = {
  assinatura: "billing",
  pagamentos: "payments",
  geral: "general",
  "campos-personalizados": "customFields",
  cargos: "jobTitles",
  automacoes: "automations",
  integracoes: "integrations",
  etiquetas: "tags",
};

export function SettingsPage() {
  const graph = useTaskStore((state) => state.graph);
  const selection = useTaskStore((state) => state.selection);
  const isDarkMode = useThemeStore((state) => state.mode === "dark");
  const addTagToStore = useTaskStore((state) => state.addTag);
  const updateTagInStore = useTaskStore((state) => state.updateTag);
  const removeTagFromStore = useTaskStore((state) => state.removeTag);
  const token = useAuthStore((state) => state.token);
  const authUser = useAuthStore((state) => state.user);
  const organizationId = useAuthStore((state) => state.user?.organization?.id);

  const allTags = Object.values(graph.tags || {}).filter(
    (tag: TaskTag) =>
      organizationId &&
      (!tag.organizationId || tag.organizationId === organizationId),
  );
  const currentWorkspaceId = selection.workspaceId;
  const manageableWorkspaces = useMemo(
    () =>
      Object.values(graph.workspaces)
        .filter((workspace) =>
          hasWorkspacePermission(
            getWorkspacePermissionForWorkspace(graph, workspace.id),
            "manage",
          ),
        )
        .sort((left, right) => left.name.localeCompare(right.name, "pt-BR")),
    [graph],
  );
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(
    null,
  );
  const currentWorkspace = selectedWorkspaceId
    ? graph.workspaces[selectedWorkspaceId]
    : null;
  const workspaceCustomFields = useMemo(() => {
    if (!selectedWorkspaceId) {
      return [] as CustomFieldDefinition[];
    }

    const ids = currentWorkspace?.customFieldIds;
    if (Array.isArray(ids) && ids.length > 0) {
      return ids
        .map((id) => graph.customFieldDefinitions[id])
        .filter(Boolean)
        .sort(compareCustomFields);
    }

    return Object.values(graph.customFieldDefinitions)
      .filter((field) => field.workspaceId === selectedWorkspaceId)
      .sort(compareCustomFields);
  }, [currentWorkspace, selectedWorkspaceId, graph.customFieldDefinitions]);

  const [isInitializing, setIsInitializing] = useState(true);
  const [activeTab, setActiveTab] = useState<
    | "billing"
    | "payments"
    | "tags"
    | "general"
    | "customFields"
    | "jobTitles"
    | "automations"
    | "integrations"
  >(() => {
    if (sessionStorage.getItem("pauta_open_billing_tab")) {
      sessionStorage.removeItem("pauta_open_billing_tab");
      return "billing";
    }
    // Endereço manda: /configuracoes?aba=automacoes abre direto na aba.
    const daUrl = new URLSearchParams(window.location.search).get("aba");
    if (daUrl && ABAS_POR_ENDERECO[daUrl]) return ABAS_POR_ENDERECO[daUrl];
    // Assinatura é a primeira tela das configurações.
    return "billing";
  });

  // Mantém o endereço combinando com a aba aberta, para poder compartilhar.
  useEffect(() => {
    const slug = Object.entries(ABAS_POR_ENDERECO).find(([, aba]) => aba === activeTab)?.[0];
    if (!slug || window.location.pathname !== "/configuracoes") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("aba") === slug) return;
    params.set("aba", slug);
    window.history.replaceState({}, "", `/configuracoes?${params.toString()}`);
  }, [activeTab]);
  // Pedido vindo da faixa do topo quando já estamos em Configurações.
  useEffect(() => {
    const abrirAssinatura = () => {
      sessionStorage.removeItem("pauta_open_billing_tab");
      setActiveTab("billing");
    };

    window.addEventListener("pauta:open-billing-tab", abrirAssinatura);
    return () => window.removeEventListener("pauta:open-billing-tab", abrirAssinatura);
  }, []);

  const accountRole = useAuthStore((state) => state.user?.organization?.role);
  const canManageBilling = accountRole === "owner" || accountRole === "admin";

  const [billingData, setBillingData] =
    useState<BillingSubscriptionResponse | null>(null);
  const [isBillingLoading, setIsBillingLoading] = useState(false);
  void isBillingLoading;
  const [billingError, setBillingError] = useState<string | null>(null);
  const [isPortalLoading, setIsPortalLoading] = useState(false);
  const [isResuming, setIsResuming] = useState(false);
  // Cancelou aqui ou no portal da Stripe: a pesquisa aparece de qualquer jeito.
  const [pesquisaCancelamento, setPesquisaCancelamento] = useState(false);
  const [fluxoCancelamento, setFluxoCancelamento] = useState(false);
  const pesquisaJaMostrada = useRef(false);

  useEffect(() => {
    if (!billingData?.organization.cancellationSurveyPending || pesquisaJaMostrada.current) return;
    pesquisaJaMostrada.current = true;
    setPesquisaCancelamento(true);
  }, [billingData?.organization.cancellationSurveyPending]);

  useEffect(() => {
    const t = setTimeout(() => setIsInitializing(false), 160);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (activeTab !== "billing" || !token) {
      // Sair da aba limpa o que foi digitado em pessoas extras e pacotes.
      return;
    }

    let isMounted = true;
    setIsBillingLoading(true);
    setBillingError(null);

    axios
      .get<BillingSubscriptionResponse>("/api/billing/subscription", {
        headers: { Authorization: `Bearer ${token}` },
      })
      .then((response) => {
        if (isMounted) {
          setBillingData(response.data);
          const freshOrg = response.data?.organization;
          if (freshOrg?.plan) {
            useAuthStore.setState((state) => ({
              user: state.user
                ? {
                    ...state.user,
                    organization: state.user.organization
                      ? {
                          ...state.user.organization,
                          plan: freshOrg.plan,
                          entitlements:
                            freshOrg.entitlements ??
                            state.user.organization.entitlements,
                        }
                      : state.user.organization,
                  }
                : state.user,
            }));
          }
        }
      })
      .catch((error) => {
        console.error("Erro ao buscar assinatura", error);
        const message = axios.isAxiosError(error)
          ? error.response?.data?.message
          : null;
        if (isMounted) {
          setBillingError(
            typeof message === "string" && message.trim()
              ? message
              : "Não foi possível carregar os planos.",
          );
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsBillingLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [activeTab, token]);

  // Tag creation state
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState<string>(
    ENTITY_COLOR_OPTIONS[0],
  );
  const [isCreating, setIsCreating] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [activeTagMenuId, setActiveTagMenuId] = useState<string | null>(null);
  const [pendingTagDelete, setPendingTagDelete] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [editingTag, setEditingTag] = useState<{
    id: string;
    name: string;
    color: string;
  } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [newFieldName, setNewFieldName] = useState("");
  const [newFieldType, setNewFieldType] = useState<CustomFieldType>("text");
  const [newFieldRequired, setNewFieldRequired] = useState(false);
  const [newFieldVisibleOnDashboard, setNewFieldVisibleOnDashboard] =
    useState(false);
  const [newFieldOptionsInput, setNewFieldOptionsInput] = useState("");
  const [isCreatingField, setIsCreatingField] = useState(false);
  const [isUpdatingField, setIsUpdatingField] = useState(false);
  const [deletingFieldId, setDeletingFieldId] = useState<string | null>(null);
  const [activeFieldMenuId, setActiveFieldMenuId] = useState<string | null>(
    null,
  );
  const [fieldMenuPosition, setFieldMenuPosition] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);
  const fieldMenuButtonRefs = useRef<Record<string, HTMLButtonElement | null>>(
    {},
  );
  const [pendingFieldDelete, setPendingFieldDelete] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [editingField, setEditingField] = useState<{
    id: string;
    originalWorkspaceId: string;
    workspaceId: string;
    name: string;
    type: CustomFieldType;
    required: boolean;
    visibleOnDashboard: boolean;
    optionsInput: string;
  } | null>(null);
  const fieldMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (
      selectedWorkspaceId &&
      manageableWorkspaces.some(
        (workspace) => workspace.id === selectedWorkspaceId,
      )
    ) {
      return;
    }

    if (
      currentWorkspaceId &&
      manageableWorkspaces.some(
        (workspace) => workspace.id === currentWorkspaceId,
      )
    ) {
      setSelectedWorkspaceId(currentWorkspaceId);
      return;
    }

    setSelectedWorkspaceId(manageableWorkspaces[0]?.id ?? null);
  }, [currentWorkspaceId, manageableWorkspaces, selectedWorkspaceId]);

  useEffect(() => {
    if (!activeTagMenuId && !activeFieldMenuId) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setActiveTagMenuId(null);
      }

      if (!fieldMenuRef.current?.contains(event.target as Node)) {
        setActiveFieldMenuId(null);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [activeFieldMenuId, activeTagMenuId]);

  const handleCreateTag = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTagName.trim()) return;

    setIsCreating(true);
    try {
      const response = await axios.post(
        "/api/tags",
        { name: newTagName, color: newTagColor },
        { headers: { Authorization: `Bearer ${token}` } },
      );
      addTagToStore(response.data.tag);
      setNewTagName("");
      toast.success("Etiqueta criada.", {
        message: response.data.tag?.name || "Já pode ser usada nos cards.",
      });
    } catch (error) {
      console.error("Erro ao criar etiqueta", error);
      toast.error("Não foi possível criar a etiqueta.", {
        message: "Revise o nome e tente de novo.",
      });
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteTag = async (id: string) => {
    setDeletingId(id);
    try {
      await axios.delete(`/api/tags/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      removeTagFromStore(id);
      toast.success("Etiqueta removida.", {
        message: "Ela saiu de todos os cards e projetos.",
      });
    } catch (error) {
      console.error("Erro ao remover etiqueta", error);
      toast.error("Não foi possível remover a etiqueta.", {
        message: "A etiqueta continua no card.",
      });
    } finally {
      setDeletingId(null);
    }
  };

  const handleUpdateTag = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTag || !editingTag.name.trim()) return;

    setIsUpdating(true);
    try {
      const response = await axios.put(
        `/api/tags/${editingTag.id}`,
        { name: editingTag.name, color: editingTag.color },
        { headers: { Authorization: `Bearer ${token}` } },
      );
      updateTagInStore(response.data.tag);
      setEditingTag(null);
      toast.success("Etiqueta atualizada.", {
        message: "As mudanças valem em todos os cards.",
      });
    } catch (error) {
      console.error("Erro ao atualizar etiqueta", error);
      toast.error("Não foi possível atualizar a etiqueta.", {
        message: "As alterações não foram salvas.",
      });
    } finally {
      setIsUpdating(false);
    }
  };

  const handleResumeSubscription = async () => {
    setIsResuming(true);
    setBillingError(null);

    try {
      const response = await axios.post(
        "/api/billing/subscription/resume",
        {},
        { headers: { Authorization: `Bearer ${token}` } },
      );
      toast.success(response.data?.message || "Assinatura reativada.");
      await loadBilling();
    } catch (error) {
      const message = axios.isAxiosError(error)
        ? (error.response?.data as { message?: string })?.message
        : null;
      setBillingError(message || "Não foi possível reativar a assinatura.");
    } finally {
      setIsResuming(false);
    }
  };

  const handleOpenPortal = async () => {
    setIsPortalLoading(true);
    setBillingError(null);

    try {
      const response = await axios.post(
        "/api/billing/portal",
        {},
        { headers: { Authorization: `Bearer ${token}` } },
      );

      if (typeof response.data?.portalUrl === "string") {
        window.location.href = response.data.portalUrl;
        return;
      }

      setBillingError("Não foi possível abrir o portal de cobrança.");
    } catch (error) {
      const message = axios.isAxiosError(error)
        ? (error.response?.data as { message?: string })?.message
        : null;
      setBillingError(message || "Não foi possível abrir o portal de cobrança.");
    } finally {
      setIsPortalLoading(false);
    }
  };


  const loadBilling = useCallback(async () => {
    if (!token) return;
    setIsBillingLoading(true);

    try {
      const response = await axios.get<BillingSubscriptionResponse>(
        "/api/billing/subscription",
        { headers: { Authorization: `Bearer ${token}` } },
      );
      setBillingData(response.data);
    } catch (error) {
      console.error("Erro ao recarregar assinatura", error);
    } finally {
      setIsBillingLoading(false);
    }
  }, [token]);





  const upsertCustomFieldInStore = (
    field: CustomFieldDefinition,
    previousWorkspaceId?: EntityId | null,
  ) => {
    useTaskStore.setState((state) => {
      const targetWorkspace = state.graph.workspaces[field.workspaceId];
      if (!targetWorkspace) {
        return state;
      }

      const nextDefinitions = {
        ...state.graph.customFieldDefinitions,
        [field.id]: field,
      };
      const nextWorkspaces = { ...state.graph.workspaces };

      if (previousWorkspaceId && nextWorkspaces[previousWorkspaceId]) {
        nextWorkspaces[previousWorkspaceId] = {
          ...nextWorkspaces[previousWorkspaceId],
          customFieldIds: (
            nextWorkspaces[previousWorkspaceId].customFieldIds || []
          ).filter((id) => id !== field.id),
        };
      }

      const destinationWorkspace = nextWorkspaces[field.workspaceId];
      const nextCustomFieldIds = Array.from(
        new Set([...(destinationWorkspace.customFieldIds || []), field.id]),
      ).sort((leftId, rightId) =>
        compareCustomFields(nextDefinitions[leftId], nextDefinitions[rightId]),
      );

      const didMove =
        Boolean(previousWorkspaceId) &&
        previousWorkspaceId !== field.workspaceId;

      return {
        graph: {
          ...state.graph,
          customFieldDefinitions: nextDefinitions,
          workspaces: {
            ...nextWorkspaces,
            [field.workspaceId]: {
              ...destinationWorkspace,
              customFieldIds: nextCustomFieldIds,
            },
          },
          tasks: didMove
            ? Object.fromEntries(
                Object.entries(state.graph.tasks).map(([taskId, task]) => [
                  taskId,
                  task.workspaceId === field.workspaceId
                    ? task
                    : {
                        ...task,
                        customFieldValues: Object.fromEntries(
                          Object.entries(task.customFieldValues || {}).filter(
                            ([id]) => id !== field.id,
                          ),
                        ),
                      },
                ]),
              )
            : state.graph.tasks,
        },
      };
    });
  };

  const removeCustomFieldFromStore = (
    workspaceId: EntityId,
    fieldId: EntityId,
  ) => {
    useTaskStore.setState((state) => {
      const workspace = state.graph.workspaces[workspaceId];
      if (!workspace) {
        return state;
      }

      const nextDefinitions = { ...state.graph.customFieldDefinitions };
      delete nextDefinitions[fieldId];

      return {
        graph: {
          ...state.graph,
          customFieldDefinitions: nextDefinitions,
          workspaces: {
            ...state.graph.workspaces,
            [workspaceId]: {
              ...workspace,
              customFieldIds: (workspace.customFieldIds || []).filter(
                (id) => id !== fieldId,
              ),
            },
          },
          tasks: Object.fromEntries(
            Object.entries(state.graph.tasks).map(([taskId, task]) => [
              taskId,
              {
                ...task,
                customFieldValues: Object.fromEntries(
                  Object.entries(task.customFieldValues || {}).filter(
                    ([id]) => id !== fieldId,
                  ),
                ),
              },
            ]),
          ),
        },
      };
    });
  };

  const handleCreateCustomField = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedWorkspaceId || !currentWorkspace) return;
    if (!newFieldName.trim()) return;

    const options =
      newFieldType === "single_select"
        ? parseCustomFieldOptionsInput(newFieldOptionsInput)
        : [];

    if (newFieldType === "single_select" && options.length === 0) {
      toast.warning("Campo de seleção sem opções.", {
        message: "Informe pelo menos uma opção antes de salvar.",
      });
      return;
    }

    setIsCreatingField(true);
    try {
      const response = await axios.post(
        `/api/workspaces/${selectedWorkspaceId}/custom-fields`,
        {
          name: newFieldName.trim(),
          type: newFieldType,
          required: newFieldRequired,
          visibleOnDashboard: newFieldVisibleOnDashboard,
          options,
        },
        { headers: { Authorization: `Bearer ${token}` } },
      );

      upsertCustomFieldInStore(response.data.field);
      setNewFieldName("");
      setNewFieldType("text");
      setNewFieldRequired(false);
      setNewFieldVisibleOnDashboard(false);
      setNewFieldOptionsInput("");
      toast.success("Campo personalizado criado.", {
        message: "Já aparece nos cards deste espaço de trabalho.",
      });
    } catch (error) {
      console.error("Erro ao criar campo personalizado", error);
      toast.error("Não foi possível criar o campo personalizado.", {
        message: "Revise o nome e o tipo do campo.",
      });
    } finally {
      setIsCreatingField(false);
    }
  };

  const handleUpdateCustomField = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingField) return;
    if (!editingField.name.trim()) return;

    const options =
      editingField.type === "single_select"
        ? parseCustomFieldOptionsInput(editingField.optionsInput)
        : [];

    if (editingField.type === "single_select" && options.length === 0) {
      toast.warning("Campo de seleção sem opções.", {
        message: "Informe pelo menos uma opção antes de salvar.",
      });
      return;
    }

    setIsUpdatingField(true);
    try {
      const previousWorkspaceId = editingField.originalWorkspaceId;
      const response = await axios.put(
        `/api/workspaces/${previousWorkspaceId}/custom-fields/${editingField.id}`,
        {
          name: editingField.name.trim(),
          workspaceId: editingField.workspaceId,
          type: editingField.type,
          required: editingField.required,
          visibleOnDashboard: editingField.visibleOnDashboard,
          options,
        },
        { headers: { Authorization: `Bearer ${token}` } },
      );

      upsertCustomFieldInStore(response.data.field, previousWorkspaceId);
      setSelectedWorkspaceId(response.data.field.workspaceId);
      setEditingField(null);
      toast.success("Campo personalizado atualizado.", {
        message: "As mudanças valem nos cards do espaço de trabalho.",
      });
    } catch (error) {
      console.error("Erro ao atualizar campo personalizado", error);
      toast.error("Não foi possível atualizar o campo personalizado.", {
        message: "As alterações não foram salvas.",
      });
    } finally {
      setIsUpdatingField(false);
    }
  };

  const handleDeleteCustomField = async (fieldId: string) => {
    if (!selectedWorkspaceId) return;

    setDeletingFieldId(fieldId);
    try {
      await axios.delete(
        `/api/workspaces/${selectedWorkspaceId}/custom-fields/${fieldId}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      removeCustomFieldFromStore(selectedWorkspaceId, fieldId);
      toast.success("Campo personalizado removido.", {
        message: "Ele saiu dos cards do espaço de trabalho.",
      });
    } catch (error) {
      console.error("Erro ao remover campo personalizado", error);
      toast.error("Não foi possível remover o campo personalizado.", {
        message: "O campo continua no espaço de trabalho.",
      });
    } finally {
      setDeletingFieldId(null);
    }
  };

  if (isInitializing) {
    return (
      <div className="flex min-h-0 w-full flex-1 flex-col animate-in fade-in duration-200">
        <div className="flex-1 overflow-auto pauta-scroll-safe min-w-0 px-4 pt-4 pb-8 sm:px-8 sm:pt-8 sm:pb-16">
          <Skeleton className="mb-8 h-8 w-40 rounded-full" />

          <div
            className={cn(
              "mb-8 flex gap-1 border-b",
              "border-(--ui-borda)",
            )}
          >
            <Skeleton className="h-9 w-16 rounded-t-lg" />
            <Skeleton className="h-9 w-40 rounded-t-lg" />
            <Skeleton className="h-9 w-44 rounded-t-lg" />
          </div>

          <div
            className={cn(
              "mb-8 rounded-2xl border p-6",
              "border-(--ui-borda) bg-(--ui-superficie)",
            )}
          >
            <div className="mb-6 flex items-start gap-4">
              <Skeleton className="h-12 w-12 rounded-xl" />
              <div className="space-y-2">
                <Skeleton className="h-5 w-52 rounded-full" />
                <Skeleton className="h-4 w-80 rounded-full" />
              </div>
            </div>
            <div
              className={cn(
                "flex gap-4 rounded-xl border p-4",
                "border-(--ui-borda)",
              )}
            >
              <Skeleton className="h-11 flex-1 rounded-xl" />
              <Skeleton className="h-11 w-48 rounded-xl" />
              <Skeleton className="h-11 w-28 rounded-xl" />
            </div>
          </div>

          <div
            className={cn(
              "overflow-hidden rounded-2xl border",
              "border-(--ui-borda) bg-(--ui-superficie)",
            )}
          >
            <div
              className={cn(
                "flex items-center justify-between border-b px-6 py-4",
                "border-(--ui-borda-suave)",
              )}
            >
              <Skeleton className="h-4 w-36 rounded-full" />
              <Skeleton className="h-6 w-8 rounded-full" />
            </div>
            <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
              {[...Array(6)].map((_, i) => (
                <div
                  key={i}
                  className={cn(
                    "rounded-xl border p-3",
                    "border-(--ui-borda) bg-(--ui-superficie-suave)",
                  )}
                >
                  <div className="mb-3 flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <Skeleton className="h-9 w-9 rounded-xl" />
                      <div className="space-y-2">
                        <Skeleton className="h-3.5 w-22 rounded-full" />
                        <Skeleton className="h-3 w-14 rounded-full" />
                      </div>
                    </div>
                    <Skeleton className="h-8 w-8 rounded-lg" />
                  </div>
                  <Skeleton className="mb-2 h-5 w-16 rounded-full" />
                  <div className="flex gap-1.5">
                    <Skeleton className="h-5 w-14 rounded-full" />
                    <Skeleton className="h-5 w-10 rounded-full" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col animate-in fade-in duration-300">
      <div className="flex-1 overflow-auto w-full pauta-scroll-safe min-w-0 px-4 pt-4 pb-8 sm:px-8 sm:pt-8 sm:pb-16">
        <h1
          className={cn(
            "mb-8 text-2xl font-black tracking-tight",
            "text-(--ui-texto-principal)",
          )}
        >
          Configurações
        </h1>

        {/* Tabs */}
        <div
          className={cn(
            "mb-8 flex flex-wrap gap-x-2 border-b",
            "border-(--ui-borda)",
          )}
        >
          <button
            onClick={() => setActiveTab("billing")}
            className={`px-4 py-2 font-bold text-sm border-b-2 transition-colors cursor-pointer ${
              activeTab === "billing"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-(--ui-texto-secundario) hover:text-(--ui-texto-principal)"
            }`}
          >
            Assinatura
          </button>
          {canManageBilling && (
          <button
            onClick={() => setActiveTab("payments")}
            className={`px-4 py-2 font-bold text-sm border-b-2 transition-colors cursor-pointer ${
              activeTab === "payments"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-(--ui-texto-secundario) hover:text-(--ui-texto-principal)"
            }`}
          >
            Pagamentos
          </button>
          )}
          <button
            onClick={() => setActiveTab("general")}
            className={`px-4 py-2 font-bold text-sm border-b-2 transition-colors cursor-pointer ${
              activeTab === "general"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-(--ui-texto-secundario) hover:text-(--ui-texto-principal)"
            }`}
          >
            Geral
          </button>
          <button
            onClick={() => setActiveTab("customFields")}
            className={`px-4 py-2 font-bold text-sm border-b-2 transition-colors cursor-pointer ${
              activeTab === "customFields"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-(--ui-texto-secundario) hover:text-(--ui-texto-principal)"
            }`}
          >
            Campos personalizados
          </button>
          <button
            onClick={() => setActiveTab("jobTitles")}
            className={`px-4 py-2 font-bold text-sm border-b-2 transition-colors cursor-pointer ${
              activeTab === "jobTitles"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-(--ui-texto-secundario) hover:text-(--ui-texto-principal)"
            }`}
          >
            Cargos
          </button>
          <button
            onClick={() => setActiveTab("automations")}
            className={`px-4 py-2 font-bold text-sm border-b-2 transition-colors cursor-pointer ${
              activeTab === "automations"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-(--ui-texto-secundario) hover:text-(--ui-texto-principal)"
            }`}
          >
            Automações
          </button>
          {canManageBilling && (
            <button
              onClick={() => setActiveTab("integrations")}
              className={`px-4 py-2 font-bold text-sm border-b-2 transition-colors cursor-pointer ${
                activeTab === "integrations"
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-(--ui-texto-secundario) hover:text-(--ui-texto-principal)"
              }`}
            >
              Integrações
            </button>
          )}
          <button
            onClick={() => setActiveTab("tags")}
            className={`px-4 py-2 font-bold text-sm border-b-2 transition-colors cursor-pointer ${
              activeTab === "tags"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-(--ui-texto-secundario) hover:text-(--ui-texto-principal)"
            }`}
          >
            Etiquetas Globais
          </button>
        </div>

        {/* Content */}
        {activeTab === "billing" && (
          <div className="animate-in fade-in slide-in-from-bottom-2">
            <div
              className={cn(
                "mb-8 rounded-2xl border p-6",
                "border-(--ui-borda) bg-(--ui-superficie)",
              )}
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex items-start gap-4">
                  <div
                    className={cn(
                      "rounded-xl p-3",
                      "bg-(--ui-azul-fundo) text-(--ui-azul-texto)",
                    )}
                  >
                    <CreditCard className="h-6 w-6" />
                  </div>
                  <div>
                    <h2
                      className={cn(
                        "text-lg font-bold",
                        "text-(--ui-texto-principal)",
                      )}
                    >
                      Assinatura e planos
                    </h2>
                    <p
                      className={cn(
                        "text-sm font-medium",
                        "text-(--ui-texto-secundario)",
                      )}
                    >
                      Gerencie o plano da organização e veja os limites de uso.
                    </p>
                  </div>
                </div>

                <div
                  className={cn(
                    "rounded-xl border px-4 py-3 text-sm font-bold",
                    "border-(--ui-borda) bg-(--ui-fundo-sutil) text-(--ui-texto-forte)",
                  )}
                >
                  Plano atual:{" "}
                  <span className="text-blue-600 capitalize">
                    {billingData?.organization.planName ||
                      billingData?.organization.plan ||
                      authUser?.organization?.plan ||
                      "Grátis"}
                  </span>
                  {billingData?.organization.trial?.active && (
                    <span className="ml-2 rounded-full bg-blue-600/10 px-2 py-0.5 text-[11px] font-black text-blue-600">
                      Teste grátis · {billingData.organization.trial.daysLeft} dia(s)
                    </span>
                  )}
                  {billingData?.organization.billingExempt && (
                    <span className="ml-2 rounded-full bg-emerald-600/10 px-2 py-0.5 text-[11px] font-black text-emerald-600">
                      Conta interna
                    </span>
                  )}
                </div>
              </div>

              {billingData?.organization && (
                <div
                  className={cn(
                    "mt-6 rounded-2xl border p-5",
                    "border-(--ui-borda) bg-(--ui-superficie)",
                  )}
                >
                  <h3
                    className={cn(
                      "mb-4 text-sm font-black",
                      "text-(--ui-texto-principal)",
                    )}
                  >
                    Uso atual do plano
                  </h3>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    {[
                      {
                        label: "Pessoas",
                        used: billingData.organization.usage?.users ?? 0,
                        max: billingData.organization.entitlements.seats,
                      },
                      {
                        label: "Workspaces",
                        used: billingData.organization.usage?.workspaces ?? 0,
                        max: billingData.organization.entitlements
                          .maxWorkspaces,
                      },
                      {
                        label: "Projetos",
                        used: billingData.organization.usage?.projects ?? 0,
                        max: billingData.organization.entitlements.maxProjects,
                      },
                      {
                        label: "Armazenamento",
                        used:
                          billingData.organization.usage?.storageMb ?? null,
                        max: billingData.organization.entitlements.maxStorageMb,
                        isStorage: true,
                      },
                    ].map((item) => {
                      const isUnlimited = item.max === -1;
                      const pct =
                        !isUnlimited && item.used !== null && item.max > 0
                          ? Math.min((item.used / item.max) * 100, 100)
                          : 0;
                      const isNearLimit = pct >= 80;

                      const maxLabel = item.isStorage
                        ? isUnlimited
                          ? "Ilimitado"
                          : item.max >= 1024
                            ? `${item.max / 1024} GB`
                            : `${item.max} MB`
                        : isUnlimited
                          ? "Ilimitado"
                          : String(item.max);

                      return (
                        <div key={item.label}>
                          <div className="mb-1.5 flex items-center justify-between">
                            <span
                              className={cn(
                                "text-xs font-bold",
                                "text-(--ui-texto-secundario)",
                              )}
                            >
                              {item.label}
                            </span>
                            <span
                              className={cn(
                                "text-xs font-black",
                                isNearLimit && !isUnlimited
                                  ? "text-amber-500"
                                  : "text-(--ui-texto-secundario)",
                              )}
                            >
                              {item.isStorage
                                ? item.used !== null
                                  ? `${formatStorageMb(item.used)} / ${maxLabel}`
                                  : maxLabel
                                : item.used !== null
                                  ? isUnlimited
                                    ? `${item.used} / ∞`
                                    : `${item.used} / ${item.max}`
                                  : maxLabel}
                            </span>
                          </div>
                          <div
                            className={cn(
                              "h-1.5 w-full overflow-hidden rounded-full",
                              "bg-(--ui-fundo-neutro)",
                            )}
                          >
                            <div
                              className={cn(
                                "h-full rounded-full transition-all",
                                isUnlimited
                                  ? "w-full bg-blue-500/30"
                                  : isNearLimit
                                    ? "bg-amber-500"
                                    : "bg-blue-600",
                              )}
                              style={isUnlimited ? {} : { width: `${pct}%` }}
                            />
                          </div>
                          {isUnlimited && (
                            <p
                              className={cn(
                                "mt-1 text-[10px] font-bold",
                                "text-(--ui-texto-secundario)",
                              )}
                            >
                              Ilimitado
                            </p>
                          )}
                        </div>
                      );
                    })}
                    <div>
                      <div className="mb-1.5 flex items-center justify-between">
                        <span
                          className={cn(
                            "text-xs font-bold",
                            "text-(--ui-texto-secundario)",
                          )}
                        >
                          Recursos avançados
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {[
                          {
                            label: "Campos personalizados",
                            enabled:
                              billingData.organization.entitlements
                                .customFields,
                          },
                          {
                            label: "Relatórios",
                            enabled:
                              billingData.organization.entitlements
                                .advancedReports,
                          },
                          {
                            label: "Automações",
                            enabled:
                              billingData.organization.entitlements.automations,
                          },
                        ].map((feat) => (
                          <span
                            key={feat.label}
                            className={cn(
                              "rounded-full px-2 py-0.5 text-[10px] font-black",
                              feat.enabled
                                ? "bg-blue-600/10 text-blue-600"
                                : "bg-(--ui-fundo-neutro) text-(--ui-texto-secundario)",
                            )}
                          >
                            {feat.enabled ? "✓" : "✗"} {feat.label}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {pesquisaCancelamento && (
                <CancellationSurveyModal onClose={() => setPesquisaCancelamento(false)} />
              )}

              {billingData?.organization.discount && (
                <div
                  className={cn(
                    "mt-5 rounded-xl border px-4 py-3",
                    "border-(--ui-verde-borda) bg-(--ui-verde-fundo)",
                  )}
                >
                  <p className={cn("text-[13px] font-bold", "text-(--ui-verde-texto)")}>
                    {billingData.organization.discount.percentOff
                      ? `Desconto de ${billingData.organization.discount.percentOff}% valendo na sua assinatura`
                      : "Desconto valendo na sua assinatura"}
                  </p>
                  <p className={cn("mt-1 text-[13px] font-medium", "text-(--ui-verde-texto)")}>
                    {billingData.organization.discount.nextAmountCents !== null && (
                      <>
                        Próxima fatura:{" "}
                        <strong>{formatBrl(billingData.organization.discount.nextAmountCents)}</strong>
                        {billingData.organization.discount.nextInvoiceAt
                          ? ` em ${formatIsoDate(billingData.organization.discount.nextInvoiceAt)}`
                          : ""}
                        .{" "}
                      </>
                    )}
                    {billingData.organization.discount.months
                      ? `O desconto vale por ${billingData.organization.discount.months} ${
                          billingData.organization.discount.months === 1 ? "mês" : "meses"
                        }`
                      : "O desconto segue ativo"}
                    {billingData.organization.discount.endsAt
                      ? `, até ${formatIsoDate(billingData.organization.discount.endsAt)}`
                      : ""}
                    . Depois disso o valor volta ao normal do plano.
                  </p>
                </div>
              )}

              {billingData?.organization.cancelAtPeriodEnd && (
                <p
                  className={cn(
                    "mt-5 rounded-xl px-4 py-3 text-[13px] font-bold",
                    "bg-(--ui-ambar-fundo) text-(--ui-ambar-texto)",
                  )}
                >
                  Assinatura cancelada. Você continua no plano{" "}
                  {billingData.organization.planName} até{" "}
                  {formatIsoDate(billingData.organization.periodEnd) || "o fim do período pago"} —
                  depois disso a conta volta para o Grátis. Nada é apagado.
                  <button
                    type="button"
                    onClick={() => void handleResumeSubscription()}
                    disabled={isResuming}
                    className="ml-2 inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1 text-[11px] font-black text-white transition-colors hover:bg-blue-700 cursor-pointer disabled:opacity-60"
                  >
                    {isResuming && <Loader2 className="h-3 w-3 animate-spin" />}
                    Reativar assinatura
                  </button>
                </p>
              )}

              {billingData?.organization.pendingChange?.at && (
                <p
                  className={cn(
                    "mt-3 text-[12px] font-bold",
                    "text-(--ui-texto-secundario)",
                  )}
                >
                  Redução contratada: a partir de{" "}
                  {formatIsoDate(billingData.organization.pendingChange.at) || "o próximo ciclo"} a
                  conta passa a ter{" "}
                  {billingData.organization.pendingChange.extraSeats ??
                    billingData.organization.extraSeats}{" "}
                  pessoa(s) extra(s) e{" "}
                  {billingData.organization.pendingChange.extraStoragePacks ??
                    billingData.organization.extraStoragePacks}{" "}
                  pacote(s) de 100 GB. Até lá, você usa o que já pagou.
                </p>
              )}

              {billingData?.organization.stripeCustomerId && (
                <button
                  type="button"
                  onClick={() => void handleOpenPortal()}
                  disabled={isPortalLoading}
                  className={cn(
                    "mt-5 inline-flex h-10 items-center gap-2 rounded-xl border px-4 text-sm font-bold transition-colors cursor-pointer disabled:opacity-60",
                    "border-(--ui-borda) text-(--ui-texto-item) hover:bg-(--ui-hover)",
                  )}
                >
                  {isPortalLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                  Abrir o portal de pagamento (faturas e cartão)
                </button>
              )}

              {billingData?.organization.stripeSubscriptionId && !billingData.organization.cancelAtPeriodEnd && (
                <>
                  <button
                    type="button"
                    onClick={() => setFluxoCancelamento(true)}
                    className={cn(
                      "ml-0 mt-3 inline-flex h-10 items-center justify-center rounded-xl border px-4 text-sm font-bold transition-colors cursor-pointer sm:ml-2 sm:mt-0",
                      "border-(--ui-rose-borda) text-(--ui-rose-texto) hover:bg-(--ui-rose-fundo)",
                    )}
                  >
                    Cancelar assinatura
                  </button>
                  <p className={cn("mt-2 text-[12px] font-medium", "text-(--ui-texto-secundario)")}>
                    O portal é a página da Stripe, com as faturas e o cartão. O cancelamento feito aqui no Pauta
                    mantém o acesso até o fim do período já pago.
                  </p>
                </>
              )}

              {fluxoCancelamento && (
                <CancelFlowModal onClose={() => setFluxoCancelamento(false)} onFinished={loadBilling} />
              )}

              <PlanCatalog
                subscription={
                  billingData as unknown as PlanSubscriptionSummary | null
                }
                onChanged={() => void loadBilling()}
              />
            </div>

            {billingError && (
              <div
                className={cn(
                  "mt-6 rounded-2xl border px-4 py-3 text-sm font-bold",
                  "border-(--ui-ambar-borda) bg-(--ui-ambar-fundo) text-(--ui-ambar-texto)",
                )}
              >
                {billingError}
              </div>
            )}
          </div>
        )}

        {activeTab === "payments" && canManageBilling && <PaymentsPage />}

        {activeTab === "tags" && (
          <div className="animate-in fade-in slide-in-from-bottom-2">
            <div
              className={cn(
                "mb-8 rounded-2xl border p-6",
                "border-(--ui-borda) bg-(--ui-superficie)",
              )}
            >
              <div className="flex items-start gap-4 mb-6">
                <div
                  className={cn(
                    "rounded-xl p-3",
                    "bg-(--ui-azul-fundo) text-(--ui-azul-texto)",
                  )}
                >
                  <TagIcon className="h-6 w-6" />
                </div>
                <div>
                  <h2
                    className={cn(
                      "text-lg font-bold",
                      "text-(--ui-texto-principal)",
                    )}
                  >
                    Gerenciador de Etiquetas
                  </h2>
                  <p
                    className={cn(
                      "text-sm font-medium",
                      "text-(--ui-texto-secundario)",
                    )}
                  >
                    As etiquetas criadas aqui estarão disponíveis para todos os
                    espaços de trabalho e projetos da organização.
                  </p>
                </div>
              </div>

              <form
                onSubmit={handleCreateTag}
                className={cn(
                  "flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:gap-4",
                  "border-(--ui-borda) bg-(--ui-fundo-sutil)",
                )}
              >
                <div className="flex-1 min-w-0">
                  <Input
                    placeholder="Nome da etiqueta..."
                    value={newTagName}
                    onChange={(e) => setNewTagName(e.target.value)}
                    className={cn(
                      "h-11",
                      "bg-(--ui-superficie)",
                    )}
                    required
                  />
                </div>
                <div
                  className={cn(
                    "flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 sm:py-0",
                    "border-(--ui-borda) bg-(--ui-superficie)",
                  )}
                >
                  {ENTITY_COLOR_OPTIONS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setNewTagColor(color)}
                      className={`w-6 h-6 rounded-full cursor-pointer transition-transform ${newTagColor === color ? "scale-125 ring-2 ring-blue-500" : "hover:scale-110"} ${"ring-offset-(--ui-superficie)"}`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
                <button
                  type="submit"
                  disabled={isCreating || !newTagName.trim()}
                  className={cn(
                    "bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-6 h-11 rounded-xl font-bold flex items-center justify-center gap-2 cursor-pointer transition-colors shrink-0",
                    isDarkMode && "shadow-sm",
                  )}
                >
                  {isCreating ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                  Adicionar
                </button>
              </form>
            </div>

            <div
              className={cn(
                "overflow-hidden rounded-2xl border",
                "border-(--ui-borda) bg-(--ui-superficie)",
              )}
            >
              <div
                className={cn(
                  "flex items-center justify-between border-b px-6 py-4",
                  "border-(--ui-borda-suave) bg-(--ui-fundo-sutil)",
                )}
              >
                <h3
                  className={cn(
                    "text-sm font-bold",
                    "text-(--ui-texto-principal)",
                  )}
                >
                  Etiquetas Cadastradas
                </h3>
                <span
                  className={cn(
                    "rounded px-2 py-1 text-xs font-bold",
                    "bg-(--ui-azul-fundo) text-(--ui-azul-texto)",
                  )}
                >
                  {allTags.length}
                </span>
              </div>

              {allTags.length === 0 ? (
                <div
                  className={cn(
                    "flex flex-col items-center p-12 text-center",
                    "text-(--ui-texto-secundario)",
                  )}
                >
                  <Info
                    className={cn(
                      "mb-3 h-8 w-8",
                      "text-(--ui-texto-apagado)",
                    )}
                  />
                  <p className="font-medium text-sm">
                    Nenhuma etiqueta global cadastrada ainda.
                  </p>
                </div>
              ) : (
                <ul className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
                  {allTags.map((tag) => (
                    <li
                      key={tag.id}
                      className={cn(
                        "group rounded-xl border p-3 transition-all hover:-translate-y-1",
                        "border-(--ui-borda) bg-(--ui-superficie)",
                      )}
                    >
                      <div className="mb-3 flex items-start justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <span
                            className="h-3.5 w-3.5 shrink-0 rounded-full"
                            style={{ backgroundColor: tag.color }}
                          />
                          <div className="min-w-0">
                            <p
                              className={cn(
                                "truncate text-[13px] font-bold",
                                "text-(--ui-texto-principal)",
                              )}
                            >
                              {tag.name}
                            </p>
                            <p
                              className={cn(
                                "mt-0.5 text-[10px] font-medium uppercase tracking-wide",
                                "text-(--ui-texto-secundario)",
                              )}
                            >
                              Etiqueta global
                            </p>
                          </div>
                        </div>

                        <div
                          className="relative"
                          ref={activeTagMenuId === tag.id ? menuRef : undefined}
                        >
                          <button
                            type="button"
                            onClick={() =>
                              setActiveTagMenuId((current) =>
                                current === tag.id ? null : tag.id,
                              )
                            }
                            className={cn(
                              "flex shrink-0 items-center justify-center p-1 transition-colors cursor-pointer",
                              "text-(--ui-texto-secundario) hover:text-(--ui-texto-forte)",
                            )}
                            aria-label={`Ações da etiqueta ${tag.name}`}
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </button>

                          {activeTagMenuId === tag.id && (
                            <div
                              className={cn(
                                "absolute right-0 top-[calc(100%+8px)] z-20 w-36 rounded-xl border p-1.5",
                                isDarkMode && "shadow-xl",
                                "pauta-theme-menu",
                              )}
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingTag({
                                    id: tag.id,
                                    name: tag.name,
                                    color: tag.color,
                                  });
                                  setActiveTagMenuId(null);
                                }}
                                className={cn(
                                  "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[12px] font-bold transition-colors cursor-pointer",
                                  "text-(--ui-texto-forte) hover:bg-(--ui-hover)",
                                )}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                                Editar
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setPendingTagDelete({
                                    id: tag.id,
                                    name: tag.name,
                                  });
                                  setActiveTagMenuId(null);
                                }}
                                disabled={deletingId === tag.id}
                                className={cn(
                                  "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[12px] font-bold transition-colors disabled:opacity-50 cursor-pointer",
                                  "text-(--ui-rose-texto) hover:bg-(--ui-rose-fundo)",
                                )}
                              >
                                {deletingId === tag.id ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Trash2 className="h-3.5 w-3.5" />
                                )}
                                Excluir
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                      <div>
                        <span
                          className="inline-flex rounded-full px-2 py-0.5 text-[10px] font-black text-white"
                          style={{ backgroundColor: tag.color }}
                        >
                          Preview
                        </span>
                        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                          <span
                            className={cn(
                              "rounded-full px-2 py-0.5 text-[10px] font-bold",
                              "bg-(--ui-fundo-neutro) text-(--ui-texto-secundario)",
                            )}
                          >
                            {tag.color}
                          </span>
                          <span
                            className={cn(
                              "rounded-full px-2 py-0.5 text-[10px] font-bold max-w-full truncate",
                              "bg-(--ui-fundo-neutro) text-(--ui-texto-secundario)",
                            )}
                          >
                            {tag.id}
                          </span>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {activeTab === "customFields" && (
          <div className="animate-in fade-in slide-in-from-bottom-2">
            {manageableWorkspaces.length === 0 ? (
              <div
                className={cn(
                  "rounded-2xl border p-12 text-center",
                  "border-(--ui-borda) bg-(--ui-superficie)",
                )}
              >
                <h2
                  className={cn(
                    "text-lg font-bold",
                    "text-(--ui-texto-principal)",
                  )}
                >
                  Selecione um espaço de trabalho
                </h2>
                <p
                  className={cn(
                    "mt-2 text-sm",
                    "text-(--ui-texto-secundario)",
                  )}
                >
                  Você não possui permissão de gestão em nenhum espaço de trabalho para
                  cadastrar campos personalizados.
                </p>
              </div>
            ) : !currentWorkspace ? (
              <div
                className={cn(
                  "rounded-2xl border p-12 text-center",
                  "border-(--ui-borda) bg-(--ui-superficie)",
                )}
              >
                <h2
                  className={cn(
                    "text-lg font-bold",
                    "text-(--ui-texto-principal)",
                  )}
                >
                  Sem permissão para gerenciar
                </h2>
                <p
                  className={cn(
                    "mt-2 text-sm",
                    "text-(--ui-texto-secundario)",
                  )}
                >
                  Selecione um espaço de trabalho para gerenciar os campos personalizados
                  vinculados a ele.
                </p>
              </div>
            ) : (
              <>
                <div
                  className={cn(
                    "mb-8 rounded-2xl border p-6",
                    "border-(--ui-borda) bg-(--ui-superficie)",
                  )}
                >
                  <div className="mb-6 flex items-start gap-4">
                    <div
                      className={cn(
                        "rounded-xl p-3",
                        "bg-(--ui-azul-fundo) text-(--ui-azul-texto)",
                      )}
                    >
                      <Info className="h-6 w-6" />
                    </div>
                    <div>
                      <h2
                        className={cn(
                          "text-lg font-bold",
                          "text-(--ui-texto-principal)",
                        )}
                      >
                        Campos personalizados de {currentWorkspace.name}
                      </h2>
                      <p
                        className={cn(
                          "text-sm font-medium",
                          "text-(--ui-texto-secundario)",
                        )}
                      >
                        Esses campos serão exibidos apenas nas tarefas deste
                        espaço de trabalho e, quando marcado, também poderão
                        alimentar o dashboard do admin na próxima fase.
                      </p>
                    </div>
                  </div>

                  <form
                    onSubmit={handleCreateCustomField}
                    className={cn(
                      "space-y-4 rounded-xl border p-4",
                      "border-(--ui-borda) bg-(--ui-fundo-sutil)",
                    )}
                  >
                    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,0.8fr)]">
                      <div className="space-y-2 lg:col-span-2">
                        <label
                          className={cn(
                            "text-[11px] font-bold uppercase tracking-widest",
                            "text-(--ui-texto-secundario)",
                          )}
                        >
                          Espaço de trabalho vinculado
                        </label>
                        <SettingsSelect
                          value={selectedWorkspaceId || ""}
                          onChange={(value) => setSelectedWorkspaceId(value)}
                          options={manageableWorkspaces.map((workspace) => ({
                            value: workspace.id,
                            label: workspace.name,
                            description: `Os campos criados aqui aparecerão apenas em ${workspace.name}.`,
                          }))}
                        />
                        <p
                          className={cn(
                            "text-xs font-medium",
                            "text-(--ui-texto-secundario)",
                          )}
                        >
                          O campo será exibido somente nos cards do espaço de trabalho
                          selecionado acima.
                        </p>
                      </div>

                      <div className="space-y-2">
                        <label
                          className={cn(
                            "text-[11px] font-bold uppercase tracking-widest",
                            "text-(--ui-texto-secundario)",
                          )}
                        >
                          Nome do campo
                        </label>
                        <Input
                          placeholder="Ex.: Canal, Cliente, Centro de custo"
                          value={newFieldName}
                          onChange={(e) => setNewFieldName(e.target.value)}
                          className={cn(
                            "h-11",
                            "bg-(--ui-superficie)",
                          )}
                          required
                        />
                      </div>

                      <div className="space-y-2">
                        <label
                          className={cn(
                            "text-[11px] font-bold uppercase tracking-widest",
                            "text-(--ui-texto-secundario)",
                          )}
                        >
                          Tipo
                        </label>
                        <SettingsSelect
                          value={newFieldType}
                          onChange={(value) =>
                            setNewFieldType(value as CustomFieldType)
                          }
                          options={CUSTOM_FIELD_TYPE_OPTIONS.map((item) => ({
                            value: item.value,
                            label: item.label,
                          }))}
                        />
                      </div>
                    </div>

                    {newFieldType === "single_select" && (
                      <div className="space-y-2">
                        <label
                          className={cn(
                            "text-[11px] font-bold uppercase tracking-widest",
                            "text-(--ui-texto-secundario)",
                          )}
                        >
                          Opções
                        </label>
                        <textarea
                          value={newFieldOptionsInput}
                          onChange={(e) =>
                            setNewFieldOptionsInput(e.target.value)
                          }
                          rows={4}
                          placeholder="Uma opção por linha ou separadas por vírgula"
                          className={cn(
                            "w-full rounded-xl border px-3 py-3 text-sm outline-none transition",
                            "border-(--ui-borda) bg-(--ui-superficie) text-(--ui-texto-forte) placeholder:text-(--ui-texto-secundario)",
                          )}
                        />
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-5">
                      <SettingsCheckbox
                        checked={newFieldRequired}
                        onChange={setNewFieldRequired}
                        label="Obrigatório"
                      />

                      <SettingsCheckbox
                        checked={newFieldVisibleOnDashboard}
                        onChange={setNewFieldVisibleOnDashboard}
                        label="Elegível para dashboard"
                      />
                    </div>

                    <div className="flex justify-end">
                      <button
                        type="submit"
                        disabled={isCreatingField || !newFieldName.trim()}
                        className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-6 h-11 rounded-xl font-bold flex items-center justify-center gap-2 cursor-pointer transition-colors"
                      >
                        {isCreatingField ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Plus className="h-4 w-4" />
                        )}
                        Adicionar campo
                      </button>
                    </div>
                  </form>
                </div>

                <div
                  className={cn(
                    "overflow-hidden rounded-2xl border",
                    "border-(--ui-borda) bg-(--ui-superficie)",
                  )}
                >
                  <div
                    className={cn(
                      "flex items-center justify-between border-b px-6 py-4",
                      "border-(--ui-borda-suave) bg-(--ui-fundo-sutil)",
                    )}
                  >
                    <h3
                      className={cn(
                        "text-sm font-bold",
                        "text-(--ui-texto-principal)",
                      )}
                    >
                      Campos cadastrados em {currentWorkspace.name}
                    </h3>
                    <span
                      className={cn(
                        "rounded px-2 py-1 text-xs font-bold",
                        "bg-(--ui-azul-fundo) text-(--ui-azul-texto)",
                      )}
                    >
                      {workspaceCustomFields.length}
                    </span>
                  </div>

                  {workspaceCustomFields.length === 0 ? (
                    <div
                      className={cn(
                        "flex flex-col items-center p-12 text-center",
                        "text-(--ui-texto-secundario)",
                      )}
                    >
                      <Info
                        className={cn(
                          "mb-3 h-8 w-8",
                          "text-(--ui-texto-apagado)",
                        )}
                      />
                      <p className="font-medium text-sm">
                        Nenhum campo personalizado cadastrado ainda.
                      </p>
                    </div>
                  ) : (
                    <ul className="grid grid-cols-1 gap-3 p-4 lg:grid-cols-3">
                      {workspaceCustomFields.map((field) => (
                        <li
                          key={field.id}
                          className={cn(
                            "group rounded-xl border p-4 transition-all hover:-translate-y-1",
                            "border-(--ui-borda) bg-(--ui-superficie)",
                          )}
                        >
                          <div className="mb-3 flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p
                                className={cn(
                                  "truncate text-[14px] font-bold",
                                  "text-(--ui-texto-principal)",
                                )}
                              >
                                {field.name}
                              </p>
                              <p
                                className={cn(
                                  "mt-0.5 text-[11px] font-medium",
                                  "text-(--ui-texto-secundario)",
                                )}
                              >
                                {getCustomFieldTypeLabel(field.type)}
                              </p>
                            </div>

                            <div className="relative">
                              <button
                                type="button"
                                onClick={() => {
                                  if (activeFieldMenuId === field.id) {
                                    setActiveFieldMenuId(null);
                                    setFieldMenuPosition(null);
                                  } else {
                                    setActiveFieldMenuId(field.id);
                                    // Calcula posição absoluta do botão
                                    const btn =
                                      fieldMenuButtonRefs.current[field.id];
                                    if (btn) {
                                      const rect = btn.getBoundingClientRect();
                                      setFieldMenuPosition({
                                        top: rect.bottom + window.scrollY + 8,
                                        left: rect.left + window.scrollX,
                                        width: rect.width,
                                      });
                                    }
                                  }
                                }}
                                className={cn(
                                  "flex shrink-0 items-center justify-center p-1 transition-colors cursor-pointer",
                                  "text-(--ui-texto-secundario) hover:text-(--ui-texto-forte)",
                                )}
                                aria-label={`Ações do campo ${field.name}`}
                                ref={(el: HTMLButtonElement | null) => {
                                  fieldMenuButtonRefs.current[field.id] = el;
                                }}
                              >
                                <MoreHorizontal className="h-4 w-4" />
                              </button>
                            </div>
                            {activeFieldMenuId === field.id && fieldMenuPosition
                              ? createPortal(
                                  <div
                                    ref={fieldMenuRef}
                                    style={{
                                      position: "absolute",
                                      top: fieldMenuPosition.top,
                                      left: fieldMenuPosition.left,
                                      minWidth: 160,
                                      zIndex: 9999,
                                    }}
                                    className={cn(
                                      "w-40 rounded-xl border p-1.5 shadow-xl",
                                      "pauta-theme-menu border-(--ui-borda) bg-(--ui-superficie)",
                                    )}
                                  >
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setEditingField({
                                          id: field.id,
                                          originalWorkspaceId:
                                            field.workspaceId,
                                          workspaceId: field.workspaceId,
                                          name: field.name,
                                          type: field.type,
                                          required: field.required,
                                          visibleOnDashboard:
                                            field.visibleOnDashboard,
                                          optionsInput:
                                            stringifyCustomFieldOptions(
                                              field.options,
                                            ),
                                        });
                                        setActiveFieldMenuId(null);
                                        setFieldMenuPosition(null);
                                      }}
                                      className={cn(
                                        "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[12px] font-bold transition-colors cursor-pointer",
                                        "text-(--ui-texto-forte) hover:bg-(--ui-hover)",
                                      )}
                                    >
                                      <Pencil className="h-3.5 w-3.5" />
                                      Editar
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setPendingFieldDelete({
                                          id: field.id,
                                          name: field.name,
                                        });
                                        setActiveFieldMenuId(null);
                                        setFieldMenuPosition(null);
                                      }}
                                      disabled={deletingFieldId === field.id}
                                      className={cn(
                                        "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[12px] font-bold transition-colors disabled:opacity-50 cursor-pointer",
                                        "text-(--ui-rose-texto) hover:bg-(--ui-rose-fundo)",
                                      )}
                                    >
                                      {deletingFieldId === field.id ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                      ) : (
                                        <Trash2 className="h-3.5 w-3.5" />
                                      )}
                                      Excluir
                                    </button>
                                  </div>,
                                  document.body,
                                )
                              : null}
                          </div>

                          <div className="flex flex-wrap gap-1.5">
                            <span
                              className={cn(
                                "rounded-full px-2 py-0.5 text-[10px] font-bold",
                                "bg-(--ui-fundo-neutro) text-(--ui-texto-secundario)",
                              )}
                            >
                              {getCustomFieldTypeLabel(field.type)}
                            </span>
                            {field.required && (
                              <span
                                className={cn(
                                  "rounded-full px-2 py-0.5 text-[10px] font-bold",
                                  "bg-(--ui-ambar-fundo) text-(--ui-ambar-texto)",
                                )}
                              >
                                Obrigatório
                              </span>
                            )}
                            {field.visibleOnDashboard && (
                              <span
                                className={cn(
                                  "rounded-full px-2 py-0.5 text-[10px] font-bold",
                                  "bg-(--ui-azul-fundo) text-(--ui-azul-texto)",
                                )}
                              >
                                Dashboard
                              </span>
                            )}
                          </div>

                          {field.type === "single_select" &&
                            field.options.length > 0 && (
                              <div className="mt-3 flex flex-wrap gap-1.5">
                                {field.options.map((option) => (
                                  <span
                                    key={option.id}
                                    className={cn(
                                      "rounded-full px-2 py-0.5 text-[10px] font-bold",
                                      "bg-(--ui-fundo-neutro) text-(--ui-texto-secundario)",
                                    )}
                                  >
                                    {option.label}
                                  </span>
                                ))}
                              </div>
                            )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {activeTab === "jobTitles" && (
          <div className="animate-in fade-in slide-in-from-bottom-2">
            <JobTitlesSettings />
          </div>
        )}

        {activeTab === "automations" && (
          <div className="animate-in fade-in slide-in-from-bottom-2">
            <AutomationsSettings />
          </div>
        )}

        {activeTab === "integrations" && canManageBilling && (
          <div className="animate-in fade-in slide-in-from-bottom-2">
            <IntegrationsSettings />
          </div>
        )}

        {activeTab === "general" && (
          <div className="animate-in fade-in slide-in-from-bottom-2">
            <AccountSettingsPanel />
          </div>
        )}
      </div>
      <ConfirmationModal
        isOpen={!!pendingTagDelete}
        onClose={() => setPendingTagDelete(null)}
        onConfirm={() => {
          if (pendingTagDelete) {
            return handleDeleteTag(pendingTagDelete.id);
          }
        }}
        title="Excluir etiqueta"
        message={
          pendingTagDelete
            ? `A etiqueta "${pendingTagDelete.name}" será removida e as tarefas que a usam perderão essa referência.`
            : ""
        }
        confirmLabel="Excluir"
        pendingLabel="Excluindo..."
        cancelLabel="Cancelar"
        variant="danger"
      />
      <ConfirmationModal
        isOpen={!!pendingFieldDelete}
        onClose={() => setPendingFieldDelete(null)}
        onConfirm={() => {
          if (pendingFieldDelete) {
            return handleDeleteCustomField(pendingFieldDelete.id);
          }
        }}
        title="Excluir campo personalizado"
        message={
          pendingFieldDelete
            ? `O campo "${pendingFieldDelete.name}" será removido deste espaço de trabalho e os valores já preenchidos nas tarefas também deixarão de aparecer.`
            : ""
        }
        confirmLabel="Excluir"
        pendingLabel="Excluindo..."
        cancelLabel="Cancelar"
        variant="danger"
      />
      {editingTag && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => !isUpdating && setEditingTag(null)}
            aria-label="Fechar edição de etiqueta"
          />
          <div
            className={cn(
              "relative z-10 w-full max-w-md rounded-3xl border p-6",
              "border-(--ui-borda) bg-(--ui-superficie)",
            )}
          >
            <div className="mb-5">
              <h2
                className={cn(
                  "text-lg font-black",
                  "text-(--ui-texto-principal)",
                )}
              >
                Editar etiqueta
              </h2>
              <p
                className={cn(
                  "mt-1 text-sm",
                  "text-(--ui-texto-secundario)",
                )}
              >
                Atualize o nome e a cor da etiqueta global.
              </p>
            </div>

            <form onSubmit={handleUpdateTag} className="space-y-5">
              <div className="space-y-2">
                <label
                  className={cn(
                    "text-[11px] font-bold uppercase tracking-widest",
                    "text-(--ui-texto-secundario)",
                  )}
                >
                  Nome
                </label>
                <Input
                  value={editingTag.name}
                  onChange={(e) =>
                    setEditingTag((current) =>
                      current ? { ...current, name: e.target.value } : current,
                    )
                  }
                  className={cn(
                    "h-11",
                    "bg-(--ui-superficie-suave)",
                  )}
                  required
                />
              </div>

              <div className="space-y-3">
                <label
                  className={cn(
                    "text-[11px] font-bold uppercase tracking-widest",
                    "text-(--ui-texto-secundario)",
                  )}
                >
                  Cor
                </label>
                <div className="flex flex-wrap gap-2">
                  {ENTITY_COLOR_OPTIONS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() =>
                        setEditingTag((current) =>
                          current ? { ...current, color } : current,
                        )
                      }
                      className={cn(
                        "h-8 w-8 rounded-full border transition-transform cursor-pointer",
                        editingTag.color === color &&
                          "scale-110 ring-2 ring-blue-500",
                        "border-(--ui-borda)",
                      )}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>

              <div
                className={cn(
                  "rounded-xl border p-3",
                  "border-(--ui-borda-suave) bg-(--ui-fundo-sutil)",
                )}
              >
                <span
                  className="inline-flex rounded-full px-2.5 py-1 text-[10px] font-black text-white"
                  style={{ backgroundColor: editingTag.color }}
                >
                  {editingTag.name.trim() || "Preview"}
                </span>
              </div>

              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setEditingTag(null)}
                  disabled={isUpdating}
                  className={cn(
                    "rounded-xl px-4 py-2 text-sm font-bold transition-colors cursor-pointer disabled:opacity-50",
                    "bg-(--ui-fundo-neutro) text-(--ui-texto-forte) hover:bg-(--ui-hover-forte)",
                  )}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isUpdating || !editingTag.name.trim()}
                  className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
                >
                  {isUpdating ? "Salvando..." : "Salvar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {editingField && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => !isUpdatingField && setEditingField(null)}
            aria-label="Fechar edição de campo personalizado"
          />
          <div
            className={cn(
              "relative z-10 w-full max-w-lg rounded-3xl border p-6",
              "border-(--ui-borda) bg-(--ui-superficie)",
            )}
          >
            <div className="mb-5">
              <h2
                className={cn(
                  "text-lg font-black",
                  "text-(--ui-texto-principal)",
                )}
              >
                Editar campo personalizado
              </h2>
              <p
                className={cn(
                  "mt-1 text-sm",
                  "text-(--ui-texto-secundario)",
                )}
              >
                Atualize a definição do campo e, se necessário, mova-o para
                outro espaço de trabalho gerenciado por você.
              </p>
            </div>

            <form onSubmit={handleUpdateCustomField} className="space-y-5">
              <div className="space-y-2">
                <label
                  className={cn(
                    "text-[11px] font-bold uppercase tracking-widest",
                    "text-(--ui-texto-secundario)",
                  )}
                >
                  Espaço de trabalho vinculado
                </label>
                <SettingsSelect
                  value={editingField.workspaceId}
                  onChange={(value) =>
                    setEditingField((current) =>
                      current ? { ...current, workspaceId: value } : current,
                    )
                  }
                  options={manageableWorkspaces.map((workspace) => ({
                    value: workspace.id,
                    label: workspace.name,
                    description:
                      workspace.id === editingField.originalWorkspaceId
                        ? "Espaço de trabalho atual deste campo."
                        : "Ao salvar, o campo será movido para este espaço de trabalho.",
                  }))}
                />
                <p
                  className={cn(
                    "text-xs font-medium",
                    "text-(--ui-texto-secundario)",
                  )}
                >
                  Ao mover, o campo deixa de aparecer no espaço de trabalho antigo e
                  passa a valer apenas no destino.
                </p>
              </div>

              <div className="space-y-2">
                <label
                  className={cn(
                    "text-[11px] font-bold uppercase tracking-widest",
                    "text-(--ui-texto-secundario)",
                  )}
                >
                  Nome
                </label>
                <Input
                  value={editingField.name}
                  onChange={(e) =>
                    setEditingField((current) =>
                      current ? { ...current, name: e.target.value } : current,
                    )
                  }
                  className={cn(
                    "h-11",
                    "bg-(--ui-superficie-suave)",
                  )}
                  required
                />
              </div>

              <div className="space-y-2">
                <label
                  className={cn(
                    "text-[11px] font-bold uppercase tracking-widest",
                    "text-(--ui-texto-secundario)",
                  )}
                >
                  Tipo
                </label>
                <SettingsSelect
                  value={editingField.type}
                  onChange={(value) =>
                    setEditingField((current) =>
                      current
                        ? {
                            ...current,
                            type: value as CustomFieldType,
                          }
                        : current,
                    )
                  }
                  options={CUSTOM_FIELD_TYPE_OPTIONS.map((item) => ({
                    value: item.value,
                    label: item.label,
                  }))}
                />
              </div>

              {editingField.type === "single_select" && (
                <div className="space-y-2">
                  <label
                    className={cn(
                      "text-[11px] font-bold uppercase tracking-widest",
                      "text-(--ui-texto-secundario)",
                    )}
                  >
                    Opções
                  </label>
                  <textarea
                    value={editingField.optionsInput}
                    onChange={(e) =>
                      setEditingField((current) =>
                        current
                          ? { ...current, optionsInput: e.target.value }
                          : current,
                      )
                    }
                    rows={4}
                    className={cn(
                      "w-full rounded-xl border px-3 py-3 text-sm outline-none transition",
                      "border-(--ui-borda) bg-(--ui-superficie-suave) text-(--ui-texto-forte)",
                    )}
                  />
                </div>
              )}

              <div className="flex flex-wrap items-center gap-5">
                <SettingsCheckbox
                  checked={editingField.required}
                  onChange={(checked) =>
                    setEditingField((current) =>
                      current ? { ...current, required: checked } : current,
                    )
                  }
                  label="Obrigatório"
                />

                <SettingsCheckbox
                  checked={editingField.visibleOnDashboard}
                  onChange={(checked) =>
                    setEditingField((current) =>
                      current
                        ? { ...current, visibleOnDashboard: checked }
                        : current,
                    )
                  }
                  label="Elegível para dashboard"
                />
              </div>

              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setEditingField(null)}
                  disabled={isUpdatingField}
                  className={cn(
                    "rounded-xl px-4 py-2 text-sm font-bold transition-colors cursor-pointer disabled:opacity-50",
                    "bg-(--ui-fundo-neutro) text-(--ui-texto-forte) hover:bg-(--ui-hover-forte)",
                  )}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isUpdatingField || !editingField.name.trim()}
                  className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
                >
                  {isUpdatingField ? "Salvando..." : "Salvar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
