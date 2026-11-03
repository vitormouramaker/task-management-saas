import { create } from "zustand";
import { createSafeStorage } from "../lib/safe-storage";
import { persist, createJSONStorage } from "zustand/middleware";
import axios from "axios";
import { useTaskStore } from "./use-task-store";
import { toast } from "./use-toast-store";
import { queryClient } from "../lib/query-client";

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  avatarColor: string;
  avatarUrl?: string;
  tags?: Array<{ id: string; name: string; color: string }>;
  tagIds?: string[];
  /** Titular de conta antiga que ainda não informou CPF/CNPJ. */
  requiresAccountCompletion?: boolean;
  /** Termos/Privacidade mudaram e ainda não foram aceitos nesta versão. */
  requiresLegalAcceptance?: boolean;
  /** Já informou CPF, celular e nascimento em algum cadastro. */
  personalDataComplete?: boolean;
  /** Tour guiado do primeiro acesso ainda não visto. */
  tourPending?: boolean;
  /** Equipe do Pauta: acesso ao painel de super-administrador. */
  isPlatformAdmin?: boolean;
  /** false enquanto a pessoa não confirmar o e-mail do cadastro. */
  emailVerified?: boolean;
  organization?: {
    id: string;
    name: string;
    slug?: string;
    plan: "free" | "essencial" | "profissional" | "empresarial" | "enterprise";
    contractedPlan?: string;
    subscriptionStatus: string;
    /** Primeiro acesso: ainda não escolheu entre Grátis, teste ou assinar. */
    onboardingPending?: boolean;
    /** O teste grátis ainda pode ser ativado nesta conta. */
    trialAvailable?: boolean;
    /** Teste grátis de 14 dias do Profissional. */
    trial?: {
      active: boolean;
      daysLeft: number;
      endsAt?: string | null;
      expired?: boolean;
    };
    role: "owner" | "admin" | "member";
    accountType?: "personal" | "business" | null;
    cnpjVerificationStatus?: "verified" | "pending" | "invalid" | null;
    entitlements?: {
      /** Pessoas liberadas: incluídas no plano + assentos extras contratados. */
      seats: number;
      includedUsers: number;
      maxUsers: number;
      maxProjects?: number;
      maxFilesPerUpload?: number;
      maxEmailAttachmentMb?: number;
      maxWorkspaces: number;
      maxStorageMb: number;
      maxFileSizeMb?: number;
      customFields: boolean;
      advancedReports: boolean;
      automations: boolean;
      /** Visões de projeto liberadas no plano (board, list, table, timeline, calendar). */
      views?: string[];
    };
  };
}

export interface SignupParams {
  /** Aceite dos Termos e da Política, exigido no cadastro. */
  acceptedTerms?: boolean;
  accountType: "personal" | "business";
  name: string;
  email: string;
  password: string;
  cpf: string;
  phone: string;
  birthDate: string;
  company?: { cnpj: string; tradeName: string };
}

interface AuthState {
  token: string | null;
  refreshToken: string | null;
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;

  login: (email: string, password: string) => Promise<boolean>;
  signup: (params: SignupParams) => Promise<boolean>;
  /** Aplica uma nova sessão (outra conta da mesma pessoa) e recarrega os dados. */
  applySession: (session: {
    token: string;
    refreshToken: string;
    user: User;
  }) => void;
  switchOrganization: (organizationId: string) => Promise<void>;
  /** Busca a sessão atualizada no servidor (ex.: depois de confirmar o e-mail). */
  refreshSession: () => Promise<boolean>;
  logout: () => void;
  /** Encerra a sessão em todos os aparelhos e sai. */
  logoutAllDevices: () => Promise<boolean>;
  forgotPassword: (
    email: string,
  ) => Promise<{ success: boolean; message: string }>;
  resetPassword: (
    token: string,
    password: string,
  ) => Promise<{ success: boolean; message: string }>;
  updateProfile: (
    name: string,
    role: string,
    tagIds?: string[],
  ) => Promise<boolean>;
  setAvatarUser: (user: User) => void;
  invalidateSession: (message?: string) => void;
  refreshPlan: () => Promise<void>;
}

