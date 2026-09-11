"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

export type PromptSuggestion = {
  id?: string
  label: string
  icon?: React.ReactNode
}

export type PromptSuggestionsProps = Omit<
  React.ComponentProps<"ul">,
  "onSelect"
> & {
  items: PromptSuggestion[]
  onSelect?: (item: PromptSuggestion) => void
}

/**
 * The quiet list under an empty composer: one full-width row per prompt, no
 * borders or dividers — spacing and a hover fill carry the structure.
 */
export function PromptSuggestions({
  items,
  onSelect,
  className,
  ...props
}: PromptSuggestionsProps) {
  if (items.length === 0) return null

  return (
    <ul
      data-slot="prompt-suggestions"
      role="list"
      aria-label="Suggested prompts"
      /* Same measure and gutters as ChatInput, so the list lines up under the
         composer without a per-call-site override. */
      className={cn("mx-auto w-full max-w-3xl px-3 pt-2 sm:px-4", className)}
      {...props}
    >
      {items.map((item, index) => (
        <li key={item.id ?? `${item.label}-${index}`}>
          <button
            type="button"
            data-slot="prompt-suggestion"
            onClick={() => onSelect?.(item)}
            className="group flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left text-[13.5px] leading-snug text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 active:bg-muted [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
          >
            {item.icon ? (
              <span className="mt-px grid size-4 shrink-0 place-items-center text-muted-foreground/70 transition-colors group-hover:text-foreground">
                {item.icon}
              </span>
            ) : null}
            <span className="min-w-0">{item.label}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}
