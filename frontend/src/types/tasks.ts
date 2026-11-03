export type EntityId = string;
export type LinkDisplayMode = "preview" | "inline" | "url";

export const TASK_PRIORITY_VALUES = [
  "urgent",
  "high",
  "medium",
  "low",
] as const;
export type TaskPriority = (typeof TASK_PRIORITY_VALUES)[number];

export const TASK_VIEW_VALUES = [
  "board",
  "list",
  "calendar",
  "table",
  "timeline",
] as const;
export type TaskViewMode = (typeof TASK_VIEW_VALUES)[number];

export type TaskStatusFilter = "all" | EntityId;
export type TaskPriorityFilter = "all" | TaskPriority;

export type CustomFieldType =
  | "text"
  | "number"
  | "date"
  | "checkbox"
  | "single_select";

export type CustomFieldValue = string | number | boolean | null;

export interface CustomFieldOption {
  id: string;
  label: string;
  color?: string | null;
}

export interface CustomFieldDefinition {
  id: EntityId;
  workspaceId: EntityId;
  name: string;
  type: CustomFieldType;
  required: boolean;
  options: CustomFieldOption[];
  defaultValue?: CustomFieldValue;
  displayOrder: number;
  visibleOnDashboard: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface TaskComment {
  id: EntityId;
  taskId: EntityId;
  authorName: string;
  content: string;
  createdAt: string;
  parentId?: string;
  editedAt?: string;
  attachment?: TaskAttachment;
  mentionIds?: EntityId[];
  linkDisplayModes?: Record<string, LinkDisplayMode>;
  likedByMe?: boolean;
  reaction?: string | null;
}

export interface TaskTag {
  id: string;
  name: string;
  color: string;
  organizationId?: string;
}

export interface TaskActivity {
  id: string;
  type: string;
  date: string;
  content: string;
  authorId?: EntityId | null;
  authorName?: string | null;
  description?: string | null;
}

export interface Member {
  id: EntityId;
  name: string;
  /** Cargo (texto livre). A permissão está em accessRole. */
  role: string;
  accessRole?: "owner" | "admin" | "member";
  email?: string;
  avatarColor: string;
  avatarUrl?: string;
  tags?: TaskTag[];
  tagIds?: EntityId[];
}

export interface RichTextContent {
  format: "html";
  value: string;
}

export interface TaskStatusDefinition {
  id: EntityId;
  name: string;
  colorClass: string;
  chipClass: string;
  dotClass: string;
  order: number;
  /** null/undefined = coluna global (padrão); senão coluna específica de uma lista/projeto */
  listId?: EntityId | null;
  /** Listas/projetos onde esta coluna global foi "forkada" e deve ser ocultada. */
  hiddenListIds?: EntityId[];
}

export type EntityVisibility = "public" | "private" | "admin_private";

export type WorkspacePermissionLevel =
  | "Edição total"
  | "Editar"
  | "Comentário"
  | "Apenas exibição";

export interface Workspace {
  id: EntityId;
  name: string;
  description?: string;
  color?: string;
  visibility?: EntityVisibility;
  ownerId?: EntityId;
  icon?: string;
  createdAt?: string;
  defaultPermissionLevel?: WorkspacePermissionLevel;
  currentPermissionLevel?: WorkspacePermissionLevel;
  sharedMemberIds?: EntityId[];
  spaceIds: EntityId[];
  customFieldIds?: EntityId[];
  tags?: TaskTag[];
}

export interface Space {
  id: EntityId;
  workspaceId: EntityId;
  name: string;
  icon: string;
  createdAt?: string;
  folderIds: EntityId[];
}

export interface Folder {
  id: EntityId;
  spaceId: EntityId;
  name: string;
  createdAt?: string;
  listIds: EntityId[];
}

export interface TaskList {
  id: EntityId;
  folderId: EntityId;
  name: string;
  colorClass: string;
  color?: string;
  taskIds: EntityId[];
  ownerId?: EntityId;
  visibility?: EntityVisibility;
  currentPermissionLevel?: WorkspacePermissionLevel;
  assigneeIds?: EntityId[];
  startDate?: string | null;
  dueDate?: string | null;
  createdAt?: string;
  tags?: TaskTag[];
}

export interface ChecklistItem {
  id: string;
  label: string;
  done: boolean;
  assigneeIds: string[];
}

export interface Checklist {
  id: string;
  name: string;
  items: ChecklistItem[];
}

export interface TaskAttachment {
  id: string;
  name: string;
  url: string;
  type:
    | "image"
    | "document"
    | "video"
    | "spreadsheet"
    | "archive"
    | "powerpoint";
  size: number;
  createdAt: string;
  uploadedById?: string | null;
  uploadedByName?: string | null;
  uploadedByAvatarColor?: string | null;
  uploadedByAvatarUrl?: string | null;
}

export interface Task {
  id: EntityId;
  workspaceId: EntityId;
  spaceId: EntityId;
  folderId: EntityId;
  listId: EntityId;
  ownerId?: EntityId;
  visibility?: EntityVisibility;
  title: string;
  description: RichTextContent;
  descriptionLinkDisplayModes?: Record<string, LinkDisplayMode>;
  statusId: EntityId;
  priority: TaskPriority;
  startDate?: string | null;
  dueDate: string | null;
  estimate?: string | null;
  assigneeIds: EntityId[];
  watcherIds?: EntityId[];
  currentPermissionLevel?: WorkspacePermissionLevel;
  tags?: TaskTag[];
  activities?: TaskActivity[];
  createdAt: string;
  updatedAt: string;
  checklists?: Checklist[];
  attachments?: TaskAttachment[];
  customFieldValues?: Record<EntityId, CustomFieldValue>;
  coverAttachmentId?: string | null;
  parentTaskId?: EntityId;
  subtaskIds?: EntityId[];
  linkedTaskIds?: EntityId[];
  sortOrder?: number;
}

export interface WorkspaceGraph {
  workspaces: Record<EntityId, Workspace>;
  spaces: Record<EntityId, Space>;
  folders: Record<EntityId, Folder>;
  lists: Record<EntityId, TaskList>;
  tasks: Record<EntityId, Task>;
  members: Record<EntityId, Member>;
  statusDefinitions: TaskStatusDefinition[];
  tags: Record<EntityId, TaskTag>;
  customFieldDefinitions: Record<EntityId, CustomFieldDefinition>;
}

export interface HierarchySelection {
  workspaceId: EntityId | null;
  spaceId: EntityId | null;
  folderId: EntityId | null;
  listId: EntityId | null;
}

export interface TaskFilters {
  search: string;
  statusId: TaskStatusFilter;
  priority: TaskPriorityFilter;
  assignedToMeOnly: boolean;
  customFieldId: EntityId | "all";
  customFieldValue: string | "all";
}

export interface TaskUiState {
  sidebarCollapsed: boolean;
  activeView: TaskViewMode;
  activeTaskIdForDetails: EntityId | null;
  taskHistory: EntityId[];
  activePage?: "home" | "tasks" | "members" | "settings" | "trash" | "calendar" | "reports" | "help";
}

export interface TaskSeedData {
  graph: WorkspaceGraph;
  selection: HierarchySelection;
  commentsByTaskId?: Record<EntityId, TaskComment[]>;
}

export interface CreateTaskInput {
  listId?: EntityId;
  title: string;
  descriptionText: string;
  statusId: EntityId;
  priority: TaskPriority;
  visibility?: EntityVisibility;
  startDate?: string | null;
  dueDate: string | null;
  estimate?: string | null;
  assigneeIds: EntityId[];
  tags?: TaskTag[];
  customFieldValues?: Record<EntityId, CustomFieldValue>;
}
