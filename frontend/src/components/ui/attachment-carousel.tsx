import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type WheelEvent,
} from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "../../lib/utils";

interface AttachmentCarouselProps {
  className?: string;
  trackClassName?: string;
  children: ReactNode;
}

export function AttachmentCarousel({
  className,
  trackClassName,
  children,
}: AttachmentCarouselProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const syncArrows = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    const maxScroll = track.scrollWidth - track.clientWidth;
    setCanScrollLeft(track.scrollLeft > 4);
    setCanScrollRight(track.scrollLeft < maxScroll - 4);
  }, []);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;

    syncArrows();

    const resizeObserver = new ResizeObserver(syncArrows);
    resizeObserver.observe(track);

    const mutationObserver = new MutationObserver(syncArrows);
    mutationObserver.observe(track, { childList: true, subtree: true });

    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, [syncArrows]);

  const scrollByStep = useCallback((direction: 1 | -1) => {
    const track = trackRef.current;
    if (!track) return;
    const step = Math.max(track.clientWidth * 0.8, 180);
    track.scrollBy({ left: direction * step, behavior: "smooth" });
  }, []);

  const handleWheel = useCallback((event: WheelEvent<HTMLDivElement>) => {
    const track = trackRef.current;
    if (!track) return;
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    const maxScroll = track.scrollWidth - track.clientWidth;
    if (maxScroll <= 0) return;
    track.scrollLeft += event.deltaY;
  }, []);

  const arrowClass = cn(
    "absolute top-1/2 z-10 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full border shadow-sm transition cursor-pointer",
    "border-(--ui-borda) bg-(--ui-superficie-suave) text-(--ui-texto-secundario) hover:bg-(--ui-hover-forte)",
  );

  return (
    <div className={cn("relative", className)}>
      <div
        ref={trackRef}
        onScroll={syncArrows}
        onWheel={handleWheel}
        className={cn(
          "flex snap-x snap-mandatory gap-2 overflow-x-auto overflow-y-hidden pb-1 [-ms-overflow-style:none] [scrollbar-width:thin]",
          trackClassName,
        )}
      >
        {children}
      </div>

      {canScrollLeft && (
        <button
          type="button"
          onClick={() => scrollByStep(-1)}
          className={cn(arrowClass, "left-1")}
          title="Anexos anteriores"
          aria-label="Anexos anteriores"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      )}

      {canScrollRight && (
        <button
          type="button"
          onClick={() => scrollByStep(1)}
          className={cn(arrowClass, "right-1")}
          title="Próximos anexos"
          aria-label="Próximos anexos"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
