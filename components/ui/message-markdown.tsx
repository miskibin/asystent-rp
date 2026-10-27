"use client"

import * as React from "react"
import { useTheme } from "next-themes"
import {
  Block,
  Streamdown,
  defaultRehypePlugins,
  defaultRemarkPlugins,
  type BlockProps,
  type CustomRendererProps,
} from "streamdown"
import { code } from "@streamdown/code"
import { mermaid } from "@streamdown/mermaid"
import { createMathPlugin } from "@streamdown/math"
import "katex/dist/katex.min.css"
import "./message-markdown.css"

import {
  FileContextMenu,
  type FileActionItem,
} from "@/components/ui/change-summary"
import { FileIcon } from "@/components/ui/file-icon"
import { GenerativeViewBlock } from "@/components/ui/generative-view"
import { RenderErrorBoundary } from "@/components/ui/render-error-boundary"
import { markdownClipboardPayload } from "@/lib/markdown-clipboard"
import {
  inlineCodeFileReference,
  parseMarkdownFileLink,
  type FilePathPosition,
} from "@/lib/markdown-file-paths"
import { VIEW_FENCE_LANGUAGE, type ViewAction } from "@/lib/generative-view"
import { remarkGithubAlerts } from "@/lib/markdown-github-alerts"
import { remarkNormalizeListItemIndentation } from "@/lib/markdown-list-indentation"
import { isContinuation, nextPhraseReveal } from "@/lib/stream-pacing"
import { cn } from "@/lib/utils"

const math = createMathPlugin({
  singleDollarTextMath: true,
})

/**
 * A ` ```ui ` fence is a view, not code: its JSON is drawn by
 * `GenerativeViewBlock` from a closed vocabulary of display blocks. Module
 * scope, like every renderer here — Streamdown compares them by reference.
 */
function ViewFence({ code: source, isIncomplete }: CustomRendererProps) {
  const onAction = React.useContext(ViewActionContext)
  return (
    <GenerativeViewBlock
      code={source}
      isIncomplete={isIncomplete}
      onAction={onAction}
    />
  )
}

const viewRenderers = [{ language: VIEW_FENCE_LANGUAGE, component: ViewFence }]
const plugins = { code, mermaid, math, renderers: viewRenderers }
const pluginsWithoutViews = { code, mermaid, math }

type RehypePlugins = React.ComponentProps<typeof Streamdown>["rehypePlugins"]
type RehypePlugin = NonNullable<RehypePlugins>[number]
type SanitizeSchema = {
  protocols?: Record<string, string[]>
  attributes?: Record<string, unknown[]>
}

/**
 * Two holes in Streamdown's sanitizer, both of which cost a whole feature.
 *
 * It only lets `http` and `https` through on `src`, so an answer that inlines
 * an image as a `data:` URI — how an agent hands back a screenshot or a
 * rendered chart — loses the `<img>` entirely. Putting that one protocol back
 * is safe: the `harden` pass that runs straight after already narrows `data:`
 * down to `data:image/*`, so nothing but a picture can ride in on it.
 *
 * And it drops every `data-` attribute, which would take `data-alert` off the
 * blockquotes `remarkGithubAlerts` marks before the CSS ever sees them. Only
 * that one attribute, only on a blockquote, and its value is one of five words
 * the plugin itself writes.
 */
function messageSanitize(): RehypePlugin {
  const { sanitize } = defaultRehypePlugins
  if (!Array.isArray(sanitize)) return sanitize
  const [plugin, schema] = sanitize as [typeof sanitize[0], SanitizeSchema]
  return [
    plugin,
    {
      ...schema,
      protocols: {
        ...schema.protocols,
        src: [...(schema.protocols?.src ?? []), "data"],
      },
      attributes: {
        ...schema.attributes,
        blockquote: [...(schema.attributes?.blockquote ?? []), "dataAlert"],
      },
    },
  ]
}

/**
 * `raw` → `sanitize` → `fileLinks` → `harden`, Streamdown's own order with one
 * pass inserted: relative links are claimed before the hardening pass, which
 * cannot resolve them (see `fileLinks`).
 */
