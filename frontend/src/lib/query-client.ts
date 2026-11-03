import { QueryClient } from "@tanstack/react-query";

// Instância única, acessível fora dos componentes (ex.: ao trocar de conta no store).
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      refetchOnWindowFocus: false,
    },
  },
});
