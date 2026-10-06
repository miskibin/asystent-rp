"use client"

import { GripVertical } from "lucide-react"
import * as ResizablePrimitive from "react-resizable-panels"

import { cn } from "@/lib/utils"

/**
 * Group of resizable panels. Horizontal by default; `orientation="vertical"`
 * stacks them. Give it an `id` plus `defaultLayout` / `onLayoutChanged` (see
 * `useDefaultLayout` from `react-resizable-panels`) to remember the split.
 */
function ResizablePanelGroup({
  className,
  ...props
}: ResizablePrimitive.GroupProps) {
  return (
    <ResizablePrimitive.Group
      data-slot="resizable-panel-group"
      className={cn(
        "flex h-full w-full aria-[orientation=vertical]:flex-col",
        className
      )}
      {...props}
    />
  )
}

/**
 * One pane. `className` lands on the inner content wrapper — the outer element
 * is owned by the layout engine — so pass layout classes for your content here
 * and style the pane itself through `[data-slot="resizable-panel"]`.
 */
function ResizablePanel({ ...props }: ResizablePrimitive.PanelProps) {
  return <ResizablePrimitive.Panel data-slot="resizable-panel" {...props} />
}

/**
 * Draggable separator between two panels. It is focusable, and the arrow keys
 * (plus Home / End and Enter) resize the panels it sits between; double-click
 * restores their default sizes.
 */
function ResizableHandle({
  withHandle,
  className,
  ...props
}: ResizablePrimitive.SeparatorProps & {
  /** Renders the centred grip, so the handle reads as draggable. */
  withHandle?: boolean
}) {
  return (
    <ResizablePrimitive.Separator
      data-slot="resizable-handle"
      className={cn(
        "relative flex w-px items-center justify-center bg-border outline-none transition-colors",
        "after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2",
        "data-[separator=active]:bg-ring data-[separator=hover]:bg-ring/70",
        "focus-visible:ring-[3px] focus-visible:ring-ring/50",
        "aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:w-full",
        "aria-[orientation=horizontal]:after:left-0 aria-[orientation=horizontal]:after:h-1 aria-[orientation=horizontal]:after:w-full aria-[orientation=horizontal]:after:translate-x-0 aria-[orientation=horizontal]:after:-translate-y-1/2",
        "[&[aria-orientation=horizontal]>div]:rotate-90",
        className
      )}
      {...props}
    >
      {withHandle ? (
        <div
          data-slot="resizable-grip"
          className="z-10 flex h-4 w-3 items-center justify-center rounded-sm border bg-border text-muted-foreground transition-colors [&_svg]:size-2.5"
        >
          <GripVertical />
        </div>
      ) : null}
    </ResizablePrimitive.Separator>
  )
}

export { ResizableHandle, ResizablePanel, ResizablePanelGroup }
