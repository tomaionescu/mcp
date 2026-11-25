import '../../shared/button.css';
import { ChevronLeftIcon, ChevronRightIcon } from '../../shared/icons';

/** "1–5 of 23", or "1–5" when the total isn't known. */
export function rangeLabel(start: number, count: number, total?: number) {
  const range =
    count > 1 ? `${start + 1}–${start + count}` : String(start + count);
  return total === undefined ? range : `${range} of ${total}`;
}

/** The range of issues on the page, between previous and next chevrons. */
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
      <button
        type="button"
        data-size="sm"
        data-slot="step"
        aria-label="Previous page"
        title="Previous page"
        disabled={!hasPrevious}
        onClick={onPrevious}
      >
        <ChevronLeftIcon />
      </button>
      <span data-slot="range">{label}</span>
      <button
        type="button"
        data-size="sm"
        data-slot="step"
        aria-label="Next page"
        title="Next page"
        disabled={!hasNext}
        onClick={onNext}
      >
        <ChevronRightIcon />
      </button>
    </nav>
  );
}
