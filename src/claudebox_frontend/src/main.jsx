/** Application entry point. */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'dockview-react/dist/styles/dockview.css'
import './main.css'
import ErrorBoundary from './components/ErrorBoundary'
import App from './features/app'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary label="app">
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
