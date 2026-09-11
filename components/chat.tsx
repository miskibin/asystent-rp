"use client"

import * as React from "react"

import { ChatInput } from "@/components/ui/chat-input"
import {
  MessageList,
  type ChatMessageData,
} from "@/components/ui/message-list"
import {
  PromptSuggestions,
  type PromptSuggestion,
} from "@/components/ui/prompt-suggestions"
import { runLayoutTransition } from "@/lib/layout-transition"
import { cn } from "@/lib/utils"

const DEFAULT_SUGGESTIONS: PromptSuggestion[] = [
  { id: "explain", label: "Explain what this project does" },
  { id: "debug", label: "Help me track down a failing test" },
  { id: "draft", label: "Draft release notes from my last commits" },
]

export type ChatProps = React.ComponentProps<"div"> & {
  /** Headline above the composer while the conversation is empty. */
  greeting?: React.ReactNode
  /** Starter prompts listed under the centered composer. `[]` hides them. */
  suggestions?: PromptSuggestion[]
}

/**
 * Starter chat layout. Wire `onSend` to your API and append assistant
 * messages when they stream in. Sidebar, navbar, and pickers are installed
 * as siblings — compose them around this block.
 *
 * Empty conversations open centered — greeting, composer, then suggestions.
 * The first send fades the opening chrome and slides the same composer to
 * the bottom, so the textarea keeps its focus and any half-typed draft.
 */
export function Chat({
  greeting = "How can I help?",
  suggestions = DEFAULT_SUGGESTIONS,
  className,
  ...props
}: ChatProps) {
  const [messages, setMessages] = React.useState<ChatMessageData[]>([])
  const [isGenerating, setIsGenerating] = React.useState(false)
  const isEmpty = messages.length === 0

  const send = React.useCallback((text: string) => {
    const value = text.trim()
    if (!value) return
    const commit = () => {
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), content: value, sender: "user" },
      ])
      setIsGenerating(true)
    }
    if (messages.length === 0) runLayoutTransition(commit)
    else commit()
  }, [messages.length])

  const stop = React.useCallback(() => setIsGenerating(false), [])

  return (
    <div
      data-slot="chat"
      className={cn(
        "flex h-full min-h-0 w-full min-w-0 flex-col overflow-x-hidden bg-background",
        isEmpty && "justify-center",
        className
      )}
      {...props}
    >
      {isEmpty ? (
        <div
          data-slot="chat-greeting"
          className="mx-auto w-full max-w-3xl px-4 pb-5 sm:px-6"
        >
          <h2 className="text-center text-2xl font-semibold tracking-tight text-balance text-foreground sm:text-3xl">
            {greeting}
          </h2>
        </div>
      ) : (
        <MessageList messages={messages} isGenerating={isGenerating} />
      )}

      <div data-slot="chat-composer" className="w-full">
        <ChatInput
          className={cn(
            "transition-[padding] duration-300 ease-out",
            isEmpty && "pb-0 sm:pb-0"
          )}
          isGenerating={isGenerating}
          onStop={stop}
          onSend={({ text }) => send(text)}
        />
        {isEmpty ? (
          <PromptSuggestions
            items={suggestions}
            onSelect={(item) => send(item.label)}
          />
        ) : null}
      </div>
    </div>
  )
}
