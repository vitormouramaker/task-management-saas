import { useTaskStore } from "../../../store/use-task-store";

export function useActiveBreadcrumbs() {
  const graph = useTaskStore((state) => state.graph);
  const selection = useTaskStore((state) => state.selection);

  const breadcrumbs: string[] = [];

  if (selection.workspaceId) {
    const workspace = graph.workspaces[selection.workspaceId];
    if (workspace) breadcrumbs.push(workspace.name);
  }

  if (selection.spaceId) {
    const space = graph.spaces[selection.spaceId];
    if (space) breadcrumbs.push(space.name);
  }

  if (selection.folderId) {
    const folder = graph.folders[selection.folderId];
    if (folder) breadcrumbs.push(folder.name);
  }

  if (selection.listId) {
    const list = graph.lists[selection.listId];
    if (list) breadcrumbs.push(list.name);
  }

  return breadcrumbs;
}
