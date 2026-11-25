import { describe, expect, it } from 'vitest';
import {
  type Handoff,
  type HandoffEvent,
  handoffTransition,
  initialHandoff,
} from './handoff';
import type { IssueSummary } from './issues-schema';

const issues: IssueSummary[] = [
  {
    id: 'rls_disabled_in_public',
    category: 'security',
    title: 'RLS disabled in public',
    severity: 'critical',
    affected_count: 3,
  },
];
const send: HandoffEvent = { type: 'send', issues };
const sending: Handoff = { status: 'sending' };

describe('handoff machine', () => {
  it.each<[string, Handoff]>([
    ['idle', initialHandoff],
    ['handed', { status: 'handed' }],
    ['failed', { status: 'failed', message: 'x' }],
  ])('sends the selected issues from %s', (_, state) => {
    expect(handoffTransition(state, send)).toEqual({
      state: sending,
      effects: [{ type: 'sendMessage', issues }],
    });
  });

  it('sends nothing with nothing selected', () => {
    expect(
      handoffTransition(initialHandoff, { type: 'send', issues: [] })
    ).toBeNull();
  });

  it('sends one message at a time', () => {
    expect(handoffTransition(sending, send)).toBeNull();
  });

  it('clears the selection once the message is handed over', () => {
    expect(handoffTransition(sending, { type: 'sent' })).toEqual({
      state: { status: 'handed' },
      effects: [{ type: 'clearSelection' }],
    });
  });

  it('keeps the selection when the send fails', () => {
    expect(
      handoffTransition(sending, { type: 'sendFailed', message: 'Too long' })
    ).toEqual({ state: { status: 'failed', message: 'Too long' } });
  });

  it('ignores results when nothing is sending', () => {
    expect(handoffTransition(initialHandoff, { type: 'sent' })).toBeNull();
    expect(
      handoffTransition(initialHandoff, { type: 'sendFailed', message: 'x' })
    ).toBeNull();
  });
});
