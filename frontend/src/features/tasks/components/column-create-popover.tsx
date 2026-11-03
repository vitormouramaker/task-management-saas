import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Plus, X } from "lucide-react";

import { cn } from "../../../lib/utils";

type ColumnStyle = {
  dot: string;
  bg: string;
  text: string;
  headerBg: string;
};

export type ColumnPreset = {
  key: string;
  label: string;
  /** Classes persistidas (dotClass identifica o preset no Kanban) */
  dotClass: string;
  colorClass: string;
  chipClass: string;
  swatch: string;
  light: ColumnStyle;
  dark: ColumnStyle;
};

/**
 * Paletas para colunas criadas pelo admin. `dotClass` é a chave usada pelo
 * Kanban para recuperar o estilo (claro/escuro) de uma coluna custom.
 */
export const COLUMN_PRESETS: ColumnPreset[] = [
  {
    key: "slate",
    label: "Cinza",
    dotClass: "bg-slate-500",
    colorClass: "bg-slate-50",
    chipClass: "bg-slate-100 text-slate-700 ring-slate-200",
    swatch: "bg-slate-400",
    light: {
      dot: "bg-slate-500",
      bg: "bg-slate-50/10",
      text: "text-slate-900",
      headerBg: "bg-slate-100 border-slate-200",
    },
    dark: {
      dot: "bg-zinc-300",
      bg: "bg-zinc-500/12",
      text: "text-zinc-100",
      headerBg: "bg-zinc-500/10 border-(--border-subtle)",
    },
  },
  {
    key: "blue",
    label: "Azul",
    dotClass: "bg-blue-600",
    colorClass: "bg-blue-50/50",
    chipClass: "bg-sky-100 text-sky-700 ring-sky-200",
    swatch: "bg-blue-500",
    light: {
      dot: "bg-blue-600",
      bg: "bg-blue-50/10",
      text: "text-blue-900",
      headerBg: "bg-blue-50 border-blue-100",
    },
    dark: {
      dot: "bg-blue-300",
      bg: "bg-blue-500/12",
      text: "text-blue-200",
      headerBg: "bg-blue-500/10 border-blue-500/20",
    },
  },
  {
    key: "orange",
    label: "Laranja",
    dotClass: "bg-orange-500",
    colorClass: "bg-orange-50/50",
    chipClass: "bg-amber-100 text-amber-700 ring-amber-200",
    swatch: "bg-orange-500",
    light: {
      dot: "bg-orange-500",
      bg: "bg-orange-50/10",
      text: "text-orange-900",
      headerBg: "bg-orange-50 border-orange-100",
    },
    dark: {
      dot: "bg-amber-300",
      bg: "bg-amber-500/12",
      text: "text-amber-200",
      headerBg: "bg-amber-500/10 border-amber-500/20",
    },
  },
  {
    key: "violet",
    label: "Violeta",
    dotClass: "bg-violet-500",
    colorClass: "bg-violet-50/50",
    chipClass: "bg-violet-100 text-violet-700 ring-violet-200",
    swatch: "bg-violet-500",
    light: {
      dot: "bg-violet-500",
      bg: "bg-violet-50/10",
      text: "text-violet-900",
      headerBg: "bg-violet-50 border-violet-100",
    },
    dark: {
      dot: "bg-violet-300",
      bg: "bg-violet-500/12",
      text: "text-violet-200",
      headerBg: "bg-violet-500/10 border-violet-500/20",
    },
  },
  {
    key: "emerald",
    label: "Verde",
    dotClass: "bg-emerald-500",
    colorClass: "bg-emerald-50/50",
    chipClass: "bg-emerald-100 text-emerald-700 ring-emerald-200",
    swatch: "bg-emerald-500",
    light: {
      dot: "bg-emerald-500",
      bg: "bg-emerald-50/10",
      text: "text-emerald-900",
      headerBg: "bg-emerald-50 border-emerald-100",
    },
    dark: {
      dot: "bg-emerald-300",
      bg: "bg-emerald-500/12",
      text: "text-emerald-200",
      headerBg: "bg-emerald-500/10 border-emerald-500/20",
    },
  },
  {
    key: "rose",
    label: "Rosa",
    dotClass: "bg-rose-500",
    colorClass: "bg-rose-50/50",
    chipClass: "bg-rose-100 text-rose-700 ring-rose-200",
    swatch: "bg-rose-500",
    light: {
      dot: "bg-rose-500",
      bg: "bg-rose-50/10",
      text: "text-rose-900",
      headerBg: "bg-rose-50 border-rose-100",
    },
    dark: {
      dot: "bg-rose-300",
      bg: "bg-rose-500/12",
      text: "text-rose-200",
      headerBg: "bg-rose-500/10 border-rose-500/20",
    },
  },
];

