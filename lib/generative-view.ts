/**
 * Generative views: a small, closed vocabulary of display blocks that an
 * agent — or a heuristic over a tool's JSON — composes into a view, and that
 * `components/ui/generative-view.tsx` draws.
 *
 * The spec is data, never code. Nothing in it can run, style itself, or reach
 * past the blocks listed here, which is what lets a model write one into an
 * answer without a sandbox: the worst a bad spec can do is look wrong. So
 * everything that arrives is *normalized* rather than trusted — unknown keys
 * dropped, strings and lists capped, links held to `http(s):` and `mailto:`,
 * depth and size bounded — and a block the vocabulary does not have becomes a
 * visible `unknown` placeholder rather than a silent hole.
 *
 * Nothing here knows about any service. A Gerrit review, a Jira search and a
 * CI run are all just data: the agent picks the blocks, or `jsonToView` reads
 * the shape of whatever a tool printed.
 *
 * Framework-free on purpose, so `node --test` can load it.
 */

export type ViewTone = "neutral" | "info" | "success" | "warning" | "danger"

export type ViewBadge = { type: "badge"; label: string; tone: ViewTone }
export type ViewLink = { type: "link"; label: string; href: string }

/** A field value or a table cell: plain text, or one inline block. */
export type ViewInline = string | ViewBadge | ViewLink

export type ViewItem = {
  title: string
  meta?: string
  body?: string
  href?: string
  tone?: ViewTone
}

export type ViewColumn = { label: string; align: "start" | "end" }

export type ViewFormField = {
  name: string
  label: string
  kind: "text" | "textarea" | "select" | "checkbox"
  options?: string[]
  placeholder?: string
  required: boolean
  /** Initial value; `"true"` checks a checkbox. */
  value?: string
}

/**
 * What a view asks of its host. Today one thing: send this text as the user's
 * next message — which is how a button or a form talks back to the agent
 * without the view ever running anything itself.
 */
export type ViewAction = { type: "send"; text: string }

export type ViewNode =
  | {
      type: "card"
      title?: string
      subtitle?: string
      href?: string
      status?: ViewBadge
      children: ViewNode[]
    }
  | { type: "section"; title: string; collapsed: boolean; children: ViewNode[] }
  | { type: "row"; children: ViewNode[] }
  | {
      type: "tabs"
      items: { label: string; children: ViewNode[] }[]
    }
  | { type: "text"; text: string; tone?: ViewTone; mono: boolean }
  | ViewBadge
  | ViewLink
  | { type: "divider" }
  | { type: "fields"; items: { label: string; value: ViewInline }[] }
  | { type: "table"; columns: ViewColumn[]; rows: ViewInline[][] }
  | { type: "list"; items: ViewItem[] }
  | { type: "timeline"; items: ViewItem[] }
  | {
      type: "stats"
      items: { label: string; value: string; hint?: string; tone?: ViewTone }[]
    }
  | {
      type: "progress"
      value: number
      max: number
      label?: string
      tone?: ViewTone
    }
  | { type: "code"; code: string; lang?: string }
  | { type: "diffstat"; added: number; removed: number }
  | { type: "button"; label: string; send: string; tone?: ViewTone }
  | {
      type: "form"
      title?: string
      fields: ViewFormField[]
      submit: string
      send?: string
    }
  | { type: "unknown"; name: string }

export type ViewNodeType = ViewNode["type"]

/** A normalized view: the blocks to draw, top to bottom. */
export type ViewSpec = ViewNode[]

export type ParsedView =
  | { ok: true; view: ViewSpec }
  | { ok: false; error: string }

/** The fence language an answer uses to ask for a view. */
export const VIEW_FENCE_LANGUAGE = "ui"

/**
 * The whole vocabulary, in as few tokens as it can be said. Hand it to a model
 * as standing context — a system prompt, or the fenced block a CLI harness
 * gets in front of its first prompt. A resumed conversation already has it,
 * so it costs once per conversation, not once per turn.
 */
