import { useState, useRef, useEffect } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "../../lib/utils";
import { useThemeStore } from "../../store/use-theme-store";

export const TIME_OPTIONS = [
  "30m",
  "1h",
  "1h 30m",
  "2h",
  "2h 30m",
  "3h",
  "3h 30m",
  "4h",
  "4h 30m",
  "5h",
  "5h 30m",
  "6h",
  "6h 30m",
  "7h",
  "7h 30m",
  "8h",
];

interface TimeEstimateDropdownProps {
  value: string | null;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export function TimeEstimateDropdown({
  value,
  onChange,
  disabled = false,
}: TimeEstimateDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDarkMode = useThemeStore((state) => state.mode === "dark");

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  const handleSelect = (option: string) => {
    onChange(option);
    setIsOpen(false);
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => {
          if (disabled) return;
          setIsOpen(!isOpen);
        }}
        className={cn(
          "flex items-center gap-1.5 rounded-lg border bg-transparent px-2 py-1.5 text-[13px] font-bold outline-none transition-all",
          isDarkMode
            ? "border-(--border-subtle) text-(--text-muted) hover:bg-white/5 hover:text-(--text-main)"
            : "border-slate-200 text-slate-700 hover:border-slate-200 hover:bg-slate-50",
          disabled
            ? "cursor-not-allowed opacity-60 hover:bg-transparent hover:text-inherit"
            : "cursor-pointer",
        )}
      >
        <span>{value || "Tempo estimado"}</span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 transition-transform",
            "text-(--ui-texto-secundario)",
            isOpen && "rotate-180",
          )}
        />
      </button>

      {isOpen && !disabled && (
        <div
          className={cn(
            "absolute top-full left-0 z-50 mt-1 max-h-60 w-40 overflow-y-auto rounded-xl border py-1",
            "pauta-theme-menu",
          )}
        >
          {TIME_OPTIONS.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => handleSelect(opt)}
              className={cn(
                "flex w-full items-center px-3 py-2.5 text-sm text-left transition-colors cursor-pointer",
                value === opt
                  ? isDarkMode
                    ? "bg-blue-500/12 font-bold text-blue-300"
                    : "bg-indigo-50 font-bold text-(--accent-roxo)"
                  : isDarkMode
                    ? "font-medium text-(--text-muted) hover:bg-white/5 hover:text-blue-300"
                    : "font-medium text-slate-700 hover:bg-slate-50 hover:text-(--accent-roxo)",
              )}
            >
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
