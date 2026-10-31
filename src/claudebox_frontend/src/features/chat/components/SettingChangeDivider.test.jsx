/** Tests for SettingChangeDivider component. */

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../context/SessionDataContext', () => ({
  useSessionData: () => ({
    availableModels: [{ id: 'claude-sonnet-4-6', name: 'Sonnet 4.6' }],
    availablePermissionModes: [],
    availableEffortLevels: [{ id: 'high', name: 'High' }],
  }),
}))

vi.mock('../../../context/SessionsContext', () => ({
  useSessionsList: () => ({ sessions: [] }),
}))

import SettingChangeDivider from './SettingChangeDivider'

const restart = { subtype: 'container_restarted', message_data: null }
const model = { subtype: 'model_changed', model: 'claude-sonnet-4-6', previous_model: 'x' }
const effort = { subtype: 'effort_level_changed', content: 'high', previous_effort_level: 'x' }

describe('SettingChangeDivider', () => {
  it('draws a single change as one label in its own colour', () => {
    render(<SettingChangeDivider events={[model]} />)

    const divider = screen.getByTestId('setting-change-divider')
    expect(divider).toHaveTextContent(/^Sonnet 4\.6$/)
    expect(divider.style.color).toBe('rgb(136, 136, 187)')
  })

  it('draws a merged run as one line naming each change in its own colour', () => {
    render(<SettingChangeDivider events={[restart, model, effort]} />)

    const divider = screen.getByTestId('setting-change-divider')
    expect(divider).toHaveTextContent('Restarted · Sonnet 4.6 · Effort: High')
    expect(screen.getByText('Restarted').style.color).toBe('rgb(200, 144, 96)')
    expect(screen.getByText('Sonnet 4.6').style.color).toBe('rgb(136, 136, 187)')
    expect(screen.getByText('Effort: High').style.color).toBe('rgb(154, 126, 200)')
  })
})
