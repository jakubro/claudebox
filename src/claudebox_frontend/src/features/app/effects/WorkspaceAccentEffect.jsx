/** Apply workspace accent color as gradient to the dockview tab bar background. */

import { useEffect } from 'react'
import { DEFAULT_TAB_BG } from '../../../config/colors'
import { useSessionsList } from '../../../context/SessionsContext'
import { deriveHoverColor } from '../../../utils/color'

/** CSS variable names set by this effect. */
const VAR_ACCENT_TAB_BG = '--accent-tab-bg'
const VAR_ACCENT_HOVER = '--accent-hover'

/**
 * Apply workspace accent color as CSS variables on the dockview theme element.
 *
 * Sets --accent-tab-bg (consumed by a :has()-scoped CSS rule in App.css that
 * targets only the center group tab bar) and --accent-hover for header button
 * hover states. Renders nothing.
 */
export default function WorkspaceAccentEffect() {
  const { workspaceColor } = useSessionsList()

  useEffect(() => {
    const el = document.querySelector('.dockview-theme-dark')
    if (!el) {
      return
    }
    if (workspaceColor) {
      el.style.setProperty(
        VAR_ACCENT_TAB_BG,
        `linear-gradient(to right, ${DEFAULT_TAB_BG}, ${workspaceColor})`,
      )
      el.style.setProperty(VAR_ACCENT_HOVER, deriveHoverColor(workspaceColor))
    } else {
      el.style.removeProperty(VAR_ACCENT_TAB_BG)
      el.style.removeProperty(VAR_ACCENT_HOVER)
    }
    return () => {
      el.style.removeProperty(VAR_ACCENT_TAB_BG)
      el.style.removeProperty(VAR_ACCENT_HOVER)
    }
  }, [workspaceColor])

  return null
}
