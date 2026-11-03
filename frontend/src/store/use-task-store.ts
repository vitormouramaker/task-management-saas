import { create } from "zustand";
import { createSafeStorage } from "../lib/safe-storage";
import { createJSONStorage, persist } from "zustand/middleware";

import type {
  CreateTaskInput,
  CustomFieldValue,
  EntityId,
  HierarchySelection,
  TaskFilters,
  TaskPriorityFilter,
  TaskStatusFilter,
  TaskUiState,
  TaskViewMode,
  WorkspaceGraph,
  TaskPriority,
  TaskTag,
  TaskSeedData,
  TaskComment,
  TaskAttachment,
  TaskActivity,
  EntityVisibility,
  Task,
  TaskStatusDefinition,
  Checklist,
  ChecklistItem,
  LinkDisplayMode,
} from "../types/tasks";
import { useAuthStore } from "./use-auth-store";
import { toast } from "./use-toast-store";
import axios from "axios";
import {
  canMoveTask,
  getWorkspacePermissionForList,
  getWorkspacePermissionForSelection,
  getWorkspacePermissionForTask,
  hasWorkspacePermission,
  type WorkspacePermissionCapability,
} from "../lib/workspace-permissions";
import type { RealtimeEvent } from "../lib/realtime";

const emptyGraph: WorkspaceGraph = {
  workspaces: {},
  spaces: {},
  folders: {},
  lists: {},
  tasks: {},
  members: {},
  statusDefinitions: [],
  customFieldDefinitions: {},
  tags: {},
};

const defaultSelection: HierarchySelection = {
  workspaceId: null,
  spaceId: null,
  folderId: null,
  listId: null,
};

const defaultFilters: TaskFilters = {
  search: "",
  statusId: "all",
  priority: "all",
  assignedToMeOnly: false,
  customFieldId: "all",
  customFieldValue: "all",
};

const defaultUi: TaskUiState = {
  sidebarCollapsed: false,
  activeView: "board",
  activeTaskIdForDetails: null,
  taskHistory: [],
  activePage: "home",
};

function stripRichTextPreservingBreaks(value?: string | null) {
  return (value || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p>/gi, "\n\n")
    .replace(/<\/?(?:p|div|li|ul|ol)>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\u00a0/g, " ")
    .trim();
}

