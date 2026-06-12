#!/usr/bin/env node
/** Audit frontend source files against GUIDELINES.md rules. */

import { readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const ROOT = join(__dirname, '..')
const SRC = join(ROOT, 'src', 'claudebox_frontend', 'src')

const verbose = process.argv.includes('--verbose')

// Thresholds
const MAX_COMPONENT_LINES = 500
const MAX_HOOK_LINES = 500
const MAX_CONTEXT_LINES = 500
const MAX_PROPS = 10

// Patterns
const ALL_CAPS_CONST_RE = /^(?:export\s+)?const\s+([A-Z][A-Z0-9_]{2,})\s*=/
const FUNCTION_DECL_RE = /^(?:export\s+(?:default\s+)?)?function\s+([A-Za-z_]\w*)\s*\(/
const ARROW_COMPONENT_RE = /^export\s+(?:default\s+)?(?:const\s+)?([A-Z]\w*)\s*=.*=>/
const JSDOC_RE = /^\/\*\*[\s\S]*?\*\//
const PARAM_RE = /@param/
const IMPORT_RE = /^import\s+.*from\s+['"]([^'"]+)['"]/

// Behavioral constant indicators - should be centralized, not in component files
const BEHAVIORAL_CONST_NAMES = /^(MAX_|MIN_|DEFAULT_|TIMEOUT_|POLL_|RECONNECT_|DEBOUNCE_|THROTTLE_)/
const THRESHOLD_CONST_NAMES =
  /_(?:THRESHOLD|INTERVAL|DELAY|DURATION|SIZE|LIMIT|URL|PATH|MS|CYCLE|HOLD_MS|PEAK_MS)$/

// Inline suppression: // audit-ignore: rule1, rule2
const AUDIT_IGNORE_RE = /\/\/\s*audit-ignore:\s*(.+)/

// ─── File Discovery ──────────────────────────────────────────────────────────

/** Find all source files recursively, excluding node_modules. */
function findSourceFiles(dir, { includeTests = false } = {}) {
  const results = []

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory() && entry.name !== 'node_modules') {
      results.push(...findSourceFiles(fullPath, { includeTests }))
    } else if (/\.(jsx?|tsx?)$/.test(entry.name)) {
      if (includeTests || !entry.name.includes('.test.')) {
        results.push(fullPath)
      }
    }
  }

  return results
}

/** Find all files matching a regex extension, recursively, excluding node_modules. */
function findByExt(dir, extRe) {
  const results = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory() && entry.name !== 'node_modules') {
      results.push(...findByExt(fullPath, extRe))
    } else if (extRe.test(entry.name)) {
      results.push(fullPath)
    }
  }
  return results
}

/**
 * Classify a file by its location in the source tree.
 * Path segments determine type - hooks/ and utils/ detected at any depth.
 */
function classify(filePath) {
  const rel = relative(SRC, filePath)
  const name = basename(filePath)
  const segments = rel.split('/')

  // Top-level directories with dedicated types
  if (segments[0] === 'context') {
    return 'context'
  }
  if (segments[0] === 'managers') {
    return 'manager'
  }
  if (segments[0] === 'api') {
    return 'api'
  }
  if (segments[0] === 'constants') {
    return 'constants'
  }

  // Barrel files - index.js at any level
  if (name === 'index.js') {
    return 'barrel'
  }

  // Detect by containing directory - works at any nesting depth
  const parentDir = basename(dirname(filePath))
  if (parentDir === 'hooks') {
    return 'hook'
  }
  if (parentDir === 'utils') {
    return 'util'
  }

  // Shared components
  if (rel.startsWith('shared/components/')) {
    return 'component'
  }

  // Feature files - .jsx are components, .js are modules (config, controllers)
  if (rel.startsWith('features/')) {
    if (filePath.endsWith('.jsx')) {
      return 'component'
    }
    return 'module'
  }

  return 'other'
}

/**
 * Extract inline audit-ignore directives from file content.
 * Returns a Map of line number -> Set of suppressed rule names.
 * Supports: // audit-ignore: rule1, rule2
 * Placed on the line above, or same line as the violation.
 */
function extractIgnores(lines) {
  const ignores = new Map()

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(AUDIT_IGNORE_RE)
    if (!match) {
      continue
    }

    const rules = new Set(match[1].split(',').map(r => r.trim()))
    // Apply to this line and the next (covers both same-line and above-line usage)
    ignores.set(i + 1, rules)
    ignores.set(i + 2, rules)
  }

  return ignores
}

/**
 * Extract file-level audit-ignore directive.
 * A comment at the top of the file (after JSDoc) that suppresses rules for the whole file.
 * Format: // audit-ignore-file: rule1, rule2
 */
function extractFileIgnores(lines) {
  const fileIgnoreRe = /\/\/\s*audit-ignore-file:\s*(.+)/
  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    const match = lines[i].match(fileIgnoreRe)
    if (match) {
      return new Set(match[1].split(',').map(r => r.trim()))
    }
  }
  return new Set()
}

// ─── Checks ──────────────────────────────────────────────────────────────────

/**
 * Check file line count against threshold for its type.
 * Rules: components <=200, hooks <=200, contexts <=150.
 * Blank lines excluded - they improve legibility and shouldn't penalize.
 */
function checkFileSize(_filePath, lines, type) {
  const violations = []
  const thresholds = {
    component: MAX_COMPONENT_LINES,
    hook: MAX_HOOK_LINES,
    context: MAX_CONTEXT_LINES,
  }

  const limit = thresholds[type]
  const nonBlankCount = lines.filter(l => l.trim() !== '').length
  if (limit && nonBlankCount > limit) {
    violations.push({
      rule: 'file-size',
      message: `${nonBlankCount} non-blank lines (limit: ${limit})`,
    })
  }

  return violations
}

/**
 * Check for misplaced constants - behavioral/config constants outside constants/.
 * Only exempt: constants/ itself (where they belong).
 * All other file types are checked - utils, managers, modules included.
 */
