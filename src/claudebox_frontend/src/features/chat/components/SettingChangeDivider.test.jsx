/** Tests for SettingChangeDivider component. */

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../context/SessionDataContext', () => ({
  useSessionData: () => ({
    availableModels: [],
    availablePermissionModes: [],
    availableEffortLevels: [],
  }),
}))

vi.mock('../../../context/SessionsContext', () => ({
  useSessionsList: () => ({ sessions: [] }),
}))

vi.mock('../utils/settingLabels', async importOriginal => {
  const actual = await importOriginal()
  return {
    ...actual,
    getSettingChangeInfo: () => ({ label: 'Test Label', color: '#ff0000' }),
  }
})

import SettingChangeDivider from './SettingChangeDivider'

describe('SettingChangeDivider', () => {
  it('renders label when not init event (model_changed with previous_model set)', () => {
    render(
      <SettingChangeDivider event={{ subtype: 'model_changed', previous_model: 'claude-3' }} />,
    )
    expect(screen.getByTestId('setting-change-divider')).toBeInTheDocument()
    expect(screen.getByText('Test Label')).toBeInTheDocument()
  })

  it('returns null for init event (model_changed with previous_model=null)', () => {
    const { container } = render(
      <SettingChangeDivider event={{ subtype: 'model_changed', previous_model: null }} />,
    )
    expect(container.innerHTML).toBe('')
  })

  it('returns null for init effort event (effort_level_changed with previous_effort_level=null)', () => {
    const { container } = render(
      <SettingChangeDivider
        event={{ subtype: 'effort_level_changed', previous_effort_level: null }}
      />,
    )
    expect(container.innerHTML).toBe('')
  })

  it('returns null for init permission event (permission_mode_changed with previous_permission_mode=null)', () => {
    const { container } = render(
      <SettingChangeDivider
        event={{
          subtype: 'permission_mode_changed',
          previous_permission_mode: null,
        }}
      />,
    )
    expect(container.innerHTML).toBe('')
  })
})
