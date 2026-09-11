"use client"

// Adapted from T3 Code (github.com/pingdotgg/t3code), MIT License, (c) 2026 T3 Tools Inc.

import { useCallback, useEffect, useLayoutEffect, useRef } from "react"
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
} from "react"

import { cn } from "@/lib/utils"

/* -------------------------------------------------------------------------------------------------
 * Width math — pure, so a consumer can size its own layout with the same rules
 * -----------------------------------------------------------------------------------------------*/

/** The variable the rail writes and `ChatSidebar` reads. */
export const SIDEBAR_WIDTH_VAR = "--chat-sidebar-width"
export const SIDEBAR_MIN_WIDTH = 208
export const SIDEBAR_MAX_WIDTH = 480
/** Room the conversation keeps for itself when the viewport is narrow. */
export const SIDEBAR_CONTENT_MIN_WIDTH = 420

export type SidebarWidthBounds = { min: number; max: number }

export type SidebarWidthOptions = {
  min?: number
  max?: number
  /** Width the rest of the layout must keep; caps `max` on small viewports. */
  contentMin?: number
}

/**
 * The window has the last word: on a narrow viewport the maximum shrinks so
 * the conversation keeps `contentMin`, and `min` still wins over that, because
 * a sidebar narrower than its own rows is not a smaller sidebar, it is a broken
 * one. Pass `viewportWidth: 0` (or nothing measurable) to get the static pair.
 */
export function resolveSidebarWidthBounds(
  viewportWidth: number,
  {
    min = SIDEBAR_MIN_WIDTH,
    max = SIDEBAR_MAX_WIDTH,
    contentMin = SIDEBAR_CONTENT_MIN_WIDTH,
  }: SidebarWidthOptions = {}
): SidebarWidthBounds {
  const room = Number.isFinite(viewportWidth)
    ? Math.floor(viewportWidth) - contentMin
    : max
  return { min, max: Math.max(min, Math.min(max, room)) }
}

export function clampSidebarWidth(width: number, bounds: SidebarWidthBounds) {
  return Math.max(bounds.min, Math.min(width, bounds.max))
}

/**
 * First paint width: a stored value when there is one, the default otherwise,
 * clamped into the bounds this viewport allows.
 */
export function resolveInitialSidebarWidth(
  storedWidth: number | null | undefined,
  viewportWidth: number,
  defaultWidth: number,
  options: SidebarWidthOptions = {}
) {
  const bounds = resolveSidebarWidthBounds(viewportWidth, options)
  const preferred =
    storedWidth == null || !Number.isFinite(storedWidth)
      ? defaultWidth
      : storedWidth
  return clampSidebarWidth(preferred, bounds)
}

/* -------------------------------------------------------------------------------------------------
 * Rail
 * -----------------------------------------------------------------------------------------------*/

export type SidebarWidthVeto = {
  currentWidth: number
  nextWidth: number
  target: HTMLElement
  side: "left" | "right"
}

export type SidebarResizeRailProps = {
  /**
   * Element the width variable is written on. Defaults to the closest
   * `[data-slot="chat-sidebar"]`, then to the rail's own parent.
   */
  targetRef?: RefObject<HTMLElement | null>
  /** Custom property to drive. Match it with the sidebar's `width`. */
  cssVar?: string
  /**
   * Width to hydrate before the first paint — a persisted one, usually. The
   * rail never reads storage itself; `onWidthChange` is the write side.
   */
  width?: number
  /** Double-click resets to this. */
  defaultWidth?: number
  minWidth?: number
  maxWidth?: number
  /** Keeps this much room for the rest of the layout on narrow viewports. */
  contentMinWidth?: number
  /** Which side of the panel the rail sits on. */
  side?: "left" | "right"
  /** Keyboard increment; Shift multiplies it by four. */
  step?: number
  disabled?: boolean
  /** Reject a width mid-drag — the pointer keeps moving, the panel does not. */
  shouldAcceptWidth?: (info: SidebarWidthVeto) => boolean
  /** Fired on release, double-click reset and keyboard resize. Persist here. */
  onWidthChange?: (width: number) => void
  label?: string
  className?: string
}

