import '../../shared/button.css';
import { type RefObject, useEffect, useRef } from 'react';
import { useAnnouncement } from '../../shared/Announcer';
import { RefreshIcon, SpinnerIcon } from '../../shared/icons';
import type { ListContent } from './IssuesList';
import type { PageWindow } from './issues-list';
import type { IssueKey, IssueSummary as Issue } from './issues-schema';
import { type McpView, useMcpView } from '../../shared/use-mcp-view';
import { registerViewTool, type ViewToolHandle } from '../../shared/view-tools';
import { IssueRow } from './IssueRow';
import { IssuesList } from './IssuesList';
import {
  type IssueCategory,
  type IssueCheck,
  type IssueSummary,
  type IssueType,
  issueKey,
} from './issues-schema';
import { Pager, rangeLabel } from './Pager';
import { type Reload, refreshIssuesViewTool } from './refresh-tool';
import { SelectionBar } from './SelectionBar';
import { type ActiveIssuesView, issueTypeOf, useIssues } from './use-issues';

const TITLE_ID = 'show-issues-title';

/** Shown by a view that a newer one of the same project has retired. */
export const RETIRED_NOTICE = 'A newer issues view is open further down.';

const CATEGORY_NAMES: Record<IssueCategory, string> = {
  security: 'Security',
  performance: 'Performance',
  health: 'Health',
};

/** "Health checks could not be read: …", for a category the server couldn't read. */
export function checkNotice(check: IssueCheck) {
  const text = `${CATEGORY_NAMES[check.type]} checks could not be read`;
  return check.reason ? `${text}: ${check.reason}` : `${text}.`;
}

const plural = (count: number, noun: string) =>
  `${count} ${count === 1 ? noun : `${noun}s`}`;

/** "14:02", in the user's time zone; undefined for a time it can't read. */
function clockTime(iso: string | undefined) {
  if (!iso) return undefined;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
}

/**
 * View for the `show_issues` tool: a project's issues, five to a page, to
 * select and hand to the assistant with "Review selected issues (N)".
 */
export function ShowIssues() {
  // `refresh_issues_view` is registered once, before the view connects. It
  // reloads whichever list is mounted when the model calls it.
  const reload = useRef<Reload>(undefined);
  const tool = useRef<ViewToolHandle>(undefined);
  const view = useMcpView<unknown>('supabase-show-issues', {
    onAppCreated: (app) => {
      tool.current = registerViewTool(
        app,
        refreshIssuesViewTool(() => reload.current)
      );
    },
  });
  const type = issueTypeOf(view.input);
  // The list is for one type: a different one (once the input arrives)
  // starts a new list.
  return (
    <IssuesSection
      key={type}
      view={view}
      type={type}
      reload={reload}
      tool={tool}
    />
  );
}

function IssuesSection({
  view,
  type,
  reload,
  tool,
}: {
  view: McpView<unknown>;
  type: IssueType;
  /** Set to this list's reload, for the view tool to call. */
  reload: RefObject<Reload | undefined>;
  tool: RefObject<ViewToolHandle | undefined>;
}) {
  const issues = useIssues(view, type);
  useEffect(() => {
    reload.current = issues.status === 'active' ? issues.reload : undefined;
  });
  // The host sends a view tool call to any one of the views that has it, so
  // only the active view keeps it.
  const retired = issues.status === 'retired';
  useEffect(() => {
    if (retired) tool.current?.disable();
  }, [retired, tool]);
  return issues.status === 'retired' ? (
    <RetiredIssues shown={issues.shown} />
  ) : (
    <ActiveIssues issues={issues} />
  );
}

/**
 * A retired view: the rows it had on screen, greyed, under a notice that
 * points to the newer view. Nothing in it can be used.
 */
