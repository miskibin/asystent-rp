"use client"

// Adapted from T3 Code (github.com/pingdotgg/t3code), MIT License, (c) 2026 T3 Tools Inc.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react"
import type { RefObject } from "react"

const motionTiming = { duration: 150, easing: "ease-out" }

// A filter change or a bulk delete swaps a large part of the list at once.
// Fades are the expensive part: every removed row gets a deep clone and every
// clone and entering row gets its own animation, and the layout reads in
// between force synchronous reflows. Translating displaced rows is cheap, so
// only the fade count decides whether an update animates.
const MAX_FADED_ROWS_PER_UPDATE = 40

/** Rows opt into the motion by carrying this attribute; nothing else moves. */
export const SIDEBAR_MOTION_KEY_ATTRIBUTE = "data-motion-key"

/** Copies must not answer to the ids, slots or keys the live row answers to. */
const CLONED_ATTRIBUTES_TO_STRIP = new Set([
  "data-slot",
  "data-testid",
  SIDEBAR_MOTION_KEY_ATTRIBUTE,
])

export type SidebarListMotion = {
  /** Animate from the previously recorded layout to the current one. */
  update: (animate: boolean) => void
  /**
   * Called on drag release, before the commit that clears the drag transforms.
   * Takes every row's visual top so the next update glides each of them from
   * where the drag left it into its committed slot.
   */
  release: () => void
  /** Forget the recorded layout and cancel everything in flight. */
  suspend: () => void
  dispose: () => void
}

type RowPosition = { top: number; left: number; width: number; height: number }

function progress(animation: Animation) {
  return animation.playState === "finished"
    ? 1
    : (animation.effect?.getComputedTiming().progress ?? 0)
}

/**
 * Animate rows between their layout positions with the Web Animations API:
 * transform and opacity only, never a layout property. The list must be
 * positioned so every direct child's `offsetTop` shares one origin.
 */
