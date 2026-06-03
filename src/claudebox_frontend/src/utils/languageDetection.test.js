/** Tests for language detection utility. */

import { describe, expect, it } from 'vitest'
import {
  detectLanguage,
  detectLanguageFromContent,
  getLanguageFromPath,
  looksLikeMarkdown,
} from './languageDetection'

describe('getLanguageFromPath', () => {
  it('returns language for known extensions', () => {
    expect(getLanguageFromPath('/path/to/file.js')).toBe('javascript')
    expect(getLanguageFromPath('/path/to/file.py')).toBe('python')
    expect(getLanguageFromPath('/path/to/file.ts')).toBe('typescript')
    expect(getLanguageFromPath('/path/to/file.json')).toBe('json')
    expect(getLanguageFromPath('/path/to/file.md')).toBe('markdown')
  })

  it('handles special filenames', () => {
    expect(getLanguageFromPath('/path/to/Dockerfile')).toBe('bash')
    expect(getLanguageFromPath('/path/to/Makefile')).toBe('bash')
    expect(getLanguageFromPath('/path/to/GNUmakefile')).toBe('bash')
  })

  it('returns null for unknown extensions', () => {
    expect(getLanguageFromPath('/path/to/file.xyz')).toBe(null)
    expect(getLanguageFromPath('/path/to/file.unknown')).toBe(null)
  })

  it('returns null for no extension', () => {
    expect(getLanguageFromPath('/path/to/noextension')).toBe(null)
  })

  it('returns null for null/undefined', () => {
    expect(getLanguageFromPath(null)).toBe(null)
    expect(getLanguageFromPath(undefined)).toBe(null)
  })

  it('is case-insensitive', () => {
    expect(getLanguageFromPath('/path/to/file.JS')).toBe('javascript')
    expect(getLanguageFromPath('/path/to/file.PY')).toBe('python')
  })
})

describe('detectLanguageFromContent', () => {
  it('detects JSON (high confidence)', () => {
    const json = `{
  "name": "test",
  "version": "1.0.0",
  "dependencies": {
    "react": "^18.0.0"
  }
}`
    expect(detectLanguageFromContent(json)).toBe('json')
  })

  it('returns a language for code-like content', () => {
    // hljs auto-detection isn't always accurate, but should return something for code
    const code = `
function helloWorld() {
  console.log("Hello, World!");
  const numbers = [1, 2, 3, 4, 5];
  numbers.forEach(n => console.log(n));
}
`
    const detected = detectLanguageFromContent(code)
    // Should detect some language (exact match varies by hljs version)
    expect(detected).not.toBe(null)
  })

  it('returns null for short content', () => {
    expect(detectLanguageFromContent('hi')).toBe(null)
    expect(detectLanguageFromContent('')).toBe(null)
  })

  it('returns null for plain text', () => {
    expect(detectLanguageFromContent('This is just some plain text content.')).toBe(null)
  })
})

describe('looksLikeMarkdown', () => {
  it('detects headers and lists', () => {
    const md = `# Header

This is some text.

- Item 1
- Item 2
`
    expect(looksLikeMarkdown(md)).toBe(true)
  })

  it('detects bold and links', () => {
    const md = `This has **bold text** and a [link](https://example.com).`
    expect(looksLikeMarkdown(md)).toBe(true)
  })

  it('detects code blocks', () => {
    const md = `# Code Example

\`\`\`python
print("hello")
\`\`\`
`
    expect(looksLikeMarkdown(md)).toBe(true)
  })

  it('returns false for plain text', () => {
    expect(looksLikeMarkdown('Just some plain text.')).toBe(false)
  })

  it('returns false for single markdown indicator', () => {
    expect(looksLikeMarkdown('# Just a header')).toBe(false)
  })

  it('returns false for empty/null', () => {
    expect(looksLikeMarkdown('')).toBe(false)
    expect(looksLikeMarkdown(null)).toBe(false)
  })
})

describe('detectLanguage', () => {
  it('prioritizes file extension over content', () => {
    // Python code in a .js file should return javascript
    const pythonCode = 'def hello(): print("hi")'
    expect(detectLanguage(pythonCode, '/file.js')).toBe('javascript')
  })

  it('falls back to content detection when no filePath', () => {
    const json =
      '{\n  "name": "my-app",\n  "version": "1.0.0",\n  "dependencies": {\n    "react": "^19.0.0",\n    "lodash": "^4.17.21"\n  },\n  "scripts": {\n    "build": "vite build",\n    "test": "vitest run"\n  }\n}'
    expect(detectLanguage(json)).toBe('json')
  })

  it('falls back to content when extension unknown', () => {
    const json =
      '{\n  "users": [\n    {"id": 1, "name": "Alice", "active": true},\n    {"id": 2, "name": "Bob", "active": false}\n  ],\n  "total": 2,\n  "page": 1\n}'
    expect(detectLanguage(json, '/file.xyz')).toBe('json')
  })

  it('uses markdown heuristics when checkMarkdown=true', () => {
    const md = `# Title

Some **bold** text and a [link](url).
`
    // Without checkMarkdown, hljs may not detect markdown with high confidence
    // With checkMarkdown (heuristics), our detection kicks in
    expect(detectLanguage(md, null, true)).toBe('markdown')
  })

  it('returns null for undetectable content', () => {
    expect(detectLanguage('random text')).toBe(null)
  })
})
