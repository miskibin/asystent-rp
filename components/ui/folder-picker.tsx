"use client"

import { Check, ChevronDown, Folder, FolderOpen, LoaderCircle } from "lucide-react"
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"

export type FolderPickerClassNames = {
  content?: string
  search?: string
  list?: string
  group?: string
  item?: string
  path?: string
  action?: string
}

export type FolderPickerProps = {
  /** Absolute paths ordered from most to least recently used. */
  recents: string[]
  value?: string
  onChange?: (path: string) => void
  /** Opens the host application's native folder chooser. */
  onOpenFolder?: () => void | Promise<void>
  onOpenChange?: (open: boolean) => void
  detail?: React.ReactNode
  placeholder?: string
  searchPlaceholder?: string
  emptyMessage?: string
  recentsLabel?: string
  openFolderLabel?: string
  disabled?: boolean
  side?: "top" | "bottom"
  variant?: "chip" | "inline"
  classNames?: FolderPickerClassNames
  className?: string
}

function folderName(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "")
  return normalized.split(/[\\/]/).pop() || path
}

export function FolderPicker({
  recents,
  value,
  onChange,
  onOpenFolder,
  onOpenChange,
  detail,
  placeholder = "Choose folder",
  searchPlaceholder = "Search recent folders…",
  emptyMessage = "No recent folders.",
  recentsLabel = "Recents",
  openFolderLabel = "Open Folder",
  disabled = false,
  side = "bottom",
  variant = "chip",
  classNames,
  className,
}: FolderPickerProps) {
  const [open, setOpen] = React.useState(false)
  const [search, setSearch] = React.useState("")
  const [openingFolder, setOpeningFolder] = React.useState(false)

  const handleOpenChange = React.useCallback(
    (next: boolean) => {
      setOpen(next)
      if (next) setSearch("")
      onOpenChange?.(next)
    },
    [onOpenChange]
  )

  const pickFolder = React.useCallback(
    (path: string) => {
      onChange?.(path)
      setOpen(false)
    },
    [onChange]
  )

  const openNativeFolderPicker = React.useCallback(() => {
    if (!onOpenFolder || openingFolder) return
    setOpen(false)
    setOpeningFolder(true)
    // The host reports its own failures; here a rejection only ends the wait.
    Promise.resolve(onOpenFolder())
      .catch(() => {})
      .finally(() => setOpeningFolder(false))
  }, [onOpenFolder, openingFolder])

  const label = value ? folderName(value) : placeholder

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-slot="folder-picker-trigger"
          data-variant={variant}
          data-empty={value ? undefined : ""}
          disabled={disabled}
          title={value ?? placeholder}
          className={cn(
            "group inline-flex h-7 max-w-full min-w-0 items-center gap-1.5 rounded-md px-2 text-[12px] text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 data-[state=open]:bg-muted data-[state=open]:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0",
            variant === "inline" && "border border-border/70 data-[empty]:border-dashed",
            className
          )}
        >
          <Folder className="size-3.5" />
          <span data-slot="folder-picker-label" className="min-w-0 truncate">
            {label}
          </span>
          {detail ? (
            <span
              data-slot="folder-picker-detail"
              className="min-w-0 truncate text-muted-foreground/80"
            >
              · {detail}
            </span>
          ) : null}
          <ChevronDown className="size-3 opacity-60 transition-transform duration-150 group-data-[state=open]:rotate-180" />
        </button>
      </PopoverTrigger>

      <PopoverContent
        data-slot="folder-picker-content"
        align="start"
        side={side}
        sideOffset={8}
        collisionPadding={12}
        className={cn(
          "w-[min(26rem,calc((100vw-1.5rem)/var(--ui-scale,1)))] overflow-hidden p-0",
          classNames?.content
        )}
      >
        <Command loop className="bg-transparent">
          <CommandInput
            data-slot="folder-picker-search"
            autoFocus
            value={search}
            onValueChange={setSearch}
            placeholder={searchPlaceholder}
            className={cn("text-[13px]", classNames?.search)}
          />
          <CommandList
            data-slot="folder-picker-list"
            className={cn("max-h-[min(20rem,50vh)]", classNames?.list)}
          >
            <CommandEmpty className="py-6 text-center text-[12px] text-muted-foreground">
              {emptyMessage}
            </CommandEmpty>
            <CommandGroup
              data-slot="folder-picker-group"
              heading={recentsLabel}
              className={classNames?.group}
            >
              {recents.map((path) => (
                <CommandItem
                  key={path}
                  data-slot="folder-picker-item"
                  value={path}
                  keywords={[folderName(path)]}
                  title={path}
                  onSelect={() => pickFolder(path)}
                  className={cn("gap-2 py-1.5", classNames?.item)}
                >
                  <Folder className="size-4" />
                  <span
                    data-slot="folder-picker-path"
                    className={cn("min-w-0 flex-1 truncate text-[13px]", classNames?.path)}
                  >
                    {path}
                  </span>
                  {path === value ? (
                    <Check
                      data-slot="folder-picker-check"
                      className="size-3.5 shrink-0 !text-primary"
                    />
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>

        <div className="border-t p-1">
          <button
            type="button"
            data-slot="folder-picker-action"
            disabled={!onOpenFolder || openingFolder}
            onClick={openNativeFolderPicker}
            className={cn(
              "flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-[13px] outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0 [&_svg]:text-muted-foreground hover:[&_svg]:text-current",
              classNames?.action
            )}
          >
            {openingFolder ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <FolderOpen className="size-4" />
            )}
            {openFolderLabel}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
