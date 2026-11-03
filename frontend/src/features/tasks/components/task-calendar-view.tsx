import { useState } from "react";
import { useListViewData } from "../hooks/use-list-view-data";
import { TaskCalendar } from "./task-calendar";
import { TaskCreateModal } from "./task-create-modal";

/** Visão Calendário do projeto aberto. */
export function TaskCalendarView() {
  const { tasks, doneStatusIds, canEditTasks } = useListViewData();
  const [createDate, setCreateDate] = useState<Date | null>(null);

  return (
    <>
      <TaskCalendar
        tasks={tasks}
        doneStatusIds={doneStatusIds}
        canEditTask={() => canEditTasks}
        onCreate={canEditTasks ? setCreateDate : undefined}
      />
      <TaskCreateModal
        isOpen={createDate !== null}
        onClose={() => setCreateDate(null)}
        defaultDueDate={createDate?.toISOString() ?? null}
      />
    </>
  );
}
