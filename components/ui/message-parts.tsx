"use client"

import { diffLines, diffWords, type Change } from "diff"
import {
  Brain,
  Check,
  ChevronDown,
  Copy,
  FilePenLine,
  FileText,
  Globe,
  ListChecks,
  Loader2,
  Search,
  Table2,
  Terminal,
  TriangleAlert,
  Wrench,
} from "lucide-react"
import { useTheme } from "next-themes"
import * as React from "react"
import type { BundledLanguage, BundledTheme, SpecialLanguage } from "shiki"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  AskQuestion,
  AskQuestionSummary,
  formatAskQuestionOutput,
  isAskToolName,
  isOpenAskTool,
  isPendingAskTool,
  parseAskQuestionInput,
  parseAskQuestionResult,
  type AskQuestionResult,
} from "@/components/ui/ask-question"
import {
  PlanCard,
  isPlanToolName,
  parsePlan,
  type PlanData,
} from "@/components/ui/plan-card"
import {
  TodoList,
  isTodoToolName,
  parseTodoItems,
  todoProgress,
  type TodoItem,
} from "@/components/ui/todo-list"
import {
  FileContextMenu,
  formatWorkedFor,
  type FileActionItem,
} from "@/components/ui/change-summary"
import { FileIcon } from "@/components/ui/file-icon"
import { RenderErrorBoundary } from "@/components/ui/render-error-boundary"
import { commandProgramName } from "@/lib/command-label"
import { fnv1a32, LRUCache } from "@/lib/lru-cache"
import { cn } from "@/lib/utils"
import { MessageMarkdown } from "@/components/ui/message-markdown"

export type MessageToolCallData = {
  id: string
  name: string
  status?: "pending" | "running" | "done" | "error"
  input?: string
  output?: string
}

export type MessageCodeBlockData = {
  language?: string
  code: string
  title?: string
}

export type MessageArtifactData = {
  id: string
  title: string
  kind?: "file" | "table" | "chart" | "text" | string
  summary?: string
  content?: string
  onOpen?: () => void
}

export type MessageAttachmentData = {
  id: string
  name: string
  mimeType: string
  /** Thumbnail and full-size source — a `data:` URL or a remote URL. */
  url: string
}

/** Shared look for the quiet, text-only disclosure rows. */
const disclosureTrigger =
  "inline-flex max-w-full items-center gap-1.5 rounded-sm py-0.5 text-left text-[13px] leading-snug text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 [&_svg]:pointer-events-none [&_svg]:shrink-0"

export const MessageReasoning = React.memo(function MessageReasoning({
  children,
  defaultOpen = false,
  duration,
  streaming = false,
  className,
}: {
  children: string
  defaultOpen?: boolean
  duration?: number
  /** Keep the body open while this thought is still streaming in. */
  streaming?: boolean
  className?: string
}) {
  const [open, setOpen] = React.useState(defaultOpen || streaming)
  const [wasStreaming, setWasStreaming] = React.useState(streaming)

  // Adjust while rendering rather than in an effect: the disclosure never
  // paints a stale open state, and no extra commit lands mid-stream.
  if (wasStreaming !== streaming) {
    setWasStreaming(streaming)
    if (streaming) setOpen(true)
    else if (!defaultOpen) setOpen(false)
  }

  const label =
    duration == null
      ? "Thought for a few seconds"
      : `Thought for ${duration} seconds`

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      data-slot="message-reasoning"
      className={cn("mb-2 animate-in fade-in duration-150", className)}
    >
      <CollapsibleTrigger asChild>
        <button
          type="button"
          data-slot="message-reasoning-trigger"
          className={disclosureTrigger}
        >
          <Brain className="size-3.5 opacity-70" />
          <span className="min-w-0 truncate">{label}</span>
          <ChevronDown
            className={cn(
              "size-3.5 opacity-50 transition-transform duration-150",
              open && "rotate-180"
            )}
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div
          data-slot="message-reasoning-content"
          className="mt-2 border-l pl-3 text-[13px] leading-relaxed opacity-60"
        >
          <MessageMarkdown className="text-inherit! text-[13px]! leading-relaxed!">
            {children}
          </MessageMarkdown>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
})

export function parseToolArgs(input?: string): Record<string, unknown> {
  if (!input?.trim()) return {}
  try {
    const value = JSON.parse(input) as unknown
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>
    }
  } catch {
    /* raw string */
  }
  return {}
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined
}

/**
 * The harness's own notes to the model, stapled onto a tool result. They are
 * addressed to the agent, never to the person reading the transcript, and on
 * some turns they are longer than the output they trail.
 */
const SYSTEM_REMINDER_RE = /<system-reminder>[\s\S]*?<\/system-reminder>/gi
/** Colour a CLI wrote for a terminal that isn't there. */
const ANSI_RE = /\u001B\[[0-9;?]*[a-zA-Z]/g

/** Pretty-prints a payload that arrived as one long JSON line. */
function expandJson(text: string): string | null {
  const first = text[0]
  if (first !== "{" && first !== "[") return null
  if (text.length > 200_000) return null
  try {
    const value = JSON.parse(text) as unknown
    if (!value || typeof value !== "object") return null
    const pretty = JSON.stringify(value, null, 2)
    return pretty === text ? null : pretty
  } catch {
    return null
  }
}

/**
 * What a tool actually said, with everything that is not that stripped out:
 * the harness's system reminders, terminal colour codes, trailing blanks, and
 * the single-line JSON a structured tool answers with.
 */
export function cleanToolOutput(output?: string): string | undefined {
  if (!output) return undefined
  const text = output
    .replace(SYSTEM_REMINDER_RE, "")
    .replace(ANSI_RE, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  if (!text) return undefined
  return expandJson(text) ?? text
}

/** Written for the model's own benefit — never worth a row of its own. */
const NOISE_ARG_KEYS = new Set([
  "description",
  "explanation",
  "reason",
  "reasoning",
  "thought",
  "thoughts",
  "intent",
  "comment",
  "id",
  "uuid",
  "callid",
  "sessionid",
  "toolid",
  "tooluseid",
  "parenttooluseid",
])

/** Already drawn by the row: the command block, the diff, the checklist. */
const RENDERED_ARG_KEYS = new Set([
  "command",
  "cmd",
  "script",
  "content",
  "contents",
  "filetext",
  "newstring",
  "oldstring",
  "newstr",
  "oldstr",
  "newtext",
  "oldtext",
  "newcontent",
  "oldcontent",
  "patch",
  "diff",
  "edits",
  "todos",
  "items",
  "tasks",
  "steps",
  "plan",
])

export type ToolArgRow = { key: string; value: string; full: string }

function argText(value: unknown): string | undefined {
  if (value == null) return undefined
  if (typeof value === "string") return value.trim() || undefined
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value)
  }
  try {
    const json = JSON.stringify(value)
    return json && json !== "{}" && json !== "[]" ? json : undefined
  } catch {
    return undefined
  }
}

/**
 * The arguments worth reading, for a row whose body is not a diff or a file.
 * The raw JSON blob it replaces is mostly punctuation, the model's own note to
 * itself, and a repeat of what the headline already said.
 *
 * `skip` is how the row hands over the keys it draws itself — the path it put
 * in the headline, for instance, which a Grep row keeps because its headline
 * is the pattern.
 */
export function toolArgRows(
  args: Record<string, unknown>,
  skip?: Iterable<string>
): ToolArgRow[] {
  const hidden = new Set<string>()
  for (const key of skip ?? []) hidden.add(key.toLowerCase())
  const rows: ToolArgRow[] = []
  for (const [key, value] of Object.entries(args)) {
    const normalized = key.replace(/[\s_-]+/g, "").toLowerCase()
    if (NOISE_ARG_KEYS.has(normalized) || RENDERED_ARG_KEYS.has(normalized)) {
      continue
    }
    if (hidden.has(key.toLowerCase()) || hidden.has(normalized)) continue
    const text = argText(value)
    if (!text) continue
    const oneLine = text.replace(/\s+/g, " ")
    rows.push({
      key: key.replace(/[_-]+/g, " "),
      value: oneLine.length > 180 ? `${oneLine.slice(0, 179)}…` : oneLine,
      full: text,
    })
  }
  return rows
}

/** `mcp__github__list_issues` → `github · list issues`. */
function prettyToolName(name: string) {
  if (!name.startsWith("mcp__")) return name
  const [, server, ...rest] = name.split("__")
  if (!server || rest.length === 0) return name
  return `${server} · ${rest.join(" ").replace(/_+/g, " ")}`
}

function fileName(path: string) {
  const trimmed = path.replace(/[\\/]+$/, "")
  return trimmed.split(/[\\/]/).pop() || path
}

