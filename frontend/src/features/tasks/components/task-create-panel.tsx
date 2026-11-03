import { zodResolver } from "@hookform/resolvers/zod";
import { Plus } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { useState } from "react";

import { getTaskStatusLabel } from "../../../lib/task-status-label";
import { getStatusesForList } from "../../../lib/status-columns";
import { cn } from "../../../lib/utils";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { useTaskStore } from "../../../store/use-task-store";
import { TASK_PRIORITY_VALUES, type TaskPriority } from "../../../types/tasks";

const createTaskSchema = z.object({
  title: z.string().min(3, "Informe um titulo com pelo menos 3 caracteres."),
  descriptionText: z.string().min(8, "Descreva o card (min. 8 caracteres)."),
  statusId: z.string().min(1, "Selecione um status."),
  priority: z.enum(TASK_PRIORITY_VALUES),
  dueDate: z.string().optional(),
});

type CreateTaskFormValues = z.infer<typeof createTaskSchema>;

const priorityLabels: Record<TaskPriority, string> = {
  urgent: "Urgente",
  high: "Alta",
  medium: "Media",
  low: "Baixa",
};

export function TaskCreatePanel() {
  const graph = useTaskStore((state) => state.graph);
  const selection = useTaskStore((state) => state.selection);
  const addTask = useTaskStore((state) => state.addTask);
  const activeList = selection.listId
    ? graph.lists[selection.listId]
    : undefined;

  const memberOptions = Object.values(graph.members);
  const [selectedAssignees, setSelectedAssignees] = useState<string[]>([]);

  const form = useForm<CreateTaskFormValues>({
    resolver: zodResolver(createTaskSchema),
    defaultValues: {
      title: "",
      descriptionText: "",
      statusId: graph.statusDefinitions[0]?.id ?? "",
      priority: "medium",
      dueDate: "",
    },
  });

  return (
    <aside
      className={cn(
        "pauta-task-create-panel p-4",
        "rounded-2xl border border-slate-200 bg-white",
      )}
    >
      <div className="pauta-task-create-panel-header flex items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-bold text-slate-900">Novo card</h2>
          <p className="text-xs text-slate-500">
            {activeList
              ? `Adicionar em ${activeList.name}`
              : "Selecione uma lista"}
          </p>
        </div>
        <Badge variant="blue">Formulario</Badge>
      </div>

      <form
        className="pauta-task-create-panel-form mt-4 space-y-3"
        onSubmit={form.handleSubmit((values) => {
          addTask({
            title: values.title,
            descriptionText: values.descriptionText,
            statusId: values.statusId,
            priority: values.priority,
            dueDate: values.dueDate ? values.dueDate : null,
            assigneeIds: selectedAssignees,
          });

          setSelectedAssignees([]);
          form.reset({
            title: "",
            descriptionText: "",
            statusId: values.statusId,
            priority: values.priority,
            dueDate: "",
          });
        })}
      >
        <div>
          <label
            htmlFor="task-title"
            className="mb-1 block text-xs font-semibold uppercase tracking-[0.08em] text-slate-500"
          >
            Titulo
          </label>
          <Input
            id="task-title"
            placeholder="Ex.: Ajustar fluxo de onboarding"
            {...form.register("title")}
          />
          {form.formState.errors.title ? (
            <p className="mt-1 text-xs text-rose-600">
              {form.formState.errors.title.message}
            </p>
          ) : null}
        </div>

        <div>
          <label
            htmlFor="task-description"
            className="mb-1 block text-xs font-semibold uppercase tracking-[0.08em] text-slate-500"
          >
            Descricao (texto rico)
          </label>
          <textarea
            id="task-description"
            rows={4}
            placeholder="Cole HTML simples ou descreva o card (MVP)."
            className={cn(
              "w-full rounded-xl border border-slate-200 bg-white",
              "px-3 py-2 text-sm text-slate-800 outline-none transition",
              "placeholder:text-slate-500 focus:border-blue-300",
              "focus:ring-4 focus:ring-blue-100",
            )}
            {...form.register("descriptionText")}
          />
          {form.formState.errors.descriptionText ? (
            <p className="mt-1 text-xs text-rose-600">
              {form.formState.errors.descriptionText.message}
            </p>
          ) : null}
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
            Responsáveis
          </label>
          <div className="flex flex-wrap gap-2 mt-1">
            {memberOptions.map((member) => {
              const isSelected = selectedAssignees.includes(member.id);
              return (
                <button
                  type="button"
                  key={member.id}
                  onClick={() => {
                    setSelectedAssignees((prev) =>
                      prev.includes(member.id)
                        ? prev.filter((id) => id !== member.id)
                        : [...prev, member.id],
                    );
                  }}
                  className={cn(
                    "flex items-center gap-2 rounded-full border px-3 py-1.5 transition-colors cursor-pointer text-[13px] font-bold",
                    isSelected
                      ? "border-blue-500 bg-blue-50 text-blue-700"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
                  )}
                >
                  <div
                    className={cn(
                      "h-4 w-4 rounded-full flex items-center justify-center text-[8px] text-white border border-white/50",
                      member.avatarColor || "bg-slate-300",
                    )}
                  >
                    {member.name.charAt(0)}
                  </div>
                  {member.name.split(" ")[0]}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label
              htmlFor="task-status"
              className="mb-1 block text-xs font-semibold uppercase tracking-[0.08em] text-slate-500"
            >
              Status
            </label>
            <select
              id="task-status"
              className={cn(
                "h-10 w-full rounded-xl border border-slate-200",
                "bg-white px-3 text-sm outline-none",
                "focus:border-blue-300 focus:ring-4 focus:ring-blue-100",
              )}
              {...form.register("statusId")}
            >
              {getStatusesForList(
                graph.statusDefinitions,
                selection.listId,
              ).map((status) => (
                <option key={status.id} value={status.id}>
                  {getTaskStatusLabel(status.name)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="task-priority"
              className="mb-1 block text-xs font-semibold uppercase tracking-[0.08em] text-slate-500"
            >
              Prioridade
            </label>
            <select
              id="task-priority"
              className={cn(
                "h-10 w-full rounded-xl border border-slate-200",
                "bg-white px-3 text-sm outline-none",
                "focus:border-blue-300 focus:ring-4 focus:ring-blue-100",
              )}
              {...form.register("priority")}
            >
              {TASK_PRIORITY_VALUES.map((priority) => (
                <option key={priority} value={priority}>
                  {priorityLabels[priority]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label
            htmlFor="task-due-date"
            className="mb-1 block text-xs font-semibold uppercase tracking-[0.08em] text-slate-500"
          >
            Prazo
          </label>
          <Input id="task-due-date" type="date" {...form.register("dueDate")} />
        </div>

        <Button
          type="submit"
          className="w-full rounded-xl"
          disabled={!activeList}
        >
          <Plus className="h-4 w-4" />
          Adicionar novo card
        </Button>
      </form>
    </aside>
  );
}
