import {
  useEffect,
  useMemo,
  useState,
  useRef,
  type RefObject,
} from "react";
import type { CSSProperties } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Calendar,
  User,
  Maximize2,
  Link2,
  CheckSquare,
  Paperclip,
  Plus,
  Search,
  Tag,
  Clock,
  Send,
  LayoutGrid,
  MessageSquare,
  Flag,
  Smile,
  Minimize2,
  Trash2,
  Check,
  ChevronRight,
  GripVertical,
  Bell,
  FileText,
  Video,
  Table,
  Archive,
  Presentation,
  Image as ImageIcon,
  Download,
  ArrowLeft,
  Layers,
  ArrowUpDown,
  Pencil,
  MoreHorizontal,
  ThumbsUp,
  Info,
} from "lucide-react";

import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";

import {
  getChecklistLineInsertion,
  getInlineChecklistTrailingCursorPosition,
  InlineChecklistContent,
  InlineChecklistEditor,
  parseInlineChecklistText,
  SortableChecklistItem,
  updateInlineChecklistText,
} from "./inline-checklist";
import {
  formatActivityDate,
  getHiddenLinkUrlsForRender,
  getLinkClassName,
  getLinkDisplayMode,
  getMentionChipClassName,
  MentionInputPreview,
  removeLinkDisplayModeKey,
  removeUrlFromText,
  renameLinkDisplayModeKey,
  replaceUrlInText,
  stripRichTextPreservingBreaks,
  updateLinkDisplayModeMap,
} from "./task-text-and-links";
import { ConfirmationModal } from "../../../components/ui/confirmation-modal";
import {
  CustomFieldEditor,
  sortCustomFieldDefinitions,
  validateCustomFieldValues,
} from "../../../components/ui/custom-field-editor";
import { AttachmentCard } from "../../../components/ui/attachment-card";
import {
  AttachmentPreviewModal,
  type AttachmentPreviewItem,
} from "../../../components/ui/attachment-preview-modal";
import { AttachmentUploadProgress } from "../../../components/ui/attachment-upload-progress";
import { AttachmentCarousel } from "../../../components/ui/attachment-carousel";
import { CommentAttachmentsCarousel } from "../../../components/ui/comment-attachments-carousel";
import { LinkPreviewCard } from "../../../components/ui/link-preview-card";
import { buildApiUrl } from "../../../lib/api";
import {
  downloadAttachmentArchive,
  downloadAttachmentFile,
  resolveAttachmentPreviewKind,
  resolveAttachmentVisualKind,
} from "../../../lib/attachment-utils";
import {
  extractManagedLinksFromText,
  getManagedLinkUrls,
  normalizeLinkUrl,
  stripLinkUrlsFromText,
} from "../../../lib/link-preview";
import {
  getUploadErrorMessage,
  getUploadValidationError,
  uploadFileToStorage,
  type UploadProgressPhase,
} from "../../../lib/file-upload";
import {
  getTextareaCaretCoordinates,
  getMentionTrigger,
  insertMentionIntoText,
  renderTextWithMentionsAndLinks,
  resolveMentionIds,
  type MentionTrigger,
} from "../../../lib/task-mentions";
import { getTaskStatusLabel } from "../../../lib/task-status-label";
import { cn, getInitials } from "../../../lib/utils";
import { useAuthStore } from "../../../store/use-auth-store";
import {
  COMMENT_EMOJI_CATEGORY_GROUPS,
  COMMENT_EMOJI_CATEGORY_TABS,
} from "./comment-emojis";
import { useTaskStore } from "../../../store/use-task-store";
import { useThemeStore } from "../../../store/use-theme-store";
import { UserAvatar } from "../../../components/ui/user-avatar";
import type {
  CustomFieldDefinition,
  CustomFieldValue,
  EntityId,
  LinkDisplayMode,
  Member,
  TaskAttachment,
  TaskComment,
  TaskPriority,
} from "../../../types/tasks";
import { FlightDatePicker } from "../../../components/ui/flight-date-picker";
import { NotificationModal } from "../../layout/components/notification-modal";
import {
  canMoveTask,
  getWorkspacePermissionForTask,
  hasWorkspacePermission,
} from "../../../lib/workspace-permissions";
import { TimeEstimateDropdown } from "../../../components/ui/time-estimate-dropdown";
import { toast } from "../../../store/use-toast-store";

const DESC_EDITOR_MIN_HEIGHT = 168;
const DESC_EDITOR_MAX_HEIGHT = 420;

const priorityConfig: Record<
  TaskPriority,
  { label: string; bg: string; text: string; dot: string }
> = {
  urgent: {
    label: "Urgente",
    bg: "bg-rose-100",
    text: "text-rose-700",
    dot: "bg-rose-600",
  },
  high: {
    label: "Alta",
    bg: "bg-amber-100",
    text: "text-amber-700",
    dot: "bg-amber-600",
  },
  medium: {
    label: "Média",
    bg: "bg-orange-100",
    text: "text-orange-700",
    dot: "bg-orange-600",
  },
  low: {
    label: "Baixa",
    bg: "bg-emerald-100",
    text: "text-emerald-700",
    dot: "bg-emerald-600",
  },
};

interface PendingUploadAttachment extends Partial<TaskAttachment> {
  id: string;
  name: string;
  size: number;
  type: TaskAttachment["type"];
  createdAt: string;
  previewUrl?: string;
  progress: number;
  etaMs: number | null;
  uploadPhase: UploadProgressPhase;
  errorMessage?: string | null;
}

interface ActivityCommentEntry {
  type: "comment" | "reply";
  id: string;
  commentIds: string[];
  date: string;
  label: string;
  sub?: string;
  attachments: TaskAttachment[];
}

function escapeActivityHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const COMMENT_ATTACHMENT_GROUP_WINDOW_MS = 15_000;
const ALL_ASSIGNEES_MENTION_ID = "__mention_all__";
const ALL_ASSIGNEES_MENTION_NAME = "all";

function groupCommentEntries(
  entries: TaskComment[],
  type: "comment" | "reply",
): ActivityCommentEntry[] {
  const sortedEntries = [...entries].sort(
    (left, right) =>
      new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
  );

  return sortedEntries
    .reduce<ActivityCommentEntry[]>((groups, comment) => {
      const lastGroup = groups[groups.length - 1];
      const currentAttachments = comment.attachment ? [comment.attachment] : [];
      const shouldMergeIntoLastGroup =
        !!lastGroup &&
        lastGroup.label === comment.authorName &&
        !comment.content.trim() &&
        currentAttachments.length > 0 &&
        new Date(comment.createdAt).getTime() -
          new Date(lastGroup.date).getTime() <=
          COMMENT_ATTACHMENT_GROUP_WINDOW_MS;

      if (shouldMergeIntoLastGroup) {
        lastGroup.commentIds.push(comment.id);
        lastGroup.attachments.push(...currentAttachments);
        lastGroup.date = comment.createdAt;
        return groups;
      }

      groups.push({
        type,
        id: comment.id,
        commentIds: [comment.id],
        date: comment.createdAt,
        label: comment.authorName,
        sub: comment.content,
        attachments: currentAttachments,
      });
      return groups;
    }, [])
    .sort(
      (left, right) =>
        new Date(right.date).getTime() - new Date(left.date).getTime(),
    );
}

function getUploadStatusLabel(attachment: PendingUploadAttachment) {
  if (attachment.errorMessage) {
    return "Falha no upload";
  }

  if (attachment.url) {
    return "Pronto para enviar";
  }

  switch (attachment.uploadPhase) {
    case "preparing":
      return `Preparando ${attachment.progress}%`;
    case "uploading":
      return `Enviando ${attachment.progress}%`;
    case "processing":
      return "Finalizando upload";
    case "complete":
      return "Upload concluído";
    default:
      return "Aguardando upload";
  }
}

