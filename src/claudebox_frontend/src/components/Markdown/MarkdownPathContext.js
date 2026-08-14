/** Ambient path-highlighting values for the markdown element overrides. */

import { createContext } from 'react'

// Module-scoped element overrides can't close over per-render values, so they read this context instead.
const MarkdownPathContext = createContext({
  sessionDir: null,
  resolvedPaths: {},
  editorTemplate: null,
})

export default MarkdownPathContext
