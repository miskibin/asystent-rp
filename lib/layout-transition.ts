import { flushSync } from "react-dom"

const COMPOSER_MS = 420
const EASING = "cubic-bezier(0.22, 1, 0.36, 1)"

/**
 * Slide the composer from the centered opening to the docked bottom.
 * Uses FLIP on the live element so the message list (and thinking
 * indicator) can paint and stream during the animation.
 */
export function runLayoutTransition(update: () => void) {
  const reduceMotion =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches

  const composer = document.querySelector<HTMLElement>(
    "[data-slot='chat-input']"
  )
  const first = !reduceMotion ? composer?.getBoundingClientRect() : undefined

  flushSync(update)

  if (!composer || !first) return
  const dy = first.top - composer.getBoundingClientRect().top
  if (Math.abs(dy) < 1) return
  composer.animate(
    [{ transform: `translateY(${dy}px)` }, { transform: "translateY(0)" }],
    { duration: COMPOSER_MS, easing: EASING }
  )
}
