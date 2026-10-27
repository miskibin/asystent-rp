"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

// Adapted from T3 Code (github.com/pingdotgg/t3code), MIT License, (c) 2026 T3 Tools Inc.

export type MiddleTruncateProps = Omit<React.ComponentProps<"span">, "children"> & {
  value: string
  /**
   * How many characters always stay at the end. Defaults to the last path
   * segment when that is short, else 10 — snapped to a word boundary on
   * `-`, `_`, `.` or `/`, so the end reads "machine" and not "er-machine".
   */
  tail?: number
  /** Puts the whole value in a native tooltip. @default true */
  showTitle?: boolean
}

/**
 * Truncates in the middle, keeping the end — the part of a path, a branch or
 * a file name that tells two of them apart. `src/components/ui/sidebar-item.tsx`
 * becomes `src/compone…sidebar-item.tsx` rather than `src/components/ui/sid…`.
 *
 * The cut lands after the last *whole* character that fits — the partial
 * glyph is clipped and the tail slides over the slack — and the ellipsis rides
 * on the tail, so there is no ragged gap where a CSS ellipsis would leave one.
 * All of it is layout-neutral, so the measured width stays the true one.
 */
export function MiddleTruncate({
  value,
  tail,
  showTitle = true,
  className,
  ...props
}: MiddleTruncateProps) {
  const split = splitForMiddleTruncate(value, tail)
  const headRef = React.useRef<HTMLSpanElement>(null)
  const head = split?.head

  React.useLayoutEffect(() => {
    const element = headRef.current
    // A new head can keep the same box size, so refit here, not only on resize.
    if (!element || head === undefined) return
    fitHead(element)
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(() => fitHead(element))
    observer.observe(element)
    return () => observer.disconnect()
  }, [head])

  return (
    <span
      data-slot="middle-truncate"
      title={showTitle ? value : undefined}
      className={cn(
        "inline-flex max-w-full min-w-0 overflow-hidden whitespace-nowrap",
        className
      )}
      {...props}
    >
      {split ? (
        <>
          <span
            ref={headRef}
            data-slot="middle-truncate-head"
            className="peer min-w-0 overflow-hidden"
          >
            {split.head}
          </span>
          <span
            data-slot="middle-truncate-tail"
            className="shrink-0 peer-data-[overflow]:before:content-['…']"
          >
            {split.tail}
          </span>
        </>
      ) : (
        // Keyed so React never reuses the head node and its imperative clip.
        <span key="whole" className="min-w-0 truncate">
          {value}
        </span>
      )}
    </span>
  )
}

/**
 * An overflowing head is cut after its last whole character: clip the partial
 * glyph and slide the tail left over the slack. Neither changes layout.
 */
function fitHead(head: HTMLElement) {
  const text = head.firstChild
  const overflowing = head.scrollWidth > head.clientWidth && text instanceof Text
  head.toggleAttribute("data-overflow", overflowing)
  let slack = 0
  if (overflowing) {
    const range = document.createRange()
    const left = head.getBoundingClientRect().left
    const widthTo = (end: number) => {
      range.setStart(text, 0)
      range.setEnd(text, end)
      return range.getBoundingClientRect().right - left
    }
    let fits = 0
    let over = text.length
    while (over - fits > 1) {
      const mid = (fits + over) >> 1
      if (widthTo(mid) <= head.clientWidth) fits = mid
      else over = mid
    }
    // Never end on half a surrogate pair.
    if (/[\uD800-\uDBFF]/.test(text.data[fits - 1] ?? "")) fits -= 1
    slack = Math.max(0, head.clientWidth - widthTo(fits))
  }
  head.style.clipPath = slack > 0 ? `inset(-0.25em ${slack}px -0.25em 0)` : ""
  const tailNode = head.nextElementSibling
  if (tailNode instanceof HTMLElement) {
    tailNode.style.translate = slack > 0 ? `-${slack}px 0` : ""
  }
}

const DEFAULT_TAIL = 10
const MAX_SEGMENT_TAIL = 16
const MIN_WORD_TAIL = 4
const WORD_BREAK = /[-_./]/

/** Where `value` splits into a head that may shrink and a tail that never does. */
export function splitForMiddleTruncate(
  value: string,
  tail?: number
): { head: string; tail: string } | null {
  // By code point, so a surrogate pair is never cut into two broken glyphs.
  const chars = Array.from(value)
  let keep = tail ?? DEFAULT_TAIL
  if (tail === undefined) {
    const slash = chars.lastIndexOf("/")
    if (slash > 0 && slash < chars.length - 1) {
      const segment = chars.length - slash - 1
      keep = segment <= MAX_SEGMENT_TAIL ? segment : DEFAULT_TAIL
    }
  }
  if (keep <= 0 || chars.length <= keep + 4) return null
  let cut = chars.length - keep
  // An automatic tail starts on a word. A shorter tail keeps the head
  // readable, so it is preferred; a longer one is the fallback.
  if (tail === undefined && !WORD_BREAK.test(chars[cut - 1] ?? "")) {
    const startsWord = (index: number) => WORD_BREAK.test(chars[index - 1] ?? "")
    let snapped = -1
    for (let index = cut + 1; index <= chars.length - MIN_WORD_TAIL; index++) {
      if (startsWord(index)) {
        snapped = index
        break
      }
    }
    for (
      let index = cut - 1;
      snapped < 0 && index >= chars.length - MAX_SEGMENT_TAIL && index > 4;
      index--
    ) {
      if (startsWord(index)) snapped = index
    }
    if (snapped > 0) cut = snapped
  }
  return { head: chars.slice(0, cut).join(""), tail: chars.slice(cut).join("") }
}
