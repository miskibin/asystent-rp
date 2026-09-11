"use client"

import { cva } from "class-variance-authority"
import { Check, ChevronDown, CircleHelp } from "lucide-react"
import * as React from "react"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"

export const ASK_OTHER_ID = "other"

export type AskQuestionOption = {
  id: string
  label: string
}

export type AskQuestionItem = {
  id: string
  prompt: string
  options: AskQuestionOption[]
  allowMultiple?: boolean
}

export type AskQuestionSelection = {
  optionIds: string[]
  other?: string
}

export type AskQuestionResult = {
  skipped: boolean
  answers: Record<string, AskQuestionSelection>
  /**
   * Who closed the questions. `"agent"` (the default when a result carries no
   * marker) covers backends that answer their own ask tool — a headless CLI
   * auto-skipping it, say — and those stay answerable in the UI.
   */
  source?: "user" | "agent"
}

export type AskQuestionProps = {
  title?: string
  questions: AskQuestionItem[]
  /** Controlled selections keyed by question id. */
  value?: Record<string, AskQuestionSelection>
  defaultValue?: Record<string, AskQuestionSelection>
  onChange?: (value: Record<string, AskQuestionSelection>) => void
  onSubmit?: (result: AskQuestionResult) => void
  onSkip?: () => void
  /** Hide the built-in Other… option on every question. */
  hideOther?: boolean
  disabled?: boolean
  defaultOpen?: boolean
  skipLabel?: string
  submitLabel?: string
  className?: string
}

const EMPTY_SELECTION: AskQuestionSelection = { optionIds: [] }

/** Same quiet disclosure header the other agent-turn cards use. */
const askQuestionTrigger =
  "flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-[13px] text-muted-foreground outline-none transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset [&_svg]:pointer-events-none [&_svg]:shrink-0"

const askQuestionActionVariants = cva(
  "h-8 rounded-md px-3 text-[13px] font-medium outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        ghost: "text-muted-foreground hover:bg-muted hover:text-foreground",
        primary: "bg-primary text-primary-foreground hover:bg-primary/90",
      },
    },
    defaultVariants: { variant: "ghost" },
  }
)

const askQuestionIndicatorVariants = cva(
  "grid size-4 shrink-0 place-items-center border transition-colors",
  {
    variants: {
      shape: {
        radio: "rounded-full",
        checkbox: "rounded-[4px]",
      },
      selected: {
        true: "border-primary",
        false: "border-input bg-background",
      },
    },
    compoundVariants: [
      {
        shape: "checkbox",
        selected: true,
        class: "bg-primary text-primary-foreground",
      },
    ],
    defaultVariants: { shape: "radio", selected: false },
  }
)

function optionLabel(option: AskQuestionOption) {
  return option.label.replace(/\s*\(Recommended\)\s*$/i, "")
}

function isRecommended(option: AskQuestionOption) {
  return /\(Recommended\)\s*$/i.test(option.label)
}

function withOther(
  question: AskQuestionItem,
  hideOther: boolean
): AskQuestionOption[] {
  if (hideOther) return question.options
  const hasOther = question.options.some(
    (option) =>
      option.id === ASK_OTHER_ID || /^other\b/i.test(option.label.trim())
  )
  if (hasOther) return question.options
  return [...question.options, { id: ASK_OTHER_ID, label: "Other…" }]
}

function isAnswered(selection: AskQuestionSelection | undefined) {
  return (selection?.optionIds.length ?? 0) > 0
}

function selectionsComplete(
  questions: AskQuestionItem[],
  value: Record<string, AskQuestionSelection>
) {
  return questions.every((question) => isAnswered(value[question.id]))
}

export function isAskToolName(name: string) {
  const kind = name.replace(/[\s_-]+/g, "").toLowerCase()
  return (
    kind === "askquestion" ||
    kind === "ask" ||
    kind === "askuser" ||
    kind === "askuserquestion" ||
    kind === "questions"
  )
}

export function isPendingAskTool(tool: { name: string; status?: string }) {
  return (
    isAskToolName(tool.name) &&
    (tool.status === "pending" || tool.status === "running")
  )
}

