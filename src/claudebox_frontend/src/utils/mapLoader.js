/** Lazy Leaflet loader and GeoJSON/TopoJSON parsing for map blocks, with per-source caches. */

const GEOJSON_TYPES = new Set([
  'FeatureCollection',
  'Feature',
  'Point',
  'MultiPoint',
  'LineString',
  'MultiLineString',
  'Polygon',
  'MultiPolygon',
  'GeometryCollection',
])

let leafletPromise = null
const parsed = new Map()
// Maps the reader opted into tiles, by block source; lasts until the page reloads.
const tileOptIns = new Set()

/** Load Leaflet and its stylesheet once, on the first map block. */
export function loadLeaflet() {
  leafletPromise ??= Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css')]).then(
    ([module]) => module.default ?? module,
  )
  return leafletPromise
}

/** The cached GeoJSON for a block already parsed, or null. */
export function getCachedGeo(source, format) {
  return parsed.get(`${format}\n${source}`) ?? null
}

/**
 * Parse a block to GeoJSON - a topology's objects each converted with topojson-client - or reject
 * with a short reason when it is not JSON, not GeoJSON, or a topology with no objects.
 * @param {string} source
 * @param {'geojson'|'topojson'} format
 * @returns {Promise<object>}
 */
export async function parseGeo(source, format) {
  const key = `${format}\n${source}`
  if (parsed.has(key)) {
    return parsed.get(key)
  }
  let data
  try {
    data = JSON.parse(source)
  } catch {
    throw new Error('not valid JSON')
  }
  const geo = format === 'topojson' ? await topologyToGeo(data) : checkedGeo(data)
  parsed.set(key, geo)
  return geo
}

/** Whether the reader asked for tiles on the map drawn from `source`. */
export function hasTileOptIn(source) {
  return tileOptIns.has(source)
}

export function recordTileOptIn(source) {
  tileOptIns.add(source)
}

function checkedGeo(data) {
  if (!GEOJSON_TYPES.has(data?.type)) {
    throw new Error('not GeoJSON')
  }
  return data
}

async function topologyToGeo(data) {
  const objects = data?.type === 'Topology' ? Object.values(data.objects ?? {}) : []
  if (objects.length === 0) {
    throw new Error('not a TopoJSON topology with objects')
  }
  const { feature } = await import('topojson-client')
  const features = objects.flatMap(object => {
    const converted = feature(data, object)
    return converted.type === 'FeatureCollection' ? converted.features : [converted]
  })
  return { type: 'FeatureCollection', features }
}