function checkMisplacedConstants(_filePath, lines, type) {
  const violations = []
  if (type === 'constants' || type === 'barrel' || type === 'other') {
    return violations
  }

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(ALL_CAPS_CONST_RE)
    if (!match) {
      continue
    }

    const name = match[1]
    if (BEHAVIORAL_CONST_NAMES.test(name) || THRESHOLD_CONST_NAMES.test(name)) {
      violations.push({
        rule: 'misplaced-constant',
        message: `\`${name}\` should be in constants/ directory`,
        line: i + 1,
      })
    }
  }

  return violations
}

/**
 * Check for multiple exported component definitions in a single .jsx file.
 * Private helper components (non-exported, <=30 lines) are tolerated.
 */
function checkMultipleComponents(filePath, lines, type) {
  const violations = []
  if (type !== 'component' || !filePath.endsWith('.jsx')) {
    return violations
  }

  const components = []
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(FUNCTION_DECL_RE)
    if (!(match && /^[A-Z]/.test(match[1]))) {
      continue
    }

    const isExported = /^export\s/.test(lines[i])

    // Measure function body length for non-exported helpers
    let bodyLines = 0
    if (!isExported) {
      let braceDepth = 0
      let started = false
      for (let j = i; j < lines.length; j++) {
        for (const ch of lines[j]) {
          if (ch === '{') {
            braceDepth++
            started = true
          }
          if (ch === '}') {
            braceDepth--
          }
        }
        if (started) {
          bodyLines++
        }
        if (started && braceDepth === 0) {
          break
        }
      }
    }

    components.push({ name: match[1], line: i + 1, isExported, bodyLines })
  }

  // Filter: keep exported components + private helpers exceeding 30 lines
  const significant = components.filter(c => c.isExported || c.bodyLines > 30)

  if (significant.length > 1) {
    const names = significant.map(c => `${c.name}:${c.line}`)
    violations.push({
      rule: 'multiple-components',
      message: `${significant.length} components: ${names.join(', ')}`,
    })
  }

  return violations
}

/**
 * Check for non-component function exports from .jsx files.
 * Utility functions should not be exported from component files.
 */
function checkUtilityExportsFromComponents(filePath, lines, type) {
  const violations = []
  if (type !== 'component' || !filePath.endsWith('.jsx')) {
    return violations
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.startsWith('export ')) {
      continue
    }
    if (line.includes('export default')) {
      continue
    }

    const fnMatch = line.match(/^export\s+function\s+([a-z]\w*)\s*\(/)
    const constMatch = line.match(/^export\s+(?:const|let)\s+([a-z]\w*)\s*=/)
    const name = fnMatch?.[1] || constMatch?.[1]

    if (name) {
      violations.push({
        rule: 'utility-export-from-component',
        message: `exported \`${name}\` from component file - move to utils/`,
        line: i + 1,
      })
    }
  }

  return violations
}

// React API references that mark a function as React-coupled (hook or renderer).
const REACT_API_RE =
  /\b(?:useState|useEffect|useCallback|useRef|useMemo|useReducer|useContext|useLayoutEffect|useImperativeHandle|forwardRef|memo)\b|<[A-Za-z]/

/**
 * Check for module-level pure helpers in hooks/ or *.jsx files.
 *
 * Companion to `utility-export-from-component`: that rule flags exported
 * helpers; this one flags non-exported module-level helpers whose body has
 * zero React-API references - they belong in a co-located utils/ file per
 * GUIDELINES §6 ("Always extract pure functions").
 *
 * Skipped patterns are documented in GUIDELINES §6 "Do NOT extract":
 * closure-bound helpers (declared inside hook bodies, not module-level -
 * naturally excluded), React-coupled renderers (caught via REACT_API_RE),
 * tightly-bound constants (this rule only matches functions).
 */
