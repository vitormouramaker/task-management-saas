import { useState, useRef, useEffect, useMemo } from "react";
import { ChevronLeft, ChevronRight, ChevronDown } from "lucide-react";
import { cn } from "../../lib/utils";
import { useThemeStore } from "../../store/use-theme-store";

interface FlightDatePickerProps {
  startDate: string | null;
  endDate: string | null;
  onChange: (start: string | null, end: string | null) => void;
  className?: string;
  direction?: 'up' | 'down' | 'right';
  disabled?: boolean;
}

const MONTH_NAMES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
];

const DAY_NAMES = ["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SÁB"];

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}

function adjustAddMonths(date: Date, amount: number) {
  const newDate = new Date(date);
  newDate.setMonth(newDate.getMonth() + amount);
  return newDate;
}

export function FlightDatePicker({ startDate, endDate, onChange, className, direction = 'down', disabled = false }: FlightDatePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDarkMode = useThemeStore((state) => state.mode === "dark");
  
  const [viewDate, setViewDate] = useState(() => {
    return startDate ? new Date(startDate) : new Date();
  });

  const [draftStart, setDraftStart] = useState<Date | null>(startDate ? new Date(startDate) : null);
  const [draftEnd, setDraftEnd] = useState<Date | null>(endDate ? new Date(endDate) : null);

  useEffect(() => {
    setDraftStart(startDate ? new Date(startDate) : null);
    setDraftEnd(endDate ? new Date(endDate) : null);
    if (startDate) {
      setViewDate(new Date(startDate));
    }
  }, [startDate, endDate, isOpen]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
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

  const handleDayClick = (date: Date) => {
    if (!draftStart || (draftStart && draftEnd)) {
      setDraftStart(date);
      setDraftEnd(null);
    } else if (draftStart && !draftEnd) {
      if (date < draftStart) {
        setDraftStart(date);
      } else {
        setDraftEnd(date);
      }
    }
  };

  const clearSelection = () => {
    setDraftStart(null);
    setDraftEnd(null);
  };

  const applySelection = () => {
    onChange(
      draftStart ? draftStart.toISOString() : null,
      draftEnd ? draftEnd.toISOString() : null
    );
    setIsOpen(false);
  };

  const nextMonth = () => setViewDate((prev) => adjustAddMonths(prev, 1));
  const prevMonth = () => setViewDate((prev) => adjustAddMonths(prev, -1));

  const renderMonth = (monthOffset: number) => {
    const targetDate = adjustAddMonths(viewDate, monthOffset);
    const year = targetDate.getFullYear();
    const month = targetDate.getMonth();

    const daysInMonth = getDaysInMonth(year, month);
    const firstDay = getFirstDayOfMonth(year, month);

    const days = [];
    for (let i = 0; i < firstDay; i++) {
      days.push(null);
    }
    for (let i = 1; i <= daysInMonth; i++) {
        const currentDate = new Date(year, month, i);
        // Remove time for pure date comparison
        currentDate.setHours(0,0,0,0);
        days.push(currentDate);
    }

    return (
      <div className="w-full">
        <div className="flex items-center justify-between mb-4 px-2">
          <button type="button" onClick={prevMonth} className={cn("cursor-pointer rounded-full p-1.5 transition-colors", "text-(--ui-texto-secundario) hover:bg-(--ui-hover) hover:text-(--ui-texto-forte)")}
            aria-label="Mês anterior"
            title="Mês anterior"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          
          <div className={cn("text-[14px] font-black uppercase tracking-tight", "text-(--ui-texto-principal)")}>
            {MONTH_NAMES[month]} {year}
          </div>

          <button type="button" onClick={nextMonth} className={cn("cursor-pointer rounded-full p-1.5 transition-colors", "text-(--ui-texto-secundario) hover:bg-(--ui-hover) hover:text-(--ui-texto-forte)")}

            aria-label="Próximo mês"

            title="Próximo mês"

          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>

        <div className={cn("mb-2 grid grid-cols-7 gap-y-1 text-center text-[11px] font-semibold", "text-(--ui-texto-secundario)")}>
          {DAY_NAMES.map(name => <div key={name}>{name}</div>)}
        </div>

        <div className="grid grid-cols-7 gap-y-1 justify-items-center">
          {days.map((date, i) => {
            if (!date) return <div key={`empty-${i}`} className="w-8 h-8" />;

            const isStart = draftStart?.getTime() === date.getTime();
            const isEnd = draftEnd?.getTime() === date.getTime();
            const isBetween = draftStart && draftEnd && date > draftStart && date < draftEnd;
            const isToday = new Date().setHours(0,0,0,0) === date.getTime();

            return (
              <div
                key={date.toISOString()}
                className={cn(
                  "relative flex items-center justify-center w-full h-8",
                  isBetween && (isDarkMode ? "bg-blue-500/10" : "bg-(--accent-roxo-suave)"),
                  isStart && draftEnd && (isDarkMode ? "rounded-l-full bg-linear-to-r from-transparent to-blue-500/10" : "bg-linear-to-r from-transparent to-(--accent-roxo-suave) rounded-l-full"),
                  isEnd && draftStart && (isDarkMode ? "rounded-r-full bg-linear-to-r from-blue-500/10 to-transparent" : "bg-linear-to-r from-(--accent-roxo-suave) to-transparent rounded-r-full")
                )}
              >
                <button
                  type="button"
                  onClick={() => handleDayClick(date)}
                  className={cn(
                    "relative flex items-center justify-center w-8 h-8 rounded-full text-xs font-semibold transition-all z-10 cursor-pointer",
                    isStart || isEnd ? "bg-(--accent-roxo) text-white" : "text-(--ui-texto-forte) hover:border hover:border-(--ui-borda-forte)",
                    isBetween && !isStart && !isEnd && "hover:bg-transparent border-transparent",
                    isToday && !isStart && !isEnd && ("font-bold text-(--ui-azul-texto)")
                  )}
                >
                  {date.getDate()}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const formatDateLabel = (date: string | null) => {
    if (!date) return "Definir";
    const d = new Date(date);
    return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth()+1).toString().padStart(2, '0')}/${d.getFullYear().toString().slice(2)}`;
  };

  const diffDays = useMemo(() => {
    if (draftStart && draftEnd) {
      const diffTime = Math.abs(draftEnd.getTime() - draftStart.getTime());
      return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    }
    return 0;
  }, [draftStart, draftEnd]);

  const popoverPositionClass =
    direction === 'up'
      ? 'bottom-full mb-2'
      : direction === 'right'
        ? 'left-full top-0 ml-3 max-sm:left-auto max-sm:right-0 max-sm:top-full max-sm:mt-2 max-sm:ml-0'
        : 'top-full mt-2';

  return (
    <div className="relative w-full min-w-0" ref={containerRef}>
      {/* Trigger */}
      <div 
        onClick={() => {
          if (disabled) return;
          setIsOpen(!isOpen);
        }}
        className={cn(
          "flex h-7 min-w-0 items-center justify-between gap-1 overflow-hidden rounded-xl border border-(--ui-borda) bg-transparent px-2.5 py-1 text-[12px] font-bold text-(--ui-texto-forte) outline-none transition-all hover:border-(--ui-borda-forte) hover:bg-(--ui-hover)",
          disabled && ("cursor-not-allowed opacity-60 hover:border-(--ui-borda) hover:bg-transparent"),
          !disabled && "cursor-pointer",
          className
        )}
      >
        <div className="flex items-center gap-1 min-w-0 overflow-hidden shrink">
          {startDate && endDate ? (
            <>
              <span className="truncate shrink">{formatDateLabel(startDate)}</span>
              <span className={cn("shrink-0 text-[10px] font-medium", "text-(--ui-texto-secundario)")}>a</span>
              <span className="truncate shrink">{formatDateLabel(endDate)}</span>
            </>
          ) : startDate ? (
            <span className="truncate shrink">{formatDateLabel(startDate)}</span>
          ) : endDate ? (
            <span className="truncate shrink">{formatDateLabel(endDate)}</span>
          ) : (
            <span className={cn("truncate shrink", "text-(--ui-texto-secundario)")}>Sem data</span>
          )}
        </div>
        <ChevronDown className={cn("ml-1 h-4 w-4 shrink-0", "text-(--ui-texto-apagado)")} />
      </div>

      {/* Popover */}
       {isOpen && !disabled && (
       <div className={cn(
          isDarkMode
            ? "absolute right-0 z-[10010] w-[320px] rounded-3xl border p-5 animate-in fade-in zoom-in-95 duration-200 pauta-theme-menu"
            : "absolute right-0 z-[10010] w-[320px] rounded-3xl border border-slate-100 bg-white p-5 shadow-2xl shadow-slate-200/50 animate-in fade-in zoom-in-95 duration-200",
          direction === 'right' && 'right-auto',
          popoverPositionClass
        )}>
          
          <div className={cn("mb-4 flex border-b pb-3", "border-(--ui-borda-suave)")}>
            <div className="text-[11px] font-black text-blue-600 uppercase tracking-widest">
              Selecione o período
            </div>
          </div>

          <div className="flex flex-col gap-6">
            {renderMonth(0)}
          </div>

          <div className={cn("mt-4 flex flex-col gap-3 border-t pt-4", "border-(--ui-borda-suave)")}>
            <div className={cn("text-center text-[10px] font-bold uppercase tracking-tight", "text-(--ui-texto-secundario)")}>
              {draftStart && draftEnd ? (
                <div className={cn("flex items-center justify-center gap-1", "text-(--ui-texto-secundario)")}>
                  <span>{draftStart.getDate()} {MONTH_NAMES[draftStart.getMonth()].slice(0,3)}</span>
                  <span>-</span>
                  <span>{draftEnd.getDate()} {MONTH_NAMES[draftEnd.getMonth()].slice(0,3)}</span>
                  <span className={cn("ml-1 rounded-md px-1.5 py-0.5 font-black", "bg-(--ui-azul-fundo) text-(--ui-azul-texto)")}>{diffDays}d</span>
                </div>
              ) : draftStart ? (
                "Selecione o fim"
              ) : "Escolha as datas"}
            </div>
            
            <div className="flex items-center gap-2">
              <button 
                type="button" 
                onClick={clearSelection}
                className={cn("flex-1 py-2 text-[11px] font-black uppercase tracking-widest transition-colors cursor-pointer", "text-(--ui-texto-secundario) hover:text-(--ui-texto-forte)")}
              >
                Limpar
              </button>
              <button 
                type="button" 
                onClick={applySelection}
                className={cn(
                  "flex-2 rounded-xl bg-blue-600 px-6 py-2.5 text-[11px] font-black text-white uppercase tracking-widest hover:bg-blue-700 transition-all cursor-pointer",
                  isDarkMode ? "shadow-lg shadow-blue-950/35" : "shadow-lg shadow-blue-200"
                )}
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
