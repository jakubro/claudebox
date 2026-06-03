/** Cross-workspace container list — bottom-left slot panel. */

import { useMemo } from 'react'
import ContainerRow from './ContainerRow'
import useContainerList from './hooks/useContainerList'

/** State group sort order — running first, dead-but-tracked last. */
const STATE_ORDER = {
  running: 0,
  starting: 1,
  stopping: 2,
  crashed: 3,
  stopped: 4,
}

function ContainersPanel() {
  const { containers, error, loading } = useContainerList()

  // Sort by state group, then newest first within each group.
  const sorted = useMemo(() => {
    return [...containers].sort((a, b) => {
      const stateA = STATE_ORDER[a.status] ?? 99
      const stateB = STATE_ORDER[b.status] ?? 99
      if (stateA !== stateB) {
        return stateA - stateB
      }
      return (b.created_at || '').localeCompare(a.created_at || '')
    })
  }, [containers])

  if (error) {
    return (
      <div className="containers-panel containers-error" data-testid="panel-containers">
        Failed to load containers
      </div>
    )
  }

  if (loading && containers.length === 0) {
    return (
      <div className="containers-panel containers-loading" data-testid="panel-containers">
        Loading...
      </div>
    )
  }

  if (containers.length === 0) {
    return (
      <div className="containers-panel containers-empty" data-testid="panel-containers">
        No containers
      </div>
    )
  }

  return (
    <div className="containers-panel" data-testid="panel-containers">
      <div className="containers-list">
        {sorted.map(c => (
          <ContainerRow key={c.id} container={c} />
        ))}
      </div>
    </div>
  )
}

export default ContainersPanel
