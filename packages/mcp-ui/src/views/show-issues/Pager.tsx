import '../../shared/button.css';

/** "1–5 of 23", or "1–5" when the total isn't known. */
export function rangeLabel(start: number, count: number, total?: number) {
  const range =
    count > 1 ? `${start + 1}–${start + count}` : String(start + count);
  return total === undefined ? range : `${range} of ${total}`;
}

/** Previous and Next, with the range of issues on the page between them. */
export function Pager({
  label,
  hasPrevious,
  hasNext,
  onPrevious,
  onNext,
}: {
  /** The page's range (see `rangeLabel`); absent while it has no rows. */
  label?: string;
  hasPrevious: boolean;
  hasNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return (
    <nav className="pager" aria-label="Issue pages">
      <span data-slot="range">{label}</span>
      <button
        type="button"
        data-size="sm"
        disabled={!hasPrevious}
        onClick={onPrevious}
      >
        Previous
      </button>
      <button type="button" data-size="sm" disabled={!hasNext} onClick={onNext}>
        Next
      </button>
    </nav>
  );
}
