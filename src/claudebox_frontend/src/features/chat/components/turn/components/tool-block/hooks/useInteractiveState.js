/** Track interactive tool answer state and skip detection. */

import { useEffect, useMemo, useRef, useState } from 'react'
import { ToolName } from '../../../../../../../config/schema'
import { isInteractiveTool } from '../../../../../../../utils/eventPredicates'
import { useTurn } from '../../../hooks/useTurn'
import { parseAnswerLabel } from '../utils/answerLabel'
import { isAskUserAwaitingAnswer } from '../utils/toolBlockState'

/**
 * Consumes TurnContext for hasNextUserMessage, nextUserMessageIsFormResponse, nextUserMessage, hasPendingMessages.
 * @param {boolean} canRenderForm - Whether an AskUserQuestion form can actually render (capability + payload).
 * @param {string} plan - Plan content for ExitPlanMode.
 */
export default function useInteractiveState(toolName, canRenderForm, plan) {
  const { hasNextUserMessage, nextUserMessageIsFormResponse, nextUserMessage, hasPendingMessages } =
    useTurn()

  const [wasAnsweredLocally, setWasAnsweredLocally] = useState(false)
  const [wasSkippedLocally, setWasSkippedLocally] = useState(false)
  const [localAnswerLabel, setLocalAnswerLabel] = useState(null)

  // Question is answered if: already responded (from loaded data) OR answered this session
  const wasAnswered = hasNextUserMessage || wasAnsweredLocally || wasSkippedLocally

  const isInteractive = isInteractiveTool(toolName)

  // Skipped on resume: interactive tool with next message that's NOT a form response
  const wasSkippedOnResume = isInteractive && hasNextUserMessage && !nextUserMessageIsFormResponse

  // ExitPlanMode awaits response when plan is present and not yet answered
  const isPlanAwaitingAnswer = toolName === ToolName.EXIT_PLAN_MODE && plan && !wasAnswered

  const isToolAwaiting =
    isAskUserAwaitingAnswer(toolName, canRenderForm, wasAnswered) || isPlanAwaitingAnswer

  // Detect when user skips form by typing in chat instead (persist this state)
  const prevHasPendingRef = useRef(hasPendingMessages)
  useEffect(() => {
    // Transition: no pending -> has pending, while form is awaiting answer and not answered via form
    if (!prevHasPendingRef.current && hasPendingMessages && isToolAwaiting && !wasAnsweredLocally) {
      setWasSkippedLocally(true)
    }
    prevHasPendingRef.current = hasPendingMessages
  }, [hasPendingMessages, isToolAwaiting, wasAnsweredLocally])

  // User skipped form by typing in chat instead (local state OR detected on resume)
  const wasSkipped = wasSkippedLocally || wasSkippedOnResume

  // Extract answer label for ExitPlanMode summary (Approved/Rejected/Answered)
  const answerLabel = useMemo(() => {
    if (toolName !== ToolName.EXIT_PLAN_MODE || !wasAnswered) {
      return null
    }
    // Local submit: already extracted
    if (localAnswerLabel) {
      return localAnswerLabel
    }
    // Resume: parse from next user message
    return parseAnswerLabel(nextUserMessage)
  }, [toolName, wasAnswered, localAnswerLabel, nextUserMessage])

  return {
    wasAnswered,
    isAwaitingAnswer: isToolAwaiting,
    wasSkipped,
    answerLabel,
    wasAnsweredLocally,
    setWasAnsweredLocally,
    setWasSkippedLocally,
    localAnswerLabel,
    setLocalAnswerLabel,
  }
}
