// Translations gate (CLAUDE.md rule 1, docs/DESIGN.md i18n rules): the en catalog has exactly the
// keys of the zh-TW source, with the same placeholders and no empty values; and src/ and share/
// have no bare user-visible strings (JSX text, visible attributes, CJK outside comments). Paths are
// relative to the current directory. Needs --experimental-strip-types: the catalogs are imported
// from their .ts files, so this checks what t() really gets. Scanner adapted from TKU Arcade.
//
// A line containing `// i18n-ignore` is skipped by the bare-string checks. Inside JSX children, where
// `//` would render, write `{/* // i18n-ignore */}`.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const ZH = 'shared/i18n/zh-TW.ts' // The source language
const EN = 'shared/i18n/en.ts'
const SOURCE_ROOTS = ['src', 'share']

const USER_VISIBLE_ATTRIBUTES = new Set(['aria-label', 'title', 'placeholder', 'alt', 'label'])
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}　-〿＀-￯]/u
const IGNORE = /\/\/\s*i18n-ignore/
const PLACEHOLDER = /\{(\w+)\}/g // Same shape as format() in shared/i18n/t.ts

const problems = []

async function load(file, exportName) {
  try {
    const catalog = (await import(pathToFileURL(resolve(file)).href))[exportName]
    if (catalog) return catalog
    problems.push(`${file}: no export named ${exportName}`)
  } catch (error) {
    problems.push(`${file}: cannot load: ${error.message}`)
  }
  return {}
}

const placeholders = (message) =>
  [...new Set([...message.matchAll(PLACEHOLDER)].map((match) => match[1]))].sort().join(', ')

const isEmpty = (message) => typeof message !== 'string' || message.trim() === ''

// `source` is the reference catalog (zh-TW); `other` must have exactly its keys and placeholders
function checkParity(source, sourceLabel, other, otherLabel) {
  for (const key of Object.keys(source)) {
    if (!(key in other)) problems.push(`${otherLabel}: missing key '${key}' (add it from ${sourceLabel})`)
  }
  for (const key of Object.keys(other)) {
    if (!(key in source)) problems.push(`${otherLabel}: extra key '${key}' (not in ${sourceLabel}, the source)`)
  }
  for (const [catalog, label] of [[source, sourceLabel], [other, otherLabel]]) {
    for (const [key, message] of Object.entries(catalog)) {
      if (isEmpty(message)) problems.push(`${label}: empty value for '${key}'`)
    }
  }
  for (const key of Object.keys(source)) {
    if (isEmpty(source[key]) || isEmpty(other[key])) continue
    const [inSource, inOther] = [placeholders(source[key]), placeholders(other[key])]
    if (inSource !== inOther) {
      problems.push(
        `${otherLabel}: placeholders differ for '${key}': source {${inSource}}, here {${inOther}}`,
      )
    }
  }
}

