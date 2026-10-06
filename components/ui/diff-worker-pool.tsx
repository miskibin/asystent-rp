"use client"

// Adapted from T3 Code (github.com/pingdotgg/t3code), MIT License, (c) 2026 T3 Tools Inc.
import { WorkerPoolContext, useWorkerPool } from "@pierre/diffs/react"
import { WorkerPoolManager } from "@pierre/diffs/worker"
import { useTheme } from "next-themes"
import * as React from "react"

import { cn } from "@/lib/utils"
import { PREFERRED_HIGHLIGHTER, diffThemeName } from "@/lib/syntax-highlighting"

/** Idle pool kept alive this long, so closing and reopening a panel is free. */
const IDLE_TTL_MS = 30_000

/** Half the cores, never fewer than two and never more than six. */
function defaultPoolSize() {
  const cores =
    typeof navigator === "undefined"
      ? 4
      : Math.max(1, navigator.hardwareConcurrency || 4)
  return Math.max(2, Math.min(6, Math.floor(cores / 2)))
}

/**
 * The worker the pool spawns. A bundler that understands
 * `new Worker(new URL(…), { type: "module" })` — webpack, Turbopack, Vite —
 * emits the chunk from this; anything else throws here, the pool never starts,
 * and every viewer falls back to the main-thread highlighter.
 */
function defaultWorkerFactory(): Worker {
  return new Worker(
    new URL("@pierre/diffs/worker/worker.js", import.meta.url),
    { type: "module" }
  )
}

type PoolEntry = {
  pool: WorkerPoolManager
  consumers: number
  idleTimer: ReturnType<typeof setTimeout> | undefined
}

/**
 * One pool per page, not per provider: workers are expensive to spawn and the
 * highlight cache inside them is the point of keeping them.
 */
let sharedPool: PoolEntry | undefined

function acquirePool(
  themeName: string,
  poolSize: number,
  workerFactory: () => Worker
): PoolEntry {
  const entry = (sharedPool ??= {
    pool: new WorkerPoolManager(
      { workerFactory, poolSize, totalASTLRUCacheSize: 240 },
      {
        theme: themeName,
        preferredHighlighter: PREFERRED_HIGHLIGHTER,
        tokenizeMaxLineLength: 1_000,
        useTokenTransformer: true,
      }
    ),
    consumers: 0,
    idleTimer: undefined,
  })
  if (entry.idleTimer) clearTimeout(entry.idleTimer)
  entry.idleTimer = undefined
  entry.consumers += 1
  return entry
}

function releasePool(entry: PoolEntry) {
  entry.consumers -= 1
  if (entry.consumers !== 0) return
  entry.idleTimer = setTimeout(() => {
    entry.idleTimer = undefined
    entry.pool.terminate()
    if (sharedPool === entry) sharedPool = undefined
  }, IDLE_TTL_MS)
}

/** Push the page's theme onto workers that were started under the other one. */
function DiffWorkerThemeSync({ themeName }: { themeName: string }) {
  const workerPool = useWorkerPool()

  React.useEffect(() => {
    if (!workerPool) return
    void (async () => {
      try {
        const current = workerPool.getDiffRenderOptions()
        if (current.theme === themeName) return
        await workerPool.setRenderOptions({ ...current, theme: themeName })
      } catch {
        // A pool that cannot be re-themed still renders; it renders in the
        // theme it started in, which beats tearing the panel down.
      }
    })()
  }, [themeName, workerPool])

  return null
}

/**
 * Hold the children back until the workers answer. Without this the first paint
 * of a code surface is unhighlighted and repaints a frame later — visible as a
 * flash of plain text on every panel open.
 */
function DiffWorkerReady({
  children,
  fallback,
}: {
  children?: React.ReactNode
  fallback?: React.ReactNode
}) {
  const workerPool = useWorkerPool()
  const [readyPool, setReadyPool] = React.useState<WorkerPoolManager>()
  const ready = workerPool
    ? readyPool === workerPool ||
      workerPool.isInitialized() ||
      !workerPool.isWorkingPool()
    : typeof window === "undefined"

  React.useEffect(() => {
    if (ready || !workerPool) return
    let mounted = true
    const settle = () => {
      if (mounted) setReadyPool(workerPool)
    }
    // A pool that failed to start resolves the same way: `@pierre/diffs` falls
    // back to its main-thread highlighter, so waiting longer buys nothing.
    void workerPool.initialize().then(settle, settle)
    return () => {
      mounted = false
    }
  }, [ready, workerPool])

  if (ready) return children
  return fallback ?? null
}

export type DiffWorkerPoolProviderProps = {
  children?: React.ReactNode
  /**
   * Workers to spawn. Defaults to half the machine's cores, clamped to 2–6 —
   * enough to keep a scrolling file list highlighted without starving the app.
   */
  poolSize?: number
  /**
   * Replaces how a worker is constructed, for a bundler that cannot follow the
   * built-in `new URL("@pierre/diffs/worker/worker.js", import.meta.url)`.
   */
  workerFactory?: () => Worker
  /** Shown while the workers start. Defaults to a quiet status line. */
  fallback?: React.ReactNode
  className?: string
}

/**
 * Moves syntax highlighting for every `DiffView` under it onto Web Workers.
 * Mount it once, high in the app — the pool is shared, reference counted, and
 * kept warm for 30s after the last panel closes, so opening files in a row
 * spawns workers only the first time.
 *
 * It is optional: a `DiffView` with no provider above it highlights on the main
 * thread instead. Large files are where the difference shows.
 */
export function DiffWorkerPoolProvider({
  children,
  poolSize,
  workerFactory,
  fallback,
  className,
}: DiffWorkerPoolProviderProps) {
  const { resolvedTheme } = useTheme()
  const themeName = diffThemeName(resolvedTheme === "dark" ? "dark" : "light")
  const detectedSize = React.useMemo(() => defaultPoolSize(), [])
  const size = poolSize ?? detectedSize

  // Read through a ref so a caller's inline arrow does not resubscribe — and
  // with it terminate and respawn the pool — on every render.
  const factoryRef = React.useRef(workerFactory)
  React.useEffect(() => {
    factoryRef.current = workerFactory
  })

  const subscribe = React.useCallback(
    (onStoreChange: () => void) => {
      if (typeof window === "undefined") return () => {}
      const entry = acquirePool(themeName, size, () =>
        (factoryRef.current ?? defaultWorkerFactory)()
      )
      onStoreChange()
      return () => releasePool(entry)
    },
    [themeName, size]
  )

  const workerPool = React.useSyncExternalStore(
    subscribe,
    () => sharedPool?.pool,
    () => undefined
  )

  return (
    <WorkerPoolContext value={workerPool}>
      <DiffWorkerThemeSync themeName={themeName} />
      <DiffWorkerReady
        fallback={
          fallback ?? (
            <div
              data-slot="diff-worker-pool-fallback"
              role="status"
              className={cn(
                "flex min-h-0 flex-1 items-center justify-center p-4 text-[12.5px] text-muted-foreground",
                className
              )}
            >
              Loading code…
            </div>
          )
        }
      >
        {children}
      </DiffWorkerReady>
    </WorkerPoolContext>
  )
}
