"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

export type GenerationStage = "thinking" | "searching" | "responding" | "idle"

export type GenerationStatusProps = React.ComponentProps<"span"> & {
  /** When true, shows the indicator. Prefer this over stage for simple UIs. */
  active?: boolean
  /** Optional legacy stage. Non-idle stages show the indicator. */
  stage?: GenerationStage
  /**
   * What the agent is doing. Read as a sentence with the elapsed time —
   * "Thinking for 12s" — and defaults to "Working" when no stage names it.
   */
  label?: string
  /** Indicator box size in px; the dot fills half of it. */
  size?: number
  /**
   * When the work started (epoch ms). Shows a ticking "12s" / "1m 05s" after
   * the label — written straight to the DOM once a second, so a long turn
   * costs no React renders at all.
   */
  startedAt?: number
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

// Adapted from T3 Code (github.com/pingdotgg/t3code), MIT License, (c) 2026 T3 Tools Inc.
/**
 * A highlight that sweeps across live text — the label of whatever is running
 * right now — in place of a spinner or a pulse. Stepped rather than smooth, so
 * a transcript with a live row repaints 14 times a second instead of 60, and
 * paused wherever `--visible-animation-state` says the row is off screen.
 * Nothing at all moves for readers who asked for less motion, or under forced
 * colours, where a transparent fill would erase the text.
 *
 * Shipped as a hoisted `<style>` (React 19 dedupes it by `href`) so the
 * component needs nothing added to the consumer's stylesheet — inside
 * `@layer components`, so a utility such as `animate-none` or a text colour on
 * the consumer's `className` still wins over it.
 */
const SHINE_CSS = `@keyframes lc-shine{from{background-position:-4.5rem 0,0 0}to{background-position:calc(100% + 4.5rem) 0,0 0}}
@layer components{@media (prefers-reduced-motion:no-preference) and (forced-colors:none){.lc-shine{color:transparent;background-image:linear-gradient(to right,transparent,var(--lc-shine-peak,var(--foreground)),transparent),linear-gradient(var(--lc-shine-base,var(--muted-foreground)),var(--lc-shine-base,var(--muted-foreground)));background-size:4.5rem 100%,100% 100%;background-repeat:no-repeat;-webkit-background-clip:text;background-clip:text;animation:lc-shine 2.2s steps(30) infinite;animation-play-state:var(--visible-animation-state,running)}}}`

/** Class that turns a span of text into a live, shining label. */
export const shineClassName = "lc-shine"

/**
 * Mount beside anything carrying `shineClassName`. Renders nothing where it
 * stands — React hoists the one stylesheet into the document head.
 */
export function ShineStyles() {
  return (
    <style href="lc-shine" precedence="default">
      {SHINE_CSS}
    </style>
  )
}

/** "4s", "1m 05s", "1h 02m". */
export function formatElapsed(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000))
  if (total < 60) return `${total}s`
  const minutes = Math.floor(total / 60)
  if (minutes < 60) return `${minutes}m ${String(total % 60).padStart(2, "0")}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`
}

function Elapsed({ startedAt }: { startedAt: number }) {
  const ref = React.useRef<HTMLSpanElement>(null)
  React.useEffect(() => {
    const node = ref.current
    if (!node) return
    const tick = () => {
      node.textContent = formatElapsed(Date.now() - startedAt)
    }
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [startedAt])
  return (
    <span
      ref={ref}
      data-slot="generation-status-elapsed"
      // The first paint has no clock to read; the effect fills it in.
      suppressHydrationWarning
      className="shrink-0 tabular-nums"
    />
  )
}

export function GenerationStatus({
  active,
  stage = "idle",
  label,
  className,
  size = 16,
  startedAt,
  ...props
}: GenerationStatusProps) {
  const show = active ?? stage !== "idle"
  if (!show) return null

  const text = label ?? STAGE_LABELS[stage] ?? "Working"
  // "Loading model…" reads as "Loading model for 12s" once a clock follows it.
  const sentence =
    startedAt != null ? text.replace(/(?:\u2026|\.\.\.)\s*$/, "") : text

  return (
    <span
      data-slot="generation-status"
      data-stage={stage}
      aria-live="polite"
      aria-busy="true"
      className={cn(
        "inline-flex min-w-0 items-center gap-1.5 text-[13px] text-muted-foreground",
        className
      )}
      {...props}
    >
      <ShineStyles />
      <PulseDot size={size} />
      <span className="flex min-w-0 items-baseline gap-1">
        <span
          data-slot="generation-status-label"
          className={cn("truncate", shineClassName)}
        >
          {sentence}
        </span>
        {startedAt != null ? (
          <>
            <span className="shrink-0">for</span>
            <Elapsed startedAt={startedAt} />
          </>
        ) : null}
      </span>
    </span>
  )
}
