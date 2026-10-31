/** One relative time that keeps up with the clock, redrawing only itself. */

import useRelativeTime from '../hooks/useRelativeTime'

function RelativeTime({ date }) {
  return useRelativeTime(date)
}

export default RelativeTime
