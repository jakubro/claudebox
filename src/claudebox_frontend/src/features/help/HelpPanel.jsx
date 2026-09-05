/** Help panel displaying keyboard shortcuts. */

import { Fragment } from 'react'
import { SHORTCUT_COLUMNS } from '../../config/shortcuts'

export default function HelpPanel() {
  return (
    <div className="help-panel" data-testid="panel-help">
      <div className="help-columns">
        {SHORTCUT_COLUMNS.map(sections => (
          <table className="help-table" key={sections[0].title}>
            <tbody>
              {sections.map(section => (
                <Fragment key={section.title}>
                  <tr className="help-section">
                    <td colSpan="2">{section.title}</td>
                  </tr>
                  {section.bindings.map(binding => (
                    <tr key={binding.keys}>
                      <td className="help-key">{binding.keys}</td>
                      <td>{binding.action}</td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        ))}
      </div>
    </div>
  )
}
