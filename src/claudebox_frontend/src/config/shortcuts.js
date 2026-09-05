/** Keyboard bindings - the one list Help, the panel dispatcher and the docs generator read. */

import PANEL_CONFIGS from './panel'

// Panel toggles carry their key on the panel itself, so this list never repeats it.
const PANEL_TOGGLES = Object.values(PANEL_CONFIGS)
  .filter(panel => panel.shortcut)
  .map(panel => ({ keys: panel.shortcut, action: `Toggle ${panel.title}` }))

const INPUT = {
  title: 'Input',
  bindings: [
    { keys: 'Enter', action: 'Send message' },
    { keys: 'Alt+Enter', action: 'Queue message' },
    { keys: 'Shift+Enter', action: 'New line' },
    { keys: 'Tab', action: 'Indent' },
    { keys: 'Shift+Tab', action: 'Dedent' },
    { keys: 'Ctrl+.', action: 'Interrupt' },
    { keys: '↑ / ↓', action: 'History navigation' },
    { keys: 'Ctrl+S', action: 'Stash input' },
    { keys: 'Ctrl+Shift+S', action: 'Pop from stash' },
  ],
}

const AUTO_PAIRING = {
  title: 'Auto-pairing',
  bindings: [
    { keys: 'Ctrl+,', action: 'Wrap in <this></this> tags' },
    { keys: '\' " ` ( [ {', action: 'Wrap selection with pair' },
    { keys: "Ctrl+'", action: 'Collapse nearest block' },
    { keys: "Ctrl+Shift+'", action: 'Collapse all blocks' },
    { keys: 'Ctrl+\\', action: 'Expand nearest block' },
    { keys: 'Ctrl+Shift+\\', action: 'Expand all blocks' },
  ],
}

const NAVIGATION = {
  title: 'Navigation',
  bindings: [
    { keys: 'Alt+↑ / ↓', action: 'Prev/next message' },
    { keys: 'Alt+Home / End', action: 'First/last message' },
    { keys: 'Alt+PageUp / PageDown', action: 'Prev/next entry in the right column' },
    { keys: 'Alt+Shift+← / →', action: 'Focus prev/next group on the session rail' },
  ],
}

const SESSION = {
  title: 'Session',
  bindings: [
    { keys: 'Alt+N', action: 'New session' },
    { keys: 'Alt+Shift+N', action: 'New session (browser tab)' },
  ],
}

const PANELS = {
  title: 'Panels',
  bindings: [
    { keys: 'Alt+C', action: 'Focus Chat' },
    ...PANEL_TOGGLES,
    { keys: 'Alt+?', action: 'Help overlay' },
    { keys: 'Double-click tab', action: 'Maximize panel' },
    { keys: 'Middle-click tab', action: 'Close panel' },
  ],
}

/** Sections split into the two side-by-side tables the Help panel draws. */
export const SHORTCUT_COLUMNS = [
  [INPUT, AUTO_PAIRING, NAVIGATION],
  [SESSION, PANELS],
]

/**
 * Every section, in reading order, for consumers that do not lay out in columns.
 * @public - the docs generator reads this through a dynamic import knip cannot follow.
 */
export const SHORTCUT_SECTIONS = SHORTCUT_COLUMNS.flat()