export const VIEW_SPEC_PROMPT = `Views: when a result is structured — a review, issues, CI runs, a comparison — you may show it as a view rather than a markdown table: a fenced block with language \`ui\` holding JSON, one node or an array of nodes. Nodes, by "type":
card{title,subtitle?,href?,status?,children[]} section{title,collapsed?,children[]} row{children[]} tabs{items[{label,children[]}]}
text{text,tone?,mono?} badge{label,tone?} link{label?,href} divider{}
fields{items[{label,value}]} table{columns[],rows[[]]} list{items[]} timeline{items[]}
stats{items[{label,value,hint?,tone?}]} progress{value,max?,label?,tone?} code{code,lang?} diffstat{added,removed}
button{label,send,tone?} form{title?,fields[{name,label,type?:text|textarea|select|checkbox,options?,required?,value?}],submit,send?}
list/timeline items: a string or {title,meta?,body?,href?,tone?}. Field values and table cells: a string, a number, or a badge/link node. status: a string or a badge node. tone: neutral|info|success|warning|danger.
A button sends its \`send\` text to you as the user's next message; a form sends \`send\` (or its submit label) followed by the answers. Use them to offer next steps or collect input; to ask the user a question, prefer your own ask tool if you have one.
Only when it reads better than prose; keep the prose around it short and do not repeat what the view shows.`

/* ---------------------------------------------------------------- limits -- */

const MAX_DEPTH = 8
const MAX_NODES = 400
const MAX_CHILDREN = 60
const MAX_ROWS = 200
const MAX_COLUMNS = 12
const MAX_ITEMS = 100
const MAX_TEXT = 4000
const MAX_LABEL = 200
const MAX_CODE = 20_000

const TONES = new Set<ViewTone>([
  "neutral",
  "info",
  "success",
  "warning",
  "danger",
])

/** Words a model reaches for instead of the five tones. */
const TONE_ALIASES: Record<string, ViewTone> = {
  default: "neutral",
  muted: "neutral",
  primary: "info",
  ok: "success",
  positive: "success",
  good: "success",
  green: "success",
  warn: "warning",
  caution: "warning",
  yellow: "warning",
  error: "danger",
  destructive: "danger",
  critical: "danger",
  negative: "danger",
  bad: "danger",
  red: "danger",
}

/* --------------------------------------------------------------- helpers -- */

type Json = unknown
type Obj = Record<string, Json>

