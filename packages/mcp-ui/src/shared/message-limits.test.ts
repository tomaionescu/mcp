import { describe, expect, it } from 'vitest';
import {
  MessageTooLongError,
  messageBlocks,
  tidyMessageText,
} from './message-limits';

describe('tidyMessageText', () => {
  it('collapses more than three line breaks in a row to three', () => {
    expect(tidyMessageText('a\n\n\n\n\n\nb')).toBe('a\n\n\nb');
    expect(tidyMessageText('a\r\n\r\n\r\n\r\nb')).toBe('a\n\n\nb');
  });

  it('cuts runs of spaces or tabs to 64', () => {
    expect(tidyMessageText(`a${' '.repeat(200)}b`)).toBe(`a${' '.repeat(64)}b`);
    expect(tidyMessageText(`a${'\t'.repeat(65)}b`)).toBe(
      `a${'\t'.repeat(64)}b`
    );
  });

  it('leaves ordinary formatting alone and trims the ends', () => {
    expect(tidyMessageText('  a\n\n\nb    c \n')).toBe('a\n\n\nb    c');
  });
});

describe('messageBlocks', () => {
  it('drops blank blocks', () => {
    expect(messageBlocks(['Review these issues', '   '])).toEqual([
      'Review these issues',
    ]);
  });

  it('accepts 8,000 characters, counting one between blocks', () => {
    expect(messageBlocks(['a'.repeat(4000), 'b'.repeat(3999)])).toHaveLength(2);
    expect(messageBlocks(['a'.repeat(8000)])).toHaveLength(1);
  });

  it('asks the user to send less rather than cut what they selected', () => {
    expect(() => messageBlocks(['a'.repeat(4000), 'b'.repeat(4000)])).toThrow(
      'The assistant accepts messages of up to 8,000 characters, and this one has 8,001. Select less to send.'
    );
    expect(() => messageBlocks(['a'.repeat(8001)])).toThrow(
      MessageTooLongError
    );
  });

  it('measures the text after trimming', () => {
    expect(
      messageBlocks([`${'a'.repeat(7000)}${' '.repeat(2000)}b`])[0]
    ).toHaveLength(7065);
  });
});
