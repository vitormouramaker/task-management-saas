import { create } from "zustand";

export type ThemeMode = "light" | "dark";

const THEME_STORAGE_KEY = "pauta_theme_mode";

function isThemeMode(value: string | null): value is ThemeMode {
  return value === "light" || value === "dark";
}

export function resolveInitialThemeMode(): ThemeMode {
  if (typeof window === "undefined") {
    return "light";
  }

  const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  return isThemeMode(storedTheme) ? storedTheme : "light";
}

export function applyThemeMode(mode: ThemeMode) {
  if (typeof document === "undefined") {
    return;
  }

  document.documentElement.dataset.theme = mode;
  document.documentElement.style.colorScheme = mode;
}

function persistThemeMode(mode: ThemeMode) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(THEME_STORAGE_KEY, mode);
}

interface ThemeState {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  toggleMode: () => void;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  mode: resolveInitialThemeMode(),
  setMode: (mode) => {
    persistThemeMode(mode);
    applyThemeMode(mode);
    set({ mode });
  },
  toggleMode: () => {
    const nextMode: ThemeMode = get().mode === "dark" ? "light" : "dark";
    persistThemeMode(nextMode);
    applyThemeMode(nextMode);
    set({ mode: nextMode });
  },
}));
