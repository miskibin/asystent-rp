// Adapted from T3 Code (github.com/pingdotgg/t3code), MIT License, (c) 2026 T3 Tools Inc.
/**
 * Shell-style prompt recall for the composer. ArrowUp walks back through the
 * prompts already sent in this conversation, ArrowDown walks forward, and one
 * step past the newest empties the composer again.
 *
 * The state is deliberately tiny and derived: a position is an entry id plus
 * the text that was put in the composer, so the caller keeps no copy of the
 * history and nothing has to be persisted or synced. The moment the composer
 * stops matching `recalled` the user has typed or sent, and browsing is over.
 */

/** One recallable prompt. `id` is whatever the host calls that message. */
export type PromptHistoryEntry = { id: string; prompt: string }

/**
 * Where the reader is in the history right now. `entryId` is resolved against
 * the current entries on every step rather than held as an index, so a list
 * that grows underneath (a send landing, an older page loading) cannot move
 * the position; `recalled` is the text that was written into the composer.
 */
export type PromptHistoryPosition = { entryId: string; recalled: string }

export type PromptHistoryStep = {
  position: PromptHistoryPosition | null
  prompt: string
}

/**
 * Prefer the id. Collapsing consecutive duplicates can retire the recalled id
 * while the same text lives on under a newer one, so fall back to the newest
 * entry whose text matches.
 */
function findActive(
  entries: readonly PromptHistoryEntry[],
  position: PromptHistoryPosition
): number {
  const byId = entries.findIndex((entry) => entry.id === position.entryId)
  if (byId >= 0) return byId
  return entries.findLastIndex((entry) => entry.prompt === position.recalled)
}

/**
 * Oldest first. Blank sends are skipped, and consecutive identical prompts
 * collapse into the newest one — the shell's `HISTCONTROL=ignoredups`, so
 * holding ArrowUp after re-running the same command still walks backwards.
 */
export function promptHistoryEntries(
  messages: readonly { id: string; text: string }[]
): PromptHistoryEntry[] {
  const entries: PromptHistoryEntry[] = []
  for (const message of messages) {
    const prompt = message.text.trim()
    if (prompt.length === 0) continue
    const previous = entries[entries.length - 1]
    if (previous && previous.prompt === prompt) {
      entries[entries.length - 1] = { id: message.id, prompt }
      continue
    }
    entries.push({ id: message.id, prompt })
  }
  return entries
}

/**
 * Returns null when the key should fall through to ordinary caret movement.
 * Backward starts only from a composer the user has not typed into and stops
 * at the oldest entry; forward past the newest empties the composer and ends
 * browsing. An edited or sent recall no longer matches `recalled`, so the
 * next backward step starts from scratch.
 */
export function stepPromptHistory(input: {
  direction: "backward" | "forward"
  entries: readonly PromptHistoryEntry[]
  position: PromptHistoryPosition | null
  currentPrompt: string
}): PromptHistoryStep | null {
  const { entries, position, currentPrompt } = input
  const activeIndex =
    position && position.recalled === currentPrompt
      ? findActive(entries, position)
      : -1

  if (input.direction === "backward") {
    if (activeIndex < 0 && currentPrompt.length > 0) return null
    const entry = entries[activeIndex < 0 ? entries.length - 1 : activeIndex - 1]
    if (!entry) return null
    return {
      position: { entryId: entry.id, recalled: entry.prompt },
      prompt: entry.prompt,
    }
  }

  if (activeIndex < 0) return null
  const entry = entries[activeIndex + 1]
  if (!entry) return { position: null, prompt: "" }
  return {
    position: { entryId: entry.id, recalled: entry.prompt },
    prompt: entry.prompt,
  }
}
