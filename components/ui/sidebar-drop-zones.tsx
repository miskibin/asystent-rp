"use client"

import { useDroppable } from "@dnd-kit/core"
import { cva, type VariantProps } from "class-variance-authority"
import type { ReactNode } from "react"

import type {
  SidebarDropZoneDef,
  SidebarZoneEdge,
  SidebarZoneTone,
} from "@/components/ui/sidebar-dnd"
import { cn } from "@/lib/utils"

const dropZoneSurfaceVariants = cva(
  "flex items-center justify-center gap-1.5 rounded-md border border-dashed text-xs font-medium transition-colors duration-150 select-none",
  {
    variants: {
      tone: {
        accent:
          "border-primary/40 bg-primary/10 text-primary data-[over=true]:border-primary data-[over=true]:bg-primary data-[over=true]:text-primary-foreground",
        danger:
          "border-destructive/40 bg-destructive/10 text-destructive data-[over=true]:border-destructive data-[over=true]:bg-destructive data-[over=true]:text-white",
        muted:
          "border-border bg-muted/60 text-muted-foreground data-[over=true]:border-foreground/25 data-[over=true]:bg-accent data-[over=true]:text-accent-foreground",
      },
    },
    defaultVariants: { tone: "accent" },
  }
)

export type SidebarDropZoneToneProps = VariantProps<
  typeof dropZoneSurfaceVariants
>

type SidebarDropZoneBaseProps = {
  id: string
  label: ReactNode
  icon?: ReactNode
  tone?: SidebarZoneTone
  className?: string
  /** Class applied to the dashed surface itself. */
  surfaceClassName?: string
}

/** Turns a `SidebarDropZoneDef` into the props both zone components take. */
export function dropZoneProps(zone: SidebarDropZoneDef) {
  return {
    id: zone.id,
    label: zone.label,
    icon: zone.icon,
    tone: zone.tone,
  }
}

/**
 * Full-width zone anchored to the top or bottom edge of the sidebar panel.
 * Mount it only while a drag is active — it animates itself in.
 */
export function SidebarEdgeDropZone({
  id,
  label,
  icon,
  tone = "accent",
  edge = "top",
  className,
  surfaceClassName,
}: SidebarDropZoneBaseProps & { edge?: SidebarZoneEdge }) {
  const { setNodeRef, isOver } = useDroppable({ id })

  return (
    <div
      ref={setNodeRef}
      data-slot="sidebar-edge-drop-zone"
      data-edge={edge}
      data-over={isOver}
      className={cn(
        "pointer-events-auto absolute inset-x-2 z-30 flex h-[16%] min-h-20 items-stretch",
        "animate-in fade-in-0 duration-200 ease-out",
        edge === "top"
          ? "top-2 slide-in-from-top-2"
          : "bottom-2 slide-in-from-bottom-2",
        className
      )}
    >
      <div
        data-over={isOver}
        className={cn(
          dropZoneSurfaceVariants({ tone }),
          "size-full px-3 backdrop-blur-[2px]",
          surfaceClassName
        )}
      >
        {icon}
        <span className="truncate">{label}</span>
      </div>
    </div>
  )
}

/**
 * Inline zone that lives in the scroll flow (e.g. above a section) and
 * collapses to zero height when hidden.
 */
export function SidebarDropZone({
  id,
  label,
  icon,
  tone = "accent",
  visible,
  className,
  surfaceClassName,
}: SidebarDropZoneBaseProps & { visible: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id })

  return (
    <div
      ref={setNodeRef}
      data-slot="sidebar-drop-zone"
      data-over={isOver}
      data-visible={visible}
      aria-hidden={!visible}
      className={cn(
        "overflow-hidden transition-all duration-200 ease-out",
        visible
          ? "my-1 max-h-12 opacity-100"
          : "pointer-events-none my-0 max-h-0 opacity-0",
        className
      )}
    >
      <div
        data-over={isOver}
        className={cn(
          dropZoneSurfaceVariants({ tone }),
          "mx-1 px-2 py-1.5",
          surfaceClassName
        )}
      >
        {icon}
        <span className="truncate">{label}</span>
      </div>
    </div>
  )
}
