import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  LoaderCircle,
  Minus,
  Plus,
  RotateCw,
  RotateCcw,
  X,
} from "lucide-react";
import { marked } from "marked";

import {
  downloadAttachmentFile,
  fetchAttachmentBlob,
  formatAttachmentSize,
  formatAttachmentTimestamp,
  getAttachmentExtension,
  resolveAttachmentPreviewKind,
  resolveAttachmentVisualKind,
} from "../../lib/attachment-utils";
import { buildAssetUrl } from "../../lib/api";
import { cn } from "../../lib/utils";

export interface AttachmentPreviewItem {
  id?: string;
  name: string;
  url?: string | null;
  previewUrl?: string | null;
  type?: string | null;
  mimeType?: string | null;
  createdAt?: string | null;
  size?: number | null;
}

interface AttachmentPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  attachments: AttachmentPreviewItem[];
  activeIndex: number;
  onChangeIndex: (index: number) => void;
  isDarkMode: boolean;
}

const IMAGE_DOUBLE_CLICK_ZOOM = 2.5;

export function AttachmentPreviewModal({
  isOpen,
  onClose,
  attachments,
  activeIndex,
  onChangeIndex,
  isDarkMode,
}: AttachmentPreviewModalProps) {
  const attachment = attachments[activeIndex] ?? null;
  const previewKind = useMemo(
    () =>
      attachment
        ? resolveAttachmentPreviewKind({
            name: attachment.name,
            type: attachment.type,
            mimeType: attachment.mimeType,
          })
        : null,
    [attachment],
  );
  const [isLoading, setIsLoading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [textPreview, setTextPreview] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [imageZoom, setImageZoom] = useState(1);
  const [imageRotation, setImageRotation] = useState(0);
  const [imageOffset, setImageOffset] = useState({ x: 0, y: 0 });
  const [isImageDragging, setIsImageDragging] = useState(false);
  const imageViewportRef = useRef<HTMLDivElement | null>(null);
  const touchZoomStateRef = useRef<{ distance: number; zoom: number } | null>(
    null,
  );
  const touchPanStateRef = useRef<{
    x: number;
    y: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const lastTouchTapRef = useRef<{
    time: number;
    x: number;
    y: number;
  } | null>(null);
  const pointerPanStateRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);

  const canGoPrevious = activeIndex > 0;
  const canGoNext = activeIndex < attachments.length - 1;
  const markdownPreviewHtml = useMemo(() => {
    if (previewKind !== "markdown" || !textPreview) {
      return "";
    }

    return marked.parse(sanitizeMarkdownInput(textPreview), {
      async: false,
      breaks: true,
      gfm: true,
    });
  }, [previewKind, textPreview]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }

      if (event.key === "ArrowLeft" && canGoPrevious) {
        event.preventDefault();
        onChangeIndex(activeIndex - 1);
        return;
      }

      if (event.key === "ArrowRight" && canGoNext) {
        event.preventDefault();
        onChangeIndex(activeIndex + 1);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeIndex, canGoNext, canGoPrevious, isOpen, onChangeIndex, onClose]);

  useEffect(() => {
    setImageZoom(1);
    setImageRotation(0);
    setImageOffset({ x: 0, y: 0 });
    setIsImageDragging(false);
    touchZoomStateRef.current = null;
    touchPanStateRef.current = null;
    lastTouchTapRef.current = null;
    pointerPanStateRef.current = null;
  }, [activeIndex, isOpen]);

  useEffect(() => {
    if (imageZoom <= 1) {
      setImageOffset({ x: 0, y: 0 });
      setIsImageDragging(false);
      touchPanStateRef.current = null;
      pointerPanStateRef.current = null;
    }
  }, [imageZoom]);

  useEffect(() => {
    const previewSource = attachment?.previewUrl || attachment?.url || null;

    if (!isOpen || !attachment || !previewSource || !previewKind) {
      setPreviewUrl(null);
      setTextPreview("");
      setErrorMessage(null);
      setIsLoading(false);
      return;
    }

    let revokedUrl: string | null = null;
    let isCancelled = false;

    setIsLoading(true);
    setErrorMessage(null);
    setPreviewUrl(null);
    setTextPreview("");

    void (async () => {
      try {
        const shouldUseDirectSource =
          Boolean(attachment.previewUrl) ||
          previewSource.startsWith("blob:") ||
          previewSource.startsWith("data:");

        if (
          shouldUseDirectSource &&
          (previewKind === "image" ||
            previewKind === "video" ||
            previewKind === "pdf")
        ) {
          setPreviewUrl(previewSource);
          setIsLoading(false);
          return;
        }

        const blob = shouldUseDirectSource
          ? await fetch(previewSource).then(async (response) => {
              if (!response.ok) {
                throw new Error("Falha ao carregar preview local.");
              }

              return response.blob();
            })
          : await fetchAttachmentBlob({
              url: attachment.url,
              fileName: attachment.name,
            });

        if (isCancelled) {
          return;
        }

        if (previewKind === "text" || previewKind === "markdown") {
          setTextPreview(await blob.text());
          setIsLoading(false);
          return;
        }

        revokedUrl = window.URL.createObjectURL(blob);
        setPreviewUrl(revokedUrl);
        setIsLoading(false);
      } catch (error) {
        if (isCancelled) {
          return;
        }

        console.error("Erro ao carregar preview do anexo:", error);
        setErrorMessage(
          "Não foi possível carregar a visualização deste anexo.",
        );
        setIsLoading(false);
      }
    })();

    return () => {
      isCancelled = true;
      if (revokedUrl) {
        window.URL.revokeObjectURL(revokedUrl);
      }
    };
  }, [attachment, isOpen, previewKind]);

  if (!isOpen || !attachment) {
    return null;
  }

  const handlePrevious = () => {
    if (!canGoPrevious) return;
    onChangeIndex(activeIndex - 1);
  };

  const handleNext = () => {
    if (!canGoNext) return;
    onChangeIndex(activeIndex + 1);
  };

  const handleImageWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (previewKind !== "image") {
      return;
    }

    event.preventDefault();

    const zoomDelta = event.deltaY > 0 ? -0.1 : 0.1;
    applyImageZoom(imageZoom + zoomDelta, {
      x: event.clientX,
      y: event.clientY,
    });
  };

  const handleImageDoubleClick = (
    event?: Pick<React.MouseEvent<HTMLDivElement>, "clientX" | "clientY">,
  ) => {
    if (previewKind !== "image") {
      return;
    }

    if (imageZoom > 1) {
      applyImageZoom(1);
      return;
    }

    applyImageZoom(
      IMAGE_DOUBLE_CLICK_ZOOM,
      event
        ? {
            x: event.clientX,
            y: event.clientY,
          }
        : undefined,
    );
  };

  const handleImageTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    if (previewKind !== "image") {
      touchZoomStateRef.current = null;
      touchPanStateRef.current = null;
      return;
    }

    if (event.touches.length === 2) {
      touchPanStateRef.current = null;
      touchZoomStateRef.current = {
        distance: getTouchDistance(event.touches),
        zoom: imageZoom,
      };
      return;
    }

    touchZoomStateRef.current = null;

    if (event.touches.length === 1) {
      const now = Date.now();
      const touch = event.touches[0];
      const previousTap = lastTouchTapRef.current;
      const isDoubleTap =
        previousTap &&
        now - previousTap.time <= 280 &&
        Math.hypot(
          touch.clientX - previousTap.x,
          touch.clientY - previousTap.y,
        ) <= 24;

      if (isDoubleTap) {
        event.preventDefault();
        touchPanStateRef.current = null;
        lastTouchTapRef.current = null;
        handleImageDoubleClick({
          clientX: touch.clientX,
          clientY: touch.clientY,
        });
        return;
      }

      lastTouchTapRef.current = {
        time: now,
        x: touch.clientX,
        y: touch.clientY,
      };
    }

    if (event.touches.length === 1 && imageZoom > 1) {
      touchPanStateRef.current = {
        x: event.touches[0].clientX,
        y: event.touches[0].clientY,
        offsetX: imageOffset.x,
        offsetY: imageOffset.y,
      };
    }
  };

  const handleImageTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    if (previewKind !== "image") {
      return;
    }

    if (event.touches.length === 1 && imageZoom > 1) {
      const panState = touchPanStateRef.current;
      if (!panState) {
        return;
      }

      event.preventDefault();

      setImageOffset(
        clampImageOffset(
          {
            x: panState.offsetX + event.touches[0].clientX - panState.x,
            y: panState.offsetY + event.touches[0].clientY - panState.y,
          },
          imageViewportRef.current,
          imageZoom,
        ),
      );
      return;
    }

    if (event.touches.length !== 2) {
      return;
    }

    const currentGesture = touchZoomStateRef.current;
    if (!currentGesture) {
      return;
    }

    event.preventDefault();

    const nextDistance = getTouchDistance(event.touches);
    if (!nextDistance || !currentGesture.distance) {
      return;
    }

    const ratio = nextDistance / currentGesture.distance;
    setImageZoom(clampImageZoom(currentGesture.zoom * ratio));
  };

  const handleImageTouchEnd = () => {
    if (touchZoomStateRef.current && imageZoom <= 1) {
      setImageOffset({ x: 0, y: 0 });
    }

    touchZoomStateRef.current = null;
    touchPanStateRef.current = null;
  };

  const applyImageZoom = (
    nextZoomValue: number,
    anchorClientPoint?: { x: number; y: number },
  ) => {
    const nextZoom = clampImageZoom(nextZoomValue);
    const viewport = imageViewportRef.current;

    if (nextZoom <= 1 || !viewport) {
      setImageZoom(1);
      setImageOffset({ x: 0, y: 0 });
      return;
    }

    if (!anchorClientPoint) {
      setImageZoom(nextZoom);
      setImageOffset(clampImageOffset(imageOffset, viewport, nextZoom));
      return;
    }

    const nextOffset = clampImageOffset(
      calculateAnchoredImageOffset({
        anchor: getViewportAnchorPoint(viewport, anchorClientPoint),
        offset: imageOffset,
        currentZoom: imageZoom,
        nextZoom,
        rotation: imageRotation,
      }),
      viewport,
      nextZoom,
    );

    setImageZoom(nextZoom);
    setImageOffset(nextOffset);
  };

  const handleImagePointerDown = (
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    if (
      previewKind !== "image" ||
      imageZoom <= 1 ||
      event.pointerType === "touch" ||
      event.detail > 1
    ) {
      return;
    }

    event.preventDefault();

    pointerPanStateRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      offsetX: imageOffset.x,
      offsetY: imageOffset.y,
    };
    imageViewportRef.current?.setPointerCapture(event.pointerId);
    setIsImageDragging(true);
  };

  const handleImagePointerMove = (
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    const pointerState = pointerPanStateRef.current;
    if (
      previewKind !== "image" ||
      !pointerState ||
      pointerState.pointerId !== event.pointerId
    ) {
      return;
    }

    event.preventDefault();

    setImageOffset(
      clampImageOffset(
        {
          x: pointerState.offsetX + event.clientX - pointerState.x,
          y: pointerState.offsetY + event.clientY - pointerState.y,
        },
        imageViewportRef.current,
        imageZoom,
      ),
    );
  };

  const finishImagePointerDrag = (pointerId?: number) => {
    if (
      pointerId !== undefined &&
      pointerPanStateRef.current?.pointerId === pointerId
    ) {
      imageViewportRef.current?.releasePointerCapture(pointerId);
    }

    pointerPanStateRef.current = null;
    setIsImageDragging(false);
  };

  const isImagePreviewReady =
    previewKind === "image" && !isLoading && !errorMessage;

  const metaLabel = [
    formatAttachmentSize(attachment.size),
    formatAttachmentTimestamp(attachment.createdAt),
  ]
    .filter(Boolean)
    .join(" • ");

  return createPortal(
    <div className="fixed inset-0 z-260 flex items-center justify-center p-3 sm:p-6">
      <div
        className="pauta-theme-overlay absolute inset-0 backdrop-blur-sm"
        onClick={onClose}
      />

      <div
        className={cn(
          "relative flex h-[min(92vh,56rem)] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border",
          "border-(--ui-borda) bg-(--ui-superficie) shadow-[0_24px_80px_rgba(0,0,0,0.45)] shadow-[0_24px_80px_rgba(15,23,42,0.18)]",
        )}
        onClick={(event) => event.stopPropagation()}
      >
        <div
          className={cn(
            "flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3 sm:px-5",
            "border-(--ui-borda-suave)",
          )}
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <FileText
                className={cn(
                  "h-4 w-4 shrink-0",
                  "text-(--ui-azul-texto)",
                )}
              />
              <h3
                className={cn(
                  "truncate text-sm font-semibold sm:text-base",
                  "text-(--ui-texto-principal)",
                )}
                title={attachment.name}
              >
                {attachment.name}
              </h3>
            </div>
            {metaLabel && (
              <p
                className={cn(
                  "mt-1 text-[11px]",
                  "text-(--ui-texto-secundario)",
                )}
              >
                {metaLabel}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 max-sm:w-full">
            {attachments.length > 1 && (
              <div className="inline-flex items-center gap-2 rounded-full px-3 py-2 text-[12px] font-semibold ring-1 ring-inset sm:order-1">
                <span
                  className={cn(
                    "text-(--ui-texto-secundario) ring-(--ui-borda)",
                  )}
                >
                  {activeIndex + 1} de {attachments.length}
                </span>
              </div>
            )}

            {isImagePreviewReady && (
              <div className="flex items-center gap-2 sm:order-2">
                <button
                  type="button"
                  onClick={() => applyImageZoom(imageZoom - 0.25)}
                  className={cn(
                    "grid h-9 w-9 place-items-center rounded-full transition cursor-pointer",
                    "bg-(--ui-fundo-neutro) text-(--ui-texto-secundario) hover:bg-(--ui-hover-forte) hover:text-(--ui-texto-forte)",
                  )}
                  title="Diminuir zoom"
                >
                  <Minus className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    applyImageZoom(1);
                    setImageRotation(0);
                  }}
                  className={cn(
                    "inline-flex h-9 items-center rounded-full px-3 text-[12px] font-semibold transition cursor-pointer",
                    "bg-(--ui-fundo-neutro) text-(--ui-texto-forte) hover:bg-(--ui-hover-forte)",
                  )}
                  title="Resetar visualização"
                >
                  <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                  {Math.round(imageZoom * 100)}%
                </button>
                <button
                  type="button"
                  onClick={() => applyImageZoom(imageZoom + 0.25)}
                  className={cn(
                    "grid h-9 w-9 place-items-center rounded-full transition cursor-pointer",
                    "bg-(--ui-fundo-neutro) text-(--ui-texto-secundario) hover:bg-(--ui-hover-forte) hover:text-(--ui-texto-forte)",
                  )}
                  title="Aumentar zoom"
                >
                  <Plus className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setImageRotation(
                      (current) => (((current + 90) % 360) + 360) % 360,
                    )
                  }
                  className={cn(
                    "grid h-9 w-9 place-items-center rounded-full transition cursor-pointer",
                    "bg-(--ui-fundo-neutro) text-(--ui-texto-secundario) hover:bg-(--ui-hover-forte) hover:text-(--ui-texto-forte)",
                  )}
                  title="Rotacionar imagem"
                >
                  <RotateCw className="h-4 w-4" />
                </button>
              </div>
            )}

            {attachments.length > 1 && (
              <div className="flex items-center gap-2 sm:order-3">
                <button
                  type="button"
                  onClick={handlePrevious}
                  disabled={!canGoPrevious}
                  className={cn(
                    "grid h-9 w-9 place-items-center rounded-full transition cursor-pointer",
                    !canGoPrevious && "cursor-not-allowed opacity-50",
                    "bg-(--ui-fundo-neutro) text-(--ui-texto-secundario) hover:bg-(--ui-hover-forte) hover:text-(--ui-texto-forte)",
                  )}
                  title="Anexo anterior"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span
                  className={cn(
                    "min-w-14 text-center text-[12px] font-semibold sm:hidden",
                    "text-(--ui-texto-secundario)",
                  )}
                >
                  {activeIndex + 1}/{attachments.length}
                </span>
                <button
                  type="button"
                  onClick={handleNext}
                  disabled={!canGoNext}
                  className={cn(
                    "grid h-9 w-9 place-items-center rounded-full transition cursor-pointer",
                    !canGoNext && "cursor-not-allowed opacity-50",
                    "bg-(--ui-fundo-neutro) text-(--ui-texto-secundario) hover:bg-(--ui-hover-forte) hover:text-(--ui-texto-forte)",
                  )}
                  title="Próximo anexo"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            )}

            {!!attachment.url && (
              <button
                type="button"
                onClick={() =>
                  void downloadAttachmentFile({
                    url: attachment.url,
                    fileName: attachment.name,
                  })
                }
                className={cn(
                  "inline-flex h-9 items-center gap-2 rounded-full px-4 text-[12px] font-semibold transition cursor-pointer sm:order-4",
                  "bg-(--ui-superficie-suave) text-(--ui-texto-forte) ring-1 ring-(--ui-borda) hover:bg-(--ui-azul-fundo) hover:text-(--ui-azul-texto) hover:ring-(--ui-azul-borda)",
                )}
              >
                <Download className="h-3.5 w-3.5" />
                Baixar
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              className={cn(
                "grid h-9 w-9 place-items-center rounded-full transition cursor-pointer sm:order-5",
                "bg-(--ui-fundo-neutro) text-(--ui-texto-secundario) hover:bg-(--ui-hover-forte) hover:text-(--ui-texto-forte)",
              )}
            

              aria-label="Fechar"

              title="Fechar"

            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div
          className={cn(
            "relative flex min-h-0 flex-1 items-center justify-center p-4 sm:p-6",
            "bg-(--ui-fundo-sutil)",
          )}
        >
          {attachments.length > 1 && (
            <>
              <button
                type="button"
                onClick={handlePrevious}
                disabled={!canGoPrevious}
                className={cn(
                  "absolute left-3 top-1/2 z-10 hidden h-11 w-11 -translate-y-1/2 place-items-center rounded-full backdrop-blur-sm transition cursor-pointer sm:grid",
                  !canGoPrevious && "cursor-not-allowed opacity-35",
                  isDarkMode
                    ? "bg-black/40 text-white hover:bg-black/55"
                    : "bg-white/80 text-slate-700 shadow-lg hover:bg-white",
                )}
                title="Anexo anterior"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={handleNext}
                disabled={!canGoNext}
                className={cn(
                  "absolute right-3 top-1/2 z-10 hidden h-11 w-11 -translate-y-1/2 place-items-center rounded-full backdrop-blur-sm transition cursor-pointer sm:grid",
                  !canGoNext && "cursor-not-allowed opacity-35",
                  isDarkMode
                    ? "bg-black/40 text-white hover:bg-black/55"
                    : "bg-white/80 text-slate-700 shadow-lg hover:bg-white",
                )}
                title="Próximo anexo"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </>
          )}

          {isLoading ? (
            <div
              className={cn(
                "flex flex-col items-center gap-3 text-sm",
                "text-(--ui-texto-secundario)",
              )}
            >
              <LoaderCircle className="h-6 w-6 animate-spin" />
              Carregando visualização...
            </div>
          ) : errorMessage ? (
            <div
              className={cn(
                "max-w-md text-center text-sm",
                "text-(--ui-texto-secundario)",
              )}
            >
              {errorMessage}
            </div>
          ) : previewKind === "image" && previewUrl ? (
            <div
              ref={imageViewportRef}
              className={cn(
                "flex h-full w-full items-center justify-center overflow-hidden rounded-2xl",
                imageZoom > 1
                  ? isImageDragging
                    ? "cursor-grabbing"
                    : "cursor-grab"
                  : "cursor-default",
              )}
              onWheel={handleImageWheel}
              onTouchStart={handleImageTouchStart}
              onTouchMove={handleImageTouchMove}
              onTouchEnd={handleImageTouchEnd}
              onPointerDown={handleImagePointerDown}
              onPointerMove={handleImagePointerMove}
              onPointerUp={(event) => finishImagePointerDrag(event.pointerId)}
              onPointerCancel={(event) =>
                finishImagePointerDrag(event.pointerId)
              }
              onDoubleClick={handleImageDoubleClick}
              style={{ touchAction: "none" }}
            >
              <img
                src={previewUrl}
                alt={attachment.name}
                className="max-h-full max-w-full rounded-2xl object-contain shadow-[0_18px_50px_rgba(0,0,0,0.25)] transition-transform duration-200"
                style={{
                  transform: `translate(${imageOffset.x}px, ${imageOffset.y}px) scale(${imageZoom}) rotate(${imageRotation}deg)`,
                }}
              />

              {imageZoom > 1 && (
                <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2">
                  <div
                    className={cn(
                      "rounded-full px-3 py-1.5 text-[11px] font-semibold backdrop-blur-md",
                      isDarkMode
                        ? "bg-black/45 text-white ring-1 ring-white/10"
                        : "bg-white/88 text-slate-700 ring-1 ring-slate-200/80 shadow-sm",
                    )}
                  >
                    Arraste para mover
                  </div>
                </div>
              )}
            </div>
          ) : previewKind === "video" && previewUrl ? (
            <video
              src={previewUrl}
              controls
              className="max-h-full max-w-full rounded-2xl bg-black shadow-[0_18px_50px_rgba(0,0,0,0.25)]"
            />
          ) : previewKind === "pdf" && previewUrl ? (
            <iframe
              src={previewUrl}
              title={attachment.name}
              className="h-full min-h-0 w-full rounded-2xl border-0 bg-white shadow-[0_18px_50px_rgba(0,0,0,0.12)]"
            />
          ) : previewKind === "markdown" ? (
            <div
              className={cn(
                "h-full w-full overflow-auto rounded-2xl border p-4 sm:p-6",
                "border-(--ui-borda) bg-(--ui-superficie)",
              )}
            >
              <article
                className={cn(
                  "mx-auto max-w-4xl [&_a]:font-semibold [&_a]:text-blue-600 [&_blockquote]:my-4 [&_blockquote]:border-l-4 [&_blockquote]:pl-4 [&_code]:rounded [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.95em] [&_em]:italic [&_h1]:mt-0 [&_h1]:text-3xl [&_h1]:font-black [&_h2]:mt-8 [&_h2]:text-2xl [&_h2]:font-bold [&_h3]:mt-6 [&_h3]:text-xl [&_h3]:font-bold [&_hr]:my-6 [&_img]:max-w-full [&_img]:rounded-xl [&_li]:ml-5 [&_li]:list-disc [&_ol]:space-y-2 [&_p]:my-4 [&_pre]:my-4 [&_pre]:overflow-auto [&_pre]:rounded-2xl [&_pre]:p-4 [&_pre]:font-mono [&_pre]:text-[12px] [&_strong]:font-bold [&_table]:my-4 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:px-3 [&_td]:py-2 [&_th]:border [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_ul]:space-y-2",
                  isDarkMode
                    ? "text-(--text-main) [&_blockquote]:border-blue-500/35 [&_blockquote]:text-(--text-soft) [&_code]:bg-white/8 [&_pre]:bg-(--bg-sunken) [&_td]:border-(--border-subtle) [&_th]:border-(--border-subtle)"
                    : "text-slate-700 [&_blockquote]:border-blue-200 [&_blockquote]:text-slate-500 [&_code]:bg-slate-100 [&_pre]:bg-slate-950 [&_pre]:text-slate-100 [&_td]:border-slate-200 [&_th]:border-slate-200",
                )}
                dangerouslySetInnerHTML={{ __html: markdownPreviewHtml }}
              />
            </div>
          ) : previewKind === "text" ? (
            <div
              className={cn(
                "h-full w-full overflow-auto rounded-2xl border p-4 sm:p-5",
                "border-(--ui-borda) bg-(--ui-superficie)",
              )}
            >
              <pre
                className={cn(
                  "whitespace-pre-wrap wrap-break-word font-mono text-[12px] leading-6 sm:text-[13px]",
                  "text-(--ui-texto-forte)",
                )}
              >
                {textPreview}
              </pre>
            </div>
          ) : (
            <div
              className={cn(
                "max-w-md text-center text-sm",
                "text-(--ui-texto-secundario)",
              )}
            >
              Este tipo de anexo não possui visualização embutida.
            </div>
          )}
        </div>

        {attachments.length > 1 && (
          <div
            className={cn(
              "border-t px-3 py-3 sm:px-4",
              "border-(--ui-borda-suave) bg-(--ui-fundo-sutil)",
            )}
          >
            <div className="flex gap-2 overflow-x-auto pb-1">
              {attachments.map((item, index) => {
                const thumbnailVisualKind = resolveAttachmentVisualKind({
                  name: item.name,
                  type: item.type,
                  mimeType: item.mimeType,
                });
                const extensionLabel = (
                  getAttachmentExtension(item.name) ||
                  item.type ||
                  "file"
                )
                  .slice(0, 4)
                  .toUpperCase();
                const isActive = index === activeIndex;

                return (
                  <button
                    key={item.id || `${item.name}-${index}`}
                    type="button"
                    onClick={() => onChangeIndex(index)}
                    className={cn(
                      "group shrink-0 overflow-hidden rounded-2xl border p-1.5 text-left transition cursor-pointer",
                      isActive
                        ? "border-(--ui-azul-borda) bg-(--ui-azul-fundo)"
                        : "border-(--ui-borda) bg-(--ui-superficie-suave) hover:border-(--ui-azul-borda)",
                    )}
                  >
                    <div className="flex w-20 flex-col gap-2 sm:w-24">
                      <div
                        className={cn(
                          "flex h-12 items-center justify-center overflow-hidden rounded-xl",
                          "bg-(--ui-fundo-neutro)",
                        )}
                      >
                        {thumbnailVisualKind === "image" && item.url ? (
                          <img
                            src={buildAssetUrl(item.url)}
                            alt={item.name}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div
                            className={cn(
                              "flex h-full w-full items-center justify-center text-[10px] font-black uppercase tracking-[0.18em]",
                              "text-(--ui-texto-secundario)",
                            )}
                          >
                            {extensionLabel}
                          </div>
                        )}
                      </div>
                      <div>
                        <p
                          className={cn(
                            "truncate text-[11px] font-semibold",
                            "text-(--ui-texto-principal)",
                          )}
                          title={item.name}
                        >
                          {item.name}
                        </p>
                        <p
                          className={cn(
                            "mt-0.5 text-[10px]",
                            "text-(--ui-texto-secundario)",
                          )}
                        >
                          {index + 1} de {attachments.length}
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

function clampImageZoom(value: number) {
  return Math.max(0.5, Math.min(4, Number(value.toFixed(3))));
}

function getViewportAnchorPoint(
  viewport: HTMLDivElement,
  anchorClientPoint: { x: number; y: number },
) {
  const rect = viewport.getBoundingClientRect();

  return {
    x: anchorClientPoint.x - rect.left - rect.width / 2,
    y: anchorClientPoint.y - rect.top - rect.height / 2,
  };
}

function calculateAnchoredImageOffset(input: {
  anchor: { x: number; y: number };
  offset: { x: number; y: number };
  currentZoom: number;
  nextZoom: number;
  rotation: number;
}) {
  const normalizedZoom = input.currentZoom <= 0 ? 1 : input.currentZoom;
  const localPoint = rotatePoint(
    {
      x: (input.anchor.x - input.offset.x) / normalizedZoom,
      y: (input.anchor.y - input.offset.y) / normalizedZoom,
    },
    -input.rotation,
  );

  const nextScreenPoint = rotatePoint(
    {
      x: localPoint.x * input.nextZoom,
      y: localPoint.y * input.nextZoom,
    },
    input.rotation,
  );

  return {
    x: input.anchor.x - nextScreenPoint.x,
    y: input.anchor.y - nextScreenPoint.y,
  };
}

function clampImageOffset(
  offset: { x: number; y: number },
  viewport: HTMLDivElement | null,
  zoom: number,
) {
  if (!viewport || zoom <= 1) {
    return { x: 0, y: 0 };
  }

  const maxX = Math.max(
    0,
    (viewport.clientWidth * zoom - viewport.clientWidth) / 2,
  );
  const maxY = Math.max(
    0,
    (viewport.clientHeight * zoom - viewport.clientHeight) / 2,
  );

  return {
    x: Math.max(-maxX, Math.min(maxX, offset.x)),
    y: Math.max(-maxY, Math.min(maxY, offset.y)),
  };
}

function getTouchDistance(touches: React.TouchList) {
  if (touches.length < 2) {
    return 0;
  }

  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.hypot(dx, dy);
}

function rotatePoint(point: { x: number; y: number }, angleInDegrees: number) {
  const angleInRadians = (angleInDegrees * Math.PI) / 180;
  const cos = Math.cos(angleInRadians);
  const sin = Math.sin(angleInRadians);

  return {
    x: point.x * cos - point.y * sin,
    y: point.x * sin + point.y * cos,
  };
}

function sanitizeMarkdownInput(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;");
}