function messageRehypePlugins(): RehypePlugins {
  const { raw, harden } = defaultRehypePlugins
  return [raw, messageSanitize(), fileLinks, harden]
}

const rehypePlugins = messageRehypePlugins()

type RemarkPlugins = React.ComponentProps<typeof Streamdown>["remarkPlugins"]

/**
 * Two things GFM does not do on its own. `remarkGithubAlerts` lifts a
 * `> [!NOTE]` marker onto the blockquote as `data-alert`, which
 * `message-markdown.css` styles as a callout; `remarkNormalizeListItemIndentation`
 * undoes the CommonMark rule that turns `-       aligned text` into a code
 * block, which an agent's own alignment hits constantly.
 */
// Streamdown's `remarkPlugins` REPLACES its default chain rather than
// extending it, and that chain is where GFM comes from — hand it only these
// two and every table renders as pipe-separated text. So the defaults come
// first, then ours, which both expect the tree GFM has already shaped.
const remarkPlugins = [
  ...Object.values(defaultRemarkPlugins),
  remarkGithubAlerts,
  remarkNormalizeListItemIndentation,
] as unknown as RemarkPlugins

/**
 * One block, isolated. A malformed fence, an unbalanced KaTeX brace or a
 * half-streamed mermaid diagram throws during render, and without a boundary
 * that throw unmounts the whole message — the answer, the tool rows, the turn.
 * Here it costs one block, which falls back to its own source as plain text.
 *
 * Module scope on purpose: `BlockComponent` reaches a memoized renderer, and a
 * component redefined per render would remount every block on every token.
 */
function IsolatedBlock(props: BlockProps) {
  return (
    <RenderErrorBoundary
      resetKeys={[props.content]}
      fallback={
        <pre
          data-slot="message-markdown-block-fallback"
          className="my-2 overflow-x-auto rounded-md border bg-muted px-3 py-2 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap text-foreground"
        >
          {props.content}
        </pre>
      }
    >
      <Block {...props} />
    </RenderErrorBoundary>
  )
}
const shikiTheme: ["github-light", "github-dark"] = [
  "github-light",
  "github-dark",
]

/**
 * A link in an answer opens straight away.
 *
 * Streamdown's default is the opposite: `linkSafety` is on, so every external
 * link renders as a `<button>` that raises an "Open external link?" modal
 * before it will go anywhere. That interstitial is meant for a chat with an
 * untrusted model on a page full of other people's content; here the answer is
 * the user's own agent citing the docs it just read, and the modal is a second
 * click between them and every URL — with no anchor left to middle-click,
 * "Copy link address", or hand to a host that wants to route the click itself.
 *
 * Off, the link is an `<a target="_blank" rel="noreferrer">` again: the browser
 * opens it in a tab, and a host embedding this (a desktop shell, where
 * `target="_blank"` has no window to open into) can intercept the click on a
 * real anchor and send it to the system browser instead.
 */
const linkSafety = { enabled: false } as const
const EMPTY_HANDLERS: MarkdownPatternHandler[] = []

export type MarkdownPatternHandler = {
  pattern: RegExp
  render: (match: RegExpExecArray) => React.ReactNode
}

export type MessageMarkdownProps = {
  children: string
  className?: string
  /** True while the text is still streaming in. */
  isAnimating?: boolean
  /**
   * How streamed text reaches the screen. `"paced"` spreads each burst over
   * the next few frames — never more than ~300ms behind the stream — and
   * fades every new word in; `"instant"` paints chunks exactly as they land.
   * Text already present when the component mounts is never replayed.
   *
   * @default "paced"
   */
  streaming?: "paced" | "instant"
  /**
   * A caret after the last line while text is arriving. Off by default; the
   * paced fade already says the answer is live.
   */
  caret?: "block" | "circle"
  /** Inline replacements applied to paragraph and list-item text. */
  patternHandlers?: MarkdownPatternHandler[]
  /**
   * Makes a file reference a button — an inline-code path and a relative
   * markdown link alike. The path arrives without its `:line` (or `#L42`)
   * suffix, and the line it named arrives beside it, ready to hand to a file
   * panel.
   */
  onFileClick?: (path: string, line?: number) => void
  /**
   * Right-click menu for every file the answer names — the path chips and the
   * images it renders. Keep the array stable: it reaches memoized blocks.
   */
  fileActions?: FileActionItem[]
  /**
   * Copying a selection out of the answer writes markdown rather than the
   * flattened text the browser would put on the clipboard — links, emphasis,
   * lists, fences and tables all survive the round trip, and a rich-paste
   * target gets a sanitized copy of the rendered HTML beside it.
   *
   * @default true
   */
  copyAsMarkdown?: boolean
  /**
   * Draws a ` ```ui ` fence as a view (`GenerativeView`) instead of showing
   * its JSON. Off, the fence is an ordinary code block.
   *
   * @default true
   */
  views?: boolean
  /**
   * What a view's button or form asks for — a message to send as the user's
   * next turn. Without it those actions are drawn disabled.
   */
  onViewAction?: (action: ViewAction) => void
}

