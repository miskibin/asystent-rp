"use client"

import { Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"
import * as React from "react"

import { cn } from "@/lib/utils"

const subscribe = () => () => {}

/** True only after hydration, so the icon never mismatches the server HTML. */
function useHydrated() {
  return React.useSyncExternalStore(
    subscribe,
    () => true,
    () => false
  )
}

export type ThemeToggleProps = React.ComponentProps<"button"> & {
  /** Fixed floating chip (default) or inline. */
  floating?: boolean
}

export function ThemeToggle({
  className,
  floating = true,
  onClick,
  ...props
}: ThemeToggleProps) {
  const { resolvedTheme, setTheme } = useTheme()
  const mounted = useHydrated()
  const isDark = mounted && resolvedTheme === "dark"

  return (
    <button
      type="button"
      data-slot="theme-toggle"
      aria-label="Toggle theme"
      title={isDark ? "Switch to light" : "Switch to dark"}
      onClick={(event) => {
        onClick?.(event)
        if (event.defaultPrevented) return
        setTheme(isDark ? "light" : "dark")
      }}
      className={cn(
        "inline-grid size-8 shrink-0 place-items-center rounded-full border bg-background text-muted-foreground shadow-xs outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0",
        floating && "fixed top-3 right-3 z-50",
        className
      )}
      {...props}
    >
      {mounted ? isDark ? <Sun /> : <Moon /> : null}
    </button>
  )
}
