#!/usr/bin/env node
/**
 * ARCHITECTURE.md drift checker - fenced tree/module-map blocks and HTTP route tables, verified
 * against the filesystem and the registered FastAPI routers, in both directions.
 *
 * Only those two classes are mechanical enough to gate; backticked path tokens in prose are
 * mostly routes, specifiers, globs or symbols, so they are swept by hand instead.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const ROOT = join(__dirname, '..')
const ARCH_PATH = join(ROOT, 'docs', 'ARCHITECTURE.md')

const verbose = process.argv.includes('--verbose')

// Backticked module name (from a "## N. Title (`module`)" heading) -> its root, relative to ROOT.
const MODULE_ROOTS = {
  claudebox: 'src/claudebox',
  claudebox_cli: 'src/claudebox_cli',
  claudebox_container_api: 'src/claudebox_container_api',
  claudebox_daemon: 'src/claudebox_daemon',
  claudebox_frontend: 'src/claudebox_frontend',
}

// Router files whose route decorators are compared against the doc's route tables.
const ROUTER_FILE_GLOBS = [
  { dir: 'src/claudebox_container_api/handlers' },
  { dir: 'src/claudebox_daemon/handlers' },
]

const FS_IGNORE = new Set([
  '__pycache__',
  '.pytest_cache',
  '.ruff_cache',
  'node_modules',
  '.DS_Store',
  'dist',
  'coverage',
  'test-results', // Playwright's own run output, never a documented source entry
])

// ---------------------------------------------------------------------------------------------
// Fenced tree / module-map blocks
// ---------------------------------------------------------------------------------------------

/** Extract every bare-fenced code block, each paired with its heading context. */
export function extractFencedBlocks(lines) {
  const blocks = []
  let fenceStart = null
  let fenceTag = null
  let lastHeadingModule = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // Any numbered top-level heading resets context, matched or not - otherwise an unbacktick'd
    // heading (e.g. "## 7. Testing") silently inherits the previous section's module.
    if (/^##\s+\d+\./.test(line)) {
      const headingMatch = line.match(/^##\s+\d+\.\s.*`([\w.]+)`/)
      lastHeadingModule = headingMatch ? headingMatch[1] : null
    }

    const fenceMatch = line.match(/^```(\w*)\s*$/)
    if (fenceMatch) {
      if (fenceStart === null) {
        fenceStart = i
        fenceTag = fenceMatch[1]
      } else {
        if (fenceTag === '') {
          blocks.push({
            startLine: fenceStart + 1,
            endLine: i + 1,
            contentLines: lines.slice(fenceStart + 1, i),
            module: lastHeadingModule,
          })
        }
        fenceStart = null
        fenceTag = null
      }
    }
  }
  return blocks
}

/**
 * Parse a tree block's content lines into {depth, name, isDir, lineNum} entries. Depth is
 * `floor(leadingTreePrefixLength / 4) + 1` - uniform whether the block's own first line is a
 * bare directory-only "root declaration" (e.g. `src/`) or a plain top-level file, since both
 * read as a depth-0 prefix and become a depth-1 child of the block's anchor root either way.
 */
export function parseTreeEntries(contentLines, startLineNum) {
  const entries = []
  for (let i = 0; i < contentLines.length; i++) {
    const raw = contentLines[i]
    if (!raw.trim()) {
      continue
    }
    // Box-drawing glyphs the tree convention uses, as escapes to keep this file pure ASCII:
    // vertical U+2502, tee U+251C, elbow U+2514, horizontal U+2500.
    const prefixMatch = raw.match(/^[\s\u2502\u251c\u2514\u2500]*/)
    const prefixLen = prefixMatch[0].length
    const rest = raw.slice(prefixLen)
    if (rest.startsWith('#') || !rest.trim()) {
      continue // comment continuation line, no entry token
    }
    const nameMatch = rest.match(/^(\S+)/)
    if (!nameMatch) {
      continue
    }
    let name = nameMatch[1]
    const isDir = name.endsWith('/')
    if (isDir) {
      name = name.slice(0, -1)
    }
    const depth = Math.floor(prefixLen / 4) + 1
    entries.push({ depth, name, isDir, lineNum: startLineNum + i })
  }
  return entries
}

/** Build {relPath, isDir, lineNum}[] from parsed entries via a depth-indexed stack. */
export function resolveTreePaths(entries) {
  const stack = []
  const resolved = []
  for (const entry of entries) {
    stack[entry.depth] = entry.name
    stack.length = entry.depth + 1
    const relPath = stack.slice(1, entry.depth + 1).join('/')
    resolved.push({ relPath, isDir: entry.isDir, lineNum: entry.lineNum, depth: entry.depth })
  }
  return resolved
}

/** List real directory children (files + dirs), filtered of build/cache noise. */
export function listRealChildren(absDir) {
  try {
    return (
      readdirSync(absDir, { withFileTypes: true })
        .filter(e => !(FS_IGNORE.has(e.name) || e.name.startsWith('.')))
        // An empty __init__.py is a pure package marker; every module map in this document omits
        // those and lists only the ones carrying real content (docstring, re-exports).
        .filter(e => !(e.name === '__init__.py' && statSync(join(absDir, e.name)).size === 0))
        .map(e => ({ name: e.name, isDir: e.isDirectory() }))
    )
  } catch {
    return null
  }
}

/**
 * Diff one tree block both ways: every entry the doc names must exist, and every directory the
 * doc expands (has at least one listed child) must have all its real children listed too.
 */
export function diffTreeBlock(block, resolvedEntries, root = ROOT, moduleRoots = MODULE_ROOTS) {
  const anchorRoot = block.module && moduleRoots[block.module] ? moduleRoots[block.module] : '.'
  const anchorAbs = join(root, anchorRoot)
  if (!listRealChildren(anchorAbs)) {
    return null // root doesn't resolve - not a real tree block (a diagram using tree glyphs)
  }

  // A root-relative block (no section module) whose own first entry names ROOT itself - e.g. the
  // top-of-document repo tree opening on `lib/` - declares the root rather than a child of it.
  if (
    !block.module &&
    resolvedEntries[0]?.depth === 1 &&
    resolvedEntries[0].relPath === basename(root)
  ) {
    const prefix = `${resolvedEntries[0].relPath}/`
    resolvedEntries = resolvedEntries
      .slice(1)
      .map(e => ({ ...e, relPath: e.relPath.slice(prefix.length), depth: e.depth - 1 }))
  }

  // Blocks using tree-drawing glyphs for something other than a filesystem tree (call chains,
  // dependency diagrams) resolve almost nothing - a real tree, even mid-drift, resolves most of
  // its entries. A block that clears neither bar is not a tree block; skip it.
  const hits = resolvedEntries.filter(e => {
    try {
      statSync(join(anchorAbs, e.relPath))
      return true
    } catch {
      return false
    }
  }).length
  if (hits / resolvedEntries.length < 0.5) {
    return null
  }

  const problems = []
  const byParent = new Map() // parentRelPath -> Set(childName) as named by the doc

  for (const entry of resolvedEntries) {
    const absPath = join(anchorAbs, entry.relPath)
    let stat
    try {
      stat = statSync(absPath)
    } catch {
      problems.push({
        kind: 'missing-on-disk',
        lineNum: entry.lineNum,
        path: `${anchorRoot}/${entry.relPath}`,
      })
      continue
    }
    if (entry.isDir !== stat.isDirectory()) {
      problems.push({
        kind: 'wrong-kind',
        lineNum: entry.lineNum,
        path: `${anchorRoot}/${entry.relPath}`,
        expected: entry.isDir ? 'directory' : 'file',
      })
    }

    const parts = entry.relPath.split('/')
    const parentRelPath = parts.slice(0, -1).join('/')
    if (!byParent.has(parentRelPath)) {
      byParent.set(parentRelPath, new Set())
    }
    byParent.get(parentRelPath).add(parts[parts.length - 1])
  }

  // Root's own immediate children count as "expanded" only when the block lists more than one -
  // a single depth-1 entry (e.g. a block that opens on `src/` to describe just that subtree)
  // is not claiming to enumerate its siblings, so the reverse check would be noise there.
  const depth1 = resolvedEntries.filter(e => e.depth === 1)
  if (depth1.length > 1) {
    byParent.set('', new Set(depth1.map(e => e.relPath)))
  } else {
    byParent.delete('')
  }

  for (const [parentRelPath, namedChildren] of byParent) {
    const parentAbs = join(anchorAbs, parentRelPath)
    const realChildren = listRealChildren(parentAbs)
    if (!realChildren) {
      continue
    }
    for (const child of realChildren) {
      if (!namedChildren.has(child.name)) {
        problems.push({
          kind: 'unlisted-on-disk',
          lineNum: block.startLine,
          path: `${anchorRoot}/${parentRelPath ? `${parentRelPath}/` : ''}${child.name}`,
        })
      }
    }
  }

  return problems
}

// ---------------------------------------------------------------------------------------------
// Route tables
// ---------------------------------------------------------------------------------------------

/** Extract every route table's data rows, with the endpoint prefix in force. */
export function extractRouteTables(lines) {
  const rows = []
  let currentPrefix = ''

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const prefixMatch = line.match(/`(\/api\/workspaces\/\{workspace_id\}[\w/{}-]*)\/\.\.\.`/)
    if (prefixMatch) {
      currentPrefix = prefixMatch[1]
    }

    if (!/^\|\s*Endpoint\s*\|\s*Method\s*\|/.test(line)) {
      continue
    }
    // Skip the header separator row, then read data rows until the table ends.
    let j = i + 2
    while (j < lines.length && lines[j].trim().startsWith('|')) {
      const cells = lines[j]
        .split('|')
        .slice(1, -1)
        .map(c => c.trim())
      const [endpointCell, methodCell] = cells
      const endpointMatch = endpointCell.match(/`([^`]+)`/)
      if (endpointMatch) {
        const relPath = endpointMatch[1]
        const fullPath = relPath.startsWith('/api') ? relPath : `${currentPrefix}${relPath}`
        const method = methodCell.replace(/\s*\(SSE\)\s*/, '').trim()
        rows.push({ method, path: fullPath, lineNum: j + 1 })
      }
      j++
    }
  }
  return rows
}

/** Extract every registered FastAPI route from a set of handler directories. */
export function extractRegisteredRoutes(root = ROOT, routerDirs = ROUTER_FILE_GLOBS) {
  const routes = []
  for (const { dir } of routerDirs) {
    const absDir = join(root, dir)
    let files
    try {
      files = readdirSync(absDir).filter(f => f.endsWith('.py') && !f.startsWith('_'))
    } catch {
      continue
    }
    for (const file of files) {
      const content = readFileSync(join(absDir, file), 'utf-8')
      const prefixes = new Map()
      for (const m of content.matchAll(/(\w+)\s*=\s*APIRouter\(\s*prefix\s*=\s*"([^"]*)"/g)) {
        prefixes.set(m[1], m[2])
      }
      for (const m of content.matchAll(
        /@(\w+)\.(get|post|put|delete|patch|api_route)\(\s*"([^"]*)"([^)]*)\)/gs,
      )) {
        const [, varName, decorator, relPath, rest] = m
        const prefix = prefixes.get(varName)
        if (prefix === undefined) {
          continue
        }
        const fullPath = prefix + relPath
        if (decorator === 'api_route') {
          const methodsMatch = rest.match(/methods\s*=\s*\[([^\]]*)\]/)
          const methods = methodsMatch
            ? methodsMatch[1].split(',').map(s => s.trim().replace(/['"]/g, ''))
            : []
          routes.push({
            method: methods.length > 1 ? '*' : methods[0] || '*',
            path: fullPath,
            file,
          })
        } else {
          routes.push({ method: decorator.toUpperCase(), path: fullPath, file })
        }
      }
    }
  }
  return routes
}

// Normalize FastAPI's `{param}` placeholders (any name) so a doc using `{id}` matches code using
// `{session_id}` for the same positional slot.
function normalizePath(path) {
  return path.replace(/\{[^}]+\}/g, '{}')
}

export function diffRoutes(docRows, registeredRoutes) {
  const registeredSet = new Set(registeredRoutes.map(r => `${r.method} ${normalizePath(r.path)}`))
  const docSet = new Set(docRows.map(r => `${r.method} ${normalizePath(r.path)}`))

  const invented = docRows.filter(r => !registeredSet.has(`${r.method} ${normalizePath(r.path)}`))
  const unlisted = registeredRoutes.filter(
    r => !docSet.has(`${r.method} ${normalizePath(r.path)}`) && r.method !== '*',
  )
  return { invented, unlisted }
}

// ---------------------------------------------------------------------------------------------
// Main - runs only when invoked directly (`node architecture-drift-check.js`), not on import
// ---------------------------------------------------------------------------------------------

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  main()
}