export function createSidebarListMotion(parent: HTMLElement): SidebarListMotion {
  let positions: Map<HTMLElement, RowPosition> | null = null
  let disposed = false
  const reducedMotion = parent.ownerDocument.defaultView?.matchMedia(
    "(prefers-reduced-motion: reduce)"
  )
  const running = new Map<
    HTMLElement,
    { animation: Animation; offset: number }
  >()
  const entering = new Map<HTMLElement, Animation>()
  const exiting = new Map<HTMLElement, Animation>()
  // Visual tops at drag release, relative to the list, so the release commit
  // can glide every row from where the drag left it into its slot.
  let released: Map<HTMLElement, number> | null = null

  const rows = () =>
    Array.from(parent.children).filter(
      (node): node is HTMLElement =>
        node instanceof HTMLElement &&
        node.hasAttribute(SIDEBAR_MOTION_KEY_ATTRIBUTE) &&
        !exiting.has(node)
    )

  const remainingOffset = (node: HTMLElement) => {
    const current = running.get(node)
    return current ? current.offset * (1 - progress(current.animation)) : 0
  }
  const clearFades = () => {
    for (const animation of [...entering.values(), ...exiting.values()]) {
      animation.cancel()
    }
    for (const node of exiting.keys()) node.remove()
    entering.clear()
    exiting.clear()
  }
  const fadeOut = (node: HTMLElement, position: RowPosition) => {
    if (position.height === 0) return
    // React owns the removed row; only a noninteractive copy stays for the fade.
    const clone = node.cloneNode(true) as HTMLElement
    for (const element of [clone, ...clone.querySelectorAll("*")]) {
      for (const attribute of Array.from(element.attributes)) {
        if (
          (attribute.name === "id" &&
            element.namespaceURI !== "http://www.w3.org/2000/svg") ||
          CLONED_ATTRIBUTES_TO_STRIP.has(attribute.name)
        ) {
          element.removeAttribute(attribute.name)
        }
      }
    }
    clone.setAttribute("aria-hidden", "true")
    clone.inert = true
    Object.assign(clone.style, {
      position: "absolute",
      top: `${position.top + remainingOffset(node)}px`,
      left: `${position.left}px`,
      width: `${position.width}px`,
      height: `${position.height}px`,
      margin: "0",
      boxSizing: "border-box",
      // The row it was cloned from may be skipped by content-visibility.
      contentVisibility: "visible",
      transform: "none",
      transition: "none",
      pointerEvents: "none",
    })
    parent.append(clone)
    const entry = entering.get(node)
    const animation = clone.animate(
      [{ opacity: entry ? progress(entry) : 1 }, { opacity: 0 }],
      motionTiming
    )
    exiting.set(clone, animation)
    animation.addEventListener(
      "finish",
      () => {
        clone.remove()
        exiting.delete(clone)
      },
      { once: true }
    )
  }

  const cancel = (node: HTMLElement) => {
    running.get(node)?.animation.cancel()
    running.delete(node)
  }
  const suspend = () => {
    for (const node of running.keys()) cancel(node)
    clearFades()
    positions = null
    released = null
  }
  const move = (node: HTMLElement, offset: number) => {
    cancel(node)
    if (offset === 0) return
    const animation = node.animate(
      [
        { transform: `translateY(${offset}px)` },
        { transform: "translateY(0px)" },
      ],
      motionTiming
    )
    running.set(node, { animation, offset })
    animation.addEventListener(
      "finish",
      () => {
        if (running.get(node)?.animation === animation) running.delete(node)
      },
      { once: true }
    )
  }

  return {
    update(animate: boolean) {
      if (disposed) return
      const next = new Map(
        rows().map((node) => [
          node,
          {
            top: node.offsetTop,
            left: node.offsetLeft,
            width: node.offsetWidth,
            height: node.offsetHeight,
          },
        ])
      )
      let fadeCount = 0
      if (positions !== null) {
        for (const [node, position] of positions) {
          if (!next.has(node) && position.height > 0) fadeCount++
        }
        for (const [node, position] of next) {
          if (!positions.has(node) && position.height > 0) fadeCount++
        }
      }
      const shouldAnimate =
        animate &&
        positions !== null &&
        !reducedMotion?.matches &&
        fadeCount <= MAX_FADED_ROWS_PER_UPDATE
      if (!shouldAnimate) clearFades()
      else if (positions !== null) {
        for (const [node, position] of positions) {
          if (!next.has(node)) fadeOut(node, position)
        }
      }
      for (const [node, animation] of entering) {
        if (!next.has(node)) {
          animation.cancel()
          entering.delete(node)
        }
      }
      for (const node of running.keys()) {
        if (!shouldAnimate || !next.has(node)) cancel(node)
      }
      if (shouldAnimate) {
        for (const [node, position] of next) {
          const previousTop = positions?.get(node)?.top
          if (previousTop === undefined) {
            if (position.height > 0) {
              const animation = node.animate(
                [{ opacity: 0 }, { opacity: 1 }],
                motionTiming
              )
              entering.set(node, animation)
              animation.addEventListener(
                "finish",
                () => {
                  if (entering.get(node) === animation) entering.delete(node)
                },
                { once: true }
              )
            }
            continue
          }
          if (previousTop === position.top) continue
          // Computed progress includes the effect's easing. Only our own
          // translate is carried forward; a drag library's transforms are
          // never read.
          move(node, previousTop + remainingOffset(node) - position.top)
        }
      }
      if (released !== null) {
        if (!reducedMotion?.matches) {
          for (const [node, position] of next) {
            const top = released.get(node)
            if (top !== undefined) move(node, top - position.top)
          }
        }
        released = null
      }
      positions = next
    },
    release() {
      suspend()
      const origin = parent.getBoundingClientRect().top
      released = new Map(
        rows().map((node) => [node, node.getBoundingClientRect().top - origin])
      )
    },
    suspend,
    dispose() {
      suspend()
      disposed = true
    },
  }
}

export type SidebarListMotionHandle = Pick<
  SidebarListMotion,
  "release" | "suspend"
>

export type UseSidebarListMotionOptions = {
  /** Off by default — opt a list in once its rows carry stable keys. */
  enabled?: boolean
  /**
   * Stop recording while a drag owns the layout: the drag library moves rows
   * with transforms, which no layout read can see, so a FLIP taken mid-drag
   * measures nothing and fights the release glide.
   */
  paused?: boolean
}

/**
 * Runs one FLIP pass after every commit of the list that calls it. The returned
 * handle is stable, so a drag context can hold on to `release` for the lifetime
 * of the list.
 */
/** `useLayoutEffect` warns when a client component is prerendered. */
const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect

export function useSidebarListMotion(
  ref: RefObject<HTMLElement | null>,
  { enabled = false, paused = false }: UseSidebarListMotionOptions = {}
): SidebarListMotionHandle {
  const motionRef = useRef<SidebarListMotion | null>(null)

  // No dependency array: the pass has to run after every commit that could have
  // moved a row, and only a layout read after paint knows whether one did.
  useIsomorphicLayoutEffect(() => {
    const node = ref.current
    if (!enabled || node === null) {
      motionRef.current?.dispose()
      motionRef.current = null
      return
    }
    motionRef.current ??= createSidebarListMotion(node)
    if (paused) motionRef.current.suspend()
    else motionRef.current.update(true)
  })

  useEffect(
    () => () => {
      motionRef.current?.dispose()
      motionRef.current = null
    },
    []
  )

  const release = useCallback(() => motionRef.current?.release(), [])
  const suspend = useCallback(() => motionRef.current?.suspend(), [])

  return useMemo(() => ({ release, suspend }), [release, suspend])
}
