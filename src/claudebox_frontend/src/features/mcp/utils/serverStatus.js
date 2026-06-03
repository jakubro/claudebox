/** MCP server status helpers. */

/** Map server status to CSS class for the status dot. */
export function statusClass(status) {
  switch (status) {
    case 'connected':
      return 'connected'
    case 'disabled':
      return 'disabled'
    case 'pending':
    case 'needs-auth':
      return 'pending'
    default:
      return 'disconnected'
  }
}
