import * as React from "react"

import { cn } from "@/lib/utils"

// Adapted from T3 Code (github.com/pingdotgg/t3code), MIT License, (c) 2026 T3 Tools Inc.

/** "999", "1.2k", "34k", "1.5m" — a count that keeps to four characters. */
export function formatDiffCount(value: number): string {
  const compact = (n: number, unit: string) =>
    `${n < 10 ? n.toFixed(1).replace(/\.0$/, "") : Math.round(n)}${unit}`
  if (value < 1000) return String(value)
  if (value < 1_000_000) return compact(value / 1000, "k")
  return compact(value / 1_000_000, "m")
}

export type DiffStatProps = Omit<React.ComponentProps<"span">, "children"> & {
  additions?: number
  deletions?: number
  /**
   * `inline` sits in a sentence and drops a zero side. `aligned` is for a
   * column of rows: two fixed 4ch cells, right-aligned, so every `+` and every
   * `−` in a list lines up with the one above it.
   * @default "inline"
   */
  layout?: "inline" | "aligned"
}

/**
 * Lines added and removed. Green and red are the one raw-palette exception —
 * no theme token means "grew" — and both ship a dark variant. The numbers are
 * hidden from assistive tech in favour of one sentence on the group.
 */
export function DiffStat({
  additions = 0,
  deletions = 0,
  layout = "inline",
  className,
  ...props
}: DiffStatProps) {
  if (additions === 0 && deletions === 0) return null
  const aligned = layout === "aligned"
  return (
    <span
      role="group"
      aria-label={`${additions} added, ${deletions} removed`}
      data-slot="diff-stat"
      data-layout={layout}
      className={cn(
        "shrink-0 font-mono text-[12px] tabular-nums",
        aligned
          ? "inline-grid grid-cols-[4ch_4ch] gap-1.5 text-right"
          : "inline-flex items-center gap-1.5",
        className
      )}
      {...props}
    >
      {additions > 0 || aligned ? (
        <span
          aria-hidden
          data-slot="diff-stat-additions"
          className="text-emerald-600 dark:text-emerald-400"
        >
          {additions > 0 ? `+${formatDiffCount(additions)}` : null}
        </span>
      ) : null}
      {deletions > 0 || aligned ? (
        <span
          aria-hidden
          data-slot="diff-stat-deletions"
          className="text-red-500 dark:text-red-400"
        >
          {deletions > 0 ? `-${formatDiffCount(deletions)}` : null}
        </span>
      ) : null}
    </span>
  )
}
