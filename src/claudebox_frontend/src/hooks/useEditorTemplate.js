/** Hook for reading the workspace's configured "open in editor" URI template. */

import useSessionDefaults from './useSessionDefaults'

/**
 * Unlike useCapabilities, an absent value hides the affordance - there's no permissive default.
 *
 * @returns {string | null}
 */
export default function useEditorTemplate() {
  const sessionDefaults = useSessionDefaults()
  return sessionDefaults?.editor_url_template ?? null
}
