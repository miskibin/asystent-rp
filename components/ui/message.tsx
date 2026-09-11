"use client"

import { Pencil, Quote, Save, Undo2 } from "lucide-react"
import * as React from "react"

import {
  MessageArtifact,
  MessageAttachments,
  MessageCode,
  MessageProcess,
  MessageReasoning,
  MessageToolCall,
  MessageToolCalls,
  type MessageArtifactData,
  type MessageAttachmentData,
  type MessageCodeBlockData,
  type MessageToolCallData,
} from "@/components/ui/message-parts"
import {
  isOpenAskTool,
  isPendingAskTool,
  type AskQuestionResult,
} from "@/components/ui/ask-question"
import { hasWrittenPlan } from "@/components/ui/plan-card"
import {
  ChangeSummary,
  fileChangesFromTools,
  type ChangeSummaryFile,
  type FileActionItem,
} from "@/components/ui/change-summary"
import { cn } from "@/lib/utils"
import { MessageMarkdown } from "@/components/ui/message-markdown"

export type PatternHandler = {
  pattern: RegExp
  render: (match: RegExpExecArray) => React.ReactNode
}

export type ActionButton = {
  id: string
  icon: React.ReactNode
  onClick: () => void
  title?: string
  className?: string
  position?: "inside" | "outside"
}

export type MessagePart =
  | { type: "thinking"; id: string; text: string }
  | { type: "text"; id: string; text: string }
  | { type: "tool"; id: string; tool: MessageToolCallData }

export type MessageProps = {
  content: string
  sender: "user" | "assistant"
  actionButtons?: ActionButton[]
  editable?: boolean
  onEdit?: (content: string) => void
  patternHandlers?: PatternHandler[]
  className?: string
  contentClassName?: string
  /** Explicit reasoning (overrides `<think>` parse when set). */
  reasoning?: string | null
  reasoningDefaultOpen?: boolean
  /** Shown as “Thought for N seconds” when set. */
  reasoningDuration?: number
  tools?: MessageToolCallData[]
  /** Chronological thinking / text / tool segments. When set, replaces the tools-then-content layout. */
  parts?: MessagePart[]
  codeBlocks?: MessageCodeBlockData[]
  artifacts?: MessageArtifactData[]
  /** Files attached to a user turn — images render as thumbnails. */
  attachments?: MessageAttachmentData[]
  /** True while this assistant message is still streaming. */
  isAnimating?: boolean
  /** Called when an Ask Question tool on this turn is submitted or skipped. */
  onAskAnswer?: (toolId: string, result: AskQuestionResult) => void
  /**
   * Offers the Build button on a plan this turn wrote. Hand it only to the
   * newest plan in a thread — see `MessageToolCall`.
   */
  onPlanBuild?: (toolId: string) => void
  /** The host shows the plan in a panel; the row becomes the way back. */
  onPlanOpen?: (toolId: string) => void
  /**
   * Elapsed seconds — labels the “Worked for 12s” row the thinking and tool
   * parts collapse into once the turn settles.
   */
  workedFor?: number
  /** Explicit file-change card. When omitted, Edit / Write tools are summarised. */
  changes?: ChangeSummaryFile[]
  onReviewChanges?: () => void
  /**
   * Opt in to clickable Edit / Write / Read headlines — the row reports the
   * whole tool so the owner can open it in a file panel.
   */
  onOpenFile?: (tool: MessageToolCallData) => void
  /** Makes each row of the change-summary card clickable. */
  onChangeFileClick?: (file: ChangeSummaryFile) => void
  /**
   * Turns a path a tool names into a URL this page can load. Only the host
   * knows how the machine's files reach the browser, so this is how a tool row
   * gets to show an image the agent wrote or read instead of its bytes.
   */
  resolveFileUrl?: (path: string) => string | undefined
  /**
   * Makes the file references inside the answer's markdown clickable — the
   * path arrives without its `:line` suffix, and the line it named arrives
   * beside it. Keep it stable: an unstable handler re-renders every markdown
   * block on every streamed token.
   */
  onFileReferenceClick?: (path: string, line?: number) => void
  /**
   * Right-click menu for every file this turn names — the change card, the
   * tool rows, the path chips and images in the answer. Keep the array stable.
   */
  fileActions?: FileActionItem[]
  /**
   * Offers a “Quote” pill over a selection inside an assistant answer, for
   * dropping the selected text into the composer. Assistant turns only.
   */
  onQuote?: (text: string) => void
}

