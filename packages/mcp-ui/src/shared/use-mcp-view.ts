import type {
  App,
  McpUiHostCapabilities,
  McpUiHostContext,
} from '@modelcontextprotocol/ext-apps';
import { useApp } from '@modelcontextprotocol/ext-apps/react';
import { useEffect, useState } from 'react';
import { callTool as callServerTool, type CallTool } from './call-tool';
import { type SendMessage, sendMessage } from './send-message';
import { parseToolError, parseViewResult } from './tool-result';
import { useHostStyles } from './use-host-styles';

export type ToolCallState<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'cancelled'; reason?: string }
  /** The tool call returned an error, or the view couldn't read its result. */
  | { status: 'error'; message: string };

/**
 * Replaces what the host shares with the model about the view
 * (`ui/update-model-context`). Each update replaces the last, so send the
 * whole state each time; `{ content: [] }` clears it.
 */
export type UpdateModelContext = (
  params: Parameters<App['updateModelContext']>[0]
) => Promise<void>;

export type McpViewOptions = {
  /**
   * Runs once the app is created, before it connects to the host, with the
   * handlers `useMcpView` needs already set. Register view tools here
   * (`app.registerTool`), so the handshake declares them. Read once, when the
   * view mounts.
   */
  onAppCreated?: (app: App) => void;
};

export type McpView<T> = {
  toolCall: ToolCallState<T>;
  /** The connected app, `null` until the host handshake completes. */
  app: App | null;
  /** Arguments of the tool call the view was opened for, once received. */
  input: Record<string, unknown> | undefined;
  hostContext: McpUiHostContext | undefined;
  /** What the host supports, once connected (empty until then). */
  hostCapabilities: McpUiHostCapabilities;
  /** Dashboard base URL the server links to, from the tool result's `_meta`. */
  dashboardUrl: string;
  /**
   * Calls a tool on the originating server; undefined until the app is
   * connected, and when the host can't proxy tool calls.
   */
  callTool: CallTool | undefined;
  /** A string argument of the tool call, if sent and a string. */
  inputText: (key: string) => string | undefined;
  /**
   * Asks the host to open a link; undefined when the host can't open links
   * (a sandboxed view can't open them itself).
   */
  openLink: ((url: string) => void) | undefined;
  /**
   * Sends a message to the assistant as the user, tidied to fit
   * `message-limits.ts`; rejects when it is too long or the host refuses it.
   * Undefined when the host can't receive messages from views.
   */
  sendMessage: SendMessage | undefined;
  /**
   * Shares the view's state with the model for its next turn. Undefined when
   * the host doesn't accept context updates.
   */
  updateModelContext: UpdateModelContext | undefined;
};

/**
 * Connects a view to its host. Returns the state of the tool call the view
 * was opened for (its result once it arrives: the view data in `_meta`, or
 * else the parsed JSON text), the app, the tool input, the host context and
 * capabilities, and helpers built on them (`callTool`, `inputText`,
 * `openLink`, `sendMessage`, `updateModelContext`). A helper is undefined when
 * the host can't do what it does. Also applies the host's styles (see
 * `useHostStyles`).
 */
export function useMcpView<T>(
  name: string,
  options: McpViewOptions = {}
): McpView<T> {
  const [toolCall, setToolCall] = useState<ToolCallState<T>>({
    status: 'loading',
  });
  const [input, setInput] = useState<Record<string, unknown>>();
  const [hostContext, setHostContext] = useState<McpUiHostContext>();
  // Older servers don't send it; they only link to production.
  const [dashboardUrl, setDashboardUrl] = useState(
    'https://supabase.com/dashboard'
  );

  const { app, error } = useApp({
    appInfo: { name, version: '0.0.0' },
    capabilities: {},
    onAppCreated: (app) => {
      app.ontoolinput = ({ arguments: args }) => setInput(args);
      app.ontoolresult = (result) => {
        // DASHBOARD_URL_META_KEY in mcp-server-supabase `src/apps/index.ts`.
        const metaUrl = result._meta?.['supabase.com/dashboardUrl'];
        if (typeof metaUrl === 'string') setDashboardUrl(metaUrl);
        if (result.isError) {
          setToolCall({ status: 'error', message: parseToolError(result) });
          return;
        }
        try {
          setToolCall({ status: 'ready', data: parseViewResult<T>(result) });
        } catch (err) {
          setToolCall({ status: 'error', message: String(err) });
        }
      };
      // Without this, a cancelled call (by the user or host) would leave the
      // view loading forever.
      app.ontoolcancelled = ({ reason }) => {
        setToolCall({ status: 'cancelled', reason });
      };
      app.onhostcontextchanged = (changed) =>
        setHostContext((current) => ({ ...current, ...changed }));
      options.onAppCreated?.(app);
    },
  });

  useEffect(() => {
    if (app) setHostContext((current) => app.getHostContext() ?? current);
  }, [app]);

  useHostStyles(app, hostContext);

  const hostCapabilities = app?.getHostCapabilities() ?? {};
  return {
    toolCall: error ? { status: 'error', message: error.message } : toolCall,
    app,
    input,
    hostContext,
    hostCapabilities,
    dashboardUrl,
    callTool:
      app && hostCapabilities.serverTools
        ? (name, args) => callServerTool(app, name, args)
        : undefined,
    inputText: (key) => {
      const value = input?.[key];
      return typeof value === 'string' ? value : undefined;
    },
    openLink:
      app && hostCapabilities.openLinks
        ? (url) => void app.openLink({ url })
        : undefined,
    sendMessage:
      app && hostCapabilities.message
        ? (text) => sendMessage(app, text)
        : undefined,
    updateModelContext:
      app && hostCapabilities.updateModelContext
        ? async (params) => {
            await app.updateModelContext(params);
          }
        : undefined,
  };
}
