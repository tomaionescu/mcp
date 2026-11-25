/**
 * View tools: tools a view registers with its host, for the model to call.
 *
 * This file is the only vendor-specific runtime code in the views. It picks
 * its paths by feature detection alone: it never checks the host's name and
 * never touches `window.openai`.
 *
 * SDK 2.1.0 of `@modelcontextprotocol/ext-apps` mirrors `app.registerTool`
 * to WebMCP itself. When upgrading to it, delete the WebMCP bridge here, or
 * each tool is registered with WebMCP twice.
 */
import type { CallToolResult } from '@modelcontextprotocol/client';
import type { App } from '@modelcontextprotocol/ext-apps';

/** A view tool. It takes no input. */
export type ViewTool = {
  name: string;
  /** Hosts may show the model only the first line, so it must stand alone. */
  description: string;
  /** Written once: both registrations call it. */
  handler: () => Promise<CallToolResult>;
};

/** Disables a view tool everywhere it was registered. */
export type ViewToolHandle = { disable: () => void };

/**
 * Registers `tool` with the host the MCP Apps way (`app.registerTool`), and
 * with WebMCP (`document.modelContext`) where the browser has it. Call it
 * before the view connects (`useMcpView`'s `onAppCreated`): the handshake
 * then declares the tools capability.
 */
export function registerViewTool(app: App, tool: ViewTool): ViewToolHandle {
  const registered = app.registerTool(
    tool.name,
    { description: tool.description },
    () => tool.handler()
  );
  const unregisterWebMcp = registerWithWebMcp(tool);
  return {
    disable: () => {
      registered.disable();
      unregisterWebMcp?.();
    },
  };
}

/**
 * The WebMCP part, as far as we know it. The exact shape of
 * `document.modelContext.registerTool`, and how to remove a tool, are not
 * yet confirmed in a real host. So this tolerates each shape we have seen
 * proposed: `registerTool` returning a function that unregisters, or an
 * object with `unregister()`, or a separate `unregisterTool(name)`, or an
 * `AbortSignal` passed in. Any failure here leaves the MCP Apps
 * registration working. Returns how to unregister, or undefined when the
 * tool wasn't registered.
 */
function registerWithWebMcp(tool: ViewTool): (() => void) | undefined {
  const modelContext = (document as { modelContext?: WebMcpModelContext })
    .modelContext;
  if (typeof modelContext?.registerTool !== 'function') return undefined;

  const abort = new AbortController();
  let registration: unknown;
  try {
    registration = modelContext.registerTool(
      {
        name: tool.name,
        description: tool.description,
        inputSchema: { type: 'object', properties: {} },
        execute: () => tool.handler(),
      },
      { signal: abort.signal }
    );
  } catch {
    return undefined;
  }

  return () => {
    try {
      abort.abort();
      if (typeof registration === 'function') {
        registration();
      } else if (hasUnregister(registration)) {
        registration.unregister();
      } else if (typeof modelContext.unregisterTool === 'function') {
        modelContext.unregisterTool(tool.name);
      }
    } catch {
      // Already gone, or this browser can't remove tools: nothing to do.
    }
  };
}

type WebMcpModelContext = {
  registerTool?: (
    tool: {
      name: string;
      description: string;
      inputSchema: Record<string, unknown>;
      execute: () => Promise<CallToolResult>;
    },
    options?: { signal?: AbortSignal }
  ) => unknown;
  unregisterTool?: (name: string) => void;
};

const hasUnregister = (value: unknown): value is { unregister: () => void } =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { unregister?: unknown }).unregister === 'function';
