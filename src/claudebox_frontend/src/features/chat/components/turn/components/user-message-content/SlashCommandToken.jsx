/** Render a slash-command token in a user message with bold + hover-card styling. */

import {
  autoUpdate,
  FloatingPortal,
  flip,
  offset,
  safePolygon,
  shift,
  useDismiss,
  useFloating,
  useFocus,
  useHover,
  useInteractions,
  useRole,
} from '@floating-ui/react'
import { useMemo, useState } from 'react'
import { useSessionData } from '../../../../../../context/SessionDataContext'
import { categorizeCommands, flattenCommands } from '../../../../../../utils/categorize'
import CommandDetailPanel from '../../../chat-input/components/CommandDetailPanel'

/**
 * Render the leading slash-command token of a user message. Resolves the
 * command name against the workspace catalog (`SessionDataContext.commands`):
 * a recognised command renders bold + dotted-underline with a hover card
 * showing usage, description, and metadata; an unrecognised command renders
 * bold only with no hover affordance.
 *
 * @param {object} props
 * @param {string} props.cmd - Token from `parseSlashCommand`, including the leading `/`.
 */
export default function SlashCommandToken({ cmd }) {
  const { commands } = useSessionData()
  const [isOpen, setIsOpen] = useState(false)

  const lookup = useMemo(() => {
    const flat = flattenCommands(categorizeCommands(commands))
    const map = new Map()
    for (const entry of flat) {
      map.set(entry.name, entry)
    }
    return map
  }, [commands])

  const name = cmd.replace(/^\//, '')
  const resolved = lookup.get(name) || null
  const showCard = resolved !== null

  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    placement: 'top',
    middleware: [offset(6), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  })
  const hover = useHover(context, {
    enabled: showCard,
    delay: { open: 100, close: 100 },
    handleClose: safePolygon(),
  })
  const focus = useFocus(context, { enabled: showCard })
  const dismiss = useDismiss(context, { escapeKey: true })
  const role = useRole(context, { role: 'tooltip' })
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, focus, dismiss, role])

  const className = `slash-command ${resolved ? 'resolved' : 'unresolved'}`

  return (
    <>
      <span className={className} ref={refs.setReference} {...getReferenceProps()}>
        {cmd}
      </span>
      {showCard && isOpen && (
        <FloatingPortal>
          <div
            className="slash-command-hover-card"
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}>
            <CommandDetailPanel command={resolved} />
          </div>
        </FloatingPortal>
      )}
    </>
  )
}
