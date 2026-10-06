"use client"

// Adapted from T3 Code (github.com/pingdotgg/t3code), MIT License, (c) 2026 T3 Tools Inc.
import type {
  ContextMenuItem,
  ContextMenuOpenContext,
  FileTreeBatchOperation,
  FileTreeDensity,
  FileTreeIcons,
  GitStatus,
  GitStatusEntry,
} from "@pierre/trees"
import {
  FileTree as PierreFileTree,
  useFileTree,
  useFileTreeSearch,
  useFileTreeSelector,
} from "@pierre/trees/react"
import { Search, X } from "lucide-react"
import { useTheme } from "next-themes"
import * as React from "react"

import type { FileActionItem } from "@/components/ui/change-summary"
import { cn } from "@/lib/utils"

export type FileTreeStatus = GitStatus

export type FileTreeEntry = {
  /** Repository-relative path. A trailing `/` makes it a directory. */
  path: string
  status?: FileTreeStatus
  /** Lines added in this file — shown on the row next to the name. */
  additions?: number
  /** Lines removed in this file. */
  deletions?: number
}

/** The node a menu was opened on. */
export type FileTreeNode = {
  path: string
  name: string
  kind: "file" | "directory"
}

export type FileTreeProps = Omit<
  React.ComponentProps<"div">,
  "children" | "onSelect"
> & {
  /**
   * The files, flat. Directories are inferred from the slashes, so a git status
   * list is a valid tree on its own.
   */
  entries?: readonly FileTreeEntry[]
  /**
   * Lazy mode. Called with `""` for the root and with a directory path — the
   * trailing slash included — the first time the reader opens it. Return that
   * level only: entries whose path ends in `/` become directories that will be
   * asked for in turn.
   */
  loadChildren?: (dir: string) => Promise<readonly FileTreeEntry[]>
  /** The file the host is showing, kept selected. */
  selectedPath?: string | null
  /** Bump it to scroll to `selectedPath` again. */
  revealNonce?: number
  /** Fires when the reader picks a file — never for a directory. */
  onSelect?: (path: string) => void
  /** The type-to-filter box above the tree. */
  search?: boolean
  /** Placeholder in the filter box. */
  searchPlaceholder?: string
  /** Anything to put in the tree's own header row, above the search box. */
  header?: React.ReactNode
  /** Right-click menu per node, built from the shared file-action shape. */
  fileActions?: FileActionItem[]
  /** Full control of the per-node menu; outranks `fileActions`. */
  renderNodeMenu?: (
    node: FileTreeNode,
    context: ContextMenuOpenContext
  ) => React.ReactNode
  /** `"closed"`, `"open"`, or how many levels to open. Defaults to `"open"`. */
  initialExpansion?: "closed" | "open" | number
  /**
   * Pierre's icon set or a custom sprite. Defaults to `complete` with colours:
   * `standard` still assigns type tokens, but Pierre only paints them on
   * `complete`.
   */
  icons?: FileTreeIcons
  /** Row height preset, or a scale factor. Defaults to `"compact"`. */
  density?: FileTreeDensity
  /** Accessible name for the tree. */
  label?: string
  /** Shown instead of the tree when there is nothing in it. */
  emptyLabel?: React.ReactNode
  classNames?: {
    root?: string
    header?: string
    search?: string
    tree?: string
  }
}

/**
 * Tokens Pierre paints when `data-file-tree-colored-icons` is on. Repeated in
 * the unsafe sheet so git status and the selected row colour the name and the
 * A/M/D lane, never the glyph — Pierre fills the sprite from the row's
 * currentColor, which is exactly those tints.
 */
const FILE_ICON_TOKENS = [
  "astro",
  "babel",
  "bash",
  "biome",
  "bootstrap",
  "browserslist",
  "bun",
  "c",
  "cpp",
  "claude",
  "css",
  "database",
  "default",
  "docker",
  "eslint",
  "git",
  "go",
  "graphql",
  "html",
  "image",
  "javascript",
  "json",
  "markdown",
  "mcp",
  "npm",
  "oxc",
  "postcss",
  "prettier",
  "python",
  "react",
  "ruby",
  "rust",
  "sass",
  "svg",
  "svelte",
  "svgo",
  "swift",
  "table",
  "text",
  "tailwind",
  "terraform",
  "typescript",
  "vite",
  "vscode",
  "vue",
  "wasm",
  "webpack",
  "yml",
  "zig",
  "zip",
] as const

const FILE_ICON_COLOR_CSS = FILE_ICON_TOKENS.map(
  (token) =>
    `[data-item-section="icon"] > [data-icon-token="${token}"] { color: var(--trees-file-icon-color-${token}); fill: currentColor; }`
).join("\n")

/**
 * Shadow-root overrides that make the tree read as part of the app chrome.
 * Custom properties inherit across the boundary, so every `var(--…)` here is
 * the page's own token and a theme swap needs no re-render.
 */
