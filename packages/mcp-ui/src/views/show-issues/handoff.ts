/**
 * Handing the selected issues to the assistant with one message. Pure: the
 * wiring builds the prompt and sends it for `sendMessage`, then reports back
 * with `sent` or `sendFailed`.
 */
import type { Transition } from '../../shared/use-machine';
import type { IssueSummary } from './issues-schema';

export type Handoff =
  | { status: 'idle' }
  | { status: 'sending' }
  /**
   * The host took the message. It may still ask the user before sending it,
   * so this means "handed to chat", not "sent".
   */
  | { status: 'handed' }
  | { status: 'failed'; message: string };

/** How the user hands the selected issues to the assistant on this host. */
export type ReviewAction =
  /** The host takes messages from the view: Review sends one. */
  | { kind: 'message'; review: () => void }
  /**
   * It doesn't: a hint says to ask in the chat. `sharesSelection` when the
   * host shows the assistant the selection (`updateModelContext`).
   */
  | { kind: 'hint'; sharesSelection: boolean };

export type HandoffEvent =
  /** The user pressed Review with these issues selected. */
  | { type: 'send'; issues: IssueSummary[] }
  | { type: 'sent' }
  | { type: 'sendFailed'; message: string };

export type HandoffEffect =
  | { type: 'sendMessage'; issues: IssueSummary[] }
  /** On success only: on failure the selection stays for another try. */
  | { type: 'clearSelection' };

export const initialHandoff: Handoff = { status: 'idle' };

export const handoffTransition: Transition<
  Handoff,
  HandoffEvent,
  HandoffEffect
> = (state, event) => {
  switch (event.type) {
    case 'send':
      // One send at a time, and only with something to send.
      if (state.status === 'sending' || !event.issues.length) return null;
      return {
        state: { status: 'sending' },
        effects: [{ type: 'sendMessage', issues: event.issues }],
      };
    case 'sent':
      if (state.status !== 'sending') return null;
      return {
        state: { status: 'handed' },
        effects: [{ type: 'clearSelection' }],
      };
    case 'sendFailed':
      if (state.status !== 'sending') return null;
      return { state: { status: 'failed', message: event.message } };
  }
};
