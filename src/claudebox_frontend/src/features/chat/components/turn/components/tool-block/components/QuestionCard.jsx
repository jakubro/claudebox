/** Shared layout for a single question: header, text, and options slot. */

/**
 * Display a question with header, text, and option slots.
 * @param {Object} props
 * @param {string} props.header - Question header/title.
 * @param {string} props.question - Question text.
 * @param {React.ReactNode} props.children - Option elements to render.
 */
export default function QuestionCard({ header, question, children }) {
  return (
    <div className="tool-question">
      <div className="tool-question-header">{header}</div>
      <div className="tool-question-text">{question}</div>
      <div className="tool-question-options">{children}</div>
    </div>
  )
}
