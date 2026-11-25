import type { CallToolResult } from '@modelcontextprotocol/client';

const FALLBACK_ERROR = 'The tool call failed.';

/**
 * The error text from an `isError` tool result. Reads `error.message` or
 * `message` from a JSON body, otherwise the plain text itself (the common
 * case: the server turns a thrown error into text). Falls back to a generic
 * message if there is nothing usable.
 */
export function parseToolError(result: CallToolResult): string {
  const text = result.content
    .flatMap((part) => (part.type === 'text' ? [part.text.trim()] : []))
    .find(Boolean);
  if (!text) return FALLBACK_ERROR;

  try {
    const parsed = JSON.parse(text);
    const message = parsed?.error?.message ?? parsed?.message ?? parsed?.error;
    if (typeof message === 'string' && message.trim()) return message.trim();
    // Valid JSON (e.g. a bare string), but not an error shape we know.
    if (typeof parsed === 'string' && parsed.trim()) return parsed.trim();
    return FALLBACK_ERROR;
  } catch {
    return text;
  }
}

/**
 * Parses the JSON text from a successful tool result. For an `isError`
 * result, use `parseToolError`.
 *
 * TODO: read `structuredContent` once the server sends it (AI-847, AI-1364).
 */
export function parseToolResult<T>(result: CallToolResult): T {
  const [first] = result.content;
  if (!first || first.type !== 'text') {
    throw new Error('Tool result has no text content');
  }

  return JSON.parse(first.text) as T;
}

/**
 * The `_meta` key a tool result carries its view's data under, which the
 * model does not read. `VIEW_DATA_META_KEY` in mcp-server-supabase
 * `src/apps/index.ts`; the view cannot import server code at run time.
 */
export const VIEW_DATA_META_KEY = 'supabase.com/view';

/**
 * The view's data from a successful tool result: `_meta[VIEW_DATA_META_KEY]`
 * when the server sends it, otherwise the JSON text (see `parseToolResult`).
 */
export function parseViewResult<T>(result: CallToolResult): T {
  const data = result._meta?.[VIEW_DATA_META_KEY];
  return data === undefined ? parseToolResult<T>(result) : (data as T);
}
