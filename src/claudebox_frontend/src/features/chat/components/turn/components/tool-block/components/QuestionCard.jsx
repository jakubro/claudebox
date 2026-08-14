/** Shared layout for a single question: header, text, and options slot. */

/**
 * @param {React.ReactNode} props.header - Question number/label.
 * @param {string} props.question - Question text.
 * @param {React.ReactNode} props.children - Options content.
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
