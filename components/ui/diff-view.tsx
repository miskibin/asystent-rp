"use client"

// Adapted from T3 Code (github.com/pingdotgg/t3code), MIT License, (c) 2026 T3 Tools Inc.
import {
  getSingularPatch,
  parseDiffFromFile,
  type CodeViewItem,
  type DiffsThemeNames,
  type FileDiffMetadata,
  type SelectedLineRange,
  type SelectionSide,
  type SupportedLanguages,
  type ThemesType,
} from "@pierre/diffs"
import {
  CodeView,
  type CodeViewHandle,
  type CodeViewReactOptions,
} from "@pierre/diffs/react"
import { MessageSquarePlus } from "lucide-react"
import { useTheme } from "next-themes"
import * as React from "react"

import { cn } from "@/lib/utils"
import { PREFERRED_HIGHLIGHTER, DIFF_THEMES } from "@/lib/syntax-highlighting"

export type DiffViewMode = "unified" | "split"

/**
 * A range of lines a reader picked, and the text those lines hold — what a
 * host needs to quote the selection back at an agent. `side` names which
 * version of the file the numbers belong to; a plain file has neither.
 */
export type DiffLineCommentRange = {
  path: string
  /** 1-based, inclusive, in the numbering of `side`. */
  startLine: number
  endLine: number
  side?: "old" | "new"
  /** The selected lines themselves, newline joined. Empty when unreadable. */
  excerpt: string
}

/**
 * Every option `DiffView` owns is removed: passing one here would be silently
 * overwritten, which is worse than not compiling.
 */
export type DiffViewOptions = Omit<
  CodeViewReactOptions<undefined, undefined>,
  | "theme"
  | "themeType"
  | "overflow"
  | "diffStyle"
  | "disableLineNumbers"
  | "disableFileHeader"
  | "unsafeCSS"
  | "preferredHighlighter"
  | "itemMetrics"
  | "layout"
  | "enableLineSelection"
>

export type DiffViewProps = Omit<
  React.ComponentProps<"div">,
  "children" | "content"
> & {
  /** Names the file in the header and picks the language when none is given. */
  path: string
  /** Overrides the language inferred from `path`. */
  language?: string
  /** Unified patch text. Outranks `oldText`/`newText`. */
  patch?: string
  /** Before/after pair, when there is no patch to hand. */
  oldText?: string
  newText?: string
  /** No diff at all: the file itself, highlighted and virtualized. */
  content?: string
  /** First line number of `content`, for a partial read. */
  startLine?: number
  /** Side by side or one column. Ignored without a diff. */
  mode?: DiffViewMode
  /** Soft-wrap long lines; off, the code scrolls sideways. */
  wrap?: boolean
  /** Gutter line numbers. */
  lineNumbers?: boolean
  /** Pierre's own per-file header — off by default, since the host usually has one. */
  fileHeader?: boolean
  /**
   * Lines to tint, in the file's own numbering — the lines an agent touched,
   * a search's hits. Beyond 400 the tint is dropped rather than emitting a
   * stylesheet that costs more than it says.
   */
  highlightLines?: Iterable<number>
  /** 1-based line to centre, in the file's own numbering. */
  focusLine?: number
  /** Bump it to ask for the same `focusLine` again. */
  focusNonce?: number
  /**
   * Turns on line selection and offers "Comment on lines" over the selected
   * range. Set it and a reader can drag the gutter to pick lines and hand
   * them — with the text they name — back to the host.
   */
  onLineComment?: (range: DiffLineCommentRange) => void
  /** Shiki theme, or a light/dark pair. Defaults to Pierre's own two. */
  theme?: DiffsThemeNames | ThemesType
  /** Appended inside the viewer's shadow root, after the token bindings. */
  unsafeCSS?: string
  /** Everything `DiffView` does not own, forwarded to `CodeView`. */
  options?: DiffViewOptions
  /** Shown when there is nothing to render. */
  emptyLabel?: React.ReactNode
  classNames?: {
    root?: string
    surface?: string
    note?: string
    lineComment?: string
  }
}

/**
 * A controlled `CodeView` reconciles an item by its `version` alone — same
 * version, same record, whatever the payload says. So every model this builds
 * carries a fresh one: it never has to equal anything, only differ from the
 * number the viewer is holding.
 */
