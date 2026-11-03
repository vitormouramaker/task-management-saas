import type { LinkDisplayMode } from "../types/tasks";

const URL_PATTERN = /(?:https?:\/\/|www\.)[^\s<]+/g;
const TRAILING_URL_PUNCTUATION = /[.,!?;:]+$/;

export interface LinkPreviewMeta {
  url: string;
  href: string;
  hostname: string;
  hostnameLabel: string;
  title: string;
  subtitle?: string;
  thumbnailUrl?: string | null;
  faviconUrls: string[];
  brandColor: string;
  brandSurfaceColor: string;
}

const BRAND_PRESETS: Array<{
  pattern: RegExp;
  brandColor: string;
  brandSurfaceColor: string;
}> = [
  {
    pattern: /(^|\.)youtube\.com$|(^|\.)youtu\.be$/,
    brandColor: "#ff0033",
    brandSurfaceColor: "#ffe3ea",
  },
  {
    pattern: /(^|\.)github\.com$/,
    brandColor: "#24292f",
    brandSurfaceColor: "#e5e7eb",
  },
  {
    pattern: /(^|\.)figma\.com$/,
    brandColor: "#f24e1e",
    brandSurfaceColor: "#ffe8df",
  },
  {
    pattern: /(^|\.)notion\.so$/,
    brandColor: "#111111",
    brandSurfaceColor: "#ededed",
  },
  {
    pattern: /(^|\.)linkedin\.com$/,
    brandColor: "#0a66c2",
    brandSurfaceColor: "#deedff",
  },
  {
    pattern: /(^|\.)x\.com$|(^|\.)twitter\.com$/,
    brandColor: "#111827",
    brandSurfaceColor: "#e5e7eb",
  },
  {
    pattern: /(^|\.)drive\.google\.com$|(^|\.)docs\.google\.com$/,
    brandColor: "#1a73e8",
    brandSurfaceColor: "#e0ecff",
  },
  {
    pattern: /(^|\.)vercel\.com$/,
    brandColor: "#111111",
    brandSurfaceColor: "#ededed",
  },
];

const FALLBACK_BRAND_PALETTE = [
  { brandColor: "#2563eb", brandSurfaceColor: "#dbeafe" },
  { brandColor: "#0891b2", brandSurfaceColor: "#cffafe" },
  { brandColor: "#7c3aed", brandSurfaceColor: "#ede9fe" },
  { brandColor: "#ea580c", brandSurfaceColor: "#ffedd5" },
  { brandColor: "#dc2626", brandSurfaceColor: "#fee2e2" },
  { brandColor: "#059669", brandSurfaceColor: "#d1fae5" },
];

function trimTrailingPunctuation(value: string) {
  return value.replace(TRAILING_URL_PUNCTUATION, "");
}

function hashString(value: string) {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }

  return Math.abs(hash);
}

function getBrandTheme(hostname: string) {
  const preset = BRAND_PRESETS.find(({ pattern }) => pattern.test(hostname));
  if (preset) {
    return {
      brandColor: preset.brandColor,
      brandSurfaceColor: preset.brandSurfaceColor,
    };
  }

  return FALLBACK_BRAND_PALETTE[
    hashString(hostname) % FALLBACK_BRAND_PALETTE.length
  ];
}

function getFaviconUrls(url: URL, href: string) {
  const originFaviconUrl = `${url.protocol}//${url.hostname}/favicon.ico`;

  return Array.from(
    new Set([
      originFaviconUrl,
      `https://icon.horse/icon/${url.hostname}`,
      `https://www.google.com/s2/favicons?sz=128&domain_url=${encodeURIComponent(href)}`,
    ]),
  );
}

export function normalizeLinkUrl(value: string) {
  const cleanedValue = trimTrailingPunctuation(value.trim());
  if (!cleanedValue) return "";
  return cleanedValue.startsWith("http://") ||
    cleanedValue.startsWith("https://")
    ? cleanedValue
    : `https://${cleanedValue}`;
}

export function extractUrlsFromText(text: string) {
  if (!text) return [];

  const matches = text.match(URL_PATTERN) ?? [];
  return Array.from(
    new Set(matches.map((match) => normalizeLinkUrl(match)).filter(Boolean)),
  );
}