function main() {
  const content = readFileSync(ARCH_PATH, 'utf-8')
  const lines = content.split('\n')

  let error = false

  console.log(`\n${'='.repeat(60)}`)
  console.log('ARCHITECTURE.md DRIFT REPORT')
  console.log('='.repeat(60))

  // --- Tree blocks ---
  const blocks = extractFencedBlocks(lines)
  let treeBlocksChecked = 0
  const treeProblems = []
  for (const block of blocks) {
    const entries = parseTreeEntries(block.contentLines, block.startLine + 1)
    const resolved = resolveTreePaths(entries)
    if (resolved.length === 0) {
      continue
    }
    const problems = diffTreeBlock(block, resolved)
    if (problems === null) {
      continue // not a real tree block
    }
    treeBlocksChecked++
    for (const p of problems) {
      treeProblems.push(p)
    }
  }

  console.log(`\nFenced tree/module-map blocks checked: ${treeBlocksChecked}`)
  if (treeProblems.length > 0) {
    error = true
    console.log(`\n${'-'.repeat(60)}`)
    console.log('ERROR: TREE/MODULE-MAP DRIFT')
    console.log('-'.repeat(60))
    for (const p of treeProblems) {
      if (p.kind === 'missing-on-disk') {
        console.log(`  ARCHITECTURE.md:${p.lineNum} names \`${p.path}\`, which does not exist`)
      } else if (p.kind === 'wrong-kind') {
        console.log(
          `  ARCHITECTURE.md:${p.lineNum} lists \`${p.path}\` as a ${p.expected}, but it is not`,
        )
      } else if (p.kind === 'unlisted-on-disk') {
        console.log(
          `  \`${p.path}\` exists but is not listed (block starting at ARCHITECTURE.md:${p.lineNum})`,
        )
      }
    }
  } else if (verbose) {
    console.log('  No drift found.')
  }

  // --- Route tables ---
  const docRoutes = extractRouteTables(lines)
  const registeredRoutes = extractRegisteredRoutes()
  const { invented, unlisted } = diffRoutes(docRoutes, registeredRoutes)

  console.log(
    `\nRoute table rows checked: ${docRoutes.length} (against ${registeredRoutes.length} registered routes)`,
  )
  if (invented.length > 0 || unlisted.length > 0) {
    error = true
    console.log(`\n${'-'.repeat(60)}`)
    console.log('ERROR: ROUTE TABLE DRIFT')
    console.log('-'.repeat(60))
    for (const r of invented) {
      console.log(
        `  ARCHITECTURE.md:${r.lineNum} lists ${r.method} ${r.path}, which is not registered`,
      )
    }
    for (const r of unlisted) {
      console.log(
        `  ${r.method} ${r.path} (${r.file}) is registered but not listed in any route table`,
      )
    }
  } else if (verbose) {
    console.log('  No drift found.')
  }

  console.log('\n')

  if (error) {
    process.exit(1)
  }
}
