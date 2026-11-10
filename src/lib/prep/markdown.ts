// Markdown-lite for destination notes (e9-t05): `## ` headings, `- ` bullets, paragraphs separated
// by blank lines, and bare https links. Parsed into blocks the page renders as React elements, so
// nothing is ever injected as HTML.

export type Inline = { kind: 'text'; text: string } | { kind: 'link'; url: string }

export type Block =
  | { kind: 'heading'; content: Inline[] }
  | { kind: 'list'; items: Inline[][] }
  | { kind: 'paragraph'; lines: Inline[][] }

const URL_RE = /https:\/\/[^\s<>()\uFF08\uFF09\u300C\u300D]+/g

/** Text with its https links split out (http and other schemes stay text) */
export function inline(text: string): Inline[] {
  const out: Inline[] = []
  let last = 0
  for (const match of text.matchAll(URL_RE)) {
    const index = match.index ?? 0
    // A trailing full stop or comma belongs to the sentence
    const url = match[0].replace(/[.,;:!?\u3002\uFF0C\uFF1B\uFF1A\uFF01\uFF1F]+$/, '')
    if (index > last) out.push({ kind: 'text', text: text.slice(last, index) })
    out.push({ kind: 'link', url })
    last = index + url.length
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) })
  return out
}

export function parseNote(body: string): Block[] {
  const blocks: Block[] = []
  let list: Inline[][] | null = null
  let paragraph: Inline[][] | null = null
  const flush = () => {
    if (list) blocks.push({ kind: 'list', items: list })
    if (paragraph) blocks.push({ kind: 'paragraph', lines: paragraph })
    list = null
    paragraph = null
  }
  for (const raw of body.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd()
    if (line.trim() === '') {
      flush()
    } else if (/^#{1,3} /.test(line)) {
      flush()
      blocks.push({ kind: 'heading', content: inline(line.replace(/^#{1,3} /, '')) })
    } else if (/^\s*[-*] /.test(line)) {
      if (paragraph) flush()
      list ??= []
      list.push(inline(line.replace(/^\s*[-*] /, '')))
    } else {
      if (list) flush()
      paragraph ??= []
      paragraph.push(inline(line))
    }
  }
  flush()
  return blocks
}
