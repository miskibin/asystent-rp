"use client"

import { Check, Columns2, MoreHorizontal, Rows3, WrapText, X } from "lucide-react"
import * as React from "react"

import {
  FileContextMenu,
  type FileActionItem,
} from "@/components/ui/change-summary"
import {
  DiffView,
  type DiffLineCommentRange,
} from "@/components/ui/diff-view"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { FileIcon } from "@/components/ui/file-icon"
import {
  DiffStats,
  buildDiffLines,
  extractReadFile,
  extractToolDiff,
  isFileMutationTool,
  isImagePath,
  langFromPath,
  parseToolArgs,
  parseUnifiedPatch,
  type MessageToolCallData,
  type ToolDiffLine,
} from "@/components/ui/message-parts"
import { cn } from "@/lib/utils"

export type FilePreviewFile = {
  path: string
  /** Falls back to the extension of `path`. */
  language?: string
  /** Full post-edit file text. Supplied by the app — it is what enables the File view. */
  content?: string
  /** Unified diff text (`@@` hunks keep their real line numbers). */
  diff?: string
  /** Before/after pair, when there is no patch to hand. */
  oldText?: string
  newText?: string
  /** Diff lines already parsed by `extractToolDiff` — wins over the fields above. */
  diffLines?: ToolDiffLine[]
  /** Stat overrides; otherwise counted off the diff. */
  added?: number
  removed?: number
  /** First line number of `content` when it is a partial read. */
  startLine?: number
  /**
   * 1-based line of the File view to centre and mark — "the app wants you
   * here" (a search hit, a stack frame). Outranks the first changed line.
   */
  focusLine?: number
  /**
   * Bump it to ask for the same `focusLine` again — clicking one `file.ts:42`
   * chip twice is two requests, and only the host can tell them apart.
   */
  focusNonce?: number
  /**
   * A URL the page can load this file's picture from. Set it for an image and
   * the panel shows the picture instead of a text body — only the host knows
   * how a path on the machine reaches the browser.
   */
  imageSrc?: string
}

export type { DiffLineCommentRange }

export type FilePreviewView = "file" | "diff"

export type FilePreviewDiffLayout = "unified" | "split"

export type FilePreviewProps = Omit<React.ComponentProps<"div">, "children"> & {
  file: FilePreviewFile
  /** Defaults to `file` when there is content to show, else `diff`. */
  defaultView?: FilePreviewView
  /** Side-by-side or one column. Controlled. */
  diffLayout?: FilePreviewDiffLayout
  /** Uncontrolled initial layout; defaults to `unified`. */
  defaultDiffLayout?: FilePreviewDiffLayout
  onDiffLayoutChange?: (layout: FilePreviewDiffLayout) => void
  /** Soft-wrap long lines. Controlled. */
  wrap?: boolean
  /** Uncontrolled initial wrapping; defaults to `true`. */
  defaultWrap?: boolean
  onWrapChange?: (wrap: boolean) => void
  /** Right-click menu on the header, and the same items behind the kebab. */
  actions?: FileActionItem[]
  /** Replaces the built-in clipboard write — the host may copy an absolute path. */
  onCopyPath?: (path: string) => void
  /** Renders the close button. Escape closes the panel whenever this is set. */
  onClose?: () => void
  /**
   * Turns on line selection in both bodies and offers "Comment on lines" over
   * the picked range — the host decides what a comment is for.
   */
  onLineComment?: (range: DiffLineCommentRange) => void
  classNames?: {
    root?: string
    header?: string
    body?: string
  }
}

/** How long the header says "Copied" before falling back to the path. */
const COPIED_MS = 1200

/** Quiet square button shared by every header control. */
const filePreviewButton =
  "inline-flex shrink-0 items-center justify-center gap-1 rounded-md text-[12px] text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 [&_svg]:pointer-events-none [&_svg]:size-3.5"

function splitPath(path: string) {
  const normalized = path.replace(/[\\/]+$/, "")
  const index = Math.max(
    normalized.lastIndexOf("/"),
    normalized.lastIndexOf("\\")
  )
  return index < 0
    ? { dir: "", name: normalized || path }
    : { dir: normalized.slice(0, index + 1), name: normalized.slice(index + 1) }
}

function splitLines(text: string) {
  return text.length === 0 ? [""] : text.replace(/\n$/, "").split("\n")
}

/** 1-based line number `needle` starts on inside `haystack`, or null. */
function lineOfMatch(haystack: string, needle: string) {
  if (!needle) return null
  const index = haystack.indexOf(needle)
  if (index < 0) return null
  let line = 1
  for (let i = 0; i < index; i++) if (haystack[i] === "\n") line++
  return line
}

