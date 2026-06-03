/** Hook for fetching Claude service status. */

import { useEffect, useRef, useState } from 'react'
import { STATUS_POLL_INTERVAL } from '../../../config/timing'
import { STATUS_URL } from '../../../config/urls'
import { formatClaudeStatusResponse } from '../utils/claudeStatus'

/** Fetch and poll Claude service status from status.claude.com. */
export default function useClaudeStatus() {
  const [status, setStatus] = useState({
    indicator: 'none',
    description: 'All Systems Operational',
    isLoading: true,
    error: false,
  })
  const intervalRef = useRef(null)

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const response = await fetch(STATUS_URL)
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }
        const data = await response.json()
        const { indicator, description } = formatClaudeStatusResponse(data)
        setStatus({ indicator, description, isLoading: false, error: false })
      } catch (e) {
        console.warn('useClaudeStatus: Failed to fetch status', e)
        setStatus(prev => ({ ...prev, isLoading: false, error: true }))
      }
    }

    fetchStatus()
    intervalRef.current = setInterval(fetchStatus, STATUS_POLL_INTERVAL)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }
  }, [])

  return status
}
