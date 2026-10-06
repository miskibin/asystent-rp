"use client"

import { cva } from "class-variance-authority"
import {
  ClipboardPaste,
  FileText,
  ImageIcon,
  Paperclip,
  Sparkles,
  Square,
  Terminal,
  X,
} from "lucide-react"
import * as React from "react"

import { FileIcon } from "@/components/ui/file-icon"
import {
  promptHistoryEntries,
  stepPromptHistory,
  type PromptHistoryPosition,
} from "@/lib/prompt-history"
import { cn } from "@/lib/utils"

export type ChatSkill = {
  name: string
  description?: string
  /** Where it was found. Shown in the menu, so two of one name read apart. */
  scope?: "project" | "user"
  /**
   * `false` keeps it out of the menus: the provider reserves that skill for
   * the agent, and a user invocation of it is refused.
   */
  userInvocable?: boolean
}

export type ChatSlashCommand = {
  name: string
  description?: string
  argHint?: string
  /**
   * The command runs only when it opens the message — what a provider's own
   * commands do, since anywhere else the text reaches the agent verbatim.
   * Such a command is offered only while the `/` sits at offset 0.
   * Defaults to `commandsMustStartMessage`.
   */
  mustStartMessage?: boolean
}

export type ChatInputPayload = {
  text: string
  files: File[]
  /**
   * The skills this message names: every `$mention` in the text that matches
   * `skills`, plus whatever the host put there through `setDraft`. The text
   * keeps the mentions — this is the same list, already parsed.
   */
  skills: string[]
}

/** What the composer holds right now — the text already expanded (see `onPaste`). */
export type ChatInputDraft = {
  text: string
  files: File[]
  skills: string[]
}

/** Imperative access for a host that drives the composer from outside. */
export type ChatInputHandle = {
  focus: () => void
  getDraft: () => ChatInputDraft
  setDraft: (draft: Partial<ChatInputDraft>) => void
  /** Inserts at the caret (replacing a selection) and leaves it after the text. */
  insertText: (text: string) => void
}

export type ChatInputMentionItem = {
  id: string
  label: string
  description?: string
  /** Text written into the draft. @default `@${label}` */
  insert?: string
}

export type ChatInputQueuedMessage = {
  id: string
  text: string
  fileCount?: number
}

export type ChatInputProps = {
  onSend: (payload: ChatInputPayload) => void
  onStop?: () => void
  isGenerating?: boolean
  placeholder?: string
  /** Rendered next to the attach button — model/mode pickers belong here. */
  tools?: React.ReactNode
  /**
   * Fires on every change to the draft, the clear after a send and the text a
   * slash command inserts included. The composer keeps owning the value; this
   * is for a host that has to react to it, such as a context meter.
   */
  onTextChange?: (text: string) => void
  /**
   * What `$` offers, and what the `/` menu lists above the commands. Picking
   * one writes a `$name` mention into the draft.
   */
  skills?: ChatSkill[]
  slashCommands?: ChatSlashCommand[]
  /**
   * Default for `ChatSlashCommand.mustStartMessage` — set it when the list is
   * a provider's own commands, which only run at the head of a message.
   */
  commandsMustStartMessage?: boolean
  className?: string
  disabled?: boolean
  /** Max textarea height in px before it scrolls. */
  maxHeight?: number
  ref?: React.Ref<ChatInputHandle>
  /** Initial draft text. The composer owns the value from then on. */
  defaultValue?: string
  /**
   * Set it to let the user keep typing while a turn streams: Enter queues the
   * message instead of locking the textarea. The host owns the queue.
   */
  onQueue?: (payload: ChatInputPayload) => void
  queue?: ChatInputQueuedMessage[]
  onQueueRemove?: (id: string) => void
  /** Asked to put a queued message back into the composer — host calls `setDraft`. */
  onQueueEdit?: (id: string) => void
  /** Resolves the `@`-token at the caret. May be async; stale answers are dropped. */
  mentions?: (
    query: string
  ) => Promise<ChatInputMentionItem[]> | ChatInputMentionItem[]
  /** ⌘S / Ctrl+S hands the draft over and clears the composer. */
  onStash?: (payload: ChatInputPayload) => void
  /**
   * Prompts already sent in this conversation, oldest first — the host's user
   * messages, and nothing the composer has to know about transcripts. With it,
   * ArrowUp at the start of an untouched composer recalls the previous prompt
   * and ArrowDown walks back down, the way a shell does; one step past the
   * newest empties the composer again.
   *
   * Blank sends are skipped and consecutive duplicates collapse. Keep the
   * array stable — a new identity per render re-derives the entries.
   */
  history?: readonly { id: string; text: string }[]
}

type SlashMenuItem =
  | { kind: "skill"; name: string; description: string; scope?: ChatSkill["scope"] }
  | { kind: "command"; name: string; description: string; argHint?: string }

/** A pasted block held out of the textarea, represented there by `token`. */
type PasteEntry = { id: string; n: number; token: string; text: string }

const EMPTY_SKILLS: ChatSkill[] = []
const EMPTY_COMMANDS: ChatSlashCommand[] = []
const EMPTY_QUEUE: ChatInputQueuedMessage[] = []
const EMPTY_MENTIONS: ChatInputMentionItem[] = []
const EMPTY_FILES: File[] = []
const EMPTY_STRINGS: string[] = []
const EMPTY_PASTES: PasteEntry[] = []
const EMPTY_HISTORY: readonly { id: string; text: string }[] = []

/** Long enough that a chip beats a wall of text in a one-line composer. */
const PASTE_MAX_CHARS = 800
const PASTE_MAX_LINES = 3
const MENTION_DEBOUNCE_MS = 120
/** The `$` menu is a picker, not a browser: past this it stops being scannable. */
const MAX_SKILL_MATCHES = 50

/**
 * Every control in the composer row shares one height and radius, so the
 * toolbar stays aligned no matter what you drop into `tools`.
 */
export const chatInputButtonVariants = cva(
  "inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-md text-[12px] whitespace-nowrap outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 sm:h-7 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        ghost: "min-w-9 px-2 text-muted-foreground hover:bg-muted hover:text-foreground sm:min-w-0",
        primary:
          "min-w-11 bg-primary px-2.5 text-primary-foreground hover:bg-primary/90 disabled:bg-primary/15 disabled:text-primary/70 disabled:opacity-100",
      },
    },
    defaultVariants: { variant: "ghost" },
  }
)

/** Shared popover shell for the slash and mention menus. */
const menuSurfaceClass =
  "absolute inset-x-0 bottom-full z-30 mb-2 overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-md animate-in fade-in slide-in-from-bottom-1 duration-150"

const menuListClass = "max-h-[min(50vh,28rem)] overflow-y-auto overscroll-contain"

const menuOptionClass =
  "col-span-full grid w-full grid-cols-subgrid items-start rounded-md px-1 py-2 text-left transition-colors"

