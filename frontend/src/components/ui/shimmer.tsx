import React from "react";
import { motion, HTMLMotionProps } from "framer-motion";
import { cn } from "../../lib/utils";

export interface ShimmerProps extends HTMLMotionProps<"span"> {
  children: React.ReactNode;
  duration?: number;
  spread?: number;
}

/**
 * Shimmer Text Component (inspired by https://elements.ai-sdk.dev/components/shimmer)
 * Renders an animated text shine/sheen sweeping across the text.
 */
export function Shimmer({
  children,
  className,
  duration = 2.2,
  style,
  ...props
}: ShimmerProps) {
  return (
    <motion.span
      className={cn(
        "inline-flex items-center text-transparent bg-clip-text select-none font-medium",
        "bg-[length:250%_100%]",
        // Dark theme: soft zinc base with brilliant white/silver beam
        "dark:bg-gradient-to-r dark:from-zinc-400 dark:via-white dark:to-zinc-400",
        // Light theme: dark zinc base with jet-slate beam
        "bg-gradient-to-r from-zinc-500 via-zinc-950 to-zinc-500",
        className
      )}
      style={{
        ...style,
      }}
      animate={{
        backgroundPosition: ["120% 0%", "-120% 0%"],
      }}
      transition={{
        duration,
        repeat: Infinity,
        ease: "linear",
      }}
      {...props}
    >
      {children}
    </motion.span>
  );
}

export default Shimmer;
