/**
 * The issues view's wiring: runs the list and handoff machines, performs their
 * effects (server calls and messages), holds the selection and the visible
 * page, and shares the selection with the model. The only place in the view
 * that catches errors: each failure becomes an event, and the machines keep
 * the message in state for the components to draw.
 */
import {
  useEffect,
  useEffectEvent,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { MessageTooLongError } from '../../shared/message-limits';
import { useMachine } from '../../shared/use-machine';
import type { McpView } from '../../shared/use-mcp-view';
import {
  type Handoff,
  type HandoffEffect,
  type HandoffEvent,
  handoffTransition,
  initialHandoff,
} from './handoff';
import { fetchIssuesPage } from './issues-client';
import {
  type Effect,
  type Event,
  initialIssuesList,
  issuesListTransition,
  type Listing,
  type PageRequest,
  type PageWindow,
  pageSizeFor,
  type State as ListState,
  pageWindow,
} from './issues-list';
import {
  type IssueSummary,
  type IssueType,
  type ParsedPromptContext,
  parseViewData,
} from './issues-schema';
import { reviewIssuesPrompt } from './prompts';
import {
  emptySelection,
  type Selection,
  selectionContext,
  selectionReducer,
} from './selection';

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

export const TOO_LONG_MESSAGE =
  'That is too many issues for one message. Select fewer issues.';
const CANCELLED_MESSAGE = 'The request was cancelled.';
const NO_TOOL_CALLS_MESSAGE = "This host can't load more issues.";
const NO_MESSAGES_MESSAGE = "This host can't take messages from the view.";

const errorMessage = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

export type IssuesView = {
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
};

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

  /** Reads one page from the server and reports back to the list machine. */
  async function loadPage(request: PageRequest, send: (event: Event) => void) {
    if (!callTool) {
      send({ type: 'pageFailed', request, message: NO_TOOL_CALLS_MESSAGE });
      return;
    }
    try {
      const { page, dropped } = await fetchIssuesPage(callTool, {
        type: request.type,
        cursor: request.cursor,
        projectId,
      });
      send({ type: 'pageLoaded', request, page, dropped });
    } catch (err) {
      send({ type: 'pageFailed', request, message: errorMessage(err) });
    }
  }

  const [list, sendList] = useMachine<ListState, Event, Effect>(
    issuesListTransition,
    initialIssuesList(type),
    (effect, send) => {
      switch (effect.type) {
        case 'fetchPage':
          void loadPage(effect.request, send);
          break;
      }
    }
  );
  const { listing } = list;

  useEffect(() => {
    const result = delivered?.result;
    if (result) {
      sendList({
        type: 'delivered',
        page: result.data.page,
        dropped: result.dropped,
      });
    }
  }, [delivered, sendList]);

  const [selection, dispatchSelection] = useReducer(
    selectionReducer,
    emptySelection
  );

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

  const [handoff, sendHandoff] = useMachine<
    Handoff,
    HandoffEvent,
    HandoffEffect
  >(handoffTransition, initialHandoff, (effect, send) => {
    switch (effect.type) {
      case 'sendMessage':
        void handOff(effect.issues, send);
        break;
      case 'clearSelection':
        dispatchSelection({ type: 'cleared' });
        break;
    }
  });

  // Each update replaces the last, so the whole selection goes every time. An
  // empty one clears what was shared; nothing is sent before anything was.
  const shared = useRef(false);
  const shareSelection = useEffectEvent((current: Selection) => {
    if (!updateModelContext || (!current.size && !shared.current)) return;
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
  // Without tool calls, the delivered rows are all there will be.
  const shownListing: Listing =
    !callTool && listing.status === 'ready'
      ? { ...listing, tail: { status: 'end' } }
      : listing;
  const visiblePage = pageWindow(shownListing, page, pageSize);

  // Next past the loaded rows (or a smaller page size) needs the next server
  // page. A failed tail doesn't ask again by itself: its Retry does.
  const { needsMore } = visiblePage;
  useEffect(() => {
    if (needsMore) sendList({ type: 'more' });
  }, [needsMore, sendList]);

  const multiPage =
    shownListing.status === 'ready' &&
    (shownListing.items.length > pageSize ||
      shownListing.tail.status !== 'end');

  const startOver = () => {
    setPage(0);
    sendList({ type: 'refresh' });
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
    selection,
    handoff,
    sharesSelection: !!updateModelContext,
    previous: () => setPage(Math.max(0, visiblePage.page - 1)),
    next: () => setPage(visiblePage.page + 1),
    toggle: (issue) => dispatchSelection({ type: 'toggled', issue }),
    clear: () => dispatchSelection({ type: 'cleared' }),
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
      (() => sendHandoff({ type: 'send', issues: [...selection.values()] })),
  };
}
