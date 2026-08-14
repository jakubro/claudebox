/** Render structured question-answer pairs from user responses. */

import { Check } from 'lucide-react'

/** @param {Array<{header: string, text: string, answers: string[]}>} props.questions */
export default function QAResponseBlock({ questions }) {
  return (
    <div className="qa-response-block">
      <div className="qa-response-header">
        <Check size={14} />
        <span>Response</span>
      </div>
      <div className="qa-response-content">
        {questions.map((q, i) => (
          <div key={i} className="qa-item">
            <div className="qa-question">
              <span className="qa-header">{q.header}</span>
              <span className="qa-text">{q.text}</span>
            </div>
            <div className="qa-answers">
              {q.answers.map((a, j) => (
                <pre key={j} className="qa-answer" data-testid="qa-answer">
                  {a.endsWith('\n') ? `${a}\n` : a}
                </pre>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
