/** Tests for preferTicketCollisions - dnd-kit collision detection favoring tickets over cells. */

import { describe, expect, it } from 'vitest'
import { preferTicketCollisions } from './preferTicketCollisions'

/** Build real dnd-kit CollisionDetection args from plain droppable rects. */
function buildArgs({ rects, pointerCoordinates = null, collisionRect }) {
  const droppableRects = new Map(Object.entries(rects))
  const droppableContainers = Object.keys(rects).map(id => ({ id }))
  return { droppableContainers, droppableRects, pointerCoordinates, collisionRect }
}

describe('preferTicketCollisions', () => {
  it('filters out the containing cell when the pointer also hits a nested ticket', () => {
    const args = buildArgs({
      rects: {
        'tickets/a.md': { top: 0, left: 0, bottom: 100, right: 100, width: 100, height: 100 },
        'backlog:frontend': { top: 0, left: 0, bottom: 200, right: 200, width: 200, height: 200 },
      },
      pointerCoordinates: { x: 50, y: 50 },
    })
    const result = preferTicketCollisions(args)
    expect(result.map(c => c.id)).toEqual(['tickets/a.md'])
  })

  it('falls back to rect intersection when the pointer hits only a cell, not a ticket', () => {
    const args = buildArgs({
      rects: {
        'tickets/a.md': { top: 0, left: 0, bottom: 50, right: 50, width: 50, height: 50 },
        'backlog:frontend': { top: 0, left: 0, bottom: 200, right: 200, width: 200, height: 200 },
      },
      pointerCoordinates: { x: 150, y: 150 },
      collisionRect: { top: 140, left: 140, bottom: 160, right: 160, width: 20, height: 20 },
    })
    const result = preferTicketCollisions(args)
    expect(result.map(c => c.id)).toEqual(['backlog:frontend'])
  })

  it('falls back to rect intersection when there are no pointer coordinates at all', () => {
    const args = buildArgs({
      rects: {
        'backlog:frontend': { top: 0, left: 0, bottom: 200, right: 200, width: 200, height: 200 },
      },
      pointerCoordinates: null,
      collisionRect: { top: 10, left: 10, bottom: 30, right: 30, width: 20, height: 20 },
    })
    const result = preferTicketCollisions(args)
    expect(result.map(c => c.id)).toEqual(['backlog:frontend'])
  })

  it('returns no collisions when neither the pointer nor the rect overlap anything', () => {
    const args = buildArgs({
      rects: {
        'backlog:frontend': { top: 0, left: 0, bottom: 50, right: 50, width: 50, height: 50 },
      },
      pointerCoordinates: { x: 500, y: 500 },
      collisionRect: { top: 500, left: 500, bottom: 520, right: 520, width: 20, height: 20 },
    })
    expect(preferTicketCollisions(args)).toEqual([])
  })
})