function clip(text: string, max = 48) {
  const oneLine = text.replace(/\s+/g, " ").trim()
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max - 1)}…`
}

/**
 * `/bin/zsh -lc '…'`, `cmd /c …`, `powershell -Command …` — the harness's own
 * wrapper around the command the user actually asked for. The capture is
 * everything after the flag that says “the rest is the command”.
 *
 * The name must be a shell *exactly*, or the last segment of a path — a bare
 * `deploy.sh -c prod` is a project's own script, and unwrapping it would throw
 * away everything but `prod`.
 */
const SHELL_WRAPPER_RE =
  /^(?:(?:\S*[\\/])?env(?:\.exe)?\s+(?:(?:-\S+|[A-Za-z_]\w*=\S*)\s+)*)?(?:\S*[\\/])?(?:sh|bash|zsh|ksh|dash|fish|ash|cmd|powershell|pwsh)(?:\.exe)?\s+(?:-{1,2}[a-z]+\s+)*(?:-{1,2}[a-z]*c(?:ommand)?|\/c)\s+([\s\S]+)$/i
/** `cd packages/web && …` is where the command ran, not what it did. */
const CD_PREFIX_RE = /^cd\s+(?:'[^']*'|"[^"]*"|[^\s;&|]+)\s*(?:&&|;)\s*/

/**
 * Runners whose bare name says nothing: `npm` alone is not a headline, `npm
 * test` is. The wrappers that used to be in this list — `sudo`, `env`, `time`,
 * `nohup` — are gone, because `commandProgramName` walks past them to the
 * program that actually ran rather than naming the wrapper.
 */
const COMMAND_HOSTS = new Set([
  "npx",
  "uv",
  "uvx",
  "pnpm",
  "yarn",
  "npm",
  "bun",
  "python",
  "python3",
  "node",
  "deno",
  "cargo",
  "go",
  "git",
  "docker",
  "make",
])

function unwrapShell(command: string) {
  const match = SHELL_WRAPPER_RE.exec(command.trim())
  if (!match) return command
  const rest = match[1].trim()
  const quote = rest[0]
  const quoted =
    (quote === "'" || quote === '"') && rest.length > 1 && rest.endsWith(quote)
  if (quoted) return rest.slice(1, -1).replace(/\\(['"])/g, "$1")
  return rest
}

/** The word after `program` in `display`, when it is a subcommand and not a flag. */
function subcommandOf(display: string, program: string): string | undefined {
  const words = display.split(" ")
  const index = words.findIndex(
    (word) => word.replace(/^.*[\\/]/, "").replace(/\.exe$/i, "") === program
  )
  if (index < 0) return undefined
  const next = words[index + 1]
  return next && !next.startsWith("-") ? next : undefined
}

/**
 * What the headline says a shell tool did. `display` is the command with the
 * harness's wrapper and `cd` prefix peeled off; `program` is the binary that
 * actually ran, found by the shell-aware reader in `lib/command-label` rather
 * than by taking the first word — so `sudo -u ci env CI=1 bash -lc 'npm test |
 * tee log'` is `npm`, and `if [ -f x ]; then …` is nothing at all rather than
 * "if". `label` is how the row names it: the program, plus its subcommand
 * where the program alone says nothing (`npm test`, `git status`).
 */
export function summarizeCommand(command: string): {
  display: string
  label: string
  /** Null when nothing in the command reads as a program the row can name. */
  program: string | null
} {
  let display = unwrapShell(command)
  let next = display.replace(CD_PREFIX_RE, "")
  while (next !== display) {
    display = next
    next = display.replace(CD_PREFIX_RE, "")
  }
  display = display.replace(/\s+/g, " ").trim()

  const program = commandProgramName(command) ?? commandProgramName(display)
  if (!program) return { display, label: "command", program: null }
  const second = COMMAND_HOSTS.has(program.toLowerCase())
    ? subcommandOf(display, program)
    : undefined
  return { display, label: second ? `${program} ${second}` : program, program }
}

type ToolHeadline = {
  label: string
  detail?: string
  /** Hover text for the detail — the untouched command behind a summary. */
  title?: string
}

function toolHeadline(tool: MessageToolCallData): ToolHeadline {
  const args = parseToolArgs(tool.input)
  const kind = tool.name.replace(/\s+/g, "").toLowerCase()
  const running = tool.status === "running" || tool.status === "pending"
  const failed = tool.status === "error"
  const path =
    asString(args.path) ??
    asString(args.filePath) ??
    asString(args.target_file) ??
    asString(args.file)
  const command =
    asString(args.command) ?? asString(args.cmd) ?? asString(args.script)
  const query =
    asString(args.query) ??
    asString(args.pattern) ??
    asString(args.glob) ??
    asString(args.search)

  /**
   * An MCP tool is named `mcp__<server>__<tool>`, and the words in it belong to
   * that server's vocabulary rather than to the list below — `list_issues` is
   * not a directory listing, and `write_comment` writes no file.
   */
  if (tool.name.startsWith("mcp__")) {
    return {
      label: failed ? "Failed" : running ? "Working" : "Done",
      detail: prettyToolName(tool.name),
    }
  }
  if (isTodoToolName(tool.name)) {
    const items = parseTodoItems(tool.input)
    const progress = items ? todoProgress(items) : null
    return {
      label: failed
        ? "Couldn’t update the plan"
        : running
          ? "Updating plan"
          : "Updated plan",
      detail: progress ? `${progress.completed}/${progress.total}` : undefined,
    }
  }
  if (kind.includes("shell") || kind === "bash" || kind === "command") {
    const summary = command ? summarizeCommand(command) : null
    if (!summary?.program) {
      return {
        label: failed
          ? "Command failed"
          : running
            ? "Running command"
            : "Ran command",
        // Nothing to name, but the line itself is still worth showing.
        detail: summary ? clip(summary.display) : undefined,
        title: command,
      }
    }
    return {
      label: failed
        ? `${summary.label} failed`
        : running
          ? `Running ${summary.label}`
          : `Ran ${summary.label}`,
      detail: clip(summary.display),
      // The row shows the unwrapped line; the hover keeps the original.
      title: command,
    }
  }
  if (kind.includes("read")) {
    return {
      label: failed ? "Couldn’t read" : running ? "Reading file" : "Read file",
      detail: path ? fileName(path) : undefined,
    }
  }
  if (kind.includes("write") || kind.includes("createfile")) {
    return {
      label: failed ? "Couldn’t write" : running ? "Writing file" : "Wrote file",
      detail: path ? fileName(path) : undefined,
    }
  }
  if (
    kind.includes("edit") ||
    kind.includes("applypatch") ||
    kind.includes("searchreplace") ||
    kind.includes("strreplace")
  ) {
    return {
      label: failed ? "Couldn’t edit" : running ? "Editing file" : "Edited file",
      detail: path ? fileName(path) : undefined,
    }
  }
  if (
    kind.includes("grep") ||
    kind.includes("search") ||
    kind.includes("glob")
  ) {
    return {
      label: failed
        ? "Search failed"
        : running
          ? "Searching files"
          : "Searched files",
      detail: query ? clip(query, 40) : path ? fileName(path) : undefined,
    }
  }
  if (kind.includes("delete") || kind.includes("remove")) {
    return {
      label: failed ? "Couldn’t delete" : running ? "Deleting" : "Deleted",
      detail: path ? fileName(path) : undefined,
    }
  }
  if (kind.includes("list") || kind === "ls" || kind.includes("dir")) {
    return {
      label: failed
        ? "Couldn’t list files"
        : running
          ? "Listing files"
          : "Listed files",
      detail: path ? fileName(path) : undefined,
    }
  }
  if (isAskToolName(tool.name)) {
    return {
      label: failed ? "Failed" : running ? "Asking" : "Done",
      detail: "Ask Question",
    }
  }
  // Only reached while the arguments are still streaming — a plan that has
  // fully arrived is a card, not a row.
  if (isPlanToolName(tool.name)) {
    return {
      label: failed
        ? "Couldn’t write the plan"
        : running
          ? "Writing plan"
          : "Wrote plan",
    }
  }
  return {
    label: failed ? "Failed" : running ? "Working" : "Done",
    detail: prettyToolName(tool.name),
  }
}

export type DiffSegment = { text: string; highlight: boolean }

export type ToolDiffLine = {
  type: "add" | "remove" | "context"
  text: string
  oldLine?: number
  newLine?: number
  segments?: DiffSegment[]
}

function asRawString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

export function isFileMutationTool(name: string) {
  const kind = name.replace(/\s+/g, "").toLowerCase()
  return (
    kind.includes("write") ||
    kind.includes("createfile") ||
    kind.includes("edit") ||
    kind.includes("applypatch") ||
    kind.includes("searchreplace") ||
    kind.includes("strreplace")
  )
}

function isReadTool(name: string) {
  const kind = name.replace(/\s+/g, "").toLowerCase()
  return kind.includes("read") && !kind.includes("thread")
}

function asPositiveInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value)
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const n = Number(value.trim())
    return n > 0 ? n : undefined
  }
  return undefined
}

/** Pull file body out of a Read tool's output (`N lines\\n…` or raw text). */
export function extractReadFile(
  tool: MessageToolCallData
): { content: string; lineCount?: number; startLine: number } | null {
  if (!isReadTool(tool.name) || tool.status === "error") return null
  const output = tool.output?.replace(/\r\n/g, "\n")
  if (!output?.trim()) return null

  const args = parseToolArgs(tool.input)
  const startLine = asPositiveInt(args.offset) ?? 1

  const headed = output.match(/^(\d+)\s+lines?\n([\s\S]*)$/i)
  if (headed) {
    const body = headed[2]
    if (!body.trim()) return null
    return {
      content: body.replace(/\n$/, ""),
      lineCount: Number(headed[1]),
      startLine,
    }
  }

  // Don't treat leftover JSON dumps as file content.
  if (output.trimStart().startsWith("{")) return null
  return { content: output.replace(/\n$/, ""), startLine }
}

function splitChangeLines(value: string): string[] {
  const parts = value.split("\n")
  if (parts.length > 0 && parts[parts.length - 1] === "") {
    parts.pop()
  }
  return parts
}

/**
 * Word diffing is quadratic in the length of the pair it compares, and a tool
 * hands us whatever it wrote — a minified bundle on one line, or a rewrite of
 * a thousand of them. Past either bound the chips are dropped and the row
 * renders as plain text, which is what every renderer already does when a
 * line arrives without `segments`.
 */