const API_URL = "/api/auth";

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      refreshToken: null,
      user: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,

      login: async (email, password) => {
        set({ isLoading: true, error: null });
        try {
          const response = await axios.post(`${API_URL}/login`, {
            email,
            password,
          });
          const { token, refreshToken, user } = response.data;

          useTaskStore.getState().reset();
          set({
            token,
            refreshToken,
            user,
            isAuthenticated: true,
            isLoading: false,
          });
          return true;
        } catch (error: any) {
          console.error("Login error:", error);
          const message =
            error.response?.data?.message ||
            "Erro ao realizar login. Tente novamente.";
          set({ error: message, isLoading: false, isAuthenticated: false });
          return false;
        }
      },
      signup: async (params) => {
        set({ isLoading: true, error: null });
        try {
          const response = await axios.post(`${API_URL}/signup`, params);
          const { token, refreshToken, user } = response.data;

          useTaskStore.getState().reset();
          set({
            token,
            refreshToken,
            user,
            isAuthenticated: true,
            isLoading: false,
          });
          return true;
        } catch (error: any) {
          console.error("Signup error:", error);
          const message =
            error.response?.data?.message ||
            "Erro ao criar conta gratuita. Tente novamente.";
          set({ error: message, isLoading: false, isAuthenticated: false });
          return false;
        }
      },
      applySession: ({ token, refreshToken, user }) => {
        useTaskStore.getState().reset();
        queryClient.removeQueries({ queryKey: ["workspace-seed"] });
        set({
          token,
          refreshToken,
          user,
          isAuthenticated: true,
          isLoading: false,
          error: null,
        });
      },

      switchOrganization: async (organizationId) => {
        const { token } = get();
        const response = await axios.post(
          `${API_URL}/switch-organization`,
          { organizationId },
          { headers: { Authorization: `Bearer ${token}` } },
        );
        get().applySession(response.data);
      },

      refreshSession: async () => {
        const { refreshToken } = get();
        if (!refreshToken) return false;
        try {
          const response = await axios.post(`${API_URL}/refresh`, { refreshToken });
          get().applySession(response.data);
          return true;
        } catch {
          return false;
        }
      },

      logout: () => {
        // Em ambiente fechado (homologação), sair da conta também fecha o
        // portão: a senha do ambiente volta a ser pedida no próximo acesso.
        if (import.meta.env.VITE_AMBIENTE === "homologacao") {
          void fetch("/__portao/sair", { method: "POST", credentials: "include" }).catch(
            () => undefined,
          );
        }

        // Avisa o servidor para encerrar a sessão de verdade (o refresh token
        // deixa de valer). Falha de rede não impede a saída local.
        const currentRefreshToken = get().refreshToken;
        if (currentRefreshToken) {
          void axios
            .post(`${API_URL}/logout`, { refreshToken: currentRefreshToken })
            .catch(() => undefined);
        }
        useTaskStore.getState().reset();
        set({
          token: null,
          refreshToken: null,
          user: null,
          isAuthenticated: false,
          isLoading: false,
          error: null,
        });
      },

      logoutAllDevices: async () => {
        try {
          await axios.post(
            `${API_URL}/logout-all`,
            {},
            { headers: { Authorization: `Bearer ${get().token}` } },
          );
        } catch {
          return false;
        }
        get().logout();
        return true;
      },

      invalidateSession: (message) => {
        useTaskStore.getState().reset();
        set({
          token: null,
          refreshToken: null,
          user: null,
          isAuthenticated: false,
          isLoading: false,
          error: message || "Sua sessão expirou. Faça login novamente.",
        });
      },

      forgotPassword: async (email) => {
        set({ isLoading: true, error: null });
        try {
          const response = await axios.post(`${API_URL}/forgot-password`, {
            email,
          });
          set({ isLoading: false, error: null });
          return { success: true, message: response.data.message };
        } catch (error: any) {
          const message =
            error.response?.data?.message || "Erro ao redefinir a senha.";
          set({ isLoading: false, error: message });
          return { success: false, message };
        }
      },

      resetPassword: async (token, password) => {
        set({ isLoading: true, error: null });
        try {
          const response = await axios.post(`${API_URL}/reset-password`, {
            token,
            password,
          });
          set({ isLoading: false, error: null });
          return { success: true, message: response.data.message };
        } catch (error: any) {
          const message =
            error.response?.data?.message || "Erro ao redefinir a senha.";
          set({ isLoading: false, error: message });
          return { success: false, message };
        }
      },

      updateProfile: async (name, role, tagIds) => {
        set({ isLoading: true, error: null });
        try {
          const { token } = get();
          const response = await axios.put(
            "/api/users/profile",
            { name, role, tagIds },
            { headers: { Authorization: `Bearer ${token}` } },
          );
          set((state) => ({
            user: { ...state.user, ...response.data.user },
            isLoading: false,
          }));
          toast.success("Perfil atualizado.", {
            message: "Seus dados já aparecem para o time.",
          });
          return true;
        } catch (error: any) {
          console.error("Update profile error:", error);
          const message =
            error.response?.data?.message || "Erro ao atualizar perfil.";
          toast.error("Não foi possível atualizar o perfil.", { message });
          set({ error: message, isLoading: false });
          return false;
        }
      },

      setAvatarUser: (user) => set({ user }),

      refreshPlan: async () => {
        const { token } = get();
        if (!token) return;
        try {
          const response = await axios.get("/api/billing/subscription", {
            headers: { Authorization: `Bearer ${token}` },
          });
          const { plan, entitlements } = response.data?.organization ?? {};
          if (!plan) return;
          set((state) => ({
            user: state.user
              ? {
                  ...state.user,
                  organization: state.user.organization
                    ? {
                        ...state.user.organization,
                        plan,
                        entitlements:
                          entitlements ?? state.user.organization.entitlements,
                      }
                    : state.user.organization,
                }
              : state.user,
          }));
        } catch {
          // silently ignore — stale data beats a crash
        }
      },
    }),
    {
      name: "pauta_auth_storage",
      storage: createJSONStorage(() => createSafeStorage()),
      partialize: (state) => ({
        token: state.token,
        refreshToken: state.refreshToken,
        // O endereço da foto é assinado e expira: guardar no navegador deixa
        // a imagem quebrada depois. Ele volta na sessão e no seed.
        user: state.user ? { ...state.user, avatarUrl: undefined } : state.user,
      }),
      merge: (persistedState, currentState) => {
        const persisted = (persistedState as Partial<AuthState>) || {};
        const hasPersistedSession = Boolean(
          persisted.user && (persisted.token || persisted.refreshToken),
        );

        return {
          ...currentState,
          ...persisted,
          isAuthenticated: hasPersistedSession,
          isLoading: false,
          error: null,
        };
      },
    },
  ),
);
