#!/usr/bin/env node
/** Report current-vs-latest for direct deps; always exits 0 so it never gates `just check`. */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const ROOT = join(__dirname, '..')

const NPM_WORKSPACES = [
  { label: 'npm (src/claudebox_frontend)', dir: join(ROOT, 'src', 'claudebox_frontend') },
  { label: 'npm (e2e/app)', dir: join(ROOT, 'e2e', 'app') },
  { label: 'npm (.)', dir: ROOT },
]

/** Run `cmd` and return stdout, or `{ error }` if it couldn't run or produced no output. */
function run(cmd, args, cwd) {
  try {
    return { stdout: execFileSync(cmd, args, { cwd, encoding: 'utf-8', stdio: 'pipe' }) }
  } catch (err) {
    // A nonzero exit is the NORMAL case here (both `uv pip list --outdated` and `npm outdated`
    // exit non-zero purely because they found something) - stdout still carries valid JSON.
    if (err.stdout) {
      return { stdout: err.stdout }
    }
    return { error: err.stderr?.trim() || err.message }
  }
}

/** Extract package names from a `name = [ "pkg[extra]>=1.0", ... ]` TOML array in pyproject.toml;
 * bracket depth keeps a dependency's own `[extra]` from reading as the array's close. */
function extractArrayNames(content, arrayName) {
  const startRe = new RegExp(`^${arrayName}\\s*=\\s*\\[`, 'm')
  const startMatch = content.match(startRe)
  if (!startMatch) {
    return []
  }
  const rest = content.slice(startMatch.index + startMatch[0].length)

  let depth = 1
  let end = rest.length
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '[') {
      depth++
    } else if (rest[i] === ']') {
      depth--
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  const body = rest.slice(0, end)

  const names = []
  for (const line of body.split('\n')) {
    const m = line.match(/"([A-Za-z0-9_.-]+)/)
    if (m) {
      names.push(m[1])
    }
  }
  return names
}

/** Read the core `dependencies` and `dev` extra package names declared in pyproject.toml. */
function readPythonDirectDeps() {
  const content = readFileSync(join(ROOT, 'pyproject.toml'), 'utf-8')
  return new Set([
    ...extractArrayNames(content, 'dependencies'),
    ...extractArrayNames(content, 'dev'),
  ])
}

/** 'MAJOR' when the leading version segment differs, 'minor' otherwise. */
function classifyGap(current, latest) {
  return current.split('.')[0] !== latest.split('.')[0] ? 'MAJOR' : 'minor'
}

/** One formatted `  MAJOR  name   current -> latest` row, name padded for column alignment. */
function formatRow(name, current, latest) {
  const gap = classifyGap(current, latest)
  return `  ${gap.padEnd(5)}  ${name.padEnd(24)} ${current.padEnd(10)}-> ${latest}`
}

/** Print the python (pyproject.toml) section: direct deps only, filtered from uv's full list. */
function reportPython() {
  console.log('python (pyproject.toml)')

  const direct = readPythonDirectDeps()
  const result = run('uv', ['pip', 'list', '--outdated', '--format', 'json'], ROOT)
  if (result.error) {
    console.log(`  could not reach the Python package index: ${result.error}`)
    return
  }

  const outdated = JSON.parse(result.stdout).filter(p => direct.has(p.name))
  if (outdated.length === 0) {
    console.log('  up to date')
    return
  }
  for (const p of outdated) {
    console.log(formatRow(p.name, p.version, p.latest_version))
  }
}

/** Print one npm workspace's section; `npm outdated` without `-a` reports direct deps only. */
function reportNpmWorkspace({ label, dir }) {
  console.log(label)

  const result = run('npm', ['outdated', '--json'], dir)
  if (result.error) {
    console.log(`  could not reach the npm registry: ${result.error}`)
    return
  }

  const outdated = Object.entries(JSON.parse(result.stdout || '{}'))
  if (outdated.length === 0) {
    console.log('  up to date')
    return
  }
  for (const [name, info] of outdated) {
    console.log(formatRow(name, info.current, info.latest))
  }
}

reportPython()
console.log()
for (const workspace of NPM_WORKSPACES) {
  reportNpmWorkspace(workspace)
  console.log()
}
