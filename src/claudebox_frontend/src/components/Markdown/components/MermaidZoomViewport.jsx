/** Pan/zoom viewport for the mermaid overlay: one transform, clamped scale, corner controls. */

import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Maximize,
  Minus,
  Plus,
} from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  MERMAID_ZOOM_MAX_SCALE_RATIO as MAX_SCALE_RATIO,
  MERMAID_ZOOM_MIN_SCALE_RATIO as MIN_SCALE_RATIO,
} from '../../../config/dimensions'

const ZOOM_STEP_RATIO = 1.25
const PAN_FRACTION = 0.2 // of the viewport's own width/height, per button/key press
const DRAG_CLICK_THRESHOLD_PX = 5

/**
 * @param {string} props.svg - Raw mermaid SVG markup.
 * @param {object} props.draggedRef - Set true by a drag past the click threshold, so the caller's
 *   click-to-close can tell a drag-release from a click.
 * @param {object} [props.controlsRef] - Populated with `{zoomIn, zoomOut, panUp/Down/Left/Right,
 *   fit}` so the caller's keydown listener drives this view; state stays here, so a reopen fits.
 */
export default function MermaidZoomViewport({ svg, draggedRef, controlsRef }) {
  const viewportRef = useRef(null)
  const contentRef = useRef(null)
  const [view, setView] = useState(null)
  const boundsRef = useRef({ min: 0, max: Number.POSITIVE_INFINITY })
  const fitRef = useRef(null)
  const dragStateRef = useRef(null)

  const computeFit = useCallback(() => {
    const viewport = viewportRef.current
    const svgEl = contentRef.current?.querySelector('svg')
    if (!(viewport && svgEl)) {
      return null
    }
    const vw = viewport.clientWidth
    const vh = viewport.clientHeight
    // viewBox is the diagram's intrinsic size - unaffected by any CSS cap on the rendered box.
    const box = svgEl.viewBox?.baseVal
    const w = box?.width || svgEl.getBoundingClientRect().width
    const h = box?.height || svgEl.getBoundingClientRect().height
    if (!(vw && vh && w && h)) {
      return null
    }
    // With no height to resolve against and width="100%" overridden to auto, the SVG renders at
    // 0x0 - pin it to its viewBox pixels so the transform scales a real box.
    svgEl.style.width = `${w}px`
    svgEl.style.height = `${h}px`
    const scale = Math.min(vw / w, vh / h, 1)
    return { scale, x: (vw - w * scale) / 2, y: (vh - h * scale) / 2 }
  }, [])

  // Injected imperatively: dangerouslySetInnerHTML re-parses on every gesture's re-render, which
  // would discard the width/height computeFit wrote onto the live SVG.
  useLayoutEffect(() => {
    if (contentRef.current) {
      contentRef.current.innerHTML = svg
    }
    const fit = computeFit()
    fitRef.current = fit
    if (fit) {
      boundsRef.current = { min: fit.scale * MIN_SCALE_RATIO, max: fit.scale * MAX_SCALE_RATIO }
    }
    setView(fit)
  }, [computeFit, svg])

  // The window resizing while the overlay is open changes what "fit" means, even though the
  // current (possibly zoomed) view is left alone.
  useEffect(() => {
    const onResize = () => {
      const fit = computeFit()
      if (fit) {
        fitRef.current = fit
        boundsRef.current = { min: fit.scale * MIN_SCALE_RATIO, max: fit.scale * MAX_SCALE_RATIO }
      }
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [computeFit])

  // Whatever sits under (anchorX, anchorY) before the scale change sits under it after - the
  // wheel anchors at the pointer, every button and key at the viewport centre.
  const zoomAt = useCallback((factor, anchorX, anchorY) => {
    setView(prev => {
      if (!prev) {
        return prev
      }
      const { min, max } = boundsRef.current
      const nextScale = Math.min(max, Math.max(min, prev.scale * factor))
      if (nextScale === prev.scale) {
        return prev
      }
      const ratio = nextScale / prev.scale
      return {
        scale: nextScale,
        x: anchorX - (anchorX - prev.x) * ratio,
        y: anchorY - (anchorY - prev.y) * ratio,
      }
    })
  }, [])

  const zoomAtCentre = useCallback(
    factor => {
      const viewport = viewportRef.current
      if (!viewport) {
        return
      }
      zoomAt(factor, viewport.clientWidth / 2, viewport.clientHeight / 2)
    },
    [zoomAt],
  )

  // (contentDx, contentDy) is how the CONTENT shifts on screen - panning left reveals what was
  // to the left, so the content moves right and the left control passes a positive dx.
  const panByFraction = useCallback((contentDx, contentDy) => {
    const viewport = viewportRef.current
    if (!viewport) {
      return
    }
    setView(
      prev =>
        prev && {
          ...prev,
          x: prev.x + contentDx * viewport.clientWidth * PAN_FRACTION,
          y: prev.y + contentDy * viewport.clientHeight * PAN_FRACTION,
        },
    )
  }, [])

  const handleFit = useCallback(() => {
    if (fitRef.current) {
      setView({ ...fitRef.current })
    }
  }, [])

  useEffect(() => {
    if (!controlsRef) {
      return
    }
    controlsRef.current = {
      zoomIn: () => zoomAtCentre(ZOOM_STEP_RATIO),
      zoomOut: () => zoomAtCentre(1 / ZOOM_STEP_RATIO),
      panUp: () => panByFraction(0, 1),
      panDown: () => panByFraction(0, -1),
      panLeft: () => panByFraction(1, 0),
      panRight: () => panByFraction(-1, 0),
      fit: handleFit,
    }
    return () => {
      controlsRef.current = null
    }
  }, [controlsRef, zoomAtCentre, panByFraction, handleFit])

  const handleWheel = useCallback(
    e => {
      e.preventDefault()
      const rect = viewportRef.current?.getBoundingClientRect()
      if (!rect) {
        return
      }
      zoomAt(
        e.deltaY < 0 ? ZOOM_STEP_RATIO : 1 / ZOOM_STEP_RATIO,
        e.clientX - rect.left,
        e.clientY - rect.top,
      )
    },
    [zoomAt],
  )

  const handlePointerDown = useCallback(
    e => {
      // A press on a control button is not a drag on the diagram - capturing the pointer here
      // would fight the button's own click handling.
      if (e.button !== 0 || !view || e.target.closest('.mermaid-zoom-controls')) {
        return
      }
      e.currentTarget.setPointerCapture(e.pointerId)
      dragStateRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        originX: view.x,
        originY: view.y,
      }
    },
    [view],
  )

  const handlePointerMove = useCallback(e => {
    const drag = dragStateRef.current
    if (!drag) {
      return
    }
    const dx = e.clientX - drag.startX
    const dy = e.clientY - drag.startY
    if (!drag.moved && Math.hypot(dx, dy) > DRAG_CLICK_THRESHOLD_PX) {
      drag.moved = true
    }
    if (drag.moved) {
      setView(prev => prev && { ...prev, x: drag.originX + dx, y: drag.originY + dy })
    }
  }, [])

  const handlePointerUp = useCallback(() => {
    if (dragStateRef.current?.moved && draggedRef) {
      draggedRef.current = true
      // Cleared next tick - only the click synthesized right after THIS pointerup (when the
      // release lands on the backdrop) should read as a drag-release, never a later one.
      setTimeout(() => {
        draggedRef.current = false
      }, 0)
    }
    dragStateRef.current = null
  }, [draggedRef])

  const atMin = view ? view.scale <= boundsRef.current.min : true
  const atMax = view ? view.scale >= boundsRef.current.max : true

  return (
    <div
      ref={viewportRef}
      className="mermaid-zoom-content"
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}>
      <div
        ref={contentRef}
        className="mermaid-zoom-inner"
        style={
          view
            ? { transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }
            : { visibility: 'hidden' }
        }
      />
      <div className="mermaid-zoom-controls">
        <button
          type="button"
          className="mermaid-zoom-btn"
          onClick={() => zoomAtCentre(1 / ZOOM_STEP_RATIO)}
          disabled={atMin}
          title="Zoom out">
          <Minus size={14} />
        </button>
        <button
          type="button"
          className="mermaid-zoom-btn"
          onClick={() => zoomAtCentre(ZOOM_STEP_RATIO)}
          disabled={atMax}
          title="Zoom in">
          <Plus size={14} />
        </button>
        <button type="button" className="mermaid-zoom-btn" onClick={handleFit} title="Fit to view">
          <Maximize size={14} />
        </button>
        <span className="mermaid-zoom-controls-separator" />
        <button
          type="button"
          className="mermaid-zoom-btn"
          onClick={() => panByFraction(1, 0)}
          title="Pan left">
          <ChevronLeft size={14} />
        </button>
        <button
          type="button"
          className="mermaid-zoom-btn"
          onClick={() => panByFraction(0, 1)}
          title="Pan up">
          <ChevronUp size={14} />
        </button>
        <button
          type="button"
          className="mermaid-zoom-btn"
          onClick={() => panByFraction(0, -1)}
          title="Pan down">
          <ChevronDown size={14} />
        </button>
        <button
          type="button"
          className="mermaid-zoom-btn"
          onClick={() => panByFraction(-1, 0)}
          title="Pan right">
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  )
}
