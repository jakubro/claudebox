/** Display component for already-answered questions in tool results. */

import QuestionCard from '../../QuestionCard'

/**
 * Render a list of answered questions as read-only cards.
 * @param {Object} props
 * @param {Array<{header: string, question: string, options?: Array}>} props.questions - Questions with their options.
 */
export default function QuestionsDisplay({ questions }) {
  return (
    <div className="tool-questions">
      {questions.map((q, i) => (
        <QuestionCard key={i} header={q.header} question={q.question}>
          {q.options?.map((opt, j) => (
            <div key={j} className="tool-question-option">
              <span className="tool-option-label">{opt.label}</span>
              {opt.description && <span className="tool-option-desc">{opt.description}</span>}
            </div>
          ))}
        </QuestionCard>
      ))}
    </div>
  )
}
