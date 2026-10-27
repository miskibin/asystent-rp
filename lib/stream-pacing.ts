/**
 * Paces a streaming answer onto the screen.
 *
 * Text does not arrive the way it reads. A model's tokens are batched by its
 * server, then by the harness CLI, then by the app's own frame queue, and what
 * reaches the list is a lump of a dozen words, a pause, three words, a
 * paragraph. Painted as it lands, the answer lurches. `nextRevealLength`
 * spreads the backlog over time instead: a floor rate that reads as typing,
 * rising with the backlog so the screen is never more than `maxLagMs` behind
 * what has actually arrived — pacing that falls behind a fast stream is worse
 * than no pacing at all.
 *
 * Pure and framework-free, so the curve is testable under `node --test`.
 */

export type StreamPacing = {
  /** Characters per second when there is barely anything queued. */
  minCharsPerSecond: number
  /** The most the screen may trail the stream, at the current rate. */
  maxLagMs: number
  /**
   * Once the stream has ended, how quickly what is left drains. Short, so the
   * answer settles promptly; non-zero, so it does not land as one jump.
   */
  settleLagMs: number
}

export const DEFAULT_STREAM_PACING: StreamPacing = {
  minCharsPerSecond: 90,
  maxLagMs: 300,
  settleLagMs: 120,
}

/**
 * How many characters of `text` to show after `elapsedMs` more, given that
 * `shown` are on screen now. Never moves backwards, never passes the end, and
 * prefers to stop at the end of a word so a word is not drawn in two halves.
 */
export function nextRevealLength(
  text: string,
  shown: number,
  elapsedMs: number,
  streaming: boolean,
  pacing: StreamPacing = DEFAULT_STREAM_PACING
): number {
  const target = text.length
  if (shown >= target) return target
  const backlog = target - shown
  const lagMs = streaming ? pacing.maxLagMs : pacing.settleLagMs
  const rate = Math.max(pacing.minCharsPerSecond, (backlog * 1000) / lagMs)
  const step = Math.max(1, Math.round((rate * Math.max(0, elapsedMs)) / 1000))
  const raw = Math.min(target, shown + step)
  if (raw >= target) return target
  return keepPairs(text, wordBoundaryAfter(text, raw, target))
}

/** Never ends between the two halves of a surrogate pair (most emoji). */
function keepPairs(text: string, index: number) {
  const code = text.charCodeAt(index - 1)
  return code >= 0xd800 && code <= 0xdbff ? index + 1 : index
}

/**
 * The end of the word `index` falls in — or `index` itself when that word is
 * long enough that waiting for its end would stall the reveal.
 */
function wordBoundaryAfter(text: string, index: number, target: number) {
  const LOOKAHEAD = 16
  const limit = Math.min(target, index + LOOKAHEAD)
  for (let at = index; at < limit; at++) {
    if (isBreak(text.charCodeAt(at))) return at
  }
  return index
}

function isBreak(code: number) {
  // space, tab, newline, carriage return
  return code === 32 || code === 9 || code === 10 || code === 13
}

/**
 * Whether `next` continues `previous` — the only case worth pacing. Anything
 * else (an edit, a regenerate, a transcript swap) is shown as it is.
 */
export function isContinuation(previous: string, next: string) {
  return next.length >= previous.length && next.startsWith(previous)
}

/* -------------------------------------------------------------------------- */
/* Phrase by phrase                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The reveal the chat uses: a phrase at a time — a few words, cut where the
 * text itself pauses (a comma, a full stop, the end of a line), never more
 * than `maxWords` — on a calm, steady beat.
 *
 * Word-by-word pacing never sits still: the screen changes dozens of times a
 * second and the reader chases the edge. Whole sentences sit still but land
 * as lumps. A phrase is the unit in between — small enough to arrive
 * gently, large enough that the screen is quiet between arrivals — and it
 * fades in as one (the component's job), so text *emerges* a few words at a
 * time.
 *
 * Guards: an unfinished phrase shows its arrived words after `holdMs` rather
 * than stalling; a stream that outruns the beat is never left more than
 * `maxLagChars` behind (several phrases go at once until it is not); and once
 * the stream ends, the rest drains on the faster `settleMs`.
 */
export type PhrasePacing = {
  /** Least time between two phrases while streaming. */
  phraseMs: number
  /** The same once the stream has ended and the rest is draining. */
  settleMs: number
  /** A phrase is at least this many words, unless the text ends first. */
  minWords: number
  /** And at most this many, wherever the text pauses. */
  maxWords: number
  /** How far behind the arrived text the screen may fall. */
  maxLagChars: number
  /** How long an unfinished phrase holds the reveal before its words show. */
  holdMs: number
}

export const DEFAULT_PHRASE_PACING: PhrasePacing = {
  phraseMs: 180,
  settleMs: 70,
  minWords: 2,
  maxWords: 6,
  maxLagChars: 120,
  holdMs: 300,
}

/** Characters after which the text pauses: `, ; : . ! ? …` and CJK forms. */
function isPause(code: number) {
  return (
    code === 44 || // ,
    code === 59 || // ;
    code === 58 || // :
    code === 46 || // .
    code === 33 || // !
    code === 63 || // ?
    code === 0x2026 || // …
    code === 0x3001 || // 、
    code === 0x3002 || // 。
    code === 0xff0c || // ，
    code === 0xff01 || // ！
    code === 0xff1f // ？
  )
}

/**
 * The end of the next phrase after `from`, within what has arrived (`limit`),
 * or -1 when not enough has arrived to know. A word only counts once the
 * whitespace after it has arrived — `implement` might still become
 * `implementation`.
 */
export function nextPhraseEnd(
  text: string,
  from: number,
  limit = text.length,
  pacing: Pick<PhrasePacing, "minWords" | "maxWords"> = DEFAULT_PHRASE_PACING
): number {
  let words = 0
  let inWord = false
  for (let at = from; at < limit; at++) {
    const code = text.charCodeAt(at)
    if (code === 10) {
      // A line ends a phrase however short: code, lists and tables arrive
      // line by line.
      if (inWord || words > 0) return at + 1
      continue
    }
    if (isBreak(code)) {
      if (inWord) {
        words++
        inWord = false
        const before = text.charCodeAt(at - 1)
        if ((words >= pacing.minWords && isPause(before)) || words >= pacing.maxWords) {
          return at
        }
      }
      continue
    }
    inWord = true
  }
  return -1
}

/**
 * How much of `text` to show now, `sinceAdvanceMs` after the reveal last moved
 * forward, given `shown` on screen. Returns `shown` when it should hold still.
 */
export function nextPhraseReveal(
  text: string,
  shown: number,
  sinceAdvanceMs: number,
  streaming: boolean,
  pacing: PhrasePacing = DEFAULT_PHRASE_PACING
): number {
  const target = text.length
  if (shown >= target) return target
  if (sinceAdvanceMs < (streaming ? pacing.phraseMs : pacing.settleMs)) return shown

  let next = nextPhraseEnd(text, shown, target, pacing)
  if (next > 0) {
    // Far behind: phrase after phrase until the backlog is back in bounds.
    while (target - next > pacing.maxLagChars) {
      const further = nextPhraseEnd(text, next, target, pacing)
      if (further < 0) break
      next = further
    }
    return keepPairs(text, next)
  }
  if (!streaming) return target
  if (sinceAdvanceMs < pacing.holdMs) return shown
  // Held long enough: the words that have arrived whole.
  for (let at = target - 1; at > shown; at--) {
    if (isBreak(text.charCodeAt(at))) return keepPairs(text, at)
  }
  return shown
}
