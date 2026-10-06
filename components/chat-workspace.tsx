"use client"

import * as React from "react"
import dynamic from "next/dynamic"
import { BookOpen, Copy, Download, FileText, Loader2, LogOut, PanelLeft, Pencil, RefreshCw, Search, Trash2, X } from "lucide-react"
import { useRouter } from "next/navigation"
import { useChatContext } from "@/app/ChatContext"
import { ChatInput, type ChatInputHandle, type ChatInputPayload } from "@/components/ui/chat-input"
import { ChatSidebar, ChatSidebarItemList, SideActionRow, SideIconBtn, SidebarCollapsibleSection } from "@/components/ui/chat-sidebar"
import { ChatSidebarDnd, pinDropZone, trashDropZone, type SidebarDndDrop } from "@/components/ui/sidebar-dnd"
import { SidebarResizeRail } from "@/components/ui/sidebar-resize-rail"
import { ChatNavbar } from "@/components/ui/chat-navbar"
import { ChatEmptyState } from "@/components/ui/chat-empty-state"
import { ContextMeter } from "@/components/ui/context-meter"
import { ModePicker, type ChatModeOption } from "@/components/ui/mode-picker"
import { ModelPicker } from "@/components/ui/model-picker"
import { MessageList, type ChatMessageData } from "@/components/ui/message-list"
import { PromptSuggestions, type PromptSuggestion } from "@/components/ui/prompt-suggestions"
import type { FilePreviewFile } from "@/components/ui/file-preview"
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable"
import { parseAskQuestionInput, type AskQuestionResult } from "@/components/ui/ask-question"
import { ThemeToggle } from "@/components/ui/theme-toggle"
import { useToast } from "@/hooks/use-toast"
import { CHAT_COMMANDS, CHAT_SKILLS, DOCUMENT_CHAR_LIMIT, DOCUMENT_COUNT_LIMIT, DOCUMENT_EXTENSIONS, expandTaskPrompt, documentsSchema, documentContext } from "@/lib/chat-request"
import { exportConversation, filesFromMessages, type ChatFile } from "@/lib/chat-files"
import { MODEL_HISTORY_CHAR_LIMIT, trimModelHistory, USER_MESSAGE_CHAR_LIMIT } from "@/lib/chat-persistence"
import { runLayoutTransition } from "@/lib/layout-transition"
import { createClientComponentClient } from "@/lib/supabase/client"
import { useChatStore } from "@/lib/store"
import type { Message } from "@/lib/types"
import { cn } from "@/lib/utils"

const SUGGESTIONS: PromptSuggestion[] = [
  { id: "sitting", label: "Co wydarzyło się na ostatnim posiedzeniu Sejmu?" },
  { id: "law", label: "Jak sprawdzić etap prac nad ustawą?" },
  { id: "draft", label: "Pomóż mi przygotować wniosek o informację publiczną" },
]
const MODES: ChatModeOption[] = [
  { id: "agent", name: "Asystent", description: "Wyszukuje dane, analizuje i przygotowuje dokumenty" },
  { id: "ask", name: "Pytanie", description: "Odpowiedź z faktami i źródłami" },
  { id: "plan", name: "Plan", description: "Plan analizy lub kolejnych kroków" },
]
const MODELS = [{ id: "deepseek-flash", name: "DeepSeek V4 Flash", description: "Model skonfigurowany na serwerze" }]
const ZONES = [pinDropZone({ label: "Upuść, aby przypiąć" }), trashDropZone({ label: "Upuść, aby usunąć" })]
const FilePreview = dynamic(() => import("@/components/ui/file-preview").then((module) => module.FilePreview), { loading: () => <Loader2 className="m-4 size-5 animate-spin" aria-label="Ładowanie dokumentu" /> })
const FileTree = dynamic(() => import("@/components/ui/file-tree").then((module) => module.FileTree))
type QueuedPrompt = ChatInputPayload & { id: string; held?: boolean }

function useIsDesktop() {
  return React.useSyncExternalStore(
    React.useCallback((onChange) => {
      const media = window.matchMedia("(min-width: 768px)"); media.addEventListener("change", onChange)
      return () => media.removeEventListener("change", onChange)
    }, []),
    () => window.matchMedia("(min-width: 768px)").matches,
    () => true,
  )
}
function download(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }))
  const link = document.createElement("a"); link.href = url; link.download = name; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
function ActionButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return <button type="button" title={label} aria-label={label} onClick={onClick} disabled={disabled}
    className="inline-grid size-8 place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-40 [&_svg]:size-4">{children}</button>
}

export function ChatWorkspace() {
  const router = useRouter()
  const supabase = React.useMemo(() => createClientComponentClient(), [])
  const { toast } = useToast()
  const { messages, threads, activeThreadId, isThreadsLoading, isConversationLoading, isLoading, status,
    errorMessage, clearError, handleSubmit, stopGenerating, newThread, switchThread, deleteThread, deleteThreads,
    renameThread, pinThreads, reorderThreads, deleteMessage, editMessage, regenerateMessage, mode, setMode } = useChatContext()
  const desktop = useIsDesktop()
  const rootRef = React.useRef<HTMLDivElement>(null)
  const composerRef = React.useRef<ChatInputHandle>(null)
  const queueBusyRef = React.useRef(false)
  const preparingRef = React.useRef(false)
  const workspaceVersionRef = React.useRef(0)
  const [collapsed, setCollapsed] = React.useState(false)
  const [mobileOpen, setMobileOpen] = React.useState(false)
  const [chatsOpen, setChatsOpen] = React.useState(true)
  const [search, setSearch] = React.useState("")
  const [draftText, setDraftText] = React.useState("")
  const [queuePaused, setQueuePaused] = React.useState(false)
  const [sidebarWidth, setSidebarWidth] = React.useState<number>()
  const [documentsOpen, setDocumentsOpen] = React.useState(true)
  const [preparing, setPreparing] = React.useState(false)
  const [queue, setQueue] = React.useState<QueuedPrompt[]>([])
  const [preview, setPreview] = React.useState<(FilePreviewFile & { id?: string }) | null>(null)
  const [comparePath, setComparePath] = React.useState("")
  const [messageCache] = React.useState(() => new WeakMap<Message, ChatMessageData>())
  const drawerOpen = mobileOpen && !desktop
  const documentModalOpen = !desktop && !!preview
  const isEmpty = messages.length === 0
  const files = React.useMemo(() => filesFromMessages(messages), [messages])
  const activeTitle = threads.find((thread) => thread.id === activeThreadId)?.title ?? "Nowa rozmowa"
  const history = React.useMemo(() => messages.filter((message) => message.role === "user").map(({ id, content }) => ({ id, text: content })), [messages])
  const sidebarItems = React.useMemo(() => threads.filter((thread) => thread.title.toLocaleLowerCase("pl").includes(search.toLocaleLowerCase("pl"))).map((thread) => ({
    id: thread.id, title: thread.title, pinned: thread.pinned,
    status: thread.id === activeThreadId && isLoading ? "streaming" as const : "idle" as const,
  })), [activeThreadId, isLoading, search, threads])
  const openFile = React.useCallback((file: ChatFile) => { setComparePath(""); setPreview({ id: file.id, path: file.path, content: file.content, language: file.language }) }, [])
  const chatMessages = React.useMemo<ChatMessageData[]>(() => messages.filter((message) => message.role !== "system").map((message) => {
    const cached = messageCache.get(message)
    if (cached) return cached
    const result: ChatMessageData = {
      id: message.id, content: message.content, sender: message.role as "user" | "assistant",
      parts: message.parts, tools: message.tools, workedFor: message.workedFor,
      attachments: message.documents?.map((document, index) => ({ id: `${message.id}-${index}`, name: document.name, mimeType: "text/plain", url: "" })),
      artifacts: message.role === "assistant" ? filesFromMessages([message]).map((file) => ({
        id: file.path, title: file.title, kind: "text", summary: "Otwórz dokument", onOpen: () => openFile(file),
      })) : undefined,
    }
    messageCache.set(message, result)
    return result
  }), [messageCache, messages, openFile])

  React.useEffect(() => {
    try { const width = Number(localStorage.getItem("asystent-rp.sidebar-width")); if (width > 0) setSidebarWidth(width) } catch { /* Default width is usable without storage. */ }
  }, [])
  React.useEffect(() => {
    if (!drawerOpen && !documentModalOpen) return
    const previous = document.activeElement as HTMLElement | null
    const panel = rootRef.current?.querySelector<HTMLElement>(documentModalOpen ? "[data-document-modal]" : "[data-chat-drawer]")
    const focusables = () => [...(panel?.querySelectorAll<HTMLElement>('button:not([disabled]),input,select,a[href],[tabindex="0"]') ?? [])].filter((element) => element.getClientRects().length)
    focusables()[0]?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { if (documentModalOpen) setPreview(null); else setMobileOpen(false) }
      if (event.key !== "Tab") return
      const nodes = focusables(); const first = nodes[0]; const last = nodes.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener("keydown", onKeyDown)
    return () => { document.removeEventListener("keydown", onKeyDown); previous?.focus() }
  }, [documentModalOpen, drawerOpen])

  const exportChat = React.useCallback(() => download(exportConversation(messages, activeTitle), "asystent-rp.md"), [activeTitle, messages])
  const resetWorkspace = React.useCallback(() => { workspaceVersionRef.current += 1; setQueuePaused(false); setQueue([]); setPreview(null); setComparePath(""); composerRef.current?.setDraft({ text: "", files: [], skills: [] }); setMobileOpen(false) }, [])
  const newChat = React.useCallback(() => { resetWorkspace(); newThread() }, [newThread, resetWorkspace])
  const selectChat = React.useCallback((id: string) => { resetWorkspace(); void switchThread(id) }, [resetWorkspace, switchThread])
  const send = React.useCallback(async (payload: ChatInputPayload) => {
    if (/^\/nowa\s*$/.test(payload.text.trim())) { newChat(); return true }
    if (/^\/eksport\s*$/.test(payload.text.trim())) { exportChat(); return true }
    if (preparingRef.current) return false
    preparingRef.current = true
    const version = workspaceVersionRef.current
    setPreparing(true)
    let submitted = false
    try {
      if (payload.files.length > DOCUMENT_COUNT_LIMIT) throw new Error("Dołącz maksymalnie 3 dokumenty.")
      const documents = await Promise.all(payload.files.map(async (file) => {
        if (!DOCUMENT_EXTENSIONS.test(file.name) || file.size > DOCUMENT_CHAR_LIMIT * 4) throw new Error("Obsługiwane są małe dokumenty tekstowe: TXT, MD, CSV, JSON, XML, YAML, LOG. Łącznie do 12000 znaków.")
        return { name: file.name, content: await file.text() }
      }))
      if (version !== workspaceVersionRef.current) return false
      if (!documentsSchema.safeParse(documents).success) throw new Error("Dokumenty muszą być tekstowe, niepuste i mieć łącznie do 12000 znaków.")
      const text = expandTaskPrompt(payload.text) || (documents.length ? "Przeanalizuj załączone dokumenty i wskaż najważniejsze informacje." : "")
      if (!text || text.length > USER_MESSAGE_CHAR_LIMIT) throw new Error("Wiadomość musi mieć od 1 do 4000 znaków.")
      submitted = true
      preparingRef.current = false
      setPreparing(false)
      let result: Promise<boolean> | undefined
      const submit = () => { result = handleSubmit({ preventDefault() {} } as React.FormEvent, text, documents) }
      if (isEmpty) runLayoutTransition(submit); else submit()
      return await result ?? false
    } catch (error) {
      toast({ title: "Nie wysłano wiadomości", description: error instanceof Error ? error.message : "Sprawdź wiadomość.", variant: "destructive" })
      // ChatInput clears after its callback; restore rejected input on the next frame.
      requestAnimationFrame(() => composerRef.current?.setDraft(payload))
      return false
    } finally { if (!submitted) { preparingRef.current = false; setPreparing(false) } }
  }, [exportChat, handleSubmit, isEmpty, newChat, toast])

  React.useEffect(() => {
    if (isLoading || preparing || isThreadsLoading || isConversationLoading || errorMessage || queuePaused || queueBusyRef.current) return
    const next = queue.find((item) => !item.held)
    if (!next) return
    queueBusyRef.current = true
    void send(next).then((success) => {
      if (success) setQueue((current) => current.filter((item) => item.id !== next.id))
      else setQueuePaused(true)
    }).finally(() => { queueBusyRef.current = false })
  }, [errorMessage, isConversationLoading, isLoading, isThreadsLoading, preparing, queue, queuePaused, send])
  const enqueue = React.useCallback((payload: ChatInputPayload) => {
    setQueue((current) => [...current, { ...payload, id: crypto.randomUUID() }])
  }, [])
  const editQueued = React.useCallback((id: string) => {
    const item = queue.find((prompt) => prompt.id === id)
    if (!item) return
    const current = composerRef.current?.getDraft()
    if (current?.text.trim() || current?.files.length) { toast({ title: "Najpierw wyślij lub zapisz obecną wiadomość." }); return }
    composerRef.current?.setDraft(item); composerRef.current?.focus()
    setQueue((currentQueue) => currentQueue.filter((prompt) => prompt.id !== id))
  }, [queue, toast])
  const stash = React.useCallback((payload: ChatInputPayload) => {
    setQueue((current) => [...current, { ...payload, id: crypto.randomUUID(), held: true }]); toast({ title: "Szkic zapisany — wybierz edycję w kolejce, aby go wysłać" })
  }, [toast])
  const stop = React.useCallback(() => { setQueue([]); stopGenerating() }, [stopGenerating])
  const quote = React.useCallback((_id: string, text: string) => {
    composerRef.current?.insertText(`\n> ${text.replace(/\n/g, "\n> ")}\n\n`); composerRef.current?.focus()
  }, [])
  const answerQuestion = React.useCallback(async (messageId: string, toolId: string, result: AskQuestionResult) => {
    const message = messages.find((item) => item.id === messageId)
    const part = message?.parts?.find((item) => item.type === "tool" && item.tool.id === toolId)
    if (!message || part?.type !== "tool") return
    const question = parseAskQuestionInput(part.tool.input)
    if (!question) return
    const text = result.skipped ? "Kontynuuj bez dodatkowych informacji; zaznacz brakujące dane." : question.questions.map((item) => {
      const selected = result.answers[item.id]
      const labels = item.options.filter((option) => selected?.optionIds.includes(option.id)).map((option) => option.label)
      if (selected?.other) labels.push(selected.other)
      return `${item.prompt}: ${labels.join(", ")}`
    }).join("\n")
    const updated = { ...message, parts: message.parts?.map((item) => item === part ? { ...part, tool: { ...part.tool, status: "done" as const, output: JSON.stringify({ ...result, source: "user" }) } } : item) }
    try {
      const { error } = await supabase.from("chat_messages").update({ process: { parts: updated.parts, workedFor: updated.workedFor, sources: updated.sources } }).eq("id", messageId)
      if (error) throw error
      useChatStore.getState().updateMessage(messageId, updated)
      await send({ text, files: [], skills: [] })
    } catch { toast({ title: "Nie udało się zapisać odpowiedzi. Spróbuj ponownie.", variant: "destructive" }) }
  }, [messages, send, supabase, toast])
  const planBuild = React.useCallback((messageId: string, toolId: string) => {
    const file = files.find((item) => item.messageId === messageId && item.toolId === toolId)
    if (file) void send({ text: `Rozwiń analizę według planu „${file.title}” z poprzedniej odpowiedzi. Nie wykonuj żadnych działań w moim imieniu.`, files: [], skills: [] })
  }, [files, send])
  const planOpen = React.useCallback((messageId: string, toolId: string) => {
    const file = files.find((item) => item.messageId === messageId && item.toolId === toolId); if (file) openFile(file)
  }, [files, openFile])
  const mentions = React.useCallback((query: string) => files.filter((file) => file.title.toLocaleLowerCase().includes(query.toLocaleLowerCase())).slice(0, 12).map((file) => ({ id: file.path, label: file.title, description: "Dokument z tej rozmowy", insert: `„${file.title}”` })), [files])
  const onDrop = React.useCallback((drop: SidebarDndDrop) => {
    if (drop.kind === "zone") {
      if (drop.action === "pin") void pinThreads([drop.itemId], true)
      if (drop.action === "delete") void deleteThread(drop.itemId)
    } else if (drop.kind === "reorder") {
      const ids = threads.map((thread) => thread.id); const from = ids.indexOf(drop.itemId); const to = ids.indexOf(drop.overId)
      if (from < 0 || to < 0) return
      ids.splice(from, 1); ids.splice(to, 0, drop.itemId); void reorderThreads(ids)
    }
  }, [deleteThread, pinThreads, reorderThreads, threads])
  const signOut = React.useCallback(async () => { stop(); useChatStore.getState().clearMessages(); await supabase.auth.signOut(); router.replace("/"); router.refresh() }, [router, stop, supabase])
  const renderActions = React.useCallback((message: ChatMessageData) => {
    const original = messages.find((item) => item.id === message.id)
    return <div className="mb-4 space-y-2">
      {original?.sources?.length ? <div className="flex flex-wrap gap-2 text-xs text-muted-foreground" data-slot="chat-sources"><span>Źródła:</span>{original.sources.map((url, index) => <a key={url} href={url} target="_blank" rel="noreferrer" className="rounded border px-2 py-1 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">{new URL(url).hostname} · {index + 1}</a>)}</div> : null}
      {message.sender === "assistant" ? <div className="flex gap-1 opacity-70 hover:opacity-100">
        <ActionButton label="Kopiuj" onClick={() => void navigator.clipboard.writeText(message.content).catch(() => toast({ title: "Nie udało się skopiować." }))}><Copy /></ActionButton>
        <ActionButton label="Wygeneruj ponownie" disabled={isLoading} onClick={() => void regenerateMessage(message.id)}><RefreshCw /></ActionButton>
        <ActionButton label="Pobierz odpowiedź" onClick={() => download(message.content, "odpowiedz.md")}><Download /></ActionButton>
        <ActionButton label="Usuń" disabled={isLoading} onClick={() => deleteMessage(message.id)}><Trash2 /></ActionButton>
      </div> : original?.documents?.map((doc, index) => <button key={index} type="button" className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring" onClick={() => { const file = files.find((item) => item.id === `${message.id}:attachment:${index}`); if (file) openFile(file) }}>Otwórz {doc.name}</button>)}
    </div>
  }, [deleteMessage, files, isLoading, messages, openFile, regenerateMessage, toast])
  const contextChars = React.useMemo(() => trimModelHistory(messages.map((message) => ({ ...message, content: message.content + documentContext(message.documents) }))).reduce((sum, message) => sum + message.content.length, 0) + draftText.length, [draftText, messages])
  const selectedFile = files.find((file) => file.id === preview?.id)
  const selectedPlan = selectedFile?.toolId && messages.find((message) => message.id === selectedFile.messageId)?.parts?.some((part) => part.type === "tool" && part.tool.id === selectedFile.toolId && part.tool.name === "create_plan")
  const compareFile = files.find((file) => file.id === comparePath)
  const previewFile = preview && compareFile && selectedFile ? { path: preview.path, oldText: compareFile.content, newText: selectedFile.content, content: selectedFile.content, language: selectedFile.language } : preview

  const transcript = <div className={cn("flex h-full min-h-0 flex-col", isEmpty && "justify-center")}>
    {isConversationLoading || isThreadsLoading ? <div className="grid flex-1 place-items-center"><Loader2 className="size-5 animate-spin" aria-label="Ładowanie rozmowy" /></div> : isEmpty ?
      <ChatEmptyState title="Co chcesz sprawdzić?" description="Pytaj o ustawy, głosowania i wypowiedzi. Możesz też dołączyć dokument do analizy." icon={<BookOpen />} /> :
      <MessageList messages={chatMessages} conversationKey={activeThreadId ?? "new"} isGenerating={isLoading}
        generationStage={isLoading ? status?.includes("danych") ? "searching" : "responding" : "idle"} generationLabel={status ?? "Odpowiadam"}
        onEditMessage={(id, content) => void editMessage(id, content)} onQuote={quote}
        onAskAnswer={(id, toolId, result) => void answerQuestion(id, toolId, result)} onPlanBuild={planBuild} onPlanOpen={planOpen}
        onFileReferenceClick={(_id, path) => { const file = files.find((item) => item.path === path || item.title === path); if (file) openFile(file) }}
        renderActions={renderActions} />}
    {errorMessage ? <div role="alert" className="mx-auto flex w-full max-w-3xl items-center gap-2 px-4 py-2 text-sm text-destructive"><span className="flex-1">{errorMessage}</span><ActionButton label="Zamknij komunikat" onClick={clearError}><X /></ActionButton></div> : null}
    {queuePaused ? <div className="mx-auto flex w-full max-w-3xl items-center gap-2 px-4 text-xs text-muted-foreground"><span>Kolejka zatrzymana. Popraw lub usuń wiadomość.</span><button type="button" onClick={() => { clearError(); setQueuePaused(false) }} className="rounded border px-2 py-1 focus-visible:ring-2 focus-visible:ring-ring">Wznów</button></div> : null}
    <ChatInput ref={composerRef} placeholder="Napisz wiadomość… (/ komendy, $ skróty, @ dokumenty)" onSend={(payload) => void send(payload)} onStop={stop}
      disabled={preparing || isThreadsLoading || isConversationLoading || drawerOpen} isGenerating={isLoading} history={history}
      slashCommands={CHAT_COMMANDS} skills={CHAT_SKILLS} mentions={mentions} onTextChange={setDraftText}
      onQueue={enqueue} queue={queue.map((item) => ({ id: item.id, text: item.text, fileCount: item.files.length }))}
      onQueueRemove={(id) => setQueue((current) => current.filter((item) => item.id !== id))} onQueueEdit={editQueued} onStash={stash}
      tools={<><ModePicker value={mode} onChange={setMode} modes={MODES} label="Tryb" triggerLabel="Zmień tryb" disabled={isLoading} /><ModelPicker options={MODELS} value="deepseek-flash" label="Model" /><ContextMeter used={contextChars} total={MODEL_HISTORY_CHAR_LIMIT} label={(used, total) => `Przybliżony rozmiar historii: ${used} / ${total} znaków. Serwer przycina starszą historię.`} /></>}
      className={cn(isEmpty && "pb-0 sm:pb-0")} />
    {isEmpty && !isThreadsLoading ? <PromptSuggestions items={SUGGESTIONS} onSelect={(item) => void send({ text: item.label, files: [], skills: [] })} /> : null}
  </div>

  const documentPanel = previewFile ? <div className="flex h-full min-h-0 flex-col bg-background">
    <div className="flex items-center gap-2 border-b px-3 py-2 text-xs">
      <label htmlFor="compare-document">Porównaj z:</label><select id="compare-document" value={comparePath} onChange={(event) => setComparePath(event.target.value)} className="min-w-0 flex-1 rounded border bg-background p-1 focus-visible:ring-2 focus-visible:ring-ring"><option value="">Bez porównania</option>{files.filter((file) => file.id !== preview?.id).map((file) => <option key={file.id} value={file.id}>{file.title}</option>)}</select>
      <ActionButton label="Pobierz dokument" onClick={() => download(previewFile.content ?? "", selectedFile?.title ?? "dokument.md")}><Download /></ActionButton>
      {selectedPlan && selectedFile?.toolId ? <button type="button" disabled={isLoading} onClick={() => { planBuild(selectedFile.messageId, selectedFile.toolId!); if (!desktop) setPreview(null) }} className="rounded border px-2 py-1 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40">Rozwiń analizę</button> : null}
    </div>
    <FilePreview key={`${previewFile.path}-${comparePath}`} file={previewFile} defaultView={comparePath ? "diff" : "file"} className="min-h-0 flex-1" onClose={() => setPreview(null)}
      onLineComment={(range) => { composerRef.current?.insertText(`\nW dokumencie ${selectedFile?.title ?? "dokument"}, wiersze ${range.startLine}-${range.endLine}:\n${range.excerpt}\n`); composerRef.current?.focus() }} />
  </div> : null

  return <div ref={rootRef} className="relative flex h-dvh min-h-0 overflow-hidden bg-background">
    <ChatSidebarDnd zones={ZONES} onDrop={onDrop} canDrop={(itemId, overId) => { const a = threads.find((thread) => thread.id === itemId); const b = threads.find((thread) => thread.id === overId); return !b || a?.pinned === b.pinned }}>
      <button type="button" tabIndex={drawerOpen ? 0 : -1} aria-label="Zamknij panel rozmów" aria-hidden={!drawerOpen} onClick={() => setMobileOpen(false)} className={cn("absolute inset-0 z-40 bg-foreground/20 backdrop-blur-[1px] md:hidden", !drawerOpen && "pointer-events-none opacity-0")} />
      <div data-chat-drawer role={drawerOpen ? "dialog" : undefined} aria-modal={drawerOpen || undefined} aria-label={drawerOpen ? "Rozmowy" : undefined} inert={!desktop && !drawerOpen}
        className={cn("z-50 h-full shrink-0 max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:shadow-xl md:relative", !drawerOpen && "max-md:-translate-x-full")}>
        <ChatSidebar collapsed={desktop ? collapsed : false} onCollapsedChange={(next) => desktop ? setCollapsed(next) : setMobileOpen(false)} edgeZones
          brand={<span className="px-1 text-[15px] font-semibold tracking-tight">Asystent RP</span>}
          nav={<SideActionRow><SideIconBtn label="Nowa rozmowa" onClick={newChat}><Pencil className="size-4" /></SideIconBtn></SideActionRow>}
          rail={<SideIconBtn label="Nowa rozmowa" onClick={newChat}><Pencil className="size-4" /></SideIconBtn>}
          footer={<button type="button" onClick={() => void signOut()} className="flex w-full items-center gap-2 rounded px-2 py-2 text-sm text-muted-foreground hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring"><LogOut className="size-4" />Wyloguj</button>}
          collapseLabel="Zwiń panel" expandLabel="Otwórz panel">
          <label className="mb-3 flex items-center gap-2 rounded-md border px-2 text-muted-foreground"><Search className="size-3.5" /><input aria-label="Szukaj rozmów" placeholder="Szukaj rozmów" value={search} onChange={(event) => setSearch(event.target.value)} className="h-8 min-w-0 w-full bg-transparent text-xs outline-none" /></label>
          <SidebarCollapsibleSection title="Rozmowy" open={chatsOpen} onToggle={() => setChatsOpen((value) => !value)} count={threads.length}>
            <ChatSidebarItemList items={sidebarItems} activeId={activeThreadId ?? undefined} listId="chats" draggable sortable={!search} motion
              emptyState={isThreadsLoading ? "Ładowanie…" : "Brak rozmów"} onSelect={selectChat} onRename={(id, title) => void renameThread(id, title)}
              onTogglePin={(id, pinned) => void pinThreads([id], pinned)} onTogglePinMany={(ids, pinned) => void pinThreads(ids, pinned)} onDelete={(id) => void deleteThread(id)} onDeleteMany={(ids) => void deleteThreads(ids)} />
          </SidebarCollapsibleSection>
          {files.length ? <SidebarCollapsibleSection title="Dokumenty" open={documentsOpen} onToggle={() => setDocumentsOpen((open) => !open)} count={files.length}>
            <FileTree entries={files.map((file) => ({ path: file.path }))} selectedPath={selectedFile?.path} className="h-48" search searchPlaceholder="Szukaj dokumentów" label="Dokumenty rozmowy" onSelect={(path) => { const file = files.find((item) => item.path === path); if (file) { openFile(file); setMobileOpen(false) } }} />
          </SidebarCollapsibleSection> : null}
        </ChatSidebar>
        {desktop && !collapsed ? <SidebarResizeRail targetRef={rootRef} width={sidebarWidth} onWidthChange={(width) => { setSidebarWidth(width); try { localStorage.setItem("asystent-rp.sidebar-width", String(width)) } catch { /* Storage may be disabled. */ } }} label="Zmień szerokość panelu" /> : null}
      </div>
    </ChatSidebarDnd>
    <main inert={drawerOpen || documentModalOpen} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <ChatNavbar title={activeTitle} left={<ActionButton label="Otwórz rozmowy" onClick={() => desktop ? setCollapsed((value) => !value) : setMobileOpen(true)}><PanelLeft /></ActionButton>}
        right={<>{files.length ? <ActionButton label="Otwórz dokumenty" onClick={() => { if (files[0]) openFile(files[0]) }}><FileText /></ActionButton> : null}<ActionButton label="Eksportuj rozmowę" onClick={exportChat}><Download /></ActionButton><ThemeToggle floating={false} /></>} />
      {desktop && documentPanel ? <ResizablePanelGroup className="min-h-0 flex-1"><ResizablePanel defaultSize="60%" minSize="30%">{transcript}</ResizablePanel><ResizableHandle withHandle /><ResizablePanel defaultSize="40%" minSize="25%">{documentPanel}</ResizablePanel></ResizablePanelGroup> : <div className="min-h-0 flex-1">{transcript}</div>}
    </main>
    {!desktop && documentPanel ? <div data-document-modal role="dialog" aria-modal="true" aria-label="Podgląd dokumentu" className="absolute inset-0 z-[60] bg-background">{documentPanel}</div> : null}
  </div>
}
