import {
  X,
  Mail,
  Send,
  Plus,
  ArrowLeft,
  Search,
  Download,
  Paperclip,
  Inbox,
} from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { useTaskStore, type SentEmail } from "../../../store/use-task-store";
import { useAuthStore } from "../../../store/use-auth-store";
import { useThemeStore } from "../../../store/use-theme-store";
import { buildAssetUrl } from "../../../lib/api";
import { AttachmentCard } from "../../../components/ui/attachment-card";
import {
  AttachmentPreviewModal,
  type AttachmentPreviewItem,
} from "../../../components/ui/attachment-preview-modal";
import { AttachmentUploadProgress } from "../../../components/ui/attachment-upload-progress";
import { LinkPreviewCard } from "../../../components/ui/link-preview-card";
import {
  formatRelativeTimestamp,
  getAttachmentNameFromUrl,
  normalizeTimestampDate,
  resolveAttachmentPreviewKind,
} from "../../../lib/attachment-utils";
import {
  extractUrlsFromText,
  normalizeLinkUrl,
} from "../../../lib/link-preview";
import {
  getUploadErrorMessage,
  getUploadValidationError,
  uploadFileToStorage,
  type UploadProgressPhase,
} from "../../../lib/file-upload";
import { renderTextWithLinks } from "../../../lib/task-mentions";
import { cn, getInitials } from "../../../lib/utils";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { LinkDisplayMode } from "../../../types/tasks";
import { toast } from "../../../store/use-toast-store";
import { useFecharComEsc } from "../../../lib/use-fechar-com-esc";

interface EmailModalProps {
  isOpen: boolean;
  onClose: () => void;
  anchorRef?: RefObject<HTMLElement | null>;
}

type ViewState = "list" | "compose" | "detail";
type TabState = "unread" | "read" | "sent";
type ComposeAttachment = {
  id: string;
  file: File;
  createdAt: string;
  previewUrl?: string | null;
  uploadProgress: number;
  uploadEtaMs: number | null;
  uploadPhase: UploadProgressPhase;
  uploadedUrl?: string | null;
  errorMessage?: string | null;
};

function getEmailLinkClassName() {
  return cn(
    "break-all underline underline-offset-2 transition-colors",
    "text-(--ui-azul-texto) hover:text-(--ui-azul-texto)",
  );
}