let nextItemVersion = 0

/** Past this the per-line stylesheet costs more than the tint is worth. */
const HIGHLIGHT_LINE_CAP = 400

/**
 * Binds every surface `@pierre/diffs` paints to the shadcn tokens. Custom
 * properties cross the shadow boundary, so `var(--background)` inside the
 * viewer is the page's own background and a theme swap needs no re-render.
 *
 * Additions and deletions have no semantic token to borrow — the registry's
 * dark-safe green and red are the defaults, and `--chat-diff-added` /
 * `--chat-diff-removed` set anywhere above the viewer replace them.
 */
const TOKEN_CSS = `
:host,
[data-diffs-header],
[data-diff],
[data-file],
[data-error-wrapper],
[data-virtualizer-buffer] {
  --diff-add: var(--chat-diff-added, oklch(0.696 0.17 162.48));
  --diff-del: var(--chat-diff-removed, oklch(0.637 0.237 25.331));

  --diffs-header-font-family: var(--font-sans) !important;
  --diffs-font-family: var(--font-mono) !important;
  --diffs-bg: var(--background) !important;
  --diffs-light-bg: var(--background) !important;
  --diffs-dark-bg: var(--background) !important;
  --diffs-token-light-bg: transparent;
  --diffs-token-dark-bg: transparent;

  /* Gutter, context and row tints all mix from the surface the code sits on,
     so a theme that separates the canvas from the panel keeps both. */
  --diffs-bg-context-override: color-mix(in srgb, var(--background) 97%, var(--foreground));
  --diffs-bg-context-gutter-override: color-mix(in srgb, var(--background) 95%, var(--foreground));
  --diffs-bg-hover-override: color-mix(in srgb, var(--background) 94%, var(--foreground));
  --diffs-bg-separator-override: color-mix(in srgb, var(--background) 95%, var(--foreground));
  --diffs-bg-buffer-override: color-mix(in srgb, var(--background) 90%, var(--foreground));
  --diffs-fg-number-override: color-mix(in srgb, var(--muted-foreground) 80%, transparent);

  --diffs-bg-addition-override: light-dark(
    color-mix(in srgb, var(--background) 88%, var(--diff-add)),
    color-mix(in srgb, var(--background) 84%, var(--diff-add))
  );
  --diffs-bg-addition-number-override: light-dark(
    color-mix(in srgb, var(--background) 78%, var(--diff-add)),
    color-mix(in srgb, var(--background) 74%, var(--diff-add))
  );
  --diffs-bg-addition-emphasis-override: color-mix(in srgb, var(--background) 66%, var(--diff-add));

  --diffs-bg-deletion-override: light-dark(
    color-mix(in srgb, var(--background) 88%, var(--diff-del)),
    color-mix(in srgb, var(--background) 84%, var(--diff-del))
  );
  --diffs-bg-deletion-number-override: light-dark(
    color-mix(in srgb, var(--background) 78%, var(--diff-del)),
    color-mix(in srgb, var(--background) 74%, var(--diff-del))
  );
  --diffs-bg-deletion-emphasis-override: color-mix(in srgb, var(--background) 66%, var(--diff-del));

  --diffs-addition-color-override: var(--diff-add);
  --diffs-deletion-color-override: var(--diff-del);

  background-color: var(--diffs-bg) !important;
  color: var(--foreground) !important;
}

[data-diffs-header],
[data-file-info] {
  background-color: var(--background) !important;
  border-block-color: var(--border) !important;
  color: var(--foreground) !important;
  font-family: var(--font-sans) !important;
  font-size: 12px !important;
}

:is([data-separator="line-info"], [data-separator="line-info-basic"]) [data-separator-content] {
  color: var(--muted-foreground) !important;
  font-family: var(--font-sans) !important;
  font-size: 11px !important;
}
`

/**
 * Rows the host asked us to mark. `data-line` carries the file's own number on
 * every rendered row, so one rule per line is all the tint takes — and it lands
 * on a virtualized row the moment it mounts.
 */
