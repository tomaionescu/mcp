import '../../shared/button.css';
import type { CSSProperties } from 'react';
import { CheckIcon, RefreshIcon } from '../../shared/icons';
import { Message } from '../../shared/Message';
import { IssueRow } from './IssueRow';
import { type IssueKey, type IssueSummary, issueKey } from './issues-schema';

/** What the list shows: the page's rows, or what stands in for them. */
export type ListContent =
  /** The tool call that opened the view gave no list. */
  | { status: 'unavailable'; reason: string }
  | { status: 'loading' }
  /** `onRetry` is absent when the host can't call tools. */
  | { status: 'failed'; message: string; onRetry?: () => void }
  /**
   * No issues. With `incompleteChecks`, some checks couldn't be read, so an
   * empty list isn't "no issues".
   */
  | { status: 'empty'; incompleteChecks: boolean }
  | {
      status: 'ready';
      items: IssueSummary[];
      isSelected: (key: IssueKey) => boolean;
      onToggle: (issue: IssueSummary) => void;
    };

/**
 * One view page of issues, or what stands in for it: loading rows, the
 * error with a Retry, or the empty state. Once the list has more than one
 * page (`reserve`), it keeps a full page's height, so a short last page
 * doesn't make the chat jump.
 */
export function IssuesList({
  content,
  pageSize,
  reserve,
}: {
  content: ListContent;
  pageSize: number;
  reserve: boolean;
}) {
  return (
    <ul
      className="issues-list"
      data-reserve={reserve}
      style={{ '--sb-view-show-issues-page-size': pageSize } as CSSProperties}
    >
      <ListItems content={content} pageSize={pageSize} />
    </ul>
  );
}

/** The list's items for its content. */
function ListItems({
  content,
  pageSize,
}: {
  content: ListContent;
  pageSize: number;
}) {
  switch (content.status) {
    case 'unavailable':
      return <UnavailableStatus reason={content.reason} />;
    case 'loading':
      return <LoadingRows count={pageSize} />;
    case 'failed':
      return <FailedStatus {...content} />;
    case 'empty':
      return <EmptyStatus {...content} />;
    case 'ready':
      return <IssueRows {...content} />;
    default:
      return content satisfies never;
  }
}

/** The tool call that opened the view gave no list. */
function UnavailableStatus({ reason }: { reason: string }) {
  return (
    <li data-slot="status" data-state="unavailable">
      <Message tone="error">Issues are unavailable. {reason}</Message>
    </li>
  );
}

/** A page of placeholder rows, each shaped like an issue's two lines. */
function LoadingRows({ count }: { count: number }) {
  return Array.from({ length: count }, (_, index) => (
    <li key={index} data-slot="skeleton-row" aria-hidden="true">
      <span data-slot="skeleton" data-width="long" />
      <span data-slot="skeleton" data-width="short" />
    </li>
  ));
}

/** Why the page couldn't be loaded, and Retry when the host can call tools. */
function FailedStatus({
  message,
  onRetry,
}: Extract<ListContent, { status: 'failed' }>) {
  return (
    <li data-slot="status" data-state="failed">
      <Message tone="error">{message}</Message>
      {onRetry && (
        <button type="button" data-size="sm" onClick={onRetry}>
          <RefreshIcon size={12} />
          Retry
        </button>
      )}
    </li>
  );
}

/** No issues: all clear, or only in the checks that could be read. */
function EmptyStatus({
  incompleteChecks,
}: Extract<ListContent, { status: 'empty' }>) {
  if (incompleteChecks) {
    return (
      <li data-slot="status" data-state="empty">
        <Message>No issues found in the checks that could be read.</Message>
      </li>
    );
  }
  return (
    <li data-slot="status" data-state="empty">
      <CheckIcon slot="empty-icon" />
      <Message>No issues found</Message>
    </li>
  );
}

/** The page's issues, one selectable row each. */
function IssueRows({
  items,
  isSelected,
  onToggle,
}: Extract<ListContent, { status: 'ready' }>) {
  return items.map((issue) => {
    const key = issueKey(issue);
    return (
      <IssueRow
        key={key}
        issue={issue}
        selected={isSelected(key)}
        onToggle={onToggle}
      />
    );
  });
}
