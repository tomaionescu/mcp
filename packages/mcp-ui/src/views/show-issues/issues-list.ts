/**
 * What the issues view has loaded, is loading, or failed to load. Pure: the
 * wiring runs the `fetchPage` effects and sends back `pageLoaded` or
 * `pageFailed`. Which view page is on screen is view state, outside this
 * machine; `pageWindow` maps one onto the loaded items.
 */
import type { McpUiHostContext } from '@modelcontextprotocol/ext-apps';
import type { Transition } from '../../shared/use-machine';
import {
  type IssueCheck,
  type IssueCounts,
  type IssueSummary,
  type IssueType,
  issueKey,
  type ParsedIssuesPage,
} from './issues-schema';

/** One request to the server for a page of issues. */
export type PageRequest = { type: IssueType; cursor: string | null };

/** Whether more issues can be loaded after the ones in a ready listing. */
export type Tail =
  /** No more on the server. */
  | { status: 'end' }
  /** More exist, none requested. */
  | { status: 'more'; cursor: string }
  | { status: 'loading'; cursor: string }
  | {
      status: 'failed';
      cursor: string;
      message: string;
      /**
       * The server rejected the cursor (the list changed shape, or a server
       * of another version), so retrying loads the first page again.
       */
      restart: boolean;
    };

export type Listing =
  /**
   * The first page is on its way: `request` is the fetch it waits for, or
   * `null` while waiting for the tool result that opened the view.
   */
  | { status: 'loading'; request: PageRequest | null }
  | { status: 'failed'; message: string }
  | {
      status: 'ready';
      /** Everything loaded so far, in order, without repeats. */
      items: IssueSummary[];
      total?: number;
      counts?: IssueCounts;
      checks: IssueCheck[];
      /** When the first page was read: the oldest data on screen. */
      readAt?: string;
      /** Rows the parser could not read, across all pages. */
      dropped: number;
      tail: Tail;
    };

export type State = { type: IssueType; listing: Listing };

export type Event =
  /** The result of the tool call that opened the view arrived. */
  | { type: 'delivered'; page: ParsedIssuesPage; dropped: number }
  /** Load the next server page. */
  | { type: 'more' }
  | { type: 'retry' }
  | { type: 'refresh' }
  | {
      type: 'pageLoaded';
      request: PageRequest;
      page: ParsedIssuesPage;
      dropped: number;
    }
  | { type: 'pageFailed'; request: PageRequest; message: string };

export type Effect = { type: 'fetchPage'; request: PageRequest };

/** Shown when the server rejects the cursor; Retry starts over. */
export const LIST_CHANGED_MESSAGE =
  'The list changed. Retry to load it again from the start.';

/**
 * How the server's cursor error reads (`InvalidIssuesCursorError` in
 * mcp-server-supabase `src/issues-page.ts`): "The cursor is invalid or does
 * not match this request. …". The error reaches the view only as text, so it
 * is recognised by that phrase.
 */
const CURSOR_REJECTED = /\bcursor is invalid\b/i;

export const initialIssuesList = (type: IssueType): State => ({
  type,
  listing: { status: 'loading', request: null },
});

const sameRequest = (a: PageRequest, b: PageRequest) =>
  a.type === b.type && a.cursor === b.cursor;

/** Starts a new listing from the first page. */
function startOver(state: State) {
  const request: PageRequest = { type: state.type, cursor: null };
  return {
    state: { ...state, listing: { status: 'loading', request } as const },
    effects: [{ type: 'fetchPage', request } as const],
  };
}

const tailOf = (page: ParsedIssuesPage): Tail =>
  page.next_cursor
    ? { status: 'more', cursor: page.next_cursor }
    : { status: 'end' };

