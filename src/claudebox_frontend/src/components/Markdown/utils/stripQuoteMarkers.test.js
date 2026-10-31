/** Tests for stripQuoteMarkers. */

import { describe, expect, it } from 'vitest'
import { stripQuoteMarkers } from './stripQuoteMarkers'

describe('stripQuoteMarkers', () => {
  it.each([
    [
      'formatting kept',
      '> Use `npm test`:\n> - **fast** run\n> - full run',
      1,
      'Use `npm test`:\n- **fast** run\n- full run',
    ],
    ['blank quote line', '> a\n>\n> b', 1, 'a\n\nb'],
    ['outer of a nested quote', '> outer\n> > inner', 1, 'outer\n> inner'],
    ['inner of a nested quote', '> inner', 2, 'inner'],
    ['inner spanning lines', '> a\n> > b', 2, 'a\nb'],
    ['lazy continuation', '> first\nsecond', 1, 'first\nsecond'],
    ['inside a list item', '> quoted\n  > more', 1, 'quoted\nmore'],
    ['no space after the marker', '>tight\n>lines', 1, 'tight\nlines'],
    ['fence inside', '> ```js\n> const x = 1\n> ```', 1, '```js\nconst x = 1\n```'],
  ])('%s', (_, source, depth, expected) => {
    expect(stripQuoteMarkers(source, depth)).toBe(expected)
  })
})
