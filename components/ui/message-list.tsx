"use client"

import { ArrowDown } from "lucide-react"
import * as React from "react"

import { cn } from "@/lib/utils"
import {
  GenerationStatus,
  type GenerationStage,
} from "@/components/ui/generation-status"
import {
  Message,
  isOpenAskTool,
  isPendingAskTool,
  type ChangeSummaryFile,
  type MessageArtifactData,
  type MessageAttachmentData,
  type MessageCodeBlockData,
  type MessagePart,
  type MessageToolCallData,
  type PatternHandler,
  type AskQuestionResult,
} from "@/components/ui/message"
import type { FileActionItem } from "@/components/ui/change-summary"

// Adapted from T3 Code (github.com/pingdotgg/t3code), MIT License, (c) 2026 T3 Tools Inc.
/** How close to the end still counts as "at the bottom" for the jump button. */
const BOTTOM_SCROLL_THRESHOLD_PX = 48
/**
 * The band inside which following re-arms itself. Strict on purpose, and
 * deliberately tighter than the button's own threshold: a generous "near the
 * end" test re-arms live-follow while the reader is a paragraph up reading
 * history, and the next streamed chunk yanks them back down. A few pixels of
 * slack — rather than an exact `distance <= 0` — is still needed, because the
 * content under the viewport is growing while the test runs.
 */
const FOLLOW_REARM_THRESHOLD_PX = 40
const EMPTY_PATTERNS: PatternHandler[] = []
const OFFSCREEN_ITEM_STYLE: React.CSSProperties = {
  contentVisibility: "auto",
  containIntrinsicSize: "auto 160px",
}

export type ChatMessageData = {
  id: string
  content: string
  sender: "user" | "assistant"
  reasoning?: string | null
  reasoningDuration?: number
  reasoningDefaultOpen?: boolean
  tools?: MessageToolCallData[]
  parts?: MessagePart[]
  codeBlocks?: MessageCodeBlockData[]
  artifacts?: MessageArtifactData[]
  attachments?: MessageAttachmentData[]
  workedFor?: number
  changes?: ChangeSummaryFile[]
}

export type MessageListProps = React.ComponentProps<"div"> & {
  messages: ChatMessageData[]
  isGenerating?: boolean
  generationStage?: GenerationStage
  /**
   * Overrides the stage's own word in the waiting indicator — for a backend
   * that can say something more useful than "Thinking" ("Loading qwen3:8b into
   * memory", "Waiting for the first token").
   */
  generationLabel?: string
  patternHandlers?: PatternHandler[]
  onEditMessage?: (id: string, content: string) => void
  onAskAnswer?: (
    messageId: string,
    toolId: string,
    result: AskQuestionResult
  ) => void
  /**
   * Build the plan a turn wrote. Only offered on the newest plan in the list,
   * and only once the turn that wrote it has settled — an older one is a
   * record of what was proposed, not a button.
   */
  onPlanBuild?: (messageId: string, toolId: string) => void
  /** The host shows the plan in a panel; the row becomes the way back. */
  onPlanOpen?: (messageId: string, toolId: string) => void
  /** Makes the Review label on a turn's change card a button. */
  onReviewChanges?: (messageId: string) => void
  /** Clicking an Edit / Write / Read headline — open it in a file panel. */
  onOpenFile?: (messageId: string, tool: MessageToolCallData) => void
  /** Clicking a row of a turn's change-summary card. */
  onChangeFileClick?: (messageId: string, file: ChangeSummaryFile) => void
  /** Clicking a file reference inside an answer's markdown. */
  onFileReferenceClick?: (
    messageId: string,
    path: string,
    line?: number
  ) => void
  /**
   * Right-click menu for every file the transcript names — change cards, tool
   * rows, path chips and images. Hold the array at one identity: it is handed
   * to the memoized rows as-is.
   */
  fileActions?: FileActionItem[]
  /** Quoting a selection out of an assistant answer, for the composer. */
  onQuote?: (messageId: string, text: string) => void
  /**
   * Turns a path a tool names into a URL the page can load — forwarded to
   * every row so an image the agent wrote or read renders as a picture.
   */
  resolveFileUrl?: (path: string) => string | undefined
  renderActions?: (message: ChatMessageData) => React.ReactNode
  /**
   * Identifies the conversation on screen. Pass it whenever one list renders
   * several transcripts in turn: on a change the list stops following the
   * chat that was left and jumps to the end of the one just opened.
   */
  conversationKey?: string
  emptyState?: React.ReactNode
}

/**
 * Keeps a callback prop at one identity for the lifetime of the list, so a
 * parent that re-renders on every streamed token does not invalidate the
 * memoized rows underneath it.
 */
