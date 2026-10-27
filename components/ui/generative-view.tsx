"use client"

import { cva } from "class-variance-authority"
import { Check, ChevronDown } from "lucide-react"
import * as React from "react"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { DiffStat } from "@/components/ui/diff-stat"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  formMessage,
  parseViewSpec,
  type ViewAction,
  type ViewInline,
  type ViewItem,
  type ViewNode,
  type ViewSpec,
  type ViewTone,
} from "@/lib/generative-view"
import { cn } from "@/lib/utils"

export type GenerativeViewSlot =
  | "root"
  | "card"
  | "section"
  | "table"
  | "fields"
  | "list"
  | "timeline"
  | "stats"
  | "badge"
  | "form"

/**
 * Tones are the one raw-palette exception, the same one the diff counts and
 * the status dots make: no theme token means "passed" or "needs attention".
 * Info and danger stay on `primary` and `destructive`; both others ship a
 * dark variant.
 */
const badgeVariants = cva(
  "inline-flex h-[18px] shrink-0 items-center gap-1 rounded-full px-2 text-[11px] leading-none font-medium whitespace-nowrap",
  {
    variants: {
      tone: {
        neutral: "bg-muted text-muted-foreground",
        info: "bg-primary/10 text-primary",
        success:
          "bg-emerald-500/10 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-400",
        warning:
          "bg-amber-500/12 text-amber-700 dark:bg-amber-400/10 dark:text-amber-400",
        danger: "bg-destructive/10 text-destructive",
      },
    },
    defaultVariants: { tone: "neutral" },
  }
)

const TONE_TEXT: Record<ViewTone, string> = {
  neutral: "text-muted-foreground",
  info: "text-primary",
  success: "text-emerald-600 dark:text-emerald-400",
  warning: "text-amber-600 dark:text-amber-400",
  danger: "text-destructive",
}

const TONE_FILL: Record<ViewTone, string> = {
  neutral: "bg-muted-foreground/40",
  info: "bg-primary",
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  danger: "bg-destructive",
}

/** Quiet until pointed at: the underline carries the affordance, not a colour. */
const linkClassName =
  "rounded-sm text-foreground underline decoration-foreground/20 underline-offset-[3px] transition-colors hover:decoration-foreground/70 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"

type ClassNames = Partial<Record<GenerativeViewSlot, string>>

/**
 * Per-part class overrides reach nested blocks through context rather than
 * being threaded through every level of the tree.
 */
const ClassNamesContext = React.createContext<ClassNames>({})

function useSlotClass(slot: GenerativeViewSlot) {
  return React.useContext(ClassNamesContext)[slot]
}

type ActionContextValue = {
  onAction?: (action: ViewAction) => void
  /** Drawn, but not yet clickable — the view is still streaming in. */
  pending: boolean
}

const ActionContext = React.createContext<ActionContextValue>({ pending: false })

const controlClassName =
  "w-full min-w-0 rounded-md border border-transparent bg-muted/60 px-2.5 py-1.5 text-[12.5px] transition-colors outline-none placeholder:text-muted-foreground/70 hover:bg-muted focus-visible:border-ring focus-visible:bg-transparent focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60"

const buttonVariants = cva(
  "inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-3 text-[12px] font-medium whitespace-nowrap transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      tone: {
        neutral: "bg-muted/70 text-foreground hover:bg-muted",
        info: "bg-foreground text-background hover:bg-foreground/85",
        success:
          "bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-400",
        warning:
          "bg-amber-500/12 text-amber-700 hover:bg-amber-500/20 dark:text-amber-400",
        danger: "bg-destructive/10 text-destructive hover:bg-destructive/15",
      },
    },
    defaultVariants: { tone: "neutral" },
  }
)

/* ------------------------------------------------------------- inlines -- */

function ViewBadge({ label, tone }: { label: string; tone: ViewTone }) {
  return (
    <span
      data-slot="generative-view-badge"
      data-tone={tone}
      className={cn(badgeVariants({ tone }), useSlotClass("badge"))}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-current opacity-60" />
      {label}
    </span>
  )
}

function ViewLink({ label, href }: { label: string; href: string }) {
  return (
    <a
      data-slot="generative-view-link"
      href={href}
      target="_blank"
      rel="noreferrer"
      className={linkClassName}
    >
      {label}
    </a>
  )
}