/**
 * An ask with no answer on it: in flight, or already closed by the agent
 * without a single selection. Headless backends resolve their own ask tool the
 * moment they emit it, so keying the form off `isPendingAskTool` alone means
 * the questions flash past and land as an unanswerable "No selection" summary.
 *
 * Unanswered is not the same as actionable — an agent-closed ask three turns
 * back is history, not a prompt. Only the caller knows where the tool sits, so
 * `MessageList` offers the form on the latest turn only, and `MessageToolCall`
 * follows the `onAskAnswer` handler it is given.
 */
export function isOpenAskTool(tool: {
  name: string
  status?: string
  input?: string
  output?: string
}) {
  if (!isAskToolName(tool.name)) return false
  if (tool.status === "pending" || tool.status === "running") return true
  if (tool.status === "error") return false
  if (!parseAskQuestionInput(tool.input)) return false
  const result = parseAskQuestionResult(tool.output)
  // No parsable result at all, or the agent closed it with nothing picked.
  return (
    result === null ||
    (result.source !== "user" && Object.keys(result.answers).length === 0)
  )
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function parseOptions(value: unknown): AskQuestionOption[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item, index) => {
    if (typeof item === "string" && item.trim()) {
      return [{ id: `opt-${index}`, label: item.trim() }]
    }
    const record = asRecord(item)
    if (!record) return []
    const label =
      typeof record.label === "string"
        ? record.label
        : typeof record.title === "string"
          ? record.title
          : typeof record.text === "string"
            ? record.text
            : ""
    if (!label.trim()) return []
    const id =
      typeof record.id === "string" && record.id.trim()
        ? record.id
        : `opt-${index}`
    return [{ id, label: label.trim() }]
  })
}

function parseQuestions(value: unknown): AskQuestionItem[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item, index) => {
    const record = asRecord(item)
    if (!record) return []
    const prompt =
      typeof record.prompt === "string"
        ? record.prompt
        : typeof record.question === "string"
          ? record.question
          : typeof record.text === "string"
            ? record.text
            : ""
    const options = parseOptions(record.options)
    if (!prompt.trim() || options.length < 2) return []
    const id =
      typeof record.id === "string" && record.id.trim()
        ? record.id
        : `q-${index}`
    const allowMultiple = Boolean(record.allowMultiple ?? record.allow_multiple)
    return [{ id, prompt: prompt.trim(), options, allowMultiple }]
  })
}

/** Read Cursor AskQuestion tool args (`title` + `questions`) from a JSON string. */
export function parseAskQuestionInput(input?: string): {
  title?: string
  questions: AskQuestionItem[]
} | null {
  if (!input?.trim()) return null
  try {
    const value = JSON.parse(input) as unknown
    const record = asRecord(value)
    const questions = parseQuestions(
      Array.isArray(value) ? value : record?.questions
    )
    if (questions.length === 0) return null
    const title =
      typeof record?.title === "string" && record.title.trim()
        ? record.title.trim()
        : undefined
    return { title, questions }
  } catch {
    return null
  }
}

/** Exactly what older versions of this component wrote for a Skip. */
const LEGACY_SKIP_OUTPUT = "Questions skipped"

