/**
 * The issues view's top-level state. Active, it holds the list, the
 * selection and the handoff. Retired, once a newer issues view of the same
 * project has opened (`shared/use-supersession.ts`), it holds none of them:
 * a retired view cannot fetch, send a prompt or share a selection, because
 * every event but the one that retires it is refused. No flag has to be
 * checked before each call. Pure: the wiring runs the effects.
 */
import type { Transition } from '../../shared/use-machine';
import {
  type Handoff,
  type HandoffEffect,
  type HandoffEvent,
  handoffTransition,
  initialHandoff,
} from './handoff';
import {
  type Effect as ListEffect,
  type Event as ListEvent,
  initialIssuesList,
  issuesListTransition,
  type State as ListState,
} from './issues-list';
import type { IssueSummary, IssueType } from './issues-schema';
import {
  emptySelection,
  type Selection,
  type SelectionEvent,
  selectionReducer,
} from './selection';

export type ViewState =
  | {
      status: 'active';
      list: ListState;
      selection: Selection;
      handoff: Handoff;
    }
  | {
      status: 'retired';
      /** The rows that were on screen, kept only to draw them greyed. */
      shown: readonly IssueSummary[];
    };

export type ViewEvent =
  | { type: 'list'; event: ListEvent }
  | { type: 'selection'; event: SelectionEvent }
  | { type: 'handoff'; event: HandoffEvent }
  /** A newer issues view of the same project has opened. */
  | { type: 'retire'; shown: readonly IssueSummary[] };

export type ViewEffect =
  | ListEffect
  | Extract<HandoffEffect, { type: 'sendMessage' }>
  /** The view is no longer current: take back what it shared with the model. */
  | { type: 'clearModelContext' };

export const initialViewState = (type: IssueType): ViewState => ({
  status: 'active',
  list: initialIssuesList(type),
  selection: emptySelection,
  handoff: initialHandoff,
});

export const viewTransition: Transition<ViewState, ViewEvent, ViewEffect> = (
  state,
  event
) => {
  if (state.status === 'retired') return null;
  switch (event.type) {
    case 'list': {
      const next = issuesListTransition(state.list, event.event);
      if (!next) return null;
      return { state: { ...state, list: next.state }, effects: next.effects };
    }
    case 'selection': {
      const selection = selectionReducer(state.selection, event.event);
      if (selection === state.selection) return null;
      return { state: { ...state, selection } };
    }
    case 'handoff': {
      const next = handoffTransition(state.handoff, event.event);
      if (!next) return null;
      let { selection } = state;
      const effects: ViewEffect[] = [];
      for (const effect of next.effects ?? []) {
        // The selection is part of this state, so clearing it is no effect.
        if (effect.type === 'clearSelection') {
          selection = selectionReducer(selection, { type: 'cleared' });
        } else {
          effects.push(effect);
        }
      }
      return { state: { ...state, handoff: next.state, selection }, effects };
    }
    case 'retire':
      return {
        state: { status: 'retired', shown: event.shown },
        effects: [{ type: 'clearModelContext' }],
      };
  }
};