const MAX_WORD_DIFF_LINE_CHARS = 2000
const MAX_WORD_DIFF_PAIRS = 300

function wordSegments(
  before: string,
  after: string
): { removed: DiffSegment[]; added: DiffSegment[] } | null {
  if (
    before.length > MAX_WORD_DIFF_LINE_CHARS ||
    after.length > MAX_WORD_DIFF_LINE_CHARS
  ) {
    return null
  }
  const parts = diffWords(before, after)
  return {
    removed: parts
      .filter((part) => !part.added)
      .map((part) => ({ text: part.value, highlight: !!part.removed })),
    added: parts
      .filter((part) => !part.removed)
      .map((part) => ({ text: part.value, highlight: !!part.added })),
  }
}

export function buildDiffLines(oldText: string, newText: string): ToolDiffLine[] {
  const changes = diffLines(oldText, newText) as Change[]
  const lines: ToolDiffLine[] = []
  let oldLine = 1
  let newLine = 1
  let wordDiffPairs = 0

  for (let i = 0; i < changes.length; i++) {
    const change = changes[i]
    const next = changes[i + 1]

    if (change.removed && next?.added) {
      const removedLines = splitChangeLines(change.value)
      const addedLines = splitChangeLines(next.value)
      const count = Math.max(removedLines.length, addedLines.length)
      for (let j = 0; j < count; j++) {
        const rem = removedLines[j]
        const add = addedLines[j]
        if (rem !== undefined && add !== undefined) {
          const segments =
            wordDiffPairs++ < MAX_WORD_DIFF_PAIRS
              ? wordSegments(rem, add)
              : null
          lines.push({
            type: "remove",
            text: rem,
            oldLine: oldLine++,
            segments: segments?.removed,
          })
          lines.push({
            type: "add",
            text: add,
            newLine: newLine++,
            segments: segments?.added,
          })
        } else if (rem !== undefined) {
          lines.push({ type: "remove", text: rem, oldLine: oldLine++ })
        } else if (add !== undefined) {
          lines.push({ type: "add", text: add, newLine: newLine++ })
        }
      }
      i++
      continue
    }

    const chunkLines = splitChangeLines(change.value)
    for (const text of chunkLines) {
      if (change.added) {
        lines.push({ type: "add", text, newLine: newLine++ })
      } else if (change.removed) {
        lines.push({ type: "remove", text, oldLine: oldLine++ })
      } else {
        lines.push({
          type: "context",
          text,
          oldLine: oldLine++,
          newLine: newLine++,
        })
      }
    }
  }

  return lines
}

function looksLikeUnifiedPatch(text: string) {
  return /^(diff --git |--- |\+\+\+ |@@ )/m.test(text)
}

export function parseUnifiedPatch(patch: string): ToolDiffLine[] | null {
  if (!looksLikeUnifiedPatch(patch)) return null
  const lines: ToolDiffLine[] = []
  let oldLine = 0
  let newLine = 0

  for (const raw of patch.split("\n")) {
    if (raw.startsWith("@@")) {
      const match = raw.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
      if (match) {
        oldLine = Number(match[1])
        newLine = Number(match[2])
      }
      continue
    }
    if (
      raw.startsWith("diff ") ||
      raw.startsWith("index ") ||
      raw.startsWith("--- ") ||
      raw.startsWith("+++ ")
    ) {
      continue
    }
    if (raw.startsWith("+")) {
      lines.push({ type: "add", text: raw.slice(1), newLine: newLine++ })
    } else if (raw.startsWith("-")) {
      lines.push({ type: "remove", text: raw.slice(1), oldLine: oldLine++ })
    } else if (raw.startsWith("\\")) {
      continue
    } else {
      const text = raw.startsWith(" ") ? raw.slice(1) : raw
      lines.push({
        type: "context",
        text,
        oldLine: oldLine || undefined,
        newLine: newLine || undefined,
      })
      if (oldLine) oldLine++
      if (newLine) newLine++
    }
  }

  return lines.length > 0 ? applyWordHighlights(lines) : null
}

/** Pair adjacent remove/add rows so changed tokens get Cursor-style chips. */
function applyWordHighlights(lines: ToolDiffLine[]): ToolDiffLine[] {
  const out: ToolDiffLine[] = []
  let wordDiffPairs = 0
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const next = lines[i + 1]
    if (
      line.type === "remove" &&
      next?.type === "add" &&
      !line.segments &&
      !next.segments
    ) {
      const segments =
        wordDiffPairs++ < MAX_WORD_DIFF_PAIRS
          ? wordSegments(line.text, next.text)
          : null
      out.push({ ...line, segments: segments?.removed })
      out.push({ ...next, segments: segments?.added })
      i++
      continue
    }
    out.push(line)
  }
  return out
}

/** Build a Cursor-style unified diff from Edit / Write / ApplyPatch tool args. */
export function extractToolDiff(tool: MessageToolCallData): ToolDiffLine[] | null {
  if (!isFileMutationTool(tool.name)) return null
  const args = parseToolArgs(tool.input)

  // Cursor editToolCall result folds `diffString` into args.diff (see cursor-agent).
  const patch =
    asString(args.patch) ??
    asString(args.diff) ??
    (tool.output && looksLikeUnifiedPatch(tool.output) ? tool.output : undefined)
  if (patch) {
    const parsed = parseUnifiedPatch(patch)
    if (parsed) return parsed
  }

  const oldText =
    asRawString(args.old_string) ??
    asRawString(args.oldString) ??
    asRawString(args.old_str) ??
    asRawString(args.oldText)
  const newText =
    asRawString(args.new_string) ??
    asRawString(args.newString) ??
    asRawString(args.new_str) ??
    asRawString(args.newText)

  if (oldText !== undefined && newText !== undefined) {
    return buildDiffLines(oldText, newText)
  }

  // Cursor streams the after-file as streamContent; writeToolCall uses fileText.
  const contents =
    asRawString(args.contents) ??
    asRawString(args.content) ??
    asRawString(args.file_text) ??
    asRawString(args.fileText) ??
    asRawString(args.streamContent)

  if (contents !== undefined && oldText === undefined) {
    return buildDiffLines("", contents)
  }

  return null
}

function formatDiffStats(lines: ToolDiffLine[]) {
  let added = 0
  let removed = 0
  for (const line of lines) {
    if (line.type === "add") added++
    else if (line.type === "remove") removed++
  }
  return { added, removed }
}

/**
 * Added / removed is the one place a raw palette earns its keep — no theme
 * token carries "this line grew". Every pair below ships a dark variant or
 * an alpha blend, so a re-themed app still reads correctly.
 *
 * Props spread after `data-slot`, so a host that reuses this outside a tool
 * row — the file preview header, say — can stamp its own slot name.
 */
export function DiffStats({
  added,
  removed,
  className,
  ...props
}: React.ComponentProps<"span"> & {
  added: number
  removed: number
}) {
  if (added === 0 && removed === 0) return null
  return (
    <span
      data-slot="message-tool-stats"
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 font-mono text-[12px] tabular-nums",
        className
      )}
      {...props}
    >
      {added > 0 ? (
        <span className="text-emerald-600 dark:text-emerald-400">+{added}</span>
      ) : null}
      {removed > 0 ? (
        <span className="text-red-500 dark:text-red-400">-{removed}</span>
      ) : null}
    </span>
  )
}

export function langFromPath(path?: string) {
  if (!path) return undefined
  const base = path.split(/[\\/]/).pop() ?? path
  const ext = base.includes(".") ? base.split(".").pop()?.toLowerCase() : undefined
  if (!ext) return undefined
  if (ext === "ts") return "ts"
  if (ext === "tsx") return "tsx"
  if (ext === "js" || ext === "mjs" || ext === "cjs") return "js"
  if (ext === "jsx") return "jsx"
  if (ext === "json") return "json"
  if (ext === "css") return "css"
  if (ext === "html") return "html"
  if (ext === "md" || ext === "mdx") return "markdown"
  if (ext === "py") return "py"
  if (ext === "rs") return "rust"
  if (ext === "go") return "go"
  if (ext === "yml" || ext === "yaml") return "yaml"
  if (ext === "toml") return "toml"
  if (ext === "sql") return "sql"
  if (ext === "sh" || ext === "bash") return "bash"
  return undefined
}

/**
 * Image files an agent writes or reads — a chart it just rendered, a
 * screenshot it took. Their bytes are not text, so every text view in this
 * file has nothing to show for them; the row renders the picture instead,
 * given a URL the host can serve it from.
 */
const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "avif",
  "bmp",
  "ico",
  "svg",
])

export function isImagePath(path?: string) {
  if (!path) return false
  const base = path.split(/[\\/]/).pop() ?? path
  const ext = base.includes(".") ? base.split(".").pop()?.toLowerCase() : undefined
  return !!ext && IMAGE_EXTENSIONS.has(ext)
}

/** `1531x889 px` out of a Read tool's stand-in text, as `1531×889`. */
export function imageDimensions(output?: string) {
  const match = output?.match(/(\d+)\s*[x×]\s*(\d+)\s*px/i)
  return match ? `${match[1]}×${match[2]}` : null
}

const SHIKI_LANGS = new Set([
  "ts",
  "tsx",
  "js",
  "jsx",
  "typescript",
  "javascript",
  "json",
  "python",
  "py",
  "bash",
  "shell",
  "sh",
  "css",
  "html",
  "md",
  "markdown",
  "sql",
  "yaml",
  "yml",
  "toml",
  "rust",
  "go",
  "java",
  "c",
  "cpp",
  "text",
  "plaintext",
])

