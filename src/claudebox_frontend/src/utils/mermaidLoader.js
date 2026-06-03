/** Lazy mermaid loader with dark theme initialization and rendering. */

const MERMAID_THEME_VARIABLES = {
  primaryColor: '#2d2d30',
  primaryTextColor: '#cccccc',
  primaryBorderColor: '#3c3c3c',
  lineColor: '#808080',
  secondaryColor: '#212122',
  tertiaryColor: '#1a1a1a',
  background: '#1a1a1a',
  mainBkg: '#2d2d30',
  nodeBorder: '#3c3c3c',
  clusterBkg: '#212122',
  clusterBorder: '#3c3c3c',
  titleColor: '#cccccc',
  edgeLabelBackground: '#212122',
  nodeTextColor: '#cccccc',
}

let mermaidInstance = null
let mermaidInitialized = false

/** Render mermaid source to SVG, lazy-loading the library on first call. */
export async function renderMermaidChart(id, source) {
  if (!mermaidInstance) {
    const { default: mermaid } = await import('mermaid')
    if (!mermaidInitialized) {
      mermaid.initialize({
        startOnLoad: false,
        theme: 'dark',
        themeVariables: MERMAID_THEME_VARIABLES,
        securityLevel: 'strict',
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, sans-serif',
      })
      mermaidInitialized = true
    }
    mermaidInstance = mermaid
  }
  return mermaidInstance.render(id, source)
}
