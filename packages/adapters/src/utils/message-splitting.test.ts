import { describe, expect, test } from 'bun:test';
import { splitIntoParagraphChunks, splitIntoAtomicChunks } from './message-splitting';

describe('splitIntoParagraphChunks', () => {
  test('empty string returns empty array', () => {
    expect(splitIntoParagraphChunks('', 100)).toEqual([]);
  });

  test('short message returns single chunk', () => {
    const msg = 'Hello world';
    expect(splitIntoParagraphChunks(msg, 100)).toEqual(['Hello world']);
  });

  test('two paragraphs that fit return single chunk', () => {
    const msg = 'First paragraph.\n\nSecond paragraph.';
    expect(splitIntoParagraphChunks(msg, 100)).toEqual([msg]);
  });

  test('two paragraphs that do not fit return two chunks', () => {
    const msg = 'First paragraph here.\n\nSecond paragraph here.';
    // maxLength < total but > each paragraph
    expect(splitIntoParagraphChunks(msg, 25)).toEqual([
      'First paragraph here.',
      'Second paragraph here.',
    ]);
  });

  test('single long paragraph falls back to line splitting', () => {
    const msg = 'Line one\nLine two\nLine three';
    // maxLength can fit ~1 line but not all
    expect(splitIntoParagraphChunks(msg, 15)).toEqual(['Line one', 'Line two', 'Line three']);
  });

  test('single line longer than maxLength stays as one chunk', () => {
    const msg = 'ThisIsASingleVeryLongLineWithNoBreaks';
    expect(splitIntoParagraphChunks(msg, 10)).toEqual([msg]);
  });

  test('message exactly at maxLength returns single chunk', () => {
    const msg = 'ABCDE';
    expect(splitIntoParagraphChunks(msg, 5)).toEqual(['ABCDE']);
  });

  test('multiple paragraph breaks are normalized', () => {
    const msg = 'Para one.\n\n\n\nPara two.';
    expect(splitIntoParagraphChunks(msg, 100)).toEqual(['Para one.\n\nPara two.']);
  });

  test('combines short paragraphs then splits when exceeding', () => {
    const msg = 'A\n\nB\n\nC\n\nD';
    // maxLength can fit A + B but not A + B + C
    expect(splitIntoParagraphChunks(msg, 6)).toEqual(['A\n\nB', 'C\n\nD']);
  });

  test('mixed: some paragraphs fit, one triggers line fallback', () => {
    const shortPara = 'Short paragraph.';
    const longPara = 'Line A\nLine B\nLine C\nLine D';
    const msg = `${shortPara}\n\n${longPara}`;
    // maxLength 20: shortPara (16 chars) fits alone, longPara (27 chars) triggers line splitting
    // Lines A+B+C group together (18 chars with newlines), D gets its own chunk
    const result = splitIntoParagraphChunks(msg, 20);
    expect(result).toEqual(['Short paragraph.', 'Line A\nLine B\nLine C', 'Line D']);
  });
});

describe('splitIntoAtomicChunks', () => {
  test('empty string returns empty array', () => {
    expect(splitIntoAtomicChunks('', 100)).toEqual([]);
  });

  test('prose plus one small code block fits in a single chunk', () => {
    const msg = 'Here is code:\n```js\nconst x = 1;\n```';
    expect(splitIntoAtomicChunks(msg, 100)).toEqual([msg]);
  });

  test('a code block that would straddle a boundary stays whole', () => {
    const code = '```\nBB\n```'; // length 10
    const msg = `AAAA\n${code}`;
    // maxLength 10: prose (4) + code (10) exceed it, so the code block moves to its own chunk.
    const result = splitIntoAtomicChunks(msg, 10);
    expect(result).toEqual(['AAAA', code]);
    // Boundary never fell inside the fence.
    expect(result[1]?.startsWith('```')).toBe(true);
    expect(result[1]?.endsWith('```')).toBe(true);
  });

  test('a single code block larger than maxLength is emitted intact as one chunk', () => {
    const code = '```\n' + 'X'.repeat(50) + '\n```';
    const result = splitIntoAtomicChunks(code, 20);
    expect(result.length).toBe(1);
    expect(result[0]).toBe(code);
    expect(result[0]?.startsWith('```')).toBe(true);
    expect(result[0]?.endsWith('```')).toBe(true);
  });

  test('two code blocks separated by prose split at the prose boundary, never mid-fence', () => {
    const code1 = '```\naaa\n```'; // length 11
    const code2 = '```\nbbb\n```'; // length 11
    const msg = `${code1}\nmiddle\n${code2}`;
    const result = splitIntoAtomicChunks(msg, 12);
    expect(result).toEqual([code1, 'middle', code2]);
    // Both code chunks retain their full opening and closing fences.
    for (const chunk of [result[0], result[2]]) {
      expect(chunk?.startsWith('```')).toBe(true);
      expect(chunk?.endsWith('```')).toBe(true);
    }
  });

  test('an unterminated fence runs to EOF as one atomic chunk', () => {
    const msg = '```\nno close here';
    const result = splitIntoAtomicChunks(msg, 100);
    expect(result).toEqual([msg]);
  });
});
