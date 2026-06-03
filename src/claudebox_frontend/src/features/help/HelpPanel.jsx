/** Help panel displaying keyboard shortcuts. */

/** Render help panel displaying keyboard shortcuts. */
export default function HelpPanel() {
  return (
    <div className="help-panel" data-testid="panel-help">
      <div className="help-columns">
        <table className="help-table">
          <tbody>
            <tr className="help-section">
              <td colSpan="2">Input</td>
            </tr>
            <tr>
              <td className="help-key">Enter</td>
              <td>Send message</td>
            </tr>
            <tr>
              <td className="help-key">Alt+Enter</td>
              <td>Queue message</td>
            </tr>
            <tr>
              <td className="help-key">Shift+Enter</td>
              <td>New line</td>
            </tr>
            <tr>
              <td className="help-key">Ctrl+.</td>
              <td>Interrupt</td>
            </tr>
            <tr>
              <td className="help-key">↑ / ↓</td>
              <td>History navigation</td>
            </tr>
            <tr>
              <td className="help-key">Ctrl+S</td>
              <td>Stash input</td>
            </tr>
            <tr>
              <td className="help-key">Ctrl+Shift+S</td>
              <td>Pop from stash</td>
            </tr>

            <tr className="help-section">
              <td colSpan="2">Auto-pairing</td>
            </tr>
            <tr>
              <td className="help-key">Ctrl+,</td>
              <td>Wrap in &lt;this&gt;&lt;/this&gt; tags</td>
            </tr>
            <tr>
              <td className="help-key">{`' " \` ( [ {`}</td>
              <td>Wrap selection with pair</td>
            </tr>
            <tr>
              <td className="help-key">Ctrl+&apos;</td>
              <td>Collapse nearest block</td>
            </tr>
            <tr>
              <td className="help-key">Ctrl+Shift+&apos;</td>
              <td>Collapse all blocks</td>
            </tr>
            <tr>
              <td className="help-key">Ctrl+\</td>
              <td>Expand nearest block</td>
            </tr>
            <tr>
              <td className="help-key">Ctrl+Shift+\</td>
              <td>Expand all blocks</td>
            </tr>

            <tr className="help-section">
              <td colSpan="2">Navigation</td>
            </tr>
            <tr>
              <td className="help-key">Alt+↑ / ↓</td>
              <td>Prev/next message</td>
            </tr>
            <tr>
              <td className="help-key">Alt+Home / End</td>
              <td>First/last message</td>
            </tr>
          </tbody>
        </table>

        <table className="help-table">
          <tbody>
            <tr className="help-section">
              <td colSpan="2">Session</td>
            </tr>
            <tr>
              <td className="help-key">Alt+N</td>
              <td>New session</td>
            </tr>
            <tr>
              <td className="help-key">Alt+Shift+N</td>
              <td>New session (browser tab)</td>
            </tr>

            <tr className="help-section">
              <td colSpan="2">Panels</td>
            </tr>
            <tr>
              <td className="help-key">Alt+C</td>
              <td>Focus Chat</td>
            </tr>
            <tr>
              <td className="help-key">Alt+0</td>
              <td>Toggle Logs</td>
            </tr>
            <tr>
              <td className="help-key">Alt+1</td>
              <td>Toggle Sessions</td>
            </tr>
            <tr>
              <td className="help-key">Alt+2</td>
              <td>Toggle Todos</td>
            </tr>
            <tr>
              <td className="help-key">Alt+3</td>
              <td>Toggle Stash</td>
            </tr>
            <tr>
              <td className="help-key">Alt+4</td>
              <td>Toggle Tasks</td>
            </tr>
            <tr>
              <td className="help-key">Alt+5</td>
              <td>Toggle Bookmarks</td>
            </tr>
            <tr>
              <td className="help-key">Alt+6</td>
              <td>Toggle Boards</td>
            </tr>
            <tr>
              <td className="help-key">Alt+7</td>
              <td>Toggle Usage</td>
            </tr>
            <tr>
              <td className="help-key">Alt+8</td>
              <td>Toggle MCP</td>
            </tr>
            <tr>
              <td className="help-key">Alt+9</td>
              <td>Toggle Skills</td>
            </tr>
            <tr>
              <td className="help-key">Alt+?</td>
              <td>Help overlay</td>
            </tr>
            <tr>
              <td className="help-key">Double-click tab</td>
              <td>Maximize panel</td>
            </tr>
            <tr>
              <td className="help-key">Middle-click tab</td>
              <td>Close panel</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