function highlightCSS(lines: readonly number[]) {
  if (lines.length === 0) return ""
  const selector = lines.map((line) => `[data-line="${line}"]`).join(",\n")
  return `\n${selector} {\n  --diffs-line-bg: color-mix(in srgb, var(--background) 86%, var(--diff-add)) !important;\n}\n`
}

/**
 * A patch carries only the lines around each change, but Pierre's parser keeps
 * every hunk's render start in *source file* coordinates — so a hunk at line
 * 400 reserves 400 rows of virtualized height that are never drawn, and the
 * end of the file sits past the reachable scroll range. The virtualizer walks a
 * partial patch as compact rows, so the starts have to be compact too;
 * `collapsedBefore` is left alone, because that is what draws the
 * "N unmodified lines" separator.
 */
function compactPartialHunks(file: FileDiffMetadata): FileDiffMetadata {
  if (!file.isPartial) return file

  let splitLineStart = 0
  let unifiedLineStart = 0
  const hunks = file.hunks.map((hunk) => {
    const compacted = { ...hunk, splitLineStart, unifiedLineStart }
    splitLineStart += hunk.splitLineCount
    unifiedLineStart += hunk.unifiedLineCount
    return compacted
  })

  return {
    ...file,
    hunks,
    splitLineCount: splitLineStart,
    unifiedLineCount: unifiedLineStart,
    ...(file.cacheKey ? { cacheKey: `${file.cacheKey}:compact-partial` } : {}),
  }
}

/** `content` with a trailing newline trimmed, split into rows. */
function splitLines(text: string) {
  return text.length === 0 ? [""] : text.replace(/\n$/, "").split("\n")
}

/**
 * A partial read as a context-only patch. A file item always numbers from 1,
 * and a `Read` that started at line 400 has to say 400 — a diff item numbers
 * from its hunk header, which is the one place the real numbers survive.
 */
function contextPatch(path: string, content: string, startLine: number) {
  const lines = splitLines(content)
  const span = `${startLine},${lines.length}`
  // No `a/`/`b/` prefixes: Pierre reads them as two different names and calls
  // an unchanged excerpt a rename.
  return [
    `--- ${path}`,
    `+++ ${path}`,
    `@@ -${span} +${span} @@`,
    ...lines.map((line) => ` ${line}`),
    "",
  ].join("\n")
}

/**
 * The lines a selected range names, read back out of the model the viewer is
 * showing. A hunk carries both its file-line start and where its rows begin
 * inside `additionLines` / `deletionLines`, so one walk covers a whole-file
 * diff and a patch that only holds the lines around each change.
 */
function excerptFromDiff(
  file: FileDiffMetadata,
  side: SelectionSide,
  startLine: number,
  endLine: number
) {
  const deletions = side === "deletions"
  const source = deletions ? file.deletionLines : file.additionLines
  const picked: string[] = []
  for (const hunk of file.hunks) {
    const first = deletions ? hunk.deletionStart : hunk.additionStart
    const count = deletions ? hunk.deletionCount : hunk.additionCount
    const index = deletions ? hunk.deletionLineIndex : hunk.additionLineIndex
    const from = Math.max(startLine, first)
    const to = Math.min(endLine, first + count - 1)
    for (let line = from; line <= to; line++) {
      picked.push((source[index + (line - first)] ?? "").replace(/\r?\n$/, ""))
    }
  }
  return picked.join("\n")
}

/** The same, for the plain-file item — which always numbers from 1. */
function excerptFromFile(contents: string, startLine: number, endLine: number) {
  return splitLines(contents)
    .slice(Math.max(0, startLine - 1), endLine)
    .join("\n")
}

/** `12`, or `12-18` — the label the comment affordance carries. */
function rangeLabel(startLine: number, endLine: number) {
  return startLine === endLine ? `${startLine}` : `${startLine}-${endLine}`
}

/**
 * Pierre reports a range in the numbering of whichever side each end was
 * picked on. A selection dragged across the two columns of a split diff is
 * read as belonging to the side it ended on, and the numbers are ordered.
 */
function normalizeRange(range: SelectedLineRange) {
  const side: SelectionSide | undefined = range.endSide ?? range.side
  const startLine = Math.min(range.start, range.end)
  const endLine = Math.max(range.start, range.end)
  return { side, startLine, endLine }
}

