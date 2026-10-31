/** Ambient values for the markdown element overrides: paths, relative-URL bases and block actions. */

import { createContext } from 'react'

// Module-scoped element overrides can't close over per-render values, so they read this context instead.
const MarkdownPathContext = createContext({
  sessionDir: null,
  resolvedPaths: {},
  editorTemplate: null,
  hostsBlockActions: false,
  baseDir: null,
  baseUrl: null,
  workspaceDir: null,
  sessionId: null,
})

export default MarkdownPathContext