/** Recupera o preset cujo dotClass corresponde ao informado. */
export function getPresetByDotClass(dotClass: string | undefined) {
  return COLUMN_PRESETS.find((p) => p.dotClass === dotClass);
}

/** Recupera o estilo de uma coluna custom pelo dotClass persistido. */
export function getPresetStyleByDotClass(
  dotClass: string | undefined,
  isDarkMode: boolean,
): ColumnStyle | null {
  const preset = COLUMN_PRESETS.find((p) => p.dotClass === dotClass);
  if (!preset) return null;
  return isDarkMode ? preset.dark : preset.light;
}

interface ColumnCreatePopoverProps {
  onCreate: (payload: {
    name: string;
    colorClass: string;
    chipClass: string;
    dotClass: string;
  }) => void;
}

export function ColumnCreatePopover({
  onCreate,
}: ColumnCreatePopoverProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState("");
  const [presetKey, setPresetKey] = useState(COLUMN_PRESETS[1].key);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);

  function handleSubmit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    const preset =
      COLUMN_PRESETS.find((p) => p.key === presetKey) || COLUMN_PRESETS[0];
    onCreate({
      name: trimmed,
      colorClass: preset.colorClass,
      chipClass: preset.chipClass,
      dotClass: preset.dotClass,
    });
    setName("");
    setPresetKey(COLUMN_PRESETS[1].key);
    setIsOpen(false);
  }

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className={cn(
          "flex h-11 w-[min(60vw,13rem)] shrink-0 items-center justify-center gap-2 rounded-2xl border-2 border-dashed text-[12px] font-black uppercase tracking-wider transition-colors sm:w-52",
          "border-(--ui-borda) text-(--ui-texto-secundario) hover:border-(--ui-azul-borda-foco) hover:text-(--ui-texto-forte)",
        )}
      >
        <Plus className="h-4 w-4" />
        Nova coluna
      </button>

      {isOpen && (
        <div
          className={cn(
            "absolute left-0 top-13 z-30 w-72 rounded-2xl border p-4 shadow-xl",
            "border-(--ui-borda) bg-(--ui-superficie)",
          )}
        >
          <div className="mb-3 flex items-center justify-between">
            <h4
              className={cn(
                "text-[12px] font-black uppercase tracking-wider",
                "text-(--ui-texto-forte)",
              )}
            >
              Nova coluna
            </h4>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className={cn(
                "rounded-lg p-1 transition-colors",
                "text-(--ui-texto-secundario) hover:text-(--ui-texto-forte)",
              )}
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <input aria-label="Nome da coluna"
            ref={inputRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSubmit();
            }}
            placeholder="Nome da coluna"
            className={cn(
              "mb-3 h-10 w-full rounded-xl border px-3 text-sm outline-none transition-all",
              "border-(--ui-borda) bg-(--ui-superficie-suave) text-(--ui-texto-forte) focus:border-(--ui-azul-borda-foco) focus:ring-4 focus:ring-(--ui-azul-foco)",
            )}
          />

          <div className="mb-4 flex flex-wrap gap-2">
            {COLUMN_PRESETS.map((preset) => (
              <button
                key={preset.key}
                type="button"
                title={preset.label}
                onClick={() => setPresetKey(preset.key)}
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-full ring-2 ring-offset-2 transition-all",
                  preset.swatch,
                  "ring-offset-(--ui-superficie)",
                  presetKey === preset.key
                    ? "ring-blue-400"
                    : "ring-transparent",
                )}
              >
                {presetKey === preset.key && (
                  <Check className="h-3.5 w-3.5 text-white" />
                )}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={handleSubmit}
            disabled={!name.trim()}
            className={cn(
              "h-10 w-full rounded-xl text-[12px] font-black uppercase tracking-wider transition-colors",
              name.trim()
                ? "bg-blue-600 text-white hover:bg-blue-700"
                : "cursor-not-allowed bg-(--ui-fundo-neutro) text-(--ui-texto-secundario)",
            )}
          >
            Criar coluna
          </button>
        </div>
      )}
    </div>
  );
}