type DiffModel =
  | { kind: "none" }
  | { kind: "item"; item: CodeViewItem<undefined>; diff: boolean }
  /** A patch we could not parse — shown as its own text rather than thrown away. */
  | { kind: "raw"; item: CodeViewItem<undefined>; note: string }

/**
 * One pass over whatever the host handed us. A patch wins, then a before/after
 * pair, then the plain body. Nothing here throws: an unparseable patch renders
 * as text with a note, because a reader would rather see the patch than a
 * blank panel.
 */
function buildModel(
  path: string,
  lang: SupportedLanguages | undefined,
  patch: string | undefined,
  oldText: string | undefined,
  newText: string | undefined,
  content: string | undefined,
  startLine: number
): DiffModel {
  const id = path || "file"
  const version = ++nextItemVersion

  if (patch?.trim()) {
    try {
      const fileDiff = compactPartialHunks(getSingularPatch(patch))
      return {
        kind: "item",
        diff: true,
        item: { id, type: "diff", fileDiff, version },
      }
    } catch {
      return {
        kind: "raw",
        note: "This diff could not be parsed — it may have been truncated.",
        item: {
          id,
          type: "file",
          version,
          file: { name: `${path}.diff`, contents: patch },
        },
      }
    }
  }

  if (oldText !== undefined && newText !== undefined && oldText !== newText) {
    const fileDiff = parseDiffFromFile(
      { name: path, contents: oldText, ...(lang ? { lang } : {}) },
      { name: path, contents: newText, ...(lang ? { lang } : {}) }
    )
    return {
      kind: "item",
      diff: true,
      item: { id, type: "diff", fileDiff, version },
    }
  }

  const body = content ?? newText
  if (body === undefined) return { kind: "none" }

  if (startLine > 1) {
    try {
      const fileDiff = compactPartialHunks(
        getSingularPatch(contextPatch(path, body, startLine))
      )
      return {
        kind: "item",
        diff: false,
        item: { id, type: "diff", fileDiff, version },
      }
    } catch {
      // Fall through to the plain file: numbering from 1 beats no body.
    }
  }

  return {
    kind: "item",
    diff: false,
    item: {
      id,
      type: "file",
      version,
      file: { name: path, contents: body, ...(lang ? { lang } : {}) },
    },
  }
}

/**
 * A file or a diff, highlighted and virtualized by `@pierre/diffs`, themed with
 * the app's own tokens. A megabyte renders as cheaply as a page: only the rows
 * on screen exist, and with a `DiffWorkerPoolProvider` above it the
 * highlighting happens off the main thread.
 *
 * The viewer *is* its own scroll container, so give it a height and let it
 * scroll: `@pierre/diffs` hangs its virtualizer off the `CodeView` root, reads
 * `scrollTop` from it and listens for `scroll` on it. Without an overflow of
 * its own that root is 18,000px of content in an 820px box with nowhere to go —
 * the file renders, the wheel does nothing, and the rows past the first screen
 * are unreachable. The library never sets it; the consumer must.
 */
/**
 * The viewer options both `DiffView` and `DiffStack` hand to `CodeView`.
 *
 * One definition rather than two, because these are the settings that make a
 * diff *this* registry's diff — the theme, the metrics that keep the last row
 * inside the scroll range, the wrap mode — and a stack of files that disagreed
 * with a single file about any of them would read as a different component.
 */
function useViewerOptions({
  options,
  theme,
  dark,
  wrap,
  mode,
  lineNumbers,
  fileHeader,
  css,
  commentable,
}: {
  options?: Partial<CodeViewReactOptions<undefined, undefined>>
  theme?: DiffViewProps["theme"]
  dark: boolean
  wrap: boolean
  mode: DiffViewMode
  lineNumbers: boolean
  fileHeader: boolean
  css: string
  commentable: boolean
}) {
  return React.useMemo<CodeViewReactOptions<undefined, undefined>>(
    () => ({
      ...options,
      theme: theme ?? DIFF_THEMES,
      themeType: dark ? "dark" : "light",
      overflow: wrap ? "wrap" : "scroll",
      diffStyle: mode === "split" ? "split" : "unified",
      disableLineNumbers: !lineNumbers,
      disableFileHeader: !fileHeader,
      preferredHighlighter: PREFERRED_HIGHLIGHTER,
      unsafeCSS: css,
      enableLineSelection: commentable,
      itemMetrics: {
        diffHeaderHeight: fileHeader ? 32 : 0,
        hunkSeparatorHeight: 24,
        spacing: 0,
        paddingTop: 0,
        // The 8px under a file's last line is painted unconditionally by
        // Pierre's stylesheet, so the metric has to count it or the end of the
        // list sits past the reachable scroll range.
        paddingBottom: 8,
      },
      layout: { paddingTop: 0, paddingBottom: 0, gap: 0 },
    }),
    [options, theme, dark, wrap, mode, lineNumbers, fileHeader, css, commentable]
  )
}

