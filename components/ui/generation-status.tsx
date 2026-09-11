import * as React from "react";

import { cn } from "@/lib/utils";

export type GenerationStage = "thinking" | "searching" | "responding" | "idle";

export type GenerationStatusProps = React.ComponentProps<"span"> & {
  active?: boolean;
  stage?: GenerationStage;
  label?: string;
  size?: number;
};

const STAGE_LABELS: Record<GenerationStage, string | undefined> = {
  thinking: "Thinking",
  searching: "Searching",
  responding: "Responding",
  idle: undefined,
};

/** Copied from miskibin/chat-components: one quiet, accessible loading cue. */
export function GenerationStatus({
  active,
  stage = "idle",
  label,
  className,
  size = 16,
  ...props
}: GenerationStatusProps) {
  const show = active ?? stage !== "idle";
  if (!show) return null;

  const text = label ?? STAGE_LABELS[stage];

  return (
    <span
      data-slot="generation-status"
      data-stage={stage}
      aria-live="polite"
      aria-busy="true"
      className={cn("inline-flex items-center gap-1.5 text-[13px] text-muted-foreground", className)}
      {...props}
    >
      <span
        data-slot="generation-status-spinner"
        aria-label="Ładowanie"
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
      {text ? (
        <span data-slot="generation-status-label" className="truncate motion-safe:animate-pulse">
          {text}
        </span>
      ) : null}
    </span>
  );
}
