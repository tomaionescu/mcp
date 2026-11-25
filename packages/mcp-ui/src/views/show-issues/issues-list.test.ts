import { describe, expect, it } from 'vitest';
import type { IssueSummary, ParsedIssuesPage } from './issues-schema';
import {
  type Event,
  initialIssuesList,
  issuesListTransition,
  LIST_CHANGED_MESSAGE,
  type Listing,
  type PageRequest,
  pageSizeFor,
  pageWindow,
  type State,
} from './issues-list';

const issue = (n: number, over: Partial<IssueSummary> = {}): IssueSummary => ({
  id: `check_${n}`,
  category: 'security',
  title: `Check ${n}`,
  severity: 'warning',
  affected_count: 1,
  ...over,
});
const issues = (from: number, to: number) =>
  Array.from({ length: to - from }, (_, i) => issue(from + i));

const page = (
  rows: IssueSummary[],
  next_cursor: string | null = null,
  over: Partial<ParsedIssuesPage> = {}
): ParsedIssuesPage => ({ issues: rows, checks: [], next_cursor, ...over });

const first: PageRequest = { type: 'all', cursor: null };
const after = (cursor: string): PageRequest => ({ type: 'all', cursor });

/** Runs events in order; a disallowed one throws, so tests can't skip one by accident. */
function run(state: State, ...events: Event[]) {
  let effects: unknown[] = [];
  for (const event of events) {
    const next = issuesListTransition(state, event);
    if (!next) throw new Error(`${event.type} not allowed`);
    state = next.state;
    effects = next.effects ?? [];
  }
  return { state, effects };
}

const start = initialIssuesList('all');
const delivered = (p: ParsedIssuesPage, dropped = 0): Event => ({
  type: 'delivered',
  page: p,
  dropped,
});
const loaded = (
  request: PageRequest,
  p: ParsedIssuesPage,
  dropped = 0
): Event => ({
  type: 'pageLoaded',
  request,
  page: p,
  dropped,
});
const failed = (request: PageRequest, message = 'down'): Event => ({
  type: 'pageFailed',
  request,
  message,
});
const ready = (listing: Listing) => {
  if (listing.status !== 'ready')
    throw new Error(`listing is ${listing.status}`);
  return listing;
};

/** Delivered 20 issues with more after `c1`. */
const withMore = run(start, delivered(page(issues(0, 20), 'c1'))).state;

