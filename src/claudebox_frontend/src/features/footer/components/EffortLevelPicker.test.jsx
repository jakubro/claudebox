/** Tests for EffortLevelPicker component. */

import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockCapabilities } from '../../../test-utils/mockCapabilities'
import EffortLevelPicker from './EffortLevelPicker'

const mockEffortLevels = [
  { id: 'max', name: 'Max' },
  { id: 'xhigh', name: 'XHigh' },
  { id: 'high', name: 'High' },
  { id: 'medium', name: 'Medium' },
  { id: 'low', name: 'Low' },
]

const mockSetEffortLevel = vi.fn()
let mockUseCapabilities = { capabilities: mockCapabilities(), runtimeName: 'Claude' }

vi.mock('../../../context/SessionDataContext', () => ({
  useSessionData: () => ({ availableEffortLevels: mockEffortLevels }),
  useSessionActions: () => ({ setEffortLevel: mockSetEffortLevel }),
}))

vi.mock('../../../hooks/useCapabilities', () => ({
  default: () => mockUseCapabilities,
}))

vi.mock('lucide-react', () => ({
  Check: () => <span data-testid="icon-check">✓</span>,
  ChevronDown: () => <span data-testid="icon-chevron">▼</span>,
}))

beforeEach(() => {
  mockSetEffortLevel.mockClear()
  mockUseCapabilities = { capabilities: mockCapabilities(), runtimeName: 'Claude' }
})

describe('EffortLevelPicker', () => {
  it('renders current effort level name', () => {
    render(<EffortLevelPicker currentEffortLevel="medium" disabled={false} />)
    expect(screen.getByTestId('footer-effort')).toHaveTextContent('Medium')
  })

  describe('capability gating', () => {
    it('renders during the capability race', () => {
      mockUseCapabilities = { capabilities: null, runtimeName: null }
      render(<EffortLevelPicker currentEffortLevel="medium" disabled={false} />)
      expect(screen.getByTestId('footer-effort')).toBeInTheDocument()
    })

    it('hides when supports_effort_levels is false', () => {
      mockUseCapabilities = {
        capabilities: mockCapabilities({ supports_effort_levels: false }),
        runtimeName: 'Goose',
      }
      render(<EffortLevelPicker currentEffortLevel="medium" disabled={false} />)
      expect(screen.queryByTestId('footer-effort')).toBeNull()
    })

    it('hides when supports_set_effort_level is false', () => {
      mockUseCapabilities = {
        capabilities: mockCapabilities({ supports_set_effort_level: false }),
        runtimeName: 'Goose',
      }
      render(<EffortLevelPicker currentEffortLevel="medium" disabled={false} />)
      expect(screen.queryByTestId('footer-effort')).toBeNull()
    })
  })
})