const THINK_TAG_REGEX = /<think>([\s\S]*?)<\/think>/i
const USER_PREVIEW_MAX_WORDS = 80

const EMPTY_ACTIONS: ActionButton[] = []
const EMPTY_TOOLS: MessageToolCallData[] = []
const EMPTY_CODE_BLOCKS: MessageCodeBlockData[] = []
const EMPTY_ARTIFACTS: MessageArtifactData[] = []
const EMPTY_ATTACHMENTS: MessageAttachmentData[] = []
const EMPTY_PATTERNS: PatternHandler[] = []
const EMPTY_CHANGES: ChangeSummaryFile[] = []

/** Small square icon button used for edit / save / custom message actions. */
const messageActionButton =
  "inline-grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-3.5"

function previewUserMessageText(text: string, maxWords: number) {
  const words = text.trim().split(/\s+/)
  if (words.length <= maxWords) {
    return { preview: text, remainder: "" }
  }
  return {
    preview: words.slice(0, maxWords).join(" ") + "…",
    remainder: words.slice(maxWords).join(" "),
  }
}

/**
 * Memoized: in a streaming list only the message whose props actually change
 * re-renders. Keep the callbacks you pass in stable to benefit from it.
 */
export const Message = React.memo(function Message({
  content,
  sender,
  actionButtons = EMPTY_ACTIONS,
  editable = false,
  onEdit,
  patternHandlers = EMPTY_PATTERNS,
  className,
  contentClassName,
  reasoning: reasoningProp,
  reasoningDefaultOpen = false,
  reasoningDuration,
  tools = EMPTY_TOOLS,
  parts,
  codeBlocks = EMPTY_CODE_BLOCKS,
  artifacts = EMPTY_ARTIFACTS,
  attachments = EMPTY_ATTACHMENTS,
  isAnimating = false,
  onAskAnswer,
  onPlanBuild,
  onPlanOpen,
  workedFor,
  changes,
  onReviewChanges,
  onOpenFile,
  onChangeFileClick,
  resolveFileUrl,
  onFileReferenceClick,
  fileActions,
  onQuote,
}: MessageProps) {
  const [isEditing, setIsEditing] = React.useState(false)
  const [editedContent, setEditedContent] = React.useState(content)
  const [longPromptExpanded, setLongPromptExpanded] = React.useState(false)

  const { reasoning, displayContent } = React.useMemo(() => {
    if (reasoningProp != null) {
      return { reasoning: reasoningProp || null, displayContent: content }
    }
    const match = THINK_TAG_REGEX.exec(content)
    if (!match) return { reasoning: null, displayContent: content }
    return {
      reasoning: match[1].trim(),
      displayContent: content.replace(THINK_TAG_REGEX, "").trim(),
    }
  }, [content, reasoningProp])

  const { insideButtons, outsideButtons } = React.useMemo(
    () => ({
      insideButtons: actionButtons.filter((btn) => btn.position !== "outside"),
      outsideButtons: actionButtons.filter((btn) => btn.position === "outside"),
    }),
    [actionButtons]
  )

  /**
   * The buffer is seeded where editing starts rather than synced from the
   * content prop: an assistant turn rewrites that prop on every streamed
   * token, and following it cost a second render each time to fill an editor
   * that is not open and, for that sender, cannot be.
   */
  const startEdit = React.useCallback(() => {
    setEditedContent(content)
    setIsEditing(true)
  }, [content])

  const cancelEdit = React.useCallback(() => {
    setIsEditing(false)
    setEditedContent(content)
  }, [content])

  const saveEdit = React.useCallback(() => {
    setIsEditing(false)
    if (onEdit && editedContent !== content) onEdit(editedContent)
  }, [content, editedContent, onEdit])

  /** Scanned once per render instead of once per thinking part. */
  const lastThinkingIndex = React.useMemo(
    () => parts?.findLastIndex((part) => part.type === "thinking") ?? -1,
    [parts]
  )

  /**
   * Everything up to and including the last thinking / tool part is the
   * turn's process; whatever trails it is the answer. One scan, so a turn
   * that streams a hundred parts still costs one pass per render.
   *
   * A written plan is the exception: it is what the turn came back with, so it
   * reads as the answer rather than folding into the stack. One left mid-turn
   * — superseded by whatever the agent did next — stays process.
   */
  const processEnd = React.useMemo(
    () =>
      parts?.findLastIndex(
        (part) =>
          part.type === "thinking" ||
          (part.type === "tool" && !hasWrittenPlan(part.tool))
      ) ?? -1,
    [parts]
  )

  const hasProcess = React.useMemo(() => {
    if (!parts) return tools.length > 0
    return parts
      .slice(0, processEnd + 1)
      .some(
        (part) =>
          part.type === "tool" || (part.type === "thinking" && !!part.text)
      )
  }, [parts, processEnd, tools])

  /**
   * An ask nobody has answered yet must stay reachable, so the group is held
   * open — collapsing the turn would hide the form the user is meant to fill.
   */
  const hasOpenAsk = React.useMemo(() => {
    const list =
      parts
        ?.filter(
          (part): part is Extract<MessagePart, { type: "tool" }> =>
            part.type === "tool"
        )
        .map((part) => part.tool) ?? tools
    return list.some(
      (tool) =>
        isPendingAskTool(tool) || (!!onAskAnswer && isOpenAskTool(tool))
    )
  }, [onAskAnswer, parts, tools])

  const derivedChanges = React.useMemo(() => {
    if (changes) return changes
    // Only rendered once the turn settles, so parsing every streamed diff on
    // the way there is pure waste.
    if (isAnimating) return EMPTY_CHANGES
    const fromParts =
      parts
        ?.filter(
          (part): part is Extract<MessagePart, { type: "tool" }> =>
            part.type === "tool"
        )
        .map((part) => part.tool) ?? []
    return fileChangesFromTools(fromParts.length > 0 ? fromParts : tools)
  }, [changes, isAnimating, parts, tools])

  /**
   * The pill lives beside the answer rather than in a portal: one absolutely
   * positioned button inside the turn, placed from the selection's own rect.
   */
  const contentRef = React.useRef<HTMLDivElement>(null)
  const pillRef = React.useRef<HTMLButtonElement>(null)
  const [quotePos, setQuotePos] = React.useState<{
    top: number
    left: number
  } | null>(null)
  const quotable = sender === "assistant" && !!onQuote

  const readSelection = React.useCallback(() => {
    const host = contentRef.current
    if (!host) return
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      setQuotePos(null)
      return
    }
    // Both ends have to be in this answer — a selection dragged across two
    // turns belongs to neither.
    const inside =
      !!selection.anchorNode &&
      !!selection.focusNode &&
      host.contains(selection.anchorNode) &&
      host.contains(selection.focusNode)
    if (!inside || !selection.toString().trim()) {
      setQuotePos(null)
      return
    }
    /**
     * The first client rect is the line the selection starts on. Its union box
     * is not: over several lines that box is centred between them, which puts
     * the pill in the middle of the text it is about to quote.
     */
    const range = selection.getRangeAt(0)
    const rect = range.getClientRects()[0] ?? range.getBoundingClientRect()
    const box = host.getBoundingClientRect()
    setQuotePos({
      // The pill sits fully above `top`, so a selection on the answer's first
      // line has to be held down far enough to keep it inside the box.
      top: Math.max(rect.top - box.top - 6, 20),
      left: rect.left - box.left + rect.width / 2,
    })
  }, [])

  const quoteSelection = React.useCallback(() => {
    const selection = window.getSelection()
    const text = selection?.toString().trim() ?? ""
    selection?.removeAllRanges()
    setQuotePos(null)
    if (text) onQuote?.(text)
  }, [onQuote])

  /* Only while the pill is up: it is the selection going away — collapsed,
     dismissed or replaced — that takes it back down again. */
  React.useEffect(() => {
    if (!quotePos) return
    const onSelectionChange = () => {
      const selection = window.getSelection()
      if (!selection || selection.isCollapsed) setQuotePos(null)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setQuotePos(null)
    }
    // A selection still being extended with shift + arrows ends each step on a
    // key release; the pill follows it to the line it now starts on.
    const onKeyUp = () => readSelection()
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (target && pillRef.current?.contains(target)) return
      setQuotePos(null)
    }
    document.addEventListener("selectionchange", onSelectionChange)
    document.addEventListener("keydown", onKeyDown)
    document.addEventListener("keyup", onKeyUp)
    document.addEventListener("pointerdown", onPointerDown)
    return () => {
      document.removeEventListener("selectionchange", onSelectionChange)
      document.removeEventListener("keydown", onKeyDown)
      document.removeEventListener("keyup", onKeyUp)
      document.removeEventListener("pointerdown", onPointerDown)
    }
  }, [quotePos, readSelection])

  if (sender === "user") {
    if (isEditing) {
      return (
        <div
          data-slot="message"
          data-sender="user"
          data-editing="true"
          className={cn("mb-4 flex w-full justify-end", className)}
        >
          <div className="w-full max-w-[85%] rounded-xl border bg-muted px-3.5 py-2.5 transition-colors focus-within:border-ring sm:max-w-[70%] sm:px-4">
            <textarea
              value={editedContent}
              onChange={(e) => setEditedContent(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault()
                  saveEdit()
                } else if (e.key === "Escape") {
                  e.preventDefault()
                  cancelEdit()
                }
              }}
              rows={3}
              autoFocus
              aria-label="Edit message"
              className="w-full resize-none border-0 bg-transparent text-base leading-relaxed text-foreground outline-none sm:text-[15px]"
            />
            <div className="mt-2 flex justify-end gap-1">
              <button
                type="button"
                title="Cancel (Esc)"
                onClick={cancelEdit}
                className={cn(messageActionButton, "hover:bg-background")}
              >
                <Undo2 />
              </button>
              <button
                type="button"
                title="Save (⌘↵)"
                onClick={saveEdit}
                className={cn(
                  messageActionButton,
                  "text-primary hover:bg-background hover:text-primary"
                )}
              >
                <Save />
              </button>
            </div>
          </div>
        </div>
      )
    }

    const { preview, remainder } = previewUserMessageText(
      displayContent,
      USER_PREVIEW_MAX_WORDS
    )

    return (
      <div
        data-slot="message"
        data-sender="user"
        className={cn(
          "group mb-4 flex w-full min-w-0 flex-col items-end gap-1",
          className
        )}
      >
        {attachments.length > 0 ? (
          <MessageAttachments attachments={attachments} />
        ) : null}
        <div className="flex w-full min-w-0 items-center justify-end gap-1">
          {editable && onEdit && (
            <button
              type="button"
              title="Edit message"
              onClick={startEdit}
              className={cn(
                messageActionButton,
                "opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
              )}
            >
              <Pencil />
            </button>
          )}
          {displayContent ? (
            <div
              data-slot="message-content"
              className={cn(
                "max-w-[85%] min-w-0 rounded-xl bg-muted px-3.5 py-2.5 text-[15px] leading-relaxed break-words whitespace-pre-wrap text-foreground sm:max-w-[70%] sm:px-4",
                contentClassName
              )}
            >
              {remainder && !longPromptExpanded ? preview : displayContent}
              {remainder ? (
                <button
                  type="button"
                  className="mt-2 block rounded-sm py-0.5 text-left text-[13px] font-medium text-primary underline-offset-2 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  aria-expanded={longPromptExpanded}
                  onClick={() => setLongPromptExpanded((v) => !v)}
                >
                  {longPromptExpanded ? "Show less" : "Show more"}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    )
  }

  const legacyReasoning =
    reasoning && !parts?.some((part) => part.type === "thinking") ? (
      <MessageReasoning
        key="reasoning"
        defaultOpen={reasoningDefaultOpen}
        duration={reasoningDuration}
        streaming={isAnimating}
      >
        {reasoning}
      </MessageReasoning>
    ) : null

  const partNodes = parts?.map((part, index) => {
    if (part.type === "tool") {
      // onAskAnswer is forwarded as-is: MessageToolCall reports its
      // own id, so a stable handler keeps every row memoized.
      return (
        <MessageToolCall
          key={part.id}
          tool={part.tool}
          onAskAnswer={onAskAnswer}
          onPlanBuild={onPlanBuild}
          onPlanOpen={onPlanOpen}
          onOpenFile={onOpenFile}
          fileActions={fileActions}
          resolveFileUrl={resolveFileUrl}
        />
      )
    }
    if (part.type === "thinking") {
      if (!part.text) return null
      const isLatestThinking = index === lastThinkingIndex
      return (
        <MessageReasoning
          key={part.id}
          defaultOpen={reasoningDefaultOpen}
          streaming={isAnimating && isLatestThinking}
        >
          {part.text}
        </MessageReasoning>
      )
    }
    return part.text ? (
      <MessageMarkdown
        key={part.id}
        isAnimating={isAnimating}
        patternHandlers={patternHandlers}
        onFileClick={onFileReferenceClick}
        fileActions={fileActions}
      >
        {part.text}
      </MessageMarkdown>
    ) : null
  })

  /* Same shape either way: the process above, the answer below. The legacy
     `tools` array is one stack, already expanded — the group around it is
     the collapse. */
  const process = partNodes
    ? partNodes.slice(0, processEnd + 1)
    : tools.length > 0
      ? [
          <MessageToolCalls
            key="tools"
            tools={tools}
            defaultOpen
            onAskAnswer={onAskAnswer}
            onPlanBuild={onPlanBuild}
            onPlanOpen={onPlanOpen}
            onOpenFile={onOpenFile}
            fileActions={fileActions}
            resolveFileUrl={resolveFileUrl}
          />,
        ]
      : []
  const answer = partNodes
    ? partNodes.slice(processEnd + 1)
    : displayContent
      ? [
          <MessageMarkdown
            key="content"
            isAnimating={isAnimating}
            patternHandlers={patternHandlers}
            onFileClick={onFileReferenceClick}
            fileActions={fileActions}
          >
            {displayContent}
          </MessageMarkdown>,
        ]
      : []

  return (
    <div
      data-slot="message"
      data-sender="assistant"
      className={cn("group mb-7", className)}
    >
      <div
        ref={contentRef}
        data-slot="message-content"
        onMouseUp={quotable ? readSelection : undefined}
        // Only fires while something inside the answer has focus; a keyboard
        // selection is otherwise picked up by the document listener the pill
        // installs while it is up.
        onKeyUp={quotable ? readSelection : undefined}
        className={cn(
          "min-w-0 max-w-full text-[15px] leading-[1.65] text-foreground",
          quotable && "relative",
          contentClassName
        )}
      >
        {hasProcess || legacyReasoning ? (
          <MessageProcess
            streaming={isAnimating || hasOpenAsk}
            seconds={workedFor}
          >
            {legacyReasoning}
            {process}
          </MessageProcess>
        ) : null}
        {answer}

        {/* `streaming` keeps a fence that is still growing out of the
            highlight cache — the pass still runs, so nothing renders bare. */}
        {codeBlocks.map((block, i) => (
          <MessageCode
            key={`${block.language ?? "code"}-${i}`}
            block={block}
            streaming={isAnimating}
          />
        ))}

        {artifacts.map((artifact) => (
          <MessageArtifact key={artifact.id} artifact={artifact} />
        ))}

        {!isAnimating && derivedChanges.length > 0 ? (
          <div
            data-slot="message-turn-summary"
            className="mt-3 flex flex-col items-start gap-2.5"
          >
            <ChangeSummary
              files={derivedChanges}
              onAction={onReviewChanges}
              onFileClick={onChangeFileClick}
              fileActions={fileActions}
            />
          </div>
        ) : null}

        {insideButtons.length > 0 ||
        outsideButtons.length > 0 ||
        (editable && onEdit) ? (
          <div
            data-slot="message-actions"
            className="mt-2 flex flex-wrap items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100"
          >
            {[...insideButtons, ...outsideButtons].map((button) => (
              <button
                key={button.id}
                type="button"
                title={button.title}
                onClick={button.onClick}
                className={cn(messageActionButton, button.className)}
              >
                {button.icon}
              </button>
            ))}
            {editable && onEdit && (
              <button
                type="button"
                title="Edit message"
                onClick={startEdit}
                className={messageActionButton}
              >
                <Pencil />
              </button>
            )}
          </div>
        ) : null}

        {quotable && quotePos ? (
          <button
            ref={pillRef}
            type="button"
            data-slot="message-quote"
            style={{ top: quotePos.top, left: quotePos.left }}
            // Mousing down on the pill must not clear what it is about to quote.
            onMouseDown={(event) => event.preventDefault()}
            onClick={quoteSelection}
            className="absolute z-10 inline-flex -translate-x-1/2 -translate-y-full items-center gap-1 rounded-md border bg-popover px-2 py-1 text-[12px] text-popover-foreground shadow-md outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 [&_svg]:size-3"
          >
            <Quote />
            Quote
          </button>
        ) : null}
      </div>
    </div>
  )
})

export type {
  MessageArtifactData,
  MessageAttachmentData,
  MessageCodeBlockData,
  MessageToolCallData,
} from "@/components/ui/message-parts"
export type { ChangeSummaryFile } from "@/components/ui/change-summary"
export type { AskQuestionResult } from "@/components/ui/ask-question"
export { ChangeSummary, WorkedFor } from "@/components/ui/change-summary"
export {
  MessageArtifact,
  MessageAttachments,
  MessageCode,
  MessageProcess,
  MessageReasoning,
  MessageToolCall,
  MessageToolCalls,
} from "@/components/ui/message-parts"
export {
  AskQuestion,
  isAskToolName,
  isOpenAskTool,
  isPendingAskTool,
  parseAskQuestionInput,
} from "@/components/ui/ask-question"
