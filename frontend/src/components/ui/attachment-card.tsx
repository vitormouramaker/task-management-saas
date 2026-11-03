import type { ReactNode } from "react";
import { FileText } from "lucide-react";

import { buildAssetUrl } from "../../lib/api";
import {
  formatAttachmentSize,
  formatAttachmentTimestamp,
  getAttachmentBaseName,
  getAttachmentExtension,
  resolveAttachmentVisualKind,
} from "../../lib/attachment-utils";
import { cn, getInitials } from "../../lib/utils";
import pdfIconUrl from "../../assets/attachment-icons/file-icon-pdf.svg";
import spreadsheetIconUrl from "../../assets/attachment-icons/file-icon-planilha.svg";
import powerpointIconUrl from "../../assets/attachment-icons/file-icon-powerpoint.svg";
import videoIconUrl from "../../assets/attachment-icons/file-icon-video.svg";
import wordIconUrl from "../../assets/attachment-icons/file-icon-word.svg";
import zipIconUrl from "../../assets/attachment-icons/file-icon-zip.svg";

export interface AttachmentCardItem {
  id?: string;
  name: string;
  url?: string | null;
  type?: string | null;
  mimeType?: string | null;
  createdAt?: string | null;
  previewUrl?: string | null;
  size?: number | null;
}

interface AttachmentCardProps {
  attachment: AttachmentCardItem;
  uploaderName?: string | null;
  uploaderAvatarUrl?: string | null;
  uploaderAvatarColor?: string | null;
  statusLabel?: string | null;
  badge?: ReactNode;
  footer?: ReactNode;
  actions?: ReactNode;
  selectionControl?: ReactNode;
  selectionControlVisible?: boolean;
  onPreview?: () => void;
  className?: string;
}

function getVisualTokens(
  kind: ReturnType<typeof resolveAttachmentVisualKind>,
): {
  assetSrc?: string;
  label: string;
  frame?: string;
} {
  switch (kind) {
    case "archive":
      return {
        assetSrc: zipIconUrl,
        label: "ZIP",
      };
    case "spreadsheet":
      return {
        assetSrc: spreadsheetIconUrl,
        label: "XLS",
      };
    case "pdf":
      return {
        assetSrc: pdfIconUrl,
        label: "PDF",
      };
    case "video":
      return {
        assetSrc: videoIconUrl,
        label: "MP4",
      };
    case "powerpoint":
      return {
        assetSrc: powerpointIconUrl,
        label: "PPT",
      };
    case "word":
      return {
        assetSrc: wordIconUrl,
        label: "DOC",
      };
    case "document":
      return {
        assetSrc: wordIconUrl,
        label: "DOC",
      };
    case "generic":
      return {
        label: "FILE",
        frame:
          "border-slate-500/30 bg-slate-500/10 text-slate-400 shadow-slate-950/20",
      };
    default:
      return {
        label: "IMG",
        frame:
          "border-blue-500/30 bg-blue-500/10 text-blue-300 shadow-blue-950/20",
      };
  }
}

function AttachmentAvatar({
  uploaderName,
  uploaderAvatarUrl,
  uploaderAvatarColor,
}: {
  uploaderName?: string | null;
  uploaderAvatarUrl?: string | null;
  uploaderAvatarColor?: string | null;
}) {
  if (!uploaderName) {
    return null;
  }

  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="max-w-24 truncate text-[10px] font-medium opacity-90">
        {uploaderName}
      </span>
      <div
        className={cn(
          "flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full text-[9px] font-black text-white ring-1 ring-white/12",
          !uploaderAvatarUrl && "border border-white/12",
        )}
        style={{
          backgroundColor: uploaderAvatarUrl
            ? undefined
            : uploaderAvatarColor || "#5b5bd6",
        }}
      >
        {uploaderAvatarUrl ? (
          <img
            src={buildAssetUrl(uploaderAvatarUrl)}
            alt={uploaderName}
            className="h-full w-full object-cover"
          />
        ) : (
          getInitials(uploaderName)
        )}
      </div>
    </div>
  );
}

function FileGlyph({
  label,
  kind,
}: {
  label: string;
  kind: ReturnType<typeof resolveAttachmentVisualKind>;
}) {
  const tokens = getVisualTokens(kind);

  return (
    <div className="relative h-19 w-14.5">
      {tokens.assetSrc ? (
        <img
          src={tokens.assetSrc}
          alt=""
          aria-hidden="true"
          className="h-full w-full object-contain drop-shadow-[0_10px_20px_rgba(0,0,0,0.14)]"
        />
      ) : (
        <div
          className={cn(
            "absolute inset-0 overflow-hidden rounded-[0.95rem] border shadow-lg",
            tokens.frame,
          )}
        >
          <svg
            viewBox="0 0 18 18"
            className="absolute right-px top-px h-4.5 w-4.5 opacity-90"
            aria-hidden="true"
          >
            <path
              d="M18 0v9c-5 0-9-4-9-9z"
              fill="currentColor"
              fillOpacity="0.16"
            />
            <path
              d="M18 0v9c-5 0-9-4-9-9"
              fill="none"
              stroke="currentColor"
              strokeOpacity="0.34"
              strokeWidth="1.05"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M17.7 0.3 9.75 0.3"
              fill="none"
              stroke="currentColor"
              strokeOpacity="0.14"
              strokeWidth="0.9"
              strokeLinecap="round"
            />
          </svg>
          <FileText className="absolute left-1/2 top-[1.05rem] h-4.5 w-4.5 -translate-x-1/2" />
          <span className="absolute inset-x-0 bottom-[0.7rem] text-center text-[9px] font-black uppercase tracking-[0.16em]">
            {label}
          </span>
        </div>
      )}
    </div>
  );
}

