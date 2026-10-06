// Adapted from T3 Code (github.com/pingdotgg/t3code), MIT License, (c) 2026 T3 Tools Inc.
/**
 * Which strings inside an answer are file paths — and which of them only look
 * like one. It is the whole difference between a chip that opens a file and a
 * chip that opens nothing, and both mistakes are easy: `and/or` is not a path,
 * `example.com` is a host, `/chat/settings` is a route, and `main.pl:42` is a
 * Perl file rather than a Polish domain precisely *because* of the `:42`.
 *
 * Nothing here touches the filesystem. It answers "does this read as a path",
 * and the host resolves it.
 */

export type FilePathPosition = { path: string; line?: number; column?: number }

const WINDOWS_DRIVE_RE = /^[a-zA-Z]:([/\\]|$)/
const SLASH_PREFIXED_WINDOWS_DRIVE_RE = /^\/[A-Za-z]:[\\/]/
const RELATIVE_PREFIX_RE = /^(~\/|\.{1,2}\/)/
const EXTERNAL_SCHEME_RE = /^([A-Za-z][A-Za-z0-9+.-]*):([\s\S]*)$/
const POSITION_SUFFIX_RE = /:\d+(?::\d+)?$/
const POSITION_SUFFIX_CAPTURE_RE = /:(\d+)(?::(\d+))?$/
const POSITION_HASH_RE = /^#L(\d+)(?:C(\d+))?$/i
const POSITION_ONLY_RE = /^\d+(?::\d+)?$/
const INLINE_CODE_DISQUALIFIER_RE = /[\s`]/
const PATH_SEPARATOR_RE = /[\\/]/
const FILE_EXTENSION_RE = /\.[A-Za-z0-9_-]+$/
const NUMERIC_DOTTED_RE = /^\d+(?:\.\d+)+$/
/** One path, no spaces — segments of word characters, dots, dashes and `@`. */
const PATH_SHAPE_RE = /^(?:[A-Za-z]:)?[\w@.+~-]*(?:[\\/][\w@.+ -]*[\w@.+-])*[\\/]?$/

export function isWindowsAbsolutePath(value: string): boolean {
  return value.startsWith("\\\\") || WINDOWS_DRIVE_RE.test(value)
}

/** Browser URL parsers write `C:/foo` as `/C:/foo` for file URLs. */
export function stripSlashPrefixedWindowsDrive(path: string): string {
  return SLASH_PREFIXED_WINDOWS_DRIVE_RE.test(path) ? path.slice(1) : path
}

/**
 * Standard OS and dev-container roots. Deliberately excludes app-route-ish
 * prefixes like `/app/` or `/chat/`, so an SPA route never reads as a file.
 */
const POSIX_FILE_ROOT_PREFIXES = [
  "/Users/",
  "/home/",
  "/tmp/",
  "/var/",
  "/etc/",
  "/opt/",
  "/mnt/",
  "/Volumes/",
  "/private/",
  "/root/",
  "/usr/",
  "/bin/",
  "/sbin/",
  "/lib/",
  "/lib64/",
  "/srv/",
  "/dev/",
  "/proc/",
  "/sys/",
  "/run/",
  "/boot/",
  "/media/",
  "/workspace/",
  "/workspaces/",
]

/** Extension-less names that are unmistakably files. `Name:digits` is not enough
 *  on its own — it also matches `error:1`, `port:3000` and `TODO:12`. */
const EXTENSIONLESS_FILE_NAMES = new Set([
  "Makefile",
  "makefile",
  "GNUmakefile",
  "Dockerfile",
  "Containerfile",
  "Justfile",
  "justfile",
  "Rakefile",
  "Gemfile",
  "Procfile",
  "Brewfile",
  "Caddyfile",
  "Vagrantfile",
  "Jenkinsfile",
  "Podfile",
  "Fastfile",
  "BUILD",
  "WORKSPACE",
  "LICENSE",
  "LICENCE",
  "COPYING",
  "NOTICE",
  "AUTHORS",
  "CONTRIBUTORS",
  "CHANGELOG",
  "README",
  "CODEOWNERS",
])

/**
 * Dot-files are enumerated rather than matched as "starts with a dot", so a
 * `.length` in an answer stays code.
 */
const DOT_FILE_RE =
  /^\.(env|gitignore|gitattributes|gitmodules|npmrc|nvmrc|editorconfig|dockerignore|babelrc|prettierrc|eslintrc)[\w.-]*$/i

/** `Next.js` and friends are prose about a library, not a JavaScript file. */
const LIBRARY_DOT_JS_RE =
  /^(next|node|nuxt|vue|react|three|d3|socket|express|nest|jquery|chart|video)\.js$/i

const SINGLE_LABEL_HOSTNAMES = new Set(["localhost"])
/** Allowlists rather than "any TLD", so `conf.d/` and `Makefile.in:12` are not hosts. */
const GENERIC_HOSTNAME_TLDS = new Set([
  "com", "net", "org", "io", "dev", "app", "ai", "co", "edu", "gov", "mil",
  "info", "biz", "xyz", "me", "tv", "cc", "gg", "chat", "cloud", "site",
  "online", "tech", "store", "link",
])
/**
 * Country codes that also name file extensions. A `:line` suffix settles it
 * the other way: `main.pl:42` is a file, `example.pl` is a host.
 */
const COUNTRY_HOSTNAME_TLDS = new Set([
  "uk", "de", "fr", "nl", "se", "no", "fi", "dk", "pl", "ch", "at", "be",
  "es", "it", "pt", "eu", "us", "ca", "au", "nz", "jp", "kr", "cn", "br",
  "ru", "mx", "ie", "cz", "tr", "sg", "hk",
])

function looksLikeHostname(segment: string, hasPosition: boolean): boolean {
  if (segment.startsWith(".")) return false
  const lowered = segment.toLowerCase()
  if (SINGLE_LABEL_HOSTNAMES.has(lowered)) return true
  if (NUMERIC_DOTTED_RE.test(segment)) return true
  const labels = lowered.split(".")
  const lastLabel = labels.at(-1)
  if (labels.length < 2 || lastLabel === undefined) return false
  if (GENERIC_HOSTNAME_TLDS.has(lastLabel)) return true
  return !hasPosition && COUNTRY_HOSTNAME_TLDS.has(lastLabel)
}

function basenameOf(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, "")
  if (trimmed.length === 0) return path
  const separator = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"))
  return separator >= 0 ? trimmed.slice(separator + 1) : trimmed
}

/** The last segment of a path, with any trailing separator trimmed off first. */
export function fileBasename(path: string): string {
  return basenameOf(path)
}

function looksLikeNamedFile(basename: string, hasPosition: boolean): boolean {
  if (EXTENSIONLESS_FILE_NAMES.has(basename)) return true
  if (DOT_FILE_RE.test(basename)) return true
  if (LIBRARY_DOT_JS_RE.test(basename)) return false
  if (FILE_EXTENSION_RE.test(basename)) return true
  // A `:line` suffix is the author saying "this is a file", whatever it ends in.
  return hasPosition
}

function looksLikePosixFilesystemPath(path: string, hasPosition: boolean): boolean {
  if (!path.startsWith("/")) return false
  if (POSIX_FILE_ROOT_PREFIXES.some((prefix) => path.startsWith(prefix))) return true
  if (hasPosition) return true
  return looksLikeNamedFile(basenameOf(path), hasPosition)
}

function hasExternalScheme(value: string): boolean {
  if (isWindowsAbsolutePath(value)) return false
  const match = EXTERNAL_SCHEME_RE.exec(value)
  if (!match) return false
  const rest = match[2] ?? ""
  if (rest.startsWith("//")) return true
  // `file.ts:42` matches the scheme shape too — a bare position is not a URL.
  return !POSITION_ONLY_RE.test(rest)
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/**
 * Turns a `file:` URL into a host path. A non-localhost authority becomes a
 * UNC share, which is what it means on Windows.
 */
export function parseFileUrlHref(
  href: string
): { path: string; hash: string } | null {
  try {
    const parsed = new URL(href)
    if (parsed.protocol.toLowerCase() !== "file:") return null
    const uncHostname =
      parsed.hostname.toLowerCase() === "localhost" ? "" : parsed.hostname
    const path = uncHostname
      ? `\\\\${uncHostname}${parsed.pathname.replaceAll("/", "\\")}`
      : parsed.pathname
    if (path.length === 0) return null
    return {
      path: stripSlashPrefixedWindowsDrive(safeDecodeURIComponent(path)),
      hash: parsed.hash,
    }
  } catch {
    return null
  }
}

/** Splits `src/app.ts:42:7` — or a `#L42C7` anchor — into path, line, column. */
export function splitFilePathPosition(path: string, hash = ""): FilePathPosition {
  const suffixMatch = POSITION_SUFFIX_CAPTURE_RE.exec(path)
  const match = suffixMatch ?? POSITION_HASH_RE.exec(hash)
  if (!match?.[1]) return { path }
  const line = Number.parseInt(match[1], 10)
  const column = match[2] === undefined ? undefined : Number.parseInt(match[2], 10)
  return {
    path: suffixMatch ? path.slice(0, -suffixMatch[0].length) : path,
    ...(line > 0 ? { line } : {}),
    ...(column !== undefined && column > 0 ? { column } : {}),
  }
}

export function formatFilePathPosition(position: FilePathPosition): string {
  if (!position.line) return position.path
  return `${position.path}:${position.line}${position.column ? `:${position.column}` : ""}`
}

/**
 * The file an inline-code span names, or null when it reads as ordinary code.
 *
 * The rules, in the order they settle things: a `file:` URL is a path; a
 * Windows absolute path keeps its backslashes and everything else has them
 * normalized; an explicit path shape (`./`, `~/`, `/`, `C:\`) is trusted,
 * except that a POSIX root has to look like a filesystem rather than a route;
 * and a bare relative string has to survive the hostname check and then name
 * something — an extension, a well-known extension-less file, or a `:line`
 * suffix — or be at least three segments deep.
 */
export function inlineCodeFileReference(text: string): FilePathPosition | null {
  const trimmed = text.trim()
  if (trimmed.length === 0 || trimmed.length > 200) return null
  if (INLINE_CODE_DISQUALIFIER_RE.test(trimmed)) return null

  if (trimmed.toLowerCase().startsWith("file:")) {
    const parsed = parseFileUrlHref(trimmed)
    if (!parsed) return null
    const position = splitFilePathPosition(parsed.path, parsed.hash)
    return position.path.length > 0 ? position : null
  }
  if (hasExternalScheme(trimmed)) return null

  const candidate = isWindowsAbsolutePath(trimmed)
    ? trimmed
    : stripSlashPrefixedWindowsDrive(trimmed.replaceAll("\\", "/"))
  const hasPosition = POSITION_SUFFIX_RE.test(candidate)
  const withoutPosition = candidate.replace(POSITION_SUFFIX_RE, "")
  if (withoutPosition.length === 0) return null
  // A UNC share opens on two separators, which no single-path shape allows.
  if (
    !withoutPosition.startsWith("\\\\") &&
    !PATH_SHAPE_RE.test(withoutPosition)
  ) {
    return null
  }

  const explicitShape =
    RELATIVE_PREFIX_RE.test(withoutPosition) ||
    withoutPosition.startsWith("/") ||
    isWindowsAbsolutePath(withoutPosition)

  if (explicitShape) {
    if (
      withoutPosition.startsWith("/") &&
      !isWindowsAbsolutePath(withoutPosition) &&
      !looksLikePosixFilesystemPath(withoutPosition, hasPosition)
    ) {
      return null
    }
    return splitFilePathPosition(candidate)
  }

  const firstSegment = withoutPosition.split(/[\\/]/)[0] ?? withoutPosition
  if (looksLikeHostname(firstSegment, hasPosition)) return null
  if (looksLikeNamedFile(basenameOf(withoutPosition), hasPosition)) {
    return splitFilePathPosition(candidate)
  }
  /* Nothing names a file, so only depth is left: `packages/web/src` reads as a
     directory, `and/or` does not. */
  const segments = withoutPosition.split(/[\\/]/).filter(Boolean)
  return segments.length >= 3 ? splitFilePathPosition(candidate) : null
}

/**
 * The file a markdown link destination names, or null when it is a URL, a
 * route or an anchor. Only a `:line` the author wrote counts as evidence — a
 * `#L12` anchor never turns `/chat/settings` into a file.
 */
export function parseMarkdownFileLink(href: string): FilePathPosition | null {
  const trimmed = href.trim()
  const normalized =
    trimmed.startsWith("<") && trimmed.endsWith(">") ? trimmed.slice(1, -1) : trimmed
  if (
    normalized.length === 0 ||
    normalized.startsWith("#") ||
    normalized.startsWith("//")
  ) {
    return null
  }

  const fileUrl = normalized.toLowerCase().startsWith("file:")
    ? parseFileUrlHref(normalized)
    : null
  let path: string
  let hash: string
  if (fileUrl) {
    path = fileUrl.path
    hash = safeDecodeURIComponent(fileUrl.hash.trim())
  } else {
    const hashIndex = normalized.indexOf("#")
    const withSearch = hashIndex >= 0 ? normalized.slice(0, hashIndex) : normalized
    hash = hashIndex >= 0 ? safeDecodeURIComponent(normalized.slice(hashIndex)) : ""
    const queryIndex = withSearch.indexOf("?")
    const authored = queryIndex >= 0 ? withSearch.slice(0, queryIndex) : withSearch
    // A percent-encoded drive colon (`/c%3A/`) only becomes strippable decoded.
    path = stripSlashPrefixedWindowsDrive(safeDecodeURIComponent(authored.trim()))
  }
  if (path.length === 0 || hasExternalScheme(path)) return null

  const hasPosition = POSITION_SUFFIX_RE.test(path)
  const position = splitFilePathPosition(path, hash)
  if (isWindowsAbsolutePath(position.path) || RELATIVE_PREFIX_RE.test(position.path)) {
    return position
  }
  if (position.path.startsWith("/")) {
    return looksLikePosixFilesystemPath(path, hasPosition) ? position : null
  }
  if (EXTENSIONLESS_FILE_NAMES.has(position.path)) return position
  if (!PATH_SEPARATOR_RE.test(position.path) && !hasPosition) {
    return FILE_EXTENSION_RE.test(position.path) &&
      !LIBRARY_DOT_JS_RE.test(position.path)
      ? position
      : null
  }
  return looksLikeNamedFile(basenameOf(position.path), hasPosition) ||
    position.path.split(/[\\/]/).filter(Boolean).length >= 3
    ? position
    : null
}
