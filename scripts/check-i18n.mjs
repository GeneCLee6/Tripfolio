// Translations gate (CLAUDE.md rule 1, docs/DESIGN.md i18n rules, RULES.md §2). The catalog is
// split in three (app, common, share) so the share page ships only what it uses, plus page catalogs
// (shared/i18n/pages/<page>.zh-TW.ts + .en.ts) that a lazy page's entry registers so its keys stay
// out of the first screen; this checks:
//   1. each en file has exactly the keys of its zh-TW file (the source), with the same placeholders
//      and no empty values (page catalogs included);
//   2. the share page's import graph (from share/main.tsx) never loads the app or a page catalog,
//      uses only keys from zh-TW.common.ts + zh-TW.share.ts, and every key there is used by it;
//   3. src/ asks t() only for keys of the app catalog (zh-TW.ts + zh-TW.common.ts) or of the page
//      catalog of a page the file belongs to; a page key used by a file that can load without that
//      page fails, naming the key to move back to zh-TW.ts;
//   4. no key is written in two catalog files;
//   5. src/ and share/ have no bare user-visible strings (JSX text, visible attributes, CJK
//      outside comments).
// Paths are relative to the current directory. Needs --experimental-strip-types: the catalogs are
// imported from their .ts files, so this checks what t() really gets. Scanner adapted from TKU Arcade.
//
// A line containing `// i18n-ignore` is skipped by the bare-string checks. Inside JSX children, where
// `//` would render, write `{/* // i18n-ignore */}`.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const ZH = 'shared/i18n/zh-TW.ts' // The source language; the app's own keys
const EN = 'shared/i18n/en.ts'
const COMMON_ZH = 'shared/i18n/zh-TW.common.ts' // Keys both the app and the share page use
const COMMON_EN = 'shared/i18n/en.common.ts'
const SHARE_ZH = 'shared/i18n/zh-TW.share.ts' // The share page's own keys
const SHARE_EN = 'shared/i18n/en.share.ts'
// Page catalogs: shared/i18n/pages/<page>.zh-TW.ts + <page>.en.ts, registered by <page>.ts, which the
// page's lazy entry module imports
const PAGES_DIR = 'shared/i18n/pages'
const PAGES = existsSync(PAGES_DIR)
  ? readdirSync(PAGES_DIR)
      .filter((file) => file.endsWith('.zh-TW.ts'))
      .sort()
      .map((file) => {
        const name = file.slice(0, -'.zh-TW.ts'.length)
        return {
          name,
          zh: `${PAGES_DIR}/${file}`,
          en: `${PAGES_DIR}/${name}.en.ts`,
          register: `${PAGES_DIR}/${name}.ts`,
        }
      })
  : []
const CATALOG_FILES = [
  [ZH, EN],
  [COMMON_ZH, COMMON_EN],
  [SHARE_ZH, SHARE_EN],
  ...PAGES.map((page) => [page.zh, page.en]),
]
const SHARE_ENTRY = 'share/main.tsx'
const APP_ENTRY = 'src/main.tsx'
// Modules that carry the app catalog or a page catalog; the share page must not load them
const APP_CATALOG_MODULES = ['shared/i18n/t.ts', ZH, EN, ...PAGES.flatMap((page) => [page.register, page.zh, page.en])]
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

// --- The catalog split (RULES.md §2) ------------------------------------------------------------
// The share page registers only zh-TW.common.ts + zh-TW.share.ts (share/catalog.ts); the app
// registers zh-TW.ts, which spreads zh-TW.common.ts in. To keep that exact, walk the share page's
// import graph from share/main.tsx (lazy imports included) and collect the keys it uses: any string
// literal that is a key (so key maps like src/map/labels.ts count), a literal plural base
// (`t.plural('count.stops', n)`), and any template whose fixed head is a key prefix
// (`share.mode.${mode}` takes every share.mode.* key).

const toPosix = (file) => relative(process.cwd(), file).split(sep).join('/')

const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1')