/** Everything below feeds Shiki, which only accepts languages it bundles. */
export type HighlightLang = BundledLanguage | SpecialLanguage

export function normalizeLang(lang?: string): HighlightLang {
  if (!lang) return "text"
  const l = lang.toLowerCase().trim()
  if (l === "typescript") return "ts"
  if (l === "javascript") return "js"
  if (l === "python") return "py"
  if (l === "shell" || l === "zsh") return "bash"
  return SHIKI_LANGS.has(l) ? (l as HighlightLang) : "text"
}

/**
 * Shiki is loaded once per page (module-level singleton) and every rendered
 * snippet is cached, so re-renders and remounts never re-run the highlighter.
 *
 * `shiki`'s top-level `codeToHtml` / `codeToTokens` run on the Oniguruma WASM
 * engine, which is the one to be on: the JavaScript regex engine backtracks
 * catastrophically on a few real grammars and takes the tokenizing thread with
 * it. Do not swap these for a highlighter built with
 * `createJavaScriptRegexEngine`.
 */
let shikiModule: Promise<typeof import("shiki")> | null = null

function loadShiki() {
  shikiModule ??= import("shiki")
  return shikiModule
}

/**
 * Keyed by a hash of the code rather than the code itself: a lookup should
 * compare two short strings, not re-walk a megabyte of file on every render.
 * The length beside the hash is what makes a 32-bit collision harmless.
 */
function highlightCacheKey(
  code: string,
  lang: HighlightLang,
  theme: BundledTheme
) {
  return `${fnv1a32(code).toString(36)}:${code.length}:${lang}:${theme}`
}

/**
 * Bounded by entries *and* bytes. 200 snippets of three lines each is nothing;
 * 200 renders of a four-thousand-line file is a hundred megabytes of HTML held
 * for transcripts nobody is looking at any more.
 */
const HIGHLIGHT_CACHE_MAX_ENTRIES = 500
const HIGHLIGHT_CACHE_MAX_BYTES = 50 * 1024 * 1024
const highlightCache = new LRUCache<string>(
  HIGHLIGHT_CACHE_MAX_ENTRIES,
  HIGHLIGHT_CACHE_MAX_BYTES
)

/** UTF-16 code units, doubled for bytes, against the floor the code itself sets. */
function estimateHighlightedSize(html: string, code: string) {
  return Math.max(html.length * 2, code.length * 3)
}

/**
 * `store` is false while the block is still streaming. A fence that grows by a
 * token per frame would otherwise write a hundred near-identical entries and
 * evict everything worth keeping before the final text ever arrives.
 */
async function highlight(
  code: string,
  lang: HighlightLang,
  theme: BundledTheme,
  store = true
) {
  const key = highlightCacheKey(code, lang, theme)
  const cached = highlightCache.get(key)
  if (cached !== undefined) return cached
  const { codeToHtml } = await loadShiki()
  const html = await codeToHtml(code, { lang, theme })
  if (store) {
    highlightCache.set(key, html, estimateHighlightedSize(html, code))
  }
  return html
}

export type ShikiToken = { content: string; color?: string }

const TOKEN_CACHE_MAX_ENTRIES = 500
const TOKEN_CACHE_MAX_BYTES = 50 * 1024 * 1024
const tokenCache = new LRUCache<ShikiToken[][]>(
  TOKEN_CACHE_MAX_ENTRIES,
  TOKEN_CACHE_MAX_BYTES
)

/** A token line holds the source text plus a colour per span. */
function estimateTokenSize(code: string) {
  return code.length * 8
}

/**
 * Tokens for a whole block, one line per entry. Line-gutter views (diffs, file
 * previews) used to mount one highlighter per line: a 500-line file meant 500
 * async Shiki calls, 500 `setState`s and a cache that evicted itself before it
 * could ever hit. One pass per block keeps that flat.
 */
async function highlightLines(
  code: string,
  lang: HighlightLang,
  theme: BundledTheme,
  store = true
) {
  const key = highlightCacheKey(code, lang, theme)
  const cached = tokenCache.get(key)
  if (cached !== undefined) return cached
  const { codeToTokens } = await loadShiki()
  const { tokens } = await codeToTokens(code, { lang, theme })
  const lines = tokens.map((line) =>
    line.map((token) => ({ content: token.content, color: token.color }))
  )
  if (store) tokenCache.set(key, lines, estimateTokenSize(code))
  return lines
}

/**
 * One Shiki pass for `code`, or null until it lands (and for plain text).
 *
 * `streaming` says the block is still growing: the pass still runs, so the
 * view is never left unhighlighted, but its result is not cached.
 */
