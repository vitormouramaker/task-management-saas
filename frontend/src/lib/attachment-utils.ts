import axios from "axios";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { buildApiUrl } from "./api";
import { useAuthStore } from "../store/use-auth-store";
import { toast } from "../store/use-toast-store";

export type AttachmentVisualKind =
  | "image"
  | "video"
  | "spreadsheet"
  | "pdf"
  | "archive"
  | "powerpoint"
  | "word"
  | "document"
  | "generic";

export type AttachmentPreviewKind =
  "image" | "video" | "pdf" | "text" | "markdown";

const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "bmp",
  "avif",
]);

const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "avi", "mkv", "webm", "m4v"]);

const SPREADSHEET_EXTENSIONS = new Set(["csv", "xls", "xlsx", "ods"]);
const ARCHIVE_EXTENSIONS = new Set(["zip", "rar", "7z", "tar", "gz"]);
const PDF_EXTENSIONS = new Set(["pdf"]);
const POWERPOINT_EXTENSIONS = new Set(["ppt", "pptx", "odp", "key"]);
const WORD_EXTENSIONS = new Set(["doc", "docx", "odt"]);
const DOCUMENT_EXTENSIONS = new Set(["txt", "rtf", "md"]);
const TEXT_PREVIEW_EXTENSIONS = new Set(["txt"]);
const MARKDOWN_PREVIEW_EXTENSIONS = new Set(["md"]);
const ATTACHMENT_SERVER_OFFSET_MS = 3 * 60 * 60 * 1000;
const ATTACHMENT_RECENT_THRESHOLD_MS = 45_000;
const ATTACHMENT_FUTURE_TOLERANCE_MS = 90_000;
const ATTACHMENT_RELATIVE_LIMIT_MS = 7 * 24 * 60 * 60 * 1000;

export function getAttachmentNameFromUrl(url: string) {
  const rawName = url.split("?")[0]?.split("/").pop() || url;

  try {
    return decodeURIComponent(rawName);
  } catch {
    return rawName;
  }
}

export function getAttachmentExtension(name: string) {
  const sanitizedName = name.trim();
  const lastDotIndex = sanitizedName.lastIndexOf(".");
  if (lastDotIndex <= 0 || lastDotIndex === sanitizedName.length - 1) {
    return "";
  }

  return sanitizedName.slice(lastDotIndex + 1).toLowerCase();
}

export function getAttachmentBaseName(name: string) {
  const sanitizedName = name.trim();
  const lastDotIndex = sanitizedName.lastIndexOf(".");
  if (lastDotIndex <= 0) {
    return sanitizedName;
  }

  return sanitizedName.slice(0, lastDotIndex);
}

export function resolveAttachmentVisualKind(input: {
  name: string;
  type?: string | null;
  mimeType?: string | null;
}) {
  const extension = getAttachmentExtension(input.name);
  const normalizedType = input.type?.toLowerCase() || "";
  const normalizedMimeType = input.mimeType?.toLowerCase() || "";

  if (
    normalizedType === "image" ||
    normalizedMimeType.startsWith("image/") ||
    IMAGE_EXTENSIONS.has(extension)
  ) {
    return "image" satisfies AttachmentVisualKind;
  }

  if (
    normalizedType === "video" ||
    normalizedMimeType.startsWith("video/") ||
    VIDEO_EXTENSIONS.has(extension)
  ) {
    return "video" satisfies AttachmentVisualKind;
  }

  if (
    normalizedType === "spreadsheet" ||
    SPREADSHEET_EXTENSIONS.has(extension)
  ) {
    return "spreadsheet" satisfies AttachmentVisualKind;
  }

  if (PDF_EXTENSIONS.has(extension)) {
    return "pdf" satisfies AttachmentVisualKind;
  }

  if (ARCHIVE_EXTENSIONS.has(extension)) {
    return "archive" satisfies AttachmentVisualKind;
  }

  if (
    normalizedType === "powerpoint" ||
    normalizedMimeType.includes("presentation") ||
    normalizedMimeType.includes("powerpoint") ||
    POWERPOINT_EXTENSIONS.has(extension)
  ) {
    return "powerpoint" satisfies AttachmentVisualKind;
  }

  if (
    normalizedMimeType.includes("word") ||
    normalizedMimeType.includes("officedocument.wordprocessingml") ||
    normalizedMimeType.includes("opendocument.text") ||
    WORD_EXTENSIONS.has(extension)
  ) {
    return "word" satisfies AttachmentVisualKind;
  }

  if (DOCUMENT_EXTENSIONS.has(extension)) {
    return "document" satisfies AttachmentVisualKind;
  }

  if (normalizedType === "document") {
    return "document" satisfies AttachmentVisualKind;
  }

  return "generic" satisfies AttachmentVisualKind;
}

