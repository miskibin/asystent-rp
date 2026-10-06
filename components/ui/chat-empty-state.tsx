import * as React from "react"

import { cn } from "@/lib/utils"

export type ChatEmptyStateProps = React.ComponentProps<"section"> & {
  title: React.ReactNode
  description?: React.ReactNode
  icon?: React.ReactNode
  children?: React.ReactNode
}

/**
 * A calm starting point for a conversation. The host supplies the copy,
 * optional mark, and any suggested actions without giving up the layout.
 */
export function ChatEmptyState({
  title,
  description,
  icon,
  className,
  children,
  ...props
}: ChatEmptyStateProps) {
  return (
    <section
      data-slot="chat-empty-state"
      className={cn(
        "mx-auto flex w-full max-w-2xl flex-col items-center justify-center px-4 py-10 text-center sm:px-6 sm:py-16",
        className
      )}
      {...props}
    >
      {icon ? (
        <div
          data-slot="chat-empty-state-icon"
          className="mb-4 grid size-10 place-items-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-5"
        >
          {icon}
        </div>
      ) : null}
      <h2
        data-slot="chat-empty-state-title"
        className="text-pretty text-lg font-semibold tracking-tight text-foreground sm:text-xl"
      >
        {title}
      </h2>
      {description ? (
        <p
          data-slot="chat-empty-state-description"
          className="mt-2 max-w-lg text-pretty text-[13px] leading-relaxed text-muted-foreground"
        >
          {description}
        </p>
      ) : null}
      {children ? (
        <div data-slot="chat-empty-state-actions" className="mt-6 w-full">
          {children}
        </div>
      ) : null}
    </section>
  )
}
