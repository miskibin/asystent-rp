"use client"

import { Check, ChevronDown } from "lucide-react"
import * as React from "react"

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

export type ModelOption = {
  id: string
  name: string
  badge?: string
  description?: string
  meta?: string
  disabled?: boolean
  disabledReason?: string
  /** Id of the ModelPickerGroup this model belongs to. */
  group?: string
  /**
   * Usable context window in tokens. The picker does not render it — it is
   * carried here so a host that already has this list can size a context
   * meter without keeping a second lookup table beside it.
   */
  contextLength?: number
}

export type ModelPickerGroup = {
  id: string
  label: string
  /** Small leading icon for the group heading, e.g. a brand logo. */
  icon?: React.ReactNode
}

export type ModelEffortOption = {
  id: string
  label: string
  description?: string
}

/** Pass this to `efforts` to get the usual four-step reasoning scale. */
export const DEFAULT_MODEL_EFFORTS: ModelEffortOption[] = [
  { id: "low", label: "Low", description: "Fastest, shallowest answers." },
  { id: "medium", label: "Medium", description: "Balanced speed and depth." },
  { id: "high", label: "High", description: "Thinks longer before answering." },
  {
    id: "xhigh",
    label: "Extra High",
    description: "Maximum reasoning budget. Slowest.",
  },
]

export type ModelPickerProps = {
  options: ModelOption[]
  /**
   * Section definitions; order defines section order. Options with an unknown
   * or absent group render first, ungrouped.
   */
  groups?: ModelPickerGroup[]
  value?: string
  defaultValue?: string
  onChange?: (id: string) => void
  /** Reasoning-effort options. `false` (the default) hides the row. */
  efforts?: ModelEffortOption[] | false
  effort?: string
  defaultEffort?: string
  onEffortChange?: (id: string) => void
  placeholder?: string
  searchPlaceholder?: string
  emptyMessage?: string
  disabled?: boolean
  /** Which way the menu opens. Composers open "top", navbars open "bottom". */
  side?: "top" | "bottom"
  /** Row label for the model submenu. */
  label?: string
  /** Row label for the effort submenu. */
  effortLabel?: string
  /** Model counts above this get a search field; at or below it, a plain list. */
  searchThreshold?: number
  className?: string
}

