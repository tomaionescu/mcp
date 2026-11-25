import type { CallToolResult } from '@modelcontextprotocol/client';
import { describe, expect, it } from 'vitest';
import {
  parseToolError,
  parseToolErrorCode,
  parseToolResult,
  parseViewResult,
  VIEW_DATA_META_KEY,
} from './tool-result';

const result = (...texts: string[]): CallToolResult => ({
  content: texts.map((text) => ({ type: 'text', text })),
});

describe('parseToolError', () => {
  it('returns plain text, trimmed', () => {
    expect(parseToolError(result('  boom \n'))).toBe('boom');
  });

  it.each([
    ['error.message', '{"error":{"message":"a"}}', 'a'],
    ['message', '{"message":"b"}', 'b'],
    ['error string', '{"error":"c"}', 'c'],
    ['bare JSON string', '"d"', 'd'],
  ])('reads %s from JSON', (_, body, expected) => {
    expect(parseToolError(result(body))).toBe(expected);
  });

  it.each([
    ['no content', result()],
    ['blank text', result('   ')],
    ['unknown JSON shape', result('{"foo":1}')],
    ['empty message', result('{"message":"  "}')],
    [
      'non-text content',
      {
        content: [{ type: 'image', data: '', mimeType: 'image/png' }],
      } as CallToolResult,
    ],
  ])('falls back to a generic message for %s', (_, r) => {
    expect(parseToolError(r)).toBe('The tool call failed.');
  });

  it('skips blank parts and uses the first with text', () => {
    expect(parseToolError(result('', 'second'))).toBe('second');
  });
});

describe('parseToolErrorCode', () => {
  it('reads error.code from a JSON body', () => {
    const body =
      '{"error":{"name":"ToolCallerError","message":"m","code":"x"}}';
    expect(parseToolErrorCode(result(body))).toBe('x');
  });

  it.each([
    ['plain text', result('boom')],
    ['no code', result('{"error":{"message":"m"}}')],
    ['a non-string code', result('{"error":{"message":"m","code":7}}')],
    ['an empty code', result('{"error":{"message":"m","code":""}}')],
    ['a top-level code', result('{"code":"x"}')],
    ['no content', result()],
  ])('is undefined for %s', (_, r) => {
    expect(parseToolErrorCode(r)).toBeUndefined();
  });
});

describe('parseToolResult', () => {
  it('parses the first text part as JSON', () => {
    expect(parseToolResult(result('[1,2]'))).toEqual([1, 2]);
  });

  it('throws with no content', () => {
    expect(() => parseToolResult(result())).toThrow(/no text content/);
  });

  it('throws on non-text first content', () => {
    const r = {
      content: [{ type: 'image', data: '', mimeType: 'image/png' }],
    } as CallToolResult;
    expect(() => parseToolResult(r)).toThrow(/no text content/);
  });

  it('throws on invalid JSON', () => {
    expect(() => parseToolResult(result('not json'))).toThrow(SyntaxError);
  });
});

describe('parseViewResult', () => {
  it('reads the view data from _meta, not the text', () => {
    const r: CallToolResult = {
      ...result('Opened the issues view for the user.'),
      _meta: { [VIEW_DATA_META_KEY]: { page: 1 } },
    };
    expect(parseViewResult(r)).toEqual({ page: 1 });
  });

  it('falls back to the JSON text without view data', () => {
    const r: CallToolResult = {
      ...result('{"id":"abc"}'),
      _meta: { 'supabase.com/dashboardUrl': 'https://example.com' },
    };
    expect(parseViewResult(r)).toEqual({ id: 'abc' });
    expect(parseViewResult(result('[1]'))).toEqual([1]);
  });

  it('throws like parseToolResult when neither is there', () => {
    expect(() => parseViewResult(result())).toThrow(/no text content/);
  });
});