export function resolveAttachmentPreviewKind(input: {
  name: string;
  type?: string | null;
  mimeType?: string | null;
}) {
  const extension = getAttachmentExtension(input.name);
  const visualKind = resolveAttachmentVisualKind(input);

  if (visualKind === "image") {
    return "image" satisfies AttachmentPreviewKind;
  }

  if (visualKind === "video") {
    return "video" satisfies AttachmentPreviewKind;
  }

  if (visualKind === "pdf") {
    return "pdf" satisfies AttachmentPreviewKind;
  }

  if (MARKDOWN_PREVIEW_EXTENSIONS.has(extension)) {
    return "markdown" satisfies AttachmentPreviewKind;
  }

  if (TEXT_PREVIEW_EXTENSIONS.has(extension)) {
    return "text" satisfies AttachmentPreviewKind;
  }

  return null;
}

function parseTimestampValue(value: string | Date) {
  if (value instanceof Date) {
    return value;
  }

  const rawValue = value.trim();
  const parsedDate = new Date(rawValue);

  if (Number.isNaN(parsedDate.getTime())) {
    return parsedDate;
  }

  const hasExplicitTimezone =
    /(?:z|[+-]\d{2}:?\d{2})$/i.test(rawValue) || /gmt/i.test(rawValue);

  if (!hasExplicitTimezone) {
    return new Date(parsedDate.getTime() - ATTACHMENT_SERVER_OFFSET_MS);
  }

  return parsedDate;
}

function normalizeParsedTimestamp(date: Date, now: Date) {
  if (Number.isNaN(date.getTime())) {
    return date;
  }

  const futureOffsetMs = date.getTime() - now.getTime();
  if (futureOffsetMs <= ATTACHMENT_FUTURE_TOLERANCE_MS) {
    return date;
  }

  const adjustedDate = new Date(date.getTime() - ATTACHMENT_SERVER_OFFSET_MS);
  const adjustedFutureOffsetMs = adjustedDate.getTime() - now.getTime();

  return Math.abs(adjustedFutureOffsetMs) < Math.abs(futureOffsetMs)
    ? adjustedDate
    : date;
}

export function normalizeTimestampDate(
  value?: string | Date | null,
  now = new Date(),
) {
  if (!value) {
    return null;
  }

  const parsedDate = parseTimestampValue(value);
  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }

  return normalizeParsedTimestamp(parsedDate, now);
}

export function formatRelativeTimestamp(
  value?: string | Date | null,
  now = new Date(),
) {
  const date = normalizeTimestampDate(value, now);
  if (!date) {
    return "Agora há pouco";
  }

  const differenceMs = Math.max(0, now.getTime() - date.getTime());
  if (differenceMs < ATTACHMENT_RECENT_THRESHOLD_MS) {
    return "Agora há pouco";
  }

  if (differenceMs >= ATTACHMENT_RELATIVE_LIMIT_MS) {
    return format(date, "dd/MM/yyyy 'às' HH:mm", { locale: ptBR });
  }

  const minuteMs = 60 * 1000;
  const hourMs = 60 * minuteMs;
  const dayMs = 24 * hourMs;

  if (differenceMs < hourMs) {
    const minutes = Math.max(1, Math.floor(differenceMs / minuteMs));
    return `há ${minutes} min`;
  }

  if (differenceMs < dayMs) {
    const hours = Math.max(1, Math.floor(differenceMs / hourMs));
    return `há ${hours} h`;
  }

  const days = Math.max(1, Math.floor(differenceMs / dayMs));
  return `há ${days} ${days === 1 ? "dia" : "dias"}`;
}

export function formatAttachmentTimestamp(
  value?: string | Date | null,
  now = new Date(),
) {
  return formatRelativeTimestamp(value, now);
}