type FileRefContextValue = {
  onFileClick: ((path: string, line?: number) => void) | null
  fileActions?: FileActionItem[]
}

const NO_FILE_REFS: FileRefContextValue = { onFileClick: null }

/**
 * What a file reference can do reaches the renderers through context rather
 * than through a closure, so they can stay module-scope: Streamdown memoizes
 * each block against `components` key by key, by reference, and a fresh
 * function per render would re-render every block on every token.
 */
const FileRefContext = React.createContext<FileRefContextValue>(NO_FILE_REFS)

/** Same reason as `FileRefContext`: the fence renderer is module scope. */
const ViewActionContext = React.createContext<
  ((action: ViewAction) => void) | undefined
>(undefined)

/**
 * Every href the hardening pass resolves on its own: an absolute URL or custom
 * scheme, a host- or root-relative URL, an in-page anchor, and a dot-relative
 * path. Those keep Streamdown's own treatment.
 */
const HARDENABLE_HREF_RE = /^(?:[a-zA-Z][\w+.-]*:|\/|#|\.{1,2}\/)/

/** A relative link is a file, plain text, or none of this file's business. */
type LinkVerdict = FilePathPosition | { path: null }

/**
 * What `[label](href)` should become. `null` leaves the link alone.
 *
 * A path is a path whether or not it starts with `./` — `README.md` and
 * `./docs/setup.md` are the same reference — so `parseMarkdownFileLink` gets
 * first refusal and a dot-relative path is claimed too, rather than being
 * resolved against the page the transcript happens to be rendered on.
 */
function classifyLinkHref(href: string): LinkVerdict | null {
  const text = href.trim()
  if (!text) return { path: null }
  const reference = parseMarkdownFileLink(text)
  if (reference) return reference
  return HARDENABLE_HREF_RE.test(text) ? null : { path: null }
}

/** The slice of a hast node this file walks — no `@types/hast` dependency. */
type HastNode = {
  type: string
  tagName?: string
  properties?: Record<string, unknown>
  children?: HastNode[]
}

/**
 * The element `fileLinks` leaves behind for `MarkdownFileLink` to render.
 * Invented after the sanitizer has run, so markdown that writes the tag by
 * hand cannot reach that renderer — the sanitizer drops unknown tags.
 */
const FILE_LINK_TAG = "file-link"

/**
 * Relative links, before the hardening pass can mangle them.
 *
 * `rehype-harden` resolves an href against `defaultOrigin`, and Streamdown
 * leaves that unset: `[README](README.md)` parses as no URL at all and is
 * replaced with a grey `[blocked]` marker, while `[docs](./docs/setup.md)`
 * survives only as `/docs/setup.md` — a link off the page the transcript is
 * rendered on. Neither is what an agent citing a file in its workspace meant,
 * and agents cite files constantly.
 *
 * So a relative link that names a path becomes the same chip an inline-code
 * reference does, one the host can open through `onFileClick`; a relative link
 * that names nothing resolvable degrades to the text it wrapped. Absolute
 * links, anchors and images are untouched and reach `harden` as before.
 */
function fileLinks() {
  return (tree: HastNode) => {
    rewriteFileLinks(tree)
  }
}

function rewriteFileLinks(node: HastNode) {
  const children = node.children
  if (!children) return
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index]
    if (!child || child.type !== "element") continue
    rewriteFileLinks(child)
    if (child.tagName !== "a") continue
    const href = child.properties?.href
    if (typeof href !== "string") continue
    const verdict = classifyLinkHref(href)
    if (!verdict) continue
    if (verdict.path !== null) {
      children[index] = {
        type: "element",
        tagName: FILE_LINK_TAG,
        properties: {
          dataPath: verdict.path,
          dataLine: verdict.line,
          dataHref: href,
        },
        children: child.children ?? [],
      }
      continue
    }
    const label = child.children ?? []
    children.splice(index, 1, ...label)
    index += label.length - 1
  }
}

