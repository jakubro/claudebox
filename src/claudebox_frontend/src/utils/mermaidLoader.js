/** Lazy mermaid loader with dark theme initialization, drawn-SVG caching, and DOM cleanup. */

import { MAX_MERMAID_CACHE_ENTRIES } from '../config/thresholds'

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

// Drawn-SVG cache keyed by source text - a remounted diagram restores instantly instead of redrawing.
const svgCache = new Map()

/** Look up a diagram already drawn for this source text, or null if uncached. */
export function getCachedMermaidSvg(source) {
  return svgCache.get(source) ?? null
}

/** Store a drawn diagram, evicting the oldest entry once the cache is full. */
function cacheSvg(source, svg) {
  if (svgCache.size >= MAX_MERMAID_CACHE_ENTRIES && !svgCache.has(source)) {
    const oldestKey = svgCache.keys().next().value
    svgCache.delete(oldestKey)
  }
  svgCache.set(source, svg)
}

/** Defensive sweep for `id`/`d{id}`/`i{id}` DOM nodes a failed render may have left behind. */
export function removeMermaidRenderArtifacts(id) {
  for (const candidate of [id, `d${id}`, `i${id}`]) {
    document.getElementById(candidate)?.remove()
  }
}

/** Render mermaid source to SVG, using a cached result when available, lazy-loading the library on first call. */
export async function renderMermaidChart(id, source) {
  const cached = getCachedMermaidSvg(source)
  if (cached) {
    return { svg: cached }
  }

  if (!mermaidInstance) {
    const { default: mermaid } = await import('mermaid')
    if (!mermaidInitialized) {
      mermaid.initialize({
        startOnLoad: false,
        theme: 'dark',
        themeVariables: MERMAID_THEME_VARIABLES,
        securityLevel: 'strict',
        // Skip mermaid's own error graphic - we fall back to syntax-highlighted source.
        suppressErrorRendering: true,
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, sans-serif',
      })
      mermaidInitialized = true
    }
    mermaidInstance = mermaid
  }

  const result = await mermaidInstance.render(id, source)
  cacheSvg(source, result.svg)
  return result
}