export function ModelPicker({
  options,
  groups,
  value,
  defaultValue,
  onChange,
  efforts = false,
  effort,
  defaultEffort,
  onEffortChange,
  placeholder = "Model",
  searchPlaceholder = "Search models…",
  emptyMessage = "No models found.",
  disabled = false,
  side = "top",
  label = "Model",
  effortLabel = "Effort",
  searchThreshold = 8,
  className,
}: ModelPickerProps) {
  const effortOptions = efforts === false ? null : efforts
  const hasEfforts = Boolean(effortOptions && effortOptions.length > 0)

  const [open, setOpen] = React.useState(false)

  const [internalModel, setInternalModel] = React.useState(
    defaultValue ?? options[0]?.id ?? ""
  )
  const [internalEffort, setInternalEffort] = React.useState(
    defaultEffort ?? effortOptions?.[0]?.id ?? ""
  )

  const selectedId = value ?? internalModel
  // An id that names no option is not a selection: the trigger falls back to
  // the placeholder rather than naming a model no row is checked beside and
  // `onChange` never announced.
  const current = options.find((m) => m.id === selectedId) ?? null

  const selectedEffortId = effort ?? internalEffort
  const currentEffort =
    effortOptions?.find((e) => e.id === selectedEffortId) ?? null

  const pickModel = React.useCallback(
    (option: ModelOption) => {
      if (option.disabled) return
      setInternalModel(option.id)
      onChange?.(option.id)
      setOpen(false)
    },
    [onChange]
  )

  const pickEffort = React.useCallback(
    (option: ModelEffortOption) => {
      setInternalEffort(option.id)
      onEffortChange?.(option.id)
      setOpen(false)
    },
    [onEffortChange]
  )

  const modelList = (
    <ModelList
      options={options}
      groups={groups}
      selectedId={selectedId}
      onPick={pickModel}
      searchable={options.length > searchThreshold}
      searchPlaceholder={searchPlaceholder}
      emptyMessage={emptyMessage}
    />
  )

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-slot="model-picker-trigger"
          disabled={disabled || options.length === 0}
          title="Change model"
          className={cn(
            "group inline-flex h-9 max-w-full min-w-0 items-center gap-1.5 rounded-md px-2 text-[12px] text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 data-[state=open]:bg-muted data-[state=open]:text-foreground sm:h-7 [&_svg]:pointer-events-none [&_svg]:shrink-0",
            className
          )}
        >
          <span className="truncate">{current?.name ?? placeholder}</span>
          {currentEffort ? (
            <span
              data-slot="model-picker-trigger-effort"
              className="shrink-0 opacity-60"
            >
              {currentEffort.label}
            </span>
          ) : null}
          <ChevronDown className="size-3 opacity-60 transition-transform duration-150 group-data-[state=open]:rotate-180" />
        </button>
      </DropdownMenuTrigger>

      {/* One row per thing that can change. Without efforts there is only one
          thing, so the list stands in for the menu instead of hiding behind it. */}
      {hasEfforts ? (
        <DropdownMenuContent
          data-slot="model-picker-content"
          side={side}
          align="start"
          sideOffset={8}
          collisionPadding={12}
          className="w-[min(15rem,calc((100vw-1.5rem)/var(--ui-scale,1)))]"
        >
          <DropdownMenuSub>
            <SectionTrigger label={label} value={current?.name ?? placeholder} />
            <DropdownMenuSubContent
              data-slot="model-picker-list"
              collisionPadding={12}
              className="w-[min(17rem,calc((100vw-1.5rem)/var(--ui-scale,1)))] p-0"
            >
              {modelList}
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuSub>
            <SectionTrigger
              label={effortLabel}
              value={currentEffort?.label ?? "—"}
            />
            <DropdownMenuSubContent
              data-slot="model-picker-effort"
              collisionPadding={12}
              className="w-[min(13rem,calc((100vw-1.5rem)/var(--ui-scale,1)))]"
            >
              {effortOptions?.map((option) => (
                <DropdownMenuItem
                  key={option.id}
                  data-slot="model-picker-effort-item"
                  role="menuitemradio"
                  aria-checked={option.id === selectedEffortId}
                  title={option.description}
                  onSelect={() => pickEffort(option)}
                  className="gap-2 py-1.5 text-[13px]"
                >
                  <span className="flex-1 truncate">{option.label}</span>
                  {option.id === selectedEffortId ? (
                    <Check className="size-3.5 shrink-0" />
                  ) : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      ) : (
        <DropdownMenuContent
          data-slot="model-picker-content"
          side={side}
          align="start"
          sideOffset={8}
          collisionPadding={12}
          className="w-[min(17rem,calc((100vw-1.5rem)/var(--ui-scale,1)))] p-0"
        >
          <div data-slot="model-picker-list">{modelList}</div>
        </DropdownMenuContent>
      )}
    </DropdownMenu>
  )
}

/** `Label ………… value ›` — the one row shape the menu is built from. */
function SectionTrigger({ label, value }: { label: string; value: string }) {
  return (
    <DropdownMenuSubTrigger
      data-slot="model-picker-section"
      className="gap-4 py-1.5 text-[13px]"
    >
      <span className="flex min-w-0 flex-1 items-center justify-between gap-4">
        <span className="shrink-0">{label}</span>
        <span
          data-slot="model-picker-section-value"
          className="truncate text-[12px] text-muted-foreground"
        >
          {value}
        </span>
      </span>
    </DropdownMenuSubTrigger>
  )
}

type ModelListProps = {
  options: ModelOption[]
  groups?: ModelPickerGroup[]
  selectedId: string
  onPick: (option: ModelOption) => void
  searchable: boolean
  searchPlaceholder: string
  emptyMessage: string
}

/**
 * Short lists are plain menu items — Radix's own typeahead is enough. Long ones
 * (a local runtime's whole model directory, say) get cmdk, which owns focus and
 * arrow keys inside the submenu so the menu's typeahead never sees the keys.
 */
function ModelList({
  options,
  groups,
  selectedId,
  onPick,
  searchable,
  searchPlaceholder,
  emptyMessage,
}: ModelListProps) {
  const [search, setSearch] = React.useState("")
  const inputRef = React.useRef<HTMLInputElement>(null)

  // No groups is the common case and stays a flat list, byte for byte as before.
  const sections = React.useMemo(
    () => (groups && groups.length > 0 ? sectionize(options, groups) : null),
    [options, groups]
  )

  React.useEffect(() => {
    if (!searchable) return
    // The menu focuses itself on open; take it back on the next frame.
    const frame = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [searchable])

  if (!searchable) {
    return (
      <div className="p-1">
        {sections
          ? sections.map((section) => (
              <div key={section.key} data-slot="model-picker-group">
                {section.group ? (
                  <GroupHeading
                    group={section.group}
                    className="px-2 py-1.5 text-xs font-medium text-muted-foreground"
                  />
                ) : null}
                {section.options.map((model) => (
                  <ModelMenuItem
                    key={model.id}
                    model={model}
                    selected={model.id === selectedId}
                    onPick={onPick}
                  />
                ))}
              </div>
            ))
          : options.map((model) => (
              <ModelMenuItem
                key={model.id}
                model={model}
                selected={model.id === selectedId}
                onPick={onPick}
              />
            ))}
      </div>
    )
  }

  const match = matches(search)

  return (
    <Command
      loop
      shouldFilter={false}
      className="bg-transparent"
      // cmdk drives the list; the menu's typeahead must not also see the keys.
      onKeyDown={(event) => {
        if (event.key !== "Escape") event.stopPropagation()
      }}
    >
      <CommandInput
        ref={inputRef}
        data-slot="model-picker-search"
        value={search}
        onValueChange={setSearch}
        placeholder={searchPlaceholder}
        className="text-[13px]"
      />
      <CommandList className="max-h-[min(18rem,50vh)] p-1">
        <CommandEmpty className="py-6 text-center text-[12px] text-muted-foreground">
          {emptyMessage}
        </CommandEmpty>
        {sections
          ? sections.map((section) => {
              const visible = section.options.filter((model) =>
                match(model, section.group?.label)
              )
              if (visible.length === 0) return null
              return (
                <CommandGroup
                  key={section.key}
                  data-slot="model-picker-group"
                  heading={
                    section.group ? (
                      <GroupHeading group={section.group} />
                    ) : undefined
                  }
                  // The list already pads; the group only supplies the heading.
                  className="p-0"
                >
                  {visible.map((model) => (
                    <ModelCommandItem
                      key={model.id}
                      model={model}
                      selected={model.id === selectedId}
                      onPick={onPick}
                    />
                  ))}
                </CommandGroup>
              )
            })
          : options
              .filter((model) => match(model))
              .map((model) => (
                <ModelCommandItem
                  key={model.id}
                  model={model}
                  selected={model.id === selectedId}
                  onPick={onPick}
                />
              ))}
      </CommandList>
    </Command>
  )
}

type ModelSection = {
  key: string
  group: ModelPickerGroup | null
  options: ModelOption[]
}

/** React key for the headingless leading section; not a group id. */
const UNGROUPED_KEY = "__ungrouped__"

/**
 * Sections in `groups` order. Options with an unknown or absent group keep
 * their relative order and lead the list without a heading, so a partly
 * grouped list still shows everything. A repeated group id renders once.
 */
function sectionize(
  options: ModelOption[],
  groups: ModelPickerGroup[]
): ModelSection[] {
  const buckets = new Map<string, ModelOption[]>()
  for (const group of groups) {
    if (!buckets.has(group.id)) buckets.set(group.id, [])
  }
  const ungrouped: ModelOption[] = []
  for (const option of options) {
    const bucket = option.group ? buckets.get(option.group) : undefined
    if (bucket) bucket.push(option)
    else ungrouped.push(option)
  }

  const sections: ModelSection[] = ungrouped.length
    ? [{ key: UNGROUPED_KEY, group: null, options: ungrouped }]
    : []
  for (const group of groups) {
    const bucket = buckets.get(group.id)
    if (!bucket?.length) continue
    buckets.delete(group.id)
    sections.push({ key: group.id, group, options: bucket })
  }
  return sections
}

/** Icon, then label — the same content in both render branches. */
function GroupHeading({
  group,
  className,
}: {
  group: ModelPickerGroup
  className?: string
}) {
  return (
    <span
      data-slot="model-picker-group-heading"
      className={cn(
        "flex items-center gap-1.5 [&_svg]:size-3.5 [&_svg]:shrink-0",
        className
      )}
    >
      {group.icon}
      <span className="truncate">{group.label}</span>
    </span>
  )
}

type ModelItemProps = {
  model: ModelOption
  selected: boolean
  onPick: (option: ModelOption) => void
}

function ModelMenuItem({ model, selected, onPick }: ModelItemProps) {
  return (
    <DropdownMenuItem
      data-slot="model-picker-item"
      role="menuitemradio"
      aria-checked={selected}
      disabled={model.disabled}
      title={rowTitle(model)}
      onSelect={() => onPick(model)}
      className="gap-2 py-1.5 text-[13px]"
    >
      <ModelRow model={model} selected={selected} />
    </DropdownMenuItem>
  )
}

function ModelCommandItem({ model, selected, onPick }: ModelItemProps) {
  return (
    <CommandItem
      data-slot="model-picker-item"
      value={model.id}
      disabled={model.disabled}
      title={rowTitle(model)}
      onSelect={() => onPick(model)}
      className="gap-2 py-1.5 text-[13px]"
    >
      <ModelRow model={model} selected={selected} />
    </CommandItem>
  )
}

function rowTitle(model: ModelOption) {
  return (
    [model.description, model.disabledReason].filter(Boolean).join(" · ") ||
    undefined
  )
}

/** Substring match over everything the row can show, not just the name. */
function matches(
  search: string
): (model: ModelOption, groupLabel?: string) => boolean {
  const needle = search.trim().toLowerCase()
  if (!needle) return () => true
  return (model, groupLabel) =>
    [model.name, model.badge, model.description, model.meta, groupLabel]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(needle)
}

function ModelRow({
  model,
  selected,
}: {
  model: ModelOption
  selected: boolean
}) {
  return (
    <>
      <span className="min-w-0 flex-1 truncate">{model.name}</span>
      {model.badge ? (
        <span
          data-slot="model-picker-badge"
          className="shrink-0 text-[11px] text-muted-foreground"
        >
          {model.badge}
        </span>
      ) : null}
      {model.meta ? (
        <span
          data-slot="model-picker-meta"
          className="shrink-0 text-[11px] text-muted-foreground tabular-nums"
        >
          {model.meta}
        </span>
      ) : null}
      {selected && !model.disabled ? (
        <Check className="size-3.5 shrink-0" />
      ) : null}
    </>
  )
}
