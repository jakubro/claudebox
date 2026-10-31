/** The name a session shows - the one given by hand, else the one a model wrote for it. */

/** Shown name, or null when the session has neither. */
export function displayName(session) {
  return session?.name || session?.auto_name || null
}

/** True when the shown name is the automatic one. */
export function isAutoNamed(session) {
  return !session?.name && Boolean(session?.auto_name)
}
