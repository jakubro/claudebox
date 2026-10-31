/** Tests for colorValue. */

import { describe, expect, it } from 'vitest'
import { colorValue } from './colorValue'

describe('colorValue', () => {
  it.each([
    ['#0969DA', '#0969DA'],
    ['#0969da', '#0969da'],
    ['rgb(9, 105, 218)', 'rgb(9, 105, 218)'],
    ['rgb(9,105,218)', 'rgb(9, 105, 218)'],
    ['rgb(255, 0, 0)', 'rgb(255, 0, 0)'],
    ['hsl(212, 92%, 45%)', 'hsl(212, 92%, 45%)'],
    ['hsl(360, 100%, 0%)', 'hsl(360, 100%, 0%)'],
  ])('reads %s', (text, color) => {
    expect(colorValue(text)).toBe(color)
  })

  it.each([
    ['#fff'],
    ['#0969DA80'],
    ['rgba(9, 105, 218, 0.5)'],
    ['red'],
    ['color: #0969DA'],
    ['#0969DAX'],
    ['rgb(300, 0, 0)'],
    ['hsl(400, 50%, 50%)'],
    ['hsl(200, 101%, 50%)'],
    ['rgb(1, 2, 3); background: url(x)'],
  ])('ignores %s', text => {
    expect(colorValue(text)).toBeNull()
  })
})
