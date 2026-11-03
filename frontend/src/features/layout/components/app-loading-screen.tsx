import { cn } from "../../../lib/utils";
import { useThemeStore } from "../../../store/use-theme-store";
import { Skeleton } from "../../../components/ui/skeleton";

function SeedSidebarSkeleton({ isDarkMode }: { isDarkMode: boolean }) {
  return (
    <aside className="pauta-sidebar relative z-50 flex h-full w-72 shrink-0 flex-col transition-[width] duration-500 ease-in-out">
      <div className="pauta-sidebar-inner flex h-full w-full flex-col">
        <div className="pauta-sidebar-brand-row flex h-20 shrink-0 items-center px-6">
          <div className="pauta-sidebar-logo flex items-center gap-3">
            <div className="pauta-sidebar-logo-mark flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-blue-500 bg-blue-600">
              <div className="grid grid-cols-2 gap-1">
                <span className="h-1.5 w-1.5 rounded-sm bg-white" />
                <span className="h-1.5 w-1.5 rounded-sm bg-white" />
                <span className="h-1.5 w-1.5 rounded-sm bg-white" />
                <span className="h-1.5 w-1.5 rounded-sm bg-white" />
              </div>
            </div>
            <span
              className={cn(
                "text-xl font-black tracking-tight",
                "text-(--ui-texto-principal)",
              )}
            >
              Pauta
            </span>
          </div>
        </div>

        <div className="pauta-sidebar-content flex-1 overflow-y-auto px-4 py-2 scrollbar-thin">
          <nav
            className="pauta-sidebar-nav mb-8"
            aria-label="Navegacao principal"
          >
            <ul className="pauta-sidebar-nav-list space-y-1.5">
              {["Inicio", "Calendario", "Membros", "Configuracoes"].map(
                (item, index) => (
                  <li key={item}>
                    <div
                      className={cn(
                        "pauta-sidebar-nav-item flex w-full items-center gap-3 rounded-2xl border border-transparent px-4 py-3 text-[14px] font-bold transition-colors duration-200",
                        index === 0
                          ? isDarkMode
                            ? "border-(--border-subtle) bg-(--bg-surface-muted) text-blue-300"
                            : "border border-slate-100 bg-slate-50 text-blue-600"
                          : "text-(--ui-texto-secundario)",
                      )}
                    >
                      <Skeleton className="h-5 w-5 rounded-lg" />
                      <span className="flex-1 text-left">{item}</span>
                    </div>
                  </li>
                ),
              )}
            </ul>
          </nav>

          <div className="pauta-sidebar-workspaces space-y-4">
            <div className="mb-2 flex items-center justify-between px-2">
              <span
                className={cn(
                  "text-[10px] font-black uppercase tracking-widest",
                  "text-(--ui-texto-secundario)",
                )}
              >
                Espacos de trabalho
              </span>
              <Skeleton className="h-6 w-6 rounded-lg" />
            </div>

            <ul className="space-y-2">
              {[...Array(2)].map((_, workspaceIndex) => (
                <li key={workspaceIndex} className="space-y-1">
                  <div className="group flex items-center gap-1 rounded-2xl transition-all">
                    <Skeleton className="ml-1 h-6 w-6 rounded-lg" />
                    <div className="flex flex-1 items-center gap-3 rounded-2xl px-4 py-2.5 text-left">
                      <Skeleton className="h-8 w-8 rounded-xl" />
                      <Skeleton className="h-4 flex-1 rounded-full" />
                    </div>
                    <Skeleton className="h-6 w-6 rounded-lg" />
                    <Skeleton className="h-6 w-6 rounded-lg" />
                  </div>

                  <div className="relative ml-8 mt-1">
                    <div
                      className={cn(
                        "absolute left-1.75 top-0 h-[calc(100%-12px)] w-[1.5px] rounded-full",
                        "bg-(--ui-borda-suave)",
                      )}
                    />
                    <ul className="space-y-1 pl-4">
                      {[...Array(workspaceIndex === 0 ? 3 : 2)].map(
                        (_, projectIndex) => (
                          <li key={projectIndex} className="relative">
                            <div
                              className={cn(
                                "absolute -left-2.75 top-3.5 h-[1.5px] w-2.5 rounded-full",
                                "bg-(--ui-borda-suave)",
                              )}
                            />
                            <div className="group/project flex items-center gap-1.5 rounded-xl transition-all">
                              <Skeleton className="h-5 w-5 rounded-lg" />
                              <div
                                className={cn(
                                  "flex flex-1 min-w-0 items-center gap-2.5 rounded-xl border border-transparent px-3 py-1.5 text-[13px] font-bold",
                                  workspaceIndex === 0 && projectIndex === 0
                                    ? "border-(--ui-azul-borda) bg-(--ui-azul-fundo) text-(--ui-azul-texto)"
                                    : "text-transparent",
                                )}
                              >
                                <Skeleton className="h-3.5 w-20 rounded-full" />
                              </div>
                              <Skeleton className="h-5 w-5 rounded-lg" />
                            </div>
                          </li>
                        ),
                      )}
                      <li className="relative">
                        <div
                          className={cn(
                            "absolute -left-2.75 top-3.5 h-[1.5px] w-2.5 rounded-full",
                            "bg-(--ui-borda-suave)",
                          )}
                        />
                        <div className="flex items-center gap-2 px-3 py-1.5">
                          <Skeleton className="h-4 w-4 rounded-full" />
                          <Skeleton className="h-3 w-24 rounded-full" />
                        </div>
                      </li>
                    </ul>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </aside>
  );
}

function SeedHeaderSkeleton() {
  return (
    <header className="pauta-app-header sticky top-0 z-20 flex h-20 items-center justify-between px-8 backdrop-blur-md">
      <div className="pauta-app-header-search relative w-full max-w-lg">
        <Skeleton className="h-10 w-full rounded-xl" />
      </div>

      <div className="pauta-app-header-actions flex items-center gap-6">
        <div
          className={cn(
            "pauta-app-header-notifications flex items-center gap-4 border-r pr-6",
            "border-(--ui-borda-suave)",
          )}
        >
          <Skeleton className="h-8 w-8 rounded-lg" />
          <Skeleton className="h-8 w-8 rounded-lg" />
        </div>

        <div className="pauta-app-header-user flex items-center gap-3 rounded-xl p-1.5 pr-3">
          <div className="pauta-app-header-user-text flex flex-col items-end gap-1">
            <Skeleton className="h-3.5 w-24 rounded-full" />
            <Skeleton className="h-3 w-20 rounded-full" />
          </div>
          <Skeleton className="h-9 w-9 rounded-full" />
          <Skeleton className="h-4 w-4 rounded-full" />
        </div>
      </div>
    </header>
  );
}

export function SeedProjectHeaderSkeleton() {
  return (
    <section
      className={cn(
        "pauta-app-main-header z-10 shrink-0 border-b px-6 pt-4 pb-0 backdrop-blur-sm",
        "border-(--ui-borda-suave) bg-(--ui-superficie-suave)",
      )}
    >
      <div className="pauta-project-header mb-3 flex items-center justify-between">
        <div className="mr-4 flex-1">
          <Skeleton className="h-8 w-40 rounded-full" />
        </div>

        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-8 rounded-lg" />
          <Skeleton className="h-8 w-8 rounded-lg" />
          <Skeleton className="h-8 w-8 rounded-lg" />
        </div>
      </div>

      <div className="pauta-project-metadata-row mb-3 flex flex-wrap items-center gap-x-8 gap-y-2">
        <div className="flex items-center gap-2">
          <Skeleton className="h-3 w-16 rounded-full" />
          <Skeleton className="h-7 w-28 rounded-full" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-3 w-16 rounded-full" />
          <div className="flex -space-x-2">
            <Skeleton className="h-6 w-6 rounded-full" />
            <Skeleton className="h-6 w-6 rounded-full" />
            <Skeleton className="h-6 w-6 rounded-full" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-3 w-10 rounded-full" />
          <Skeleton className="h-8 w-36 rounded-full" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-3 w-14 rounded-full" />
          <div className="flex gap-1.5">
            <Skeleton className="h-6 w-20 rounded-full" />
            <Skeleton className="h-6 w-16 rounded-full" />
            <Skeleton className="h-6 w-6 rounded-full" />
          </div>
        </div>
      </div>

      <div className="pauta-view-tabs-row flex items-end justify-between">
        <div className="pauta-view-tabs flex gap-7">
          <div className="relative flex items-center gap-1.5 pb-3 text-[13px] font-extrabold text-blue-600">
            <Skeleton className="h-4 w-4 rounded-lg" />
            <Skeleton className="h-3.5 w-14 rounded-full" />
            <div className="absolute -bottom-px left-0 h-[2.5px] w-full rounded-t-full bg-blue-600" />
          </div>
        </div>

        <div className="pb-3">
          <Skeleton className="h-8 w-36 rounded-lg" />
        </div>
      </div>
    </section>
  );
}

export function SeedBoardSkeleton({ isDarkMode }: { isDarkMode: boolean }) {
  return (
    <div className="pauta-main-content-scroll flex-1 overflow-auto px-6 py-4">
      <section
        className={cn(
          "pauta-kanban-board flex h-full min-h-0",
          isDarkMode && "text-(--text-main)",
        )}
      >
        <div className="pauta-kanban-columns flex h-full gap-3">
          {[...Array(5)].map((_, columnIndex) => (
            <div
              key={columnIndex}
              className="pauta-kanban-column flex h-full w-70 shrink-0 flex-col rounded-2xl"
            >
              <div
                className={cn(
                  "pauta-kanban-column-header mb-3 flex shrink-0 items-center justify-between rounded-xl border p-3",
                  "border-(--ui-borda) bg-(--ui-superficie-campo)",
                )}
              >
                <div className="pauta-kanban-column-header-main flex items-center gap-2">
                  <Skeleton className="h-2.5 w-2.5 rounded-full" />
                  <Skeleton className="h-4 w-24 rounded-full" />
                </div>
                <div className="pauta-kanban-column-header-actions flex items-center gap-1.5">
                  <Skeleton className="h-5 w-6 rounded-lg" />
                  <Skeleton className="h-4 w-4 rounded-lg" />
                  <Skeleton className="h-4 w-4 rounded-lg" />
                </div>
              </div>

              <div className="pauta-kanban-column-body flex-1 space-y-2.5 px-0.5 pb-2">
                {[...Array(columnIndex === 0 ? 1 : 3)].map((_, cardIndex) => (
                  <div
                    key={cardIndex}
                    className={cn(
                      "pauta-task-card group relative flex flex-col overflow-hidden rounded-2xl border",
                      "border-(--ui-borda) bg-(--ui-superficie)",
                    )}
                  >
                    <div
                      className={cn(
                        "pauta-task-card-header flex items-center justify-between border-b px-4 py-2.5",
                        "border-(--ui-borda)",
                      )}
                    >
                      <Skeleton className="h-5 w-20 rounded-full" />
                      <div className="flex items-center gap-1">
                        <Skeleton className="h-4 w-4 rounded-lg" />
                        <Skeleton className="h-4 w-4 rounded-lg" />
                        <Skeleton className="h-4 w-4 rounded-lg" />
                      </div>
                    </div>

                    <div className="pauta-task-card-body flex-1 p-4">
                      <Skeleton className="h-4 w-32 rounded-full" />
                      <Skeleton className="mt-3 h-3.5 w-[88%] rounded-full" />
                      <Skeleton className="mt-2 h-3.5 w-[64%] rounded-full" />
                      <Skeleton className="mt-4 h-3 w-28 rounded-full" />
                    </div>

                    <div
                      className={cn(
                        "pauta-task-card-footer flex items-center justify-between border-t px-4 py-3",
                        "border-(--ui-borda)",
                      )}
                    >
                      <div className="flex -space-x-2">
                        <Skeleton className="h-6 w-6 rounded-full" />
                        <Skeleton className="h-6 w-6 rounded-full" />
                      </div>
                      <div className="flex items-center gap-1">
                        <Skeleton className="h-5 w-8 rounded-lg" />
                        <Skeleton className="h-5 w-8 rounded-lg" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function SeedShellLoadingScreen({ isDarkMode }: { isDarkMode: boolean }) {
  return (
    <div className="pauta-app-shell flex h-screen w-screen overflow-hidden">
      <SeedSidebarSkeleton isDarkMode={isDarkMode} />

      <div className="pauta-app-shell-main flex flex-1 flex-col overflow-hidden">
        <SeedHeaderSkeleton />
        <main className="pauta-app-main flex flex-1 flex-col overflow-hidden">
          <SeedProjectHeaderSkeleton />
          <SeedBoardSkeleton isDarkMode={isDarkMode} />
        </main>
      </div>
    </div>
  );
}

export function AppLoadingScreen() {
  const isDarkMode = useThemeStore((state) => state.mode === "dark");
  return <SeedShellLoadingScreen isDarkMode={isDarkMode} />;
}
