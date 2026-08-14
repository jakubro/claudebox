/** Apply workspace accent color as gradient to the dockview tab bar background. */

import { useEffect } from 'react'
import { DEFAULT_TAB_BG } from '../../../config/colors'
import { useSessionsList } from '../../../context/SessionsContext'
import { deriveHoverColor } from '../../../utils/color'

/** CSS variable names set by this effect. */
const VAR_ACCENT_TAB_BG = '--accent-tab-bg'
const VAR_ACCENT_HOVER = '--accent-hover'

/** Sets --accent-tab-bg (App.css :has()-scoped rule, center tab bar) and --accent-hover for header hovers. */
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
