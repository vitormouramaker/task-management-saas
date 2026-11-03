/**
 * Lista de verificação dos cards: item arrastável e o editor em linha.
 *
 * Saiu da tela de detalhes do card, que tinha tudo num arquivo só.
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { Check, GripVertical, Plus, Trash2 } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { cn } from "../../../lib/utils";
import { renderTextWithMentionsAndLinks } from "../../../lib/task-mentions";
import { stripLinkUrlsFromText } from "../../../lib/link-preview";
import { getLinkClassName, getMentionChipClassName } from "./task-text-and-links";
import type { EntityId, Member } from "../../../types/tasks";

/** Prefixo que marca o item não concluído no texto do card. */
export const CHECKLIST_UNCHECKED_PREFIX = "☐ ";

export interface SortableChecklistItemProps {
  item: any;
  taskId: EntityId;
  checklistId: string;
  onToggle: (taskId: EntityId, clId: string, itemId: string) => void;
  onUpdateLabel: (
    taskId: EntityId,
    clId: string,
    itemId: string,
    label: string,
  ) => void;
  onDelete: (
    taskId: EntityId,
    clId: string,
    itemId: string,
    label: string,
  ) => void;
  onSetAssignee: (
    taskId: EntityId,
    clId: string,
    itemId: string,
    mId: string,
  ) => void;
  members: any;
  isEditing: boolean;
  onStartEditing: () => void;
  onStopEditing: () => void;
  itemAssigneeMenuOpen: string | null;
  setItemAssigneeMenuOpen: (id: string | null) => void;
  canEditContent: boolean;
  canManageAssignees: boolean;
  canReorder: boolean;
}

