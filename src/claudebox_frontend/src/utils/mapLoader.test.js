/** Tests for map block parsing. */

import { describe, expect, it } from 'vitest'
import { parseGeo } from './mapLoader'

describe('parseGeo', () => {
  it('accepts a GeoJSON Feature, FeatureCollection or bare geometry as written', async () => {
    const point = '{"type":"Point","coordinates":[1,2]}'

    expect(await parseGeo(point, 'geojson')).toEqual({ type: 'Point', coordinates: [1, 2] })
  })

  it('converts every object of a topology into one FeatureCollection', async () => {
    const topology = JSON.stringify({
      type: 'Topology',
      arcs: [],
      objects: {
        a: { type: 'Point', coordinates: [1, 2] },
        b: { type: 'GeometryCollection', geometries: [{ type: 'Point', coordinates: [3, 4] }] },
      },
    })

    const geo = await parseGeo(topology, 'topojson')

    expect(geo.type).toBe('FeatureCollection')
    expect(geo.features.map(f => f.geometry.coordinates)).toEqual([
      [1, 2],
      [3, 4],
    ])
  })

  it.each([
    ['{ not json', 'geojson', 'not valid JSON'],
    ['{"type":"Banana"}', 'geojson', 'not GeoJSON'],
    ['{"type":"Topology","objects":{}}', 'topojson', 'not a TopoJSON topology with objects'],
    ['{"type":"Point","coordinates":[1,2]}', 'topojson', 'not a TopoJSON topology with objects'],
  ])('rejects %s as %s', async (source, format, reason) => {
    await expect(parseGeo(source, format)).rejects.toThrow(reason)
  })
})
