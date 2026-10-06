// Adapted from T3 Code (github.com/pingdotgg/t3code), MIT License, (c) 2026 T3 Tools Inc.
import {
  getSharedHighlighter,
  type DiffsHighlighter,
  type HighlighterTypes,
  type SupportedLanguages,
} from "@pierre/diffs"

/**
 * Always highlight with the Oniguruma WASM engine — the JS regex engine can
 * backtrack catastrophically and hang whichever thread is tokenizing. The
 * shared highlighter is a first-caller-wins singleton, so every creation site
 * has to pass this value: `DiffView`, `DiffWorkerPoolProvider`, and anything an
 * app preloads with.
 */
export const PREFERRED_HIGHLIGHTER: HighlighterTypes = "shiki-wasm"

/** The two bundled Pierre themes, the light/dark pair `DiffView` renders with. */
export const DIFF_THEMES = {
  light: "pierre-light",
  dark: "pierre-dark",
} as const

export type DiffThemeName = (typeof DIFF_THEMES)[keyof typeof DIFF_THEMES]

export function diffThemeName(theme: "light" | "dark"): DiffThemeName {
  return theme === "dark" ? DIFF_THEMES.dark : DIFF_THEMES.light
}

const highlighterByLanguage = new Map<string, Promise<DiffsHighlighter>>()

/**
 * The one highlighter every surface shares, warmed for `language`. `@pierre/diffs`
 * owns the instance; this only pins the engine and keeps one promise per
 * language so a list of files does not queue the same load twice. A language
 * Shiki does not know falls back to plain text rather than rejecting — only a
 * `text` failure means Shiki itself could not start, and that one is rethrown.
 *
 * Rendering does not need this: `DiffView` passes `preferredHighlighter` down
 * and the library loads what it needs. Call it to warm the cache before a panel
 * opens, or to reuse the same highlighter for search hits and inline snippets.
 */
export function getSharedDiffHighlighter(
  language: string
): Promise<DiffsHighlighter> {
  const cached = highlighterByLanguage.get(language)
  if (cached) return cached

  const promise = getSharedHighlighter({
    themes: [DIFF_THEMES.dark, DIFF_THEMES.light],
    langs: [language as SupportedLanguages],
    preferredHighlighter: PREFERRED_HIGHLIGHTER,
  }).catch((error: unknown) => {
    highlighterByLanguage.delete(language)
    if (language === "text") throw error
    return getSharedDiffHighlighter("text")
  })
  highlighterByLanguage.set(language, promise)
  return promise
}