function useStableCallback<A extends unknown[], R>(
  callback: ((...args: A) => R) | undefined
) {
  const ref = React.useRef(callback)
  React.useEffect(() => {
    ref.current = callback
  })
  return React.useCallback((...args: A) => ref.current?.(...args), [])
}

/**
 * `fileActions` is data, not a callback, so `useStableCallback` cannot hold it:
 * a host that spells the array inline would re-render every memoized row on
 * every streamed token. Identity is rebuilt only when an entry actually
 * changes — the icon is left out on purpose, it travels with its `id`.
 */
function sameFileActions(a?: FileActionItem[], b?: FileActionItem[]) {
  if (a === b) return true
  if (!a || !b || a.length !== b.length) return false
  return a.every((item, i) => {
    const other = b[i]
    return (
      item.id === other.id &&
      item.label === other.label &&
      item.onSelect === other.onSelect &&
      item.destructive === other.destructive &&
      item.separatorBefore === other.separatorBefore
    )
  })
}

function useStableFileActions(actions?: FileActionItem[]) {
  // Adjusted during render rather than in an effect: the rows must never see
  // the throwaway identity, and a re-render only happens when the menu really
  // changed — typically once, when the host first has its actions.
  const [held, setHeld] = React.useState(actions)
  if (!sameFileActions(held, actions)) setHeld(actions)
  return sameFileActions(held, actions) ? held : actions
}

/** Pixels between the bottom of the visible area and the end of the content. */
function distanceFromEnd(node: HTMLElement) {
  return node.scrollHeight - node.scrollTop - node.clientHeight
}

export function useChatAutoScroll(
  messages: ReadonlyArray<unknown>,
  conversationKey?: string
) {
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const contentRef = React.useRef<HTMLDivElement>(null)
  const autoScrollRef = React.useRef(true)
  const programmaticScrollUntilRef = React.useRef(0)
  const prevMessageCountRef = React.useRef(0)
  const frameRef = React.useRef(0)
  const bottomFrameRef = React.useRef(0)
  const atBottomRef = React.useRef(true)
  const [atBottom, setAtBottom] = React.useState(true)

  /* A scroll fires far more often than the answer changes: the flag is read
     again one frame later and only committed when it actually flipped. */
  const measureAtBottom = React.useCallback(() => {
    if (bottomFrameRef.current) return
    bottomFrameRef.current = requestAnimationFrame(() => {
      bottomFrameRef.current = 0
      const node = scrollRef.current
      if (!node) return
      const near = distanceFromEnd(node) <= BOTTOM_SCROLL_THRESHOLD_PX
      if (near === atBottomRef.current) return
      atBottomRef.current = near
      setAtBottom(near)
    })
  }, [])

  const handleMessageScroll = React.useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    /* Two different questions, two different bands. Whether the jump button
       shows is a matter of taste; whether the next token drags the reader down
       is not, so following only comes back on inside the tighter one. */
    if (distanceFromEnd(el) <= FOLLOW_REARM_THRESHOLD_PX) {
      autoScrollRef.current = true
    } else if (Date.now() > programmaticScrollUntilRef.current) {
      autoScrollRef.current = false
    }
    measureAtBottom()
  }, [measureAtBottom])

  /**
   * The distance to the bottom also changes without a scroll — the panel beside
   * the conversation opening, the composer growing, the window resizing. Left
   * to the scroll handler alone the jump button would stay stuck in whichever
   * state the last scroll left it in.
   */
  React.useEffect(() => {
    const el = scrollRef.current
    if (!el || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(() => measureAtBottom())
    observer.observe(el)
    return () => observer.disconnect()
  }, [measureAtBottom])

  /** Jump to the newest line and start following the turn again. */
  const scrollToBottom = React.useCallback(() => {
    const node = scrollRef.current
    if (!node) return
    autoScrollRef.current = true
    programmaticScrollUntilRef.current = Date.now() + 500
    node.scrollTo({ top: node.scrollHeight, behavior: "smooth" })
  }, [])

  /**
   * Follow state belongs to the conversation it was formed in. A host that
   * swaps transcripts without remounting the list — the usual shape, since
   * remounting throws away every rendered turn — would otherwise carry the
   * reader's "scrolled up to read" over to a chat they have not looked at,
   * and park them mid-transcript while its newest turn streams below.
   *
   * The count is cleared too, so the effect below reads the new transcript as
   * an initial paint and jumps to its end instantly rather than animating.
   */
  const conversationRef = React.useRef(conversationKey)
  React.useEffect(() => {
    if (conversationRef.current === conversationKey) return
    conversationRef.current = conversationKey
    autoScrollRef.current = true
    prevMessageCountRef.current = 0
    const node = scrollRef.current
    if (!node) return
    programmaticScrollUntilRef.current = Date.now() + 500
    node.scrollTo({ top: node.scrollHeight, behavior: "auto" })
  }, [conversationKey])

  /**
   * Streaming turns re-run this every token. Coalescing to one frame — and
   * jumping rather than smooth-scrolling while text is still arriving — keeps
   * the browser from queueing a fresh animated scroll per chunk.
   */
  React.useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    measureAtBottom()
    const prev = prevMessageCountRef.current
    const curr = messages.length
    prevMessageCountRef.current = curr
    const isInitialOrJump = prev === 0 || curr - prev > 1
    if (!autoScrollRef.current && !isInitialOrJump) return
    if (frameRef.current) cancelAnimationFrame(frameRef.current)
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0
      const node = scrollRef.current
      if (!node) return
      if (distanceFromEnd(node) <= 1) return
      programmaticScrollUntilRef.current = Date.now() + 500
      node.scrollTo({
        top: node.scrollHeight,
        // Smooth only when a single new message arrives. The first paint and
        // multi-message jumps stay instant — animating the height of a whole
        // transcript outruns the 500ms window above and reads as the user
        // scrolling away, which switches following off.
        behavior: isInitialOrJump || curr === prev ? "auto" : "smooth",
      })
    })
  }, [measureAtBottom, messages])

  /**
   * The effect above fires on new *messages*. Plenty of height arrives after
   * the last one: a mermaid diagram mounting, Shiki replacing a plain block, an
   * image loading, a font swapping in. Each of those leaves a follower parked a
   * screenful short of the bottom — visibly so under a floating composer, where
   * the shortfall reads as the last turn hiding behind it.
   *
   * So the content box is watched too, and while the reader is still following
   * the run, a growth spurt re-pins them. Instantly, never smoothly: this is a
   * layout correction, not a navigation, and animating it would outlast the
   * window below that tells a programmatic scroll from the reader's own.
   */
  React.useEffect(() => {
    const content = contentRef.current
    if (!content || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(() => {
      if (!autoScrollRef.current) return
      const node = scrollRef.current
      if (!node) return
      if (distanceFromEnd(node) <= 1) return
      programmaticScrollUntilRef.current = Date.now() + 500
      node.scrollTo({ top: node.scrollHeight, behavior: "auto" })
    })
    observer.observe(content)
    return () => observer.disconnect()
  }, [])

  React.useEffect(
    () => () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current)
      if (bottomFrameRef.current) cancelAnimationFrame(bottomFrameRef.current)
    },
    []
  )

  return { scrollRef, contentRef, handleMessageScroll, atBottom, scrollToBottom }
}