export function AttachmentCard({
  attachment,
  uploaderName,
  uploaderAvatarUrl,
  uploaderAvatarColor,
  statusLabel,
  badge,
  footer,
  actions,
  selectionControl,
  selectionControlVisible = false,
  onPreview,
  className,
}: AttachmentCardProps) {
  const extension = getAttachmentExtension(attachment.name);
  const baseName = getAttachmentBaseName(attachment.name);
  const visualKind = resolveAttachmentVisualKind({
    name: attachment.name,
    type: attachment.type,
    mimeType: attachment.mimeType,
  });
  const glyphLabel = (extension || getVisualTokens(visualKind).label)
    .slice(0, 4)
    .toUpperCase();
  const previewSource =
    visualKind === "image"
      ? attachment.previewUrl || (attachment.url ? buildAssetUrl(attachment.url) : "")
      : "";
  const metaLabel =
    [statusLabel, statusLabel ? formatAttachmentSize(attachment.size) : null]
      .filter(Boolean)
      .join(" · ") ||
    [
      formatAttachmentSize(attachment.size),
      formatAttachmentTimestamp(attachment.createdAt),
    ]
      .filter(Boolean)
      .join(" • ");

  return (
    <div
      className={cn(
        "group relative flex min-w-0 flex-col overflow-hidden rounded-2xl border transition-all",
        "border-(--ui-borda) bg-(--ui-superficie) shadow-[0_18px_40px_rgba(0,0,0,0.24)] shadow-[0_16px_32px_rgba(15,23,42,0.08)]",
        className,
      )}
    >
      {onPreview ? (
        <button
          type="button"
          onClick={onPreview}
          className="flex flex-col text-left cursor-pointer"
        >
          <div
            className={cn(
              "relative flex h-26 items-center justify-center overflow-hidden border-b",
              "border-(--ui-borda-suave) bg-(--ui-fundo-sutil)",
            )}
          >
            {previewSource ? (
              <img
                src={previewSource}
                alt={attachment.name}
                className="h-full w-full object-cover transition duration-200 group-hover:scale-[1.02]"
              />
            ) : (
              <FileGlyph label={glyphLabel} kind={visualKind} />
            )}
          </div>

          <div className="space-y-2.5 p-2.5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-1.5">
                  <p
                    className={cn(
                      "min-w-0 flex-1 truncate text-[12px] font-semibold leading-tight",
                      "text-(--ui-texto-principal)",
                    )}
                    title={attachment.name}
                  >
                    {baseName}
                  </p>
                  {extension && (
                    <span
                      className={cn(
                        "shrink-0 text-[11px] font-semibold lowercase",
                        "text-(--ui-texto-secundario)",
                      )}
                    >
                      .{extension}
                    </span>
                  )}
                </div>
              </div>
              {badge}
            </div>

            <div
              className={cn(
                "flex items-center justify-between gap-3 text-[10px]",
                "text-(--ui-texto-secundario)",
              )}
            >
              <span className="truncate">{metaLabel}</span>
              <AttachmentAvatar
                uploaderName={uploaderName}
                uploaderAvatarUrl={uploaderAvatarUrl}
                uploaderAvatarColor={uploaderAvatarColor}
              />
            </div>
          </div>
        </button>
      ) : (
        <>
          <div
            className={cn(
              "relative flex h-26 items-center justify-center overflow-hidden border-b",
              "border-(--ui-borda-suave) bg-(--ui-fundo-sutil)",
            )}
          >
            {previewSource ? (
              <img
                src={previewSource}
                alt={attachment.name}
                className="h-full w-full object-cover"
              />
            ) : (
              <FileGlyph label={glyphLabel} kind={visualKind} />
            )}
          </div>

          <div className="space-y-2.5 p-2.5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-1.5">
                  <p
                    className={cn(
                      "min-w-0 flex-1 truncate text-[12px] font-semibold leading-tight",
                      "text-(--ui-texto-principal)",
                    )}
                    title={attachment.name}
                  >
                    {baseName}
                  </p>
                  {extension && (
                    <span
                      className={cn(
                        "shrink-0 text-[11px] font-semibold lowercase",
                        "text-(--ui-texto-secundario)",
                      )}
                    >
                      .{extension}
                    </span>
                  )}
                </div>
              </div>
              {badge}
            </div>

            <div
              className={cn(
                "flex items-center justify-between gap-3 text-[10px]",
                "text-(--ui-texto-secundario)",
              )}
            >
              <span className="truncate">{metaLabel}</span>
              <AttachmentAvatar
                uploaderName={uploaderName}
                uploaderAvatarUrl={uploaderAvatarUrl}
                uploaderAvatarColor={uploaderAvatarColor}
              />
            </div>
          </div>
        </>
      )}

      {footer && <div className="px-2.5 pb-2.5">{footer}</div>}

      {selectionControl && (
        <div
          className={cn(
            "absolute left-2.5 top-2.5 z-10 transition-opacity",
            selectionControlVisible
              ? "opacity-100"
              : "opacity-100 lg:opacity-0 lg:group-hover:opacity-100",
          )}
        >
          {selectionControl}
        </div>
      )}

      {actions && (
        <div className="absolute right-2.5 top-2.5 z-10 flex items-center gap-1 opacity-100 transition-opacity lg:opacity-0 lg:group-hover:opacity-100">
          {actions}
        </div>
      )}
    </div>
  );
}
