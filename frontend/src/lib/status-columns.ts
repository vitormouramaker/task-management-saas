import type { EntityId, TaskStatusDefinition } from "../types/tasks";

/**
 * Retorna as colunas (status) visíveis para uma lista/projeto, já ordenadas.
 *
 * Colunas globais (listId nulo) são compartilhadas por todas as listas; colunas
 * com listId aparecem apenas na lista correspondente. Quando listId é nulo
 * (nenhuma lista ativa), apenas as globais são retornadas.
 */
export function getStatusesForList(
  definitions: TaskStatusDefinition[] | undefined,
  listId: EntityId | null | undefined,
): TaskStatusDefinition[] {
  return (definitions || [])
    .filter((status) => {
      // Coluna específica: só aparece na sua própria lista.
      if (status.listId != null) return status.listId === listId;
      // Coluna global: oculta se foi "forkada" nesta lista (override por projeto).
      if (listId && status.hiddenListIds?.includes(listId)) return false;
      return true;
    })
    .slice()
    .sort((a, b) => a.order - b.order);
}
