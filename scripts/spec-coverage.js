#!/usr/bin/env node
/**
 * SPEC coverage calculator - parses claim markers and E2E test references.
 *
 * Coverage source: E2E tests under `lib/e2e/app/tests/*.spec.js` (Playwright)
 * and `lib/e2e/cli/test_*.py` (pytest). Per GUIDELINES.md § 8, unit tests
 * (`*.test.js` / `*.test.jsx` / `*_test.py`) MUST NOT carry SPEC markers —
 * this script reports any such occurrences as violations and exits non-zero
 * so they're caught at lint time.
 *
 * Marker syntax:
 *   - JavaScript Playwright: `// SPEC: scope:name`
 *   - Python pytest:         `# SPEC: scope:name`
 *
 * Limitation: coverage is documentary (comment presence), not behavioral.
 * A SPEC marker near any E2E test counts as "covered" regardless of whether
 * the test actually verifies the claimed behavior.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const ROOT = join(__dirname, '..')
const SPEC_PATH = join(ROOT, 'docs', 'SPEC.md')
const E2E_DIRS = [
  { dir: join(ROOT, 'e2e', 'app', 'tests'), exts: ['.spec.js', '.spec.jsx'] },
  { dir: join(ROOT, 'e2e', 'cli'), exts: ['.py'], filePrefix: 'test_' },
]
const UNIT_DIRS = [
  { dir: join(ROOT, 'src', 'claudebox_frontend', 'src'), exts: ['.test.js', '.test.jsx'] },
  { dir: join(ROOT, 'tests'), exts: ['.py'] },
]

const verbose = process.argv.includes('--verbose')

// Single regex matches both `// SPEC:` (JS) and `# SPEC:` (Python).
const SPEC_REGEX = /(?:\/\/|#)\s*SPEC:\s*([a-z0-9-]+:[a-z0-9-]+)/g

/**
 * Extract claim IDs from SPEC.md.
 */
function extractSpecClaims(specContent) {
  const claimRegex = /<!-- claim:([a-z0-9-]+:[a-z0-9-]+) -->/g
  const skipRegex = /<!-- skip:claim:([a-z0-9-]+:[a-z0-9-]+) -->/g
  const claims = new Map()
  const skipped = new Map()
  let match

  while ((match = claimRegex.exec(specContent)) !== null) {
    const claimId = match[1]
    const lineNum = specContent.slice(0, match.index).split('\n').length
    claims.set(claimId, { lineNum, covered: false, tests: [] })
  }

  while ((match = skipRegex.exec(specContent)) !== null) {
    const claimId = match[1]
    const lineNum = specContent.slice(0, match.index).split('\n').length
    skipped.set(claimId, { lineNum, reason: 'not E2E testable' })
  }

  return { claims, skipped }
}

/**
 * Extract SPEC references from E2E test files.
 */
function extractTestReferences(claims) {
  const references = []

  for (const { dir, exts, filePrefix } of E2E_DIRS) {
    const files = findTestFiles(dir, exts, filePrefix)
    for (const file of files) {
      const content = readFileSync(file, 'utf-8')
      let match
      const re = new RegExp(SPEC_REGEX.source, 'g')
      while ((match = re.exec(content)) !== null) {
        const claimId = match[1]
        const lineNum = content.slice(0, match.index).split('\n').length
        references.push({ file, claimId, lineNum })

        if (claims.has(claimId)) {
          const claim = claims.get(claimId)
          claim.covered = true
          claim.tests.push(file.replace(`${ROOT}/`, ''))
        }
      }
    }
  }

  return references
}

/**
 * Collect SPEC: markers found in unit-test files.
 */
function collectUnitSpecViolations() {
  const violations = []
  for (const { dir, exts } of UNIT_DIRS) {
    const files = findTestFiles(dir, exts)
    for (const file of files) {
      const content = readFileSync(file, 'utf-8')
      let match
      const re = new RegExp(SPEC_REGEX.source, 'g')
      while ((match = re.exec(content)) !== null) {
        const lineNum = content.slice(0, match.index).split('\n').length
        violations.push({ file, claimId: match[1], lineNum })
      }
    }
  }
  return violations
}

/**
 * Find test files recursively.
 *
 * If `filePrefix` is given, only files whose basename starts with it (and
 * matches one of `exts`) are returned. Otherwise any matching extension counts.
 */