/*
 * The `$skill` machinery below — the token shape, the money exclusion and the
 * tiered ranking — is adapted from T3 Code
 * (github.com/pingdotgg/t3code, MIT License).
 */

/**
 * A `$name` that is a skill mention and not an amount of money. A name may
 * open with a digit, so the exclusion is explicit: `$20`, `$20k`, `$100M` and
 * `$1e6` stay prose, and every match has to carry at least one letter.
 */
const SKILL_TOKEN_REGEX =
  /(^|\s)\$(?![0-9][0-9_]*(?:[kKmMbBtT]|[eE][0-9]+)?(?:\s|$))(?=[a-zA-Z0-9:_-]*[a-zA-Z])([a-zA-Z0-9][a-zA-Z0-9:_-]*)(?=\s|$)/g

/** The same exclusion, for a token still being typed at the caret. */
const MONEY_TOKEN_REGEX = /^[0-9][0-9_]*(?:[kKmMbBtT]|[eE][0-9]+)?$/

/** The `$token` the caret sits in, if any. Shaped like `findMentionToken`. */
function findSkillToken(text: string, caret: number) {
  const position = Math.max(0, Math.min(caret, text.length))
  const match = /(^|\s)\$([a-zA-Z0-9:_-]*)$/.exec(text.slice(0, position))
  if (!match) return null
  if (MONEY_TOKEN_REGEX.test(match[2])) return null
  const start = match.index + match[1].length
  const tail = /^[a-zA-Z0-9:_-]*/.exec(text.slice(position))?.[0] ?? ""
  return { query: match[2], start, end: position + tail.length }
}

/** Every known skill the text names, in the order it names them, once each. */
function skillMentionsIn(text: string, known: ReadonlySet<string>) {
  const names: string[] = []
  for (const match of text.matchAll(SKILL_TOKEN_REGEX)) {
    const name = match[2]
    if (known.has(name) && !names.includes(name)) names.push(name)
  }
  return names
}

/** Drops every `$name` mention of one skill, and the space that carried it. */
function removeSkillMention(text: string, name: string) {
  return text.replace(SKILL_TOKEN_REGEX, (match, _prefix: string, found: string) =>
    found === name ? "" : match
  )
}

/**
 * How well a scattered subsequence of `query` sits in `value` — the last
 * resort, so `mgd` still finds `migrate-database`. Lower is better: an early,
 * tight, short match wins.
 */
function scoreSubsequenceMatch(value: string, query: string): number | null {
  if (!query) return 0
  let queryIndex = 0
  let first = -1
  let previous = -1
  let gaps = 0
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== query[queryIndex]) continue
    if (first === -1) first = index
    if (previous !== -1) gaps += index - previous - 1
    previous = index
    queryIndex += 1
    if (queryIndex === query.length) {
      const span = index - first + 1 - query.length
      return first * 2 + gaps * 3 + span + Math.min(64, value.length - query.length)
    }
  }
  return null
}

function lengthPenalty(value: string, query: string) {
  return Math.min(64, Math.max(0, value.length - query.length))
}

function boundaryMatchIndex(
  value: string,
  query: string,
  markers: readonly string[]
) {
  let best: number | null = null
  for (const marker of markers) {
    const index = value.indexOf(`${marker}${query}`)
    if (index === -1) continue
    const at = index + marker.length
    if (best === null || at < best) best = at
  }
  return best
}

/**
 * Tiered match scoring — exact, then prefix, then a word boundary, then
 * anywhere, then a subsequence. Each tier's base is far enough above the last
 * that no within-tier refinement can cross it, which is what keeps the order
 * of a menu predictable. Both inputs must already be trimmed and lowercased.
 */
function scoreQueryMatch(input: {
  value: string
  query: string
  exactBase: number
  prefixBase?: number
  boundaryBase?: number
  includesBase?: number
  fuzzyBase?: number
  boundaryMarkers?: readonly string[]
}): number | null {
  const { value, query } = input
  if (!value || !query) return null
  if (value === query) return input.exactBase
  if (input.prefixBase !== undefined && value.startsWith(query)) {
    return input.prefixBase + lengthPenalty(value, query)
  }
  if (input.boundaryBase !== undefined) {
    const index = boundaryMatchIndex(
      value,
      query,
      input.boundaryMarkers ?? [" ", "-", "_", "/"]
    )
    if (index !== null) {
      return input.boundaryBase + index * 2 + lengthPenalty(value, query)
    }
  }
  if (input.includesBase !== undefined) {
    const index = value.indexOf(query)
    if (index !== -1) {
      return input.includesBase + index * 2 + lengthPenalty(value, query)
    }
  }
  if (input.fuzzyBase !== undefined) {
    const fuzzy = scoreSubsequenceMatch(value, query)
    if (fuzzy !== null) return input.fuzzyBase + fuzzy
  }
  return null
}

/** The name carries the pick, so it outranks the prose around it. */
function scoreSkill(skill: ChatSkill, query: string): number | null {
  const scores = [
    scoreQueryMatch({
      value: skill.name.toLowerCase(),
      query,
      exactBase: 0,
      prefixBase: 2,
      boundaryBase: 4,
      includesBase: 6,
      fuzzyBase: 100,
      boundaryMarkers: ["-", "_", ":", "/"],
    }),
    scoreQueryMatch({
      value: skill.description?.toLowerCase() ?? "",
      query,
      exactBase: 20,
      prefixBase: 22,
      boundaryBase: 24,
      includesBase: 26,
    }),
    scoreQueryMatch({
      value: skill.scope ?? "",
      query,
      exactBase: 40,
      prefixBase: 42,
      includesBase: 44,
    }),
  ].filter((score): score is number => score !== null)
  return scores.length === 0 ? null : Math.min(...scores)
}

/** A skill the provider reserves for the agent is not a user's to start. */
function isUserInvocable(skill: ChatSkill) {
  return skill.userInvocable !== false
}

function rankSkills(skills: ChatSkill[], query: string, limit: number) {
  const offered = skills.filter(isUserInvocable)
  const normalized = query.trim().toLowerCase()
  if (!normalized) return offered.slice(0, limit)
  return offered
    .flatMap((skill) => {
      const score = scoreSkill(skill, normalized)
      return score === null ? [] : [{ skill, score }]
    })
    .sort(
      (left, right) =>
        left.score - right.score || left.skill.name.localeCompare(right.skill.name)
    )
    .slice(0, limit)
    .map((entry) => entry.skill)
}

/**
 * The `/token` the caret sits in, if any. A `/` mid-word is a path, not a
 * command, so the token has to open the text or follow a space.
 */
