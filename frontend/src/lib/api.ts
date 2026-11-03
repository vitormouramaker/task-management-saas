import axios, { type AxiosRequestConfig } from "axios";
import { useAuthStore } from "../store/use-auth-store";
import { toast } from "../store/use-toast-store";
import { queryClient } from "./query-client";

// Configure a origem da API via VITE_API_ORIGIN em .env.local/.env.production.
// Sem essa variavel, o frontend tenta encontrar o backend local nas portas conhecidas.
const HEALTH_PATH = "/api/health";
const HEALTH_TIMEOUT_MS = 1200;
const PAUTA_SERVICES = new Set(["pauta-back", "pauta-backend"]);
// Mantido apenas para reescrever chamadas antigas hardcoded durante a migracao.
const LEGACY_API_ORIGIN = "http://localhost:4444";
const DEFAULT_API_ORIGINS = [
  "http://localhost:4444",
  "http://localhost:4455",
];

function normalizeOrigin(origin: string) {
  return origin.trim().replace(/\/+$/, "");
}

function getDefaultOrigins() {
  if (typeof window === "undefined") {
    return DEFAULT_API_ORIGINS;
  }

  return Array.from(new Set([window.location.origin, ...DEFAULT_API_ORIGINS]));
}

function getConfiguredOrigin() {
  const envOrigin = import.meta.env.VITE_API_ORIGIN;
  return envOrigin ? normalizeOrigin(envOrigin) : null;
}

let apiOrigin = getConfiguredOrigin() ?? getDefaultOrigins()[0];

