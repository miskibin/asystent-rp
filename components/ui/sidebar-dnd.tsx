"use client"

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DndContextProps,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type Modifier,
} from "@dnd-kit/core"
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable"
import { Pin, Trash2 } from "lucide-react"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"

/* -------------------------------------------------------------------------------------------------
 * Zone definitions
 * -----------------------------------------------------------------------------------------------*/

export type SidebarZoneTone = "accent" | "danger" | "muted"
export type SidebarZoneEdge = "top" | "bottom"

/**
 * Declarative description of a drop target. Anything a consumer can drag an item
 * onto — pin, trash, archive, "move to project", … — is just one of these.
 */
export type SidebarDropZoneDef = {
  /** Droppable id. Must be unique within the DnD context. */
  id: string
  /** Text rendered inside the zone while dragging. */
  label: string
  icon?: ReactNode
  tone?: SidebarZoneTone
  /** Render the zone pinned to an edge of the sidebar panel (via `ChatSidebar edgeZones`). */
  edge?: SidebarZoneEdge
  /** Semantic name delivered on `onDrop`. Defaults to the zone id. */
  action?: string
  disabled?: boolean
}

export const SIDEBAR_PIN_ZONE_ID = "sidebar-pin-zone"
export const SIDEBAR_TRASH_ZONE_ID = "sidebar-trash-zone"

/** Prebuilt "drop to pin" zone. Override any field. */
export function pinDropZone(
  overrides: Partial<SidebarDropZoneDef> = {}
): SidebarDropZoneDef {
  return {
    id: SIDEBAR_PIN_ZONE_ID,
    label: "Drop here to pin",
    icon: <Pin className="size-3.5" />,
    tone: "accent",
    edge: "top",
    action: "pin",
    ...overrides,
  }
}

/** Prebuilt "drop to delete" zone. Override any field. */
export function trashDropZone(
  overrides: Partial<SidebarDropZoneDef> = {}
): SidebarDropZoneDef {
  return {
    id: SIDEBAR_TRASH_ZONE_ID,
    label: "Drop here to delete",
    icon: <Trash2 className="size-3.5" />,
    tone: "danger",
    edge: "bottom",
    action: "delete",
    ...overrides,
  }
}

export const DEFAULT_SIDEBAR_ZONES: SidebarDropZoneDef[] = [
  pinDropZone(),
  trashDropZone(),
]

/* -------------------------------------------------------------------------------------------------
 * Drop events
 * -----------------------------------------------------------------------------------------------*/

/** An item was dropped on a zone. `action` is `zone.action ?? zone.id` — e.g. "pin", "delete", "archive". */
export type SidebarZoneDrop = {
  kind: "zone"
  action: string
  itemId: string
  zoneId: string
  zone: SidebarDropZoneDef
}

/** An item was dropped on another item — a reorder inside (or between) registered lists. */
export type SidebarReorderDrop = {
  kind: "reorder"
  action: "reorder"
  itemId: string
  /** List the item was dropped into. */
  listId: string
  /** List the item came from (equal to `listId` for same-list reorders). */
  fromListId: string
  /** Index of the item inside `fromListId`. */
  from: number
  /** Target index inside `listId`. */
  to: number
  /** Id of the item that was dropped on. */
  overId: string
}

/** An item was dropped on a droppable that is neither a zone nor a registered list item. */
export type SidebarCustomDrop = {
  kind: "custom"
  action: "custom"
  itemId: string
  overId: string
}

export type SidebarDndDrop =
  | SidebarZoneDrop
  | SidebarReorderDrop
  | SidebarCustomDrop

/**
 * What dropping here would *do*, when a drag crosses from one list into
 * another — "Pin", "Archive", "Move to Work". The provider only carries it;
 * `resolveDropVerb` decides, and the lifted row renders it.
 */
export type SidebarDropVerb = {
  label: string
  icon?: ReactNode
}

/* -------------------------------------------------------------------------------------------------
 * Context
 * -----------------------------------------------------------------------------------------------*/

type SidebarDndContextValue = {
  /** Id of the item currently being dragged, or null. */
  activeId: string | null
  /** All zones declared on the provider. */
  zones: SidebarDropZoneDef[]
  /** Zones that asked to be rendered on a sidebar edge. */
  edgeZones: SidebarDropZoneDef[]
  registerList: (listId: string, ids: string[]) => void
  unregisterList: (listId: string) => void
  /**
   * Runs the handler at drag release, *before* the commit that clears the drag
   * transforms — the one moment a list can read where its rows actually are.
   * Returns its own unsubscribe.
   */
  registerDragRelease: (handler: () => void) => () => void
}

const noop = () => {}
const noopUnsubscribe = () => noop

const SidebarDndCtx = createContext<SidebarDndContextValue>({
  activeId: null,
  zones: [],
  edgeZones: [],
  registerList: noop,
  unregisterList: noop,
  registerDragRelease: noopUnsubscribe,
})

