import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { markdownSpans } from '../../core/markdown';
import { compileRule, outermostSpans, textSpans } from '../../core/text';

describe('link spans', () => {
  it('lists markdown, wiki and reference links on a line', () => {
    const line = 'See [a](b.md), [[Note]] and [c][ref].';
    const texts = outermostSpans(markdownSpans(line)).map((s) => line.slice(s.start, s.end));
    assert.deepEqual(texts, ['[a](b.md)', '[[Note]]', '[c][ref]']);
  });

  it('lists URLs (trimmed) and custom pattern matches', () => {
    const rule = { pattern: '\\bABC-\\d+\\b', target: 'x' };
    const line = 'Ticket ABC-1 at https://x.org/a.';
    const texts = textSpans(line, [{ regex: compileRule(rule) }]).map((s) => line.slice(s.start, s.end));
    assert.deepEqual(texts.sort(), ['ABC-1', 'https://x.org/a']);
  });

  it('keeps only the outermost of nested spans', () => {
    assert.deepEqual(
      outermostSpans([
        { start: 4, end: 10 },
        { start: 0, end: 20 },
        { start: 25, end: 30 },
        { start: 20, end: 22 },
      ]),
      [
        { start: 0, end: 20 },
        { start: 20, end: 22 },
        { start: 25, end: 30 },
      ],
    );
  });
});