export function getManagedLinkUrls(
  text: string,
  linkDisplayModes?: Record<string, LinkDisplayMode>,
) {
  return Array.from(
    new Set(
      [...Object.keys(linkDisplayModes ?? {}), ...extractUrlsFromText(text)]
        .map((url) => normalizeLinkUrl(url))
        .filter(Boolean),
    ),
  );
}

export function stripLinkUrlsFromText(text: string) {
  if (!text) return text;

  const matches = text.match(URL_PATTERN) ?? [];
  if (matches.length === 0) {
    return text;
  }

  const normalizedLines = text
    .split(/\r?\n/)
    .map((line) => {
      const nextLine = line
        .replace(URL_PATTERN, (match) => {
          const cleanedMatch = trimTrailingPunctuation(match);
          return match.slice(cleanedMatch.length);
        })
        .replace(/[ \t]{2,}/g, " ")
        .replace(/\s+([.,!?;:])/g, "$1")
        .trimEnd();

      return {
        text: nextLine,
        wasBlank: line.trim().length === 0,
      };
    })
    .reduce<string[]>((accumulator, line) => {
      if (line.text.trim().length === 0) {
        if (!line.wasBlank) {
          return accumulator;
        }

        if (
          accumulator.length === 0 ||
          accumulator[accumulator.length - 1] === ""
        ) {
          return accumulator;
        }

        accumulator.push("");
        return accumulator;
      }

      accumulator.push(line.text);
      return accumulator;
    }, []);

  return normalizedLines.join("\n").trim();
}

export function extractManagedLinksFromText(
  text: string,
  linkDisplayModes?: Record<string, LinkDisplayMode>,
) {
  const urls = getManagedLinkUrls(text, linkDisplayModes);

  if (urls.length === 0) {
    return {
      text,
      urls,
      linkDisplayModes: linkDisplayModes ?? {},
    };
  }

  const nextLinkDisplayModes = { ...(linkDisplayModes ?? {}) };

  urls.forEach((url) => {
    nextLinkDisplayModes[url] = nextLinkDisplayModes[url] ?? "preview";
  });

  return {
    text: stripLinkUrlsFromText(text),
    urls,
    linkDisplayModes: nextLinkDisplayModes,
  };
}

function getYoutubeVideoId(url: URL) {
  if (url.hostname.includes("youtu.be")) {
    return url.pathname.replace(/^\/+/, "").split("/")[0] || null;
  }

  if (url.hostname.includes("youtube.com")) {
    return url.searchParams.get("v");
  }

  return null;
}

export function getLinkPreviewMeta(rawUrl: string): LinkPreviewMeta | null {
  const href = normalizeLinkUrl(rawUrl);
  if (!href) return null;

  try {
    const parsedUrl = new URL(href);
    const hostname = parsedUrl.hostname.toLowerCase();
    const hostnameLabel = hostname.replace(/^www\./, "");
    const pathname = parsedUrl.pathname.replace(/\/+$/, "");
    const lastPathSegment = pathname.split("/").filter(Boolean).at(-1);
    const brandTheme = getBrandTheme(hostnameLabel);
    const faviconUrls = getFaviconUrls(parsedUrl, href);

    const youtubeVideoId = getYoutubeVideoId(parsedUrl);
    if (youtubeVideoId) {
      return {
        url: rawUrl,
        href,
        hostname,
        hostnameLabel: "youtube.com",
        title: "YouTube",
        subtitle:
          parsedUrl.pathname === "/" ? undefined : pathname || undefined,
        thumbnailUrl: `https://i.ytimg.com/vi/${youtubeVideoId}/hqdefault.jpg`,
        faviconUrls,
        brandColor: brandTheme.brandColor,
        brandSurfaceColor: brandTheme.brandSurfaceColor,
      };
    }

    const hostnameParts = hostnameLabel.split(".");
    const titleBase =
      hostnameParts.length > 1
        ? hostnameParts[hostnameParts.length - 2]
        : hostnameLabel;
    const title = titleBase.charAt(0).toUpperCase() + titleBase.slice(1);

    return {
      url: rawUrl,
      href,
      hostname,
      hostnameLabel,
      title,
      subtitle: lastPathSegment
        ? decodeURIComponent(lastPathSegment)
        : undefined,
      thumbnailUrl: null,
      faviconUrls,
      brandColor: brandTheme.brandColor,
      brandSurfaceColor: brandTheme.brandSurfaceColor,
    };
  } catch {
    return null;
  }
}