function hasAskTool(
  message: ChatMessageData,
  match: (tool: MessageToolCallData) => boolean
) {
  return Boolean(
    message.tools?.some(match) ||
      message.parts?.some((part) => part.type === "tool" && match(part.tool))
  )
}

/**
 * Memoized: the per-row closures live inside this boundary, so a re-render of
 * the list only reaches the rows whose message object actually changed. Every
 * prop here is safe to freeze — `renderActions` is a render prop and stays
 * outside, in the list, where it re-runs with the caller's current closure.
 */
const MessageListRow = React.memo(function MessageListRow({
  message,
  isStreaming,
  openAsk,
  openPlan,
  patternHandlers,
  onEditMessage,
  onAskAnswer,
  onPlanBuild,
  onPlanOpen,
  onReviewChanges,
  onOpenFile,
  onChangeFileClick,
  onFileReferenceClick,
  fileActions,
  onQuote,
  resolveFileUrl,
}: {
  message: ChatMessageData
  isStreaming: boolean
  openAsk: boolean
  /** This message carries the plan the Build button belongs on. */
  openPlan: boolean
  patternHandlers: PatternHandler[]
  onEditMessage?: (id: string, content: string) => void
  onAskAnswer?: (
    messageId: string,
    toolId: string,
    result: AskQuestionResult
  ) => void
  /**
   * Build the plan a turn wrote. Only offered on the newest plan in the list,
   * and only once the turn that wrote it has settled — an older one is a
   * record of what was proposed, not a button.
   */
  onPlanBuild?: (messageId: string, toolId: string) => void
  /** The host shows the plan in a panel; the row becomes the way back. */
  onPlanOpen?: (messageId: string, toolId: string) => void
  onReviewChanges?: (messageId: string) => void
  onOpenFile?: (messageId: string, tool: MessageToolCallData) => void
  onChangeFileClick?: (messageId: string, file: ChangeSummaryFile) => void
  onFileReferenceClick?: (
    messageId: string,
    path: string,
    line?: number
  ) => void
  fileActions?: FileActionItem[]
  onQuote?: (messageId: string, text: string) => void
  resolveFileUrl?: (path: string) => string | undefined
}) {
  const isUser = message.sender === "user"

  const handleEdit = React.useCallback(
    (content: string) => onEditMessage?.(message.id, content),
    [message.id, onEditMessage]
  )
  const handleAskAnswer = React.useCallback(
    (toolId: string, result: AskQuestionResult) =>
      onAskAnswer?.(message.id, toolId, result),
    [message.id, onAskAnswer]
  )
  const handlePlanBuild = React.useCallback(
    (toolId: string) => onPlanBuild?.(message.id, toolId),
    [message.id, onPlanBuild]
  )
  const handlePlanOpen = React.useCallback(
    (toolId: string) => onPlanOpen?.(message.id, toolId),
    [message.id, onPlanOpen]
  )
  const handleReviewChanges = React.useCallback(
    () => onReviewChanges?.(message.id),
    [message.id, onReviewChanges]
  )
  const handleOpenFile = React.useCallback(
    (tool: MessageToolCallData) => onOpenFile?.(message.id, tool),
    [message.id, onOpenFile]
  )
  const handleChangeFileClick = React.useCallback(
    (file: ChangeSummaryFile) => onChangeFileClick?.(message.id, file),
    [message.id, onChangeFileClick]
  )
  const handleFileReferenceClick = React.useCallback(
    (path: string, line?: number) =>
      onFileReferenceClick?.(message.id, path, line),
    [message.id, onFileReferenceClick]
  )
  const handleQuote = React.useCallback(
    (text: string) => onQuote?.(message.id, text),
    [message.id, onQuote]
  )

  return (
    <Message
      content={message.content}
      sender={message.sender}
      reasoning={message.reasoning}
      reasoningDuration={message.reasoningDuration}
      reasoningDefaultOpen={message.reasoningDefaultOpen}
      tools={message.tools}
      parts={message.parts}
      codeBlocks={message.codeBlocks}
      artifacts={message.artifacts}
      attachments={message.attachments}
      workedFor={message.workedFor}
      changes={message.changes}
      patternHandlers={patternHandlers}
      isAnimating={isStreaming}
      editable={isUser && !!onEditMessage}
      onEdit={isUser && onEditMessage ? handleEdit : undefined}
      /* Only the row that is actually asking takes a callback, so every other
         memoized Message keeps its render while the turn streams. */
      onAskAnswer={openAsk && onAskAnswer ? handleAskAnswer : undefined}
      /* Same rule for the plan: only the row that still has one to build. */
      onPlanBuild={openPlan && onPlanBuild ? handlePlanBuild : undefined}
      /* Unlike Build, this is offered on every plan in the thread: reopening
         one the conversation has moved past is reading, not acting. */
      onPlanOpen={onPlanOpen ? handlePlanOpen : undefined}
      onReviewChanges={onReviewChanges ? handleReviewChanges : undefined}
      onOpenFile={onOpenFile ? handleOpenFile : undefined}
      onChangeFileClick={onChangeFileClick ? handleChangeFileClick : undefined}
      onFileReferenceClick={
        onFileReferenceClick ? handleFileReferenceClick : undefined
      }
      fileActions={fileActions}
      onQuote={onQuote ? handleQuote : undefined}
      resolveFileUrl={resolveFileUrl}
    />
  )
})