/** Appends `incoming` to `items`, skipping issues already there. */
function appendNew(items: IssueSummary[], incoming: IssueSummary[]) {
  const seen = new Set(items.map(issueKey));
  const added = incoming.filter((issue) => {
    const key = issueKey(issue);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return [...items, ...added];
}

function firstPage(page: ParsedIssuesPage, dropped: number): Listing {
  return {
    status: 'ready',
    items: appendNew([], page.issues),
    total: page.total,
    counts: page.counts,
    checks: page.checks,
    readAt: page.read_at,
    dropped,
    tail: tailOf(page),
  };
}

export const issuesListTransition: Transition<State, Event, Effect> = (
  state,
  event
) => {
  const { listing } = state;
  switch (event.type) {
    case 'delivered':
      if (listing.status !== 'loading' || listing.request) return null;
      return {
        state: { ...state, listing: firstPage(event.page, event.dropped) },
      };

    case 'more': {
      if (listing.status !== 'ready' || listing.tail.status !== 'more') {
        return null;
      }
      const { cursor } = listing.tail;
      return {
        state: {
          ...state,
          listing: { ...listing, tail: { status: 'loading', cursor } },
        },
        effects: [{ type: 'fetchPage', request: { type: state.type, cursor } }],
      };
    }

    case 'retry': {
      if (listing.status === 'failed') return startOver(state);
      if (listing.status !== 'ready' || listing.tail.status !== 'failed') {
        return null;
      }
      const { cursor, restart } = listing.tail;
      if (restart) return startOver(state);
      return {
        state: {
          ...state,
          listing: { ...listing, tail: { status: 'loading', cursor } },
        },
        effects: [{ type: 'fetchPage', request: { type: state.type, cursor } }],
      };
    }

    case 'refresh':
      // Already loading the first page: don't fetch it twice.
      if (listing.status === 'loading' && listing.request) return null;
      return startOver(state);

    case 'pageLoaded': {
      if (
        listing.status === 'loading' &&
        listing.request &&
        sameRequest(listing.request, event.request)
      ) {
        return {
          state: { ...state, listing: firstPage(event.page, event.dropped) },
        };
      }
      const ready = waitingForMore(state, event.request);
      if (ready) {
        const { page } = event;
        return {
          state: {
            ...state,
            listing: {
              ...ready,
              items: appendNew(ready.items, page.issues),
              // The newest counts win; the server sends them on every page.
              total: page.total ?? ready.total,
              counts: page.counts ?? ready.counts,
              checks: page.checks,
              dropped: ready.dropped + event.dropped,
              tail: tailOf(page),
            },
          },
        };
      }
      return null;
    }

    case 'pageFailed': {
      if (
        listing.status === 'loading' &&
        listing.request &&
        sameRequest(listing.request, event.request)
      ) {
        return {
          state: {
            ...state,
            listing: { status: 'failed', message: event.message },
          },
        };
      }
      const ready = waitingForMore(state, event.request);
      if (ready) {
        const restart = CURSOR_REJECTED.test(event.message);
        return {
          state: {
            ...state,
            listing: {
              ...ready,
              tail: {
                status: 'failed',
                cursor: ready.tail.cursor,
                message: restart ? LIST_CHANGED_MESSAGE : event.message,
                restart,
              },
            },
          },
        };
      }
      return null;
    }
  }
};

type Ready = Extract<Listing, { status: 'ready' }>;

/** The ready listing, if `request` is the next-page fetch it waits for. */
function waitingForMore(
  { type, listing }: State,
  request: PageRequest
): (Ready & { tail: Extract<Tail, { status: 'loading' }> }) | undefined {
  if (listing.status !== 'ready' || listing.tail.status !== 'loading') {
    return undefined;
  }
  const { tail } = listing;
  return sameRequest({ type, cursor: tail.cursor }, request)
    ? { ...listing, tail }
    : undefined;
}

export type PageWindow = {
  /** What to draw for this view page. */
  rows:
    | { status: 'ready'; items: IssueSummary[] }
    | { status: 'loading' }
    | { status: 'failed'; message: string };
  /**
   * The page shown, 0-based. Smaller than the page asked for when that is
   * past the end of a complete list.
   */
  page: number;
  /** Index of the page's first row, for a "6–10 of 23" label. */
  start: number;
  hasPrevious: boolean;
  hasNext: boolean;
  /** Showing this page needs rows that aren't loaded: send `more`. */
  needsMore: boolean;
};

/**
 * The view page `page` (0-based) of `pageSize` rows over a listing. A page
 * that reaches past the loaded items shows loading (or the tail's failure)
 * until they arrive, unless the list has ended. Never relies on `total`.
 */
export function pageWindow(
  listing: Listing,
  page: number,
  pageSize: number
): PageWindow {
  if (listing.status !== 'ready') {
    return {
      rows:
        listing.status === 'failed'
          ? { status: 'failed', message: listing.message }
          : { status: 'loading' },
      page: 0,
      start: 0,
      hasPrevious: false,
      hasNext: false,
      needsMore: false,
    };
  }

  const { items, tail } = listing;
  const ended = tail.status === 'end';
  const lastPage = Math.max(0, Math.ceil(items.length / pageSize) - 1);
  const shown = ended
    ? Math.min(Math.max(page, 0), lastPage)
    : Math.max(page, 0);
  const start = shown * pageSize;
  const end = start + pageSize;
  const loaded = ended || end <= items.length;

  return {
    rows: loaded
      ? { status: 'ready', items: items.slice(start, end) }
      : tail.status === 'failed'
        ? { status: 'failed', message: tail.message }
        : { status: 'loading' },
    page: shown,
    start,
    hasPrevious: shown > 0,
    // Past a fully loaded page, the next one is loaded or can be.
    hasNext: loaded && (end < items.length || !ended),
    needsMore: !loaded && tail.status === 'more',
  };
}

/** Rows per view page when the host gives no height limit. */
export const PAGE_SIZE = 5;
const MIN_PAGE_SIZE = 3;
/** Every row is one line of title and one of meta, so they're all this tall. */
export const ROW_HEIGHT = 56;
/** Header and footer around the rows. */
export const CHROME_HEIGHT = 90;

/**
 * Rows per view page: 5, unless the host reports a `maxHeight` too small
 * for 5 rows plus the header and footer. Then as many as fit, but at least 3.
 */
export function pageSizeFor(
  containerDimensions: McpUiHostContext['containerDimensions']
): number {
  const maxHeight =
    containerDimensions && 'maxHeight' in containerDimensions
      ? containerDimensions.maxHeight
      : undefined;
  if (maxHeight === undefined) return PAGE_SIZE;
  const fits = Math.floor((maxHeight - CHROME_HEIGHT) / ROW_HEIGHT);
  return Math.min(PAGE_SIZE, Math.max(MIN_PAGE_SIZE, fits));
}
