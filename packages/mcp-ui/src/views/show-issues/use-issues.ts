/**
 * The issues view's wiring: runs the view's state machine (the list, the
 * selection and the handoff, until a newer view retires this one), performs
 * its effects (server calls, messages and model context), holds the visible
 * page, and shares the selection with the model. The only place in the view
 * that catches errors: each failure becomes an event, and the machine keeps
 * the message in state for the components to draw.
 */
import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { ToolCallError } from '../../shared/call-tool';
import { MessageTooLongError } from '../../shared/message-limits';
import { useMachine } from '../../shared/use-machine';
import type { McpView } from '../../shared/use-mcp-view';
import { useSupersession } from '../../shared/use-supersession';
import type { Handoff, HandoffEvent } from './handoff';
import { fetchIssuesPage } from './issues-client';
import {
  type Event,
  type Listing,
  type PageRequest,
  type PageWindow,
  pageSizeFor,
  pageWindow,
} from './issues-list';
import {
  type IssueSummary,
  type IssueType,
  type ParsedPromptContext,
  parseViewData,
} from './issues-schema';
import { reviewIssuesPrompt } from './prompts';
import type { Reload } from './refresh-tool';
import { type Selection, selectionContext } from './selection';
import {
  initialViewState,
  type ViewEffect,
  type ViewEvent,
  type ViewState,
  viewTransition,
} from './view-state';

const ISSUE_TYPES: readonly IssueType[] = [
  'all',
  'security',
  'performance',
  'health',
];

/** The `type` `show_issues` was called with; the server's default is `all`. */
export function issueTypeOf(input: Record<string, unknown> | undefined) {
  const type = input?.type;
  return ISSUE_TYPES.find((known) => known === type) ?? 'all';
}

/** This view's name on the channel that retires older views. */
const VIEW_NAME = 'show-issues';

export const TOO_LONG_MESSAGE =
  'That is too many issues for one message. Select fewer issues.';
const CANCELLED_MESSAGE = 'The request was cancelled.';
const NO_TOOL_CALLS_MESSAGE = "This host can't load more issues.";
const NO_MESSAGES_MESSAGE = "This host can't take messages from the view.";

const errorMessage = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

/** How a page fetch ended, as the event the list machine gets. */
type PageOutcome = Extract<Event, { type: 'pageLoaded' | 'pageFailed' }>;

/** The issues in a ready listing, if known: the total, or all are loaded. */
function listingCount(listing: Listing) {
  if (listing.status !== 'ready') return undefined;
  return (
    listing.total ??
    (listing.tail.status === 'end' ? listing.items.length : undefined)
  );
}

export type ActiveIssuesView = {
  status: 'active';
  type: IssueType;
  listing: Listing;
  /**
   * Why the tool call that opened the view gave no list: it failed, was
   * cancelled, or its result couldn't be read. Only while nothing has
   * replaced it (a refresh does).
   */
  unavailable?: string;
  /** The rows of the visible page, and where it sits. */
  visiblePage: PageWindow;
  pageSize: number;
  /** The list has more than one page, so it keeps a full page's height. */
  multiPage: boolean;
  /**
   * More issues exist than were delivered, and this host can't load them.
   * `total` is absent when the server didn't send it.
   */
  partial?: { shown: number; total?: number };
  /** Loading the first page or the next one. */
  busy: boolean;
  selection: Selection;
  handoff: Handoff;
  /** Whether the host sees the selection (`updateModelContext`). */
  sharesSelection: boolean;
  previous: () => void;
  next: () => void;
  toggle: (issue: IssueSummary) => void;
  clear: () => void;
  /** Reloads from the first page. Undefined when the host can't call tools. */
  refresh: (() => void) | undefined;
  /** Retries what failed. Undefined when the host can't call tools. */
  retry: (() => void) | undefined;
  /**
   * Hands the selected issues to the assistant. Undefined when the host
   * can't take messages from the view.
   */
  review: (() => void) | undefined;
  /**
   * Refreshes as the button does, and settles once the first page is in,
   * with the counts before and after (for `refresh_issues_view`). Undefined
   * when the host can't call tools.
   */
  reload: Reload | undefined;
};

/**
 * A newer issues view of the same project has opened. This one does nothing
 * more: it only shows the rows it had on screen, greyed.
 */
