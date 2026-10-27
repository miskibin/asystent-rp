import * as React from "react"

import { cn } from "@/lib/utils"

// Adapted from T3 Code (github.com/pingdotgg/t3code), MIT License, (c) 2026 T3 Tools Inc.

/**
 * A key, as a quiet tinted square — a shade of the ink rather than a bordered
 * keycap, so a row of hints reads as a hint and not as a row of buttons.
 * Inherits nothing interactive: it is never what the pointer lands on.
 */
export function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "pointer-events-none inline-flex h-5 min-w-5 items-center justify-center gap-1 rounded bg-foreground/[0.07] px-1 font-sans text-[11px] font-medium text-muted-foreground select-none [&_svg:not([class*='size-'])]:size-3",
        className
      )}
      {...props}
    />
  )
}

/** Keys pressed together — `⌘` `K` — spaced as one chord. */
export function KbdGroup({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd-group"
      className={cn("inline-flex items-center gap-1", className)}
      {...props}
    />
  )
}