export function DiffView({
  path,
  language,
  patch,
  oldText,
  newText,
  content,
  startLine = 1,
  mode = "unified",
  wrap = true,
  lineNumbers = true,
  fileHeader = false,
  highlightLines,
  focusLine,
  focusNonce,
  onLineComment,
  theme,
  unsafeCSS,
  options,
  emptyLabel = "No preview available for this file.",
  className,
  classNames,
  style,
  ...props
}: DiffViewProps) {
  const { resolvedTheme } = useTheme()
  const dark = resolvedTheme === "dark"
  const commentable = !!onLineComment

  const lang = language as SupportedLanguages | undefined
  const model = React.useMemo(
    () => buildModel(path, lang, patch, oldText, newText, content, startLine),
    [path, lang, patch, oldText, newText, content, startLine]
  )

  const marked = React.useMemo(() => {
    if (!highlightLines) return ""
    const lines: number[] = []
    for (const line of highlightLines) {
      if (lines.length > HIGHLIGHT_LINE_CAP) return ""
      lines.push(line)
    }
    return highlightCSS(lines)
  }, [highlightLines])

  const css = React.useMemo(
    () => `${TOKEN_CSS}${marked}${unsafeCSS ? `\n${unsafeCSS}` : ""}`,
    [marked, unsafeCSS]
  )

  /**
   * The lines the reader has picked. Controlled, because that is the only
   * shape the viewer offers: it reports every change and draws back whatever
   * it is handed.
   */
  const [selection, setSelection] = React.useState<SelectedLineRange | null>(
    null
  )
  const onSelectionChange = React.useCallback(
    (next: { id: string; range: SelectedLineRange } | null) =>
      setSelection(next?.range ?? null),
    []
  )

  const viewerOptions = useViewerOptions({
    options,
    theme,
    dark,
    wrap,
    mode,
    lineNumbers,
    fileHeader,
    css,
    commentable,
  })

  // State rather than a ref: the reveal effect below has to run again once the
  // viewer exists, and assigning a ref does not schedule that.
  const [handle, setHandle] = React.useState<CodeViewHandle<
    undefined,
    undefined
  > | null>(null)

  const item = model.kind === "none" ? undefined : model.item
  const itemId = item?.id
  const isDiffItem = item?.type === "diff"
  const isDiff = model.kind === "item" && model.diff
  const items = React.useMemo(() => (item ? [item] : []), [item])

  // Adjusted while rendering rather than in an effect: a range picked in the
  // file that was open must not survive into the one that replaces it.
  const [selectionFor, setSelectionFor] = React.useState(itemId)
  if (selectionFor !== itemId) {
    setSelectionFor(itemId)
    setSelection(null)
  }
  const selected = React.useMemo(
    () => (commentable && selection && itemId ? { id: itemId, range: selection } : null),
    [commentable, itemId, selection]
  )

  /** The picked range, ordered and reduced to one side. */
  const picked = React.useMemo(
    () => (selection ? normalizeRange(selection) : null),
    [selection]
  )

  /**
   * Hand the picked lines to the host, with the text they hold — a quote is
   * what makes the comment mean something once it is out of the viewer — and
   * drop the selection, so the affordance does not outlive the click.
   */
  const comment = React.useCallback(() => {
    if (!onLineComment || !selection || !item) return
    const { side, startLine: from, endLine: to } = normalizeRange(selection)
    const excerpt =
      item.type === "diff"
        ? excerptFromDiff(item.fileDiff, side ?? "additions", from, to)
        : excerptFromFile(item.file.contents, from, to)
    onLineComment({
      path,
      startLine: from,
      endLine: to,
      ...(side ? { side: side === "deletions" ? ("old" as const) : ("new" as const) } : null),
      excerpt,
    })
    setSelection(null)
    handle?.clearSelectedLines()
  }, [handle, item, onLineComment, path, selection])

  /**
   * Centre the requested line once per request. The line *and* the host's
   * nonce make the request: the same line asked for twice is two requests, and
   * only the host can tell them apart.
   */
  const revealKey =
    focusLine == null || itemId == null
      ? null
      : `${itemId}\0${focusLine}\0${focusNonce ?? ""}`
  const revealedRef = React.useRef<string | null>(null)
  React.useEffect(() => {
    if (revealKey === null || itemId == null || focusLine == null) return
    if (revealedRef.current === revealKey) return
    if (!handle?.getInstance()) return
    revealedRef.current = revealKey
    handle.scrollTo({
      type: "line",
      id: itemId,
      lineNumber: focusLine,
      ...(isDiffItem ? { side: "additions" as const } : {}),
      align: "center",
    })
  }, [focusLine, handle, isDiffItem, itemId, revealKey])

  return (
    <div
      data-slot="diff-view"
      data-mode={isDiff ? mode : "file"}
      data-wrap={wrap ? "true" : "false"}
      className={cn(
        "flex h-full min-h-0 w-full flex-col overflow-hidden bg-background text-foreground",
        className,
        classNames?.root
      )}
      style={{ colorScheme: dark ? "dark" : "light", ...style }}
      {...props}
    >
      {model.kind === "raw" ? (
        <p
          data-slot="diff-view-note"
          className={cn(
            "shrink-0 border-b px-3 py-1.5 text-[12px] text-muted-foreground",
            classNames?.note
          )}
        >
          {model.note}
        </p>
      ) : null}
      {model.kind === "none" ? (
        <p
          data-slot="diff-view-empty"
          className={cn(
            "px-3 py-2 text-[12.5px] text-muted-foreground",
            classNames?.note
          )}
        >
          {emptyLabel}
        </p>
      ) : (
        <div
          data-slot="diff-view-surface"
          className={cn("relative min-h-0 flex-1", classNames?.surface)}
        >
          <CodeView<undefined, undefined>
            ref={setHandle}
            items={items}
            options={viewerOptions}
            {...(commentable
              ? {
                  selectedLines: selected,
                  onSelectedLinesChange: onSelectionChange,
                }
              : null)}
            /* `overflow-y-auto` is load-bearing, not tidying — it is what
               makes this element the virtualizer's scroll container. See the
               component's own doc comment. `overscroll-contain` keeps a flick
               at the end of a file from scrolling the conversation behind it. */
            className="h-full overflow-y-auto overscroll-contain font-mono text-[12.5px] outline-none"
          />
          {commentable && picked ? (
            <button
              type="button"
              data-slot="diff-view-line-comment"
              onClick={comment}
              className={cn(
                "absolute right-3 bottom-3 z-10 inline-flex items-center gap-1.5 rounded-md border bg-popover px-2 py-1 text-[12px] font-medium text-popover-foreground shadow-md outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50",
                classNames?.lineComment
              )}
            >
              <MessageSquarePlus className="size-3.5" />
              Comment on {picked.startLine === picked.endLine
                ? "line"
                : "lines"}{" "}
              {rangeLabel(picked.startLine, picked.endLine)}
            </button>
          ) : null}
        </div>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Many files, one scroller                                                    */
/* -------------------------------------------------------------------------- */

/** One file in a {@link DiffStack} — the same inputs `DiffView` takes. */
export type DiffStackFile = {
  path: string
  language?: string
  patch?: string
  oldText?: string
  newText?: string
  content?: string
}

export type DiffStackProps = Omit<
  React.ComponentProps<"div">,
  "children" | "content"
> & {
  files: DiffStackFile[]
  mode?: DiffViewMode
  wrap?: boolean
  lineNumbers?: boolean
  theme?: DiffViewProps["theme"]
  unsafeCSS?: string
  options?: Partial<CodeViewReactOptions<undefined, undefined>>
  emptyLabel?: React.ReactNode
  /** Scrolls that file to the top of the viewport. Re-request with a new nonce. */
  focusPath?: string
  focusNonce?: number
  classNames?: { root?: string; surface?: string; note?: string }
}

/**
 * Every changed file in one scroller, the way a review reads.
 *
 * `DiffView` answers "show me this file"; this answers "show me what changed",
 * which is a different question with a different shape. A column of separate
 * viewers would be a column of separate *scrollers* — the reader would land in
 * one, scroll it to its end, and stop, with the rest of the review below a
 * boundary the wheel refuses to cross. So this is one `CodeView` holding one
 * item per file: `@pierre/diffs` virtualizes them together against a single
 * scroll container, which is both the only way the wheel behaves and the
 * reason a hundred-file review costs what one screen costs.
 *
 * File headers are on, because in a stack the filename is the only thing
 * saying which file a hunk belongs to.
 */
export function DiffStack({
  files,
  mode = "unified",
  wrap = true,
  lineNumbers = true,
  theme,
  unsafeCSS,
  options,
  emptyLabel = "Nothing has changed here yet.",
  focusPath,
  focusNonce,
  className,
  classNames,
  style,
  ...props
}: DiffStackProps) {
  const { resolvedTheme } = useTheme()
  const dark = resolvedTheme === "dark"

  const css = React.useMemo(
    () => `${TOKEN_CSS}${unsafeCSS ? `\n${unsafeCSS}` : ""}`,
    [unsafeCSS]
  )

  /**
   * One item per file, keyed by path so a re-read of the same worktree does not
   * remount every viewer. A file whose patch could not be parsed keeps its
   * place as text — the same bargain `DiffView` makes — and one with nothing to
   * show at all drops out rather than rendering an empty frame.
   */
  const items = React.useMemo(
    () =>
      files.flatMap((file) => {
        const model = buildModel(
          file.path,
          file.language as SupportedLanguages | undefined,
          file.patch,
          file.oldText,
          file.newText,
          file.content,
          1
        )
        return model.kind === "none" ? [] : [model.item]
      }),
    [files]
  )

  const viewerOptions = useViewerOptions({
    options,
    theme,
    dark,
    wrap,
    mode,
    lineNumbers,
    fileHeader: true,
    css,
    commentable: false,
  })

  const [handle, setHandle] = React.useState<CodeViewHandle<
    undefined,
    undefined
  > | null>(null)

  /** Same one-reveal-per-request rule as `DiffView`'s `focusLine`. */
  const revealKey = focusPath ? `${focusPath}\0${focusNonce ?? ""}` : null
  const revealedRef = React.useRef<string | null>(null)
  React.useEffect(() => {
    if (revealKey === null || !focusPath) return
    if (revealedRef.current === revealKey) return
    if (!handle?.getInstance()) return
    revealedRef.current = revealKey
    handle.scrollTo({ type: "item", id: focusPath, align: "start" })
  }, [focusPath, handle, revealKey])

  return (
    <div
      data-slot="diff-stack"
      data-mode={mode}
      data-wrap={wrap ? "true" : "false"}
      className={cn(
        "flex h-full min-h-0 w-full flex-col overflow-hidden bg-background text-foreground",
        className,
        classNames?.root
      )}
      style={{ colorScheme: dark ? "dark" : "light", ...style }}
      {...props}
    >
      {items.length === 0 ? (
        <p
          data-slot="diff-stack-empty"
          className={cn(
            "px-3 py-2 text-[12.5px] text-muted-foreground",
            classNames?.note
          )}
        >
          {emptyLabel}
        </p>
      ) : (
        <div
          data-slot="diff-stack-surface"
          className={cn("relative min-h-0 flex-1", classNames?.surface)}
        >
          <CodeView<undefined, undefined>
            ref={setHandle}
            items={items}
            options={viewerOptions}
            /* The scroll container, for the same reason `DiffView`'s is — and
               here it is the *only* one, which is the whole point. */
            className="h-full overflow-y-auto overscroll-contain font-mono text-[12.5px] outline-none"
          />
        </div>
      )}
    </div>
  )
}
