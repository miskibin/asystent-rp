"use client"

import { ArrowUp } from "lucide-react"
import * as React from "react"

import { cn } from "@/lib/utils"

export type ChatComposerProps = Omit<
  React.ComponentProps<"textarea">,
  "onChange" | "value"
> & {
  value: string
  onValueChange: (value: string) => void
  onSend: () => void
  onStop?: () => void
  isGenerating?: boolean
  maxLength?: number
  footer?: React.ReactNode
}

/**
 * A controlled, text-only chat composer. Enter sends; Shift+Enter makes a
 * new line. It deliberately owns no backend, attachment, or agent state.
 */
export function ChatComposer({
  value,
  onValueChange,
  onSend,
  onStop,
  isGenerating = false,
  maxLength = 4_000,
  placeholder = "Write a message…",
  disabled = false,
  footer,
  className,
  onKeyDown,
  ...props
}: ChatComposerProps) {
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)
  const canSend = value.trim().length > 0 && !disabled && !isGenerating

  const resize = React.useCallback(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = "auto"
    textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`
  }, [])

  React.useEffect(() => {
    resize()
  }, [resize, value])

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      onKeyDown?.(event)
      if (event.defaultPrevented || event.key !== "Enter" || event.shiftKey) {
        return
      }
      // The Enter that confirms an IME candidate (keyCode 229 in Safari,
      // where `isComposing` is already false) belongs to the IME.
      if (event.nativeEvent.isComposing || event.keyCode === 229) return
      event.preventDefault()
      if (canSend) onSend()
    },
    [canSend, onKeyDown, onSend]
  )

  return (
    <div data-slot="chat-composer" className={cn("w-full", className)}>
      <div
        data-slot="chat-composer-surface"
        className="relative rounded-xl border bg-background p-2 shadow-sm transition-shadow focus-within:ring-[3px] focus-within:ring-ring/50"
      >
        <textarea
          ref={textareaRef}
          data-slot="chat-composer-textarea"
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled || isGenerating}
          maxLength={maxLength}
          rows={1}
          className="block max-h-[180px] min-h-11 w-full resize-none bg-transparent px-2 py-2 pr-12 text-sm leading-6 outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60"
          {...props}
        />
        {isGenerating ? (
          <button
            type="button"
            data-slot="chat-composer-stop"
            aria-label="Stop generating"
            onClick={onStop}
            className="absolute right-2 bottom-2 grid size-9 place-items-center rounded-full bg-destructive/90 text-destructive-foreground outline-none transition-[background-color,transform] duration-150 hover:scale-105 hover:bg-destructive focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-95 motion-reduce:transform-none"
          >
            <span aria-hidden className="size-2.5 rounded-[3px] bg-current" />
          </button>
        ) : (
          <button
            type="button"
            data-slot="chat-composer-send"
            aria-label="Send message"
            disabled={!canSend}
            onClick={onSend}
            className="absolute right-2 bottom-2 grid size-9 place-items-center rounded-full bg-primary text-primary-foreground outline-none transition-[background-color,color,transform] duration-150 hover:scale-105 hover:bg-primary/90 focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-95 disabled:pointer-events-none disabled:bg-foreground/10 disabled:text-muted-foreground motion-reduce:transform-none"
          >
            <ArrowUp className="size-4" />
          </button>
        )}
      </div>
      {footer ? (
        <div
          data-slot="chat-composer-footer"
          className="px-2 pt-2 text-center text-[11px] leading-4 text-muted-foreground"
        >
          {footer}
        </div>
      ) : null}
    </div>
  )
}
