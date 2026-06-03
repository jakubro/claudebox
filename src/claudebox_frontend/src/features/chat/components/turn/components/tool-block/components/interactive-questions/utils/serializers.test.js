/** Tests for formatQuestionXml serialization. */

import { describe, expect, it } from 'vitest'
import { formatQuestionXml } from './serializers'

describe('formatQuestionXml', () => {
  const baseQuestion = {
    header: 'Choice',
    question: 'Pick one?',
    options: [
      { label: 'Option A', description: 'First' },
      { label: 'Option B', description: 'Second' },
    ],
    multiSelect: false,
  }

  const multiQuestion = {
    header: 'Features',
    question: 'Select features?',
    options: [{ label: 'Feature 1' }, { label: 'Feature 2' }, { label: 'Feature 3' }],
    multiSelect: true,
  }

  describe('single-select mode', () => {
    it('returns XML with selected option', () => {
      const selections = { 0: 0 }
      const otherSelected = {}
      const otherTexts = {}

      const result = formatQuestionXml(baseQuestion, 0, selections, otherSelected, otherTexts)
      expect(result).toContain('<question header="Choice" text="Pick one?">')
      expect(result).toContain('<answer>Option A</answer>')
      expect(result).toContain('</question>')
    })

    it('returns null when no selection', () => {
      const selections = { 0: null }
      const otherSelected = {}
      const otherTexts = {}

      const result = formatQuestionXml(baseQuestion, 0, selections, otherSelected, otherTexts)
      expect(result).toBeNull()
    })

    it('returns "Other" text when other is selected', () => {
      const selections = { 0: null }
      const otherSelected = { 0: true }
      const otherTexts = { 0: 'Custom answer' }

      const result = formatQuestionXml(baseQuestion, 0, selections, otherSelected, otherTexts)
      expect(result).toContain('<answer>Custom answer</answer>')
    })

    it('returns null when other selected but text empty', () => {
      const selections = { 0: null }
      const otherSelected = { 0: true }
      const otherTexts = { 0: '' }

      const result = formatQuestionXml(baseQuestion, 0, selections, otherSelected, otherTexts)
      expect(result).toBeNull()
    })

    it('preserves whitespace in other text', () => {
      const selections = { 0: null }
      const otherSelected = { 0: true }
      const otherTexts = { 0: '  Custom answer  ' }

      const result = formatQuestionXml(baseQuestion, 0, selections, otherSelected, otherTexts)
      expect(result).toContain('<answer>  Custom answer  </answer>')
    })
  })

  describe('multi-select mode', () => {
    it('returns multiple answer elements for multiple selections', () => {
      const selections = { 0: new Set([0, 2]) }
      const otherSelected = {}
      const otherTexts = {}

      const result = formatQuestionXml(multiQuestion, 0, selections, otherSelected, otherTexts)
      expect(result).toContain('<answer>Feature 1</answer>')
      expect(result).toContain('<answer>Feature 3</answer>')
    })

    it('returns single answer for one selection', () => {
      const selections = { 0: new Set([1]) }
      const otherSelected = {}
      const otherTexts = {}

      const result = formatQuestionXml(multiQuestion, 0, selections, otherSelected, otherTexts)
      expect(result).toContain('<answer>Feature 2</answer>')
      expect(result).not.toContain('<answer>Feature 1</answer>')
      expect(result).not.toContain('<answer>Feature 3</answer>')
    })

    it('returns null when empty selection set', () => {
      const selections = { 0: new Set() }
      const otherSelected = {}
      const otherTexts = {}

      const result = formatQuestionXml(multiQuestion, 0, selections, otherSelected, otherTexts)
      expect(result).toBeNull()
    })

    it('includes other text with selections', () => {
      const selections = { 0: new Set([0]) }
      const otherSelected = { 0: true }
      const otherTexts = { 0: 'Custom' }

      const result = formatQuestionXml(multiQuestion, 0, selections, otherSelected, otherTexts)
      expect(result).toContain('<answer>Feature 1</answer>')
      expect(result).toContain('<answer>Custom</answer>')
    })

    it('returns only other text when no options selected', () => {
      const selections = { 0: new Set() }
      const otherSelected = { 0: true }
      const otherTexts = { 0: 'Only custom' }

      const result = formatQuestionXml(multiQuestion, 0, selections, otherSelected, otherTexts)
      expect(result).toContain('<answer>Only custom</answer>')
      // No Feature 1/2/3 answer elements
      expect(result).not.toContain('<answer>Feature')
    })
  })

  describe('XML escaping', () => {
    it('escapes special characters in header', () => {
      const question = { ...baseQuestion, header: 'Auth & Access' }
      const selections = { 0: 0 }

      const result = formatQuestionXml(question, 0, selections, {}, {})
      expect(result).toContain('header="Auth &amp; Access"')
    })

    it('escapes special characters in answer text', () => {
      const selections = { 0: null }
      const otherTexts = { 0: 'Use <script> & "quotes"' }

      const result = formatQuestionXml(baseQuestion, 0, selections, { 0: true }, otherTexts)
      expect(result).toContain('&lt;script&gt;')
      expect(result).toContain('&amp;')
      expect(result).toContain('&quot;quotes&quot;')
    })
  })
})
