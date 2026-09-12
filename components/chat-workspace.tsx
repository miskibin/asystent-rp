"use client"

import * as React from "react"
import { Copy, LogOut, PanelLeft, Pencil, RefreshCw, Trash2 } from "lucide-react"
import { useRouter } from "next/navigation"

import { useChatContext } from "@/app/ChatContext"
import { ChatInput, type ChatInputPayload } from "@/components/ui/chat-input"
import {
  ChatSidebar,
  ChatSidebarItemList,
  SideActionRow,
  SideIconBtn,
  SidebarCollapsibleSection,
} from "@/components/ui/chat-sidebar"
import { MessageList, type ChatMessageData } from "@/components/ui/message-list"
import { PromptSuggestions, type PromptSuggestion } from "@/components/ui/prompt-suggestions"
import { ThemeToggle } from "@/components/ui/theme-toggle"
import { useToast } from "@/hooks/use-toast"
import { runLayoutTransition } from "@/lib/layout-transition"
import { createClientComponentClient } from "@/lib/supabase/client"
import { cn } from "@/lib/utils"

const DESKTOP_QUERY = "(min-width: 768px)"

const SUGGESTIONS: PromptSuggestion[] = [
  { id: "explain", label: "Wyjaśnij mi trudny temat prostymi słowami" },
  { id: "organize", label: "Pomóż mi uporządkować ten problem" },
  { id: "draft", label: "Napisz krótką wersję roboczą" },
]

function useIsDesktop() {
  const [isDesktop, setIsDesktop] = React.useState(true)

  React.useEffect(() => {
    const media = window.matchMedia(DESKTOP_QUERY)
    const sync = () => setIsDesktop(media.matches)
    sync()
    media.addEventListener("change", sync)
    return () => media.removeEventListener("change", sync)
  }, [])

  return isDesktop
}

function ActionButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="inline-grid size-8 place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 [&_svg]:size-4"
    >
      {children}
    </button>
  )
}

