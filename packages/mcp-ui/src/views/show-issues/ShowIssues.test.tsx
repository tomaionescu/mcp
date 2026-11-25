import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnnouncerProvider } from '../../shared/Announcer';
import { ToolCallError } from '../../shared/call-tool';
import { FakeBroadcastChannel } from '../../shared/fake-broadcast-channel';
import { MessageTooLongError } from '../../shared/message-limits';
import type { ToolCallState } from '../../shared/use-mcp-view';
import { VIEWS_CHANNEL } from '../../shared/use-supersession';
import type { IssueSummary } from './issues-schema';
import { INVALID_CURSOR_CODE, LIST_CHANGED_MESSAGE } from './issues-list';
import { OUT_OF_STEP_MESSAGE } from './issues-schema';
import { selectionContext } from './selection';
import {
  CANNOT_RELOAD_MESSAGE,
  REFRESH_TOOL_DESCRIPTION,
} from './refresh-tool';
import { RETIRED_NOTICE, ShowIssues } from './ShowIssues';

const { host } = vi.hoisted(() => ({
  host: {
    toolCall: { status: 'loading' } as ToolCallState<unknown>,
    input: undefined as Record<string, unknown> | undefined,
    callTool: undefined as
      | ((name: string, args: Record<string, unknown>) => Promise<unknown>)
      | undefined,
    sendMessage: undefined as ((text: string) => Promise<void>) | undefined,
    updateModelContext: undefined as
      | ((params: unknown) => Promise<void>)
      | undefined,
    /** The app `onAppCreated` is given. */
    app: undefined as unknown,
    /** What happened to the app, in order. */
    log: [] as string[],
  },
}));

// As the real hook: the app is created, `onAppCreated` runs, then it
// connects.
vi.mock('../../shared/use-mcp-view', async () => {
  const { useEffect } = await import('react');
  return {
    useMcpView: (
      _name: string,
      options: { onAppCreated?: (app: unknown) => void } = {}
    ) => {
      useEffect(() => {
        options.onAppCreated?.(host.app);
        host.log.push('connected');
      }, []);
      return {
        toolCall: host.toolCall,
        app: null,
        input: host.input,
        hostContext: undefined,
        hostCapabilities: {},
        dashboardUrl: 'https://supabase.com/dashboard',
        callTool: host.callTool,
        inputText: (key: string) => {
          const value = host.input?.[key];
          return typeof value === 'string' ? value : undefined;
        },
        openLink: undefined,
        sendMessage: host.sendMessage,
        updateModelContext: host.updateModelContext,
      };
    },
  };
});

const PROJECT = 'abcdefghijklmnopqrst';

const issue = (n: number, overrides: Partial<IssueSummary> = {}) =>
  ({
    id: `check_${String(n).padStart(2, '0')}`,
    category: 'security',
    title: `Issue ${n}`,
    severity: 'critical',
    affected_count: 3,
    ...overrides,
  }) satisfies IssueSummary;

const issues = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, index) => issue(from + index));

function page({
  rows,
  total,
  next_cursor = null,
  checks = [],
}: {
  rows: unknown[];
  total?: number;
  next_cursor?: string | null;
  checks?: unknown[];
}) {
  return {
    issues: rows,
    ...(total !== undefined && { total }),
    counts: {
      all: total ?? 0,
      security: total ?? 0,
      performance: 0,
      health: 0,
    },
    checks,
    next_cursor,
    read_at: '2026-11-25T14:02:00Z',
  };
}

/** `show_issues` delivered this page. */
function delivered(first: ReturnType<typeof page>) {
  host.toolCall = {
    status: 'ready',
    data: {
      page: first,
      opened: { at: 1, project: PROJECT },
      context: { project: { id: PROJECT, name: 'Design check' } },
    },
  };
}

/** 23 issues: 20 delivered, 3 on the next server page. */
function manyIssues() {
  delivered(page({ rows: issues(1, 20), total: 23, next_cursor: 'c1' }));
}

const callTool =
  vi.fn<(name: string, args: Record<string, unknown>) => Promise<unknown>>();
const sendMessage = vi.fn<(text: string) => Promise<void>>();
const updateModelContext = vi.fn<(params: unknown) => Promise<void>>();
const toolHandle = { disable: vi.fn() };
const registerTool = vi.fn((..._args: unknown[]) => {
  host.log.push('registered tool');
  return toolHandle;
});

/** The model calls `refresh_issues_view`; resolves with its result. */
async function callViewTool() {
  const handler = registerTool.mock.calls[0]![2] as () => Promise<unknown>;
  let result: unknown;
  await act(async () => {
    result = await handler();
  });
  return result;
}

