import axios from "axios";
import { buildApiUrl } from "./api";

export type UploadProgressPhase =
  | "idle"
  | "preparing"
  | "uploading"
  | "processing"
  | "complete"
  | "error";

export interface UploadProgressSnapshot {
  progress: number;
  etaMs: number | null;
  phase: UploadProgressPhase;
}

export interface UploadedStorageFile {
  url: string;
  name: string;
  size: number;
  contentType: string;
}

const MB = 1024 * 1024;

// Mesma lista do back-end (storage.service.js).
const BLOCKED_UPLOAD_EXTENSIONS = new Set([
  "exe",
  "msi",
  "bat",
  "cmd",
  "scr",
  "sh",
  "ps1",
  "vbs",
  "apk",
  "jar",
]);

function clampProgress(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function calculateEtaMs(startedAt: number, progress: number) {
  if (progress <= 0 || progress >= 100) {
    return null;
  }

  const elapsedMs = Date.now() - startedAt;
  return Math.max(0, Math.round((elapsedMs * (100 - progress)) / progress));
}

function emitProgress(
  onProgress: ((snapshot: UploadProgressSnapshot) => void) | undefined,
  startedAt: number,
  progress: number,
  phase: UploadProgressPhase,
) {
  if (!onProgress) {
    return;
  }

  const normalizedProgress = clampProgress(progress);
  onProgress({
    progress: normalizedProgress,
    etaMs: calculateEtaMs(startedAt, normalizedProgress),
    phase,
  });
}

export function formatStorageSize(megabytes: number) {
  if (megabytes >= 1024) {
    return `${(megabytes / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} GB`;
  }

  return `${megabytes.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
}

function formatFileSize(bytes: number) {
  if (bytes >= MB) {
    return formatStorageSize(bytes / MB);
  }

  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Retorna a mensagem de bloqueio ou null quando o arquivo pode ser enviado. */
export function getUploadValidationError(
  file: File,
  maxFileSizeMb?: number | null,
) {
  const extension = file.name.includes(".")
    ? (file.name.split(".").pop()?.toLowerCase() ?? "")
    : "";

  if (BLOCKED_UPLOAD_EXTENSIONS.has(extension)) {
    return `"${file.name}" não pode ser enviado: tipo de arquivo bloqueado por segurança.`;
  }

  if (file.size === 0) {
    return `"${file.name}" está vazio.`;
  }

  if (maxFileSizeMb && maxFileSizeMb > 0 && file.size > maxFileSizeMb * MB) {
    return `"${file.name}" tem ${formatFileSize(file.size)}. O limite do seu plano é ${formatStorageSize(maxFileSizeMb)} por arquivo.`;
  }

  return null;
}

export function getUploadErrorMessage(error: unknown, fallback: string) {
  if (axios.isAxiosError(error)) {
    const serverMessage = (
      error.response?.data as { message?: unknown } | undefined
    )?.message;

    if (typeof serverMessage === "string" && serverMessage) {
      return serverMessage;
    }

    return error.response
      ? fallback
      : "Verifique sua conexão e tente novamente.";
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}

/**
 * Envia o arquivo em binário (sem base64). Antes consulta o back-end para
 * validar tamanho e espaço disponível no plano.
 */
export async function uploadFileToStorage(options: {
  file: File;
  endpoint: string;
  token: string;
  /** Quantos arquivos foram escolhidos de uma vez (limite do plano). */
  batchSize?: number;
  onProgress?: (snapshot: UploadProgressSnapshot) => void;
}): Promise<UploadedStorageFile> {
  const { file, endpoint, token, batchSize, onProgress } = options;
  const startedAt = Date.now();
  const authorization = { Authorization: `Bearer ${token}` };

  emitProgress(onProgress, startedAt, 0, "preparing");
  await axios.post(
    buildApiUrl("/api/storage/upload-check"),
    { name: file.name, size: file.size, count: batchSize ?? 1 },
    { headers: authorization },
  );
  emitProgress(onProgress, startedAt, 3, "uploading");

  const response = await axios.post(endpoint, file, {
    headers: {
      ...authorization,
      "Content-Type": "application/octet-stream",
      "X-File-Name": encodeURIComponent(file.name),
      "X-File-Type": file.type || "application/octet-stream",
    },
    onUploadProgress: (event) => {
      const total = event.total || file.size;
      const ratio = total > 0 ? event.loaded / total : 0;
      emitProgress(onProgress, startedAt, 3 + ratio * 92, "uploading");
    },
  });

  emitProgress(onProgress, startedAt, 97, "processing");
  const uploadedFile = response.data?.file as UploadedStorageFile | undefined;

  if (!uploadedFile?.url) {
    throw new Error("URL do arquivo não retornada.");
  }

  emitProgress(onProgress, startedAt, 100, "complete");
  return uploadedFile;
}

export function formatUploadEta(etaMs: number | null) {
  if (etaMs === null) {
    return "Calculando tempo restante";
  }

  if (etaMs < 15_000) {
    return "Menos de 15s restantes";
  }

  const totalSeconds = Math.ceil(etaMs / 1000);
  if (totalSeconds < 60) {
    return `${totalSeconds}s restantes`;
  }

  const totalMinutes = Math.ceil(totalSeconds / 60);
  if (totalMinutes < 60) {
    return `${totalMinutes} min restantes`;
  }

  const totalHours = Math.ceil(totalMinutes / 60);
  return `${totalHours}h restantes`;
}