function Inline({ value }: { value: ViewInline }) {
  if (typeof value === "string") return <>{value}</>
  if (value.type === "badge") return <ViewBadge label={value.label} tone={value.tone} />
  return <ViewLink label={value.label} href={value.href} />
}

function ItemTitle({ item }: { item: ViewItem }) {
  return item.href ? (
    <ViewLink label={item.title} href={item.href} />
  ) : (
    <span>{item.title}</span>
  )
}

/* -------------------------------------------------------------- blocks -- */

function Card({ node }: { node: Extract<ViewNode, { type: "card" }> }) {
  const slotClass = useSlotClass("card")
  const hasHeader = !!(node.title || node.subtitle || node.status)
  return (
    <section
      data-slot="generative-view-card"
      className={cn(
        "min-w-0 overflow-hidden rounded-xl border border-border/60 bg-card text-card-foreground",
        slotClass
      )}
    >
      {hasHeader ? (
        <header
          data-slot="generative-view-card-header"
          className="flex items-start gap-3 px-4 pt-3.5 pb-1 last:pb-3.5"
        >
          <div className="min-w-0 flex-1">
            {node.title ? (
              <div className="text-[13.5px] leading-snug font-semibold tracking-tight break-words">
                {node.href ? (
                  <ViewLink label={node.title} href={node.href} />
                ) : (
                  node.title
                )}
              </div>
            ) : null}
            {node.subtitle ? (
              <div className="mt-0.5 text-[12px] leading-snug text-muted-foreground">
                {node.subtitle}
              </div>
            ) : null}
          </div>
          {node.status ? (
            <ViewBadge label={node.status.label} tone={node.status.tone} />
          ) : null}
        </header>
      ) : null}
      {node.children.length > 0 ? (
        <div
          data-slot="generative-view-card-body"
          className="space-y-4 px-4 pt-3 pb-4 first:pt-4"
        >
          <Nodes nodes={node.children} />
        </div>
      ) : null}
    </section>
  )
}

function Section({ node }: { node: Extract<ViewNode, { type: "section" }> }) {
  const slotClass = useSlotClass("section")
  const [open, setOpen] = React.useState(!node.collapsed)
  if (!node.title) {
    return (
      <div data-slot="generative-view-section" className={cn("space-y-2", slotClass)}>
        <Nodes nodes={node.children} />
      </div>
    )
  }
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      data-slot="generative-view-section"
      data-state={open ? "open" : "closed"}
      className={cn("min-w-0", slotClass)}
    >
      <CollapsibleTrigger asChild>
        <button
          type="button"
          data-slot="generative-view-section-trigger"
          className="-mx-1 flex cursor-pointer items-center gap-1 rounded-md px-1 py-0.5 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <ChevronDown
            className={cn(
              "size-3 transition-transform duration-150",
              !open && "-rotate-90"
            )}
          />
          {node.title}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 pt-1.5">
        <Nodes nodes={node.children} />
      </CollapsibleContent>
    </Collapsible>
  )
}