interface ColumnEditPopoverProps {
  isOpen: boolean;
  onClose: () => void;
  /** Botão que dispara o popover; usado para ancorar a posição (portal fixed). */
  anchorRef: React.RefObject<HTMLElement | null>;
  initialName: string;
  initialDotClass: string;
  onSave: (payload: {
    name: string;
    colorClass: string;
    chipClass: string;
    dotClass: string;
  }) => void;
}

const POPOVER_WIDTH = 288; // w-72 = 18rem
const POPOVER_GAP = 6;
const VIEWPORT_MARGIN = 8;

export function ColumnEditPopover({
  isOpen,
  onClose,
  anchorRef,
  initialName,
  initialDotClass,
  onSave,
}: ColumnEditPopoverProps) {
  const [name, setName] = useState(initialName);
  const [presetKey, setPresetKey] = useState(
    () => getPresetByDotClass(initialDotClass)?.key || COLUMN_PRESETS[0].key,
  );
  const [position, setPosition] = useState<{ top: number; left: number }>({
    top: 0,
    left: 0,
  });
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reseta os campos sempre que o popover abre (refletindo a coluna atual).
  useEffect(() => {
    if (!isOpen) return;
    setName(initialName);
    setPresetKey(
      getPresetByDotClass(initialDotClass)?.key || COLUMN_PRESETS[0].key,
    );
    inputRef.current?.focus();
  }, [isOpen, initialName, initialDotClass]);

  // Calcula a posição fixa (alinhada à direita do botão), presa ao viewport
  // para nunca ficar atrás da sidebar ou fora da tela.
  useLayoutEffect(() => {
    if (!isOpen) return;
    function updatePosition() {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (!rect) return;
      const left = Math.min(
        Math.max(rect.right - POPOVER_WIDTH, VIEWPORT_MARGIN),
        window.innerWidth - POPOVER_WIDTH - VIEWPORT_MARGIN,
      );
      setPosition({ top: rect.bottom + POPOVER_GAP, left });
    }
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [isOpen, anchorRef]);

  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (containerRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onClose();
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen, onClose, anchorRef]);

  if (!isOpen) return null;

  function handleSubmit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    const preset =
      COLUMN_PRESETS.find((p) => p.key === presetKey) || COLUMN_PRESETS[0];
    onSave({
      name: trimmed,
      colorClass: preset.colorClass,
      chipClass: preset.chipClass,
      dotClass: preset.dotClass,
    });
    onClose();
  }

  return createPortal(
    <div
      ref={containerRef}
      style={{ top: position.top, left: position.left, width: POPOVER_WIDTH }}
      className={cn(
        "fixed z-[100] rounded-2xl border p-4 shadow-xl",
        "border-(--ui-borda) bg-(--ui-superficie)",
      )}
    >
      <div className="mb-3 flex items-center justify-between">
        <h4
          className={cn(
            "text-[12px] font-black uppercase tracking-wider",
            "text-(--ui-texto-forte)",
          )}
        >
          Editar coluna
        </h4>
        <button
          type="button"
          onClick={onClose}
          className={cn(
            "rounded-lg p-1 transition-colors",
            "text-(--ui-texto-secundario) hover:text-(--ui-texto-forte)",
          )}
        
          aria-label="Fechar"
          title="Fechar"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <input aria-label="Nome da coluna"
        ref={inputRef}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSubmit();
        }}
        placeholder="Nome da coluna"
        className={cn(
          "mb-3 h-10 w-full rounded-xl border px-3 text-sm outline-none transition-all",
          "border-(--ui-borda) bg-(--ui-superficie-suave) text-(--ui-texto-forte) focus:border-(--ui-azul-borda-foco) focus:ring-4 focus:ring-(--ui-azul-foco)",
        )}
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {COLUMN_PRESETS.map((preset) => (
          <button
            key={preset.key}
            type="button"
            title={preset.label}
            onClick={() => setPresetKey(preset.key)}
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-full ring-2 ring-offset-2 transition-all",
              preset.swatch,
              "ring-offset-(--ui-superficie)",
              presetKey === preset.key ? "ring-blue-400" : "ring-transparent",
            )}
          >
            {presetKey === preset.key && (
              <Check className="h-3.5 w-3.5 text-white" />
            )}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={handleSubmit}
        disabled={!name.trim()}
        className={cn(
          "h-10 w-full rounded-xl text-[12px] font-black uppercase tracking-wider transition-colors",
          name.trim()
            ? "bg-blue-600 text-white hover:bg-blue-700"
            : "cursor-not-allowed bg-(--ui-fundo-neutro) text-(--ui-texto-secundario)",
        )}
      >
        Salvar
      </button>
    </div>,
    document.body,
  );
}