export function parseAskQuestionResult(
  output?: string
): AskQuestionResult | null {
  if (!output?.trim()) return null
  // Matched literally, not by keyword: an agent's own free-text "skipped the
  // questions" is not a user decision and must stay answerable.
  if (output.trim() === LEGACY_SKIP_OUTPUT) {
    return { skipped: true, answers: {}, source: "user" }
  }
  if (/skip/i.test(output) && !output.trim().startsWith("{")) {
    return { skipped: true, answers: {} }
  }
  try {
    const value = JSON.parse(output) as unknown
    const record = asRecord(value)
    if (!record) return null
    const source = record.source === "user" ? ("user" as const) : undefined
    if (record.skipped === true) {
      return { skipped: true, answers: {}, source }
    }
    const nested = asRecord(record.answers)
    const answersRecord = nested ?? record
    const answers: Record<string, AskQuestionSelection> = {}
    for (const [key, item] of Object.entries(answersRecord)) {
      // Only the flat fallback shape can collide with the result's own keys;
      // under `answers` they are question ids and `source` is a valid one.
      if (!nested && (key === "skipped" || key === "source")) continue
      if (Array.isArray(item)) {
        answers[key] = {
          optionIds: item.filter((id): id is string => typeof id === "string"),
        }
        continue
      }
      const entry = asRecord(item)
      if (!entry) continue
      const optionIds = Array.isArray(entry.optionIds)
        ? entry.optionIds.filter((id): id is string => typeof id === "string")
        : []
      const other =
        typeof entry.other === "string" && entry.other.trim()
          ? entry.other
          : undefined
      if (optionIds.length > 0 || other) {
        answers[key] = { optionIds, other }
      }
    }
    return { skipped: false, answers, source }
  } catch {
    return null
  }
}

/**
 * The stored form of a result the user produced. The `source` marker is what
 * tells a reload apart from an ask the agent closed on its own — see
 * `isOpenAskTool`.
 */
export function formatAskQuestionOutput(result: AskQuestionResult) {
  return JSON.stringify({ ...result, source: "user" }, null, 2)
}

function selectedLabels(
  question: AskQuestionItem,
  selection: AskQuestionSelection | undefined,
  hideOther: boolean
) {
  if (!selection?.optionIds.length) return []
  const options = withOther(question, hideOther)
  return selection.optionIds.map((id) => {
    if (id === ASK_OTHER_ID) {
      return selection.other?.trim()
        ? `Other: ${selection.other.trim()}`
        : "Other"
    }
    return options.find((option) => option.id === id)?.label ?? id
  })
}

function AskQuestionIndicator({
  selected,
  multiple,
}: {
  selected: boolean
  multiple: boolean
}) {
  return (
    <span
      aria-hidden
      data-slot="ask-question-indicator"
      data-state={selected ? "checked" : "unchecked"}
      className={askQuestionIndicatorVariants({
        shape: multiple ? "checkbox" : "radio",
        selected,
      })}
    >
      {selected ? (
        multiple ? (
          <Check className="size-3" strokeWidth={3} />
        ) : (
          <span className="size-2 rounded-full bg-primary" />
        )
      ) : null}
    </span>
  )
}

const ARROW_KEYS = ["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"]

/**
 * Cursor-style questionnaire: single-select radios, multi-select
 * checkboxes, an Other… field, and Skip / Continue.
 *
 * Single-select groups are real `radiogroup`s — one tab stop, arrow keys move
 * and select. Multi-select groups are `checkbox`es and each one is a tab stop.
 */