// HTML entities are not words; a lone letter (an icon, a grade) reads the same in both languages
const hasWords = (text) => /[A-Za-z]{2,}/.test(text.replace(/&#?\w+;/g, ' '))

const LITERAL_VALUE = /^\{\s*(['"])((?:(?!\1)[^\\]|\\.)*)\1\s*\}$/s

// Walks one source file, returning its comment ranges and its bare strings. A real walk rather than
// a regex: in JSX text an apostrophe does not open a string and `//` does not open a comment, while
// in code `<` is usually not a tag. `<` is tried as an element only when `jsx` is set, and a try that
// finds no matching closing tag (generics, comparisons) is undone, so it costs nothing.
function scan(source, jsx) {
  const comments = []
  const bare = []
  const notElements = new Set()

  function skipComment(start) {
    if (source.startsWith('//', start)) {
      const newline = source.indexOf('\n', start)
      comments.push([start, newline < 0 ? source.length : newline])
    } else if (source.startsWith('/*', start)) {
      const close = source.indexOf('*/', start + 2)
      comments.push([start, close < 0 ? source.length : close + 2])
    } else {
      return -1
    }
    return comments.at(-1)[1]
  }

  function skipBlank(start) {
    let i = start
    for (;;) {
      if (/\s/.test(source[i] ?? '')) i++
      else {
        const afterComment = skipComment(i)
        if (afterComment < 0) return i
        i = afterComment
      }
    }
  }

  // A newline ends it too, so a stray quote costs one line at most
  function skipString(start) {
    for (let i = start + 1; i < source.length; i++) {
      if (source[i] === '\\') i++
      else if (source[i] === source[start] || source[i] === '\n') return i + 1
    }
    return source.length
  }

  function regexCanStart(start) {
    const before = source.slice(Math.max(0, start - 12), start).trimEnd()
    return !/[\w$)\]}'"`]$/.test(before) || /\b(return|typeof|case|in|of|void)$/.test(before)
  }

  function skipRegex(start) {
    let inClass = false
    for (let i = start + 1; i < source.length && source[i] !== '\n'; i++) {
      if (source[i] === '\\') i++
      else if (source[i] === '[') inClass = true
      else if (source[i] === ']') inClass = false
      else if (source[i] === '/' && !inClass) return i + 1
    }
    return -1
  }

  // Its text is not looked at (styled-components CSS has `>`), but ${} is code again
  function skipTemplate(start) {
    for (let i = start + 1; i < source.length; i++) {
      if (source[i] === '\\') i++
      else if (source[i] === '`') return i + 1
      else if (source.startsWith('${', i)) {
        i = code(i + 2, true) - 1
        if (i < 0) return -1
      }
    }
    return -1
  }

  // Returns the index after the closing `}` when nested; -1 when the source ends first
  function code(start, nested) {
    let depth = 0
    let i = start
    while (i < source.length) {
      const char = source[i]
      const afterComment = skipComment(i)
      if (afterComment >= 0) i = afterComment
      else if (char === "'" || char === '"') i = skipString(i)
      else if (char === '`') {
        i = skipTemplate(i)
        if (i < 0) return -1
      } else if (char === '/' && regexCanStart(i)) {
        const end = skipRegex(i)
        i = end < 0 ? i + 1 : end
      } else if (char === '{') {
        depth++
        i++
      } else if (char === '}') {
        if (nested && depth === 0) return i + 1
        depth--
        i++
      } else if (char === '<' && jsx) {
        const end = element(i)
        i = end < 0 ? i + 1 : end
      } else i++
    }
    return -1
  }

  function matchAt(pattern, at) {
    pattern.lastIndex = at
    return pattern.exec(source)?.[0] ?? ''
  }

  function skipTypeArguments(start) {
    let depth = 0
    for (let i = start; i < source.length; i++) {
      if (source[i] === '<') depth++
      else if (source[i] === '>' && source[i - 1] !== '=' && --depth === 0) return i + 1
    }
    return -1
  }

  function attribute(start) {
    const name = matchAt(/[A-Za-z_$][\w$:.-]*/y, start)
    if (!name) return -1
    const afterName = skipBlank(start + name.length)
    if (source[afterName] !== '=') return afterName
    const at = skipBlank(afterName + 1)
    let end
    let value
    if (source[at] === '"' || source[at] === "'") {
      end = source.indexOf(source[at], at + 1) + 1
      if (end === 0) return -1
      value = source.slice(at + 1, end - 1)
    } else if (source[at] === '{') {
      end = code(at + 1, true)
      if (end < 0) return -1
      value = LITERAL_VALUE.exec(source.slice(at, end))?.[2]
    } else if (source[at] === '<') {
      return element(at)
    } else {
      return -1
    }
    if (USER_VISIBLE_ATTRIBUTES.has(name) && value !== undefined && hasWords(value)) {
      bare.push({ at, what: `bare ${name} attribute`, text: value })
    }
    return end
  }

  function addText(from, to) {
    let at = from
    for (const line of source.slice(from, to).split('\n')) {
      if (hasWords(line)) bare.push({ at, what: 'bare JSX text', text: line.trim() })
      at += line.length + 1
    }
  }

  function children(start, name) {
    let i = start
    for (;;) {
      const stop = /[<>{}]/g
      stop.lastIndex = i
      const next = stop.exec(source)?.index
      if (next === undefined) return -1
      addText(i, next)
      i = next
      // A raw `>` or `}` is a syntax error in JSX text, so this was never an element
      if (source[i] === '>' || source[i] === '}') return -1
      if (source[i] === '{') {
        i = code(i + 1, true)
      } else if (source.startsWith('</', i)) {
        const close = skipBlank(i + 2)
        if (!source.startsWith(name, close)) return -1
        const end = skipBlank(close + name.length)
        return source[end] === '>' ? end + 1 : -1
      } else {
        i = element(i)
      }
      if (i < 0) return -1
    }
  }

  function parseElement(start) {
    const name = matchAt(/[A-Za-z_$][\w$:.-]*/y, start + 1)
    let i = start + 1 + name.length
    if (!name && source[i] !== '>') return -1
    if (source[i] === '<') {
      i = skipTypeArguments(i) // <Select<string> ...>
      if (i < 0) return -1
    }
    for (;;) {
      i = skipBlank(i)
      if (source.startsWith('/>', i)) return i + 2
      if (source[i] === '>') return children(i + 1, name)
      i = source[i] === '{' ? code(i + 1, true) : attribute(i)
      if (i < 0) return -1
    }
  }

  function element(start) {
    if (notElements.has(start)) return -1
    const [commentCount, bareCount] = [comments.length, bare.length]
    const end = parseElement(start)
    if (end < 0) {
      // Whatever the failed try read as comments and text was really code
      notElements.add(start)
      comments.length = commentCount
      bare.length = bareCount
    }
    return end
  }

  code(0, false)
  return { comments, bare }
}

function checkSource(file) {
  const source = readFileSync(file, 'utf8')
  const lines = source.split('\n')
  const { comments, bare } = scan(source, file.endsWith('.tsx'))

  const found = []
  const report = (line, what, text) => {
    if (!IGNORE.test(lines[line - 1])) found.push({ line, what, text })
  }

  let withoutComments = source
  for (const [start, end] of comments) {
    const blank = source.slice(start, end).replace(/[^\n]/g, ' ')
    withoutComments = withoutComments.slice(0, start) + blank + withoutComments.slice(end)
  }
  withoutComments.split('\n').forEach((line, index) => {
    if (CJK.test(line)) report(index + 1, 'CJK outside comments', line.trim())
  })
  for (const { at, what, text } of bare) {
    report(source.slice(0, at).split('\n').length, what, text)
  }

  found.sort((a, b) => a.line - b.line)
  for (const { line, what, text } of found) problems.push(`${file}:${line}: ${what}: ${text}`)
}

const sourceFiles = SOURCE_ROOTS.filter((root) => existsSync(root))
  .flatMap((root) =>
    readdirSync(root, { recursive: true, encoding: 'utf8' }).map(
      (path) => `${root}/${path.replaceAll('\\', '/')}`,
    ),
  )
  .filter((path) => /\.tsx?$/.test(path))
  .sort()

const zh = await load(ZH, 'zhTW')
const en = await load(EN, 'en')

checkParity(zh, ZH, en, EN)
for (const file of sourceFiles) checkSource(file)

for (const problem of problems) console.log(problem)
if (problems.length > 0) {
  console.log(`FAIL check-i18n: ${problems.length} problem(s)`)
  // Not process.exit(): on Windows stdout to a pipe is async, and the list must reach the end
  process.exitCode = 1
} else {
  console.log(`ok   check-i18n: ${Object.keys(zh).length} keys, ${sourceFiles.length} source files`)
}