export function SortableChecklistItem({
  item,
  taskId,
  checklistId,
  onToggle,
  onUpdateLabel,
  onDelete,
  onSetAssignee,
  members,
  isEditing,
  onStartEditing,
  onStopEditing,
  itemAssigneeMenuOpen,
  setItemAssigneeMenuOpen,
  canEditContent,
  canManageAssignees,
  canReorder,
}: SortableChecklistItemProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (
        itemAssigneeMenuOpen === item.id &&
        menuRef.current &&
        !menuRef.current.contains(e.target as Node)
      ) {
        setItemAssigneeMenuOpen(null);
      }
    };
    if (itemAssigneeMenuOpen === item.id) {
      document.addEventListener("mousedown", handleClick);
    }
    return () => document.removeEventListener("mousedown", handleClick);
  }, [itemAssigneeMenuOpen, item.id, setItemAssigneeMenuOpen]);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id, disabled: !canReorder });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
  };

  const [draftLabel, setDraftLabel] = useState(item.label);
  const assignees = (item.assigneeIds ?? [])
    .map((id: string) => members[id])
    .filter(Boolean);

  useEffect(() => {
    setDraftLabel(item.label);
  }, [item.label]);

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        "group/cli flex items-center gap-1.5 py-1.5 pl-2 pr-2 rounded-lg transition-colors cursor-pointer",
        "hover:bg-(--ui-fundo-sutil)",
      )}
    >
      {/* Drag Handle */}
      <div
        {...(canReorder ? attributes : {})}
        {...(canReorder ? listeners : {})}
        className={cn(
          "p-1 -ml-1",
          canReorder
            ? "cursor-grab active:cursor-grabbing"
            : "cursor-not-allowed opacity-50",
          "text-(--ui-texto-apagado) hover:text-(--ui-texto-forte)",
        )}
      >
        <GripVertical className="h-3.5 w-3.5" />
      </div>

      {/* Checkbox */}
      <button
        type="button"
        onClick={() => {
          if (!canEditContent) return;
          onToggle(taskId, checklistId, item.id);
        }}
        className={cn(
          "flex h-4 w-4 shrink-0 items-center justify-center rounded border-2 transition cursor-pointer",
          !canEditContent && "cursor-not-allowed opacity-60",
          item.done
            ? "border-emerald-500 bg-emerald-500 text-white"
            : "border-(--ui-borda-forte) bg-(--ui-superficie-suave) hover:border-blue-400",
        )}
      >
        {item.done && <Check className="h-2.5 w-2.5" />}
      </button>

      {/* Label / Edit Input */}
      {isEditing ? (
        <input aria-label="Nome do campo"
          autoFocus
          value={draftLabel}
          onChange={(e) => setDraftLabel(e.target.value)}
          onBlur={() => {
            if (draftLabel.trim())
              onUpdateLabel(taskId, checklistId, item.id, draftLabel.trim());
            onStopEditing();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              if (draftLabel.trim())
                onUpdateLabel(taskId, checklistId, item.id, draftLabel.trim());
              onStopEditing();
            }
            if (e.key === "Escape") {
              setDraftLabel(item.label);
              onStopEditing();
            }
          }}
          className={cn(
            "flex-1 rounded border border-blue-400 px-1.5 py-0.5 text-[13px] outline-none",
            "bg-(--ui-superficie) text-(--ui-texto-forte)",
          )}
          disabled={!canEditContent}
        />
      ) : (
        <span
          onClick={() => {
            if (!canEditContent) return;
            onStartEditing();
          }}
          className={cn(
            "flex-1 text-[13px] select-none",
            canEditContent && "cursor-text",
            "text-(--ui-texto-item)",
            item.done &&
              ("line-through text-(--ui-texto-secundario)"),
          )}
        >
          {item.label}
        </span>
      )}

      {/* Avatares dos atribuí­dos */}
      <div className="relative flex items-center">
        <div className="flex -space-x-1">
          {assignees.map((m: any) => (
            <span
              key={m.id}
              title={m.name}
              className={cn(
                "flex h-5 w-5 items-center justify-center rounded-full border-2 text-[9px] font-bold text-white",
                "border-(--ui-superficie)",
                m.avatarColor,
              )}
            >
              {m.name
                .split(" ")
                .map((n: any) => n[0])
                .join("")}
            </span>
          ))}
        </div>

        <button
          type="button"
          onClick={() => {
            if (!canManageAssignees) return;
            setItemAssigneeMenuOpen(
              itemAssigneeMenuOpen === item.id ? null : item.id,
            );
          }}
          className={cn(
            "opacity-0 group-hover/cli:opacity-100 ml-1 flex h-5 w-5 items-center justify-center rounded-full border-2 border-dashed cursor-pointer transition",
            !canManageAssignees &&
              "cursor-not-allowed opacity-50 group-hover/cli:opacity-50",
            "border-(--ui-borda-forte) text-(--ui-texto-secundario) hover:border-blue-400 hover:text-(--ui-azul-texto)",
          )}
          title="Atribuir"
        >
          <Plus className="h-2.5 w-2.5" />
        </button>

        {itemAssigneeMenuOpen === item.id && (
          <div
            ref={menuRef}
            className={cn(
              "absolute right-0 bottom-[calc(100%+6px)] z-100 w-48 rounded-xl border p-1.5 animate-in fade-in zoom-in-95 duration-200",
              "pauta-theme-menu",
            )}
          >
            {Object.values(members).map((m: any) => {
              const isSelected = (item.assigneeIds ?? []).includes(m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() =>
                    onSetAssignee(taskId, checklistId, item.id, m.id)
                  }
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[12px] cursor-pointer transition",
                    isSelected
                      ? "bg-(--ui-azul-fundo) text-(--ui-azul-texto)"
                      : "hover:bg-(--ui-hover) text-(--ui-texto-item)",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white",
                      m.avatarColor,
                    )}
                  >
                    {m.name
                      .split(" ")
                      .map((n: any) => n[0])
                      .join("")}
                  </span>
                  <span className="flex-1">{m.name}</span>
                  {isSelected && <Check className="h-3 w-3 text-blue-500" />}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={() => {
          if (!canEditContent) return;
          onDelete(taskId, checklistId, item.id, item.label);
        }}
        className={cn(
          "transition p-1",
          canEditContent
            ? "opacity-0 group-hover/cli:opacity-100 cursor-pointer"
            : "opacity-40 cursor-not-allowed",
          "text-(--ui-texto-apagado) hover:text-(--ui-rose-texto)",
        )}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </li>
  );
}

const INLINE_CHECKLIST_MARKER = "::pauta-checklist::";

export function getChecklistLineInsertion(
  value: string,
  selectionStart: number | null,
  selectionEnd: number | null,
) {
  if (
    selectionStart === null ||
    selectionEnd === null ||
    selectionStart !== selectionEnd
  ) {
    return null;
  }

  const lineStart = value.lastIndexOf("\n", selectionStart - 1) + 1;
  const nextLineBreak = value.indexOf("\n", selectionStart);
  const lineEnd = nextLineBreak === -1 ? value.length : nextLineBreak;
  const line = value.slice(lineStart, lineEnd);
  const checklistMatch = line.match(/^(\s*)([☐☑])\s?(.*)$/);

  if (!checklistMatch) {
    return null;
  }

  const indent = checklistMatch[1] ?? "";
  const content = checklistMatch[3] ?? "";
  const insertText =
    content.trim().length === 0
      ? "\n"
      : `\n${indent}${CHECKLIST_UNCHECKED_PREFIX}`;

  return {
    text:
      value.slice(0, selectionStart) + insertText + value.slice(selectionEnd),
    cursorPosition: selectionStart + insertText.length,
  };
}

export interface InlineChecklistItemState {
  checked: boolean;
  label: string;
  indent: string;
}

export interface InlineChecklistState {
  items: InlineChecklistItemState[];
  trailingText: string;
}

export function parseInlineChecklistText(value: string): InlineChecklistState | null {
  const normalizedValue = value.replace(/\r\n/g, "\n");
  const lines = normalizedValue.split("\n");
  let currentIndex = 0;

  if (lines[0]?.startsWith(INLINE_CHECKLIST_MARKER)) {
    currentIndex = 1;
  }

  const items: InlineChecklistItemState[] = [];
  let trailingStartIndex = -1;

  for (; currentIndex < lines.length; currentIndex += 1) {
    const line = lines[currentIndex];
    const match = line.match(/^(\s*)([☐☑])\s?(.*)$/);

    if (match) {
      items.push({
        indent: match[1] ?? "",
        checked: match[2] === "☑",
        label: match[3] ?? "",
      });
      continue;
    }

    if (line.trim().length === 0) {
      trailingStartIndex = currentIndex + 1;
      break;
    }

    if (items.length === 0) {
      return null;
    }

    trailingStartIndex = currentIndex;
    break;
  }

  if (items.length === 0) {
    return null;
  }

  return {
    items,
    trailingText:
      trailingStartIndex === -1
        ? ""
        : lines.slice(trailingStartIndex).join("\n"),
  };
}

export function serializeInlineChecklistState(state: InlineChecklistState) {
  const items = state.items
    .map(
      (item) =>
        `${item.indent}${item.checked ? "☑" : "☐"} ${item.label.trimEnd()}`,
    )
    .join("\n");

  if (!state.trailingText.length) {
    return items;
  }

  return `${items}\n\n${state.trailingText}`;
}

export function updateInlineChecklistText(
  value: string,
  updater: (state: InlineChecklistState) => InlineChecklistState,
) {
  const parsedState = parseInlineChecklistText(value);
  if (!parsedState) {
    return value;
  }

  return serializeInlineChecklistState(updater(parsedState));
}

export function getInlineChecklistTrailingCursorPosition(
  value: string,
  absoluteCursorPosition: number,
) {
  const checklist = parseInlineChecklistText(value);
  if (!checklist) {
    return absoluteCursorPosition;
  }

  const trailingOffset = `${serializeInlineChecklistState({
    ...checklist,
    trailingText: "",
  })}\n\n`.length;

  return Math.max(0, absoluteCursorPosition - trailingOffset);
}

export function InlineChecklistEditor({
  value,
  isDarkMode,
  readOnly,
  onChange,
  onExitToText,
  trailingTextareaExternalRef,
  onTrailingTextCursorChange,
  onMentionReset,
}: {
  value: string;
  isDarkMode: boolean;
  readOnly?: boolean;
  onChange: (nextValue: string) => void;
  onExitToText?: (nextText: string) => void;
  trailingTextareaExternalRef?: RefObject<HTMLTextAreaElement | null>;
  onTrailingTextCursorChange?: (
    text: string,
    cursorPosition: number | null | undefined,
    textarea: HTMLTextAreaElement | null,
    absoluteOffset: number,
  ) => void;
  onMentionReset?: () => void;
}) {
  const checklist = parseInlineChecklistText(value);
  const [isTrailingTextVisible, setIsTrailingTextVisible] = useState(() =>
    Boolean(checklist?.trailingText.length),
  );
  const itemInputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const trailingTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const pendingFocusRef = useRef<
    | { type: "item"; index: number; cursor: "start" | "end" }
    | { type: "trailing"; cursor: number }
    | { type: "text"; value: string }
    | null
  >(null);

  const resizeTrailingTextarea = useCallback(
    (textarea?: HTMLTextAreaElement | null) => {
      const element = textarea ?? trailingTextareaRef.current;
      if (!element) {
        return;
      }

      element.style.height = "auto";
      element.style.height = `${element.scrollHeight}px`;
      element.style.overflowY = "hidden";
    },
    [],
  );

  useEffect(() => {
    if (checklist?.trailingText.length) {
      setIsTrailingTextVisible(true);
    }
  }, [checklist?.trailingText.length]);

  useEffect(() => {
    if (!isTrailingTextVisible && !checklist?.trailingText.length) {
      return;
    }

    resizeTrailingTextarea();
  }, [checklist?.trailingText, isTrailingTextVisible, resizeTrailingTextarea]);

  useEffect(() => {
    const pendingFocus = pendingFocusRef.current;
    if (!pendingFocus) {
      return;
    }

    if (pendingFocus.type === "item") {
      const input = itemInputRefs.current[pendingFocus.index];
      if (input) {
        input.focus();
        const cursorPosition =
          pendingFocus.cursor === "end" ? input.value.length : 0;
        input.setSelectionRange(cursorPosition, cursorPosition);
      }
    }

    if (pendingFocus.type === "trailing") {
      const textarea = trailingTextareaRef.current;
      if (textarea) {
        textarea.focus();
        textarea.setSelectionRange(pendingFocus.cursor, pendingFocus.cursor);
      }
    }

    if (pendingFocus.type === "text") {
      onExitToText?.(pendingFocus.value);
    }

    pendingFocusRef.current = null;
  }, [checklist, onExitToText]);

  if (!checklist || checklist.items.length === 0) {
    return null;
  }

  const trailingTextOffset = `${serializeInlineChecklistState({
    ...checklist,
    trailingText: "",
  })}\n\n`.length;

  return (
    <div className="space-y-1 px-4 py-3">
      {checklist.items.map((item, index) => (
        <div
          key={`inline-checklist-editor-${index}`}
          className="group flex items-center gap-2"
        >
          <button
            type="button"
            onClick={() => {
              if (readOnly) return;
              onChange(
                updateInlineChecklistText(value, (currentState) => ({
                  ...currentState,
                  items: currentState.items.map((currentItem, currentIndex) =>
                    currentIndex === index
                      ? { ...currentItem, checked: !currentItem.checked }
                      : currentItem,
                  ),
                })),
              );
            }}
            className={cn(
              "flex h-4 w-4 shrink-0 items-center justify-center rounded border-2 transition cursor-pointer",
              readOnly && "cursor-default",
              item.checked
                ? "border-emerald-500 bg-emerald-500 text-white"
                : "border-(--ui-borda-forte) bg-(--ui-superficie-suave) hover:border-blue-400",
            )}
          >
            {item.checked && <Check className="h-2.5 w-2.5" />}
          </button>

          <input aria-label="Item do checklist"
            ref={(node) => {
              itemInputRefs.current[index] = node;
            }}
            onFocus={() => onMentionReset?.()}
            autoFocus={
              index === checklist.items.length - 1 &&
              item.label.length === 0 &&
              !checklist.trailingText.length
            }
            value={item.label}
            onChange={(event) => {
              if (readOnly) return;
              onChange(
                updateInlineChecklistText(value, (currentState) => ({
                  ...currentState,
                  items: currentState.items.map((currentItem, currentIndex) =>
                    currentIndex === index
                      ? { ...currentItem, label: event.target.value }
                      : currentItem,
                  ),
                })),
              );
            }}
            onKeyDown={(event) => {
              if (readOnly) return;

              if (event.key === "Enter") {
                event.preventDefault();

                if (event.currentTarget.value.trim().length === 0) {
                  const nextText = updateInlineChecklistText(
                    value,
                    (currentState) => ({
                      ...currentState,
                      items: currentState.items.filter(
                        (_, currentIndex) => currentIndex !== index,
                      ),
                    }),
                  );
                  const nextState = parseInlineChecklistText(nextText);

                  if (!nextState || nextState.items.length === 0) {
                    pendingFocusRef.current = {
                      type: "text",
                      value: checklist.trailingText,
                    };
                    onChange(checklist.trailingText);
                    return;
                  }

                  setIsTrailingTextVisible(true);
                  pendingFocusRef.current = {
                    type: "trailing",
                    cursor: 0,
                  };
                  onChange(nextText);
                  return;
                }

                pendingFocusRef.current = {
                  type: "item",
                  index: index + 1,
                  cursor: "start",
                };
                onChange(
                  updateInlineChecklistText(value, (currentState) => {
                    const nextItems = [...currentState.items];
                    nextItems.splice(index + 1, 0, {
                      checked: false,
                      label: "",
                      indent: currentState.items[index]?.indent ?? "",
                    });
                    return {
                      ...currentState,
                      items: nextItems,
                    };
                  }),
                );
                return;
              }

              if (
                event.key === "Backspace" &&
                event.currentTarget.value.length === 0
              ) {
                event.preventDefault();

                if (checklist.items.length === 1) {
                  pendingFocusRef.current = {
                    type: "text",
                    value: checklist.trailingText,
                  };
                  onChange(checklist.trailingText);
                  return;
                }

                const nextIndex = index > 0 ? index - 1 : 0;
                pendingFocusRef.current = {
                  type: "item",
                  index: nextIndex,
                  cursor: "end",
                };
                onChange(
                  updateInlineChecklistText(value, (currentState) => ({
                    ...currentState,
                    items: currentState.items.filter(
                      (_, currentIndex) => currentIndex !== index,
                    ),
                  })),
                );
              }
            }}
            readOnly={readOnly}
            className={cn(
              "min-w-0 flex-1 bg-transparent text-sm outline-none",
              item.checked && "line-through",
              isDarkMode
                ? item.checked
                  ? "text-(--text-soft)"
                  : "text-(--text-main)"
                : item.checked
                  ? "text-slate-500"
                  : "text-slate-700",
            )}
          />

          {!readOnly && checklist.items.length > 1 && (
            <button
              type="button"
              onClick={() => {
                const nextIndex = index > 0 ? index - 1 : 0;
                pendingFocusRef.current = {
                  type: "item",
                  index: nextIndex,
                  cursor: "end",
                };
                onChange(
                  updateInlineChecklistText(value, (currentState) => ({
                    ...currentState,
                    items: currentState.items.filter(
                      (_, currentIndex) => currentIndex !== index,
                    ),
                  })),
                );
              }}
              className={cn(
                "opacity-0 transition group-hover:opacity-100",
                "text-(--ui-texto-apagado) hover:text-(--ui-rose-texto)",
              )}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      ))}

      {!readOnly && (
        <button
          type="button"
          onClick={() => {
            pendingFocusRef.current = {
              type: "item",
              index: checklist.items.length,
              cursor: "start",
            };
            onChange(
              updateInlineChecklistText(value, (currentState) => ({
                ...currentState,
                items: [
                  ...currentState.items,
                  {
                    checked: false,
                    label: "",
                    indent:
                      currentState.items[currentState.items.length - 1]
                        ?.indent ?? "",
                  },
                ],
              })),
            );
          }}
          className={cn(
            "mt-2 inline-flex items-center gap-2 rounded-lg px-2 py-1 text-xs font-semibold transition cursor-pointer",
            "text-(--ui-texto-secundario) hover:bg-(--ui-hover) hover:text-(--ui-texto-forte)",
          )}
        >
          <Plus className="h-3.5 w-3.5" />
          Adicionar item
        </button>
      )}

      {(isTrailingTextVisible || checklist.trailingText.length > 0) && (
        <div className="pt-2">
          <textarea
            ref={(node) => {
              trailingTextareaRef.current = node;
              if (trailingTextareaExternalRef) {
                trailingTextareaExternalRef.current = node;
              }
              resizeTrailingTextarea(node);
            }}
            rows={1}
            value={checklist.trailingText}
            readOnly={readOnly}
            onFocus={(event) => {
              resizeTrailingTextarea(event.currentTarget);
              onTrailingTextCursorChange?.(
                event.currentTarget.value,
                event.currentTarget.selectionStart,
                event.currentTarget,
                trailingTextOffset,
              );
            }}
            onChange={(event) => {
              if (readOnly) return;
              resizeTrailingTextarea(event.target);
              onChange(
                updateInlineChecklistText(value, (currentState) => ({
                  ...currentState,
                  trailingText: event.target.value,
                })),
              );
              onTrailingTextCursorChange?.(
                event.target.value,
                event.target.selectionStart,
                event.target,
                trailingTextOffset,
              );
            }}
            onKeyUp={(event) =>
              onTrailingTextCursorChange?.(
                event.currentTarget.value,
                event.currentTarget.selectionStart,
                event.currentTarget,
                trailingTextOffset,
              )
            }
            onClick={(event) =>
              onTrailingTextCursorChange?.(
                event.currentTarget.value,
                event.currentTarget.selectionStart,
                event.currentTarget,
                trailingTextOffset,
              )
            }
            onKeyDown={(event) => {
              if (readOnly) return;

              if (
                event.key === "Backspace" &&
                event.currentTarget.selectionStart === 0 &&
                event.currentTarget.selectionEnd === 0 &&
                event.currentTarget.value.length === 0
              ) {
                event.preventDefault();
                setIsTrailingTextVisible(false);
                onMentionReset?.();
                pendingFocusRef.current = {
                  type: "item",
                  index: Math.max(0, checklist.items.length - 1),
                  cursor: "end",
                };
              }
            }}
            placeholder="Texto comum..."
            className={cn(
              "w-full resize-none overflow-hidden bg-transparent text-sm leading-relaxed outline-none",
              "text-(--ui-texto-forte) placeholder:text-(--ui-texto-secundario)",
            )}
          />
        </div>
      )}
    </div>
  );
}

export function InlineChecklistContent({
  value,
  isDarkMode,
  members,
  hiddenUrls,
  onToggle,
}: {
  value: string;
  isDarkMode: boolean;
  members: Member[];
  hiddenUrls?: string[];
  onToggle?: (index: number) => void;
}) {
  const checklist = parseInlineChecklistText(value);

  if (!checklist || checklist.items.length === 0) {
    return null;
  }

  return (
    <div className="space-y-1">
      {checklist.items.map((item, index) => (
        <div
          key={`inline-checklist-content-${index}`}
          className="flex items-start gap-2"
        >
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onToggle?.(index);
            }}
            disabled={!onToggle}
            className={cn(
              "mt-0.75 flex h-4 w-4 shrink-0 items-center justify-center rounded border-2 transition",
              !onToggle && "cursor-default",
              item.checked
                ? "border-emerald-500 bg-emerald-500 text-white"
                : "border-(--ui-borda-forte) bg-(--ui-superficie-suave)",
              onToggle &&
                ("cursor-pointer hover:border-blue-400"),
            )}
          >
            {item.checked && <Check className="h-2.5 w-2.5" />}
          </button>
          <div
            className={cn(
              "min-w-0 flex-1 whitespace-pre-wrap text-sm leading-relaxed",
              item.checked && "line-through",
              isDarkMode
                ? item.checked
                  ? "text-(--text-soft)"
                  : "text-(--text-main)"
                : item.checked
                  ? "text-slate-500"
                  : "text-slate-700",
            )}
          >
            {renderTextWithMentionsAndLinks(
              stripLinkUrlsFromText(item.label),
              members,
              getMentionChipClassName("content"),
              getLinkClassName(),
              hiddenUrls,
            )}
          </div>
        </div>
      ))}

      {checklist.trailingText.trim().length > 0 && (
        <div
          className={cn(
            "whitespace-pre-wrap pt-2 text-sm leading-relaxed",
            "text-(--ui-texto-forte)",
          )}
        >
          {renderTextWithMentionsAndLinks(
            stripLinkUrlsFromText(checklist.trailingText),
            members,
            getMentionChipClassName("content"),
            getLinkClassName(),
            hiddenUrls,
          )}
        </div>
      )}
    </div>
  );
}
