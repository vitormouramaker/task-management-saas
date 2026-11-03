import { create } from "zustand";

export type ToastTone = "success" | "error" | "warning" | "info" | "loading";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastItem {
  id: string;
  tone: ToastTone;
  title: string;
  message?: string;
  /** ms até sumir sozinho. 0 = fica até ser fechado (usado por "loading"). */
  duration: number;
  action?: ToastAction;
}

export interface ToastInput {
  tone?: ToastTone;
  title: string;
  message?: string;
  duration?: number;
  action?: ToastAction;
  /** Reaproveita o id para atualizar um toast já visível (ex.: loading -> success). */
  id?: string;
}

interface ToastStore {
  toasts: ToastItem[];
  push: (input: ToastInput) => string;
  update: (id: string, patch: Partial<ToastInput>) => void;
  dismiss: (id: string) => void;
  clear: () => void;
}

const DEFAULT_DURATIONS: Record<ToastTone, number> = {
  success: 3600,
  info: 4200,
  warning: 5200,
  error: 6200,
  loading: 0,
};

const MAX_VISIBLE_TOASTS = 4;

function createToastId() {
  return `toast_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

export const useToastStore = create<ToastStore>((set, get) => ({
  toasts: [],
  push: (input) => {
    const tone = input.tone ?? "info";
    const id = input.id ?? createToastId();
    const toast: ToastItem = {
      id,
      tone,
      title: input.title,
      message: input.message,
      duration: input.duration ?? DEFAULT_DURATIONS[tone],
      action: input.action,
    };

    set((state) => {
      const withoutSameId = state.toasts.filter((item) => item.id !== id);
      const next = [...withoutSameId, toast];

      return {
        toasts:
          next.length > MAX_VISIBLE_TOASTS
            ? next.slice(next.length - MAX_VISIBLE_TOASTS)
            : next,
      };
    });

    return id;
  },
  update: (id, patch) => {
    const existing = get().toasts.find((item) => item.id === id);

    if (!existing) {
      return;
    }

    const tone = patch.tone ?? existing.tone;

    set((state) => ({
      toasts: state.toasts.map((item) =>
        item.id === id
          ? {
              ...item,
              ...patch,
              tone,
              duration: patch.duration ?? DEFAULT_DURATIONS[tone],
            }
          : item,
      ),
    }));
  },
  dismiss: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((item) => item.id !== id),
    })),
  clear: () => set({ toasts: [] }),
}));

function pushWithTone(tone: ToastTone) {
  return (title: string, options?: Omit<ToastInput, "title" | "tone">) =>
    useToastStore.getState().push({ ...options, tone, title });
}

/**
 * Helper para disparar toasts de qualquer lugar (componentes, stores, libs).
 * Ex.: toast.success("Card duplicado.")
 */
export const toast = {
  success: pushWithTone("success"),
  error: pushWithTone("error"),
  warning: pushWithTone("warning"),
  info: pushWithTone("info"),
  loading: pushWithTone("loading"),
  custom: (input: ToastInput) => useToastStore.getState().push(input),
  update: (id: string, patch: Partial<ToastInput>) =>
    useToastStore.getState().update(id, patch),
  dismiss: (id: string) => useToastStore.getState().dismiss(id),
  clear: () => useToastStore.getState().clear(),
};
