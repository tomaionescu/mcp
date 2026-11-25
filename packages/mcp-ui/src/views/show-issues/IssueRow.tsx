import { useId } from 'react';
import type { IssueSummary } from './issues-schema';
import { SeverityIndicator } from './SeverityIndicator';

const CATEGORY_LABELS: Record<IssueSummary['category'], string> = {
  security: 'Security',
  performance: 'Performance',
  health: 'Health',
};

const SEVERITY_LABELS: Record<IssueSummary['severity'], string> = {
  critical: 'Error',
  warning: 'Warning',
};

/** "Security · Error · 3 findings", the line under an issue's title. */
export function issueMeta(issue: IssueSummary) {
  const findings = `${issue.affected_count} ${issue.affected_count === 1 ? 'finding' : 'findings'}`;
  return [
    CATEGORY_LABELS[issue.category],
    SEVERITY_LABELS[issue.severity],
    findings,
  ].join(' · ');
}

/**
 * One issue: a checkbox labelled by the title, the severity bars, the title
 * on one line and its category, severity and findings under it. The whole
 * row toggles the checkbox.
 */
export function IssueRow({
  issue,
  selected,
  onToggle,
}: {
  issue: IssueSummary;
  selected: boolean;
  onToggle: (issue: IssueSummary) => void;
}) {
  const id = useId();
  return (
    <li className="issue-row">
      <label data-slot="target">
        <input
          type="checkbox"
          data-slot="checkbox"
          checked={selected}
          aria-labelledby={`${id}-title`}
          aria-describedby={`${id}-meta`}
          onChange={() => onToggle(issue)}
        />
        <SeverityIndicator severity={issue.severity} />
        <span data-slot="text">
          <span data-slot="title" id={`${id}-title`} title={issue.title}>
            {issue.title}
          </span>
          <span data-slot="meta" id={`${id}-meta`}>
            {issueMeta(issue)}
          </span>
        </span>
      </label>
    </li>
  );
}
