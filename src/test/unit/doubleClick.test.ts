import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DoubleClickDetector, isWholeWord, SelectionSample } from '../../core/doubleClick';

const SEPARATORS = '`~!@#$%^&*()-=+[{]}\\|;:\'",.<>/?';
const LINE = 'See [the docs](docs/setup.md) for more.';

function sample(startChar: number, endChar: number, overrides: Partial<SelectionSample> = {}): SelectionSample {
  return { time: 1000, fromMouse: true, count: 1, startLine: 0, endLine: 0, startChar, endChar, ...overrides };
}

describe('isWholeWord', () => {
  it('accepts exactly one word', () => {
    assert.equal(isWholeWord(LINE, 15, 19, SEPARATORS), true); // "docs"
    assert.equal(isWholeWord(LINE, 0, 3, SEPARATORS), true); // "See" at line start
  });

  it('rejects partial words, multiple words and separators', () => {
    assert.equal(isWholeWord(LINE, 15, 18, SEPARATORS), false); // "doc"
    assert.equal(isWholeWord(LINE, 5, 13, SEPARATORS), false); // "the docs"
    assert.equal(isWholeWord(LINE, 14, 15, SEPARATORS), false); // "("
    assert.equal(isWholeWord(LINE, 3, 3, SEPARATORS), false);
  });
});

describe('DoubleClickDetector', () => {
  it('detects a single jump to a word selection', () => {
    const detector = new DoubleClickDetector();
    assert.equal(detector.feed(sample(16, 16, { time: 900 }), LINE, SEPARATORS), false); // first click
    assert.equal(detector.feed(sample(15, 19, { time: 1000 }), LINE, SEPARATORS), true); // second click
  });

  it('detects a double-click when the cursor was already there (no first event)', () => {
    const detector = new DoubleClickDetector();
    assert.equal(detector.feed(sample(15, 19), LINE, SEPARATORS), true);
  });

  it('ignores a drag that ends on a word boundary', () => {
    const detector = new DoubleClickDetector();
    detector.feed(sample(15, 15, { time: 900 }), LINE, SEPARATORS);
    detector.feed(sample(15, 17, { time: 950 }), LINE, SEPARATORS);
    assert.equal(detector.feed(sample(15, 19, { time: 1000 }), LINE, SEPARATORS), false);
  });

  it('accepts a double-click long after an earlier drag', () => {
    const detector = new DoubleClickDetector();
    detector.feed(sample(4, 9, { time: 0 }), LINE, SEPARATORS);
    assert.equal(detector.feed(sample(15, 19, { time: 5000 }), LINE, SEPARATORS), true);
  });

  it('ignores keyboard selections, multi-cursor and multi-line selections', () => {
    const detector = new DoubleClickDetector();
    assert.equal(detector.feed(sample(15, 19, { fromMouse: false }), LINE, SEPARATORS), false);
    assert.equal(detector.feed(sample(15, 19, { count: 2, time: 5000 }), LINE, SEPARATORS), false);
    assert.equal(detector.feed(sample(15, 19, { endLine: 1, time: 9000 }), LINE, SEPARATORS), false);
  });
});
