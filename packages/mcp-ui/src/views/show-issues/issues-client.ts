import type { CallTool } from '../../shared/call-tool';
import {
  type IssueType,
  type PageResult,
  parseIssuesPage,
} from './issues-schema';

/** The app-only server tool that pages a project's issues for this view. */
export const PAGINATE_ISSUES_TOOL = 'app_paginate_issues';

export type FetchIssuesPageRequest = {
  type: IssueType;
  /** The previous page's `next_cursor`; `null` for the first page. */
  cursor: string | null;
  /**
   * Only when the view knows it (from the tool input or context): a
   * project-scoped server has no `project_id` input.
   */
  projectId?: string;
  /** Server page size; the server defaults to 20. */
  limit?: number;
};

/**
 * Reads one page of issues from the server. Throws a readable `Error` when
 * the call fails or the result isn't a page (see `parseIssuesPage`).
 */
export async function fetchIssuesPage(
  callTool: CallTool,
  { type, cursor, projectId, limit }: FetchIssuesPageRequest
): Promise<PageResult> {
  const raw = await callTool<unknown>(PAGINATE_ISSUES_TOOL, {
    ...(projectId && { project_id: projectId }),
    type,
    ...(cursor && { cursor }),
    ...(limit !== undefined && { limit }),
  });
  return parseIssuesPage(raw);
}
