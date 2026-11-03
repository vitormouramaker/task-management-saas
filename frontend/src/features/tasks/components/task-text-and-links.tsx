/**
 * Texto, menções e links dos cards: formatação da data da atividade, as
 * classes do texto com menção e as funções que controlam como cada link
 * aparece.
 *
 * Saiu da tela de detalhes do card junto com a lista de verificação.
 */
import { cn } from "../../../lib/utils";
import { renderTextWithMentionsAndLinks } from "../../../lib/task-mentions";
import { normalizeLinkUrl } from "../../../lib/link-preview";
import { normalizeTimestampDate } from "../../../lib/attachment-utils";
import type { LinkDisplayMode, Member } from "../../../types/tasks";

export function formatActivityDate(dateString: string) {
  const normalizedDate = normalizeTimestampDate(dateString);
  if (!normalizedDate) return "";
  return normalizedDate.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function getMentionChipClassName(
  _tone: "editor" | "content",
) {
  return cn(
    "font-semibold text-(--ui-azul-texto)",
  );
}

export function getLinkClassName() {
  return cn(
    "pointer-events-auto relative z-10 underline underline-offset-2 transition-colors wrap-anywhere",
    "text-(--ui-azul-texto) hover:text-(--ui-azul-texto)",
  );
}

export function stripRichTextPreservingBreaks(value?: string | null) {
  return (value || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p>/gi, "\n\n")
    .replace(/<\/?(?:p|div|li|ul|ol)>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\u00a0/g, " ")
    .trim();
}


export function removeUrlFromText(value: string, url: string) {
  const candidates = Array.from(
    new Set([
      url,
      url.replace(/^https?:\/\//, ""),
      url.replace(/^https:\/\//, "http://"),
      url.replace(/^http:\/\//, "https://"),
    ]),
  );

  for (const candidate of candidates) {
    if (value.includes(candidate)) {
      return value
        .replace(candidate, "")
        .replace(/\s{2,}/g, " ")
        .trim();
    }
  }

  return value;
}

export function replaceUrlInText(value: string, currentUrl: string, nextUrl: string) {
  const normalizedNextUrl = normalizeLinkUrl(nextUrl);
  if (!normalizedNextUrl) {
    return value;
  }

  const candidates = Array.from(
    new Set([
      currentUrl,
      currentUrl.replace(/^https?:\/\//, ""),
      currentUrl.replace(/^https:\/\//, "http://"),
      currentUrl.replace(/^http:\/\//, "https://"),
    ]),
  );

  for (const candidate of candidates) {
    if (value.includes(candidate)) {
      return value.replace(candidate, normalizedNextUrl);
    }
  }

  return value;
}

export function renameLinkDisplayModeKey(
  currentModes: Record<string, LinkDisplayMode> | undefined,
  currentUrl: string,
  nextUrl: string,
) {
  const nextModes = { ...(currentModes ?? {}) };
  const currentKey = normalizeLinkUrl(currentUrl);
  const nextKey = normalizeLinkUrl(nextUrl);
  const currentMode = nextModes[currentKey];
  delete nextModes[currentKey];
  if (currentMode) {
    nextModes[nextKey] = currentMode;
  }
  return nextModes;
}

export function removeLinkDisplayModeKey(
  currentModes: Record<string, LinkDisplayMode> | undefined,
  currentUrl: string,
) {
  const nextModes = { ...(currentModes ?? {}) };
  delete nextModes[normalizeLinkUrl(currentUrl)];
  return nextModes;
}

export function getLinkDisplayMode(
  linkDisplayModes: Record<string, LinkDisplayMode> | undefined,
  url: string,
) {
  return linkDisplayModes?.[normalizeLinkUrl(url)] ?? "preview";
}

export function getHiddenLinkUrlsForRender(
  urls: string[],
  linkDisplayModes?: Record<string, LinkDisplayMode>,
) {
  return urls.filter(
    (url) => getLinkDisplayMode(linkDisplayModes, url) !== "url",
  );
}

export function updateLinkDisplayModeMap(
  currentModes: Record<string, LinkDisplayMode> | undefined,
  url: string,
  mode: LinkDisplayMode,
) {
  return {
    ...(currentModes ?? {}),
    [normalizeLinkUrl(url)]: mode,
  };
}

export function MentionInputPreview({
  value,
  members,
  className,
  scrollTop,
  scrollLeft,
  hiddenUrls = [],
}: {
  value: string;
  members: Member[];
  className: string;
  scrollTop: number;
  scrollLeft: number;
  hiddenUrls?: string[];
}) {
  if (!value) return null;

  return (
    <div
      aria-hidden="true"
      className="absolute inset-0 overflow-hidden rounded-xl"
    >
      <div
        className={cn(
          "pointer-events-none min-h-full whitespace-pre-wrap wrap-anywhere",
          className,
        )}
        style={{
          transform:
            scrollTop || scrollLeft
              ? `translate(${-scrollLeft}px, ${-scrollTop}px)`
              : undefined,
        }}
      >
        {renderTextWithMentionsAndLinks(
          value,
          members,
          getMentionChipClassName("editor"),
          getLinkClassName(),
          hiddenUrls,
        )}
        <span className="opacity-0"> </span>
      </div>
    </div>
  );
}

