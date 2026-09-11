import * as React from "react"

import { cn } from "@/lib/utils"

export type ChatNavbarProps = React.ComponentProps<"header"> & {
  /** String titles are truncated automatically; nodes are rendered as-is. */
  title?: React.ReactNode
  left?: React.ReactNode
  right?: React.ReactNode
}

export function ChatNavbar({
  title,
  left,
  right,
  className,
  children,
  ...props
}: ChatNavbarProps) {
  return (
    <header
      data-slot="chat-navbar"
      className={cn(
        "flex h-12 w-full shrink-0 items-center justify-between gap-2 border-b bg-background px-3 sm:gap-3 sm:px-4",
        className
      )}
      {...props}
    >
      <div
        data-slot="chat-navbar-left"
        className="flex min-w-0 flex-1 items-center gap-2"
      >
        {left}
        {typeof title === "string" ? (
          <h1
            data-slot="chat-navbar-title"
            className="truncate text-[13.5px] font-medium text-foreground"
          >
            {title}
          </h1>
        ) : (
          title
        )}
        {children}
      </div>
      <div
        data-slot="chat-navbar-right"
        className="flex shrink-0 items-center gap-1"
      >
        {right}
      </div>
    </header>
  )
}
