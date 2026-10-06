// Adapted from T3 Code (github.com/pingdotgg/t3code), MIT License, (c) 2026 T3 Tools Inc.
import { useCallback } from "react"

/**
 * One observer for every looping animation on the page.
 *
 * A CSS animation keeps compositing while its element is scrolled out of the
 * sidebar, while the tab is in the background, and while the user has asked for
 * less motion — none of which anybody sees. Every observed element gets two
 * custom properties written on it, and the animation reads them:
 *
 * ```css
 * animation-play-state: var(--visible-animation-state, running);
 * will-change: var(--visible-animation-will-change, auto);
 * ```
 *
 * The fallbacks matter: an element nobody observed keeps animating normally, so
 * forgetting the ref degrades to today's behaviour rather than a frozen dot.
 */
type ObservedAnimation = {
  element: HTMLElement | SVGElement
  intersecting: boolean
}

const animations = new Map<Element, ObservedAnimation>()
let observer: IntersectionObserver | null = null
let reducedMotion: MediaQueryList | null = null

function updateAnimation(animation: ObservedAnimation) {
  const running =
    animation.intersecting &&
    document.visibilityState === "visible" &&
    !reducedMotion?.matches
  animation.element.style.setProperty(
    "--visible-animation-state",
    running ? "running" : "paused"
  )
  animation.element.style.setProperty(
    "--visible-animation-will-change",
    running ? "transform" : "auto"
  )
}

function updateAnimations() {
  for (const animation of animations.values()) updateAnimation(animation)
}

/**
 * Attach to a stable animation container. Every element shares one observer,
 * one `visibilitychange` listener and one motion-preference listener, and the
 * last one to detach tears all three down.
 *
 * Returns its own unsubscribe — call it on unmount.
 */
export function observeVisibleAnimation(
  element: HTMLElement | SVGElement | null
) {
  if (element === null) return
  element.style.setProperty("--visible-animation-state", "paused")
  element.style.setProperty("--visible-animation-will-change", "auto")
  if (typeof IntersectionObserver === "undefined") return

  if (observer === null) {
    reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)")
    reducedMotion.addEventListener("change", updateAnimations)
    document.addEventListener("visibilitychange", updateAnimations)
    observer = new IntersectionObserver((entries, source) => {
      // A disconnected observer can still deliver a queued batch.
      if (source !== observer) return
      for (const entry of entries) {
        const animation = animations.get(entry.target)
        if (!animation) continue
        animation.intersecting = entry.isIntersecting
        updateAnimation(animation)
      }
    })
  }

  const animation: ObservedAnimation = { element, intersecting: false }
  animations.set(element, animation)
  observer.observe(element)

  return () => {
    if (animations.get(element) !== animation) return
    animations.delete(element)
    observer?.unobserve(element)
    element.style.setProperty("--visible-animation-state", "paused")
    element.style.setProperty("--visible-animation-will-change", "auto")
    if (animations.size === 0) {
      observer?.disconnect()
      observer = null
      reducedMotion?.removeEventListener("change", updateAnimations)
      reducedMotion = null
      document.removeEventListener("visibilitychange", updateAnimations)
    }
  }
}

/**
 * Ref callback form: `<span ref={useVisibleAnimation()} />`. React 19 runs the
 * returned cleanup when the element detaches, so there is no effect and no
 * second render pass.
 *
 * ```tsx
 * const ref = useVisibleAnimation(streaming)
 * <span ref={ref} className="animate-pulse [animation-play-state:var(--visible-animation-state,running)]" />
 * ```
 */
export function useVisibleAnimation<T extends HTMLElement | SVGElement>(
  enabled = true
) {
  return useCallback(
    (element: T | null) => {
      if (!enabled) return
      return observeVisibleAnimation(element)
    },
    [enabled]
  )
}
