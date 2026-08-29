/**
 * Fixture tests for architecture-drift-check.js. Each builds an isolated tmp tree, never the real
 * repo, and proves one drift class fails on its own.
 */

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import {
  diffRoutes,
  diffTreeBlock,
  extractFencedBlocks,
  extractRegisteredRoutes,
  extractRouteTables,
  parseTreeEntries,
  resolveTreePaths,
} from './architecture-drift-check.js'

/** Create a fresh tmp dir for one test and register its removal on completion. */
function makeTmpRoot(t) {
  const dir = mkdtempSync(join(tmpdir(), 'arch-drift-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

/** Run one fenced tree block's lines through the block -> entries -> diff pipeline. */
function diffFixtureBlock(lines, root) {
  const [block] = extractFencedBlocks(lines)
  const entries = parseTreeEntries(block.contentLines, block.startLine + 1)
  const resolved = resolveTreePaths(entries)
  return diffTreeBlock(block, resolved, root, { fixture_mod: '.' })
}

const FIXTURE_HEADING = '## 1. Fixture (`fixture_mod`)'

// Tree-glyph prefixes as escapes to keep this file pure ASCII (tee U+251C, elbow U+2514, U+2500).
const TEE = '\u251c\u2500\u2500 '
const ELBOW = '\u2514\u2500\u2500 '

describe('tree/module-map blocks', () => {
  it('flags a fenced entry naming a file that does not exist', t => {
    const root = makeTmpRoot(t)
    mkdirSync(join(root, 'pkg'))
    writeFileSync(join(root, 'pkg', 'real.py'), '')

    const lines = [FIXTURE_HEADING, '', '```', 'pkg/', `${TEE}real.py`, `${ELBOW}fake.py`, '```']
    const problems = diffFixtureBlock(lines, root)

    assert.equal(problems.length, 1)
    assert.equal(problems[0].kind, 'missing-on-disk')
    assert.equal(problems[0].path, './pkg/fake.py')
  })

  it('flags a real directory entry the fenced block omits', t => {
    const root = makeTmpRoot(t)
    mkdirSync(join(root, 'pkg'))
    writeFileSync(join(root, 'pkg', 'real.py'), '')
    writeFileSync(join(root, 'pkg', 'extra.py'), '')

    const lines = [FIXTURE_HEADING, '', '```', 'pkg/', `${ELBOW}real.py`, '```']
    const problems = diffFixtureBlock(lines, root)

    assert.equal(problems.length, 1)
    assert.equal(problems[0].kind, 'unlisted-on-disk')
    assert.equal(problems[0].path, './pkg/extra.py')
  })
})

describe('route tables', () => {
  /** Write one router file registering `routes` ({method, path} pairs) under root/handlers. */
  function writeRouterFixture(root, prefix, routes) {
    const handlersDir = join(root, 'handlers')
    mkdirSync(handlersDir)
    const decorators = routes
      .map(
        (r, i) =>
          `@router.${r.method.toLowerCase()}("${r.path}")\nasync def op_${i}():\n    return None\n`,
      )
      .join('\n')
    writeFileSync(
      join(handlersDir, 'widgets.py'),
      `from fastapi import APIRouter\n\nrouter = APIRouter(prefix="${prefix}")\n\n${decorators}`,
    )
    return extractRegisteredRoutes(root, [{ dir: 'handlers' }])
  }

  function docRows(rows) {
    const lines = [
      '| Endpoint | Method | Description |',
      '|----------|--------|-------------|',
      ...rows.map(r => `| \`${r.path}\` | ${r.method} | fixture row |`),
    ]
    return extractRouteTables(lines)
  }

  it('flags a doc row for an endpoint no router registers', t => {
    const root = makeTmpRoot(t)
    const registered = writeRouterFixture(root, '/api/widgets', [{ method: 'GET', path: '/list' }])
    const rows = docRows([
      { path: '/api/widgets/list', method: 'GET' },
      { path: '/api/widgets/bogus', method: 'DELETE' },
    ])

    const { invented, unlisted } = diffRoutes(rows, registered)

    assert.equal(invented.length, 1)
    assert.equal(invented[0].path, '/api/widgets/bogus')
    assert.equal(unlisted.length, 0)
  })

  it('flags a registered route no doc row lists', t => {
    const root = makeTmpRoot(t)
    const registered = writeRouterFixture(root, '/api/widgets', [
      { method: 'GET', path: '/list' },
      { method: 'POST', path: '/list' },
    ])
    const rows = docRows([{ path: '/api/widgets/list', method: 'GET' }])

    const { invented, unlisted } = diffRoutes(rows, registered)

    assert.equal(invented.length, 0)
    assert.equal(unlisted.length, 1)
    assert.equal(unlisted[0].path, '/api/widgets/list')
    assert.equal(unlisted[0].method, 'POST')
  })
})