function findSlashToken(text: string, caret: number) {
  const position = Math.max(0, Math.min(caret, text.length))
  const match = /(^|\s)\/([^\s/]*)$/.exec(text.slice(0, position))
  if (!match) return null
  const start = match.index + match[1].length
  const tail = /^[^\s/]*/.exec(text.slice(position))?.[0] ?? ""
  return { query: match[2], start, end: position + tail.length }
}

/** The `@token` the caret sits in, if any. */
function findMentionToken(text: string, caret: number) {
  const position = Math.max(0, Math.min(caret, text.length))
  const before = text.slice(0, position)
  const match = /(^|\s)@([^\s@]*)$/.exec(before)
  if (!match) return null
  const start = match.index + match[1].length
  // The token ends where the run of non-space characters does, not at the
  // caret: picking inside `@src|c` has to replace the `c` too. The query
  // stays caret-scoped, so the menu keeps filtering on what was typed.
  const tail = /^[^\s@]*/.exec(text.slice(position))?.[0] ?? ""
  return { query: match[2], start, end: position + tail.length }
}

function pasteTokenFor(n: number, lines: number, chars: number) {
  // One long line has nothing to count in lines — `+1 lines` says nothing.
  const size = lines === 1 ? `+${chars} chars` : `+${lines} lines`
  return `[Pasted text #${n} ${size}]`
}

/** Puts every still-present placeholder back to the block it stands for. */
function expandPastes(text: string, pastes: PasteEntry[]) {
  return pastes.reduce(
    (acc, paste) => acc.split(paste.token).join(paste.text),
    text
  )
}

function looksLikePath(label: string) {
  return label.includes("/") || label.includes(".")
}