export function MessageList({
  messages,
  isGenerating = false,
  generationStage = "idle",
  generationLabel,
  patternHandlers = EMPTY_PATTERNS,
  onEditMessage,
  onAskAnswer,
  onPlanBuild,
  onPlanOpen,
  onReviewChanges,
  onOpenFile,
  onChangeFileClick,
  onFileReferenceClick,
  fileActions,
  onQuote,
  resolveFileUrl,
  renderActions,
  conversationKey,
  emptyState,
  className,
  children,
  onScroll,
  ...props
}: MessageListProps) {
  const { scrollRef, contentRef, handleMessageScroll, atBottom, scrollToBottom } =
    useChatAutoScroll(messages, conversationKey)
  const lastIndex = messages.length - 1

  const stableEdit = useStableCallback(onEditMessage)
  const stableAskAnswer = useStableCallback(onAskAnswer)
  const stablePlanBuild = useStableCallback(onPlanBuild)
  const stablePlanOpen = useStableCallback(onPlanOpen)
  const stableReviewChanges = useStableCallback(onReviewChanges)
  const stableOpenFile = useStableCallback(onOpenFile)
  const stableChangeFileClick = useStableCallback(onChangeFileClick)
  const stableFileReferenceClick = useStableCallback(onFileReferenceClick)
  const stableQuote = useStableCallback(onQuote)
  // Rows are memoized: a host that builds this resolver inline would otherwise
  // re-render every row on every streamed token.
  const stableResolveFileUrl = useStableCallback(resolveFileUrl)
  const stableFileActions = useStableFileActions(fileActions)

  return (
    <div
      ref={scrollRef}
      data-slot="message-list"
      onScroll={(event) => {
        onScroll?.(event)
        handleMessageScroll()
      }}
      className={cn(
        "min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 pt-4 pb-4 sm:px-4 md:px-6",
        className
      )}
      {...props}
    >
      <div
        ref={contentRef}
        className="mx-auto flex min-h-full w-full max-w-3xl min-w-0 flex-col"
      >
        {messages.length === 0
          ? (emptyState ?? <div className="flex flex-1 items-center justify-center" />)
          : messages.map((message, index) => {
              const isLast = index === lastIndex
              const isStreaming =
                (isGenerating || generationStage !== "idle") &&
                isLast &&
                message.sender === "assistant"
              /* An ask in flight is always live. One the agent closed without
                 answers is the user's to pick up only on the latest turn —
                 further back it is history, not a prompt. */
              const openAsk =
                hasAskTool(message, isPendingAskTool) ||
                (isLast && hasAskTool(message, isOpenAskTool))
              /* The plan is only actionable where it is the last word in the
                 thread and nothing is still arriving. */
              const openPlan = isLast && !isStreaming
              const waiting =
                isStreaming &&
                !message.reasoning &&
                !message.content?.trim() &&
                !message.tools?.length &&
                !message.parts?.length

              return (
                <div
                  key={message.id}
                  data-slot="message-list-item"
                  // Find-in-page and accessibility retain the DOM, while the
                  // browser can skip layout and paint work for distant rows.
                  style={OFFSCREEN_ITEM_STYLE}
                >
                  <MessageListRow
                    message={message}
                    isStreaming={isStreaming}
                    openAsk={openAsk}
                    openPlan={openPlan}
                    patternHandlers={patternHandlers}
                    onEditMessage={onEditMessage ? stableEdit : undefined}
                    onAskAnswer={onAskAnswer ? stableAskAnswer : undefined}
                    onPlanBuild={onPlanBuild ? stablePlanBuild : undefined}
                    onPlanOpen={onPlanOpen ? stablePlanOpen : undefined}
                    onReviewChanges={
                      onReviewChanges ? stableReviewChanges : undefined
                    }
                    onOpenFile={onOpenFile ? stableOpenFile : undefined}
                    onChangeFileClick={
                      onChangeFileClick ? stableChangeFileClick : undefined
                    }
                    onFileReferenceClick={
                      onFileReferenceClick ? stableFileReferenceClick : undefined
                    }
                    fileActions={stableFileActions}
                    onQuote={onQuote ? stableQuote : undefined}
                    resolveFileUrl={
                      resolveFileUrl ? stableResolveFileUrl : undefined
                    }
                  />
                  {/* Rendered here, outside the memo: the actions a caller
                      builds close over what it knows right now — the picked
                      model, the running turn — and a settled row that froze
                      them would hand a stale one back on the next click. */}
                  {waiting ? (
                    <div className="mb-4">
                      <GenerationStatus
                        active
                        stage={generationStage}
                        label={generationLabel}
                      />
                    </div>
                  ) : isStreaming || openAsk ? null : (
                    renderActions?.(message)
                  )}
                </div>
              )
            })}
        {children}
        {/* Zero-height rail: the button hangs above the bottom edge instead of
            reserving a strip at the end of every transcript. */}
        <div className="pointer-events-none sticky bottom-2 z-10 flex h-0 w-full items-end justify-center">
          <button
            type="button"
            data-slot="message-list-jump"
            data-visible={!atBottom}
            aria-label="Scroll to bottom"
            aria-hidden={atBottom}
            tabIndex={atBottom ? -1 : 0}
            onClick={scrollToBottom}
            className="inline-grid size-8 translate-y-1 place-items-center rounded-full border bg-background/95 text-muted-foreground opacity-0 shadow-md backdrop-blur transition-[opacity,transform,color] duration-150 outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[visible=true]:pointer-events-auto data-[visible=true]:translate-y-0 data-[visible=true]:opacity-100 [&_svg]:size-4"
          >
            <ArrowDown />
          </button>
        </div>
      </div>
    </div>
  )
}
