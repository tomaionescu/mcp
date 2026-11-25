import type { App } from '@modelcontextprotocol/ext-apps';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerViewTool, type ViewTool } from './view-tools';

const result = { content: [{ type: 'text' as const, text: 'Done.' }] };

const tool: ViewTool = {
  name: 'refresh_test_view',
  description: 'Reloads the test view.',
  handler: vi.fn(async () => result),
};

/** A fake app: `registerTool` returns a handle whose `disable` is a spy. */
function fakeApp() {
  const registered = { disable: vi.fn() };
  const registerTool = vi.fn((..._args: unknown[]) => registered);
  return {
    app: { registerTool } as unknown as App,
    registerTool,
    registered,
    /** The callback the app was given. */
    callback: () => registerTool.mock.calls[0]![2] as () => Promise<unknown>,
  };
}

/** Gives the document a WebMCP `modelContext` for this test. */
function withModelContext(modelContext: Record<string, unknown>) {
  Object.defineProperty(document, 'modelContext', {
    value: modelContext,
    configurable: true,
  });
}

afterEach(() => {
  delete (document as { modelContext?: unknown }).modelContext;
  vi.clearAllMocks();
});

describe('registerViewTool', () => {
  it('registers with the app only, where the browser has no WebMCP', async () => {
    const { app, registerTool, callback } = fakeApp();
    registerViewTool(app, tool);

    expect(registerTool).toHaveBeenCalledWith(
      'refresh_test_view',
      { description: 'Reloads the test view.' },
      expect.any(Function)
    );
    await expect(callback()()).resolves.toBe(result);
  });

  it('registers with the app and WebMCP, both calling the one handler', async () => {
    const registerWebMcp = vi.fn();
    withModelContext({ registerTool: registerWebMcp });
    const { app, callback } = fakeApp();
    registerViewTool(app, tool);

    expect(registerWebMcp).toHaveBeenCalledTimes(1);
    const [definition] = registerWebMcp.mock.calls[0]!;
    expect(definition).toMatchObject({
      name: 'refresh_test_view',
      description: 'Reloads the test view.',
      inputSchema: { type: 'object', properties: {} },
    });
    await expect(definition.execute()).resolves.toBe(result);
    await expect(callback()()).resolves.toBe(result);
    expect(tool.handler).toHaveBeenCalledTimes(2);
  });

  it('disables the tool in both places with one handle', () => {
    const unregister = vi.fn();
    const registerWebMcp = vi.fn(() => unregister);
    withModelContext({ registerTool: registerWebMcp });
    const { app, registered } = fakeApp();

    registerViewTool(app, tool).disable();

    expect(registered.disable).toHaveBeenCalledTimes(1);
    expect(unregister).toHaveBeenCalledTimes(1);
    const [, options] = registerWebMcp.mock.calls[0] as unknown as [
      unknown,
      { signal: AbortSignal },
    ];
    expect(options.signal.aborted).toBe(true);
  });

  it.each([
    [
      'an object with unregister()',
      (unregister: () => void) => ({
        registerTool: () => ({ unregister }),
      }),
    ],
    [
      'unregisterTool(name)',
      (unregister: (name: string) => void) => ({
        registerTool: () => undefined,
        unregisterTool: unregister,
      }),
    ],
  ])('removes the WebMCP tool through %s', (_, modelContext) => {
    const unregister = vi.fn();
    withModelContext(modelContext(unregister));
    const { app } = fakeApp();

    registerViewTool(app, tool).disable();

    expect(unregister).toHaveBeenCalledTimes(1);
  });

  it('keeps the app registration when WebMCP throws', () => {
    withModelContext({
      registerTool: () => {
        throw new Error('Tool already registered');
      },
    });
    const { app, registerTool, registered } = fakeApp();

    const handle = registerViewTool(app, tool);
    expect(registerTool).toHaveBeenCalledTimes(1);
    handle.disable();
    expect(registered.disable).toHaveBeenCalledTimes(1);
  });

  it('survives a WebMCP removal that throws', () => {
    withModelContext({
      registerTool: () => () => {
        throw new Error('Unknown tool');
      },
    });
    const { app, registered } = fakeApp();

    expect(() => registerViewTool(app, tool).disable()).not.toThrow();
    expect(registered.disable).toHaveBeenCalledTimes(1);
  });
});
