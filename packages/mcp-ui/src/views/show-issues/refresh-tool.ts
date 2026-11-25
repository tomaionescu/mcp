/**
 * `refresh_issues_view`, the view tool the model calls after it changes the
 * project. No `app_` prefix: that marks a server tool only the view calls,
 * and this is the opposite, a view tool the model calls.
 */
import type { CallToolResult } from '@modelcontextprotocol/client';
import type { ViewTool } from '../../shared/view-tools';

export const REFRESH_TOOL_NAME = 'refresh_issues_view';

export const REFRESH_TOOL_DESCRIPTION =
  "In the open issues view, reload the project's issues. Call this after you change the project so the user sees current issues.";

/**
 * The host doesn't let the view call tools, or a newer view retired it.
 * Opening a new view is a reload too.
 */
export const CANNOT_RELOAD_MESSAGE =
  "This issues view can't reload. Call show_issues to open a new one.";

/** How many issues the list had before a reload and after, where known. */
export type ReloadResult = { before?: number; after?: number };

/** Reloads the list from the first page; rejects with why it failed. */
export type Reload = () => Promise<ReloadResult>;

const issueCount = (count: number) =>
  `${count} ${count === 1 ? 'issue' : 'issues'}`;

/** "Issues reloaded: 21 issues, was 23.", or as much of it as is known. */
export function reloadSummary({ before, after }: ReloadResult) {
  if (after === undefined) {
    return before === undefined
      ? 'Issues reloaded.'
      : `Issues reloaded. There ${before === 1 ? 'was' : 'were'} ${issueCount(before)} before.`;
  }
  return before === undefined
    ? `Issues reloaded: ${issueCount(after)}.`
    : `Issues reloaded: ${issueCount(after)}, was ${before}.`;
}

const text = (value: string, isError = false): CallToolResult => ({
  content: [{ type: 'text', text: value }],
  ...(isError && { isError }),
});

/**
 * The tool, calling whatever `reload` returns when it runs: the list
 * mounted at that moment, or undefined when it can't reload.
 */
export function refreshIssuesViewTool(
  reload: () => Reload | undefined
): ViewTool {
  return {
    name: REFRESH_TOOL_NAME,
    description: REFRESH_TOOL_DESCRIPTION,
    handler: async () => {
      const current = reload();
      if (!current) return text(CANNOT_RELOAD_MESSAGE, true);
      try {
        return text(reloadSummary(await current()));
      } catch (err) {
        return text(err instanceof Error ? err.message : String(err), true);
      }
    },
  };
}
