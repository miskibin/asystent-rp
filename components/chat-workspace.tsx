"use client"

import * as React from "react"
import { Copy, Loader2, LogOut, PanelLeft, Pencil, RefreshCw, Search, X } from "lucide-react"
import { useRouter } from "next/navigation"
import { useChatContext } from "@/app/ChatContext"
import { ChatInput, type ChatInputHandle, type ChatInputPayload } from "@/components/ui/chat-input"
import { ChatSidebar, ChatSidebarItemList, SideIconBtn, SideRow } from "@/components/ui/chat-sidebar"
import { SidebarResizeRail } from "@/components/ui/sidebar-resize-rail"
import { ChatEmptyState } from "@/components/ui/chat-empty-state"
import { MessageList, type ChatMessageData } from "@/components/ui/message-list"
import { PromptSuggestions } from "@/components/ui/prompt-suggestions"
import { ThemeToggle } from "@/components/ui/theme-toggle"
import { useToast } from "@/hooks/use-toast"
import { DOCUMENT_CHAR_LIMIT, DOCUMENT_COUNT_LIMIT, DOCUMENT_EXTENSIONS, documentsSchema } from "@/lib/chat-request"
import { USER_MESSAGE_CHAR_LIMIT } from "@/lib/chat-persistence"
import { createClientComponentClient } from "@/lib/supabase/client"
import { useChatStore } from "@/lib/store"
import { cn } from "@/lib/utils"
import { LAW_HANDOFF_STORAGE, lawDraft } from "@/lib/law-handoff"

const SUGGESTIONS = [
  { id: "sitting", label: "Co wydarzyło się na ostatnim posiedzeniu Sejmu?" },
  { id: "law", label: "Jak sprawdzić etap prac nad ustawą?" },
]

function useIsDesktop() {
  return React.useSyncExternalStore(
    React.useCallback((onChange) => {
      const media = window.matchMedia("(min-width: 768px)")
      media.addEventListener("change", onChange)
      return () => media.removeEventListener("change", onChange)
    }, []),
    () => window.matchMedia("(min-width: 768px)").matches,
    () => true,
  )
}

function ActionButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return <button type="button" title={label} aria-label={label} onClick={onClick} disabled={disabled}
    className="inline-grid size-9 place-items-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 [&_svg]:size-4">{children}</button>
}

