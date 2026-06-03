/** Tests for SkillsPanel component. */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockCapabilities } from '../../test-utils/mockCapabilities'
import SkillsPanel from './SkillsPanel'

// Mock data — mutable ref for per-test override
const mockState = { commands: {} }
const mockEventsData = { isResuming: false, isReplaying: false }
let mockUseCapabilities = { capabilities: mockCapabilities(), runtimeName: 'Claude' }

vi.mock('../../context/SessionDataContext', () => ({
  useSessionData: () => ({
    commands: mockState.commands,
  }),
}))

vi.mock('../../context/EventsContext', () => ({
  useEvents: () => mockEventsData,
}))

vi.mock('../../hooks/useCapabilities', () => ({
  default: () => mockUseCapabilities,
}))

describe('SkillsPanel', () => {
  beforeEach(() => {
    mockState.commands = {}
    mockEventsData.isResuming = false
    mockEventsData.isReplaying = false
    mockUseCapabilities = { capabilities: mockCapabilities(), runtimeName: 'Claude' }
  })

  it('renders empty state when no skills', () => {
    render(<SkillsPanel />)
    expect(screen.getByText('No skills')).toBeInTheDocument()
  })

  it('renders all three tab buttons', () => {
    render(<SkillsPanel />)
    expect(screen.getByRole('button', { name: /Custom/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /MCP/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /All/ })).toBeInTheDocument()
  })

  it('defaults to Custom tab', () => {
    render(<SkillsPanel />)
    const customBtn = screen.getByRole('button', { name: /Custom/ })
    expect(customBtn).toHaveClass('active')
  })

  it('shows MCP skills in MCP tab', async () => {
    const user = userEvent.setup()
    mockState.commands = {
      custom: [],
      mcp: [{ name: 'mcp__slack__send' }, { name: 'mcp__github__pr' }],
      builtin: [],
    }

    render(<SkillsPanel />)

    await user.click(screen.getByRole('button', { name: /MCP/ }))

    expect(screen.getByText('/mcp__slack__send')).toBeInTheDocument()
    expect(screen.getByText('/mcp__github__pr')).toBeInTheDocument()
  })

  it('shows custom skills in Custom tab', () => {
    mockState.commands = {
      custom: [{ name: 'deploy' }, { name: 'test' }, { name: 'format' }],
      mcp: [],
      builtin: [],
    }

    render(<SkillsPanel />)

    expect(screen.getByText('/deploy')).toBeInTheDocument()
    expect(screen.getByText('/test')).toBeInTheDocument()
    expect(screen.getByText('/format')).toBeInTheDocument()
  })

  it('shows all skills in All tab', async () => {
    const user = userEvent.setup()
    mockState.commands = {
      custom: [{ name: 'deploy' }],
      mcp: [{ name: 'mcp__slack__send' }],
      builtin: [{ name: 'compact' }],
    }

    render(<SkillsPanel />)

    await user.click(screen.getByRole('button', { name: /All/ }))

    expect(screen.getByText('/deploy')).toBeInTheDocument()
    expect(screen.getByText('/mcp__slack__send')).toBeInTheDocument()
    expect(screen.getByText('/compact')).toBeInTheDocument()
  })

  it('excludes built-in skills from Custom tab', () => {
    mockState.commands = {
      custom: [{ name: 'deploy' }],
      mcp: [],
      builtin: [{ name: 'compact' }, { name: 'cost' }],
    }

    render(<SkillsPanel />)

    // Custom tab (default) — only deploy
    expect(screen.getByText('/deploy')).toBeInTheDocument()
    expect(screen.queryByText('/compact')).not.toBeInTheDocument()
    expect(screen.queryByText('/cost')).not.toBeInTheDocument()
  })

  it('shows counts in tab badges', () => {
    mockState.commands = {
      custom: [{ name: 'deploy' }],
      mcp: [{ name: 'mcp__slack__send' }],
      builtin: [{ name: 'compact' }],
    }

    render(<SkillsPanel />)

    expect(screen.getByRole('button', { name: /Custom.*1/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /MCP.*1/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /All.*3/ })).toBeInTheDocument()
  })

  it('switches tabs when clicked', async () => {
    const user = userEvent.setup()
    mockState.commands = {
      custom: [{ name: 'deploy' }],
      mcp: [{ name: 'mcp__slack__send' }],
      builtin: [],
    }

    render(<SkillsPanel />)

    // Start on Custom tab - only /deploy visible
    expect(screen.getByText('/deploy')).toBeInTheDocument()
    expect(screen.queryByText('/mcp__slack__send')).not.toBeInTheDocument()

    // Switch to MCP
    await user.click(screen.getByRole('button', { name: /MCP/ }))

    expect(screen.getByText('/mcp__slack__send')).toBeInTheDocument()
    expect(screen.queryByText('/deploy')).not.toBeInTheDocument()
  })

  it('renders category icon dots', () => {
    mockState.commands = { custom: [{ name: 'deploy' }], mcp: [], builtin: [] }

    render(<SkillsPanel />)

    const icons = document.querySelectorAll('.skills-icon')
    expect(icons).toHaveLength(1)
  })

  describe('isReplaying', () => {
    it('shows "Resuming..." when isReplaying is true', () => {
      mockEventsData.isReplaying = true

      render(<SkillsPanel />)

      expect(screen.getByTestId('panel-skills')).toHaveTextContent('Resuming...')
    })

    it('shows "Resuming..." when isResuming is true', () => {
      mockEventsData.isResuming = true

      render(<SkillsPanel />)

      expect(screen.getByTestId('panel-skills')).toHaveTextContent('Resuming...')
    })

    it('has skills-loading class (not skills-empty) when resuming', () => {
      mockEventsData.isResuming = true

      render(<SkillsPanel />)

      // Resuming is a loading state (data not yet hydrated), not an empty state.
      const root = screen.getByTestId('panel-skills')
      expect(root).toHaveClass('skills-loading')
      expect(root).not.toHaveClass('skills-empty')
    })
  })

  describe('capability gating', () => {
    it('renders during the capability race', () => {
      mockUseCapabilities = { capabilities: null, runtimeName: null }
      render(<SkillsPanel />)
      expect(screen.getByTestId('panel-skills')).toBeInTheDocument()
    })

    it('hides when supports_skills is false', () => {
      mockUseCapabilities = {
        capabilities: mockCapabilities({ supports_skills: false }),
        runtimeName: 'Goose',
      }
      const { container } = render(<SkillsPanel />)
      expect(container).toBeEmptyDOMElement()
    })
  })
})