export function ChatInput({
  onSend,
  onStop,
  isGenerating = false,
  placeholder,
  tools,
  onTextChange,
  skills = EMPTY_SKILLS,
  slashCommands = EMPTY_COMMANDS,
  commandsMustStartMessage = false,
  className,
  disabled = false,
  maxHeight = 200,
  ref,
  defaultValue = "",
  onQueue,
  queue = EMPTY_QUEUE,
  onQueueRemove,
  onQueueEdit,
  mentions,
  onStash,
  history = EMPTY_HISTORY,
}: ChatInputProps) {
  const [text, setText] = React.useState(defaultValue)
  const [pending, setPending] = React.useState<File[]>(EMPTY_FILES)
  const [forcedSkills, setForcedSkills] = React.useState<string[]>(EMPTY_STRINGS)
  const [pastes, setPastes] = React.useState<PasteEntry[]>(EMPTY_PASTES)
  const [dragOver, setDragOver] = React.useState(false)
  const [caret, setCaret] = React.useState(defaultValue.length)
  const [slashIndex, setSlashIndex] = React.useState(0)
  // Every menu's selection and dismissal is keyed by the token it belongs to,
  // so a new token starts fresh without an effect resetting anything.
  const [slashDismissed, setSlashDismissed] = React.useState<string | null>(null)
  const [skillSelection, setSkillSelection] = React.useState<{
    key: string
    index: number
  } | null>(null)
  const [skillDismissed, setSkillDismissed] = React.useState<string | null>(null)
  const [mentionSelection, setMentionSelection] = React.useState<{
    key: string
    index: number
  } | null>(null)
  const [mentionDismissed, setMentionDismissed] = React.useState<string | null>(
    null
  )
  const [mentionResult, setMentionResult] = React.useState<{
    query: string
    items: ChatInputMentionItem[]
  } | null>(null)
  /* Where the reader is in the sent prompts, as an entry id plus the text that
     was put in the composer — never an index, which a list that grows
     underneath would silently move. */
  const [historyPosition, setHistoryPosition] =
    React.useState<PromptHistoryPosition | null>(null)
  const taRef = React.useRef<HTMLTextAreaElement>(null)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const pasteIdRef = React.useRef(0)
  const mentionSeqRef = React.useRef(0)
  const uid = React.useId()
  const slashMenuId = `${uid}-slash`
  const skillMenuId = `${uid}-skill`
  const mentionMenuId = `${uid}-mention`

  /**
   * What the handle reads, and what the mutators keep current. Each one
   * writes its ref *synchronously* before setting state, so two calls in the
   * same tick compose (`insertText("a"); insertText("b")`) and `getDraft()`
   * is right before React has flushed anything — a passive-effect mirror was
   * one commit behind both, and started empty under a `defaultValue`.
   */
  const textRef = React.useRef(defaultValue)
  const pastesRef = React.useRef<PasteEntry[]>(EMPTY_PASTES)
  const pendingRef = React.useRef<File[]>(EMPTY_FILES)
  const skillsRef = React.useRef<string[]>(EMPTY_STRINGS)

  /**
   * Read through a ref so `changeText` — and the callbacks that close over it
   * — stay stable across renders. A host that rebuilds the handler on every
   * keystroke must not be able to rebuild this composer's memoized ones too.
   */
  const notifyText = React.useRef(onTextChange)
  React.useEffect(() => {
    notifyText.current = onTextChange
  }, [onTextChange])

  const mentionProvider = React.useRef(mentions)
  React.useEffect(() => {
    mentionProvider.current = mentions
  }, [mentions])

  /** The catalog as a set, for reading mentions out of the text. */
  const skillNames = React.useMemo(
    () => new Set(skills.map((skill) => skill.name)),
    [skills]
  )
  const skillNamesRef = React.useRef(skillNames)
  React.useEffect(() => {
    skillNamesRef.current = skillNames
  }, [skillNames])

  /**
   * What a payload reports: the mentions the text carries, after whatever the
   * host set through `setDraft`. One list, whichever way a skill got there.
   */
  const collectSkills = React.useCallback((value: string) => {
    const named = skillMentionsIn(value, skillNamesRef.current)
    if (named.length === 0) return skillsRef.current
    return [...new Set([...skillsRef.current, ...named])]
  }, [])

  const changeText = React.useCallback((value: string) => {
    textRef.current = value
    setText(value)
    notifyText.current?.(value)
  }, [])

  const updatePastes = React.useCallback(
    (next: PasteEntry[] | ((prev: PasteEntry[]) => PasteEntry[])) => {
      const value = typeof next === "function" ? next(pastesRef.current) : next
      if (value === pastesRef.current) return
      pastesRef.current = value
      setPastes(value)
    },
    []
  )

  const updatePending = React.useCallback(
    (next: File[] | ((prev: File[]) => File[])) => {
      const value = typeof next === "function" ? next(pendingRef.current) : next
      if (value === pendingRef.current) return
      pendingRef.current = value
      setPending(value)
    },
    []
  )

  const updateSkills = React.useCallback(
    (next: string[] | ((prev: string[]) => string[])) => {
      const value = typeof next === "function" ? next(skillsRef.current) : next
      if (value === skillsRef.current) return
      skillsRef.current = value
      setForcedSkills(value)
    },
    []
  )

  /**
   * A placeholder the user edited away — backspaced into, typed or pasted
   * over — takes its entry with it. Left behind, the chip lingers and
   * `expandPastes` quietly drops the block the token stood for on send.
   */
  const prunePastes = React.useCallback(
    (value: string) => {
      updatePastes((prev) => {
        if (prev.length === 0) return prev
        const kept = prev.filter((p) => value.includes(p.token))
        return kept.length === prev.length ? prev : kept
      })
    },
    [updatePastes]
  )

  /** Focus after a menu pick or an insert, once React has written the value. */
  const focusCaret = React.useCallback((position: number) => {
    requestAnimationFrame(() => {
      const ta = taRef.current
      if (!ta) return
      ta.focus()
      ta.setSelectionRange(position, position)
    })
  }, [])

  const historyEntries = React.useMemo(
    () => promptHistoryEntries(history),
    [history]
  )

  const slashEnabled = skills.length > 0 || slashCommands.length > 0
  const slashToken = React.useMemo(
    () => (slashEnabled ? findSlashToken(text, caret) : null),
    [caret, slashEnabled, text]
  )
  const slashQuery = slashToken?.query ?? null
  const slashKey =
    slashToken === null ? null : `${slashToken.start}:${slashToken.query}`
  const slashVisible = slashToken !== null && slashDismissed !== slashKey

  const slashMatches = React.useMemo(() => {
    if (!slashVisible || slashQuery === null) return [] as SlashMenuItem[]
    const q = slashQuery.toLowerCase()
    /* A provider expands its own command only when the command opens the
       message; anywhere else it reaches the agent as literal text, so it is
       not offered there. Skills insert a mention the agent reads from any
       position, and so stay on the menu. */
    const atStart = slashToken?.start === 0
    return [
      ...rankSkills(skills, q, MAX_SKILL_MATCHES).map<SlashMenuItem>((s) => ({
        kind: "skill",
        name: s.name,
        description: s.description ?? "",
        scope: s.scope,
      })),
      ...slashCommands
        .filter(
          (c) =>
            (atStart || !(c.mustStartMessage ?? commandsMustStartMessage)) &&
            (c.name.toLowerCase().startsWith(q) ||
              (c.description?.toLowerCase().includes(q) ?? false))
        )
        .map<SlashMenuItem>((c) => ({
          kind: "command",
          name: c.name,
          description: c.description ?? "",
          argHint: c.argHint,
        })),
    ]
  }, [
    commandsMustStartMessage,
    skills,
    slashCommands,
    slashQuery,
    slashToken?.start,
    slashVisible,
  ])

  const slashOpen = slashVisible && slashMatches.length > 0
  // The index outlives the query that shrinks the list under it, so clamp on
  // read — the same shape `mentionIndex` uses.
  const slashSelected = Math.min(
    slashIndex,
    Math.max(0, slashMatches.length - 1)
  )

  /* The `$` menu. Its own trigger rather than a corner of the slash one: a
     skill is named inside a sentence ("rewrite this with $changelog"), which
     is exactly where a `/` cannot go. */
  const skillsEnabled = skills.length > 0
  const skillToken = React.useMemo(
    () => (skillsEnabled ? findSkillToken(text, caret) : null),
    [caret, skillsEnabled, text]
  )
  const skillKey =
    skillToken === null ? null : `${skillToken.start}:${skillToken.query}`
  const skillMatches = React.useMemo(
    () =>
      skillToken === null
        ? EMPTY_SKILLS
        : rankSkills(skills, skillToken.query, MAX_SKILL_MATCHES),
    [skillToken, skills]
  )
  const skillOpen =
    !slashOpen &&
    skillMatches.length > 0 &&
    skillKey !== null &&
    skillDismissed !== skillKey
  const skillIndex =
    skillSelection && skillSelection.key === skillKey
      ? Math.min(skillSelection.index, skillMatches.length - 1)
      : 0

  const moveSkill = React.useCallback(
    (delta: number) => {
      if (skillKey === null || skillMatches.length === 0) return
      const next =
        (skillIndex + delta + skillMatches.length) % skillMatches.length
      setSkillSelection({ key: skillKey, index: next })
    },
    [skillIndex, skillKey, skillMatches.length]
  )

  /* The chips are a reading of the text, not a second store beside it: the
     mention *is* the value, so editing it away takes the chip with it. */
  const mentionedSkills = React.useMemo(
    () => skillMentionsIn(text, skillNames),
    [skillNames, text]
  )

  const mentionsEnabled = !!mentions
  const mentionToken = React.useMemo(
    () => (mentionsEnabled ? findMentionToken(text, caret) : null),
    [caret, mentionsEnabled, text]
  )
  const mentionQuery = mentionToken?.query ?? null
  const mentionKey =
    mentionToken === null ? null : `${mentionToken.start}:${mentionToken.query}`

  // Debounced, sequence-guarded lookup. The provider is read through a ref so
  // an inline arrow from the host cannot restart the debounce every render.
  React.useEffect(() => {
    if (!mentionsEnabled || mentionQuery === null) return
    const seq = ++mentionSeqRef.current
    let cancelled = false
    const timer = window.setTimeout(() => {
      void (async () => {
        let items: ChatInputMentionItem[] = EMPTY_MENTIONS
        try {
          items = (await mentionProvider.current?.(mentionQuery)) ?? EMPTY_MENTIONS
        } catch {
          items = EMPTY_MENTIONS
        }
        if (cancelled || seq !== mentionSeqRef.current) return
        setMentionResult({ query: mentionQuery, items })
      })()
    }, MENTION_DEBOUNCE_MS)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [mentionQuery, mentionsEnabled])

  const mentionMatches =
    mentionQuery !== null && mentionResult?.query === mentionQuery
      ? mentionResult.items
      : EMPTY_MENTIONS
  const mentionOpen =
    !slashOpen &&
    !skillOpen &&
    mentionMatches.length > 0 &&
    mentionKey !== null &&
    mentionDismissed !== mentionKey
  const mentionIndex =
    mentionSelection && mentionSelection.key === mentionKey
      ? Math.min(mentionSelection.index, mentionMatches.length - 1)
      : 0

  const moveMention = React.useCallback(
    (delta: number) => {
      if (mentionKey === null || mentionMatches.length === 0) return
      const next =
        (mentionIndex + delta + mentionMatches.length) % mentionMatches.length
      setMentionSelection({ key: mentionKey, index: next })
    },
    [mentionIndex, mentionKey, mentionMatches.length]
  )

  // Auto-resize the textarea, capped at `maxHeight`.
  React.useEffect(() => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = "auto"
    const capped = ta.scrollHeight > maxHeight
    ta.style.height = `${capped ? maxHeight : ta.scrollHeight}px`
    ta.style.overflowY = capped ? "auto" : "hidden"
  }, [text, maxHeight])

  const addFiles = React.useCallback((files: FileList | File[] | null) => {
    if (!files) return
    const list = Array.from(files)
    if (list.length === 0) return
    updatePending((prev) => [...prev, ...list])
  }, [updatePending])

  const clearDraft = React.useCallback(() => {
    changeText("")
    updatePending(EMPTY_FILES)
    updateSkills(EMPTY_STRINGS)
    updatePastes(EMPTY_PASTES)
    setCaret(0)
  }, [changeText, updatePastes, updatePending, updateSkills])

  /** Queueing is on only when the host said what to do with a queued message. */
  const queueing = isGenerating && !!onQueue

  const submit = React.useCallback(() => {
    if (disabled) return
    const value = expandPastes(text, pastes).trim()
    if (!value && pending.length === 0) return
    const payload: ChatInputPayload = {
      text: value,
      files: pending,
      skills: collectSkills(value),
    }
    if (isGenerating) {
      if (!onQueue) return
      onQueue(payload)
    } else {
      onSend(payload)
    }
    clearDraft()
  }, [
    clearDraft,
    collectSkills,
    disabled,
    isGenerating,
    onQueue,
    onSend,
    pastes,
    pending,
    text,
  ])

  const stash = React.useCallback(() => {
    if (disabled || !onStash) return
    const value = expandPastes(text, pastes).trim()
    if (!value && pending.length === 0) return
    onStash({ text: value, files: pending, skills: collectSkills(value) })
    clearDraft()
  }, [clearDraft, collectSkills, disabled, onStash, pastes, pending, text])

  /**
   * One shell-style step through the sent prompts. Returns false when the key
   * should fall through to ordinary caret movement — which is most of the
   * time, and is why this reads the step first and only then prevents.
   */
  const recallPrompt = React.useCallback(
    (direction: "backward" | "forward") => {
      const step = stepPromptHistory({
        direction,
        entries: historyEntries,
        position: historyPosition,
        currentPrompt: textRef.current,
      })
      if (!step) return false
      setHistoryPosition(step.position)
      changeText(step.prompt)
      // The recalled text arrives whole, so any paste chips it replaced are gone.
      updatePastes(EMPTY_PASTES)
      setCaret(step.prompt.length)
      focusCaret(step.prompt.length)
      return true
    },
    [changeText, focusCaret, historyEntries, historyPosition, updatePastes]
  )

  const insertAtCaret = React.useCallback(
    (value: string) => {
      const current = textRef.current
      const ta = taRef.current
      const start = ta ? ta.selectionStart : current.length
      const end = ta ? ta.selectionEnd : start
      const next = current.slice(0, start) + value + current.slice(end)
      const position = start + value.length
      changeText(next)
      setCaret(position)
      focusCaret(position)
    },
    [changeText, focusCaret]
  )

  /**
   * The handle keeps one identity for the composer's lifetime: a host holds
   * it across renders — an effect cleanup that parks the draft when the chat
   * changes, say — and a handle rebuilt per keystroke would hand that cleanup
   * the text the composer had when the reference was taken.
   */
  React.useImperativeHandle(
    ref,
    () => ({
      focus: () => taRef.current?.focus(),
      getDraft: () => {
        const value = expandPastes(textRef.current, pastesRef.current)
        return {
          text: value,
          files: pendingRef.current,
          skills: collectSkills(value),
        }
      },
      setDraft: (draft) => {
        if (draft.text !== undefined) {
          // The text arrives expanded, so the chips it may have carried are gone.
          changeText(draft.text)
          updatePastes(EMPTY_PASTES)
          setCaret(draft.text.length)
        }
        if (draft.files !== undefined) updatePending(draft.files)
        if (draft.skills !== undefined) updateSkills(draft.skills)
      },
      insertText: insertAtCaret,
    }),
    [
      changeText,
      collectSkills,
      insertAtCaret,
      updatePastes,
      updatePending,
      updateSkills,
    ]
  )

  /** Writes `insert` over the token the caret sits in, and lands after it. */
  const replaceToken = React.useCallback(
    (token: { start: number; end: number }, insert: string) => {
      const current = textRef.current
      const next = current.slice(0, token.start) + insert + current.slice(token.end)
      const position = token.start + insert.length
      changeText(next)
      setCaret(position)
      focusCaret(position)
    },
    [changeText, focusCaret]
  )

  const selectSlashItem = React.useCallback(
    (item: SlashMenuItem) => {
      if (!slashToken) return
      // A skill is a mention wherever it is picked, so the two menus can never
      // disagree about what choosing one puts in the draft.
      replaceToken(
        slashToken,
        item.kind === "command" ? `/${item.name} ` : `$${item.name} `
      )
      setSlashIndex(0)
      setSlashDismissed(null)
    },
    [replaceToken, slashToken]
  )

  const selectSkillItem = React.useCallback(
    (skill: ChatSkill) => {
      if (!skillToken) return
      replaceToken(skillToken, `$${skill.name} `)
      setSkillSelection(null)
      setSkillDismissed(null)
    },
    [replaceToken, skillToken]
  )

  const selectMentionItem = React.useCallback(
    (item: ChatInputMentionItem) => {
      if (!mentionToken) return
      const insert = `${item.insert ?? `@${item.label}`} `
      const next =
        text.slice(0, mentionToken.start) + insert + text.slice(mentionToken.end)
      const position = mentionToken.start + insert.length
      changeText(next)
      setCaret(position)
      setMentionSelection(null)
      setMentionDismissed(null)
      focusCaret(position)
    },
    [changeText, focusCaret, mentionToken, text]
  )

  const removePaste = React.useCallback(
    (paste: PasteEntry) => {
      updatePastes((prev) => prev.filter((p) => p.id !== paste.id))
      // The placeholder must go with the chip, or a send would keep the token.
      changeText(text.split(paste.token).join(""))
    },
    [changeText, text, updatePastes]
  )

  const onPaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const clipboard = event.clipboardData
    if (!clipboard) return
    if (clipboard.files?.length) {
      event.preventDefault()
      addFiles(clipboard.files)
      return
    }
    const raw = clipboard.getData("text/plain")
    if (!raw) return
    const lines = raw.split("\n").length
    if (raw.length <= PASTE_MAX_CHARS && lines <= PASTE_MAX_LINES) return

    event.preventDefault()
    const ta = event.currentTarget
    const start = ta.selectionStart
    const end = ta.selectionEnd
    // What the paste leaves standing, before the new placeholder goes in: a
    // token the selection swallowed loses its entry here.
    prunePastes(text.slice(0, start) + text.slice(end))
    // Numbers are reused once a chip is gone, so two live tokens never collide.
    const n = pastesRef.current.reduce((max, p) => Math.max(max, p.n), 0) + 1
    const token = pasteTokenFor(n, lines, raw.length)
    pasteIdRef.current += 1
    updatePastes((prev) => [
      ...prev,
      { id: `paste-${pasteIdRef.current}`, n, token, text: raw },
    ])
    const position = start + token.length
    changeText(text.slice(0, start) + token + text.slice(end))
    setCaret(position)
    focusCaret(position)
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Never steal keys from an IME candidate window.
    if (event.nativeEvent.isComposing) return

    if (
      onStash &&
      (event.metaKey || event.ctrlKey) &&
      event.key.toLowerCase() === "s"
    ) {
      // Always swallow it: a composer must never open the browser's save dialog.
      event.preventDefault()
      stash()
      return
    }

    if (slashOpen) {
      if (event.key === "ArrowDown") {
        event.preventDefault()
        setSlashIndex((slashSelected + 1) % slashMatches.length)
        return
      }
      if (event.key === "ArrowUp") {
        event.preventDefault()
        setSlashIndex(
          (slashSelected - 1 + slashMatches.length) % slashMatches.length
        )
        return
      }
      if (event.key === "Tab") {
        event.preventDefault()
        const item = slashMatches[slashSelected]
        if (item) selectSlashItem(item)
        return
      }
      if (event.key === "Escape") {
        event.preventDefault()
        setSlashIndex(0)
        setSlashDismissed(slashKey)
        return
      }
      if (event.key === "Enter" && !event.shiftKey) {
        const item = slashMatches[slashSelected]
        // Enter picks only while the command is the whole message — mid-text
        // it is Tab's job, and Enter still sends what was written.
        if (item && text.trim() === `/${slashQuery ?? ""}`) {
          event.preventDefault()
          selectSlashItem(item)
          return
        }
      }
    }

    if (skillOpen) {
      if (event.key === "ArrowDown") {
        event.preventDefault()
        moveSkill(1)
        return
      }
      if (event.key === "ArrowUp") {
        event.preventDefault()
        moveSkill(-1)
        return
      }
      if (event.key === "Escape") {
        event.preventDefault()
        setSkillDismissed(skillKey)
        return
      }
      if (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey)) {
        const item = skillMatches[skillIndex]
        if (item) {
          event.preventDefault()
          selectSkillItem(item)
          return
        }
      }
    }

    if (mentionOpen) {
      if (event.key === "ArrowDown") {
        event.preventDefault()
        moveMention(1)
        return
      }
      if (event.key === "ArrowUp") {
        event.preventDefault()
        moveMention(-1)
        return
      }
      if (event.key === "Escape") {
        event.preventDefault()
        setMentionDismissed(mentionKey)
        return
      }
      if (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey)) {
        const item = mentionMatches[mentionIndex]
        if (item) {
          event.preventDefault()
          selectMentionItem(item)
          return
        }
      }
    }

    /* Prompt recall comes after both menus on purpose: while one is open the
       arrows are choosing an item, and only a plain arrow at the very start or
       the very end of the text is a request for history. Anything the reader
       has typed is left alone — a backward step out of a non-empty composer
       returns nothing, so the draft is never overwritten. */
    if (
      historyEntries.length > 0 &&
      (event.key === "ArrowUp" || event.key === "ArrowDown") &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.shiftKey
    ) {
      const ta = event.currentTarget
      const collapsed = ta.selectionStart === ta.selectionEnd
      const backward = event.key === "ArrowUp"
      const atEdge =
        collapsed &&
        (backward
          ? ta.selectionStart === 0
          : ta.selectionStart === ta.value.length)
      if (atEdge && recallPrompt(backward ? "backward" : "forward")) {
        event.preventDefault()
        return
      }
    }

    // Enter sends (or queues), Shift+Enter inserts a newline.
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  const syncCaret = (event: React.SyntheticEvent<HTMLTextAreaElement>) => {
    setCaret(event.currentTarget.selectionStart)
  }

  const hasDraft = text.trim().length > 0 || pending.length > 0
  const canSend = hasDraft && !disabled && (!isGenerating || queueing)
  // While queueing the textarea stays live — only a plain generating turn locks it.
  const inputLocked = disabled || (isGenerating && !queueing)
  const hasAttachments =
    pending.length > 0 ||
    forcedSkills.length > 0 ||
    mentionedSkills.length > 0 ||
    pastes.length > 0
  const resolvedPlaceholder =
    placeholder ?? (queueing ? "Queue a message… (Enter)" : "Ask anything")

  return (
    <div
      data-slot="chat-input"
      className={cn(
        "mx-auto w-full max-w-3xl px-3 pt-1 pb-3 sm:px-4 sm:pb-4",
        className
      )}
    >
      <div className="relative">
        {slashOpen ? (
          <SlashMenu
            menuId={slashMenuId}
            matches={slashMatches}
            selectedIndex={slashSelected}
            onHover={setSlashIndex}
            onSelect={selectSlashItem}
          />
        ) : null}
        {skillOpen ? (
          <SkillMenu
            menuId={skillMenuId}
            items={skillMatches}
            selectedIndex={skillIndex}
            onHover={(index) =>
              setSkillSelection(
                skillKey === null ? null : { key: skillKey, index }
              )
            }
            onSelect={selectSkillItem}
          />
        ) : null}
        {mentionOpen ? (
          <MentionMenu
            menuId={mentionMenuId}
            items={mentionMatches}
            selectedIndex={mentionIndex}
            onHover={(index) =>
              setMentionSelection(
                mentionKey === null ? null : { key: mentionKey, index }
              )
            }
            onSelect={selectMentionItem}
          />
        ) : null}

        {queue.length > 0 ? (
          <div data-slot="chat-input-queue" className="mb-2 flex flex-col gap-1">
            <div className="px-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              Queued · {queue.length}
            </div>
            {queue.map((item) => (
              <div
                key={item.id}
                data-slot="chat-input-queue-item"
                className="flex items-center gap-2 rounded-md border bg-muted/40 px-2 py-1 text-[12px]"
              >
                {onQueueEdit ? (
                  <button
                    type="button"
                    title="Edit this message"
                    aria-label={`Edit queued message: ${item.text}`}
                    onClick={() => onQueueEdit(item.id)}
                    className="min-w-0 flex-1 truncate rounded-sm text-left text-foreground outline-none transition-colors hover:text-primary focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    {item.text}
                  </button>
                ) : (
                  <span className="min-w-0 flex-1 truncate text-foreground">
                    {item.text}
                  </span>
                )}
                {item.fileCount ? (
                  <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
                    <Paperclip className="size-3" />
                    {item.fileCount}
                  </span>
                ) : null}
                {onQueueRemove ? (
                  <button
                    type="button"
                    title="Remove"
                    aria-label={`Remove queued message: ${item.text}`}
                    onClick={() => onQueueRemove(item.id)}
                    className="inline-grid size-4 shrink-0 place-items-center rounded-full text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    <X className="size-3" />
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}

        <div
          data-slot="chat-input-surface"
          data-drag-over={dragOver || undefined}
          data-state={queueing ? "queueing" : undefined}
          className={cn(
            /* A hairline card, not a pill: the focus state is a border-color
               shift rather than a ring, so a 700px-wide surface never lights
               up like a text field.

               It carries the theme's own `shadow-lg` because the composer is
               the one surface that floats: hosts that let the transcript run to
               the bottom of the window have it sitting *over* the conversation,
               and a hairline alone does not say "on top of". Opaque, for the
               same reason — text passing underneath must not show through.

               A shadow is black, though, which is most of nothing on a dark
               page. So dark mode gets a rim of the foreground instead — the
               same lift, built from the light in the theme rather than from
               its absence. */
            "rounded-2xl border bg-background px-3 pt-2.5 pb-2 shadow-lg transition-colors has-[textarea:focus]:border-ring dark:ring-1 dark:ring-foreground/10 sm:px-3.5",
            dragOver && "border-primary ring-1 ring-primary/20"
          )}
          onDragOver={(e) => {
            e.preventDefault()
            if (e.dataTransfer?.types?.includes("Files")) setDragOver(true)
          }}
          onDragLeave={(e) => {
            if (e.currentTarget.contains(e.relatedTarget as Node)) return
            setDragOver(false)
          }}
          onDrop={(e) => {
            e.preventDefault()
            setDragOver(false)
            if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files)
          }}
        >
          {hasAttachments ? (
            <div
              data-slot="chat-input-chips"
              className="mb-2 flex flex-wrap gap-1.5"
            >
              {forcedSkills.map((name) => (
                <Chip
                  key={`skill-${name}`}
                  icon={<Sparkles className="size-3.5 text-primary" />}
                  label={name}
                  accent
                  onRemove={() =>
                    updateSkills((prev) => prev.filter((s) => s !== name))
                  }
                />
              ))}
              {mentionedSkills
                .filter((name) => !forcedSkills.includes(name))
                .map((name) => (
                  <Chip
                    key={`mention-${name}`}
                    icon={<Sparkles className="size-3.5 text-primary" />}
                    label={`$${name}`}
                    title="Named in the message — removing it edits the text"
                    accent
                    onRemove={() => changeText(removeSkillMention(text, name))}
                  />
                ))}
              {pastes.map((paste) => (
                <Chip
                  key={paste.id}
                  icon={<ClipboardPaste className="size-3.5 text-primary" />}
                  label={paste.token}
                  title={paste.text.slice(0, 200)}
                  onRemove={() => removePaste(paste)}
                />
              ))}
              {pending.map((file, i) => (
                <Chip
                  key={`${file.name}-${i}`}
                  icon={
                    file.type.startsWith("image/") ? (
                      <ImageIcon className="size-3.5 text-primary" />
                    ) : (
                      <FileText className="size-3.5 text-primary" />
                    )
                  }
                  label={file.name}
                  onRemove={() =>
                    updatePending((prev) => prev.filter((_, idx) => idx !== i))
                  }
                />
              ))}
            </div>
          ) : null}

          <textarea
            ref={taRef}
            data-slot="chat-input-textarea"
            rows={1}
            value={text}
            onChange={(e) => {
              const value = e.target.value
              changeText(value)
              prunePastes(value)
              setCaret(e.target.selectionStart)
            }}
            onKeyDown={onKeyDown}
            onSelect={syncCaret}
            onClick={syncCaret}
            onPaste={onPaste}
            placeholder={resolvedPlaceholder}
            aria-label="Message"
            role="combobox"
            aria-expanded={slashOpen || skillOpen || mentionOpen}
            aria-autocomplete="list"
            aria-controls={
              slashOpen
                ? slashMenuId
                : skillOpen
                  ? skillMenuId
                  : mentionOpen
                    ? mentionMenuId
                    : undefined
            }
            aria-activedescendant={
              slashOpen
                ? `${slashMenuId}-opt-${slashSelected}`
                : skillOpen
                  ? `${skillMenuId}-opt-${skillIndex}`
                  : mentionOpen
                    ? `${mentionMenuId}-opt-${mentionIndex}`
                    : undefined
            }
            disabled={inputLocked}
            /* text-base on mobile keeps iOS from zooming the viewport on focus. */
            className="min-h-6 w-full resize-none border-0 bg-transparent py-1.5 text-base leading-relaxed text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-60 sm:text-[15px]"
          />

          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              addFiles(e.target.files)
              e.target.value = ""
            }}
          />

          <div
            data-slot="chat-input-toolbar"
            className="mt-1 flex items-end justify-between gap-2"
          >
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-0.5">
              <button
                type="button"
                title="Attach file"
                aria-label="Attach file"
                onClick={() => fileInputRef.current?.click()}
                disabled={inputLocked}
                className={cn(chatInputButtonVariants(), "px-1.5")}
              >
                <Paperclip />
              </button>
              {tools}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {isGenerating ? (
                <button
                  type="button"
                  data-slot="chat-input-stop"
                  onClick={onStop}
                  title="Stop generating"
                  className={cn(
                    chatInputButtonVariants({
                      /* Queueing keeps both actions on screen — only one of
                         them can be the primary one. */
                      variant: queueing ? "ghost" : "primary",
                    }),
                    queueing && "border"
                  )}
                >
                  <Square className="size-2.5 fill-current" />
                  <span className="text-[11px]">stop</span>
                </button>
              ) : null}
              {isGenerating && !queueing ? null : (
                <button
                  type="button"
                  data-slot="chat-input-send"
                  onClick={submit}
                  disabled={!canSend}
                  title={queueing ? "Queue (Enter)" : "Send (Enter)"}
                  className={cn(chatInputButtonVariants({ variant: "primary" }))}
                >
                  <span className="hidden text-[13px] leading-none sm:inline">↵</span>
                  <span className="text-[11px]">
                    {queueing ? "queue" : "send"}
                  </span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Chip({
  icon,
  label,
  title,
  onRemove,
  accent = false,
}: {
  icon: React.ReactNode
  label: string
  /** Hover text when the label itself is not the full story. @default label */
  title?: string
  onRemove: () => void
  accent?: boolean
}) {
  return (
    <span
      data-slot="chat-input-chip"
      className={cn(
        "inline-flex max-w-full items-center gap-2 rounded-md border px-2 py-1 text-[12px] sm:max-w-[260px]",
        accent ? "border-primary/30 bg-primary/10" : "bg-muted"
      )}
      title={title ?? label}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate text-foreground">{label}</span>
      <button
        type="button"
        onClick={onRemove}
        title="Remove"
        aria-label={`Remove ${label}`}
        className="inline-grid size-4 shrink-0 place-items-center rounded-full text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <X className="size-3" />
      </button>
    </span>
  )
}

function SlashMenu({
  menuId,
  matches,
  selectedIndex,
  onHover,
  onSelect,
}: {
  menuId: string
  matches: SlashMenuItem[]
  selectedIndex: number
  onHover: (index: number) => void
  onSelect: (item: SlashMenuItem) => void
}) {
  const listRef = React.useRef<HTMLDivElement>(null)
  const skills = matches.filter((m) => m.kind === "skill")
  const commands = matches.filter((m) => m.kind === "command")

  React.useEffect(() => {
    listRef.current
      ?.querySelector(`[data-slash-option="${selectedIndex}"]`)
      ?.scrollIntoView({ block: "nearest" })
  }, [selectedIndex, matches.length])

  return (
    <div
      id={menuId}
      data-slot="chat-input-slash-menu"
      className={menuSurfaceClass}
      role="listbox"
      aria-label="Slash commands"
    >
      <div ref={listRef} className={menuListClass}>
        <SlashGroup
          menuId={menuId}
          title="Skills"
          icon={<Sparkles className="size-3" />}
          items={skills}
          selectedIndex={selectedIndex}
          offset={0}
          onHover={onHover}
          onSelect={onSelect}
        />
        <SlashGroup
          menuId={menuId}
          title="Commands"
          icon={<Terminal className="size-3" />}
          items={commands}
          selectedIndex={selectedIndex}
          offset={skills.length}
          onHover={onHover}
          onSelect={onSelect}
        />
      </div>
    </div>
  )
}

function SlashGroup({
  menuId,
  title,
  icon,
  items,
  selectedIndex,
  offset,
  onHover,
  onSelect,
}: {
  menuId: string
  title: string
  icon: React.ReactNode
  items: SlashMenuItem[]
  selectedIndex: number
  offset: number
  onHover: (index: number) => void
  onSelect: (item: SlashMenuItem) => void
}) {
  if (items.length === 0) return null

  return (
    <div data-slot="chat-input-slash-group">
      <div className="sticky top-0 z-10 flex items-center gap-1.5 bg-popover px-3 pt-2 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {icon}
        {title}
      </div>
      <div className="grid grid-cols-[max-content_minmax(0,1fr)] px-2 pb-1">
        {items.map((item, localIndex) => {
          const index = offset + localIndex
          const selected = index === selectedIndex
          return (
            <button
              key={`${item.kind}:${item.name}`}
              id={`${menuId}-opt-${index}`}
              type="button"
              role="option"
              aria-selected={selected}
              data-slash-option={index}
              onMouseEnter={() => onHover(index)}
              onMouseDown={(e) => {
                e.preventDefault()
                onSelect(item)
              }}
              className={cn(
                menuOptionClass,
                selected ? "bg-muted" : "bg-transparent"
              )}
            >
              <span
                className={cn(
                  "whitespace-nowrap text-[12px]",
                  item.kind === "skill" ? "text-primary" : "text-foreground"
                )}
              >
                {item.kind === "skill" ? "$" : "/"}
                {item.name}
                {item.kind === "command" && item.argHint ? (
                  <span className="text-[11px] text-muted-foreground">
                    {" "}
                    {item.argHint}
                  </span>
                ) : null}
              </span>
              <span className="min-w-0 truncate pl-2 text-[11px] text-muted-foreground">
                {item.description}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function SkillMenu({
  menuId,
  items,
  selectedIndex,
  onHover,
  onSelect,
}: {
  menuId: string
  items: ChatSkill[]
  selectedIndex: number
  onHover: (index: number) => void
  onSelect: (skill: ChatSkill) => void
}) {
  const listRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    listRef.current
      ?.querySelector(`[data-skill-option="${selectedIndex}"]`)
      ?.scrollIntoView({ block: "nearest" })
  }, [selectedIndex, items.length])

  return (
    <div
      id={menuId}
      data-slot="chat-input-skill-menu"
      className={menuSurfaceClass}
      role="listbox"
      aria-label="Skills"
    >
      <div ref={listRef} className={menuListClass}>
        <div className="sticky top-0 z-10 flex items-center gap-1.5 bg-popover px-3 pt-2 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          <Sparkles className="size-3" />
          Skills
        </div>
        <div className="grid grid-cols-[max-content_minmax(0,1fr)] px-2 pb-1">
          {items.map((item, index) => {
            const selected = index === selectedIndex
            return (
              <button
                key={item.name}
                id={`${menuId}-opt-${index}`}
                type="button"
                role="option"
                aria-selected={selected}
                data-skill-option={index}
                data-scope={item.scope}
                onMouseEnter={() => onHover(index)}
                onMouseDown={(e) => {
                  e.preventDefault()
                  onSelect(item)
                }}
                className={cn(
                  menuOptionClass,
                  selected ? "bg-muted" : "bg-transparent"
                )}
              >
                <span className="whitespace-nowrap text-[12px] text-primary">
                  ${item.name}
                </span>
                <span className="flex min-w-0 items-baseline gap-2 pl-2">
                  <span className="min-w-0 truncate text-[11px] text-muted-foreground">
                    {item.description}
                  </span>
                  {item.scope ? (
                    <span className="ml-auto shrink-0 text-[10px] tracking-wide text-muted-foreground/70 uppercase">
                      {item.scope}
                    </span>
                  ) : null}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function MentionMenu({
  menuId,
  items,
  selectedIndex,
  onHover,
  onSelect,
}: {
  menuId: string
  items: ChatInputMentionItem[]
  selectedIndex: number
  onHover: (index: number) => void
  onSelect: (item: ChatInputMentionItem) => void
}) {
  const listRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    listRef.current
      ?.querySelector(`[data-mention-option="${selectedIndex}"]`)
      ?.scrollIntoView({ block: "nearest" })
  }, [selectedIndex, items.length])

  return (
    <div
      id={menuId}
      data-slot="chat-input-mention-menu"
      className={menuSurfaceClass}
      role="listbox"
      aria-label="Mentions"
    >
      <div ref={listRef} className={menuListClass}>
        <div className="grid grid-cols-[max-content_minmax(0,1fr)] px-2 py-1">
          {items.map((item, index) => {
            const selected = index === selectedIndex
            return (
              <button
                key={item.id}
                id={`${menuId}-opt-${index}`}
                type="button"
                role="option"
                aria-selected={selected}
                data-mention-option={index}
                onMouseEnter={() => onHover(index)}
                onMouseDown={(e) => {
                  e.preventDefault()
                  onSelect(item)
                }}
                className={cn(
                  menuOptionClass,
                  selected ? "bg-muted" : "bg-transparent"
                )}
              >
                <span className="flex items-center gap-1.5 font-mono text-[12px] whitespace-nowrap text-foreground">
                  {looksLikePath(item.label) ? (
                    <FileIcon path={item.label} size={13} />
                  ) : null}
                  {item.label}
                </span>
                <span className="min-w-0 truncate pl-2 text-[11px] text-muted-foreground">
                  {item.description}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
