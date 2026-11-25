import '../../shared/button.css';
import type { CSSProperties } from 'react';
import { CheckIcon, RefreshIcon } from '../../shared/icons';
import { Message } from '../../shared/Message';
import { IssueRow } from './IssueRow';
import type { PageWindow } from './issues-list';
import { type IssueKey, type IssueSummary, issueKey } from './issues-schema';

/**
 * One view page of issues, or what stands in for it: loading rows, the
 * error with a Retry, or the empty state. Once the list has more than one
 * page (`reserve`), it keeps a full page's height, so a short last page
 * doesn't make the chat jump.
 */
export function IssuesList({
  rows,
  unavailable,
  pageSize,
  reserve,
  isSelected,
  incompleteChecks,
  onToggle,
  onRetry,
}: {
  rows: PageWindow['rows'];
  /** The tool call that opened the view gave no list; shown in its place. */
  unavailable?: string;
  pageSize: number;
  reserve: boolean;
  isSelected: (key: IssueKey) => boolean;
  /** Some checks couldn't be read, so an empty list isn't "no issues". */
  incompleteChecks: boolean;
  onToggle: (issue: IssueSummary) => void;
  /** Retries a failed load; omit when the host can't call tools. */
  onRetry?: () => void;
}) {
  return (
    <ul
      className="issues-list"
      data-reserve={reserve}
      style={{ '--sb-view-show-issues-page-size': pageSize } as CSSProperties}
    >
      {unavailable !== undefined ? (
        <li data-slot="status" data-state="unavailable">
          <Message tone="error">Issues are unavailable. {unavailable}</Message>
        </li>
      ) : rows.status === 'loading' ? (
        Array.from({ length: pageSize }, (_, index) => (
          <li key={index} data-slot="skeleton-row" aria-hidden="true">
            <span data-slot="skeleton" data-width="long" />
            <span data-slot="skeleton" data-width="short" />
          </li>
        ))
      ) : rows.status === 'failed' ? (
        <li data-slot="status" data-state="failed">
          <Message tone="error">{rows.message}</Message>
          {onRetry && (
            <button type="button" data-size="sm" onClick={onRetry}>
              <RefreshIcon size={12} />
              Retry
            </button>
          )}
        </li>
      ) : rows.items.length === 0 ? (
        <li data-slot="status" data-state="empty">
          {incompleteChecks ? (
            <Message>No issues found in the checks that could be read.</Message>
          ) : (
            <>
              <CheckIcon slot="empty-icon" />
              <Message>No issues found</Message>
            </>
          )}
        </li>
      ) : (
        rows.items.map((issue) => {
          const key = issueKey(issue);
          return (
            <IssueRow
              key={key}
              issue={issue}
              selected={isSelected(key)}
              onToggle={onToggle}
            />
          );
        })
      )}
    </ul>
  );
}
