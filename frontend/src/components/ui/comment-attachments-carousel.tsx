import { useState } from "react";
import { Download, Loader2 } from "lucide-react";

import {
  downloadAttachmentArchive,
  downloadAttachmentFile,
  resolveAttachmentPreviewKind,
} from "../../lib/attachment-utils";
import { cn } from "../../lib/utils";
import { AttachmentCard } from "./attachment-card";
import { AttachmentCarousel } from "./attachment-carousel";
import { toast } from "../../store/use-toast-store";

interface CommentAttachmentsCarouselProps {
  attachments: Array<{
    id: string;
    name: string;
    url?: string | null;
    type?: string | null;
    mimeType?: string | null;
    size?: number | null;
    createdAt?: string | null;
    uploadedByName?: string | null;
    uploadedByAvatarUrl?: string | null;
    uploadedByAvatarColor?: string | null;
  }>;
  uploaderName?: string | null;
  uploaderAvatarUrl?: string | null;
  uploaderAvatarColor?: string | null;
  fallbackDate?: string | null;
  archiveName?: string | null;
  className?: string;
  onPreview?: (attachmentId: string) => void;
}

export function CommentAttachmentsCarousel({
  attachments,
  uploaderName,
  uploaderAvatarUrl,
  uploaderAvatarColor,
  fallbackDate,
  archiveName,
  className,
  onPreview,
}: CommentAttachmentsCarouselProps) {
  const [isDownloadingArchive, setIsDownloadingArchive] = useState(false);

  if (attachments.length === 0) {
    return null;
  }

  const downloadableAttachments = attachments.filter(
    (attachment) => attachment.url,
  );
  const canDownloadAll = downloadableAttachments.length > 1;

  async function handleDownloadAll() {
    if (isDownloadingArchive) return;

    setIsDownloadingArchive(true);
    try {
      await downloadAttachmentArchive({
        attachments: downloadableAttachments.map((attachment) => ({
          url: attachment.url,
          fileName: attachment.name,
        })),
        archiveName:
          archiveName?.trim() ||
          `anexos-comentario-${downloadableAttachments.length}.zip`,
      });
    } catch (error) {
      console.error("Erro ao baixar anexos do comentário:", error);
      toast.error("Não foi possível baixar os anexos.", {
        message: "Tente novamente em instantes.",
      });
    } finally {
      setIsDownloadingArchive(false);
    }
  }

  return (
    <div className={cn("space-y-2", className)}>
      {canDownloadAll && (
        <div className="flex items-center justify-between gap-2">
          <span
            className={cn(
              "text-[10px] font-semibold uppercase tracking-wide",
              "text-(--ui-texto-secundario)",
            )}
          >
            {attachments.length} anexos
          </span>
          <button
            type="button"
            onClick={() => void handleDownloadAll()}
            disabled={isDownloadingArchive}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition cursor-pointer disabled:cursor-not-allowed disabled:opacity-60",
              "border-(--ui-borda) text-(--ui-texto-forte) hover:bg-(--ui-hover-forte)",
            )}
            title="Baixar todos os anexos em um arquivo .zip"
          >
            {isDownloadingArchive ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            {isDownloadingArchive ? "Baixando..." : "Baixar tudo"}
          </button>
        </div>
      )}

      <AttachmentCarousel>
        {attachments.map((attachment) => {
          const canPreview = Boolean(
            resolveAttachmentPreviewKind({
              name: attachment.name,
              type: attachment.type,
              mimeType: attachment.mimeType,
            }),
          );

          return (
            <AttachmentCard
              key={attachment.id}
              attachment={{
                ...attachment,
                createdAt: attachment.createdAt || fallbackDate,
              }}
              uploaderName={attachment.uploadedByName || uploaderName}
              uploaderAvatarUrl={
                attachment.uploadedByAvatarUrl || uploaderAvatarUrl
              }
              uploaderAvatarColor={
                attachment.uploadedByAvatarColor || uploaderAvatarColor
              }
              className="w-56 shrink-0 snap-start"
              onPreview={
                canPreview && onPreview
                  ? () => onPreview(attachment.id)
                  : undefined
              }
              actions={
                attachment.url ? (
                  <button
                    type="button"
                    onClick={() =>
                      void downloadAttachmentFile({
                        url: attachment.url,
                        fileName: attachment.name,
                      })
                    }
                    className="grid h-7 w-7 place-items-center rounded-full bg-white text-slate-700 shadow-sm ring-1 ring-slate-200 transition hover:bg-blue-600 hover:text-white hover:ring-blue-600 cursor-pointer"
                    title="Baixar anexo"
                  >
                    <Download className="h-3.5 w-3.5" />
                  </button>
                ) : null
              }
            />
          );
        })}
      </AttachmentCarousel>
    </div>
  );
}