describe('issues list machine', () => {
  it('starts waiting for the tool result', () => {
    expect(start).toEqual({
      type: 'all',
      listing: { status: 'loading', request: null },
    });
  });

  it('becomes ready from the delivered page', () => {
    const { state, effects } = run(
      start,
      delivered(
        page(issues(0, 2), null, {
          total: 2,
          read_at: 't1',
          checks: [{ type: 'health', status: 'unavailable' }],
        }),
        1
      )
    );
    expect(state.listing).toEqual({
      status: 'ready',
      items: issues(0, 2),
      total: 2,
      counts: undefined,
      checks: [{ type: 'health', status: 'unavailable' }],
      readAt: 't1',
      dropped: 1,
      tail: { status: 'end' },
    });
    expect(effects).toEqual([]);
  });

  it('accepts the tool result only while waiting for it', () => {
    expect(issuesListTransition(withMore, delivered(page([])))).toBeNull();
  });

  describe('more', () => {
    it('fetches the next page once, however often it is sent', () => {
      const { state, effects } = run(withMore, { type: 'more' });
      expect(effects).toEqual([{ type: 'fetchPage', request: after('c1') }]);
      expect(ready(state.listing).tail).toEqual({
        status: 'loading',
        cursor: 'c1',
      });
      expect(issuesListTransition(state, { type: 'more' })).toBeNull();
    });

    it('does nothing at the end or while the first page loads', () => {
      const ended = run(start, delivered(page(issues(0, 3)))).state;
      expect(issuesListTransition(ended, { type: 'more' })).toBeNull();
      expect(issuesListTransition(start, { type: 'more' })).toBeNull();
    });

    it('appends the next page, without repeats, with the newest counts', () => {
      const { state } = run(
        withMore,
        { type: 'more' },
        loaded(
          after('c1'),
          page([issue(19), ...issues(20, 25)], null, {
            total: 25,
            counts: { all: 25, security: 25, performance: 0, health: 0 },
            read_at: 't2',
          }),
          2
        )
      );
      const listing = ready(state.listing);
      expect(listing.items).toEqual(issues(0, 25));
      expect(listing.total).toBe(25);
      expect(listing.counts?.all).toBe(25);
      expect(listing.dropped).toBe(2);
      expect(listing.tail).toEqual({ status: 'end' });
    });

    it('does not mistake the same id in another category for a repeat', () => {
      const other = issue(0, { category: 'health' });
      const { state } = run(
        withMore,
        { type: 'more' },
        loaded(after('c1'), page([other]))
      );
      expect(ready(state.listing).items).toHaveLength(21);
    });

    it('keeps the first read time and totals a later page leaves out', () => {
      const delivered20 = run(
        start,
        delivered(page(issues(0, 20), 'c1', { total: 30, read_at: 't1' }), 1)
      ).state;
      const { state } = run(
        delivered20,
        { type: 'more' },
        loaded(after('c1'), page(issues(20, 30), null, { read_at: 't2' }), 1)
      );
      const listing = ready(state.listing);
      expect(listing.readAt).toBe('t1');
      expect(listing.total).toBe(30);
      expect(listing.dropped).toBe(2);
    });
  });

  describe('stale answers', () => {
    it('drops an answer to a request it is not waiting for', () => {
      const loading = run(withMore, { type: 'more' }).state;
      expect(
        issuesListTransition(loading, loaded(after('old'), page([issue(99)])))
      ).toBeNull();
      expect(issuesListTransition(loading, failed(after('old')))).toBeNull();
      expect(issuesListTransition(loading, loaded(first, page([])))).toBeNull();
    });

    it('drops a next page that arrives after a refresh', () => {
      const refreshing = run(
        withMore,
        { type: 'more' },
        { type: 'refresh' }
      ).state;
      expect(
        issuesListTransition(refreshing, loaded(after('c1'), page([issue(99)])))
      ).toBeNull();
      expect(issuesListTransition(refreshing, failed(after('c1')))).toBeNull();
    });

    it('drops answers when nothing was requested', () => {
      expect(
        issuesListTransition(withMore, loaded(first, page([])))
      ).toBeNull();
      expect(issuesListTransition(start, loaded(first, page([])))).toBeNull();
    });
  });

  describe('failure and retry', () => {
    it('keeps loaded rows when loading more fails, and retries the same cursor', () => {
      const { state } = run(withMore, { type: 'more' }, failed(after('c1')));
      const listing = ready(state.listing);
      expect(listing.items).toHaveLength(20);
      expect(listing.tail).toEqual({
        status: 'failed',
        cursor: 'c1',
        message: 'down',
        restart: false,
      });
      expect(issuesListTransition(state, { type: 'more' })).toBeNull();

      const retried = run(state, { type: 'retry' });
      expect(retried.effects).toEqual([
        { type: 'fetchPage', request: after('c1') },
      ]);
      const { state: done } = run(
        retried.state,
        loaded(after('c1'), page(issues(20, 22)))
      );
      expect(ready(done.listing).items).toHaveLength(22);
    });

    it('loads the first page again when the cursor was rejected', () => {
      const { state } = run(
        withMore,
        { type: 'more' },
        failed(
          after('c1'),
          'The cursor is invalid or does not match this request. Request the first page again without a cursor.'
        )
      );
      expect(ready(state.listing).tail).toMatchObject({
        status: 'failed',
        message: LIST_CHANGED_MESSAGE,
        restart: true,
      });
      const retried = run(state, { type: 'retry' });
      expect(retried.state.listing).toEqual({
        status: 'loading',
        request: first,
      });
      expect(retried.effects).toEqual([{ type: 'fetchPage', request: first }]);
    });

    it('fails the listing when the first page fails, and retries it', () => {
      const { state } = run(
        withMore,
        { type: 'refresh' },
        failed(first, 'gone')
      );
      expect(state.listing).toEqual({ status: 'failed', message: 'gone' });
      const retried = run(state, { type: 'retry' });
      expect(retried.effects).toEqual([{ type: 'fetchPage', request: first }]);
      const { state: done } = run(
        retried.state,
        loaded(first, page(issues(0, 1)))
      );
      expect(ready(done.listing).items).toEqual(issues(0, 1));
    });

    it('has nothing to retry otherwise', () => {
      expect(issuesListTransition(withMore, { type: 'retry' })).toBeNull();
      expect(issuesListTransition(start, { type: 'retry' })).toBeNull();
    });
  });

  describe('refresh', () => {
    it('starts a new listing from the first page', () => {
      const { state, effects } = run(withMore, { type: 'refresh' });
      expect(state.listing).toEqual({ status: 'loading', request: first });
      expect(effects).toEqual([{ type: 'fetchPage', request: first }]);
      const { state: done } = run(state, loaded(first, page(issues(5, 7))));
      expect(ready(done.listing).items).toEqual(issues(5, 7));
    });

    it('works before the tool result arrives, for when the tool call failed', () => {
      const { effects } = run(start, { type: 'refresh' });
      expect(effects).toEqual([{ type: 'fetchPage', request: first }]);
    });

    it('does not fetch the first page twice', () => {
      const refreshing = run(withMore, { type: 'refresh' }).state;
      expect(issuesListTransition(refreshing, { type: 'refresh' })).toBeNull();
    });

    it('uses the listing type', () => {
      const { effects } = run(initialIssuesList('health'), {
        type: 'refresh',
      });
      expect(effects).toEqual([
        { type: 'fetchPage', request: { type: 'health', cursor: null } },
      ]);
    });
  });
});

