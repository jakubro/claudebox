/** Tests for settingLabels utility. */

import { describe, expect, it } from 'vitest'
import { getSettingChangeInfo, isSettingInitEvent } from './settingLabels'

const models = [
  { id: 'claude-opus-4-8', name: 'Opus 4.8' },
  { id: 'claude-opus-4-6', name: 'Opus 4.6' },
  { id: 'claude-sonnet-4-6', name: 'Sonnet 4.6' },
  { id: 'claude-haiku-4-5-20251001', name: 'Haiku 4.5' },
]

const permissionModes = [
  { id: 'bypassPermissions', name: 'Bypass' },
  { id: 'plan', name: 'Plan' },
  { id: 'default', name: 'Default' },
  { id: 'acceptEdits', name: 'Accept Edits' },
  { id: 'dontAsk', name: "Don't Ask" },
  { id: 'auto', name: 'Auto' },
]

describe('getSettingChangeInfo', () => {
  it('returns model display name for known model', () => {
    const result = getSettingChangeInfo(
      { subtype: 'model_changed', model: 'claude-opus-4-6' },
      { models },
    )

    expect(result.label).toBe('Opus 4.6')
    expect(result.color).toBe('#8888bb')
  })

  it('returns model id as fallback for unknown model', () => {
    const result = getSettingChangeInfo(
      { subtype: 'model_changed', model: 'claude-future-99' },
      { models },
    )

    expect(result.label).toBe('claude-future-99')
  })

  it('falls back to raw id for an orphaned 1M-suffixed model absent from the catalog', () => {
    const result = getSettingChangeInfo(
      { subtype: 'model_changed', model: 'claude-opus-4-6[1m]' },
      { models },
    )

    expect(result.label).toBe('claude-opus-4-6[1m]')
  })

  it('returns permission mode display name for bypass', () => {
    const result = getSettingChangeInfo(
      { subtype: 'permission_mode_changed', permission_mode: 'bypassPermissions' },
      { permissionModes },
    )

    expect(result.label).toBe('Bypass')
    expect(result.color).toBe('#c8a060')
  })

  it('returns permission mode display name for plan', () => {
    const result = getSettingChangeInfo(
      { subtype: 'permission_mode_changed', permission_mode: 'plan' },
      { permissionModes },
    )

    expect(result.label).toBe('Plan')
    expect(result.color).toBe('#7ac0d4')
  })

  it('returns permission mode display name for acceptEdits', () => {
    const result = getSettingChangeInfo(
      { subtype: 'permission_mode_changed', permission_mode: 'acceptEdits' },
      { permissionModes },
    )

    expect(result.label).toBe('Accept Edits')
    expect(result.color).toBe('#6ac86a')
  })

  it('returns permission mode display name for dontAsk', () => {
    const result = getSettingChangeInfo(
      { subtype: 'permission_mode_changed', permission_mode: 'dontAsk' },
      { permissionModes },
    )

    expect(result.label).toBe("Don't Ask")
    expect(result.color).toBe('#a06850')
  })

  it('returns permission mode display name for auto', () => {
    const result = getSettingChangeInfo(
      { subtype: 'permission_mode_changed', permission_mode: 'auto' },
      { permissionModes },
    )

    expect(result.label).toBe('Auto')
    expect(result.color).toBe('#9890b0')
  })

  it('returns fallback for unknown permission mode', () => {
    const result = getSettingChangeInfo(
      { subtype: 'permission_mode_changed', permission_mode: 'unknown_permission_mode' },
      { permissionModes },
    )

    expect(result.label).toBe('unknown_permission_mode')
    expect(result.color).toBe('#999')
  })

  it('returns effort level display name for known level', () => {
    const effortLevels = [
      { id: 'max', name: 'Max' },
      { id: 'high', name: 'High' },
      { id: 'medium', name: 'Medium' },
    ]
    const result = getSettingChangeInfo(
      { subtype: 'effort_level_changed', content: 'high' },
      { effortLevels },
    )

    expect(result.label).toBe('Effort: High')
    expect(result.color).toBe('#9a7ec8')
  })

  it('falls back to raw id for unknown effort level', () => {
    const result = getSettingChangeInfo(
      { subtype: 'effort_level_changed', content: 'turbo' },
      { effortLevels: [] },
    )

    expect(result.label).toBe('Effort: turbo')
    expect(result.color).toBe('#9a7ec8')
  })

  it('returns fallback for unrecognized event subtype', () => {
    const result = getSettingChangeInfo({ subtype: 'something_else' })

    expect(result.label).toBe('Unknown')
    expect(result.color).toBe('#999')
  })

  it('falls back to id when no metadata provided', () => {
    const result = getSettingChangeInfo({
      subtype: 'model_changed',
      model: 'claude-opus-4-6',
    })

    expect(result.label).toBe('claude-opus-4-6')
  })

  it('returns "Restarted" label for a plain container_restarted event', () => {
    const result = getSettingChangeInfo({ subtype: 'container_restarted', message_data: null })

    expect(result.label).toBe('Restarted')
    expect(result.color).toBe('#c89060')
  })

  it('returns "Forked from <name>" when parent matches a session in the list', () => {
    const sessions = [
      { session_id: 'parent-abc', name: 'morning planning' },
      { session_id: 'other-xyz', name: 'unrelated' },
    ]
    const result = getSettingChangeInfo(
      {
        subtype: 'container_restarted',
        message_data: { fork_parent_session_id: 'parent-abc' },
      },
      { sessions },
    )

    expect(result.label).toBe('Forked from morning planning')
    expect(result.color).toBe('#c89060')
  })

  it('falls back to fork-parent id when no matching session', () => {
    const result = getSettingChangeInfo(
      {
        subtype: 'container_restarted',
        message_data: { fork_parent_session_id: 'orphan-id' },
      },
      { sessions: [] },
    )

    expect(result.label).toBe('Forked from orphan-id')
    expect(result.color).toBe('#c89060')
  })
})

describe('isSettingInitEvent', () => {
  it('returns true for model_changed with null previous_model', () => {
    expect(isSettingInitEvent({ subtype: 'model_changed', previous_model: null })).toBe(true)
  })

  it('returns false for model_changed with a previous_model', () => {
    expect(
      isSettingInitEvent({ subtype: 'model_changed', previous_model: 'claude-sonnet-4-6' }),
    ).toBe(false)
  })

  it('returns true for permission_mode_changed with null previous_permission_mode', () => {
    expect(
      isSettingInitEvent({ subtype: 'permission_mode_changed', previous_permission_mode: null }),
    ).toBe(true)
  })

  it('returns true for effort_level_changed with null previous_effort_level', () => {
    expect(
      isSettingInitEvent({ subtype: 'effort_level_changed', previous_effort_level: null }),
    ).toBe(true)
  })

  it('returns false for container_restarted regardless of payload', () => {
    expect(isSettingInitEvent({ subtype: 'container_restarted' })).toBe(false)
    expect(
      isSettingInitEvent({
        subtype: 'container_restarted',
        message_data: { fork_parent_session_id: 'p' },
      }),
    ).toBe(false)
  })

  it('returns false for any unrecognized subtype (no init concept)', () => {
    expect(isSettingInitEvent({ subtype: 'something_else' })).toBe(false)
  })
})