function isObj(value: Json): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function clip(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/** Any scalar as display text; anything else is not text. */
function scalarText(value: Json, max = MAX_LABEL): string | undefined {
  if (typeof value === "string") return clip(value, max)
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  if (typeof value === "boolean") return value ? "yes" : "no"
  return undefined
}

function str(value: Json, max = MAX_LABEL): string | undefined {
  const text = scalarText(value, max)?.trim()
  return text ? text : undefined
}

function num(value: Json): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

export function normalizeTone(value: Json): ViewTone | undefined {
  if (typeof value !== "string") return undefined
  const key = value.trim().toLowerCase()
  if (TONES.has(key as ViewTone)) return key as ViewTone
  return TONE_ALIASES[key]
}

/**
 * The only links a view may carry. A relative href has nothing to resolve
 * against inside a chat, and `javascript:` is the reason this check exists.
 */
export function safeHref(value: Json): string | undefined {
  const href = str(value, 2048)
  if (!href) return undefined
  return /^(https?:\/\/|mailto:)/i.test(href) ? href : undefined
}

/* --------------------------------------------------------------- toning -- */

const SUCCESS_RE =
  /^(merged|closed|done|resolved|fixed|success(ful)?|succeeded|pass(ed|ing)?|ok|green|approved|complete(d)?|verified|released|deployed|active|healthy|\+[12])$/
const DANGER_RE =
  /^(fail(ed|ure|ing)?|error(ed)?|broken|rejected|abandoned|red|blocker|critical|cancel(l)?ed|declined|-[12]|unhealthy|down)$/
const WARNING_RE =
  /^(draft|wip|blocked|warn(ing)?|pending|stale|on[ _-]?hold|needs[ _-].*|changes[ _-]requested|unstable|degraded|skipped|flaky)$/
const INFO_RE =
  /^(new|open(ed)?|in[ _-]?progress|in[ _-]?review|running|queued|started|todo|to[ _-]do|review|ready|scheduled|triage)$/

/** What a status word usually means, for a badge nobody gave a tone. */
export function toneForStatus(label: string): ViewTone {
  const word = label.trim().toLowerCase()
  if (SUCCESS_RE.test(word)) return "success"
  if (DANGER_RE.test(word)) return "danger"
  if (WARNING_RE.test(word)) return "warning"
  if (INFO_RE.test(word)) return "info"
  return "neutral"
}

/* ----------------------------------------------------------- normalizing -- */

type Budget = {
  nodes: number
  /**
   * The JSON was closed by `closePartialJson`: a block whose `type` is still
   * arriving is dropped rather than flashed as "unsupported", and an action
   * is drawn only once its text has landed whole.
   */
  partial: boolean
}

function badgeFrom(value: Json): ViewBadge | undefined {
  if (isObj(value)) {
    const label = str(value.label) ?? str(value.text) ?? str(value.value)
    if (!label) return undefined
    return {
      type: "badge",
      label,
      tone: normalizeTone(value.tone) ?? toneForStatus(label),
    }
  }
  const label = str(value)
  return label
    ? { type: "badge", label, tone: toneForStatus(label) }
    : undefined
}

function linkFrom(value: Obj): ViewLink | undefined {
  const href = safeHref(value.href ?? value.url)
  const label = str(value.label) ?? str(value.text) ?? str(value.title)
  if (!href) return undefined
  return { type: "link", label: label ?? href, href }
}

function inlineFrom(value: Json): ViewInline | undefined {
  if (isObj(value)) {
    if (value.type === "badge") return badgeFrom(value)
    if (value.type === "link") {
      const link = linkFrom(value)
      return link ?? str(value.label)
    }
    return undefined
  }
  if (Array.isArray(value)) {
    const parts = value.map((part) => scalarText(part)).filter(Boolean)
    return parts.length ? clip(parts.join(", "), MAX_TEXT) : undefined
  }
  if (value === null || value === undefined) return undefined
  const text = scalarText(value, MAX_TEXT)
  if (text === undefined) return undefined
  const href = safeHref(text)
  return href ? { type: "link", label: href, href } : text
}

function itemFrom(value: Json): ViewItem | undefined {
  if (!isObj(value)) {
    const title = str(value, MAX_TEXT)
    return title ? { title } : undefined
  }
  const title =
    str(value.title, MAX_TEXT) ??
    str(value.label, MAX_TEXT) ??
    str(value.text, MAX_TEXT) ??
    str(value.name, MAX_TEXT)
  if (!title) return undefined
  return {
    title,
    meta: str(value.meta) ?? str(value.time) ?? str(value.date),
    body: str(value.body, MAX_TEXT) ?? str(value.description, MAX_TEXT),
    href: safeHref(value.href ?? value.url),
    tone:
      normalizeTone(value.tone) ??
      (str(value.status) ? toneForStatus(String(value.status)) : undefined),
  }
}

function childrenFrom(value: Json, depth: number, budget: Budget): ViewNode[] {
  const list = Array.isArray(value) ? value : value === undefined ? [] : [value]
  const out: ViewNode[] = []
  for (const child of list.slice(0, MAX_CHILDREN)) {
    const node = nodeFrom(child, depth + 1, budget)
    if (node) out.push(node)
  }
  return out
}

function fieldsFrom(value: Json): { label: string; value: ViewInline }[] {
  const entries: [Json, Json][] = Array.isArray(value)
    ? value.map((entry) =>
        isObj(entry)
          ? [entry.label ?? entry.key ?? entry.name, entry.value]
          : [undefined, undefined]
      )
    : isObj(value)
      ? Object.entries(value)
      : []
  const out: { label: string; value: ViewInline }[] = []
  for (const [rawLabel, rawValue] of entries.slice(0, MAX_ITEMS)) {
    const label = str(rawLabel)
    const inline = inlineFrom(rawValue)
    if (label && inline !== undefined) out.push({ label, value: inline })
  }
  return out
}

function tableFrom(node: Obj): ViewNode | undefined {
  const rawColumns = Array.isArray(node.columns) ? node.columns : []
  let columns: ViewColumn[] = []
  let keys: string[] | undefined
  for (const column of rawColumns.slice(0, MAX_COLUMNS)) {
    if (isObj(column)) {
      const label = str(column.label) ?? str(column.key) ?? ""
      columns.push({
        label,
        align: column.align === "end" || column.align === "right" ? "end" : "start",
      })
      keys = keys ?? []
      keys.push(str(column.key) ?? label)
    } else {
      const label = str(column) ?? ""
      columns.push({ label, align: "start" })
      keys = keys ?? []
      keys.push(label)
    }
  }
  const rawRows = Array.isArray(node.rows) ? node.rows.slice(0, MAX_ROWS) : []
  // Rows written as objects: the columns are their keys, unless named.
  if (columns.length === 0) {
    const first = rawRows.find(isObj)
    if (first) {
      keys = Object.keys(first).slice(0, MAX_COLUMNS)
      columns = keys.map((key) => ({ label: key, align: "start" }))
    }
  }
  const rows: ViewInline[][] = []
  for (const row of rawRows) {
    const cells = Array.isArray(row)
      ? row.slice(0, MAX_COLUMNS)
      : isObj(row) && keys
        ? keys.map((key) => row[key])
        : undefined
    if (!cells) continue
    rows.push(cells.map((cell) => inlineFrom(cell) ?? ""))
  }
  const width = Math.max(columns.length, ...rows.map((row) => row.length), 0)
  if (width === 0) return undefined
  while (columns.length < width) columns.push({ label: "", align: "start" })
  // A column of numbers reads right-aligned.
  columns.forEach((column, index) => {
    if (
      column.align === "start" &&
      rows.length > 0 &&
      rows.every((row) => {
        const cell = row[index]
        return typeof cell === "string" && (cell === "" || /^[+−-]?[\d.,]+%?$/.test(cell))
      }) &&
      rows.some((row) => row[index] !== "")
    ) {
      column.align = "end"
    }
  })
  return {
    type: "table",
    columns,
    rows: rows.map((row) =>
      row.length < width ? [...row, ...Array(width - row.length).fill("")] : row
    ),
  }
}

function nodeFrom(value: Json, depth: number, budget: Budget): ViewNode | undefined {
  if (depth > MAX_DEPTH || budget.nodes >= MAX_NODES) return undefined
  if (typeof value === "string") {
    const text = str(value, MAX_TEXT)
    if (!text) return undefined
    budget.nodes++
    return { type: "text", text, mono: false }
  }
  if (!isObj(value)) return undefined
  const type = typeof value.type === "string" ? value.type.trim().toLowerCase() : ""
  budget.nodes++
  switch (type) {
    case "card": {
      const status =
        value.status !== undefined ? badgeFrom(value.status) : undefined
      return {
        type: "card",
        title: str(value.title, MAX_TEXT),
        subtitle: str(value.subtitle, MAX_TEXT) ?? str(value.description, MAX_TEXT),
        href: safeHref(value.href ?? value.url),
        status,
        children: childrenFrom(value.children ?? value.body, depth, budget),
      }
    }
    case "section":
    case "group": {
      return {
        type: "section",
        title: str(value.title) ?? str(value.label) ?? "",
        collapsed: value.collapsed === true,
        children: childrenFrom(value.children, depth, budget),
      }
    }
    case "row":
    case "columns":
    case "stack": {
      const children = childrenFrom(value.children, depth, budget)
      // A vertical stack is just the root's own flow.
      return type === "stack" && value.direction !== "row"
        ? { type: "section", title: "", collapsed: false, children }
        : { type: "row", children }
    }
    case "tabs": {
      const items = (Array.isArray(value.items) ? value.items : [])
        .slice(0, 12)
        .flatMap((item) => {
          if (!isObj(item)) return []
          const label = str(item.label) ?? str(item.title)
          if (!label) return []
          return [{ label, children: childrenFrom(item.children, depth, budget) }]
        })
      return items.length ? { type: "tabs", items } : undefined
    }
    case "text":
    case "paragraph":
    case "markdown": {
      const text = str(value.text, MAX_TEXT) ?? str(value.content, MAX_TEXT)
      if (!text) return undefined
      return {
        type: "text",
        text,
        tone: normalizeTone(value.tone),
        mono: value.mono === true,
      }
    }
    case "badge":
    case "status":
      return badgeFrom(value)
    case "link": {
      const link = linkFrom(value)
      if (link) return link
      const text = str(value.label) ?? str(value.text)
      return text ? { type: "text", text, mono: false } : undefined
    }
    case "divider":
    case "separator":
      return { type: "divider" }
    case "fields":
    case "kv":
    case "properties": {
      const items = fieldsFrom(value.items ?? value.fields)
      return items.length ? { type: "fields", items } : undefined
    }
    case "table":
      return tableFrom(value)
    case "list":
    case "timeline": {
      const items = (Array.isArray(value.items) ? value.items : [])
        .slice(0, MAX_ITEMS)
        .map(itemFrom)
        .filter((item): item is ViewItem => !!item)
      return items.length ? { type, items } : undefined
    }
    case "stats":
    case "stat": {
      const raw = type === "stat" ? [value] : Array.isArray(value.items) ? value.items : []
      const items = raw.slice(0, 12).flatMap((item) => {
        if (!isObj(item)) return []
        const label = str(item.label)
        const stat = str(item.value)
        if (!label || stat === undefined) return []
        return [
          {
            label,
            value: stat,
            hint: str(item.hint) ?? str(item.delta),
            tone: normalizeTone(item.tone),
          },
        ]
      })
      return items.length ? { type: "stats", items } : undefined
    }
    case "progress":
    case "meter": {
      const max = Math.max(num(value.max) ?? 100, Number.EPSILON)
      const raw = num(value.value)
      if (raw === undefined) return undefined
      return {
        type: "progress",
        value: Math.min(Math.max(raw, 0), max),
        max,
        label: str(value.label),
        tone: normalizeTone(value.tone),
      }
    }
    case "code": {
      const code = scalarText(value.code ?? value.text, MAX_CODE)
      if (!code) return undefined
      return { type: "code", code, lang: str(value.lang ?? value.language, 40) }
    }
    case "diffstat": {
      const added = num(value.added ?? value.additions)
      const removed = num(value.removed ?? value.deletions)
      if (added === undefined && removed === undefined) return undefined
      return {
        type: "diffstat",
        added: Math.max(0, Math.round(added ?? 0)),
        removed: Math.max(0, Math.round(removed ?? 0)),
      }
    }
    case "button":
    case "action": {
      const label = str(value.label) ?? str(value.text)
      const send = str(value.send, MAX_TEXT) ?? str(value.message, MAX_TEXT) ?? label
      if (!label || !send) return undefined
      return { type: "button", label, send, tone: normalizeTone(value.tone) }
    }
    case "form": {
      const fields = (Array.isArray(value.fields) ? value.fields : [])
        .slice(0, 20)
        .flatMap((field): ViewFormField[] => {
          if (!isObj(field)) return []
          const label = str(field.label) ?? str(field.name)
          const name = str(field.name, 60) ?? label
          if (!label || !name) return []
          const rawKind = str(field.type ?? field.kind, 20)?.toLowerCase()
          const options = Array.isArray(field.options)
            ? field.options
                .slice(0, 50)
                .map((option) => str(isObj(option) ? (option.label ?? option.value) : option))
                .filter((option): option is string => !!option)
            : undefined
          const kind: ViewFormField["kind"] =
            rawKind === "textarea" || rawKind === "checkbox"
              ? rawKind
              : rawKind === "select" || (options && options.length > 0)
                ? "select"
                : "text"
          return [
            {
              name,
              label,
              kind,
              options: kind === "select" ? options : undefined,
              placeholder: str(field.placeholder),
              required: field.required === true,
              value: scalarText(field.value ?? field.default, MAX_TEXT),
            },
          ]
        })
      if (fields.length === 0) return undefined
      return {
        type: "form",
        title: str(value.title),
        fields,
        submit: str(value.submit) ?? str(value.label) ?? "Send",
        send: str(value.send, MAX_TEXT),
      }
    }
    default:
      return budget.partial
        ? undefined
        : { type: "unknown", name: clip(type || "untyped", 40) }
  }
}

/**
 * A view from anything JSON-shaped — one node, or an array of them. Never
 * throws: what cannot be drawn is dropped, or kept as an `unknown` marker.
 */
export function normalizeView(
  value: unknown,
  { partial = false }: { partial?: boolean } = {}
): ViewSpec {
  const budget: Budget = { nodes: 0, partial }
  const list = Array.isArray(value) ? value : [value]
  const out: ViewNode[] = []
  for (const item of list.slice(0, MAX_CHILDREN)) {
    const node = nodeFrom(item, 0, budget)
    if (node) out.push(node)
  }
  return out
}

/**
 * The text of a ` ```ui ` fence, as a view or the reason it is not one.
 *
 * `partial` is for a fence still streaming in: the JSON is closed where it
 * stands (`closePartialJson`) so the view grows token by token instead of
 * waiting for the last brace.
 */
export function parseViewSpec(
  source: string,
  { partial = false }: { partial?: boolean } = {}
): ParsedView {
  const text = source.trim()
  if (!text) return { ok: false, error: "Empty view" }
  let value: unknown
  let closed = false
  try {
    value = JSON.parse(text)
  } catch (error) {
    const repaired = partial ? closePartialJson(text) : undefined
    if (repaired === undefined) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Invalid JSON",
      }
    }
    try {
      value = JSON.parse(repaired)
      closed = true
    } catch {
      return { ok: false, error: "Invalid JSON" }
    }
  }
  const view = normalizeView(value, { partial: closed })
  return view.length > 0
    ? { ok: true, view }
    : { ok: false, error: "Nothing in this view can be drawn" }
}

