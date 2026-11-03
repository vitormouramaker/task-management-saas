export const ENTITY_COLOR_OPTIONS = [
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#84cc16",
  "#22c55e",
  "#10b981",
  "#06b6d4",
  "#0ea5e9",
  "#3b82f6",
  "#6366f1",
  "#8b5cf6",
  "#d946ef",
  "#f43f5e",
] as const;

export const DEFAULT_ENTITY_COLOR = ENTITY_COLOR_OPTIONS[8];

const LEGACY_COLOR_CLASS_MAP: Record<string, string> = {
  "bg-red-500": "#ef4444",
  "bg-orange-500": "#f97316",
  "bg-amber-500": "#f59e0b",
  "bg-lime-500": "#84cc16",
  "bg-green-500": "#22c55e",
  "bg-emerald-500": "#10b981",
  "bg-cyan-500": "#06b6d4",
  "bg-sky-500": "#0ea5e9",
  "bg-blue-500": "#3b82f6",
  "bg-indigo-500": "#6366f1",
  "bg-violet-500": "#8b5cf6",
  "bg-fuchsia-500": "#d946ef",
  "bg-rose-500": "#f43f5e",
};

export function normalizeEntityColor(
  value?: string | null,
  fallback = DEFAULT_ENTITY_COLOR,
) {
  if (!value) return fallback;

  const normalizedValue = value.trim();
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(normalizedValue)) {
    if (normalizedValue.length === 4) {
      const [hash, red, green, blue] = normalizedValue;
      return `${hash}${red}${red}${green}${green}${blue}${blue}`;
    }

    return normalizedValue;
  }

  return LEGACY_COLOR_CLASS_MAP[normalizedValue] ?? fallback;
}

export function withAlpha(hexColor: string, alpha: number) {
  const normalized = normalizeEntityColor(hexColor).replace("#", "");
  const clampedAlpha = Math.max(0, Math.min(1, alpha));
  const alphaHex = Math.round(clampedAlpha * 255)
    .toString(16)
    .padStart(2, "0");

  return `#${normalized}${alphaHex}`;
}
