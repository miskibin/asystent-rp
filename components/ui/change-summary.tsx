"use client"

import { MoreHorizontal } from "lucide-react"
import * as React from "react"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { FileIcon } from "@/components/ui/file-icon"
import { cn } from "@/lib/utils"

export type ChangeSummaryFile = {
  path: string
  additions?: number
  deletions?: number
}

export type ChangeSummaryTool = {
  name: string
  status?: "pending" | "running" | "done" | "error"
  input?: string
  output?: string
}

/**
 * One entry of the right-click menu a host attaches to anything that names a
 * file — a change-summary row, the file panel's header, a path chip or an
 * image in an answer. The host gets the path back and decides what "open" or
 * "reveal" means on its machine; the components only know how to show the
 * menu. Keep the array stable: the rows holding it are memoized.
 */
export type FileActionItem = {
  id: string
  label: string
  icon?: React.ReactNode
  onSelect: (path: string) => void
  destructive?: boolean
  separatorBefore?: boolean
}

export type FileContextMenuProps = {
  /** The path handed to every action. */
  path: string
  /** Nothing to show → the children render as they are, without a menu. */
  actions?: FileActionItem[]
  children: React.ReactNode
}

/**
 * Wraps a trigger in the shadcn context menu, one item per action. Shared by
 * the change-summary rows, the file panel and the markdown chips so every
 * file in the UI answers a right-click the same way.
 */