export function useHighlightedLines(
  code: string,
  language?: string,
  streaming = false
) {
  const { resolvedTheme } = useTheme()
  const lang = normalizeLang(language)
  const theme = resolvedTheme === "dark" ? "github-dark" : "github-light"
  const cacheKey = highlightCacheKey(code, lang, theme)
  // Keyed by the block it belongs to, so a re-keyed view never paints the
  // previous block's tokens while its own highlight is still in flight.
  const [rendered, setRendered] = React.useState<{
    key: string
    lines: ShikiToken[][]
  } | null>(null)

  React.useEffect(() => {
    if (!code || lang === "text") return
    let cancelled = false
    highlightLines(code, lang, theme, !streaming)
      .then((lines) => {
        if (!cancelled) setRendered({ key: cacheKey, lines })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [cacheKey, code, lang, streaming, theme])

  return (
    tokenCache.get(cacheKey) ??
    (rendered?.key === cacheKey ? rendered.lines : null)
  )
}

/** One highlighted line — plain text until (or unless) its tokens arrive. */
export const CodeLine = React.memo(function CodeLine({
  text,
  tokens,
}: {
  text: string
  tokens?: ShikiToken[]
}) {
  if (!tokens || tokens.length === 0) return <>{text || "\u00a0"}</>
  return (
    <>
      {tokens.map((token, index) => (
        <span key={index} style={token.color ? { color: token.color } : undefined}>
          {token.content}
        </span>
      ))}
    </>
  )
})

/** Long outputs render behind a cap; the rest is one click away. */
const PREVIEW_LINE_CAP = 300

function ShowAllLines({
  total,
  onShowAll,
  label,
}: {
  total: number
  onShowAll: () => void
  /** Replaces the line count, for a body cut short by length rather than lines. */
  label?: string
}) {
  return (
    <button
      type="button"
      data-slot="message-tool-show-all"
      onClick={onShowAll}
      className="w-full border-t border-border/50 bg-muted/40 py-1 text-center text-[12px] text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      {label ?? `Show all ${total.toLocaleString()} lines`}
    </button>
  )
}

/** How much of a plain output a row shows before it offers the rest. */
const OUTPUT_LINE_CAP = 24
const OUTPUT_CHAR_CAP = 4_000

/**
 * Plain tool text — an output with no structure to draw, or an argument the
 * tool passed whole. Capped rather than dumped: a build log is thousands of
 * lines, and a row that pastes all of them buries the turn around it.
 */
const ToolText = React.memo(function ToolText({
  text,
  tone,
}: {
  text: string
  tone?: "error"
}) {
  const [showAll, setShowAll] = React.useState(false)
  const lines = React.useMemo(() => text.split("\n"), [text])
  const capped =
    !showAll &&
    (lines.length > OUTPUT_LINE_CAP || text.length > OUTPUT_CHAR_CAP)
  const visible = capped
    ? lines.slice(0, OUTPUT_LINE_CAP).join("\n").slice(0, OUTPUT_CHAR_CAP)
    : text
  const showAllLines = React.useCallback(() => setShowAll(true), [])

  return (
    <div
      data-slot="message-tool-text"
      className="overflow-hidden rounded-md border border-border/60 bg-muted/30"
    >
      <pre
        className={cn(
          "m-0 max-h-[min(22rem,55vh)] overflow-auto px-2 py-1.5 font-mono text-[12px] leading-relaxed break-words whitespace-pre-wrap",
          tone === "error" ? "text-destructive" : "text-muted-foreground"
        )}
      >
        {visible}
      </pre>
      {capped ? (
        <ShowAllLines
          total={lines.length}
          onShowAll={showAllLines}
          label={
            lines.length > OUTPUT_LINE_CAP ? undefined : "Show the whole output"
          }
        />
      ) : null}
    </div>
  )
})

const ToolDiff = React.memo(function ToolDiff({
  lines,
  language,
  streaming = false,
}: {
  lines: ToolDiffLine[]
  language?: string
  /** The tool is still writing — highlight, but keep it out of the cache. */
  streaming?: boolean
}) {
  const [showAll, setShowAll] = React.useState(false)
  const capped = !showAll && lines.length > PREVIEW_LINE_CAP
  const visible = capped ? lines.slice(0, PREVIEW_LINE_CAP) : lines
  // One highlight pass for the visible block; the gutter reads it per line.
  const source = React.useMemo(
    () => visible.map((line) => line.text).join("\n"),
    [visible]
  )
  const highlighted = useHighlightedLines(source, language, streaming)
  const showAllLines = React.useCallback(() => setShowAll(true), [])

  return (
    <div
      data-slot="message-tool-diff"
      className="max-h-[min(22rem,55vh)] overflow-auto rounded-md border border-border/60 bg-muted/30 font-mono text-[12.5px] leading-[1.7]"
    >
      {visible.map((line, index) => {
        const lineNo =
          line.type === "remove"
            ? line.oldLine
            : (line.newLine ?? line.oldLine)
        return (
          <div
            key={index}
            data-slot="message-tool-diff-line"
            data-type={line.type}
            className={cn(
              "flex",
              line.type === "add" && "bg-emerald-500/10",
              line.type === "remove" && "bg-red-500/10"
            )}
          >
            <span className="w-9 shrink-0 select-none border-r border-border/50 pr-2 text-right text-[11px] tabular-nums text-muted-foreground/45">
              {lineNo ?? ""}
            </span>
            <span
              className={cn(
                "w-5 shrink-0 select-none text-center",
                line.type === "add" &&
                  "text-emerald-600/80 dark:text-emerald-400/80",
                line.type === "remove" && "text-red-500/80 dark:text-red-400/80",
                line.type === "context" && "text-muted-foreground/40"
              )}
            >
              {line.type === "add" ? "+" : line.type === "remove" ? "-" : " "}
            </span>
            <span className="min-w-0 flex-1 break-words whitespace-pre-wrap px-1 text-foreground/90">
              {line.segments ? (
                line.segments.map((segment, segmentIndex) => (
                  <span
                    key={segmentIndex}
                    className={cn(
                      segment.highlight &&
                        (line.type === "add"
                          ? "rounded-[2px] bg-emerald-500/25"
                          : "rounded-[2px] bg-red-500/25")
                    )}
                  >
                    {segment.text}
                  </span>
                ))
              ) : (
                <CodeLine text={line.text} tokens={highlighted?.[index]} />
              )}
            </span>
          </div>
        )
      })}
      {capped ? (
        <ShowAllLines total={lines.length} onShowAll={showAllLines} />
      ) : null}
    </div>
  )
})

/** Same chrome as ToolDiff, for Read — line gutter + Shiki, no +/- column. */
const ToolFileView = React.memo(function ToolFileView({
  content,
  language,
  startLine = 1,
  streaming = false,
}: {
  content: string
  language?: string
  startLine?: number
  /** The tool is still writing — highlight, but keep it out of the cache. */
  streaming?: boolean
}) {
  const [showAll, setShowAll] = React.useState(false)
  const lines = React.useMemo(
    () => (content.length === 0 ? [""] : content.split("\n")),
    [content]
  )
  const capped = !showAll && lines.length > PREVIEW_LINE_CAP
  const visible = capped ? lines.slice(0, PREVIEW_LINE_CAP) : lines
  const source = React.useMemo(() => visible.join("\n"), [visible])
  const highlighted = useHighlightedLines(source, language, streaming)
  const showAllLines = React.useCallback(() => setShowAll(true), [])

  return (
    <div
      data-slot="message-tool-file"
      className="max-h-[min(22rem,55vh)] overflow-auto rounded-md border border-border/60 bg-muted/30 font-mono text-[12.5px] leading-[1.7]"
    >
      {visible.map((text, index) => (
        <div key={index} data-slot="message-tool-file-line" className="flex">
          <span className="w-9 shrink-0 select-none border-r border-border/50 pr-2 text-right text-[11px] tabular-nums text-muted-foreground/45">
            {startLine + index}
          </span>
          <span className="min-w-0 flex-1 break-words whitespace-pre-wrap px-2 text-foreground/90">
            <CodeLine text={text} tokens={highlighted?.[index]} />
          </span>
        </div>
      ))}
      {capped ? (
        <ShowAllLines total={lines.length} onShowAll={showAllLines} />
      ) : null}
    </div>
  )
})

/**
 * The picture itself, for a tool row that touched an image. Kept inside the
 * row's own box so a tall render cannot push the conversation around, and
 * `loading="lazy"` so a transcript full of charts still opens instantly.
 */
const ToolImageView = React.memo(function ToolImageView({
  src,
  alt,
}: {
  src: string
  alt: string
}) {
  /**
   * Tied to the source that failed: a row that swaps in another image (a
   * re-run writing the same chart to a new path) must get a fresh try rather
   * than inherit the last one's error.
   */
  const [failedSrc, setFailedSrc] = React.useState<string | null>(null)
  const fail = React.useCallback(() => setFailedSrc(src), [src])

  if (failedSrc === src) {
    return (
      <p
        data-slot="message-tool-image-error"
        className="py-1 text-[12px] text-muted-foreground"
      >
        That image could not be loaded.
      </p>
    )
  }

  return (
    <div
      data-slot="message-tool-image"
      className="overflow-hidden rounded-md border border-border/60 bg-muted/30 p-1.5"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- a local path served by the host, not an optimizable asset */}
      <img
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        onError={fail}
        className="max-h-[min(22rem,55vh)] w-auto max-w-full rounded-sm object-contain"
      />
    </div>
  )
})

/** Single Cursor-style tool row — no card chrome. */
export const MessageToolCall = React.memo(function MessageToolCall({
  tool,
  defaultOpen = false,
  onAskAnswer,
  onPlanBuild,
  onPlanOpen,
  onOpenFile,
  fileActions,
  resolveFileUrl,
  className,
}: {
  tool: MessageToolCallData
  defaultOpen?: boolean
  /**
   * Called when an Ask Question tool is submitted or skipped. Takes the tool
   * id first so the same handler can be shared by every row in a turn.
   */
  onAskAnswer?: (toolId: string, result: AskQuestionResult) => void
  /**
   * Offers the plan card its Build button. Takes the tool id first, like
   * `onAskAnswer`, so one stable handler serves every row in a turn. Hand it
   * only to the newest plan in a thread — an older one is history, and a
   * button on it would build a plan the conversation has already moved past.
   */
  onPlanBuild?: (toolId: string) => void
  /**
   * The host shows this plan somewhere with more room — a side panel. Given,
   * the row collapses to its header and that header is the way back to it,
   * rather than repeating a document already open beside the transcript.
   */
  onPlanOpen?: (toolId: string) => void
  /**
   * Opt in to “click the headline to open the file” — the row splits into an
   * open button and a separate chevron. Only fires for Edit / Write / Read
   * rows that carry a path; without it the header stays one disclosure.
   */
  onOpenFile?: (tool: MessageToolCallData) => void
  /**
   * Right-click menu for a row that names a file — same actions as the
   * change-summary card. Keep the array stable: the row is memoized.
   */
  fileActions?: FileActionItem[]
  /**
   * Turns a path the tool names into a URL this page can load — the one thing
   * a component cannot work out on its own, since only the host knows how the
   * machine's files reach the browser. Where it answers for an image, the row
   * shows the picture instead of the bytes.
   */
  resolveFileUrl?: (path: string) => string | undefined
  className?: string
}) {
  const [open, setOpen] = React.useState(defaultOpen)
  const [askResult, setAskResult] = React.useState<AskQuestionResult | null>(
    null
  )
  const ask = React.useMemo(
    () => (isAskToolName(tool.name) ? parseAskQuestionInput(tool.input) : null),
    [tool.name, tool.input]
  )
  const parsedAsk = React.useMemo(
    () => parseAskQuestionResult(tool.output),
    [tool.output]
  )
  const resolvedAsk = askResult ?? parsedAsk
  const displayTool = React.useMemo((): MessageToolCallData => {
    if (!askResult) return tool
    return {
      ...tool,
      status: "done",
      output: formatAskQuestionOutput(askResult),
    }
  }, [askResult, tool])
  const status = displayTool.status ?? "done"
  const running = status === "running" || status === "pending"
  const errored = status === "error"
  /**
   * An editing tool rewrites its args on every streamed chunk, and both derived
   * views below re-parse the whole payload. Deferring them lets React drop the
   * intermediate states instead of diffing a file once per chunk.
   */
  const deferredTool = React.useDeferredValue(displayTool)
  const diff = React.useMemo(() => extractToolDiff(deferredTool), [deferredTool])
  const showDiff = !!diff && diff.length > 0
  const readFile = React.useMemo(
    () => extractReadFile(deferredTool),
    [deferredTool]
  )
  const showFile = !!readFile
  /**
   * A plan the agent rewrote. The same list is usually shown above the
   * composer; the row keeps it too so an old turn still says what the plan
   * was at that point in the thread.
   */
  const todos = React.useMemo<TodoItem[] | null>(
    () =>
      isTodoToolName(deferredTool.name)
        ? parseTodoItems(deferredTool.input)
        : null,
    [deferredTool]
  )
  const showTodos = !!todos && todos.length > 0
  /**
   * A plan the agent wrote out. Null while the arguments are still streaming,
   * so the row stays a row until the whole plan has landed and can be drawn in
   * one piece.
   */
  const plan = React.useMemo<PlanData | null>(
    () =>
      isPlanToolName(deferredTool.name)
        ? parsePlan(deferredTool.input)
        : null,
    [deferredTool]
  )
  /**
   * An ask the agent closed without a selection is still the user's to answer,
   * but only where the owner says so: `onAskAnswer` is the signal that this row
   * is the live one. Without it an ask from an old turn would reopen on reload.
   */
  const askOpen =
    !!ask &&
    !askResult &&
    (running || (!!onAskAnswer && isOpenAskTool(tool)))
  const showAskSummary = !!ask && !!resolvedAsk && !askOpen && !running
  const headline = toolHeadline(displayTool)
  const args = React.useMemo(
    () => parseToolArgs(displayTool.input),
    [displayTool.input]
  )

  const answerAsk = React.useCallback(
    (result: AskQuestionResult) => {
      setAskResult(result)
      onAskAnswer?.(tool.id, result)
    },
    [onAskAnswer, tool.id]
  )

  const skipAsk = React.useCallback(() => {
    answerAsk({ skipped: true, answers: {} })
  }, [answerAsk])

  const openFile = React.useCallback(() => {
    onOpenFile?.(tool)
  }, [onOpenFile, tool])

  const buildPlan = React.useCallback(() => {
    onPlanBuild?.(tool.id)
  }, [onPlanBuild, tool.id])

  const openPlanPanel = React.useCallback(() => {
    onPlanOpen?.(tool.id)
  }, [onPlanOpen, tool.id])

  if (plan) {
    return (
      <PlanCard
        plan={plan}
        onBuild={onPlanBuild ? buildPlan : undefined}
        /* Shown elsewhere: the row says a plan was written and where in the
           thread, and hands the reader back to where it can be read. */
        compact={!!onPlanOpen}
        onOpen={onPlanOpen ? openPlanPanel : undefined}
        busy={running}
        className={className}
      />
    )
  }

  if (ask && askOpen) {
    return (
      <AskQuestion
        title={ask.title}
        questions={ask.questions}
        onSubmit={answerAsk}
        onSkip={skipAsk}
        className={className}
      />
    )
  }

  const path =
    asString(args.path) ??
    asString(args.filePath) ??
    asString(args.target_file) ??
    asString(args.file)
  const language = langFromPath(path)
  /**
   * An image has no text body worth printing — a Read of one hands back a
   * stand-in line like `image/png image, 1531x889 px`. Given a URL for it, the
   * row shows the picture in place of that.
   */
  const imagePath = path && isImagePath(path) ? path : undefined
  const imageSrc =
    imagePath && !errored && !running
      ? resolveFileUrl?.(imagePath)
      : undefined
  const showImage = !!imageSrc
  /**
   * The body is built from what the tool was *asked* and what it *said* —
   * never from the raw argument blob, which is mostly punctuation, the model's
   * own note to itself, and a repeat of the headline.
   */
  const commandText = (() => {
    const raw =
      asString(args.command) ?? asString(args.cmd) ?? asString(args.script)
    return raw ? unwrapShell(raw).trim() : undefined
  })()
  /* The path already sits in the headline whenever that is what it says. */
  const pathKey = ["path", "filePath", "target_file", "file"].find(
    (key) => asString(args[key]) && asString(args[key]) === path
  )
  const skipArgs =
    pathKey && path && headline.detail === fileName(path) ? [pathKey] : undefined
  const argRows = toolArgRows(args, skipArgs)
  /** An argument string the tool passed whole, rather than as JSON. */
  const rawInput =
    Object.keys(args).length === 0 ? displayTool.input?.trim() : undefined
  const outputText = cleanToolOutput(displayTool.output)
  const showOutput =
    !!outputText &&
    (errored ||
      (!showDiff && !showFile && !showImage && !showTodos && !showAskSummary))
  const hasBody =
    showDiff ||
    showFile ||
    showTodos ||
    showImage ||
    showAskSummary ||
    !!commandText ||
    argRows.length > 0 ||
    !!rawInput ||
    showOutput
  const stats = showDiff ? formatDiffStats(diff) : null
  const readMeta = showImage
    ? imageDimensions(displayTool.output)
    : showFile && readFile.lineCount != null
      ? `${readFile.lineCount} lines`
      : showFile
        ? `${readFile.content.split("\n").length} lines`
        : null
  const shortOutput =
    !ask &&
    !showTodos &&
    !stats &&
    !readMeta &&
    outputText &&
    outputText.length < 28 &&
    !outputText.includes("\n") &&
    !/^[+\d\s−-]+$/.test(outputText)
      ? outputText
      : null

  /**
   * The headline only becomes an “open the file” button where the owner asked
   * for it and the row actually points at a file — otherwise the markup below
   * is the plain disclosure it has always been.
   */
  const openable =
    !!onOpenFile &&
    !!path &&
    (isFileMutationTool(displayTool.name) || isReadTool(displayTool.name))

  /**
   * A row that names a file answers a right-click whether or not the host can
   * open it — a Grep or Shell row carries the same menu as an Edit.
   */
  const menuPath = path && fileActions?.length ? path : undefined

  const chevron = hasBody ? (
    <ChevronDown
      className={cn(
        "size-3 opacity-0 transition-[opacity,transform] duration-150 group-hover:opacity-40",
        open && "rotate-180 opacity-40"
      )}
    />
  ) : null

  /**
   * The file-type glyph only belongs next to a detail that *is* the file name —
   * a Grep row whose detail is the pattern, or a Shell row, keeps its plain
   * headline.
   */
  const iconPath =
    path && headline.detail === fileName(path) ? path : undefined

  const headlineContent = (
    <>
      {running ? (
        <Loader2 className="size-3 animate-spin opacity-70" />
      ) : errored ? (
        <TriangleAlert className="size-3 text-destructive" />
      ) : null}
      <span className="shrink-0">{headline.label}</span>
      {iconPath ? <FileIcon path={iconPath} size={14} /> : null}
      {headline.detail ? (
        <span
          className={cn(
            "min-w-0 truncate font-mono text-[12px] font-medium",
            errored ? "text-destructive" : "text-foreground/90"
          )}
          title={headline.title ?? headline.detail}
        >
          {headline.detail}
        </span>
      ) : null}
      {stats ? (
        <DiffStats added={stats.added} removed={stats.removed} />
      ) : readMeta ? (
        <span className="shrink-0 text-[12px] text-muted-foreground">
          {readMeta}
        </span>
      ) : shortOutput ? (
        <span className="shrink-0 text-[12px] text-muted-foreground">
          {shortOutput}
        </span>
      ) : null}
    </>
  )

  /**
   * One node either way, so the context menu wraps it once: an openable row is
   * a headline button plus its own chevron, everything else is the plain
   * disclosure it has always been.
   */
  const header = openable ? (
    <div
      data-slot="message-tool-call-header"
      className="flex min-w-0 items-center gap-1"
    >
      <button
        type="button"
        data-slot="message-tool-call-trigger"
        data-action="open-file"
        onClick={openFile}
        title={path}
        className={cn(disclosureTrigger, "min-w-0 cursor-pointer py-[3px]")}
      >
        {headlineContent}
      </button>
      {hasBody ? (
        <CollapsibleTrigger asChild>
          <button
            type="button"
            data-slot="message-tool-call-chevron"
            aria-label={open ? "Hide tool details" : "Show tool details"}
            className={cn(
              disclosureTrigger,
              "cursor-pointer px-0.5 py-[3px]",
              // The glyph is hover-revealed; keyboard focus has to show it too.
              "focus-visible:[&_svg]:opacity-60"
            )}
          >
            {chevron}
          </button>
        </CollapsibleTrigger>
      ) : null}
    </div>
  ) : (
    <CollapsibleTrigger asChild>
      <button
        type="button"
        data-slot="message-tool-call-trigger"
        disabled={!hasBody}
        className={cn(
          disclosureTrigger,
          "py-[3px]",
          hasBody
            ? "cursor-pointer"
            : "cursor-default hover:text-muted-foreground"
        )}
      >
        {headlineContent}
        {chevron}
      </button>
    </CollapsibleTrigger>
  )

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      data-slot="message-tool-call"
      data-status={status}
      data-tool-id={tool.id}
      className={cn("group animate-in fade-in duration-150", className)}
    >
      {menuPath ? (
        <FileContextMenu path={menuPath} actions={fileActions}>
          {header}
        </FileContextMenu>
      ) : (
        header
      )}
      {hasBody ? (
        <CollapsibleContent>
          <div
            data-slot="message-tool-call-body"
            className="mb-1.5 ml-0.5 space-y-1.5 border-l border-border/70 pl-3"
          >
            {showAskSummary && ask && resolvedAsk ? (
              <AskQuestionSummary
                questions={ask.questions}
                result={resolvedAsk}
              />
            ) : null}
            {showTodos && todos ? (
              <TodoList items={todos} running={running} className="py-1" />
            ) : null}
            {showImage && imageSrc ? (
              <ToolImageView
                src={imageSrc}
                alt={path ? fileName(path) : "Image"}
              />
            ) : null}
            {showDiff ? (
              <ToolDiff lines={diff} language={language} streaming={running} />
            ) : null}
            {showFile && readFile && !showImage ? (
              <ToolFileView
                content={readFile.content}
                language={language}
                startLine={readFile.startLine}
                streaming={running}
              />
            ) : null}
            {commandText ? (
              <pre
                data-slot="message-tool-command"
                className="m-0 overflow-x-auto rounded-md border border-border/60 bg-muted/30 px-2 py-1.5 font-mono text-[12.5px] leading-relaxed break-words whitespace-pre-wrap text-foreground/90"
              >
                {commandText}
              </pre>
            ) : null}
            {argRows.length > 0 ? (
              <dl
                data-slot="message-tool-args"
                className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5 py-0.5 text-[12px] leading-relaxed"
              >
                {argRows.map((row) => (
                  <React.Fragment key={row.key}>
                    <dt className="text-muted-foreground/70">{row.key}</dt>
                    <dd
                      className="min-w-0 font-mono break-words text-foreground/80"
                      title={row.full === row.value ? undefined : row.full}
                    >
                      {row.value}
                    </dd>
                  </React.Fragment>
                ))}
              </dl>
            ) : null}
            {rawInput ? <ToolText text={rawInput} /> : null}
            {showOutput && outputText ? (
              <ToolText text={outputText} tone={errored ? "error" : undefined} />
            ) : null}
          </div>
        </CollapsibleContent>
      ) : null}
    </Collapsible>
  )
})

// Adapted from T3 Code (github.com/pingdotgg/t3code), MIT License, (c) 2026 T3 Tools Inc.
/** What a call did, in the words the group summary is written in. */
export type ToolGroupAction =
  | "read"
  | "edit"
  | "command"
  | "search"
  | "browser"
  | "plan"
  | "other"

const BROWSER_TOOL_RE = /browser|playwright|puppeteer|navigate|screenshot/
const COMMAND_TOOL_RE = /shell|bash|terminal|command|exec|process/
const SEARCH_TOOL_RE = /grep|search|glob|find|ripgrep|list|dir/

/**
 * One call, classified. Deliberately coarse: the summary above a folded group
 * answers “what did it spend that time on”, and six buckets say that better
 * than twenty tool names would.
 */
export function toolGroupAction(tool: MessageToolCallData): ToolGroupAction {
  if (isTodoToolName(tool.name) || isPlanToolName(tool.name)) return "plan"
  /* An MCP tool's words belong to its server's vocabulary, not to the list
     below — `list_issues` is not a directory listing. */
  if (tool.name.startsWith("mcp__") || isAskToolName(tool.name)) return "other"
  const kind = tool.name.replace(/\s+/g, "").toLowerCase()
  if (BROWSER_TOOL_RE.test(kind)) return "browser"
  if (isFileMutationTool(tool.name)) return "edit"
  if (isReadTool(tool.name)) return "read"
  if (COMMAND_TOOL_RE.test(kind) || kind === "ls") return "command"
  if (SEARCH_TOOL_RE.test(kind)) return "search"
  return "other"
}

function toolPath(tool: MessageToolCallData): string | undefined {
  const args = parseToolArgs(tool.input)
  return (
    asString(args.path) ??
    asString(args.filePath) ??
    asString(args.target_file) ??
    asString(args.file)
  )
}

/**
 * Four edits to one file are one changed file, which is what a reader counts.
 * An edit whose path never arrived counts on its own — dropping it would say
 * a turn changed nothing.
 */
function toolGroupActionCount(
  action: ToolGroupAction,
  tools: readonly MessageToolCallData[]
) {
  if (action !== "edit") return tools.length
  const paths = new Set<string>()
  let pathless = 0
  for (const tool of tools) {
    const path = toolPath(tool)
    if (path) paths.add(path)
    else pathless += 1
  }
  return paths.size + pathless
}

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`
}

function toolGroupActionLabel(action: ToolGroupAction, count: number) {
  switch (action) {
    case "read":
      return `Read ${plural(count, "file", "files")}`
    case "edit":
      return `Changed ${plural(count, "file", "files")}`
    case "command":
      return `Ran ${plural(count, "command", "commands")}`
    case "search":
      return `Searched ${plural(count, "time", "times")}`
    case "browser":
      return `Used the browser ${plural(count, "time", "times")}`
    case "plan":
      return `Updated the plan ${plural(count, "time", "times")}`
    default:
      return `Used ${plural(count, "tool", "tools")}`
  }
}

/**
 * A harness that publishes a “started” marker without an id and then the call
 * itself leaves two rows for one piece of work. The marker is dropped only
 * when a later entry of the same name actually settled — an in-flight call
 * keeps its row, because that is the one the reader is watching.
 */
function omitSupersededMarkers(
  tools: readonly MessageToolCallData[]
): MessageToolCallData[] {
  const settled = new Set<string>()
  const kept: MessageToolCallData[] = []
  for (let index = tools.length - 1; index >= 0; index -= 1) {
    const tool = tools[index]
    const identity = tool.name
    const marker = !tool.id && (!tool.status || tool.status === "pending")
    if (marker && settled.has(identity)) continue
    kept.push(tool)
    if (tool.status === "done" || tool.status === "error") settled.add(identity)
  }
  return kept.reverse()
}

/** “Read 3 files, ran 2 commands, and changed 1 file.” */
export function summarizeToolGroup(
  tools: readonly MessageToolCallData[]
): string {
  const grouped = new Map<ToolGroupAction, MessageToolCallData[]>()
  for (const tool of omitSupersededMarkers(tools)) {
    const action = toolGroupAction(tool)
    const group = grouped.get(action)
    if (group) group.push(tool)
    else grouped.set(action, [tool])
  }
  const labels = [...grouped].map(([action, actionTools]) =>
    toolGroupActionLabel(action, toolGroupActionCount(action, actionTools))
  )
  // Only the first clause keeps its capital — the rest are mid-sentence.
  const parts = labels.map((label, index) =>
    index === 0 ? label : label.charAt(0).toLowerCase() + label.slice(1)
  )
  if (parts.length < 2) return parts[0] ?? ""
  if (parts.length === 2) return parts.join(" and ")
  return `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)}`
}

/** The one thing the whole group did, or "mixed" when it did several. */
export function toolGroupSummaryKind(
  tools: readonly MessageToolCallData[]
): ToolGroupAction | "mixed" {
  const actions = new Set(omitSupersededMarkers(tools).map(toolGroupAction))
  if (actions.size !== 1) return "mixed"
  return actions.values().next().value ?? "mixed"
}

const TOOL_GROUP_ICONS: Record<
  ToolGroupAction | "mixed",
  React.ComponentType<{ className?: string }>
> = {
  read: FileText,
  edit: FilePenLine,
  command: Terminal,
  search: Search,
  browser: Globe,
  plan: ListChecks,
  other: Wrench,
  mixed: Wrench,
}

/** Stack of minimal tool rows; collapses behind “Used N tools” when many. */
export function MessageToolCalls({
  tools,
  className,
  collapseAt = 3,
  defaultOpen,
  onAskAnswer,
  onPlanBuild,
  onPlanOpen,
  onOpenFile,
  fileActions,
  resolveFileUrl,
}: {
  tools: MessageToolCallData[]
  className?: string
  /** Collapse the list behind a summary when tool count ≥ this. */
  collapseAt?: number
  defaultOpen?: boolean
  onAskAnswer?: (toolId: string, result: AskQuestionResult) => void
  /** Forwarded to every row — see `MessageToolCall`. */
  onPlanBuild?: (toolId: string) => void
  /**
   * The host shows this plan somewhere with more room — a side panel. Given,
   * the row collapses to its header and that header is the way back to it,
   * rather than repeating a document already open beside the transcript.
   */
  onPlanOpen?: (toolId: string) => void
  /** Forwarded to every row — see `MessageToolCall`. */
  onOpenFile?: (tool: MessageToolCallData) => void
  /** Forwarded to every row — see `MessageToolCall`. */
  fileActions?: FileActionItem[]
  resolveFileUrl?: (path: string) => string | undefined
}) {
  const pendingAsk = tools.some(
    (tool) => isPendingAskTool(tool) || (!!onAskAnswer && isOpenAskTool(tool))
  )
  const many = !pendingAsk && tools.length >= collapseAt
  const [open, setOpen] = React.useState(defaultOpen ?? !many)
  /* Only worth computing for a group that actually folds — and only when the
     calls change, never on the tokens streaming beside them. */
  const summary = React.useMemo(
    () => (many ? summarizeToolGroup(tools) : ""),
    [many, tools]
  )
  const summaryKind = React.useMemo(
    () => (many ? toolGroupSummaryKind(tools) : "mixed"),
    [many, tools]
  )

  if (tools.length === 0) return null

  // One shared handler, so the memoized rows keep their render while a
  // sibling part of the same turn streams.
  const list = (
    <div data-slot="message-tool-list" className="flex flex-col">
      {tools.map((tool) => (
        <MessageToolCall
          key={tool.id}
          tool={tool}
          onAskAnswer={onAskAnswer}
          onPlanBuild={onPlanBuild}
          onPlanOpen={onPlanOpen}
          onOpenFile={onOpenFile}
          fileActions={fileActions}
          resolveFileUrl={resolveFileUrl}
        />
      ))}
    </div>
  )

  if (!many) {
    return (
      <div data-slot="message-tool-calls" className={cn("mb-3", className)}>
        {list}
      </div>
    )
  }

  const SummaryIcon = TOOL_GROUP_ICONS[summaryKind]

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      data-slot="message-tool-calls"
      className={cn("mb-3 animate-in fade-in duration-150", className)}
    >
      <CollapsibleTrigger asChild>
        <button
          type="button"
          data-slot="message-tool-calls-trigger"
          data-kind={summaryKind}
          className={cn(disclosureTrigger, "w-full")}
        >
          <SummaryIcon className="size-3.5 opacity-70" />
          <span className="min-w-0 truncate">{summary}</span>
          <ChevronDown
            className={cn(
              "size-3.5 opacity-50 transition-transform duration-150",
              open && "rotate-180"
            )}
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>{list}</CollapsibleContent>
    </Collapsible>
  )
}

export type MessageProcessProps = {
  /** The chronological thinking / tool stack for one turn. */
  children: React.ReactNode
  /** Elapsed seconds — becomes the “Worked for 12s” trigger label. */
  seconds?: number
  /** Overrides the derived label. */
  label?: React.ReactNode
  /**
   * True while the turn is still streaming: the stack stays open and the
   * trigger is withheld, so live parts read exactly as a flat stack. When it
   * flips to false the group folds into the labelled row.
   */
  streaming?: boolean
  /** Keep the stack expanded after the turn settles. */
  defaultOpen?: boolean
  className?: string
}

/**
 * Everything the turn did before it answered, behind one “Worked for 12s”
 * disclosure — the shape a finished agent turn settles into.
 *
 * Not memoized on purpose: `children` is a fresh element tree on every render
 * of the turn, so a memo boundary here would never hit. The rows inside it are
 * the memoized ones.
 */
export function MessageProcess({
  children,
  seconds,
  label,
  streaming = false,
  defaultOpen = false,
  className,
}: MessageProcessProps) {
  const [open, setOpen] = React.useState(defaultOpen || streaming)
  const [wasStreaming, setWasStreaming] = React.useState(streaming)

  // Adjusted while rendering rather than in an effect — the group never paints
  // one frame of an expanded stack after the turn has already settled.
  if (wasStreaming !== streaming) {
    setWasStreaming(streaming)
    if (streaming) setOpen(true)
    else if (!defaultOpen) setOpen(false)
  }

  const text =
    label ?? (seconds == null ? "Worked for a while" : formatWorkedFor(seconds))

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      data-slot="message-process"
      className={cn("mb-3 animate-in fade-in duration-150", className)}
    >
      {streaming ? null : (
        <CollapsibleTrigger asChild>
          <button
            type="button"
            data-slot="message-process-trigger"
            className={disclosureTrigger}
          >
            <span className="min-w-0 truncate">{text}</span>
            <ChevronDown
              className={cn(
                "size-3.5 opacity-50 transition-transform duration-150",
                open && "rotate-180"
              )}
            />
          </button>
        </CollapsibleTrigger>
      )}
      <CollapsibleContent data-slot="message-process-content">
        <div className={cn(streaming ? null : "mt-1.5")}>{children}</div>
      </CollapsibleContent>
    </Collapsible>
  )
}

/** What a block that could not be drawn falls back to: the text, unstyled. */
function CodeFallback({ code }: { code: string }) {
  return (
    <pre
      data-slot="message-code-fallback"
      className="m-0 overflow-x-auto bg-muted px-3.5 py-3 font-mono text-[12.5px] leading-[1.55] whitespace-pre-wrap text-foreground"
    >
      <code>{code}</code>
    </pre>
  )
}

function HighlightedCode({
  code,
  language,
  streaming = false,
}: {
  code: string
  language?: string
  /** The fence is still growing — highlight it, but do not cache the result. */
  streaming?: boolean
}) {
  const { resolvedTheme } = useTheme()
  const lang = normalizeLang(language)
  const theme = resolvedTheme === "dark" ? "github-dark" : "github-light"
  const cacheKey = highlightCacheKey(code, lang, theme)
  const [rendered, setRendered] = React.useState<{
    key: string
    html: string
  } | null>(null)

  React.useEffect(() => {
    let cancelled = false
    highlight(code, lang, theme, !streaming)
      .then((out) => {
        if (!cancelled) setRendered({ key: cacheKey, html: out })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [cacheKey, code, lang, streaming, theme])

  // Paint straight from cache when we have it — no flash of unhighlighted code.
  const html =
    highlightCache.get(cacheKey) ??
    (rendered?.key === cacheKey ? rendered.html : null)

  if (!html) {
    return (
      <pre className="m-0 overflow-x-auto bg-muted px-3.5 py-3 font-mono text-[12.5px] leading-[1.55] text-foreground">
        <code>{code}</code>
      </pre>
    )
  }

  return (
    <div
      className="lc-code-shiki overflow-x-auto bg-muted text-[12.5px] leading-[1.55] [&_code]:font-mono [&_pre]:m-0 [&_pre]:px-3.5 [&_pre]:py-3 [&_pre]:!bg-transparent"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

export const MessageCode = React.memo(function MessageCode({
  block,
  className,
  streaming = false,
}: {
  block: MessageCodeBlockData
  className?: string
  /**
   * True while the fence is still arriving. The highlighter still runs, so the
   * block never sits unhighlighted; its output just is not cached, because a
   * fence that grows by a token per frame would fill the cache with a hundred
   * throwaway versions of itself.
   */
  streaming?: boolean
}) {
  const [copied, setCopied] = React.useState(false)

  /* "Copied" waits for the write to land: `navigator.clipboard` is undefined
     outside a secure context, and a write can still be refused. */
  const copy = React.useCallback(() => {
    const clipboard = navigator.clipboard
    if (!clipboard) return
    void clipboard.writeText(block.code).then(() => setCopied(true), () => {})
  }, [block.code])

  React.useEffect(() => {
    if (!copied) return
    const id = window.setTimeout(() => setCopied(false), 1200)
    return () => window.clearTimeout(id)
  }, [copied])

  const langLabel = (block.language ?? "text").toLowerCase()

  /* A diagram is the one part of a message that renders someone else's syntax,
     and a half-written one throws. Its own boundary keeps that failure inside
     the block instead of taking the answer around it down. */
  if (langLabel === "mermaid") {
    return (
      <div className={cn("my-3", className)}>
        <RenderErrorBoundary
          resetKeys={[block.code]}
          fallback={<CodeFallback code={block.code} />}
        >
          <MessageMarkdown>{`\`\`\`mermaid\n${block.code}\n\`\`\``}</MessageMarkdown>
        </RenderErrorBoundary>
      </div>
    )
  }

  return (
    <div
      data-slot="message-code"
      className={cn(
        "my-3 overflow-hidden rounded-lg border bg-muted animate-in fade-in duration-150",
        className
      )}
    >
      <div
        data-slot="message-code-header"
        className="flex h-8 items-center gap-2 border-b px-2.5"
      >
        <span className="rounded-sm border px-1.5 py-0.5 font-mono text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          {langLabel}
        </span>
        {block.title ? (
          <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-muted-foreground">
            {block.title}
          </span>
        ) : (
          <span className="flex-1" />
        )}
        <button
          type="button"
          data-slot="message-code-copy"
          data-state={copied ? "copied" : "idle"}
          onClick={copy}
          title={copied ? "Copied" : "Copy"}
          aria-label={copied ? "Copied" : "Copy code"}
          className="inline-grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-background hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 [&_svg]:pointer-events-none [&_svg]:size-3.5"
        >
          {copied ? <Check /> : <Copy />}
        </button>
      </div>
      <RenderErrorBoundary
        resetKeys={[block.code, block.language]}
        fallback={<CodeFallback code={block.code} />}
      >
        <HighlightedCode
          code={block.code}
          language={block.language}
          streaming={streaming}
        />
      </RenderErrorBoundary>
    </div>
  )
})

