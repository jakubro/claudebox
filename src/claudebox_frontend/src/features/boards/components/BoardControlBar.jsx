/** Board control bar — density toggle and other per-viewer board controls. */

import { List, Rows3 } from 'lucide-react'
import PanelControlBar from '../../../components/PanelControlBar/PanelControlBar'
import { useSessionRouting } from '../../../context/SessionRoutingContext'

/** Render the board control bar with the comfortable/terse density toggle. */
export default function BoardControlBar() {
  const { density, setDensity } = useSessionRouting()
  const isTerse = density === 'terse'
  return (
    <PanelControlBar>
      <div className="panel-control-group">
        <button
          type="button"
          className={`panel-control-btn${isTerse ? ' pressed' : ''}`}
          aria-pressed={isTerse}
          onClick={() => setDensity(isTerse ? 'comfortable' : 'terse')}
          title={isTerse ? 'Switch to comfortable layout' : 'Switch to terse layout'}>
          {isTerse ? <List size={12} /> : <Rows3 size={12} />}
        </button>
      </div>
    </PanelControlBar>
  )
}