/** Lets pending tool calls settle and re-render. */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve)));

function renderView() {
  const { container } = render(
    <AnnouncerProvider>
      <ShowIssues />
    </AnnouncerProvider>
  );
  return {
    titles: () =>
      [...container.querySelectorAll('.issue-row [data-slot="title"]')].map(
        (title) => title.textContent
      ),
    range: () =>
      container.querySelector('.pager [data-slot="range"]')?.textContent,
    section: () => container.querySelector('section')!,
    checkbox: (title: string) =>
      screen.getByRole<HTMLInputElement>('checkbox', { name: title }),
  };
}

/** Queries inside the view, not the announcer's live regions. */
const inView = () => within(document.querySelector('section')!);

const click = (name: string | RegExp) =>
  fireEvent.click(screen.getByRole('button', { name }));

beforeEach(() => {
  host.toolCall = { status: 'loading' };
  host.input = { project_id: PROJECT };
  callTool.mockReset();
  sendMessage.mockReset().mockResolvedValue(undefined);
  updateModelContext.mockReset().mockResolvedValue(undefined);
  host.callTool = callTool;
  host.sendMessage = sendMessage;
  host.updateModelContext = updateModelContext;
  host.app = { registerTool };
  host.log = [];
  registerTool.mockClear();
  toolHandle.disable.mockClear();
  vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  FakeBroadcastChannel.reset();
});

