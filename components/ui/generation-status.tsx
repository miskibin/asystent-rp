"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

export type GenerationStage = "thinking" | "searching" | "responding" | "idle"

export type GenerationStatusProps = React.ComponentProps<"span"> & {
  /** When true, shows the indicator. Prefer this over stage for simple UIs. */
  active?: boolean
  /** Optional legacy stage. Non-idle stages show the indicator. */
  stage?: GenerationStage
  /** Optional label next to the indicator. */
  label?: string
  /** Indicator box size in px; the dot fills half of it. */
  size?: number
}

const STAGE_LABELS: Record<GenerationStage, string | undefined> = {
  thinking: "Thinking",
  searching: "Searching",
  responding: "Responding",
  idle: undefined,
}

/**
 * One dot, breathing. No timers and no frame state: the browser owns the
 * animation, and `motion-safe` drops it entirely for readers who asked for
 * less motion — the dot simply sits there instead.
 */
function PulseDot({ size = 16 }: { size?: number }) {
  return (
    <span
      data-slot="generation-status-spinner"
      aria-label="Loading"
      role="status"
      className="inline-grid shrink-0 place-items-center text-muted-foreground"
      style={{ width: size, height: size }}
    >
      <span
        aria-hidden
        style={{ width: size / 2, height: size / 2 }}
        className="rounded-full bg-current motion-safe:animate-pulse"
      />
    </span>
  )
}

export function GenerationStatus({
  active,
  stage = "idle",
  label,
  className,
  size = 16,
  ...props
}: GenerationStatusProps) {
  const show = active ?? stage !== "idle"
  if (!show) return null

  const text = label ?? STAGE_LABELS[stage]

  return (
    <span
      data-slot="generation-status"
      data-stage={stage}
      aria-live="polite"
      aria-busy="true"
      className={cn(
        "inline-flex items-center gap-1.5 text-[13px] text-muted-foreground",
        className
      )}
      {...props}
    >
      <PulseDot size={size} />
      {text ? (
        <span
          data-slot="generation-status-label"
          className="truncate motion-safe:animate-pulse"
        >
          {text}
        </span>
      ) : null}
    </span>
  )
}
