import '../../shared/button.css';
import { CheckIcon, SpinnerIcon } from '../../shared/icons';
import { Message } from '../../shared/Message';
import type { Handoff, ReviewAction } from './handoff';

/** "Review selected issues (3)". */
export const reviewLabel = (count: number) =>
  `Review selected issues (${count})`;

/**
 * How many issues are selected, Clear, and the button that hands them to the
 * assistant, with the result of the last hand-off. On a host that can't take
 * messages from the view, a hint replaces the button.
 */
export function SelectionBar({
  count,
  handoff,
  action,
  onClear,
}: {
  count: number;
  handoff: Handoff;
  action: ReviewAction;
  onClear: () => void;
}) {
  return (
    <div className="selection-bar">
      <div data-slot="actions">
        {count > 0 && <SelectedCount count={count} onClear={onClear} />}
        {action.kind === 'message' && (
          <ReviewButton count={count} handoff={handoff} {...action} />
        )}
      </div>
      {action.kind === 'hint' && <ReviewHint {...action} />}
      <HandoffResult handoff={handoff} count={count} />
    </div>
  );
}

/** "3 selected", and Clear. */
function SelectedCount({
  count,
  onClear,
}: {
  count: number;
  onClear: () => void;
}) {
  return (
    <>
      <span data-slot="count">{count} selected</span>
      <button type="button" data-size="sm" onClick={onClear}>
        Clear
      </button>
    </>
  );
}

/** "Review selected issues (N)", with a spinner while the hand-off is sent. */
function ReviewButton({
  count,
  handoff,
  review,
}: {
  count: number;
  handoff: Handoff;
} & Extract<ReviewAction, { kind: 'message' }>) {
  const sending = handoff.status === 'sending';
  return (
    <button
      type="button"
      data-size="sm"
      className="primary"
      disabled={count === 0 || sending}
      onClick={review}
    >
      {sending && <SpinnerIcon size={12} />}
      {reviewLabel(count)}
    </button>
  );
}

/** In place of the Review button, on a host that can't take messages. */
function ReviewHint({
  sharesSelection,
}: Extract<ReviewAction, { kind: 'hint' }>) {
  if (sharesSelection) {
    return (
      <p data-slot="hint">
        The assistant can see the issues you select. Ask it about them in the
        chat.
      </p>
    );
  }
  return (
    <p data-slot="hint">Ask the assistant about these issues in the chat.</p>
  );
}

/** Why the last hand-off failed, or that it was handed (once nothing is selected). */
function HandoffResult({
  handoff,
  count,
}: { handoff: Handoff; count: number }) {
  switch (handoff.status) {
    case 'failed':
      return <Message tone="error">{handoff.message}</Message>;
    case 'handed':
      if (count > 0) return null;
      return (
        <p data-slot="handed">
          <CheckIcon size={12} />
          Handed to chat
        </p>
      );
    case 'idle':
    case 'sending':
      return null;
    default:
      return handoff satisfies never;
  }
}
