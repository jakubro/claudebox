/** Interaction context - request lifecycle and error state. */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { sendMessage } from '../api/chat'
import { InterruptStatus } from '../config/schema'
import { ERROR_AUTO_CLEAR_MS, INTERRUPT_STOPPED_CLEAR_MS } from '../config/timing'
import { isDoneRespondingEvent, isRespondingEvent } from '../utils/eventPredicates'
import { useEvents } from './EventsContext'

const InteractionContext = createContext(null)

/**
 * Medium-frequency context - updates during submit/response cycles.
 *
 * @param {object} props
 * @param {React.ReactNode} props.children - Child components.
 */
export function InteractionProvider({ children }) {
  const { events } = useEvents()

  // Interaction state
  const [isSubmitting, setIsSubmitting] = useState(false) // POST in flight
  const [isAwaitingResponse, setIsAwaitingResponse] = useState(false) // POST succeeded, waiting for response
  const [awaitingResponseSince, setAwaitingResponseSince] = useState(null)
  const [interruptStatus, setInterruptStatus] = useState(null) // null | "stopping" | "stopped"
  const [errorMessage, setErrorMessage] = useState(null)

  // Set error message (clears other transient states)
  const setError = useCallback(message => {
    setErrorMessage(message)
    setIsSubmitting(false)
    setIsAwaitingResponse(false)
    setAwaitingResponseSince(null)
    setInterruptStatus(null)
  }, [])

  useEffect(() => {
    if (isAwaitingResponse && awaitingResponseSince && events.length > 0) {
      const lastEvent = events[events.length - 1]
      if (
        lastEvent.timestamp > awaitingResponseSince &&
        (isRespondingEvent(lastEvent) || isDoneRespondingEvent(lastEvent))
      ) {
        setIsAwaitingResponse(false)
        setAwaitingResponseSince(null)
      }
    }
  }, [events, isAwaitingResponse, awaitingResponseSince])

  // Track the last result event to detect turn completion
  const [lastResultTimestamp, setLastResultTimestamp] = useState(null)

  // Scans from the end since a result event may not be the last one - task notifications can follow it.
  useEffect(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i]
      if (isDoneRespondingEvent(e)) {
        if (!lastResultTimestamp || e.timestamp > lastResultTimestamp) {
          setLastResultTimestamp(e.timestamp)
        }
        break
      }
    }
  }, [events, lastResultTimestamp])

  // Clears "stopped" only once a result event arrives (not merely isResponding=false) - avoids
  // flashing back to "Working..." after an interrupt.
  useEffect(() => {
    if (interruptStatus === InterruptStatus.STOPPED && lastResultTimestamp) {
      // Turn completed - clear after short delay for visual feedback
      const timeout = setTimeout(() => {
        setInterruptStatus(null)
        setLastResultTimestamp(null)
      }, INTERRUPT_STOPPED_CLEAR_MS)
      return () => clearTimeout(timeout)
    }
  }, [interruptStatus, lastResultTimestamp])

  // Auto-clear error message after 4 seconds
  useEffect(() => {
    if (errorMessage) {
      const timeout = setTimeout(() => setErrorMessage(null), ERROR_AUTO_CLEAR_MS)
      return () => clearTimeout(timeout)
    }
  }, [errorMessage])

  // Interaction actions
  const startSubmitting = useCallback(() => {
    setIsSubmitting(true)
    setInterruptStatus(null)
    setAwaitingResponseSince(Date.now())
  }, [])

  const submitSucceeded = useCallback(() => {
    setIsSubmitting(false)
    setIsAwaitingResponse(true)
  }, [])

  const submitFailed = useCallback(() => {
    setIsSubmitting(false)
  }, [])

  const startInterrupt = useCallback(() => {
    setInterruptStatus(InterruptStatus.STOPPING)
  }, [])

  const completeInterrupt = useCallback(() => {
    setInterruptStatus(InterruptStatus.STOPPED)
    setIsSubmitting(false)
  }, [])

  // Submit a prompt programmatically (used by interactive tool responses)
  const submitPrompt = useCallback(
    async prompt => {
      if (!prompt?.trim()) {
        return
      }
      startSubmitting()
      try {
        await sendMessage(prompt)
        submitSucceeded()
      } catch (_err) {
        setIsSubmitting(false)
        setErrorMessage('Send failed')
      }
    },
    [startSubmitting, submitSucceeded],
  )

  const value = useMemo(
    () => ({
      isSubmitting,
      isAwaitingResponse,
      interruptStatus,
      errorMessage,
      startSubmitting,
      submitSucceeded,
      submitFailed,
      startInterrupt,
      completeInterrupt,
      setError,
      submitPrompt,
    }),
    [
      isSubmitting,
      isAwaitingResponse,
      interruptStatus,
      errorMessage,
      startSubmitting,
      submitSucceeded,
      submitFailed,
      startInterrupt,
      completeInterrupt,
      setError,
      submitPrompt,
    ],
  )

  return <InteractionContext.Provider value={value}>{children}</InteractionContext.Provider>
}

/** Access request lifecycle state and actions. */
export function useInteraction() {
  const context = useContext(InteractionContext)
  if (!context) {
    throw new Error('useInteraction must be used within InteractionProvider')
  }
  return context
}