function ArtifactIcon({ kind }: { kind?: string }) {
  return kind === "table" ? (
    <Table2 className="size-4" />
  ) : (
    <FileText className="size-4" />
  )
}

export const MessageArtifact = React.memo(function MessageArtifact({
  artifact,
  className,
}: {
  artifact: MessageArtifactData
  className?: string
}) {
  const meta = [artifact.kind, artifact.summary].filter(Boolean).join(" · ")
  const interactive = !!artifact.onOpen

  return (
    <div
      data-slot="message-artifact"
      className={cn(
        "my-3 overflow-hidden rounded-lg border bg-card animate-in fade-in duration-150",
        className
      )}
    >
      <button
        type="button"
        data-slot="message-artifact-trigger"
        onClick={artifact.onOpen}
        disabled={!interactive}
        className={cn(
          "group/artifact flex w-full items-center gap-2.5 bg-muted px-3.5 py-2 text-left text-foreground outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset",
          interactive
            ? "cursor-pointer hover:bg-accent hover:text-accent-foreground"
            : "cursor-default",
          artifact.content && "border-b"
        )}
      >
        <span className="inline-flex shrink-0 text-primary">
          <ArtifactIcon kind={artifact.kind} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium">
            {artifact.title}
          </span>
          {meta ? (
            <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground group-hover/artifact:text-current/75">
              {meta}
            </span>
          ) : null}
        </span>
      </button>
      {artifact.content ? (
        <div
          data-slot="message-artifact-content"
          className="max-h-[min(14rem,40vh)] overflow-auto bg-muted px-3.5 py-2.5 font-mono text-[12.5px] leading-relaxed break-words whitespace-pre-wrap text-foreground"
        >
          {artifact.content}
        </div>
      ) : null}
    </div>
  )
})

