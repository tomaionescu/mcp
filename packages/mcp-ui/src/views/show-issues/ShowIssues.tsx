import '../../shared/button.css';
import { useAnnouncement } from '../../shared/Announcer';
import { RefreshIcon, SpinnerIcon } from '../../shared/icons';
import { type McpView, useMcpView } from '../../shared/use-mcp-view';
import { IssuesList } from './IssuesList';
import type { IssueCategory, IssueCheck, IssueType } from './issues-schema';
import { Pager, rangeLabel } from './Pager';
import { SelectionBar } from './SelectionBar';
import { type IssuesView, issueTypeOf, useIssues } from './use-issues';

const TITLE_ID = 'show-issues-title';

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
 * select and hand to the assistant with "Review these issues (N)".
 */
export function ShowIssues() {
  const view = useMcpView<unknown>('supabase-show-issues');
  const type = issueTypeOf(view.input);
  // The list is for one type: a different one (once the input arrives)
  // starts a new list.
  return <IssuesSection key={type} view={view} type={type} />;
}

function IssuesSection({
  view,
  type,
}: {
  view: McpView<unknown>;
  type: IssueType;
}) {
  const issues = useIssues(view, type);
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
  const readAt = clockTime(ready?.readAt);
  const rows = visiblePage.rows;
  const range =
    rows.status === 'ready' && rows.items.length > 0
      ? rangeLabel(visiblePage.start, rows.items.length, ready?.total)
      : undefined;

  useAnnouncement(listAnnouncement(issues, range));
  useAnnouncement(
    unavailable !== undefined
      ? `Issues are unavailable. ${unavailable}`
      : rows.status === 'failed'
        ? rows.message
        : undefined,
    'assertive'
  );
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
        {readAt && ready?.readAt && (
          <time data-slot="read-at" dateTime={ready.readAt}>
            Read at {readAt}
          </time>
        )}
        {refresh && (
          <button
            type="button"
            data-size="sm"
            data-slot="refresh"
            disabled={refreshing}
            onClick={refresh}
          >
            {refreshing ? <SpinnerIcon size={12} /> : <RefreshIcon size={12} />}
            Refresh
          </button>
        )}
      </header>

      {(unreadChecks.length > 0 || !!ready?.dropped || issues.partial) && (
        <ul data-slot="notices">
          {unreadChecks.map((check) => (
            <li key={check.type} data-slot="notice" data-tone="warning">
              {checkNotice(check)}
            </li>
          ))}
          {!!ready?.dropped && (
            <li data-slot="notice" data-tone="warning">
              {plural(ready.dropped, 'issue')} could not be shown.
            </li>
          )}
          {issues.partial && (
            <li data-slot="notice">
              {issues.partial.total === undefined
                ? `Showing the first ${plural(issues.partial.shown, 'issue')}.`
                : `Showing ${issues.partial.shown} of ${issues.partial.total}.`}{' '}
              Ask the assistant for the rest.
            </li>
          )}
        </ul>
      )}

      <IssuesList
        rows={rows}
        unavailable={unavailable}
        pageSize={issues.pageSize}
        reserve={issues.multiPage}
        isSelected={(key) => selection.has(key)}
        incompleteChecks={unreadChecks.length > 0}
        onToggle={issues.toggle}
        onRetry={retry}
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
          sharesSelection={issues.sharesSelection}
          onClear={issues.clear}
          onReview={issues.review}
        />
      </footer>
    </section>
  );
}

/** What a screen reader hears as the list changes: loading, then the page. */
function listAnnouncement(issues: IssuesView, range: string | undefined) {
  const { rows } = issues.visiblePage;
  if (issues.unavailable !== undefined) return undefined;
  if (rows.status === 'loading') return 'Loading issues';
  if (rows.status === 'ready') {
    return range ? `Issues ${range}` : 'No issues found';
  }
  return undefined;
}