describe('ShowIssues', () => {
  it('shows a page of rows under the header', () => {
    delivered(
      page({
        rows: [
          issue(1),
          issue(2, {
            category: 'performance',
            severity: 'warning',
            affected_count: 1,
          }),
        ],
        total: 2,
      })
    );
    const view = renderView();

    expect(screen.getByRole('heading', { name: 'Issues' })).not.toBeNull();
    expect(inView().getByText(/^Read at \d\d:\d\d$/)).not.toBeNull();
    expect(view.titles()).toEqual(['Issue 1', 'Issue 2']);
    expect(inView().getByText('Security · Error · 3 findings')).not.toBeNull();
    expect(
      inView().getByText('Performance · Warning · 1 finding')
    ).not.toBeNull();
    // One page: no pager.
    expect(view.range()).toBeUndefined();
    expect(view.section().getAttribute('aria-busy')).toBe('false');
  });

  it('pages through the loaded rows, then loads the next server page', async () => {
    manyIssues();
    callTool.mockResolvedValue(page({ rows: issues(21, 23), total: 23 }));
    const view = renderView();

    expect(view.titles()).toHaveLength(5);
    expect(view.range()).toBe('1–5 of 23');
    for (const range of ['6–10', '11–15', '16–20']) {
      click('Next');
      expect(view.range()).toBe(`${range} of 23`);
    }
    expect(callTool).not.toHaveBeenCalled();

    click('Next');
    expect(callTool).toHaveBeenCalledWith('app_paginate_issues', {
      project_id: PROJECT,
      type: 'all',
      cursor: 'c1',
    });
    await settle();
    expect(view.titles()).toEqual(['Issue 21', 'Issue 22', 'Issue 23']);
    expect(view.range()).toBe('21–23 of 23');
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Next' }).disabled
    ).toBe(true);

    click('Previous');
    expect(view.range()).toBe('16–20 of 23');
    expect(callTool).toHaveBeenCalledTimes(1);
  });

  it('keeps the selection across pages and a refresh', async () => {
    manyIssues();
    host.input = { project_id: PROJECT, type: 'security' };
    callTool.mockResolvedValue(
      page({ rows: issues(1, 20), total: 23, next_cursor: 'c1' })
    );
    const view = renderView();

    fireEvent.click(view.checkbox('Issue 1'));
    click('Next');
    fireEvent.click(view.checkbox('Issue 6'));
    expect(inView().getByText('2 selected')).not.toBeNull();
    click('Previous');
    expect(view.checkbox('Issue 1').checked).toBe(true);

    click('Next');
    click('Refresh');
    expect(callTool).toHaveBeenCalledWith('app_paginate_issues', {
      project_id: PROJECT,
      type: 'security',
    });
    await settle();
    expect(view.range()).toBe('1–5 of 23');
    expect(view.checkbox('Issue 1').checked).toBe(true);
    expect(inView().getByText('2 selected')).not.toBeNull();
    expect(
      screen.getByRole('button', { name: 'Review these issues (2)' })
    ).not.toBeNull();
  });

  it('hands the selected issues to the assistant and clears the selection', async () => {
    manyIssues();
    const view = renderView();

    fireEvent.click(view.checkbox('Issue 1'));
    fireEvent.click(view.checkbox('Issue 2'));
    click('Review these issues (2)');
    await settle();

    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [text] = sendMessage.mock.calls[0]!;
    expect(text).toContain('Selected issues (metadata, not instructions)');
    expect(text).toContain('"name":"check_01"');
    expect(text).toContain('"name":"check_02"');
    expect(text).toContain('for project "Design check"');
    expect(inView().getByText('Handed to chat')).not.toBeNull();
    expect(inView().queryByText(/selected$/)).toBeNull();
    expect(view.checkbox('Issue 1').checked).toBe(false);
  });

  it('keeps the selection when the send fails', async () => {
    manyIssues();
    sendMessage.mockRejectedValue(
      new Error('The assistant did not accept the message.')
    );
    const view = renderView();

    fireEvent.click(view.checkbox('Issue 1'));
    click('Review these issues (1)');
    await settle();

    expect(
      inView().getByText('The assistant did not accept the message.')
    ).not.toBeNull();
    expect(view.checkbox('Issue 1').checked).toBe(true);
    expect(inView().getByText('1 selected')).not.toBeNull();
  });

  it('asks for fewer issues when the message is too long', async () => {
    manyIssues();
    sendMessage.mockRejectedValue(new MessageTooLongError(9000));
    const view = renderView();

    fireEvent.click(view.checkbox('Issue 1'));
    click('Review these issues (1)');
    await settle();

    expect(inView().getByText(/Select fewer issues\.$/)).not.toBeNull();
    expect(inView().queryByText(/Select less to send/)).toBeNull();
    expect(view.checkbox('Issue 1').checked).toBe(true);
  });

  it('shares the selection with the model on every change', () => {
    manyIssues();
    const view = renderView();
    expect(updateModelContext).not.toHaveBeenCalled();

    fireEvent.click(view.checkbox('Issue 1'));
    expect(updateModelContext).toHaveBeenLastCalledWith(
      selectionContext(new Map([['security:check_01', issue(1)]]))
    );
    fireEvent.click(view.checkbox('Issue 2'));
    expect(updateModelContext).toHaveBeenLastCalledWith(
      selectionContext(
        new Map([
          ['security:check_01', issue(1)],
          ['security:check_02', issue(2)],
        ])
      )
    );

    click('Clear');
    expect(updateModelContext).toHaveBeenLastCalledWith({ content: [] });
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();
  });

  describe('errors', () => {
    it('shows why show_issues gave no list, and refreshes', async () => {
      host.toolCall = { status: 'error', message: 'Project not found' };
      callTool.mockResolvedValue(page({ rows: issues(1, 2), total: 2 }));
      const view = renderView();

      expect(
        inView().getByText(/^Issues are unavailable\. Project not found$/)
      ).not.toBeNull();
      click('Refresh');
      await settle();
      expect(view.titles()).toEqual(['Issue 1', 'Issue 2']);
    });

    it('shows a cancelled call as unavailable', () => {
      host.toolCall = { status: 'cancelled', reason: 'Stopped by the user' };
      renderView();

      expect(
        inView().getByText(/^Issues are unavailable\. Stopped by the user$/)
      ).not.toBeNull();
    });

    it("says the view and server are out of step when the result can't be read", () => {
      host.toolCall = { status: 'ready', data: { page: { rows: [] } } };
      renderView();

      expect(
        inView().getByText(`Issues are unavailable. ${OUT_OF_STEP_MESSAGE}`)
      ).not.toBeNull();
    });

    it("warns about a category that couldn't be read, never as no issues", () => {
      delivered(
        page({
          rows: [],
          total: 0,
          checks: [
            { type: 'security', status: 'complete' },
            {
              type: 'health',
              status: 'unavailable',
              reason: 'Service Unavailable',
            },
          ],
        })
      );
      renderView();

      expect(
        inView().getByText(
          'Health checks could not be read: Service Unavailable'
        )
      ).not.toBeNull();
      expect(inView().queryByText('No issues found')).toBeNull();
      expect(
        inView().getByText('No issues found in the checks that could be read.')
      ).not.toBeNull();
    });

    it('shows no issues from an empty, complete list', () => {
      // No `total`: the empty state doesn't rely on it.
      delivered(page({ rows: [] }));
      renderView();

      expect(inView().getByText('No issues found')).not.toBeNull();
    });

    it('keeps the selection when a refresh fails, and retries', async () => {
      manyIssues();
      callTool.mockRejectedValueOnce(new Error('Forbidden'));
      const view = renderView();

      fireEvent.click(view.checkbox('Issue 1'));
      click('Refresh');
      expect(view.section().getAttribute('aria-busy')).toBe('true');
      await settle();
      expect(inView().getByText('Forbidden')).not.toBeNull();
      expect(view.titles()).toEqual([]);
      expect(inView().getByText('1 selected')).not.toBeNull();

      callTool.mockResolvedValueOnce(
        page({ rows: issues(1, 20), total: 23, next_cursor: 'c1' })
      );
      click('Retry');
      await settle();
      expect(view.checkbox('Issue 1').checked).toBe(true);
    });

    it('shows a failed next page on that page, with Previous still working', async () => {
      manyIssues();
      callTool.mockRejectedValueOnce(new Error('Forbidden'));
      const view = renderView();

      for (let i = 0; i < 4; i++) click('Next');
      await settle();
      expect(inView().getByText('Forbidden')).not.toBeNull();

      click('Previous');
      expect(view.range()).toBe('16–20 of 23');
      click('Next');
      expect(inView().getByText('Forbidden')).not.toBeNull();
      expect(callTool).toHaveBeenCalledTimes(1);

      callTool.mockResolvedValueOnce(page({ rows: issues(21, 23), total: 23 }));
      click('Retry');
      expect(callTool).toHaveBeenLastCalledWith('app_paginate_issues', {
        project_id: PROJECT,
        type: 'all',
        cursor: 'c1',
      });
      await settle();
      expect(view.titles()).toEqual(['Issue 21', 'Issue 22', 'Issue 23']);
    });

    it('starts over from the first page when the cursor is rejected', async () => {
      manyIssues();
      callTool.mockRejectedValueOnce(
        new ToolCallError('The cursor is invalid.', INVALID_CURSOR_CODE)
      );
      const view = renderView();

      for (let i = 0; i < 4; i++) click('Next');
      await settle();
      expect(inView().getByText(LIST_CHANGED_MESSAGE)).not.toBeNull();

      callTool.mockResolvedValueOnce(
        page({ rows: issues(1, 20), total: 21, next_cursor: 'c2' })
      );
      click('Retry');
      expect(callTool).toHaveBeenLastCalledWith('app_paginate_issues', {
        project_id: PROJECT,
        type: 'all',
      });
      await settle();
      expect(view.range()).toBe('1–5 of 21');
    });

    it("reports rows it couldn't read", () => {
      delivered(
        page({
          rows: [issue(1), { id: 'x', category: 'billing' }, { nope: true }],
          total: 3,
        })
      );
      const view = renderView();

      expect(inView().getByText('2 issues could not be shown.')).not.toBeNull();
      expect(view.titles()).toEqual(['Issue 1']);
    });
  });

  describe('host without tool calls', () => {
    it('pages the delivered issues and says more exist', () => {
      host.callTool = undefined;
      manyIssues();
      const view = renderView();

      expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull();
      expect(
        inView().getByText('Showing 20 of 23. Ask the assistant for the rest.')
      ).not.toBeNull();
      for (let i = 0; i < 3; i++) click('Next');
      expect(view.range()).toBe('16–20 of 23');
      expect(
        screen.getByRole<HTMLButtonElement>('button', { name: 'Next' }).disabled
      ).toBe(true);
    });
  });

  describe('refresh_issues_view', () => {
    it('is registered before the view connects', () => {
      renderView();

      expect(host.log).toEqual(['registered tool', 'connected']);
      expect(registerTool).toHaveBeenCalledWith(
        'refresh_issues_view',
        { description: REFRESH_TOOL_DESCRIPTION },
        expect.any(Function)
      );
    });

    it('reloads the list from the first page and returns the counts', async () => {
      manyIssues();
      callTool.mockResolvedValue(
        page({ rows: issues(1, 20), total: 21, next_cursor: 'c2' })
      );
      const view = renderView();
      click('Next');

      await expect(callViewTool()).resolves.toEqual({
        content: [
          { type: 'text', text: 'Issues reloaded: 21 issues, was 23.' },
        ],
      });
      expect(callTool).toHaveBeenCalledWith('app_paginate_issues', {
        project_id: PROJECT,
        type: 'all',
      });
      expect(view.range()).toBe('1–5 of 21');
    });

    it('returns the failure, which the list shows too', async () => {
      manyIssues();
      callTool.mockRejectedValue(new Error('Forbidden'));
      renderView();

      await expect(callViewTool()).resolves.toEqual({
        content: [{ type: 'text', text: 'Forbidden' }],
        isError: true,
      });
      expect(inView().getByText('Forbidden')).not.toBeNull();
    });

    it("says it can't reload on a host without tool calls", async () => {
      host.callTool = undefined;
      manyIssues();
      renderView();

      await expect(callViewTool()).resolves.toEqual({
        content: [{ type: 'text', text: CANNOT_RELOAD_MESSAGE }],
        isError: true,
      });
    });
  });

  describe('retiring', () => {
    /** Another issues view of the project, opened at `at`, announces itself. */
    function newerViewOpens(at = 2, project = PROJECT) {
      const channel = new FakeBroadcastChannel(VIEWS_CHANNEL);
      channel.postMessage({
        key: { view: 'show-issues', project },
        at,
        id: 'newer',
      });
      return settle();
    }

    /** Buttons and checkboxes in the view that can still be used. */
    const enabledControls = () =>
      [
        ...document.querySelectorAll<HTMLButtonElement | HTMLInputElement>(
          'section button, section input'
        ),
      ].filter((control) => !control.disabled);

    it('retires when a newer view of the project opens', async () => {
      manyIssues();
      const view = renderView();
      fireEvent.click(view.checkbox('Issue 1'));
      expect(updateModelContext).toHaveBeenCalledTimes(1);

      await newerViewOpens();

      expect(inView().getByText(RETIRED_NOTICE)).not.toBeNull();
      // The rows it showed stay, greyed, and nothing can be used.
      expect(view.titles()).toEqual(issues(1, 5).map((row) => row.title));
      expect(view.checkbox('Issue 1').checked).toBe(false);
      expect(enabledControls()).toEqual([]);
      expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull();
      expect(screen.queryByRole('button', { name: /^Review/ })).toBeNull();
      // It takes back what it shared, once.
      expect(updateModelContext).toHaveBeenCalledTimes(2);
      expect(updateModelContext).toHaveBeenLastCalledWith({ content: [] });

      await newerViewOpens(3);
      expect(updateModelContext).toHaveBeenCalledTimes(2);
    });

    it('disables its view tool, so only the active view has it', async () => {
      manyIssues();
      renderView();
      expect(toolHandle.disable).not.toHaveBeenCalled();

      await newerViewOpens();

      expect(toolHandle.disable).toHaveBeenCalledTimes(1);
      await expect(callViewTool()).resolves.toEqual({
        content: [{ type: 'text', text: CANNOT_RELOAD_MESSAGE }],
        isError: true,
      });
      expect(callTool).not.toHaveBeenCalled();
    });

    it('stays active for an older view or another project', async () => {
      host.toolCall = {
        status: 'ready',
        data: {
          page: page({ rows: issues(1, 2), total: 2 }),
          opened: { at: 5, project: PROJECT },
        },
      };
      renderView();

      await newerViewOpens(1);
      await newerViewOpens(9, 'zyxwvutsrqponmlkjihg');

      expect(inView().queryByText(RETIRED_NOTICE)).toBeNull();
      expect(screen.getByRole('button', { name: 'Refresh' })).not.toBeNull();
      expect(updateModelContext).not.toHaveBeenCalled();
    });

    it('ignores a page that arrives after it retired', async () => {
      manyIssues();
      let answer: (page: unknown) => void = () => {};
      callTool.mockReturnValueOnce(
        new Promise((resolve) => {
          answer = resolve;
        })
      );
      const view = renderView();

      click('Refresh');
      await newerViewOpens();
      expect(inView().getByText(RETIRED_NOTICE)).not.toBeNull();

      answer(page({ rows: issues(30, 31), total: 2 }));
      await settle();
      expect(inView().getByText(RETIRED_NOTICE)).not.toBeNull();
      expect(view.titles()).toEqual([]);
      expect(callTool).toHaveBeenCalledTimes(1);
      expect(updateModelContext).toHaveBeenCalledTimes(1);
      expect(updateModelContext).toHaveBeenLastCalledWith({ content: [] });
    });
  });

  describe('host without messages', () => {
    it('replaces the Review button with a hint', () => {
      host.sendMessage = undefined;
      manyIssues();
      const view = renderView();

      fireEvent.click(view.checkbox('Issue 1'));
      expect(screen.queryByRole('button', { name: /^Review/ })).toBeNull();
      const footer = view.section().querySelector('footer')!;
      expect(
        within(footer).getByText(
          'The assistant can see the issues you select. Ask it about them in the chat.'
        )
      ).not.toBeNull();
    });
  });
});