describe('pageWindow', () => {
  const listing = (
    items: IssueSummary[],
    tail: Extract<Listing, { status: 'ready' }>['tail']
  ): Listing => ({ status: 'ready', items, checks: [], dropped: 0, tail });

  it('shows a full page with more after it', () => {
    expect(pageWindow(listing(issues(0, 20), { status: 'end' }), 1, 5)).toEqual(
      {
        rows: { status: 'ready', items: issues(5, 10) },
        page: 1,
        start: 5,
        hasPrevious: true,
        hasNext: true,
        needsMore: false,
      }
    );
  });

  it('shows a short last page with no Next', () => {
    expect(pageWindow(listing(issues(0, 12), { status: 'end' }), 2, 5)).toEqual(
      {
        rows: { status: 'ready', items: issues(10, 12) },
        page: 2,
        start: 10,
        hasPrevious: true,
        hasNext: false,
        needsMore: false,
      }
    );
  });

  it('offers Next on the last loaded page when the server has more', () => {
    const window = pageWindow(
      listing(issues(0, 20), { status: 'more', cursor: 'c1' }),
      3,
      5
    );
    expect(window.hasNext).toBe(true);
    expect(window.needsMore).toBe(false);
  });

  it('asks for more for a page beyond the loaded items', () => {
    expect(
      pageWindow(listing(issues(0, 20), { status: 'more', cursor: 'c1' }), 4, 5)
    ).toEqual({
      rows: { status: 'loading' },
      page: 4,
      start: 20,
      hasPrevious: true,
      hasNext: false,
      needsMore: true,
    });
  });

  it('shows loading without asking again while more loads', () => {
    const window = pageWindow(
      listing(issues(0, 20), { status: 'loading', cursor: 'c1' }),
      4,
      5
    );
    expect(window.rows).toEqual({ status: 'loading' });
    expect(window.needsMore).toBe(false);
    expect(window.hasPrevious).toBe(true);
  });

  it('shows the failure on the page that needed the rows', () => {
    const window = pageWindow(
      listing(issues(0, 20), {
        status: 'failed',
        cursor: 'c1',
        message: 'down',
        restart: false,
      }),
      4,
      5
    );
    expect(window.rows).toEqual({ status: 'failed', message: 'down' });
    expect(window.hasPrevious).toBe(true);
    expect(window.needsMore).toBe(false);
  });

  it('waits for a page only partly loaded when more exist', () => {
    const window = pageWindow(
      listing(issues(0, 20), { status: 'more', cursor: 'c1' }),
      6,
      3
    );
    expect(window.rows).toEqual({ status: 'loading' });
    expect(window.needsMore).toBe(true);
  });

  it('moves a page past the end of a complete list back to the last page', () => {
    const window = pageWindow(listing(issues(0, 7), { status: 'end' }), 4, 5);
    expect(window.page).toBe(1);
    expect(window.rows).toEqual({ status: 'ready', items: issues(5, 7) });
  });

  it('shows an empty list as one empty page', () => {
    expect(pageWindow(listing([], { status: 'end' }), 0, 5)).toEqual({
      rows: { status: 'ready', items: [] },
      page: 0,
      start: 0,
      hasPrevious: false,
      hasNext: false,
      needsMore: false,
    });
  });

  it('works without a total', () => {
    const window = pageWindow(
      listing(issues(0, 10), { status: 'more', cursor: 'c1' }),
      0,
      5
    );
    expect(window.rows).toEqual({ status: 'ready', items: issues(0, 5) });
    expect(window.hasNext).toBe(true);
  });

  it.each([
    [
      'loading',
      { status: 'loading', request: null } as Listing,
      { status: 'loading' },
    ],
    [
      'failed',
      { status: 'failed', message: 'gone' } as Listing,
      { status: 'failed', message: 'gone' },
    ],
  ])('passes a %s listing through with no paging', (_, l, rows) => {
    expect(pageWindow(l, 2, 5)).toEqual({
      rows,
      page: 0,
      start: 0,
      hasPrevious: false,
      hasNext: false,
      needsMore: false,
    });
  });
});

describe('pageSizeFor', () => {
  it.each([
    ['no dimensions', undefined, 5],
    ['no max height', { maxWidth: 400 }, 5],
    ['a fixed height', { height: 200, width: 400 }, 5],
    ['room for 5 rows', { maxHeight: 370 }, 5],
    ['room for more', { maxHeight: 2000 }, 5],
    ['room for 4 rows', { maxHeight: 369 }, 4],
    ['room for 3 rows', { maxHeight: 260 }, 3],
    ['room for fewer', { maxHeight: 100 }, 3],
  ] as const)('%s', (_, dimensions, expected) => {
    expect(pageSizeFor(dimensions)).toBe(expected);
  });
});
