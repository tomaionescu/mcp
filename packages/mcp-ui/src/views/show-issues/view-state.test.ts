import { describe, expect, it } from 'vitest';
import type { IssueSummary } from './issues-schema';
import { issueKey } from './selection';
import {
  initialViewState,
  type ViewEvent,
  type ViewState,
  viewTransition,
} from './view-state';

const issue: IssueSummary = {
  id: 'rls_disabled_in_public',
  category: 'security',
  title: 'RLS disabled in public',
  severity: 'critical',
  affected_count: 3,
};

/** Runs events in order; a refused one throws. */
function run(state: ViewState, ...events: ViewEvent[]) {
  let effects: unknown[] = [];
  for (const event of events) {
    const next = viewTransition(state, event);
    if (!next) throw new Error(`${event.type} not allowed`);
    state = next.state;
    effects = next.effects ?? [];
  }
  return { state, effects };
}

const active = (state: ViewState) => {
  if (state.status !== 'active') throw new Error('retired');
  return state;
};

const toggle: ViewEvent = {
  type: 'selection',
  event: { type: 'toggled', issue },
};

describe('view state', () => {
  it('runs the list machine and passes its effects on', () => {
    const { state, effects } = run(initialViewState('security'), {
      type: 'list',
      event: { type: 'refresh' },
    });
    expect(active(state).list.listing).toEqual({
      status: 'loading',
      request: { type: 'security', cursor: null },
    });
    expect(effects).toEqual([
      { type: 'fetchPage', request: { type: 'security', cursor: null } },
    ]);
  });

  it('refuses what the list machine refuses', () => {
    expect(
      viewTransition(initialViewState('all'), {
        type: 'list',
        event: { type: 'more' },
      })
    ).toBeNull();
  });

  it('clears the selection when the handoff succeeds', () => {
    const sent = run(
      initialViewState('all'),
      toggle,
      { type: 'handoff', event: { type: 'send', issues: [issue] } },
      { type: 'handoff', event: { type: 'sent' } }
    );
    expect(active(sent.state).selection.size).toBe(0);
    expect(active(sent.state).handoff).toEqual({ status: 'handed' });
    expect(sent.effects).toEqual([]);
  });

  it('keeps the selection when the handoff fails', () => {
    const { state } = run(
      initialViewState('all'),
      toggle,
      { type: 'handoff', event: { type: 'send', issues: [issue] } },
      { type: 'handoff', event: { type: 'sendFailed', message: 'No' } }
    );
    expect(active(state).selection.has(issueKey(issue))).toBe(true);
  });

  it('retires, dropping everything but the rows on screen, and clears the model context', () => {
    const { state, effects } = run(initialViewState('all'), toggle, {
      type: 'retire',
      shown: [issue],
    });
    expect(state).toEqual({ status: 'retired', shown: [issue] });
    expect(effects).toEqual([{ type: 'clearModelContext' }]);
  });

  it('refuses every event once retired', () => {
    const retired: ViewState = { status: 'retired', shown: [] };
    for (const event of [
      toggle,
      { type: 'list', event: { type: 'refresh' } },
      {
        type: 'list',
        event: {
          type: 'pageLoaded',
          request: { type: 'all', cursor: null },
          page: { issues: [issue], checks: [], next_cursor: null },
          dropped: 0,
        },
      },
      { type: 'handoff', event: { type: 'sent' } },
      { type: 'retire', shown: [issue] },
    ] satisfies ViewEvent[]) {
      expect(viewTransition(retired, event)).toBeNull();
    }
  });
});
