import type {
  CustomFieldDefinition,
  CustomFieldValue,
  EntityId,
  Task,
  TaskFilters,
  WorkspaceGraph,
} from "../types/tasks";

function stripHtml(value?: string | null) {
  return (value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function getWorkspaceIdFromList(
  graph: WorkspaceGraph,
  listId: EntityId | null | undefined,
) {
  if (!listId) return null;

  const list = graph.lists[listId];
  if (!list) return null;

  const folder = graph.folders[list.folderId];
  if (!folder) return null;

  const space = graph.spaces[folder.spaceId];
  if (!space) return null;

  return space.workspaceId;
}

export function getWorkspaceCustomFields(
  graph: WorkspaceGraph,
  workspaceId: EntityId | null | undefined,
) {
  if (!workspaceId) {
    return [] as CustomFieldDefinition[];
  }

  const workspace = graph.workspaces[workspaceId];
  const fieldIds = workspace?.customFieldIds || [];
  const fields = fieldIds.length
    ? fieldIds
        .map((fieldId) => graph.customFieldDefinitions[fieldId])
        .filter(Boolean)
    : Object.values(graph.customFieldDefinitions).filter(
        (field) => field.workspaceId === workspaceId,
      );

  return fields.sort((left, right) => {
    if (left.displayOrder !== right.displayOrder) {
      return left.displayOrder - right.displayOrder;
    }

    return left.name.localeCompare(right.name, "pt-BR");
  });
}

export function encodeCustomFieldFilterValue(
  field: CustomFieldDefinition,
  rawValue: CustomFieldValue | undefined,
) {
  if (rawValue === null || rawValue === undefined || rawValue === "") {
    return null;
  }

  if (field.type === "single_select") {
    return String(rawValue);
  }

  if (field.type === "checkbox") {
    return rawValue ? "true" : "false";
  }

  if (field.type === "date") {
    return String(rawValue).slice(0, 10);
  }

  return String(rawValue).trim();
}

export function formatCustomFieldFilterLabel(
  field: CustomFieldDefinition,
  rawValue: CustomFieldValue | undefined,
) {
  const encodedValue = encodeCustomFieldFilterValue(field, rawValue);
  if (!encodedValue) {
    return null;
  }

  if (field.type === "single_select") {
    return (
      field.options.find((option) => option.id === encodedValue)?.label ||
      encodedValue
    );
  }

  if (field.type === "checkbox") {
    return encodedValue === "true" ? "Marcado" : "Desmarcado";
  }

  return encodedValue;
}

export function getCustomFieldFilterOptions(
  tasks: Task[],
  field: CustomFieldDefinition | undefined,
) {
  if (!field) {
    return [] as Array<{ value: string; label: string; count: number }>;
  }

  const valueMap = new Map<string, { label: string; count: number }>();

  tasks.forEach((task) => {
    const rawValue = task.customFieldValues?.[field.id];
    const encodedValue = encodeCustomFieldFilterValue(field, rawValue);
    const label = formatCustomFieldFilterLabel(field, rawValue);

    if (!encodedValue || !label) {
      return;
    }

    const current = valueMap.get(encodedValue);
    valueMap.set(encodedValue, {
      label,
      count: (current?.count || 0) + 1,
    });
  });

  return Array.from(valueMap.entries())
    .map(([value, meta]) => ({ value, label: meta.label, count: meta.count }))
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }

      return left.label.localeCompare(right.label, "pt-BR");
    });
}

export function taskMatchesFilters(
  task: Task,
  graph: WorkspaceGraph,
  filters: TaskFilters,
  currentUserId?: string | null,
) {
  if (filters.statusId !== "all" && task.statusId !== filters.statusId) {
    return false;
  }

  if (filters.priority !== "all" && task.priority !== filters.priority) {
    return false;
  }

  if (
    filters.assignedToMeOnly &&
    (!currentUserId || !task.assigneeIds.includes(currentUserId))
  ) {
    return false;
  }

  if (filters.customFieldId !== "all") {
    const field = graph.customFieldDefinitions[filters.customFieldId];
    if (!field) {
      return false;
    }

    const encodedValue = encodeCustomFieldFilterValue(
      field,
      task.customFieldValues?.[field.id],
    );

    if (filters.customFieldValue === "all") {
      if (!encodedValue) {
        return false;
      }
    } else if (encodedValue !== filters.customFieldValue) {
      return false;
    }
  }

  const normalizedSearch = filters.search.trim().toLowerCase();
  if (!normalizedSearch) {
    return true;
  }

  const searchValues = [task.title, stripHtml(task.description?.value)];

  if (task.customFieldValues) {
    Object.entries(task.customFieldValues).forEach(([fieldId, value]) => {
      const field = graph.customFieldDefinitions[fieldId];
      if (!field) return;

      const label = formatCustomFieldFilterLabel(field, value);
      if (label) {
        searchValues.push(field.name, label);
      }
    });
  }

  return searchValues.some((value) =>
    String(value || "")
      .toLowerCase()
      .includes(normalizedSearch),
  );
}
