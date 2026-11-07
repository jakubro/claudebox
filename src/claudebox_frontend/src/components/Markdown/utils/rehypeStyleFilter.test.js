/** Tests for the inline style filter. */

import { describe, expect, it } from 'vitest'
import rehypeStyleFilter, { filterStyle } from './rehypeStyleFilter'

describe('filterStyle', () => {
  it.each([
    ['color: red', 'color: red'],
    ['color: #0969DA', 'color: #0969da'],
    ['color: #abc', 'color: #abc'],
    ['color: #abcd', 'color: #abcd'],
    ['color: #0969da80', 'color: #0969da80'],
    ['color: rgb(9, 105, 218)', 'color: rgb(9, 105, 218)'],
    ['color: rgb(9 105 218 / 50%)', 'color: rgb(9 105 218 / 50%)'],
    ['color: hsla(212, 92%, 45%, 0.5)', 'color: hsla(212, 92%, 45%, 0.5)'],
    ['font-weight: bold', 'font-weight: bold'],
    ['font-weight: 700', 'font-weight: 700'],
    ['text-align: center', 'text-align: center'],
    ['width: 50%', 'width: 50%'],
    ['width: 120px', 'width: 120px'],
    ['width: 2.5em', 'width: 2.5em'],
  ])('keeps %s', (input, expected) => {
    expect(filterStyle(input)).toBe(expected)
  })

  it('lower-cases and re-joins several declarations', () => {
    expect(filterStyle('COLOR: Red; Width: 30%')).toBe('color: red; width: 30%')
  })

  it.each([
    'position: fixed',
    'inset: 0',
    'z-index: 9999',
    'background: red',
    'background-image: url(x)',
    'margin: 40px',
    'padding: 40px',
    'display: flex',
    'font-size: 40px',
    'height: 10px',
    'transform: scale(9)',
    'opacity: 0',
    'cursor: pointer',
    'pointer-events: none',
  ])('drops %s', input => {
    expect(filterStyle(input)).toBeNull()
  })

  it.each([
    'color: var(--accent)',
    'color: url(x)',
    'color: red !important',
    'color: expression(x)',
    'color: r\\65d',
    'color: red /* x */',
    'color: rgb(9, 105)',
    'color: rgb(9, 105, 218',
    'width: calc(100% + 9px)',
    'width: 100vw',
    'width: 150%',
    'width: 99999px',
    'font-weight: bolder',
    'font-weight: 750',
    'text-align: -webkit-center',
  ])('drops the declaration %s of an allowed property', input => {
    expect(filterStyle(input)).toBeNull()
  })

  it('keeps only the allowed declarations of a mixed style', () => {
    expect(filterStyle('text-align: center; position: fixed')).toBe('text-align: center')
  })

  it('treats a semicolon inside a quoted string as a separator that fails closed', () => {
    expect(filterStyle('color: red; font-family: "a;color:blue"')).toBe('color: red')
  })

  it.each(['', ';;', 'color', ': red'])('returns null for %j', input => {
    expect(filterStyle(input)).toBeNull()
  })
})

describe('rehypeStyleFilter', () => {
  function element(tagName, style, children = []) {
    return { type: 'element', tagName, properties: style === undefined ? {} : { style }, children }
  }

  it('filters, empties and removes styles on nested elements', () => {
    const kept = element('span', 'color: red; position: fixed')
    const emptied = element('div', 'position: fixed')
    const nonString = element('b', 42)
    const plain = element('i')
    const tree = {
      type: 'root',
      children: [
        element('p', undefined, [kept, element('em', undefined, [emptied, nonString, plain])]),
      ],
    }

    rehypeStyleFilter()(tree)

    expect(kept.properties.style).toBe('color: red')
    expect('style' in emptied.properties).toBe(false)
    expect('style' in nonString.properties).toBe(false)
    expect(plain.properties).toEqual({})
  })
})
