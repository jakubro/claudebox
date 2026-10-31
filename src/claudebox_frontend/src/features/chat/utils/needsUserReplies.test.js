/** Tests for activeTurnReplies. */

import { describe, expect, it } from 'vitest'
import { activeTurnReplies } from './needsUserReplies'

const ask = (content, extra = {}) => ({ subtype: 'tool_use', content, ...extra })
const session = {
  session_id: 's1',
  needs_user: 'Approve: file it',
  needs_user_replies: ['Go', 'Hold'],
}

describe('activeTurnReplies', () => {
  it.each(['mcp__claudebox__needs_user', 'needs_user'])(
    'offers the replies after a %s call',
    name => {
      expect(activeTurnReplies(session, 's1', [ask(name)], false)).toEqual(['Go', 'Hold'])
    },
  )

  it('offers nothing once the session no longer needs the user', () => {
    const cleared = { ...session, needs_user: null }

    expect(activeTurnReplies(cleared, 's1', [ask('needs_user')], false)).toBeNull()
  })

  it('offers nothing for another session than the one on screen', () => {
    expect(activeTurnReplies(session, 's2', [ask('needs_user')], false)).toBeNull()
  })

  it('offers nothing while a sent message awaits confirmation', () => {
    expect(activeTurnReplies(session, 's1', [ask('needs_user')], true)).toBeNull()
  })

  it('offers nothing on a turn whose own events carry no needs_user call', () => {
    expect(activeTurnReplies(session, 's1', [ask('Bash')], false)).toBeNull()
  })

  it('offers nothing when a question follows the call', () => {
    const events = [ask('needs_user'), ask('AskUserQuestion')]

    expect(activeTurnReplies(session, 's1', events, false)).toBeNull()
  })

  it('ignores a call a subagent makes', () => {
    const events = [ask('needs_user', { parent_tool_use_id: 'task-1' })]

    expect(activeTurnReplies(session, 's1', events, false)).toBeNull()
  })
})