export function ChatWorkspace() {
  const router = useRouter()
  const supabase = React.useMemo(() => createClientComponentClient(), [])
  const { toast } = useToast()
  const {
    messages,
    threads,
    activeThreadId,
    isThreadsLoading,
    isLoading,
    status,
    handleSubmit,
    stopGenerating,
    newThread,
    switchThread,
    deleteThread,
    deleteMessage,
    editMessage,
    regenerateMessage,
  } = useChatContext()
  const isDesktop = useIsDesktop()
  const [collapsed, setCollapsed] = React.useState(false)
  const [mobileOpen, setMobileOpen] = React.useState(false)
  const [chatsOpen, setChatsOpen] = React.useState(true)

  const chatMessages = React.useMemo<ChatMessageData[]>(
    () =>
      messages
        .filter((message) => message.role === "user" || message.role === "assistant")
        .filter((message) => message.content.length > 0 || message.role === "assistant")
        .map((message) => ({
          id: message.id,
          content: message.content,
          sender: message.role as "user" | "assistant",
          parts: message.parts,
          tools: message.tools,
          workedFor: message.workedFor,
        })),
    [messages]
  )
  const history = React.useMemo(
    () =>
      chatMessages
        .filter((message) => message.sender === "user")
        .map((message) => ({ id: message.id, text: message.content })),
    [chatMessages]
  )
  const isEmpty = chatMessages.length === 0
  const drawerOpen = mobileOpen && !isDesktop

  React.useEffect(() => {
    if (!drawerOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpen(false)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [drawerOpen])

  const send = React.useCallback(
    (payload: ChatInputPayload) => {
      if (payload.files.length > 0) {
        toast({
          title: "Załączniki nie są jeszcze obsługiwane",
          description: "Wyślij na razie wiadomość tekstową.",
        })
        return
      }
      const text = payload.text.trim()
      if (!text) return
      const submit = () => {
        void handleSubmit(new Event("submit") as unknown as React.FormEvent, text)
      }
      if (isEmpty) runLayoutTransition(submit)
      else submit()
    },
    [handleSubmit, isEmpty, toast]
  )

  const newChat = React.useCallback(() => {
    newThread()
    setMobileOpen(false)
  }, [newThread])

  const signOut = React.useCallback(async () => {
    await supabase.auth.signOut()
    router.replace("/")
    router.refresh()
  }, [router, supabase])

  return (
    <div className="relative flex h-[100dvh] min-h-0 overflow-hidden bg-background">
      <div
        aria-hidden={!drawerOpen}
        onClick={() => setMobileOpen(false)}
        className={cn(
          "absolute inset-0 z-40 bg-foreground/20 backdrop-blur-[1px] transition-opacity duration-200 md:hidden",
          drawerOpen ? "opacity-100" : "pointer-events-none opacity-0"
        )}
      />

      <div
        className={cn(
          "z-50 h-full shrink-0 max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:shadow-xl max-md:transition-transform max-md:duration-200 md:relative",
          !drawerOpen && "max-md:-translate-x-full"
        )}
      >
        <ChatSidebar
          collapsed={isDesktop ? collapsed : false}
          onCollapsedChange={(next) =>
            isDesktop ? setCollapsed(next) : setMobileOpen(false)
          }
          brand={
            <span className="truncate px-1 text-[15px] font-semibold tracking-tight text-foreground">
              Asystent RP
            </span>
          }
          nav={
            <SideActionRow>
              <SideIconBtn label="Nowa rozmowa" onClick={newChat}>
                <Pencil className="size-4" />
              </SideIconBtn>
            </SideActionRow>
          }
          rail={
            <SideIconBtn label="Nowa rozmowa" onClick={newChat}>
              <Pencil className="size-4" />
            </SideIconBtn>
          }
          footer={
            <button
              type="button"
              onClick={() => void signOut()}
              className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm text-muted-foreground outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring/60"
            >
              <LogOut className="size-4" />
              <span>Wyloguj</span>
            </button>
          }
          collapseLabel="Zwiń panel"
          expandLabel="Otwórz panel"
        >
          <SidebarCollapsibleSection
            title="Rozmowy"
            open={chatsOpen}
            onToggle={() => setChatsOpen((value) => !value)}
            count={threads.length}
          >
            <ChatSidebarItemList
              items={threads.map((thread) => ({
                id: thread.id,
                title: thread.title,
              }))}
              activeId={activeThreadId ?? undefined}
              listId="recent-chats"
              draggable={false}
              groupPinned={false}
              showStatusDot={false}
              motion
              emptyState={isThreadsLoading ? "Ładowanie rozmów…" : "Brak zapisanych rozmów"}
              onSelect={(id) => {
                void switchThread(id)
                setMobileOpen(false)
              }}
              onDelete={(id) => void deleteThread(id)}
            />
          </SidebarCollapsibleSection>
        </ChatSidebar>
      </div>

      <main className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <button
          type="button"
          aria-label="Otwórz rozmowy"
          onClick={() => setMobileOpen(true)}
          className="fixed top-3 left-3 z-30 inline-grid size-8 place-items-center rounded-md border border-border/60 bg-background/80 text-muted-foreground shadow-sm backdrop-blur-sm outline-none transition-colors hover:bg-background hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 md:hidden [&_svg]:size-4"
        >
          <PanelLeft />
        </button>
        <ThemeToggle floating={false} className="absolute top-3 right-3 z-30" />

        <div
          className={cn(
            "flex min-h-0 flex-1 flex-col overflow-x-hidden",
            isEmpty && "justify-center"
          )}
        >
          {isEmpty ? (
            <div
              data-slot="demo-opening"
              className="mx-auto w-full max-w-3xl px-3 pb-5 sm:px-4"
            >
              <h1 className="text-center text-2xl font-semibold tracking-tight text-balance text-foreground sm:text-3xl">
                Jak mogę pomóc?
              </h1>
            </div>
          ) : (
            <MessageList
              messages={chatMessages}
              conversationKey={activeThreadId ?? "new"}
              isGenerating={isLoading}
              generationStage={isLoading ? "responding" : "idle"}
              generationLabel={status || "Odpowiadam"}
              onEditMessage={(id, content) => void editMessage(id, content)}
              renderActions={(message) =>
                message.sender === "assistant" ? (
                  <div className="-mt-2 mb-4 flex gap-1 opacity-60 transition-opacity focus-within:opacity-100 hover:opacity-100">
                    <ActionButton
                      label="Kopiuj"
                      onClick={() => void navigator.clipboard.writeText(message.content)}
                    >
                      <Copy />
                    </ActionButton>
                    <ActionButton
                      label="Wygeneruj ponownie"
                      onClick={() => void regenerateMessage(message.id)}
                    >
                      <RefreshCw />
                    </ActionButton>
                    <ActionButton
                      label="Usuń"
                      onClick={() => deleteMessage(message.id)}
                    >
                      <Trash2 />
                    </ActionButton>
                  </div>
                ) : null
              }
            />
          )}

          <div data-slot="chat-composer" className="w-full shrink-0">
            <ChatInput
              className={cn(
                "transition-[padding] duration-300 ease-out",
                isEmpty && "pb-0 sm:pb-0"
              )}
              placeholder="Napisz wiadomość…"
              isGenerating={isLoading}
              onStop={stopGenerating}
              onSend={send}
              history={history}
            />
            {isEmpty ? (
              <PromptSuggestions
                items={SUGGESTIONS}
                onSelect={(item) =>
                  send({ text: item.label, files: [], skills: [] })
                }
              />
            ) : null}
          </div>
        </div>
      </main>
    </div>
  )
}
