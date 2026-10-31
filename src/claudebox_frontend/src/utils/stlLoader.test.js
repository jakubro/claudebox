/** Tests for STL block parsing. */

import { describe, expect, it } from 'vitest'
import { parseStl } from './stlLoader'

const TRIANGLE = [
  'solid t',
  '  facet normal 0 0 1',
  '    outer loop',
  '      vertex 0 0 0',
  '      vertex 1 0 0',
  '      vertex 0 1 0',
  '    endloop',
  '  endfacet',
  'endsolid t',
].join('\n')

describe('parseStl', () => {
  it('reads the facets of an ASCII model', async () => {
    const geometry = await parseStl(TRIANGLE)

    expect(geometry.getAttribute('position').count).toBe(3)
  })

  it.each([
    ['text that is not STL', 'not an ASCII STL model'],
    ['solid broken endsolid', 'the model has no facets'],
    [`solid empty\n${' '.repeat(100)}\nendsolid empty`, 'the model has no facets'],
  ])('rejects %j', async (source, reason) => {
    await expect(parseStl(source)).rejects.toThrow(reason)
  })
})