function ViewTabs({ node }: { node: Extract<ViewNode, { type: "tabs" }> }) {
  return (
    <Tabs
      defaultValue="0"
      data-slot="generative-view-tabs"
      className="min-w-0 gap-2"
    >
      <TabsList className="h-7 max-w-full overflow-x-auto">
        {node.items.map((item, index) => (
          <TabsTrigger
            key={index}
            value={String(index)}
            className="px-2 py-0.5 text-[12px]"
          >
            {item.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {node.items.map((item, index) => (
        <TabsContent key={index} value={String(index)} className="space-y-2">
          <Nodes nodes={item.children} />
        </TabsContent>
      ))}
    </Tabs>
  )
}

function Fields({ node }: { node: Extract<ViewNode, { type: "fields" }> }) {
  return (
    <dl
      data-slot="generative-view-fields"
      className={cn(
        "grid grid-cols-[minmax(0,max-content)_minmax(0,1fr)] items-baseline gap-x-6 gap-y-1.5 text-[12.5px] leading-relaxed",
        useSlotClass("fields")
      )}
    >
      {node.items.map((item, index) => (
        <React.Fragment key={index}>
          <dt className="truncate text-[12px] text-muted-foreground">
            {item.label}
          </dt>
          <dd className="min-w-0 break-words">
            <Inline value={item.value} />
          </dd>
        </React.Fragment>
      ))}
    </dl>
  )
}

/** Rows shown before "Show all" — a long query result should not bury the answer. */
const TABLE_PREVIEW_ROWS = 15

function Table({ node }: { node: Extract<ViewNode, { type: "table" }> }) {
  const [expanded, setExpanded] = React.useState(false)
  const hasHeader = node.columns.some((column) => column.label)
  const capped = !expanded && node.rows.length > TABLE_PREVIEW_ROWS
  const rows = capped ? node.rows.slice(0, TABLE_PREVIEW_ROWS) : node.rows
  return (
    <div
      data-slot="generative-view-table"
      className={cn(
        "min-w-0",
        useSlotClass("table")
      )}
    >
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[12.5px]">
          {hasHeader ? (
            <thead className="border-b border-border/70 text-[11.5px] text-muted-foreground">
              <tr>
                {node.columns.map((column, index) => (
                  <th
                    key={index}
                    scope="col"
                    className={cn(
                      "px-2.5 pb-1.5 font-medium whitespace-nowrap first:pl-0 last:pr-0",
                      column.align === "end" ? "text-right" : "text-left"
                    )}
                  >
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
          ) : null}
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr
                key={rowIndex}
                className="border-b border-border/40 last:border-0"
              >
                {row.map((cell, cellIndex) => (
                  <td
                    key={cellIndex}
                    className={cn(
                      "px-2.5 py-1.5 align-top first:pl-0 last:pr-0",
                      node.columns[cellIndex]?.align === "end"
                        ? "text-right tabular-nums"
                        : "text-left",
                      cellIndex === 0 && "max-w-[28rem]"
                    )}
                  >
                    <Inline value={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {capped ? (
        <button
          type="button"
          data-slot="generative-view-table-more"
          onClick={() => setExpanded(true)}
          className="mt-1 cursor-pointer rounded-sm text-[11.5px] text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          Show all {node.rows.length} rows
        </button>
      ) : null}
    </div>
  )
}

function List({ node }: { node: Extract<ViewNode, { type: "list" }> }) {
  /* One toned item gives every row a dot column, so titles stay aligned. */
  const dotted = node.items.some((item) => item.tone)
  return (
    <ul
      data-slot="generative-view-list"
      className={cn(
        "divide-y divide-border/40 text-[12.5px] leading-relaxed",
        useSlotClass("list")
      )}
    >
      {node.items.map((item, index) => (
        <li
          key={index}
          data-tone={item.tone}
          className="flex min-w-0 items-start gap-2.5 py-1.5 first:pt-0 last:pb-0"
        >
          {dotted ? (
            <span
              aria-hidden
              className={cn(
                "mt-[0.6em] size-1.5 shrink-0 rounded-full",
                item.tone ? TONE_FILL[item.tone] : "bg-transparent"
              )}
            />
          ) : null}
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-baseline gap-2">
              <span className="min-w-0 flex-1 break-words">
                <ItemTitle item={item} />
              </span>
              {item.meta ? (
                <span className="shrink-0 text-[11.5px] text-muted-foreground">
                  {item.meta}
                </span>
              ) : null}
            </div>
            {item.body ? (
              <p className="text-[12px] whitespace-pre-wrap text-muted-foreground">
                {item.body}
              </p>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  )
}

function Timeline({ node }: { node: Extract<ViewNode, { type: "timeline" }> }) {
  return (
    <ol
      data-slot="generative-view-timeline"
      className={cn(
        "relative ml-[3px] space-y-3 border-l border-border/60 pl-4 text-[12.5px] leading-relaxed",
        useSlotClass("timeline")
      )}
    >
      {node.items.map((item, index) => (
        <li key={index} data-tone={item.tone} className="relative min-w-0">
          <span
            aria-hidden
            className={cn(
              "absolute top-[0.5em] -left-[calc(1rem+4px)] size-[7px] rounded-full ring-[3px] ring-card",
              TONE_FILL[item.tone ?? "neutral"]
            )}
          />
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="min-w-0 flex-1 font-medium break-words">
              <ItemTitle item={item} />
            </span>
            {item.meta ? (
              <span className="shrink-0 text-[11.5px] text-muted-foreground">
                {item.meta}
              </span>
            ) : null}
          </div>
          {item.body ? (
            <p className="mt-0.5 text-[12px] whitespace-pre-wrap text-muted-foreground">
              {item.body}
            </p>
          ) : null}
        </li>
      ))}
    </ol>
  )
}

function Stats({ node }: { node: Extract<ViewNode, { type: "stats" }> }) {
  return (
    <div
      data-slot="generative-view-stats"
      className={cn(
        "grid grid-cols-[repeat(auto-fit,minmax(6.5rem,1fr))] gap-x-6 gap-y-3",
        useSlotClass("stats")
      )}
    >
      {node.items.map((item, index) => (
        <div
          key={index}
          data-slot="generative-view-stat"
          data-tone={item.tone}
          className="min-w-0"
        >
          <div className="truncate text-[11.5px] text-muted-foreground">
            {item.label}
          </div>
          <div
            className={cn(
              "mt-0.5 truncate text-[13.5px] font-semibold tracking-tight tabular-nums",
              item.tone && item.tone !== "neutral" && TONE_TEXT[item.tone]
            )}
          >
            {item.value}
          </div>
          {item.hint ? (
            <div className="truncate text-[11px] text-muted-foreground">
              {item.hint}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  )
}

function Progress({ node }: { node: Extract<ViewNode, { type: "progress" }> }) {
  const percent = Math.round((node.value / node.max) * 100)
  return (
    <div
      data-slot="generative-view-progress"
      data-tone={node.tone}
      className="space-y-1.5"
    >
      <div className="flex items-baseline justify-between gap-2 text-[12px]">
        <span className="truncate text-muted-foreground">{node.label}</span>
        <span className="shrink-0 tabular-nums">
          {node.max === 100 ? `${percent}%` : `${node.value} / ${node.max}`}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={node.label}
        aria-valuemin={0}
        aria-valuemax={node.max}
        aria-valuenow={node.value}
        className="h-1 overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-300",
            node.tone ? TONE_FILL[node.tone] : "bg-foreground/80"
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  )
}

/**
 * One click, one message: a button that has sent stays pressed, so a double
 * click cannot queue the same turn twice. Without a host to send to it is
 * drawn disabled — the view still says what was on offer.
 */
function ViewButton({ node }: { node: Extract<ViewNode, { type: "button" }> }) {
  const { onAction, pending } = React.useContext(ActionContext)
  const [sent, setSent] = React.useState(false)
  return (
    <button
      type="button"
      data-slot="generative-view-button"
      data-state={sent ? "sent" : undefined}
      data-tone={node.tone}
      disabled={!onAction || pending || sent}
      onClick={() => {
        setSent(true)
        onAction?.({ type: "send", text: node.send })
      }}
      className={buttonVariants({ tone: node.tone })}
    >
      {sent ? <Check className="size-3.5" /> : null}
      {node.label}
    </button>
  )
}

function ViewForm({ node }: { node: Extract<ViewNode, { type: "form" }> }) {
  const { onAction, pending } = React.useContext(ActionContext)
  const id = React.useId()
  const [values, setValues] = React.useState<Record<string, string | boolean>>(
    () =>
      Object.fromEntries(
        node.fields.map((field) => [
          field.name,
          field.kind === "checkbox"
            ? field.value === "true"
            : (field.value ?? (field.kind === "select" ? (field.options?.[0] ?? "") : "")),
        ])
      )
  )
  const [sent, setSent] = React.useState(false)
  const locked = !onAction || pending || sent
  const set = (name: string, value: string | boolean) =>
    setValues((current) => ({ ...current, [name]: value }))

  return (
    <form
      data-slot="generative-view-form"
      data-state={sent ? "sent" : undefined}
      onSubmit={(event) => {
        event.preventDefault()
        if (locked) return
        setSent(true)
        onAction?.({ type: "send", text: formMessage(node, values) })
      }}
      className={cn(
        // Framed on its own; inside a card the card is the frame.
        "min-w-0 space-y-3 rounded-xl border border-border/60 p-4 [[data-slot=generative-view-card-body]_&]:rounded-none [[data-slot=generative-view-card-body]_&]:border-0 [[data-slot=generative-view-card-body]_&]:p-0",
        useSlotClass("form")
      )}
    >
      {node.title ? (
        <div className="text-[13px] font-semibold tracking-tight">
          {node.title}
        </div>
      ) : null}
      {node.fields.map((field) => {
        const fieldId = `${id}-${field.name}`
        const value = values[field.name]
        if (field.kind === "checkbox") {
          return (
            <label
              key={field.name}
              htmlFor={fieldId}
              className="flex items-center gap-2 text-[12.5px]"
            >
              <input
                id={fieldId}
                type="checkbox"
                checked={value === true}
                disabled={locked}
                onChange={(event) => set(field.name, event.target.checked)}
                className="size-3.5 accent-primary focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
              />
              {field.label}
            </label>
          )
        }
        return (
          <div key={field.name} className="space-y-1">
            <label
              htmlFor={fieldId}
              className="block text-[11.5px] text-muted-foreground"
            >
              {field.label}
              {field.required ? <span aria-hidden> *</span> : null}
            </label>
            {field.kind === "textarea" ? (
              <textarea
                id={fieldId}
                rows={3}
                required={field.required}
                placeholder={field.placeholder}
                value={typeof value === "string" ? value : ""}
                disabled={locked}
                onChange={(event) => set(field.name, event.target.value)}
                className={cn(controlClassName, "resize-y leading-relaxed")}
              />
            ) : field.kind === "select" ? (
              <select
                id={fieldId}
                required={field.required}
                value={typeof value === "string" ? value : ""}
                disabled={locked}
                onChange={(event) => set(field.name, event.target.value)}
                className={cn(controlClassName, "h-7 py-0")}
              >
                {(field.options ?? []).map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id={fieldId}
                type="text"
                required={field.required}
                placeholder={field.placeholder}
                value={typeof value === "string" ? value : ""}
                disabled={locked}
                onChange={(event) => set(field.name, event.target.value)}
                className={cn(controlClassName, "h-7")}
              />
            )}
          </div>
        )
      })}
      <button
        type="submit"
        data-slot="generative-view-form-submit"
        disabled={locked}
        className={buttonVariants({ tone: "info" })}
      >
        {sent ? <Check className="size-3.5" /> : null}
        {node.submit}
      </button>
    </form>
  )
}

function Block({ node }: { node: ViewNode }) {
  switch (node.type) {
    case "card":
      return <Card node={node} />
    case "section":
      return <Section node={node} />
    case "row":
      return (
        <div
          data-slot="generative-view-row"
          className="flex min-w-0 flex-wrap items-start gap-2 [&>:not([data-slot=generative-view-button])]:min-w-[10rem] [&>:not([data-slot=generative-view-button])]:flex-1"
        >
          <Nodes nodes={node.children} />
        </div>
      )
    case "tabs":
      return <ViewTabs node={node} />
    case "text":
      return (
        <p
          data-slot="generative-view-text"
          data-tone={node.tone}
          className={cn(
            "text-[13px] leading-relaxed break-words whitespace-pre-wrap",
            node.mono && "font-mono text-[12px]",
            node.tone && TONE_TEXT[node.tone]
          )}
        >
          {node.text}
        </p>
      )
    case "badge":
      return (
        <div>
          <ViewBadge label={node.label} tone={node.tone} />
        </div>
      )
    case "link":
      return (
        <div className="text-[13px]">
          <ViewLink label={node.label} href={node.href} />
        </div>
      )
    case "divider":
      return <hr data-slot="generative-view-divider" className="border-border" />
    case "fields":
      return <Fields node={node} />
    case "table":
      return <Table node={node} />
    case "list":
      return <List node={node} />
    case "timeline":
      return <Timeline node={node} />
    case "stats":
      return <Stats node={node} />
    case "progress":
      return <Progress node={node} />
    case "code":
      return (
        <pre
          data-slot="generative-view-code"
          data-lang={node.lang}
          className="m-0 max-h-80 overflow-auto rounded-lg bg-muted/50 px-3 py-2 font-mono text-[12px] leading-relaxed whitespace-pre"
        >
          {node.code}
        </pre>
      )
    case "diffstat":
      return (
        <div>
          <DiffStat additions={node.added} deletions={node.removed} />
        </div>
      )
    case "button":
      return <ViewButton node={node} />
    case "form":
      return <ViewForm node={node} />
    case "unknown":
      return (
        <div
          data-slot="generative-view-unknown"
          className="rounded-lg bg-muted/40 px-3 py-1.5 text-[11.5px] text-muted-foreground"
        >
          Unsupported block “{node.name}”
        </div>
      )
  }
}

function Nodes({ nodes }: { nodes: ViewNode[] }) {
  return nodes.map((node, index) => <Block key={index} node={node} />)
}

/* ---------------------------------------------------------------- public -- */

export type GenerativeViewProps = Omit<React.ComponentProps<"div">, "children"> & {
  /** Normalized blocks — from `parseViewSpec`, `normalizeView` or `jsonToView`. */
  view: ViewSpec
  /** Per-part overrides, applied to every block of that kind in the tree. */
  classNames?: ClassNames
  /**
   * What a button or a form asks for — today, a message to send as the
   * user's next turn. Without it, actions are drawn disabled. Keep it stable:
   * the view is memoized.
   */
  onAction?: (action: ViewAction) => void
  /**
   * The view is still streaming: actions are drawn but not yet clickable, so
   * nothing half-written can be sent.
   */
  pending?: boolean
}

/**
 * Draws a view: a closed vocabulary of display blocks (cards, fields, tables,
 * lists, timelines, stats, progress, tabs…) that an agent composed, or that
 * `jsonToView` read off a tool's JSON. The spec is data — there is nothing in
 * it that can run — so it is safe to render straight from a model's answer.
 *
 * Memoized on `view`: keep the array stable and a streaming list never
 * re-renders it.
 */
export const GenerativeView = React.memo(function GenerativeView({
  view,
  classNames,
  onAction,
  pending = false,
  className,
  ...props
}: GenerativeViewProps) {
  const context = React.useMemo(() => classNames ?? {}, [classNames])
  const actions = React.useMemo(
    () => ({ onAction, pending }),
    [onAction, pending]
  )
  return (
    <ActionContext.Provider value={actions}>
      <ClassNamesContext.Provider value={context}>
        <div
          data-slot="generative-view"
          data-pending={pending || undefined}
          className={cn(
            "min-w-0 space-y-3 text-foreground",
            classNames?.root,
            className
          )}
          {...props}
        >
          <Nodes nodes={view} />
        </div>
      </ClassNamesContext.Provider>
    </ActionContext.Provider>
  )
})

export type GenerativeViewBlockProps = {
  /** The fence's body: JSON for one node or an array of them. */
  code: string
  /** The fence is still streaming in. */
  isIncomplete?: boolean
  /** Forwarded to `GenerativeView`. Keep it stable. */
  onAction?: (action: ViewAction) => void
  className?: string
}

/**
 * A view written into an answer as a ` ```ui ` fence. While the fence is
 * still arriving, its JSON is closed where it stands and drawn — the view
 * grows with the stream, its actions held until the fence ends — and only
 * before anything whole has arrived does it hold a placeholder. Once it
 * closes, JSON that still does not parse shows the reason above its source.
 */
export const GenerativeViewBlock = React.memo(function GenerativeViewBlock({
  code,
  isIncomplete = false,
  onAction,
  className,
}: GenerativeViewBlockProps) {
  const parsed = React.useMemo(
    () => parseViewSpec(code, { partial: isIncomplete }),
    [code, isIncomplete]
  )
  if (parsed.ok) {
    return (
      <GenerativeView
        view={parsed.view}
        onAction={onAction}
        pending={isIncomplete}
        data-state={isIncomplete ? "streaming" : "done"}
        className={cn("my-3", className)}
      />
    )
  }
  if (isIncomplete) {
    return (
      <div
        data-slot="generative-view-pending"
        role="status"
        className={cn(
          "my-3 rounded-xl bg-muted/40 px-4 py-3 text-[12px] text-muted-foreground motion-safe:animate-pulse",
          className
        )}
      >
        Building view…
      </div>
    )
  }
  return (
    <div
      data-slot="generative-view-error"
      className={cn("my-3 overflow-hidden rounded-md border", className)}
    >
      <div className="border-b bg-muted/40 px-2 py-1 text-[11.5px] text-muted-foreground">
        Couldn’t draw this view: {parsed.error}
      </div>
      <pre className="m-0 max-h-60 overflow-auto px-2 py-1.5 font-mono text-[12px] leading-relaxed whitespace-pre-wrap">
        {code}
      </pre>
    </div>
  )
})
