/** The current time, re-read on an interval so time-derived views stay live. */

import { useEffect, useState } from 'react'

export default function useNow(intervalMs) {
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(interval)
  }, [intervalMs])

  return now
}