/* -------------------------------------------------------- streaming -- */

/**
 * JSON cut off mid-stream, closed into a document that parses — or
 * `undefined` when nothing complete has arrived yet.
 *
 * Cuts back to the last point where every open value is whole (after a
 * value, or just inside a bracket), with one exception: a string *value*
 * still arriving is kept and closed, so a long title or comment types itself
 * out rather than appearing at once. An object key never is — half a key is a
 * different key.
 */
export function closePartialJson(text: string): string | undefined {
  const stack: ("{" | "[")[] = []
  /** For each open object: is the next string a key? */
  const expectKey: boolean[] = []
  let inString = false
  let stringIsKey = false
  let escaped = false
  let safe = -1
  let safeStack: ("{" | "[")[] = []

  const markSafe = (index: number) => {
    safe = index
    safeStack = stack.slice()
  }

  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === "\\") escaped = true
      else if (char === '"') {
        inString = false
        if (!stringIsKey) markSafe(index + 1)
      }
      continue
    }
    switch (char) {
      case '"':
        inString = true
        stringIsKey = stack.at(-1) === "{" && expectKey.at(-1) === true
        break
      case "{":
        stack.push("{")
        expectKey.push(true)
        markSafe(index + 1)
        break
      case "[":
        stack.push("[")
        expectKey.push(false)
        markSafe(index + 1)
        break
      case "}":
      case "]":
        stack.pop()
        expectKey.pop()
        markSafe(index + 1)
        break
      case ":":
        if (stack.at(-1) === "{") expectKey[expectKey.length - 1] = false
        break
      case ",":
        // A bare number or literal just ended; the comma itself is the cut.
        if (/[\w.]/.test(text.slice(0, index).trimEnd().slice(-1))) markSafe(index)
        if (stack.at(-1) === "{") expectKey[expectKey.length - 1] = true
        break
    }
  }

  const close = (open: ("{" | "[")[]) =>
    open
      .slice()
      .reverse()
      .map((bracket) => (bracket === "{" ? "}" : "]"))
      .join("")

  if (inString && !stringIsKey) {
    // Never end on half an escape: `\`, `\u00`.
    const body = text.replace(/\\(u[0-9a-fA-F]{0,3})?$/, "")
    return `${body}"${close(stack)}`
  }
  if (safe < 0) return undefined
  return `${text.slice(0, safe)}${close(safeStack)}`
}