/**
 * The verb lives in its own context: it changes on every `dragover`, and one
 * badge on the lifted row is the only thing that should re-render for it.
 */
const SidebarDropVerbCtx = createContext<SidebarDropVerb | null>(null)

export function useSidebarDnd() {
  return useContext(SidebarDndCtx)
}

/** The verb for the drag in progress, or null. Read it on the lifted row. */
export function useSidebarDropVerb() {
  return useContext(SidebarDropVerbCtx)
}

/**
 * Registers an ordered list of item ids so the provider can translate an
 * item-on-item drop into `{ action: "reorder", from, to }`. No-op outside a provider.
 */
export function useSidebarDndList(listId: string, itemIds: string[]) {
  const { registerList, unregisterList } = useSidebarDnd()

  // Writing to the ref-backed Map is cheap and never re-renders, so keep it
  // fresh on every commit rather than diffing the id array.
  useEffect(() => {
    registerList(listId, itemIds)
  })

  useEffect(() => () => unregisterList(listId), [listId, unregisterList])
}

/* -------------------------------------------------------------------------------------------------
 * Provider
 * -----------------------------------------------------------------------------------------------*/

export type ChatSidebarDndProps = {
  children: ReactNode
  /** Drop zones available while dragging. Defaults to the pin + trash pair. */
  zones?: SidebarDropZoneDef[]
  /** Fires for every resolved drop (zone, reorder, or custom). */
  onDrop?: (drop: SidebarDndDrop) => void
  /** Convenience hook fired in addition to `onDrop` for reorder drops. */
  onReorder?: (drop: SidebarReorderDrop) => void
  onDragStart?: (itemId: string) => void
  onDragCancel?: () => void
  /** Rendered inside the dnd-kit `DragOverlay` while dragging. */
  renderOverlay?: (itemId: string) => ReactNode
  /**
   * Rejects a drop target while it is still only hovered. Answers are cached
   * per target for the length of one drag, so this may cost real work.
   */
  canDrop?: (itemId: string, overId: string) => boolean
  /**
   * Names what a drop that crosses lists would do, for the badge on the lifted
   * row. Return null for a move that needs no explaining — a reorder inside one
   * list never asks.
   */
  resolveDropVerb?: (
    fromListId: string,
    toListId: string
  ) => SidebarDropVerb | null
  /** Pixels the mouse must travel before a drag starts — keeps clicks working. */
  activationDistance?: number
  /** Long-press duration (ms) before a touch drag starts — keeps the list scrollable. */
  touchDelay?: number
  modifiers?: Modifier[]
  /** Replace the default mouse + touch + keyboard sensors entirely. */
  sensors?: DndContextProps["sensors"]
}