function removeUrlFromEmailBody(value: string, url: string) {
  const candidates = Array.from(
    new Set([
      url,
      url.replace(/^https?:\/\//, ""),
      url.replace(/^https:\/\//, "http://"),
      url.replace(/^http:\/\//, "https://"),
    ]),
  );

  for (const candidate of candidates) {
    if (value.includes(candidate)) {
      return value
        .replace(candidate, "")
        .replace(/\s{2,}/g, " ")
        .trim();
    }
  }

  return value;
}

function replaceUrlInEmailBody(
  value: string,
  currentUrl: string,
  nextUrl: string,
) {
  const normalizedNextUrl = normalizeLinkUrl(nextUrl);
  if (!normalizedNextUrl) {
    return value;
  }

  const candidates = Array.from(
    new Set([
      currentUrl,
      currentUrl.replace(/^https?:\/\//, ""),
      currentUrl.replace(/^https:\/\//, "http://"),
      currentUrl.replace(/^http:\/\//, "https://"),
    ]),
  );

  for (const candidate of candidates) {
    if (value.includes(candidate)) {
      return value.replace(candidate, normalizedNextUrl);
    }
  }

  return value;
}

function getLinkDisplayMode(
  linkDisplayModes: Record<string, LinkDisplayMode> | undefined,
  url: string,
) {
  return linkDisplayModes?.[normalizeLinkUrl(url)] ?? "preview";
}

function getHiddenLinkUrlsForRender(
  urls: string[],
  linkDisplayModes?: Record<string, LinkDisplayMode>,
) {
  return urls.filter(
    (url) => getLinkDisplayMode(linkDisplayModes, url) !== "url",
  );
}

export function EmailModal({ isOpen, onClose, anchorRef }: EmailModalProps) {
  // Esc fecha a janela, como em qualquer aplicativo.
  useFecharComEsc(isOpen, onClose);
  const sentEmails = useTaskStore((state) => state.sentEmails);
  const addSentEmail = useTaskStore((state) => state.addSentEmail);
  const markEmailRead = useTaskStore((state) => state.markEmailRead);
  const updateEmailLinkDisplayMode = useTaskStore(
    (state) => state.updateEmailLinkDisplayMode,
  );
  const members = useTaskStore((state) => state.graph.members);
  const authUser = useAuthStore((state) => state.user);

  const [view, setView] = useState<ViewState>("list");
  const [tab, setTab] = useState<TabState>("unread");
  const [selectedEmail, setSelectedEmail] = useState<SentEmail | null>(null);

  // Compose state
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [body, setBody] = useState("");
  const [composeLinkDisplayModes, setComposeLinkDisplayModes] = useState<
    Record<string, LinkDisplayMode>
  >({});
  const [isSending, setIsSending] = useState(false);

  // Member picker
  const [showMemberPicker, setShowMemberPicker] = useState(false);
  const [memberSearch, setMemberSearch] = useState("");

  // Attachments
  const [attachmentFiles, setAttachmentFiles] = useState<ComposeAttachment[]>(
    [],
  );
  const [attachmentPreviewState, setAttachmentPreviewState] = useState<{
    attachments: AttachmentPreviewItem[];
    activeIndex: number;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isDarkMode = useThemeStore((state) => state.mode === "dark");
  const [isMobileViewport, setIsMobileViewport] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 1023px)");
    const updateViewport = (event?: MediaQueryListEvent) => {
      setIsMobileViewport(event ? event.matches : mediaQuery.matches);
    };

    updateViewport();
    mediaQuery.addEventListener("change", updateViewport);
    return () => mediaQuery.removeEventListener("change", updateViewport);
  }, []);

  // Reset do estado visual somente quando o modal abre.
  useEffect(() => {
    if (isOpen) {
      setView("list");
      setTab("unread");
      setComposeLinkDisplayModes({});
      setAttachmentPreviewState(null);
    }
  }, [isOpen]);

  // Limpa previews temporários apenas ao fechar o modal.
  useEffect(() => {
    if (isOpen || attachmentFiles.length === 0) {
      return;
    }

    attachmentFiles.forEach((item) => {
      if (item.previewUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(item.previewUrl);
      }
    });
    setAttachmentFiles([]);
  }, [attachmentFiles, isOpen]);

  const [anchoredStyle, setAnchoredStyle] = useState<{
    top: number;
    right: number;
  } | null>(null);

  useLayoutEffect(() => {
    if (!isOpen || isMobileViewport || !anchorRef?.current) return;

    const updatePosition = () => {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (!rect) return;
      setAnchoredStyle({
        top: rect.bottom + 8,
        right: window.innerWidth - rect.right,
      });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [anchorRef, isMobileViewport, isOpen, view]);

  const allMembers = Object.values(members);
  const filteredMembers = allMembers.filter(
    (m) =>
      m.name.toLowerCase().includes(memberSearch.toLowerCase()) ||
      (m.email || "").toLowerCase().includes(memberSearch.toLowerCase()),
  );

  const unreadCount = sentEmails.filter(
    (e) => e.type === "received" && !e.read,
  ).length;
  const readCount = sentEmails.filter(
    (e) => e.type === "received" && e.read,
  ).length;
  const sentCount = sentEmails.filter((e) => e.type === "sent").length;
  const scopedEmails =
    tab === "unread"
      ? sentEmails.filter((e) => e.type === "received" && !e.read)
      : tab === "read"
        ? sentEmails.filter((e) => e.type === "received" && e.read)
        : sentEmails.filter((e) => e.type === "sent");
  const filteredEmails = [...scopedEmails].sort(
    (left, right) =>
      (normalizeTimestampDate(right.sentAt)?.getTime() ?? 0) -
      (normalizeTimestampDate(left.sentAt)?.getTime() ?? 0),
  );

  const tabConfig = {
    unread: {
      label: "Caixa de entrada",
      title: "Caixa de entrada",
      eyebrow: "Mensagens recebidas",
      empty: "Sua caixa de entrada está vazia",
      count: unreadCount,
      Icon: Inbox,
      headerTone: "bg-(--ui-azul-fundo) text-(--ui-azul-texto)",
      chipTone: "bg-(--ui-azul-fundo) text-(--ui-azul-texto)",
    },
    read: {
      label: "Lidas",
      title: "Mensagens lidas",
      eyebrow: "Histórico recente",
      empty: "Nenhuma mensagem lida",
      count: readCount,
      Icon: Mail,
      headerTone: "bg-(--ui-azul-fundo) text-(--ui-azul-texto)",
      chipTone: "bg-(--ui-fundo-neutro) text-(--ui-texto-secundario)",
    },
    sent: {
      label: "Enviadas",
      title: "Mensagens enviadas",
      eyebrow: "Saída",
      empty: "Nenhuma mensagem enviada",
      count: sentCount,
      Icon: Send,
      headerTone: "bg-(--ui-azul-fundo) text-(--ui-azul-texto)",
      chipTone: "bg-(--ui-verde-fundo) text-(--ui-verde-texto)",
    },
  } satisfies Record<
    TabState,
    {
      label: string;
      title: string;
      eyebrow: string;
      empty: string;
      count: number;
      Icon: typeof Mail;
      headerTone: string;
      chipTone: string;
    }
  >;
  const activeTabConfig = tabConfig[tab];

  const getEmailNameFromAddress = (value?: string | null) => {
    const address = value?.trim();
    if (!address) {
      return "Destinatário";
    }

    const [localPart] = address.split("@");
    if (!localPart) {
      return address;
    }

    return localPart
      .replace(/[._-]+/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase());
  };

  const getEmailDisplayName = (email: SentEmail) =>
    email.type === "received"
      ? email.senderName || email.senderEmail || "Remetente desconhecido"
      : getEmailNameFromAddress(email.to);

  const getEmailSecondaryLabel = (email: SentEmail) =>
    email.type === "received"
      ? email.senderEmail || "Mensagem recebida"
      : "Você enviou esta mensagem";

  const getEmailPreview = (email: SentEmail) => {
    const preview = email.subtitle?.trim() || email.body;
    return preview.replace(/\s+/g, " ").trim();
  };
  const composeBodyUrls = useMemo(() => extractUrlsFromText(body), [body]);
  const selectedEmailUrls = useMemo(
    () => extractUrlsFromText(selectedEmail?.body || ""),
    [selectedEmail?.body],
  );
  const hiddenSelectedEmailUrls = useMemo(
    () =>
      getHiddenLinkUrlsForRender(
        selectedEmailUrls,
        selectedEmail?.linkDisplayModes,
      ),
    [selectedEmailUrls, selectedEmail?.linkDisplayModes],
  );

  const getEmailCardSecondaryLabel = (email: SentEmail) =>
    email.type === "received" ? getEmailSecondaryLabel(email) : email.to;

  const renderEmailAvatar = (email: SentEmail) => {
    const avatarUrl =
      email.type === "received"
        ? email.senderAvatarUrl
        : authUser?.avatarUrl || email.senderAvatarUrl;
    const label = getEmailDisplayName(email);

    return avatarUrl ? (
      <img
        src={buildAssetUrl(avatarUrl)}
        onError={(event) => {
          event.currentTarget.style.display = "none";
        }}
        alt={label}
        className="h-10 w-10 shrink-0 rounded-xl object-cover"
      />
    ) : (
      <div
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[11px] font-black",
          "bg-(--ui-fundo-neutro) text-(--ui-texto-forte)",
        )}
      >
        {getInitials(label)}
      </div>
    );
  };

  const getEmailCardTone = (email: SentEmail) => {
    if (email.type === "sent") {
      return isDarkMode
        ? {
            cardBorder: "border-(--border-subtle)",
            cardBg: "bg-(--bg-elevated)",
            headerBg: "bg-white/[0.03]",
            accent: "bg-slate-400/80",
            time: "text-(--text-soft)",
          }
        : {
            cardBorder: "border-slate-200",
            cardBg: "bg-white",
            headerBg: "bg-slate-50",
            accent: "bg-slate-300",
            time: "text-slate-500",
          };
    }

    if (email.read) {
      return isDarkMode
        ? {
            cardBorder: "border-(--border-subtle)",
            cardBg: "bg-(--bg-elevated)",
            headerBg: "bg-white/[0.03]",
            accent: "bg-slate-400/80",
            time: "text-(--text-soft)",
          }
        : {
            cardBorder: "border-slate-200",
            cardBg: "bg-white",
            headerBg: "bg-slate-50",
            accent: "bg-slate-300",
            time: "text-slate-500",
          };
    }

    return isDarkMode
      ? {
          cardBorder: "border-blue-500/20",
          cardBg: "bg-(--bg-elevated)",
          headerBg: "bg-white/[0.03]",
          accent: "bg-blue-400",
          time: "text-(--text-main)",
        }
      : {
          cardBorder: "border-slate-200",
          cardBg: "bg-white",
          headerBg: "bg-slate-50",
          accent: "bg-blue-500",
          time: "text-slate-700",
        };
  };

  const getEmailCardTimeLabel = (email: SentEmail) => {
    const label = formatRelativeTimestamp(email.sentAt);
    if (label.toLowerCase().includes("agora")) {
      return "AGORA";
    }

    return label
      .replace(/^há\s+/i, "")
      .replace(/^ha\s+/i, "")
      .toUpperCase();
  };

  const getEmailDetailSenderLabel = (email: SentEmail) =>
    email.senderName || email.senderEmail || "Remetente desconhecido";

  const getEmailDetailRecipientLabel = (email: SentEmail) =>
    email.type === "received" ? "Mim" : getEmailNameFromAddress(email.to);

  const formatEmailAbsoluteTimestamp = (value?: string | null) => {
    const date = normalizeTimestampDate(value);
    if (!date) {
      return "Agora há pouco";
    }

    return format(date, "dd 'de' MMMM, HH:mm", { locale: ptBR });
  };

  if (!isOpen) return null;

  const atualizarAnexo = (
    attachmentId: string,
    mudanca: (atual: ComposeAttachment) => ComposeAttachment,
  ) => {
    setAttachmentFiles((atuais) =>
      atuais.map((item) => (item.id === attachmentId ? mudanca(item) : item)),
    );
  };

  /** Envia o arquivo assim que ele é anexado, como acontece nos cards. */
  const enviarAnexo = async (anexo: ComposeAttachment, quantidade: number) => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    try {
      const enviado = await uploadFileToStorage({
        file: anexo.file,
        endpoint: "/api/emails/attachments/upload",
        token,
        batchSize: quantidade,
        onProgress: (snapshot) =>
          atualizarAnexo(anexo.id, (atual) => ({
            ...atual,
            uploadProgress: snapshot.progress,
            uploadEtaMs: snapshot.etaMs,
            uploadPhase: snapshot.phase,
            errorMessage: null,
          })),
      });

      atualizarAnexo(anexo.id, (atual) => ({
        ...atual,
        uploadedUrl: enviado.url,
        uploadProgress: 100,
        uploadEtaMs: 0,
        uploadPhase: "complete",
        errorMessage: null,
      }));
    } catch (error) {
      atualizarAnexo(anexo.id, (atual) => ({
        ...atual,
        uploadPhase: "idle",
        errorMessage: getUploadErrorMessage(error, "Não foi possível enviar o anexo."),
      }));
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const escolhidos = Array.from(e.target.files);
    e.target.value = "";

    const entitlements = useAuthStore.getState().user?.organization?.entitlements;
    const maxFileSizeMb = entitlements?.maxFileSizeMb;
    const maxEmailAttachmentMb = entitlements?.maxEmailAttachmentMb ?? -1;

    // Limite de tamanho por arquivo.
    const erroDeTamanho = escolhidos
      .map((file) => getUploadValidationError(file, maxFileSizeMb))
      .find(Boolean);
    if (erroDeTamanho) {
      toast.error("Arquivo não enviado", { message: erroDeTamanho });
      return;
    }

    // Limite do plano para anexos da mensagem (soma do que já está anexado).
    if (maxEmailAttachmentMb === 0) {
      toast.error("Anexos indisponíveis no plano Grátis", {
        message: "Faça upgrade para enviar arquivos pelo e-mail interno.",
      });
      return;
    }

    if (maxEmailAttachmentMb > 0) {
      const jaAnexado = attachmentFiles.reduce((total, item) => total + item.file.size, 0);
      const novos = escolhidos.reduce((total, file) => total + file.size, 0);
      const totalMb = (jaAnexado + novos) / (1024 * 1024);

      if (totalMb > maxEmailAttachmentMb) {
        toast.error("Limite de anexos do plano", {
          message: `Seu plano permite até ${maxEmailAttachmentMb} MB por mensagem. Os arquivos escolhidos somam ${totalMb.toFixed(1)} MB.`,
        });
        return;
      }
    }

    const novosAnexos: ComposeAttachment[] = escolhidos.map((file) => ({
      id: `mail_attachment_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      file,
      createdAt: new Date().toISOString(),
      previewUrl: URL.createObjectURL(file),
      uploadProgress: 0,
      uploadEtaMs: null,
      uploadPhase: "preparing" as UploadProgressPhase,
      uploadedUrl: null,
      errorMessage: null,
    }));

    setAttachmentFiles((prev) => [...prev, ...novosAnexos]);
    novosAnexos.forEach((anexo) => void enviarAnexo(anexo, escolhidos.length));
  };

  const getComposeAttachmentStatus = (attachment: ComposeAttachment) => {
    if (attachment.errorMessage) {
      return "Falha no upload";
    }

    switch (attachment.uploadPhase) {
      case "preparing":
        return `Preparando ${attachment.uploadProgress}%`;
      case "uploading":
        return `Enviando ${attachment.uploadProgress}%`;
      case "processing":
        return "Finalizando upload";
      case "complete":
        return "Anexo enviado";
      default:
        return "Pronto para enviar";
    }
  };

  const removeFile = (attachmentId: string) => {
    setAttachmentFiles((prev) => {
      const nextFiles = prev.filter((item) => item.id !== attachmentId);
      const removedItem = prev.find((item) => item.id === attachmentId);
      if (removedItem?.previewUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(removedItem.previewUrl);
      }
      return nextFiles;
    });
  };

  const openAttachmentPreview = (
    attachments: AttachmentPreviewItem[],
    activeAttachmentId?: string,
  ) => {
    const previewableAttachments = attachments.filter((attachment) =>
      Boolean(
        resolveAttachmentPreviewKind({
          name: attachment.name,
          type: attachment.type,
          mimeType: attachment.mimeType,
        }),
      ),
    );

    if (previewableAttachments.length === 0) {
      return;
    }

    const activeIndex = Math.max(
      0,
      previewableAttachments.findIndex((attachment) =>
        activeAttachmentId
          ? attachment.id === activeAttachmentId
          : attachment === previewableAttachments[0],
      ),
    );

    setAttachmentPreviewState({
      attachments: previewableAttachments,
      activeIndex,
    });
  };

  const uploadAttachments = async (): Promise<string[]> => {
    if (attachmentFiles.length === 0) return [];
    const token = useAuthStore.getState().token;
    if (!token) {
      throw new Error("Token de autenticação ausente.");
    }

    const maxFileSizeMb =
      useAuthStore.getState().user?.organization?.entitlements?.maxFileSizeMb;
    const validationError = attachmentFiles
      .filter((attachment) => !attachment.uploadedUrl)
      .map((attachment) =>
        getUploadValidationError(attachment.file, maxFileSizeMb),
      )
      .find(Boolean);
    if (validationError) {
      throw new Error(validationError);
    }

    const urls: string[] = [];

    for (const attachment of attachmentFiles) {
      if (attachment.errorMessage) {
        throw new Error(`"${attachment.file.name}": ${attachment.errorMessage}`);
      }

      const uploadedUrl =
        attachment.uploadedUrl ||
        (await uploadFileToStorage({
          file: attachment.file,
          endpoint: "/api/emails/attachments/upload",
          token,
          batchSize: attachmentFiles.length,
          onProgress: (snapshot) => {
            setAttachmentFiles((current) =>
              current.map((item) =>
                item.id === attachment.id
                  ? {
                      ...item,
                      uploadProgress: snapshot.progress,
                      uploadEtaMs: snapshot.etaMs,
                      uploadPhase: snapshot.phase,
                      errorMessage: null,
                    }
                  : item,
              ),
            );
          },
        })).url;

      urls.push(uploadedUrl);
      setAttachmentFiles((current) =>
        current.map((item) =>
          item.id === attachment.id
            ? {
                ...item,
                uploadedUrl,
                uploadProgress: 100,
                uploadEtaMs: null,
                uploadPhase: "complete",
                errorMessage: null,
              }
            : item,
        ),
      );
    }

    return urls;
  };

  const handleSend = async () => {
    if (!to || !subject || !body) return;
    setIsSending(true);
    try {
      const attachmentUrls = await uploadAttachments();
      await addSentEmail({
        to,
        subject,
        subtitle,
        body,
        attachments: attachmentUrls,
        linkDisplayModes: composeLinkDisplayModes,
      });
      setView("list");
      setTab("sent");
      setTo("");
      setSubject("");
      setSubtitle("");
      setBody("");
      setComposeLinkDisplayModes({});
      attachmentFiles.forEach((item) => {
        if (item.previewUrl?.startsWith("blob:")) {
          URL.revokeObjectURL(item.previewUrl);
        }
      });
      setAttachmentFiles([]);
      toast.success("E-mail enviado.", {
        message: "Os destinatários já receberam a mensagem.",
      });
    } catch (error) {
      console.error("Erro ao enviar email com anexos:", error);
      toast.error("Não foi possível enviar o e-mail.", {
        message: getUploadErrorMessage(
          error,
          "A mensagem não saiu da caixa de saída.",
        ),
      });
      setAttachmentFiles((current) =>
        current.map((item) =>
          item.uploadPhase !== "complete"
            ? {
                ...item,
                uploadPhase: "error",
                errorMessage: "Falha ao enviar anexo.",
              }
            : item,
        ),
      );
    } finally {
      setIsSending(false);
    }
  };

  const handleOpenDetail = async (email: SentEmail) => {
    setSelectedEmail(email);
    setView("detail");
    if (!email.read) await markEmailRead(email.id);
  };

  const renderList = () => (
    <div
      className={cn(
        "flex h-dvh flex-col sm:h-125",
        "bg-(--ui-superficie) text-(--text-main)",
      )}
    >
      {/* Header */}
      <div
        className={cn(
          "sticky top-0 z-10 flex items-center justify-between gap-3 border-b px-4 py-3.5",
          "border-(--ui-borda-suave) bg-(--ui-superficie) backdrop-blur-sm",
        )}
        style={
          isMobileViewport
            ? {
                paddingTop: "calc(env(safe-area-inset-top, 0px) + 0.875rem)",
                paddingLeft: "calc(env(safe-area-inset-left, 0px) + 1rem)",
                paddingRight: "calc(env(safe-area-inset-right, 0px) + 1rem)",
              }
            : undefined
        }
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <div
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl",
              activeTabConfig.headerTone,
            )}
          >
            <activeTabConfig.Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h2
              className={cn(
                "truncate whitespace-nowrap text-[12px] font-black uppercase tracking-tight sm:text-[13px]",
                "text-(--ui-texto-principal)",
              )}
            >
              {activeTabConfig.title}
            </h2>
            <p
              className={cn(
                "truncate whitespace-nowrap text-[8px] font-bold uppercase tracking-[0.16em] leading-none",
                "text-(--ui-texto-secundario)",
              )}
            >
              {activeTabConfig.eyebrow}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={onClose}
            className={cn(
              "pauta-touch-target rounded-lg p-1.5 transition-colors cursor-pointer",
              "text-(--ui-texto-apagado) hover:bg-(--ui-hover) hover:text-(--ui-texto-forte)",
            )}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div
        className={cn(
          "flex gap-1.5 overflow-x-auto border-b px-3 py-2",
          "border-(--ui-borda-suave) bg-(--ui-fundo-sutil)",
        )}
      >
        {(
          [
            { key: "unread", label: "Não lidas" },
            { key: "read", label: "Lidas" },
            { key: "sent", label: "Enviadas" },
          ] as const
        ).map(({ key, label }) => {
          const displayLabel = key === "unread" ? "Caixa de entrada" : label;
          const count =
            key === "unread"
              ? unreadCount
              : key === "read"
                ? readCount
                : sentCount;

          return (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={cn(
                "pauta-touch-target inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl px-2.5 py-2 text-[9px] font-black uppercase tracking-[0.12em] transition-all cursor-pointer",
                tab === key
                  ? isDarkMode
                    ? "bg-blue-500/15 text-blue-300"
                    : "bg-white text-blue-600 shadow-sm ring-1 ring-blue-100"
                  : "text-(--ui-texto-secundario) hover:bg-(--ui-hover) hover:text-(--ui-texto-forte)",
              )}
            >
              {displayLabel}
              {count > 0 && (
                <span
                  className={cn(
                    "inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[8px] font-black",
                    tab === key
                      ? "bg-(--ui-azul-fundo) text-(--ui-azul-texto)"
                      : "bg-(--ui-fundo-neutro) text-(--ui-texto-secundario)",
                  )}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* List */}
      <div
        className={cn(
          "pauta-scroll-safe min-h-0 flex-1 overflow-y-auto p-3 sm:p-3",
          "bg-(--ui-fundo-sutil)",
        )}
      >
        {filteredEmails.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center opacity-60">
            <div
              className={cn(
                "mb-3 flex h-14 w-14 items-center justify-center rounded-full",
                isDarkMode
                  ? "bg-(--bg-surface-muted) text-(--text-soft)"
                  : "bg-slate-50 text-slate-200",
              )}
            >
              <activeTabConfig.Icon className="h-6 w-6" />
            </div>
            <p
              className={cn(
                "text-xs font-bold",
                "text-(--ui-texto-secundario)",
              )}
            >
              {tab === "unread"
                ? "Nenhuma mensagem não lida"
                : tab === "read"
                  ? "Nenhuma mensagem lida"
                  : "Nenhuma mensagem enviada"}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredEmails.map((email) => {
              const tone = getEmailCardTone(email);
              const timeLabel = getEmailCardTimeLabel(email);

              return (
                <button
                  key={email.id}
                  onClick={() => handleOpenDetail(email)}
                  className={cn(
                    "group relative w-full overflow-hidden rounded-[14px] border text-left transition-all cursor-pointer",
                    tone.cardBorder,
                    tone.cardBg,
                    isDarkMode
                      ? "shadow-(--shadow-soft) hover:bg-white/2"
                      : "shadow-sm hover:shadow-md",
                  )}
                >
                  <div
                    className={cn(
                      "border-b px-3 py-3 sm:px-4",
                      "border-(--ui-borda-suave)",
                      tone.headerBg,
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <div className="pt-0.5">{renderEmailAvatar(email)}</div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p
                              className={cn(
                                "truncate text-[12px] font-bold",
                                "text-(--ui-texto-principal)",
                              )}
                            >
                              {getEmailDisplayName(email)}
                            </p>
                            <p
                              className={cn(
                                "mt-0.5 truncate text-[10px]",
                                "text-(--ui-texto-secundario)",
                              )}
                            >
                              {getEmailCardSecondaryLabel(email)}
                            </p>
                          </div>

                          <div className="flex shrink-0 items-center gap-2 pl-2">
                            <span
                              className={cn(
                                "h-2 w-2 rounded-full",
                                tone.accent,
                              )}
                            />
                            <span
                              className={cn(
                                "text-[9px] font-black uppercase tracking-[0.08em]",
                                tone.time,
                              )}
                            >
                              {timeLabel}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="px-3 py-4 sm:px-4">
                    <h3
                      className={cn(
                        "line-clamp-1 text-[13px] font-semibold",
                        "text-(--ui-texto-principal)",
                      )}
                    >
                      {email.subject}
                    </h3>
                    <p
                      className={cn(
                        "mt-1 line-clamp-2 text-[11px] leading-relaxed",
                        "text-(--ui-texto-secundario)",
                      )}
                    >
                      {getEmailPreview(email)}
                    </p>

                    {email.attachments.length > 0 && (
                      <div className="mt-4 flex items-center gap-2">
                        <Paperclip
                          className={cn(
                            "h-4 w-4",
                            "text-(--ui-texto-secundario)",
                          )}
                        />
                        <span
                          className={cn(
                            "text-[10px] font-black uppercase tracking-[0.08em]",
                            "text-(--ui-texto-forte)",
                          )}
                        >
                          {email.attachments.length === 1
                            ? "1 anexo"
                            : `${email.attachments.length} anexos`}
                        </span>
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div
        className={cn(
          "border-t p-3",
          "border-(--ui-borda-suave) bg-(--ui-superficie-suave)",
        )}
        style={
          isMobileViewport
            ? {
                paddingBottom:
                  "calc(env(safe-area-inset-bottom, 0px) + 0.75rem)",
                paddingLeft: "calc(env(safe-area-inset-left, 0px) + 0.75rem)",
                paddingRight: "calc(env(safe-area-inset-right, 0px) + 0.75rem)",
              }
            : undefined
        }
      >
        <button
          onClick={() => setView("compose")}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-[11px] font-black uppercase tracking-[0.12em] text-white transition-all hover:bg-blue-700 active:scale-[0.99] cursor-pointer"
        >
          <Plus className="h-4 w-4" />
          Novo e-mail
        </button>
      </div>
    </div>
  );

  const renderCompose = () => (
    <div
      className={cn(
        "flex h-dvh flex-col sm:h-155",
        "bg-(--ui-superficie) text-(--text-main)",
      )}
    >
      <div
        className={cn(
          "sticky top-0 z-10 flex items-center justify-between border-b p-4",
          "border-(--ui-borda-suave) bg-(--ui-superficie-suave) backdrop-blur-sm",
        )}
        style={
          isMobileViewport
            ? {
                paddingTop: "calc(env(safe-area-inset-top, 0px) + 1rem)",
                paddingLeft: "calc(env(safe-area-inset-left, 0px) + 1rem)",
                paddingRight: "calc(env(safe-area-inset-right, 0px) + 1rem)",
              }
            : undefined
        }
      >
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-600 text-white">
            <Send className="h-4 w-4" />
          </div>
          <div>
            <h2
              className={cn(
                "text-sm font-black uppercase tracking-tighter",
                "text-(--ui-texto-principal)",
              )}
            >
              Nova Mensagem
            </h2>
            <p
              className={cn(
                "text-[9px] font-bold uppercase tracking-widest leading-none",
                "text-(--ui-texto-secundario)",
              )}
            >
              Redigir
            </p>
          </div>
        </div>
        <button
          onClick={() => setView("list")}
          className={cn(
            "pauta-touch-target rounded-lg p-1.5 transition-colors cursor-pointer",
            "text-(--ui-texto-apagado) hover:bg-(--ui-hover-forte) hover:text-(--ui-texto-forte)",
          )}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="pauta-scroll-safe min-h-0 flex-1 overflow-y-auto p-4 space-y-4 sm:p-5">
        {/* Para — member picker */}
        <div className="space-y-1.5">
          <label
            className={cn(
              "ml-1 text-[10px] font-bold uppercase tracking-widest",
              "text-(--ui-texto-apagado)",
            )}
          >
            Para:
          </label>
          <div className="relative">
            <Search
              className={cn(
                "pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2",
                "text-(--ui-texto-apagado)",
              )}
            />
            <input aria-label="Nome ou e-mail (separe por vírgula para várias pessoas)"
              value={to}
              autoComplete="off"
              onChange={(e) => {
                setTo(e.target.value);
                // A busca considera só o endereço que está sendo digitado agora.
                setMemberSearch(e.target.value.split(",").pop()?.trim() || "");
              }}
              onFocus={() => {
                setShowMemberPicker(true);
                setMemberSearch(to.split(",").pop()?.trim() || "");
              }}
              onBlur={() => setTimeout(() => setShowMemberPicker(false), 150)}
              placeholder="Nome ou e-mail (separe por vírgula para várias pessoas)"
              className={cn(
                "w-full h-10 rounded-xl border pl-10 pr-4 text-[13px] font-medium outline-none transition-all",
                "border-(--ui-borda-suave) bg-(--ui-fundo-sutil) text-(--ui-texto-forte) focus:border-(--ui-azul-borda-foco) focus:ring-4 focus:ring-(--ui-azul-foco) focus:bg-(--ui-superficie-suave)",
              )}
            />

            {showMemberPicker && (
              <div
                className={cn(
                  "absolute top-[calc(100%+4px)] left-0 z-50 w-full overflow-hidden rounded-2xl border animate-in fade-in zoom-in-95 duration-150",
                  "pauta-theme-menu",
                )}
              >
                {filteredMembers.length === 0 ? (
                  <div
                    className={cn(
                      "px-4 py-3 text-center text-[11px] font-bold",
                      "text-(--ui-texto-secundario)",
                    )}
                  >
                    Nenhum membro encontrado
                  </div>
                ) : (
                  <div className="max-h-48 overflow-y-auto py-1">
                    {filteredMembers.map((member) => (
                      <button
                        key={member.id}
                        onClick={() => {
                          const escolhido = member.email || member.name;
                          // Substitui só o trecho que estava sendo digitado.
                          setTo((atual) => {
                            const partes = atual.split(",");
                            partes[partes.length - 1] = ` ${escolhido}`;
                            return partes
                              .map((parte) => parte.trim())
                              .filter(Boolean)
                              .join(", ");
                          });
                          setShowMemberPicker(false);
                          setMemberSearch("");
                        }}
                        className={cn(
                          "flex w-full items-center gap-3 px-3 py-2 transition-colors cursor-pointer",
                          "hover:bg-(--ui-hover)",
                        )}
                      >
                        <div
                          className={cn(
                            "h-7 w-7 shrink-0 rounded-full flex items-center justify-center text-[10px] font-black text-white",
                            member.avatarColor || "bg-slate-400",
                          )}
                        >
                          {member.avatarUrl ? (
                            <img
                              src={buildAssetUrl(member.avatarUrl)}
                              onError={(event) => {
                                event.currentTarget.style.display = "none";
                              }}
                              className="h-full w-full rounded-full object-cover"
                              alt={member.name}
                            />
                          ) : (
                            getInitials(member.name)
                          )}
                        </div>
                        <div className="flex flex-col items-start min-w-0">
                          <span
                            className={cn(
                              "truncate text-[12px] font-bold",
                              "text-(--ui-texto-principal)",
                            )}
                          >
                            {member.name}
                          </span>
                          {member.email && (
                            <span
                              className={cn(
                                "truncate text-[10px]",
                                "text-(--ui-texto-secundario)",
                              )}
                            >
                              {member.email}
                            </span>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Assunto + subtítulo */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label
              className={cn(
                "ml-1 text-[10px] font-bold uppercase tracking-widest",
                "text-(--ui-texto-apagado)",
              )}
            >
              Assunto:
            </label>
            <input aria-label="Título"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Título"
              className={cn(
                "h-10 w-full rounded-xl border px-4 text-[13px] font-medium outline-none transition-all",
                "border-(--ui-borda-suave) bg-(--ui-fundo-sutil) text-(--ui-texto-forte) placeholder:text-(--text-soft) focus:border-(--ui-azul-borda-foco) focus:ring-4 focus:ring-(--ui-azul-foco) focus:bg-(--ui-superficie-suave)",
              )}
            />
          </div>
          <div className="space-y-1.5">
            <label
              className={cn(
                "ml-1 text-[10px] font-bold uppercase tracking-widest",
                "text-(--ui-texto-apagado)",
              )}
            >
              Subtítulo:
            </label>
            <input aria-label="Opcional"
              value={subtitle}
              onChange={(e) => setSubtitle(e.target.value)}
              placeholder="Opcional"
              className={cn(
                "h-10 w-full rounded-xl border px-4 text-[13px] font-medium outline-none transition-all",
                "border-(--ui-borda-suave) bg-(--ui-fundo-sutil) text-(--ui-texto-forte) placeholder:text-(--text-soft) focus:border-(--ui-azul-borda-foco) focus:ring-4 focus:ring-(--ui-azul-foco) focus:bg-(--ui-superficie-suave)",
              )}
            />
          </div>
        </div>

        {/* Mensagem */}
        <div className="space-y-1.5">
          <label
            className={cn(
              "ml-1 text-[10px] font-bold uppercase tracking-widest",
              "text-(--ui-texto-apagado)",
            )}
          >
            Mensagem:
          </label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className={cn(
              "min-h-35 w-full resize-none rounded-xl border p-4 text-[13px] font-medium outline-none transition-all wrap-anywhere",
              "border-(--ui-borda-suave) bg-(--ui-fundo-sutil) text-(--ui-texto-forte) placeholder:text-(--text-soft) focus:border-(--ui-azul-borda-foco) focus:ring-4 focus:ring-(--ui-azul-foco) focus:bg-(--ui-superficie-suave)",
            )}
            placeholder="Escreva aqui..."
          />
          {composeBodyUrls.length > 0 && (
            <div className="flex flex-wrap items-start gap-3 pt-3">
              {composeBodyUrls.map((url) => {
                const linkMode = getLinkDisplayMode(
                  composeLinkDisplayModes,
                  url,
                );
                if (linkMode === "url") {
                  return null;
                }
                return (
                  <LinkPreviewCard
                    isDarkMode={isDarkMode}
                    key={`email-compose-${url}`}
                    url={url}
                    mode={linkMode}
                    onModeChange={(mode) =>
                      setComposeLinkDisplayModes((current) => ({
                        ...current,
                        [normalizeLinkUrl(url)]: mode,
                      }))
                    }
                    onEdit={() => {
                      const nextUrl = window.prompt("Editar link", url);
                      if (!nextUrl) return;
                      setBody((current) =>
                        replaceUrlInEmailBody(current, url, nextUrl),
                      );
                    }}
                    onRemove={() =>
                      setBody((current) => removeUrlFromEmailBody(current, url))
                    }
                  />
                );
              })}
            </div>
          )}
        </div>

        {/* Anexos */}
        <div className="space-y-1.5">
          <label
            className={cn(
              "ml-1 text-[10px] font-bold uppercase tracking-widest",
              "text-(--ui-texto-apagado)",
            )}
          >
            Anexos:
          </label>
          <div className="space-y-3">
            {attachmentFiles.length > 0 && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {attachmentFiles.map((item) => (
                  <AttachmentCard
                    key={item.id}
                    attachment={{
                      id: item.id,
                      name: item.file.name,
                      url: item.uploadedUrl,
                      mimeType: item.file.type,
                      createdAt: item.createdAt,
                      previewUrl: item.previewUrl,
                      size: item.file.size,
                    }}
                    uploaderName={authUser?.name || "Você"}
                    uploaderAvatarUrl={authUser?.avatarUrl}
                    uploaderAvatarColor={authUser?.avatarColor}
                    statusLabel={getComposeAttachmentStatus(item)}
                    className="min-h-0"
                    footer={
                      item.uploadPhase !== "idle" || item.errorMessage ? (
                        <AttachmentUploadProgress
                          isDarkMode={isDarkMode}
                          progress={item.uploadProgress}
                          etaMs={item.uploadEtaMs}
                          phase={item.errorMessage ? "error" : item.uploadPhase}
                          errorMessage={item.errorMessage}
                        />
                      ) : null
                    }
                    onPreview={
                      resolveAttachmentPreviewKind({
                        name: item.file.name,
                        mimeType: item.file.type,
                      })
                        ? () =>
                            openAttachmentPreview(
                              attachmentFiles.map((attachment) => ({
                                id: attachment.id,
                                name: attachment.file.name,
                                url: attachment.uploadedUrl,
                                previewUrl: attachment.previewUrl,
                                mimeType: attachment.file.type,
                                createdAt: attachment.createdAt,
                              })),
                              item.id,
                            )
                        : undefined
                    }
                    actions={
                      <button
                        type="button"
                        onClick={() => removeFile(item.id)}
                        disabled={isSending}
                        className="grid h-7 w-7 place-items-center rounded-full bg-white text-slate-700 shadow-sm ring-1 ring-slate-200 transition hover:bg-rose-600 hover:text-white hover:ring-rose-600"
                        title="Remover anexo"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    }
                  />
                ))}
              </div>
            )}
            <input
              type="file"
              multiple
              ref={fileInputRef}
              className="hidden"
              onChange={handleFileChange}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                "flex items-center gap-1.5 rounded-lg border-2 border-dashed px-3 py-1.5 text-[10px] font-black transition-all cursor-pointer",
                isDarkMode
                  ? "border-(--border-strong) text-(--text-soft) hover:border-blue-400 hover:bg-blue-500/8 hover:text-blue-300"
                  : "border-slate-200 text-slate-400 hover:border-blue-400 hover:text-blue-500",
              )}
            >
              <Plus className="h-3 w-3" />
              ANEXAR
            </button>
          </div>
        </div>
      </div>

      <div
        className={cn(
          "border-t p-4",
          "border-(--ui-borda-suave) bg-(--ui-superficie-suave)",
        )}
        style={
          isMobileViewport
            ? {
                paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1rem)",
                paddingLeft: "calc(env(safe-area-inset-left, 0px) + 1rem)",
                paddingRight: "calc(env(safe-area-inset-right, 0px) + 1rem)",
              }
            : undefined
        }
      >
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-end">
          <button
            onClick={() => setView("list")}
            className={cn(
              "w-full px-4 py-2 text-[10px] font-black uppercase tracking-widest transition-colors cursor-pointer sm:w-auto",
              "text-(--ui-texto-secundario) hover:text-(--ui-texto-forte)",
            )}
          >
            CANCELAR
          </button>
          <button
            onClick={handleSend}
            disabled={isSending || !to || !subject || !body}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-6 py-2.5 text-xs font-black text-white transition-all hover:bg-blue-700 active:scale-95 cursor-pointer disabled:opacity-50 disabled:pointer-events-none sm:w-auto"
          >
            <Send className="h-3.5 w-3.5" />
            {isSending ? "ENVIANDO..." : "ENVIAR"}
          </button>
        </div>
      </div>
    </div>
  );

  const renderDetail = () => {
    if (!selectedEmail) return null;
    return (
      <div
        className={cn(
          "flex h-dvh flex-col sm:h-150",
          "bg-(--ui-superficie) text-(--text-main)",
        )}
      >
        <div
          className={cn(
            "sticky top-0 z-10 flex items-center justify-between border-b p-4 sm:px-6",
            "border-(--ui-borda-suave) bg-(--ui-superficie-suave) backdrop-blur-sm",
          )}
          style={
            isMobileViewport
              ? {
                  paddingTop: "calc(env(safe-area-inset-top, 0px) + 1rem)",
                  paddingLeft: "calc(env(safe-area-inset-left, 0px) + 1rem)",
                  paddingRight: "calc(env(safe-area-inset-right, 0px) + 1rem)",
                }
              : undefined
          }
        >
          <div className="flex min-w-0 items-center gap-3">
            <button
              onClick={() => setView("list")}
              className={cn(
                "pauta-touch-target rounded-lg p-1.5 transition-colors cursor-pointer",
                "text-(--ui-texto-secundario) hover:bg-(--ui-hover) hover:text-(--ui-texto-forte)",
              )}
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div
              className={cn(
                "flex h-9 w-9 items-center justify-center rounded-xl",
                "bg-(--ui-azul-fundo) text-(--ui-azul-texto)",
              )}
            >
              <Mail className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h1
                className={cn(
                  "line-clamp-2 text-sm font-black leading-tight",
                  "text-(--ui-texto-principal)",
                )}
              >
                {selectedEmail.subject}
              </h1>
              <p
                className={cn(
                  "text-[9px] font-bold uppercase tracking-widest",
                  "text-(--ui-texto-secundario)",
                )}
              >
                {selectedEmail.subtitle || "Detalhes"}
              </p>
            </div>
          </div>
          <button
            onClick={() => setView("list")}
            className={cn(
              "pauta-touch-target rounded-lg p-1.5 transition-colors cursor-pointer",
              "text-(--ui-texto-apagado) hover:bg-(--ui-hover) hover:text-(--ui-texto-forte)",
            )}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="pauta-scroll-safe mx-auto min-h-0 flex-1 w-full max-w-2xl overflow-y-auto p-4 sm:p-8">
          <div
            className={cn(
              "mb-5 rounded-2xl border p-4 sm:mb-6 sm:p-5",
              "border-(--ui-borda-suave) bg-(--ui-fundo-sutil)",
            )}
          >
            <div className="flex items-start gap-3 sm:gap-4">
              <div
                className={cn(
                  "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sm font-black",
                  isDarkMode
                    ? "bg-white/8 text-(--text-main)"
                    : "bg-white text-slate-700 ring-1 ring-slate-200",
                )}
              >
                {selectedEmail.type === "received"
                  ? getInitials(getEmailDetailSenderLabel(selectedEmail))
                  : getInitials(getEmailDetailRecipientLabel(selectedEmail))}
              </div>

              <div className="min-w-0 flex-1 space-y-3">
                <div className="space-y-2">
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
                    <span
                      className={cn(
                        "w-14 shrink-0 text-[10px] font-black uppercase tracking-widest",
                        "text-(--ui-texto-secundario)",
                      )}
                    >
                      De:
                    </span>
                    <span
                      className={cn(
                        "truncate text-[12px] font-bold",
                        "text-(--ui-texto-principal)",
                      )}
                    >
                      {getEmailDetailSenderLabel(selectedEmail)}
                    </span>
                  </div>

                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
                    <span
                      className={cn(
                        "w-14 shrink-0 text-[10px] font-black uppercase tracking-widest",
                        "text-(--ui-texto-secundario)",
                      )}
                    >
                      Para:
                    </span>
                    <span
                      className={cn(
                        "truncate text-[12px] font-bold",
                        "text-(--ui-texto-principal)",
                      )}
                    >
                      {getEmailDetailRecipientLabel(selectedEmail)}
                    </span>
                  </div>

                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
                    <span
                      className={cn(
                        "w-14 shrink-0 text-[10px] font-black uppercase tracking-widest",
                        "text-(--ui-texto-secundario)",
                      )}
                    >
                      Data:
                    </span>
                    <span
                      className={cn(
                        "truncate text-[12px] font-medium",
                        "text-(--ui-texto-secundario)",
                      )}
                    >
                      {formatEmailAbsoluteTimestamp(selectedEmail.sentAt)}
                    </span>
                  </div>
                </div>

                {selectedEmail.type === "received" &&
                  selectedEmail.senderEmail &&
                  selectedEmail.senderName && (
                    <p
                      className={cn(
                        "text-[10px]",
                        "text-(--ui-texto-secundario)",
                      )}
                    >
                      {selectedEmail.senderEmail}
                    </p>
                  )}
              </div>
            </div>
          </div>

          <div className="space-y-4">
            {selectedEmail.subtitle && (
              <p
                className={cn(
                  "border-l-2 border-blue-500 py-1 pl-4 text-[13px] italic",
                  "text-(--ui-texto-secundario)",
                )}
              >
                "
                {renderTextWithLinks(
                  selectedEmail.subtitle,
                  getEmailLinkClassName(),
                  hiddenSelectedEmailUrls,
                )}
                "
              </p>
            )}
            <div
              className={cn(
                "whitespace-pre-wrap text-[14px] leading-relaxed",
                "text-(--ui-texto-forte)",
              )}
            >
              {renderTextWithLinks(
                selectedEmail.body,
                getEmailLinkClassName(),
                hiddenSelectedEmailUrls,
              )}
            </div>
            {selectedEmailUrls.length > 0 && (
              <div className="flex flex-wrap items-start gap-3">
                {selectedEmailUrls.map((url) => {
                  const linkMode = getLinkDisplayMode(
                    selectedEmail.linkDisplayModes,
                    url,
                  );
                  if (linkMode === "url") {
                    return null;
                  }
                  return (
                    <LinkPreviewCard
                      isDarkMode={isDarkMode}
                      key={`email-detail-${selectedEmail.id}-${url}`}
                      url={url}
                      mode={linkMode}
                      onModeChange={(mode) =>
                        void updateEmailLinkDisplayMode(
                          selectedEmail.id,
                          normalizeLinkUrl(url),
                          mode,
                        )
                      }
                    />
                  );
                })}
              </div>
            )}
          </div>

          {selectedEmail.attachments.length > 0 && (
            <div
              className={cn(
                "mt-8 border-t pt-5 sm:mt-10 sm:pt-6",
                "border-(--ui-borda-suave)",
              )}
            >
              <p
                className={cn(
                  "mb-3 text-[9px] font-bold uppercase tracking-widest",
                  "text-(--ui-texto-apagado)",
                )}
              >
                Anexos ({selectedEmail.attachments.length})
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {selectedEmail.attachments.map((url, i) => {
                  const filename = getAttachmentNameFromUrl(url);
                  const uploaderName =
                    selectedEmail.type === "received"
                      ? selectedEmail.senderName ||
                        selectedEmail.senderEmail ||
                        "Remetente"
                      : authUser?.name || selectedEmail.senderName || "Você";
                  return (
                    <AttachmentCard
                      key={i}
                      attachment={{
                        id: `email_attachment_${selectedEmail.id}_${i}`,
                        name: filename,
                        url,
                        createdAt: selectedEmail.sentAt,
                      }}
                      uploaderName={uploaderName}
                      uploaderAvatarUrl={
                        selectedEmail.type === "received"
                          ? selectedEmail.senderAvatarUrl
                          : authUser?.avatarUrl || selectedEmail.senderAvatarUrl
                      }
                      uploaderAvatarColor={
                        selectedEmail.type === "received"
                          ? selectedEmail.senderAvatarColor
                          : authUser?.avatarColor ||
                            selectedEmail.senderAvatarColor
                      }
                      onPreview={
                        resolveAttachmentPreviewKind({ name: filename })
                          ? () =>
                              openAttachmentPreview(
                                selectedEmail.attachments.map(
                                  (attachmentUrl, attachmentIndex) => ({
                                    id: `email_attachment_${selectedEmail.id}_${attachmentIndex}`,
                                    name: getAttachmentNameFromUrl(
                                      attachmentUrl,
                                    ),
                                    url: attachmentUrl,
                                    createdAt: selectedEmail.sentAt,
                                  }),
                                ),
                                `email_attachment_${selectedEmail.id}_${i}`,
                              )
                          : undefined
                      }
                      actions={
                        <a
                          href={buildAssetUrl(url)}
                          target="_blank"
                          rel="noreferrer"
                          download
                          className="grid h-7 w-7 place-items-center rounded-full bg-white text-slate-700 shadow-sm ring-1 ring-slate-200 transition hover:bg-blue-600 hover:text-white hover:ring-blue-600"
                          title="Baixar anexo"
                        >
                          <Download className="h-3.5 w-3.5" />
                        </a>
                      }
                    />
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  const shouldRenderListOrCompose = view === "list" || view === "compose";
  const listOrComposeContent = view === "list" ? renderList() : renderCompose();

  return (
    <>
      {shouldRenderListOrCompose &&
        (isMobileViewport
          ? createPortal(
              <div
                data-email-portal
                className={cn(
                  "fixed inset-0 z-200 overflow-hidden",
                  "pauta-theme-surface bg-(--ui-superficie-suave)",
                )}
              >
                {listOrComposeContent}
              </div>,
              document.body,
            )
          : (!anchorRef || anchoredStyle) && (
              <div
                className={cn(
                  "overflow-hidden animate-in duration-200",
                  "pauta-theme-menu",
                  view === "list"
                    ? "w-90 rounded-[28px] slide-in-from-top-2"
                    : "w-120 rounded-[28px] zoom-in-95",
                )}
                style={
                  anchoredStyle
                    ? {
                        position: "fixed",
                        top: anchoredStyle.top,
                        right: anchoredStyle.right,
                        zIndex: 120,
                      }
                    : {
                        position: "fixed",
                        top: "72px",
                        right: "24px",
                        zIndex: 120,
                      }
                }
              >
                {listOrComposeContent}
              </div>
            ))}

      {view === "detail" &&
        createPortal(
          <div
            data-email-portal
            className={cn(
              "fixed inset-0 z-200 flex",
              isMobileViewport
                ? "items-stretch justify-stretch"
                : "items-center justify-center",
            )}
          >
            {!isMobileViewport && (
              <div
                className="pauta-theme-overlay absolute inset-0 animate-in fade-in duration-200 backdrop-blur-sm"
                onClick={() => setView("list")}
              />
            )}
            <div
              className={cn(
                "relative z-10 w-full overflow-hidden animate-in zoom-in-95 duration-200",
                isMobileViewport
                  ? "h-dvh rounded-none border-0"
                  : "mx-4 max-w-160 rounded-[28px] border",
                "pauta-theme-surface border-(--ui-borda-suave) bg-(--ui-superficie-suave) shadow-2xl",
              )}
            >
              {renderDetail()}
            </div>
          </div>,
          document.body,
        )}

      {attachmentPreviewState && (
        <AttachmentPreviewModal
          isDarkMode={isDarkMode}
          isOpen={true}
          onClose={() => setAttachmentPreviewState(null)}
          attachments={attachmentPreviewState.attachments}
          activeIndex={attachmentPreviewState.activeIndex}
          onChangeIndex={(index) =>
            setAttachmentPreviewState((current) =>
              current
                ? {
                    ...current,
                    activeIndex: index,
                  }
                : current,
            )
          }
        />
      )}
    </>
  );
}