/* --------------------------------------------------------------- forms -- */

/**
 * The message a submitted form sends: its `send` line (or the submit label),
 * then one `- Label: answer` line per field that was answered. Plain text on
 * purpose — the agent reads it like anything else the user typed.
 */
export function formMessage(
  form: Extract<ViewNode, { type: "form" }>,
  values: Record<string, string | boolean>
): string {
  const lines = [form.send ?? form.submit]
  for (const field of form.fields) {
    const value = values[field.name]
    if (field.kind === "checkbox") {
      lines.push(`- ${field.label}: ${value === true ? "yes" : "no"}`)
      continue
    }
    const text = typeof value === "string" ? value.trim() : ""
    if (!text) continue
    lines.push(
      text.includes("\n")
        ? `- ${field.label}:\n${text.replace(/^/gm, "  ")}`
        : `- ${field.label}: ${text}`
    )
  }
  return lines.join("\n")
}

/* ---------------------------------------------------- JSON → view, auto -- */

const ID_KEYS = ["key", "number", "iid", "id", "_number", "change_id", "sha"]
const TITLE_KEYS = [
  "title",
  "subject",
  "summary",
  "name",
  "full_name",
  "fullName",
  "displayName",
  "message",
  "description",
]
const STATUS_KEYS = [
  "status",
  "state",
  "conclusion",
  "result",
  "resolution",
  "phase",
  "outcome",
]
const PERSON_KEYS = [
  "owner",
  "author",
  "assignee",
  "user",
  "creator",
  "reporter",
  "committer",
  "uploader",
]
const TIME_KEYS = [
  "updated",
  "updated_at",
  "updatedAt",
  "lastUpdated",
  "created",
  "created_at",
  "createdAt",
  "date",
  "timestamp",
]
const URL_KEYS = ["url", "web_url", "html_url", "htmlUrl", "webUrl", "link", "href", "self"]
const PERSON_NAME_KEYS = [
  "name",
  "displayName",
  "display_name",
  "username",
  "login",
  "email",
]

