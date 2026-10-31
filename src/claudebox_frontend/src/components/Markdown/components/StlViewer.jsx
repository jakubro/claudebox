/** STL block drawn as an interactive 3D model, entirely in the browser. */

import { memo, useCallback, useState } from 'react'
import useSettledFailure from '../../../hooks/useSettledFailure'
import SourceFallback from './SourceFallback'
import SourceToggleToolbar from './SourceToggleToolbar'
import StlCanvas from './StlCanvas'

/** @param {string} props.source - The block's raw text */
function StlViewer({ source }) {
  // Kept with the source that failed, so a block still streaming in gets a fresh attempt per flush.
  const [failed, setFailed] = useState(null)
  const [showSource, setShowSource] = useState(false)
  const failure = failed?.source === source ? failed.reason : null
  const noticeVisible = useSettledFailure(failure === null ? null : source)

  const handleToggle = useCallback(() => setShowSource(s => !s), [])
  const handleFailure = useCallback(reason => setFailed({ source, reason }), [source])

  if (failure !== null) {
    return (
      <SourceFallback
        source={source}
        language="plaintext"
        prefix="Model failed to draw"
        reason={failure}
        noticeVisible={noticeVisible}
      />
    )
  }

  return (
    <div className="stl-viewer drawn-block">
      <SourceToggleToolbar
        source={source}
        showSource={showSource}
        onToggle={handleToggle}
        drawnTitle="Show model"
      />
      {showSource ? (
        <SourceFallback source={source} language="plaintext" noticeVisible={false} />
      ) : (
        <StlCanvas source={source} onFailure={handleFailure} />
      )}
    </div>
  )
}

// Memoized on the source - a remount would rebuild the scene and lose the reader's view.
export default memo(StlViewer)
