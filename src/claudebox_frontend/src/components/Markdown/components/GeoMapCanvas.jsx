/** The Leaflet map of one map block: its shapes, their popups, and tiles once the reader asks. */

import { useCallback, useEffect, useRef, useState } from 'react'
import { hasTileOptIn, loadLeaflet, recordTileOptIn } from '../../../utils/mapLoader'
import { addOsmTiles, fitToLayer, propertiesPopup } from '../../../utils/mapView'

/**
 * @param {object} props.geo - Parsed GeoJSON to draw
 * @param {string} props.source - The block's raw text, which keys the tile opt-in
 * @param {function(string)} props.onFailure - Called with a short reason when the shapes cannot be drawn
 */
export default function GeoMapCanvas({ geo, source, onFailure }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const [tiles, setTiles] = useState(() => hasTileOptIn(source))

  useEffect(() => {
    let map = null
    let cancelled = false
    loadLeaflet().then(L => {
      if (cancelled || !containerRef.current) {
        return
      }
      map = L.map(containerRef.current, { scrollWheelZoom: false, minZoom: 1, maxZoom: 19 })
      map.attributionControl.setPrefix(false)
      const accent = getComputedStyle(containerRef.current).getPropertyValue('--accent').trim()
      let layer
      try {
        layer = L.geoJSON(geo, {
          style: () => ({ color: accent, weight: 2, fillOpacity: 0.2 }),
          pointToLayer: (_, latlng) =>
            L.circleMarker(latlng, { radius: 5, color: accent, fillOpacity: 0.8 }),
          onEachFeature: (feature, shape) => {
            if (feature.properties && Object.keys(feature.properties).length > 0) {
              shape.bindPopup(propertiesPopup(feature.properties))
            }
          },
        }).addTo(map)
      } catch {
        onFailure('invalid geometry')
        return
      }
      fitToLayer(map, layer)
      mapRef.current = { map, L }
      if (hasTileOptIn(source)) {
        addOsmTiles(mapRef.current)
      }
    })
    return () => {
      cancelled = true
      map?.remove()
      mapRef.current = null
    }
  }, [geo, source, onFailure])

  const handleLoadTiles = useCallback(() => {
    recordTileOptIn(source)
    if (mapRef.current) {
      addOsmTiles(mapRef.current)
    }
    setTiles(true)
  }, [source])

  return (
    <div className="geo-map-canvas-wrapper">
      <div ref={containerRef} className="geo-map-canvas" />
      {!tiles && (
        <button type="button" className="geo-map-load-tiles" onClick={handleLoadTiles}>
          Load map
        </button>
      )}
    </div>
  )
}