// Relative imports only. `import type` and `export type` are erased; everything else is loaded
// (verbatimModuleSyntax keeps `import { type X } from` as a side-effect import).
const STATEMENT =
  /\b(import|export)\s+(type\s+)?([^;'"`]*?)\s*from\s*['"](\.[^'"]+)['"]|\bimport\s*['"](\.[^'"]+)['"]|\bimport\(\s*['"](\.[^'"]+)['"]\s*\)/g
const EXPORT_FROM = /\bexport\s+(type\s+)?([^;'"`]*?)\s*from\s*['"][^'"]+['"]/g

function resolveImport(from, specifier) {
  const path = resolve(dirname(from), specifier)
  if (existsSync(path)) return path
  return ['.ts', '.tsx', '/index.ts'].map((ending) => path + ending).find((file) => existsSync(file)) ?? path
}

// The value names an import or re-export clause takes; null when it takes everything
function clauseNames(clause) {
  const braces = /\{([\s\S]*)\}/.exec(clause)
  if (!braces || clause.replace(braces[0], '').replace(/[\s,]/g, '') !== '') return null
  return braces[1]
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name && !name.startsWith('type '))
    .map((name) => name.split(/\s+as\s+/)[0])
}

const modules = new Map()
function parseModule(file) {
  if (modules.has(file)) return modules.get(file)
  const source = stripComments(readFileSync(file, 'utf8'))
  const imports = []
  for (const match of source.matchAll(STATEMENT)) {
    if (match[2]) continue
    if (match[4]) imports.push({ names: clauseNames(match[3]), file: resolveImport(file, match[4]) })
    else imports.push({ names: null, file: resolveImport(file, match[5] ?? match[6]) })
  }
  // A barrel (src/components/index.ts) only re-exports: follow just the names imported from it,
  // as tree-shaking does, so the share page is not charged for every base component
  const barrel = imports.length > 0 && source.replace(EXPORT_FROM, '').trim() === ''
  const parsed = { source, imports, barrel }
  modules.set(file, parsed)
  return parsed
}

// The files `entries` load, as posix paths; `via` maps each to the first file that imports it.
// Files in `skip` (posix paths) are not entered, nor is anything only they import.
function importGraph(entries, skip = new Set()) {
  const via = new Map()
  function visit(file, wanted, from) {
    if (!/\.tsx?$/.test(file) || !existsSync(file) || skip.has(toPosix(file))) return
    const { imports, barrel } = parseModule(file)
    if (barrel && wanted) {
      for (const { names, file: target } of imports) {
        const taken = names ? names.filter((name) => wanted.includes(name)) : null
        if (!taken || taken.length > 0) visit(target, taken, from)
      }
      return
    }
    if (via.has(toPosix(file))) return
    via.set(toPosix(file), from)
    for (const { names, file: target } of imports) visit(target, names, toPosix(file))
  }
  for (const entry of [entries].flat()) visit(resolve(entry), null, null)
  return via
}

// The files that belong to a page: loaded by its entry module(s) but unreachable from the app entry
// without going through one of them. A page catalog registered by the entry is always there when
// these run, since lazy() evaluates the entry's chunk before the page renders. A file the entry
// loads that something else also loads (a shared component, a sheet another page opens) does not
// belong, because it can render before the page catalog is registered.
function pageFiles(entries) {
  const skip = new Set(entries)
  const outside = importGraph(APP_ENTRY, skip)
  return new Set([...importGraph(entries).keys()].filter((file) => !outside.has(file)))
}

const LITERAL = /'([\w.-]+)'|"([\w.-]+)"/g
const TEMPLATE_HEAD = /`([\w-]+(?:\.[\w-]+)*\.)\$\{/g

// The keys of `catalog` that `source` can reach (see above)
function usedKeys(source, catalog) {
  const keys = Object.keys(catalog)
  const used = new Set()
  for (const match of source.matchAll(LITERAL)) {
    const literal = match[1] ?? match[2]
    if (literal in catalog) used.add(literal)
    if (`${literal}.other` in catalog) for (const key of keys) if (key.startsWith(`${literal}.`)) used.add(key)
  }
  for (const match of source.matchAll(TEMPLATE_HEAD)) {
    for (const key of keys) if (key.startsWith(match[1])) used.add(key)
  }
  return used
}

// The keys a catalog file writes itself, read from its text (a spread is not a definition)
const definedKeys = (file) =>
  [...readFileSync(file, 'utf8').matchAll(/^\s*'([^']+)'\s*:/gm)].map((match) => match[1])

function checkSplit(sourceFiles, { app, common, share, pages }) {
  // (1) Each zh-TW file and its en file write the same keys; (4) no key is written twice
  for (const [zhFile, enFile] of CATALOG_FILES) {
    const [zhKeys, enKeys] = [definedKeys(zhFile), definedKeys(enFile)]
    for (const key of zhKeys) {
      if (!enKeys.includes(key)) problems.push(`${enFile}: missing key '${key}' (it is in ${zhFile}; write it in this file)`)
    }
    for (const key of enKeys) {
      if (!zhKeys.includes(key)) problems.push(`${enFile}: extra key '${key}' (not in ${zhFile})`)
    }
  }
  for (const column of [0, 1]) {
    const owner = new Map()
    for (const files of CATALOG_FILES) {
      for (const key of definedKeys(files[column])) {
        if (owner.has(key)) problems.push(`${files[column]}: '${key}' is also written in ${owner.get(key)} (write each key once)`)
        else owner.set(key, files[column])
      }
    }
  }

  // (2) The share page never loads the app catalog, and what it uses is exactly common + share
  const graph = importGraph(SHARE_ENTRY)
  for (const file of APP_CATALOG_MODULES) {
    if (graph.has(file)) {
      problems.push(`${file} is loaded by the share page (imported by ${graph.get(file)}): that ships the whole app catalog; import shared/i18n/core.ts there instead of t.ts`)
    }
  }
  const all = { ...app, ...share, ...Object.assign({}, ...pages.map((page) => page.catalog)) }
  const used = new Set()
  for (const file of graph.keys()) {
    if (CATALOG_FILES.flat().includes(file)) continue
    for (const key of usedKeys(parseModule(resolve(file)).source, all)) used.add(key)
  }
  for (const key of [...used].sort()) {
    if (!(key in common) && !(key in share)) {
      problems.push(`the share page uses '${key}', which only the app catalog has: move it from ${ZH} to ${COMMON_ZH} (and from ${EN} to ${COMMON_EN})`)
    }
  }
  for (const [catalog, file] of [[common, COMMON_ZH], [share, SHARE_ZH]]) {
    for (const key of Object.keys(catalog)) {
      if (!used.has(key)) problems.push(`${file}: '${key}' is not used by the share page: move it to ${ZH} (and its en file)`)
    }
  }

  // (3) Each page catalog belongs to the files of the page whose entry imports its register module
  const appFiles = sourceFiles.filter((path) => path.startsWith('src/'))
  for (const page of pages) {
    page.entries = appFiles.filter((file) =>
      parseModule(resolve(file)).imports.some(({ file: target }) => toPosix(target) === page.register),
    )
    if (page.entries.length === 0) {
      problems.push(`${page.register}: no file in src/ imports it, so ${page.zh} is never registered (import it from the page's lazy entry module)`)
    }
    page.files = pageFiles(page.entries)
    for (const file of page.entries) {
      if (!page.files.has(file)) {
        problems.push(`${file} imports ${page.register} but is not a lazy page entry (it loads on the first screen or with another page): import page catalogs only from a lazy page's entry module`)
      }
    }
  }
  const has = (catalog, key) => key in catalog || `${key}.other` in catalog
  const moveBack = (file, key, page) =>
    `${file}: '${key}' is a page key (${page.zh}) but this file can load without ${page.entries.join(' / ') || 'its page'}: move '${key}' back to ${ZH} and ${EN}, or use it only inside that page`

  // src/ asks only for keys of the app catalog or of a page catalog it belongs to; the share page's
  // own keys are not registered there
  for (const file of appFiles) {
    const source = stripComments(readFileSync(file, 'utf8'))
    const reported = new Set()
    for (const match of source.matchAll(/(?<![\w.])(?:t|tp|t\.plural)\(\s*'([^']+)'/g)) {
      const key = match[1]
      if (has(app, key)) continue
      const page = pages.find((candidate) => has(candidate.catalog, key))
      if (!page) {
        problems.push(`${file}: '${key}' is not in the app catalog (${ZH}, ${COMMON_ZH}) or a page catalog (${PAGES_DIR}/)`)
      } else if (!page.files.has(file)) {
        problems.push(moveBack(file, key, page))
        reported.add(key)
      }
    }
    // Key maps and template prefixes count too (labels.ts files hold keys without calling t())
    for (const page of pages) {
      if (page.files.has(file)) continue
      for (const key of usedKeys(source, page.catalog)) {
        if (!reported.has(key)) problems.push(moveBack(file, key, page))
      }
    }
    for (const key of usedKeys(source, share)) {
      problems.push(`${file}: '${key}' is a share page key (${SHARE_ZH}); the app does not register it`)
    }
  }
  return { graphFiles: graph.size, shareKeys: used.size }
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
const zhCommon = await load(COMMON_ZH, 'zhTWCommon')
const enCommon = await load(COMMON_EN, 'enCommon')
const zhShare = await load(SHARE_ZH, 'zhTWShare')
const enShare = await load(SHARE_EN, 'enShare')
// A page catalog exports <camelName>ZhTW and <camelName>En (trip-form → tripFormZhTW, tripFormEn)
const pages = []
for (const page of PAGES) {
  const camel = page.name.replace(/-(\w)/g, (_, letter) => letter.toUpperCase())
  pages.push({
    ...page,
    catalog: await load(page.zh, `${camel}ZhTW`),
    enCatalog: await load(page.en, `${camel}En`),
  })
}

// zh and en are the app catalogs as registered (common spread in)
checkParity(zh, ZH, en, EN)
checkParity(zhCommon, COMMON_ZH, enCommon, COMMON_EN)
checkParity(zhShare, SHARE_ZH, enShare, SHARE_EN)
for (const page of pages) checkParity(page.catalog, page.zh, page.enCatalog, page.en)
const split = checkSplit(sourceFiles, { app: zh, common: zhCommon, share: zhShare, pages })
for (const file of sourceFiles) checkSource(file)

for (const problem of problems) console.log(problem)
if (problems.length > 0) {
  console.log(`FAIL check-i18n: ${problems.length} problem(s)`)
  // Not process.exit(): on Windows stdout to a pipe is async, and the list must reach the end
  process.exitCode = 1
} else {
  const own = Object.keys(zh).length - Object.keys(zhCommon).length
  console.log(
    `ok   check-i18n: ${own} app + ${Object.keys(zhCommon).length} common + ${Object.keys(zhShare).length} share keys; ` +
      `share page loads ${split.graphFiles} files and ${split.shareKeys} keys; ${sourceFiles.length} source files` +
      pages
        .map((page) => `\n     page ${page.name}: ${Object.keys(page.catalog).length} keys for ${page.files.size} files after ${page.entries.join(', ')}`)
        .join(''),
  )
}
