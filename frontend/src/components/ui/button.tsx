import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "pauta-ui-button inline-flex items-center justify-center gap-2 rounded-xl text-sm font-semibold transition disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-(--bg-app)",
  {
    variants: {
      variant: {
        default: "bg-blue-600 text-white hover:bg-blue-500",
        secondary:
          "bg-(--bg-elevated) text-(--text-main) ring-1 ring-(--border-subtle) hover:bg-(--bg-surface-muted)",
        ghost: "text-(--text-muted) hover:bg-white/5 hover:text-(--text-main)",
        soft: "bg-blue-500/12 text-blue-600 hover:bg-blue-500/18",
        destructive: "bg-rose-600 text-white hover:bg-rose-500",
      },
      size: {
        sm: "h-8 px-3 text-xs",
        md: "h-10 px-4",
        lg: "h-11 px-5",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "md",
    },
  },
);

export interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  ),
);

Button.displayName = "Button";
