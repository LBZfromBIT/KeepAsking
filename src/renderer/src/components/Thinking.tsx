/** Shown until the first token of a reply arrives. */
export function Thinking() {
  return (
    <div className="thinking" aria-live="polite">
      <span className="thinking-spark" aria-hidden="true">
        ✻
      </span>
      <span className="thinking-shimmer">
        Thinking
        <span className="thinking-dots" aria-hidden="true" />
      </span>
    </div>
  );
}
