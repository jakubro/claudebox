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

// --- File Discovery ---

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

/** Classify a file by its source-tree location; hooks/ and utils/ match at any nesting depth. */
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
  if (segments[0] === 'config') {
    return 'config'
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

  // Cross-feature components - .jsx are components, .js are modules (schemas, config)
  if (segments[0] === 'components') {
    return filePath.endsWith('.jsx') ? 'component' : 'module'
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
 * Extract inline audit-ignore directives (`// audit-ignore: rule1, rule2`, placed above or on
 * the violation line) into a Map of line number -> Set of suppressed rule names.
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
 * Extract the file-level audit-ignore directive (`// audit-ignore-file: rule1, rule2`)
 * from the first 10 lines.
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

// --- Checks ---

/** Check non-blank line count against the type's threshold constant; blank lines never count against it. */
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

/** Flag behavioral/config ALL_CAPS constants outside constants/; config, barrel, and other types are exempt. */
function checkMisplacedConstants(_filePath, lines, type) {
  const violations = []
  if (type === 'config' || type === 'barrel' || type === 'other') {
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

/** Flag a .jsx file exporting multiple components; non-exported helpers under 30 body lines are tolerated. */
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

/** Flag non-default function/const exports from .jsx files - utilities belong in utils/, not component files. */
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
  /\b(?:useState|useEffect|useCallback|useRef|useMemo|useReducer|useContext|useLayoutEffect|useImperativeHandle|forwardRef|memo|Children|cloneElement|isValidElement|createElement)\b|<[A-Za-z]/

/**
 * Flag non-exported module-level helpers with zero React-API references (GUIDELINES section 6,
 * "Always extract pure functions"). Companion to `utility-export-from-component`, which covers
 * exported helpers. Closure-bound helpers, React-coupled renderers, and constants are excluded.
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

/** Check for a blank line after file-level JSDoc (GUIDELINES section 9 requires one before imports). */
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

/** Flag component JSDoc missing @param when the component takes a destructured props object. */
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

    const hasProps = /\(\s*\{/.test(lines[i])
    if (!hasProps) {
      continue
    }

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

/** Flag arrow-function component exports in .jsx - GUIDELINES require function declarations. */
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
 * Flag React concerns in utils/ files (GUIDELINES: "if it needs React, it's a hook") -
 * catches both explicit React imports and .jsx extension.
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
 * Check `*Panel.jsx` files for the canonical `.{panel}-{loading|empty|error}` class triplet
 * (GUIDELINES section 6): only rendered states need a class, but where one exists its prefix
 * must match the panel's own root class (kebab-case slug from the basename minus `Panel.jsx`).
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

  // Slug: PascalCase basename minus "Panel.jsx" -> kebab-case, e.g. SessionsPanel.jsx -> sessions.
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
 * Flag direct CSS imports in .jsx components - CSS must flow through index.css -> main.css.
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
 * Flag temporal references in comments (GUIDELINES preamble: describe current state, not
 * history - no "was:", "moved from", "previously", "renamed from"). Tracks block-comment
 * state across lines so only comment text is inspected.
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

/** Flag CSS-in-JS library imports (GUIDELINES section 6 Styling bans CSS-in-JS, CSS modules, Tailwind). */
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

/** Flag Tailwind imports / directives (GUIDELINES section 6 Styling bans Tailwind). */
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

/** Flag "Loading" copy using the Unicode ellipsis instead of three ASCII dots (GUIDELINES section 6). */
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
 * Flag `use*` hook names containing a PascalCase `And` segment (GUIDELINES section 6 Hook Scope:
 * "if the name needs 'and' to describe it, split it").
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

/** Flag >1 class per coordination-module .js file (GUIDELINES section 6: one class per file). */
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
 * Check that a feature barrel index.js reduces to a single `export { default } from './XPanel'`
 * (with optional file-level JSDoc and trailing semicolon/whitespace) per GUIDELINES section 6.
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

/** Check that the file-level JSDoc spans a single line (GUIDELINES section 10 JS Conventions). */
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
 * Flag destructured props starting with `handle*` in `function Comp({ ... })` signatures -
 * GUIDELINES section 6 reserves `handle*` for internal handlers, `on*` for callback props.
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
 * Flag non-comment `https?://` literals in component .jsx files (GUIDELINES section 6 Constants:
 * URLs belong in config/, not components). Excludes the SVG `xmlns` namespace attribute.
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

/** Flag .css class selectors containing uppercase letters (GUIDELINES section 6: kebab-case only). */
function checkKebabCaseCss(filePath, content, _type) {
  const violations = []
  if (!filePath.endsWith('.css')) {
    return violations
  }

  // Strip block comments to avoid matching within them.
  const stripped = content.replace(/\/\*[\s\S]*?\*\//g, '')
  const lines = stripped.split('\n')

  // Match `.someName` only in selector context, not inside `.5em` or `var(--foo)` literals.
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

// --- Cross-File Checks ---

/** Detect any `.module.css` file under src/ (GUIDELINES section 6 Styling bans CSS modules). */
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

/** Detect any `styles/` directory under src/ - CSS must co-locate with its component (section 6). */
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

/** Detect `*.test.{js,jsx}` files with no co-located source sibling (GUIDELINES section 7 Testing). */
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
 * Detect PascalCase CSS files with no sibling `.jsx` of the same basename (GUIDELINES section 6:
 * CSS co-locates with its component). Exempt: `index.css`, `main.css`, and non-feature dirs.
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
      continue // already flagged by the CSS Modules check
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
 * Flag a feature util with no imports from its own feature tree - such generic utils belong
 * in utils/ where they're discoverable and reusable.
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

  // A candidate only qualifies if some file outside its own feature also imports it.
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
 * Flag a feature importing another feature's internals; features may only import their own
 * internals, shared/, context/, constants/, api/. Exception: features/app/, the layout shell.
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
 * Flag a non-app feature importing outside its own internals, components/, hooks/, utils/,
 * config/, context/, or api/ - e.g. managers/, which only the app feature may import.
 */
function checkImportSources(allFiles, allContents) {
  const violations = []
  const allowedRoots = new Set(['components', 'hooks', 'utils', 'config', 'context', 'api'])

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

// --- Runner ---

// Audit-ignore directives for every scanned file, keyed by SRC-relative path.
const ignoreIndex = new Map()

/** Record one file's inline and file-level audit-ignore directives. */
function indexIgnores(filePath, content) {
  const lines = content.split('\n')

  ignoreIndex.set(relative(SRC, filePath), {
    fileRules: extractFileIgnores(lines),
    lineRules: extractIgnores(lines),
  })
}

// Violations silenced by audit-ignore directives, retained so the report can count them.
const suppressedViolations = []

/**
 * Return the violations that survive their file's audit-ignore directives; every suppression
 * path (per-file, CSS, test, cross-file) runs through here so nothing vanishes silently.
 */
function applyIgnores(violations) {
  const kept = []

  for (const v of violations) {
    if (isSuppressed(v)) {
      suppressedViolations.push(v)
    } else {
      kept.push(v)
    }
  }

  return kept
}

/** Report whether a violation is silenced by its own file's audit-ignore directives. */
function isSuppressed(v) {
  const entry = ignoreIndex.get(v.file)

  if (!entry) {
    return false
  }
  if (entry.fileRules.has(v.rule)) {
    return true
  }

  return Boolean(v.line && entry.lineRules.get(v.line)?.has(v.rule))
}

/** Run all per-file checks and return violations, applying inline ignores. */
function auditFile(filePath, content) {
  const lines = content.split('\n')
  const type = classify(filePath)
  const rel = relative(SRC, filePath)

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

  return applyIgnores(violations.map(v => ({ file: rel, ...v })))
}

// --- Main ---

const sourceFiles = findSourceFiles(SRC)
const testFiles = findSourceFiles(SRC, { includeTests: true }).filter(f =>
  basename(f).includes('.test.'),
)

const allViolations = []

// Per-file checks on source files
const sourceContents = sourceFiles.map(f => readFileSync(f, 'utf-8'))
for (let i = 0; i < sourceFiles.length; i++) {
  indexIgnores(sourceFiles[i], sourceContents[i])
  allViolations.push(...auditFile(sourceFiles[i], sourceContents[i]))
}

// Test files - only check file-level JSDoc
for (const testFile of testFiles) {
  const content = readFileSync(testFile, 'utf-8')
  const rel = relative(SRC, testFile)
  indexIgnores(testFile, content)

  const jsdocViolations = checkFileLevelJSDoc(testFile, content, 'test')
  const blankLineViolations = checkJSDocBlankLine(testFile, content, 'test')

  allViolations.push(
    ...applyIgnores([...jsdocViolations, ...blankLineViolations].map(v => ({ file: rel, ...v }))),
  )
}

// CSS file walk (.css extension is outside findSourceFiles default).
const cssFiles = findByExt(SRC, /\.css$/)
const cssContents = cssFiles.map(f => readFileSync(f, 'utf-8'))
for (let i = 0; i < cssFiles.length; i++) {
  // Per-file CSS checks (kebab-case-css, no-tailwind for @tailwind directive)
  indexIgnores(cssFiles[i], cssContents[i])
  const cssViolations = [
    ...checkKebabCaseCss(cssFiles[i], cssContents[i], 'css'),
    ...checkNoTailwind(cssFiles[i], cssContents[i], 'css'),
  ]
  allViolations.push(
    ...applyIgnores(cssViolations.map(v => ({ file: relative(SRC, cssFiles[i]), ...v }))),
  )
}

// Cross-file checks run last, after every file's audit-ignore comments are already registered.
allViolations.push(
  ...applyIgnores([
    ...checkBuriedGenericUtils(sourceFiles, sourceContents),
    ...checkCrossFeatureImports(sourceFiles, sourceContents),
    ...checkImportSources(sourceFiles, sourceContents),
    ...checkNoCssModules(cssFiles),
    ...checkNoStylesDirectory(cssFiles, sourceFiles),
    ...checkCssWithoutComponentSibling(cssFiles, sourceFiles),
    ...checkOrphanedTestFiles(testFiles, sourceFiles),
  ]),
)

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

const ignoredByRule = new Map()
for (const v of suppressedViolations) {
  ignoredByRule.set(v.rule, (ignoredByRule.get(v.rule) ?? 0) + 1)
}
const ignoredFiles = new Set(suppressedViolations.map(v => v.file))

for (const rule of ruleOrder) {
  const violations = byRule.get(rule) || []
  totalViolations += violations.length
  ruleSummary.push({
    rule,
    label: ruleLabels[rule],
    count: violations.length,
    ignored: ignoredByRule.get(rule) ?? 0,
  })
}

// Output - summary first, details in verbose
console.log(`\n${'='.repeat(60)}`)
console.log('GUIDELINES AUDIT REPORT')
console.log('='.repeat(60))
console.log(`\nTotal violations:  ${totalViolations}`)
console.log(
  `Ignored:           ${suppressedViolations.length} in ${ignoredFiles.size} ${ignoredFiles.size === 1 ? 'file' : 'files'}`,
)
console.log(`Files scanned:     ${sourceFiles.length + testFiles.length}`)

console.log(`\n${'-'.repeat(60)}`)
console.log('BY RULE')
console.log('-'.repeat(60))

for (const { label, count, ignored } of ruleSummary) {
  const status = count === 0 ? '✓' : String(count)
  const note = ignored ? `  (${ignored} ignored)` : ''
  console.log(`  ${label.padEnd(38)} ${status.padStart(4)}${note}`)
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