function MentionPicker({
  isOpen,
  title,
  search,
  members,
  onSearchChange,
  onSelect,
  menuRef,
  placement = "bottom",
  style,
  position = "absolute",
  renderInPortal = false,
  showSearch = true,
}: {
  isOpen: boolean;
  title: string;
  search: string;
  members: Member[];
  onSearchChange: (value: string) => void;
  onSelect: (member: Member) => void;
  menuRef: RefObject<HTMLDivElement | null>;
  isDarkMode: boolean;
  placement?: "bottom" | "top" | "floating";
  style?: CSSProperties;
  position?: "absolute" | "fixed";
  renderInPortal?: boolean;
  showSearch?: boolean;
}) {
  if (!isOpen) return null;

  const isFloating = placement === "floating";

  const picker = (
    <div
      ref={menuRef}
      className={cn(
        position === "fixed" ? "fixed" : "absolute",
        "z-1300 overflow-hidden rounded-2xl border shadow-[0_24px_60px_-28px_rgba(15,23,42,0.55)] backdrop-blur-sm animate-in fade-in zoom-in-95 duration-150",
        placement === "top" && "bottom-full left-0 right-0 mb-2 origin-bottom",
        placement === "bottom" && "left-0 right-0 top-full mt-2 origin-top",
        isFloating &&
          "w-72 max-w-[min(18rem,calc(100vw-3rem))] origin-top-left",
        "border-(--ui-borda) bg-(--ui-superficie)",
      )}
      style={style}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div
        className={cn(
          "border-b",
          isFloating ? "px-2.5 py-2" : "px-3 py-2",
          "border-(--ui-borda-suave)",
        )}
      >
        <p
          className={cn(
            showSearch
              ? "mb-2 text-[10px] font-bold uppercase tracking-[0.16em]"
              : "text-[10px] font-bold uppercase tracking-[0.16em]",
            "text-(--ui-texto-secundario)",
          )}
        >
          {title}
        </p>
        {showSearch && (
          <input aria-label="Pesquisar membro..."
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Pesquisar membro..."
            className={cn(
              "w-full rounded-xl border px-3 text-sm outline-none",
              isFloating ? "h-8" : "h-9",
              "border-(--ui-azul-borda) bg-(--ui-fundo-sutil) text-(--ui-texto-forte) placeholder:text-(--ui-texto-secundario) focus:ring-2 focus:ring-(--ui-azul-borda)",
            )}
          />
        )}
      </div>

      <div
        className={cn(
          "overflow-y-auto",
          isFloating ? "max-h-52 p-1.5" : "max-h-60 p-2",
        )}
      >
        {members.length === 0 ? (
          <p
            className={cn(
              "px-2 py-4 text-center text-xs",
              "text-(--ui-texto-secundario)",
            )}
          >
            Nenhum membro encontrado.
          </p>
        ) : (
          members.map((member) => (
            <button
              key={member.id}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onSelect(member)}
              className={cn(
                "flex w-full cursor-pointer items-center gap-3 rounded-xl text-left transition-colors",
                isFloating ? "px-2.5 py-2" : "px-3 py-2",
                "hover:bg-(--ui-hover)",
              )}
            >
              <UserAvatar member={member} size={isFloating ? 28 : 30} />
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    isFloating
                      ? "truncate text-[13px] font-bold"
                      : "truncate text-sm font-bold",
                    "text-(--ui-texto-principal)",
                  )}
                >
                  {member.id === ALL_ASSIGNEES_MENTION_ID
                    ? "@all • Todos os responsáveis"
                    : member.name}
                </p>
                <p
                  className={cn(
                    isFloating
                      ? "truncate text-[10px]"
                      : "truncate text-[11px]",
                    "text-(--ui-texto-secundario)",
                  )}
                >
                  {member.role || member.email || "Membro"}
                </p>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );

  return renderInPortal ? createPortal(picker, document.body) : picker;
}

export function TaskDetailsModal() {
  const [commentText, setCommentText] = useState("");
  const [titleDraft, setTitleDraft] = useState("");
  const [descDraft, setDescDraft] = useState("");
  const [descEditorHeight, setDescEditorHeight] = useState(
    DESC_EDITOR_MIN_HEIGHT,
  );
  const [commentMentionSearch, setCommentMentionSearch] = useState("");
  const [descMentionSearch, setDescMentionSearch] = useState("");
  const [commentMentionTrigger, setCommentMentionTrigger] =
    useState<MentionTrigger | null>(null);
  const [descMentionTrigger, setDescMentionTrigger] =
    useState<MentionTrigger | null>(null);
  const [commentMentions, setCommentMentions] = useState<
    Array<{ id: string; name: string }>
  >([]);
  const [descMentions, setDescMentions] = useState<
    Array<{ id: string; name: string }>
  >([]);
  const [commentLinkDisplayModes, setCommentLinkDisplayModes] = useState<
    Record<string, LinkDisplayMode>
  >({});
  const [descLinkDisplayModes, setDescLinkDisplayModes] = useState<
    Record<string, LinkDisplayMode>
  >({});
  const [editingCommentLinkDisplayModes, setEditingCommentLinkDisplayModes] =
    useState<Record<string, LinkDisplayMode>>({});
  const [commentEditorScroll, setCommentEditorScroll] = useState({
    top: 0,
    left: 0,
  });
  const [descEditorScroll, setDescEditorScroll] = useState({
    top: 0,
    left: 0,
  });
  const [descMentionMenuStyle, setDescMentionMenuStyle] =
    useState<CSSProperties>();

  const titleRef = useRef<HTMLTextAreaElement>(null);
  const commentInputRef = useRef<HTMLTextAreaElement>(null);
  const descTextareaRef = useRef<HTMLTextAreaElement>(null);
  const commentLinkPreviewRef = useRef<HTMLDivElement>(null);
  const descLinkPreviewRef = useRef<HTMLDivElement>(null);
  const commentMentionMenuRef = useRef<HTMLDivElement>(null);
  const descMentionMenuRef = useRef<HTMLDivElement>(null);
  const descChecklistTrailingTextareaRef = useRef<HTMLTextAreaElement>(null);
  const commentChecklistTrailingTextareaRef = useRef<HTMLTextAreaElement>(null);
  const editChecklistTrailingTextareaRef = useRef<HTMLTextAreaElement>(null);
  const descResizeCleanupRef = useRef<(() => void) | null>(null);
  const descReadInteractionRef = useRef({
    pointerDownAt: 0,
    x: 0,
    y: 0,
    ignoreNextClick: false,
  });

  const graph = useTaskStore((state) => state.graph);
  const ui = useTaskStore((state) => state.ui);
  const commentsByTaskId = useTaskStore((state) => state.commentsByTaskId);
  const closeTaskDetails = useTaskStore((state) => state.closeTaskDetails);
  const addComment = useTaskStore((state) => state.addComment);
  const updateTaskTitle = useTaskStore((state) => state.updateTaskTitle);
  const updateTaskDescription = useTaskStore(
    (state) => state.updateTaskDescription,
  );
  const updateTaskDescriptionLinkDisplayMode = useTaskStore(
    (state) => state.updateTaskDescriptionLinkDisplayMode,
  );
  const updateTaskDates = useTaskStore((state) => state.updateTaskDates);
  const removeTaskAssignee = useTaskStore((state) => state.removeTaskAssignee);
  const addTaskAssignee = useTaskStore((state) => state.addTaskAssignee);
  const editComment = useTaskStore((state) => state.editComment);
  const updateCommentLinkDisplayMode = useTaskStore(
    (state) => state.updateCommentLinkDisplayMode,
  );
  const persistCommentLike = useTaskStore((state) => state.toggleCommentLike);
  const persistCommentReaction = useTaskStore(
    (state) => state.setCommentReaction,
  );
  const moveTaskToStatus = useTaskStore((state) => state.moveTaskToStatus);
  const updateTaskPriority = useTaskStore((state) => state.updateTaskPriority);
  const toggleTaskTag = useTaskStore((state) => state.toggleTaskTag);
  const fetchTaskDetails = useTaskStore((state) => state.fetchTaskDetails);
  const updateTaskEstimate = useTaskStore((state) => state.updateTaskEstimate);
  const updateTaskCustomFieldValues = useTaskStore(
    (state) => state.updateTaskCustomFieldValues,
  );
  const deleteComment = useTaskStore((state) => state.deleteComment);
  const addChecklist = useTaskStore((state) => state.addChecklist);
  const deleteChecklist = useTaskStore((state) => state.deleteChecklist);
  const renameChecklist = useTaskStore((state) => state.renameChecklist);
  const addChecklistItem = useTaskStore((state) => state.addChecklistItem);
  const toggleChecklistItem = useTaskStore(
    (state) => state.toggleChecklistItem,
  );
  const setChecklistItemAssignee = useTaskStore(
    (state) => state.setChecklistItemAssignee,
  );
  const updateChecklistItemLabel = useTaskStore(
    (state) => state.updateChecklistItemLabel,
  );
  const reorderChecklistItem = useTaskStore(
    (state) => state.reorderChecklistItem,
  );
  const deleteChecklistItem = useTaskStore(
    (state) => state.deleteChecklistItem,
  );
  const deleteTask = useTaskStore((state) => state.deleteTask);
  const addAttachment = useTaskStore((state) => state.addAttachment);
  const deleteAttachment = useTaskStore((state) => state.deleteAttachment);
  const setTaskCoverAttachment = useTaskStore(
    (state) => state.setTaskCoverAttachment,
  );
  const addSubtask = useTaskStore((state) => state.addSubtask);
  const taskHistory = useTaskStore((state) => state.ui.taskHistory);
  const openTaskDetails = useTaskStore((state) => state.openTaskDetails);
  const linkTask = useTaskStore((state) => state.linkTask);
  const unlinkTask = useTaskStore((state) => state.unlinkTask);
  const isDarkMode = useThemeStore((state) => state.mode === "dark");

  const [uploadType, setUploadType] =
    useState<TaskAttachment["type"]>("document");
  const [uploadAccept, setUploadAccept] = useState(".pdf,.doc,.docx,.txt,.rtf");
  const [isAttachmentMenuOpen, setIsAttachmentMenuOpen] = useState(false);
  const [isLeftAttachmentMenuOpen, setIsLeftAttachmentMenuOpen] =
    useState(false);
  const [isAssigneeMenuOpen, setIsAssigneeMenuOpen] = useState(false);
  const [assigneeSearch, setAssigneeSearch] = useState("");
  const [assigneeTagFilter, setAssigneeTagFilter] = useState<string | null>(
    null,
  );
  const [isPriorityMenuOpen, setIsPriorityMenuOpen] = useState(false);
  const [isTagMenuOpen, setIsTagMenuOpen] = useState(false);
  const [tagSearch, setTagSearch] = useState("");
  const [isLinkMenuOpen, setIsLinkMenuOpen] = useState(false);
  const [linkSearch, setLinkSearch] = useState("");
  const [isEmojiPickerOpen, setIsEmojiPickerOpen] = useState(false);
  const [emojiSearch, setEmojiSearch] = useState("");
  const [activeEmojiTab, setActiveEmojiTab] =
    useState<(typeof COMMENT_EMOJI_CATEGORY_TABS)[number]["key"]>("recent");

  const [replyingToId, setReplyingToId] = useState<string | null>(null);
  const [isSubtaskAdding, setIsSubtaskAdding] = useState(false);
  const [subtaskDraft, setSubtaskDraft] = useState("");

  const assigneeMenuRef = useRef<HTMLDivElement>(null);
  const priorityMenuRef = useRef<HTMLDivElement>(null);
  const tagMenuRef = useRef<HTMLDivElement>(null);
  const linkMenuRef = useRef<HTMLDivElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const leftAttachmentMenuRef = useRef<HTMLDivElement>(null);
  const mainAttachmentMenuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const statusMenuRef = useRef<HTMLDivElement>(null);
  const notificationButtonRef = useRef<HTMLButtonElement>(null);

  const [uploadSource, setUploadSource] = useState<"task" | "comment">("task");
  const [taskCustomFieldDrafts, setTaskCustomFieldDrafts] = useState<
    Record<string, CustomFieldValue>
  >({});
  const [taskCustomFieldErrors, setTaskCustomFieldErrors] = useState<
    Partial<Record<string, string>>
  >({});
  const [stagedCommentAttachments, setStagedCommentAttachments] = useState<
    PendingUploadAttachment[]
  >([]);
  const [stagedTaskAttachments, setStagedTaskAttachments] = useState<
    PendingUploadAttachment[]
  >([]);
  const [isUploadingCommentAttachment, setIsUploadingCommentAttachment] =
    useState(false);
  const [isUploadingTaskAttachment, setIsUploadingTaskAttachment] =
    useState(false);
  const commentAttachmentUploadRef = useRef(0);
  const taskAttachmentUploadRef = useRef(0);
  const token = useAuthStore((state) => state.token);
  const authUser = useAuthStore((state) => state.user);

  async function uploadTaskFile(
    taskId: string,
    file: File,
    type: TaskAttachment["type"],
    onProgress?: (snapshot: {
      progress: number;
      etaMs: number | null;
      phase: UploadProgressPhase;
    }) => void,
    batchSize?: number,
  ) {
    if (!token) {
      throw new Error("Token de autenticação ausente.");
    }
    const uploadedFile = await uploadFileToStorage({
      file,
      endpoint: buildApiUrl(`/api/workspaces/tasks/${taskId}/uploads`),
      token,
      batchSize,
      onProgress,
    });

    return {
      id: `att_${Math.random().toString(36).slice(2, 10)}`,
      name: file.name,
      size: file.size,
      type,
      url: uploadedFile.url,
      createdAt: new Date().toISOString(),
    };
  }

  function triggerFileUpload(
    type: TaskAttachment["type"],
    accept = ".pdf,.doc,.docx,.txt,.rtf",
    source: "task" | "comment" = "task",
  ) {
    if (
      (source === "comment" && !canCommentTask) ||
      (source === "task" && !canCollaborateTask)
    ) {
      return;
    }
    if (source === "task" && isUploadingTaskAttachment) {
      return;
    }
    if (source === "comment" && isUploadingCommentAttachment) {
      return;
    }
    setUploadType(type);
    setUploadAccept(accept);
    setUploadSource(source);
    setIsAttachmentMenuOpen(false);
    setIsLeftAttachmentMenuOpen(false);
    setTimeout(() => {
      fileInputRef.current?.click();
    }, 100);
  }

  function resolveUploadTypeFromFile(file: File): TaskAttachment["type"] {
    const visualKind = resolveAttachmentVisualKind({
      name: file.name,
      mimeType: file.type,
    });

    switch (visualKind) {
      case "image":
        return "image";
      case "video":
        return "video";
      case "spreadsheet":
        return "spreadsheet";
      case "archive":
        return "archive";
      case "powerpoint":
        return "powerpoint";
      default:
        return "document";
    }
  }

  async function uploadFilesToTask(
    files: File[],
    options: {
      source: "task" | "comment";
      type?: TaskAttachment["type"];
    },
  ) {
    const { source } = options;
    if (files.length === 0 || !activeTaskId) return;
    if (
      (source === "comment" && !canCommentTask) ||
      (source === "task" && !canCollaborateTask)
    ) {
      return;
    }

    const maxFileSizeMb = authUser?.organization?.entitlements?.maxFileSizeMb;
    const rejectedMessages = files
      .map((file) => getUploadValidationError(file, maxFileSizeMb))
      .filter((message): message is string => Boolean(message));
    if (rejectedMessages.length > 0) {
      toast.error(
        rejectedMessages.length === 1
          ? "Arquivo não enviado."
          : `${rejectedMessages.length} arquivos não enviados.`,
        { message: rejectedMessages[0] },
      );
      files = files.filter(
        (file) => !getUploadValidationError(file, maxFileSizeMb),
      );
      if (files.length === 0) return;
    }

    let currentUploadId = 0;
    const isCommentUpload = source === "comment";

    const placeholders = files.map((file) => {
      const attachmentType = options.type ?? resolveUploadTypeFromFile(file);

      return {
        id: `staged_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: file.name,
        size: file.size,
        type: attachmentType,
        url: "",
        createdAt: new Date().toISOString(),
        previewUrl:
          attachmentType === "image" ? URL.createObjectURL(file) : undefined,
        progress: 0,
        etaMs: null,
        uploadPhase: "preparing" as UploadProgressPhase,
        errorMessage: null,
      };
    });

    const updatePlaceholder = (
      placeholderId: string,
      updater: (attachment: PendingUploadAttachment) => PendingUploadAttachment,
    ) => {
      const setter = isCommentUpload
        ? setStagedCommentAttachments
        : setStagedTaskAttachments;
      setter((current) =>
        current.map((attachment) =>
          attachment.id === placeholderId ? updater(attachment) : attachment,
        ),
      );
    };

    try {
      if (isCommentUpload) {
        currentUploadId = commentAttachmentUploadRef.current + 1;
        commentAttachmentUploadRef.current = currentUploadId;
        setIsUploadingCommentAttachment(true);
        setStagedCommentAttachments((current) => [...current, ...placeholders]);
      } else {
        currentUploadId = taskAttachmentUploadRef.current + 1;
        taskAttachmentUploadRef.current = currentUploadId;
        setIsUploadingTaskAttachment(true);
        setAttachmentsCollapsed(false);
        setStagedTaskAttachments((current) => [...current, ...placeholders]);
      }

      for (const [index, file] of files.entries()) {
        const placeholder = placeholders[index];
        const attachment = await uploadTaskFile(
          activeTaskId,
          file,
          placeholder.type,
          (snapshot) => {
            updatePlaceholder(placeholder.id, (current) => ({
              ...current,
              progress: snapshot.progress,
              etaMs: snapshot.etaMs,
              uploadPhase: snapshot.phase,
              errorMessage: null,
            }));
          },
          files.length,
        );

        if (
          (isCommentUpload &&
            commentAttachmentUploadRef.current !== currentUploadId) ||
          (!isCommentUpload &&
            taskAttachmentUploadRef.current !== currentUploadId)
        ) {
          return;
        }

        if (isCommentUpload) {
          updatePlaceholder(placeholder.id, (current) => ({
            ...current,
            ...attachment,
            previewUrl: current.previewUrl,
            progress: 100,
            etaMs: null,
            uploadPhase: "complete",
            errorMessage: null,
          }));
        } else {
          await addAttachment(activeTaskId, attachment);
          setStagedTaskAttachments((current) =>
            current.filter((item) => item.id !== placeholder.id),
          );
        }
      }
    } catch (error) {
      console.error("Erro ao enviar arquivo da tarefa:", error);
      const uploadErrorMessage = getUploadErrorMessage(
        error,
        "Verifique sua conexão e tente novamente.",
      );
      toast.error("Não foi possível enviar o anexo.", {
        message: uploadErrorMessage,
      });
      // O aviso já saiu no toast: anexos que não subiram somem da lista.
      const setter = isCommentUpload
        ? setStagedCommentAttachments
        : setStagedTaskAttachments;
      setter((current) =>
        current.filter((attachment) => {
          const failed =
            !attachment.url &&
            placeholders.some((placeholder) => placeholder.id === attachment.id);
          if (failed && attachment.previewUrl?.startsWith("blob:")) {
            URL.revokeObjectURL(attachment.previewUrl);
          }
          return !failed;
        }),
      );
    } finally {
      if (
        isCommentUpload &&
        commentAttachmentUploadRef.current === currentUploadId
      ) {
        setIsUploadingCommentAttachment(false);
      }
      if (
        !isCommentUpload &&
        taskAttachmentUploadRef.current === currentUploadId
      ) {
        setIsUploadingTaskAttachment(false);
      }
    }
  }

  useEffect(() => {
    // Evita que o navegador abra o arquivo quando ele cai fora das areas de drop.
    const preventFileDrop = (event: DragEvent) => {
      if (!Array.from(event.dataTransfer?.types ?? []).includes("Files")) {
        return;
      }
      event.preventDefault();
    };

    window.addEventListener("dragover", preventFileDrop);
    window.addEventListener("drop", preventFileDrop);

    return () => {
      window.removeEventListener("dragover", preventFileDrop);
      window.removeEventListener("drop", preventFileDrop);
    };
  }, []);

  function hasDraggedFiles(event: React.DragEvent<HTMLElement>) {
    const types = Array.from(event.dataTransfer?.types ?? []);
    return types.includes("Files");
  }

  function canDropFilesOn(source: "task" | "comment") {
    return source === "comment" ? canCommentTask : canCollaborateTask;
  }

  function getFileDropHandlers(source: "task" | "comment") {
    const depthRef =
      source === "comment" ? commentDropDepthRef : taskDropDepthRef;

    return {
      onDragEnter: (event: React.DragEvent<HTMLDivElement>) => {
        if (!hasDraggedFiles(event) || !canDropFilesOn(source)) return;
        event.preventDefault();
        depthRef.current += 1;
        setFileDropTarget(source);
      },
      onDragOver: (event: React.DragEvent<HTMLDivElement>) => {
        if (!hasDraggedFiles(event) || !canDropFilesOn(source)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      },
      onDragLeave: (event: React.DragEvent<HTMLDivElement>) => {
        if (!hasDraggedFiles(event) || !canDropFilesOn(source)) return;
        depthRef.current = Math.max(0, depthRef.current - 1);
        if (depthRef.current === 0) {
          setFileDropTarget((current) => (current === source ? null : current));
        }
      },
      onDrop: (event: React.DragEvent<HTMLDivElement>) => {
        if (!hasDraggedFiles(event) || !canDropFilesOn(source)) return;
        event.preventDefault();
        event.stopPropagation();
        depthRef.current = 0;
        setFileDropTarget(null);

        const files = Array.from(event.dataTransfer.files ?? []);
        if (files.length === 0) return;

        void uploadFilesToTask(files, { source });
      },
    };
  }

  function renderFileDropOverlay(source: "task" | "comment") {
    if (fileDropTarget !== source) return null;

    return (
      <div
        className={cn(
          "pointer-events-none absolute inset-2 z-50 flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed backdrop-blur-[2px]",
          "border-(--ui-azul-borda) bg-(--ui-superficie-suave) text-(--ui-azul-texto)",
        )}
      >
        <Paperclip className="h-6 w-6" />
        <p className="text-sm font-semibold">
          {source === "comment"
            ? "Solte para anexar ao comentário"
            : "Solte para anexar ao card"}
        </p>
      </div>
    );
  }

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    const input = event.target;

    try {
      await uploadFilesToTask(files, {
        source: uploadSource,
        type: uploadType,
      });
    } finally {
      input.value = "";
    }
  }
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }
    return window.matchMedia("(max-width: 1023px)").matches;
  });
  const [activeTab, setActiveTab] = useState<"comments" | "activity">(
    "comments",
  );
  const [mobilePanelView, setMobilePanelView] = useState<
    "details" | "comments" | "activity"
  >("details");
  const [mobilePanelTransitionDirection, setMobilePanelTransitionDirection] =
    useState<"left" | "right">("right");
  const [isDescEditing, setIsDescEditing] = useState(false);
  const [isDescExpanded, setIsDescExpanded] = useState(false);
  const DESC_CHAR_LIMIT = 300;

  // Comment editing
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [openCommentMenuId, setOpenCommentMenuId] = useState<string | null>(
    null,
  );
  const [openReactionPickerCommentId, setOpenReactionPickerCommentId] =
    useState<string | null>(null);
  const [reactionPickerAnchor, setReactionPickerAnchor] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const [editingCommentText, setEditingCommentText] = useState("");
  const [editMentionTrigger, setEditMentionTrigger] =
    useState<MentionTrigger | null>(null);
  const [editMentionMenuStyle, setEditMentionMenuStyle] =
    useState<CSSProperties>();
  const editTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const editLinkPreviewRef = useRef<HTMLDivElement>(null);
  const editMentionMenuRef = useRef<HTMLDivElement>(null);

  // Checklist
  const [newItemLabels, setNewItemLabels] = useState<Record<string, string>>(
    {},
  );
  const [itemAssigneeMenuOpen, setItemAssigneeMenuOpen] = useState<
    string | null
  >(null);
  const [checklistsCollapsed, setChecklistsCollapsed] = useState<
    Record<string, boolean>
  >({});
  const [checklistsSectionCollapsed, setChecklistsSectionCollapsed] =
    useState(false);
  const [subtasksCollapsed, setSubtasksCollapsed] = useState(false);
  const [linkedItemsCollapsed, setLinkedItemsCollapsed] = useState(false);
  const [attachmentsCollapsed, setAttachmentsCollapsed] = useState(false);
  const [activitySearchQuery, setActivitySearchQuery] = useState("");
  const [isActivitySearchOpen, setIsActivitySearchOpen] = useState(false);
  const [activitySortOrder, setActivitySortOrder] = useState<"desc" | "asc">(
    "desc",
  );
  const [selectedTaskAttachmentIds, setSelectedTaskAttachmentIds] = useState<
    string[]
  >([]);
  const [isDownloadingAttachmentArchive, setIsDownloadingAttachmentArchive] =
    useState(false);
  const [fileDropTarget, setFileDropTarget] = useState<
    "task" | "comment" | null
  >(null);
  const taskDropDepthRef = useRef(0);
  const commentDropDepthRef = useRef(0);
  const [attachmentPreviewState, setAttachmentPreviewState] = useState<{
    attachments: AttachmentPreviewItem[];
    activeIndex: number;
  } | null>(null);

  const [renamingChecklistId, setRenamingChecklistId] = useState<string | null>(
    null,
  );
  const [renameDraft, setRenameDraft] = useState("");
  const [pendingRename, setPendingRename] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [isStatusMenuOpen, setIsStatusMenuOpen] = useState(false);
  const [isNotificationModalOpen, setIsNotificationModalOpen] = useState(false);

  // Confirmation Modal
  const [confirmConfig, setConfirmConfig] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void | Promise<unknown>;
    confirmLabel?: string;
    pendingLabel?: string;
  }>({
    isOpen: false,
    title: "",
    message: "",
    onConfirm: () => {},
    confirmLabel: undefined,
    pendingLabel: undefined,
  });

  // Efeito para fechar menus ao clicar fora (Corrige o bloqueio de scroll)
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      const isInsideNotification =
        target instanceof Element &&
        !!target.closest(
          "[data-task-notification], [data-task-notification-panel]",
        );
      if (
        isAssigneeMenuOpen &&
        assigneeMenuRef.current &&
        !assigneeMenuRef.current.contains(target)
      )
        setIsAssigneeMenuOpen(false);
      if (
        isPriorityMenuOpen &&
        priorityMenuRef.current &&
        !priorityMenuRef.current.contains(target)
      )
        setIsPriorityMenuOpen(false);
      if (
        isTagMenuOpen &&
        tagMenuRef.current &&
        !tagMenuRef.current.contains(target)
      )
        setIsTagMenuOpen(false);
      if (
        isLinkMenuOpen &&
        linkMenuRef.current &&
        !linkMenuRef.current.contains(target)
      )
        setIsLinkMenuOpen(false);
      if (
        isEmojiPickerOpen &&
        emojiPickerRef.current &&
        !emojiPickerRef.current.contains(target)
      )
        setIsEmojiPickerOpen(false);
      if (
        isLeftAttachmentMenuOpen &&
        leftAttachmentMenuRef.current &&
        !leftAttachmentMenuRef.current.contains(target)
      )
        setIsLeftAttachmentMenuOpen(false);
      if (
        isAttachmentMenuOpen &&
        mainAttachmentMenuRef.current &&
        !mainAttachmentMenuRef.current.contains(target)
      )
        setIsAttachmentMenuOpen(false);
      if (
        isStatusMenuOpen &&
        statusMenuRef.current &&
        !statusMenuRef.current.contains(target)
      )
        setIsStatusMenuOpen(false);
      if (isNotificationModalOpen && !isInsideNotification)
        setIsNotificationModalOpen(false);
      if (
        commentMentionTrigger &&
        commentMentionMenuRef.current &&
        !commentMentionMenuRef.current.contains(target) &&
        target !== commentInputRef.current
      ) {
        setCommentMentionTrigger(null);
        setCommentMentionSearch("");
      }
      if (
        descMentionTrigger &&
        descMentionMenuRef.current &&
        !descMentionMenuRef.current.contains(target) &&
        target !== descTextareaRef.current
      ) {
        setDescMentionTrigger(null);
        setDescMentionSearch("");
        setDescMentionMenuStyle(undefined);
      }
      if (
        editMentionTrigger &&
        editMentionMenuRef.current &&
        !editMentionMenuRef.current.contains(target) &&
        target !== editTextareaRef.current
      ) {
        setEditMentionTrigger(null);
        setEditMentionMenuStyle(undefined);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [
    isAssigneeMenuOpen,
    isPriorityMenuOpen,
    isTagMenuOpen,
    isLinkMenuOpen,
    isEmojiPickerOpen,
    isLeftAttachmentMenuOpen,
    isAttachmentMenuOpen,
    isStatusMenuOpen,
    isNotificationModalOpen,
    commentMentionTrigger,
    descMentionTrigger,
    editMentionTrigger,
  ]);

  const activeTaskId = ui.activeTaskIdForDetails as EntityId | null;
  const task = activeTaskId ? graph.tasks[activeTaskId] : null;
  const comments = useMemo(() => {
    if (!task) {
      return [];
    }

    return [...(commentsByTaskId[task.id] ?? [])].sort(
      (left, right) =>
        new Date(right.createdAt).getTime() -
        new Date(left.createdAt).getTime(),
    );
  }, [commentsByTaskId, task]);
  const commentsById = useMemo(
    () =>
      comments.reduce<Record<string, (typeof comments)[number]>>(
        (accumulator, comment) => {
          accumulator[comment.id] = comment;
          return accumulator;
        },
        {},
      ),
    [comments],
  );
  const taskWorkspaceCustomFields = useMemo(() => {
    if (!task?.workspaceId) {
      return [] as CustomFieldDefinition[];
    }

    const workspace = graph.workspaces[task.workspaceId];
    const fieldIds = workspace?.customFieldIds || [];
    const fields = fieldIds.length
      ? fieldIds
          .map((fieldId) => graph.customFieldDefinitions[fieldId])
          .filter(Boolean)
      : Object.values(graph.customFieldDefinitions).filter(
          (field) => field.workspaceId === task.workspaceId,
        );

    return sortCustomFieldDefinitions(fields);
  }, [graph.customFieldDefinitions, graph.workspaces, task?.workspaceId]);
  const unreadNotificationsCount = useTaskStore(
    (state) =>
      state.notifications.filter((notification) => !notification.read).length,
  );

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  function handleDragEnd(event: DragEndEvent, checklistId: string) {
    const { active, over } = event;
    if (active.id !== over?.id && task) {
      const checklist = task.checklists?.find((cl) => cl.id === checklistId);
      if (checklist) {
        const oldIndex = checklist.items.findIndex((it) => it.id === active.id);
        const newIndex = checklist.items.findIndex((it) => it.id === over?.id);
        reorderChecklistItem(task.id, checklistId, oldIndex, newIndex);
      }
    }
  }

  useEffect(() => {
    if (activeTaskId) {
      fetchTaskDetails(activeTaskId);
    }
  }, [activeTaskId, fetchTaskDetails]);

  useEffect(() => {
    return () => descResizeCleanupRef.current?.();
  }, []);

  useEffect(() => {
    const rawDescriptionText = stripRichTextPreservingBreaks(
      task?.description.value,
    );
    const nextDescriptionState = extractManagedLinksFromText(
      rawDescriptionText,
      task?.descriptionLinkDisplayModes,
    );

    setTitleDraft(task?.title ?? "");
    setDescDraft(nextDescriptionState.text);
    setDescLinkDisplayModes(nextDescriptionState.linkDisplayModes);
    setDescEditorHeight(DESC_EDITOR_MIN_HEIGHT);
    setIsDescEditing(false);
    setIsDescExpanded(false);
    setCommentMentionSearch("");
    setDescMentionSearch("");
    setCommentMentionTrigger(null);
    setDescMentionTrigger(null);
    setCommentMentions([]);
    setDescMentions([]);
    setCommentLinkDisplayModes({});
    setEditingCommentLinkDisplayModes({});
    setCommentEditorScroll({ top: 0, left: 0 });
    setDescEditorScroll({ top: 0, left: 0 });
    setDescMentionMenuStyle(undefined);
  }, [
    task?.description.value,
    task?.descriptionLinkDisplayModes,
    task?.id,
    task?.title,
  ]);

  useEffect(() => {
    if (titleRef.current) {
      titleRef.current.style.height = "auto";
      titleRef.current.style.height = titleRef.current.scrollHeight + "px";
    }
  }, [titleDraft]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const mediaQuery = window.matchMedia("(max-width: 1023px)");
    const handleChange = (event: MediaQueryListEvent) => {
      setIsMobileViewport(event.matches);
    };

    setIsMobileViewport(mediaQuery.matches);
    mediaQuery.addEventListener("change", handleChange);

    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    if (isMobileViewport) {
      setIsFullscreen(false);
    }
  }, [isMobileViewport]);

  useEffect(() => {
    if (!isMobileViewport) {
      setMobilePanelView("details");
    }
  }, [isMobileViewport]);

  useEffect(() => {
    setActiveTab("comments");
    setMobilePanelView("details");
    setIsActivitySearchOpen(false);
    setActivitySearchQuery("");
    setSelectedTaskAttachmentIds([]);
    setAttachmentPreviewState(null);
  }, [task?.id]);

  useEffect(() => {
    const nextValues = taskWorkspaceCustomFields.reduce<
      Record<string, CustomFieldValue>
    >((accumulator, field) => {
      const currentValue = task?.customFieldValues?.[field.id];

      if (currentValue !== undefined) {
        accumulator[field.id] = currentValue;
        return accumulator;
      }

      if (field.defaultValue !== undefined) {
        accumulator[field.id] = field.defaultValue;
        return accumulator;
      }

      if (field.type === "checkbox") {
        accumulator[field.id] = false;
      }

      return accumulator;
    }, {});

    setTaskCustomFieldDrafts(nextValues);
    setTaskCustomFieldErrors({});
  }, [task?.customFieldValues, task?.id, taskWorkspaceCustomFields]);

  useEffect(() => {
    syncCommentTextareaHeight();
  }, [commentText]);

  useEffect(() => {
    if (!editingCommentId) return;

    requestAnimationFrame(() => {
      const textarea = editTextareaRef.current;
      if (!textarea) return;
      textarea.focus();
      const cursorPosition = textarea.value.length;
      textarea.setSelectionRange(cursorPosition, cursorPosition);
    });
  }, [editingCommentId]);

  // Abre rename automaticamente apÃ³s criar nova checklist
  useEffect(() => {
    if (pendingRename && task?.checklists && task.checklists.length > 0) {
      const last = task.checklists[task.checklists.length - 1];
      setRenamingChecklistId(last.id);
      setRenameDraft(last.name);
      setPendingRename(false);
    }
  }, [pendingRename, task?.checklists]);

  const activityItems = useMemo(() => {
    if (!task) return [];

    const creatorName =
      (task.ownerId && graph.members[task.ownerId]?.name) || "AlguÃ©m";

    let items: Array<{
      type: "activity" | "comment" | "reply";
      id: string;
      commentIds?: string[];
      date: string;
      label: string;
      sub?: string;
      attachments?: TaskAttachment[];
      children?: any[];
    }> = [];

    if (task.activities && task.activities.length > 0) {
      items = task.activities.map((act) => ({
        type: "activity",
        id: act.id,
        date: act.date,
        // Montado aqui com texto escapado: o rótulo vai para dangerouslySetInnerHTML
        // e nome/descrição trazem texto digitado pelo usuário.
        label:
          act.authorName !== undefined || act.description !== undefined
            ? `<span class="font-bold text-slate-700">${escapeActivityHtml(act.authorName || "Alguém")}</span> ${escapeActivityHtml(act.description || "")}`
            : escapeActivityHtml(String(act.content || "").replace(/<[^>]+>/g, "")),
        sub: "",
      }));
    } else {
      items.push({
        type: "activity",
        id: "created",
        date: task.createdAt,
        label: `<span class="font-bold text-slate-700">${escapeActivityHtml(creatorName)}</span> criou esta tarefa`,
        sub: "",
      });
      if (task.updatedAt && task.updatedAt !== task.createdAt) {
        items.push({
          type: "activity",
          id: "updated",
          date: task.updatedAt,
          label: "O card foi atualizado.",
          sub: "",
        });
      }
    }

    const parents = groupCommentEntries(
      comments.filter((c) => !c.parentId),
      "comment",
    );
    const replies = comments.filter((c) => c.parentId);

    parents.forEach((commentGroup) => {
      const groupedChildren = groupCommentEntries(
        replies.filter((reply) =>
          commentGroup.commentIds.includes(reply.parentId || ""),
        ),
        "reply",
      );

      items.push({
        type: "comment",
        id: commentGroup.id,
        commentIds: commentGroup.commentIds,
        date: commentGroup.date,
        label: commentGroup.label,
        sub: commentGroup.sub,
        attachments: commentGroup.attachments,
        children: groupedChildren,
      });
    });

    let result = items;
    if (activitySearchQuery.trim()) {
      const q = activitySearchQuery.toLowerCase();
      result = items.filter(
        (item) =>
          item.label.toLowerCase().includes(q) ||
          (item.sub && item.sub.toLowerCase().includes(q)) ||
          item.attachments?.some((attachment) =>
            attachment.name.toLowerCase().includes(q),
          ) ||
          (item.children &&
            item.children.some(
              (child) =>
                child.label.toLowerCase().includes(q) ||
                (child.sub && child.sub.toLowerCase().includes(q)) ||
                child.attachments?.some((attachment: TaskAttachment) =>
                  attachment.name.toLowerCase().includes(q),
                ),
            )),
      );
    }

    result.sort((a, b) => {
      const timeDiff = new Date(b.date).getTime() - new Date(a.date).getTime();
      return activitySortOrder === "desc" ? timeDiff : -timeDiff;
    });

    return result;
  }, [task, comments, activitySearchQuery, activitySortOrder, graph.members]);

  const assigneeFilterTags = useMemo(
    () =>
      Array.from(
        new Map(
          Object.values(graph.members || {}).flatMap((member) =>
            (member.tags || []).map((tag) => [tag.id, tag] as const),
          ),
        ).values(),
      ),
    [graph.members],
  );
  const availableAssigneeMembers = useMemo(() => {
    if (!task) return [];

    const normalizedSearch = assigneeSearch.trim().toLowerCase();

    return Object.values(graph.members)
      .filter((member) => !task.assigneeIds.includes(member.id))
      .filter((member) => {
        const memberTagIds = member.tagIds?.length
          ? member.tagIds
          : member.tags?.map((t: any) => t.id) || [];
        const matchesSearch =
          !normalizedSearch ||
          member.name.toLowerCase().includes(normalizedSearch) ||
          member.role?.toLowerCase().includes(normalizedSearch) ||
          member.email?.toLowerCase().includes(normalizedSearch) ||
          member.tags?.some((t: any) =>
            t.name.toLowerCase().includes(normalizedSearch),
          );
        const matchesTag =
          !assigneeTagFilter || memberTagIds.includes(assigneeTagFilter);

        return matchesSearch && matchesTag;
      });
  }, [graph.members, task, assigneeSearch, assigneeTagFilter]);
  const availableTags = useMemo(() => {
    if (!task) return [];

    const normalizedSearch = tagSearch.trim().toLowerCase();

    return Object.values(graph.tags || {})
      .filter(
        (candidateTag) => !task.tags?.some((tag) => tag.id === candidateTag.id),
      )
      .filter(
        (candidateTag) =>
          !normalizedSearch ||
          candidateTag.name.toLowerCase().includes(normalizedSearch),
      );
  }, [graph.tags, task, tagSearch]);
  const linkableTasks = useMemo(() => {
    if (!task) return [];

    const currentList = graph.lists[task.listId];
    if (!currentList) return [];

    return currentList.taskIds.flatMap((candidateTaskId) => {
      if (
        candidateTaskId === task.id ||
        (task.linkedTaskIds || []).includes(candidateTaskId)
      ) {
        return [];
      }

      const candidateTask = graph.tasks[candidateTaskId];
      return candidateTask ? [candidateTask] : [];
    });
  }, [graph.lists, graph.tasks, task]);
  const filteredLinkableTasks = useMemo(() => {
    const normalizedSearch = linkSearch.trim().toLowerCase();

    if (!normalizedSearch) {
      return linkableTasks;
    }

    return linkableTasks.filter((candidateTask) => {
      const statusName =
        graph.statusDefinitions.find(
          (status) => status.id === candidateTask.statusId,
        )?.name || "";

      return (
        candidateTask.title.toLowerCase().includes(normalizedSearch) ||
        statusName.toLowerCase().includes(normalizedSearch)
      );
    });
  }, [linkSearch, linkableTasks, graph.statusDefinitions]);
  const filteredEmojiGroups = useMemo(() => {
    const normalizedSearch = emojiSearch.trim().toLowerCase();
    const baseGroups = normalizedSearch
      ? COMMENT_EMOJI_CATEGORY_GROUPS
      : COMMENT_EMOJI_CATEGORY_GROUPS.filter(
          (group) => group.key === activeEmojiTab,
        );

    return baseGroups
      .map((group) => ({
        ...group,
        emojis: group.emojis.filter((emoji) => {
          if (!normalizedSearch) return true;
          const keywords = [group.title.toLowerCase(), ...group.keywords];
          return (
            keywords.some((keyword) => keyword.includes(normalizedSearch)) ||
            emoji.includes(normalizedSearch)
          );
        }),
      }))
      .filter((group) => group.emojis.length > 0);
  }, [emojiSearch, activeEmojiTab]);
  const mentionableMembers = useMemo(() => {
    const sortedMembers = Object.values(graph.members).sort(
      (memberA, memberB) => memberA.name.localeCompare(memberB.name, "pt-BR"),
    );

    if (!task?.assigneeIds?.length) {
      return sortedMembers;
    }

    return [
      {
        id: ALL_ASSIGNEES_MENTION_ID,
        name: ALL_ASSIGNEES_MENTION_NAME,
        role: "Todos os responsáveis do card",
        avatarColor: "bg-blue-600",
      },
      ...sortedMembers,
    ];
  }, [graph.members, task?.assigneeIds]);
  const filteredCommentMentionMembers = useMemo(() => {
    if (!commentMentionTrigger) return [];

    const typedSearch = commentMentionTrigger.query.trim().toLowerCase();
    const manualSearch = commentMentionSearch.trim().toLowerCase();

    return mentionableMembers.filter((member) => {
      const searchableValues = [
        member.name,
        member.email || "",
        member.role || "",
      ].map((value) => value.toLowerCase());

      const matchesTyped =
        !typedSearch ||
        searchableValues.some((value) => value.includes(typedSearch));
      const matchesManual =
        !manualSearch ||
        searchableValues.some((value) => value.includes(manualSearch));

      return matchesTyped && matchesManual;
    });
  }, [commentMentionSearch, commentMentionTrigger, mentionableMembers]);
  const filteredDescMentionMembers = useMemo(() => {
    if (!descMentionTrigger) return [];

    const typedSearch = descMentionTrigger.query.trim().toLowerCase();
    const manualSearch = descMentionSearch.trim().toLowerCase();

    return mentionableMembers.filter((member) => {
      const searchableValues = [
        member.name,
        member.email || "",
        member.role || "",
      ].map((value) => value.toLowerCase());

      const matchesTyped =
        !typedSearch ||
        searchableValues.some((value) => value.includes(typedSearch));
      const matchesManual =
        !manualSearch ||
        searchableValues.some((value) => value.includes(manualSearch));

      return matchesTyped && matchesManual;
    });
  }, [descMentionSearch, descMentionTrigger, mentionableMembers]);

  const filteredEditMentionMembers = useMemo(() => {
    if (!editMentionTrigger) return [];
    const q = editMentionTrigger.query.trim().toLowerCase();
    return mentionableMembers.filter((m) =>
      [m.name, m.email ?? "", m.role ?? ""].some((v) =>
        v.toLowerCase().includes(q),
      ),
    );
  }, [editMentionTrigger, mentionableMembers]);

  useEffect(() => {
    if (!isAssigneeMenuOpen) {
      setAssigneeSearch("");
      setAssigneeTagFilter(null);
    }
  }, [isAssigneeMenuOpen, activeTaskId]);
  useEffect(() => {
    if (!isTagMenuOpen) {
      setTagSearch("");
    }
  }, [isTagMenuOpen, activeTaskId]);
  useEffect(() => {
    if (!isLinkMenuOpen) {
      setLinkSearch("");
    }
  }, [isLinkMenuOpen, activeTaskId]);
  useEffect(() => {
    if (!isEmojiPickerOpen) {
      setEmojiSearch("");
      setActiveEmojiTab("recent");
    }
  }, [isEmojiPickerOpen]);

  const commentDraftUrls = useMemo(
    () => getManagedLinkUrls(commentText, commentLinkDisplayModes),
    [commentText, commentLinkDisplayModes],
  );
  const descriptionDraftUrls = useMemo(
    () => getManagedLinkUrls(descDraft, descLinkDisplayModes),
    [descDraft, descLinkDisplayModes],
  );
  const editingCommentUrls = useMemo(
    () =>
      getManagedLinkUrls(editingCommentText, editingCommentLinkDisplayModes),
    [editingCommentText, editingCommentLinkDisplayModes],
  );
  const hiddenCommentDraftUrls = useMemo(
    () => getHiddenLinkUrlsForRender(commentDraftUrls, commentLinkDisplayModes),
    [commentDraftUrls, commentLinkDisplayModes],
  );
  const hiddenDescriptionDraftUrls = useMemo(
    () =>
      getHiddenLinkUrlsForRender(descriptionDraftUrls, descLinkDisplayModes),
    [descriptionDraftUrls, descLinkDisplayModes],
  );
  const hiddenEditingCommentUrls = useMemo(
    () =>
      getHiddenLinkUrlsForRender(
        editingCommentUrls,
        editingCommentLinkDisplayModes,
      ),
    [editingCommentUrls, editingCommentLinkDisplayModes],
  );
  const descriptionInlineChecklist = useMemo(
    () => parseInlineChecklistText(descDraft),
    [descDraft],
  );
  const commentInlineChecklist = useMemo(
    () => parseInlineChecklistText(commentText),
    [commentText],
  );
  const editingCommentInlineChecklist = useMemo(
    () => parseInlineChecklistText(editingCommentText),
    [editingCommentText],
  );
  const shouldUseDescriptionMentionPreview =
    descDraft.includes("@") && !descriptionInlineChecklist;
  const shouldUseCommentMentionPreview =
    commentText.includes("@") && !commentInlineChecklist;
  const shouldUseEditingCommentPreview =
    editingCommentText.includes("@") && !editingCommentInlineChecklist;
  const hasDescriptionContent =
    descDraft.trim().length > 0 || descriptionDraftUrls.length > 0;
  const modalBreadcrumbTaskIds = useMemo(() => {
    const historyBreadcrumbs = (taskHistory ?? []).filter(
      (historyTaskId) => historyTaskId !== activeTaskId,
    );

    if (historyBreadcrumbs.length > 0) {
      return historyBreadcrumbs;
    }

    if (!task?.parentTaskId) {
      return [];
    }

    const ancestorIds: string[] = [];
    const visitedIds = new Set<string>(task.id ? [task.id] : []);
    let currentParentId: string | null = task.parentTaskId ?? null;

    while (currentParentId && !visitedIds.has(currentParentId)) {
      ancestorIds.push(currentParentId);
      visitedIds.add(currentParentId);
      currentParentId = graph.tasks[currentParentId]?.parentTaskId ?? null;
    }

    return ancestorIds.reverse();
  }, [activeTaskId, graph.tasks, task?.id, task?.parentTaskId, taskHistory]);

  // Importante: os hooks acima precisam rodar sempre; sÃ³ depois podemos decidir renderizar ou não
  if (!activeTaskId || !task) return null;

  const status = graph.statusDefinitions.find((s) => s.id === task.statusId);
  const taskId = task.id;
  const isFullViewportModal = isFullscreen || isMobileViewport;
  const permission = getWorkspacePermissionForTask(graph, taskId);
  const canEditTask = hasWorkspacePermission(permission, "edit");
  const canCommentTask = hasWorkspacePermission(permission, "comment");
  const canMoveTaskStatus = canMoveTask(
    task,
    permission,
    authUser?.id,
    authUser?.organization?.role === "owner" ||
      authUser?.organization?.role === "admin",
  );
  const canCollaborateTask = canCommentTask;

  const handleTaskCustomFieldDraftChange = (
    fieldId: EntityId,
    value: CustomFieldValue,
  ) => {
    setTaskCustomFieldDrafts((current) => ({
      ...current,
      [fieldId]: value,
    }));
    setTaskCustomFieldErrors((current) => {
      if (!current[fieldId]) {
        return current;
      }

      const nextErrors = { ...current };
      delete nextErrors[fieldId];
      return nextErrors;
    });
  };

  const handleTaskCustomFieldCommit = async (
    fieldId: EntityId,
    value: CustomFieldValue,
  ) => {
    const nextValues = {
      ...taskCustomFieldDrafts,
      [fieldId]: value,
    };
    const nextErrors = validateCustomFieldValues(
      taskWorkspaceCustomFields,
      nextValues,
    );

    setTaskCustomFieldDrafts(nextValues);
    setTaskCustomFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    const didPersist = await updateTaskCustomFieldValues(taskId, nextValues);
    if (!didPersist) {
      await fetchTaskDetails(taskId);
    }
  };

  const assignees = task.assigneeIds
    .map((id) => graph.members[id])
    .filter(Boolean);
  const taskTitle = task.title;
  const taskAssigneeIds = task.assigneeIds;
  const taskAttachments = task.attachments ?? [];
  const hasStagedCommentAttachments = stagedCommentAttachments.length > 0;
  const hasPendingTaskAttachments = stagedTaskAttachments.length > 0;
  const selectedTaskAttachments = taskAttachments.filter((attachment) =>
    selectedTaskAttachmentIds.includes(attachment.id),
  );

  function buildAttachmentArchiveName(mode: "all" | "selected") {
    const normalizedTitle = taskTitle
      .toLowerCase()
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48);

    return `${normalizedTitle || "card"}-anexos-${mode}`;
  }

  function toggleTaskAttachmentSelection(attachmentId: string) {
    setSelectedTaskAttachmentIds((current) =>
      current.includes(attachmentId)
        ? current.filter((id) => id !== attachmentId)
        : [...current, attachmentId],
    );
  }

  async function handleDownloadTaskAttachments(
    attachments: typeof taskAttachments,
    mode: "all" | "selected",
  ) {
    if (attachments.length === 0 || isDownloadingAttachmentArchive) {
      return;
    }

    setIsDownloadingAttachmentArchive(true);

    try {
      await downloadAttachmentArchive({
        attachments: attachments.map((attachment) => ({
          url: attachment.url,
          fileName: attachment.name,
        })),
        archiveName: buildAttachmentArchiveName(mode),
      });
    } finally {
      setIsDownloadingAttachmentArchive(false);
    }
  }

  function openAttachmentPreview(
    attachments: AttachmentPreviewItem[],
    activeAttachmentId?: string,
  ) {
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
  }

  function openTaskDetailsFromBreadcrumb(targetTaskId: string) {
    const targetIndex = modalBreadcrumbTaskIds.indexOf(targetTaskId);

    if (targetIndex === -1) {
      openTaskDetails(targetTaskId);
      return;
    }

    useTaskStore.setState((state) => ({
      ui: {
        ...state.ui,
        activeTaskIdForDetails: targetTaskId,
        taskHistory: modalBreadcrumbTaskIds.slice(0, targetIndex),
      },
    }));
  }

  function handleModalNavigateBack() {
    if (modalBreadcrumbTaskIds.length === 0) {
      closeTaskDetails();
      return;
    }

    const previousTaskId =
      modalBreadcrumbTaskIds[modalBreadcrumbTaskIds.length - 1];
    openTaskDetailsFromBreadcrumb(previousTaskId);
  }

  function resolveTaskMentionIds(
    text: string,
    mentions: Array<{ id: string; name: string }>,
  ) {
    const directMentionIds = resolveMentionIds(
      text,
      mentions.filter((mention) => mention.id !== ALL_ASSIGNEES_MENTION_ID),
    );
    const shouldMentionAllAssignees =
      text.includes(`@${ALL_ASSIGNEES_MENTION_NAME}`) &&
      taskAssigneeIds.length > 0;

    if (!shouldMentionAllAssignees) {
      return directMentionIds;
    }

    return Array.from(new Set([...directMentionIds, ...taskAssigneeIds]));
  }

  function updateCommentDraftLinkMode(url: string, mode: LinkDisplayMode) {
    setCommentLinkDisplayModes((current) =>
      updateLinkDisplayModeMap(current, url, mode),
    );
  }

  function updateDescriptionDraftLinkMode(url: string, mode: LinkDisplayMode) {
    setDescLinkDisplayModes((current) =>
      updateLinkDisplayModeMap(current, url, mode),
    );
  }

  function updateEditingCommentDraftLinkMode(
    url: string,
    mode: LinkDisplayMode,
  ) {
    setEditingCommentLinkDisplayModes((current) =>
      updateLinkDisplayModeMap(current, url, mode),
    );
  }

  function persistDescriptionLinkMode(url: string, mode: LinkDisplayMode) {
    updateDescriptionDraftLinkMode(url, mode);
    void updateTaskDescriptionLinkDisplayMode(
      taskId,
      normalizeLinkUrl(url),
      mode,
    );
  }

  async function editPersistedDescriptionLink(url: string) {
    const nextUrl = window.prompt("Editar link", url);
    if (!nextUrl) return;

    const nextText = replaceUrlInText(descDraft, url, nextUrl);
    const nextLinkModes = renameLinkDisplayModeKey(
      descLinkDisplayModes,
      url,
      nextUrl,
    );

    setDescDraft(nextText);
    setDescLinkDisplayModes(nextLinkModes);
    await updateTaskDescription(
      taskId,
      nextText,
      resolveTaskMentionIds(nextText, mentionableMembers),
      nextLinkModes,
    );
  }

  async function removePersistedDescriptionLink(url: string) {
    const previousText = descDraft;
    const previousLinkModes = descLinkDisplayModes;
    const nextText = removeUrlFromText(descDraft, url);
    const nextLinkModes = removeLinkDisplayModeKey(descLinkDisplayModes, url);

    setDescDraft(nextText);
    setDescLinkDisplayModes(nextLinkModes);
    const didPersist = await updateTaskDescription(
      taskId,
      nextText,
      resolveTaskMentionIds(nextText, mentionableMembers),
      nextLinkModes,
    );

    if (!didPersist) {
      setDescDraft(previousText);
      setDescLinkDisplayModes(previousLinkModes);
      return;
    }

    await fetchTaskDetails(taskId);
  }

  async function editPersistedCommentLink(
    commentId: string,
    currentText: string,
    currentModes: Record<string, LinkDisplayMode> | undefined,
    url: string,
  ) {
    const nextUrl = window.prompt("Editar link", url);
    if (!nextUrl) return;

    const nextText = replaceUrlInText(currentText, url, nextUrl);
    const nextLinkModes = renameLinkDisplayModeKey(currentModes, url, nextUrl);

    await editComment(
      taskId,
      commentId,
      nextText,
      resolveTaskMentionIds(nextText, mentionableMembers),
      nextLinkModes,
    );
  }

  async function removePersistedCommentLink(
    commentId: string,
    currentText: string,
    currentModes: Record<string, LinkDisplayMode> | undefined,
    url: string,
  ) {
    const nextText = removeUrlFromText(currentText, url);
    const nextLinkModes = removeLinkDisplayModeKey(currentModes, url);

    const didPersist = await editComment(
      taskId,
      commentId,
      nextText,
      resolveTaskMentionIds(nextText, mentionableMembers),
      nextLinkModes,
    );

    if (!didPersist) {
      return;
    }

    await fetchTaskDetails(taskId);
  }

  function editDescriptionDraftLink(url: string) {
    const nextUrl = window.prompt("Editar link", url);
    if (!nextUrl) return;

    setDescDraft((current) => replaceUrlInText(current, url, nextUrl));
    setDescLinkDisplayModes((current) =>
      renameLinkDisplayModeKey(current, url, nextUrl),
    );
  }

  function removeDescriptionDraftLink(url: string) {
    setDescDraft((current) => removeUrlFromText(current, url));
    setDescLinkDisplayModes((current) =>
      removeLinkDisplayModeKey(current, url),
    );
  }

  function editCommentDraftLink(url: string) {
    const nextUrl = window.prompt("Editar link", url);
    if (!nextUrl) return;

    setCommentText((current) => replaceUrlInText(current, url, nextUrl));
    setCommentLinkDisplayModes((current) =>
      renameLinkDisplayModeKey(current, url, nextUrl),
    );
  }

  function removeCommentDraftLink(url: string) {
    setCommentText((current) => removeUrlFromText(current, url));
    setCommentLinkDisplayModes((current) =>
      removeLinkDisplayModeKey(current, url),
    );
  }

  function editEditingCommentDraftLink(url: string) {
    const nextUrl = window.prompt("Editar link", url);
    if (!nextUrl) return;

    setEditingCommentText((current) => replaceUrlInText(current, url, nextUrl));
    setEditingCommentLinkDisplayModes((current) =>
      renameLinkDisplayModeKey(current, url, nextUrl),
    );
  }

  function removeEditingCommentDraftLink(url: string) {
    setEditingCommentText((current) => removeUrlFromText(current, url));
    setEditingCommentLinkDisplayModes((current) =>
      removeLinkDisplayModeKey(current, url),
    );
  }

  function commitTitle() {
    if (!canEditTask) return;
    updateTaskTitle(taskId, titleDraft);
  }

  function commitDescription() {
    if (!canEditTask) return;
    updateTaskDescription(
      taskId,
      descDraft,
      resolveTaskMentionIds(descDraft, descMentions),
      descLinkDisplayModes,
    );
  }

  function syncCommentMentionState(
    value: string,
    cursorPosition: number | null | undefined,
  ) {
    const nextTrigger = getMentionTrigger(value, cursorPosition);
    setCommentMentionTrigger(nextTrigger);
    if (!nextTrigger) {
      setCommentMentionSearch("");
    }
  }

  function syncCommentChecklistTrailingMentionState(
    value: string,
    cursorPosition: number | null | undefined,
    _textarea: HTMLTextAreaElement | null,
    offset: number,
  ) {
    const nextTrigger = getMentionTrigger(value, cursorPosition);
    setCommentMentionTrigger(
      nextTrigger
        ? {
            ...nextTrigger,
            start: nextTrigger.start + offset,
            end: nextTrigger.end + offset,
          }
        : null,
    );
    if (!nextTrigger) {
      setCommentMentionSearch("");
    }
  }

  function syncCommentTextareaHeight(textarea?: HTMLTextAreaElement | null) {
    const element = textarea ?? commentInputRef.current;
    if (!element) return;

    const maxHeight = 104;
    element.style.height = "auto";
    const nextHeight = Math.min(element.scrollHeight, maxHeight);
    element.style.height = `${nextHeight}px`;
    element.style.overflowY =
      element.scrollHeight > maxHeight ? "auto" : "hidden";
  }

  function updateDescMentionMenuPosition(
    textarea: HTMLTextAreaElement | null,
    cursorPosition: number | null | undefined,
  ) {
    if (!textarea || cursorPosition === null || cursorPosition === undefined) {
      setDescMentionMenuStyle(undefined);
      return;
    }

    const caret = getTextareaCaretCoordinates(textarea, cursorPosition);
    const pickerWidth = Math.min(
      288,
      Math.max(224, textarea.clientWidth * 0.58),
    );
    const maxLeft = Math.max(12, textarea.clientWidth - pickerWidth - 12);
    const nextLeft =
      caret.left > textarea.clientWidth * 0.56
        ? caret.left - pickerWidth + 24
        : caret.left + 20;

    setDescMentionMenuStyle({
      top: Math.max(10, caret.top + Math.max(caret.lineHeight - 8, 14)),
      left: Math.min(Math.max(12, nextLeft), maxLeft),
      width: pickerWidth,
    });
  }

  function syncDescMentionState(
    value: string,
    cursorPosition: number | null | undefined,
    textarea?: HTMLTextAreaElement | null,
  ) {
    const nextTrigger = getMentionTrigger(value, cursorPosition);
    setDescMentionTrigger(nextTrigger);
    if (!nextTrigger) {
      setDescMentionSearch("");
      setDescMentionMenuStyle(undefined);
      return;
    }

    updateDescMentionMenuPosition(
      textarea ?? descTextareaRef.current,
      nextTrigger.end,
    );
  }

  function syncDescChecklistTrailingMentionState(
    value: string,
    cursorPosition: number | null | undefined,
    textarea: HTMLTextAreaElement | null,
    offset: number,
  ) {
    const nextTrigger = getMentionTrigger(value, cursorPosition);
    setDescMentionTrigger(
      nextTrigger
        ? {
            ...nextTrigger,
            start: nextTrigger.start + offset,
            end: nextTrigger.end + offset,
          }
        : null,
    );
    if (!nextTrigger) {
      setDescMentionSearch("");
      setDescMentionMenuStyle(undefined);
      return;
    }

    updateDescMentionMenuPosition(textarea, nextTrigger.end);
  }

  function handleCommentChange(event: React.ChangeEvent<HTMLTextAreaElement>) {
    const nextValue = extractManagedLinksFromText(
      event.target.value,
      commentLinkDisplayModes,
    );

    setCommentText(nextValue.text);
    setCommentLinkDisplayModes(nextValue.linkDisplayModes);
    syncCommentMentionState(nextValue.text, event.target.selectionStart);
    syncCommentTextareaHeight(event.target);
  }

  function handleDescChange(event: React.ChangeEvent<HTMLTextAreaElement>) {
    const nextValue = extractManagedLinksFromText(
      event.target.value,
      descLinkDisplayModes,
    );

    setDescDraft(nextValue.text);
    setDescLinkDisplayModes(nextValue.linkDisplayModes);
    syncDescMentionState(
      nextValue.text,
      event.target.selectionStart,
      event.target,
    );
  }

  function startDescriptionResize(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault();

    const startY = event.clientY;
    const startHeight =
      descTextareaRef.current?.offsetHeight ?? descEditorHeight;

    descResizeCleanupRef.current?.();

    const previousUserSelect = document.body.style.userSelect;
    const previousCursor = document.body.style.cursor;

    document.body.style.userSelect = "none";
    document.body.style.cursor = "row-resize";

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const viewportMaxHeight = Math.min(
        DESC_EDITOR_MAX_HEIGHT,
        Math.max(DESC_EDITOR_MIN_HEIGHT, Math.round(window.innerHeight * 0.45)),
      );
      const nextHeight = Math.min(
        viewportMaxHeight,
        Math.max(
          DESC_EDITOR_MIN_HEIGHT,
          startHeight + moveEvent.clientY - startY,
        ),
      );

      setDescEditorHeight(nextHeight);
    };

    const cleanup = () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", cleanup);
      document.body.style.userSelect = previousUserSelect;
      document.body.style.cursor = previousCursor;
      if (descResizeCleanupRef.current === cleanup) {
        descResizeCleanupRef.current = null;
      }
    };

    descResizeCleanupRef.current = cleanup;
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", cleanup);
  }

  function handleCommentMentionSelect(member: Member) {
    if (!commentMentionTrigger) return;
    const nextValue = insertMentionIntoText(
      commentText,
      commentMentionTrigger,
      member.name,
    );
    setCommentText(nextValue.text);
    setCommentMentions((current) => [
      ...current.filter((mention) => mention.id !== member.id),
      { id: member.id, name: member.name },
    ]);
    setCommentMentionTrigger(null);
    setCommentMentionSearch("");
    requestAnimationFrame(() => {
      const mainTextarea = commentInputRef.current;
      if (mainTextarea) {
        mainTextarea.focus();
        mainTextarea.setSelectionRange(
          nextValue.cursorPosition,
          nextValue.cursorPosition,
        );
        return;
      }

      const checklistTextarea = commentChecklistTrailingTextareaRef.current;
      if (!checklistTextarea) return;
      const cursorPosition = getInlineChecklistTrailingCursorPosition(
        nextValue.text,
        nextValue.cursorPosition,
      );
      checklistTextarea.focus();
      checklistTextarea.setSelectionRange(cursorPosition, cursorPosition);
    });
  }

  function handleDescMentionSelect(member: Member) {
    if (!descMentionTrigger) return;
    const nextValue = insertMentionIntoText(
      descDraft,
      descMentionTrigger,
      member.name,
    );
    setDescDraft(nextValue.text);
    setDescMentions((current) => [
      ...current.filter((mention) => mention.id !== member.id),
      { id: member.id, name: member.name },
    ]);
    setDescMentionTrigger(null);
    setDescMentionSearch("");
    setDescMentionMenuStyle(undefined);
    requestAnimationFrame(() => {
      const mainTextarea = descTextareaRef.current;
      if (mainTextarea) {
        mainTextarea.focus();
        mainTextarea.setSelectionRange(
          nextValue.cursorPosition,
          nextValue.cursorPosition,
        );
        return;
      }

      const checklistTextarea = descChecklistTrailingTextareaRef.current;
      if (!checklistTextarea) return;
      const cursorPosition = getInlineChecklistTrailingCursorPosition(
        nextValue.text,
        nextValue.cursorPosition,
      );
      checklistTextarea.focus();
      checklistTextarea.setSelectionRange(cursorPosition, cursorPosition);
    });
  }

  async function toggleDescriptionChecklistItem(index: number) {
    const previousText = descDraft;
    const nextText = updateInlineChecklistText(descDraft, (state) => ({
      ...state,
      items: state.items.map((item, itemIndex) =>
        itemIndex === index ? { ...item, checked: !item.checked } : item,
      ),
    }));

    if (nextText === previousText) {
      return;
    }

    setDescDraft(nextText);
    const didPersist = await updateTaskDescription(
      taskId,
      nextText,
      resolveTaskMentionIds(nextText, mentionableMembers),
      descLinkDisplayModes,
    );

    if (!didPersist) {
      setDescDraft(previousText);
    }
  }

  async function togglePersistedCommentChecklistItem(
    commentId: string,
    currentText: string,
    currentModes: Record<string, LinkDisplayMode> | undefined,
    index: number,
  ) {
    const nextText = updateInlineChecklistText(currentText, (state) => ({
      ...state,
      items: state.items.map((item, itemIndex) =>
        itemIndex === index ? { ...item, checked: !item.checked } : item,
      ),
    }));

    if (nextText === currentText) {
      return;
    }

    await editComment(
      taskId,
      commentId,
      nextText,
      resolveTaskMentionIds(nextText, mentionableMembers),
      currentModes,
    );
  }

  function hasSelectionInside(container: HTMLElement) {
    if (typeof window === "undefined") return false;

    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
      return false;
    }

    const anchorNode = selection.anchorNode;
    const focusNode = selection.focusNode;

    return !!(
      anchorNode &&
      focusNode &&
      container.contains(anchorNode) &&
      container.contains(focusNode)
    );
  }

  function handleDescriptionReadMouseDown(
    event: React.MouseEvent<HTMLDivElement>,
  ) {
    if (event.button !== 0) return;

    descReadInteractionRef.current = {
      pointerDownAt: Date.now(),
      x: event.clientX,
      y: event.clientY,
      ignoreNextClick: false,
    };
  }

  function handleDescriptionReadMouseUp(
    event: React.MouseEvent<HTMLDivElement>,
  ) {
    const interaction = descReadInteractionRef.current;
    const movedDistance = Math.hypot(
      event.clientX - interaction.x,
      event.clientY - interaction.y,
    );
    const heldTooLong = Date.now() - interaction.pointerDownAt > 250;

    interaction.ignoreNextClick =
      movedDistance > 4 ||
      heldTooLong ||
      hasSelectionInside(event.currentTarget);
  }

  async function handleSubmitComment(event: React.FormEvent) {
    event.preventDefault();
    if (!canCommentTask) return;
    if (isUploadingCommentAttachment) return;
    if (!commentText.trim() && stagedCommentAttachments.length === 0) return;
    const mentionIds = resolveTaskMentionIds(commentText, commentMentions);
    const attachmentsToSubmit = stagedCommentAttachments.flatMap(
      (attachment) =>
        attachment.url
          ? ([
              { ...attachment, url: attachment.url },
            ] satisfies TaskAttachment[])
          : [],
    );
    const commentPayloads =
      attachmentsToSubmit.length > 0
        ? attachmentsToSubmit.map((attachment, index) => ({
            content: index === 0 ? commentText : "",
            attachment,
            mentionIds: index === 0 ? mentionIds : [],
            linkDisplayModes: index === 0 ? commentLinkDisplayModes : {},
          }))
        : [
            {
              content: commentText,
              attachment: undefined,
              mentionIds,
              linkDisplayModes: commentLinkDisplayModes,
            },
          ];

    for (const payload of commentPayloads) {
      const submittedComment = replyingToId
        ? await addComment(
            taskId,
            payload.content,
            replyingToId,
            payload.attachment,
            payload.mentionIds,
            payload.linkDisplayModes,
          )
        : await addComment(
            taskId,
            payload.content,
            undefined,
            payload.attachment,
            payload.mentionIds,
            payload.linkDisplayModes,
          );
      if (!submittedComment) return;
    }

    if (replyingToId) {
      setReplyingToId(null);
    }
    setCommentText("");
    setCommentMentionSearch("");
    setCommentMentionTrigger(null);
    setCommentMentions([]);
    setCommentLinkDisplayModes({});
    setCommentEditorScroll({ top: 0, left: 0 });
    setStagedCommentAttachments([]);
    setIsUploadingCommentAttachment(false);
  }

  function handleCommentLikeToggle(commentId: string) {
    if (!canCommentTask) return;
    void persistCommentLike(taskId, commentId);
  }

  function setEmojiForComment(
    commentId: string,
    currentReaction: string | null | undefined,
    emoji: string,
  ) {
    if (!canCommentTask) return;
    setOpenReactionPickerCommentId(null);
    void persistCommentReaction(
      taskId,
      commentId,
      currentReaction === emoji ? null : emoji,
    );
  }

  function syncEditMentionState(
    value: string,
    cursorPosition: number | null | undefined,
    textarea?: HTMLTextAreaElement | null,
  ) {
    const nextTrigger = getMentionTrigger(value, cursorPosition);
    setEditMentionTrigger(nextTrigger);
    if (!nextTrigger) {
      setEditMentionMenuStyle(undefined);
      return;
    }

    const targetTextarea = textarea ?? editTextareaRef.current;
    if (!targetTextarea) {
      return;
    }

    const caret = getTextareaCaretCoordinates(targetTextarea, nextTrigger.end);
    const textareaRect = targetTextarea.getBoundingClientRect();
    const viewportPadding = 12;
    const pickerWidth = Math.min(288, Math.max(224, textareaRect.width));
    const left = Math.min(
      Math.max(viewportPadding, textareaRect.left),
      window.innerWidth - pickerWidth - viewportPadding,
    );
    const estimatedPickerHeight = 224;
    const desiredTop =
      textareaRect.top + caret.top - estimatedPickerHeight - 12;
    const fallbackTop = textareaRect.bottom + 8;

    setEditMentionMenuStyle({
      top:
        desiredTop >= viewportPadding
          ? desiredTop
          : Math.min(
              fallbackTop,
              window.innerHeight - estimatedPickerHeight - viewportPadding,
            ),
      left,
      width: pickerWidth,
    });
  }

  function syncEditChecklistTrailingMentionState(
    value: string,
    cursorPosition: number | null | undefined,
    textarea: HTMLTextAreaElement | null,
    offset: number,
  ) {
    const nextTrigger = getMentionTrigger(value, cursorPosition);
    setEditMentionTrigger(
      nextTrigger
        ? {
            ...nextTrigger,
            start: nextTrigger.start + offset,
            end: nextTrigger.end + offset,
          }
        : null,
    );
    if (!nextTrigger) {
      setEditMentionMenuStyle(undefined);
      return;
    }

    const targetTextarea = textarea ?? editTextareaRef.current;
    if (!targetTextarea) {
      return;
    }

    const caret = getTextareaCaretCoordinates(targetTextarea, nextTrigger.end);
    const textareaRect = targetTextarea.getBoundingClientRect();
    const viewportPadding = 12;
    const pickerWidth = Math.min(288, Math.max(224, textareaRect.width));
    const left = Math.min(
      Math.max(viewportPadding, textareaRect.left),
      window.innerWidth - pickerWidth - viewportPadding,
    );
    const estimatedPickerHeight = 224;
    const desiredTop =
      textareaRect.top + caret.top - estimatedPickerHeight - 12;
    const fallbackTop = textareaRect.bottom + 8;

    setEditMentionMenuStyle({
      top:
        desiredTop >= viewportPadding
          ? desiredTop
          : Math.min(
              fallbackTop,
              window.innerHeight - estimatedPickerHeight - viewportPadding,
            ),
      left,
      width: pickerWidth,
    });
  }

  function handleEditMentionSelect(member: Member) {
    if (!editMentionTrigger) return;
    const nextValue = insertMentionIntoText(
      editingCommentText,
      editMentionTrigger,
      member.name,
    );
    setEditingCommentText(nextValue.text);
    setEditMentionTrigger(null);
    setEditMentionMenuStyle(undefined);
    requestAnimationFrame(() => {
      const mainTextarea = editTextareaRef.current;
      if (mainTextarea) {
        mainTextarea.focus();
        mainTextarea.setSelectionRange(
          nextValue.cursorPosition,
          nextValue.cursorPosition,
        );
        return;
      }

      const checklistTextarea = editChecklistTrailingTextareaRef.current;
      if (!checklistTextarea) return;
      const cursorPosition = getInlineChecklistTrailingCursorPosition(
        nextValue.text,
        nextValue.cursorPosition,
      );
      checklistTextarea.focus();
      checklistTextarea.setSelectionRange(cursorPosition, cursorPosition);
    });
  }

  function handleEmojiSelect(emoji: string) {
    if (!canCommentTask) return;
    setCommentText((current) => {
      const nextValue = `${current}${emoji}`;
      syncCommentMentionState(nextValue, nextValue.length);
      requestAnimationFrame(() => {
        const textarea = commentInputRef.current;
        if (!textarea) return;
        textarea.focus();
        const cursorPosition = nextValue.length;
        textarea.setSelectionRange(cursorPosition, cursorPosition);
      });
      return nextValue;
    });
  }

  const getMobilePanelViewIndex = (
    view: "details" | "comments" | "activity",
  ) => {
    if (view === "details") return 0;
    if (view === "comments") return 1;
    return 2;
  };

  const switchMobilePanelView = (
    nextView: "details" | "comments" | "activity",
  ) => {
    if (!isMobileViewport) return;

    const currentIndex = getMobilePanelViewIndex(mobilePanelView);
    const nextIndex = getMobilePanelViewIndex(nextView);

    setMobilePanelTransitionDirection(
      nextIndex >= currentIndex ? "right" : "left",
    );

    if (nextView === "details") {
      setMobilePanelView("details");
      setIsActivitySearchOpen(false);
      setActivitySearchQuery("");
      return;
    }

    setActiveTab(nextView === "activity" ? "activity" : "comments");
    setMobilePanelView(nextView);
  };

  const showTaskDetailsPanel =
    !isMobileViewport || mobilePanelView === "details";
  const showTaskEngagementPanel =
    !isMobileViewport || mobilePanelView !== "details";

  return (
    <div
      className="pauta-task-details-modal pauta-theme-overlay fixed inset-0 z-100 flex items-end justify-center p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={(e) => e.target === e.currentTarget && closeTaskDetails()}
    >
      <div
        className={cn(
          "pauta-task-details-modal-panel relative flex flex-col overflow-hidden transition-all duration-300",
          "pauta-theme-surface border-(--ui-borda) bg-(--ui-superficie-suave)",
          isMobileViewport
            ? "h-dvh w-full max-w-none rounded-none border-0"
            : isFullViewportModal
              ? "h-[98vh] w-[98vw] max-w-none rounded-2xl border"
              : "h-[85vh] w-[95vw] max-w-7xl rounded-2xl border",
        )}
      >
        {/* Top bar: data criação + expand + close */}
        <div
          className={cn(
            "sticky top-0 z-20 flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2 sm:px-4",
            "border-(--ui-borda-suave) bg-(--ui-superficie)",
          )}
          style={
            isMobileViewport
              ? {
                  paddingTop: "calc(env(safe-area-inset-top, 0px) + 0.5rem)",
                  paddingLeft: "calc(env(safe-area-inset-left, 0px) + 0.75rem)",
                  paddingRight:
                    "calc(env(safe-area-inset-right, 0px) + 0.75rem)",
                }
              : undefined
          }
        >
          <div
            className={cn(
              "min-w-0 flex items-center gap-1.5 text-[10px] font-medium sm:text-[11px]",
              "text-(--ui-texto-secundario)",
            )}
          >
            <Calendar className="h-3.5 w-3.5" />
            <span className="truncate">
              Criado em{" "}
              <span
                className={cn(
                  "font-semibold",
                  "text-(--ui-texto-secundario)",
                )}
              >
                {task?.createdAt
                  ? new Date(task.createdAt).toLocaleString("pt-BR", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : "—"}
              </span>
            </span>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <div data-task-notification className="relative">
              <button
                ref={notificationButtonRef}
                type="button"
                onClick={() => setIsNotificationModalOpen((value) => !value)}
                className={cn(
                  "pauta-touch-target relative inline-flex h-8 w-8 items-center justify-center rounded-lg cursor-pointer",
                  "border border-(--ui-borda) text-(--ui-texto-secundario) hover:bg-(--ui-hover) hover:text-(--ui-azul-texto)",
                  "transition",
                )}
                title="Notificações"
              >
                <Bell className="h-4 w-4" />
                {unreadNotificationsCount > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full border border-white bg-rose-500 px-1 text-[8px] font-black text-white">
                    {unreadNotificationsCount}
                  </span>
                )}
              </button>
              <NotificationModal
                isOpen={isNotificationModalOpen}
                onClose={() => setIsNotificationModalOpen(false)}
                anchored
                anchorRef={notificationButtonRef}
              />
            </div>
            {!isMobileViewport && (
              <button
                type="button"
                onClick={() => setIsFullscreen(!isFullscreen)}
                className={cn(
                  "pauta-touch-target inline-flex h-8 w-8 items-center justify-center rounded-lg cursor-pointer",
                  "border border-(--ui-borda) text-(--ui-texto-secundario) hover:bg-(--ui-hover) hover:text-(--ui-texto-forte)",
                  "transition",
                )}
                title={isFullscreen ? "Minimizar" : "Expandir"}
              >
                {isFullscreen ? (
                  <Minimize2 className="h-4 w-4" />
                ) : (
                  <Maximize2 className="h-4 w-4" />
                )}
              </button>
            )}
            {canEditTask && (
              <button
                type="button"
                onClick={() => {
                  setConfirmConfig({
                    isOpen: true,
                    title: "Excluir card",
                    message:
                      "Deseja excluir este card? Ele vai para a lixeira e pode ser restaurado dentro do prazo do seu plano.",
                    onConfirm: () => deleteTask(taskId),
                    confirmLabel: "Excluir",
                    pendingLabel: "Excluindo...",
                  });
                }}
                className={cn(
                  "pauta-touch-target inline-flex h-8 w-8 items-center justify-center rounded-lg cursor-pointer",
                  "border border-(--ui-borda) text-(--ui-texto-secundario) hover:bg-(--ui-rose-fundo) hover:text-(--ui-rose-texto)",
                  "transition",
                )}
                title="Excluir card"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
            <button
              type="button"
              onClick={closeTaskDetails}
              className={cn(
                "pauta-touch-target inline-flex h-8 w-8 items-center justify-center rounded-lg cursor-pointer",
                "border border-(--ui-borda) text-(--ui-texto-secundario) hover:bg-(--ui-hover) hover:text-(--ui-texto-forte)",
                "transition",
              )}
            
              aria-label="Fechar"
              title="Fechar"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className={cn("flex min-h-0 flex-1 overflow-hidden", "flex-row")}>
          {/* Coluna esquerda: scroll em todo o conteÃºdo */}
          {showTaskDetailsPanel && (
            <div
              className={cn(
                "pauta-scroll-safe relative z-10 flex min-w-0 flex-1 flex-col overflow-y-auto px-4 py-3 sm:px-5 sm:py-4",
                isMobileViewport && "animate-in fade-in duration-200",
                isMobileViewport &&
                  (mobilePanelTransitionDirection === "right"
                    ? "slide-in-from-left-2"
                    : "slide-in-from-right-2"),
              )}
              {...getFileDropHandlers("task")}
            >
              {renderFileDropOverlay("task")}
              {/* Breadcrumbs e Botão Voltar */}
              {modalBreadcrumbTaskIds.length > 0 && (
                <div className="mb-4 flex items-center gap-2 overflow-hidden px-1">
                  <button
                    onClick={handleModalNavigateBack}
                    className={cn(
                      "group flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition cursor-pointer",
                      "bg-(--ui-fundo-sutil) text-(--ui-texto-secundario) hover:bg-(--ui-azul-fundo) hover:text-(--ui-azul-texto)",
                    )}
                    title="Voltar"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                  </button>
                  <div
                    className={cn(
                      "flex items-center gap-1.5 overflow-hidden text-[11px] font-bold flex-wrap",
                      "text-(--ui-texto-secundario)",
                    )}
                  >
                    {modalBreadcrumbTaskIds.map((hId) => (
                      <div
                        key={hId}
                        className="flex items-center gap-1.5 overflow-hidden"
                      >
                        <span
                          className={cn(
                            "max-w-25 truncate cursor-pointer transition",
                            "hover:text-(--ui-texto-forte)",
                          )}
                          onClick={() => openTaskDetailsFromBreadcrumb(hId)}
                        >
                          {graph.tasks[hId]?.title}
                        </span>
                        <ChevronRight className="h-3 w-3 shrink-0 opacity-50" />
                      </div>
                    ))}
                    <span className="truncate text-blue-600 max-w-37.5">
                      {task.title}
                    </span>
                  </div>
                </div>
              )}

              {/* TÃ­tulo (editÃ¡vel) */}
              <textarea
                ref={titleRef}
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={commitTitle}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitTitle();
                    e.currentTarget.blur();
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setTitleDraft(task.title);
                    e.currentTarget.blur();
                  }
                }}
                onFocus={(e) => {
                  const val = e.target.value;
                  e.target.value = "";
                  e.target.value = val;
                  e.target.setSelectionRange(val.length, val.length);
                }}
                rows={1}
                readOnly={!canEditTask}
                className={cn(
                  "mb-4 w-full shrink-0 resize-none border-b-2 overflow-hidden",
                  "border-transparent bg-transparent px-0 py-1 font-black",
                  "text-lg leading-tight outline-none transition sm:text-xl",
                  canEditTask
                    ? "text-(--ui-texto-principal) focus:border-(--ui-azul-borda-foco) focus:bg-transparent"
                    : "text-(--ui-texto-principal)",
                )}
                placeholder="TÃ­tulo do card"
              />
              {/* Atributos em grid compacto */}
              <div className="grid gap-x-4 gap-y-2.5 sm:grid-cols-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="flex shrink-0 items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500 w-25">
                    <LayoutGrid className="h-3 w-3" />
                    Status
                  </span>
                  <div className="flex flex-wrap items-center gap-1.5 min-w-0 flex-1">
                    <div className={cn("relative", isStatusMenuOpen && "z-50")}>
                      {status ? (
                        <button
                          type="button"
                          onClick={() => {
                            if (!canMoveTaskStatus) return;
                            setIsStatusMenuOpen(!isStatusMenuOpen);
                          }}
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold border cursor-pointer transition-colors",
                            !canMoveTaskStatus &&
                              "cursor-not-allowed opacity-70",
                            status.chipClass,
                            "hover:opacity-80",
                          )}
                        >
                          <span
                            className={cn(
                              "h-1.5 w-1.5 rounded-full",
                              status.dotClass,
                            )}
                          />
                          {getTaskStatusLabel(status.name)}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            canMoveTaskStatus && setIsStatusMenuOpen(true)
                          }
                          className={cn(
                            "text-xs",
                            canMoveTaskStatus
                              ? "cursor-pointer"
                              : "cursor-not-allowed opacity-70",
                            "text-(--ui-texto-secundario) hover:text-(--ui-texto-forte)",
                          )}
                        >
                          Adicionar
                        </button>
                      )}
                      {canMoveTaskStatus && isStatusMenuOpen && (
                        <div
                          ref={statusMenuRef}
                          className={cn(
                            "absolute top-full mt-2 left-0 z-100 w-48 rounded-xl border p-2 animate-in fade-in zoom-in-95 duration-200",
                            "pauta-theme-menu",
                          )}
                        >
                          <h4
                            className={cn(
                              "mb-2 px-2 text-[10px] font-bold uppercase tracking-widest",
                              "text-(--ui-texto-secundario)",
                            )}
                          >
                            Alterar Status
                          </h4>
                          <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
                            {graph.statusDefinitions.map((s) => (
                              <button
                                key={s.id}
                                type="button"
                                onClick={() => {
                                  moveTaskToStatus(taskId, s.id);
                                  setIsStatusMenuOpen(false);
                                }}
                                className={cn(
                                  "flex items-center gap-2 rounded-lg px-2 py-1.5 cursor-pointer text-left transition-colors",
                                  "hover:bg-(--ui-hover)",
                                  task.statusId === s.id &&
                                    ("bg-(--ui-fundo-sutil)"),
                                )}
                              >
                                <span
                                  className={cn(
                                    "h-2 w-2 rounded-full",
                                    s.dotClass,
                                  )}
                                />
                                <span
                                  className={cn(
                                    "text-xs font-medium",
                                    "text-(--ui-texto-item)",
                                  )}
                                >
                                  {s.name}
                                </span>
                                {task.statusId === s.id && (
                                  <Check className="ml-auto h-3 w-3 text-blue-500" />
                                )}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={cn(
                      "flex w-25 shrink-0 items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider",
                      "text-(--ui-texto-secundario)",
                    )}
                  >
                    <User className="h-3 w-3" />
                    Responsáveis
                  </span>
                  <div
                    className={cn(
                      "flex flex-wrap items-center gap-2 min-w-0 flex-1 relative",
                      isAssigneeMenuOpen && "z-50",
                    )}
                  >
                    {assignees.length > 0 && (
                      <div className="flex -space-x-1.5">
                        {assignees.map((m) => (
                          <div
                            key={m.id}
                            className={cn(
                              "group relative h-7 w-7 rounded-full border-2 cursor-pointer",
                              "border-(--ui-superficie)",
                            )}
                          >
                            <div className="absolute -top-10 left-1/2 z-50 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-800 px-2 py-1 text-[11px] font-medium text-white group-hover:block">
                              {m.name}
                              <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-800" />
                            </div>
                            <UserAvatar
                              member={m}
                              size={28}
                              className={cn(
                                "h-7 w-7 ring-0",
                                m.avatarUrl
                                  ? "border-0"
                                  : "border border-(--ui-borda-forte)",
                              )}
                            />
                            <button
                              type="button"
                              onClick={(e) => {
                                if (!canEditTask) return;
                                e.stopPropagation();
                                removeTaskAssignee(taskId, m.id);
                              }}
                              className="absolute -top-1 -right-1 z-10 hidden h-4 w-4 items-center justify-center rounded-full bg-slate-800 text-white group-hover:flex cursor-pointer"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => {
                          if (!canEditTask) return;
                          setIsAssigneeMenuOpen(!isAssigneeMenuOpen);
                        }}
                        className={cn(
                          "flex h-7 w-7 items-center justify-center rounded-full border border-dashed transition-colors cursor-pointer",
                          !canEditTask && "cursor-not-allowed opacity-60",
                          "border-(--ui-borda-forte) bg-(--ui-superficie-suave) text-(--ui-texto-secundario) hover:border-blue-400 hover:text-(--ui-azul-texto)",
                        )}
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                      {canEditTask && isAssigneeMenuOpen && (
                        <div
                          ref={assigneeMenuRef}
                          className={cn(
                            "absolute top-full mt-2 right-0 z-100 w-80 rounded-xl border p-3 animate-in fade-in zoom-in-95 duration-200",
                            "pauta-theme-menu",
                          )}
                        >
                          <h4
                            className={cn(
                              "mb-2 px-2 text-[10px] font-bold uppercase tracking-widest",
                              "text-(--ui-texto-secundario)",
                            )}
                          >
                            Atribuir a...
                          </h4>
                          <input aria-label="Buscar membro por nome, cargo ou e-mail"
                            value={assigneeSearch}
                            onChange={(event) =>
                              setAssigneeSearch(event.target.value)
                            }
                            placeholder="Buscar membro por nome, cargo ou e-mail"
                            className={cn(
                              "mb-3 w-full rounded-xl border px-3 py-2 text-sm outline-none transition-all",
                              "border-(--ui-borda) bg-(--ui-fundo-sutil) text-(--ui-texto-principal) placeholder:text-(--ui-texto-secundario) focus:border-(--ui-azul-borda-foco)",
                            )}
                          />
                          <div className="-mx-1 mb-3 overflow-x-auto pb-1">
                            <div className="flex w-max min-w-full gap-2 px-1">
                              <button
                                type="button"
                                onClick={() => setAssigneeTagFilter(null)}
                                className={cn(
                                  "shrink-0 cursor-pointer whitespace-nowrap rounded-full border px-3 py-1 text-[11px] font-black transition-all hover:opacity-85",
                                  assigneeTagFilter === null
                                    ? "border-(--ui-azul-borda) bg-(--ui-azul-fundo) text-(--ui-azul-texto)"
                                    : "border-(--ui-borda) text-(--ui-texto-secundario)",
                                )}
                              >
                                Todas
                              </button>
                              {assigneeFilterTags.map((tag) => (
                                <button
                                  key={tag.id}
                                  type="button"
                                  onClick={() =>
                                    setAssigneeTagFilter((current) =>
                                      current === tag.id ? null : tag.id,
                                    )
                                  }
                                  className={cn(
                                    "shrink-0 cursor-pointer whitespace-nowrap rounded-full border px-3 py-1 text-[11px] font-black transition-all hover:opacity-85",
                                    assigneeTagFilter === tag.id
                                      ? "text-white"
                                      : "border-(--ui-borda) text-(--ui-texto-secundario)",
                                  )}
                                  style={
                                    assigneeTagFilter === tag.id
                                      ? {
                                          backgroundColor: tag.color,
                                          borderColor: tag.color,
                                        }
                                      : undefined
                                  }
                                >
                                  {tag.name}
                                </button>
                              ))}
                            </div>
                          </div>
                          <div className="flex max-h-56 flex-col gap-1.5 overflow-y-auto">
                            {availableAssigneeMembers.map((m) => (
                              <button
                                key={m.id}
                                type="button"
                                onClick={() => {
                                  addTaskAssignee(taskId, m.id);
                                  setIsAssigneeMenuOpen(false);
                                }}
                                className={cn(
                                  "flex items-center gap-2 rounded-lg px-2 py-1.5 cursor-pointer",
                                  "hover:bg-(--ui-hover) text-left transition-colors",
                                )}
                              >
                                <UserAvatar
                                  member={m}
                                  size={24}
                                  className="h-6 w-6 border-0 ring-0"
                                />
                                <div className="min-w-0 flex-1">
                                  <p
                                    className={cn(
                                      "truncate text-xs font-medium",
                                      "text-(--ui-texto-item)",
                                    )}
                                  >
                                    {m.name}
                                  </p>
                                  <p
                                    className={cn(
                                      "text-[10px] font-medium",
                                      "text-(--ui-texto-secundario)",
                                    )}
                                  >
                                    {m.role}
                                  </p>
                                  {!!m.tags?.length && (
                                    <div className="mt-1.5 flex flex-wrap gap-1">
                                      {m.tags.slice(0, 3).map((tag) => (
                                        <span
                                          key={tag.id}
                                          className="rounded-full px-2 py-0.5 text-[9px] font-black text-white"
                                          style={{ backgroundColor: tag.color }}
                                        >
                                          {tag.name}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </button>
                            ))}
                            {availableAssigneeMembers.length === 0 && (
                              <span
                                className={cn(
                                  "rounded-xl border px-3 py-4 text-center text-xs font-bold",
                                  "border-(--ui-borda) text-(--ui-texto-secundario)",
                                )}
                              >
                                Nenhum membro encontrado para esse filtro.
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={cn(
                      "flex w-25 shrink-0 items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider",
                      "text-(--ui-texto-secundario)",
                    )}
                  >
                    <Calendar className="h-3 w-3" />
                    Prazo
                  </span>
                  <div className="flex flex-wrap items-center gap-2 min-w-0 flex-1">
                    <FlightDatePicker
                      startDate={task.startDate ?? null}
                      endDate={task.dueDate ?? null}
                      onChange={(start, end) =>
                        updateTaskDates(taskId, start, end)
                      }
                      direction="down"
                      disabled={!canEditTask}
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={cn(
                      "flex w-25 shrink-0 items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider",
                      "text-(--ui-texto-secundario)",
                    )}
                  >
                    <Clock className="h-3 w-3" />
                    Estimativa
                  </span>
                  <div className="flex flex-wrap items-center gap-2 min-w-0 flex-1">
                    <TimeEstimateDropdown
                      value={task.estimate || null}
                      onChange={(val) => updateTaskEstimate(taskId, val)}
                      disabled={!canEditTask}
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={cn(
                      "flex w-25 shrink-0 items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider",
                      "text-(--ui-texto-secundario)",
                    )}
                  >
                    <Flag className="h-3 w-3" />
                    Prioridade
                  </span>
                  <div className="flex flex-wrap items-center gap-2 min-w-0 flex-1">
                    <div
                      className={cn("relative", isPriorityMenuOpen && "z-50")}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          if (!canEditTask) return;
                          setIsPriorityMenuOpen(!isPriorityMenuOpen);
                        }}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold border border-current/10 cursor-pointer",
                          !canEditTask && "cursor-not-allowed opacity-70",
                          priorityConfig[task.priority].bg,
                          priorityConfig[task.priority].text,
                        )}
                      >
                        <span
                          className={cn(
                            "h-1.5 w-1.5 rounded-full",
                            priorityConfig[task.priority].dot,
                          )}
                        />
                        {priorityConfig[task.priority].label}
                      </button>
                      {canEditTask && isPriorityMenuOpen && (
                        <div
                          ref={priorityMenuRef}
                          className={cn(
                            "absolute top-full mt-2 right-0 z-100 w-48 rounded-xl border p-2 animate-in fade-in zoom-in-95 duration-200",
                            "pauta-theme-menu",
                          )}
                        >
                          <h4
                            className={cn(
                              "mb-2 px-2 text-[10px] font-bold uppercase tracking-widest",
                              "text-(--ui-texto-secundario)",
                            )}
                          >
                            Alterar Prioridade
                          </h4>
                          <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
                            {(
                              Object.entries(priorityConfig) as [
                                TaskPriority,
                                any,
                              ][]
                            ).map(([key, p]) => (
                              <button
                                key={key}
                                type="button"
                                onClick={() => {
                                  updateTaskPriority(taskId, key);
                                  setIsPriorityMenuOpen(false);
                                }}
                                className={cn(
                                  "flex items-center gap-2 rounded-lg px-2 py-1.5 cursor-pointer text-left transition-colors",
                                  "hover:bg-(--ui-hover)",
                                  task.priority === key &&
                                    ("bg-(--ui-fundo-sutil)"),
                                )}
                              >
                                <span
                                  className={cn("h-2 w-2 rounded-full", p.dot)}
                                />
                                <span
                                  className={cn(
                                    "text-xs font-medium",
                                    "text-(--ui-texto-item)",
                                  )}
                                >
                                  {p.label}
                                </span>
                                {task.priority === key && (
                                  <Check className="ml-auto h-3 w-3 text-blue-500" />
                                )}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                {taskWorkspaceCustomFields.length > 0 && (
                  <div className="flex items-start gap-2 min-w-0">
                    <span
                      className={cn(
                        "flex w-25 shrink-0 items-center gap-1.5 pt-2 text-[10px] font-bold uppercase tracking-wider",
                        "text-(--ui-texto-secundario)",
                      )}
                    >
                      <Info className="h-3 w-3" />
                      Campos
                    </span>
                    <div className="min-w-0 flex-1 rounded-2xl border p-3">
                      <CustomFieldEditor
                        fields={taskWorkspaceCustomFields}
                        values={taskCustomFieldDrafts}
                        errors={taskCustomFieldErrors}
                        disabled={!canEditTask}
                        variant="inline"
                        onValueChange={handleTaskCustomFieldDraftChange}
                        onValueCommit={handleTaskCustomFieldCommit}
                      />
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={cn(
                      "flex w-25 shrink-0 items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider",
                      "text-(--ui-texto-secundario)",
                    )}
                  >
                    <Tag className="h-3 w-3" />
                    Etiquetas
                  </span>
                  <div
                    className={cn(
                      "flex flex-wrap items-center gap-2 min-w-0 flex-1 relative",
                      isTagMenuOpen && "z-50",
                    )}
                  >
                    {task.tags && task.tags.length > 0
                      ? task.tags.map((tag) => (
                          <div
                            key={tag.id}
                            className="group relative flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-bold cursor-pointer transition-all hover:pr-6"
                            style={{
                              borderColor: tag.color + "40",
                              backgroundColor: tag.color + "10",
                              color: tag.color,
                            }}
                          >
                            {tag.name}
                            <button
                              type="button"
                              onClick={(e) => {
                                if (!canEditTask) return;
                                e.stopPropagation();
                                toggleTaskTag(taskId, tag);
                              }}
                              className={cn(
                                "absolute top-1/2 -translate-y-1/2 right-1.5 hidden h-3.5 w-3.5 items-center justify-center",
                                "rounded-full bg-slate-800 text-white cursor-pointer group-hover:flex",
                              )}
                            >
                              <X className="h-2.5 w-2.5" />
                            </button>
                          </div>
                        ))
                      : null}
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => {
                          if (!canEditTask) return;
                          setIsTagMenuOpen(!isTagMenuOpen);
                        }}
                        className={cn(
                          "flex h-7 w-7 items-center justify-center rounded-full border border-dashed cursor-pointer",
                          !canEditTask && "cursor-not-allowed opacity-60",
                          "border-(--ui-borda-forte) bg-(--ui-superficie-suave) text-(--ui-texto-secundario) hover:border-blue-400 hover:text-(--ui-azul-texto)",
                          "transition-colors",
                        )}
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                      {canEditTask && isTagMenuOpen && (
                        <div
                          ref={tagMenuRef}
                          className={cn(
                            "absolute top-full mt-2 right-0 z-100 w-56 rounded-xl border p-2 animate-in fade-in zoom-in-95 duration-200",
                            "pauta-theme-menu",
                          )}
                        >
                          <h4
                            className={cn(
                              "mb-2 px-2 text-[10px] font-bold uppercase tracking-widest",
                              "text-(--ui-texto-secundario)",
                            )}
                          >
                            Adicionar Etiquetas
                          </h4>
                          <div
                            className={cn(
                              "relative mb-2",
                              "text-(--ui-texto-secundario)",
                            )}
                          >
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2" />
                            <input aria-label="Buscar etiqueta"
                              type="text"
                              value={tagSearch}
                              onChange={(e) => setTagSearch(e.target.value)}
                              placeholder="Buscar etiqueta"
                              className={cn(
                                "w-full rounded-lg border py-2 pl-8 pr-3 text-xs outline-none transition",
                                "border-(--ui-borda) bg-(--ui-fundo-sutil) text-(--ui-texto-forte) placeholder:text-(--ui-texto-secundario) focus:border-blue-400 focus:bg-(--ui-superficie-suave)",
                              )}
                            />
                          </div>
                          <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
                            {(() => {
                              if (availableTags.length === 0) {
                                return (
                                  <p
                                    className={cn(
                                      "px-2 py-3 text-center text-[12px] font-medium",
                                      "text-(--ui-texto-secundario)",
                                    )}
                                  >
                                    Nenhuma etiqueta disponÃ­vel
                                  </p>
                                );
                              }

                              return availableTags.map((t) => (
                                <button
                                  key={t.id}
                                  type="button"
                                  onClick={() => {
                                    toggleTaskTag(taskId, t);
                                  }}
                                  className={cn(
                                    "flex items-center justify-between rounded-lg px-2 py-1.5 cursor-pointer",
                                    "hover:bg-(--ui-hover) text-left transition-colors",
                                  )}
                                >
                                  <div className="flex items-center gap-2">
                                    <span
                                      className="h-3 w-3 rounded-full"
                                      style={{ backgroundColor: t.color }}
                                    />
                                    <span
                                      className={cn(
                                        "text-xs font-medium",
                                        "text-(--ui-texto-item)",
                                      )}
                                    >
                                      {t.name}
                                    </span>
                                  </div>
                                </button>
                              ));
                            })()}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
              {/* Fim do bloco de atributos */}

              {/* Área descrição */}
              <div
                className={cn(
                  "mb-6 mt-2 border-t pt-6",
                  "border-(--ui-borda-suave)",
                )}
              >
                <h4
                  className={cn(
                    "mb-2 px-1 text-[11px] font-black uppercase tracking-widest",
                    "text-(--ui-texto-secundario)",
                  )}
                >
                  Descrição
                </h4>

                {isDescEditing ? (
                  /* Modo edição: textarea visível */
                  <div
                    className={cn(
                      "overflow-hidden rounded-xl border transition",
                      isDarkMode
                        ? cn(
                            "border-blue-500/30 bg-transparent",
                            descMentionTrigger && "ring-2 ring-blue-500/20",
                          )
                        : cn(
                            "border-blue-300 bg-transparent",
                            descMentionTrigger && "ring-2 ring-blue-100",
                          ),
                    )}
                  >
                    {descriptionInlineChecklist ? (
                      <div
                        onBlurCapture={(event) => {
                          const nextFocused = event.relatedTarget;
                          if (
                            nextFocused instanceof Node &&
                            event.currentTarget.contains(nextFocused)
                          ) {
                            return;
                          }
                          if (
                            nextFocused instanceof Node &&
                            descLinkPreviewRef.current?.contains(nextFocused)
                          ) {
                            return;
                          }
                          commitDescription();
                          setIsDescEditing(false);
                        }}
                      >
                        <InlineChecklistEditor
                          isDarkMode={isDarkMode}
                          value={descDraft}
                          readOnly={!canEditTask}
                          onChange={setDescDraft}
                          trailingTextareaExternalRef={
                            descChecklistTrailingTextareaRef
                          }
                          onTrailingTextCursorChange={
                            syncDescChecklistTrailingMentionState
                          }
                          onMentionReset={() => {
                            setDescMentionTrigger(null);
                            setDescMentionSearch("");
                            setDescMentionMenuStyle(undefined);
                          }}
                          onExitToText={(nextText) => {
                            setDescDraft(nextText);
                            requestAnimationFrame(() => {
                              const textarea = descTextareaRef.current;
                              if (!textarea) return;
                              textarea.focus();
                              const cursorPosition = nextText.length;
                              textarea.setSelectionRange(
                                cursorPosition,
                                cursorPosition,
                              );
                            });
                          }}
                        />
                      </div>
                    ) : (
                      <div
                        className="relative"
                        style={{ height: `${descEditorHeight}px` }}
                      >
                        {shouldUseDescriptionMentionPreview && (
                          <MentionInputPreview
                            value={descDraft}
                            members={mentionableMembers}
                            scrollTop={descEditorScroll.top}
                            scrollLeft={descEditorScroll.left}
                            hiddenUrls={hiddenDescriptionDraftUrls}
                            className={cn(
                              "px-4 py-3 text-sm leading-relaxed",
                              "text-(--ui-texto-forte)",
                            )}
                          />
                        )}
                        <textarea
                          ref={descTextareaRef}
                          value={descDraft}
                          onChange={handleDescChange}
                          onClick={(event) =>
                            syncDescMentionState(
                              event.currentTarget.value,
                              event.currentTarget.selectionStart,
                              event.currentTarget,
                            )
                          }
                          onKeyUp={(event) =>
                            syncDescMentionState(
                              event.currentTarget.value,
                              event.currentTarget.selectionStart,
                              event.currentTarget,
                            )
                          }
                          onScroll={(event) =>
                            setDescEditorScroll({
                              top: event.currentTarget.scrollTop,
                              left: event.currentTarget.scrollLeft,
                            })
                          }
                          onBlur={(event) => {
                            const nextFocused = event.relatedTarget;
                            if (
                              nextFocused instanceof Node &&
                              (descMentionMenuRef.current?.contains(
                                nextFocused,
                              ) ||
                                descLinkPreviewRef.current?.contains(
                                  nextFocused,
                                ))
                            ) {
                              return;
                            }
                            commitDescription();
                            setIsDescEditing(false);
                            setDescMentionTrigger(null);
                            setDescMentionSearch("");
                            setDescMentionMenuStyle(undefined);
                          }}
                          onFocus={(e) => {
                            const val = e.target.value;
                            e.target.value = "";
                            e.target.value = val;
                            const len = val.length;
                            e.target.setSelectionRange(len, len);
                            setDescEditorScroll({
                              top: e.target.scrollTop,
                              left: e.target.scrollLeft,
                            });
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Escape" && descMentionTrigger) {
                              event.preventDefault();
                              setDescMentionTrigger(null);
                              setDescMentionSearch("");
                              setDescMentionMenuStyle(undefined);
                              return;
                            }
                            if (
                              event.key === "Enter" &&
                              descMentionTrigger &&
                              filteredDescMentionMembers.length > 0
                            ) {
                              event.preventDefault();
                              handleDescMentionSelect(
                                filteredDescMentionMembers[0],
                              );
                              return;
                            }
                            if (event.key === "Enter" && !event.shiftKey) {
                              const nextChecklistState =
                                getChecklistLineInsertion(
                                  event.currentTarget.value,
                                  event.currentTarget.selectionStart,
                                  event.currentTarget.selectionEnd,
                                );
                              if (nextChecklistState) {
                                event.preventDefault();
                                setDescDraft(nextChecklistState.text);
                                requestAnimationFrame(() => {
                                  const textarea = descTextareaRef.current;
                                  if (!textarea) return;
                                  textarea.focus();
                                  textarea.setSelectionRange(
                                    nextChecklistState.cursorPosition,
                                    nextChecklistState.cursorPosition,
                                  );
                                });
                              }
                            }
                          }}
                          autoFocus
                          rows={6}
                          readOnly={!canEditTask}
                          placeholder="Clique para adicionar uma descrição detalhada..."
                          className={cn(
                            "relative z-10 h-full w-full resize-none overflow-y-auto bg-transparent outline-none transition",
                            "px-4 py-3 text-sm leading-relaxed wrap-anywhere",
                            descDraft && "selection:bg-blue-500/25",
                            "text-(--ui-texto-forte) placeholder:text-(--text-soft)",
                          )}
                          style={{
                            height: `${descEditorHeight}px`,
                            ...(shouldUseDescriptionMentionPreview
                              ? {
                                  color: "transparent",
                                  WebkitTextFillColor: "transparent",
                                  caretColor: isDarkMode
                                    ? "#f8fafc"
                                    : "#0f172a",
                                }
                              : {}),
                          }}
                        />
                      </div>
                    )}
                    {descriptionDraftUrls.length > 0 && (
                      <div
                        ref={descLinkPreviewRef}
                        className={cn(
                          "border-t",
                          "border-(--ui-borda-suave) bg-(--ui-fundo-sutil)",
                        )}
                      >
                        <button
                          type="button"
                          aria-label="Redimensionar área da descrição"
                          onMouseDown={startDescriptionResize}
                          className={cn(
                            "relative flex h-6 w-full cursor-row-resize items-center justify-center",
                            "text-(--ui-texto-secundario)",
                          )}
                        >
                          <span
                            className={cn(
                              "absolute inset-x-4 top-1/2 h-px -translate-y-1/2",
                              "bg-(--ui-fundo-neutro)",
                            )}
                          />
                          <span
                            className={cn(
                              "relative z-10 grid h-5 w-8 place-items-center rounded-full border backdrop-blur-sm",
                              isDarkMode
                                ? "border-white/10 bg-slate-950/90"
                                : "border-slate-200 bg-white/95",
                            )}
                          >
                            <GripVertical className="h-3.5 w-3.5 rotate-90" />
                          </span>
                        </button>
                        <div className="flex flex-wrap items-start gap-3 px-4 pb-3">
                          {descriptionDraftUrls.map((url) => {
                            const linkMode = getLinkDisplayMode(
                              descLinkDisplayModes,
                              url,
                            );
                            return (
                              <LinkPreviewCard
                                isDarkMode={isDarkMode}
                                key={`task-desc-draft-${url}`}
                                url={url}
                                mode={linkMode}
                                onModeChange={(mode) =>
                                  updateDescriptionDraftLinkMode(url, mode)
                                }
                                onEdit={() => editDescriptionDraftLink(url)}
                                onRemove={() => removeDescriptionDraftLink(url)}
                              />
                            );
                          })}
                        </div>
                      </div>
                    )}
                    <MentionPicker
                      isDarkMode={isDarkMode}
                      isOpen={!!descMentionTrigger}
                      title="Mencionar na descrição"
                      search={descMentionSearch}
                      members={filteredDescMentionMembers}
                      onSearchChange={setDescMentionSearch}
                      onSelect={handleDescMentionSelect}
                      menuRef={descMentionMenuRef}
                      placement="floating"
                      style={descMentionMenuStyle}
                    />
                  </div>
                ) : (
                  /* Modo leitura: ghost click-to-edit */
                  <div
                    role="button"
                    tabIndex={canEditTask ? 0 : -1}
                    onMouseDown={handleDescriptionReadMouseDown}
                    onMouseUp={handleDescriptionReadMouseUp}
                    onClick={(event) => {
                      if (!canEditTask) return;

                      const target = event.target;
                      if (
                        target instanceof HTMLElement &&
                        target.closest("a, button")
                      ) {
                        return;
                      }

                      if (
                        descReadInteractionRef.current.ignoreNextClick ||
                        hasSelectionInside(event.currentTarget)
                      ) {
                        descReadInteractionRef.current.ignoreNextClick = false;
                        return;
                      }

                      setIsDescEditing(true);
                    }}
                    onKeyDown={(e) => {
                      if (canEditTask && e.key === "Enter")
                        setIsDescEditing(true);
                    }}
                    className={cn(
                      "group w-full rounded-xl px-4 py-3 transition",
                      canEditTask
                        ? "cursor-pointer hover:bg-(--ui-hover) hover:ring-1 hover:ring-(--ui-borda)"
                        : "cursor-default",
                    )}
                  >
                    {hasDescriptionContent ? (
                      <>
                        {descriptionInlineChecklist ? (
                          <InlineChecklistContent
                            isDarkMode={isDarkMode}
                            value={descDraft}
                            members={mentionableMembers}
                            hiddenUrls={getHiddenLinkUrlsForRender(
                              descriptionDraftUrls,
                              descLinkDisplayModes,
                            )}
                            onToggle={
                              canEditTask
                                ? toggleDescriptionChecklistItem
                                : undefined
                            }
                          />
                        ) : descDraft.trim().length > 0 ? (
                          <p
                            className={cn(
                              "whitespace-pre-wrap text-sm leading-relaxed",
                              "text-(--ui-texto-forte)",
                              !isDescExpanded && "line-clamp-none",
                            )}
                          >
                            {renderTextWithMentionsAndLinks(
                              isDescExpanded ||
                                descDraft.length <= DESC_CHAR_LIMIT
                                ? descDraft
                                : descDraft.slice(0, DESC_CHAR_LIMIT) + "...",
                              mentionableMembers,
                              getMentionChipClassName("content"),
                              getLinkClassName(),
                              getHiddenLinkUrlsForRender(
                                descriptionDraftUrls,
                                descLinkDisplayModes,
                              ),
                            )}
                          </p>
                        ) : null}
                        {descriptionDraftUrls.length > 0 && (
                          <div
                            className={cn(
                              "flex flex-wrap items-start gap-3",
                              descDraft.trim().length > 0 && "mt-3",
                            )}
                          >
                            {descriptionDraftUrls.map((url) => {
                              const linkMode = getLinkDisplayMode(
                                descLinkDisplayModes,
                                url,
                              );
                              return (
                                <LinkPreviewCard
                                  isDarkMode={isDarkMode}
                                  key={`task-desc-${url}`}
                                  url={url}
                                  mode={linkMode}
                                  onModeChange={(mode) =>
                                    persistDescriptionLinkMode(url, mode)
                                  }
                                  onEdit={() => {
                                    void editPersistedDescriptionLink(url);
                                  }}
                                  onRemove={() => {
                                    void removePersistedDescriptionLink(url);
                                  }}
                                />
                              );
                            })}
                          </div>
                        )}
                        {!descriptionInlineChecklist &&
                          descDraft.length > DESC_CHAR_LIMIT && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setIsDescExpanded(!isDescExpanded);
                              }}
                              className={cn(
                                "mt-2 text-[12px] font-semibold text-blue-500",
                                "hover:text-blue-700 transition-colors",
                              )}
                            >
                              {isDescExpanded ? "Ver menos ↑" : "Ver mais ↓"}
                            </button>
                          )}
                      </>
                    ) : (
                      <p
                        className={cn(
                          "text-sm italic transition-colors",
                          "text-(--ui-texto-secundario) group-hover:text-(--ui-texto-secundario)",
                        )}
                      >
                        Clique para adicionar uma descrição detalhada...
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Seção de Subtarefas — aparece quando há subtarefas ou está adicionando */}
              {((task.subtaskIds?.length ?? 0) > 0 || isSubtaskAdding) && (
                <div
                  className={cn(
                    "mb-2 mt-2 border-t px-1 pt-4",
                    "border-(--ui-borda-suave)",
                  )}
                >
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setSubtasksCollapsed(!subtasksCollapsed)}
                        className={cn(
                          "transition cursor-pointer",
                          "text-(--ui-texto-secundario) hover:text-(--ui-texto-forte)",
                        )}
                      >
                        <ChevronRight
                          className={cn(
                            "h-3.5 w-3.5 transition-transform",
                            !subtasksCollapsed && "rotate-90",
                          )}
                        />
                      </button>
                      <h4
                        className={cn(
                          "flex items-center gap-2 text-[11px] font-black uppercase tracking-widest",
                          "text-(--ui-texto-secundario)",
                        )}
                      >
                        <Layers className="h-3 w-3" />
                        Subtarefas
                        <span
                          className={cn(
                            "ml-1 text-[11px] font-bold",
                            "text-(--ui-texto-secundario)",
                          )}
                        >
                          {task.subtaskIds?.length ?? 0} Subtarefas
                        </span>
                      </h4>
                    </div>
                  </div>

                  {!subtasksCollapsed && (
                    <div className="space-y-0.5">
                      {task.subtaskIds?.map((subId) => {
                        const subtask = graph.tasks[subId];
                        if (!subtask) return null;
                        return (
                          <div
                            key={subId}
                            className={cn(
                              "group/sub flex items-center gap-2 rounded-lg py-1.5 pl-2 pr-2 transition-colors cursor-pointer",
                              "hover:bg-(--ui-fundo-sutil)",
                            )}
                          >
                            <div
                              className="flex-1 flex items-center gap-3 min-w-0"
                              onClick={() => openTaskDetails(subId)}
                            >
                              <div
                                className={cn(
                                  "flex h-5 w-5 shrink-0 items-center justify-center rounded transition",
                                  "bg-(--ui-fundo-neutro) text-(--ui-texto-secundario) group-hover/sub:bg-(--ui-azul-fundo) group-hover/sub:text-(--ui-azul-texto)",
                                )}
                              >
                                <LayoutGrid className="h-3 w-3" />
                              </div>
                              <span
                                className={cn(
                                  "flex-1 truncate text-[13px] font-medium",
                                  "text-(--ui-texto-secundario) group-hover/sub:text-(--ui-texto-principal)",
                                )}
                              >
                                {subtask.title}
                              </span>
                            </div>

                            {canEditTask && (
                              <div className="flex items-center gap-1 opacity-0 group-hover/sub:opacity-100 transition-opacity">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setConfirmConfig({
                                      isOpen: true,
                                      title: "Excluir Subtarefa",
                                      message: `Deseja realmente excluir a subtarefa "${subtask.title}"?`,
                                      onConfirm: () => deleteTask(subId),
                                    });
                                  }}
                                  className={cn(
                                    "p-1 transition cursor-pointer",
                                    "text-(--ui-texto-apagado) hover:text-(--ui-rose-texto)",
                                  )}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                                <ChevronRight
                                  className={cn(
                                    "h-3.5 w-3.5",
                                    "text-(--ui-texto-apagado)",
                                  )}
                                />
                              </div>
                            )}
                          </div>
                        );
                      })}

                      {canEditTask && isSubtaskAdding && (
                        <div className="mt-1 flex items-center gap-2 pl-2 py-1">
                          <div
                            className={cn(
                              "h-4 w-4 shrink-0 rounded border-2 border-dashed",
                              "border-(--ui-borda)",
                            )}
                          />
                          <input aria-label="Adicionar subtarefa"
                            autoFocus
                            placeholder="Adicionar subtarefa"
                            className={cn(
                              "flex-1 bg-transparent text-[13px] font-medium outline-none",
                              "text-(--ui-texto-secundario) placeholder:text-(--ui-texto-secundario) focus:text-(--ui-texto-forte)",
                            )}
                            value={subtaskDraft}
                            onChange={(e) => setSubtaskDraft(e.target.value)}
                            onKeyDown={async (e) => {
                              if (e.key === "Enter" && subtaskDraft.trim()) {
                                await addSubtask(taskId, subtaskDraft.trim());
                                setSubtaskDraft("");
                                setIsSubtaskAdding(false);
                              }
                              if (e.key === "Escape") setIsSubtaskAdding(false);
                            }}
                            onBlur={() => {
                              if (!subtaskDraft.trim())
                                setIsSubtaskAdding(false);
                            }}
                          />
                        </div>
                      )}

                      {canEditTask &&
                        (task.subtaskIds?.length ?? 0) > 0 &&
                        !isSubtaskAdding && (
                          <button
                            type="button"
                            onClick={() => setIsSubtaskAdding(true)}
                            className={cn(
                              "flex w-full items-center gap-2 px-2 py-1.5 text-left text-[13px] font-medium transition cursor-pointer",
                              "text-(--ui-texto-secundario) hover:bg-(--ui-hover) hover:text-(--ui-texto-forte)",
                            )}
                          >
                            <Plus className="h-3.5 w-3.5" />
                            Adicionar subtarefa
                          </button>
                        )}
                    </div>
                  )}
                </div>
              )}

              {/* Seção de Tarefas Vinculadas */}
              {(task.linkedTaskIds?.length ?? 0) > 0 && (
                <div
                  className={cn(
                    "mb-2 mt-2 border-t px-1 pt-4",
                    "border-(--ui-borda-suave)",
                  )}
                >
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setLinkedItemsCollapsed(!linkedItemsCollapsed)
                        }
                        className={cn(
                          "transition cursor-pointer",
                          "text-(--ui-texto-secundario) hover:text-(--ui-texto-forte)",
                        )}
                      >
                        <ChevronRight
                          className={cn(
                            "h-3.5 w-3.5 transition-transform",
                            !linkedItemsCollapsed && "rotate-90",
                          )}
                        />
                      </button>
                      <h4
                        className={cn(
                          "flex items-center gap-2 text-[11px] font-black uppercase tracking-widest",
                          "text-(--ui-texto-secundario)",
                        )}
                      >
                        <Link2 className="h-3 w-3" />
                        Itens Vinculados
                        <span
                          className={cn(
                            "ml-1 text-[11px] font-bold",
                            "text-(--ui-texto-secundario)",
                          )}
                        >
                          {task.linkedTaskIds?.length ?? 0} Itens Vinculados
                        </span>
                      </h4>
                    </div>
                  </div>

                  {!linkedItemsCollapsed && (
                    <>
                      <div className="space-y-1.5">
                        {task.linkedTaskIds?.map((linkedId) => {
                          const lTask = graph.tasks[linkedId];
                          if (!lTask) return null;
                          return (
                            <div
                              key={linkedId}
                              className={cn(
                                "group/link flex items-center gap-3 rounded-lg py-1.5 pl-2 pr-2 transition-colors cursor-pointer",
                                "hover:bg-(--ui-fundo-sutil)",
                              )}
                            >
                              <div
                                className="flex-1 flex items-center gap-3 min-w-0"
                                onClick={() => openTaskDetails(linkedId)}
                              >
                                <div
                                  className={cn(
                                    "flex h-5 w-5 shrink-0 items-center justify-center rounded",
                                    "bg-(--ui-azul-fundo) text-(--ui-azul-texto)",
                                  )}
                                >
                                  <LayoutGrid className="h-3 w-3" />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p
                                    className={cn(
                                      "truncate text-[13px] font-bold transition-colors",
                                      "text-(--ui-texto-forte) group-hover/link:text-(--ui-azul-texto)",
                                    )}
                                  >
                                    {lTask.title}
                                  </p>
                                  <div className="flex items-center gap-2 mt-0.5">
                                    <span
                                      className={cn(
                                        "text-[10px] font-medium",
                                        "text-(--ui-texto-secundario)",
                                      )}
                                    >
                                      {
                                        graph.statusDefinitions.find(
                                          (s) => s.id === lTask.statusId,
                                        )?.name
                                      }
                                    </span>
                                    {lTask.priority && (
                                      <span
                                        className={cn(
                                          "text-[9px] font-bold uppercase tracking-tighter",
                                          lTask.priority === "urgent" &&
                                            "text-rose-500",
                                          lTask.priority === "high" &&
                                            "text-orange-500",
                                          lTask.priority === "medium" &&
                                            "text-blue-500",
                                          lTask.priority === "low" &&
                                            "text-slate-500",
                                        )}
                                      >
                                        {lTask.priority}
                                      </span>
                                    )}
                                    {lTask.dueDate && (
                                      <span className="text-[9px] text-amber-600 font-medium flex items-center gap-0.5">
                                        <Clock className="h-2 w-2" />
                                        {new Date(
                                          lTask.dueDate,
                                        ).toLocaleDateString("pt-BR", {
                                          day: "2-digit",
                                          month: "2-digit",
                                        })}
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <div className="flex flex-col items-end gap-1.5 ml-auto">
                                  {lTask.assigneeIds.length > 0 && (
                                    <div className="flex -space-x-1.5 overflow-hidden">
                                      {lTask.assigneeIds
                                        .slice(0, 3)
                                        .map((id) => {
                                          const m = graph.members[id];
                                          return (
                                            <div
                                              key={id}
                                              className={cn(
                                                "flex h-4 w-4 items-center justify-center rounded-full border text-[8px] font-bold text-white",
                                                "border-(--ui-superficie)",
                                                m?.avatarColor ||
                                                  "bg-slate-300",
                                              )}
                                              title={m?.name}
                                            >
                                              {m?.name.charAt(0)}
                                            </div>
                                          );
                                        })}
                                    </div>
                                  )}
                                </div>
                              </div>
                              {canEditTask && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setConfirmConfig({
                                      isOpen: true,
                                      title: "Desvincular card",
                                      message: `Tem certeza que deseja desvincular a tarefa "${lTask.title}"?`,
                                      onConfirm: () => {
                                        if (activeTaskId)
                                          unlinkTask(activeTaskId, linkedId);
                                      },
                                    });
                                  }}
                                  className={cn(
                                    "p-1 opacity-0 transition cursor-pointer group-hover/link:opacity-100",
                                    "text-(--ui-texto-apagado) hover:text-(--ui-rose-texto)",
                                  )}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>
                          );
                        })}

                        {canEditTask && (
                          <div
                            className={cn(
                              "relative mt-3",
                              isLinkMenuOpen && "z-50",
                            )}
                          >
                            <button
                              type="button"
                              onClick={() => setIsLinkMenuOpen(!isLinkMenuOpen)}
                              className={cn(
                                "flex w-full items-center gap-2 px-2 py-1.5 text-left text-[13px] font-medium transition cursor-pointer",
                                "text-(--ui-texto-secundario) hover:bg-(--ui-hover) hover:text-(--ui-texto-forte)",
                              )}
                            >
                              <Plus className="h-3.5 w-3.5" />
                              vincular itens ou adicionar dependências
                            </button>

                            {isLinkMenuOpen && (
                              <div
                                ref={linkMenuRef}
                                className={cn(
                                  "absolute top-full left-0 z-100 mt-1 flex max-h-100 w-80 flex-col overflow-hidden rounded-2xl border animate-in fade-in zoom-in-95 duration-200",
                                  "pauta-theme-menu",
                                )}
                              >
                                <div
                                  className={cn(
                                    "relative z-10 flex shrink-0 border-b px-4 py-3",
                                    "border-(--ui-borda-suave) bg-(--ui-superficie)",
                                  )}
                                >
                                  <p
                                    className={cn(
                                      "text-[11px] font-bold uppercase tracking-widest",
                                      "text-(--ui-texto-secundario)",
                                    )}
                                  >
                                    Vincular card
                                  </p>
                                </div>
                                <div className="px-3 pb-2 pt-2">
                                  <div
                                    className={cn(
                                      "relative",
                                      "text-(--ui-texto-secundario)",
                                    )}
                                  >
                                    <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2" />
                                    <input aria-label="Buscar card"
                                      type="text"
                                      value={linkSearch}
                                      onChange={(e) =>
                                        setLinkSearch(e.target.value)
                                      }
                                      placeholder="Buscar card"
                                      className={cn(
                                        "w-full rounded-lg border py-2 pl-8 pr-3 text-xs outline-none transition",
                                        "border-(--ui-borda) bg-(--ui-fundo-sutil) text-(--ui-texto-forte) placeholder:text-(--ui-texto-secundario) focus:border-blue-400 focus:bg-(--ui-superficie-suave)",
                                      )}
                                    />
                                  </div>
                                </div>
                                <div className="overflow-y-auto px-1.5 py-1.5 space-y-0.5">
                                  {filteredLinkableTasks.map((t) => (
                                    <button
                                      key={t.id}
                                      type="button"
                                      onMouseDown={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        if (activeTaskId)
                                          linkTask(activeTaskId, t.id);
                                        setIsLinkMenuOpen(false);
                                      }}
                                      className={cn(
                                        "group/item flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition cursor-pointer",
                                        "hover:bg-(--ui-hover)",
                                      )}
                                    >
                                      <div
                                        className="h-2 w-2 rounded-full mt-1.5 shrink-0"
                                        style={{
                                          backgroundColor:
                                            graph.statusDefinitions.find(
                                              (s) => s.id === t.statusId,
                                            )?.colorClass === "bg-slate-500"
                                              ? "#64748b"
                                              : "#3b82f6",
                                        }}
                                      />
                                      <div className="min-w-0 flex-1">
                                        <p
                                          className={cn(
                                            "truncate text-[13px] font-bold transition-colors",
                                            "text-(--ui-texto-forte) group-hover/item:text-(--ui-azul-texto)",
                                          )}
                                        >
                                          {t.title}
                                        </p>
                                        <div className="flex items-center gap-2 mt-1">
                                          <span
                                            className={cn(
                                              "text-[10px] font-medium",
                                              "text-(--ui-texto-secundario)",
                                            )}
                                          >
                                            {
                                              graph.statusDefinitions.find(
                                                (s) => s.id === t.statusId,
                                              )?.name
                                            }
                                          </span>
                                        </div>
                                      </div>
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Ações Secundárias */}
              <div className="space-y-0.5 pt-2">
                {/* Botão de adicionar subtarefa — só aparece quando não há subtarefas e não está adicionando */}
                {canEditTask &&
                  (task.subtaskIds?.length ?? 0) === 0 &&
                  !isSubtaskAdding && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsSubtaskAdding(true);
                        setSubtasksCollapsed(false);
                      }}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-lg px-2 py-2 cursor-pointer",
                        "text-left text-[13px] font-medium text-(--ui-texto-secundario) hover:bg-(--ui-hover) hover:text-(--ui-texto-forte) transition",
                      )}
                    >
                      <Plus
                        className={cn(
                          "h-3.5 w-3.5",
                          "text-(--ui-texto-secundario)",
                        )}
                      />
                      Adicionar subtarefa
                    </button>
                  )}

                {/* Vincular itens menu — só aparece quando não há links */}
                {canEditTask && (task.linkedTaskIds?.length ?? 0) === 0 && (
                  <div className={cn("relative", isLinkMenuOpen && "z-50")}>
                    <button
                      type="button"
                      onClick={() => setIsLinkMenuOpen(!isLinkMenuOpen)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-lg px-2 py-2 cursor-pointer",
                        "text-left text-[13px] font-medium text-(--ui-texto-secundario) hover:bg-(--ui-hover) hover:text-(--ui-texto-forte) transition",
                      )}
                    >
                      <Link2
                        className={cn(
                          "h-3.5 w-3.5",
                          "text-(--ui-texto-secundario)",
                        )}
                      />
                      Vincular itens ou adicionar dependências
                    </button>

                    {isLinkMenuOpen && (
                      <div
                        ref={linkMenuRef}
                        className={cn(
                          "absolute top-full left-0 z-100 mt-1 flex max-h-100 w-80 flex-col overflow-hidden rounded-2xl border animate-in fade-in zoom-in-95 duration-200",
                          "pauta-theme-menu",
                        )}
                      >
                        <div
                          className={cn(
                            "relative z-10 flex shrink-0 border-b px-4 py-3",
                            "border-(--ui-borda-suave) bg-(--ui-superficie)",
                          )}
                        >
                          <p
                            className={cn(
                              "text-[11px] font-bold uppercase tracking-widest",
                              "text-(--ui-texto-secundario)",
                            )}
                          >
                            Vincular card
                          </p>
                        </div>
                        <div className="px-3 pb-2 pt-2">
                          <div
                            className={cn(
                              "relative",
                              "text-(--ui-texto-secundario)",
                            )}
                          >
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2" />
                            <input aria-label="Buscar card"
                              type="text"
                              value={linkSearch}
                              onChange={(e) => setLinkSearch(e.target.value)}
                              placeholder="Buscar card"
                              className={cn(
                                "w-full rounded-lg border py-2 pl-8 pr-3 text-xs outline-none transition",
                                "border-(--ui-borda) bg-(--ui-fundo-sutil) text-(--ui-texto-forte) placeholder:text-(--ui-texto-secundario) focus:border-blue-400 focus:bg-(--ui-superficie-suave)",
                              )}
                            />
                          </div>
                        </div>
                        <div className="overflow-y-auto px-1.5 py-1.5 space-y-0.5">
                          {filteredLinkableTasks.map((t) => (
                            <button
                              key={t.id}
                              type="button"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                if (activeTaskId) linkTask(activeTaskId, t.id);
                                setIsLinkMenuOpen(false);
                              }}
                              className={cn(
                                "group/item flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition cursor-pointer",
                                "hover:bg-(--ui-hover)",
                              )}
                            >
                              <div
                                className="h-2 w-2 rounded-full mt-1.5 shrink-0"
                                style={{
                                  backgroundColor:
                                    graph.statusDefinitions.find(
                                      (s) => s.id === t.statusId,
                                    )?.colorClass === "bg-slate-500"
                                      ? "#64748b"
                                      : "#3b82f6",
                                }}
                              />
                              <div className="min-w-0 flex-1">
                                <p
                                  className={cn(
                                    "truncate text-[13px] font-bold transition-colors",
                                    "text-(--ui-texto-forte) group-hover/item:text-(--ui-azul-texto)",
                                  )}
                                >
                                  {t.title}
                                </p>
                                <div className="flex items-center gap-2 mt-1">
                                  <span
                                    className={cn(
                                      "text-[10px] font-medium",
                                      "text-(--ui-texto-secundario)",
                                    )}
                                  >
                                    {
                                      graph.statusDefinitions.find(
                                        (s) => s.id === t.statusId,
                                      )?.name
                                    }
                                  </span>
                                  {t.priority && (
                                    <span
                                      className={cn(
                                        "text-[9px] font-bold uppercase",
                                        t.priority === "urgent" &&
                                          "text-rose-500",
                                        t.priority === "high" &&
                                          "text-orange-400",
                                        t.priority === "medium" &&
                                          "text-blue-500",
                                      )}
                                    >
                                      {t.priority}
                                    </span>
                                  )}
                                  {t.dueDate && (
                                    <span className="text-[9px] text-amber-500 flex items-center gap-0.5">
                                      <Clock className="h-2 w-2" />
                                      {new Date(t.dueDate).toLocaleDateString(
                                        "pt-BR",
                                        { day: "2-digit", month: "2-digit" },
                                      )}
                                    </span>
                                  )}
                                </div>
                              </div>
                              {t.assigneeIds.length > 0 && (
                                <div className="flex -space-x-1 overflow-hidden ml-auto">
                                  {t.assigneeIds.slice(0, 2).map((id) => (
                                    <div
                                      key={id}
                                      className={cn(
                                        "flex h-3.5 w-3.5 items-center justify-center rounded-full border text-[7px] font-bold text-white",
                                        "border-(--ui-superficie)",
                                        graph.members[id]?.avatarColor ||
                                          "bg-slate-300",
                                      )}
                                    >
                                      {graph.members[id]?.name.charAt(0)}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </button>
                          ))}
                        </div>
                        {filteredLinkableTasks.length === 0 && (
                          <div className="px-4 py-8 text-center">
                            <Link2 className="h-8 w-8 text-slate-100 mx-auto mb-2" />
                            <p className="text-xs text-slate-500 italic">
                              Nenhum outro card disponível para vincular.
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Botão de adicionar checklist — só aparece quando não há checklists */}
                {canCollaborateTask && (task.checklists ?? []).length === 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      if (activeTaskId) addChecklist(activeTaskId, "Checklist");
                      setChecklistsSectionCollapsed(false);
                      setPendingRename(true);
                    }}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg px-2 py-2 cursor-pointer",
                      "text-left text-[13px] font-medium text-(--ui-texto-secundario) hover:bg-(--ui-hover) hover:text-(--ui-texto-forte) transition",
                    )}
                  >
                    <CheckSquare
                      className={cn(
                        "h-3.5 w-3.5",
                        "text-(--ui-texto-secundario)",
                      )}
                    />
                    Adicionar checklist
                  </button>
                )}

                {canCollaborateTask &&
                  (task.attachments?.length ?? 0) === 0 && (
                    <div>
                      <div
                        className={cn(
                          "relative",
                          isLeftAttachmentMenuOpen && "z-50",
                        )}
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setIsLeftAttachmentMenuOpen(
                              !isLeftAttachmentMenuOpen,
                            )
                          }
                          className={cn(
                            "flex w-full items-center gap-3 rounded-lg px-2 py-2 cursor-pointer",
                            "text-left text-[13px] font-medium text-(--ui-texto-secundario) hover:bg-(--ui-hover) hover:text-(--ui-texto-forte) transition",
                          )}
                        >
                          <Plus
                            className={cn(
                              "h-3.5 w-3.5",
                              "text-(--ui-texto-secundario)",
                            )}
                          />
                          Anexar arquivo
                        </button>

                        {isLeftAttachmentMenuOpen && (
                          <div
                            ref={leftAttachmentMenuRef}
                            className={cn(
                              "absolute bottom-full left-0 z-100 mb-2 w-52 rounded-xl border py-2 animate-in fade-in slide-in-from-bottom-2 duration-200",
                              "pauta-theme-menu",
                            )}
                          >
                            <button
                              type="button"
                              className={cn(
                                "flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors cursor-pointer",
                                "text-(--ui-texto-item) hover:bg-(--ui-hover)",
                              )}
                              onClick={() =>
                                triggerFileUpload(
                                  "document",
                                  ".pdf,.doc,.docx,.txt,.rtf",
                                )
                              }
                            >
                              <FileText className="h-4 w-4 text-blue-500" />
                              Documento
                            </button>
                            <button
                              type="button"
                              className={cn(
                                "flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors cursor-pointer",
                                "text-(--ui-texto-item) hover:bg-(--ui-hover)",
                              )}
                              onClick={() =>
                                triggerFileUpload("image", "image/*")
                              }
                            >
                              <ImageIcon className="h-4 w-4 text-emerald-500" />
                              Imagem
                            </button>
                            <button
                              type="button"
                              className={cn(
                                "flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors cursor-pointer",
                                "text-(--ui-texto-item) hover:bg-(--ui-hover)",
                              )}
                              onClick={() =>
                                triggerFileUpload("video", "video/*")
                              }
                            >
                              <Video className="h-4 w-4 text-rose-500" />
                              Vídeo
                            </button>
                            <button
                              type="button"
                              className={cn(
                                "flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors cursor-pointer",
                                "text-(--ui-texto-item) hover:bg-(--ui-hover)",
                              )}
                              onClick={() =>
                                triggerFileUpload(
                                  "spreadsheet",
                                  ".xls,.xlsx,.csv",
                                )
                              }
                            >
                              <Table className="h-4 w-4 text-orange-500" />
                              Planilha
                            </button>
                            <button
                              type="button"
                              className={cn(
                                "flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors cursor-pointer",
                                "text-(--ui-texto-item) hover:bg-(--ui-hover)",
                              )}
                              onClick={() =>
                                triggerFileUpload(
                                  "powerpoint",
                                  ".ppt,.pptx,.odp",
                                )
                              }
                            >
                              <Presentation className="h-4 w-4 text-violet-500" />
                              PowerPoint
                            </button>
                            <button
                              type="button"
                              className={cn(
                                "flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors cursor-pointer",
                                "text-(--ui-texto-item) hover:bg-(--ui-hover)",
                              )}
                              onClick={() =>
                                triggerFileUpload(
                                  "archive",
                                  ".zip,.rar,.7z,.tar,.gz",
                                )
                              }
                            >
                              <Archive className="h-4 w-4 text-amber-500" />
                              ZIP
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
              </div>

              {/* ── ANEXOS ─────────────────────────────────────────────────── */}
              {(taskAttachments.length > 0 || hasPendingTaskAttachments) && (
                <div
                  className={cn(
                    "mt-2 mb-2 border-t px-1 pt-4",
                    "border-(--ui-borda-suave)",
                  )}
                >
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setAttachmentsCollapsed(!attachmentsCollapsed)
                        }
                        className={cn(
                          "transition cursor-pointer",
                          "text-(--ui-texto-secundario) hover:text-(--ui-texto-forte)",
                        )}
                      >
                        <ChevronRight
                          className={cn(
                            "h-3.5 w-3.5 transition-transform",
                            !attachmentsCollapsed && "rotate-90",
                          )}
                        />
                      </button>
                      <h4
                        className={cn(
                          "flex items-center gap-2 text-[11px] font-black uppercase tracking-widest",
                          "text-(--ui-texto-secundario)",
                        )}
                      >
                        <Paperclip className="h-3 w-3" />
                        Anexos
                        <span
                          className={cn(
                            "ml-1 text-[11px] font-bold",
                            "text-(--ui-texto-secundario)",
                          )}
                        >
                          {taskAttachments.length +
                            stagedTaskAttachments.length}{" "}
                          Anexos
                        </span>
                      </h4>
                    </div>
                  </div>

                  {!attachmentsCollapsed && (
                    <>
                      {taskAttachments.length > 0 && (
                        <div className="mb-3 flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              void handleDownloadTaskAttachments(
                                taskAttachments,
                                "all",
                              )
                            }
                            disabled={isDownloadingAttachmentArchive}
                            className={cn(
                              "inline-flex h-9 items-center gap-2 rounded-full px-4 text-[11px] font-semibold transition cursor-pointer",
                              isDownloadingAttachmentArchive &&
                                "cursor-not-allowed opacity-60",
                              "bg-(--ui-superficie-suave) text-(--ui-texto-forte) ring-1 ring-(--ui-borda) hover:bg-(--ui-azul-fundo) hover:text-(--ui-azul-texto) hover:ring-(--ui-azul-borda)",
                            )}
                          >
                            <Download className="h-3.5 w-3.5" />
                            {isDownloadingAttachmentArchive
                              ? "Preparando download..."
                              : "Baixar todos os anexos"}
                          </button>

                          {selectedTaskAttachments.length > 0 && (
                            <button
                              type="button"
                              onClick={() =>
                                void handleDownloadTaskAttachments(
                                  selectedTaskAttachments,
                                  "selected",
                                )
                              }
                              disabled={isDownloadingAttachmentArchive}
                              className={cn(
                                "inline-flex h-9 items-center gap-2 rounded-full px-4 text-[11px] font-semibold transition cursor-pointer",
                                isDownloadingAttachmentArchive &&
                                  "cursor-not-allowed opacity-60",
                                "bg-(--ui-azul-fundo) text-(--ui-azul-texto) ring-1 ring-(--ui-azul-borda) hover:bg-(--ui-azul-fundo)",
                              )}
                            >
                              <Download className="h-3.5 w-3.5" />
                              Baixar selecionados
                              <span className="text-[10px] opacity-80">
                                ({selectedTaskAttachments.length})
                              </span>
                            </button>
                          )}
                        </div>
                      )}

                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                        {taskAttachments.map((att) => {
                          const isImageAttachment = att.type === "image";
                          const canUseAttachmentAsCover =
                            isImageAttachment && Boolean(att.url);
                          const isCoverAttachment =
                            task.coverAttachmentId === att.id &&
                            isImageAttachment;
                          const fallbackUploader =
                            (task.ownerId && graph.members[task.ownerId]) ||
                            null;
                          const uploaderName =
                            att.uploadedByName ||
                            fallbackUploader?.name ||
                            null;
                          const uploaderAvatarUrl =
                            att.uploadedByAvatarUrl ||
                            fallbackUploader?.avatarUrl;
                          const uploaderAvatarColor =
                            att.uploadedByAvatarColor ||
                            fallbackUploader?.avatarColor;
                          const isAttachmentSelected =
                            selectedTaskAttachmentIds.includes(att.id);
                          const previewableTaskAttachments: AttachmentPreviewItem[] =
                            taskAttachments.map((attachment) => ({
                              id: attachment.id,
                              name: attachment.name,
                              url: attachment.url,
                              type: attachment.type,
                              createdAt: attachment.createdAt,
                              size: attachment.size,
                            }));
                          const canPreviewAttachment = Boolean(
                            resolveAttachmentPreviewKind({
                              name: att.name,
                              type: att.type,
                            }),
                          );

                          return (
                            <AttachmentCard
                              key={att.id}
                              attachment={att}
                              uploaderName={uploaderName}
                              uploaderAvatarUrl={uploaderAvatarUrl}
                              uploaderAvatarColor={uploaderAvatarColor}
                              badge={
                                isCoverAttachment ? (
                                  <span
                                    className={cn(
                                      "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold",
                                      "bg-(--ui-azul-fundo) text-(--ui-azul-texto) ring-1 ring-(--ui-azul-borda)",
                                    )}
                                  >
                                    <ImageIcon className="h-3 w-3" />
                                    Capa
                                  </span>
                                ) : null
                              }
                              footer={
                                (canUseAttachmentAsCover ||
                                  isCoverAttachment) &&
                                (canEditTask || isCoverAttachment) ? (
                                  <div
                                    className={cn(
                                      "border-t pt-3",
                                      "border-(--ui-borda-suave)",
                                    )}
                                  >
                                    {canEditTask && (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setTaskCoverAttachment(
                                            taskId,
                                            isCoverAttachment ? null : att.id,
                                          )
                                        }
                                        className={cn(
                                          "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[11px] font-semibold transition cursor-pointer",
                                          isCoverAttachment
                                            ? isDarkMode
                                              ? "bg-blue-500/16 text-blue-100 ring-1 ring-blue-500/25 hover:bg-blue-500/22"
                                              : "bg-blue-600 text-white shadow-sm shadow-blue-200 hover:bg-blue-700"
                                            : "bg-(--ui-superficie-suave) text-(--ui-texto-secundario) ring-1 ring-(--ui-borda) hover:bg-(--ui-azul-fundo) hover:text-(--ui-azul-texto) hover:ring-(--ui-azul-borda)",
                                        )}
                                      >
                                        {isCoverAttachment ? (
                                          <>
                                            <Check className="h-3.5 w-3.5" />
                                            Remover capa
                                          </>
                                        ) : (
                                          <>
                                            <ImageIcon className="h-3.5 w-3.5" />
                                            Usar como capa
                                          </>
                                        )}
                                      </button>
                                    )}
                                  </div>
                                ) : null
                              }
                              actions={
                                <>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void downloadAttachmentFile({
                                        url: att.url,
                                        fileName: att.name,
                                      })
                                    }
                                    className="grid h-7 w-7 place-items-center rounded-full bg-white text-slate-700 shadow-sm ring-1 ring-slate-200 transition hover:bg-blue-600 hover:text-white hover:ring-blue-600 cursor-pointer"
                                    title="Baixar anexo"
                                  >
                                    <Download className="h-3.5 w-3.5" />
                                  </button>
                                  {canEditTask && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        deleteAttachment(taskId, att.id)
                                      }
                                      className="grid h-7 w-7 place-items-center rounded-full bg-white text-slate-700 shadow-sm ring-1 ring-slate-200 transition hover:bg-rose-600 hover:text-white hover:ring-rose-600 cursor-pointer"
                                      title="Excluir anexo"
                                    >
                                      <X className="h-3.5 w-3.5" />
                                    </button>
                                  )}
                                </>
                              }
                              selectionControl={
                                <button
                                  type="button"
                                  onClick={() =>
                                    toggleTaskAttachmentSelection(att.id)
                                  }
                                  className={cn(
                                    "grid h-7 w-7 place-items-center rounded-xl border backdrop-blur-sm transition cursor-pointer",
                                    isAttachmentSelected
                                      ? isDarkMode
                                        ? "border-blue-400/45 bg-blue-500/18 text-blue-100 shadow-[0_10px_25px_rgba(37,99,235,0.25)]"
                                        : "border-blue-300 bg-blue-600 text-white shadow-[0_10px_25px_rgba(37,99,235,0.18)]"
                                      : isDarkMode
                                        ? "border-white/12 bg-black/45 text-transparent hover:border-blue-400/30 hover:bg-blue-500/10"
                                        : "border-white/70 bg-white/90 text-transparent shadow-sm hover:border-blue-200 hover:bg-blue-50",
                                  )}
                                  title={
                                    isAttachmentSelected
                                      ? "Desmarcar anexo"
                                      : "Selecionar anexo"
                                  }
                                  aria-pressed={isAttachmentSelected}
                                >
                                  <Check className="h-4 w-4" />
                                </button>
                              }
                              selectionControlVisible={isAttachmentSelected}
                              onPreview={
                                canPreviewAttachment
                                  ? () =>
                                      openAttachmentPreview(
                                        previewableTaskAttachments,
                                        att.id,
                                      )
                                  : undefined
                              }
                              className={cn(
                                isCoverAttachment &&
                                  ("border-(--ui-azul-borda) ring-1 ring-(--ui-azul-borda)"),
                              )}
                            />
                          );
                        })}
                        {stagedTaskAttachments.map((attachment) => (
                          <AttachmentCard
                            key={attachment.id}
                            attachment={attachment}
                            uploaderName={authUser?.name || "Você"}
                            uploaderAvatarUrl={authUser?.avatarUrl}
                            uploaderAvatarColor={authUser?.avatarColor}
                            statusLabel={getUploadStatusLabel(attachment)}
                            className={cn(
                              "border-(--ui-azul-borda) ring-1 ring-(--ui-azul-borda)",
                            )}
                            footer={
                              <AttachmentUploadProgress
                                isDarkMode={isDarkMode}
                                progress={attachment.progress}
                                etaMs={attachment.etaMs}
                                phase={attachment.uploadPhase}
                                errorMessage={attachment.errorMessage}
                              />
                            }
                            actions={
                              attachment.uploadPhase === "error" ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setStagedTaskAttachments((current) =>
                                      current.filter(
                                        (item) => item.id !== attachment.id,
                                      ),
                                    )
                                  }
                                  className="grid h-7 w-7 place-items-center rounded-full bg-white text-slate-700 shadow-sm ring-1 ring-slate-200 transition hover:bg-rose-600 hover:text-white hover:ring-rose-600"
                                  title="Remover anexo"
                                >
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              ) : null
                            }
                          />
                        ))}
                      </div>
                      {canCollaborateTask && (
                        <div
                          className={cn(
                            "relative mt-3",
                            isLeftAttachmentMenuOpen && "z-50",
                          )}
                        >
                          <button
                            type="button"
                            onClick={() =>
                              setIsLeftAttachmentMenuOpen(
                                !isLeftAttachmentMenuOpen,
                              )
                            }
                            className={cn(
                              "flex w-full items-center gap-2 px-2 py-1.5 text-left text-[13px] font-medium transition cursor-pointer",
                              "text-(--ui-texto-secundario) hover:bg-(--ui-hover) hover:text-(--ui-texto-forte)",
                            )}
                          >
                            <Plus className="h-3.5 w-3.5" />
                            Anexar arquivo
                          </button>
                          {isLeftAttachmentMenuOpen && (
                            <div
                              ref={leftAttachmentMenuRef}
                              className={cn(
                                "absolute bottom-full left-0 z-100 mb-2 w-52 rounded-xl border py-2 animate-in fade-in slide-in-from-bottom-2 duration-200",
                                "pauta-theme-menu",
                              )}
                            >
                              <button
                                type="button"
                                className={cn(
                                  "flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors cursor-pointer",
                                  "text-(--ui-texto-item) hover:bg-(--ui-hover)",
                                )}
                                onClick={() =>
                                  triggerFileUpload(
                                    "document",
                                    ".pdf,.doc,.docx,.txt,.rtf",
                                  )
                                }
                              >
                                <FileText className="h-4 w-4 text-blue-500" />
                                Documento
                              </button>
                              <button
                                type="button"
                                className={cn(
                                  "flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors cursor-pointer",
                                  "text-(--ui-texto-item) hover:bg-(--ui-hover)",
                                )}
                                onClick={() =>
                                  triggerFileUpload("image", "image/*")
                                }
                              >
                                <ImageIcon className="h-4 w-4 text-emerald-500" />
                                Imagem
                              </button>
                              <button
                                type="button"
                                className={cn(
                                  "flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors cursor-pointer",
                                  "text-(--ui-texto-item) hover:bg-(--ui-hover)",
                                )}
                                onClick={() =>
                                  triggerFileUpload("video", "video/*")
                                }
                              >
                                <Video className="h-4 w-4 text-rose-500" />
                                Vídeo
                              </button>
                              <button
                                type="button"
                                className={cn(
                                  "flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors cursor-pointer",
                                  "text-(--ui-texto-item) hover:bg-(--ui-hover)",
                                )}
                                onClick={() =>
                                  triggerFileUpload(
                                    "spreadsheet",
                                    ".xls,.xlsx,.csv",
                                  )
                                }
                              >
                                <Table className="h-4 w-4 text-orange-500" />
                                Planilha
                              </button>
                              <button
                                type="button"
                                className={cn(
                                  "flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors cursor-pointer",
                                  "text-(--ui-texto-item) hover:bg-(--ui-hover)",
                                )}
                                onClick={() =>
                                  triggerFileUpload(
                                    "powerpoint",
                                    ".ppt,.pptx,.odp",
                                  )
                                }
                              >
                                <Presentation className="h-4 w-4 text-violet-500" />
                                PowerPoint
                              </button>
                              <button
                                type="button"
                                className={cn(
                                  "flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors cursor-pointer",
                                  "text-(--ui-texto-item) hover:bg-(--ui-hover)",
                                )}
                                onClick={() =>
                                  triggerFileUpload(
                                    "archive",
                                    ".zip,.rar,.7z,.tar,.gz",
                                  )
                                }
                              >
                                <Archive className="h-4 w-4 text-amber-500" />
                                ZIP
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* ── CHECKLISTS ─────────────────────────────────────────────────── */}
              {(task.checklists ?? []).length > 0 && (
                <div
                  className={cn(
                    "mt-2 mb-2 border-t px-1 pt-4",
                    "border-(--ui-borda-suave)",
                  )}
                >
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setChecklistsSectionCollapsed(
                            !checklistsSectionCollapsed,
                          )
                        }
                        className={cn(
                          "transition cursor-pointer",
                          "text-(--ui-texto-secundario) hover:text-(--ui-texto-forte)",
                        )}
                      >
                        <ChevronRight
                          className={cn(
                            "h-3.5 w-3.5 transition-transform",
                            !checklistsSectionCollapsed && "rotate-90",
                          )}
                        />
                      </button>
                      <h4
                        className={cn(
                          "flex items-center gap-2 text-[11px] font-black uppercase tracking-widest",
                          "text-(--ui-texto-secundario)",
                        )}
                      >
                        <CheckSquare className="h-3 w-3" />
                        Checklists
                        <span
                          className={cn(
                            "ml-1 text-[11px] font-bold",
                            "text-(--ui-texto-secundario)",
                          )}
                        >
                          {(task.checklists ?? []).length} Checklists
                        </span>
                      </h4>
                    </div>
                  </div>

                  {!checklistsSectionCollapsed && (
                    <div className="space-y-4">
                      {(task.checklists ?? []).map((cl) => {
                        const doneCount = cl.items.filter(
                          (it) => it.done,
                        ).length;
                        const isCollapsed = checklistsCollapsed[cl.id];
                        const isRenaming = renamingChecklistId === cl.id;
                        return (
                          <div key={cl.id} className="mt-2">
                            {/* Cabe\u00e7alho da checklist */}
                            <div className="flex items-center gap-2 mb-1">
                              <button
                                type="button"
                                onClick={() =>
                                  setChecklistsCollapsed((prev) => ({
                                    ...prev,
                                    [cl.id]: !prev[cl.id],
                                  }))
                                }
                                className={cn(
                                  "transition cursor-pointer",
                                  "text-(--ui-texto-secundario) hover:text-(--ui-texto-forte)",
                                )}
                              >
                                <ChevronRight
                                  className={cn(
                                    "h-3.5 w-3.5 transition-transform",
                                    !isCollapsed && "rotate-90",
                                  )}
                                />
                              </button>

                              {/* Nome edit\u00e1vel inline */}
                              {canCollaborateTask && isRenaming ? (
                                <div className="relative inline-flex items-center min-w-15">
                                  <span className="invisible whitespace-pre text-[13px] font-bold px-2 py-0.5 pointer-events-none">
                                    {renameDraft || " "}
                                  </span>
                                  <input aria-label="Novo nome do arquivo"
                                    autoFocus
                                    value={renameDraft}
                                    onChange={(e) =>
                                      setRenameDraft(e.target.value)
                                    }
                                    onBlur={() => {
                                      if (renameDraft.trim())
                                        renameChecklist(
                                          taskId,
                                          cl.id,
                                          renameDraft.trim(),
                                        );
                                      setRenamingChecklistId(null);
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") {
                                        if (renameDraft.trim())
                                          renameChecklist(
                                            taskId,
                                            cl.id,
                                            renameDraft.trim(),
                                          );
                                        setRenamingChecklistId(null);
                                      }
                                      if (e.key === "Escape")
                                        setRenamingChecklistId(null);
                                    }}
                                    className={cn(
                                      "absolute inset-0 w-full rounded border px-2 py-0.5 text-[13px] font-bold outline-none",
                                      "border-(--ui-azul-borda-foco) bg-(--ui-superficie-suave) text-(--ui-texto-principal)",
                                    )}
                                  />
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (!canCollaborateTask) return;
                                    setRenamingChecklistId(cl.id);
                                    setRenameDraft(cl.name);
                                  }}
                                  className={cn(
                                    "rounded px-1.5 py-0.5 text-left text-[13px] font-bold transition-colors",
                                    canCollaborateTask
                                      ? isDarkMode
                                        ? "cursor-pointer text-(--text-main) hover:bg-white/5 hover:text-blue-300"
                                        : "cursor-pointer text-slate-700 hover:bg-slate-100/80 hover:text-slate-900"
                                      : "cursor-default text-(--ui-texto-forte)",
                                  )}
                                >
                                  {cl.name}
                                </button>
                              )}

                              <span
                                className={cn(
                                  "ml-auto text-[11px]",
                                  "text-(--ui-texto-secundario)",
                                )}
                              >
                                {doneCount} de {cl.items.length}
                              </span>

                              {canCollaborateTask && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setConfirmConfig({
                                      isOpen: true,
                                      title: "Excluir Checklist",
                                      message: `Tem certeza que deseja excluir a checklist "${cl.name}"?`,
                                      onConfirm: () =>
                                        deleteChecklist(taskId, cl.id),
                                    });
                                  }}
                                  className={cn(
                                    "transition cursor-pointer",
                                    "text-(--ui-texto-apagado) hover:text-(--ui-rose-texto)",
                                  )}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>

                            {!isCollapsed && (
                              <div className="ml-5">
                                {cl.items.length > 0 && (
                                  <div
                                    className={cn(
                                      "mb-2 h-1.5 w-full overflow-hidden rounded-full",
                                      "bg-(--ui-fundo-neutro)",
                                    )}
                                  >
                                    <div
                                      className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                                      style={{
                                        width: `${(doneCount / cl.items.length) * 100}%`,
                                      }}
                                    />
                                  </div>
                                )}

                                <DndContext
                                  sensors={sensors}
                                  collisionDetection={closestCenter}
                                  onDragEnd={(e) => {
                                    if (!canEditTask) return;
                                    handleDragEnd(e, cl.id);
                                  }}
                                >
                                  <ul className="space-y-0.5">
                                    <SortableContext
                                      items={cl.items.map((it) => it.id)}
                                      strategy={verticalListSortingStrategy}
                                    >
                                      {cl.items.map((item) => (
                                        <SortableChecklistItem
                                          key={item.id}
                                          item={item}
                                          taskId={taskId}
                                          checklistId={cl.id}
                                          members={graph.members}
                                          onToggle={toggleChecklistItem}
                                          onUpdateLabel={
                                            updateChecklistItemLabel
                                          }
                                          onDelete={(tid, cid, iid, label) => {
                                            setConfirmConfig({
                                              isOpen: true,
                                              title: "Excluir Item",
                                              message: `Deseja realmente excluir o item "${label}"?`,
                                              onConfirm: () =>
                                                deleteChecklistItem(
                                                  tid,
                                                  cid,
                                                  iid,
                                                ),
                                            });
                                          }}
                                          onSetAssignee={
                                            setChecklistItemAssignee
                                          }
                                          isEditing={editingItemId === item.id}
                                          onStartEditing={() => {
                                            if (!canCollaborateTask) return;
                                            setEditingItemId(item.id);
                                          }}
                                          onStopEditing={() =>
                                            setEditingItemId(null)
                                          }
                                          itemAssigneeMenuOpen={
                                            itemAssigneeMenuOpen
                                          }
                                          setItemAssigneeMenuOpen={
                                            setItemAssigneeMenuOpen
                                          }
                                          canEditContent={canCollaborateTask}
                                          canManageAssignees={canEditTask}
                                          canReorder={canEditTask}
                                        />
                                      ))}
                                    </SortableContext>
                                  </ul>
                                </DndContext>

                                {canCollaborateTask && (
                                  <div className="mt-0.5 flex items-center gap-2 py-1">
                                    <div
                                      className={cn(
                                        "h-4 w-4 shrink-0 rounded border-2 border-dashed",
                                        "border-(--ui-borda)",
                                      )}
                                    />
                                    <input aria-label="+ Adicionar item"
                                      value={newItemLabels[cl.id] ?? ""}
                                      onChange={(e) =>
                                        setNewItemLabels((prev) => ({
                                          ...prev,
                                          [cl.id]: e.target.value,
                                        }))
                                      }
                                      onKeyDown={(e) => {
                                        if (
                                          e.key === "Enter" &&
                                          (newItemLabels[cl.id] ?? "").trim()
                                        ) {
                                          if (activeTaskId)
                                            addChecklistItem(
                                              activeTaskId,
                                              cl.id,
                                              newItemLabels[cl.id].trim(),
                                            );
                                          setNewItemLabels((prev) => ({
                                            ...prev,
                                            [cl.id]: "",
                                          }));
                                        }
                                      }}
                                      placeholder="+ Adicionar item"
                                      className={cn(
                                        "flex-1 bg-transparent text-[13px] font-medium outline-none",
                                        "text-(--ui-texto-secundario) placeholder:text-(--ui-texto-secundario) focus:text-(--ui-texto-forte)",
                                      )}
                                    />
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {canCollaborateTask && !checklistsSectionCollapsed && (
                    <button
                      type="button"
                      onClick={() => {
                        if (activeTaskId)
                          addChecklist(activeTaskId, "Checklist");
                        setPendingRename(true);
                      }}
                      className={cn(
                        "mt-2 mb-4 flex items-center gap-2 px-2 py-1.5 cursor-pointer",
                        "text-[13px] font-medium text-(--ui-texto-secundario) hover:bg-(--ui-hover) hover:text-(--ui-texto-forte) transition",
                      )}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Adicionar checklist
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Coluna direita: Activity + Comentários */}
          {showTaskEngagementPanel && (
            <div
              key={isMobileViewport ? mobilePanelView : "desktop-engagement"}
              className={cn(
                "pauta-task-details-sidebar relative z-0 flex min-h-0 flex-col",
                isMobileViewport
                  ? "min-w-0 flex-1"
                  : "w-[min(26rem,42vw)] shrink-0",
                isMobileViewport && "animate-in fade-in duration-200",
                isMobileViewport &&
                  (mobilePanelTransitionDirection === "right"
                    ? "slide-in-from-right-2"
                    : "slide-in-from-left-2"),
                isDarkMode
                  ? cn(
                      !isMobileViewport && "border-l border-(--border-subtle)",
                      "bg-(--bg-surface)",
                    )
                  : cn(
                      !isMobileViewport && "border-l border-slate-100",
                      "bg-slate-50/50",
                    ),
              )}
              {...getFileDropHandlers("comment")}
            >
              {renderFileDropOverlay("comment")}
              {/* Header Activity */}
              <div
                className={cn(
                  "flex shrink-0 flex-col border-b",
                  "border-(--ui-borda-suave)",
                )}
              >
                <div className="flex items-center justify-between px-3 py-2.5 min-h-13 sm:px-4 sm:py-3">
                  {isActivitySearchOpen ? (
                    <div className="flex flex-1 items-center gap-2 animate-in fade-in slide-in-from-right-2 duration-300">
                      <input aria-label="Pesquisar em atividades e comentários..."
                        autoFocus
                        type="text"
                        className={cn(
                          "h-9 flex-1 rounded-xl border px-3 text-[13px] outline-none transition-all font-medium",
                          "border-(--ui-borda) bg-(--ui-superficie-suave) text-(--ui-texto-forte) focus:border-blue-400 focus:ring-4 focus:ring-(--ui-azul-foco)",
                        )}
                        placeholder="Pesquisar em atividades e comentários..."
                        value={activitySearchQuery}
                        onChange={(e) => setActivitySearchQuery(e.target.value)}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setIsActivitySearchOpen(false);
                          setActivitySearchQuery("");
                        }}
                        className={cn(
                          "rounded-lg p-2 transition cursor-pointer",
                          "text-(--ui-texto-secundario) hover:bg-(--ui-hover-forte) hover:text-(--ui-texto-forte)",
                        )}
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <>
                      {isMobileViewport ? (
                        <div className="flex min-w-0 items-center gap-2">
                          <div
                            className={cn(
                              "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl",
                              "bg-(--ui-fundo-neutro)",
                            )}
                          >
                            {activeTab === "comments" ? (
                              <MessageSquare className="h-4 w-4" />
                            ) : (
                              <Clock className="h-4 w-4" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <p
                              className={cn(
                                "truncate text-sm font-bold",
                                "text-(--ui-texto-principal)",
                              )}
                            >
                              {activeTab === "comments"
                                ? "Comentários"
                                : "Atividade"}
                            </p>
                            <p
                              className={cn(
                                "text-[10px] font-medium",
                                "text-(--ui-texto-secundario)",
                              )}
                            >
                              {activeTab === "comments"
                                ? "Conversa e respostas deste card"
                                : "Histórico recente deste card"}
                            </p>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-3 sm:gap-4">
                          <button
                            type="button"
                            onClick={() => setActiveTab("comments")}
                            className={cn(
                              "text-sm font-bold relative transition-colors cursor-pointer",
                              activeTab === "comments"
                                ? "text-(--ui-texto-principal)"
                                : "text-(--ui-texto-secundario) hover:text-(--ui-texto-forte)",
                            )}
                          >
                            Comentários
                            {activeTab === "comments" && (
                              <span className="absolute -bottom-3.75 left-0 right-0 h-0.75 bg-blue-600 rounded-t-full" />
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => setActiveTab("activity")}
                            className={cn(
                              "text-sm font-bold relative transition-colors cursor-pointer",
                              activeTab === "activity"
                                ? "text-(--ui-texto-principal)"
                                : "text-(--ui-texto-secundario) hover:text-(--ui-texto-forte)",
                            )}
                          >
                            Atividade
                            {activeTab === "activity" && (
                              <span className="absolute -bottom-3.75 left-0 right-0 h-0.75 bg-blue-600 rounded-t-full" />
                            )}
                          </button>
                        </div>
                      )}
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setIsActivitySearchOpen(true)}
                          className={cn(
                            "flex items-center justify-center rounded-lg p-1.5 transition cursor-pointer",
                            "text-(--ui-texto-secundario) hover:bg-(--ui-hover-forte) hover:text-(--ui-texto-secundario)",
                          )}
                          title="Pesquisar"
                        >
                          <Search className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setActivitySortOrder((prev) =>
                              prev === "desc" ? "asc" : "desc",
                            )
                          }
                          className={cn(
                            "rounded-lg p-1.5 transition cursor-pointer flex items-center justify-center",
                            activitySortOrder === "asc"
                              ? "bg-(--ui-azul-fundo) text-(--ui-azul-texto)"
                              : "text-(--ui-texto-secundario) hover:bg-(--ui-hover-forte) hover:text-(--ui-texto-secundario)",
                          )}
                          title={
                            activitySortOrder === "desc"
                              ? "Mais recentes primeiro"
                              : "Mais antigos primeiro"
                          }
                        >
                          <ArrowUpDown className="h-4 w-4" />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div className="pauta-scroll-safe min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4">
                <ul className="space-y-3">
                  {activityItems.filter((item) =>
                    activeTab === "comments"
                      ? item.type !== "activity"
                      : item.type === "activity",
                  ).length === 0 ? (
                    <li
                      className={cn(
                        "text-xs",
                        "text-(--ui-texto-secundario)",
                      )}
                    >
                      Nenhuma{" "}
                      {activeTab === "activity" ? "atividade" : "comentário"}{" "}
                      ainda.
                    </li>
                  ) : (
                    activityItems
                      .filter((item) =>
                        activeTab === "comments"
                          ? item.type !== "activity"
                          : item.type === "activity",
                      )
                      .map((item) => {
                        const commentState = commentsById[item.id];
                        return (
                          <li
                            key={item.id}
                            className={cn(
                              "group/item text-xs",
                              item.type !== "activity"
                                ? cn(
                                    "relative rounded-xl border",
                                    "border-(--ui-borda) bg-(--ui-superficie) text-(--ui-texto-item)",
                                  )
                                : cn(
                                    "flex gap-3",
                                    "text-(--ui-texto-item)",
                                  ),
                            )}
                          >
                            {item.type === "activity" ? (
                              <>
                                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                                <div className="min-w-0 flex-1">
                                  <div
                                    className={cn(
                                      "font-medium break-word whitespace-pre-wrap",
                                      "text-(--ui-texto-principal)",
                                    )}
                                    dangerouslySetInnerHTML={{
                                      __html: item.label,
                                    }}
                                    title={item.label.replace(/<[^>]+>/g, "")}
                                  />
                                  <time
                                    dateTime={item.date}
                                    className={cn(
                                      "mt-0.5 block text-[10px]",
                                      "text-(--ui-texto-secundario)",
                                    )}
                                  >
                                    {formatActivityDate(item.date)}
                                  </time>
                                </div>
                              </>
                            ) : (
                              <>
                                {/* Header do comentário */}
                                <div className="flex items-center gap-2 px-3 pt-3 pb-2">
                                  {(() => {
                                    const m = mentionableMembers.find(
                                      (x) => x.name === item.label,
                                    );
                                    if (m) {
                                      return (
                                        <UserAvatar member={m} size={28} />
                                      );
                                    }
                                    const colors = [
                                      "#7c3aed",
                                      "#2563eb",
                                      "#059669",
                                      "#d97706",
                                      "#dc2626",
                                      "#0891b2",
                                    ];
                                    let h = 0;
                                    for (let i = 0; i < item.label.length; i++)
                                      h =
                                        item.label.charCodeAt(i) +
                                        ((h << 5) - h);
                                    return (
                                      <div
                                        className="h-7 w-7 shrink-0 rounded-full flex items-center justify-center text-[9px] font-black text-white"
                                        style={{
                                          background:
                                            colors[Math.abs(h) % colors.length],
                                        }}
                                      >
                                        {getInitials(item.label)}
                                      </div>
                                    );
                                  })()}
                                  <div className="min-w-0 flex-1">
                                    <p
                                      className={cn(
                                        "truncate text-[12px] font-semibold leading-tight",
                                        "text-(--ui-texto-principal)",
                                      )}
                                    >
                                      {item.label}
                                    </p>
                                    <time
                                      dateTime={item.date}
                                      className={cn(
                                        "text-[10px]",
                                        "text-(--ui-texto-secundario)",
                                      )}
                                    >
                                      {formatActivityDate(item.date)}
                                    </time>
                                  </div>
                                  {/* 3-dot menu */}
                                  {canCommentTask &&
                                    editingCommentId !== item.id && (
                                      <div
                                        className={cn(
                                          "relative transition-opacity",
                                          openCommentMenuId === item.id
                                            ? "opacity-100"
                                            : "opacity-0 group-hover/item:opacity-100",
                                        )}
                                      >
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setOpenCommentMenuId(
                                              openCommentMenuId === item.id
                                                ? null
                                                : item.id,
                                            )
                                          }
                                          className={cn(
                                            "grid h-6 w-6 place-items-center rounded-md transition cursor-pointer",
                                            "text-(--ui-texto-secundario) hover:bg-(--ui-hover-forte) hover:text-(--ui-texto-forte)",
                                          )}
                                        >
                                          <MoreHorizontal className="h-3.5 w-3.5" />
                                        </button>
                                        {openCommentMenuId === item.id && (
                                          <>
                                            <div
                                              className="fixed inset-0 z-10"
                                              onClick={() =>
                                                setOpenCommentMenuId(null)
                                              }
                                            />
                                            <div
                                              className={cn(
                                                "absolute right-0 top-full z-20 mt-1 min-w-130px overflow-hidden rounded-xl border shadow-lg",
                                                "border-(--ui-borda) bg-(--ui-superficie-suave)",
                                              )}
                                            >
                                              <button
                                                type="button"
                                                onClick={() => {
                                                  const nextEditingState =
                                                    extractManagedLinksFromText(
                                                      item.sub ?? "",
                                                      commentState?.linkDisplayModes,
                                                    );
                                                  setEditingCommentId(item.id);
                                                  setEditingCommentText(
                                                    nextEditingState.text,
                                                  );
                                                  setEditingCommentLinkDisplayModes(
                                                    nextEditingState.linkDisplayModes,
                                                  );
                                                  setOpenCommentMenuId(null);
                                                }}
                                                className={cn(
                                                  "flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] transition cursor-pointer",
                                                  "text-(--ui-texto-forte) hover:bg-(--ui-hover)",
                                                )}
                                              >
                                                <Pencil className="h-3.5 w-3.5" />
                                                Editar
                                              </button>
                                              <button
                                                type="button"
                                                onClick={() => {
                                                  setOpenCommentMenuId(null);
                                                  setConfirmConfig({
                                                    isOpen: true,
                                                    title: "Excluir Comentário",
                                                    message:
                                                      "Deseja realmente excluir este comentário?",
                                                    onConfirm: () =>
                                                      Promise.all(
                                                        (
                                                          item.commentIds ?? [
                                                            item.id,
                                                          ]
                                                        ).map((commentId) =>
                                                          deleteComment(
                                                            taskId,
                                                            commentId,
                                                          ),
                                                        ),
                                                      ),
                                                  });
                                                }}
                                                className={cn(
                                                  "flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] transition cursor-pointer",
                                                  "text-(--ui-rose-texto) hover:bg-(--ui-rose-fundo)",
                                                )}
                                              >
                                                <Trash2 className="h-3.5 w-3.5 opacity-70" />
                                                Excluir
                                              </button>
                                            </div>
                                          </>
                                        )}
                                      </div>
                                    )}
                                </div>

                                {/* Conteúdo do comentário */}
                                <div className="px-3 pb-3">
                                  {editingCommentId === item.id ? (
                                    <div className="relative">
                                      <div className="relative">
                                        {editingCommentInlineChecklist ? (
                                          <div
                                            className={cn(
                                              "rounded-lg border",
                                              "border-(--ui-azul-borda)",
                                            )}
                                          >
                                            <InlineChecklistEditor
                                              isDarkMode={isDarkMode}
                                              value={editingCommentText}
                                              onChange={setEditingCommentText}
                                              trailingTextareaExternalRef={
                                                editChecklistTrailingTextareaRef
                                              }
                                              onTrailingTextCursorChange={
                                                syncEditChecklistTrailingMentionState
                                              }
                                              onMentionReset={() => {
                                                setEditMentionTrigger(null);
                                                setEditMentionMenuStyle(
                                                  undefined,
                                                );
                                              }}
                                              onExitToText={(nextText) => {
                                                setEditingCommentText(nextText);
                                                requestAnimationFrame(() => {
                                                  const textarea =
                                                    editTextareaRef.current;
                                                  if (!textarea) return;
                                                  textarea.focus();
                                                  const cursorPosition =
                                                    nextText.length;
                                                  textarea.setSelectionRange(
                                                    cursorPosition,
                                                    cursorPosition,
                                                  );
                                                });
                                              }}
                                            />
                                          </div>
                                        ) : (
                                          <>
                                            {shouldUseEditingCommentPreview && (
                                              <MentionInputPreview
                                                value={editingCommentText}
                                                members={mentionableMembers}
                                                scrollTop={0}
                                                scrollLeft={0}
                                                hiddenUrls={
                                                  hiddenEditingCommentUrls
                                                }
                                                className={cn(
                                                  "px-2 py-1.5 text-xs leading-5",
                                                  "text-(--ui-texto-forte)",
                                                )}
                                              />
                                            )}
                                            <textarea
                                              ref={editTextareaRef}
                                              autoFocus
                                              value={editingCommentText}
                                              onChange={(e) => {
                                                const nextValue =
                                                  extractManagedLinksFromText(
                                                    e.target.value,
                                                    editingCommentLinkDisplayModes,
                                                  );
                                                setEditingCommentText(
                                                  nextValue.text,
                                                );
                                                setEditingCommentLinkDisplayModes(
                                                  nextValue.linkDisplayModes,
                                                );
                                                syncEditMentionState(
                                                  nextValue.text,
                                                  e.target.selectionStart,
                                                  e.target,
                                                );
                                              }}
                                              onKeyUp={(e) => {
                                                syncEditMentionState(
                                                  editingCommentText,
                                                  (
                                                    e.target as HTMLTextAreaElement
                                                  ).selectionStart,
                                                  e.target as HTMLTextAreaElement,
                                                );
                                              }}
                                              onClick={(e) => {
                                                syncEditMentionState(
                                                  editingCommentText,
                                                  (
                                                    e.target as HTMLTextAreaElement
                                                  ).selectionStart,
                                                  e.target as HTMLTextAreaElement,
                                                );
                                              }}
                                              onKeyDown={(event) => {
                                                if (
                                                  event.key === "Enter" &&
                                                  !event.shiftKey &&
                                                  editMentionTrigger
                                                ) {
                                                  event.preventDefault();
                                                  if (
                                                    filteredEditMentionMembers.length >
                                                    0
                                                  ) {
                                                    handleEditMentionSelect(
                                                      filteredEditMentionMembers[0],
                                                    );
                                                  }
                                                  return;
                                                }

                                                if (
                                                  event.key === "Enter" &&
                                                  !event.shiftKey
                                                ) {
                                                  const nextChecklistState =
                                                    getChecklistLineInsertion(
                                                      event.currentTarget.value,
                                                      event.currentTarget
                                                        .selectionStart,
                                                      event.currentTarget
                                                        .selectionEnd,
                                                    );
                                                  if (nextChecklistState) {
                                                    event.preventDefault();
                                                    setEditingCommentText(
                                                      nextChecklistState.text,
                                                    );
                                                    requestAnimationFrame(
                                                      () => {
                                                        const textarea =
                                                          editTextareaRef.current;
                                                        if (!textarea) return;
                                                        textarea.focus();
                                                        textarea.setSelectionRange(
                                                          nextChecklistState.cursorPosition,
                                                          nextChecklistState.cursorPosition,
                                                        );
                                                      },
                                                    );
                                                  }
                                                }
                                              }}
                                              rows={2}
                                              className={cn(
                                                "relative z-10 w-full rounded-lg border bg-transparent px-2 py-1.5 text-xs outline-none wrap-anywhere",
                                                "border-(--ui-azul-borda) text-(--ui-texto-forte) focus:ring-1 focus:ring-(--ui-azul-foco)",
                                              )}
                                              style={
                                                shouldUseEditingCommentPreview
                                                  ? {
                                                      color: "transparent",
                                                      WebkitTextFillColor:
                                                        "transparent",
                                                      caretColor: isDarkMode
                                                        ? "#f8fafc"
                                                        : "#0f172a",
                                                    }
                                                  : undefined
                                              }
                                            />
                                          </>
                                        )}
                                      </div>
                                      {editingCommentUrls.length > 0 && (
                                        <div
                                          ref={editLinkPreviewRef}
                                          className="mt-3 flex flex-wrap items-start gap-3"
                                        >
                                          {editingCommentUrls.map((url) => {
                                            const linkMode = getLinkDisplayMode(
                                              editingCommentLinkDisplayModes,
                                              url,
                                            );
                                            return (
                                              <LinkPreviewCard
                                                isDarkMode={isDarkMode}
                                                key={`task-comment-edit-${url}`}
                                                url={url}
                                                mode={linkMode}
                                                onModeChange={(mode) =>
                                                  updateEditingCommentDraftLinkMode(
                                                    url,
                                                    mode,
                                                  )
                                                }
                                                onEdit={() =>
                                                  editEditingCommentDraftLink(
                                                    url,
                                                  )
                                                }
                                                onRemove={() =>
                                                  removeEditingCommentDraftLink(
                                                    url,
                                                  )
                                                }
                                              />
                                            );
                                          })}
                                        </div>
                                      )}
                                      <MentionPicker
                                        isDarkMode={isDarkMode}
                                        isOpen={
                                          !!editMentionTrigger &&
                                          filteredEditMentionMembers.length > 0
                                        }
                                        title="Mencionar no comentário"
                                        search={editMentionTrigger?.query ?? ""}
                                        members={filteredEditMentionMembers}
                                        onSearchChange={() => {}}
                                        onSelect={handleEditMentionSelect}
                                        menuRef={editMentionMenuRef}
                                        placement="floating"
                                        position="fixed"
                                        renderInPortal
                                        showSearch={false}
                                        style={editMentionMenuStyle}
                                      />
                                      <div className="mt-1 flex gap-2">
                                        <button
                                          type="button"
                                          onClick={async () => {
                                            const trimmed =
                                              editingCommentText.trim();
                                            if (trimmed) {
                                              await editComment(
                                                taskId,
                                                item.id,
                                                trimmed,
                                                resolveTaskMentionIds(
                                                  trimmed,
                                                  mentionableMembers,
                                                ),
                                                editingCommentLinkDisplayModes,
                                              );
                                            }
                                            setEditingCommentId(null);
                                            setEditMentionTrigger(null);
                                            setEditMentionMenuStyle(undefined);
                                            setEditingCommentText("");
                                            setEditingCommentLinkDisplayModes(
                                              {},
                                            );
                                          }}
                                          className="rounded-md bg-blue-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-blue-700 transition cursor-pointer"
                                        >
                                          Salvar
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setEditingCommentId(null);
                                            setEditMentionTrigger(null);
                                            setEditMentionMenuStyle(undefined);
                                            setEditingCommentText("");
                                            setEditingCommentLinkDisplayModes(
                                              {},
                                            );
                                          }}
                                          className={cn(
                                            "rounded-md border px-2.5 py-1 text-[11px] transition cursor-pointer",
                                            "border-(--ui-borda) text-(--ui-texto-secundario) hover:bg-(--ui-hover)",
                                          )}
                                        >
                                          Cancelar
                                        </button>
                                      </div>
                                    </div>
                                  ) : (
                                    item.sub &&
                                    (parseInlineChecklistText(item.sub) ? (
                                      <InlineChecklistContent
                                        isDarkMode={isDarkMode}
                                        value={item.sub}
                                        members={mentionableMembers}
                                        hiddenUrls={getHiddenLinkUrlsForRender(
                                          getManagedLinkUrls(
                                            item.sub,
                                            commentState?.linkDisplayModes,
                                          ),
                                          commentState?.linkDisplayModes,
                                        )}
                                        onToggle={
                                          canCommentTask
                                            ? (index) => {
                                                void togglePersistedCommentChecklistItem(
                                                  item.id,
                                                  item.sub ?? "",
                                                  commentState?.linkDisplayModes,
                                                  index,
                                                );
                                              }
                                            : undefined
                                        }
                                      />
                                    ) : (
                                      <p
                                        className={cn(
                                          "whitespace-pre-wrap text-[13px] wrap-anywhere",
                                          "text-(--ui-texto-secundario)",
                                        )}
                                      >
                                        {renderTextWithMentionsAndLinks(
                                          stripLinkUrlsFromText(item.sub),
                                          mentionableMembers,
                                          getMentionChipClassName("content",
                                          ),
                                          getLinkClassName(),
                                          getHiddenLinkUrlsForRender(
                                            getManagedLinkUrls(
                                              item.sub,
                                              commentState?.linkDisplayModes,
                                            ),
                                            commentState?.linkDisplayModes,
                                          ),
                                        )}
                                      </p>
                                    ))
                                  )}
                                  {!!item.sub &&
                                    getManagedLinkUrls(
                                      item.sub,
                                      commentState?.linkDisplayModes,
                                    ).length > 0 && (
                                      <div className="mt-3 flex flex-wrap items-start gap-3">
                                        {getManagedLinkUrls(
                                          item.sub,
                                          commentState?.linkDisplayModes,
                                        ).map((url) => {
                                          const linkMode = getLinkDisplayMode(
                                            commentState?.linkDisplayModes,
                                            url,
                                          );
                                          return (
                                            <LinkPreviewCard
                                              isDarkMode={isDarkMode}
                                              key={`task-comment-${item.id}-${url}`}
                                              url={url}
                                              mode={linkMode}
                                              onModeChange={(mode) =>
                                                void updateCommentLinkDisplayMode(
                                                  taskId,
                                                  item.id,
                                                  normalizeLinkUrl(url),
                                                  mode,
                                                )
                                              }
                                              onEdit={() => {
                                                void editPersistedCommentLink(
                                                  item.id,
                                                  item.sub ?? "",
                                                  commentState?.linkDisplayModes,
                                                  url,
                                                );
                                              }}
                                              onRemove={() => {
                                                void removePersistedCommentLink(
                                                  item.id,
                                                  item.sub ?? "",
                                                  commentState?.linkDisplayModes,
                                                  url,
                                                );
                                              }}
                                            />
                                          );
                                        })}
                                      </div>
                                    )}

                                  {!!item.attachments?.length && (
                                    <CommentAttachmentsCarousel
                                      className="mt-3"
                                      attachments={item.attachments}
                                      uploaderName={item.label}
                                      fallbackDate={item.date}
                                      onPreview={(attachmentId) =>
                                        openAttachmentPreview(
                                          (item.attachments ?? []).map(
                                            (commentAttachment) => ({
                                              id: commentAttachment.id,
                                              name: commentAttachment.name,
                                              url: commentAttachment.url,
                                              type: commentAttachment.type,
                                              createdAt:
                                                commentAttachment.createdAt ||
                                                item.date,
                                              size: commentAttachment.size,
                                            }),
                                          ),
                                          attachmentId,
                                        )
                                      }
                                    />
                                  )}
                                </div>

                                {/* Footer do comentário */}
                                {editingCommentId !== item.id && (
                                  <div
                                    className={cn(
                                      "border-t px-3 py-2",
                                      "border-(--ui-borda-suave)",
                                    )}
                                  >
                                    <div className="flex items-center justify-between">
                                      <div className="flex items-center gap-1">
                                        {/* Curtir */}
                                        <button
                                          type="button"
                                          onClick={() =>
                                            handleCommentLikeToggle(item.id)
                                          }
                                          className={cn(
                                            "grid h-6 w-6 place-items-center rounded-md transition cursor-pointer",
                                            commentState?.likedByMe
                                              ? "text-(--ui-azul-texto) bg-(--ui-azul-fundo)"
                                              : "text-(--ui-texto-secundario) hover:bg-(--ui-hover-forte) hover:text-(--ui-texto-forte)",
                                          )}
                                        >
                                          <ThumbsUp className="h-3.5 w-3.5" />
                                        </button>

                                        {/* Emoji picker */}
                                        <div className="relative">
                                          {openReactionPickerCommentId ===
                                            item.id && (
                                            <>
                                              <div
                                                className="fixed inset-0 z-200"
                                                onClick={() =>
                                                  setOpenReactionPickerCommentId(
                                                    null,
                                                  )
                                                }
                                              />
                                              <div
                                                className={cn(
                                                  "fixed z-201 w-72 overflow-hidden rounded-2xl border animate-in fade-in slide-in-from-bottom-2 duration-200",
                                                  isDarkMode
                                                    ? "border-(--border-subtle) bg-(--bg-elevated) shadow-(--shadow-soft)"
                                                    : "border-slate-200 bg-white shadow-xl shadow-slate-200/50",
                                                )}
                                                style={
                                                  reactionPickerAnchor
                                                    ? {
                                                        bottom: `calc(100vh - ${reactionPickerAnchor.top}px + 6px)`,
                                                        left: reactionPickerAnchor.left,
                                                      }
                                                    : undefined
                                                }
                                              >
                                                <div
                                                  className={cn(
                                                    "border-b p-3",
                                                    "border-(--ui-borda-suave)",
                                                  )}
                                                >
                                                  <input aria-label="Pesquisar..."
                                                    type="text"
                                                    value={emojiSearch}
                                                    onChange={(e) =>
                                                      setEmojiSearch(
                                                        e.target.value,
                                                      )
                                                    }
                                                    placeholder="Pesquisar..."
                                                    className={cn(
                                                      "w-full rounded-xl border px-3 py-2 text-sm outline-none transition",
                                                      "border-(--ui-azul-borda) bg-(--ui-superficie-suave) text-(--ui-texto-forte) placeholder:text-(--ui-texto-secundario) focus:border-(--ui-azul-borda-foco)",
                                                    )}
                                                  />
                                                </div>
                                                <div className="max-h-48 overflow-y-auto px-3 py-3 scrollbar-thin">
                                                  {filteredEmojiGroups.length ===
                                                  0 ? (
                                                    <p
                                                      className={cn(
                                                        "py-4 text-center text-xs font-medium",
                                                        "text-(--ui-texto-secundario)",
                                                      )}
                                                    >
                                                      Nenhum emoji encontrado.
                                                    </p>
                                                  ) : (
                                                    filteredEmojiGroups.map(
                                                      (group) => (
                                                        <div
                                                          key={group.title}
                                                          className="mb-3 last:mb-0"
                                                        >
                                                          <p
                                                            className={cn(
                                                              "mb-1.5 text-[11px] font-medium",
                                                              "text-(--ui-texto-secundario)",
                                                            )}
                                                          >
                                                            {group.title}
                                                          </p>
                                                          <div className="flex flex-wrap gap-1">
                                                            {group.emojis.map(
                                                              (emoji) => (
                                                                <button
                                                                  key={`r-${group.title}-${emoji}`}
                                                                  type="button"
                                                                  onClick={() =>
                                                                    setEmojiForComment(
                                                                      item.id,
                                                                      commentState?.reaction,
                                                                      emoji,
                                                                    )
                                                                  }
                                                                  className={cn(
                                                                    "grid h-7 w-7 place-items-center rounded-lg text-lg transition cursor-pointer",
                                                                    "hover:bg-(--ui-hover-forte)",
                                                                  )}
                                                                >
                                                                  {emoji}
                                                                </button>
                                                              ),
                                                            )}
                                                          </div>
                                                        </div>
                                                      ),
                                                    )
                                                  )}
                                                </div>
                                                <div
                                                  className={cn(
                                                    "flex items-center gap-1 border-t px-2 py-2",
                                                    "border-(--ui-borda-suave) bg-(--ui-fundo-sutil)",
                                                  )}
                                                >
                                                  {COMMENT_EMOJI_CATEGORY_TABS.map(
                                                    (tabItem) => {
                                                      const TabIcon =
                                                        tabItem.icon;
                                                      return (
                                                        <button
                                                          key={tabItem.key}
                                                          type="button"
                                                          onClick={() => {
                                                            setActiveEmojiTab(
                                                              tabItem.key,
                                                            );
                                                            setEmojiSearch("");
                                                          }}
                                                          className={cn(
                                                            "grid h-7 w-7 place-items-center rounded-lg transition cursor-pointer",
                                                            "text-(--ui-texto-secundario) hover:bg-(--ui-hover) hover:text-(--ui-texto-forte)",
                                                            activeEmojiTab ===
                                                              tabItem.key &&
                                                              ("bg-(--ui-azul-fundo) text-(--ui-azul-texto)"),
                                                          )}
                                                        >
                                                          <TabIcon className="h-4 w-4" />
                                                        </button>
                                                      );
                                                    },
                                                  )}
                                                </div>
                                              </div>
                                            </>
                                          )}
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              setEmojiSearch("");
                                              if (
                                                openReactionPickerCommentId ===
                                                item.id
                                              ) {
                                                setOpenReactionPickerCommentId(
                                                  null,
                                                );
                                              } else {
                                                const rect = (
                                                  e.currentTarget as HTMLElement
                                                ).getBoundingClientRect();
                                                setReactionPickerAnchor({
                                                  top: rect.top,
                                                  left: rect.left,
                                                });
                                                setOpenReactionPickerCommentId(
                                                  item.id,
                                                );
                                              }
                                            }}
                                            className={cn(
                                              "grid h-6 w-6 place-items-center rounded-md transition cursor-pointer",
                                              "text-(--ui-texto-secundario) hover:bg-(--ui-hover-forte) hover:text-(--ui-texto-forte)",
                                            )}
                                          >
                                            <Smile className="h-3.5 w-3.5" />
                                          </button>
                                        </div>
                                      </div>

                                      {canCommentTask && (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setReplyingToId(item.id);
                                            setTimeout(
                                              () =>
                                                commentInputRef.current?.focus(),
                                              0,
                                            );
                                          }}
                                          className="text-[11px] font-medium text-blue-600 hover:underline cursor-pointer transition"
                                        >
                                          Responder
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                )}

                                {/* Emoji chip no canto inferior direito */}
                                {commentState?.reaction && (
                                  <div
                                    className="absolute -bottom-2.5 right-3 z-10 text-lg leading-none"
                                    aria-label={`Reação ${commentState.reaction}`}
                                  >
                                    {commentState.reaction}
                                  </div>
                                )}

                                {/* Filhos e Respostas */}
                                {item.children && item.children.length > 0 && (
                                  <div
                                    className={cn(
                                      "mx-3 mb-3 space-y-3 border-l-2 pl-3",
                                      "border-(--ui-borda-suave)",
                                    )}
                                  >
                                    {item.children.map((child: any) => (
                                      <div
                                        key={child.id}
                                        className="flex gap-2"
                                      >
                                        <div className="min-w-0 flex-1">
                                          {(() => {
                                            const childState =
                                              commentsById[child.id];
                                            return (
                                              <>
                                                <p
                                                  className={cn(
                                                    "font-semibold text-[12px]",
                                                    "text-(--ui-texto-principal)",
                                                  )}
                                                >
                                                  {child.label}
                                                </p>
                                                <div className="mt-0.5">
                                                  {parseInlineChecklistText(
                                                    child.sub,
                                                  ) ? (
                                                    <InlineChecklistContent
                                                      isDarkMode={isDarkMode}
                                                      value={child.sub}
                                                      members={
                                                        mentionableMembers
                                                      }
                                                      hiddenUrls={getHiddenLinkUrlsForRender(
                                                        getManagedLinkUrls(
                                                          child.sub,
                                                          childState?.linkDisplayModes,
                                                        ),
                                                        childState?.linkDisplayModes,
                                                      )}
                                                      onToggle={
                                                        canCommentTask
                                                          ? (index) => {
                                                              void togglePersistedCommentChecklistItem(
                                                                child.id,
                                                                child.sub ?? "",
                                                                childState?.linkDisplayModes,
                                                                index,
                                                              );
                                                            }
                                                          : undefined
                                                      }
                                                    />
                                                  ) : (
                                                    <span
                                                      className={cn(
                                                        "whitespace-pre-wrap text-[13px] wrap-anywhere",
                                                        "text-(--ui-texto-secundario)",
                                                      )}
                                                    >
                                                      {renderTextWithMentionsAndLinks(
                                                        stripLinkUrlsFromText(
                                                          child.sub,
                                                        ),
                                                        mentionableMembers,
                                                        getMentionChipClassName("content",
                                                        ),
                                                        getLinkClassName(),
                                                        getHiddenLinkUrlsForRender(
                                                          getManagedLinkUrls(
                                                            child.sub,
                                                            childState?.linkDisplayModes,
                                                          ),
                                                          childState?.linkDisplayModes,
                                                        ),
                                                      )}
                                                    </span>
                                                  )}
                                                </div>
                                                {getManagedLinkUrls(
                                                  child.sub,
                                                  childState?.linkDisplayModes,
                                                ).length > 0 && (
                                                  <div className="mt-3 flex flex-wrap items-start gap-3">
                                                    {getManagedLinkUrls(
                                                      child.sub,
                                                      childState?.linkDisplayModes,
                                                    ).map((url) => {
                                                      const linkMode =
                                                        getLinkDisplayMode(
                                                          childState?.linkDisplayModes,
                                                          url,
                                                        );
                                                      return (
                                                        <LinkPreviewCard
                                                          key={`task-reply-${child.id}-${url}`}
                                                          url={url}
                                                          isDarkMode={
                                                            isDarkMode
                                                          }
                                                          mode={linkMode}
                                                          onModeChange={(
                                                            mode,
                                                          ) =>
                                                            void updateCommentLinkDisplayMode(
                                                              taskId,
                                                              child.id,
                                                              normalizeLinkUrl(
                                                                url,
                                                              ),
                                                              mode,
                                                            )
                                                          }
                                                          onEdit={() => {
                                                            void editPersistedCommentLink(
                                                              child.id,
                                                              child.sub ?? "",
                                                              childState?.linkDisplayModes,
                                                              url,
                                                            );
                                                          }}
                                                          onRemove={() => {
                                                            void removePersistedCommentLink(
                                                              child.id,
                                                              child.sub ?? "",
                                                              childState?.linkDisplayModes,
                                                              url,
                                                            );
                                                          }}
                                                        />
                                                      );
                                                    })}
                                                  </div>
                                                )}
                                                {!!child.attachments
                                                  ?.length && (
                                                  <CommentAttachmentsCarousel
                                                    className="mt-3"
                                                    attachments={
                                                      child.attachments
                                                    }
                                                    uploaderName={child.label}
                                                    fallbackDate={child.date}
                                                    onPreview={(attachmentId) =>
                                                      openAttachmentPreview(
                                                        (
                                                          child.attachments ??
                                                          []
                                                        ).map(
                                                          (
                                                            childAttachment: TaskAttachment,
                                                          ) => ({
                                                            id: childAttachment.id,
                                                            name: childAttachment.name,
                                                            url: childAttachment.url,
                                                            type: childAttachment.type,
                                                            createdAt:
                                                              childAttachment.createdAt ||
                                                              child.date,
                                                            size: childAttachment.size,
                                                          }),
                                                        ),
                                                        attachmentId,
                                                      )
                                                    }
                                                  />
                                                )}
                                                <time
                                                  className={cn(
                                                    "mt-0.5 block text-[10px]",
                                                    "text-(--ui-texto-secundario)",
                                                  )}
                                                >
                                                  {formatActivityDate(
                                                    child.date,
                                                  )}
                                                </time>
                                              </>
                                            );
                                          })()}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </>
                            )}
                          </li>
                        );
                      })
                  )}
                </ul>
              </div>

              {/* Comentários: compositor estilo ClickUp */}
              {(!isMobileViewport || activeTab === "comments") && (
                <div
                  className={cn(
                    "shrink-0 border-t p-3 sm:p-4",
                    "border-(--ui-borda-suave)",
                  )}
                  style={
                    isMobileViewport
                      ? {
                          paddingBottom:
                            "calc(env(safe-area-inset-bottom, 0px) + 0.75rem)",
                          paddingLeft:
                            "calc(env(safe-area-inset-left, 0px) + 0.75rem)",
                          paddingRight:
                            "calc(env(safe-area-inset-right, 0px) + 0.75rem)",
                        }
                      : undefined
                  }
                >
                  <form
                    onSubmit={handleSubmitComment}
                    className={cn(
                      "relative rounded-2xl border",
                      "border-(--ui-borda) bg-(--ui-superficie)",
                    )}
                  >
                    {!canCommentTask && (
                      <div
                        className={cn(
                          "border-b px-3.5 py-3 text-sm font-medium",
                          "border-(--ui-ambar-borda) bg-(--ui-ambar-fundo) text-(--ui-ambar-texto)",
                        )}
                      >
                        Seu nível de acesso atual não permite comentar nesta
                        card.
                      </div>
                    )}
                    {replyingToId && (
                      <div
                        className={cn(
                          "flex items-center justify-between rounded-t-[calc(1rem-1px)] border-b px-3 py-2 text-xs",
                          "border-(--ui-azul-borda) bg-(--ui-azul-fundo) text-(--ui-azul-texto)",
                        )}
                      >
                        <span className="font-medium">
                          Respondendo a{" "}
                          {
                            comments.find((c) => c.id === replyingToId)
                              ?.authorName
                          }
                        </span>
                        <button
                          type="button"
                          onClick={() => setReplyingToId(null)}
                          className="cursor-pointer text-blue-500 hover:text-blue-800"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                    <div className="relative px-3.5 pt-3">
                      {hasStagedCommentAttachments && (
                        <AttachmentCarousel
                          className="mb-3"
                        >
                          {stagedCommentAttachments.map((attachment) => (
                            <AttachmentCard
                              key={attachment.id}
                              attachment={attachment}
                              uploaderName={authUser?.name || "Você"}
                              uploaderAvatarUrl={authUser?.avatarUrl}
                              uploaderAvatarColor={authUser?.avatarColor}
                              statusLabel={getUploadStatusLabel(attachment)}
                              onPreview={
                                attachment.previewUrl || attachment.url
                                  ? () =>
                                      openAttachmentPreview(
                                        stagedCommentAttachments
                                          .filter(
                                            (item) =>
                                              item.previewUrl || item.url,
                                          )
                                          .map((item) => ({
                                            id: item.id,
                                            name: item.name,
                                            url: item.url,
                                            previewUrl: item.previewUrl,
                                            type: item.type,
                                            createdAt: item.createdAt,
                                            size: item.size,
                                          })),
                                        attachment.id,
                                      )
                                  : undefined
                              }
                              className={cn(
                                "w-56 shrink-0 snap-start",
                                "border-(--ui-azul-borda) ring-1 ring-(--ui-azul-borda)",
                              )}
                              footer={
                                !attachment.url || attachment.errorMessage ? (
                                  <AttachmentUploadProgress
                                    isDarkMode={isDarkMode}
                                    progress={attachment.progress}
                                    etaMs={attachment.etaMs}
                                    phase={
                                      attachment.errorMessage
                                        ? "error"
                                        : attachment.uploadPhase
                                    }
                                    errorMessage={attachment.errorMessage}
                                  />
                                ) : null
                              }
                              actions={
                                <button
                                  type="button"
                                  onClick={() =>
                                    setStagedCommentAttachments((current) =>
                                      current.filter(
                                        (item) => item.id !== attachment.id,
                                      ),
                                    )
                                  }
                                  className="grid h-7 w-7 place-items-center rounded-full bg-white text-slate-700 shadow-sm ring-1 ring-slate-200 transition hover:bg-rose-600 hover:text-white hover:ring-rose-600 cursor-pointer"
                                  title="Remover anexo"
                                >
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              }
                            />
                          ))}
                        </AttachmentCarousel>
                      )}

                      <div className="relative">
                        {commentInlineChecklist ? (
                          <div
                            className={cn(
                              "rounded-lg border",
                              "border-(--ui-borda)",
                            )}
                          >
                            <InlineChecklistEditor
                              isDarkMode={isDarkMode}
                              value={commentText}
                              readOnly={!canCommentTask}
                              onChange={setCommentText}
                              trailingTextareaExternalRef={
                                commentChecklistTrailingTextareaRef
                              }
                              onTrailingTextCursorChange={
                                syncCommentChecklistTrailingMentionState
                              }
                              onMentionReset={() => {
                                setCommentMentionTrigger(null);
                                setCommentMentionSearch("");
                              }}
                              onExitToText={(nextText) => {
                                setCommentText(nextText);
                                requestAnimationFrame(() => {
                                  const textarea = commentInputRef.current;
                                  if (!textarea) return;
                                  syncCommentTextareaHeight(textarea);
                                  textarea.focus();
                                  const cursorPosition = nextText.length;
                                  textarea.setSelectionRange(
                                    cursorPosition,
                                    cursorPosition,
                                  );
                                });
                              }}
                            />
                          </div>
                        ) : (
                          <>
                            {shouldUseCommentMentionPreview && (
                              <MentionInputPreview
                                value={commentText}
                                members={mentionableMembers}
                                scrollTop={commentEditorScroll.top}
                                scrollLeft={commentEditorScroll.left}
                                hiddenUrls={hiddenCommentDraftUrls}
                                className={cn(
                                  "text-sm leading-6",
                                  "text-(--ui-texto-principal)",
                                )}
                              />
                            )}
                            <textarea
                              ref={commentInputRef}
                              id="task-comment"
                              rows={2}
                              value={commentText}
                              onChange={handleCommentChange}
                              onScroll={(event) =>
                                setCommentEditorScroll({
                                  top: event.currentTarget.scrollTop,
                                  left: event.currentTarget.scrollLeft,
                                })
                              }
                              onKeyDown={(event) => {
                                if (
                                  event.key === "Escape" &&
                                  commentMentionTrigger
                                ) {
                                  setCommentMentionTrigger(null);
                                  setCommentMentionSearch("");
                                  return;
                                }
                                if (event.key === "Enter" && !event.shiftKey) {
                                  if (
                                    commentMentionTrigger &&
                                    filteredCommentMentionMembers.length > 0
                                  ) {
                                    event.preventDefault();
                                    handleCommentMentionSelect(
                                      filteredCommentMentionMembers[0],
                                    );
                                    return;
                                  }
                                  const nextChecklistState =
                                    getChecklistLineInsertion(
                                      event.currentTarget.value,
                                      event.currentTarget.selectionStart,
                                      event.currentTarget.selectionEnd,
                                    );
                                  if (nextChecklistState) {
                                    event.preventDefault();
                                    setCommentText(nextChecklistState.text);
                                    requestAnimationFrame(() => {
                                      const textarea = commentInputRef.current;
                                      if (!textarea) return;
                                      syncCommentTextareaHeight(textarea);
                                      textarea.focus();
                                      textarea.setSelectionRange(
                                        nextChecklistState.cursorPosition,
                                        nextChecklistState.cursorPosition,
                                      );
                                    });
                                    return;
                                  }
                                  event.preventDefault();
                                  if (
                                    !isUploadingCommentAttachment &&
                                    canCommentTask &&
                                    (commentText.trim() ||
                                      hasStagedCommentAttachments)
                                  ) {
                                    event.currentTarget.form?.requestSubmit();
                                  }
                                }
                              }}
                              placeholder="Escreva um comentário..."
                              className={cn(
                                "relative z-10 max-h-26 w-full resize-none overflow-y-auto bg-transparent text-sm leading-6 outline-none wrap-anywhere",
                                commentText && "selection:bg-blue-500/25",
                                isDarkMode
                                  ? cn(
                                      "text-(--text-main) placeholder:text-(--text-soft)",
                                      commentMentionTrigger &&
                                        "rounded-lg ring-2 ring-blue-500/15",
                                    )
                                  : cn(
                                      "text-slate-800 placeholder:text-slate-500",
                                      commentMentionTrigger &&
                                        "rounded-lg ring-2 ring-blue-100",
                                    ),
                              )}
                              style={
                                shouldUseCommentMentionPreview
                                  ? {
                                      color: "transparent",
                                      WebkitTextFillColor: "transparent",
                                      caretColor: isDarkMode
                                        ? "#f8fafc"
                                        : "#0f172a",
                                    }
                                  : undefined
                              }
                              disabled={!canCommentTask}
                            />
                          </>
                        )}
                        {commentDraftUrls.length > 0 && (
                          <div
                            ref={commentLinkPreviewRef}
                            className="mt-3 flex flex-wrap items-start gap-3"
                          >
                            {commentDraftUrls.map((url) => {
                              const linkMode = getLinkDisplayMode(
                                commentLinkDisplayModes,
                                url,
                              );
                              return (
                                <LinkPreviewCard
                                  isDarkMode={isDarkMode}
                                  key={`task-comment-draft-${url}`}
                                  url={url}
                                  mode={linkMode}
                                  onModeChange={(mode) =>
                                    updateCommentDraftLinkMode(url, mode)
                                  }
                                  onEdit={() => editCommentDraftLink(url)}
                                  onRemove={() => removeCommentDraftLink(url)}
                                />
                              );
                            })}
                          </div>
                        )}

                        <MentionPicker
                          isDarkMode={isDarkMode}
                          isOpen={!!commentMentionTrigger}
                          title="Mencionar no comentário"
                          search={commentMentionSearch}
                          members={filteredCommentMentionMembers}
                          onSearchChange={setCommentMentionSearch}
                          onSelect={handleCommentMentionSelect}
                          menuRef={commentMentionMenuRef}
                          placement="top"
                        />
                      </div>
                    </div>

                    <div
                      className={cn(
                        "flex items-center justify-between gap-2 rounded-b-2xl border-t px-3 py-2.5",
                        "border-(--ui-borda-suave) bg-(--ui-fundo-sutil)",
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <div className="relative">
                          <button
                            type="button"
                            onClick={() => {
                              if (!canCommentTask) return;
                              setIsEmojiPickerOpen(false);
                              setIsAttachmentMenuOpen(!isAttachmentMenuOpen);
                            }}
                            className={cn(
                              "pauta-touch-target grid h-9 w-9 place-items-center rounded-xl transition cursor-pointer",
                              !canCommentTask &&
                                "cursor-not-allowed opacity-60",
                              "text-(--ui-texto-secundario) hover:bg-(--ui-hover) hover:text-(--ui-texto-forte)",
                            )}
                            aria-label="Anexar"
                          >
                            <Plus className="h-4.5 w-4.5" />
                          </button>

                          {canCommentTask && isAttachmentMenuOpen && (
                            <div
                              ref={mainAttachmentMenuRef}
                              className={cn(
                                "absolute bottom-[calc(100%+8px)] left-0 z-1000 w-52 rounded-xl border py-2 animate-in fade-in slide-in-from-bottom-2 duration-200",
                                "pauta-theme-menu",
                              )}
                            >
                              <button
                                type="button"
                                className={cn(
                                  "flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors cursor-pointer",
                                  "text-(--ui-texto-item) hover:bg-(--ui-hover)",
                                )}
                                onClick={() =>
                                  triggerFileUpload(
                                    "document",
                                    ".pdf,.doc,.docx,.txt,.rtf",
                                    "comment",
                                  )
                                }
                              >
                                <FileText className="h-4 w-4 text-blue-500" />
                                Documento
                              </button>
                              <button
                                type="button"
                                className={cn(
                                  "flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors cursor-pointer",
                                  "text-(--ui-texto-item) hover:bg-(--ui-hover)",
                                )}
                                onClick={() =>
                                  triggerFileUpload(
                                    "image",
                                    "image/*",
                                    "comment",
                                  )
                                }
                              >
                                <ImageIcon className="h-4 w-4 text-emerald-500" />
                                Imagem
                              </button>
                              <button
                                type="button"
                                className={cn(
                                  "flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors cursor-pointer",
                                  "text-(--ui-texto-item) hover:bg-(--ui-hover)",
                                )}
                                onClick={() =>
                                  triggerFileUpload(
                                    "video",
                                    "video/*",
                                    "comment",
                                  )
                                }
                              >
                                <Video className="h-4 w-4 text-rose-500" />
                                Vídeo
                              </button>
                              <button
                                type="button"
                                className={cn(
                                  "flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors cursor-pointer",
                                  "text-(--ui-texto-item) hover:bg-(--ui-hover)",
                                )}
                                onClick={() =>
                                  triggerFileUpload(
                                    "spreadsheet",
                                    ".xls,.xlsx,.csv",
                                    "comment",
                                  )
                                }
                              >
                                <Table className="h-4 w-4 text-orange-500" />
                                Planilha
                              </button>
                              <button
                                type="button"
                                className={cn(
                                  "flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors cursor-pointer",
                                  "text-(--ui-texto-item) hover:bg-(--ui-hover)",
                                )}
                                onClick={() =>
                                  triggerFileUpload(
                                    "powerpoint",
                                    ".ppt,.pptx,.odp",
                                    "comment",
                                  )
                                }
                              >
                                <Presentation className="h-4 w-4 text-violet-500" />
                                PowerPoint
                              </button>
                              <button
                                type="button"
                                className={cn(
                                  "flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors cursor-pointer",
                                  "text-(--ui-texto-item) hover:bg-(--ui-hover)",
                                )}
                                onClick={() =>
                                  triggerFileUpload(
                                    "archive",
                                    ".zip,.rar,.7z,.tar,.gz",
                                    "comment",
                                  )
                                }
                              >
                                <Archive className="h-4 w-4 text-amber-500" />
                                ZIP
                              </button>
                            </div>
                          )}
                          <input
                            type="file"
                            ref={fileInputRef}
                            className="hidden"
                            onChange={handleFileChange}
                            multiple
                            accept={uploadAccept}
                          />
                        </div>

                        <div className="relative" ref={emojiPickerRef}>
                          <button
                            type="button"
                            onClick={() => {
                              if (!canCommentTask) return;
                              setIsAttachmentMenuOpen(false);
                              setIsEmojiPickerOpen((current) => !current);
                            }}
                            className={cn(
                              "pauta-touch-target grid h-9 w-9 place-items-center rounded-xl transition cursor-pointer",
                              !canCommentTask &&
                                "cursor-not-allowed opacity-60",
                              "text-(--ui-texto-secundario) hover:bg-(--ui-hover) hover:text-(--ui-texto-forte)",
                            )}
                            aria-label="Emoji"
                          >
                            <Smile className="h-4.5 w-4.5" />
                          </button>

                          {canCommentTask && isEmojiPickerOpen && (
                            <div
                              className={cn(
                                "absolute bottom-[calc(100%+8px)] left-0 z-1300 w-72 overflow-hidden rounded-2xl border animate-in fade-in slide-in-from-bottom-2 duration-200",
                                isDarkMode
                                  ? "border-(--border-subtle) bg-(--bg-elevated) shadow-(--shadow-soft)"
                                  : "border-slate-200 bg-white shadow-xl shadow-slate-200/50",
                              )}
                            >
                              <div
                                className={cn(
                                  "border-b p-3",
                                  "border-(--ui-borda-suave)",
                                )}
                              >
                                <input aria-label="Pesquisar..."
                                  type="text"
                                  value={emojiSearch}
                                  onChange={(e) =>
                                    setEmojiSearch(e.target.value)
                                  }
                                  placeholder="Pesquisar..."
                                  className={cn(
                                    "w-full rounded-xl border px-3 py-2 text-sm outline-none transition",
                                    "border-(--ui-azul-borda) bg-(--ui-superficie-suave) text-(--ui-texto-forte) placeholder:text-(--ui-texto-secundario) focus:border-(--ui-azul-borda-foco)",
                                  )}
                                />
                              </div>

                              <div className="max-h-64 overflow-y-auto px-3 py-3 scrollbar-thin">
                                {filteredEmojiGroups.length === 0 ? (
                                  <p
                                    className={cn(
                                      "py-6 text-center text-xs font-medium",
                                      "text-(--ui-texto-secundario)",
                                    )}
                                  >
                                    Nenhum emoji encontrado.
                                  </p>
                                ) : (
                                  filteredEmojiGroups.map((group) => (
                                    <div
                                      key={group.title}
                                      className="mb-4 last:mb-0"
                                    >
                                      <p
                                        className={cn(
                                          "mb-2 text-[11px] font-medium",
                                          "text-(--ui-texto-secundario)",
                                        )}
                                      >
                                        {group.title}
                                      </p>
                                      <div className="flex flex-wrap gap-1">
                                        {group.emojis.map((emoji) => (
                                          <button
                                            key={`${group.title}-${emoji}`}
                                            type="button"
                                            onClick={() =>
                                              handleEmojiSelect(emoji)
                                            }
                                            className={cn(
                                              "grid h-8 w-8 place-items-center rounded-lg text-xl transition cursor-pointer",
                                              "hover:bg-(--ui-hover-forte)",
                                            )}
                                          >
                                            {emoji}
                                          </button>
                                        ))}
                                      </div>
                                    </div>
                                  ))
                                )}
                              </div>

                              <div
                                className={cn(
                                  "flex items-center gap-1 border-t px-2 py-2",
                                  "border-(--ui-borda-suave) bg-(--ui-fundo-sutil)",
                                )}
                              >
                                {COMMENT_EMOJI_CATEGORY_TABS.map((tabItem) => {
                                  const TabIcon = tabItem.icon;
                                  return (
                                    <button
                                      key={tabItem.key}
                                      type="button"
                                      onClick={() => {
                                        setActiveEmojiTab(tabItem.key);
                                        setEmojiSearch("");
                                      }}
                                      className={cn(
                                        "grid h-7 w-7 place-items-center rounded-lg transition cursor-pointer",
                                        "text-(--ui-texto-secundario) hover:bg-(--ui-hover) hover:text-(--ui-texto-forte)",
                                        activeEmojiTab === tabItem.key &&
                                          ("bg-(--ui-azul-fundo) text-(--ui-azul-texto)"),
                                      )}
                                    >
                                      <TabIcon className="h-4 w-4" />
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="submit"
                          disabled={
                            isUploadingCommentAttachment ||
                            (!commentText.trim() &&
                              !hasStagedCommentAttachments) ||
                            !canCommentTask
                          }
                          className={cn(
                            "pauta-touch-target grid h-9 w-9 place-items-center rounded-xl transition-all duration-300",
                            (commentText.trim() ||
                              hasStagedCommentAttachments) &&
                              !isUploadingCommentAttachment
                              ? "cursor-pointer text-blue-500 hover:bg-blue-500/10 hover:text-blue-600"
                              : "text-(--ui-texto-apagado) cursor-not-allowed",
                          )}
                        
                          aria-label="Enviar comentário"
                          title="Enviar comentário"
                        >
                          <Send
                            className={cn(
                              "h-4.5 w-4.5",
                              (commentText.trim() ||
                                hasStagedCommentAttachments) &&
                                !isUploadingCommentAttachment &&
                                "animate-in slide-in-from-left-1",
                            )}
                          />
                        </button>
                      </div>
                    </div>
                  </form>
                </div>
              )}
            </div>
          )}

          {isMobileViewport && (
            <div
              className={cn(
                "flex w-15 shrink-0 flex-col items-center gap-3 border-l px-2 py-3",
                "border-(--ui-borda-suave) bg-(--ui-fundo-sutil)",
              )}
              style={{
                paddingTop: "calc(env(safe-area-inset-top, 0px) + 0.75rem)",
                paddingRight: "calc(env(safe-area-inset-right, 0px) + 0.5rem)",
                paddingBottom:
                  "calc(env(safe-area-inset-bottom, 0px) + 0.75rem)",
              }}
            >
              <button
                type="button"
                onClick={() => switchMobilePanelView("details")}
                className={cn(
                  "flex min-h-11 w-11 items-center justify-center rounded-2xl px-1 py-2 text-center transition-colors cursor-pointer",
                  mobilePanelView === "details"
                    ? "bg-(--ui-azul-fundo) text-(--ui-azul-texto)"
                    : "text-(--ui-texto-secundario) hover:bg-(--ui-hover) hover:text-(--ui-texto-forte)",
                )}
                title="Mostrar detalhes"
                aria-label="Mostrar detalhes"
              >
                <Info className="h-5 w-5" />
              </button>

              <button
                type="button"
                onClick={() =>
                  switchMobilePanelView(
                    mobilePanelView === "comments" ? "details" : "comments",
                  )
                }
                className={cn(
                  "flex h-11 w-11 items-center justify-center rounded-2xl transition-colors cursor-pointer",
                  mobilePanelView === "comments"
                    ? "bg-(--ui-azul-fundo) text-(--ui-azul-texto)"
                    : "text-(--ui-texto-secundario) hover:bg-(--ui-hover) hover:text-(--ui-texto-forte)",
                )}
                title="Comentários"
                aria-label="Mostrar comentários"
              >
                <MessageSquare className="h-5 w-5" />
              </button>

              <button
                type="button"
                onClick={() =>
                  switchMobilePanelView(
                    mobilePanelView === "activity" ? "details" : "activity",
                  )
                }
                className={cn(
                  "flex h-11 w-11 items-center justify-center rounded-2xl transition-colors cursor-pointer",
                  mobilePanelView === "activity"
                    ? "bg-(--ui-azul-fundo) text-(--ui-azul-texto)"
                    : "text-(--ui-texto-secundario) hover:bg-(--ui-hover) hover:text-(--ui-texto-forte)",
                )}
                title="Atividade"
                aria-label="Mostrar atividade"
              >
                <Clock className="h-5 w-5" />
              </button>
            </div>
          )}
        </div>
      </div>
      <ConfirmationModal
        isOpen={confirmConfig.isOpen}
        onClose={() => setConfirmConfig({ ...confirmConfig, isOpen: false })}
        onConfirm={confirmConfig.onConfirm}
        title={confirmConfig.title}
        message={confirmConfig.message}
        confirmLabel={confirmConfig.confirmLabel}
        pendingLabel={confirmConfig.pendingLabel}
      />
      <AttachmentPreviewModal
        isDarkMode={isDarkMode}
        isOpen={!!attachmentPreviewState}
        onClose={() => setAttachmentPreviewState(null)}
        attachments={attachmentPreviewState?.attachments ?? []}
        activeIndex={attachmentPreviewState?.activeIndex ?? 0}
        onChangeIndex={(nextIndex) =>
          setAttachmentPreviewState((current) =>
            current
              ? {
                  ...current,
                  activeIndex: nextIndex,
                }
              : current,
          )
        }
      />
    </div>
  );
}
