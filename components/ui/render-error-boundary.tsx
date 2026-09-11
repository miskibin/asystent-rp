"use client"

// Adapted from T3 Code (github.com/pingdotgg/t3code), MIT License, (c) 2026 T3 Tools Inc.
import * as React from "react"

export type RenderErrorBoundaryProps = {
  children: React.ReactNode
  /** What to show instead of the children that threw. */
  fallback: React.ReactNode
  /**
   * Inputs the failed render depended on. When any of them changes the
   * boundary tries again — without remounting healthy siblings or losing the
   * scroll position of the row it sits in.
   */
  resetKeys?: readonly unknown[]
}

type RenderErrorBoundaryState = {
  failed: boolean
  resetKeys?: readonly unknown[]
}

/**
 * One render, isolated. A message row draws things it did not write — a
 * mermaid diagram from a half-streamed fence, a KaTeX expression with an
 * unbalanced brace, a highlighter handed a language it does not have — and
 * any one of them throwing takes the whole transcript down with it, because a
 * React render error unmounts the nearest boundary and there is nothing
 * between the block and the app.
 *
 * So each of those gets its own boundary and its own plain-text fallback: the
 * fence that could not be drawn shows as a `<pre>`, and the answer around it
 * stays on screen.
 */
export class RenderErrorBoundary extends React.Component<
  RenderErrorBoundaryProps,
  RenderErrorBoundaryState
> {
  state: RenderErrorBoundaryState = {
    failed: false,
    resetKeys: this.props.resetKeys,
  }

  // Retry changed inputs without remounting healthy children or their controls.
  static getDerivedStateFromProps(
    { resetKeys }: RenderErrorBoundaryProps,
    state: RenderErrorBoundaryState
  ): RenderErrorBoundaryState | null {
    if (
      resetKeys?.length !== state.resetKeys?.length ||
      resetKeys?.some((key, index) => !Object.is(key, state.resetKeys?.[index]))
    ) {
      return { failed: false, resetKeys }
    }
    return null
  }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}
