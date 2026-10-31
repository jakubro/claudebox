/** The WebGL view of one STL block, drawn only when it changes and released when it unmounts. */

import { Minus, Plus, RotateCcw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { loadThree, parseStl } from '../../../utils/stlLoader'
import { buildScene } from '../../../utils/stlScene'

const ZOOM_STEP = 0.8
const NO_WEBGL = '3D graphics are unavailable in this browser'

/**
 * @param {string} props.source - The block's raw text
 * @param {function(string)} props.onFailure - Called with a short reason when the model cannot be drawn
 */
export default function StlCanvas({ source, onFailure }) {
  const hostRef = useRef(null)
  const viewRef = useRef(null)
  const [drawn, setDrawn] = useState(false)

  useEffect(() => {
    let cancelled = false
    let teardown = null
    Promise.all([loadThree(), parseStl(source)]).then(
      ([three, geometry]) => {
        if (cancelled) {
          geometry.dispose()
          return
        }
        try {
          teardown = buildScene(three, geometry, hostRef.current, viewRef)
          setDrawn(true)
        } catch {
          geometry.dispose()
          onFailure(NO_WEBGL)
        }
      },
      err => !cancelled && onFailure(err.message),
    )
    return () => {
      cancelled = true
      teardown?.()
      viewRef.current = null
    }
  }, [source, onFailure])

  return (
    <div className="stl-canvas" ref={hostRef}>
      {!drawn && <div className="drawn-block-loading">Drawing model...</div>}
      {drawn && (
        <div className="stl-controls">
          <button type="button" title="Zoom in" onClick={() => viewRef.current?.zoom(ZOOM_STEP)}>
            <Plus size={14} />
          </button>
          <button
            type="button"
            title="Zoom out"
            onClick={() => viewRef.current?.zoom(1 / ZOOM_STEP)}>
            <Minus size={14} />
          </button>
          <button type="button" title="Reset view" onClick={() => viewRef.current?.reset()}>
            <RotateCcw size={14} />
          </button>
        </div>
      )}
    </div>
  )
}
