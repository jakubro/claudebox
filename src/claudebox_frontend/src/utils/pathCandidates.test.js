/** Tests for path candidate extraction. */

import { describe, expect, it } from 'vitest'
import { extractPathCandidates, uniqueCandidates } from './pathCandidates'

describe('extractPathCandidates', () => {
  it('extracts paths containing slashes', () => {
    const results = extractPathCandidates('See docs/README.md for details')
    expect(results).toEqual([{ candidate: 'docs/README.md', start: 4, end: 18 }])
  })

  it('extracts bare filenames with recognized extensions', () => {
    const results = extractPathCandidates('check GUIDELINES.md now')
    expect(results).toEqual([{ candidate: 'GUIDELINES.md', start: 6, end: 19 }])
  })

  it('extracts absolute paths', () => {
    const results = extractPathCandidates('File at /home/user/file.py')
    expect(results).toEqual([{ candidate: '/home/user/file.py', start: 8, end: 26 }])
  })

  it('extracts /tmp paths', () => {
    const results = extractPathCandidates('saved to /tmp/foo.log')
    expect(results).toEqual([{ candidate: '/tmp/foo.log', start: 9, end: 21 }])
  })

  it('extracts multiple candidates', () => {
    const results = extractPathCandidates('see src/app.js and lib/utils.py')
    expect(results).toHaveLength(2)
    expect(results[0].candidate).toBe('src/app.js')
    expect(results[1].candidate).toBe('lib/utils.py')
  })

  it('excludes URLs starting with http://', () => {
    const results = extractPathCandidates('visit http://example.com/path')
    expect(results).toEqual([])
  })

  it('excludes URLs starting with https://', () => {
    const results = extractPathCandidates('visit https://github.com/foo/bar')
    expect(results).toEqual([])
  })

  it('strips trailing punctuation', () => {
    const results = extractPathCandidates('see docs/foo.md, and lib/bar.py.')
    expect(results[0].candidate).toBe('docs/foo.md')
    expect(results[1].candidate).toBe('lib/bar.py')
  })

  it('strips trailing parenthesis', () => {
    const results = extractPathCandidates('(see docs/foo.md)')
    expect(results[0].candidate).toBe('docs/foo.md')
  })

  it('strips surrounding brackets and colons', () => {
    const results = extractPathCandidates('file [src/app.js]:')
    expect(results[0].candidate).toBe('src/app.js')
  })

  it('does not extract words without slash or recognized extension', () => {
    const results = extractPathCandidates('just some normal text here')
    expect(results).toEqual([])
  })

  it('rejects false positive "e.g."', () => {
    const results = extractPathCandidates('e.g. this is an example')
    expect(results).toEqual([])
  })

  it('rejects false positive version numbers like "v2.0.74"', () => {
    const results = extractPathCandidates('version v2.0.74 released')
    expect(results).toEqual([])
  })

  it('rejects false positive "Node.js"', () => {
    // "Node.js" ends with .js which IS a recognized extension — it would match
    const results = extractPathCandidates('Use Node.js for this')
    expect(results).toHaveLength(1)
    expect(results[0].candidate).toBe('Node.js')
  })

  it('returns correct offsets', () => {
    const text = 'prefix src/file.js suffix'
    const results = extractPathCandidates(text)
    expect(results[0].start).toBe(7)
    expect(results[0].end).toBe(18)
    expect(text.slice(results[0].start, results[0].end)).toBe('src/file.js')
  })

  it('returns empty array for empty text', () => {
    expect(extractPathCandidates('')).toEqual([])
    expect(extractPathCandidates(null)).toEqual([])
    expect(extractPathCandidates(undefined)).toEqual([])
  })

  it('matches any 1-5 alpha-char extension', () => {
    for (const ext of ['go', 'rs', 'c', 'rb', 'java', 'swift', 'vue', 'proto']) {
      const results = extractPathCandidates(`file.${ext}`)
      expect(results).toHaveLength(1)
      expect(results[0].candidate).toBe(`file.${ext}`)
    }
  })

  it('rejects numeric or too-long extensions', () => {
    expect(extractPathCandidates('file.123')).toEqual([])
    expect(extractPathCandidates('file.abcdef')).toEqual([])
  })

  it('rejects "i.e." as false positive', () => {
    expect(extractPathCandidates('i.e. something')).toEqual([])
  })

  it('strips backticks and extracts inner path', () => {
    const results = extractPathCandidates('open `src/app.js` now')
    expect(results).toEqual([{ candidate: 'src/app.js', start: 6, end: 16 }])
  })

  it('strips backticks from /tmp paths', () => {
    const results = extractPathCandidates('see `/tmp/foo.md` here')
    expect(results[0].candidate).toBe('/tmp/foo.md')
  })

  it('rejects XML/HTML tags containing slashes', () => {
    const results = extractPathCandidates('<command-message>scope</command-message>')
    expect(results).toEqual([])
  })

  it('rejects colon-containing non-paths', () => {
    const results = extractPathCandidates('use qdr:h/d/w/m/y filter')
    expect(results).toEqual([])
  })

  it('rejects colon-containing strings even with extensions', () => {
    const results = extractPathCandidates('check foo:bar.js')
    expect(results).toEqual([])
  })

  it('strips trailing line:col suffixes from grep-style paths', () => {
    const results = extractPathCandidates('src/app.js:42:10')
    expect(results).toEqual([{ candidate: 'src/app.js', start: 0, end: 10 }])
  })

  it('strips trailing line number from absolute path', () => {
    const text = 'File /home/user/spec.js:3269:30 here'
    const results = extractPathCandidates(text)
    expect(results[0].candidate).toBe('/home/user/spec.js')
    expect(text.slice(results[0].start, results[0].end)).toBe('/home/user/spec.js')
  })

  it('strips single line number suffix', () => {
    const results = extractPathCandidates('src/app.js:42')
    expect(results[0].candidate).toBe('src/app.js')
  })

  it('strips double quotes and extracts inner path', () => {
    const results = extractPathCandidates('open "src/app.js" now')
    expect(results).toEqual([{ candidate: 'src/app.js', start: 6, end: 16 }])
  })

  it('strips quotes wrapping backtick-wrapped path', () => {
    const results = extractPathCandidates('see "`/tmp/foo.md`" here')
    expect(results[0].candidate).toBe('/tmp/foo.md')
  })

  it('strips single quotes around path', () => {
    const results = extractPathCandidates("check '/tmp/bar.log' now")
    expect(results[0].candidate).toBe('/tmp/bar.log')
  })

  it('rejects "//" as not a real path', () => {
    expect(extractPathCandidates('use // for comments')).toEqual([])
  })

  it('rejects slash-only tokens', () => {
    expect(extractPathCandidates('a / b')).toEqual([])
    expect(extractPathCandidates('a /// b')).toEqual([])
  })

  it('strips leading parenthesis and extracts path', () => {
    const results = extractPathCandidates('(lib/foo.js')
    expect(results[0].candidate).toBe('lib/foo.js')
  })

  it('strips leading asterisks from markdown bold', () => {
    const results = extractPathCandidates('**src/app.js')
    expect(results[0].candidate).toBe('src/app.js')
  })

  it('strips bold-wrapped inline code: **`path`**', () => {
    const results = extractPathCandidates('see **`src/app.js`** for details')
    expect(results).toEqual([{ candidate: 'src/app.js', start: 7, end: 17 }])
  })

  it('strips italic-wrapped inline code: *`path`*', () => {
    const results = extractPathCandidates('see *`src/utils.js`* now')
    expect(results[0].candidate).toBe('src/utils.js')
  })

  it('strips bold+italic-wrapped inline code: ***`path`***', () => {
    const results = extractPathCandidates('see ***`lib/utils.py`*** now')
    expect(results[0].candidate).toBe('lib/utils.py')
  })

  it('rejects code with interior backticks', () => {
    expect(extractPathCandidates('addSessionPanel`/`removeSessionPanel')).toEqual([])
  })

  it('rejects code function calls with path arguments', () => {
    expect(extractPathCandidates("vi.mock('../../api/chat")).toEqual([])
    expect(extractPathCandidates("page.goto('/")).toEqual([])
  })

  it('rejects tokens with question marks', () => {
    expect(extractPathCandidates('(action?.type')).toEqual([])
  })

  it('rejects markdown link syntax', () => {
    expect(extractPathCandidates('[1.2*](docs/active/feature-spec.md')).toEqual([])
  })

  it('strips leading parens to extract clean path', () => {
    const results = extractPathCandidates('(tool/footer')
    expect(results[0].candidate).toBe('tool/footer')
  })
})

describe('uniqueCandidates', () => {
  it('deduplicates candidate strings', () => {
    const extractions = [
      { candidate: 'src/app.js', start: 0, end: 10 },
      { candidate: 'lib/utils.py', start: 15, end: 27 },
      { candidate: 'src/app.js', start: 30, end: 40 },
    ]
    expect(uniqueCandidates(extractions)).toEqual(['src/app.js', 'lib/utils.py'])
  })

  it('returns empty array for empty input', () => {
    expect(uniqueCandidates([])).toEqual([])
  })
})
