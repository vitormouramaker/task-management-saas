import axios from "axios";
import { create } from "zustand";
import { buildApiUrl } from "../../lib/api";
import { useAuthStore } from "../../store/use-auth-store";

export type SupportStatus = "aberta" | "respondida" | "resolvida";

export interface SupportPolicy {
  planId: string;
  planName: string;
  chat: boolean;
  priority: number;
  responseTime: string | null;
  businessHours: string;
}

export interface SupportConversation {
  id: string;
  organizationId: string | null;
  organizationName: string | null;
  memberId: string | null;
  memberName: string | null;
  memberEmail: string | null;
  subject: string;
  status: SupportStatus;
  priority: number;
  planId: string | null;
  waitingSince: string | null;
  lastMessageAt: string;
  lastMessagePreview: string | null;
  customerUnread: number;
  teamUnread: number;
  createdAt: string;
  closedAt: string | null;
  surveyRating: number | null;
  surveyAnswered: boolean;
}

export interface SupportMessage {
  id: string;
  conversationId: string;
  authorType: "customer" | "team";
  authorName: string | null;
  teamMemberName?: string | null;
  body: string;
  createdAt: string;
}

export const SUPPORT_STATUS_LABELS: Record<SupportStatus, string> = {
  aberta: "Aguardando equipe",
  respondida: "Respondida",
  resolvida: "Resolvida",
};

/** base = "/api/support" (cliente) ou "/api/admin/support" (equipe). */
export function supportRequest() {
  const token = useAuthStore.getState().token;
  const headers = { Authorization: `Bearer ${token}` };
  return {
    get: async <T,>(path: string, params?: Record<string, unknown>) =>
      (await axios.get(buildApiUrl(path), { headers, params })).data as T,
    post: async <T,>(path: string, body: unknown) =>
      (await axios.post(buildApiUrl(path), body, { headers })).data as T,
    patch: async <T,>(path: string, body: unknown) =>
      (await axios.patch(buildApiUrl(path), body, { headers })).data as T,
  };
}

export function supportErrorMessage(error: unknown, fallback: string) {
  return axios.isAxiosError(error)
    ? (error.response?.data as { message?: string })?.message || fallback
    : fallback;
}

interface SupportPanelState {
  isOpen: boolean;
  conversationId: string | null;
  open: (conversationId?: string | null) => void;
  close: () => void;
  setConversation: (conversationId: string | null) => void;
}

export const useSupportPanel = create<SupportPanelState>((set) => ({
  isOpen: false,
  conversationId: null,
  open: (conversationId = null) => set({ isOpen: true, conversationId }),
  close: () => set({ isOpen: false }),
  setConversation: (conversationId) => set({ conversationId }),
}));

export function formatSupportTime(value: string) {
  const date = new Date(value);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return sameDay
    ? date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}