/**
 * Thumbnail row for the images (and other files) a user attached to their
 * turn. Images open full-size in a new tab; anything else falls back to a
 * plain named chip.
 */
export const MessageAttachments = React.memo(function MessageAttachments({
  attachments,
  className,
}: {
  attachments: MessageAttachmentData[]
  className?: string
}) {
  if (attachments.length === 0) return null

  return (
    <div
      data-slot="message-attachments"
      className={cn("flex flex-wrap justify-end gap-1.5", className)}
    >
      {attachments.map((attachment) =>
        attachment.mimeType.startsWith("image/") ? (
          <a
            key={attachment.id}
            href={attachment.url}
            target="_blank"
            rel="noreferrer"
            data-slot="message-attachment"
            data-kind="image"
            title={attachment.name}
            className="block size-20 shrink-0 overflow-hidden rounded-lg border bg-muted outline-none transition-opacity hover:opacity-90 focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- data: URLs and arbitrary remote hosts, not a next/image-friendly asset */}
            <img
              src={attachment.url}
              alt={attachment.name}
              className="size-full object-cover"
            />
          </a>
        ) : (
          <span
            key={attachment.id}
            data-slot="message-attachment"
            data-kind="file"
            title={attachment.name}
            className="inline-flex max-w-40 items-center gap-1.5 rounded-md border bg-muted px-2 py-1 text-[12px]"
          >
            <FileText className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 truncate text-foreground">
              {attachment.name}
            </span>
          </span>
        )
      )}
    </div>
  )
})
