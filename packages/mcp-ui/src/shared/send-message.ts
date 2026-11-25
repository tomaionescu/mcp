import type { App } from '@modelcontextprotocol/ext-apps';
import { messageBlocks } from './message-limits';

/** Sends a message to the assistant as the user (`ui/message`). */
export type SendMessage = (text: string) => Promise<void>;

/**
 * Sends `text` as a user message, tidied to fit `message-limits.ts`. Throws
 * when the text is blank or too long (nothing is sent then), when the host
 * returns an error result, and on transport errors.
 */
export async function sendMessage(app: App, text: string): Promise<void> {
  const blocks = messageBlocks([text]);
  if (!blocks.length) throw new Error('The message is empty.');
  const result = await app.sendMessage({
    role: 'user',
    content: blocks.map((block) => ({ type: 'text', text: block })),
  });
  if (result.isError) {
    throw new Error('The assistant did not accept the message.');
  }
}
