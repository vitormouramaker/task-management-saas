import { cn } from "../../../lib/utils";

interface AuthCardProps {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  topAction?: React.ReactNode;
}

/** Moldura das telas de link recebido por e-mail (convite, confirmação). */
export function AuthCard({ icon: Icon, title, subtitle, children, topAction }: AuthCardProps) {

  return (
    <div className="pauta-auth-screen flex min-h-dvh items-center justify-center p-4 py-10">
      <div className="pauta-auth-card relative w-full max-w-115 rounded-2xl border p-5 sm:rounded-3xl sm:p-8 backdrop-blur-xl animate-in fade-in zoom-in-95 duration-500">
        {topAction && <div className="absolute right-6 top-6">{topAction}</div>}
        <div className="mb-8 mt-6 text-center">
          <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-linear-to-br from-blue-600 to-indigo-600 shadow-lg shadow-blue-500/30">
            <Icon className="h-7 w-7 text-white" />
          </div>
          <h1 className={cn("text-2xl font-black tracking-tight", "text-(--ui-texto-principal)")}>
            {title}
          </h1>
          {subtitle && (
            <p className={cn("mt-2 text-sm font-medium", "text-(--ui-texto-secundario)")}>
              {subtitle}
            </p>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

export function SecondaryButton({
  children,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        "flex h-11 w-full items-center justify-center gap-2 rounded-xl border text-sm font-bold transition-colors cursor-pointer disabled:opacity-50 disabled:pointer-events-none",
        "border-(--ui-borda) text-(--ui-texto-secundario) hover:bg-(--ui-hover) hover:text-(--ui-texto-forte)",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
