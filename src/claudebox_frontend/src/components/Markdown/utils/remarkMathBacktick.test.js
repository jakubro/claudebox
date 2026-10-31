/** Tests for remarkMathBacktick. */

import { remark } from 'remark'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { describe, expect, it } from 'vitest'
import remarkMathBacktick from './remarkMathBacktick'

const processor = remark().use(remarkGfm).use(remarkMath).use(remarkMathBacktick)

/** The paragraph's children as [kind, value] pairs, math marked 'M'. */
function inline(source) {
  const tree = processor.runSync(processor.parse(source))
  return tree.children[0].children.map(n => [n.type === 'inlineMath' ? 'M' : n.type, n.value])
}

describe('remarkMathBacktick', () => {
  it.each([
    [
      'A $`\\sqrt{2}`$ b',
      [
        ['text', 'A '],
        ['M', '\\sqrt{2}'],
        ['text', ' b'],
      ],
    ],
    [
      'C $`a + \\$5`$ end',
      [
        ['text', 'C '],
        ['M', 'a + \\$5'],
        ['text', ' end'],
      ],
    ],
    [
      '$`x`$ and $`y`$',
      [
        ['M', 'x'],
        ['text', ' and '],
        ['M', 'y'],
      ],
    ],
    ['$``a`b``$', [['M', 'a`b']]],
    ['$` x `$', [['M', 'x']]],
    ['$x^2$', [['M', 'x^2']]],
    ['`$x$`', [['inlineCode', '$x$']]],
    ['$`x end', [['text', '$`x end']]],
    ['$`a``$', [['M', '`a``']]],
  ])('parses %s', (source, expected) => {
    expect(inline(source)).toEqual(expected)
  })

  it('emits the node remark-math emits, so the formula typesets the same way', () => {
    const [node] = processor.runSync(processor.parse('$`x`$')).children[0].children

    expect(node.data).toEqual({
      hName: 'code',
      hProperties: { className: ['language-math', 'math-inline'] },
      hChildren: [{ type: 'text', value: 'x' }],
    })
  })
})