export function ChatSidebarDnd({
  children,
  zones = DEFAULT_SIDEBAR_ZONES,
  onDrop,
  onReorder,
  onDragStart,
  onDragCancel,
  renderOverlay,
  canDrop,
  resolveDropVerb,
  activationDistance = 6,
  touchDelay = 220,
  modifiers,
  sensors,
}: ChatSidebarDndProps) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const [dropVerb, setDropVerb] = useState<SidebarDropVerb | null>(null)

  // Mouse drags start after a few px; touch drags after a short press, so the
  // sidebar keeps scrolling normally on small screens.
  const defaultSensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: { distance: activationDistance },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: touchDelay, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  // Lists register their ordered ids in a ref: reordering must not re-render the tree.
  const listsRef = useRef<Map<string, string[]>>(new Map())
  const registerList = useCallback((listId: string, ids: string[]) => {
    listsRef.current.set(listId, ids)
  }, [])
  const unregisterList = useCallback((listId: string) => {
    listsRef.current.delete(listId)
  }, [])

  const releaseHandlersRef = useRef<Set<() => void>>(new Set())
  const registerDragRelease = useCallback((handler: () => void) => {
    const handlers = releaseHandlersRef.current
    handlers.add(handler)
    return () => {
      handlers.delete(handler)
    }
  }, [])
  const runDragRelease = useCallback(() => {
    for (const handler of releaseHandlersRef.current) handler()
  }, [])

  /** Which registered list holds an id, if any. */
  const listOf = useCallback((id: string) => {
    for (const [listId, ids] of listsRef.current) {
      if (ids.includes(id)) return listId
    }
    return null
  }, [])

  const activeZones = useMemo(
    () => zones.filter((zone) => !zone.disabled),
    [zones]
  )
  const zoneIds = useMemo(
    () => new Set(activeZones.map((zone) => zone.id)),
    [activeZones]
  )
  const edgeZones = useMemo(
    () => activeZones.filter((zone) => zone.edge),
    [activeZones]
  )

  const value = useMemo<SidebarDndContextValue>(
    () => ({
      activeId,
      zones: activeZones,
      edgeZones,
      registerList,
      unregisterList,
      registerDragRelease,
    }),
    [
      activeId,
      activeZones,
      edgeZones,
      registerDragRelease,
      registerList,
      unregisterList,
    ]
  )

  // One answer per target per drag: `canDrop` may walk a real data structure,
  // and a pointer crossing a row asks about it on every move.
  const dropCacheRef = useRef(new Map<string, boolean>())

  /** Zones win whenever the pointer is inside one; items fall back to closest-center. */
  const collisionDetection = useCallback<CollisionDetection>(
    (args) => {
      // A rejected target falls back to the source, never to the next-nearest
      // droppable: sliding past a forbidden row must not silently drop the item
      // two rows further down.
      const reject = (collisions: ReturnType<CollisionDetection>) => {
        if (!canDrop) return collisions
        const nearest = collisions[0]
        if (!nearest || nearest.id === args.active.id) return collisions
        const id = String(nearest.id)
        const cache = dropCacheRef.current
        let valid = cache.get(id)
        if (valid === undefined) {
          valid = canDrop(String(args.active.id), id)
          cache.set(id, valid)
        }
        return valid
          ? collisions
          : collisions.filter((collision) => collision.id === args.active.id)
      }

      if (zoneIds.size === 0) return reject(closestCenter(args))

      // Keyboard dragging has no pointer: let zones compete on distance instead.
      if (!args.pointerCoordinates) return reject(closestCenter(args))

      const zoneHits = pointerWithin(args).filter((hit) =>
        zoneIds.has(String(hit.id))
      )
      if (zoneHits.length > 0) return zoneHits

      return reject(
        closestCenter({
          ...args,
          droppableContainers: args.droppableContainers.filter(
            (container) => !zoneIds.has(String(container.id))
          ),
        })
      )
    },
    [canDrop, zoneIds]
  )

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const id = String(event.active.id)
      dropCacheRef.current = new Map()
      setActiveId(id)
      setDropVerb(null)
      onDragStart?.(id)
    },
    [onDragStart]
  )

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      if (!resolveDropVerb) return
      const overId = event.over ? String(event.over.id) : null
      const itemId = String(event.active.id)
      const fromListId = overId === null ? null : listOf(itemId)
      const toListId = overId === null ? null : listOf(overId)
      const verb =
        fromListId !== null && toListId !== null && fromListId !== toListId
          ? resolveDropVerb(fromListId, toListId)
          : null
      // Same object every frame while the pointer stays in one list.
      setDropVerb((current) =>
        current?.label === verb?.label && current?.icon === verb?.icon
          ? current
          : verb
      )
    },
    [listOf, resolveDropVerb]
  )

  const handleDragCancel = useCallback(() => {
    runDragRelease()
    setActiveId(null)
    setDropVerb(null)
    onDragCancel?.()
  }, [onDragCancel, runDragRelease])

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      // Before React commits the new order: this is the last frame in which the
      // rows still sit where the drag left them.
      runDragRelease()
      setActiveId(null)
      setDropVerb(null)

      const itemId = String(event.active.id)
      const overId = event.over ? String(event.over.id) : null
      if (!overId) return

      const zone = activeZones.find((candidate) => candidate.id === overId)
      if (zone) {
        onDrop?.({
          kind: "zone",
          action: zone.action ?? zone.id,
          itemId,
          zoneId: zone.id,
          zone,
        })
        return
      }

      if (overId === itemId) return

      let fromListId: string | null = null
      let toListId: string | null = null
      let from = -1
      let to = -1
      for (const [listId, ids] of listsRef.current) {
        const fromIndex = ids.indexOf(itemId)
        if (fromIndex !== -1) {
          fromListId = listId
          from = fromIndex
        }
        const toIndex = ids.indexOf(overId)
        if (toIndex !== -1) {
          toListId = listId
          to = toIndex
        }
      }

      if (fromListId !== null && toListId !== null) {
        const drop: SidebarReorderDrop = {
          kind: "reorder",
          action: "reorder",
          itemId,
          listId: toListId,
          fromListId,
          from,
          to,
          overId,
        }
        onReorder?.(drop)
        onDrop?.(drop)
        return
      }

      onDrop?.({ kind: "custom", action: "custom", itemId, overId })
    },
    [activeZones, onDrop, onReorder, runDragRelease]
  )

  return (
    <DndContext
      sensors={sensors ?? defaultSensors}
      modifiers={modifiers}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <SidebarDropVerbCtx.Provider value={dropVerb}>
        <SidebarDndCtx.Provider value={value}>{children}</SidebarDndCtx.Provider>
        <DragOverlay dropAnimation={null}>
          {activeId && renderOverlay ? renderOverlay(activeId) : null}
        </DragOverlay>
      </SidebarDropVerbCtx.Provider>
    </DndContext>
  )
}