export type RetiredIssuesView = {
  status: 'retired';
  shown: readonly IssueSummary[];
};

export type IssuesView = ActiveIssuesView | RetiredIssuesView;

/**
 * State and actions for the issues view, from the `useMcpView` connection and
 * the `type` `show_issues` was called with (see `issueTypeOf`). The type is
 * fixed for the hook's life: remount (with a `key`) if it changes.
 */
export function useIssues(view: McpView<unknown>, type: IssueType): IssuesView {
  const {
    toolCall,
    inputText,
    hostContext,
    callTool,
    sendMessage,
    updateModelContext,
  } = view;
  // Only from the tool input: a project-scoped server has no `project_id`.
  const projectId = inputText('project_id');

  // Keyed on the data, not `toolCall`, which can be a new object each render.
  const raw = toolCall.status === 'ready' ? toolCall.data : undefined;
  const delivered = useMemo(() => {
    if (raw === undefined) return undefined;
    try {
      return { result: parseViewData(raw, projectId) };
    } catch (err) {
      return { error: errorMessage(err) };
    }
  }, [raw, projectId]);

  const context: ParsedPromptContext | undefined =
    delivered?.result?.data.context ??
    (projectId ? { project: { id: projectId } } : undefined);

  /** Reads one page from the server, as the event for the list machine. */
  async function readPage(request: PageRequest): Promise<PageOutcome> {
    if (!callTool) {
      return { type: 'pageFailed', request, message: NO_TOOL_CALLS_MESSAGE };
    }
    try {
      const { page, dropped } = await fetchIssuesPage(callTool, {
        type: request.type,
        cursor: request.cursor,
        projectId,
      });
      return { type: 'pageLoaded', request, page, dropped };
    } catch (err) {
      return {
        type: 'pageFailed',
        request,
        message: errorMessage(err),
        code: err instanceof ToolCallError ? err.code : undefined,
      };
    }
  }

  // The first-page fetch in flight, if any, for a reload to wait on.
  const firstPage = useRef<Promise<PageOutcome>>(undefined);

  /** Builds the prompt for `issues` and sends it as the user. */
  async function handOff(
    issues: IssueSummary[],
    send: (event: HandoffEvent) => void
  ) {
    if (!sendMessage) {
      send({ type: 'sendFailed', message: NO_MESSAGES_MESSAGE });
      return;
    }
    try {
      await sendMessage(reviewIssuesPrompt(context, issues));
      send({ type: 'sent' });
    } catch (err) {
      send({
        type: 'sendFailed',
        message:
          err instanceof MessageTooLongError
            ? TOO_LONG_MESSAGE
            : errorMessage(err),
      });
    }
  }

  const [state, send] = useMachine<ViewState, ViewEvent, ViewEffect>(
    viewTransition,
    initialViewState(type),
    (effect, send) => {
      switch (effect.type) {
        case 'fetchPage': {
          const loading = readPage(effect.request).then((event) => {
            send({ type: 'list', event });
            return event;
          });
          if (effect.request.cursor === null) {
            firstPage.current = loading;
            void loading.then(() => {
              if (firstPage.current === loading) firstPage.current = undefined;
            });
          }
          break;
        }
        case 'sendMessage':
          void handOff(effect.issues, (event) =>
            send({ type: 'handoff', event })
          );
          break;
        case 'clearModelContext':
          // Best effort, as when sharing the selection.
          updateModelContext?.({ content: [] }).catch(() => {});
          break;
      }
    }
  );
  const active = state.status === 'active' ? state : undefined;
  const sendList = (event: Event) => send({ type: 'list', event });

  useEffect(() => {
    const result = delivered?.result;
    if (result) {
      send({
        type: 'list',
        event: {
          type: 'delivered',
          page: result.data.page,
          dropped: result.dropped,
        },
      });
    }
  }, [delivered, send]);

  // Each update replaces the last, so the whole selection goes every time. An
  // empty one clears what was shared; nothing is sent before anything was.
  // A retired view has no selection, and shares nothing.
  const selection = active?.selection;
  const shared = useRef(false);
  const shareSelection = useEffectEvent((current: Selection | undefined) => {
    if (!current || !updateModelContext) return;
    if (!current.size && !shared.current) return;
    shared.current = current.size > 0;
    // Best effort: the selection is also in the Review message, and a failed
    // update has nothing the user could do about it.
    updateModelContext(selectionContext(current)).catch(() => {});
  });
  useEffect(() => shareSelection(selection), [selection]);

  // The visible page is view state: Previous and Next move it, and the list
  // machine only learns that more rows are needed (`more`).
  const [page, setPage] = useState(0);
  const pageSize = pageSizeFor(hostContext?.containerDimensions);
  /** The listing as drawn, and the window of it on screen. */
  const windowOf = (listing: Listing) => {
    // Without tool calls, the delivered rows are all there will be.
    const shown: Listing =
      !callTool && listing.status === 'ready'
        ? { ...listing, tail: { status: 'end' } }
        : listing;
    return { shown, visiblePage: pageWindow(shown, page, pageSize) };
  };

  // Next past the loaded rows (or a smaller page size) needs the next server
  // page. A failed tail doesn't ask again by itself: its Retry does.
  const needsMore =
    !!active && windowOf(active.list.listing).visiblePage.needsMore;
  useEffect(() => {
    if (needsMore) send({ type: 'list', event: { type: 'more' } });
  }, [needsMore, send]);

  // A newer issues view of this project retires this one. It keeps the rows
  // on screen, to draw them greyed.
  const opened = delivered?.result?.data.opened;
  const superseded = useSupersession(
    { view: VIEW_NAME, project: opened?.project },
    opened?.at
  );
  const retire = useEffectEvent(() => {
    if (!active) return;
    const { rows } = windowOf(active.list.listing).visiblePage;
    send({ type: 'retire', shown: rows.status === 'ready' ? rows.items : [] });
  });
  useEffect(() => {
    if (superseded) retire();
  }, [superseded]);

  if (state.status === 'retired') {
    return { status: 'retired', shown: state.shown };
  }

  const { listing } = state.list;
  const { shown: shownListing, visiblePage } = windowOf(listing);

  const multiPage =
    shownListing.status === 'ready' &&
    (shownListing.items.length > pageSize ||
      shownListing.tail.status !== 'end');

  const startOver = () => {
    setPage(0);
    sendList({ type: 'refresh' });
  };

  const reload: Reload = async () => {
    const before = listingCount(listing);
    startOver();
    // The refresh's fetch, or the first-page fetch already in flight.
    const loading = firstPage.current;
    if (!loading) throw new Error('The issues view did not reload.');
    const outcome = await loading;
    if (outcome.type === 'pageFailed') throw new Error(outcome.message);
    const { page } = outcome;
    return {
      before,
      after:
        page.total ??
        (page.next_cursor === null ? page.issues.length : undefined),
    };
  };

  const unavailable =
    listing.status === 'loading' && !listing.request
      ? toolCall.status === 'error'
        ? toolCall.message
        : toolCall.status === 'cancelled'
          ? (toolCall.reason ?? CANCELLED_MESSAGE)
          : delivered?.error
      : undefined;

  return {
    status: 'active',
    type,
    listing,
    unavailable,
    visiblePage,
    pageSize,
    multiPage,
    partial:
      !callTool && listing.status === 'ready' && listing.tail.status !== 'end'
        ? { shown: listing.items.length, total: listing.total }
        : undefined,
    busy:
      (listing.status === 'loading' && !unavailable) ||
      (listing.status === 'ready' && listing.tail.status === 'loading'),
    selection: state.selection,
    handoff: state.handoff,
    sharesSelection: !!updateModelContext,
    previous: () => setPage(Math.max(0, visiblePage.page - 1)),
    next: () => setPage(visiblePage.page + 1),
    toggle: (issue) =>
      send({ type: 'selection', event: { type: 'toggled', issue } }),
    clear: () => send({ type: 'selection', event: { type: 'cleared' } }),
    refresh: callTool && startOver,
    retry:
      callTool &&
      (() => {
        // A refresh that failed, or a rejected cursor, starts from page one.
        const restarts =
          listing.status !== 'ready' ||
          (listing.tail.status === 'failed' && listing.tail.restart);
        if (restarts) setPage(0);
        sendList({ type: 'retry' });
      }),
    review:
      sendMessage &&
      (() =>
        send({
          type: 'handoff',
          event: { type: 'send', issues: [...state.selection.values()] },
        })),
    reload: callTool && reload,
  };
}
