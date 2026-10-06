// Adapted from T3 Code (github.com/pingdotgg/t3code), MIT License, (c) 2026 T3 Tools Inc.
/**
 * CommonMark reads four or more spaces after a list marker as an indented code
 * block. In an agent's output that spacing is almost always accidental
 * alignment — `-       text` — and the reader gets a full code card for every
 * bullet. This re-parses only the blocks that keep excess indentation *and*
 * start on the marker's own line; explicit fences and ordinary indented blocks
 * stay code.
 */

type MarkdownPosition = { start?: { line?: number; offset?: number } }

type MarkdownAstNode = {
  type: string
  value?: unknown
  position?: MarkdownPosition
  children?: MarkdownAstNode[]
}

type MarkdownFile = { value?: unknown }

type MarkdownParser = { parse(markdown: string): unknown }

/** The processor's own parser, re-entered for one recovered chunk. */
type ParseMarkdown = (markdown: string) => unknown

type RecoveredMarkdown = { blocks: MarkdownAstNode[]; source: string }

const INLINE_PARSE_PREFIX = "lc-markdown-inline-prefix:"

function isSameLineOverIndentedCode(
  node: MarkdownAstNode,
  parent: MarkdownAstNode | undefined,
  markdown: string
): boolean {
  if (
    node.type !== "code" ||
    parent?.type !== "listItem" ||
    typeof node.value !== "string" ||
    !/^[\t ]/.test(node.value)
  ) {
    return false
  }

  const nodeStart = node.position?.start
  const parentStart = parent.position?.start
  if (
    nodeStart?.line === undefined ||
    nodeStart.offset === undefined ||
    parentStart?.line === undefined ||
    nodeStart.line !== parentStart.line
  ) {
    return false
  }

  const sourceCharacter = markdown[nodeStart.offset]
  return sourceCharacter !== "`" && sourceCharacter !== "~"
}

function parseRecoveredMarkdown(
  value: string,
  parse: ParseMarkdown
): RecoveredMarkdown {
  /* A text prefix forces block-looking input into a paragraph while keeping the
     processor's own inline extensions (GFM syntax, for one). Later root
     children stay blocks, so blank-line-separated content is never dropped. */
  const source = `${INLINE_PARSE_PREFIX}${value}`
  const document = parse(source) as MarkdownAstNode
  const blocks = document.children
  const paragraph = blocks?.[0]
  const children = paragraph?.type === "paragraph" ? paragraph.children : undefined
  const first = children?.[0]
  if (
    !blocks ||
    !children ||
    first?.type !== "text" ||
    typeof first.value !== "string" ||
    !first.value.startsWith(INLINE_PARSE_PREFIX)
  ) {
    return { blocks: [{ type: "text", value }], source }
  }

  const firstValue = first.value.slice(INLINE_PARSE_PREFIX.length)
  return {
    blocks: [
      {
        ...paragraph,
        type: "paragraph",
        children: [
          ...(firstValue ? [{ ...first, value: firstValue }] : []),
          ...children.slice(1),
        ],
      },
      ...blocks.slice(1),
    ],
    source,
  }
}

function blocksFromIndentedCode(
  node: MarkdownAstNode,
  parse: ParseMarkdown
): RecoveredMarkdown {
  const value = typeof node.value === "string" ? node.value.trim() : ""
  const recovered = parseRecoveredMarkdown(value, parse)
  const first = recovered.blocks[0]
  return {
    ...recovered,
    blocks:
      first && node.position
        ? [{ ...first, position: node.position }, ...recovered.blocks.slice(1)]
        : recovered.blocks,
  }
}

/**
 * remark plugin. It re-enters the processor's own parser for the chunk it
 * recovers — so GFM and every other configured extension still applies — which
 * is why it reads `this` and has to stay a `function`.
 */
export function remarkNormalizeListItemIndentation(this: MarkdownParser) {
  const parse: ParseMarkdown = this.parse.bind(this)
  return (tree: MarkdownAstNode, file: MarkdownFile) => {
    if (typeof file.value !== "string") return
    const markdown = file.value

    const visit = (node: MarkdownAstNode, source: string) => {
      if (!node.children) return
      node.children = node.children.flatMap((child) => {
        if (isSameLineOverIndentedCode(child, node, source)) {
          const recovered = blocksFromIndentedCode(child, parse)
          for (const block of recovered.blocks) visit(block, recovered.source)
          return recovered.blocks
        }
        visit(child, source)
        return [child]
      })
    }

    visit(tree, markdown)
  }
}
