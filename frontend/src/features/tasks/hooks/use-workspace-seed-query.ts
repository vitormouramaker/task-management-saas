import { useQuery } from "@tanstack/react-query";

import { fetchWorkspaceSeed } from "../api/fetch-workspace-seed";

import { useAuthStore } from "../../../store/use-auth-store";

export function useWorkspaceSeedQuery() {
  const token = useAuthStore((state) => state.token);
  const userId = useAuthStore((state) => state.user?.id ?? null);
  // A conta ativa faz parte da chave: trocar de conta carrega outro conjunto de dados.
  const organizationId = useAuthStore(
    (state) => state.user?.organization?.id ?? null,
  );
  return useQuery({
    queryKey: ["workspace-seed", userId, organizationId],
    queryFn: fetchWorkspaceSeed,
    enabled: !!token && !!userId,
    // Os endereços dos arquivos são assinados e expiram em 12 horas: com a aba
    // aberta o dia inteiro, recarregamos antes disso.
    refetchInterval: 6 * 60 * 60 * 1000,
    refetchIntervalInBackground: false,
  });
}
