import * as React from "react";
import { motion, type MotionProps } from "framer-motion";
import { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/brand/brand-utils";

const MotionCard = motion(Card);

// ── Types ─────────────────────────────────────────────────────────────────────

export type StatsCardVariant =
  | "primary"
  | "info"
  | "success"
  | "warning"
  | "danger"
  | "neutral";

export type TrendVariant = "success" | "danger" | "neutral";

export interface StatsCardTrend {
  value: string | number;
  label: string;
  variant: TrendVariant;
}

export interface StatsCardProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, keyof MotionProps>,
    MotionProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  description?: string;
  trend?: StatsCardTrend;
  variant?: StatsCardVariant;
  gradient?: boolean;
}

// ── Variant Styles ────────────────────────────────────────────────────────────

const variantStyles: Record<StatsCardVariant, string> = {
  primary:
    "bg-[color-mix(in_srgb,var(--primary)_10%,transparent)] text-[var(--primary)] border-[color-mix(in_srgb,var(--primary)_10%,transparent)]",
  info: "bg-[color-mix(in_srgb,var(--info)_10%,transparent)] text-[var(--info)] border-[color-mix(in_srgb,var(--info)_10%,transparent)]",
  success:
    "bg-[color-mix(in_srgb,var(--success)_10%,transparent)] text-[var(--success)] border-[color-mix(in_srgb,var(--success)_10%,transparent)]",
  warning:
    "bg-[color-mix(in_srgb,var(--warning)_10%,transparent)] text-[var(--warning)] border-[color-mix(in_srgb,var(--warning)_10%,transparent)]",
  danger:
    "bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] text-[var(--danger)] border-[color-mix(in_srgb,var(--danger)_10%,transparent)]",
  neutral:
    "bg-[color-mix(in_srgb,var(--text-muted)_10%,transparent)] text-[var(--text-muted)] border-[color-mix(in_srgb,var(--text-muted)_10%,transparent)]",
};

const gradientCardStyles: Record<StatsCardVariant, string> = {
  primary: "bg-gradient-to-br from-[var(--primary)] to-[color-mix(in_srgb,var(--primary)_70%,#1e1b4b)] border-transparent",
  info: "bg-gradient-to-br from-[var(--info)] to-[color-mix(in_srgb,var(--info)_70%,#1e1b4b)] border-transparent",
  success: "bg-gradient-to-br from-[var(--success)] to-[color-mix(in_srgb,var(--success)_70%,#064e3b)] border-transparent",
  warning: "bg-gradient-to-br from-[var(--warning)] to-[color-mix(in_srgb,var(--warning)_70%,#78350f)] border-transparent",
  danger: "bg-gradient-to-br from-[var(--danger)] to-[color-mix(in_srgb,var(--danger)_70%,#7f1d1d)] border-transparent",
  neutral: "bg-gradient-to-br from-[var(--text-muted)] to-[color-mix(in_srgb,var(--text-muted)_70%,#1f2937)] border-transparent",
};

const trendStyles: Record<TrendVariant, string> = {
  success:
    "bg-[color-mix(in_srgb,var(--success)_10%,transparent)] text-[var(--success)]",
  danger:
    "bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] text-[var(--danger)]",
  neutral:
    "bg-[color-mix(in_srgb,var(--text-muted)_10%,transparent)] text-[var(--text-muted)]",
};

// ── StatsCard Component ──────────────────────────────────────────────────────

export const StatsCard = React.forwardRef<HTMLDivElement, StatsCardProps>(
  (
    {
      label,
      value,
      icon: Icon,
      description,
      trend,
      variant = "primary",
      gradient = false,
      className,
      ...props
    },
    ref
  ) => {
    return (
      <MotionCard
        ref={ref}
        className={cn(
          "group relative overflow-hidden",
          "rounded-[var(--card-radius)]",
          gradient && gradientCardStyles[variant],
          className
        )}
        whileHover={{ scale: 1.02, transition: { duration: 0.15 } }}
        {...props}
      >
        <div className="p-[var(--card-padding)]">
          <div className="flex items-start justify-between gap-4">
            {/* Content Section */}
            <div className="flex-1 min-w-0 space-y-1">
              {/* Label */}
              <p className={cn(
                "text-xs font-semibold uppercase tracking-wider",
                gradient ? "text-white/70" : "text-[var(--text-muted)]"
              )}>
                {label}
              </p>

              {/* Value */}
              <p
                className={cn(
                  "text-2xl font-bold tabular-nums whitespace-normal break-words leading-tight",
                  gradient ? "text-white" : "text-[var(--text-primary)]"
                )}
                dir="auto"
              >
                {value}
              </p>

              {/* Trend */}
              {trend && (
                <div className="flex items-center gap-1.5 mt-1">
                  <span
                    className={cn(
                      "px-2 py-0.5 rounded-full text-xs font-semibold",
                      gradient ? "bg-white/20 text-white" : trendStyles[trend.variant]
                    )}
                  >
                    {trend.value}
                  </span>
                  <span className={cn("text-xs", gradient ? "text-white/70" : "text-[var(--text-muted)]")}>
                    {trend.label}
                  </span>
                </div>
              )}

              {/* Description */}
              {description && (
                <p className={cn(
                  "text-sm line-clamp-1",
                  gradient ? "text-white/70" : "text-[var(--text-secondary)]"
                )}>
                  {description}
                </p>
              )}
            </div>

            {/* Icon Container */}
            <div
              className={cn(
                "shrink-0 rounded-[var(--radius-lg)] p-3 border",
                "transition-transform duration-200 group-hover:scale-110",
                gradient ? "bg-white/20 text-white border-white/10" : variantStyles[variant]
              )}
            >
              <Icon className="h-7 w-7" strokeWidth={2.5} />
            </div>
          </div>

          {/* Subtle Decorative Gradient */}
          {!gradient && (
            <div
              className="absolute -bottom-6 -end-6 h-24 w-24 rounded-full blur-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300"
              style={{
                background: `linear-gradient(to bottom right, color-mix(in_srgb, var(--primary) 5%, transparent), transparent)`,
              }}
            />
          )}
          {gradient && (
            <div className="absolute -top-6 -end-6 w-24 h-24 rounded-full bg-white/[0.06] pointer-events-none" />
          )}
        </div>
      </MotionCard>
    );
  }
);

StatsCard.displayName = "StatsCard";

// ── KPIGrid Component ─────────────────────────────────────────────────────────

export interface KPIGridProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export const KPIGrid = React.forwardRef<HTMLDivElement, KPIGridProps>(
  ({ children, className, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn("grid gap-4 sm:grid-cols-2 lg:grid-cols-4", className)}
        {...props}
      >
        {children}
      </div>
    );
  }
);

KPIGrid.displayName = "KPIGrid";
