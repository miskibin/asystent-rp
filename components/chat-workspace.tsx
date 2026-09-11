"use client"

import * as React from "react"
import { Copy, LogOut, MessageSquare, PanelLeft, Pencil, RefreshCw, Trash2 } from "lucide-react"
import { useRouter } from "next/navigation"

import { useChatContext } from "@/app/ChatContext"
import { ChatInput, type ChatInputPayload } from "@/components/ui/chat-input"
import { ChatSidebar, SideIconBtn, SideRow, SidebarCollapsibleSection } from "@/components/ui/chat-sidebar"
import { MessageList, type ChatMessageData } from "@/components/ui/message-list"
import { PromptSuggestions, type PromptSuggestion } from "@/components/ui/prompt-suggestions"
import { ThemeToggle } from "@/components/ui/theme-toggle"
import { runLayoutTransition } from "@/lib/layout-transition"
import { createClientComponentClient } from "@/lib/supabase/client"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"

const SUGGESTIONS: PromptSuggestion[] = [
  { id: "explain", label: "Wyjaśnij mi trudny temat prostymi słowami" },
  { id: "organize", label: "Pomóż mi uporządkować ten problem" },
  { id: "draft", label: "Napisz krótką wersję roboczą" },
]

function ActionButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
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
    isLoading,
    status,
    handleSubmit,
    stopGenerating,
    clearMessages,
    deleteMessage,
    editMessage,
    regenerateMessage,
  } = useChatContext()
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
        })),
    [messages]
  )
  const history = React.useMemo(
    () => chatMessages.filter((message) => message.sender === "user").map((message) => ({ id: message.id, text: message.content })),
    [chatMessages]
  )
  const isEmpty = chatMessages.length === 0
  const conversationTitle = history[0]?.text || "Nowa rozmowa"

  const send = React.useCallback(
    (payload: ChatInputPayload) => {
      if (payload.files.length > 0) {
        toast({ title: "Załączniki nie są jeszcze obsługiwane", description: "Wyślij na razie wiadomość tekstową." })
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
    stopGenerating()
    clearMessages()
    setMobileOpen(false)
  }, [clearMessages, stopGenerating])

  const signOut = React.useCallback(async () => {
    await supabase.auth.signOut()
    router.replace("/")
    router.refresh()
  }, [router, supabase])

  const nav = (
    <SideRow icon={<Pencil className="size-4" />} onClick={newChat}>Nowa rozmowa</SideRow>
  )
  const rail = (
    <SideIconBtn label="Nowa rozmowa" onClick={newChat}><Pencil className="size-4" /></SideIconBtn>
  )
  const footer = (
    <button
      type="button"
      onClick={() => void signOut()}
      className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm text-muted-foreground outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring/60"
    >
      <LogOut className="size-4" />
      <span>Wyloguj</span>
    </button>
  )
  const sidebarContent = (
    <SidebarCollapsibleSection title="Rozmowy" open={chatsOpen} onToggle={() => setChatsOpen((value) => !value)} count={1}>
      <SideRow icon={<MessageSquare className="size-4" />} className="bg-sidebar-accent text-sidebar-accent-foreground">
        <span className="truncate">{conversationTitle}</span>
      </SideRow>
    </SidebarCollapsibleSection>
  )

  return (
    <div className="relative flex h-[100dvh] min-h-0 overflow-hidden bg-background">
      <div className="hidden h-full shrink-0 md:block">
        <ChatSidebar
          collapsed={collapsed}
          onCollapsedChange={setCollapsed}
          brand={<span className="truncate px-1 text-[15px] font-semibold tracking-tight">Asystent RP</span>}
          nav={nav}
          rail={rail}
          footer={footer}
          collapseLabel="Zwiń panel"
          expandLabel="Otwórz panel"
        >
          {sidebarContent}
        </ChatSidebar>
      </div>

      <div
        aria-hidden={!mobileOpen}
        onClick={() => setMobileOpen(false)}
        className={cn(
          "absolute inset-0 z-40 bg-foreground/20 backdrop-blur-[1px] transition-opacity duration-200 md:hidden",
          mobileOpen ? "opacity-100" : "pointer-events-none opacity-0"
        )}
      />
      <div className={cn("absolute inset-y-0 left-0 z-50 h-full shadow-xl transition-transform duration-200 md:hidden", !mobileOpen && "-translate-x-full")}>
        <ChatSidebar
          collapsed={false}
          onCollapsedChange={() => setMobileOpen(false)}
          brand={<span className="truncate px-1 text-[15px] font-semibold tracking-tight">Asystent RP</span>}
          nav={nav}
          rail={rail}
          footer={footer}
          collapseLabel="Zamknij panel"
        >
          {sidebarContent}
        </ChatSidebar>
      </div>

      <main className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <button
          type="button"
          aria-label="Otwórz rozmowy"
          onClick={() => setMobileOpen(true)}
          className="fixed top-3 left-3 z-30 inline-grid size-8 place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 md:hidden [&_svg]:size-4"
        >
          <PanelLeft />
        </button>
        <ThemeToggle floating={false} className="absolute top-3 right-3 z-30" />

        <div className={cn("flex min-h-0 flex-1 flex-col overflow-x-hidden", isEmpty && "justify-center")}>
          {isEmpty ? (
            <div data-slot="demo-opening" className="mx-auto w-full max-w-3xl px-3 pb-5 sm:px-4">
              <h1 className="text-center text-2xl font-semibold tracking-tight text-balance text-foreground sm:text-3xl">Jak mogę pomóc?</h1>
            </div>
          ) : (
            <MessageList
              messages={chatMessages}
              isGenerating={isLoading}
              generationStage={isLoading ? "responding" : "idle"}
              generationLabel={status || "Odpowiadam"}
              onEditMessage={(id, content) => void editMessage(id, content)}
              renderActions={(message) =>
                message.sender === "assistant" ? (
                  <div className="-mt-2 mb-4 flex gap-1 opacity-60 transition-opacity focus-within:opacity-100 hover:opacity-100">
                    <ActionButton label="Kopiuj" onClick={() => void navigator.clipboard.writeText(message.content)}><Copy /></ActionButton>
                    <ActionButton label="Wygeneruj ponownie" onClick={() => void regenerateMessage(message.id)}><RefreshCw /></ActionButton>
                    <ActionButton label="Usuń" onClick={() => deleteMessage(message.id)}><Trash2 /></ActionButton>
                  </div>
                ) : null
              }
            />
          )}

          <div data-slot="chat-composer" className="w-full shrink-0">
            <ChatInput
              className={cn("transition-[padding] duration-300 ease-out", isEmpty && "pb-0 sm:pb-0")}
              placeholder="Napisz wiadomość…"
              isGenerating={isLoading}
              onStop={stopGenerating}
              onSend={send}
              history={history}
              tools={<span className="hidden text-[12px] text-muted-foreground sm:inline">DeepSeek 4.1 Flash</span>}
            />
            {isEmpty ? <PromptSuggestions items={SUGGESTIONS} onSelect={(item) => send({ text: item.label, files: [], skills: [] })} /> : null}
          </div>
        </div>
      </main>
    </div>
  )
}