function checkPureModuleHelpers(filePath, lines, type) {
  const violations = []
  if (!(type === 'hook' || type === 'component')) {
    return violations
  }
  // Defensive: if a hook/component file somehow lives under utils/, skip.
  if (filePath.includes('/utils/')) {
    return violations
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // Module scope only - must start at column 0 (no leading whitespace).
    const fnMatch = line.match(/^function\s+([a-z]\w*)\s*\(/)
    const constMatch = line.match(
      /^(?:const|let)\s+([a-z]\w*)\s*=\s*(?:async\s*)?(?:\(|function\b)/,
    )
    const name = fnMatch?.[1] || constMatch?.[1]
    if (!name) {
      continue
    }

    // Walk forward until the function body closes, tracking brace depth.
    let depth = 0
    let started = false
    let bodyEnd = i
    for (let j = i; j < lines.length; j++) {
      for (const ch of lines[j]) {
        if (ch === '{') {
          depth++
          started = true
        } else if (ch === '}') {
          depth--
        }
      }
      if (started && depth === 0) {
        bodyEnd = j
        break
      }
    }

    const body = lines.slice(i, bodyEnd + 1).join('\n')
    if (!REACT_API_RE.test(body)) {
      violations.push({
        rule: 'pure-module-helper',
        message: `\`${name}\` is a module-level pure helper - extract to utils/`,
        line: i + 1,
      })
    }
  }

  return violations
}

/** Check for missing file-level JSDoc comment. */
function checkFileLevelJSDoc(_filePath, content, type) {
  const violations = []
  if (type === 'other' || type === 'barrel') {
    return violations
  }

  // Allow shebang before JSDoc
  const stripped = content.replace(/^#!.*\n/, '')
  if (!JSDOC_RE.test(stripped.trimStart())) {
    violations.push({
      rule: 'missing-file-jsdoc',
      message: 'missing file-level /** ... */ comment',
    })
  }

  return violations
}

/**
 * Check for missing blank line after file-level JSDoc.
 * Section 9: blank line required between file comment and imports.
 */
function checkJSDocBlankLine(_filePath, content, type) {
  const violations = []
  if (type === 'other' || type === 'barrel') {
    return violations
  }

  const stripped = content.replace(/^#!.*\n/, '')
  const match = stripped.match(JSDOC_RE)
  if (!match) {
    return violations
  }

  // Find where the JSDoc ends and check the next line
  const afterJSDoc = stripped.slice(match.index + match[0].length)
  if (afterJSDoc.length > 0 && !afterJSDoc.startsWith('\n\n')) {
    violations.push({
      rule: 'missing-jsdoc-blank-line',
      message: 'missing blank line after file-level JSDoc',
    })
  }

  return violations
}

/**
 * Check for missing @param on component JSDoc.
 * Components with props should document them with @param.
 */
function checkComponentParamDocs(filePath, lines, type) {
  const violations = []
  if (type !== 'component' || !filePath.endsWith('.jsx')) {
    return violations
  }

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(FUNCTION_DECL_RE)
    if (!(match && /^[A-Z]/.test(match[1]))) {
      continue
    }

    // Check if it has props (destructured object param)
    const hasProps = /\(\s*\{/.test(lines[i])
    if (!hasProps) {
      continue
    }

    // Look backwards for JSDoc
    let jsdocBlock = ''
    for (let j = i - 1; j >= Math.max(0, i - 20); j--) {
      if (lines[j].includes('*/')) {
        for (let k = j; k >= Math.max(0, j - 30); k--) {
          jsdocBlock = `${lines[k]}\n${jsdocBlock}`
          if (lines[k].includes('/**')) {
            break
          }
        }
        break
      }
      if (lines[j].trim() && !lines[j].trim().startsWith('*') && !lines[j].trim().startsWith('/')) {
        break
      }
    }

    if (jsdocBlock && !PARAM_RE.test(jsdocBlock)) {
      violations.push({
        rule: 'missing-param-jsdoc',
        message: `component \`${match[1]}\` has props but no @param in JSDoc`,
        line: i + 1,
      })
    }
  }

  return violations
}

/** Check for component signatures with too many props. */
function checkPropsCount(filePath, content, type) {
  const violations = []
  if (type !== 'component' || !filePath.endsWith('.jsx')) {
    return violations
  }

  // Join lines to handle multi-line destructuring
  const joined = content.replace(/\n/g, ' ')
  const matches = joined.matchAll(/function\s+([A-Z]\w*)\s*\(\s*\{([^}]*)\}/g)

  for (const match of matches) {
    const name = match[1]
    const propsStr = match[2]
    const props = propsStr
      .split(',')
      .map(p =>
        p
          .trim()
          .split(/\s*=\s*/)[0]
          .trim(),
      )
      .filter(Boolean)

    if (props.length > MAX_PROPS) {
      violations.push({
        rule: 'excessive-props',
        message: `\`${name}\` has ${props.length} props (limit: ${MAX_PROPS})`,
      })
    }
  }

  return violations
}

/**
 * Check for arrow function component exports in .jsx files.
 * Guidelines require function declarations for components.
 */
function checkArrowComponents(filePath, lines, type) {
  const violations = []
  if (type !== 'component' || !filePath.endsWith('.jsx')) {
    return violations
  }

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(ARROW_COMPONENT_RE)
    if (match) {
      violations.push({
        rule: 'arrow-component',
        message: `\`${match[1]}\` uses arrow function - use function declaration`,
        line: i + 1,
      })
    }
  }

  return violations
}

/**
 * Check for React concerns in utils/ files.
 * Guidelines: "if it needs React, it's a hook" and "never import React in utils/".
 * Flags both explicit React imports and .jsx extension (JSX = React concern).
 */
function checkReactInUtils(filePath, lines, type) {
  const violations = []
  if (type !== 'util') {
    return violations
  }

  // Flag .jsx extension in utils/ - JSX is a React concern
  if (filePath.endsWith('.jsx')) {
    violations.push({
      rule: 'react-in-utils',
      message:
        'utils/ file has .jsx extension - JSX is a React concern, should be a hook or component',
    })
  }

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(IMPORT_RE)
    if (match && match[1] === 'react') {
      violations.push({
        rule: 'react-in-utils',
        message: 'utils/ file imports from react - should be a hook',
        line: i + 1,
      })
    }
  }

  return violations
}

/**
 * Check that panel-root state classes follow the `.{panel}-{loading|empty|error}` triplet.
 *
 * GUIDELINES.md §6: panels expose state via the canonical `.{panel}-loading / -empty / -error`
 * class triplet. Only the states a panel actually renders need classes - but where a state IS
 * rendered, the class name MUST match the triplet pattern. The class prefix MUST match the
 * panel's own root class (kebab-case slug derived from the file basename minus `Panel.jsx`).
 *
 * Targets only `*Panel.jsx` files. Looks for `className="X-panel X-state"` patterns; if the
 * second class is `X-loading|X-empty|X-error`, the prefix must match. Otherwise warns about
 * a state-suffixed class with the wrong prefix or mismatched panel slug.
 */
function checkPanelStateClassTriplet(filePath, content, type) {
  const violations = []
  if (type !== 'component') {
    return violations
  }
  const name = basename(filePath)
  if (!name.endsWith('Panel.jsx')) {
    return violations
  }

  // Slug: PascalCase basename minus "Panel.jsx" -> kebab-case.
  // e.g. SessionsPanel.jsx -> sessions, McpPanel.jsx -> mcp.
  const stem = name.slice(0, -'Panel.jsx'.length)
  const expectedSlug = stem
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase()
  if (!expectedSlug) {
    return violations
  }

  const panelClass = `${expectedSlug}-panel`
  const stateRe = /className="([^"]*\b[a-z][a-z-]*-(loading|empty|error)\b[^"]*)"/g

  for (const match of content.matchAll(stateRe)) {
    const classList = match[1].split(/\s+/)
    if (!classList.includes(panelClass)) {
      continue
    }
    for (const cls of classList) {
      const stateMatch = cls.match(/^([a-z][a-z-]*)-(loading|empty|error)$/)
      if (!stateMatch) {
        continue
      }
      const prefix = stateMatch[1]
      if (prefix !== expectedSlug) {
        const lineNum = content.slice(0, match.index).split('\n').length
        violations.push({
          rule: 'panel-state-class-triplet',
          message: `panel-root has \`${cls}\` but expected prefix \`${expectedSlug}\` - class should be \`${expectedSlug}-${stateMatch[2]}\``,
          line: lineNum,
        })
      }
    }
  }

  return violations
}

/**
 * Check for CSS imports directly in component .jsx files.
 * CSS must flow through the cascade orchestrator (index.css -> main.css).
 * Exempt: main.jsx (entry point), third-party CSS from node_modules.
 */
function checkCSSImportInComponent(filePath, lines, _type) {
  const violations = []
  if (!filePath.endsWith('.jsx')) {
    return violations
  }
  if (basename(filePath) === 'main.jsx') {
    return violations
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // Match: import '...css' or import "...css"
    const cssImport = line.match(/^import\s+['"]([^'"]+\.css)['"]\s*;?\s*$/)
    if (!cssImport) {
      continue
    }

    const importPath = cssImport[1]
    // Allow third-party CSS (from node_modules - no relative path prefix)
    if (!(importPath.startsWith('.') || importPath.startsWith('/'))) {
      continue
    }

    violations.push({
      rule: 'css-import-in-component',
      message: `direct CSS import \`${importPath}\` - use cascade orchestrator`,
      line: i + 1,
    })
  }

  return violations
}

/**
 * A1. Check for temporal references in comments.
 * GUIDELINES.md preamble: "Comments describe current state, not change history.
 * No 'was:', 'moved from', 'previously', 'renamed from'."
 *
 * Walks lines tracking block-comment state; only inspects comment text.
 */
function checkTemporalReferences(filePath, lines, _type) {
  const violations = []
  if (filePath.endsWith('.css')) {
    return violations
  }

  const banned = /\b(was:|previously|formerly|moved from|renamed from)\b/i
  let inBlock = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    let commentText = ''

    if (inBlock) {
      const end = line.indexOf('*/')
      if (end >= 0) {
        commentText = line.slice(0, end)
        inBlock = false
      } else {
        commentText = line
      }
    } else {
      const blockStart = line.indexOf('/*')
      const lineStart = line.indexOf('//')
      if (blockStart >= 0 && (lineStart < 0 || blockStart < lineStart)) {
        const end = line.indexOf('*/', blockStart + 2)
        if (end >= 0) {
          commentText = line.slice(blockStart + 2, end)
        } else {
          commentText = line.slice(blockStart + 2)
          inBlock = true
        }
      } else if (lineStart >= 0) {
        commentText = line.slice(lineStart + 2)
      }
    }

    if (commentText && banned.test(commentText)) {
      const hit = commentText.match(banned)[0]
      violations.push({
        rule: 'temporal-reference-in-comment',
        message: `comment contains \`${hit}\` - describe current state, not history (git tracks history)`,
        line: i + 1,
      })
    }
  }

  return violations
}

/**
 * A3. Check for CSS-in-JS library imports.
 * GUIDELINES.md §6 Styling: "🚫 Never CSS-in-JS, CSS modules, or Tailwind".
 */
function checkCssInJsImport(filePath, lines, _type) {
  const violations = []
  if (!/\.(jsx?|tsx?)$/.test(filePath)) {
    return violations
  }

  const cssInJsRe =
    /^import\s+.*from\s+['"](styled-components|@emotion\/[\w-]+|@stitches\/[\w-]+|goober|linaria)['"]/

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(cssInJsRe)
    if (m) {
      violations.push({
        rule: 'no-css-in-js',
        message: `imports from \`${m[1]}\` - CSS-in-JS is banned; use plain CSS files`,
        line: i + 1,
      })
    }
  }

  return violations
}

/**
 * A4. Check for Tailwind imports / directives.
 * GUIDELINES.md §6 Styling: "🚫 Never CSS-in-JS, CSS modules, or Tailwind".
 */
function checkNoTailwind(filePath, content, _type) {
  const violations = []

  if (/\.(jsx?|tsx?)$/.test(filePath)) {
    const lines = content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (/^import\s+.*from\s+['"](?:tailwindcss|@tailwindcss\/[\w-]+)['"]/.test(lines[i])) {
        violations.push({
          rule: 'no-tailwind',
          message: 'imports from tailwindcss - Tailwind is banned; use plain CSS',
          line: i + 1,
        })
      }
    }
  }

  if (filePath.endsWith('.css')) {
    const lines = content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (
        /^@tailwind\b/.test(lines[i].trim()) ||
        /^@import\s+['"]tailwindcss\b/.test(lines[i].trim())
      ) {
        violations.push({
          rule: 'no-tailwind',
          message: '@tailwind directive - Tailwind is banned',
          line: i + 1,
        })
      }
    }
  }

  return violations
}

/**
 * A6. Check for Unicode-ellipsis "Loading…" copy.
 * GUIDELINES.md §6 Loading copy: "Loading copy is `'Loading...'` (3 ASCII dots)".
 */
function checkLoadingCopy(filePath, lines, _type) {
  const violations = []
  if (!/\.(jsx?|tsx?)$/.test(filePath)) {
    return violations
  }

  for (let i = 0; i < lines.length; i++) {
    if (/Loading…/.test(lines[i])) {
      violations.push({
        rule: 'loading-copy-ascii-dots',
        message: 'uses Unicode ellipsis (…) - replace with three ASCII dots (...)',
        line: i + 1,
      })
    }
  }

  return violations
}

/**
 * A7. Check for hook names containing AND.
 * GUIDELINES.md §6 Hook Scope: "if the name needs 'and' to describe it, split it".
 * Detects PascalCase `And` segment in `use*` hook names.
 */
function checkHookAndTest(_filePath, lines, type) {
  const violations = []
  if (type !== 'hook') {
    return violations
  }

  const andRe = /\b(use[A-Z]\w*And[A-Z]\w*)\b/

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(andRe)
    if (!m) {
      continue
    }
    if (/^(?:export\s+(?:default\s+)?)?(?:function|const)\s+/.test(lines[i])) {
      violations.push({
        rule: 'hook-and-test',
        message: `\`${m[1]}\` contains \`And\` - single-purpose rule says split into separate hooks`,
        line: i + 1,
      })
    }
  }

  return violations
}

/**
 * A8. Check for >1 class declaration per .js file (managers/services/controllers).
 * GUIDELINES.md §6 File Boundaries: "✅ one class per `.js` file (managers, controllers, services)".
 */
function checkOneClassPerJsModule(filePath, content, type) {
  const violations = []
  if (!filePath.endsWith('.js')) {
    return violations
  }
  const name = basename(filePath)
  if (name.includes('.test.')) {
    return violations
  }

  const isCoordinationModule =
    type === 'manager' || /(?:Controller|Service|Manager)\.js$/.test(name)
  if (!isCoordinationModule) {
    return violations
  }

  const matches = [...content.matchAll(/^class\s+(\w+)\b/gm)]
  if (matches.length > 1) {
    const names = matches.map(m => m[1]).join(', ')
    violations.push({
      rule: 'one-class-per-js-module',
      message: `defines ${matches.length} classes (${names}) - coordination modules ship one class per file`,
    })
  }

  return violations
}

/**
 * B1. Check feature barrel index.js follows the canonical re-export shape.
 * GUIDELINES.md §6 Directory Architecture: "index.js - Barrel re-export of root component".
 *
 * Body must reduce to a single `export { default } from './XPanel'` (with optional
 * file-level JSDoc and trailing semicolon/whitespace).
 */
function checkBarrelIndexPattern(filePath, content, _type) {
  const violations = []
  const rel = relative(SRC, filePath)
  if (!/^features\/[^/]+\/index\.js$/.test(rel)) {
    return violations
  }

  // Strip leading JSDoc/comments and blank lines, then check the remainder.
  const stripped = content
    .replace(/^\s*\/\*\*[\s\S]*?\*\/\s*/, '')
    .replace(/^(?:\s*\/\/[^\n]*\n)+/, '')
    .trim()
  const canonical = /^export\s*\{\s*default\s*\}\s*from\s*['"]\.\/[A-Z]\w+['"]\s*;?$/

  if (!canonical.test(stripped)) {
    violations.push({
      rule: 'barrel-index-pattern',
      message:
        "feature index.js is not a clean barrel - body must be `export { default } from './RootComponent'`",
    })
  }

  return violations
}

/**
 * B3. Check that the file-level JSDoc spans a single line.
 * GUIDELINES.md §10 JS Conventions: "Single line at top of file".
 */
function checkFileJsdocSingleLine(filePath, content, _type) {
  const violations = []
  if (!/\.(jsx?|tsx?)$/.test(filePath)) {
    return violations
  }
  if (basename(filePath).includes('.test.')) {
    return violations // tests checked separately
  }

  const m = content.match(/^\s*\/\*\*([\s\S]*?)\*\//)
  if (!m) {
    return violations
  }
  if (m[1].includes('\n')) {
    violations.push({
      rule: 'multi-line-file-jsdoc',
      message: 'file-level JSDoc spans multiple lines - collapse to one line',
      line: 1,
    })
  }

  return violations
}

/**
 * B4. Check component prop names follow the `on*` convention for callback props.
 * GUIDELINES.md §6 Component Patterns: "use `handle*` for internal handlers, `on*` for callback props".
 *
 * Inspects the destructured props of `function Comp({ ... })` and flags any prop
 * starting with `handle*` (callback props should be `on*`).
 */
function checkHandlerPropNaming(_filePath, content, type) {
  const violations = []
  if (type !== 'component') {
    return violations
  }

  // Match: function ComponentName({ ...props }) - single-level brace scan
  const sigRe = /(?:export\s+(?:default\s+)?)?function\s+([A-Z]\w*)\s*\(\s*\{([^{}]*)\}/g
  for (const m of content.matchAll(sigRe)) {
    const propsBlock = m[2]
    // Split by top-level commas (best-effort: no nested objects expected here).
    for (const propEntry of propsBlock.split(',')) {
      const nameMatch = propEntry.trim().match(/^([a-zA-Z_]\w*)/)
      if (!nameMatch) {
        continue
      }
      const propName = nameMatch[1]
      if (/^handle[A-Z]/.test(propName)) {
        const lineNum = content.slice(0, m.index).split('\n').length
        violations.push({
          rule: 'handler-prop-naming',
          message: `prop \`${propName}\` should be \`${propName.replace(/^handle/, 'on')}\` (callback props use \`on*\`, locals use \`handle*\`)`,
          line: lineNum,
        })
      }
    }
  }

  return violations
}

/**
 * B5. Check for URL literals embedded in component files.
 * GUIDELINES.md §6 Constants: "🚫 Never put size limits, URLs, or behavioral thresholds in component files".
 *
 * Catches `https?://` literals in component .jsx that aren't in comments. Excludes
 * the `xmlns="http://www.w3.org/2000/svg"` attribute (SVG namespace, not behavioral).
 */
function checkUrlLiteralInComponent(_filePath, content, type) {
  const violations = []
  if (type !== 'component') {
    return violations
  }

  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // Skip pure comment lines
    if (/^\s*(?:\/\/|\*|\/\*)/.test(line)) {
      continue
    }
    // Skip SVG xmlns attribute
    const stripped = line.replace(/xmlns=['"][^'"]*['"]/g, '')
    const m = stripped.match(/['"`](https?:\/\/[^'"`\s]+)['"`]/)
    if (m) {
      violations.push({
        rule: 'url-literal-in-component',
        message: `URL literal \`${m[1]}\` in component - centralize in config/`,
        line: i + 1,
      })
    }
  }

  return violations
}

/**
 * B6. Check that CSS class selectors use kebab-case.
 * GUIDELINES.md §6 Styling: "Plain CSS files with kebab-case class names".
 *
 * Scans .css files for class selectors containing uppercase letters.
 */
function checkKebabCaseCss(filePath, content, _type) {
  const violations = []
  if (!filePath.endsWith('.css')) {
    return violations
  }

  // Strip block comments to avoid matching within them.
  const stripped = content.replace(/\/\*[\s\S]*?\*\//g, '')
  const lines = stripped.split('\n')

  // Match `.someName` only when preceded by a non-name character (selector context),
  // not e.g. inside `.5em` numeric literal or `var(--foo)` CSS-variable usage.
  const classSelRe = /(?<![a-zA-Z0-9_-])\.([a-zA-Z][a-zA-Z0-9_-]*)/g

  for (let i = 0; i < lines.length; i++) {
    for (const m of lines[i].matchAll(classSelRe)) {
      if (/[A-Z]/.test(m[1])) {
        violations.push({
          rule: 'kebab-case-css',
          message: `class selector \`.${m[1]}\` contains uppercase - use kebab-case`,
          line: i + 1,
        })
      }
    }
  }

  return violations
}

// ─── Cross-File Checks ───────────────────────────────────────────────────────

/**
 * A2. Detect any CSS Module file under src/.
 * GUIDELINES.md §6 Styling: "🚫 Never CSS-in-JS, CSS modules, or Tailwind".
 */
function checkNoCssModules(cssFiles) {
  const violations = []
  for (const file of cssFiles) {
    if (file.endsWith('.module.css')) {
      violations.push({
        file: relative(SRC, file),
        rule: 'no-css-modules',
        message: '.module.css file - CSS Modules are banned; use plain CSS with kebab-case classes',
      })
    }
  }
  return violations
}

/**
 * A5. Detect any `styles/` directory under src/.
 * GUIDELINES.md §6 Styling: "🚫 Never put component styles in a separate `styles/` directory".
 */
function checkNoStylesDirectory(cssFiles, allSourceFiles) {
  const violations = []
  const seen = new Set()
  const all = [...cssFiles, ...allSourceFiles]
  for (const file of all) {
    const rel = relative(SRC, file)
    const m = rel.match(/(^|\/)styles\//)
    if (m && !seen.has(rel)) {
      seen.add(rel)
      violations.push({
        file: rel,
        rule: 'no-styles-directory',
        message: 'lives under a `styles/` directory - CSS must co-locate with its component',
      })
    }
  }
  return violations
}

/**
 * A9. Detect orphaned test files - every `*.test.{js,jsx}` should have a sibling source file.
 * GUIDELINES.md §7 Testing: "Test files co-located: `Component.test.jsx` alongside `Component.jsx`".
 */
function checkOrphanedTestFiles(testFiles, sourceFiles) {
  const violations = []
  const sourceSet = new Set(sourceFiles)
  for (const testFile of testFiles) {
    const dir = dirname(testFile)
    const name = basename(testFile)
    // strip `.test.` from the name to derive the source basename
    const sourceName = name.replace(/\.test\./, '.')
    const expected = join(dir, sourceName)
    if (!sourceSet.has(expected)) {
      violations.push({
        file: relative(SRC, testFile),
        rule: 'orphaned-test-file',
        message: `no sibling source file \`${sourceName}\` - orphaned test (likely after rename/move)`,
      })
    }
  }
  return violations
}

/**
 * B2. Detect CSS files without a sibling component .jsx of the same basename.
 * GUIDELINES.md §6 Styling: "✅ Always co-locate CSS with its component - `{Component}.css` next to `{Component}.jsx`".
 *
 * Exemptions: `index.css` (barrel imports), `main.css` (cascade orchestrator),
 * `App.css` (app-feature foundation), CSS in non-feature top-level dirs (config/, etc.).
 */
function checkCssWithoutComponentSibling(cssFiles, sourceFiles) {
  const violations = []
  const sourceSet = new Set(sourceFiles)

  for (const cssFile of cssFiles) {
    const name = basename(cssFile)
    if (name === 'index.css' || name === 'main.css') {
      continue
    }
    if (name.endsWith('.module.css')) {
      continue // already flagged by A2
    }
    const rel = relative(SRC, cssFile)
    if (!(rel.startsWith('features/') || rel.startsWith('components/'))) {
      continue
    }

    // PascalCase basename suggests component CSS; lowercase suggests a leaf style file.
    const stem = name.replace(/\.css$/, '')
    if (!/^[A-Z]/.test(stem)) {
      continue
    }

    const dir = dirname(cssFile)
    const expectedJsx = join(dir, `${stem}.jsx`)
    if (!sourceSet.has(expectedJsx)) {
      violations.push({
        file: rel,
        rule: 'css-without-component-sibling',
        message: `no sibling \`${stem}.jsx\` - CSS file is orphaned or misplaced`,
      })
    }
  }

  return violations
}

/**
 * Check for generic utils buried in feature directories.
 * A feature util that imports nothing from its own feature tree is generic -
 * it belongs in shared/utils/ where it's discoverable and reusable.
 */
function checkBuriedGenericUtils(allFiles, allContents) {
  const violations = []

  // Build list of candidate utils (no feature-internal imports)
  const candidates = []

  for (let i = 0; i < allFiles.length; i++) {
    const rel = relative(SRC, allFiles[i])
    if (!rel.startsWith('features/')) {
      continue
    }
    if (!rel.includes('/utils/')) {
      continue
    }
    if (basename(allFiles[i]).includes('.test.')) {
      continue
    }

    const content = allContents[i]
    const featurePrefix = `features/${rel.split('/')[1]}/`
    const lines = content.split('\n')
    let hasFeatureImport = false

    for (const line of lines) {
      const match = line.match(IMPORT_RE)
      if (!match) {
        continue
      }

      const importPath = match[1]
      if (!importPath.startsWith('.')) {
        continue
      }

      // Resolve relative import and check if it stays within this feature
      const resolved = relative(SRC, join(dirname(allFiles[i]), importPath))
      if (resolved.startsWith(featurePrefix)) {
        hasFeatureImport = true
        break
      }
    }

    if (!hasFeatureImport) {
      candidates.push({ file: allFiles[i], rel, featurePrefix })
    }
  }

  // For each candidate, check if any file outside the feature imports it.
  // If only its own feature imports it, it's feature-private - not a candidate for promotion.
  for (const { file, rel, featurePrefix } of candidates) {
    const utilStem = relative(SRC, file).replace(/\.js$/, '')
    let hasExternalConsumer = false

    for (let j = 0; j < allFiles.length; j++) {
      const consumerRel = relative(SRC, allFiles[j])
      if (consumerRel.startsWith(featurePrefix)) {
        continue
      }

      const lines = allContents[j].split('\n')
      for (const line of lines) {
        const match = line.match(IMPORT_RE)
        if (!match) {
          continue
        }

        const importPath = match[1]
        if (!importPath.startsWith('.')) {
          continue
        }

        const resolved = relative(SRC, join(dirname(allFiles[j]), importPath))
        if (resolved === utilStem || resolved.startsWith(`${utilStem}/`)) {
          hasExternalConsumer = true
          break
        }
      }

      if (hasExternalConsumer) {
        break
      }
    }

    if (hasExternalConsumer) {
      violations.push({
        file: rel,
        rule: 'buried-generic-util',
        message: 'no feature-internal imports and used outside feature - move to utils/',
      })
    }
  }

  return violations
}

/**
 * Check for cross-feature imports.
 * Features can only import from: own internals, shared/, context/, constants/, api/.
 * Exception: features/app/ can import from all features (it's the layout shell).
 */
function checkCrossFeatureImports(allFiles, allContents) {
  const violations = []

  for (let i = 0; i < allFiles.length; i++) {
    const filePath = allFiles[i]
    const rel = relative(SRC, filePath)
    if (!rel.startsWith('features/')) {
      continue
    }

    // Extract this file's feature name (first segment after features/)
    const featureName = rel.split('/')[1]

    // app is the layout shell - allowed to import from all features
    if (featureName === 'app') {
      continue
    }

    const lines = allContents[i].split('\n')
    for (let j = 0; j < lines.length; j++) {
      const match = lines[j].match(IMPORT_RE)
      if (!match) {
        continue
      }

      const importPath = match[1]
      if (!importPath.startsWith('.')) {
        continue
      }

      // Resolve the import to see if it points to another feature
      const importDir = dirname(filePath)
      const resolved = relative(SRC, join(importDir, importPath))

      if (resolved.startsWith('features/')) {
        const targetFeature = resolved.split('/')[1]
        if (targetFeature !== featureName) {
          violations.push({
            file: rel,
            rule: 'cross-feature-import',
            message: `imports from features/${targetFeature}/ - features must be independent`,
            line: j + 1,
          })
        }
      }
    }
  }

  return violations
}

/**
 * Check feature import sources against the import rules table.
 * Features (non-app) can import from: own internals, shared/, context/, constants/, api/.
 * Anything else (managers/, other features, etc.) is a violation.
 */
function checkImportSources(allFiles, allContents) {
  const violations = []
  const allowedRoots = new Set(['shared', 'context', 'constants', 'api'])

  for (let i = 0; i < allFiles.length; i++) {
    const filePath = allFiles[i]
    const rel = relative(SRC, filePath)
    if (!rel.startsWith('features/')) {
      continue
    }

    const featureName = rel.split('/')[1]
    // app can import from managers/ and all features
    if (featureName === 'app') {
      continue
    }

    const lines = allContents[i].split('\n')
    for (let j = 0; j < lines.length; j++) {
      const match = lines[j].match(IMPORT_RE)
      if (!match) {
        continue
      }

      const importPath = match[1]
      if (!importPath.startsWith('.')) {
        continue
      }

      const importDir = dirname(filePath)
      const resolved = relative(SRC, join(importDir, importPath))

      // Skip own feature internals
      if (resolved.startsWith(`features/${featureName}`)) {
        continue
      }
      // Skip allowed roots
      const topDir = resolved.split('/')[0]
      if (allowedRoots.has(topDir)) {
        continue
      }

      // managers/ is only allowed for app feature
      if (topDir === 'managers') {
        violations.push({
          file: rel,
          rule: 'import-source-violation',
          message: `imports from ${topDir}/ - only app feature can import managers`,
          line: j + 1,
        })
      }
    }
  }

  return violations
}

// ─── Runner ──────────────────────────────────────────────────────────────────

/** Run all per-file checks and return violations, applying inline ignores. */
function auditFile(filePath, content) {
  const lines = content.split('\n')
  const type = classify(filePath)
  const rel = relative(SRC, filePath)
  const lineIgnores = extractIgnores(lines)
  const fileIgnores = extractFileIgnores(lines)

  const violations = [
    ...checkFileSize(filePath, lines, type),
    ...checkMisplacedConstants(filePath, lines, type),
    ...checkMultipleComponents(filePath, lines, type),
    ...checkUtilityExportsFromComponents(filePath, lines, type),
    ...checkPureModuleHelpers(filePath, lines, type),
    ...checkFileLevelJSDoc(filePath, content, type),
    ...checkJSDocBlankLine(filePath, content, type),
    ...checkComponentParamDocs(filePath, lines, type),
    ...checkPropsCount(filePath, content, type),
    ...checkArrowComponents(filePath, lines, type),
    ...checkReactInUtils(filePath, lines, type),
    ...checkCSSImportInComponent(filePath, lines, type),
    ...checkPanelStateClassTriplet(filePath, content, type),
    ...checkTemporalReferences(filePath, lines, type),
    ...checkCssInJsImport(filePath, lines, type),
    ...checkNoTailwind(filePath, content, type),
    ...checkLoadingCopy(filePath, lines, type),
    ...checkHookAndTest(filePath, lines, type),
    ...checkOneClassPerJsModule(filePath, content, type),
    ...checkBarrelIndexPattern(filePath, content, type),
    ...checkFileJsdocSingleLine(filePath, content, type),
    ...checkHandlerPropNaming(filePath, content, type),
    ...checkUrlLiteralInComponent(filePath, content, type),
  ]

  return violations
    .filter(v => {
      // File-level suppression
      if (fileIgnores.has(v.rule)) {
        return false
      }
      // Line-level suppression
      if (v.line && lineIgnores.has(v.line) && lineIgnores.get(v.line).has(v.rule)) {
        return false
      }
      return true
    })
    .map(v => ({ file: rel, ...v }))
}

// ─── Main ────────────────────────────────────────────────────────────────────

const sourceFiles = findSourceFiles(SRC)
const testFiles = findSourceFiles(SRC, { includeTests: true }).filter(f =>
  basename(f).includes('.test.'),
)

const allViolations = []

// Per-file checks on source files
const sourceContents = sourceFiles.map(f => readFileSync(f, 'utf-8'))
for (let i = 0; i < sourceFiles.length; i++) {
  allViolations.push(...auditFile(sourceFiles[i], sourceContents[i]))
}

// Test files - only check file-level JSDoc
for (const testFile of testFiles) {
  const content = readFileSync(testFile, 'utf-8')
  const rel = relative(SRC, testFile)
  const lines = content.split('\n')
  const fileIgnores = extractFileIgnores(lines)

  const jsdocViolations = checkFileLevelJSDoc(testFile, content, 'test')
  const blankLineViolations = checkJSDocBlankLine(testFile, content, 'test')

  allViolations.push(
    ...[...jsdocViolations, ...blankLineViolations]
      .filter(v => !fileIgnores.has(v.rule))
      .map(v => ({ file: rel, ...v })),
  )
}

// Cross-file checks (not suppressible per-line - use audit-ignore-file)
allViolations.push(...checkBuriedGenericUtils(sourceFiles, sourceContents))
allViolations.push(...checkCrossFeatureImports(sourceFiles, sourceContents))
allViolations.push(...checkImportSources(sourceFiles, sourceContents))

// CSS file walk (.css extension is outside findSourceFiles default).
const cssFiles = findByExt(SRC, /\.css$/)
const cssContents = cssFiles.map(f => readFileSync(f, 'utf-8'))
for (let i = 0; i < cssFiles.length; i++) {
  // Per-file CSS checks (kebab-case-css, no-tailwind for @tailwind directive)
  const lines = cssContents[i].split('\n')
  const fileIgnores = extractFileIgnores(lines)
  const cssViolations = [
    ...checkKebabCaseCss(cssFiles[i], cssContents[i], 'css'),
    ...checkNoTailwind(cssFiles[i], cssContents[i], 'css'),
  ]
  allViolations.push(
    ...cssViolations
      .filter(v => !fileIgnores.has(v.rule))
      .map(v => ({ file: relative(SRC, cssFiles[i]), ...v })),
  )
}

// Cross-file CSS-aware checks
allViolations.push(...checkNoCssModules(cssFiles))
allViolations.push(...checkNoStylesDirectory(cssFiles, sourceFiles))
allViolations.push(...checkCssWithoutComponentSibling(cssFiles, sourceFiles))
allViolations.push(...checkOrphanedTestFiles(testFiles, sourceFiles))

// Group by rule
const byRule = new Map()
for (const v of allViolations) {
  if (!byRule.has(v.rule)) {
    byRule.set(v.rule, [])
  }
  byRule.get(v.rule).push(v)
}

const ruleLabels = {
  'file-size': 'File Size',
  'misplaced-constant': 'Misplaced Constants',
  'multiple-components': 'Multiple Components Per File',
  'utility-export-from-component': 'Utility Exports From Components',
  'pure-module-helper': 'Pure Module Helpers Outside utils/',
  'excessive-props': 'Excessive Props (>10)',
  'buried-generic-util': 'Generic Utils Buried In Features',
  'missing-file-jsdoc': 'Missing File JSDoc',
  'missing-jsdoc-blank-line': 'Missing Blank Line After JSDoc',
  'missing-param-jsdoc': 'Missing @param JSDoc',
  'arrow-component': 'Arrow Function Components',
  'react-in-utils': 'React Imports In Utils',
  'css-import-in-component': 'CSS Import In Component',
  'cross-feature-import': 'Cross-Feature Imports',
  'import-source-violation': 'Import Source Violations',
  'panel-state-class-triplet': 'Panel State Class Triplet',
  'temporal-reference-in-comment': 'Temporal References In Comments',
  'no-css-modules': 'CSS Modules (banned)',
  'no-css-in-js': 'CSS-in-JS (banned)',
  'no-tailwind': 'Tailwind (banned)',
  'no-styles-directory': 'styles/ Directory (banned)',
  'loading-copy-ascii-dots': 'Loading Copy ASCII Dots',
  'hook-and-test': 'Hook AND-Test',
  'one-class-per-js-module': 'One Class Per .js Module',
  'orphaned-test-file': 'Orphaned Test File',
  'barrel-index-pattern': 'Barrel index.js Pattern',
  'css-without-component-sibling': 'CSS Without Component Sibling',
  'multi-line-file-jsdoc': 'Multi-Line File JSDoc',
  'handler-prop-naming': 'Handler Prop Naming (handle*/on*)',
  'url-literal-in-component': 'URL Literal In Component',
  'kebab-case-css': 'Kebab-Case CSS Class Names',
}

const ruleOrder = [
  'cross-feature-import',
  'import-source-violation',
  'file-size',
  'excessive-props',
  'misplaced-constant',
  'multiple-components',
  'utility-export-from-component',
  'pure-module-helper',
  'arrow-component',
  'react-in-utils',
  'css-import-in-component',
  'panel-state-class-triplet',
  'temporal-reference-in-comment',
  'no-css-modules',
  'no-css-in-js',
  'no-tailwind',
  'no-styles-directory',
  'loading-copy-ascii-dots',
  'hook-and-test',
  'one-class-per-js-module',
  'orphaned-test-file',
  'barrel-index-pattern',
  'css-without-component-sibling',
  'multi-line-file-jsdoc',
  'handler-prop-naming',
  'url-literal-in-component',
  'kebab-case-css',
  'buried-generic-util',
  'missing-file-jsdoc',
  'missing-jsdoc-blank-line',
  'missing-param-jsdoc',
]

let totalViolations = 0
const ruleSummary = []

for (const rule of ruleOrder) {
  const violations = byRule.get(rule) || []
  totalViolations += violations.length
  ruleSummary.push({ rule, label: ruleLabels[rule], count: violations.length })
}

// Output - summary first, details in verbose
console.log(`\n${'='.repeat(60)}`)
console.log('GUIDELINES AUDIT REPORT')
console.log('='.repeat(60))
console.log(`\nTotal violations:  ${totalViolations}`)
console.log(`Files scanned:     ${sourceFiles.length + testFiles.length}`)

console.log(`\n${'-'.repeat(60)}`)
console.log('BY RULE')
console.log('-'.repeat(60))

for (const { label, count } of ruleSummary) {
  const status = count === 0 ? '✓' : String(count)
  console.log(`  ${label.padEnd(38)} ${status.padStart(4)}`)
}

if (verbose) {
  const violated = ruleSummary.filter(r => r.count > 0)

  for (const { rule, label, count } of violated) {
    console.log(`\n${'-'.repeat(60)}`)
    console.log(`${label} (${count})`)
    console.log('-'.repeat(60))

    for (const v of byRule.get(rule)) {
      const loc = v.line ? `${v.file}:${v.line}` : v.file
      console.log(`  ${loc}`)
      console.log(`    ${v.message}`)
    }
  }
}

console.log('\n')
if (totalViolations > 0) {
  process.exit(1)
}
