import { useEffect, useState } from 'react';

/**
 * The one channel every view that retires its older copies talks on. Views
 * of other kinds and projects hear each other's messages and drop them.
 */
export const VIEWS_CHANNEL = 'supabase-mcp-views';

/**
 * What a view shows: its name, plus the project ref when it has one. Only
 * views with the same key retire each other.
 */
export type ViewKey = { view: string; project?: string };

/** What a view posts on the channel. */
export type ViewStamp = {
  key: ViewKey;
  /** When the server opened the view, by the server's clock. */
  at: number;
  /** Made at random once per view, to break ties on `at`. */
  id: string;
};

/**
 * How `theirs` compares with `mine`: a newer or an older view with the same
 * key, or `other` (a different key, or this view's own stamp). The later
 * `at` is newer; on a tie, the larger `id`.
 */
export function compareStamps(
  mine: ViewStamp,
  theirs: ViewStamp
): 'newer' | 'older' | 'other' {
  if (
    theirs.key.view !== mine.key.view ||
    theirs.key.project !== mine.key.project
  ) {
    return 'other';
  }
  if (theirs.at !== mine.at) return theirs.at > mine.at ? 'newer' : 'older';
  if (theirs.id === mine.id) return 'other';
  return theirs.id > mine.id ? 'newer' : 'older';
}

/**
 * A stamp from the channel, or undefined for anything else. Any view, of
 * any version, can post there, so nothing is taken on trust.
 */
export function readStamp(data: unknown): ViewStamp | undefined {
  if (typeof data !== 'object' || data === null) return undefined;
  const { key, at, id } = data as Record<string, unknown>;
  if (typeof key !== 'object' || key === null) return undefined;
  const { view, project } = key as Record<string, unknown>;
  if (
    typeof view !== 'string' ||
    (project !== undefined && typeof project !== 'string') ||
    typeof at !== 'number' ||
    typeof id !== 'string'
  ) {
    return undefined;
  }
  return { key: project === undefined ? { view } : { view, project }, at, id };
}

/** Random, and needs no secure context (unlike `crypto.randomUUID`). */
const newViewId = () =>
  Array.from(crypto.getRandomValues(new Uint32Array(2)), (part) =>
    part.toString(36)
  ).join('-');

/**
 * Whether a newer view with the same key has opened, so this one should
 * retire. Each tool call mounts a new view, and the older ones stay live
 * further up the chat.
 *
 * Once it has its stamp (`at`, from the tool result), the view posts it on
 * `VIEWS_CHANNEL`. A view that hears an older stamp with its key answers
 * with its own, so an older view that mounts late (as when a saved chat is
 * reopened) still learns it is old. A view that hears a newer stamp with its
 * key retires, for good.
 *
 * Without a stamp, or where the browser has no `BroadcastChannel`, the view
 * takes no part and never retires.
 */
export function useSupersession(key: ViewKey, at: number | undefined) {
  const [id] = useState(newViewId);
  const [retired, setRetired] = useState(false);
  const { view, project } = key;

  useEffect(() => {
    if (at === undefined || typeof BroadcastChannel === 'undefined') return;
    const mine: ViewStamp = {
      key: project === undefined ? { view } : { view, project },
      at,
      id,
    };
    const channel = new BroadcastChannel(VIEWS_CHANNEL);
    channel.onmessage = ({ data }: MessageEvent) => {
      const theirs = readStamp(data);
      if (!theirs) return;
      switch (compareStamps(mine, theirs)) {
        case 'newer':
          setRetired(true);
          break;
        case 'older':
          // A retired view still answers: it is newer than the one asking.
          channel.postMessage(mine);
          break;
      }
    };
    channel.postMessage(mine);
    return () => channel.close();
  }, [view, project, at, id]);

  return retired;
}
