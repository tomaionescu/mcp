import { describe, expect, it } from 'vitest';
import {
  CANNOT_RELOAD_MESSAGE,
  REFRESH_TOOL_DESCRIPTION,
  refreshIssuesViewTool,
  reloadSummary,
} from './refresh-tool';

describe('reloadSummary', () => {
  it.each([
    [{ before: 23, after: 21 }, 'Issues reloaded: 21 issues, was 23.'],
    [{ before: 2, after: 1 }, 'Issues reloaded: 1 issue, was 2.'],
    [{ after: 0 }, 'Issues reloaded: 0 issues.'],
    [{ before: 1 }, 'Issues reloaded. There was 1 issue before.'],
    [{ before: 4 }, 'Issues reloaded. There were 4 issues before.'],
    [{}, 'Issues reloaded.'],
  ])('%o: %s', (counts, text) => {
    expect(reloadSummary(counts)).toBe(text);
  });
});

describe('refreshIssuesViewTool', () => {
  it('has a first line that stands alone, under 200 characters', () => {
    const [firstLine] = REFRESH_TOOL_DESCRIPTION.split('\n');
    expect(firstLine).toBe(REFRESH_TOOL_DESCRIPTION);
    expect(firstLine!.length).toBeLessThan(200);
  });

  it('returns the counts as one line', async () => {
    const tool = refreshIssuesViewTool(() => async () => ({
      before: 23,
      after: 21,
    }));
    await expect(tool.handler()).resolves.toEqual({
      content: [{ type: 'text', text: 'Issues reloaded: 21 issues, was 23.' }],
    });
  });

  it('returns an error result when the reload fails', async () => {
    const tool = refreshIssuesViewTool(() => async () => {
      throw new Error('Forbidden');
    });
    await expect(tool.handler()).resolves.toEqual({
      content: [{ type: 'text', text: 'Forbidden' }],
      isError: true,
    });
  });

  it("returns an error result when the view can't reload", async () => {
    const tool = refreshIssuesViewTool(() => undefined);
    await expect(tool.handler()).resolves.toEqual({
      content: [{ type: 'text', text: CANNOT_RELOAD_MESSAGE }],
      isError: true,
    });
  });
});