function firstKey(keys: string[], candidates: string[]) {
  const lower = new Map(keys.map((key) => [key.toLowerCase(), key]))
  for (const candidate of candidates) {
    const key = lower.get(candidate.toLowerCase())
    if (key) return key
  }
  return undefined
}

/** A nested person, project or label as the one word that names it. */
function nameOf(value: Json): string | undefined {
  if (isObj(value)) {
    for (const key of PERSON_NAME_KEYS) {
      const text = str(value[key])
      if (text) return text
    }
    return undefined
  }
  return str(value)
}

/** An epoch in seconds or milliseconds, or an ISO string, as a short date. */
function timeText(value: Json): string | undefined {
  const n = num(value)
  if (n !== undefined && typeof value === "number" && n > 1e9) {
    const ms = n < 1e12 ? n * 1000 : n
    return new Date(ms).toISOString().slice(0, 16).replace("T", " ")
  }
  const text = str(value)
  if (text && /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(text)) {
    return text.slice(0, 16).replace("T", " ")
  }
  return text
}

function cellFor(value: Json, kind: "status" | "time" | "plain"): ViewInline {
  if (kind === "status") return badgeFrom(nameOf(value)) ?? ""
  if (kind === "time") return timeText(value) ?? ""
  return (isObj(value) ? nameOf(value) : inlineFrom(value)) ?? ""
}