export function FileContextMenu({
  path,
  actions,
  children,
}: FileContextMenuProps) {
  if (!actions?.length) return <>{children}</>
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent
        data-slot="file-context-menu"
        data-path={path}
        className="min-w-44"
      >
        {actions.map((action) => (
          <React.Fragment key={action.id}>
            {action.separatorBefore ? <ContextMenuSeparator /> : null}
            <ContextMenuItem
              data-action={action.id}
              variant={action.destructive ? "destructive" : "default"}
              onSelect={() => action.onSelect(path)}
              className="text-[12.5px]"
            >
              {action.icon}
              {action.label}
            </ContextMenuItem>
          </React.Fragment>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  )
}

export type ChangeSummaryProps = Omit<React.ComponentProps<"div">, "title"> & {
  files: ChangeSummaryFile[]
  /** Defaults to “N Files Changed”. */
  title?: React.ReactNode
  actionLabel?: React.ReactNode
  onAction?: () => void
  /** Makes every file row a button — open the file in a preview panel. */
  onFileClick?: (file: ChangeSummaryFile) => void
  /** Right-click menu on every row — open in an editor, reveal, copy the path. */
  fileActions?: FileActionItem[]
  /** How many files to show before “Show N more”. */
  previewCount?: number
}

export type WorkedForProps = React.ComponentProps<"span"> & {
  /** Elapsed seconds for the finished turn. */
  seconds: number
}

/** Quiet text button shared by Review and “Show N more”. */
const changeSummaryAction =
  "inline-flex shrink-0 items-center gap-1.5 rounded-sm text-[13px] text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 [&_svg]:pointer-events-none [&_svg]:shrink-0"

function fileName(path: string) {
  const trimmed = path.replace(/[\\/]+$/, "")
  return trimmed.split(/[\\/]/).pop() || path
}

/**
 * Coarse kind, exposed as `data-kind` so a host can style rows by family. The
 * glyph itself comes from `FileIcon`, which knows the file type in far more
 * detail than these four buckets do.
 */
function fileKind(path: string) {
  const ext = fileName(path).split(".").pop()?.toLowerCase()
  if (ext === "css" || ext === "scss" || ext === "less") return "style"
  if (ext === "json" || ext === "jsonc") return "data"
  if (
    ext === "ts" ||
    ext === "tsx" ||
    ext === "js" ||
    ext === "jsx" ||
    ext === "mts" ||
    ext === "cts"
  ) {
    return "code"
  }
  return "text"
}

/** +/- is the one raw-palette exception: no theme token means "grew". */
function DiffStats({
  additions = 0,
  deletions = 0,
}: {
  additions?: number
  deletions?: number
}) {
  if (additions === 0 && deletions === 0) return null
  return (
    <span
      data-slot="change-summary-stats"
      className="inline-flex shrink-0 items-center gap-1.5 font-mono text-[12px] tabular-nums"
    >
      {additions > 0 ? (
        <span className="text-emerald-600 dark:text-emerald-400">
          +{additions}
        </span>
      ) : null}
      {deletions > 0 ? (
        <span className="text-red-500 dark:text-red-400">-{deletions}</span>
      ) : null}
    </span>
  )
}

function FileRow({
  file,
  onSelect,
  actions,
}: {
  file: ChangeSummaryFile
  onSelect?: (file: ChangeSummaryFile) => void
  actions?: FileActionItem[]
}) {
  const kind = fileKind(file.path)
  const select = React.useCallback(() => onSelect?.(file), [file, onSelect])
  const content = (
    <>
      <FileIcon
        data-slot="change-summary-file-icon"
        path={file.path}
        size={14}
      />
      <span className="min-w-0 flex-1 truncate text-left" title={file.path}>
        {fileName(file.path)}
      </span>
      <DiffStats additions={file.additions} deletions={file.deletions} />
    </>
  )
  // `text-foreground` sits on the row, not on the name: the interactive row
  // repaints itself `text-accent-foreground` on hover, and a child that pins
  // its own colour is exactly how a theme whose accent is near-white in dark
  // mode ends up drawing white on white.
  const shared =
    "flex min-w-0 items-center gap-2 py-[3px] text-[13px] leading-snug text-foreground"

  // Without a handler the row stays the plain, non-interactive line it was.
  const row = onSelect ? (
    <button
      type="button"
      data-slot="change-summary-file"
      data-kind={kind}
      data-interactive="true"
      onClick={select}
      className={cn(
        shared,
        "-mx-1 w-[calc(100%+0.5rem)] cursor-pointer rounded-sm px-1 outline-none transition-colors",
        "hover:bg-accent hover:text-accent-foreground",
        "focus-visible:ring-[3px] focus-visible:ring-ring/50"
      )}
    >
      {content}
    </button>
  ) : (
    /* Not a control, but with a menu attached it still has to be reachable:
       focused, Shift+F10 and the Menu key open it. */
    <div
      data-slot="change-summary-file"
      data-kind={kind}
      tabIndex={actions?.length ? 0 : undefined}
      className={cn(
        shared,
        actions?.length &&
          "-mx-1 w-[calc(100%+0.5rem)] rounded-sm px-1 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      )}
    >
      {content}
    </div>
  )

  return (
    <FileContextMenu path={file.path} actions={actions}>
      {row}
    </FileContextMenu>
  )
}

/** Compact “Worked for 12s” label shown after a turn finishes. */
export function WorkedFor({ seconds, className, ...props }: WorkedForProps) {
  return (
    <span
      data-slot="worked-for"
      className={cn("text-[12px] text-muted-foreground", className)}
      {...props}
    >
      {formatWorkedFor(seconds)}
    </span>
  )
}

export function formatWorkedFor(seconds: number) {
  const total = Math.max(0, Math.round(seconds))
  if (total < 1) return "Worked for a moment"
  if (total < 60) return `Worked for ${total}s`
  const minutes = Math.floor(total / 60)
  const rem = total % 60
  if (total < 3600) {
    return rem > 0 ? `Worked for ${minutes}m ${rem}s` : `Worked for ${minutes}m`
  }
  const hours = Math.floor(total / 3600)
  const mins = Math.floor((total % 3600) / 60)
  return mins > 0 ? `Worked for ${hours}h ${mins}m` : `Worked for ${hours}h`
}

/**
 * Collapsed review card: file count, optional Review action, a few rows, then
 * “Show N more”. Memoized — it sits at the end of a settled turn that a
 * streaming sibling re-renders often.
 */
export const ChangeSummary = React.memo(function ChangeSummary({
  files,
  title,
  actionLabel = "Review",
  onAction,
  onFileClick,
  fileActions,
  previewCount = 4,
  className,
  ...props
}: ChangeSummaryProps) {
  const [expanded, setExpanded] = React.useState(false)
  const count = files.length

  const heading = title ?? `${count} ${count === 1 ? "File" : "Files"} Changed`
  const preview = files.slice(0, previewCount)
  const rest = files.slice(previewCount)
  const hidden = rest.length

  if (count === 0) return null

  return (
    <div
      data-slot="change-summary"
      data-state={hidden === 0 || expanded ? "expanded" : "collapsed"}
      className={cn(
        "w-full max-w-md rounded-lg border bg-card px-3.5 py-3 text-card-foreground",
        className
      )}
      {...props}
    >
      <div
        data-slot="change-summary-header"
        className="mb-1.5 flex items-baseline justify-between gap-3"
      >
        <span className="text-[13px] font-medium tracking-tight">{heading}</span>
        {onAction ? (
          <button
            type="button"
            data-slot="change-summary-action"
            onClick={onAction}
            className={changeSummaryAction}
          >
            {actionLabel}
          </button>
        ) : (
          <span
            data-slot="change-summary-action"
            className="shrink-0 text-[13px] text-muted-foreground"
          >
            {actionLabel}
          </span>
        )}
      </div>

      <div data-slot="change-summary-list" className="flex flex-col">
        {preview.map((file) => (
          <FileRow
            key={file.path}
            file={file}
            onSelect={onFileClick}
            actions={fileActions}
          />
        ))}
      </div>

      {hidden > 0 ? (
        <Collapsible open={expanded} onOpenChange={setExpanded}>
          <CollapsibleContent>
            <div data-slot="change-summary-rest" className="flex flex-col">
              {rest.map((file) => (
                <FileRow
                  key={file.path}
                  file={file}
                  onSelect={onFileClick}
                  actions={fileActions}
                />
              ))}
            </div>
          </CollapsibleContent>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              data-slot="change-summary-more"
              className={cn(changeSummaryAction, "mt-0.5 py-0.5")}
            >
              <MoreHorizontal className="size-3.5 opacity-70" />
              {expanded ? "Show less" : `Show ${hidden} more`}
            </button>
          </CollapsibleTrigger>
        </Collapsible>
      ) : null}
    </div>
  )
})

function parseArgs(input?: string): Record<string, unknown> {
  if (!input?.trim()) return {}
  try {
    const value = JSON.parse(input) as unknown
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>
    }
  } catch {
    /* raw */
  }
  return {}
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined
}

function isFileMutationTool(name: string) {
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

function parseOutputStats(output?: string) {
  if (!output) return { additions: 0, deletions: 0 }
  const added = output.match(/\+(\d+)/)
  const removed = output.match(/[-−](\d+)/)
  return {
    additions: added ? Number(added[1]) : 0,
    deletions: removed ? Number(removed[1]) : 0,
  }
}

function countUnifiedDiff(patch?: string) {
  if (!patch) return { additions: 0, deletions: 0 }
  let additions = 0
  let deletions = 0
  for (const line of patch.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue
    if (line.startsWith("+")) additions++
    else if (line.startsWith("-")) deletions++
  }
  return { additions, deletions }
}

/** Pull Edit / Write / ApplyPatch tools into the card’s file list. */
export function fileChangesFromTools(
  tools: ChangeSummaryTool[]
): ChangeSummaryFile[] {
  const byPath = new Map<string, ChangeSummaryFile>()

  for (const tool of tools) {
    if (tool.status && tool.status !== "done") continue
    if (!isFileMutationTool(tool.name)) continue
    const args = parseArgs(tool.input)
    const path =
      asString(args.path) ??
      asString(args.filePath) ??
      asString(args.target_file) ??
      asString(args.file)
    if (!path) continue

    const fromOutput = parseOutputStats(tool.output)
    const fromDiff = countUnifiedDiff(
      asString(args.diff) ?? asString(args.patch) ?? asString(args.diffString)
    )
    const additions = fromOutput.additions || fromDiff.additions
    const deletions = fromOutput.deletions || fromDiff.deletions
    const existing = byPath.get(path)
    if (existing) {
      existing.additions = (existing.additions ?? 0) + additions
      existing.deletions = (existing.deletions ?? 0) + deletions
    } else {
      byPath.set(path, { path, additions, deletions })
    }
  }

  return [...byPath.values()]
}
