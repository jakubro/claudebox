/** Leaflet view helpers for map blocks: fitting the shapes, and their properties as plain text. */

const SINGLE_POINT_ZOOM = 10
const FIT_PADDING = [16, 16]

const OSM_TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const OSM_ATTRIBUTION = '&copy; OpenStreetMap contributors'

/** Fit the map to `layer`; a lone point gets a fixed zoom, an empty layer the whole world. */
export function fitToLayer(map, layer) {
  const bounds = layer.getBounds()
  if (!bounds.isValid()) {
    map.setView([0, 0], 1)
  } else if (bounds.getNorthEast().equals(bounds.getSouthWest())) {
    map.setView(bounds.getCenter(), SINGLE_POINT_ZOOM)
  } else {
    map.fitBounds(bounds, { padding: FIT_PADDING })
  }
}

/** Add OpenStreetMap tiles under the map's shapes, with OpenStreetMap's attribution. */
export function addOsmTiles({ map, L }) {
  L.tileLayer(OSM_TILES, { maxZoom: 19, attribution: OSM_ATTRIBUTION }).addTo(map)
}

/** A popup body listing `key: value` lines as text nodes - property values are agent-written. */
export function propertiesPopup(properties) {
  const body = document.createElement('div')
  for (const [key, value] of Object.entries(properties)) {
    const line = document.createElement('div')
    line.textContent = `${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`
    body.append(line)
  }
  return body
}