const TREE_CSS = `
:host {
  --trees-bg-override: transparent;
  --trees-fg-override: var(--foreground);
  --trees-fg-muted-override: var(--muted-foreground);
  --trees-selected-bg-override: var(--accent);
  --trees-selected-fg-override: var(--accent-foreground);
  --trees-hover-bg-override: color-mix(in srgb, var(--accent) 60%, transparent);
  --trees-border-color-override: var(--border);
  --trees-indent-guide-bg-override: color-mix(in srgb, var(--border) 70%, transparent);
  --trees-focus-ring-color-override: color-mix(in srgb, var(--ring) 50%, transparent);
  --trees-focus-ring-width-override: 3px;
  --trees-font-family-override: var(--font-sans);
  --trees-font-size-override: 12.5px;
  --trees-border-radius-override: 6px;
  --trees-git-added-color-override: var(--chat-diff-added, oklch(0.696 0.17 162.48));
  --trees-git-untracked-color-override: var(--chat-diff-added, oklch(0.696 0.17 162.48));
  --trees-git-deleted-color-override: var(--chat-diff-removed, oklch(0.637 0.237 25.331));
  /* A tint of the theme's primary *through* the foreground, not the primary
     itself. Every row in a "changed files" tree is modified, so painting that
     state the full accent turns the whole list one saturated colour — a
     glowing blue column in the default theme — which distinguishes nothing and
     is the loudest thing in a window whose text is otherwise muted grey. At
     40% the hue still separates a modified file from an untouched one while
     browsing a folder, and the +12 −3 decoration beside it carries the
     detail, which is what the colour was standing in for. */
  --trees-git-modified-color-override: color-mix(in oklab, var(--primary) 40%, var(--foreground));
  --trees-git-renamed-color-override: color-mix(in oklab, var(--primary) 40%, var(--foreground));
  --trees-git-ignored-color-override: var(--muted-foreground);
}

${FILE_ICON_COLOR_CSS}
`

/** `+12 −3`, coloured like every other diff stat in the registry. */
const ADDED_COLOR = "var(--chat-diff-added, oklch(0.696 0.17 162.48))"
const REMOVED_COLOR = "var(--chat-diff-removed, oklch(0.637 0.237 25.331))"

/** `add`/`remove` operations that turn `from` into `to`, in one batch. */
function treeUpdates(
  from: readonly string[],
  to: readonly string[]
): FileTreeBatchOperation[] {
  const previous = new Set(from)
  const next = new Set(to)
  const updates: FileTreeBatchOperation[] = []
  for (const path of next) if (!previous.has(path)) updates.push({ path, type: "add" })
  for (const path of previous) {
    if (!next.has(path)) updates.push({ path, type: "remove", recursive: true })
  }
  return updates
}

/** The menu the tree portals into its own slot, one row per action. */
function NodeMenu({
  node,
  actions,
  close,
}: {
  node: FileTreeNode
  actions: readonly FileActionItem[]
  close: () => void
}) {
  return (
    <div
      data-slot="file-tree-menu"
      role="menu"
      className="min-w-44 overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
    >
      {actions.map((action) => (
        <React.Fragment key={action.id}>
          {action.separatorBefore ? (
            <div aria-hidden className="-mx-1 my-1 h-px bg-border" />
          ) : null}
          <button
            type="button"
            role="menuitem"
            data-action={action.id}
            data-slot="file-tree-menu-item"
            onClick={() => {
              action.onSelect(node.path)
              close()
            }}
            className={cn(
              "flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[12.5px] outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground [&_svg]:size-3.5 [&_svg]:shrink-0",
              action.destructive &&
                "text-destructive hover:bg-destructive/10 hover:text-destructive"
            )}
          >
            {action.icon}
            {action.label}
          </button>
        </React.Fragment>
      ))}
    </div>
  )
}

/**
 * A directory tree over a flat list of files — a git status, a diff's file
 * list, a whole checkout loaded a level at a time. Rows are virtualized by
 * `@pierre/trees`, so a repository with tens of thousands of files scrolls the
 * same as one with ten; keyboard navigation, type-to-filter and per-node menus
 * come with it.
 *
 * The tree owns its scroll container, so give it a height.
 */
