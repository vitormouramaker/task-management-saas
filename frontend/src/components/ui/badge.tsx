import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../../lib/utils";
import { useThemeStore } from "../../store/use-theme-store";

const badgeVariants = cva(
  "pauta-ui-badge inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset",
  {
    variants: {
      variant: {
        neutral: "bg-slate-100 text-slate-700 ring-slate-200",
        blue: "bg-blue-50 text-blue-700 ring-blue-200",
        green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
        amber: "bg-amber-50 text-amber-700 ring-amber-200",
        rose: "bg-rose-50 text-rose-700 ring-rose-200",
        purple: "bg-violet-50 text-violet-700 ring-violet-200",
        cyan: "bg-cyan-50 text-cyan-700 ring-cyan-200",
      },
    },
    defaultVariants: {
      variant: "neutral",
    },
  },
);

export interface BadgeProps
  extends
    React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  const isDarkMode = useThemeStore((state) => state.mode === "dark");

  const darkVariantClass =
    variant === "blue"
      ? "bg-blue-500/12 text-blue-300 ring-blue-500/25"
      : variant === "green"
        ? "bg-emerald-500/12 text-emerald-300 ring-emerald-500/25"
        : variant === "amber"
          ? "bg-amber-500/12 text-amber-300 ring-amber-500/25"
          : variant === "rose"
            ? "bg-rose-500/12 text-rose-300 ring-rose-500/25"
            : variant === "purple"
              ? "bg-violet-500/12 text-violet-300 ring-violet-500/25"
              : variant === "cyan"
                ? "bg-cyan-500/12 text-cyan-300 ring-cyan-500/25"
                : "bg-(--bg-surface) text-(--text-muted) ring-(--border-subtle)";

  return (
    <span
      className={cn(
        badgeVariants({ variant }),
        isDarkMode && darkVariantClass,
        className,
      )}
      {...props}
    />
  );
}
