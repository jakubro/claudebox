/** Tests for WorkspaceAccentEffect. */

import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let mockWorkspaceColor = null

vi.mock('../../../context/SessionsContext', () => ({
  useSessionsList: () => ({ workspaceColor: mockWorkspaceColor }),
}))

import WorkspaceAccentEffect from './WorkspaceAccentEffect'

const CSS_VAR_BG = '--accent-tab-bg'
const CSS_VAR_HOVER = '--accent-hover'

describe('WorkspaceAccentEffect', () => {
  let themeEl

  beforeEach(() => {
    mockWorkspaceColor = null
    themeEl = document.createElement('div')
    themeEl.classList.add('dockview-theme-dark')
    document.body.appendChild(themeEl)
  })

  afterEach(() => {
    themeEl.remove()
  })

  function renderEffect() {
    return renderHook(() => {}, {
      wrapper: ({ children }) => (
        <>
          <WorkspaceAccentEffect />
          {children}
        </>
      ),
    })
  }

  it('does not set CSS variables when no color', () => {
    renderEffect()

    expect(themeEl.style.getPropertyValue(CSS_VAR_BG)).toBe('')
    expect(themeEl.style.getPropertyValue(CSS_VAR_HOVER)).toBe('')
  })

  it('sets gradient background when color is provided', () => {
    mockWorkspaceColor = '#1e3a5f'

    renderEffect()

    const bg = themeEl.style.getPropertyValue(CSS_VAR_BG)
    expect(bg).toContain('linear-gradient')
    expect(bg).toContain('#1e3a5f')
    expect(bg).toContain('#161618')
  })

  it('sets accent hover color when color is provided', () => {
    mockWorkspaceColor = '#1e3a5f'

    renderEffect()

    const hover = themeEl.style.getPropertyValue(CSS_VAR_HOVER)
    expect(hover).toMatch(/^#[0-9a-f]{6}$/)
    expect(hover).not.toBe('#1e3a5f')
  })

  it('removes CSS variables when color changes to null', () => {
    mockWorkspaceColor = '#1e3a5f'
    const { rerender } = renderEffect()

    expect(themeEl.style.getPropertyValue(CSS_VAR_BG)).toContain('linear-gradient')

    mockWorkspaceColor = null
    rerender()

    expect(themeEl.style.getPropertyValue(CSS_VAR_BG)).toBe('')
    expect(themeEl.style.getPropertyValue(CSS_VAR_HOVER)).toBe('')
  })

  it('updates CSS variables when color changes', () => {
    mockWorkspaceColor = '#1e3a5f'
    const { rerender } = renderEffect()

    expect(themeEl.style.getPropertyValue(CSS_VAR_BG)).toContain('#1e3a5f')

    mockWorkspaceColor = '#4a1e4a'
    rerender()

    expect(themeEl.style.getPropertyValue(CSS_VAR_BG)).toContain('#4a1e4a')
  })

  it('cleans up CSS variables on unmount', () => {
    mockWorkspaceColor = '#1e3a5f'
    const { unmount } = renderEffect()

    expect(themeEl.style.getPropertyValue(CSS_VAR_BG)).toContain('linear-gradient')

    unmount()

    expect(themeEl.style.getPropertyValue(CSS_VAR_BG)).toBe('')
    expect(themeEl.style.getPropertyValue(CSS_VAR_HOVER)).toBe('')
  })
})