export function ChatWorkspace() {
  const router = useRouter()
  const supabase = React.useMemo(() => createClientComponentClient(), [])
  const { toast } = useToast()
  const { messages, threads, activeThreadId, isThreadsLoading, isConversationLoading, isLoading,
    errorMessage, clearError, handleSubmit, stopGenerating, newThread, switchThread, deleteThread,
    renameThread, editMessage, regenerateMessage } = useChatContext()
  const desktop = useIsDesktop()
  const sidebarRef = React.useRef<HTMLDivElement>(null)
  const composerRef = React.useRef<ChatInputHandle>(null)
  const preparingRef = React.useRef(false)
  const workspaceVersionRef = React.useRef(0)
  const [collapsed, setCollapsed] = React.useState(false)
  const [mobileOpen, setMobileOpen] = React.useState(false)
  const [search, setSearch] = React.useState("")
  const [preparing, setPreparing] = React.useState(false)
  const drawerOpen = mobileOpen && !desktop
  const conversationLoading = isThreadsLoading || isConversationLoading
  const newConversation = !activeThreadId && messages.length === 0 && !conversationLoading
  const busy = isLoading || preparing || conversationLoading
  const sidebarItems = React.useMemo(() => threads.filter((thread) => thread.title.toLocaleLowerCase("pl").includes(search.toLocaleLowerCase("pl"))).map((thread) => ({
    id: thread.id, title: thread.title,
    subtitle: new Date(thread.updatedAt).toLocaleString("pl-PL", { timeZone: "Europe/Warsaw", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }),
    status: thread.id === activeThreadId && isLoading ? "streaming" as const : "idle" as const,
  })), [activeThreadId, isLoading, search, threads])
  // Historical presentation tools remain in storage; the chat displays ordinary messages only.
  const chatMessages = React.useMemo<ChatMessageData[]>(() => messages.filter((message) => message.role !== "system").map((message) => ({
    id: message.id, content: message.content, sender: message.role as "user" | "assistant",
  })), [messages])

  React.useLayoutEffect(() => {
    if (!desktop) return
    try {
      const stored = Number(localStorage.getItem("asystent-rp.sidebar-width"))
      if (stored > 0) sidebarRef.current?.style.setProperty("--chat-sidebar-width", `${Math.max(208, Math.min(480, window.innerWidth - 420, stored))}px`)
    } catch { /* Default width also works without storage. */ }
  }, [desktop])
  React.useEffect(() => {
    if (!drawerOpen) return
    const previous = document.activeElement as HTMLElement | null
    const panel = sidebarRef.current
    const focusables = () => [...(panel?.querySelectorAll<HTMLElement>('button:not([disabled]),input,a[href],[tabindex="0"]') ?? [])].filter((element) => element.getClientRects().length)
    focusables()[0]?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpen(false)
      if (event.key !== "Tab") return
      const nodes = focusables(), first = nodes[0], last = nodes.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener("keydown", onKeyDown)
    return () => { document.removeEventListener("keydown", onKeyDown); previous?.focus() }
  }, [drawerOpen])

  const resetComposer = React.useCallback(() => {
    workspaceVersionRef.current += 1
    composerRef.current?.setDraft({ text: "", files: [], skills: [] })
    setMobileOpen(false)
  }, [])
  const newChat = React.useCallback(() => { resetComposer(); newThread(); requestAnimationFrame(() => composerRef.current?.focus()) }, [newThread, resetComposer])
  const lawHandoffApplied = React.useRef(false)
  React.useEffect(() => {
    if (lawHandoffApplied.current || isThreadsLoading || isConversationLoading) return
    const text = lawDraft(new URLSearchParams(window.location.search))
    lawHandoffApplied.current = true
    if (!text) return
    newThread()
    requestAnimationFrame(() => { composerRef.current?.setDraft({ text, files: [], skills: [] }); composerRef.current?.focus(); try { sessionStorage.removeItem(LAW_HANDOFF_STORAGE) } catch { /* Storage may be blocked. */ } })
  }, [isThreadsLoading, isConversationLoading, newThread])
  const selectChat = React.useCallback((id: string) => { resetComposer(); void switchThread(id) }, [resetComposer, switchThread])
  const send = React.useCallback(async (payload: ChatInputPayload) => {
    if (busy || preparingRef.current) return
    preparingRef.current = true
    const version = workspaceVersionRef.current
    setPreparing(true)
    try {
      if (payload.files.length > DOCUMENT_COUNT_LIMIT) throw new Error("Dołącz maksymalnie 3 dokumenty.")
      const documents = await Promise.all(payload.files.map(async (file) => {
        if (!DOCUMENT_EXTENSIONS.test(file.name) || file.size > DOCUMENT_CHAR_LIMIT * 4) throw new Error("Obsługiwane są małe pliki tekstowe: TXT, MD, CSV, JSON, XML, YAML, LOG.")
        return { name: file.name, content: await file.text() }
      }))
      if (version !== workspaceVersionRef.current) return
      if (!documentsSchema.safeParse(documents).success) throw new Error("Dokumenty muszą być tekstowe, niepuste i mieć łącznie do 12000 znaków.")
      const text = payload.text.trim() || (documents.length ? "Przeanalizuj załączone dokumenty." : "")
      if (!text || text.length > USER_MESSAGE_CHAR_LIMIT) throw new Error("Wiadomość musi mieć od 1 do 4000 znaków.")
      preparingRef.current = false
      setPreparing(false)
      await handleSubmit({ preventDefault() {} } as React.FormEvent, text, documents)
    } catch (error) {
      if (version !== workspaceVersionRef.current) return
      toast({ title: "Nie wysłano wiadomości", description: error instanceof Error ? error.message : "Sprawdź wiadomość.", variant: "destructive" })
      requestAnimationFrame(() => composerRef.current?.setDraft(payload))
    } finally { preparingRef.current = false; setPreparing(false) }
  }, [busy, handleSubmit, toast])
  const signOut = React.useCallback(async () => {
    stopGenerating(); useChatStore.getState().clearMessages()
    await supabase.auth.signOut(); router.replace("/"); router.refresh()
  }, [router, stopGenerating, supabase])
  const renderActions = React.useCallback((message: ChatMessageData) => {
    const original = messages.find((item) => item.id === message.id)
    return <div className="mb-4 space-y-2">
      {original?.sources?.length ? <div className="flex flex-wrap gap-2 text-xs text-muted-foreground" data-slot="chat-sources"><span>Źródła:</span>{original.sources.map((url, index) => <a key={url} href={url} target="_blank" rel="noreferrer" className="rounded border px-2 py-1 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">{new URL(url).hostname} · {index + 1}</a>)}</div> : null}
      {message.sender === "assistant" && message.content ? <div className="flex gap-1">
        <ActionButton label="Kopiuj" onClick={() => void navigator.clipboard.writeText(message.content).catch(() => toast({ title: "Nie udało się skopiować." }))}><Copy /></ActionButton>
        <ActionButton label="Wygeneruj ponownie" disabled={busy} onClick={() => void regenerateMessage(message.id)}><RefreshCw /></ActionButton>
      </div> : original?.documents?.map((doc, index) => <span key={index} className="mr-2 inline-block rounded border px-2 py-1 text-xs text-muted-foreground">{doc.name}</span>)}
    </div>
  }, [busy, messages, regenerateMessage, toast])

  return <div className="relative flex h-dvh min-h-0 overflow-hidden bg-background">
    {drawerOpen ? <button type="button" aria-label="Zamknij panel rozmów" onClick={() => setMobileOpen(false)} className="absolute inset-0 z-40 bg-foreground/20 md:hidden" /> : null}
    <div ref={sidebarRef} data-chat-drawer role={drawerOpen ? "dialog" : undefined} aria-modal={drawerOpen || undefined} aria-label={drawerOpen ? "Rozmowy" : undefined} inert={!desktop && !drawerOpen}
      className={cn("z-50 h-full shrink-0 max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:max-w-[calc(100vw-3rem)] max-md:shadow-xl md:relative", !drawerOpen && "max-md:hidden")}>
      <ChatSidebar collapsed={desktop ? collapsed : false} onCollapsedChange={(next) => desktop ? setCollapsed(next) : setMobileOpen(false)} animateWidth={false}
        width={desktop ? undefined : "min(290px, calc(100vw - 3rem))"}
        brand={<span className="px-1 text-[15px] font-semibold tracking-tight">Asystent RP</span>}
        nav={<SideRow icon={<Pencil className="size-4" />} onClick={newChat} className="min-h-11">Nowa rozmowa</SideRow>}
        rail={<SideIconBtn label="Nowa rozmowa" onClick={newChat} className="size-11"><Pencil className="size-4" /></SideIconBtn>}
        footer={<button type="button" title="Wyloguj" aria-label="Wyloguj" onClick={() => void signOut()} className="flex min-h-11 w-full items-center justify-center gap-2 rounded px-2 text-sm text-muted-foreground hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring"><LogOut className="size-4" />{(!desktop || !collapsed) && "Wyloguj"}</button>}
        collapseLabel={desktop ? "Zwiń panel" : "Zamknij rozmowy"} expandLabel="Otwórz panel">
        <label className="mb-3 flex items-center gap-2 rounded-md border px-2 text-muted-foreground"><Search className="size-4" /><input aria-label="Szukaj rozmów" placeholder="Szukaj rozmów" value={search} onChange={(event) => setSearch(event.target.value)} className="h-10 min-w-0 w-full bg-transparent text-sm outline-none" /></label>
        <ChatSidebarItemList items={sidebarItems} activeId={activeThreadId ?? undefined}
          emptyState={isThreadsLoading ? "Ładowanie…" : "Brak rozmów"} onSelect={selectChat} onRename={(id, title) => void renameThread(id, title)} onDelete={(id) => void deleteThread(id)} />
      </ChatSidebar>
      {desktop && !collapsed ? <SidebarResizeRail targetRef={sidebarRef} onWidthChange={(width) => { try { localStorage.setItem("asystent-rp.sidebar-width", String(width)) } catch { /* Storage may be disabled. */ } }} label="Zmień szerokość panelu" /> : null}
    </div>
    <main inert={drawerOpen} className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden pt-14">
      <ThemeToggle aria-label="Zmień motyw" title="Zmień motyw" className="size-10" />
      <div className="absolute top-3 left-3 flex gap-1 md:hidden">
        <ActionButton label="Otwórz rozmowy" onClick={() => setMobileOpen(true)}><PanelLeft /></ActionButton>
        <ActionButton label="Nowa rozmowa" onClick={newChat}><Pencil /></ActionButton>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        {conversationLoading ? <div role="status" aria-label="Ładowanie rozmowy" className="flex min-h-0 flex-1 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Ładowanie rozmowy…</div> : <MessageList messages={chatMessages} conversationKey={activeThreadId ?? "new"} isGenerating={isLoading} generationStage={isLoading ? "thinking" : "idle"} generationLabel="Przygotowuję odpowiedź…"
          onEditMessage={busy ? undefined : (id, content) => void editMessage(id, content)} renderActions={renderActions}
          emptyState={newConversation ? <ChatEmptyState title="W czym mogę pomóc?" description="Zapytaj o Sejm, ustawy lub głosowania."><PromptSuggestions items={SUGGESTIONS} onSelect={(item) => void send({ text: item.label, files: [], skills: [] })} /></ChatEmptyState> : <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Ta rozmowa jest pusta.</div>} />}
        {errorMessage ? <div role="alert" className="mx-auto flex w-full max-w-3xl items-center gap-2 px-4 py-2 text-sm text-destructive"><span className="flex-1">{errorMessage}</span><ActionButton label="Zamknij komunikat" onClick={clearError}><X /></ActionButton></div> : null}
        <ChatInput ref={composerRef} placeholder="Napisz wiadomość…" onSend={(payload) => void send(payload)} onStop={stopGenerating}
          disabled={preparing || conversationLoading || drawerOpen} isGenerating={isLoading} className="pb-[max(0.75rem,env(safe-area-inset-bottom))]" />
      </div>
    </main>
  </div>
}