function textOf(node: React.ReactNode): string {
  if (typeof node === "string") return node
  if (typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(textOf).join("")
  return ""
}

const fileRefChip =
  "inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/60 px-1.5 py-0 align-baseline font-mono text-[12px] text-foreground/90"

/**
 * One chip for both ways an answer names a file — an inline-code path and a
 * relative markdown link. The label stays whatever the answer wrote; only the
 * handler is told the path and the line.
 */
function FileRefChip({
  path,
  line,
  copyAs,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"span">, "ref"> & {
  path: string
  line?: number
  /**
   * What a copied selection crossing this chip should yield — the markdown the
   * answer wrote, rather than the empty string a `<button>` serializes to.
   */
  copyAs?: string
}) {
  const { onFileClick, fileActions } = React.useContext(FileRefContext)
  const label = (
    <>
      <FileIcon path={path} size={13} aria-hidden />
      {children}
    </>
  )

  /* A chip with no click handler is still a right-click target, so it has to
     be reachable: focused, Shift+F10 and the Menu key open the same menu. */
  const menuOnly = !!fileActions?.length
  const chip = !onFileClick ? (
    <span
      data-slot="message-file-ref"
      data-path={path}
      data-markdown-copy={copyAs}
      tabIndex={menuOnly ? 0 : undefined}
      className={cn(
        fileRefChip,
        menuOnly &&
          "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        className
      )}
      {...props}
    >
      {label}
    </span>
  ) : (
    <button
      type="button"
      data-slot="message-file-ref"
      data-path={path}
      data-markdown-copy={copyAs}
      data-interactive="true"
      title={path}
      onClick={() => onFileClick(path, line)}
      className={cn(
        fileRefChip,
        "cursor-pointer outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50",
        className
      )}
      {...(props as React.ComponentProps<"button">)}
    >
      {label}
    </button>
  )

  return (
    <FileContextMenu path={path} actions={fileActions}>
      {chip}
    </FileContextMenu>
  )
}

/**
 * Streamdown routes bare inline spans here and leaves fenced blocks (and
 * mermaid / math) on their own renderer, so this only ever sees `` `code` ``.
 * Anything that is not a file reference renders as Streamdown's own inline
 * code, untouched.
 */
function InlineCode({
  node,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"code">, "ref"> & { node?: unknown }) {
  // `node` is Streamdown's hast element — destructured out so it never reaches
  // the DOM, and of no use to a chip that reads its own text.
  void node
  const text = textOf(children)
  const reference = inlineCodeFileReference(text)

  if (!reference) {
    return (
      <code
        className={cn(
          "rounded bg-muted px-1.5 py-0.5 font-mono text-sm",
          className
        )}
        data-streamdown="inline-code"
        {...props}
      >
        {children}
      </code>
    )
  }

  // The chip keeps saying `file.ts:42`; only the handler is told the number.
  return (
    <FileRefChip
      path={reference.path}
      line={reference.line}
      copyAs={`\`${text}\``}
      className={className}
      {...props}
    >
      {children}
    </FileRefChip>
  )
}

/**
 * Only used when the host offered file actions — Streamdown's own renderer,
 * with its hover download control, stays in place otherwise.
 *
 * A `data:` image is its own bytes rather than a file on the machine, so it
 * gets no menu. Anything else is handed over as written: a host that rewrote a
 * local path into `/api/files?path=…` gets that URL back and decodes it.
 */
function MarkdownImage({
  node,
  className,
  src,
  alt,
  ...props
}: Omit<React.ComponentProps<"img">, "ref"> & { node?: unknown }) {
  void node
  const { fileActions } = React.useContext(FileRefContext)
  const path = typeof src === "string" && !src.startsWith("data:") ? src : null
  // Same as the chip: an image that carries a menu is focusable, so the
  // keyboard can open it.
  const menuable = !!path && !!fileActions?.length
  const image = (
    // eslint-disable-next-line @next/next/no-img-element -- data: URLs and arbitrary remote hosts, not a next/image-friendly asset
    <img
      data-slot="message-markdown-image"
      data-streamdown="image"
      src={src}
      alt={alt ?? ""}
      tabIndex={menuable ? 0 : undefined}
      className={cn(
        "max-w-full rounded-lg",
        menuable &&
          "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        className
      )}
      {...props}
    />
  )
  if (!path) return image
  return (
    <FileContextMenu path={path} actions={fileActions}>
      {image}
    </FileContextMenu>
  )
}

/**
 * The relative link `fileLinks` claimed — `[the route](app/page.tsx:12)`, a
 * bare `README.md`, or a `file://` URL a harness pasted. Rendered as the same
 * chip an inline-code path gets, so both open the same panel at the same line.
 * Streamdown types a tag of its own loosely, so the path arrives as a plain
 * record entry.
 *
 * The label is flattened to text: an answer that writes ``[`README.md`](README.md)``
 * would otherwise nest a chip inside a chip, and a chip is a button.
 */
function MarkdownFileLink(props: Record<string, unknown>) {
  const rawPath = props["data-path"]
  const rawLine = props["data-line"]
  const rawHref = props["data-href"]
  const path = typeof rawPath === "string" ? rawPath : ""
  const parsedLine = typeof rawLine === "number" ? rawLine : Number(rawLine)
  const line =
    Number.isFinite(parsedLine) && parsedLine > 0 ? parsedLine : undefined
  const label = textOf(props.children as React.ReactNode).trim()
  if (!path) return <>{label}</>
  const text = label || path
  const href = typeof rawHref === "string" ? rawHref : path
  return (
    <FileRefChip path={path} line={line} copyAs={`[${text}](${href})`}>
      {text}
    </FileRefChip>
  )
}

/**
 * Holds a callback prop at one identity, so a parent that re-renders on every
 * streamed token does not invalidate what depends on it.
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
 * A phrase arrives as one: its words fade in together, quickly — long enough
 * to soften the edge, short enough that nothing reads as lagging behind.
 */
const PHRASE_FADE = {
  animation: "fadeIn",
  duration: 240,
  easing: "ease-out",
  sep: "word",
  stagger: 6,
  maxBacklogMs: 120,
} as const

/** A first chunk this short is typed out rather than painted whole. */
const PACE_FROM_START_CHARS = 120

/**
 * The text to paint this frame: a phrase more per beat, trailing `text` by a
 * little while it streams (see `nextPhraseReveal`). Only growth while
 * paced is spread out: a mount, a transcript swap or an edit shows the text
 * as it is. `settling` stays true while what arrived before the stream ended
 * is still being drawn.
 */
/**
 * How much of each streamed text has already been on screen, by its opening
 * characters. A streaming answer is remounted when the list regroups it — the
 * text before a tool call moves under the "worked for" disclosure the moment
 * that call arrives — and a fresh instance would otherwise start from nothing:
 * reveal the text again and fade every word in again, so the paragraph the
 * reader was on blinked out and back. Module state, because the instance that
 * knew is gone; bounded, because it only has to bridge a remount.
 */
const revealedTexts = new Map<string, number>()
const REVEAL_KEY_CHARS = 64
const MIN_REVEAL_KEY_CHARS = 20
const MAX_REVEALED_TEXTS = 300

function rememberRevealed(text: string, length: number) {
  if (length <= 0) return
  const key = text.slice(0, Math.min(REVEAL_KEY_CHARS, length))
  if ((revealedTexts.get(key) ?? 0) >= length) return
  revealedTexts.delete(key)
  revealedTexts.set(key, length)
  if (revealedTexts.size > MAX_REVEALED_TEXTS) {
    revealedTexts.delete(revealedTexts.keys().next().value as string)
  }
}

/**
 * How much of `text` an earlier instance already showed, or 0. A short key
 * only matches exactly: "I'll check" opens too many answers to be evidence.
 */
function recallRevealed(text: string) {
  let best = 0
  for (const [key, length] of revealedTexts) {
    if (length <= best) continue
    const matches =
      key.length >= MIN_REVEAL_KEY_CHARS ? text.startsWith(key) : text === key
    if (matches) best = Math.min(length, text.length)
  }
  return best
}

function usePacedText(text: string, streaming: boolean, enabled: boolean) {
  // Decided once, at mount: text this component has seen before (in an
  // earlier instance) continues from where it was and does not fade again.
  const [restored] = React.useState(() =>
    enabled && streaming ? recallRevealed(text) : 0
  )
  const [shown, setShown] = React.useState(() =>
    restored > 0
      ? restored
      : enabled && streaming && text.length <= PACE_FROM_START_CHARS
        ? 0
        : text.length
  )
  const [source, setSource] = React.useState(text)
  let length = shown
  // Adjusted while rendering: a text that is not a continuation of the last
  // one must never paint a frame sliced at the old length.
  if (source !== text) {
    setSource(text)
    if (!enabled || !isContinuation(source, text)) {
      length = text.length
      setShown(length)
    }
  }
  if (!enabled && length !== text.length) {
    length = text.length
    setShown(length)
  }

  React.useEffect(() => {
    if (enabled) rememberRevealed(text, length)
  }, [enabled, length, text])

  const behind = enabled && length < text.length
  /**
   * When the reveal last moved. A ref, not effect-local: the effect restarts
   * on every token that arrives, and the beat is measured across restarts.
   */
  const advancedAtRef = React.useRef(0)
  React.useEffect(() => {
    if (!behind) return
    let frame = 0
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick)
      if (!advancedAtRef.current) advancedAtRef.current = now - 10_000
      const next = nextPhraseReveal(text, length, now - advancedAtRef.current, streaming)
      // Most frames change nothing — and then nothing re-renders.
      if (next > length) {
        advancedAtRef.current = now
        setShown(next)
      }
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [behind, length, streaming, text])

  return {
    text: length >= text.length ? text : text.slice(0, length),
    settling: behind,
    restored: restored > 0,
  }
}

/**
 * Memoized so a streaming message list only re-renders the message that
 * actually changed.
 */
export const MessageMarkdown = React.memo(function MessageMarkdown({
  children,
  className,
  isAnimating = false,
  streaming = "paced",
  caret,
  patternHandlers = EMPTY_HANDLERS,
  onFileClick,
  fileActions,
  copyAsMarkdown = true,
  views = true,
  onViewAction,
}: MessageMarkdownProps) {
  const paced = streaming === "paced"
  const {
    text: visibleText,
    settling,
    restored,
  } = usePacedText(
    children,
    isAnimating,
    paced
  )
  // A paced answer is still "animating" while it drains what already
  // arrived, so the fade and the caret stay with it until the last word.
  const live = isAnimating || settling
  const { resolvedTheme } = useTheme()
  const mermaidConfig = React.useMemo(
    () => ({
      config: {
        theme: resolvedTheme === "dark" ? ("dark" as const) : ("neutral" as const),
      },
    }),
    [resolvedTheme]
  )

  /* Overriding `img` costs Streamdown's own download control, so it is only
     swapped in where the host actually has something to offer on a picture. */
  const menuOnImages = !!fileActions?.length

  const components = React.useMemo(() => {
    const image = menuOnImages ? { img: MarkdownImage } : null
    // `inlineCode` is the same function every time — Streamdown compares the
    // map key by key, by reference, so rebuilding the object costs nothing.
    const chips = {
      inlineCode: InlineCode,
      [FILE_LINK_TAG]: MarkdownFileLink,
    }
    if (patternHandlers.length === 0) return { ...chips, ...image }
    /**
     * Scanning from an offset needs `lastIndex`, which is state on the regex —
     * so each handler gets a private copy, always global. The caller's own
     * RegExp is never written to (rendering must not mutate props), and a
     * pattern handed in without the `g` flag now advances instead of matching
     * its first hit forever.
     */
    const compiled = patternHandlers.map((handler) => ({
      handler,
      pattern: new RegExp(
        handler.pattern.source,
        handler.pattern.flags.includes("g")
          ? handler.pattern.flags
          : handler.pattern.flags + "g"
      ),
    }))
    const process = (text: string): React.ReactNode => {
      const segments: React.ReactNode[] = []
      let cursor = 0
      while (cursor < text.length) {
        let earliest: {
          handler: MarkdownPatternHandler
          match: RegExpExecArray
          index: number
        } | null = null
        for (const { handler, pattern } of compiled) {
          pattern.lastIndex = cursor
          const match = pattern.exec(text)
          if (match && (!earliest || match.index < earliest.index)) {
            earliest = { handler, match, index: match.index }
          }
        }
        if (!earliest) {
          segments.push(text.slice(cursor))
          break
        }
        if (earliest.index > cursor) {
          segments.push(text.slice(cursor, earliest.index))
        }
        let rendered: React.ReactNode
        try {
          rendered = earliest.handler.render(earliest.match) ?? earliest.match[0]
        } catch {
          rendered = earliest.match[0]
        }
        segments.push(rendered)
        cursor = earliest.index + earliest.match[0].length
      }
      return segments
    }
    const wrap = (node: React.ReactNode): React.ReactNode => {
      if (Array.isArray(node)) {
        return node.map((child, index) => (
          <span key={index}>
            {typeof child === "string" ? process(child) : child}
          </span>
        ))
      }
      return typeof node === "string" ? process(node) : node
    }
    return {
      ...chips,
      ...image,
      // Streamdown hands every renderer its hast `node`; it is not a DOM prop.
      p: ({
        children: kids,
        node,
        ...props
      }: { children?: React.ReactNode; node?: unknown }) => {
        void node
        return <p {...props}>{wrap(kids)}</p>
      },
      li: ({
        children: kids,
        node,
        ...props
      }: { children?: React.ReactNode; node?: unknown }) => {
        void node
        return <li {...props}>{wrap(kids)}</li>
      },
    }
  }, [patternHandlers, menuOnImages])

  /* Either the stable callback or null — one identity each, so the provider
     never invalidates the blocks below it mid-stream. */
  const stableFileClick = useStableCallback(onFileClick)
  const fileClick = onFileClick ? stableFileClick : null
  const fileRefs = React.useMemo(
    () => ({ onFileClick: fileClick, fileActions }),
    [fileClick, fileActions]
  )
  const stableViewAction = useStableCallback(onViewAction)
  const viewAction = onViewAction ? stableViewAction : undefined

  /**
   * Serializing the selection back to markdown, on the way to the clipboard.
   * One stable handler on the wrapper: the work happens only when someone
   * actually copies, and nothing below it re-renders because of it.
   */
  const handleCopy = React.useCallback(
    (event: React.ClipboardEvent<HTMLDivElement>) => {
      const selection = window.getSelection()
      if (!selection || selection.isCollapsed) return
      const payload = markdownClipboardPayload(selection)
      if (!payload) return
      event.clipboardData.setData("text/plain", payload.text)
      event.clipboardData.setData("text/html", payload.html)
      event.preventDefault()
    },
    []
  )

  return (
    <div
      data-slot="message-markdown"
      className="min-w-0"
      onCopy={copyAsMarkdown ? handleCopy : undefined}
    >
      <FileRefContext.Provider value={fileRefs}>
        <ViewActionContext.Provider value={viewAction}>
          <Streamdown
            className={cn("lc-markdown max-w-none", className)}
            plugins={views ? plugins : pluginsWithoutViews}
            rehypePlugins={rehypePlugins}
            remarkPlugins={remarkPlugins}
            BlockComponent={IsolatedBlock}
            shikiTheme={shikiTheme}
            mermaid={mermaidConfig}
            isAnimating={live}
            animated={paced && !restored ? PHRASE_FADE : undefined}
            caret={caret}
            linkSafety={linkSafety}
            parseIncompleteMarkdown
            codeBlockMaxHeight={Infinity}
            tableMaxHeight={Infinity}
            components={components}
          >
            {visibleText}
          </Streamdown>
        </ViewActionContext.Provider>
      </FileRefContext.Provider>
    </div>
  )
})
