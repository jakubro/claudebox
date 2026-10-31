/** Tests for relative link and image URL resolution. */

import { describe, expect, it } from 'vitest'
import {
  fileFolder,
  imageEndpointQuery,
  pathBelow,
  resolveRelative,
  resolveTempImage,
  resolveWebUrl,
  webPageUrl,
} from './relativeUrl'

const BASE = '/home/u/proj'

describe('resolveRelative', () => {
  it.each([
    ['docs/guide.md', 'docs/guide.md'],
    ['./out/plot.png', 'out/plot.png'],
    ['./a/../b.md', 'b.md'],
    ['docs/guide.md#setup', 'docs/guide.md'],
    ['docs/guide.md?raw=1', 'docs/guide.md'],
    ['my%20notes.md', 'my notes.md'],
  ])('resolves %s inside the base', (url, relative) => {
    expect(resolveRelative(url, BASE)).toEqual({ absolute: `${BASE}/${relative}`, relative })
  })

  it.each([
    ['../outside.png'],
    ['../../etc/passwd'],
    ['a/../../x'],
    ['.'],
    ['https://example.com/a.png'],
    ['mailto:a@b.c'],
    ['//cdn.example.com/a.png'],
    ['/etc/hosts'],
    ['#setup'],
    [''],
    ['%E0%A4%A'],
  ])('rejects %s', url => {
    expect(resolveRelative(url, BASE)).toBeNull()
  })
})

describe('resolveTempImage', () => {
  it.each([
    ['/tmp/plot.png', '/tmp/plot.png'],
    ['/tmp/a/./b/../plot.png', '/tmp/a/plot.png'],
  ])('keeps %s', (url, path) => {
    expect(resolveTempImage(url)).toBe(path)
  })

  it.each([['/tmp/../etc/passwd'], ['/tmp'], ['/var/tmp/x.png'], ['tmp/x.png']])(
    'rejects %s',
    url => {
      expect(resolveTempImage(url)).toBeNull()
    },
  )
})

describe('pathBelow', () => {
  it('gives the path below a directory, or null outside it', () => {
    expect(pathBelow('/home/u/proj/docs/a.png', '/home/u/proj')).toBe('docs/a.png')
    expect(pathBelow('/home/u/other/a.png', '/home/u/proj')).toBeNull()
  })
})

describe('imageEndpointQuery', () => {
  const scope = { baseDir: BASE, workspaceDir: BASE, sessionId: 's1' }

  it.each([
    ['./out/plot.png', scope, 'path=out%2Fplot.png'],
    ['img/d.png', { ...scope, baseDir: `${BASE}/docs/guide` }, 'path=docs%2Fguide%2Fimg%2Fd.png'],
    ['/tmp/plot.png', scope, 'path=%2Ftmp%2Fplot.png&session=s1'],
    ['../outside.png', scope, null],
    ['/tmp/plot.png', { ...scope, sessionId: null }, undefined],
    ['https://example.com/a.png', scope, undefined],
    ['/home/u/a.png', scope, undefined],
    ['a.png', { ...scope, baseDir: null }, undefined],
    ['/tmp/plot.png', { ...scope, baseDir: null }, undefined],
  ])('maps %s', (src, s, expected) => {
    expect(imageEndpointQuery(src, s)).toBe(expected)
  })
})

describe('webPageUrl', () => {
  it('accepts an absolute http(s) address', () => {
    expect(webPageUrl('https://a.b/c')).toBe('https://a.b/c')
  })

  it.each(['ftp://x', 'javascript:x', 'docs/a', '', null])('rejects %s', url => {
    expect(webPageUrl(url)).toBeNull()
  })
})

describe('resolveWebUrl', () => {
  const page = 'https://e.com/p/README.md'

  it.each([
    ['docs/a.md', 'https://e.com/p/docs/a.md'],
    ['../b', 'https://e.com/b'],
    ['/about', 'https://e.com/about'],
    ['//cdn.e.com/x.png', 'https://cdn.e.com/x.png'],
    ['https://other/x', 'https://other/x'],
    ['mailto:a@b', null],
  ])('%s -> %s', (url, expected) => {
    expect(resolveWebUrl(url, page)).toBe(expected)
  })
})

describe('fileFolder', () => {
  it.each([
    ['/a/b.md', null, '/a'],
    ['/b.md', null, '/'],
    ['b.md', '/ws', '/ws'],
    ['d/b.md', '/ws', '/ws/d'],
    ['b.md', null, null],
    ['../../b.md', '/ws', null],
  ])('%s in %s -> %s', (filePath, workspaceDir, expected) => {
    expect(fileFolder(filePath, workspaceDir)).toBe(expected)
  })
})
