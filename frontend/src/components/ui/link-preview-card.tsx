import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  Copy,
  Ellipsis,
  ExternalLink,
  Globe,
  Link2,
  Pencil,
  Play,
  Trash2,
} from "lucide-react";

import type { LinkDisplayMode } from "../../types/tasks";
import { getLinkPreviewMeta } from "../../lib/link-preview";
import { cn } from "../../lib/utils";

interface LinkPreviewCardProps {
  url: string;
  isDarkMode: boolean;
  storageKey?: string;
  className?: string;
  mode?: LinkDisplayMode;
  onModeChange?: (mode: LinkDisplayMode) => void;
  onEdit?: (url: string) => void;
  onRemove?: () => void;
}

const DISPLAY_OPTIONS: Array<{ value: LinkDisplayMode; label: string }> = [
  { value: "preview", label: "Pré-visualizar" },
  { value: "inline", label: "Link em linha" },
  { value: "url", label: "URL" },
];

function withAlpha(hexColor: string, alpha: number) {
  const normalized = hexColor.replace("#", "");
  const expanded =
    normalized.length === 3
      ? normalized
          .split("")
          .map((char) => `${char}${char}`)
          .join("")
      : normalized;

  if (expanded.length !== 6) {
    return hexColor;
  }

  const red = Number.parseInt(expanded.slice(0, 2), 16);
  const green = Number.parseInt(expanded.slice(2, 4), 16);
  const blue = Number.parseInt(expanded.slice(4, 6), 16);

  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function SiteFavicon({
  meta,
  className,
  iconClassName,
}: {
  meta: NonNullable<ReturnType<typeof getLinkPreviewMeta>>;
  className?: string;
  iconClassName?: string;
}) {
  const [faviconIndex, setFaviconIndex] = useState(0);
  const faviconSrc = meta.faviconUrls[faviconIndex];

  useEffect(() => {
    setFaviconIndex(0);
  }, [meta.href]);

  if (faviconSrc) {
    return (
      <img
        src={faviconSrc}
        alt=""
        aria-hidden="true"
        className={cn("object-contain", className)}
        onError={() => {
          setFaviconIndex((current) =>
            current < meta.faviconUrls.length - 1
              ? current + 1
              : meta.faviconUrls.length,
          );
        }}
      />
    );
  }

  return meta.hostname.includes("youtube") ? (
    <Play className={cn("fill-current", iconClassName)} />
  ) : (
    <Globe className={iconClassName} />
  );
}

export function LinkPreviewCard({
  url,
  isDarkMode,
  storageKey,
  className,
  mode,
  onModeChange,
  onEdit,
  onRemove,
}: LinkPreviewCardProps) {
  const meta = useMemo(() => getLinkPreviewMeta(url), [url]);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuPanelRef = useRef<HTMLDivElement>(null);
  const [internalDisplayMode, setInternalDisplayMode] =
    useState<LinkDisplayMode>("preview");
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const displayMode = mode ?? internalDisplayMode;
  const isInlineMode = displayMode === "inline";

  function updateDisplayMode(nextMode: LinkDisplayMode) {
    if (mode === undefined) {
      setInternalDisplayMode(nextMode);
    }
    onModeChange?.(nextMode);
  }

  useEffect(() => {
    if (mode !== undefined || !storageKey || typeof window === "undefined")
      return;
    const savedMode = window.localStorage.getItem(
      storageKey,
    ) as LinkDisplayMode | null;
    if (
      savedMode === "preview" ||
      savedMode === "inline" ||
      savedMode === "url"
    ) {
      setInternalDisplayMode(savedMode);
    }
  }, [mode, storageKey]);

  useEffect(() => {
    if (mode !== undefined || !storageKey || typeof window === "undefined")
      return;
    window.localStorage.setItem(storageKey, displayMode);
  }, [displayMode, mode, storageKey]);

  useEffect(() => {
    if (!isMenuOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (
        target &&
        (containerRef.current?.contains(target) ||
          menuPanelRef.current?.contains(target))
      ) {
        return;
      }
      setIsMenuOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isMenuOpen]);

  useEffect(() => {
    if (!isMenuOpen || typeof window === "undefined") return;

    const updateMenuPosition = () => {
      const rect = menuButtonRef.current?.getBoundingClientRect();
      if (!rect) return;

      const panelWidth = 224;
      const panelHeight = 320;
      const viewportPadding = 12;
      const nextLeft = Math.min(
        Math.max(viewportPadding, rect.right - panelWidth),
        window.innerWidth - panelWidth - viewportPadding,
      );
      const nextTop =
        rect.bottom + 6 + panelHeight <= window.innerHeight - viewportPadding
          ? rect.bottom + 6
          : Math.max(viewportPadding, rect.top - panelHeight - 6);

      setMenuPosition({ top: nextTop, left: nextLeft });
    };

    updateMenuPosition();
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);

    return () => {
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [isMenuOpen]);

  if (!meta) return null;

  async function handleCopy() {
    if (!meta) return;
    try {
      await navigator.clipboard.writeText(meta.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  }

  const actionButtonClassName = cn(
    "grid h-5 w-5 place-items-center rounded-md border shadow-sm transition-colors cursor-pointer",
    isDarkMode
      ? "border-white/10 bg-slate-950/80 text-white hover:bg-slate-900"
      : "border-slate-200 bg-white/95 text-slate-700 hover:bg-slate-50",
  );

  const actionIconClassName = "h-[10px] w-[10px]";

  const topActions = (
    <div
      className={cn(
        "absolute z-30 flex items-center gap-0.5 opacity-100 transition-all duration-150 lg:opacity-0 lg:group-hover/link-preview:opacity-100 lg:group-focus-within/link-preview:opacity-100",
        isInlineMode ? "right-1 top-1/2 -translate-y-1/2" : "right-1.5 top-1.5",
      )}
    >
      <button
        type="button"
        onClick={handleCopy}
        className={actionButtonClassName}
      >
        {copied ? (
          <Check className={actionIconClassName} />
        ) : (
          <Copy className={actionIconClassName} />
        )}
      </button>
      <a
        href={meta.href}
        target="_blank"
        rel="noreferrer noopener"
        className={actionButtonClassName}
      >
        <ExternalLink className={actionIconClassName} />
      </a>
      <div>
        <button
          ref={menuButtonRef}
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setIsMenuOpen((current) => !current);
          }}
          className={actionButtonClassName}
        >
          <Ellipsis className={actionIconClassName} />
        </button>
      </div>
    </div>
  );

  const menuContent =
    isMenuOpen && menuPosition && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={menuPanelRef}
            className={cn(
              "fixed z-3000 min-w-56 overflow-hidden rounded-2xl border shadow-xl",
              "border-(--ui-borda) bg-(--ui-superficie)",
            )}
            style={{ top: menuPosition.top, left: menuPosition.left }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div
              className={cn(
                "border-b px-3 py-2 text-[11px]",
                "border-(--ui-borda-suave) text-(--ui-texto-secundario)",
              )}
            >
              Exibir como
            </div>
            <div className="p-2">
              {DISPLAY_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    updateDisplayMode(option.value);
                    setIsMenuOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm font-semibold transition-colors cursor-pointer",
                    displayMode === option.value
                      ? "bg-(--ui-fundo-neutro) text-(--ui-texto-principal)"
                      : "text-(--ui-texto-item) hover:bg-(--ui-hover)",
                  )}
                >
                  <span>{option.label}</span>
                  {displayMode === option.value && (
                    <Check className="h-4 w-4 text-blue-500" />
                  )}
                </button>
              ))}
            </div>
            <div
              className={cn(
                "border-t p-2",
                "border-(--ui-borda-suave)",
              )}
            >
              <button
                type="button"
                onClick={() => {
                  void handleCopy();
                  setIsMenuOpen(false);
                }}
                className={cn(
                  "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors cursor-pointer",
                  "text-(--ui-texto-item) hover:bg-(--ui-hover)",
                )}
              >
                <Link2 className="h-4 w-4" />
                Copiar link
              </button>
              <a
                href={meta.href}
                target="_blank"
                rel="noreferrer noopener"
                className={cn(
                  "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors",
                  "text-(--ui-texto-item) hover:bg-(--ui-hover)",
                )}
              >
                <ExternalLink className="h-4 w-4" />
                Abrir em uma nova aba
              </a>
              {onEdit ? (
                <button
                  type="button"
                  onClick={() => {
                    onEdit(meta.href);
                    setIsMenuOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors cursor-pointer",
                    "text-(--ui-texto-item) hover:bg-(--ui-hover)",
                  )}
                >
                  <Pencil className="h-4 w-4" />
                  Editar link
                </button>
              ) : null}
              {onRemove ? (
                <button
                  type="button"
                  onClick={() => {
                    onRemove();
                    setIsMenuOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors cursor-pointer",
                    "text-(--ui-rose-texto) hover:bg-(--ui-rose-fundo)",
                  )}
                >
                  <Trash2 className="h-4 w-4" />
                  Excluir
                </button>
              ) : null}
            </div>
          </div>,
          document.body,
        )
      : null;

  if (displayMode === "url") {
    return (
      <div
        ref={containerRef}
        className={className}
        onMouseDown={(event) => event.preventDefault()}
      >
        <a
          href={meta.href}
          target="_blank"
          rel="noreferrer noopener"
          className={cn(
            "break-all text-sm underline underline-offset-2",
            "text-(--ui-azul-texto)",
          )}
        >
          {meta.href}
        </a>
      </div>
    );
  }

  if (displayMode === "inline") {
    return (
      <div
        ref={containerRef}
        className={cn(
          "group/link-preview relative inline-flex min-w-[18rem] max-w-104 flex-none overflow-visible",
          className,
        )}
        onMouseDown={(event) => event.preventDefault()}
      >
        {topActions}
        {menuContent}
        <div
          className={cn(
            "flex w-full min-w-0 items-center gap-2 rounded-xl border px-2.5 py-1.5 pr-18",
          )}
          style={{
            borderColor: isDarkMode
              ? withAlpha(meta.brandColor, 0.38)
              : withAlpha(meta.brandColor, 0.22),
            background: isDarkMode
              ? `linear-gradient(135deg, rgba(15,23,42,0.92) 0%, ${withAlpha(meta.brandColor, 0.16)} 100%)`
              : `linear-gradient(135deg, rgba(255,255,255,0.98) 0%, ${withAlpha(meta.brandSurfaceColor, 0.95)} 100%)`,
          }}
        >
          <div
            className="grid h-7 w-7 shrink-0 place-items-center rounded-lg"
            style={{
              background: `linear-gradient(135deg, ${meta.brandColor} 0%, ${withAlpha(meta.brandColor, 0.72)} 100%)`,
            }}
          >
            <SiteFavicon
              meta={meta}
              className="h-4.5 w-4.5 rounded-sm bg-white/95 p-0.5"
              iconClassName="h-3.5 w-3.5 text-white"
            />
          </div>
          <div className="min-w-0 flex-1">
            <div
              className={cn(
                "mb-0.5 truncate text-[10px] font-black uppercase tracking-[0.18em]",
                "text-(--ui-texto-secundario)",
              )}
            >
              {meta.hostnameLabel}
            </div>
            <a
              href={meta.href}
              target="_blank"
              rel="noreferrer noopener"
              className="block min-w-0 truncate text-[13px] font-semibold underline underline-offset-2"
              style={{
                color: isDarkMode ? meta.brandSurfaceColor : meta.brandColor,
              }}
            >
              {meta.hostname.includes("youtube")
                ? `${meta.hostnameLabel} ${meta.title}`
                : meta.title}
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        "group/link-preview relative w-56 max-w-full flex-none overflow-visible rounded-2xl",
        className,
      )}
      onMouseDown={(event) => event.preventDefault()}
    >
      {topActions}
      {menuContent}
      <a
        href={meta.href}
        target="_blank"
        rel="noreferrer noopener"
        className={cn(
          "block overflow-hidden rounded-2xl border transition-transform hover:-translate-y-0.5",
          "border-(--ui-borda) bg-(--ui-superficie)",
        )}
      >
        <div
          className={cn(
            "relative h-24 overflow-hidden border-b",
            "border-(--ui-borda-suave) bg-(--ui-fundo-sutil)",
          )}
        >
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-14 bg-linear-to-b from-slate-950/45 via-slate-950/10 to-transparent opacity-0 transition-opacity duration-200 group-hover/link-preview:opacity-100 group-focus-within/link-preview:opacity-100" />
          {meta.thumbnailUrl ? (
            <img
              src={meta.thumbnailUrl}
              alt={meta.title}
              className="h-full w-full object-cover"
            />
          ) : (
            <div
              className="flex h-full w-full flex-col justify-between p-3"
              style={{
                background: `linear-gradient(140deg, ${withAlpha(meta.brandSurfaceColor, isDarkMode ? 0.24 : 0.94)} 0%, ${withAlpha(meta.brandColor, isDarkMode ? 0.5 : 0.86)} 100%)`,
              }}
            >
              <div className="flex items-start">
                <div
                  className="grid h-10 w-10 place-items-center rounded-2xl border bg-white/92 shadow-sm"
                  style={{ borderColor: withAlpha(meta.brandColor, 0.2) }}
                >
                  <SiteFavicon
                    meta={meta}
                    className="h-6 w-6 rounded-md p-0.5"
                    iconClassName="h-5 w-5 text-slate-800"
                  />
                </div>
              </div>
              <div>
                <p
                  className={cn(
                    "line-clamp-2 text-sm font-bold leading-tight",
                    "text-(--ui-texto-principal)",
                  )}
                >
                  {meta.title}
                </p>
                {meta.subtitle ? (
                  <p
                    className={cn(
                      "mt-1 line-clamp-2 text-[11px] leading-relaxed",
                      "text-(--ui-texto-forte)",
                    )}
                  >
                    {meta.subtitle}
                  </p>
                ) : null}
              </div>
            </div>
          )}
        </div>
        <div
          className={cn(
            "space-y-1 px-3 py-2.5",
            "bg-(--ui-superficie)",
          )}
        >
          <p
            className={cn(
              "truncate text-sm font-bold",
              "text-(--ui-texto-principal)",
            )}
          >
            {meta.title}
          </p>
          <div className="flex items-center gap-1.5">
            <div
              className="grid h-5 w-5 place-items-center rounded-md border bg-white/95"
              style={{ borderColor: withAlpha(meta.brandColor, 0.18) }}
            >
              <SiteFavicon
                meta={meta}
                className="h-3.5 w-3.5 rounded-sm"
                iconClassName="h-3 w-3 text-slate-700"
              />
            </div>
            <span
              className={cn(
                "truncate text-xs",
                "text-(--ui-texto-secundario)",
              )}
            >
              {meta.hostnameLabel}
            </span>
          </div>
        </div>
      </a>
    </div>
  );
}
