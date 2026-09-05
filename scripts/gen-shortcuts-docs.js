#!/usr/bin/env node
/** Render the keyboard binding registry into docs/reference/shortcuts.md via `just docs`. */

import { writeFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const LIB_ROOT = fileURLToPath(new URL('..', import.meta.url))
const DOCS_PATH = path.join(LIB_ROOT, 'docs', 'reference', 'shortcuts.md')
const REGISTRY = path.join(LIB_ROOT, 'src', 'claudebox_frontend', 'src', 'config', 'shortcuts.js')

const HEADER = `# Keyboard shortcuts

Every binding the app registers, generated from the same list the in-app Help panel draws. This
file is generated - run \`just docs\` to bring it back in step after changing a binding.

![The keyboard help overlay, listing the same bindings in columns](images/shortcuts-help-overlay.png)

\`Alt+?\` opens that overlay over whatever you are looking at; Escape closes it.
`

// Vite resolves extensionless relative imports and Node does not; the frontend is written for the
// former, so teach the loader that one rule rather than making the app's imports unidiomatic.
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('.') && !path.extname(specifier)) {
      return next(`${specifier}.js`, context)
    }

    return next(specifier, context)
  },
})

const { SHORTCUT_SECTIONS } = await import(REGISTRY)

/** Wrap a binding as a code span, widening the fence when the binding itself holds a backtick. */
function codeSpan(keys) {
  return keys.includes('`') ? `\`\` ${keys} \`\`` : `\`${keys}\``
}

/** Escape what a table cell cannot carry literally: the column separator and tag brackets. */
function cell(text) {
  return text.replaceAll('|', '\\|').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

/** Render one section as a heading and a two-column table. */
function section({ title, bindings }) {
  const rows = bindings.map(b => `| ${codeSpan(b.keys)} | ${cell(b.action)} |`)

  return [`## ${title}`, '', '| Shortcut | Action |', '|---|---|', ...rows].join('\n')
}

/** Return the full text of the generated shortcuts reference. */
function buildDocument() {
  return `${HEADER}\n${SHORTCUT_SECTIONS.map(section).join('\n\n')}\n`
}

const document = buildDocument()

if (process.argv.includes('--stdout')) {
  process.stdout.write(document)
} else {
  writeFileSync(DOCS_PATH, document)
}
