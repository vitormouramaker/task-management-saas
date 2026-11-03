import { Input } from "./input";
import { cn } from "../../lib/utils";
import type {
  CustomFieldDefinition,
  CustomFieldValue,
  EntityId,
} from "../../types/tasks";

type CustomFieldErrors = Partial<Record<EntityId, string>>;

interface CustomFieldEditorProps {
  fields: CustomFieldDefinition[];
  values: Record<EntityId, CustomFieldValue>;
  onValueChange: (fieldId: EntityId, value: CustomFieldValue) => void;
  onValueCommit?: (fieldId: EntityId, value: CustomFieldValue) => void;
  errors?: CustomFieldErrors;
  disabled?: boolean;
  variant?: "panel" | "inline";
}

function isEmptyValue(value: CustomFieldValue) {
  return value === null || value === undefined || value === "";
}

function formatDateValue(value: CustomFieldValue) {
  if (typeof value !== "string") {
    return "";
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  return /^\d{4}-\d{2}-\d{2}/.test(trimmed) ? trimmed.slice(0, 10) : trimmed;
}

export function sortCustomFieldDefinitions(fields: CustomFieldDefinition[]) {
  return [...fields].sort((left, right) => {
    if (left.displayOrder !== right.displayOrder) {
      return left.displayOrder - right.displayOrder;
    }

    return left.name.localeCompare(right.name, "pt-BR");
  });
}

export function validateCustomFieldValues(
  fields: CustomFieldDefinition[],
  values: Record<EntityId, CustomFieldValue>,
) {
  const errors: CustomFieldErrors = {};

  fields.forEach((field) => {
    const value = values[field.id];

    if (field.required && field.type !== "checkbox" && isEmptyValue(value)) {
      errors[field.id] = "Campo obrigatório.";
      return;
    }

    if (field.type === "number" && !isEmptyValue(value)) {
      const numericValue =
        typeof value === "number" ? value : Number(String(value).trim());
      if (Number.isNaN(numericValue)) {
        errors[field.id] = "Informe um número válido.";
      }
    }

    if (field.type === "date" && !isEmptyValue(value)) {
      const normalized = formatDateValue(value);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
        errors[field.id] = "Informe uma data válida.";
      }
    }

    if (field.type === "single_select" && !isEmptyValue(value)) {
      const optionId = String(value).trim();
      const hasOption = field.options.some((option) => option.id === optionId);
      if (!hasOption) {
        errors[field.id] = "Selecione uma opção válida.";
      }
    }
  });

  return errors;
}

export function CustomFieldEditor({
  fields,
  values,
  onValueChange,
  onValueCommit,
  errors,
  disabled = false,
  variant = "panel",
}: CustomFieldEditorProps) {
  if (fields.length === 0) {
    return null;
  }

  return (
    <div className={cn("space-y-4", variant === "inline" && "space-y-3")}>
      {fields.map((field) => {
        const error = errors?.[field.id];
        const value = values[field.id];
        const inputId = `custom-field-${field.id}`;
        const isInline = variant === "inline";

        return (
          <div
            key={field.id}
            className={cn(
              isInline ? "flex min-w-0 items-start gap-3" : "space-y-1.5",
            )}
          >
            <div className={cn(isInline ? "w-25 shrink-0 pt-2" : "")}>
              <label
                htmlFor={inputId}
                className={cn(
                  isInline
                    ? "flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider"
                    : "block text-xs font-bold uppercase tracking-widest",
                  "text-(--ui-texto-secundario)",
                )}
              >
                {field.name}
                {field.required && <span className="text-rose-500">*</span>}
              </label>
            </div>

            <div className="min-w-0 flex-1 space-y-1.5">
              {field.type === "text" && (
                <Input
                  id={inputId}
                  value={typeof value === "string" ? value : ""}
                  onChange={(event) =>
                    onValueChange(field.id, event.target.value)
                  }
                  onBlur={(event) =>
                    onValueCommit?.(field.id, event.target.value)
                  }
                  disabled={disabled}
                  placeholder={`Preencha ${field.name.toLowerCase()}`}
                  className={cn(
                    "h-10 rounded-xl text-sm",
                    "border-(--ui-borda) bg-(--ui-superficie-suave) text-(--ui-texto-principal)",
                  )}
                />
              )}

              {field.type === "number" && (
                <Input
                  id={inputId}
                  type="number"
                  value={isEmptyValue(value) ? "" : String(value)}
                  onChange={(event) =>
                    onValueChange(field.id, event.target.value)
                  }
                  onBlur={(event) =>
                    onValueCommit?.(field.id, event.target.value)
                  }
                  disabled={disabled}
                  placeholder="0"
                  className={cn(
                    "h-10 rounded-xl text-sm",
                    "border-(--ui-borda) bg-(--ui-superficie-suave) text-(--ui-texto-principal)",
                  )}
                />
              )}

              {field.type === "date" && (
                <Input
                  id={inputId}
                  type="date"
                  value={formatDateValue(value)}
                  onChange={(event) =>
                    onValueChange(field.id, event.target.value || null)
                  }
                  onBlur={(event) =>
                    onValueCommit?.(field.id, event.target.value || null)
                  }
                  disabled={disabled}
                  className={cn(
                    "h-10 rounded-xl text-sm",
                    "border-(--ui-borda) bg-(--ui-superficie-suave) text-(--ui-texto-principal)",
                  )}
                />
              )}

              {field.type === "single_select" && (
                <select
                  id={inputId}
                  value={typeof value === "string" ? value : ""}
                  onChange={(event) => {
                    const nextValue = event.target.value || null;
                    onValueChange(field.id, nextValue);
                    onValueCommit?.(field.id, nextValue);
                  }}
                  disabled={disabled}
                  className={cn(
                    "h-10 w-full rounded-xl border px-3 text-sm font-medium outline-none transition cursor-pointer",
                    "border-(--ui-borda) bg-(--ui-superficie-suave) text-(--ui-texto-forte)",
                  )}
                >
                  <option value="">Selecione uma opção</option>
                  {field.options.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              )}

              {field.type === "checkbox" && (
                <label
                  htmlFor={inputId}
                  className={cn(
                    "flex min-h-10 items-center gap-2 rounded-xl border px-3 text-sm font-medium cursor-pointer",
                    disabled && "cursor-not-allowed opacity-70",
                    "border-(--ui-borda) bg-(--ui-superficie-suave) text-(--ui-texto-forte)",
                  )}
                >
                  <input
                    id={inputId}
                    type="checkbox"
                    checked={Boolean(value)}
                    onChange={(event) => {
                      onValueChange(field.id, event.target.checked);
                      onValueCommit?.(field.id, event.target.checked);
                    }}
                    disabled={disabled}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  Marcar este campo
                </label>
              )}

              {error && (
                <p className="text-xs font-medium text-rose-500">{error}</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
