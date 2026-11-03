import type { EntityVisibility } from "../types/tasks";

export function isAdminPrivateVisibility(
  visibility?: EntityVisibility | null,
) {
  return visibility === "admin_private";
}

export function isPublicVisibility(visibility?: EntityVisibility | null) {
  return visibility === "public";
}

export function getVisibilityLabel(visibility?: EntityVisibility | null) {
  switch (visibility) {
    case "admin_private":
      return "Privado ADM";
    case "public":
      return "Público";
    case "private":
    default:
      return "Privado";
  }
}