/**
 * A drag handle for the sidebar's width that never re-renders React.
 *
 * The whole gesture is one custom property written on the panel inside a
 * `requestAnimationFrame`, so a resize costs a style recalculation and nothing
 * else — no state, no reflowing tree, no row re-render mid-drag. Width
 * transitions on the target are forced to `0ms` while the pointer is down: an
 * animated width would lag a full easing curve behind the cursor.
 *
 * Persistence stays with the consumer. The rail reports a settled width through
 * `onWidthChange` and hydrates from `width` in a layout effect, before paint,
 * so a restored sidebar never flashes at the default width first.
 */
export function SidebarResizeRail({
  targetRef,
  cssVar = SIDEBAR_WIDTH_VAR,
  width,
  defaultWidth = 290,
  minWidth = SIDEBAR_MIN_WIDTH,
  maxWidth = SIDEBAR_MAX_WIDTH,
  contentMinWidth = SIDEBAR_CONTENT_MIN_WIDTH,
  side = "left",
  step = 16,
  disabled = false,
  shouldAcceptWidth,
  onWidthChange,
  label = "Resize sidebar",
  className,
}: SidebarResizeRailProps) {
  const railRef = useRef<HTMLDivElement>(null)
  const widthRef = useRef<number | null>(null)
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startWidth: number
    width: number
    pendingWidth: number
    frame: number | null
    moved: boolean
    target: HTMLElement
  } | null>(null)
  const suppressClickRef = useRef(false)

  // Options travel through a ref so every handler can stay identity-stable.
  const optionsRef = useRef({
    minWidth,
    maxWidth,
    contentMinWidth,
    side,
    step,
    defaultWidth,
    cssVar,
    targetRef,
    shouldAcceptWidth,
    onWidthChange,
    disabled,
  })
  useEffect(() => {
    optionsRef.current = {
      minWidth,
      maxWidth,
      contentMinWidth,
      side,
      step,
      defaultWidth,
      cssVar,
      targetRef,
      shouldAcceptWidth,
      onWidthChange,
      disabled,
    }
  })

  const bounds = useCallback(() => {
    const options = optionsRef.current
    return resolveSidebarWidthBounds(
      typeof window === "undefined" ? Number.NaN : window.innerWidth,
      {
        min: options.minWidth,
        max: options.maxWidth,
        contentMin: options.contentMinWidth,
      }
    )
  }, [])

  const resolveTarget = useCallback(() => {
    const explicit = optionsRef.current.targetRef?.current
    if (explicit) return explicit
    const rail = railRef.current
    if (!rail) return null
    return (
      rail.closest<HTMLElement>("[data-slot='chat-sidebar']") ??
      rail.parentElement
    )
  }, [])

  const applyWidth = useCallback(
    (target: HTMLElement, next: number) => {
      target.style.setProperty(optionsRef.current.cssVar, `${next}px`)
      widthRef.current = next
      railRef.current?.setAttribute("aria-valuenow", String(Math.round(next)))
    },
    []
  )

  const commit = useCallback(
    (next: number) => {
      const target = resolveTarget()
      if (!target) return
      applyWidth(target, clampSidebarWidth(next, bounds()))
      const settled = widthRef.current
      if (settled !== null) optionsRef.current.onWidthChange?.(settled)
    },
    [applyWidth, bounds, resolveTarget]
  )

  // Hydrate before paint so a restored width never flashes as the default.
  useLayoutEffect(() => {
    const target = resolveTarget()
    if (!target) return
    if (width === undefined) {
      // Nothing to restore — publish the width the layout already has, so the
      // separator reports a value from its first frame.
      railRef.current?.setAttribute(
        "aria-valuenow",
        String(Math.round(target.getBoundingClientRect().width))
      )
      return
    }
    applyWidth(target, clampSidebarWidth(width, bounds()))
  }, [applyWidth, bounds, resolveTarget, width])

  const endDrag = useCallback(() => {
    const drag = dragRef.current
    if (!drag) return
    dragRef.current = null
    if (drag.frame !== null) cancelAnimationFrame(drag.frame)
    drag.target.style.removeProperty("transition-duration")
    document.body.style.removeProperty("cursor")
    document.body.style.removeProperty("user-select")
    if (railRef.current?.hasPointerCapture(drag.pointerId)) {
      railRef.current.releasePointerCapture(drag.pointerId)
    }
    railRef.current?.removeAttribute("data-resizing")
    suppressClickRef.current = drag.moved
    if (drag.moved) optionsRef.current.onWidthChange?.(drag.width)
  }, [])

  useEffect(() => endDrag, [endDrag])

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (optionsRef.current.disabled || event.button !== 0) return
      const target = resolveTarget()
      if (!target) return
      const startWidth = clampSidebarWidth(
        target.getBoundingClientRect().width,
        bounds()
      )
      event.preventDefault()
      event.stopPropagation()
      // An animated width would trail the pointer by a whole easing curve.
      target.style.setProperty("transition-duration", "0ms")
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startWidth,
        width: startWidth,
        pendingWidth: startWidth,
        frame: null,
        moved: false,
        target,
      }
      applyWidth(target, startWidth)
      event.currentTarget.setPointerCapture(event.pointerId)
      event.currentTarget.setAttribute("data-resizing", "true")
      document.body.style.cursor = "col-resize"
      document.body.style.userSelect = "none"
    },
    [applyWidth, bounds, resolveTarget]
  )

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current
      if (!drag || drag.pointerId !== event.pointerId) return
      event.preventDefault()
      const delta =
        optionsRef.current.side === "right"
          ? drag.startX - event.clientX
          : event.clientX - drag.startX
      if (Math.abs(delta) > 2) drag.moved = true
      drag.pendingWidth = clampSidebarWidth(drag.startWidth + delta, bounds())
      if (drag.frame !== null) return
      // One write per frame: pointermove fires far more often than the
      // compositor paints, and each write is a style recalculation.
      drag.frame = requestAnimationFrame(() => {
        const active = dragRef.current
        if (!active) return
        active.frame = null
        const nextWidth = active.pendingWidth
        if (nextWidth === active.width) return
        const accepted =
          optionsRef.current.shouldAcceptWidth?.({
            currentWidth: active.width,
            nextWidth,
            target: active.target,
            side: optionsRef.current.side,
          }) ?? true
        if (!accepted) return
        applyWidth(active.target, nextWidth)
        active.width = nextWidth
      })
    },
    [applyWidth, bounds]
  )

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (dragRef.current?.pointerId !== event.pointerId) return
      event.preventDefault()
      endDrag()
    },
    [endDrag]
  )

  const onClick = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    // The release that ends a drag also fires a click on the handle.
    if (!suppressClickRef.current) return
    suppressClickRef.current = false
    event.preventDefault()
    event.stopPropagation()
  }, [])

  const onDoubleClick = useCallback(() => {
    commit(optionsRef.current.defaultWidth)
  }, [commit])

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const options = optionsRef.current
      if (options.disabled) return
      const limits = bounds()
      const current =
        widthRef.current ?? resolveTarget()?.getBoundingClientRect().width ?? 0
      const amount = options.step * (event.shiftKey ? 4 : 1)
      const grow = options.side === "right" ? -1 : 1
      if (event.key === "ArrowLeft") commit(current - amount * grow)
      else if (event.key === "ArrowRight") commit(current + amount * grow)
      else if (event.key === "Home") commit(limits.min)
      else if (event.key === "End") commit(limits.max)
      else if (event.key === "Enter") commit(options.defaultWidth)
      else return
      event.preventDefault()
    },
    [bounds, commit, resolveTarget]
  )

  return (
    <div
      ref={railRef}
      data-slot="sidebar-rail"
      data-side={side}
      data-disabled={disabled || undefined}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      title={label}
      tabIndex={disabled ? -1 : 0}
      aria-valuemin={minWidth}
      aria-valuemax={maxWidth}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
      className={cn(
        "group/sidebar-rail absolute inset-y-0 z-30 w-3 touch-none select-none",
        side === "right" ? "left-0 -translate-x-1/2" : "right-0 translate-x-1/2",
        disabled ? "pointer-events-none" : "cursor-col-resize",
        "outline-none",
        // Sits on the seam, not over titles. Idle line is transparent; hover
        // and drag bring it in at ~70% so the border still reads underneath.
        "after:pointer-events-none after:absolute after:inset-y-0 after:left-1/2 after:w-0.5 after:-translate-x-1/2 after:rounded-full after:bg-sidebar-border after:opacity-0 after:transition-opacity after:duration-150 after:content-['']",
        "hover:after:opacity-70",
        "data-[resizing=true]:after:bg-sidebar-ring/70 data-[resizing=true]:after:opacity-100",
        "focus-visible:after:bg-sidebar-ring focus-visible:after:opacity-100 focus-visible:after:ring-2 focus-visible:after:ring-sidebar-ring/60",
        className
      )}
    />
  )
}
