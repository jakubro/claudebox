/** Tests for InlineDiff component. */

import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import InlineDiff from './InlineDiff'

describe('InlineDiff', () => {
  const oldLine = 'the quick fox'
  const newLine = 'the slow fox'

  describe('remove side', () => {
    it('marks the removed word and skips the added one', () => {
      const { container } = render(<InlineDiff oldLine={oldLine} newLine={newLine} type="remove" />)

      const removed = container.querySelector('.diff-inline-removed')
      expect(removed).toHaveTextContent('quick')
      expect(container.querySelector('.diff-inline-added')).toBeNull()
      expect(container.textContent).toBe('the quick fox')
    })
  })

  describe('add side', () => {
    it('marks the added word and skips the removed one', () => {
      const { container } = render(<InlineDiff oldLine={oldLine} newLine={newLine} type="add" />)

      const added = container.querySelector('.diff-inline-added')
      expect(added).toHaveTextContent('slow')
      expect(container.querySelector('.diff-inline-removed')).toBeNull()
      expect(container.textContent).toBe('the slow fox')
    })
  })

  describe('identical lines', () => {
    it('renders unchanged text with no highlight spans', () => {
      const { container } = render(<InlineDiff oldLine="same" newLine="same" type="remove" />)

      expect(container.textContent).toBe('same')
      expect(container.querySelector('.diff-inline-removed')).toBeNull()
      expect(container.querySelector('.diff-inline-added')).toBeNull()
    })
  })
})