/**
 * Already-parsed lines back into a unified patch — the one shape the viewer
 * reads. Hunks break wherever the numbering jumps, and lines that carry no
 * numbers at all (a diff synthesized from an old/new pair) number themselves
 * from 1, exactly as the old renderer drew them.
 */
function patchFromDiffLines(path: string, lines: ToolDiffLine[]) {
  // No `a/`/`b/` prefixes: Pierre reads those as two different names and calls
  // the result a rename.
  const out = [`--- ${path}`, `+++ ${path}`]
  const rows: string[] = []
  let hunkOld = 1
  let hunkNew = 1
  let oldCount = 0
  let newCount = 0
  let nextOld = 0
  let nextNew = 0

  const flush = () => {
    if (rows.length === 0) return
    out.push(`@@ -${hunkOld},${oldCount} +${hunkNew},${newCount} @@`, ...rows)
    rows.length = 0
    oldCount = 0
    newCount = 0
  }

  for (const line of lines) {
    const oldLine = line.type === "add" ? undefined : line.oldLine
    const newLine = line.type === "remove" ? undefined : line.newLine
    if (
      rows.length > 0 &&
      ((oldLine != null && nextOld > 0 && oldLine !== nextOld) ||
        (newLine != null && nextNew > 0 && newLine !== nextNew))
    ) {
      flush()
    }
    if (rows.length === 0) {
      hunkOld = oldLine ?? (nextOld > 0 ? nextOld : 1)
      hunkNew = newLine ?? (nextNew > 0 ? nextNew : 1)
    }
    rows.push(
      `${line.type === "add" ? "+" : line.type === "remove" ? "-" : " "}${line.text}`
    )
    if (line.type !== "add") {
      oldCount++
      nextOld = (oldLine ?? nextOld) + 1
    }
    if (line.type !== "remove") {
      newCount++
      nextNew = (newLine ?? nextNew) + 1
    }
  }
  flush()

  return out.length > 2 ? `${out.join("\n")}\n` : null
}

type FilePreviewModel = {
  /** What the diff view renders — a patch, else the before/after pair. */
  patch: string | null
  oldText?: string
  newText?: string
  hasDiff: boolean
  added: number
  removed: number
  /** Absolute new-file line numbers the agent touched — tinted in the File view. */
  changed: Set<number>
}

/**
 * One pass over whatever the app handed us: the patch the viewer will render,
 * the stats for the header, and the set of changed lines. Tolerates a truncated
 * or malformed patch — it is handed on as text and the viewer says so, rather
 * than throwing.
 */
function buildModel(file: FilePreviewFile): FilePreviewModel {
  let diffLines: ToolDiffLine[] = []
  let patch: string | null = null

  if (file.diffLines?.length) {
    diffLines = file.diffLines
    patch = patchFromDiffLines(file.path, diffLines)
  } else if (file.diff?.trim()) {
    patch = file.diff
    diffLines = parseUnifiedPatch(file.diff) ?? []
  }

  const { oldText, newText } = file
  const pair =
    patch === null && oldText !== undefined && newText !== undefined
  if (pair) diffLines = buildDiffLines(oldText, newText)

  const fileLines = file.content !== undefined ? splitLines(file.content) : null
  const startLine = file.startLine ?? 1

  let added = 0
  let removed = 0
  const adds: { line: number; text: string }[] = []
  for (const line of diffLines) {
    if (line.type === "add") {
      added++
      if (line.newLine != null) adds.push({ line: line.newLine, text: line.text })
    } else if (line.type === "remove") removed++
  }

  /**
   * `@@` hunks carry real file line numbers, so their adds land as they are —
   * checked against the body rather than trusted. A diff synthesized from an
   * old/new pair numbers itself from 1 inside that snippet instead, so fall
   * back to locating the snippet. When neither lines up nothing is tinted — a
   * wrong line is worse than none.
   */
  let changed = new Set<number>()
  if (fileLines && adds.length > 0) {
    const hits = adds.filter(
      (add) => fileLines[add.line - startLine] === add.text
    ).length
    if (hits * 2 >= adds.length) {
      changed = new Set(adds.map((add) => add.line))
    }
  }
  if (fileLines && changed.size === 0 && file.content && newText) {
    const at = lineOfMatch(file.content, newText)
    if (at != null) {
      const span = splitLines(newText).length
      for (let i = 0; i < span; i++) changed.add(startLine + at - 1 + i)
    }
  }

  return {
    patch,
    oldText: pair ? oldText : undefined,
    newText: pair ? newText : undefined,
    hasDiff: patch !== null || (pair && diffLines.length > 0),
    added: file.added ?? added,
    removed: file.removed ?? removed,
    changed,
  }
}

