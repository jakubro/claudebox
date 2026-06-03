/** Language detection for code content. */

import hljs from 'highlight.js/lib/core'

// Register common languages for highlightAuto
import bash from 'highlight.js/lib/languages/bash'
import css from 'highlight.js/lib/languages/css'
import go from 'highlight.js/lib/languages/go'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import markdown from 'highlight.js/lib/languages/markdown'
import python from 'highlight.js/lib/languages/python'
import rust from 'highlight.js/lib/languages/rust'
import sql from 'highlight.js/lib/languages/sql'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'

hljs.registerLanguage('bash', bash)
hljs.registerLanguage('css', css)
hljs.registerLanguage('go', go)
hljs.registerLanguage('java', java)
hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('json', json)
hljs.registerLanguage('markdown', markdown)
hljs.registerLanguage('python', python)
hljs.registerLanguage('rust', rust)
hljs.registerLanguage('sql', sql)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('yaml', yaml)

/**
 * Map file extension to syntax highlighter language.
 */
export const extensionToLanguage = {
  // JavaScript/TypeScript
  js: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  mjs: 'javascript',
  cjs: 'javascript',
  // Python
  py: 'python',
  pyi: 'python',
  pyx: 'python',
  // Web
  html: 'xml',
  htm: 'xml',
  css: 'css',
  scss: 'css',
  sass: 'css',
  less: 'css',
  // Data
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'plaintext',
  xml: 'xml',
  csv: 'plaintext',
  // Shell
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  fish: 'bash',
  // Config
  env: 'bash',
  ini: 'plaintext',
  conf: 'plaintext',
  cfg: 'plaintext',
  // Documentation
  md: 'markdown',
  mdx: 'markdown',
  rst: 'plaintext',
  txt: 'plaintext',
  // Systems
  rs: 'rust',
  go: 'go',
  c: 'plaintext',
  h: 'plaintext',
  cpp: 'plaintext',
  hpp: 'plaintext',
  java: 'java',
  kt: 'plaintext',
  swift: 'plaintext',
  rb: 'plaintext',
  php: 'plaintext',
  lua: 'plaintext',
  r: 'plaintext',
  sql: 'sql',
  // Docker/DevOps
  dockerfile: 'bash',
  makefile: 'bash',
  // Other
  graphql: 'plaintext',
  gql: 'plaintext',
  vue: 'xml',
  svelte: 'xml',
}

/** Detect language from file path extension or special filename. */
export function getLanguageFromPath(filePath) {
  if (!filePath) {
    return null
  }

  // Handle special filenames (Dockerfile, Makefile, etc.)
  const filename = filePath.split('/').pop().toLowerCase()
  if (filename === 'dockerfile') {
    return 'bash'
  }
  if (filename === 'makefile' || filename === 'gnumakefile') {
    return 'bash'
  }

  // Extract extension
  const extMatch = filePath.match(/\.([^.]+)$/)
  if (!extMatch) {
    return null
  }

  const ext = extMatch[1].toLowerCase()
  return extensionToLanguage[ext] || null
}

// Minimum relevance score for highlightAuto to be trusted
const MIN_RELEVANCE = 5 // audit-ignore: misplaced-constant

/**
 * Detect language from content using highlight.js.
 */
export function detectLanguageFromContent(content) {
  if (!content || content.length < 10) {
    return null
  }

  try {
    const result = hljs.highlightAuto(content)
    if (result.relevance >= MIN_RELEVANCE && result.language) {
      return result.language
    }
  } catch (e) {
    console.warn('languageDetection: highlight.js error', e)
  }

  return null
}

/** Check if content has markdown-like patterns. */
export function looksLikeMarkdown(content) {
  if (!content) {
    return false
  }

  const patterns = [
    /^#{1,6}\s+\S/m, // Headers: # Header
    /\*\*[^*]+\*\*/, // Bold: **text**
    /\[[^\]]+\]\([^)]+\)/, // Links: [text](url)
    /^[-*]\s+\S/m, // Unordered list: - item
    /^\d+\.\s+\S/m, // Ordered list: 1. item
    /^>\s+\S/m, // Blockquote: > quote
    /```[\s\S]*?```/, // Code blocks
  ]

  // Count matching patterns
  const matches = patterns.filter(p => p.test(content)).length

  // Require at least 2 different markdown indicators
  return matches >= 2
}

/**
 * Detect language for content with optional file path hint.
 *
 * @param {string} content - Source code or text to analyze.
 * @param {string} [filePath] - File path for extension-based detection.
 * @param {boolean} [checkMarkdown=false] - Check for markdown patterns.
 * @returns {string|null} Detected language or null for plaintext.
 */
export function detectLanguage(content, filePath = null, checkMarkdown = false) {
  // 1. Try extension-based detection first (most reliable)
  if (filePath) {
    const langFromPath = getLanguageFromPath(filePath)
    if (langFromPath && langFromPath !== 'plaintext') {
      return langFromPath
    }
  }

  // 2. Try content-based detection
  const langFromContent = detectLanguageFromContent(content)
  if (langFromContent) {
    return langFromContent
  }

  // 3. Check markdown heuristics if requested
  if (checkMarkdown && looksLikeMarkdown(content)) {
    return 'markdown'
  }

  // 4. Fallback
  return null
}
