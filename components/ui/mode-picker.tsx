"use client"

import { Bot, ChevronDown, ListTodo, MessageCircle } from "lucide-react"
import * as React from "react"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

export type ChatMode = "ask" | "plan" | "agent"

export const CHAT_MODES: {
  id: ChatMode
  name: string
  description: string
  icon: typeof Bot
}[] = [
  {
    id: "ask",
    name: "Ask",
    description: "Read-only answers, no edits",
    icon: MessageCircle,
  },
  {
    id: "plan",
    name: "Plan",
    description: "Analyze and propose a plan",
    icon: ListTodo,
  },
  {
    id: "agent",
    name: "Agent",
    description: "Edit files and run commands",
    icon: Bot,
  },
]

export type ModePickerProps = {
  value?: ChatMode
  defaultValue?: ChatMode
  onChange?: (mode: ChatMode) => void
  disabled?: boolean
  /** Which way the menu opens. Composers open "top", navbars open "bottom". */
  side?: "top" | "bottom"
  className?: string
}

export function ModePicker({
  value,
  defaultValue = "agent",
  onChange,
  disabled = false,
  side = "top",
  className,
}: ModePickerProps) {
  const [internal, setInternal] = React.useState<ChatMode>(defaultValue)
  const selectedId = value ?? internal
  const current =
    CHAT_MODES.find((m) => m.id === selectedId) ?? CHAT_MODES[2]
  const Icon = current.icon

  const pick = React.useCallback(
    (mode: ChatMode) => {
      setInternal(mode)
      onChange?.(mode)
    },
    [onChange]
  )

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-slot="mode-picker-trigger"
          disabled={disabled}
          title="Change mode"
          className={cn(
            "group inline-flex h-9 max-w-full min-w-0 items-center gap-1.5 rounded-md px-2 text-[12px] text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 data-[state=open]:bg-muted data-[state=open]:text-foreground sm:h-7 [&_svg]:pointer-events-none [&_svg]:shrink-0",
            className
          )}
        >
          <Icon className="size-3.5" />
          <span className="truncate">{current.name}</span>
          <ChevronDown className="size-3 opacity-60 transition-transform duration-150 group-data-[state=open]:rotate-180" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        data-slot="mode-picker-content"
        side={side}
        align="start"
        sideOffset={8}
        collisionPadding={12}
        className="w-[min(16rem,calc((100vw-1.5rem)/var(--ui-scale,1)))]"
      >
        <DropdownMenuLabel className="px-2 pt-1.5 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          Mode
        </DropdownMenuLabel>
        {CHAT_MODES.map((mode) => {
          const ModeIcon = mode.icon
          const selected = mode.id === selectedId
          return (
            <DropdownMenuItem
              key={mode.id}
              data-slot="mode-picker-item"
              aria-checked={selected}
              role="menuitemradio"
              onSelect={() => pick(mode.id)}
              className="items-start gap-2.5 py-2"
            >
              <span className="mt-px grid size-6 shrink-0 place-items-center rounded-md border bg-muted text-muted-foreground">
                <ModeIcon className="size-3" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] text-foreground">
                  {mode.name}
                </span>
                <span className="mt-0.5 block text-[11px] text-muted-foreground">
                  {mode.description}
                </span>
              </span>
              {selected ? (
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />
              ) : null}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
