import type { ReactNode } from "react";

import { normalizeLinkUrl } from "./link-preview";
import type { Member } from "../types/tasks";

export interface MentionTrigger {
  start: number;
  end: number;
  query: string;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const URL_PATTERN = /(?:https?:\/\/|www\.)[^\s<]+/;
const TRAILING_URL_PUNCTUATION = /[.,!?;:]+$/;

function splitUrlSuffix(value: string) {
  const trimmedValue = value.replace(TRAILING_URL_PUNCTUATION, "");
  return {
    url: trimmedValue,
    suffix: value.slice(trimmedValue.length),
  };
}

function normalizeUrlHref(value: string) {
  return value.startsWith("http://") || value.startsWith("https://")
    ? value
    : `https://${value}`;
}

function hasVisibleContent(parts: ReactNode[]) {
  return parts.some((part) => {
    if (typeof part === "string") {
      return part.trim().length > 0;
    }
    return part !== null && part !== undefined;
  });
}

function getMentionNames(members: Member[]) {
  return Array.from(
    new Set(
      members
        .map((member) => member.name?.trim())
        .filter((name): name is string => Boolean(name)),
    ),
  ).sort((nameA, nameB) => nameB.length - nameA.length);
}

export function getMentionTrigger(
  text: string,
  cursorPosition: number | null | undefined,
): MentionTrigger | null {
  if (cursorPosition === null || cursorPosition === undefined) return null;
  if (cursorPosition < 0 || cursorPosition > text.length) return null;

  const uptoCursor = text.slice(0, cursorPosition);
  const mentionStart = uptoCursor.lastIndexOf("@");
  if (mentionStart === -1) return null;

  const beforeMention = uptoCursor[mentionStart - 1];
  if (beforeMention && !/\s|[([{>]/.test(beforeMention)) {
    return null;
  }

  const query = uptoCursor.slice(mentionStart + 1);
  if (/[\n\r]/.test(query) || query.includes("@")) return null;
  if (/\s/.test(query)) return null;

  return {
    start: mentionStart,
    end: cursorPosition,
    query,
  };
}

export function insertMentionIntoText(
  text: string,
  trigger: MentionTrigger,
  memberName: string,
) {
  const replacement = `@${memberName} `;
  const nextText =
    text.slice(0, trigger.start) + replacement + text.slice(trigger.end);
  const nextCursorPosition = trigger.start + replacement.length;

  return {
    text: nextText,
    cursorPosition: nextCursorPosition,
  };
}

export function resolveMentionIds(
  text: string,
  mentions: Array<{ id: string; name: string }>,
) {
  return mentions
    .filter((mention) => text.includes(`@${mention.name}`))
    .map((mention) => mention.id);
}

export function renderTextWithMentions(
  text: string,
  members: Member[],
  mentionClassName: string,
) {
  if (!text) return text;

  const memberNames = getMentionNames(members);

  if (memberNames.length === 0) return text;

  const mentionRegex = new RegExp(
    `@(?:${memberNames.map(escapeRegExp).join("|")})(?=$|\\s|[.,!?;:])`,
    "g",
  );

  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = mentionRegex.exec(text)) !== null) {
    const mentionText = match[0];
    const startIndex = match.index;

    if (startIndex > lastIndex) {
      parts.push(text.slice(lastIndex, startIndex));
    }

    parts.push(
      <span key={`${mentionText}-${startIndex}`} className={mentionClassName}>
        {mentionText}
      </span>,
    );

    lastIndex = startIndex + mentionText.length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : text;
}

export function renderEditorTextWithMentions(
  text: string,
  members: Member[],
  mentionClassName: string,
) {
  if (!text) return text;

  const memberNames = getMentionNames(members);

  if (memberNames.length === 0) return text;

  const mentionRegex = new RegExp(
    `@(?:${memberNames.map(escapeRegExp).join("|")})(?=$|\\s|[.,!?;:])`,
    "g",
  );

  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = mentionRegex.exec(text)) !== null) {
    const mentionText = match[0];
    const mentionStart = match.index;
    const mentionEnd = mentionStart + mentionText.length;

    if (mentionStart > lastIndex) {
      parts.push(text.slice(lastIndex, mentionStart));
    }

    parts.push(
      <span key={`${mentionText}-${mentionStart}`} className={mentionClassName}>
        {mentionText}
      </span>,
    );

    lastIndex = mentionEnd;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : text;
}

export function renderTextWithLinks(
  text: string,
  linkClassName: string,
  hiddenUrls: string[] = [],
) {
  if (!text) return text;

  const linkRegex = new RegExp(URL_PATTERN.source, "g");
  const hiddenUrlSet = new Set(hiddenUrls.map((url) => normalizeLinkUrl(url)));
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let hasMatch = false;

  while ((match = linkRegex.exec(text)) !== null) {
    hasMatch = true;

    const linkText = match[0];
    const startIndex = match.index;

    if (startIndex > lastIndex) {
      parts.push(text.slice(lastIndex, startIndex));
    }

    const { url, suffix } = splitUrlSuffix(linkText);
    const normalizedUrl = normalizeLinkUrl(url);

    if (hiddenUrlSet.has(normalizedUrl)) {
      lastIndex = startIndex + linkText.length;
      continue;
    }

    parts.push(
      <a
        key={`${url}-${startIndex}`}
        href={normalizeUrlHref(url)}
        target="_blank"
        rel="noreferrer noopener"
        className={linkClassName}
      >
        {url}
      </a>,
    );

    if (suffix) {
      parts.push(suffix);
    }

    lastIndex = startIndex + linkText.length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  if (!hasMatch) {
    return text;
  }

  return hasVisibleContent(parts) ? parts : null;
}

export function renderTextWithMentionsAndLinks(
  text: string,
  members: Member[],
  mentionClassName: string,
  linkClassName: string,
  hiddenUrls: string[] = [],
) {
  if (!text) return text;

  const memberNames = getMentionNames(members);
  const mentionPattern =
    memberNames.length > 0
      ? `@(?:${memberNames.map(escapeRegExp).join("|")})(?=$|\\s|[.,!?;:])`
      : null;
  const tokenPattern = mentionPattern
    ? `${URL_PATTERN.source}|${mentionPattern}`
    : URL_PATTERN.source;
  const tokenRegex = new RegExp(tokenPattern, "g");
  const hiddenUrlSet = new Set(hiddenUrls.map((url) => normalizeLinkUrl(url)));

  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let hasMatch = false;

  while ((match = tokenRegex.exec(text)) !== null) {
    hasMatch = true;

    const token = match[0];
    const startIndex = match.index;

    if (startIndex > lastIndex) {
      parts.push(text.slice(lastIndex, startIndex));
    }

    if (token.startsWith("@")) {
      parts.push(
        <span key={`${token}-${startIndex}`} className={mentionClassName}>
          {token}
        </span>,
      );
    } else {
      const { url, suffix } = splitUrlSuffix(token);
      const normalizedUrl = normalizeLinkUrl(url);
      if (hiddenUrlSet.has(normalizedUrl)) {
        lastIndex = startIndex + token.length;
        continue;
      }
      parts.push(
        <a
          key={`${url}-${startIndex}`}
          href={normalizeUrlHref(url)}
          target="_blank"
          rel="noreferrer noopener"
          className={linkClassName}
        >
          {url}
        </a>,
      );
      if (suffix) {
        parts.push(suffix);
      }
    }

    lastIndex = startIndex + token.length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  if (!hasMatch) {
    return text;
  }

  return hasVisibleContent(parts) ? parts : null;
}

const TEXTAREA_MIRROR_STYLE_PROPERTIES = [
  "box-sizing",
  "width",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "border-top-width",
  "border-right-width",
  "border-bottom-width",
  "border-left-width",
  "font-family",
  "font-size",
  "font-style",
  "font-weight",
  "font-kerning",
  "font-stretch",
  "font-variant",
  "letter-spacing",
  "line-height",
  "text-align",
  "text-indent",
  "text-transform",
  "white-space",
  "word-break",
  "word-spacing",
  "overflow-wrap",
] as const;

export function getTextareaCaretCoordinates(
  textarea: HTMLTextAreaElement,
  position: number,
) {
  const safePosition = Math.max(0, Math.min(position, textarea.value.length));
  const computedStyle = window.getComputedStyle(textarea);
  const mirror = document.createElement("div");

  TEXTAREA_MIRROR_STYLE_PROPERTIES.forEach((property) => {
    mirror.style.setProperty(
      property,
      computedStyle.getPropertyValue(property),
    );
  });

  mirror.style.position = "absolute";
  mirror.style.visibility = "hidden";
  mirror.style.pointerEvents = "none";
  mirror.style.left = "-9999px";
  mirror.style.top = "0";
  mirror.style.height = "auto";
  mirror.style.overflow = "hidden";
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.wordWrap = "break-word";
  mirror.style.width = `${textarea.clientWidth}px`;
  mirror.textContent = textarea.value.slice(0, safePosition);

  const caretMarker = document.createElement("span");
  caretMarker.textContent = "\u200b";
  mirror.appendChild(caretMarker);

  document.body.appendChild(mirror);

  const parsedLineHeight = Number.parseFloat(computedStyle.lineHeight);
  const parsedFontSize = Number.parseFloat(computedStyle.fontSize);
  const coordinates = {
    top: caretMarker.offsetTop - textarea.scrollTop,
    left: caretMarker.offsetLeft - textarea.scrollLeft,
    lineHeight:
      Number.isFinite(parsedLineHeight) && parsedLineHeight > 0
        ? parsedLineHeight
        : parsedFontSize * 1.4,
  };

  document.body.removeChild(mirror);

  return coordinates;
}
