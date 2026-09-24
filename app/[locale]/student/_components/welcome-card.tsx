"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/brand/brand-utils";
import {
  itemVariants,
  usePrefersReducedMotion,
  getVariants,
} from "@/lib/motion-variants";

interface WelcomeCardProps {
  studentName: string;
  className?: string;
  subtitle?: string;
}

export function WelcomeCard({
  studentName,
  className,
  subtitle,
}: WelcomeCardProps) {
  const reduced = usePrefersReducedMotion();
  const item = getVariants(reduced, itemVariants);

  const initials = studentName
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("");

  return (
    <motion.div
      variants={item}
      initial="hidden"
      animate="visible"
      className={cn(
        "relative overflow-hidden rounded-2xl p-4 sm:p-5",
        "bg-gradient-to-br from-[var(--primary)] to-[color-mix(in_srgb,var(--primary)_65%,#1e1b4b)]",
        "text-white",
        className,
      )}
    >
      {/* Decorative circles */}
      <div className="absolute -top-6 -end-6 w-24 h-24 rounded-full bg-white/[0.06] pointer-events-none" />
      <div className="absolute -bottom-4 -start-4 w-20 h-20 rounded-full bg-white/[0.04] pointer-events-none" />

      <div className="relative flex items-center gap-3 sm:gap-4">
        <div className="shrink-0 w-11 h-11 sm:w-14 sm:h-14 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center text-base sm:text-xl font-bold select-none">
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-base sm:text-xl font-bold truncate leading-snug">
            مرحباً، {studentName}
          </h1>
          {subtitle && (
            <p className="text-xs sm:text-sm opacity-80 mt-0.5 truncate">
              {subtitle}
            </p>
          )}
        </div>
      </div>
    </motion.div>
  );
}
