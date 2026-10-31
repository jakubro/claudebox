/** GeoJSON/TopoJSON block drawn as a map: shapes offline, OpenStreetMap tiles only on request. */

import { memo, useCallback, useEffect, useState } from 'react'
import useSettledFailure from '../../../hooks/useSettledFailure'
import { getCachedGeo, parseGeo } from '../../../utils/mapLoader'
import GeoMapCanvas from './GeoMapCanvas'
import SourceFallback from './SourceFallback'
import SourceToggleToolbar from './SourceToggleToolbar'

/**
 * @param {string} props.source - The block's raw text
 * @param {'geojson'|'topojson'} props.format
 */
function GeoMap({ source, format }) {
  const [geo, setGeo] = useState(() => getCachedGeo(source, format))
  const [failure, setFailure] = useState(null)
  const [showSource, setShowSource] = useState(false)
  const noticeVisible = useSettledFailure(failure ? source : null)

  useEffect(() => {
    let cancelled = false
    parseGeo(source, format).then(
      parsedGeo => {
        if (!cancelled) {
          setGeo(parsedGeo)
          setFailure(null)
        }
      },
      err => {
        if (!cancelled) {
          setGeo(null)
          setFailure(err.message)
        }
      },
    )
    return () => {
      cancelled = true
    }
  }, [source, format])

  const handleToggle = useCallback(() => setShowSource(s => !s), [])
  const handleFailure = useCallback(reason => setFailure(reason), [])

  if (failure !== null) {
    return (
      <SourceFallback
        source={source}
        language="json"
        prefix="Map failed to draw"
        reason={failure}
        noticeVisible={noticeVisible}
      />
    )
  }

  return (
    <div className="geo-map drawn-block">
      <SourceToggleToolbar
        source={source}
        showSource={showSource}
        onToggle={handleToggle}
        drawnTitle="Show map"
      />
      {showSource ? (
        <SourceFallback source={source} language="json" noticeVisible={false} />
      ) : geo ? (
        <GeoMapCanvas geo={geo} source={source} onFailure={handleFailure} />
      ) : (
        <div className="drawn-block-loading">Drawing map...</div>
      )}
    </div>
  )
}

// Memoized on the source - a remount would drop the drawn map, its view and the tile choice.
export default memo(GeoMap)
