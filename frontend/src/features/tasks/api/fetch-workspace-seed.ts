import axios from "axios";
import { useAuthStore } from "../../../store/use-auth-store";
import type { TaskSeedData } from "../../../types/tasks";

export async function fetchWorkspaceSeed(): Promise<TaskSeedData> {
  const token = useAuthStore.getState().token;
  if (!token) throw new Error("Acesso negado: Usuário não autenticado");

  const response = await axios.get(
    "/api/workspaces/seed",
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );

  return response.data;
}

