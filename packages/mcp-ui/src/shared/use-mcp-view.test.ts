import type {
  App,
  McpUiHostCapabilities,
} from '@modelcontextprotocol/ext-apps';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VIEW_DATA_META_KEY } from './tool-result';
import { useMcpView } from './use-mcp-view';

type ToolResult = Parameters<NonNullable<App['ontoolresult']>>[0];

const sdk = vi.hoisted(() => ({
  capabilities: {} as McpUiHostCapabilities,
  /** What happened to the fake app, in order. */
  log: [] as string[],
  app: undefined as unknown as App,
}));

// Creates the fake app, calls `onAppCreated`, then "connects" on the next
// effect, as the SDK's `useApp` does.
vi.mock('@modelcontextprotocol/ext-apps/react', async () => {
  const { useEffect, useState } = await import('react');
  return {
    useHostStyles: () => {},
    useApp: ({ onAppCreated }: { onAppCreated?: (app: App) => void }) => {
      const [app, setApp] = useState<App | null>(null);
      useEffect(() => {
        const created = {
          getHostCapabilities: () => sdk.capabilities,
          getHostContext: () => undefined,
          sendMessage: vi.fn().mockResolvedValue({}),
          updateModelContext: vi.fn().mockResolvedValue({}),
        } as unknown as App;
        sdk.app = created;
        onAppCreated?.(created);
        sdk.log.push('connected');
        setApp(created);
      }, []);
      return { app, isConnected: Boolean(app), error: null };
    },
  };
});

afterEach(() => {
  cleanup();
  sdk.capabilities = {};
  sdk.log = [];
});

function view(capabilities: McpUiHostCapabilities = {}) {
  sdk.capabilities = capabilities;
  return renderHook(() =>
    useMcpView<unknown>('test-view', {
      onAppCreated: (app) => {
        // The hook's own handlers are set before the option runs.
        sdk.log.push(app.ontoolresult ? 'created with handlers' : 'created');
      },
    })
  );
}

const deliver = (result: ToolResult) =>
  act(() => sdk.app.ontoolresult?.(result));

describe('useMcpView', () => {
  it('runs onAppCreated before connecting', () => {
    view();
    expect(sdk.log).toEqual(['created with handlers', 'connected']);
  });

  it('uses the view data in _meta when present', () => {
    const { result } = view();
    deliver({
      content: [{ type: 'text', text: 'Opened the issues view.' }],
      _meta: { [VIEW_DATA_META_KEY]: { page: 1 } },
    });
    expect(result.current.toolCall).toEqual({
      status: 'ready',
      data: { page: 1 },
    });
  });

  it('falls back to the JSON text', () => {
    const { result } = view();
    deliver({ content: [{ type: 'text', text: '{"id":"abc"}' }] });
    expect(result.current.toolCall).toEqual({
      status: 'ready',
      data: { id: 'abc' },
    });
  });

  it('offers no host actions the host lacks', () => {
    const { result } = view({});
    expect(result.current.app).not.toBeNull();
    expect(result.current.sendMessage).toBeUndefined();
    expect(result.current.updateModelContext).toBeUndefined();
    expect(result.current.callTool).toBeUndefined();
    expect(result.current.openLink).toBeUndefined();
  });

  it('sends messages through the message limits when the host takes them', async () => {
    const { result } = view({ message: { text: {} } });
    await result.current.sendMessage?.('Review\n\n\n\n\nthese');
    expect(sdk.app.sendMessage).toHaveBeenCalledWith({
      role: 'user',
      content: [{ type: 'text', text: 'Review\n\n\nthese' }],
    });
    await expect(
      result.current.sendMessage?.('a'.repeat(8001))
    ).rejects.toThrow(/8,000/);
  });

  it('updates the model context when the host accepts it', async () => {
    const { result } = view({ updateModelContext: { text: {} } });
    const params = { content: [{ type: 'text' as const, text: 'Selected' }] };
    await expect(result.current.updateModelContext?.(params)).resolves.toBe(
      undefined
    );
    expect(sdk.app.updateModelContext).toHaveBeenCalledWith(params);
  });
});
