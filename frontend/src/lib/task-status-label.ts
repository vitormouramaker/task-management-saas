export function getTaskStatusLabel(name?: string | null) {
  const normalized = name
    ?.toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();

  if (normalized === "em andamento" || normalized === "andamento") {
    return "Andamento";
  }

  if (normalized === "em revisao" || normalized === "revisao") {
    return "Revisão";
  }

  return name || "";
}
