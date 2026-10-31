/** Tests for updateStoredList. */

import { afterEach, describe, expect, it } from 'vitest'
import { updateStoredList } from './storedList'

describe('updateStoredList', () => {
  afterEach(() => localStorage.clear())

  it('starts from an empty list when the key is absent', () => {
    updateStoredList('k', prev => [...prev, 'a'])

    expect(localStorage.getItem('k')).toBe('["a"]')
  })

  it('removes the key when the result is empty', () => {
    localStorage.setItem('k', '["a"]')

    updateStoredList('k', prev => prev.filter(x => x !== 'a'))

    expect(localStorage.getItem('k')).toBe(null)
  })

  it('leaves unparseable storage as it was', () => {
    localStorage.setItem('k', '{broken')

    updateStoredList('k', prev => [...prev, 'a'])

    expect(localStorage.getItem('k')).toBe('{broken')
  })
})