function getCommentCreatedAtTime(comment: TaskComment) {
  const timestamp = new Date(comment.createdAt).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function normalizeTaskAttachment(rawAttachment: any): TaskAttachment {
  return {
    id: rawAttachment.id,
    name: rawAttachment.name,
    url: rawAttachment.url,
    type: rawAttachment.type,
    size: rawAttachment.size ?? 0,
    createdAt:
      rawAttachment.createdAt ||
      rawAttachment.created_at ||
      new Date().toISOString(),
    uploadedById:
      rawAttachment.uploadedById ?? rawAttachment.uploaded_by_id ?? null,
    uploadedByName:
      rawAttachment.uploadedByName ?? rawAttachment.uploaded_by_name ?? null,
    uploadedByAvatarColor:
      rawAttachment.uploadedByAvatarColor ??
      rawAttachment.uploaded_by_avatar_color ??
      null,
    uploadedByAvatarUrl:
      rawAttachment.uploadedByAvatarUrl ??
      rawAttachment.uploaded_by_avatar_url ??
      null,
  };
}

function normalizeChecklistItem(rawItem: any): ChecklistItem {
  return {
    id: rawItem.id,
    label: rawItem.label ?? "",
    done: Boolean(rawItem.done),
    assigneeIds: Array.isArray(rawItem.assigneeIds)
      ? rawItem.assigneeIds
      : Array.isArray(rawItem.assignee_ids)
        ? rawItem.assignee_ids
        : [],
  };
}

function normalizeChecklist(rawChecklist: any): Checklist {
  return {
    id: rawChecklist.id,
    name: rawChecklist.name ?? "",
    items: Array.isArray(rawChecklist.items)
      ? rawChecklist.items.map(normalizeChecklistItem)
      : [],
  };
}

function normalizeTask(rawTask: any): Task {
  return {
    id: rawTask.id,
    workspaceId: rawTask.workspaceId ?? rawTask.workspace_id ?? "",
    spaceId: rawTask.spaceId ?? rawTask.space_id ?? "",
    folderId: rawTask.folderId ?? rawTask.folder_id ?? "",
    listId: rawTask.listId ?? rawTask.list_id ?? "",
    parentTaskId: rawTask.parentTaskId ?? rawTask.parent_task_id ?? undefined,
    ownerId: rawTask.ownerId ?? rawTask.owner_id ?? undefined,
    visibility: rawTask.visibility ?? "public",
    title: rawTask.title ?? "",
    description: rawTask.description ?? {
      format: "html",
      value: rawTask.descriptionText ?? rawTask.description_text ?? "",
    },
    descriptionLinkDisplayModes:
      rawTask.descriptionLinkDisplayModes ??
      rawTask.description_link_display_modes ??
      {},
    statusId: rawTask.statusId ?? rawTask.status_id ?? "",
    priority: rawTask.priority ?? "medium",
    startDate: rawTask.startDate ?? rawTask.start_date ?? null,
    dueDate: rawTask.dueDate ?? rawTask.due_date ?? null,
    estimate: rawTask.estimate ?? null,
    assigneeIds: Array.isArray(rawTask.assigneeIds)
      ? rawTask.assigneeIds
      : Array.isArray(rawTask.assignee_ids)
        ? rawTask.assignee_ids
        : [],
    watcherIds: Array.isArray(rawTask.watcherIds)
      ? rawTask.watcherIds
      : Array.isArray(rawTask.watcher_ids)
        ? rawTask.watcher_ids
        : [],
    currentPermissionLevel:
      rawTask.currentPermissionLevel ?? rawTask.current_permission_level,
    tags: Array.isArray(rawTask.tags) ? rawTask.tags : [],
    activities: Array.isArray(rawTask.activities) ? rawTask.activities : [],
    createdAt:
      rawTask.createdAt ?? rawTask.created_at ?? new Date().toISOString(),
    updatedAt:
      rawTask.updatedAt ?? rawTask.updated_at ?? new Date().toISOString(),
    checklists: Array.isArray(rawTask.checklists)
      ? rawTask.checklists.map(normalizeChecklist)
      : [],
    attachments: Array.isArray(rawTask.attachments)
      ? rawTask.attachments.map(normalizeTaskAttachment)
      : [],
    customFieldValues:
      rawTask.customFieldValues ?? rawTask.custom_field_values ?? {},
    coverAttachmentId:
      rawTask.coverAttachmentId ?? rawTask.cover_attachment_id ?? null,
    subtaskIds: Array.isArray(rawTask.subtaskIds)
      ? rawTask.subtaskIds
      : Array.isArray(rawTask.subtask_ids)
        ? rawTask.subtask_ids
        : [],
    linkedTaskIds: Array.isArray(rawTask.linkedTaskIds)
      ? rawTask.linkedTaskIds
      : Array.isArray(rawTask.linked_task_ids)
        ? rawTask.linked_task_ids
        : [],
    sortOrder: rawTask.sortOrder ?? rawTask.sort_order,
  };
}

function normalizeTaskComment(rawComment: any): TaskComment {
  const commentCreatedAt =
    rawComment.createdAt || rawComment.created_at || new Date().toISOString();

  return {
    id: rawComment.id,
    taskId: rawComment.taskId ?? rawComment.task_id ?? "",
    authorName: rawComment.authorName ?? rawComment.author_name ?? "",
    content: rawComment.content ?? "",
    createdAt: commentCreatedAt,
    parentId: rawComment.parentId ?? rawComment.parent_id ?? undefined,
    editedAt: rawComment.editedAt ?? rawComment.edited_at ?? undefined,
    attachment: rawComment.attachment
      ? normalizeTaskAttachment({
          ...rawComment.attachment,
          id:
            rawComment.attachment.id ??
            `comment_attachment_${rawComment.id ?? crypto.randomUUID()}`,
          createdAt:
            rawComment.attachment.createdAt ??
            rawComment.attachment.created_at ??
            commentCreatedAt,
        })
      : undefined,
    mentionIds: rawComment.mentionIds ?? rawComment.mention_ids ?? undefined,
    linkDisplayModes:
      rawComment.linkDisplayModes ?? rawComment.link_display_modes ?? {},
    likedByMe:
      typeof rawComment.likedByMe === "boolean"
        ? rawComment.likedByMe
        : typeof rawComment.liked_by_me === "boolean"
          ? rawComment.liked_by_me
          : undefined,
    reaction: rawComment.reaction ?? null,
  };
}

function sortCommentsByNewest(comments: TaskComment[]) {
  return [...comments].sort(
    (left, right) =>
      getCommentCreatedAtTime(right) - getCommentCreatedAtTime(left),
  );
}

function getNotificationCreatedAtTime(notification: TaskNotification) {
  const timestamp = new Date(notification.createdAt).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function sortNotificationsByNewest(notifications: TaskNotification[]) {
  return [...notifications].sort(
    (left, right) =>
      getNotificationCreatedAtTime(right) - getNotificationCreatedAtTime(left),
  );
}

function normalizeTaskNotification(rawNotification: any): TaskNotification {
  return {
    id: rawNotification.id,
    userId: rawNotification.userId ?? rawNotification.user_id ?? "",
    title: rawNotification.title ?? "",
    message: rawNotification.message ?? "",
    type: rawNotification.type ?? "assign",
    referenceId:
      rawNotification.referenceId ?? rawNotification.reference_id ?? "",
    read: Boolean(rawNotification.read),
    createdAt:
      rawNotification.createdAt ??
      rawNotification.created_at ??
      new Date().toISOString(),
    url: rawNotification.url ?? "",
    assignerName:
      rawNotification.assignerName ?? rawNotification.assigner_name ?? null,
    assignerAvatarColor:
      rawNotification.assignerAvatarColor ??
      rawNotification.assigner_avatar_color ??
      null,
    assignerAvatarUrl:
      rawNotification.assignerAvatarUrl ??
      rawNotification.assigner_avatar_url ??
      null,
  };
}

function getEmailSentAtTime(email: SentEmail) {
  const timestamp = new Date(email.sentAt).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function sortEmailsByNewest(emails: SentEmail[]) {
  return [...emails].sort(
    (left, right) => getEmailSentAtTime(right) - getEmailSentAtTime(left),
  );
}

function mergeTaskIntoGraph(
  graph: WorkspaceGraph,
  nextTaskInput: any,
): WorkspaceGraph {
  const nextTask = normalizeTask(nextTaskInput);
  const previousTask = graph.tasks[nextTask.id];

  const mergedTask: Task = {
    ...previousTask,
    ...nextTask,
    description: nextTask.description ??
      previousTask?.description ?? { format: "html", value: "" },
    activities: nextTask.activities?.length
      ? nextTask.activities
      : (previousTask?.activities ?? []),
    currentPermissionLevel:
      nextTask.currentPermissionLevel ?? previousTask?.currentPermissionLevel,
  };

  const lists = { ...graph.lists };

  if (
    previousTask?.listId &&
    previousTask.listId !== mergedTask.listId &&
    lists[previousTask.listId]
  ) {
    lists[previousTask.listId] = {
      ...lists[previousTask.listId],
      taskIds: lists[previousTask.listId].taskIds.filter(
        (id) => id !== mergedTask.id,
      ),
    };
  }

  if (mergedTask.listId && lists[mergedTask.listId]) {
    const targetList = lists[mergedTask.listId];
    lists[mergedTask.listId] = {
      ...targetList,
      taskIds: targetList.taskIds.includes(mergedTask.id)
        ? targetList.taskIds
        : [mergedTask.id, ...targetList.taskIds],
    };
  }

  return {
    ...graph,
    lists,
    tasks: {
      ...graph.tasks,
      [mergedTask.id]: mergedTask,
    },
  };
}

function normalizeSentEmail(rawEmail: any): SentEmail {
  return {
    id: rawEmail.id,
    to: rawEmail.to,
    subject: rawEmail.subject,
    subtitle: rawEmail.subtitle,
    body: rawEmail.body,
    attachments: rawEmail.attachments || [],
    read: Boolean(rawEmail.read),
    type: rawEmail.type ?? "sent",
    senderName: rawEmail.senderName ?? rawEmail.sender_name,
    senderEmail: rawEmail.senderEmail ?? rawEmail.sender_email,
    senderAvatarColor:
      rawEmail.senderAvatarColor ?? rawEmail.sender_avatar_color,
    senderAvatarUrl: rawEmail.senderAvatarUrl ?? rawEmail.sender_avatar_url,
    sentAt: rawEmail.sentAt ?? rawEmail.sent_at ?? new Date().toISOString(),
    linkDisplayModes:
      rawEmail.linkDisplayModes ?? rawEmail.link_display_modes ?? {},
  };
}

interface TaskStoreState {
  graph: WorkspaceGraph;
  selection: HierarchySelection;
  filters: TaskFilters;
  ui: TaskUiState;
  commentsByTaskId: Record<EntityId, TaskComment[]>;
  presenceByWorkspaceId: Record<EntityId, EntityId[]>;
  favoriteListIds: EntityId[];
  currentUser: EntityId;
  notifications: TaskNotification[];
  sentEmails: SentEmail[];
  seedInitialized: boolean;
  taskSortOrders: Record<EntityId, number>;
  hydrateFromSeed: (seed: TaskSeedData) => void;
  toggleSidebar: () => void;
  setActivePage: (page: "home" | "tasks" | "members" | "settings" | "trash" | "calendar" | "reports" | "help") => void;
  setActiveView: (view: TaskViewMode) => void;
  setSearch: (value: string) => void;
  setStatusFilter: (value: TaskStatusFilter) => void;
  setPriorityFilter: (value: TaskPriorityFilter) => void;
  setAssignedToMeOnly: (value: boolean) => void;
  setCustomFieldFilter: (value: EntityId | "all") => void;
  setCustomFieldValueFilter: (value: string | "all") => void;
  clearFilters: () => void;
  openTaskDetails: (taskId: EntityId) => void;
  fetchTaskDetails: (taskId: EntityId) => Promise<void>;
  closeTaskDetails: () => void;
  updateTaskTitle: (taskId: EntityId, title: string) => Promise<void>;
  updateTaskDescription: (
    taskId: EntityId,
    text: string,
    mentionIds?: EntityId[],
    linkDisplayModes?: Record<string, LinkDisplayMode>,
  ) => Promise<boolean>;
  updateTaskDescriptionLinkDisplayMode: (
    taskId: EntityId,
    url: string,
    mode: LinkDisplayMode,
  ) => Promise<void>;
  updateTaskDates: (
    taskId: EntityId,
    startDate: string | null,
    dueDate: string | null,
  ) => Promise<void>;
  updateTaskEstimate: (
    taskId: EntityId,
    estimate: string | null,
  ) => Promise<void>;
  updateTaskCustomFieldValues: (
    taskId: EntityId,
    customFieldValues: Record<EntityId, CustomFieldValue>,
  ) => Promise<boolean>;
  removeTaskAssignee: (taskId: EntityId, assigneeId: string) => Promise<void>;
  addTaskAssignee: (taskId: EntityId, assigneeId: string) => Promise<void>;
  addTaskTag: (taskId: EntityId, tag: TaskTag) => Promise<void>;
  removeTaskTag: (taskId: EntityId, tagId: string) => Promise<void>;
  toggleTaskTag: (taskId: EntityId, tag: TaskTag) => Promise<void>;

  addComment: (
    taskId: EntityId,
    content: string,
    parentId?: string,
    attachment?: TaskAttachment,
    mentionIds?: EntityId[],
    linkDisplayModes?: Record<string, LinkDisplayMode>,
  ) => Promise<TaskComment | null>;
  deleteComment: (taskId: EntityId, commentId: string) => void;
  editComment: (
    taskId: EntityId,
    commentId: string,
    newContent: string,
    mentionIds?: EntityId[],
    linkDisplayModes?: Record<string, LinkDisplayMode>,
  ) => Promise<boolean>;
  updateCommentLinkDisplayMode: (
    taskId: EntityId,
    commentId: string,
    url: string,
    mode: LinkDisplayMode,
  ) => Promise<boolean>;
  toggleCommentLike: (taskId: EntityId, commentId: string) => Promise<void>;
  setCommentReaction: (
    taskId: EntityId,
    commentId: string,
    emoji: string | null,
  ) => Promise<void>;
  setActiveList: (listId: EntityId) => void;
  addTask: (payload: CreateTaskInput) => Promise<void>;
  moveTaskToStatus: (taskId: EntityId, statusId: EntityId) => Promise<void>;
  reorderTasksInColumn: (activeId: EntityId, overId: EntityId) => void;
  createStatusColumn: (
    listId: EntityId,
    payload: {
      name: string;
      colorClass: string;
      chipClass: string;
      dotClass: string;
    },
  ) => Promise<void>;
  updateStatusColumn: (
    statusId: EntityId,
    payload: {
      name: string;
      colorClass: string;
      chipClass: string;
      dotClass: string;
    },
  ) => Promise<void>;
  reorderStatusColumns: (orderedIds: EntityId[]) => Promise<void>;
  cycleTaskStatus: (taskId: EntityId) => void;
  deleteTask: (taskId: EntityId) => void;
  toggleTaskWatcher: (taskId: EntityId) => Promise<boolean>;
  duplicateTask: (taskId: EntityId) => Promise<EntityId | null>;
  addSubtask: (parentTaskId: EntityId, title: string) => Promise<void>;
  navigateBack: () => void;

  // Checklist
  addChecklist: (taskId: EntityId, name: string) => Promise<void>;
  deleteChecklist: (taskId: EntityId, checklistId: string) => Promise<void>;
  renameChecklist: (
    taskId: EntityId,
    checklistId: string,
    name: string,
  ) => Promise<void>;
  addChecklistItem: (
    taskId: EntityId,
    checklistId: string,
    label: string,
  ) => Promise<void>;
  toggleChecklistItem: (
    taskId: EntityId,
    checklistId: string,
    itemId: string,
  ) => Promise<void>;
  setChecklistItemAssignee: (
    taskId: EntityId,
    checklistId: string,
    itemId: string,
    assigneeId: string | null,
  ) => Promise<void>;
  updateChecklistItemLabel: (
    taskId: EntityId,
    checklistId: string,
    itemId: string,
    label: string,
  ) => Promise<void>;
  reorderChecklistItem: (
    taskId: EntityId,
    checklistId: string,
    oldIndex: number,
    newIndex: number,
  ) => void;
  deleteChecklistItem: (
    taskId: EntityId,
    checklistId: string,
    itemId: string,
  ) => Promise<void>;
  updateTaskPriority: (
    taskId: EntityId,
    priority: TaskPriority,
  ) => Promise<void>;
  appendTaskActivities: (taskId: EntityId, activities: TaskActivity[]) => void;
  addAttachment: (
    taskId: EntityId,
    attachment: Omit<TaskAttachment, "id" | "createdAt">,
  ) => Promise<void>;
  deleteAttachment: (taskId: EntityId, attachmentId: string) => Promise<void>;
  setTaskCoverAttachment: (
    taskId: EntityId,
    attachmentId: string | null,
  ) => Promise<void>;
  linkTask: (taskId: EntityId, linkedTaskId: EntityId) => Promise<void>;
  unlinkTask: (taskId: EntityId, linkedTaskId: EntityId) => Promise<void>;
  updateListVisibility: (
    listId: EntityId,
    visibility: EntityVisibility,
  ) => Promise<void>;
  updateListDates: (
    listId: EntityId,
    startDate: string | null,
    endDate: string | null,
  ) => Promise<void>;
  toggleListAssignee: (listId: EntityId, memberId: EntityId) => Promise<void>;
  toggleListTag: (listId: EntityId, tag: TaskTag) => Promise<void>;
  addList: (
    input: {
      name: string;
      visibility: EntityVisibility;
      assigneeIds: EntityId[];
      startDate: string | null;
      dueDate: string | null;
      tags: TaskTag[];
    },
    parentFolderId?: EntityId,
  ) => void;
  addWorkspace: (input: {
    name: string;
    description?: string;
    visibility: EntityVisibility;
  }) => void;
  toggleFavoriteList: (listId: EntityId) => void;
  updateListName: (listId: EntityId, name: string) => void;
  deleteList: (listId: EntityId) => void;
  setActiveWorkspace: (workspaceId: EntityId) => void;
  addSentEmail: (
    email: Omit<
      SentEmail,
      | "id"
      | "sentAt"
      | "read"
      | "type"
      | "senderName"
      | "senderAvatarColor"
      | "senderAvatarUrl"
    >,
  ) => Promise<void>;
  updateEmailLinkDisplayMode: (
    emailId: string,
    url: string,
    mode: LinkDisplayMode,
  ) => Promise<void>;
  fetchEmails: () => Promise<void>;
  markEmailRead: (id: string) => Promise<void>;
  addTag: (tag: TaskTag) => void;
  updateTag: (tag: TaskTag) => void;
  removeTag: (tagId: EntityId) => void;
  fetchNotifications: () => Promise<void>;
  markNotificationRead: (id: string) => Promise<void>;
  markAllNotificationsRead: () => Promise<void>;
  applyRealtimeEvent: (event: RealtimeEvent) => void;
  reset: () => void;
}

export interface TaskNotification {
  id: string;
  userId: string;
  title: string;
  message: string;
  type:
    | "TASK_ASSIGNED"
    | "TASK_STATUS_CHANGED"
    | "TASK_DUE_DATE_CHANGED"
    | "TASK_ATTACHMENT_ADDED"
    | "TASK_LINKED"
    | "TASK_UNLINKED"
    | "CHECKLIST_ITEM_ASSIGNED"
    | "SUBTASK_CREATED"
    | "LIST_ASSIGNED"
    | "WORKSPACE_ASSIGNED"
    | "comment"
    | "mention"
    | "assign";
  referenceId: string;
  read: boolean;
  createdAt: string;
  url?: string;
  assignerName?: string;
  assignerAvatarColor?: string;
  assignerAvatarUrl?: string | null;
}

export interface SentEmail {
  id: string;
  to: string;
  subject: string;
  subtitle?: string;
  body: string;
  attachments: string[];
  read: boolean;
  type: "sent" | "received";
  senderName?: string;
  senderEmail?: string;
  senderAvatarColor?: string;
  senderAvatarUrl?: string;
  sentAt: string;
  linkDisplayModes?: Record<string, LinkDisplayMode>;
}

function getListHierarchy(graph: WorkspaceGraph, listId: EntityId) {
  const list = graph.lists[listId];
  if (!list) return null;

  const folder = graph.folders[list.folderId];
  if (!folder) return null;

  const space = graph.spaces[folder.spaceId];
  if (!space) return null;

  const workspace = graph.workspaces[space.workspaceId];
  if (!workspace) return null;

  return { workspace, space, folder, list };
}

function canAccessList(
  state: Pick<TaskStoreState, "graph" | "selection">,
  listId: EntityId | null | undefined,
  required: Exclude<WorkspacePermissionCapability, "none">,
) {
  return hasWorkspacePermission(
    getWorkspacePermissionForList(state.graph, listId),
    required,
  );
}

function canAccessTask(
  state: Pick<TaskStoreState, "graph" | "selection">,
  taskId: EntityId | null | undefined,
  required: Exclude<WorkspacePermissionCapability, "none">,
) {
  return hasWorkspacePermission(
    getWorkspacePermissionForTask(state.graph, taskId),
    required,
  );
}

function canMoveTaskStatus(
  state: Pick<TaskStoreState, "graph" | "currentUser">,
  taskId: EntityId | null | undefined,
) {
  if (!taskId) return false;

  const task = state.graph.tasks[taskId];
  if (!task) return false;

  const authUser = useAuthStore.getState().user;
  const currentUserId = authUser?.id ?? state.currentUser;
  const isAdmin = authUser?.organization?.role === "owner" ||
    authUser?.organization?.role === "admin";
  const permission = getWorkspacePermissionForTask(state.graph, taskId);

  return canMoveTask(task, permission, currentUserId, isAdmin);
}

function canAccessCurrentSelection(
  state: Pick<TaskStoreState, "graph" | "selection">,
  required: Exclude<WorkspacePermissionCapability, "none">,
) {
  return hasWorkspacePermission(
    getWorkspacePermissionForSelection(
      state.graph,
      state.selection.workspaceId,
      state.selection.listId,
    ),
    required,
  );
}

function logPermissionDenied(action: string) {
  toast.warning("Permissão insuficiente", {
    message: `Você não tem permissão para ${action}.`,
  });
}

function getCurrentOrganizationId() {
  return useAuthStore.getState().user?.organization?.id || null;
}

function tagBelongsToCurrentOrganization(tag: TaskTag) {
  const organizationId = getCurrentOrganizationId();
  if (!organizationId) return false;
  return !tag.organizationId || tag.organizationId === organizationId;
}

export const useTaskStore = create<TaskStoreState>()(
  persist(
    (set, get) => ({
      graph: emptyGraph,
      selection: defaultSelection,
      filters: defaultFilters,
      ui: defaultUi,
      commentsByTaskId: {},
      presenceByWorkspaceId: {},
      favoriteListIds: [],
      currentUser: "",
      notifications: [],
      sentEmails: [],
      seedInitialized: false,
      taskSortOrders: {},
      hydrateFromSeed: (seed) => {
        const authUser = useAuthStore.getState().user;
        const currentId = authUser
          ? authUser.id
          : seed.graph.members
            ? Object.keys(seed.graph.members)[0]
            : "";
        set((state) => {
          // Preserve selection if it still exists in the new graph
          let finalSelection = seed.selection;
          if (
            state.selection.listId &&
            seed.graph.lists[state.selection.listId]
          ) {
            finalSelection = { ...state.selection };
          } else if (
            state.selection.workspaceId &&
            seed.graph.workspaces[state.selection.workspaceId]
          ) {
            finalSelection = { ...state.selection };
          }

          const existingSortOrders = state.taskSortOrders || {};
          const newSortOrders = { ...existingSortOrders };
          Object.values(seed.graph.tasks).forEach((task) => {
            if (task.sortOrder !== undefined) {
              // Backend Ã© fonte de verdade quando disponÃ­vel
              newSortOrders[task.id] = task.sortOrder;
            } else if (newSortOrders[task.id] === undefined) {
              // Fallback: createdAt para tasks sem ordem salva
              newSortOrders[task.id] = new Date(task.createdAt).getTime();
            }
          });

          return {
            graph: seed.graph,
            selection: finalSelection,
            currentUser: currentId,
            commentsByTaskId: seed.commentsByTaskId || {},
            seedInitialized: true,
            taskSortOrders: newSortOrders,
          };
        });
      },
      toggleSidebar: () =>
        set((state) => ({
          ui: { ...state.ui, sidebarCollapsed: !state.ui.sidebarCollapsed },
        })),
      setActivePage: (page) =>
        set((state) => ({ ui: { ...state.ui, activePage: page } })),
      setActiveView: (view) =>
        set((state) => ({ ui: { ...state.ui, activeView: view } })),
      setSearch: (value) =>
        set((state) => ({ filters: { ...state.filters, search: value } })),
      setStatusFilter: (value) =>
        set((state) => ({ filters: { ...state.filters, statusId: value } })),
      setPriorityFilter: (value) =>
        set((state) => ({ filters: { ...state.filters, priority: value } })),
      setAssignedToMeOnly: (value) =>
        set((state) => ({
          filters: { ...state.filters, assignedToMeOnly: value },
        })),
      setCustomFieldFilter: (value) =>
        set((state) => ({
          filters: {
            ...state.filters,
            customFieldId: value,
            customFieldValue: "all",
          },
        })),
      setCustomFieldValueFilter: (value) =>
        set((state) => ({
          filters: { ...state.filters, customFieldValue: value },
        })),
      clearFilters: () => set({ filters: defaultFilters }),
      openTaskDetails: (taskId) =>
        set((state) => {
          const currentHistory = state.ui.taskHistory ?? [];

          // Se estamos tentando abrir uma tarefa que jÃ¡ estÃ¡ no histÃ³rico,
          // significa que estamos voltando por um bradcrumb ou atalho.
          // Nesse caso, cortamos o histÃ³rico atÃ© aquele ponto.
          const existingIndex = currentHistory.indexOf(taskId);
          if (existingIndex !== -1) {
            return {
              ui: {
                ...state.ui,
                activeTaskIdForDetails: taskId,
                taskHistory: currentHistory.slice(0, existingIndex),
              },
            };
          }

          const newHistory = state.ui.activeTaskIdForDetails
            ? [...currentHistory, state.ui.activeTaskIdForDetails]
            : currentHistory;

          return {
            ui: {
              ...state.ui,
              activeTaskIdForDetails: taskId,
              taskHistory: newHistory,
            },
          };
        }),
      fetchTaskDetails: async (taskId) => {
        const token = useAuthStore.getState().token;
        if (!token) return;
        try {
          const res = await axios.get(`/api/workspaces/tasks/${taskId}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          console.log(res.data);
          if (res.data?.task) {
            set((state) => ({
              graph: {
                ...state.graph,
                tasks: {
                  ...state.graph.tasks,
                  [taskId]: {
                    ...state.graph.tasks[taskId],
                    ...res.data.task,
                    currentPermissionLevel:
                      res.data.task.currentPermissionLevel ??
                      state.graph.tasks[taskId]?.currentPermissionLevel,
                  },
                },
              },
              commentsByTaskId: {
                ...state.commentsByTaskId,
                [taskId]: sortCommentsByNewest(
                  (res.data.comments || []).map(normalizeTaskComment),
                ),
              },
            }));
          }
        } catch (error) {
          console.error("Error fetching task details:", error);
        }
      },
      closeTaskDetails: () =>
        set((state) => ({
          ui: { ...state.ui, activeTaskIdForDetails: null, taskHistory: [] },
        })),
      navigateBack: () =>
        set((state) => {
          const currentHistory = state.ui.taskHistory ?? [];
          if (currentHistory.length === 0) {
            return {
              ui: {
                ...state.ui,
                activeTaskIdForDetails: null,
                taskHistory: [],
              },
            };
          }
          const newHistory = [...currentHistory];
          const previousTaskId = newHistory.pop();
          return {
            ui: {
              ...state.ui,
              activeTaskIdForDetails: previousTaskId || null,
              taskHistory: newHistory,
            },
          };
        }),
      updateTaskTitle: async (taskId, title) => {
        if (!canAccessTask(get(), taskId, "edit")) {
          logPermissionDenied("editar o tÃ­tulo da tarefa");
          return;
        }
        const token = useAuthStore.getState().token;
        const task = useTaskStore.getState().graph.tasks[taskId];
        if (!task) return;
        const nextTitle = title.trim();
        if (!nextTitle || nextTitle === task.title) return;

        try {
          const res = await axios.put(
            `/api/workspaces/tasks/${taskId}`,
            { title: nextTitle },
            {
              headers: { Authorization: `Bearer ${token}` },
            },
          );
          if (res.data?.activities) {
            get().appendTaskActivities(taskId, res.data.activities);
          }
          set((state) => ({
            graph: {
              ...state.graph,
              tasks: {
                ...state.graph.tasks,
                [taskId]: {
                  ...state.graph.tasks[taskId],
                  title: nextTitle,
                  updatedAt: new Date().toISOString(),
                },
              },
            },
          }));
        } catch (e) {
          console.error("Erro ao atualizar tÃ­tulo", e);
          toast.error("Não foi possível salvar o título da tarefa.", {
            message: "O título anterior foi restaurado.",
          });
        }
      },
      updateTaskDescription: async (
        taskId,
        text,
        mentionIds,
        linkDisplayModes,
      ) => {
        if (!canAccessTask(get(), taskId, "edit")) {
          logPermissionDenied("editar a descriÃ§Ã£o da tarefa");
          return false;
        }
        const token = useAuthStore.getState().token;
        const value = text.trim() ? `<p>${text.trim()}</p>` : "";
        const nextLinkDisplayModes = linkDisplayModes ?? {};

        try {
          const res = await axios.put(
            `/api/workspaces/tasks/${taskId}`,
            {
              description: value,
              mentionIds: mentionIds || [],
              descriptionLinkDisplayModes: nextLinkDisplayModes,
            },
            {
              headers: { Authorization: `Bearer ${token}` },
            },
          );
          if (res.data?.activities) {
            get().appendTaskActivities(taskId, res.data.activities);
          }

          set((state) => ({
            graph: {
              ...state.graph,
              tasks: {
                ...state.graph.tasks,
                [taskId]: {
                  ...state.graph.tasks[taskId],
                  description: {
                    ...state.graph.tasks[taskId].description,
                    value,
                  },
                  descriptionLinkDisplayModes: nextLinkDisplayModes,
                  updatedAt: new Date().toISOString(),
                },
              },
            },
          }));
          return true;
        } catch (e) {
          console.error("Erro ao atualizar descriÃ§Ã£o", e);
          toast.error("Não foi possível salvar a descrição.", {
            message: "A descrição anterior foi restaurada.",
          });
          return false;
        }
      },
      updateTaskDescriptionLinkDisplayMode: async (taskId, url, mode) => {
        const task = get().graph.tasks[taskId];
        if (!task) return;

        const nextLinkDisplayModes = {
          ...(task.descriptionLinkDisplayModes ?? {}),
          [url]: mode,
        };

        await get().updateTaskDescription(
          taskId,
          stripRichTextPreservingBreaks(task.description?.value),
          undefined,
          nextLinkDisplayModes,
        );
      },
      updateTaskDates: async (taskId, startDate, dueDate) => {
        if (!canAccessTask(get(), taskId, "edit")) {
          logPermissionDenied("editar as datas da tarefa");
          return;
        }
        const token = useAuthStore.getState().token;
        const previous = get().graph.tasks[taskId];
        if (!previous) return;

        // Otimista: calendário e timeline movem o card na hora.
        const applyDates = (nextStart: string | null | undefined, nextDue: string | null) =>
          set((state) => ({
            graph: {
              ...state.graph,
              tasks: state.graph.tasks[taskId]
                ? {
                    ...state.graph.tasks,
                    [taskId]: {
                      ...state.graph.tasks[taskId],
                      startDate: nextStart,
                      dueDate: nextDue,
                      updatedAt: new Date().toISOString(),
                    },
                  }
                : state.graph.tasks,
            },
          }));

        applyDates(startDate, dueDate);

        try {
          const res = await axios.put(
            `/api/workspaces/tasks/${taskId}`,
            { startDate, dueDate },
            {
              headers: { Authorization: `Bearer ${token}` },
            },
          );
          if (res.data?.activities) {
            get().appendTaskActivities(taskId, res.data.activities);
          }
        } catch (e) {
          console.error("Erro ao atualizar datas", e);
          applyDates(previous.startDate, previous.dueDate);
          toast.error("Não foi possível salvar as datas da tarefa.", {
            message: "As datas anteriores foram restauradas.",
          });
        }
      },
      updateTaskEstimate: async (taskId, estimate) => {
        if (!canAccessTask(get(), taskId, "edit")) {
          logPermissionDenied("editar a estimativa da tarefa");
          return;
        }
        const token = useAuthStore.getState().token;
        try {
          const res = await axios.put(
            `/api/workspaces/tasks/${taskId}`,
            { estimate },
            {
              headers: { Authorization: `Bearer ${token}` },
            },
          );
          if (res.data?.activities) {
            get().appendTaskActivities(taskId, res.data.activities);
          }

          set((state) => ({
            graph: {
              ...state.graph,
              tasks: {
                ...state.graph.tasks,
                [taskId]: {
                  ...state.graph.tasks[taskId],
                  estimate,
                  updatedAt: new Date().toISOString(),
                },
              },
            },
          }));
        } catch (e) {
          console.error("Erro ao atualizar estimativa", e);
          toast.error("Não foi possível salvar a estimativa.", {
            message: "A estimativa anterior foi restaurada.",
          });
        }
      },
      updateTaskCustomFieldValues: async (taskId, customFieldValues) => {
        if (!canAccessTask(get(), taskId, "edit")) {
          logPermissionDenied("editar campos personalizados da tarefa");
          return false;
        }

        const token = useAuthStore.getState().token;
        const task = get().graph.tasks[taskId];
        if (!task) return false;

        try {
          const res = await axios.put(
            `/api/workspaces/tasks/${taskId}`,
            { customFieldValues },
            {
              headers: { Authorization: `Bearer ${token}` },
            },
          );
          if (res.data?.activities) {
            get().appendTaskActivities(taskId, res.data.activities);
          }

          set((state) => ({
            graph: {
              ...state.graph,
              tasks: {
                ...state.graph.tasks,
                [taskId]: {
                  ...state.graph.tasks[taskId],
                  customFieldValues,
                  updatedAt: new Date().toISOString(),
                },
              },
            },
          }));
          return true;
        } catch (error) {
          console.error("Erro ao atualizar campos personalizados", error);
          toast.error("Não foi possível salvar os campos personalizados.", {
            message: "Os valores anteriores voltaram ao card.",
          });
          return false;
        }
      },
      removeTaskAssignee: async (taskId, assigneeId) => {
        if (!canAccessTask(get(), taskId, "edit")) {
          logPermissionDenied("alterar responsÃ¡veis da tarefa");
          return;
        }
        const token = useAuthStore.getState().token;
        const task = useTaskStore.getState().graph.tasks[taskId];
        if (!task) return;
        const nextAssignees = task.assigneeIds.filter(
          (id) => id !== assigneeId,
        );

        try {
          const res = await axios.put(
            `/api/workspaces/tasks/${taskId}`,
            { assigneeIds: nextAssignees },
            {
              headers: { Authorization: `Bearer ${token}` },
            },
          );
          if (res.data?.activities) {
            get().appendTaskActivities(taskId, res.data.activities);
          }

          set((state) => ({
            graph: {
              ...state.graph,
              tasks: {
                ...state.graph.tasks,
                [taskId]: {
                  ...state.graph.tasks[taskId],
                  assigneeIds: nextAssignees,
                  updatedAt: new Date().toISOString(),
                },
              },
            },
          }));
        } catch (e) {
          console.error("Erro ao remover responsÃ¡vel", e);
          toast.error("Não foi possível remover o responsável.", {
            message: "O responsável continua no card.",
          });
        }
      },
      addTaskAssignee: async (taskId, assigneeId) => {
        if (!canAccessTask(get(), taskId, "edit")) {
          logPermissionDenied("alterar responsÃ¡veis da tarefa");
          return;
        }
        const token = useAuthStore.getState().token;
        const task = useTaskStore.getState().graph.tasks[taskId];
        if (!task) return;
        if (task.assigneeIds.includes(assigneeId)) return;
        const nextAssignees = [...task.assigneeIds, assigneeId];

        try {
          const res = await axios.put(
            `/api/workspaces/tasks/${taskId}`,
            { assigneeIds: nextAssignees },
            {
              headers: { Authorization: `Bearer ${token}` },
            },
          );
          if (res.data?.activities) {
            get().appendTaskActivities(taskId, res.data.activities);
          }

          set((state) => ({
            graph: {
              ...state.graph,
              tasks: {
                ...state.graph.tasks,
                [taskId]: {
                  ...state.graph.tasks[taskId],
                  assigneeIds: nextAssignees,
                  updatedAt: new Date().toISOString(),
                },
              },
            },
          }));
        } catch (e) {
          console.error("Erro ao adicionar responsÃ¡vel", e);
          toast.error("Não foi possível adicionar o responsável.", {
            message: "Ninguém foi atribuído ao card.",
          });
        }
      },
      addTaskTag: async (taskId, tag) => {
        if (!canAccessTask(get(), taskId, "edit")) {
          logPermissionDenied("alterar etiquetas da tarefa");
          return;
        }
        const token = useAuthStore.getState().token;
        const task = useTaskStore.getState().graph.tasks[taskId];
        if (!task) return;
        const nextTags = [...(task.tags || []), tag];

        try {
          const res = await axios.put(
            `/api/workspaces/tasks/${taskId}`,
            { tags: nextTags },
            {
              headers: { Authorization: `Bearer ${token}` },
            },
          );
          if (res.data?.activities) {
            get().appendTaskActivities(taskId, res.data.activities);
          }

          set((state) => ({
            graph: {
              ...state.graph,
              tasks: {
                ...state.graph.tasks,
                [taskId]: {
                  ...state.graph.tasks[taskId],
                  tags: nextTags,
                  updatedAt: new Date().toISOString(),
                },
              },
            },
          }));
        } catch (e) {
          console.error("Erro ao adicionar etiqueta", e);
          toast.error("Não foi possível adicionar a etiqueta.", {
            message: "A etiqueta não entrou no card.",
          });
        }
      },
      toggleTaskTag: async (taskId, tag) => {
        if (!canAccessTask(get(), taskId, "edit")) {
          logPermissionDenied("alterar etiquetas da tarefa");
          return;
        }
        const token = useAuthStore.getState().token;
        const task = useTaskStore.getState().graph.tasks[taskId];
        if (!task) return;

        const existingTags = task.tags || [];
        const isSelected = existingTags.some((t) => t.id === tag.id);
        const nextTags = isSelected
          ? existingTags.filter((t) => t.id !== tag.id)
          : [...existingTags, tag];

        try {
          const res = await axios.put(
            `/api/workspaces/tasks/${taskId}`,
            { tags: nextTags },
            {
              headers: { Authorization: `Bearer ${token}` },
            },
          );
          if (res.data?.activities) {
            get().appendTaskActivities(taskId, res.data.activities);
          }

          set((state) => ({
            graph: {
              ...state.graph,
              tasks: {
                ...state.graph.tasks,
                [taskId]: {
                  ...state.graph.tasks[taskId],
                  tags: nextTags,
                  updatedAt: new Date().toISOString(),
                },
              },
            },
          }));
        } catch (e) {
          console.error("Erro ao alternar etiqueta", e);
          toast.error("Não foi possível atualizar as etiquetas.", {
            message: "As etiquetas do card não mudaram.",
          });
        }
      },
      removeTaskTag: async (taskId, tagId) => {
        if (!canAccessTask(get(), taskId, "edit")) {
          logPermissionDenied("alterar etiquetas da tarefa");
          return;
        }
        const token = useAuthStore.getState().token;
        const task = useTaskStore.getState().graph.tasks[taskId];
        if (!task) return;
        const nextTags = (task.tags || []).filter((t) => t.id !== tagId);

        try {
          const res = await axios.put(
            `/api/workspaces/tasks/${taskId}`,
            { tags: nextTags },
            {
              headers: { Authorization: `Bearer ${token}` },
            },
          );
          if (res.data?.activities) {
            get().appendTaskActivities(taskId, res.data.activities);
          }

          set((state) => ({
            graph: {
              ...state.graph,
              tasks: {
                ...state.graph.tasks,
                [taskId]: {
                  ...state.graph.tasks[taskId],
                  tags: nextTags,
                  updatedAt: new Date().toISOString(),
                },
              },
            },
          }));
        } catch (e) {
          console.error("Erro ao remover etiqueta", e);
          toast.error("Não foi possível remover a etiqueta.", {
            message: "A etiqueta continua no card.",
          });
        }
      },
      addComment: async (
        taskId,
        content,
        parentId,
        attachment,
        mentionIds,
        linkDisplayModes,
      ) => {
        if (!canAccessTask(get(), taskId, "comment")) {
          logPermissionDenied("comentar na tarefa");
          return null;
        }
        const token = useAuthStore.getState().token;
        const trimmed = content.trim();
        if (!trimmed && !attachment?.url) return null;

        try {
          const res = await axios.post(
            `/api/workspaces/tasks/${taskId}/comments`,
            {
              content: trimmed,
              parentId,
              attachment,
              mentionIds: mentionIds || [],
              linkDisplayModes: linkDisplayModes || {},
            },
            { headers: { Authorization: `Bearer ${token}` } },
          );

          const comment = normalizeTaskComment(res.data.comment);
          if (res.data?.activities) {
            get().appendTaskActivities(taskId, res.data.activities);
          }

          set((state) => {
            const existing = state.commentsByTaskId[taskId] ?? [];
            return {
              commentsByTaskId: {
                ...state.commentsByTaskId,
                [taskId]: sortCommentsByNewest([comment, ...existing]),
              },
            };
          });
          return comment;
        } catch (error) {
          console.error("Erro ao adicionar comentÃ¡rio:", error);
          toast.error("Não foi possível publicar o comentário.", {
            message: "Seu texto continua na caixa de digitação.",
          });
          return null;
        }
      },
      deleteComment: async (taskId, commentId) => {
        if (!canAccessTask(get(), taskId, "comment")) {
          logPermissionDenied("excluir comentÃ¡rio");
          return;
        }
        const token = useAuthStore.getState().token;
        try {
          const res = await axios.delete(
            `/api/workspaces/comments/${commentId}`,
            {
              headers: { Authorization: `Bearer ${token}` },
            },
          );

          if (res.data?.activities) {
            get().appendTaskActivities(taskId, res.data.activities);
          }

          set((state) => {
            const existing = state.commentsByTaskId[taskId] ?? [];
            return {
              commentsByTaskId: {
                ...state.commentsByTaskId,
                [taskId]: existing.filter((c) => c.id !== commentId),
              },
            };
          });
          toast.success("Comentário excluído.", {
            message: "Ele saiu da conversa do card.",
          });
        } catch (error) {
          console.error("Erro ao deletar comentÃ¡rio:", error);
          toast.error("Não foi possível excluir o comentário.", {
            message: "O comentário continua na conversa.",
          });
        }
      },
      editComment: async (
        taskId,
        commentId,
        newContent,
        mentionIds,
        linkDisplayModes,
      ) => {
        if (!canAccessTask(get(), taskId, "comment")) {
          logPermissionDenied("editar coment?rio");
          return false;
        }
        const token = useAuthStore.getState().token;
        const previousComments = get().commentsByTaskId[taskId] ?? [];
        set((state) => ({
          commentsByTaskId: {
            ...state.commentsByTaskId,
            [taskId]: (state.commentsByTaskId[taskId] ?? []).map((comment) =>
              comment.id === commentId
                ? {
                    ...comment,
                    content: newContent,
                    mentionIds:
                      mentionIds !== undefined
                        ? mentionIds
                        : comment.mentionIds,
                    linkDisplayModes:
                      linkDisplayModes !== undefined
                        ? linkDisplayModes
                        : comment.linkDisplayModes,
                    editedAt: new Date().toISOString(),
                  }
                : comment,
            ),
          },
        }));

        try {
          const res = await axios.put(
            `/api/workspaces/comments/${commentId}`,
            {
              content: newContent,
              ...(mentionIds !== undefined ? { mentionIds } : {}),
              ...(linkDisplayModes !== undefined ? { linkDisplayModes } : {}),
            },
            { headers: { Authorization: `Bearer ${token}` } },
          );

          if (res.data?.activities) {
            get().appendTaskActivities(taskId, res.data.activities);
          }
          if (res.data?.comment) {
            set((state) => ({
              commentsByTaskId: {
                ...state.commentsByTaskId,
                [taskId]: (state.commentsByTaskId[taskId] ?? []).map(
                  (comment) =>
                    comment.id === commentId
                      ? {
                          ...comment,
                          content: res.data.comment.content ?? newContent,
                          linkDisplayModes:
                            res.data.comment.linkDisplayModes ??
                            res.data.comment.link_display_modes ??
                            comment.linkDisplayModes,
                          editedAt:
                            res.data.comment.editedAt ?? comment.editedAt,
                        }
                      : comment,
                ),
              },
            }));
          }
          return true;
        } catch (error) {
          console.error("Erro ao editar coment?rio:", error);
          toast.error("Não foi possível salvar o comentário.", {
            message: "A versão anterior foi mantida.",
          });
          set((state) => ({
            commentsByTaskId: {
              ...state.commentsByTaskId,
              [taskId]: previousComments,
            },
          }));
          return false;
        }
      },
      updateCommentLinkDisplayMode: async (taskId, commentId, url, mode) => {
        const comment = (get().commentsByTaskId[taskId] ?? []).find(
          (item) => item.id === commentId,
        );
        if (!comment) return false;

        const nextLinkDisplayModes = {
          ...(comment.linkDisplayModes ?? {}),
          [url]: mode,
        };

        return get().editComment(
          taskId,
          commentId,
          comment.content,
          undefined,
          nextLinkDisplayModes,
        );
      },
      toggleCommentLike: async (taskId, commentId) => {
        if (!canAccessTask(get(), taskId, "comment")) {
          logPermissionDenied("curtir coment?rio");
          return;
        }

        const token = useAuthStore.getState().token;
        const previousComments = get().commentsByTaskId[taskId] ?? [];
        const targetComment = previousComments.find(
          (comment) => comment.id === commentId,
        );

        if (!targetComment) {
          return;
        }

        const nextLikedState = !targetComment.likedByMe;

        set((state) => ({
          commentsByTaskId: {
            ...state.commentsByTaskId,
            [taskId]: (state.commentsByTaskId[taskId] ?? []).map((comment) =>
              comment.id === commentId
                ? { ...comment, likedByMe: nextLikedState }
                : comment,
            ),
          },
        }));

        try {
          const res = await axios.put(
            `/api/workspaces/comments/${commentId}/like`,
            { liked: nextLikedState },
            { headers: { Authorization: `Bearer ${token}` } },
          );

          if (!res.data?.comment) {
            return;
          }

          set((state) => ({
            commentsByTaskId: {
              ...state.commentsByTaskId,
              [taskId]: (state.commentsByTaskId[taskId] ?? []).map((comment) =>
                comment.id === commentId
                  ? {
                      ...comment,
                      likedByMe:
                        typeof res.data.comment.likedByMe === "boolean"
                          ? res.data.comment.likedByMe
                          : comment.likedByMe,
                      reaction:
                        res.data.comment.reaction === undefined
                          ? comment.reaction
                          : res.data.comment.reaction,
                    }
                  : comment,
              ),
            },
          }));
        } catch (error) {
          console.error("Erro ao curtir coment?rio:", error);
          toast.error("Não foi possível registrar a curtida.", {
            message: "Tente reagir de novo em instantes.",
          });
          set((state) => ({
            commentsByTaskId: {
              ...state.commentsByTaskId,
              [taskId]: previousComments,
            },
          }));
        }
      },
      setCommentReaction: async (taskId, commentId, emoji) => {
        if (!canAccessTask(get(), taskId, "comment")) {
          logPermissionDenied("reagir ao coment?rio");
          return;
        }

        const token = useAuthStore.getState().token;
        const previousComments = get().commentsByTaskId[taskId] ?? [];
        const targetComment = previousComments.find(
          (comment) => comment.id === commentId,
        );

        if (!targetComment) {
          return;
        }

        set((state) => ({
          commentsByTaskId: {
            ...state.commentsByTaskId,
            [taskId]: (state.commentsByTaskId[taskId] ?? []).map((comment) =>
              comment.id === commentId
                ? { ...comment, reaction: emoji }
                : comment,
            ),
          },
        }));

        try {
          const res = await axios.put(
            `/api/workspaces/comments/${commentId}/reaction`,
            { emoji },
            { headers: { Authorization: `Bearer ${token}` } },
          );

          set((state) => ({
            commentsByTaskId: {
              ...state.commentsByTaskId,
              [taskId]: (state.commentsByTaskId[taskId] ?? []).map((comment) =>
                comment.id === commentId
                  ? {
                      ...comment,
                      likedByMe:
                        typeof res.data?.comment?.likedByMe === "boolean"
                          ? res.data.comment.likedByMe
                          : comment.likedByMe,
                      reaction:
                        res.data?.comment?.reaction === undefined
                          ? emoji
                          : res.data.comment.reaction,
                    }
                  : comment,
              ),
            },
          }));
        } catch (error) {
          console.error("Erro ao reagir ao coment?rio:", error);
          toast.error("Não foi possível registrar a reação.", {
            message: "Tente reagir de novo em instantes.",
          });
          set((state) => ({
            commentsByTaskId: {
              ...state.commentsByTaskId,
              [taskId]: previousComments,
            },
          }));
        }
      },
      setActiveList: (listId) =>
        set((state) => {
          const hierarchy = getListHierarchy(state.graph, listId);
          if (!hierarchy) return {};

          return {
            selection: {
              workspaceId: hierarchy.workspace.id,
              spaceId: hierarchy.space.id,
              folderId: hierarchy.folder.id,
              listId: hierarchy.list.id,
            },
            ui: {
              ...state.ui,
              activePage: "tasks",
            },
          };
        }),
      appendTaskActivities: (taskId, activities) => {
        set((state) => {
          const task = state.graph.tasks[taskId];
          if (!task || !activities || activities.length === 0) return {};
          const existingIds = new Set(
            (task.activities || []).map((activity) => activity.id),
          );
          const uniqueActivities = activities.filter(
            (activity) => activity?.id && !existingIds.has(activity.id),
          );
          if (uniqueActivities.length === 0) {
            return {};
          }
          return {
            graph: {
              ...state.graph,
              tasks: {
                ...state.graph.tasks,
                [taskId]: {
                  ...task,
                  activities: [...(task.activities || []), ...uniqueActivities],
                },
              },
            },
          };
        });
      },
      addTask: async (payload) => {
        const state = get();
        const listId = payload.listId ?? state.selection.listId;
        if (!listId) return;
        if (!canAccessList(state, listId, "edit")) {
          logPermissionDenied("criar tarefa");
          return;
        }

        const hierarchy = getListHierarchy(state.graph, listId);
        if (!hierarchy) return;

        const token = useAuthStore.getState().token;
        try {
          const res = await axios.post(
            `/api/workspaces/tasks`,
            {
              workspaceId: hierarchy.workspace.id,
              spaceId: hierarchy.space.id,
              folderId: hierarchy.folder.id,
              listId: hierarchy.list.id,
              title: payload.title.trim(),
              descriptionText: payload.descriptionText.trim(),
              statusId: payload.statusId,
              priority: payload.priority,
              visibility: payload.visibility || "public",
              startDate: payload.startDate || null,
              dueDate: payload.dueDate || null,
              assigneeIds: payload.assigneeIds || [],
              tags: payload.tags || [],
              estimate: payload.estimate || null,
              customFieldValues: payload.customFieldValues || {},
            },
            {
              headers: { Authorization: `Bearer ${token}` },
            },
          );

          const newTask = normalizeTask(res.data.task);
          if (!newTask)
            throw new Error("Falha ao receber a nova tarefa do servidor.");

          toast.success("Tarefa criada.", { message: newTask.title });

          set((state) => ({
            graph: {
              ...state.graph,
              tasks: { ...state.graph.tasks, [newTask.id]: newTask },
              lists: {
                ...state.graph.lists,
                [hierarchy.list.id]: {
                  ...state.graph.lists[hierarchy.list.id],
                  taskIds: [
                    newTask.id,
                    ...state.graph.lists[hierarchy.list.id].taskIds,
                  ],
                },
              },
            },
          }));
        } catch (error) {
          console.error("Erro ao criar tarefa:", error);
          toast.error("Não foi possível criar a tarefa.", {
            message: "Tente novamente em instantes.",
          });
        }
      },
      updateTaskPriority: async (taskId, priority) => {
        if (!canAccessTask(get(), taskId, "edit")) {
          logPermissionDenied("alterar prioridade da tarefa");
          return;
        }
        const token = useAuthStore.getState().token;
        const task = get().graph.tasks[taskId];
        if (!task || task.priority === priority) return;

        // Optimistic update
        set((state) => ({
          graph: {
            ...state.graph,
            tasks: {
              ...state.graph.tasks,
              [taskId]: { ...task, priority },
            },
          },
        }));

        try {
          const res = await axios.put(
            `/api/workspaces/tasks/${taskId}`,
            {
              priority,
            },
            {
              headers: { Authorization: `Bearer ${token}` },
            },
          );
          if (res.data?.activities) {
            get().appendTaskActivities(taskId, res.data.activities);
          }
        } catch (error) {
          console.error("Erro ao atualizar prioridade:", error);
          toast.error("Não foi possível alterar a prioridade.", {
            message: "A prioridade anterior foi mantida.",
          });
          // Rollback
          set((state) => ({
            graph: {
              ...state.graph,
              tasks: {
                ...state.graph.tasks,
                [taskId]: task,
              },
            },
          }));
        }
      },
      moveTaskToStatus: async (taskId, statusId) => {
        if (!canMoveTaskStatus(get(), taskId)) {
          logPermissionDenied("mover a tarefa");
          return;
        }
        const token = useAuthStore.getState().token;
        const task = get().graph.tasks[taskId];
        if (!task || task.statusId === statusId) return;
        const previousStatusId = task.statusId;

        set((state) => ({
          graph: {
            ...state.graph,
            tasks: {
              ...state.graph.tasks,
              [taskId]: {
                ...state.graph.tasks[taskId],
                statusId,
                updatedAt: new Date().toISOString(),
              },
            },
          },
        }));

        try {
          const res = await axios.put(
            `/api/workspaces/tasks/${taskId}`,
            { statusId },
            {
              headers: { Authorization: `Bearer ${token}` },
            },
          );
          if (res.data?.activities) {
            get().appendTaskActivities(taskId, res.data.activities);
          }
        } catch (e) {
          console.error("Erro ao mover status", e);
          toast.error("Não foi possível mover o card de coluna.", {
            message: "O card voltou para a coluna anterior.",
          });
          set((state) => ({
            graph: {
              ...state.graph,
              tasks: {
                ...state.graph.tasks,
                [taskId]: {
                  ...state.graph.tasks[taskId],
                  statusId: previousStatusId,
                },
              },
            },
          }));
        }
      },
      reorderTasksInColumn: (activeId, overId) => {
        const state = get();
        const activeTask = state.graph.tasks[activeId];
        const overTask = state.graph.tasks[overId];
        if (!activeTask || !overTask) return;
        if (activeTask.statusId !== overTask.statusId) return;
        if (activeTask.priority !== overTask.priority) return;

        const PRIORITY_RANK: Record<string, number> = {
          urgent: 0,
          high: 1,
          medium: 2,
          low: 3,
        };

        const columnTasks = Object.values(state.graph.tasks)
          .filter((t) => t.statusId === activeTask.statusId)
          .slice()
          .sort((a, b) => {
            const pa = PRIORITY_RANK[a.priority] ?? 99;
            const pb = PRIORITY_RANK[b.priority] ?? 99;
            if (pa !== pb) return pa - pb;
            return (
              (state.taskSortOrders[a.id] ?? 0) -
              (state.taskSortOrders[b.id] ?? 0)
            );
          });

        const activeIndex = columnTasks.findIndex((t) => t.id === activeId);
        const overIndex = columnTasks.findIndex((t) => t.id === overId);
        if (activeIndex === -1 || overIndex === -1 || activeIndex === overIndex)
          return;

        const reordered = [...columnTasks];
        const [moved] = reordered.splice(activeIndex, 1);
        reordered.splice(overIndex, 0, moved);

        const oldSortOrders = state.taskSortOrders;
        const newSortOrders = { ...oldSortOrders };
        const changedTasks: Array<{ id: EntityId; sortOrder: number }> = [];

        reordered.forEach((t, idx) => {
          const newOrder = idx * 1000;
          newSortOrders[t.id] = newOrder;
          if (oldSortOrders[t.id] !== newOrder) {
            changedTasks.push({ id: t.id, sortOrder: newOrder });
          }
        });

        // AtualizaÃ§Ã£o otimista imediata
        set((s) => ({
          graph: {
            ...s.graph,
            tasks: Object.fromEntries(
              Object.entries(s.graph.tasks).map(([id, task]) => {
                const changed = changedTasks.find((c) => c.id === id);
                return changed
                  ? [id, { ...task, sortOrder: changed.sortOrder }]
                  : [id, task];
              }),
            ),
          },
          taskSortOrders: newSortOrders,
        }));

        // Persiste no backend
        const token = useAuthStore.getState().token;
        changedTasks.forEach(({ id, sortOrder }) => {
          axios
            .put(
              `/api/workspaces/tasks/${id}`,
              { sortOrder },
              { headers: { Authorization: `Bearer ${token}` } },
            )
            .catch(() => {
              // Silently ignore â€” localStorage garante persistÃªncia local
            });
        });
      },
      createStatusColumn: async (listId, payload) => {
        const token = useAuthStore.getState().token;
        const name = payload.name.trim();
        if (!name) return;

        try {
          const res = await axios.post(
            `/api/workspaces/lists/${listId}/statuses`,
            {
              name,
              colorClass: payload.colorClass,
              chipClass: payload.chipClass,
              dotClass: payload.dotClass,
            },
            { headers: { Authorization: `Bearer ${token}` } },
          );

          const created: TaskStatusDefinition | undefined = res.data?.status;
          if (!created) return;

          set((state) => {
            if (
              state.graph.statusDefinitions.some((s) => s.id === created.id)
            ) {
              return {};
            }
            return {
              graph: {
                ...state.graph,
                statusDefinitions: [...state.graph.statusDefinitions, created],
              },
            };
          });
          toast.success("Coluna criada.", {
            message: "Já aparece no quadro deste projeto.",
          });
        } catch (e) {
          console.error("Erro ao criar coluna", e);
          toast.error("Não foi possível criar a coluna.", {
            message: "O quadro segue com as colunas atuais.",
          });
        }
      },
      updateStatusColumn: async (statusId, payload) => {
        const token = useAuthStore.getState().token;
        const listId = get().selection.listId;
        const name = payload.name.trim();
        if (!listId || !name) return;

        try {
          const res = await axios.put(
            `/api/workspaces/statuses/${statusId}`,
            {
              name,
              colorClass: payload.colorClass,
              chipClass: payload.chipClass,
              dotClass: payload.dotClass,
              listId,
            },
            { headers: { Authorization: `Bearer ${token}` } },
          );

          const updated: TaskStatusDefinition | undefined = res.data?.status;
          if (!updated) return;
          const forkedFrom: EntityId | undefined = res.data?.forkedFrom;

          set((state) => {
            // Fork: esconde a coluna global nesta lista, adiciona a nova coluna
            // específica e migra as tarefas da lista para o novo status.
            if (forkedFrom) {
              const statusDefinitions = state.graph.statusDefinitions.map(
                (status) =>
                  status.id === forkedFrom
                    ? {
                        ...status,
                        hiddenListIds: [
                          ...(status.hiddenListIds || []),
                          listId,
                        ],
                      }
                    : status,
              );
              if (!statusDefinitions.some((s) => s.id === updated.id)) {
                statusDefinitions.push(updated);
              }

              const tasks = { ...state.graph.tasks };
              Object.values(tasks).forEach((task) => {
                if (task.listId === listId && task.statusId === forkedFrom) {
                  tasks[task.id] = { ...task, statusId: updated.id };
                }
              });

              return {
                graph: { ...state.graph, statusDefinitions, tasks },
              };
            }

            // Atualização direta de uma coluna específica da lista.
            return {
              graph: {
                ...state.graph,
                statusDefinitions: state.graph.statusDefinitions.map(
                  (status) =>
                    status.id === updated.id
                      ? { ...status, ...updated }
                      : status,
                ),
              },
            };
          });
          toast.success("Coluna atualizada.", {
            message: "O quadro já mostra as mudanças.",
          });
        } catch (e) {
          console.error("Erro ao editar coluna", e);
          toast.error("Não foi possível salvar a coluna.", {
            message: "A coluna manteve os dados anteriores.",
          });
        }
      },
      reorderStatusColumns: async (orderedIds) => {
        const token = useAuthStore.getState().token;
        const previous = get().graph.statusDefinitions;

        // Ordem atual (apenas as colunas afetadas) para rollback
        const orderById = new Map(orderedIds.map((id, idx) => [id, idx + 1]));

        // Atualização otimista: reescreve `order` das colunas reordenadas
        set((state) => ({
          graph: {
            ...state.graph,
            statusDefinitions: state.graph.statusDefinitions.map((status) =>
              orderById.has(status.id)
                ? { ...status, order: orderById.get(status.id) as number }
                : status,
            ),
          },
        }));

        const orders = orderedIds.map((id) => ({
          id,
          order: orderById.get(id) as number,
        }));

        try {
          await axios.put(
            `/api/workspaces/statuses/reorder`,
            // O projeto aberto vai junto: a ordem é dele, não de todas as contas.
            { orders, listId: get().selection.listId || null },
            { headers: { Authorization: `Bearer ${token}` } },
          );
        } catch (e) {
          console.error("Erro ao reordenar colunas", e);
          toast.error("Não foi possível reordenar as colunas.", {
            message: "A ordem anterior foi restaurada.",
          });
          // Reverte ao estado anterior
          set((state) => ({
            graph: { ...state.graph, statusDefinitions: previous },
          }));
        }
      },
      cycleTaskStatus: async (taskId) => {
        if (!canMoveTaskStatus(get(), taskId)) {
          logPermissionDenied("mover a tarefa");
          return;
        }
        const token = useAuthStore.getState().token;
        const state = get();
        const task = state.graph.tasks[taskId];
        if (!task || state.graph.statusDefinitions.length === 0) return;

        const ordered = state.graph.statusDefinitions
          .slice()
          .sort((a, b) => a.order - b.order);
        const currentIndex = ordered.findIndex(
          (status) => status.id === task.statusId,
        );
        if (currentIndex < 0) return;
        const nextStatus = ordered[(currentIndex + 1) % ordered.length];

        try {
          const res = await axios.put(
            `/api/workspaces/tasks/${taskId}`,
            { statusId: nextStatus.id },
            {
              headers: { Authorization: `Bearer ${token}` },
            },
          );
          if (res.data?.activities) {
            get().appendTaskActivities(taskId, res.data.activities);
          }

          set((state) => ({
            graph: {
              ...state.graph,
              tasks: {
                ...state.graph.tasks,
                [taskId]: {
                  ...task,
                  statusId: nextStatus.id,
                  updatedAt: new Date().toISOString(),
                },
              },
            },
          }));
        } catch (e) {
          console.error("Erro ao ciclar status", e);
          toast.error("Não foi possível avançar o status do card.", {
            message: "O card seguiu na coluna atual.",
          });
        }
      },
      toggleTaskWatcher: async (taskId) => {
        const state = get();
        const task = state.graph.tasks[taskId];
        const currentUserId = useAuthStore.getState().user?.id;
        if (!task || !currentUserId) return false;

        const previousWatcherIds = task.watcherIds || [];
        const isWatching = previousWatcherIds.includes(currentUserId);
        const optimisticWatcherIds = isWatching
          ? previousWatcherIds.filter((memberId) => memberId !== currentUserId)
          : [...previousWatcherIds, currentUserId];

        const applyWatcherIds = (watcherIds: EntityId[]) => {
          set((current) => {
            const currentTask = current.graph.tasks[taskId];
            if (!currentTask) return current;
            return {
              graph: {
                ...current.graph,
                tasks: {
                  ...current.graph.tasks,
                  [taskId]: { ...currentTask, watcherIds },
                },
              },
            };
          });
        };

        applyWatcherIds(optimisticWatcherIds);

        const token = useAuthStore.getState().token;

        try {
          const res = await axios.post(
            `/api/workspaces/tasks/${taskId}/watchers/toggle`,
            {},
            { headers: { Authorization: `Bearer ${token}` } },
          );

          if (Array.isArray(res.data?.watcherIds)) {
            applyWatcherIds(res.data.watcherIds);
          }

          toast.success(
            isWatching
              ? "Você não está mais seguindo este card."
              : "Você está seguindo este card.",
            {
              message: isWatching
                ? "Você não recebe mais avisos deste card."
                : "Avisamos sobre comentários, prazos e anexos.",
            },
          );

          return true;
        } catch (error) {
          console.error("Erro ao atualizar observador da tarefa:", error);
          applyWatcherIds(previousWatcherIds);
          toast.error("Não foi possível atualizar o acompanhamento do card.", {
            message: "O sino voltou ao estado anterior.",
          });
          return false;
        }
      },
      duplicateTask: async (taskId) => {
        if (!canAccessTask(get(), taskId, "edit")) {
          logPermissionDenied("duplicar tarefa");
          return null;
        }

        const token = useAuthStore.getState().token;

        try {
          const res = await axios.post(
            `/api/workspaces/tasks/${taskId}/duplicate`,
            {},
            { headers: { Authorization: `Bearer ${token}` } },
          );

          const duplicatedTask = normalizeTask(res.data?.task);
          if (!duplicatedTask?.id) return null;

          set((state) => {
            const list = state.graph.lists[duplicatedTask.listId];

            return {
              graph: {
                ...state.graph,
                tasks: {
                  ...state.graph.tasks,
                  [duplicatedTask.id]: duplicatedTask,
                },
                lists: list
                  ? {
                      ...state.graph.lists,
                      [duplicatedTask.listId]: {
                        ...list,
                        taskIds: list.taskIds.includes(duplicatedTask.id)
                          ? list.taskIds
                          : [duplicatedTask.id, ...list.taskIds],
                      },
                    }
                  : state.graph.lists,
              },
            };
          });

          toast.success("Card duplicado.", { message: duplicatedTask.title });

          return duplicatedTask.id;
        } catch (error) {
          console.error("Erro ao duplicar tarefa:", error);
          toast.error("Não foi possível duplicar o card.", {
            message: "Nenhuma cópia foi criada.",
          });
          return null;
        }
      },
      deleteTask: async (taskId) => {
        if (!canAccessTask(get(), taskId, "edit")) {
          logPermissionDenied("excluir tarefa");
          return;
        }
        const state = get();
        const task = state.graph.tasks[taskId];
        if (!task) return;

        const token = useAuthStore.getState().token;

        try {
          // Perform backend deletion
          await axios.delete(`/api/workspaces/tasks/${taskId}`, {
            headers: { Authorization: `Bearer ${token}` },
          });

          // Optimistic update (already kind of handled by the state structure, but let's redefine set)
          set((state) => {
            const listItems = state.graph.lists[task.listId];
            const newTasks = { ...state.graph.tasks };

            // Se tiver pai, remove o ID da lista de subtarefas do pai
            if (task.parentTaskId && newTasks[task.parentTaskId]) {
              newTasks[task.parentTaskId] = {
                ...newTasks[task.parentTaskId],
                subtaskIds: (
                  newTasks[task.parentTaskId].subtaskIds || []
                ).filter((id) => id !== taskId),
              };
            }

            delete newTasks[taskId];

            const newComments = { ...state.commentsByTaskId };
            delete newComments[taskId];

            return {
              graph: {
                ...state.graph,
                tasks: newTasks,
                lists: listItems
                  ? {
                      ...state.graph.lists,
                      [task.listId]: {
                        ...listItems,
                        taskIds: listItems.taskIds.filter(
                          (id) => id !== taskId,
                        ),
                      },
                    }
                  : state.graph.lists,
              },
              commentsByTaskId: newComments,
              ui: {
                ...state.ui,
                activeTaskIdForDetails:
                  state.ui.activeTaskIdForDetails === taskId
                    ? null
                    : state.ui.activeTaskIdForDetails,
              },
            };
          });
          toast.success("Tarefa excluída.", {
            message: "Comentários e anexos dela saíram junto.",
          });
        } catch (error) {
          console.error("Erro ao deletar tarefa:", error);
          toast.error("Não foi possível excluir a tarefa.", {
            message: "Tente novamente em instantes.",
          });
        }
      },
      addSubtask: async (parentTaskId, title) => {
        if (!canAccessTask(get(), parentTaskId, "edit")) {
          logPermissionDenied("criar subtarefa");
          return;
        }
        const token = useAuthStore.getState().token;
        const parent = get().graph.tasks[parentTaskId];
        if (!parent) return;

        try {
          const res = await axios.post(
            `/api/workspaces/tasks/${parentTaskId}/subtasks`,
            {
              title: title.trim() || "Nova Subtarefa",
            },
            { headers: { Authorization: `Bearer ${token}` } },
          );

          const newTask = res.data.subtask;
          const statusDefinition = res.data.statusDefinition;

          set((state) => {
            const parentTask = state.graph.tasks[parentTaskId];
            if (!parentTask) return {};
            const list = state.graph.lists[parentTask.listId];

            // Verificar se o status "Subtarefas" ja existe nas definicoes
            const hasStatus = state.graph.statusDefinitions.some(
              (s) => s.id === "status_subtasks",
            );
            const newStatusDefs = hasStatus
              ? state.graph.statusDefinitions
              : [...state.graph.statusDefinitions, statusDefinition].filter(
                  Boolean,
                );

            const nextSubtaskIds = (parentTask.subtaskIds || []).includes(
              newTask.id,
            )
              ? parentTask.subtaskIds || []
              : [...(parentTask.subtaskIds || []), newTask.id];

            const nextListTaskIds = list
              ? list.taskIds.includes(newTask.id)
                ? list.taskIds
                : [newTask.id, ...list.taskIds]
              : [];

            return {
              graph: {
                ...state.graph,
                statusDefinitions: newStatusDefs,
                tasks: {
                  ...state.graph.tasks,
                  [newTask.id]: newTask,
                  [parentTaskId]: {
                    ...parentTask,
                    subtaskIds: nextSubtaskIds,
                  },
                },
                lists: list
                  ? {
                      ...state.graph.lists,
                      [parentTask.listId]: {
                        ...list,
                        taskIds: nextListTaskIds,
                      },
                    }
                  : state.graph.lists,
              },
            };
          });
          toast.success("Subtarefa criada.", {
            message: "Já aparece na lista de subtarefas.",
          });
        } catch (e) {
          console.error("Erro ao criar subtarefa:", e);
          toast.error("Não foi possível criar a subtarefa.", {
            message: "Nenhuma subtarefa foi adicionada.",
          });
        }
      },

      // â”€â”€ Checklists â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      addChecklist: async (taskId, name) => {
        if (!canAccessTask(get(), taskId, "comment")) {
          logPermissionDenied("criar checklist");
          return;
        }
        const token = useAuthStore.getState().token;
        try {
          const res = await axios.post(
            `/api/workspaces/tasks/${taskId}/checklists`,
            {
              name,
            },
            { headers: { Authorization: `Bearer ${token}` } },
          );

          const checklist = res.data.checklist;
          set((state) => {
            const task = state.graph.tasks[taskId];
            if (!task) return {};
            return {
              graph: {
                ...state.graph,
                tasks: {
                  ...state.graph.tasks,
                  [taskId]: {
                    ...task,
                    checklists: [...(task.checklists ?? []), checklist],
                  },
                },
              },
            };
          });
        } catch (e) {
          console.error("Erro ao criar checklist:", e);
          toast.error("Não foi possível criar a checklist.", {
            message: "Nenhuma checklist foi adicionada.",
          });
        }
      },
      deleteChecklist: async (taskId, checklistId) => {
        if (!canAccessTask(get(), taskId, "comment")) {
          logPermissionDenied("excluir checklist");
          return;
        }
        const token = useAuthStore.getState().token;
        // Optimistic update
        set((state) => {
          const task = state.graph.tasks[taskId];
          if (!task) return {};
          return {
            graph: {
              ...state.graph,
              tasks: {
                ...state.graph.tasks,
                [taskId]: {
                  ...task,
                  checklists: (task.checklists ?? []).filter(
                    (cl) => cl.id !== checklistId,
                  ),
                },
              },
            },
          };
        });
        try {
          await axios.delete(`/api/workspaces/checklists/${checklistId}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
        } catch (e) {
          console.error("Erro ao deletar checklist:", e);
          toast.error("Não foi possível excluir a checklist.", {
            message: "A checklist continua no card.",
          });
        }
      },
      renameChecklist: async (taskId, checklistId, name) => {
        if (!canAccessTask(get(), taskId, "comment")) {
          logPermissionDenied("renomear checklist");
          return;
        }
        const token = useAuthStore.getState().token;
        set((state) => {
          const task = state.graph.tasks[taskId];
          if (!task) return {};
          return {
            graph: {
              ...state.graph,
              tasks: {
                ...state.graph.tasks,
                [taskId]: {
                  ...task,
                  checklists: (task.checklists ?? []).map((cl) =>
                    cl.id === checklistId ? { ...cl, name } : cl,
                  ),
                },
              },
            },
          };
        });
        try {
          await axios.put(
            `/api/workspaces/checklists/${checklistId}`,
            { name },
            {
              headers: { Authorization: `Bearer ${token}` },
            },
          );
        } catch (e) {
          console.error("Erro ao renomear checklist:", e);
          toast.error("Não foi possível renomear a checklist.", {
            message: "O nome anterior foi mantido.",
          });
        }
      },
      addChecklistItem: async (taskId, checklistId, label) => {
        if (!canAccessTask(get(), taskId, "comment")) {
          logPermissionDenied("criar item de checklist");
          return;
        }
        const token = useAuthStore.getState().token;
        try {
          const res = await axios.post(
            `/api/workspaces/checklists/${checklistId}/items`,
            {
              label,
            },
            { headers: { Authorization: `Bearer ${token}` } },
          );

          const item = res.data.item;
          set((state) => {
            const task = state.graph.tasks[taskId];
            if (!task) return {};
            return {
              graph: {
                ...state.graph,
                tasks: {
                  ...state.graph.tasks,
                  [taskId]: {
                    ...task,
                    checklists: (task.checklists ?? []).map((cl) =>
                      cl.id === checklistId
                        ? { ...cl, items: [...cl.items, item] }
                        : cl,
                    ),
                  },
                },
              },
            };
          });
        } catch (e) {
          console.error("Erro ao criar item de checklist:", e);
          toast.error("Não foi possível criar o item da checklist.", {
            message: "O item não entrou na checklist.",
          });
        }
      },
      toggleChecklistItem: async (taskId, checklistId, itemId) => {
        if (!canAccessTask(get(), taskId, "comment")) {
          logPermissionDenied("editar item de checklist");
          return;
        }
        const token = useAuthStore.getState().token;
        // Optimistic update
        set((state) => {
          const task = state.graph.tasks[taskId];
          if (!task) return {};
          return {
            graph: {
              ...state.graph,
              tasks: {
                ...state.graph.tasks,
                [taskId]: {
                  ...task,
                  checklists: (task.checklists ?? []).map((cl) =>
                    cl.id === checklistId
                      ? {
                          ...cl,
                          items: cl.items.map((it) =>
                            it.id === itemId ? { ...it, done: !it.done } : it,
                          ),
                        }
                      : cl,
                  ),
                },
              },
            },
          };
        });
        try {
          await axios.put(
            `/api/workspaces/checklist-items/${itemId}/toggle`,
            {},
            {
              headers: { Authorization: `Bearer ${token}` },
            },
          );
        } catch (e) {
          console.error("Erro ao toggle item:", e);
          toast.error("Não foi possível atualizar o item da checklist.", {
            message: "O item voltou ao estado anterior.",
          });
        }
      },
      setChecklistItemAssignee: async (
        taskId,
        checklistId,
        itemId,
        assigneeId,
      ) => {
        if (!canAccessTask(get(), taskId, "edit")) {
          logPermissionDenied("alterar responsÃ¡veis do checklist");
          return;
        }
        const token = useAuthStore.getState().token;
        // Optimistic update
        set((state) => {
          const task = state.graph.tasks[taskId];
          if (!task) return {};
          return {
            graph: {
              ...state.graph,
              tasks: {
                ...state.graph.tasks,
                [taskId]: {
                  ...task,
                  checklists: (task.checklists ?? []).map((cl) =>
                    cl.id === checklistId
                      ? {
                          ...cl,
                          items: cl.items.map((it) => {
                            if (it.id !== itemId) return it;
                            const ids = it.assigneeIds ?? [];
                            const already = ids.includes(assigneeId!);
                            return {
                              ...it,
                              assigneeIds: already
                                ? ids.filter((id) => id !== assigneeId)
                                : [...ids, assigneeId!],
                            };
                          }),
                        }
                      : cl,
                  ),
                },
              },
            },
          };
        });
        try {
          await axios.put(
            `/api/workspaces/checklist-items/${itemId}/assignees`,
            {
              memberId: assigneeId,
            },
            { headers: { Authorization: `Bearer ${token}` } },
          );
        } catch (e) {
          console.error("Erro ao atribuir item:", e);
          toast.error("Não foi possível atribuir o item da checklist.", {
            message: "O responsável do item não mudou.",
          });
        }
      },
      updateChecklistItemLabel: async (taskId, checklistId, itemId, label) => {
        if (!canAccessTask(get(), taskId, "comment")) {
          logPermissionDenied("editar item de checklist");
          return;
        }
        const token = useAuthStore.getState().token;
        set((state) => {
          const task = state.graph.tasks[taskId];
          if (!task) return {};
          return {
            graph: {
              ...state.graph,
              tasks: {
                ...state.graph.tasks,
                [taskId]: {
                  ...task,
                  checklists: (task.checklists ?? []).map((cl) =>
                    cl.id === checklistId
                      ? {
                          ...cl,
                          items: cl.items.map((it) =>
                            it.id === itemId ? { ...it, label } : it,
                          ),
                        }
                      : cl,
                  ),
                },
              },
            },
          };
        });
        try {
          await axios.put(
            `/api/workspaces/checklist-items/${itemId}`,
            { label },
            {
              headers: { Authorization: `Bearer ${token}` },
            },
          );
        } catch (e) {
          console.error("Erro ao atualizar label do item:", e);
          toast.error("Não foi possível renomear o item da checklist.", {
            message: "O texto anterior foi mantido.",
          });
        }
      },
      reorderChecklistItem: (taskId, checklistId, oldIndex, newIndex) =>
        set((state) => {
          if (!canAccessTask(state, taskId, "edit")) {
            logPermissionDenied("reordenar checklist");
            return {};
          }
          const task = state.graph.tasks[taskId];
          if (!task) return {};

          return {
            graph: {
              ...state.graph,
              tasks: {
                ...state.graph.tasks,
                [taskId]: {
                  ...task,
                  checklists: (task.checklists ?? []).map((cl) => {
                    if (cl.id !== checklistId) return cl;
                    const items = [...cl.items];
                    const [removed] = items.splice(oldIndex, 1);
                    items.splice(newIndex, 0, removed);
                    return { ...cl, items };
                  }),
                },
              },
            },
          };
        }),
      deleteChecklistItem: async (taskId, checklistId, itemId) => {
        if (!canAccessTask(get(), taskId, "comment")) {
          logPermissionDenied("excluir item de checklist");
          return;
        }
        const token = useAuthStore.getState().token;
        set((state) => {
          const task = state.graph.tasks[taskId];
          if (!task) return {};
          return {
            graph: {
              ...state.graph,
              tasks: {
                ...state.graph.tasks,
                [taskId]: {
                  ...task,
                  checklists: (task.checklists ?? []).map((cl) =>
                    cl.id === checklistId
                      ? {
                          ...cl,
                          items: cl.items.filter((it) => it.id !== itemId),
                        }
                      : cl,
                  ),
                },
              },
            },
          };
        });
        try {
          await axios.delete(`/api/workspaces/checklist-items/${itemId}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
        } catch (e) {
          console.error("Erro ao deletar item:", e);
          toast.error("Não foi possível excluir o item da checklist.", {
            message: "O item continua na checklist.",
          });
        }
      },
      addAttachment: async (taskId, attachment) => {
        if (!canAccessTask(get(), taskId, "comment")) {
          logPermissionDenied("adicionar anexo");
          return;
        }
        const token = useAuthStore.getState().token;
        try {
          const res = await axios.post(
            `/api/workspaces/tasks/${taskId}/attachments`,
            {
              name: attachment.name,
              url: attachment.url || "",
              type: attachment.type || "document",
              size: attachment.size || 0,
            },
            { headers: { Authorization: `Bearer ${token}` } },
          );

          const newAttachment = res.data.attachment;
          if (res.data?.activities) {
            get().appendTaskActivities(taskId, res.data.activities);
          }
          set((state) => {
            const task = state.graph.tasks[taskId];
            if (!task) return {};
            return {
              graph: {
                ...state.graph,
                tasks: {
                  ...state.graph.tasks,
                  [taskId]: {
                    ...task,
                    attachments: [...(task.attachments || []), newAttachment],
                    updatedAt: new Date().toISOString(),
                  },
                },
              },
            };
          });
          toast.success("Anexo adicionado.", {
            message: "Já aparece na lista de anexos do card.",
          });
        } catch (e) {
          console.error("Erro ao criar attachment:", e);
          toast.error("Não foi possível anexar o arquivo.", {
            message: "O envio foi interrompido.",
          });
        }
      },
      deleteAttachment: async (taskId, attachmentId) => {
        if (!canAccessTask(get(), taskId, "edit")) {
          logPermissionDenied("excluir anexo");
          return;
        }
        const token = useAuthStore.getState().token;
        const previousTask = useTaskStore.getState().graph.tasks[taskId];
        if (!previousTask) return;
        set((state) => {
          const task = state.graph.tasks[taskId];
          if (!task) return {};
          return {
            graph: {
              ...state.graph,
              tasks: {
                ...state.graph.tasks,
                [taskId]: {
                  ...task,
                  attachments: (task.attachments || []).filter(
                    (a) => a.id !== attachmentId,
                  ),
                  coverAttachmentId:
                    task.coverAttachmentId === attachmentId
                      ? null
                      : (task.coverAttachmentId ?? null),
                  updatedAt: new Date().toISOString(),
                },
              },
            },
          };
        });
        try {
          const res = await axios.delete(
            `/api/workspaces/attachments/${attachmentId}`,
            {
              headers: { Authorization: `Bearer ${token}` },
            },
          );
          if (res.data?.activities) {
            get().appendTaskActivities(taskId, res.data.activities);
          }
          toast.success("Anexo excluído.", {
            message: "Ele saiu da lista de anexos do card.",
          });
        } catch (e) {
          set((state) => ({
            graph: {
              ...state.graph,
              tasks: {
                ...state.graph.tasks,
                [taskId]: previousTask,
              },
            },
          }));
          console.error("Erro ao deletar attachment:", e);
          toast.error("Não foi possível excluir o anexo.", {
            message: "O anexo continua no card.",
          });
        }
      },
      setTaskCoverAttachment: async (taskId, attachmentId) => {
        if (!canAccessTask(get(), taskId, "edit")) {
          logPermissionDenied("definir a capa do card");
          return;
        }

        const token = useAuthStore.getState().token;
        const previousTask = useTaskStore.getState().graph.tasks[taskId];
        if (!previousTask) return;

        const normalizedAttachmentId = attachmentId ?? null;
        if (previousTask.coverAttachmentId === normalizedAttachmentId) {
          return;
        }

        set((state) => {
          const task = state.graph.tasks[taskId];
          if (!task) return {};

          return {
            graph: {
              ...state.graph,
              tasks: {
                ...state.graph.tasks,
                [taskId]: {
                  ...task,
                  coverAttachmentId: normalizedAttachmentId,
                  updatedAt: new Date().toISOString(),
                },
              },
            },
          };
        });

        try {
          const res = await axios.put(
            `/api/workspaces/tasks/${taskId}`,
            { coverAttachmentId: normalizedAttachmentId },
            { headers: { Authorization: `Bearer ${token}` } },
          );
          if (res.data?.activities) {
            get().appendTaskActivities(taskId, res.data.activities);
          }
          toast.success("Capa do card atualizada.", {
            message: "O quadro já mostra a nova imagem.",
          });
        } catch (e) {
          set((state) => ({
            graph: {
              ...state.graph,
              tasks: {
                ...state.graph.tasks,
                [taskId]: previousTask,
              },
            },
          }));
          console.error("Erro ao definir capa do task:", e);
          toast.error("Não foi possível atualizar a capa do card.", {
            message: "A capa anterior foi mantida.",
          });
        }
      },
      linkTask: async (taskId, linkedTaskId) => {
        if (
          !canAccessTask(get(), taskId, "edit") ||
          !canAccessTask(get(), linkedTaskId, "edit")
        ) {
          logPermissionDenied("vincular tarefas");
          return;
        }
        const token = useAuthStore.getState().token;
        set((state) => {
          const taskA = state.graph.tasks[taskId];
          const taskB = state.graph.tasks[linkedTaskId];
          if (!taskA || !taskB) return {};

          const currentLinksA = taskA.linkedTaskIds || [];
          const currentLinksB = taskB.linkedTaskIds || [];

          if (currentLinksA.includes(linkedTaskId)) return {};

          return {
            graph: {
              ...state.graph,
              tasks: {
                ...state.graph.tasks,
                [taskId]: {
                  ...taskA,
                  linkedTaskIds: [...currentLinksA, linkedTaskId],
                  updatedAt: new Date().toISOString(),
                },
                [linkedTaskId]: {
                  ...taskB,
                  linkedTaskIds: [...currentLinksB, taskId],
                  updatedAt: new Date().toISOString(),
                },
              },
            },
          };
        });
        try {
          const res = await axios.post(
            `/api/workspaces/tasks/${taskId}/links`,
            {
              linkedTaskId,
            },
            { headers: { Authorization: `Bearer ${token}` } },
          );
          if (res.data?.activitiesTaskId) {
            get().appendTaskActivities(taskId, res.data.activitiesTaskId);
          }
          if (res.data?.activitiesLinkedTask) {
            get().appendTaskActivities(
              linkedTaskId,
              res.data.activitiesLinkedTask,
            );
          }
          toast.success("Tarefas vinculadas.", {
            message: "O vínculo aparece nos dois cards.",
          });
        } catch (e) {
          console.error("Erro ao linkar tasks:", e);
          toast.error("Não foi possível vincular as tarefas.", {
            message: "Nenhum vínculo foi criado.",
          });
        }
      },
      unlinkTask: async (taskId, linkedTaskId) => {
        if (
          !canAccessTask(get(), taskId, "edit") ||
          !canAccessTask(get(), linkedTaskId, "edit")
        ) {
          logPermissionDenied("desvincular tarefas");
          return;
        }
        const token = useAuthStore.getState().token;
        set((state) => {
          const taskA = state.graph.tasks[taskId];
          const taskB = state.graph.tasks[linkedTaskId];
          if (!taskA || !taskB) return {};

          return {
            graph: {
              ...state.graph,
              tasks: {
                ...state.graph.tasks,
                [taskId]: {
                  ...taskA,
                  linkedTaskIds: (taskA.linkedTaskIds || []).filter(
                    (id) => id !== linkedTaskId,
                  ),
                  updatedAt: new Date().toISOString(),
                },
                [linkedTaskId]: {
                  ...taskB,
                  linkedTaskIds: (taskB.linkedTaskIds || []).filter(
                    (id) => id !== taskId,
                  ),
                  updatedAt: new Date().toISOString(),
                },
              },
            },
          };
        });
        try {
          const res = await axios.delete(
            `/api/workspaces/tasks/${taskId}/links/${linkedTaskId}`,
            {
              headers: { Authorization: `Bearer ${token}` },
            },
          );
          if (res.data?.activitiesTaskId) {
            get().appendTaskActivities(taskId, res.data.activitiesTaskId);
          }
          if (res.data?.activitiesLinkedTask) {
            get().appendTaskActivities(
              linkedTaskId,
              res.data.activitiesLinkedTask,
            );
          }
          toast.success("Vínculo removido.", {
            message: "Os cards não estão mais relacionados.",
          });
        } catch (e) {
          console.error("Erro ao remover link:", e);
          toast.error("Não foi possível remover o vínculo.", {
            message: "O vínculo continua nos dois cards.",
          });
        }
      },
      updateListVisibility: async (listId, visibility) => {
        if (!canAccessList(get(), listId, "edit")) {
          logPermissionDenied("alterar visibilidade do projeto");
          return;
        }

        const token = useAuthStore.getState().token;
        const list = useTaskStore.getState().graph.lists[listId];
        if (!list) return;

        const previousVisibility = list.visibility;

        set((state) => ({
          graph: {
            ...state.graph,
            lists: {
              ...state.graph.lists,
              [listId]: {
                ...state.graph.lists[listId],
                visibility,
              },
            },
          },
        }));

        try {
          const res = await axios.put(
            `/api/workspaces/lists/${listId}`,
            { visibility },
            { headers: { Authorization: `Bearer ${token}` } },
          );

          const persistedList = res.data?.list;
          if (!persistedList) {
            return;
          }

          set((state) => ({
            graph: {
              ...state.graph,
              lists: {
                ...state.graph.lists,
                [listId]: {
                  ...state.graph.lists[listId],
                  visibility: persistedList.visibility ?? visibility,
                },
              },
            },
          }));
        } catch (e) {
          set((state) => ({
            graph: {
              ...state.graph,
              lists: {
                ...state.graph.lists,
                [listId]: {
                  ...state.graph.lists[listId],
                  visibility: previousVisibility,
                },
              },
            },
          }));
          console.error("Erro ao atualizar visibilidade do projeto:", e);
          toast.error("Não foi possível alterar a visibilidade do projeto.", {
            message: "A visibilidade anterior foi mantida.",
          });
        }
      },
      updateListDates: async (listId, startDate, endDate) => {
        if (!canAccessList(get(), listId, "edit")) {
          logPermissionDenied("editar datas do projeto");
          return;
        }
        const token = useAuthStore.getState().token;
        const list = useTaskStore.getState().graph.lists[listId];
        if (!list) return;

        const previousStartDate = list.startDate ?? null;
        const previousDueDate = list.dueDate ?? null;

        set((state) => ({
          graph: {
            ...state.graph,
            lists: {
              ...state.graph.lists,
              [listId]: {
                ...state.graph.lists[listId],
                startDate,
                dueDate: endDate,
              },
            },
          },
        }));

        try {
          const res = await axios.put(
            `/api/workspaces/lists/${listId}`,
            { startDate, dueDate: endDate },
            { headers: { Authorization: `Bearer ${token}` } },
          );

          const persistedList = res.data?.list;
          if (!persistedList) return;

          set((state) => ({
            graph: {
              ...state.graph,
              lists: {
                ...state.graph.lists,
                [listId]: {
                  ...state.graph.lists[listId],
                  startDate: persistedList.startDate ?? null,
                  dueDate: persistedList.dueDate ?? null,
                },
              },
            },
          }));
        } catch (e) {
          set((state) => ({
            graph: {
              ...state.graph,
              lists: {
                ...state.graph.lists,
                [listId]: {
                  ...state.graph.lists[listId],
                  startDate: previousStartDate,
                  dueDate: previousDueDate,
                },
              },
            },
          }));
          console.error("Erro ao atualizar datas do projeto:", e);
          toast.error("Não foi possível salvar as datas do projeto.", {
            message: "As datas anteriores foram restauradas.",
          });
        }
      },
      toggleListAssignee: async (listId, memberId) => {
        if (!canAccessList(get(), listId, "edit")) {
          logPermissionDenied("alterar responsÃ¡veis do projeto");
          return;
        }
        const token = useAuthStore.getState().token;
        const list = useTaskStore.getState().graph.lists[listId];
        if (!list) return;
        const current = list.assigneeIds || [];
        const exists = current.includes(memberId);
        // Optimistic update
        set((state) => ({
          graph: {
            ...state.graph,
            lists: {
              ...state.graph.lists,
              [listId]: {
                ...state.graph.lists[listId],
                assigneeIds: exists
                  ? current.filter((id) => id !== memberId)
                  : [...current, memberId],
              },
            },
          },
        }));
        try {
          const res = await axios.put(
            `/api/workspaces/lists/${listId}/assignees`,
            { memberId },
            { headers: { Authorization: `Bearer ${token}` } },
          );
          // Sync with server response
          set((state) => ({
            graph: {
              ...state.graph,
              lists: {
                ...state.graph.lists,
                [listId]: {
                  ...state.graph.lists[listId],
                  assigneeIds: res.data.assigneeIds,
                },
              },
            },
          }));
        } catch (e) {
          // Rollback on error
          set((state) => ({
            graph: {
              ...state.graph,
              lists: {
                ...state.graph.lists,
                [listId]: {
                  ...state.graph.lists[listId],
                  assigneeIds: current,
                },
              },
            },
          }));
          console.error("Erro ao atualizar assignee do projeto:", e);
          toast.error(
            "Não foi possível atualizar os responsáveis do projeto.",
            {
              message: "A lista anterior foi restaurada.",
            },
          );
        }
      },
      toggleListTag: async (listId, tag) => {
        if (!canAccessList(get(), listId, "edit")) {
          logPermissionDenied("alterar etiquetas do projeto");
          return;
        }

        const token = useAuthStore.getState().token;
        const list = useTaskStore.getState().graph.lists[listId];
        if (!list) return;

        const current = list.tags || [];
        const exists = current.some((t) => t.id === tag.id);
        const nextTags = exists
          ? current.filter((currentTag) => currentTag.id !== tag.id)
          : [...current, tag];

        set((state) => ({
          graph: {
            ...state.graph,
            lists: {
              ...state.graph.lists,
              [listId]: {
                ...state.graph.lists[listId],
                tags: nextTags,
              },
            },
          },
        }));

        try {
          const res = await axios.put(
            `/api/workspaces/lists/${listId}`,
            { tags: nextTags },
            { headers: { Authorization: `Bearer ${token}` } },
          );

          const persistedTags = res.data?.list?.tags;
          if (!Array.isArray(persistedTags)) {
            return;
          }

          set((state) => ({
            graph: {
              ...state.graph,
              lists: {
                ...state.graph.lists,
                [listId]: {
                  ...state.graph.lists[listId],
                  tags: persistedTags,
                },
              },
            },
          }));
        } catch (e) {
          set((state) => ({
            graph: {
              ...state.graph,
              lists: {
                ...state.graph.lists,
                [listId]: {
                  ...state.graph.lists[listId],
                  tags: current,
                },
              },
            },
          }));
          console.error("Erro ao atualizar etiquetas do projeto:", e);
          toast.error("Não foi possível atualizar as etiquetas do projeto.", {
            message: "As etiquetas anteriores foram mantidas.",
          });
        }
      },
      addList: (input, parentFolderId) =>
        set((state) => {
          if (!canAccessCurrentSelection(state, "edit")) {
            logPermissionDenied("criar projeto");
            return {};
          }
          const newListId = `list_${Math.random().toString(36).slice(2, 10)}`;

          let targetFolderId = parentFolderId;

          if (!targetFolderId) {
            // Fallback: Adding to the first folder of the first space for simplicity in this MVP
            const firstSpaceId = Object.keys(state.graph.spaces)[0];
            const firstSpace = state.graph.spaces[firstSpaceId];
            targetFolderId = firstSpace?.folderIds[0];
          }

          const targetFolder = state.graph.folders[targetFolderId || ""];
          if (!targetFolder) return {};

          return {
            graph: {
              ...state.graph,
              folders: {
                ...state.graph.folders,
                [targetFolderId!]: {
                  ...targetFolder,
                  listIds: [...targetFolder.listIds, newListId],
                },
              },
              lists: {
                ...state.graph.lists,
                [newListId]: {
                  id: newListId,
                  folderId: targetFolderId!,
                  name: input.name || "Novo Projeto",
                  colorClass: "bg-blue-500",
                  taskIds: [],
                  ownerId: state.currentUser,
                  visibility: input.visibility,
                  assigneeIds: Array.from(
                    new Set([state.currentUser, ...(input.assigneeIds || [])]),
                  ),
                  startDate: input.startDate,
                  dueDate: input.dueDate,
                  tags: input.tags,
                },
              },
            },
            selection: {
              ...state.selection,
              listId: newListId,
            },
          };
        }),
      addWorkspace: (input) =>
        set((state) => {
          const workspaceId = `ws_${Math.random().toString(36).slice(2, 10)}`;
          const spaceId = `sp_${Math.random().toString(36).slice(2, 10)}`;
          const folderId = `fld_${Math.random().toString(36).slice(2, 10)}`;
          const defaultListId = `list_${Math.random().toString(36).slice(2, 10)}`;

          return {
            graph: {
              ...state.graph,
              workspaces: {
                ...state.graph.workspaces,
                [workspaceId]: {
                  id: workspaceId,
                  name: input.name,
                  spaceIds: [spaceId],
                  ownerId: state.currentUser,
                  description: input.description,
                  visibility: input.visibility,
                } as any, // Extending type dynamically for ownerId/description
              },
              spaces: {
                ...state.graph.spaces,
                [spaceId]: {
                  id: spaceId,
                  workspaceId,
                  name: "Geral",
                  icon: "ðŸ ",
                  folderIds: [folderId],
                },
              },
              folders: {
                ...state.graph.folders,
                [folderId]: {
                  id: folderId,
                  spaceId,
                  name: "Projetos",
                  listIds: [defaultListId],
                },
              },
              lists: {
                ...state.graph.lists,
                [defaultListId]: {
                  id: defaultListId,
                  folderId,
                  name: "Default",
                  colorClass: "bg-slate-500",
                  taskIds: [],
                  ownerId: state.currentUser,
                  visibility: input.visibility,
                  assigneeIds: [state.currentUser],
                  startDate: null,
                  dueDate: null,
                  tags: [],
                },
              },
            },
            selection: {
              workspaceId,
              spaceId,
              folderId,
              listId: defaultListId,
            },
          };
        }),
      toggleFavoriteList: (listId) => {
        set((state) => ({
          favoriteListIds: state.favoriteListIds.includes(listId)
            ? state.favoriteListIds.filter((id) => id !== listId)
            : [...state.favoriteListIds, listId],
        }));
      },
      updateListName: (listId, name) => {
        set((state) => {
          if (!canAccessList(state, listId, "edit")) {
            logPermissionDenied("renomear projeto");
            return state;
          }
          const list = state.graph.lists[listId];
          if (!list) return state;

          return {
            graph: {
              ...state.graph,
              lists: {
                ...state.graph.lists,
                [listId]: { ...list, name },
              },
            },
          };
        });
      },
      deleteList: (listId) => {
        set((state) => {
          if (!canAccessList(state, listId, "edit")) {
            logPermissionDenied("excluir projeto");
            return state;
          }
          const list = state.graph.lists[listId];
          if (!list) return state;

          const newLists = { ...state.graph.lists };
          delete newLists[listId];

          const newFolders = { ...state.graph.folders };
          if (list.folderId) {
            const folder = newFolders[list.folderId];
            if (folder) {
              newFolders[list.folderId] = {
                ...folder,
                listIds: folder.listIds.filter((id) => id !== listId),
              };
            }
          }

          const isCurrentlySelected = state.selection.listId === listId;

          return {
            graph: {
              ...state.graph,
              lists: newLists,
              folders: newFolders,
            },
            selection: isCurrentlySelected
              ? { ...state.selection, listId: null }
              : state.selection,
            favoriteListIds: state.favoriteListIds.filter(
              (id) => id !== listId,
            ),
          };
        });
      },
      fetchNotifications: async () => {
        const token = useAuthStore.getState().token;
        if (!token) return;
        try {
          const res = await axios.get("/api/notifications", {
            headers: { Authorization: `Bearer ${token}` },
          });
          const mapped = sortNotificationsByNewest(
            res.data.map(normalizeTaskNotification),
          );
          set({ notifications: mapped });
        } catch (error) {
          console.error("Error fetching notifications:", error);
        }
      },
      markNotificationRead: async (id) => {
        const token = useAuthStore.getState().token;
        if (!token) return;
        try {
          await axios.patch(
            `/api/notifications/${id}/read`,
            {},
            {
              headers: { Authorization: `Bearer ${token}` },
            },
          );
          set((state) => ({
            notifications: state.notifications.map((n) =>
              n.id === id ? { ...n, read: true } : n,
            ),
          }));
        } catch (error) {
          console.error("Error marking notification as read:", error);
        }
      },
      markAllNotificationsRead: async () => {
        const token = useAuthStore.getState().token;
        if (!token) return;
        try {
          await axios.patch(
            `/api/notifications/read-all`,
            {},
            {
              headers: { Authorization: `Bearer ${token}` },
            },
          );
          set((state) => ({
            notifications: state.notifications.map((n) => ({
              ...n,
              read: true,
            })),
          }));
        } catch (error) {
          console.error("Error marking all notifications as read:", error);
        }
      },
      addTag: (tag) => {
        if (!tagBelongsToCurrentOrganization(tag)) return;

        set((state) => ({
          graph: {
            ...state.graph,
            tags: { ...state.graph.tags, [tag.id]: tag },
          },
        }));
      },
      updateTag: (tag) => {
        if (!tagBelongsToCurrentOrganization(tag)) return;

        set((state) => ({
          graph: {
            ...state.graph,
            tags: { ...state.graph.tags, [tag.id]: tag },
          },
        }));
      },
      removeTag: (tagId) => {
        set((state) => {
          const newTags = { ...(state.graph.tags as any) };
          delete newTags[tagId];
          return {
            graph: {
              ...state.graph,
              tags: newTags,
            },
          };
        });
      },
      setActiveWorkspace: (workspaceId) =>
        set((state) => ({
          selection: {
            workspaceId,
            spaceId: null,
            folderId: null,
            listId: null,
          },
          ui: { ...state.ui, activePage: "tasks" },
        })),
      addSentEmail: async (email) => {
        const token = useAuthStore.getState().token;
        try {
          const res = await axios.post("/api/emails", email, {
            headers: { Authorization: `Bearer ${token}` },
          });
          const normalizedEmail = normalizeSentEmail(res.data);
          set((state) => ({
            sentEmails: sortEmailsByNewest([
              normalizedEmail,
              ...state.sentEmails.filter(
                (item) => item.id !== normalizedEmail.id,
              ),
            ]),
          }));
        } catch (e) {
          console.error("Erro ao enviar e-mail:", e);
          toast.error("Não foi possível enviar o e-mail.", {
            message: "A mensagem não saiu da caixa de saída.",
          });
        }
      },
      updateEmailLinkDisplayMode: async (emailId, url, mode) => {
        const token = useAuthStore.getState().token;
        const currentEmail = get().sentEmails.find(
          (email) => email.id === emailId,
        );
        if (!currentEmail) return;

        const previousEmails = get().sentEmails;
        const nextLinkDisplayModes = {
          ...(currentEmail.linkDisplayModes ?? {}),
          [url]: mode,
        };

        set((state) => ({
          sentEmails: state.sentEmails.map((email) =>
            email.id === emailId
              ? { ...email, linkDisplayModes: nextLinkDisplayModes }
              : email,
          ),
        }));

        try {
          const res = await axios.patch(
            `/api/emails/${emailId}/link-display-modes`,
            {
              linkDisplayModes: nextLinkDisplayModes,
            },
            {
              headers: { Authorization: `Bearer ${token}` },
            },
          );

          if (res.data) {
            const nextEmail = normalizeSentEmail(res.data);
            set((state) => ({
              sentEmails: sortEmailsByNewest([
                nextEmail,
                ...state.sentEmails.filter(
                  (email) => email.id !== nextEmail.id,
                ),
              ]),
            }));
          }
        } catch (e) {
          console.error("Erro ao atualizar visualização do link do e-mail:", e);
          set({ sentEmails: previousEmails });
        }
      },
      fetchEmails: async () => {
        const token = useAuthStore.getState().token;
        if (!token) return;
        try {
          const res = await axios.get("/api/emails", {
            headers: { Authorization: `Bearer ${token}` },
          });
          const emails = sortEmailsByNewest(res.data.map(normalizeSentEmail));
          set({ sentEmails: emails });
        } catch (e) {
          console.error("Erro ao buscar e-mails:", e);
        }
      },
      markEmailRead: async (id) => {
        const token = useAuthStore.getState().token;
        if (!token) return;
        try {
          await axios.patch(
            `/api/emails/${id}/read`,
            {},
            {
              headers: { Authorization: `Bearer ${token}` },
            },
          );
          set((state) => ({
            sentEmails: state.sentEmails.map((e) =>
              e.id === id ? { ...e, read: true } : e,
            ),
          }));
        } catch (e) {
          console.error("Erro ao marcar e-mail como lido:", e);
        }
      },
      applyRealtimeEvent: (event) => {
        switch (event.type) {
          case "notification.refetch": {
            // Avisa na hora: sem isso, a novidade só apareceria no sininho e
            // quem estivesse trabalhando não perceberia.
            const jaVistas = new Set(get().notifications.map((item) => item.id));
            void get()
              .fetchNotifications()
              .then(() => {
                const novas = get().notifications.filter(
                  (item) => !jaVistas.has(item.id) && !item.read,
                );
                novas.slice(0, 3).forEach((item) => {
                  toast.info(item.title || "Nova notificação", {
                    message: item.message || undefined,
                    duration: 6000,
                  });
                });
              });
            return;
          }
          case "notification.read": {
            set((state) => ({
              notifications: state.notifications.map((notification) =>
                notification.id === event.payload.id
                  ? { ...notification, read: true }
                  : notification,
              ),
            }));
            return;
          }
          case "notification.read_all": {
            set((state) => ({
              notifications: state.notifications.map((notification) => ({
                ...notification,
                read: true,
              })),
            }));
            return;
          }
          case "email.upsert": {
            const nextEmail = normalizeSentEmail(event.payload.email);
            set((state) => ({
              sentEmails: sortEmailsByNewest([
                nextEmail,
                ...state.sentEmails.filter(
                  (email) => email.id !== nextEmail.id,
                ),
              ]),
            }));
            return;
          }
          case "email.read": {
            set((state) => ({
              sentEmails: state.sentEmails.map((email) =>
                email.id === event.payload.id
                  ? { ...email, read: true }
                  : email,
              ),
            }));
            return;
          }
          case "task.created": {
            const nextTask = normalizeTask(event.payload.task);
            if (!nextTask?.id) {
              return;
            }

            set((state) => ({
              graph: mergeTaskIntoGraph(state.graph, nextTask),
            }));
            if (Array.isArray(event.payload.activities)) {
              get().appendTaskActivities(
                nextTask.id,
                event.payload.activities as TaskActivity[],
              );
            }
            return;
          }
          case "task.updated": {
            const nextTask = normalizeTask(event.payload.task);
            if (!nextTask?.id) {
              return;
            }

            set((state) => ({
              graph: mergeTaskIntoGraph(state.graph, nextTask),
            }));
            if (Array.isArray(event.payload.activities)) {
              get().appendTaskActivities(
                nextTask.id,
                event.payload.activities as TaskActivity[],
              );
            }
            return;
          }
          case "comment.created": {
            const taskId = event.payload.taskId;
            const nextComment = normalizeTaskComment(event.payload.comment);
            if (!taskId || !nextComment.id) {
              return;
            }

            set((state) => {
              const existingComments = state.commentsByTaskId[taskId] ?? [];
              if (
                existingComments.some(
                  (comment) => comment.id === nextComment.id,
                )
              ) {
                return state;
              }

              return {
                commentsByTaskId: {
                  ...state.commentsByTaskId,
                  [taskId]: sortCommentsByNewest([
                    nextComment,
                    ...existingComments,
                  ]),
                },
              };
            });
            if (Array.isArray(event.payload.activities)) {
              get().appendTaskActivities(
                taskId,
                event.payload.activities as TaskActivity[],
              );
            }
            return;
          }
          case "comment.updated": {
            const taskId = event.payload.taskId;
            const rawComment = event.payload.comment as Record<string, unknown>;
            const commentId =
              typeof rawComment?.id === "string" ? rawComment.id : null;
            if (!taskId || !commentId) {
              return;
            }

            set((state) => ({
              commentsByTaskId: {
                ...state.commentsByTaskId,
                [taskId]: (state.commentsByTaskId[taskId] ?? []).map(
                  (comment) =>
                    comment.id === commentId
                      ? {
                          ...comment,
                          ...(rawComment.content !== undefined
                            ? { content: String(rawComment.content ?? "") }
                            : {}),
                          ...(rawComment.editedAt !== undefined ||
                          rawComment.edited_at !== undefined
                            ? {
                                editedAt:
                                  (rawComment.editedAt as string | undefined) ??
                                  (rawComment.edited_at as string | undefined),
                              }
                            : {}),
                          likedByMe:
                            rawComment.likedByMe === undefined &&
                            rawComment.liked_by_me === undefined
                              ? comment.likedByMe
                              : ((rawComment.likedByMe as
                                  boolean | undefined) ??
                                (rawComment.liked_by_me as
                                  boolean | undefined)),
                          linkDisplayModes:
                            rawComment.linkDisplayModes === undefined &&
                            rawComment.link_display_modes === undefined
                              ? comment.linkDisplayModes
                              : ((rawComment.linkDisplayModes ??
                                  rawComment.link_display_modes) as
                                  Record<string, LinkDisplayMode> | undefined),
                          reaction:
                            rawComment.reaction === undefined
                              ? comment.reaction
                              : (rawComment.reaction as string | null),
                        }
                      : comment,
                ),
              },
            }));
            if (Array.isArray(event.payload.activities)) {
              get().appendTaskActivities(
                taskId,
                event.payload.activities as TaskActivity[],
              );
            }
            return;
          }
          case "presence.updated": {
            const workspaceId = event.payload.workspaceId;
            if (!workspaceId) {
              return;
            }

            set((state) => ({
              presenceByWorkspaceId: {
                ...state.presenceByWorkspaceId,
                [workspaceId]: Array.isArray(event.payload.userIds)
                  ? Array.from(
                      new Set(
                        event.payload.userIds.filter(
                          (userId): userId is string =>
                            typeof userId === "string" &&
                            userId.trim().length > 0,
                        ),
                      ),
                    )
                  : [],
              },
            }));
            return;
          }
          default:
            return;
        }
      },
      reset: () =>
        set({
          graph: emptyGraph,
          selection: defaultSelection,
          filters: defaultFilters,
          ui: defaultUi,
          commentsByTaskId: {},
          presenceByWorkspaceId: {},
          favoriteListIds: [],
          currentUser: "",
          notifications: [],
          seedInitialized: false,
          // taskSortOrders Ã© preservado intencionalmente para que
          // hydrateFromSeed possa mesclar com os valores do backend
        }),
    }),
    {
      name: "pauta-task-store-v11",
      // O quadro inteiro não cabe no armazenamento do navegador (no celular o
      // limite é de poucos megabytes): guardamos só a navegação e as
      // preferências; os dados vêm do servidor a cada abertura.
      storage: createJSONStorage(() => createSafeStorage(["pauta-task-store-v10"])),
      merge: (persistedState, currentState) => {
        const typedState = persistedState as Partial<TaskStoreState>;

        return {
          ...currentState,
          ...typedState,
          filters: {
            ...currentState.filters,
            ...(typedState.filters || {}),
          },
        };
      },
      partialize: (state) => ({
        selection: state.selection,
        filters: state.filters,
        ui: state.ui,
        favoriteListIds: state.favoriteListIds,
        taskSortOrders: state.taskSortOrders,
      }),
    },
  ),
);
