import '../../shared/button.css';
import { CheckIcon, SpinnerIcon } from '../../shared/icons';
import { Message } from '../../shared/Message';
import type { Handoff } from './handoff';

/** "Review these issues (3)". */
export const reviewLabel = (count: number) => `Review these issues (${count})`;

/**
 * How many issues are selected, Clear, and the button that hands them to the
 * assistant, with the result of the last hand-off. On a host that can't take
 * messages from the view, a hint replaces the button.
 */
export function SelectionBar({
  count,
  handoff,
  sharesSelection,
  onClear,
  onReview,
}: {
  count: number;
  handoff: Handoff;
  /** The host shares the selection with the assistant. */
  sharesSelection: boolean;
  onClear: () => void;
  /** Omit when the host can't take messages from the view. */
  onReview?: () => void;
}) {
  const sending = handoff.status === 'sending';
  return (
    <div className="selection-bar">
      <div data-slot="actions">
        {count > 0 && (
          <>
            <span data-slot="count">{count} selected</span>
            <button type="button" data-size="sm" onClick={onClear}>
              Clear
            </button>
          </>
        )}
        {onReview && (
          <button
            type="button"
            data-size="sm"
            className="primary"
            disabled={count === 0 || sending}
            onClick={onReview}
          >
            {sending && <SpinnerIcon size={12} />}
            {reviewLabel(count)}
          </button>
        )}
      </div>
      {!onReview && (
        <p data-slot="hint">
          {sharesSelection
            ? 'The assistant can see the issues you select. Ask it about them in the chat.'
            : 'Ask the assistant about these issues in the chat.'}
        </p>
      )}
      {handoff.status === 'failed' ? (
        <Message tone="error">{handoff.message}</Message>
      ) : (
        handoff.status === 'handed' &&
        count === 0 && (
          <p data-slot="handed">
            <CheckIcon size={12} />
            Handed to chat
          </p>
        )
      )}
    </div>
  );
}