function RetiredIssues({ shown }: { shown: readonly IssueSummary[] }) {
  useAnnouncement(RETIRED_NOTICE);
  return (
    <section className="show-issues" aria-labelledby={TITLE_ID}>
      <header data-slot="header">
        <h2 data-slot="title" id={TITLE_ID}>
          Issues
        </h2>
      </header>
      <ul data-slot="notices">
        <li data-slot="notice">{RETIRED_NOTICE}</li>
      </ul>
      {shown.length > 0 && (
        <ul className="issues-list">
          {shown.map((issue) => (
            <IssueRow key={issueKey(issue)} issue={issue} selected={false} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ActiveIssues({ issues }: { issues: ActiveIssuesView }) {
  const {
    listing,
    unavailable,
    visiblePage,
    selection,
    handoff,
    refresh,
    retry,
  } = issues;
  const ready = listing.status === 'ready' ? listing : undefined;
  const unreadChecks =
    ready?.checks.filter((check) => check.status === 'unavailable') ?? [];
  const rows = visiblePage.rows;
  const range =
    rows.status === 'ready' && rows.items.length > 0
      ? rangeLabel(visiblePage.start, rows.items.length, ready?.total)
      : undefined;

  useAnnouncement(listAnnouncement(issues, range));
  useAnnouncement(listAlert(unavailable, rows), 'assertive');
  useAnnouncement(handoff.status === 'handed' ? 'Handed to chat' : undefined);
  useAnnouncement(
    handoff.status === 'failed' ? handoff.message : undefined,
    'assertive'
  );

  const refreshing = listing.status === 'loading' && !!listing.request;

  return (
    <section
      className="show-issues"
      aria-labelledby={TITLE_ID}
      aria-busy={issues.busy}
    >
      <header data-slot="header">
        <h2 data-slot="title" id={TITLE_ID}>
          Issues
        </h2>
        <ReadAt iso={ready?.readAt} />
        {refresh && (
          <RefreshButton refreshing={refreshing} onRefresh={refresh} />
        )}
      </header>

      <Notices
        unreadChecks={unreadChecks}
        dropped={ready?.dropped ?? 0}
        partial={issues.partial}
      />

      <IssuesList
        content={listContent({
          unavailable,
          rows,
          incompleteChecks: unreadChecks.length > 0,
          isSelected: (key) => selection.has(key),
          onToggle: issues.toggle,
          onRetry: retry,
        })}
        pageSize={issues.pageSize}
        reserve={issues.multiPage}
      />

      <footer data-slot="footer">
        {issues.multiPage && (
          <Pager
            label={range}
            hasPrevious={visiblePage.hasPrevious}
            hasNext={visiblePage.hasNext}
            onPrevious={issues.previous}
            onNext={issues.next}
          />
        )}
        <SelectionBar
          count={selection.size}
          handoff={handoff}
          action={
            issues.review
              ? { kind: 'message', review: issues.review }
              : { kind: 'hint', sharesSelection: issues.sharesSelection }
          }
          onClear={issues.clear}
        />
      </footer>
    </section>
  );
}

/** What a screen reader hears as the list changes: loading, then the page. */
function listAnnouncement(issues: ActiveIssuesView, range: string | undefined) {
  const { rows } = issues.visiblePage;
  if (issues.unavailable !== undefined) return undefined;
  if (rows.status === 'loading') return 'Loading issues';
  if (rows.status === 'ready') {
    return range ? `Issues ${range}` : 'No issues found';
  }
  return undefined;
}

/** What a screen reader must hear at once: why there is no list or page. */
function listAlert(unavailable: string | undefined, rows: PageWindow['rows']) {
  if (unavailable !== undefined)
    return `Issues are unavailable. ${unavailable}`;
  if (rows.status === 'failed') return rows.message;
  return undefined;
}

/** What the list shows, from the view's state. */
function listContent({
  unavailable,
  rows,
  incompleteChecks,
  isSelected,
  onToggle,
  onRetry,
}: {
  unavailable: string | undefined;
  rows: PageWindow['rows'];
  incompleteChecks: boolean;
  isSelected: (key: IssueKey) => boolean;
  onToggle: (issue: Issue) => void;
  onRetry: (() => void) | undefined;
}): ListContent {
  if (unavailable !== undefined) {
    return { status: 'unavailable', reason: unavailable };
  }
  switch (rows.status) {
    case 'loading':
      return { status: 'loading' };
    case 'failed':
      return { status: 'failed', message: rows.message, onRetry };
    case 'ready':
      if (rows.items.length === 0) return { status: 'empty', incompleteChecks };
      return { status: 'ready', items: rows.items, isSelected, onToggle };
    default:
      return rows satisfies never;
  }
}

/** "Read at 14:02", when the time can be read. */
function ReadAt({ iso }: { iso: string | undefined }) {
  const time = clockTime(iso);
  if (!iso || !time) return null;
  return (
    <time data-slot="read-at" dateTime={iso}>
      Read at {time}
    </time>
  );
}

/** Reloads from the first page; a spinner while it does. */
function RefreshButton({
  refreshing,
  onRefresh,
}: {
  refreshing: boolean;
  onRefresh: () => void;
}) {
  return (
    <button
      type="button"
      data-size="sm"
      data-slot="refresh"
      disabled={refreshing}
      onClick={onRefresh}
    >
      {refreshing ? <SpinnerIcon size={12} /> : <RefreshIcon size={12} />}
      Refresh
    </button>
  );
}

/** Checks that couldn't be read, rows that couldn't be shown, and a partial list. */
function Notices({
  unreadChecks,
  dropped,
  partial,
}: {
  unreadChecks: IssueCheck[];
  dropped: number;
  partial: PartialList | undefined;
}) {
  if (unreadChecks.length === 0 && dropped === 0 && !partial) return null;
  return (
    <ul data-slot="notices">
      {unreadChecks.map((check) => (
        <li key={check.type} data-slot="notice" data-tone="warning">
          {checkNotice(check)}
        </li>
      ))}
      {dropped > 0 && (
        <li data-slot="notice" data-tone="warning">
          {plural(dropped, 'issue')} could not be shown.
        </li>
      )}
      {partial && <PartialNotice {...partial} />}
    </ul>
  );
}

/** More issues exist than were delivered, and this host can't load them. */
type PartialList = { shown: number; total?: number };

/** "Showing 10 of 23. Ask the assistant for the rest." */
function PartialNotice({ shown, total }: PartialList) {
  const showing =
    total === undefined
      ? `Showing the first ${plural(shown, 'issue')}.`
      : `Showing ${shown} of ${total}.`;
  return <li data-slot="notice">{showing} Ask the assistant for the rest.</li>;
}