function isScalar(value: Json) {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
}

/** Columns worth showing for a list of records, in a reading order. */
function pickColumns(rows: Obj[]) {
  const counts = new Map<string, number>()
  for (const row of rows) {
    for (const [key, value] of Object.entries(row)) {
      if (value === null || value === undefined || value === "") continue
      if (Array.isArray(value) && !value.every(isScalar)) continue
      if (isObj(value) && !nameOf(value)) continue
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  const keys = [...counts.keys()].filter(
    (key) => (counts.get(key) ?? 0) >= Math.max(1, rows.length / 3)
  )
  const id = firstKey(keys, ID_KEYS)
  const title = firstKey(keys, TITLE_KEYS)
  const status = firstKey(keys, STATUS_KEYS)
  const person = firstKey(keys, PERSON_KEYS)
  const time = firstKey(keys, TIME_KEYS)
  const url = firstKey(keys, URL_KEYS)
  const chosen = [id, title, status, person, time].filter(
    (key): key is string => !!key
  )
  for (const key of keys) {
    if (chosen.length >= 6) break
    if (chosen.includes(key) || key === url) continue
    if (/url|href|link|avatar|_links|self|node_id|etag|hash/i.test(key)) continue
    chosen.push(key)
  }
  return { columns: chosen, status, time, url, title: title ?? id }
}

function humanize(key: string) {
  const spaced = key
    .replace(/^_+/, "")
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

const AUTO_ROWS = 50

function recordsTable(rows: Obj[]): ViewNode | undefined {
  const { columns, status, time, url, title } = pickColumns(rows)
  if (columns.length === 0) return undefined
  const shown = rows.slice(0, AUTO_ROWS)
  const table = tableFrom({
    columns: columns.map((key) => humanize(key)),
    rows: shown.map((row) =>
      columns.map((key) => {
        const kind = key === status ? "status" : key === time ? "time" : "plain"
        const cell = cellFor(row[key], kind)
        const href = key === title && url ? safeHref(row[url]) : undefined
        if (href && typeof cell === "string" && cell) {
          return { type: "link", label: cell, href }
        }
        return cell
      })
    ),
  })
  return table
}

function recordCard(record: Obj, depth: number): ViewNode[] {
  const keys = Object.keys(record)
  const titleKey = firstKey(keys, TITLE_KEYS)
  const idKey = firstKey(keys, ID_KEYS)
  const statusKey = firstKey(keys, STATUS_KEYS)
  const urlKey = firstKey(keys, URL_KEYS)
  const fields: { label: string; value: ViewInline }[] = []
  const nested: ViewNode[] = []
  const used = new Set([titleKey, statusKey, urlKey].filter(Boolean))
  for (const key of keys) {
    if (used.has(key)) continue
    const value = record[key]
    if (value === null || value === undefined || value === "") continue
    if (Array.isArray(value) && value.length > 0 && value.every(isObj)) {
      if (depth < 1 && nested.length < 4) {
        const table = recordsTable(value as Obj[])
        if (table) {
          nested.push({
            type: "section",
            title: `${humanize(key)} (${value.length})`,
            collapsed: value.length > 8,
            children: [table],
          })
        }
      }
      continue
    }
    if (fields.length >= 14) continue
    const kind = TIME_KEYS.includes(key) ? "time" : "plain"
    const cell = cellFor(value, kind)
    if (cell !== "") fields.push({ label: humanize(key), value: cell })
  }
  const titleText = titleKey ? nameOf(record[titleKey]) : undefined
  const idText = idKey && idKey !== titleKey ? str(record[idKey]) : undefined
  const title =
    titleText && idText ? `${idText} · ${titleText}` : (titleText ?? idText)
  const children: ViewNode[] = []
  if (fields.length) children.push({ type: "fields", items: fields })
  children.push(...nested)
  if (!title && children.length === 0) return []
  return [
    {
      type: "card",
      title,
      href: urlKey ? safeHref(record[urlKey]) : undefined,
      status: statusKey ? badgeFrom(nameOf(record[statusKey])) : undefined,
      children,
    },
  ]
}

/**
 * Newline-delimited JSON, as `gerrit query --format=JSON`, `gh … --json` with
 * `--jq '.[]'`, or any log shipper prints it. Every line must parse.
 */
function parseJsonLines(text: string): unknown[] | undefined {
  const lines = text.split("\n").filter((line) => line.trim())
  if (lines.length < 2) return undefined
  const out: unknown[] = []
  for (const line of lines) {
    try {
      out.push(JSON.parse(line))
    } catch {
      return undefined
    }
  }
  return out
}

/**
 * Drops the trailer a streaming query appends (`{"type":"stats","rowCount":3}`)
 * — a record that shares not one key with the rest is not one of them.
 */
function dropOutliers(rows: Obj[]): Obj[] {
  if (rows.length < 3) return rows
  return rows.filter((row, index) => {
    const others = new Set(
      rows.flatMap((other, j) => (j === index ? [] : Object.keys(other)))
    )
    return Object.keys(row).some((key) => others.has(key))
  })
}

/**
 * A view of whatever JSON a tool printed, or `undefined` when the output is
 * not JSON or a view would say no more than the text does.
 *
 * Reads shape, never vocabulary: a list of records becomes a table whose
 * columns are picked by what keys usually *mean* (an id, a title, a status, a
 * person, a time), a single record becomes a card with its fields, and a
 * wrapper like `{ total, issues: [...] }` becomes its scalars over its list.
 */
export function jsonToView(output: string | undefined): ViewSpec | undefined {
  const text = output?.trim()
  if (!text || (text[0] !== "{" && text[0] !== "[")) return undefined
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    value = parseJsonLines(text)
    if (value === undefined) return undefined
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return undefined
    if (value.every(isObj)) {
      const rows = dropOutliers(value as Obj[])
      if (rows.length === 1) {
        const card = recordCard(rows[0], 0)
        return card.length ? card : undefined
      }
      const table = recordsTable(rows)
      if (!table) return undefined
      const more = value.length > AUTO_ROWS ? value.length - AUTO_ROWS : 0
      return more > 0
        ? [table, { type: "text", text: `+${more} more`, tone: "neutral", mono: false }]
        : [table]
    }
    if (value.every(isScalar) && value.length > 1) {
      return [
        {
          type: "list",
          items: value.slice(0, MAX_ITEMS).map((item) => ({ title: String(item) })),
        },
      ]
    }
    return undefined
  }

  if (!isObj(value)) return undefined
  const keys = Object.keys(value)
  if (keys.length < 2) {
    // `{ "items": [...] }` — the wrapper says nothing; the list is the view.
    const only = keys[0] ? value[keys[0]] : undefined
    return Array.isArray(only) ? jsonToView(JSON.stringify(only)) : undefined
  }
  const card = recordCard(value, 0)
  return card.length ? card : undefined
}