export function FileTree({
  entries,
  loadChildren,
  selectedPath = null,
  revealNonce = 0,
  onSelect,
  search = true,
  searchPlaceholder = "Filter files",
  header,
  fileActions,
  renderNodeMenu,
  initialExpansion = "open",
  icons = { set: "complete", colored: true },
  density = "compact",
  label = "Files",
  emptyLabel = "No files.",
  className,
  classNames,
  style,
  ...props
}: FileTreeProps) {
  const { resolvedTheme } = useTheme()
  const lazy = loadChildren != null

  /** Paths loaded lazily, kept out of render so a fetch never re-runs a memo. */
  const [lazyEntries, setLazyEntries] = React.useState<readonly FileTreeEntry[]>(
    []
  )
  const shown = React.useMemo(
    () => (lazy ? lazyEntries : (entries ?? [])),
    [entries, lazy, lazyEntries]
  )

  const paths = React.useMemo(() => shown.map((entry) => entry.path), [shown])
  const gitStatus = React.useMemo<readonly GitStatusEntry[]>(
    () =>
      shown
        .filter((entry) => entry.status != null)
        .map((entry) => ({ path: entry.path, status: entry.status as GitStatus })),
    [shown]
  )
  const stats = React.useMemo(() => {
    const byPath = new Map<string, { additions: number; deletions: number }>()
    for (const entry of shown) {
      if (entry.additions == null && entry.deletions == null) continue
      byPath.set(entry.path, {
        additions: entry.additions ?? 0,
        deletions: entry.deletions ?? 0,
      })
    }
    return byPath
  }, [shown])

  // Read live values from refs: the model is built once, and its callbacks
  // outlive every render that produced them.
  const filesRef = React.useRef<ReadonlySet<string>>(new Set())
  const statsRef = React.useRef(stats)
  const selectRef = React.useRef(onSelect)
  React.useEffect(() => {
    filesRef.current = new Set(paths.filter((path) => !path.endsWith("/")))
    statsRef.current = stats
    selectRef.current = onSelect
  }, [onSelect, paths, stats])

  /** Selection driven by `selectedPath` is an echo, not a request to re-open. */
  const echoingRef = React.useRef(false)

  const { model } = useFileTree({
    paths: [],
    density,
    icons,
    initialExpansion,
    // A directory with nothing under it yet is exactly what lazy mode looks
    // like, so folding it away would hide the level about to arrive.
    flattenEmptyDirectories: !lazy,
    search: false,
    unsafeCSS: TREE_CSS,
    onSelectionChange: (selected) => {
      if (echoingRef.current) return
      const path = selected.at(-1)
      if (path && filesRef.current.has(path)) selectRef.current?.(path)
    },
    renderRowDecoration: ({ item }) => {
      const stat = statsRef.current.get(item.path)
      if (!stat) return null
      const parts = []
      if (stat.additions > 0) {
        parts.push({ text: `+${stat.additions}`, color: ADDED_COLOR })
      }
      if (stat.deletions > 0) {
        parts.push({ text: `−${stat.deletions}`, color: REMOVED_COLOR })
      }
      if (parts.length === 0) return null
      return {
        text: parts.map((part) => part.text).join(" "),
        title: `${stat.additions} added, ${stat.deletions} removed`,
        parts,
      }
    },
  })

  const searchState = useFileTreeSearch(model)
  const visibleCount = useFileTreeSelector(model, (current) =>
    current.getVisibleCount()
  )

  /** Root level, once, and again whenever the loader itself changes. */
  const loadRef = React.useRef(loadChildren)
  React.useEffect(() => {
    loadRef.current = loadChildren
  })
  const loadedRef = React.useRef<Set<string>>(new Set())
  React.useEffect(() => {
    if (!lazy) return
    let live = true
    loadedRef.current = new Set([""])
    void Promise.resolve(loadRef.current?.("") ?? []).then(
      (roots) => {
        if (live) setLazyEntries(roots)
      },
      () => {}
    )
    return () => {
      live = false
    }
  }, [lazy])

  /**
   * Fetch a level the first time its directory opens. The model has no
   * expansion event, so the visible rows are the signal — they already say
   * which directories are open, and they change exactly when one is toggled.
   */
  React.useEffect(() => {
    if (!lazy) return
    return model.subscribe(() => {
      const rows = model.getVisibleRows(0, model.getVisibleCount())
      for (const row of rows) {
        if (row.kind !== "directory" || !row.isExpanded) continue
        const dir = row.path.endsWith("/") ? row.path : `${row.path}/`
        if (loadedRef.current.has(dir)) continue
        loadedRef.current.add(dir)
        void Promise.resolve(loadRef.current?.(dir) ?? []).then(
          (children) => {
            if (children.length === 0) return
            setLazyEntries((current) => {
              const seen = new Set(current.map((entry) => entry.path))
              const added = children.filter((entry) => !seen.has(entry.path))
              return added.length === 0 ? current : [...current, ...added]
            })
          },
          () => {
            // A level that failed can be asked for again on the next open.
            loadedRef.current.delete(dir)
          }
        )
      }
    })
  }, [lazy, model])

  /** Push the path list into the model — a reset first, then batched deltas. */
  const mountedRef = React.useRef<readonly string[] | null>(null)
  React.useEffect(() => {
    const mounted = mountedRef.current
    if (mounted === paths) return
    mountedRef.current = paths
    if (mounted === null) model.resetPaths(paths)
    else {
      const updates = treeUpdates(mounted, paths)
      if (updates.length > 0) model.batch(updates)
    }
    model.setGitStatus(gitStatus)
  }, [gitStatus, model, paths])

  /**
   * Keep the host's file selected and in view. Once per path and nonce, so a
   * list that changes underneath never drags the reader back to it.
   */
  const revealKey = selectedPath === null ? null : `${selectedPath}\0${revealNonce}`
  const revealedRef = React.useRef<string | null>(null)
  React.useEffect(() => {
    if (revealKey === null || selectedPath === null) {
      revealedRef.current = null
      return
    }
    const item = model.getItem(selectedPath)
    if (item === null || item.isDirectory()) {
      // A file that left the list has to be revealed again when it comes back.
      revealedRef.current = null
      return
    }
    if (revealedRef.current === revealKey) return
    revealedRef.current = revealKey
    echoingRef.current = true
    for (const path of model.getSelectedPaths()) {
      if (path !== selectedPath) model.getItem(path)?.deselect()
    }
    let ancestor = ""
    for (const segment of selectedPath.split("/").slice(0, -1)) {
      ancestor += `${segment}/`
      const directory = model.getItem(ancestor)
      if (directory !== null && "expand" in directory) directory.expand()
    }
    item.select()
    model.scrollToPath(selectedPath, { offset: "nearest" })
    queueMicrotask(() => {
      echoingRef.current = false
    })
    // `paths` is a dependency so a file that arrives after it was asked for is
    // still revealed.
  }, [model, paths, revealKey, selectedPath])

  const menuActions = fileActions
  const renderMenu = React.useCallback(
    (item: ContextMenuItem, context: ContextMenuOpenContext) => {
      const node: FileTreeNode = {
        path: item.path,
        name: item.name,
        kind: item.kind,
      }
      if (renderNodeMenu) return renderNodeMenu(node, context)
      if (!menuActions?.length) return null
      return (
        <NodeMenu node={node} actions={menuActions} close={() => context.close()} />
      )
    },
    [menuActions, renderNodeMenu]
  )
  const hasMenu = !!renderNodeMenu || !!fileActions?.length

  // Nothing to show is either an empty list or a filter that matched nothing.
  // Read that way round so the frame before the model has been handed its
  // paths — every visible count starts at zero — says nothing at all.
  const filtering = searchState.value !== ""
  const empty = paths.length === 0 || (filtering && visibleCount === 0)

  const setSearch = searchState.setValue
  const onSearchChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => setSearch(event.target.value),
    [setSearch]
  )
  const clearSearch = React.useCallback(() => setSearch(""), [setSearch])

  return (
    <div
      data-slot="file-tree"
      data-empty={empty || undefined}
      className={cn(
        "flex h-full min-h-0 w-full flex-col overflow-hidden bg-background text-foreground",
        className,
        classNames?.root
      )}
      style={{ colorScheme: resolvedTheme === "dark" ? "dark" : "light", ...style }}
      {...props}
    >
      {header ? (
        <div
          data-slot="file-tree-header"
          className={cn(
            "flex h-9 shrink-0 items-center gap-1 border-b px-2 text-[12px] text-muted-foreground",
            classNames?.header
          )}
        >
          {header}
        </div>
      ) : null}
      {search ? (
        <div
          data-slot="file-tree-search"
          className={cn(
            "relative shrink-0 border-b px-2 py-1.5",
            classNames?.search
          )}
        >
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-4 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <input
            type="search"
            value={searchState.value}
            onChange={onSearchChange}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            className="h-7 w-full rounded-md bg-muted/60 pr-7 pl-7 text-[12.5px] outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 [&::-webkit-search-cancel-button]:hidden"
          />
          {searchState.value ? (
            <button
              type="button"
              data-slot="file-tree-search-clear"
              onClick={clearSearch}
              aria-label="Clear filter"
              className="absolute top-1/2 right-3 inline-flex size-5 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 [&_svg]:size-3.5"
            >
              <X />
            </button>
          ) : null}
        </div>
      ) : null}
      {/* The tree stays mounted and laid out whatever is in it: it measures
          its own container to virtualize, and a hidden one measures zero. */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <PierreFileTree
          model={model}
          aria-label={label}
          {...(hasMenu ? { renderContextMenu: renderMenu } : {})}
          className={cn("min-h-0 flex-1 overflow-hidden", classNames?.tree)}
        />
        {empty ? (
          <p
            data-slot="file-tree-empty"
            className="absolute inset-x-0 top-0 px-3 py-2 text-[12.5px] text-muted-foreground"
          >
            {filtering ? "No matching files." : emptyLabel}
          </p>
        ) : null}
      </div>
    </div>
  )
}
