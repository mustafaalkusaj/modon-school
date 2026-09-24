"use client";

import { type ReactNode } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/brand/brand-utils";
import {
  containerVariants,
  itemVariants,
  usePrefersReducedMotion,
  getVariants,
} from "@/lib/motion-variants";

interface StatItem {
  icon: ReactNode;
  label: string;
  value: string | number;
  color: string;
  onClick?: () => void;
}

interface StatsCardProps {
  items: StatItem[];
  className?: string;
}

export function StatsCard({ items, className }: StatsCardProps) {
  const reduced = usePrefersReducedMotion();
  const container = getVariants(reduced, containerVariants(0.06));
  const item = getVariants(reduced, itemVariants);

  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="visible"
      className={cn(
        "grid grid-cols-2 gap-2.5 sm:gap-3",
        className,
      )}
    >
      {items.map((stat, i) => (
        <motion.div
          key={i}
          variants={item}
          onClick={stat.onClick}
          className={cn(
            "relative overflow-hidden rounded-xl border border-[var(--card-border)]",
            "bg-[var(--card-bg)] p-3.5 sm:p-4",
            "transition-all duration-200",
            stat.onClick &&
              "cursor-pointer hover:shadow-md active:scale-[0.97]",
          )}
        >
          {/* Decorative corner accent */}
          <div
            className="absolute top-0 end-0 w-16 h-16 opacity-[0.07] rounded-bl-[2rem] pointer-events-none"
            style={{ backgroundColor: stat.color }}
          />

          <div
            className="flex items-center justify-center w-9 h-9 sm:w-10 sm:h-10 rounded-lg mb-2.5"
            style={{
              backgroundColor: `color-mix(in srgb, ${stat.color} 14%, transparent)`,
              color: stat.color,
            }}
          >
            {stat.icon}
          </div>

          <p className="text-xl sm:text-2xl font-bold text-[var(--text-primary)] leading-none mb-1">
            {stat.value}
          </p>
          <p className="text-[11px] sm:text-xs font-medium text-[var(--text-muted)] leading-tight">
            {stat.label}
          </p>
        </motion.div>
      ))}
    </motion.div>
  );
}
