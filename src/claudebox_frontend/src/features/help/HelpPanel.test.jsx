/** Tests for HelpPanel component. */

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import HelpPanel from './HelpPanel'

describe('HelpPanel', () => {
  it('renders keyboard shortcuts table', () => {
    render(<HelpPanel />)

    expect(screen.getAllByRole('table')).toHaveLength(2)
  })

  it('includes all documented shortcuts', () => {
    const { container } = render(<HelpPanel />)

    // Extract all shortcut key-description pairs from rendered tables
    const rows = container.querySelectorAll('tr:not(.help-section)')
    const shortcuts = Array.from(rows).map(row => {
      const cells = row.querySelectorAll('td')
      return [cells[0]?.textContent, cells[1]?.textContent]
    })

    expect(shortcuts).toMatchInlineSnapshot(`
      [
        [
          "Enter",
          "Send message",
        ],
        [
          "Alt+Enter",
          "Queue message",
        ],
        [
          "Shift+Enter",
          "New line",
        ],
        [
          "Ctrl+.",
          "Interrupt",
        ],
        [
          "↑ / ↓",
          "History navigation",
        ],
        [
          "Ctrl+S",
          "Stash input",
        ],
        [
          "Ctrl+Shift+S",
          "Pop from stash",
        ],
        [
          "Ctrl+,",
          "Wrap in <this></this> tags",
        ],
        [
          "' " \` ( [ {",
          "Wrap selection with pair",
        ],
        [
          "Ctrl+'",
          "Collapse nearest block",
        ],
        [
          "Ctrl+Shift+'",
          "Collapse all blocks",
        ],
        [
          "Ctrl+\\",
          "Expand nearest block",
        ],
        [
          "Ctrl+Shift+\\",
          "Expand all blocks",
        ],
        [
          "Alt+↑ / ↓",
          "Prev/next message",
        ],
        [
          "Alt+Home / End",
          "First/last message",
        ],
        [
          "Alt+N",
          "New session",
        ],
        [
          "Alt+Shift+N",
          "New session (browser tab)",
        ],
        [
          "Alt+C",
          "Focus Chat",
        ],
        [
          "Alt+0",
          "Toggle Logs",
        ],
        [
          "Alt+1",
          "Toggle Sessions",
        ],
        [
          "Alt+2",
          "Toggle Todos",
        ],
        [
          "Alt+3",
          "Toggle Stash",
        ],
        [
          "Alt+4",
          "Toggle Tasks",
        ],
        [
          "Alt+5",
          "Toggle Bookmarks",
        ],
        [
          "Alt+6",
          "Toggle Boards",
        ],
        [
          "Alt+7",
          "Toggle Usage",
        ],
        [
          "Alt+8",
          "Toggle MCP",
        ],
        [
          "Alt+9",
          "Toggle Skills",
        ],
        [
          "Alt+?",
          "Help overlay",
        ],
        [
          "Double-click tab",
          "Maximize panel",
        ],
        [
          "Middle-click tab",
          "Close panel",
        ],
      ]
    `)
  })
})
