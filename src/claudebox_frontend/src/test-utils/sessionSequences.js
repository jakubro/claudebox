/** Attached-session id sequences the routing code produces, for per-session hook tests. */

/** A switch from A to B: the attached id passes through empty. */
export const SWITCH = ['A', null, 'B']

/** A resume of A: the attached id empties and returns to A. */
export const BOUNCE = ['A', null, 'A']

/** A new session C created from inside A. */
export const CREATE_FROM_A = ['A', null, 'C']
