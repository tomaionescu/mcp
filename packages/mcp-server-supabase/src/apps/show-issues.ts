/**
 * What `show_issues` sends its view in the result's `_meta`, under
 * `VIEW_DATA_META_KEY`. The `mcp-ui` package imports these types type-only.
 * Fields may be added but never renamed or removed: a host can pair an older
 * view with a newer server, or the other way round.
 */
import type { IssuesPage } from '../issues-page.js';

export type { IssueSummary, IssuesPage } from '../issues-page.js';

/**
 * Project and connection facts for the view's prompt. Keys follow the
 * `poc/surfaces` prototype's prompt context. When the project cannot be read,
 * `project` carries its id alone.
 */
export type PromptContext = {
  project: {
    id: string;
    ref?: string;
    name?: string;
    region?: string;
    status?: string;
    organizationId?: string;
    organizationSlug?: string;
  };
  mcpServer: {
    name: string;
    version: string;
    /** The tool that opened the view. */
    entrypoint: string;
    /** The view's resource URI. */
    resource: string;
  };
  connection: {
    readOnly: boolean;
    /** The project this connection is limited to, if any. */
    scopedProjectId: string | null;
  };
};

export type ShowIssuesViewData = {
  /** The first page of issues. */
  page: IssuesPage;
  /** When and for which project the view was opened. */
  opened: { at: number; project: string };
  context: PromptContext;
};