function withPath(origin: string, path: string) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${origin}${normalizedPath}`;
}

async function probeOrigin(origin: string) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(
    () => controller.abort(),
    HEALTH_TIMEOUT_MS,
  );

  try {
    const response = await fetch(withPath(origin, HEALTH_PATH), {
      signal: controller.signal,
    });

    if (!response.ok) {
      return false;
    }

    const data = (await response.json()) as { service?: string };
    return data.service ? PAUTA_SERVICES.has(data.service) : false;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

let axiosConfigured = false;
let refreshSessionPromise: Promise<string | null> | null = null;

type RetryableRequestConfig = AxiosRequestConfig & {
  _retryAuthRefresh?: boolean;
};

function resolveAuthorizationHeader(headers: unknown) {
  if (!headers) {
    return null;
  }

  if (typeof headers === "object" && headers !== null) {
    const axiosHeaders = headers as {
      Authorization?: string;
      authorization?: string;
      get?: (name: string) => string | null | undefined;
    };

    if (typeof axiosHeaders.get === "function") {
      return (
        axiosHeaders.get("Authorization") ||
        axiosHeaders.get("authorization") ||
        null
      );
    }

    return axiosHeaders.Authorization || axiosHeaders.authorization || null;
  }

  return null;
}

function isExpiredOrMissingSession(error: unknown) {
  if (!axios.isAxiosError(error)) {
    return false;
  }

  const status = error.response?.status;
  const responseMessage =
    typeof error.response?.data?.message === "string"
      ? error.response.data.message.trim()
      : "";
  const authorizationHeader = resolveAuthorizationHeader(error.config?.headers);
  const hasBearerToken =
    typeof authorizationHeader === "string" &&
    authorizationHeader.startsWith("Bearer ");

  if (!hasBearerToken) {
    return false;
  }

  return (
    status === 401 ||
    responseMessage === "Token inválido ou expirado." ||
    responseMessage === "Acesso negado. Token não fornecido."
  );
}

function isPlanLimitError(error: unknown) {
  if (!axios.isAxiosError(error) || error.response?.status !== 403) {
    return false;
  }

  const code = (error.response?.data as { code?: string } | undefined)?.code || "";
  return (
    code === "PLAN_READ_ONLY" ||
    code === "PLAN_PAYMENT_OVERDUE" ||
    code.startsWith("PLAN_LIMIT_")
  );
}

function isRevokedSession(error: unknown) {
  return (
    axios.isAxiosError(error) &&
    (error.response?.data as { code?: string } | undefined)?.code ===
      "SESSION_REVOKED"
  );
}

function isRefreshRequest(url: string | undefined) {
  if (!url) {
    return false;
  }

  return url.includes("/api/auth/refresh");
}

async function refreshSessionToken() {
  if (refreshSessionPromise) {
    return refreshSessionPromise;
  }

  refreshSessionPromise = (async () => {
    const { refreshToken, invalidateSession } = useAuthStore.getState();

    if (!refreshToken) {
      invalidateSession("Sua sessão expirou. Faça login novamente.");
      return null;
    }

    try {
      const response = await axios.post(
        "/api/auth/refresh",
        { refreshToken },
        {
          headers: {},
        },
      );

      const {
        token: nextToken,
        refreshToken: nextRefreshToken,
        user,
      } = response.data as {
        token?: string;
        refreshToken?: string;
        user?: unknown;
      };

      if (!nextToken || !nextRefreshToken || !user) {
        invalidateSession("Sua sessão expirou. Faça login novamente.");
        return null;
      }

      useAuthStore.setState({
        token: nextToken,
        refreshToken: nextRefreshToken,
        user: user as ReturnType<typeof useAuthStore.getState>["user"],
        isAuthenticated: true,
        isLoading: false,
        error: null,
      });

      return nextToken;
    } catch {
      invalidateSession("Sua sessão expirou. Faça login novamente.");
      return null;
    } finally {
      refreshSessionPromise = null;
    }
  })();

  return refreshSessionPromise;
}

function configureAxios() {
  if (axiosConfigured) {
    return;
  }

  axios.defaults.baseURL = apiOrigin;
  axios.interceptors.request.use((config) => {
    const currentUrl = config.url;
    if (!currentUrl) {
      return config;
    }

    if (currentUrl.startsWith(LEGACY_API_ORIGIN)) {
      config.url = `${apiOrigin}${currentUrl.slice(LEGACY_API_ORIGIN.length)}`;
      return config;
    }

    if (currentUrl.startsWith("/")) {
      config.url = withPath(apiOrigin, currentUrl);
    }

    return config;
  });

  axios.interceptors.response.use(
    (response) => response,
    async (error) => {
      // Limite do plano atingido: avisa uma vez e atualiza a faixa do topo.
      if (isPlanLimitError(error)) {
        const data = (error as { response?: { data?: { message?: string } } }).response?.data;
        toast.error("Limite do plano", {
          message: data?.message || "Sua conta atingiu um limite do plano.",
        });
        void queryClient.invalidateQueries({ queryKey: ["billing", "subscription", "banner"] });
        return Promise.reject(error);
      }

      if (!isExpiredOrMissingSession(error)) {
        return Promise.reject(error);
      }

      // Sessão encerrada no servidor (logout em todos os aparelhos, troca de
      // senha): renovar não adianta, cai direto para a tela de login.
      if (isRevokedSession(error)) {
        useAuthStore
          .getState()
          .invalidateSession("Sua sessão foi encerrada. Faça login novamente.");
        return Promise.reject(error);
      }

      const originalRequest = (error.config || {}) as RetryableRequestConfig;

      if (
        originalRequest._retryAuthRefresh ||
        isRefreshRequest(originalRequest.url)
      ) {
        const { token, invalidateSession } = useAuthStore.getState();

        if (token) {
          invalidateSession("Sua sessão expirou. Faça login novamente.");
        }

        return Promise.reject(error);
      }

      const refreshedToken = await refreshSessionToken();

      if (!refreshedToken) {
        return Promise.reject(error);
      }

      originalRequest._retryAuthRefresh = true;
      originalRequest.headers = {
        ...(originalRequest.headers || {}),
        Authorization: `Bearer ${refreshedToken}`,
      };

      return axios(originalRequest as AxiosRequestConfig);
    },
  );

  axiosConfigured = true;
}

export async function initializeApiOrigin() {
  const configuredOrigin = getConfiguredOrigin();
  const candidates = Array.from(
    new Set(
      configuredOrigin
        ? [configuredOrigin, ...getDefaultOrigins()]
        : getDefaultOrigins(),
    ),
  );

  for (const candidate of candidates) {
    if (await probeOrigin(candidate)) {
      apiOrigin = candidate;
      break;
    }
  }

  axios.defaults.baseURL = apiOrigin;
  configureAxios();
}

export function getApiOrigin() {
  return apiOrigin;
}

export function buildApiUrl(path: string) {
  return withPath(apiOrigin, path);
}

export function buildAssetUrl(path: string | null | undefined) {
  if (!path) {
    return "";
  }

  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  return withPath(apiOrigin, path);
}
