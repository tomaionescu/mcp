import type { App } from '@modelcontextprotocol/ext-apps';
import { describe, expect, it, vi } from 'vitest';
import { sendMessage } from './send-message';

function fakeApp(result: unknown = {}) {
  const send = vi.fn().mockResolvedValue(result);
  return { app: { sendMessage: send } as unknown as App, send };
}

describe('sendMessage', () => {
  it('sends the tidied text as one user text block', async () => {
    const { app, send } = fakeApp();
    await sendMessage(app, '  Review\n\n\n\n\nthese  ');
    expect(send).toHaveBeenCalledWith({
      role: 'user',
      content: [{ type: 'text', text: 'Review\n\n\nthese' }],
    });
  });

  it('throws without sending when the text is too long', async () => {
    const { app, send } = fakeApp();
    await expect(sendMessage(app, 'a'.repeat(8001))).rejects.toThrow(
      /up to 8,000 characters/
    );
    expect(send).not.toHaveBeenCalled();
  });

  it('throws without sending when the text is blank', async () => {
    const { app, send } = fakeApp();
    await expect(sendMessage(app, ' \n ')).rejects.toThrow('empty');
    expect(send).not.toHaveBeenCalled();
  });

  it('throws when the host returns an error result', async () => {
    const { app } = fakeApp({ isError: true });
    await expect(sendMessage(app, 'hi')).rejects.toThrow(
      'The assistant did not accept the message.'
    );
  });

  it('rejects when the transport fails', async () => {
    const send = vi.fn().mockRejectedValue(new Error('offline'));
    const app = { sendMessage: send } as unknown as App;
    await expect(sendMessage(app, 'hi')).rejects.toThrow('offline');
  });
});