export function formatAttachmentSize(size?: number | null) {
  if (typeof size !== "number" || Number.isNaN(size) || size < 0) {
    return null;
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = size;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const rounded =
    value >= 100 || unitIndex === 0
      ? Math.round(value).toString()
      : value >= 10
        ? value.toFixed(1)
        : value.toFixed(2);

  return `${rounded.replace(/\.0+$|(\.\d*[1-9])0+$/, "$1")} ${units[unitIndex]}`;
}

export async function downloadAttachmentFile(options: {
  url?: string | null;
  fileName?: string | null;
}) {
  const { url, fileName } = options;

  if (!url) {
    return;
  }

  const downloadName = fileName?.trim() || getAttachmentNameFromUrl(url);
  const token = useAuthStore.getState().token;

  if (!token) {
    throw new Error("Usuário não autenticado para baixar anexo.");
  }

  try {
    const blob = await fetchAttachmentBlob({
      url,
      fileName: downloadName,
    });

    await saveBlobToDevice(blob, downloadName);
  } catch (error) {
    console.error("Erro ao baixar anexo:", error);
    toast.error("Não foi possível baixar o anexo.", {
      message: "Verifique sua conexão e tente de novo.",
    });
    throw error;
  }
}

export async function fetchAttachmentBlob(options: {
  url?: string | null;
  fileName?: string | null;
}) {
  const { url, fileName } = options;

  if (!url) {
    throw new Error("URL do anexo não informada.");
  }

  const downloadName = fileName?.trim() || getAttachmentNameFromUrl(url);
  const token = useAuthStore.getState().token;

  if (!token) {
    throw new Error("Usuário não autenticado para visualizar anexo.");
  }

  return requestAttachmentBlob({
    url,
    fileName: downloadName,
    token,
  });
}

export async function downloadAttachmentArchive(options: {
  attachments: Array<{
    url?: string | null;
    fileName?: string | null;
  }>;
  archiveName?: string | null;
}) {
  const { attachments, archiveName } = options;
  const token = useAuthStore.getState().token;

  if (!token) {
    throw new Error("Usuário não autenticado para baixar anexos.");
  }

  const validAttachments = attachments
    .filter((attachment) => attachment.url)
    .map((attachment) => ({
      url: attachment.url,
      name:
        attachment.fileName?.trim() ||
        getAttachmentNameFromUrl(attachment.url!),
    }));

  if (validAttachments.length === 0) {
    return;
  }

  const resolvedArchiveName =
    archiveName?.trim() ||
    (validAttachments.length === 1
      ? validAttachments[0].name
      : `anexos-${validAttachments.length}.zip`);

  const response = await axios.post(
    buildApiUrl("/api/workspaces/attachments/download-batch"),
    {
      attachments: validAttachments,
      archiveName: resolvedArchiveName,
    },
    {
      responseType: "blob",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  const blob =
    response.data instanceof Blob ? response.data : new Blob([response.data]);

  await saveBlobToDevice(blob, ensureZipFileName(resolvedArchiveName));
}

function ensureZipFileName(fileName: string) {
  return fileName.toLowerCase().endsWith(".zip") ? fileName : `${fileName}.zip`;
}

async function saveBlobToDevice(blob: Blob, fileName: string) {
  const pickerWindow = window as Window & {
    showSaveFilePicker?: (options?: { suggestedName?: string }) => Promise<{
      createWritable: () => Promise<{
        write: (data: Blob) => Promise<void>;
        close: () => Promise<void>;
      }>;
    }>;
  };

  if (typeof pickerWindow.showSaveFilePicker === "function") {
    try {
      const fileHandle = await pickerWindow.showSaveFilePicker({
        suggestedName: fileName,
      });
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (pickerError) {
      if (
        pickerError instanceof DOMException &&
        pickerError.name === "AbortError"
      ) {
        return;
      }
    }
  }

  const objectUrl = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(objectUrl);
}

async function requestAttachmentBlob(options: {
  url: string;
  fileName: string;
  token: string;
}) {
  const { url, fileName, token } = options;

  const response = await axios.get(
    buildApiUrl("/api/workspaces/attachments/download"),
    {
      params: {
        url,
        name: fileName,
      },
      responseType: "blob",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  return response.data instanceof Blob
    ? response.data
    : new Blob([response.data]);
}
