/**
 * VS Code gives extensions no mouse events, but a double-click has a recognisable
 * footprint: a single mouse-driven selection change that selects exactly one word.
 * A drag-select also produces mouse selections, but it gets there through a series
 * of growing partial selections, which is what we use to tell the two apart.
 */

export interface SelectionSample {
  /** Time of the event in ms. */
  time: number;
  /** True when the selection change came from the mouse. */
  fromMouse: boolean;
  /** Number of cursors/selections in the editor. */
  count: number;
  startLine: number;
  startChar: number;
  endLine: number;
  endChar: number;
}

/** A selection changed from the mouse within this window counts as part of the same gesture. */
export const GESTURE_WINDOW_MS = 600;

const WHITESPACE = /\s/;

/**
 * True when `[start, end)` on `lineText` is exactly one word according to the editor's
 * `editor.wordSeparators` — i.e. what a double-click on that word selects.
 */
export function isWholeWord(lineText: string, start: number, end: number, separators: string): boolean {
  if (end <= start || end > lineText.length) {
    return false;
  }
  const isWordChar = (c: string) => !WHITESPACE.test(c) && !separators.includes(c);
  for (let i = start; i < end; i++) {
    if (!isWordChar(lineText[i])) {
      return false;
    }
  }
  const before = start > 0 ? lineText[start - 1] : undefined;
  const after = end < lineText.length ? lineText[end] : undefined;
  return (before === undefined || !isWordChar(before)) && (after === undefined || !isWordChar(after));
}

export class DoubleClickDetector {
  private previous: SelectionSample | undefined;

  /**
   * Feed every selection change through here. Returns true when the change looks like
   * the word selection produced by a double-click.
   */
  feed(sample: SelectionSample, lineText: string, separators: string): boolean {
    const previous = this.previous;
    this.previous = sample;

    if (!sample.fromMouse || sample.count !== 1 || sample.startLine !== sample.endLine) {
      return false;
    }
    if (sample.startChar === sample.endChar) {
      return false;
    }
    // A non-empty mouse selection just before this one means the user is dragging.
    if (
      previous &&
      previous.fromMouse &&
      sample.time - previous.time <= GESTURE_WINDOW_MS &&
      (previous.startLine !== previous.endLine || previous.startChar !== previous.endChar)
    ) {
      return false;
    }
    return isWholeWord(lineText, sample.startChar, sample.endChar, separators);
  }

  reset(): void {
    this.previous = undefined;
  }
}