function findTestFiles(dir, exts, filePrefix = null) {
  const results = []
  try {
    const entries = readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory() && !entry.name.includes('node_modules')) {
        results.push(...findTestFiles(fullPath, exts, filePrefix))
      } else if (exts.some(ext => entry.name.endsWith(ext))) {
        if (!filePrefix || entry.name.startsWith(filePrefix)) {
          results.push(fullPath)
        }
      }
    }
  } catch (_err) {
    // Directory doesn't exist
  }
  return results
}

function groupBySection(claims) {
  const sections = new Map()
  for (const [id, data] of claims) {
    const section = id.split(':')[0]
    if (!sections.has(section)) {
      sections.set(section, { total: 0, covered: 0, claims: [] })
    }
    const s = sections.get(section)
    s.total++
    if (data.covered) {
      s.covered++
    }
    s.claims.push({ id, ...data })
  }
  return sections
}

// Main
const specContent = readFileSync(SPEC_PATH, 'utf-8')
const { claims, skipped } = extractSpecClaims(specContent)

if (claims.size === 0) {
  console.log('No claim markers found in SPEC.md')
  console.log('Add markers using: <!-- claim:scope:name -->')
  process.exit(0)
}

const e2eRefs = extractTestReferences(claims)
const unitViolations = collectUnitSpecViolations()
const orphans = e2eRefs.filter(ref => !claims.has(ref.claimId))

const totalClaims = claims.size
const coveredClaims = [...claims.values()].filter(c => c.covered).length
const coverage = ((coveredClaims / totalClaims) * 100).toFixed(1)
const sections = groupBySection(claims)

let error = false

console.log(`\n${'='.repeat(60)}`)
console.log('SPEC COVERAGE REPORT')
console.log('='.repeat(60))
console.log(`\nTotal claims:   ${totalClaims}`)
console.log(`Covered:        ${coveredClaims}`)
console.log(`Coverage:       ${coverage}%`)
if (skipped.size > 0) {
  console.log(`Skipped:        ${skipped.size} (not E2E testable)`)
}

console.log(`\n${'-'.repeat(60)}`)
console.log('BY SCOPE')
console.log('-'.repeat(60))

const sortedSections = [...sections.entries()].sort((a, b) => a[0].localeCompare(b[0]))
for (const [section, data] of sortedSections) {
  const pct = data.total > 0 ? ((data.covered / data.total) * 100).toFixed(0) : 0
  const bar = '█'.repeat(Math.floor(pct / 10)) + '░'.repeat(10 - Math.floor(pct / 10))
  console.log(`  ${section.padEnd(30)} ${bar} ${pct.padStart(3)}% (${data.covered}/${data.total})`)
}

if (verbose) {
  console.log(`\n${'-'.repeat(60)}`)
  console.log('UNCOVERED CLAIMS')
  console.log('-'.repeat(60))
  const uncovered = [...claims.entries()].filter(([, d]) => !d.covered)
  if (uncovered.length === 0) {
    console.log('  All claims covered!')
  } else {
    error = true
    for (const [id, data] of uncovered) {
      console.log(`  ${id} (line ${data.lineNum})`)
    }
  }
}

if (orphans.length > 0) {
  error = true
  console.log(`\n${'-'.repeat(60)}`)
  console.log('ERROR: NONEXISTENT SPEC REFERENCES')
  console.log('-'.repeat(60))
  const uniqueOrphans = [...new Set(orphans.map(r => r.claimId))].sort()
  for (const claimId of uniqueOrphans) {
    console.log(`  - ${claimId}`)
  }
  console.log('\n')
}

if (unitViolations.length > 0) {
  error = true
  console.log(`\n${'-'.repeat(60)}`)
  console.log('ERROR: SPEC: MARKERS IN UNIT TESTS')
  console.log('-'.repeat(60))
  console.log('Per GUIDELINES.md § 8, only E2E tests may carry SPEC markers.')
  console.log('The following unit-test markers must be moved to E2E or removed:')
  for (const { file, claimId, lineNum } of unitViolations) {
    const rel = file.replace(`${ROOT}/`, '')
    console.log(`  - ${rel}:${lineNum} → ${claimId}`)
  }
  console.log('\n')
}

if (verbose && skipped.size > 0) {
  console.log(`\n${'-'.repeat(60)}`)
  console.log('SKIPPED CLAIMS (not E2E testable)')
  console.log('-'.repeat(60))
  for (const [id, data] of skipped) {
    console.log(`  ${id} (line ${data.lineNum})`)
  }
}

console.log('\n')

if (error) {
  process.exit(1)
}