export function AskQuestion({
  title,
  questions,
  value: valueProp,
  defaultValue,
  onChange,
  onSubmit,
  onSkip,
  hideOther = false,
  disabled = false,
  defaultOpen = true,
  skipLabel = "Skip",
  submitLabel = "Continue",
  className,
}: AskQuestionProps) {
  const [open, setOpen] = React.useState(defaultOpen)
  const [uncontrolled, setUncontrolled] = React.useState<
    Record<string, AskQuestionSelection>
  >(defaultValue ?? {})
  const otherRefs = React.useRef<Record<string, HTMLInputElement | null>>({})
  const headingId = React.useId()

  const value = valueProp ?? uncontrolled
  const setValue = React.useCallback(
    (next: Record<string, AskQuestionSelection>) => {
      if (valueProp === undefined) setUncontrolled(next)
      onChange?.(next)
    },
    [onChange, valueProp]
  )

  const ready = selectionsComplete(questions, value)

  const select = React.useCallback(
    (question: AskQuestionItem, optionId: string, focusOther = true) => {
      if (disabled) return
      const current = value[question.id] ?? EMPTY_SELECTION
      let optionIds: string[]
      if (question.allowMultiple) {
        optionIds = current.optionIds.includes(optionId)
          ? current.optionIds.filter((id) => id !== optionId)
          : [...current.optionIds, optionId]
      } else {
        optionIds = [optionId]
      }
      const other = optionIds.includes(ASK_OTHER_ID) ? current.other : undefined
      setValue({ ...value, [question.id]: { optionIds, other } })
      if (focusOther && optionId === ASK_OTHER_ID) {
        requestAnimationFrame(() => otherRefs.current[question.id]?.focus())
      }
    },
    [disabled, setValue, value]
  )

  const setOther = React.useCallback(
    (questionId: string, other: string) => {
      if (disabled) return
      const current = value[questionId] ?? EMPTY_SELECTION
      const optionIds = current.optionIds.includes(ASK_OTHER_ID)
        ? current.optionIds
        : [...current.optionIds, ASK_OTHER_ID]
      setValue({ ...value, [questionId]: { optionIds, other } })
    },
    [disabled, setValue, value]
  )

  /** Roving arrow-key selection, the ARIA radiogroup contract. */
  const moveWithinGroup = React.useCallback(
    (
      event: React.KeyboardEvent<HTMLDivElement>,
      question: AskQuestionItem,
      options: AskQuestionOption[]
    ) => {
      if (question.allowMultiple || !ARROW_KEYS.includes(event.key)) return
      // Leave the Other… field alone — arrows there move the caret.
      const origin = event.target as HTMLElement | null
      if (origin?.dataset.slot !== "ask-question-option") return
      const nodes = Array.from(
        event.currentTarget.querySelectorAll<HTMLButtonElement>(
          "[data-slot='ask-question-option']"
        )
      )
      if (nodes.length === 0) return
      event.preventDefault()
      const step = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : -1
      const from = nodes.indexOf(document.activeElement as HTMLButtonElement)
      const next = from < 0 ? 0 : (from + step + nodes.length) % nodes.length
      nodes[next].focus()
      select(question, options[next].id, false)
    },
    [select]
  )

  const submit = React.useCallback(() => {
    if (disabled || !ready) return
    onSubmit?.({ skipped: false, answers: value })
  }, [disabled, onSubmit, ready, value])

  const skip = React.useCallback(() => {
    if (disabled) return
    if (onSkip) onSkip()
    else onSubmit?.({ skipped: true, answers: {} })
  }, [disabled, onSkip, onSubmit])

  const handleFormSubmit = React.useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      submit()
    },
    [submit]
  )

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      data-slot="ask-question"
      data-disabled={disabled ? "true" : undefined}
      className={cn(
        "my-2 overflow-hidden rounded-lg border bg-card text-card-foreground animate-in fade-in duration-150",
        className
      )}
    >
      <CollapsibleTrigger asChild>
        <button
          type="button"
          data-slot="ask-question-trigger"
          className={askQuestionTrigger}
        >
          <CircleHelp className="size-3.5 opacity-70" />
          <span
            id={headingId}
            className="min-w-0 flex-1 truncate font-medium text-foreground"
          >
            {title || "Questions"}
          </span>
          <ChevronDown
            className={cn(
              "size-3.5 opacity-50 transition-transform duration-150",
              open && "rotate-180"
            )}
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <form
          data-slot="ask-question-form"
          aria-labelledby={headingId}
          className="border-t px-3.5 pt-3 pb-3.5"
          onSubmit={handleFormSubmit}
        >
          <div className="flex flex-col gap-4">
            {questions.map((question) => {
              const options = withOther(question, hideOther)
              const selection = value[question.id] ?? EMPTY_SELECTION
              const promptId = `${headingId}-${question.id}`
              const rovingIndex = Math.max(
                0,
                options.findIndex((option) =>
                  selection.optionIds.includes(option.id)
                )
              )
              return (
                <fieldset
                  key={question.id}
                  data-slot="ask-question-item"
                  className="min-w-0"
                >
                  <legend
                    id={promptId}
                    data-slot="ask-question-prompt"
                    className="mb-1.5 text-[13.5px] leading-snug font-medium text-foreground"
                  >
                    {question.prompt}
                  </legend>
                  <div
                    data-slot="ask-question-group"
                    role={question.allowMultiple ? "group" : "radiogroup"}
                    aria-labelledby={promptId}
                    onKeyDown={(event) =>
                      moveWithinGroup(event, question, options)
                    }
                    className="flex flex-col gap-0.5"
                  >
                    {options.map((option, index) => {
                      const selected = selection.optionIds.includes(option.id)
                      const isOther = option.id === ASK_OTHER_ID
                      return (
                        <div key={option.id} className="min-w-0">
                          <button
                            type="button"
                            data-slot="ask-question-option"
                            data-state={selected ? "checked" : "unchecked"}
                            data-selected={selected ? "true" : "false"}
                            role={question.allowMultiple ? "checkbox" : "radio"}
                            aria-checked={selected}
                            aria-label={optionLabel(option)}
                            tabIndex={
                              question.allowMultiple || index === rovingIndex
                                ? 0
                                : -1
                            }
                            disabled={disabled}
                            onClick={() => select(question, option.id)}
                            className="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] leading-snug text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-default disabled:hover:bg-transparent data-[selected=true]:bg-muted/80"
                          >
                            <AskQuestionIndicator
                              selected={selected}
                              multiple={!!question.allowMultiple}
                            />
                            <span className="min-w-0">
                              {optionLabel(option)}
                              {isRecommended(option) ? (
                                <span className="ml-1.5 text-[11px] font-medium text-muted-foreground">
                                  Recommended
                                </span>
                              ) : null}
                            </span>
                          </button>
                          {isOther && selected ? (
                            <input
                              ref={(node) => {
                                otherRefs.current[question.id] = node
                              }}
                              data-slot="ask-question-other"
                              value={selection.other ?? ""}
                              disabled={disabled}
                              onChange={(event) =>
                                setOther(question.id, event.target.value)
                              }
                              placeholder="Type your answer"
                              aria-label="Other answer"
                              className="mt-1 mb-1 ml-8 w-[calc(100%-2rem)] rounded-md border border-input bg-background px-2.5 py-1.5 text-[13px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
                            />
                          ) : null}
                        </div>
                      )
                    })}
                  </div>
                </fieldset>
              )
            })}
          </div>
          <div
            data-slot="ask-question-actions"
            className="mt-4 flex items-center justify-end gap-1.5"
          >
            <button
              type="button"
              data-slot="ask-question-skip"
              disabled={disabled}
              onClick={skip}
              className={askQuestionActionVariants()}
            >
              {skipLabel}
            </button>
            <button
              type="submit"
              data-slot="ask-question-submit"
              disabled={disabled || !ready}
              className={askQuestionActionVariants({ variant: "primary" })}
            >
              {submitLabel}
            </button>
          </div>
        </form>
      </CollapsibleContent>
    </Collapsible>
  )
}

export type AskQuestionSummaryProps = {
  questions: AskQuestionItem[]
  result: AskQuestionResult
  hideOther?: boolean
  className?: string
}

/** Read-only recap of a settled questionnaire. */
export function AskQuestionSummary({
  questions,
  result,
  hideOther = false,
  className,
}: AskQuestionSummaryProps) {
  if (result.skipped) {
    return (
      <p
        data-slot="ask-question-summary"
        data-state="skipped"
        className={cn("text-[13px] text-muted-foreground", className)}
      >
        Skipped — nothing was selected.
      </p>
    )
  }

  return (
    <div
      data-slot="ask-question-summary"
      data-state="answered"
      className={cn("flex flex-col gap-2 text-[13px] leading-snug", className)}
    >
      {questions.map((question) => {
        const labels = selectedLabels(
          question,
          result.answers[question.id],
          hideOther
        )
        return (
          <div key={question.id} data-slot="ask-question-summary-item">
            <div className="font-medium text-foreground">{question.prompt}</div>
            <div className="mt-0.5 text-muted-foreground">
              {labels.length > 0 ? labels.join(", ") : "No selection"}
            </div>
          </div>
        )
      })}
    </div>
  )
}