/**
 * Held at one identity for the lifetime of the panel, so the document-level
 * Escape listener is attached once instead of on every parent render.
 */
function useStableCallback<A extends unknown[], R>(
  callback: ((...args: A) => R) | undefined
) {
  const ref = React.useRef(callback)
  React.useEffect(() => {
    ref.current = callback
  })
  return React.useCallback((...args: A) => ref.current?.(...args), [])
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <p
      data-slot="file-preview-note"
      className="px-3 py-2 text-[12.5px] text-muted-foreground"
    >
      {children}
    </p>
  )
}

/**
 * Right-side file panel: the agent's diff, or the file itself with the edited
 * lines marked. Both bodies are one `DiffView`, so a megabyte costs the same as
 * a page — only the rows on screen are rendered. Non-modal by design
 * (`role="dialog"` without `aria-modal`) — the conversation next to it stays
 * live.
 */
export function FilePreview({
  file,
  defaultView,
  diffLayout,
  defaultDiffLayout = "unified",
  onDiffLayoutChange,
  wrap,
  defaultWrap = true,
  onWrapChange,
  actions,
  onCopyPath,
  onClose,
  onLineComment,
  className,
  classNames,
  ...props
}: FilePreviewProps) {
  /** Parsing a whole file is the expensive bit; let a streaming prop skip frames. */
  const deferredFile = React.useDeferredValue(file)
  const model = React.useMemo(() => buildModel(deferredFile), [deferredFile])
  const language = deferredFile.language ?? langFromPath(deferredFile.path)
  const startLine = deferredFile.startLine ?? 1
  const focusLine = deferredFile.focusLine

  const image = deferredFile.imageSrc
  const hasFile = !image && deferredFile.content !== undefined
  const hasDiff = !image && model.hasDiff
  const canToggle = hasFile && hasDiff
  // A focus request is about the file body, so it decides the opening view.
  const preferred: FilePreviewView =
    focusLine != null && hasFile
      ? "file"
      : (defaultView ?? (hasFile ? "file" : "diff"))
  // A focus request is the line *and* the host's nonce: the same line asked
  // for twice is two requests, and only the host can tell them apart.
  const focusKey = `${focusLine ?? ""}\0${deferredFile.focusNonce ?? ""}`
  const [requested, setRequested] = React.useState<FilePreviewView>(preferred)
  const [shownPath, setShownPath] = React.useState(deferredFile.path)
  const [shownHasFile, setShownHasFile] = React.useState(hasFile)
  const [shownFocus, setShownFocus] = React.useState(focusKey)
  const [copied, setCopied] = React.useState(false)

  // Adjust while rendering rather than in an effect: a newly opened file never
  // paints one frame in the previous file's view.
  if (shownPath !== deferredFile.path) {
    setShownPath(deferredFile.path)
    setShownHasFile(hasFile)
    setShownFocus(focusKey)
    setRequested(preferred)
    setCopied(false)
  } else if (hasFile !== shownHasFile || focusKey !== shownFocus) {
    // The body lands after the path — a host sets the diff and fetches the
    // text after it — so the view a focus request (or the `defaultView`
    // default) asks for can only be settled once the file is actually here,
    // and a fresh request settles it again. Until then the toggle is hidden,
    // so this can never overrule a choice the reader made.
    const arrived = hasFile && !shownHasFile
    const refocused = hasFile && focusLine != null && focusKey !== shownFocus
    setShownHasFile(hasFile)
    setShownFocus(focusKey)
    if (arrived || refocused) setRequested(preferred)
  }

  const view: FilePreviewView = canToggle
    ? requested
    : hasFile
      ? "file"
      : "diff"

  const [internalLayout, setInternalLayout] =
    React.useState<FilePreviewDiffLayout>(defaultDiffLayout)
  const layout = diffLayout ?? internalLayout
  const [internalWrap, setInternalWrap] = React.useState(defaultWrap)
  const wrapped = wrap ?? internalWrap

  /** Row the File view centres on — the focus request first, else the first change. */
  const fileFocus = React.useMemo(() => {
    if (focusLine != null) return focusLine
    if (model.changed.size === 0) return undefined
    // Iterated rather than spread into Math.min: a whole-file write marks
    // every line, and that set can be enormous.
    let first = Number.POSITIVE_INFINITY
    for (const line of model.changed) if (line < first) first = line
    return first
  }, [focusLine, model.changed])

  const { dir, name } = splitPath(deferredFile.path)

  const close = useStableCallback(onClose)
  const canClose = !!onClose
  React.useEffect(() => {
    if (!canClose) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) close()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [close, canClose])

  const copyTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  React.useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current)
    },
    []
  )

  const copy = useStableCallback(onCopyPath)
  const hasCopyHandler = !!onCopyPath
  const path = deferredFile.path
  /**
   * "Copied" is a claim about the clipboard, so it waits for the write to
   * land: `navigator.clipboard` is undefined outside a secure context, and a
   * write can still be refused.
   */
  const copyPath = React.useCallback(() => {
    const markCopied = () => {
      setCopied(true)
      if (copyTimer.current) clearTimeout(copyTimer.current)
      copyTimer.current = setTimeout(() => setCopied(false), COPIED_MS)
    }
    if (hasCopyHandler) {
      copy(path)
      markCopied()
      return
    }
    const clipboard = navigator.clipboard
    if (!clipboard) return
    void clipboard.writeText(path).then(markCopied, () => {})
  }, [copy, hasCopyHandler, path])

  const showFile = React.useCallback(() => setRequested("file"), [])
  const showDiff = React.useCallback(() => setRequested("diff"), [])

  const layoutChanged = useStableCallback(onDiffLayoutChange)
  const toggleLayout = React.useCallback(() => {
    const next: FilePreviewDiffLayout = layout === "split" ? "unified" : "split"
    setInternalLayout(next)
    layoutChanged(next)
  }, [layout, layoutChanged])

  const wrapChanged = useStableCallback(onWrapChange)
  const toggleWrap = React.useCallback(() => {
    setInternalWrap(!wrapped)
    wrapChanged(!wrapped)
  }, [wrapChanged, wrapped])

  const header = (
    <div
      data-slot="file-preview-header"
      className={cn(
        "flex h-10 shrink-0 items-center gap-2 border-b px-2.5",
        classNames?.header
      )}
    >
      <FileIcon path={deferredFile.path} size={14} />
      <button
        type="button"
        data-slot="file-preview-path"
        data-copied={copied || undefined}
        title="Copy path"
        onClick={copyPath}
        className="flex min-w-0 flex-1 items-baseline gap-1 rounded-md text-left font-mono text-[12px] outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        {dir ? (
          <span className="min-w-0 truncate text-muted-foreground">{dir}</span>
        ) : null}
        <span className="shrink-0 font-medium text-foreground">{name}</span>
        {copied ? (
          <span className="inline-flex shrink-0 items-center gap-0.5 text-[11px] text-muted-foreground">
            <Check className="size-3" />
            Copied
          </span>
        ) : null}
      </button>
      <DiffStats
        data-slot="file-preview-stats"
        added={model.added}
        removed={model.removed}
      />
      <div
        data-slot="file-preview-prefs"
        role="group"
        aria-label="View preferences"
        className="flex shrink-0 items-center"
      >
        <button
          type="button"
          data-slot="file-preview-wrap-toggle"
          aria-pressed={wrapped}
          aria-label="Wrap lines"
          onClick={toggleWrap}
          title={wrapped ? "Don't wrap" : "Wrap lines"}
          className={cn(
            filePreviewButton,
            "size-6 aria-pressed:text-foreground"
          )}
        >
          <WrapText />
        </button>
        {view === "diff" ? (
          <button
            type="button"
            data-slot="file-preview-layout-toggle"
            aria-pressed={layout === "split"}
            aria-label={layout === "split" ? "Unified view" : "Split view"}
            onClick={toggleLayout}
            title={layout === "split" ? "Unified view" : "Split view"}
            className={cn(
              filePreviewButton,
              "size-6 aria-pressed:text-foreground"
            )}
          >
            {layout === "split" ? <Rows3 /> : <Columns2 />}
          </button>
        ) : null}
      </div>
      {canToggle ? (
        <div
          data-slot="file-preview-view-toggle"
          role="group"
          aria-label="Preview mode"
          className="flex shrink-0 items-center gap-0.5 rounded-md bg-muted p-0.5"
        >
          <button
            type="button"
            data-active={view === "file"}
            aria-pressed={view === "file"}
            onClick={showFile}
            className={cn(
              filePreviewButton,
              "h-6 px-2 data-[active=true]:bg-background data-[active=true]:text-foreground data-[active=true]:shadow-xs"
            )}
          >
            File
          </button>
          <button
            type="button"
            data-active={view === "diff"}
            aria-pressed={view === "diff"}
            onClick={showDiff}
            className={cn(
              filePreviewButton,
              "h-6 px-2 data-[active=true]:bg-background data-[active=true]:text-foreground data-[active=true]:shadow-xs"
            )}
          >
            Diff
          </button>
        </div>
      ) : null}
      {actions?.length ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              data-slot="file-preview-actions"
              aria-label="File actions"
              className={cn(filePreviewButton, "size-6")}
            >
              <MoreHorizontal />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-44">
            {actions.map((action) => (
              <React.Fragment key={action.id}>
                {action.separatorBefore ? <DropdownMenuSeparator /> : null}
                <DropdownMenuItem
                  data-action={action.id}
                  variant={action.destructive ? "destructive" : "default"}
                  onSelect={() => action.onSelect(deferredFile.path)}
                  className="text-[12.5px]"
                >
                  {action.icon}
                  {action.label}
                </DropdownMenuItem>
              </React.Fragment>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {onClose ? (
        <button
          type="button"
          data-slot="file-preview-close"
          onClick={onClose}
          title="Close (Esc)"
          aria-label="Close file preview"
          className={cn(filePreviewButton, "size-6")}
        >
          <X />
        </button>
      ) : null}
    </div>
  )

  return (
    <div
      data-slot="file-preview"
      data-view={view}
      data-layout={layout}
      data-wrap={wrapped ? "true" : "false"}
      role="dialog"
      aria-label={deferredFile.path}
      className={cn(
        "flex h-full min-h-0 w-full flex-col overflow-hidden bg-background text-foreground",
        className,
        classNames?.root
      )}
      {...props}
    >
      <FileContextMenu path={deferredFile.path} actions={actions}>
        {header}
      </FileContextMenu>

      <div
        data-slot="file-preview-body"
        className={cn("relative min-h-0 flex-1", classNames?.body)}
      >
        {image ? (
          <div
            data-slot="file-preview-image"
            className="flex h-full items-center justify-center overflow-auto p-3"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- a local file served by the host, not an optimizable asset */}
            <img
              src={image}
              alt={name}
              decoding="async"
              className="max-h-full max-w-full object-contain"
            />
          </div>
        ) : view === "file" && hasFile ? (
          <DiffView
            key={`${deferredFile.path}\0file`}
            path={deferredFile.path}
            language={language}
            content={deferredFile.content}
            startLine={startLine}
            highlightLines={model.changed}
            focusLine={fileFocus}
            focusNonce={deferredFile.focusNonce}
            wrap={wrapped}
            {...(onLineComment ? { onLineComment } : null)}
          />
        ) : view === "diff" && hasDiff ? (
          <DiffView
            key={`${deferredFile.path}\0diff`}
            path={deferredFile.path}
            language={language}
            patch={model.patch ?? undefined}
            oldText={model.oldText}
            newText={model.newText}
            mode={layout}
            wrap={wrapped}
            {...(onLineComment ? { onLineComment } : null)}
          />
        ) : (
          <EmptyNote>No preview available for this file.</EmptyNote>
        )}
      </div>
    </div>
  )
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined
}

function asRawString(value: unknown) {
  return typeof value === "string" ? value : undefined
}

/**
 * Tool row → panel input. The diff and the read body come straight from the
 * `message-parts` extractors, so the panel shows exactly what the inline row
 * shows; only the whole-file bodies an editing tool streams are read here.
 * Returns null when the tool has no file to open.
 */
export function filePreviewFromTool(
  tool: MessageToolCallData
): FilePreviewFile | null {
  const args = parseToolArgs(tool.input)
  const path =
    asString(args.path) ??
    asString(args.filePath) ??
    asString(args.target_file) ??
    asString(args.file)
  if (!path) return null

  const preview: FilePreviewFile = { path, language: langFromPath(path) }

  const diffLines = extractToolDiff(tool)
  if (diffLines?.length) preview.diffLines = diffLines

  // An image's "content" is a stand-in line about the bytes; the host supplies
  // an `imageSrc` for it instead, and the panel shows the picture.
  if (isImagePath(path)) return preview

  const read = extractReadFile(tool)
  if (read) {
    preview.content = read.content
    preview.startLine = read.startLine
  } else if (isFileMutationTool(tool.name)) {
    // Cursor streams the after-file as streamContent; writeToolCall uses fileText.
    preview.content =
      asRawString(args.contents) ??
      asRawString(args.content) ??
      asRawString(args.file_text) ??
      asRawString(args.fileText) ??
      asRawString(args.streamContent)
    preview.newText =
      asRawString(args.new_string) ??
      asRawString(args.newString) ??
      asRawString(args.new_str) ??
      asRawString(args.newText)
  }

  return preview
}
